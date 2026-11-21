import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { BookOpen, Plus, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, errorMessage } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { GRADES, SUBJECTS } from "@/src/lib/options";
import { Link } from "@/src/lib/router";
import {
  isWrongQuestionSessionError, isWrongQuestionWriteUncertain,
  wrongQuestionsClient as client, WRONG_QUESTION_REASONS as REASONS,
  WRONG_QUESTION_SOURCES as SOURCES, WRONG_QUESTION_STATUSES as STATUSES,
} from "@/src/lib/wrong-questions";
import type { WrongQuestion, WrongQuestionFilters, WrongQuestionInput, WrongQuestionReason, WrongQuestionStatus } from "@/src/lib/wrong-questions";

const LIMIT = 20;
const PUBLIC_CONFIRMATION = "公开后其他登录用户可见，不显示你的用户名和‘我的答案’";
const UNCERTAIN_MESSAGE = "本次写入结果无法确认，可能已经保存。请先刷新核对，勿重复提交；系统不会自动重试。";
const SELECT_CLASS = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const EMPTY_FILTERS: WrongQuestionFilters = { subject: "", chapter: "", reason: "", status: "" };
const EMPTY_FORM = { subject: "", grade: "", chapter: "", source: "", question: "", correct_answer: "", my_answer: "", reason: "", note: "" };
type EditDraft = { status: WrongQuestionStatus; reason: WrongQuestionReason; note: string };
type SessionErrorHandler = (error: unknown) => void;
type MutationKind = "create" | "save" | "public" | "private" | "delete" | "review";
const SUCCESS: Record<MutationKind, string> = {
  create: "错题已私密保存，可在下方详情中查看。", save: "状态、错因与备注已保存。",
  public: "已公开。其他登录用户下次刷新公开列表时可见。",
  private: "已转为私密，下次获取公开列表时将不再显示；他人已阅读或保存的内容无法收回。",
  delete: "错题已删除。", review: "已记录一次复习，次数和日期已更新；复习状态未自动改变。",
};

function editFrom(item: WrongQuestion): EditDraft {
  return { status: item.status, reason: item.reason, note: item.note ?? "" };
}
function dateText(value: string | null): string {
  if (!value) return "尚未复习";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "暂无日期" : date.toLocaleString("zh-CN");
}

// Invalidate before writes so an older read cannot overwrite the saved result.
function useRead<T>(load: () => Promise<T>, onSessionError: SessionErrorHandler) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string }>({ data: null, loading: true, error: "" });
  const generation = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const current = ++generation.current;
    setState({ data: null, loading: true, error: "" });
    load().then((data) => {
      if (!cancelled && current === generation.current) setState({ data, loading: false, error: "" });
    }).catch((error: unknown) => {
      if (cancelled || current !== generation.current) return;
      if (isWrongQuestionSessionError(error)) onSessionError(error);
      else setState({ data: null, loading: false, error: errorMessage(error) });
    });
    return () => { cancelled = true; };
  }, [load, onSessionError, revision]);
  const invalidate = useCallback(() => {
    generation.current++;
    setState((previous) => ({ ...previous, loading: false }));
  }, []);
  const refresh = useCallback(() => {
    generation.current++;
    setState({ data: null, loading: true, error: "" });
    setRevision((value) => value + 1);
  }, []);
  const replace = useCallback((data: T) => {
    generation.current++;
    setState({ data, loading: false, error: "" });
  }, []);
  return { ...state, invalidate, refresh, replace };
}

function Choice({ id, label, options, value, onChange, emptyLabel, labels, required = false }: {
  id: string; label: string; options: readonly string[]; value: string;
  onChange: (value: string) => void; emptyLabel?: string; labels?: Record<string, string>; required?: boolean;
}) {
  return <div className="flex min-w-0 flex-col gap-2">
    <Label htmlFor={id}>{label}</Label>
    <select id={id} className={SELECT_CLASS} value={value} onChange={(event) => onChange(event.target.value)} required={required}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map((option) => <option key={option} value={option}>{labels?.[option] ?? option}</option>)}
    </select>
  </div>;
}

function TextField({ id, label, value, onChange, limit, required = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void; limit: number; required?: boolean;
}) {
  return <div className="flex min-w-0 flex-col gap-2">
    <Label htmlFor={id}>{label}{required ? "（必填）" : "（选填）"}</Label>
    <Textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} required={required} maxLength={limit} rows={3} aria-describedby={`${id}-count`} className="min-w-0 [overflow-wrap:anywhere]" />
    <p id={`${id}-count`} className="text-right text-xs text-muted-foreground">{value.length} / {limit} 字符</p>
  </div>;
}

function PlainText({ label, value }: { label: string; value: string | null }) {
  return <div className="min-w-0">
    <h3 className="mb-1 text-sm font-medium">{label}</h3>
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{value || "未填写"}</p>
  </div>;
}

function ReadNotice({ loading, error, retry, disabled = false }: { loading: boolean; error: string; retry: () => void; disabled?: boolean }) {
  if (loading) return <p role="status" className="py-5 text-sm text-muted-foreground">正在加载错题…</p>;
  if (!error) return null;
  return <Alert variant="destructive"><AlertDescription className="flex flex-col items-start gap-2">
    <p>{error}</p><Button variant="outline" size="sm" disabled={disabled} onClick={retry}>重试读取</Button>
  </AlertDescription></Alert>;
}

function FilterBar({ publicOnly = false, disabled = false, onApply }: {
  publicOnly?: boolean; disabled?: boolean; onApply: (filters: WrongQuestionFilters) => void;
}) {
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  const prefix = publicOnly ? "public-filter" : "my-filter";
  function apply(event: FormEvent) {
    event.preventDefault();
    onApply({ ...draft, chapter: draft.chapter?.trim(), status: publicOnly ? "" : draft.status });
  }
  return <form onSubmit={apply}>
    <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Choice id={`${prefix}-subject`} label="学科" options={SUBJECTS} value={draft.subject ?? ""} onChange={(subject) => setDraft({ ...draft, subject })} emptyLabel="全部学科" />
      <div className="flex min-w-0 flex-col gap-2">
        <Label htmlFor={`${prefix}-chapter`}>章节（完整名称）</Label>
        <Input id={`${prefix}-chapter`} value={draft.chapter ?? ""} onChange={(event) => setDraft({ ...draft, chapter: event.target.value })} maxLength={100} placeholder="按完整章节名称精确匹配" />
      </div>
      <Choice id={`${prefix}-reason`} label="错因" options={REASONS} value={draft.reason ?? ""} onChange={(reason) => setDraft({ ...draft, reason })} emptyLabel="全部错因" />
      {!publicOnly && <Choice id={`${prefix}-status`} label="复习状态" options={Object.keys(STATUSES)} labels={STATUSES} value={draft.status ?? ""} onChange={(status) => setDraft({ ...draft, status: status as WrongQuestionStatus | "" })} emptyLabel="全部状态" />}
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="submit" variant="secondary">应用筛选</Button>
        <Button type="button" variant="outline" onClick={() => { setDraft(EMPTY_FILTERS); onApply(EMPTY_FILTERS); }}>重置筛选</Button>
      </div>
    </fieldset>
  </form>;
}

function Pager({ total, offset, onChange, disabled = false }: { total: number; offset: number; onChange: (offset: number) => void; disabled?: boolean }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
    <p className="text-sm text-muted-foreground">共 {total} 道 · 第 {Math.floor(offset / LIMIT) + 1} 页 · 每页 {LIMIT} 道</p>
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={disabled || offset === 0} onClick={() => onChange(Math.max(0, offset - LIMIT))}>上一页</Button>
      <Button variant="outline" size="sm" disabled={disabled || offset + LIMIT >= total} onClick={() => onChange(offset + LIMIT)}>下一页</Button>
    </div>
  </div>;
}

export default function WrongQuestionsPage() {
  const { user, loading } = useAuth();
  if (loading) return <p role="status" className="py-16 text-center text-sm text-muted-foreground">正在检查登录状态…</p>;
  if (!user) return <Card className="mx-auto max-w-lg">
    <CardHeader><CardTitle>我的错题本</CardTitle><CardDescription>登录后可整理自己的错题、记录复习，也可查看其他同学主动公开的题目。公开列表同样需要登录。</CardDescription></CardHeader>
    <CardContent><Button asChild><Link to="/login">登录 / 注册</Link></Button></CardContent>
  </Card>;
  return <NotebookSession key={user.id} userId={user.id} />;
}

function NotebookSession({ userId }: { userId: string }) {
  const [sessionError, setSessionError] = useState("");
  const onSessionError = useCallback((error: unknown) => setSessionError(errorMessage(error)), []);
  // Unmount all drafts and data, rather than leaving the previous account behind an alert.
  if (sessionError) return <Alert variant="destructive"><AlertDescription className="flex flex-col items-start gap-3">
    <p>{sessionError}。为保护隐私，已清除本页错题和表单。</p>
    <Button variant="outline" onClick={() => window.location.reload()}>刷新页面确认登录账号</Button>
  </AlertDescription></Alert>;
  return <div className="flex min-w-0 flex-col gap-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><BookOpen className="size-6 text-primary" aria-hidden />我的错题本</h1>
        <p className="mt-2 text-sm text-muted-foreground">自己整理题目与错因，按节奏复习；新增错题默认私密。</p></div>
      <Button asChild variant="outline"><Link to="/profile">返回个人中心</Link></Button>
    </header>
    <Alert><AlertDescription>请勿填写真实姓名、学校班级、联系方式等个人信息。公开前请确认题目与答案不含个人信息，不要发布未经授权的试卷、教材或其他受版权保护的原文。</AlertDescription></Alert>
    <Tabs defaultValue="mine" className="min-w-0 gap-4">
      <TabsList aria-label="错题视图"><TabsTrigger value="mine">我的错题</TabsTrigger><TabsTrigger value="public">公开题目</TabsTrigger></TabsList>
      <TabsContent value="mine" forceMount className="min-w-0 data-[state=inactive]:hidden"><MyNotebook userId={userId} onSessionError={onSessionError} /></TabsContent>
      <TabsContent value="public" className="min-w-0"><PublicFeed onSessionError={onSessionError} /></TabsContent>
    </Tabs>
  </div>;
}

function MyNotebook({ userId, onSessionError }: { userId: string; onSessionError: SessionErrorHandler }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filterKey, setFilterKey] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [uncertain, setUncertain] = useState<{ kind: MutationKind; id: string | null; refreshed: boolean } | null>(null);
  const [confirmation, setConfirmation] = useState<{ kind: "public" | "delete"; id: string } | null>(null);
  const busyRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const loadList = useCallback(() => client.list(userId, { ...filters, limit: LIMIT, offset }), [userId, filters, offset]);
  const list = useRead(loadList, onSessionError);
  const loadDetail = useCallback(async () => selectedId ? (await client.get(userId, selectedId)).item : null, [userId, selectedId]);
  const detail = useRead(loadDetail, onSessionError);
  const item = detail.data?.id === selectedId ? detail.data : null;
  const locked = busy || reconciling || uncertain !== null;
  useEffect(() => { if (item && !edit) setEdit(editFrom(item)); }, [item, edit]);
  useEffect(() => {
    if (!selectedId) return;
    const section = document.getElementById("wrong-question-detail");
    section?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: "start" });
  }, [selectedId]);

  function selectItem(id: string) {
    if (busyRef.current || (uncertain?.id && id !== uncertain.id)) return;
    if (id === selectedId) return;
    setSelectedId(id);
    setEdit(null);
  }

  async function mutate(kind: MutationKind, id: string | null, write: () => Promise<WrongQuestion | null>) {
    if (busyRef.current || uncertain) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    list.invalidate();
    detail.invalidate();
    let sent = false;
    try {
      // Stop known cross-tab account changes before sending a draft or delete.
      await client.stats(userId);
      if (!alive.current) return;
      sent = true;
      const saved = await write();
      if (!alive.current) return;
      if (saved) {
        setSelectedId(saved.id);
        detail.replace(saved);
        if (kind === "save" || kind === "create") setEdit(editFrom(saved));
      } else {
        setSelectedId(null);
        setEdit(null);
        detail.replace(null);
      }
      if (kind === "create") { setForm({ ...EMPTY_FORM }); setCreateOpen(false); }
      setMessage({ ok: true, text: SUCCESS[kind] });
      list.refresh();
    } catch (error) {
      if (!alive.current) return;
      if (isWrongQuestionSessionError(error)) { onSessionError(error); return; }
      if (sent && isWrongQuestionWriteUncertain(error)) {
        setUncertain({ kind, id, refreshed: false });
        setMessage({ ok: false, text: UNCERTAIN_MESSAGE });
      } else {
        setMessage({ ok: false, text: `${sent ? "" : "尚未提交。"}${errorMessage(error)}` });
        list.refresh();
        detail.refresh();
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function reconcile() {
    if (!uncertain || busyRef.current) return;
    busyRef.current = true;
    setReconciling(true);
    setUncertain({ ...uncertain, refreshed: false });
    list.invalidate();
    detail.invalidate();
    try {
      // Fetch unfiltered first page so a newly saved private question isn't hidden.
      const latest = await client.list(userId, { limit: LIMIT, offset: 0 });
      let latestItem: WrongQuestion | null = null;
      if (uncertain.id) {
        try { latestItem = (await client.get(userId, uncertain.id)).item; }
        catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
      }
      if (!alive.current) return;
      setFilters(EMPTY_FILTERS);
      setFilterKey((key) => key + 1);
      setOffset(0);
      list.replace(latest);
      if (uncertain.id) {
        setSelectedId(latestItem?.id ?? null);
        detail.replace(latestItem);
      } else {
        detail.refresh();
      }
      setUncertain({ ...uncertain, refreshed: true });
      setMessage({ ok: true, text: uncertain.id
        ? latestItem ? "已读取最新详情。请核对已保存的状态、错因、备注、可见范围及复习次数，再决定后续操作；编辑草稿仍保留。" : "已核对：这道错题当前不存在。请确认后解除锁定。"
        : "已读取未筛选的最新列表。请检查是否已新增成功，必要时翻页查看；若已保存，请勿再次提交。原表单仍保留。" });
    } catch (error) {
      if (!alive.current) return;
      if (isWrongQuestionSessionError(error)) onSessionError(error);
      else setMessage({ ok: false, text: `刷新核对失败，提交仍锁定。${errorMessage(error)}` });
    } finally {
      busyRef.current = false;
      if (alive.current) setReconciling(false);
    }
  }

  function create(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const required = [form.question, form.correct_answer, form.my_answer];
    if (required.some((value) => !value.trim()) || form.question.length > 5000 || form.correct_answer.length > 3000 || form.my_answer.length > 3000 || form.chapter.length > 100 || form.note.length > 2000 || !SUBJECTS.includes(form.subject as WrongQuestionInput["subject"]) || !SOURCES.includes(form.source as WrongQuestionInput["source"]) || !REASONS.includes(form.reason as WrongQuestionReason) || (form.grade && !GRADES.includes(form.grade as NonNullable<WrongQuestionInput["grade"]>))) {
      setMessage({ ok: false, text: "请填写学科、来源、错因和非空的题目、正确答案、我的答案，并检查字数限制。" });
      return;
    }
    const input: WrongQuestionInput = {
      ...form, subject: form.subject as WrongQuestionInput["subject"],
      source: form.source as WrongQuestionInput["source"], reason: form.reason as WrongQuestionReason,
      grade: (form.grade || null) as WrongQuestionInput["grade"],
      chapter: form.chapter.trim() || null, note: form.note.trim() || null,
    };
    void mutate("create", null, async () => (await client.create(userId, input)).item);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!item || !edit || locked) return;
    if (edit.note.length > 2000) { setMessage({ ok: false, text: "备注最多 2000 个字符。" }); return; }
    void mutate("save", item.id, async () => (await client.patch(userId, item.id, { status: edit.status, reason: edit.reason, note: edit.note.trim() || null })).item);
  }

  function confirmAction() {
    if (!confirmation || locked) return;
    const { kind, id } = confirmation;
    setConfirmation(null);
    if (kind === "public") void mutate("public", id, async () => (await client.patch(userId, id, { visibility: "public", public_confirmed: true })).item);
    else void mutate("delete", id, async () => { await client.remove(id); return null; });
  }

  return <div className="flex min-w-0 flex-col gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">私密题目只对自己可见，是否公开由你逐题决定。</p>
      <Button onClick={() => setCreateOpen((open) => !open)} disabled={busy || reconciling}><Plus className="size-4" aria-hidden />{createOpen ? "收起新增表单" : "新增错题"}</Button>
    </div>
    {message && <Alert variant={message.ok ? "default" : "destructive"} role="status"><AlertDescription>{message.text}</AlertDescription></Alert>}
    {busy && <p role="status" className="text-sm text-muted-foreground">正在处理，请勿重复提交…</p>}
    {uncertain && <Alert variant="destructive"><AlertDescription className="flex flex-col gap-3">
      <p>{UNCERTAIN_MESSAGE}所有写入暂时锁定，刷新不会丢弃表单，也不会重发操作。</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={reconciling} onClick={() => void reconcile()}>{reconciling ? "正在核对…" : "刷新并核对结果"}</Button>
        {uncertain.refreshed && <Button variant="outline" disabled={reconciling} onClick={() => { setUncertain(null); setMessage({ ok: true, text: "已解除锁定，没有重发任何操作。若已保存，请勿重复提交。" }); }}>我已核对，解除提交锁定</Button>}
      </div>
    </AlertDescription></Alert>}

    <Card className={`min-w-0 border-primary/20${createOpen ? "" : " hidden"}`}>
      <CardHeader><CardTitle className="text-lg">新增错题</CardTitle><CardDescription>仅支持手动整理纯文本；题目、正确答案和我的答案均必填。保存后为私密、待复习，不会自动生成解析。</CardDescription></CardHeader>
      <CardContent><form onSubmit={create}>
        <fieldset disabled={locked} className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Choice id="create-subject" label="学科（必填）" options={SUBJECTS} value={form.subject} onChange={(subject) => setForm({ ...form, subject })} emptyLabel="请选择学科" required />
            <Choice id="create-grade" label="年级（选填）" options={GRADES} value={form.grade} onChange={(grade) => setForm({ ...form, grade })} emptyLabel="未填写" />
            <div className="flex min-w-0 flex-col gap-2"><Label htmlFor="create-chapter">章节（选填，最多 100 字符）</Label><Input id="create-chapter" value={form.chapter} onChange={(event) => setForm({ ...form, chapter: event.target.value })} maxLength={100} /></div>
            <Choice id="create-source" label="来源（必填）" options={SOURCES} value={form.source} onChange={(source) => setForm({ ...form, source })} emptyLabel="请选择来源" required />
            <Choice id="create-reason" label="错因（必填）" options={REASONS} value={form.reason} onChange={(reason) => setForm({ ...form, reason })} emptyLabel="请选择错因" required />
          </div>
          <TextField id="create-question" label="题目" value={form.question} onChange={(question) => setForm({ ...form, question })} limit={5000} required />
          <div className="grid min-w-0 gap-4 md:grid-cols-2">
            <TextField id="create-correct-answer" label="正确答案" value={form.correct_answer} onChange={(correct_answer) => setForm({ ...form, correct_answer })} limit={3000} required />
            <TextField id="create-my-answer" label="我的答案" value={form.my_answer} onChange={(my_answer) => setForm({ ...form, my_answer })} limit={3000} required />
          </div>
          <TextField id="create-note" label="备注" value={form.note} onChange={(note) => setForm({ ...form, note })} limit={2000} />
          <div className="flex flex-wrap gap-2"><Button type="submit">保存为私密错题</Button><Button type="button" variant="outline" onClick={() => setForm({ ...EMPTY_FORM })}>清空表单</Button></div>
        </fieldset>
      </form></CardContent>
    </Card>

    <Card className="min-w-0">
      <CardHeader className="flex flex-wrap flex-row items-center justify-between gap-3"><CardTitle className="text-lg">我的错题列表</CardTitle><Button size="sm" variant="outline" disabled={busy || reconciling || list.loading} onClick={list.refresh}><RefreshCw className="size-4" aria-hidden />刷新列表</Button></CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <FilterBar key={filterKey} disabled={busy || reconciling} onApply={(value) => { setFilters(value); setOffset(0); }} />
        <ReadNotice loading={list.loading} error={list.error} retry={list.refresh} disabled={busy || reconciling} />
        {!list.loading && list.data && <>
          {list.data.items.length === 0 && <p className="py-5 text-sm text-muted-foreground">{offset > 0 ? "这一页暂无错题，请返回上一页。" : "暂无符合条件的错题。可以重置筛选，或新增一道私密错题。"}</p>}
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            {list.data.items.map((question) => <article key={question.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap gap-2"><Badge variant="secondary">{question.subject}</Badge><Badge variant="outline">{STATUSES[question.status]}</Badge><Badge variant={question.visibility === "public" ? "default" : "secondary"}>{question.visibility === "public" ? "已公开" : "私密"}</Badge></div>
              <p className="line-clamp-3 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{question.question}</p>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">章节：{question.chapter || "未填写"} · 错因：{question.reason}</p>
              <p className="text-xs text-muted-foreground">已复习 {question.review_count} 次 · {dateText(question.last_reviewed_at)}</p>
              <Button className="self-start" variant="outline" size="sm" disabled={busy || reconciling || Boolean(uncertain?.id && uncertain.id !== question.id)} onClick={() => selectItem(question.id)} aria-pressed={selectedId === question.id}>查看 / 管理</Button>
            </article>)}
          </div>
          <Pager total={list.data.total} offset={offset} onChange={setOffset} disabled={busy || reconciling} />
        </>}
      </CardContent>
    </Card>

    {selectedId && <Card id="wrong-question-detail" tabIndex={-1} aria-label="我的错题详情" className="min-w-0 scroll-mt-28 border-primary/25">
      <CardHeader className="flex flex-wrap flex-row items-center justify-between gap-3"><CardTitle className="text-lg">我的错题详情</CardTitle><div className="flex gap-2"><Button variant="outline" size="sm" onClick={detail.refresh} disabled={busy || reconciling || detail.loading}>刷新详情</Button><Button variant="ghost" size="sm" disabled={busy || reconciling || Boolean(uncertain?.id)} onClick={() => { setSelectedId(null); setEdit(null); }}>关闭详情</Button></div></CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-5">
        <ReadNotice loading={detail.loading} error={detail.error} retry={detail.refresh} disabled={busy || reconciling} />
        {item && <>
          <div className="flex flex-wrap gap-2"><Badge>{item.subject}</Badge><Badge variant="secondary">{item.grade || "年级未填"}</Badge><Badge variant="secondary">{item.source}</Badge><Badge variant="outline">{STATUSES[item.status]}</Badge><Badge variant="outline">{item.visibility === "public" ? "已公开" : "私密"}</Badge></div>
          <PlainText label="章节" value={item.chapter} /><PlainText label="题目" value={item.question} /><PlainText label="正确答案" value={item.correct_answer} /><PlainText label="我的答案（仅自己可见）" value={item.my_answer} />
          <PlainText label="已保存的错因" value={item.reason} /><PlainText label="已保存的备注（仅自己可见）" value={item.note} />
          <div className="flex flex-col gap-1 text-sm text-muted-foreground"><p>已复习 {item.review_count} 次 · 最近复习：{dateText(item.last_reviewed_at)}</p><p>创建时间：{dateText(item.created_at)}</p></div>
          {edit && <form onSubmit={save} className="border-t border-border pt-4">
            <fieldset disabled={locked} className="flex min-w-0 flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Choice id="edit-status" label="复习状态" options={Object.keys(STATUSES)} labels={STATUSES} value={edit.status} onChange={(status) => setEdit({ ...edit, status: status as WrongQuestionStatus })} />
                <Choice id="edit-reason" label="错因" options={REASONS} value={edit.reason} onChange={(reason) => setEdit({ ...edit, reason: reason as WrongQuestionReason })} />
              </div>
              <TextField id="edit-note" label="备注" value={edit.note} onChange={(note) => setEdit({ ...edit, note })} limit={2000} />
              <p className="text-xs text-muted-foreground">仅可修改状态、错因、备注与可见范围，题目和答案等原始记录不支持修改。刷新详情会保留未提交的编辑内容。</p>
              <div className="flex flex-wrap gap-2"><Button type="submit">保存状态、错因与备注</Button><Button type="button" variant="outline" onClick={() => setEdit(editFrom(item))}>恢复已保存的编辑内容</Button></div>
            </fieldset>
          </form>}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">“记录一次复习”只增加复习次数、更新日期，不会自动改变状态，也不会生成题目或解析。</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={locked} onClick={() => void mutate("review", item.id, async () => (await client.review(userId, item.id)).item)}>记录一次复习</Button>
              {item.visibility === "public" ? <Button variant="outline" disabled={locked} onClick={() => void mutate("private", item.id, async () => (await client.patch(userId, item.id, { visibility: "private" })).item)}>转为私密</Button> : <Button variant="outline" disabled={locked} onClick={() => setConfirmation({ kind: "public", id: item.id })}>公开这道错题</Button>}
              <Button variant="destructive" disabled={locked} onClick={() => setConfirmation({ kind: "delete", id: item.id })}>删除错题</Button>
            </div>
            <p className="text-xs text-muted-foreground">公开只展示学科、章节、题目、正确答案与错因。请先保存需要更新的错因；其他操作不会保存编辑草稿。转为私密后，下次获取公开列表不再展示，但无法收回他人已阅读或保存的内容。</p>
          </div>
        </>}
      </CardContent>
    </Card>}

    <AlertDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmation?.kind === "public" ? "确认公开这道错题？" : "确认删除这道错题？"}</AlertDialogTitle>
        <AlertDialogDescription>{confirmation?.kind === "public" ? PUBLIC_CONFIRMATION : "删除后无法恢复，题目、答案、备注和复习记录都会删除。取消不会执行任何写入。"}</AlertDialogDescription>
      </AlertDialogHeader>
        {confirmation?.kind === "public" && <p className="text-sm text-muted-foreground">请再次检查题目、正确答案和章节，不要公开个人信息或未经授权的版权原文。取消不会公开；以后可转为私密，但无法收回他人已阅读或保存的内容。</p>}
        <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction disabled={locked} variant={confirmation?.kind === "delete" ? "destructive" : "default"} onClick={confirmAction}>{confirmation?.kind === "public" ? "确认公开" : "确认删除"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function PublicFeed({ onSessionError }: { onSessionError: SessionErrorHandler }) {
  const [filters, setFilters] = useState<WrongQuestionFilters>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const load = useCallback(() => client.publicList({ subject: filters.subject, chapter: filters.chapter, reason: filters.reason, limit: LIMIT, offset }), [filters, offset]);
  const feed = useRead(load, onSessionError);
  return <Card className="min-w-0">
    <CardHeader className="flex flex-wrap flex-row items-start justify-between gap-3">
      <div className="flex flex-col gap-2"><CardTitle className="text-lg">公开题目</CardTitle><CardDescription>仅展示主动公开题目的学科、章节、题目、正确答案和错因，不展示姓名、用户名或“我的答案”。</CardDescription></div>
      <Button variant="outline" size="sm" disabled={feed.loading} onClick={feed.refresh}><RefreshCw className="size-4" aria-hidden />刷新公开列表</Button>
    </CardHeader>
    <CardContent className="flex min-w-0 flex-col gap-5">
      <p className="text-xs text-muted-foreground">作者转为私密或删除后，下次获取列表会更新。当前已阅读的内容不会瞬间消失；请使用刷新按钮获取最新列表。题目与答案由用户手动填写，请自行核对。</p>
      <FilterBar publicOnly onApply={(value) => { setFilters(value); setOffset(0); }} />
      <ReadNotice loading={feed.loading} error={feed.error} retry={feed.refresh} />
      {!feed.loading && feed.data && <>
        {feed.data.items.length === 0 && <p className="py-5 text-sm text-muted-foreground">{offset > 0 ? "这一页暂无公开题目，请返回上一页。" : "暂无符合条件的公开题目，可以重置筛选或稍后刷新。"}</p>}
        {feed.data.items.map((question, index) => <article key={`${offset}-${index}`} className="flex min-w-0 flex-col gap-4 rounded-lg border border-border p-4">
          <div className="flex flex-wrap gap-2"><Badge variant="secondary">{question.subject}</Badge><Badge variant="outline">{question.reason}</Badge></div>
          <PlainText label="章节" value={question.chapter} /><PlainText label="题目" value={question.question} /><PlainText label="正确答案" value={question.correct_answer} />
        </article>)}
        <Pager total={feed.data.total} offset={offset} onChange={setOffset} />
      </>}
    </CardContent>
  </Card>;
}
