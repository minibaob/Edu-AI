import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ClipboardList, Loader2, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, errorMessage } from "@/src/lib/api";
import HebeiScoreReference from "@/src/components/hebei-score-reference";
import {
  getSimulation, getSimulationOptions, SIMULATION_PAGE_SIZE, SIMULATION_RULES,
} from "@/src/lib/simulation";
import type { SimulationInput, SimulationItem, SimulationOptions, SimulationResponse } from "@/src/lib/simulation";

const selectClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive";

const GROUPS = [
  { key: "chong", label: "冲", range: "0 < d ≤ 10", color: "text-[var(--edu-violet)]" },
  { key: "wen", label: "稳", range: "−10 ≤ d ≤ 0", color: "text-primary" },
  { key: "bao", label: "保", range: "d < −10", color: "text-foreground" },
] as const;

type FormValues = { province: string; category: string; batch: string; score: string; rank: string };
type ValidationErrors = Partial<Record<"category" | "batch" | "score" | "rank", string>>;
type Submission = { input: SimulationInput; offset: number };

function signed(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
}

function UniversityCard({ item, showRank }: { item: SimulationItem; showRank: boolean }) {
  const hasRank = showRank && typeof item.min_rank === "number"
    && Number.isSafeInteger(item.min_rank) && item.min_rank > 0;
  const hasRankDifference = hasRank && typeof item.rank_difference === "number"
    && Number.isSafeInteger(item.rank_difference);

  return (
    <Card className="min-w-0 gap-3 py-4">
      <CardHeader className="gap-1 px-4">
        <CardTitle className="break-words text-base leading-snug"><h4>{item.name}</h4></CardTitle>
        <CardDescription className="break-words">学校代码：{item.university_code}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-muted-foreground">最低分</dt><dd className="font-semibold">{item.min_score} 分</dd></div>
          <div><dt className="text-muted-foreground">数据年份</dt><dd>{item.year} 年</dd></div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">分差 d（该校线 − 我的分）</dt>
            <dd className="font-semibold">{signed(item.d)} 分</dd>
          </div>
          {hasRank && <div className="col-span-2"><dt className="text-muted-foreground">最低位次</dt><dd>{item.min_rank}</dd></div>}
          {hasRankDifference && (
            <div className="col-span-2">
              <dt className="text-muted-foreground">位次差（该行最低位次 − 我的位次）</dt>
              <dd>{signed(item.rank_difference!)}</dd>
            </div>
          )}
        </dl>
        <div className="border-t border-border pt-3 text-xs text-muted-foreground">
          <p className="mb-1 font-medium">来源</p>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{item.source}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SimulationPage() {
  const [form, setForm] = useState<FormValues>({ province: "河北", category: "", batch: "", score: "", rank: "" });
  const [options, setOptions] = useState<SimulationOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [validation, setValidation] = useState<ValidationErrors>({});
  const [submitted, setSubmitted] = useState<Submission | null>(null);
  const [result, setResult] = useState<SimulationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryError, setQueryError] = useState("");
  const optionsSequence = useRef(0);
  const querySequence = useRef(0);
  const matching = useRef(false);

  useEffect(() => {
    const sequence = ++optionsSequence.current;
    setOptions(null);
    setOptionsLoading(true);
    setOptionsError("");
    getSimulationOptions(form.province)
      .then((data) => { if (sequence === optionsSequence.current) setOptions(data); })
      .catch((err) => {
        if (sequence !== optionsSequence.current) return;
        setOptionsError(err instanceof ApiError && err.status === 400
          ? "省份条件无效，请重新选择省份。" : errorMessage(err));
      })
      .finally(() => { if (sequence === optionsSequence.current) setOptionsLoading(false); });
    return () => { if (sequence === optionsSequence.current) optionsSequence.current += 1; };
  }, [form.province, optionsRetry]);

  useEffect(() => () => {
    querySequence.current += 1;
    matching.current = false;
  }, []);

  const categories = options?.available ? options.options : [];
  const batches = categories.find((item) => item.category === form.category)?.batches ?? [];
  const canSubmit = !optionsLoading && !optionsError && categories.length > 0;
  const maxTotal = result ? Math.max(result.groups.chong.total, result.groups.wen.total, result.groups.bao.total) : 0;

  // 在输入事件内立即作废请求，而非等下一轮 effect，避免旧响应回填。
  function clearResults() {
    querySequence.current += 1;
    matching.current = false;
    setLoading(false);
    setResult(null);
    setSubmitted(null);
    setQueryError("");
    setValidation({});
  }

  function changeField(field: keyof FormValues, value: string) {
    if (form[field] === value) return;
    clearResults();
    if (field === "province") {
      optionsSequence.current += 1;
      setOptions(null);
      setOptionsError("");
      setOptionsLoading(true);
    }
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "province") next.category = "";
      if (field === "province" || field === "category") next.batch = "";
      return next;
    });
  }

  function retryOptions() {
    if (optionsLoading) return;
    clearResults();
    setOptionsLoading(true);
    setOptionsRetry((value) => value + 1);
  }

  async function runSimulation(submission: Submission) {
    if (matching.current) return;
    matching.current = true;
    const sequence = ++querySequence.current;
    setSubmitted(submission);
    setResult(null);
    setQueryError("");
    setLoading(true);
    try {
      const data = await getSimulation(submission.input, submission.offset);
      if (sequence === querySequence.current) setResult(data);
    } catch (err) {
      if (sequence !== querySequence.current) return;
      setQueryError(err instanceof ApiError && err.status === 400
        ? "条件无效：请重新选择已收录的科类和批次；分数须为 0–750 的整数，位次须为正安全整数或留空。"
        : errorMessage(err));
    } finally {
      if (sequence === querySequence.current) {
        matching.current = false;
        setLoading(false);
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (matching.current || !canSubmit) return;
    const errors: ValidationErrors = {};
    if (!categories.some((item) => item.category === form.category)) errors.category = "请选择已收录的科类。";
    if (!batches.some((item) => item.batch === form.batch)) errors.batch = "请选择该科类下已收录的批次。";
    const scoreText = form.score.trim();
    const rankText = form.rank.trim();
    const score = Number(scoreText);
    const rank = rankText === "" ? null : Number(rankText);
    if (!/^\d+$/.test(scoreText) || !Number.isInteger(score) || score < 0 || score > 750) {
      errors.score = "请输入 0–750 的整数分数（含 0 和 750），不能留空。";
    }
    if (rank !== null && (!/^\d+$/.test(rankText) || !Number.isSafeInteger(rank) || rank <= 0)) {
      errors.rank = "位次须为正安全整数（不超过 9007199254740991），或留空。";
    }
    setValidation(errors);
    if (Object.keys(errors).length > 0) return;
    // 新建快照；后续分页与重试只使用此次明确提交的条件。
    void runSimulation({
      input: { province: form.province, category: form.category, batch: form.batch, score, rank },
      offset: 0,
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="edu-gradient-soft rounded-2xl border border-primary/15 p-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ClipboardList className="size-6 shrink-0 text-primary" aria-hidden /> 志愿模拟填报（规则版）
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">基于已收录真实数据进行规则匹配，帮助你对照学校分数线。</p>
      </header>

      <Card className="gap-3 border-primary/20">
        <CardHeader><CardTitle><h2 className="text-base">规则匹配说明</h2></CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed">
          <p className="font-medium">{SIMULATION_RULES.delta}</p>
          <p>{SIMULATION_RULES.chong}</p>
          <p>{SIMULATION_RULES.wen}</p>
          <p>{SIMULATION_RULES.bao}</p>
          <p className="text-muted-foreground">d &gt; 10 的学校不匹配。位次仅作对照，不参与分档。</p>
          <p className="text-muted-foreground">每档每页最多 {SIMULATION_PAGE_SIZE} 所，冲 / 稳 / 保三档同步翻页。</p>
        </CardContent>
      </Card>

      <Alert className="border-primary/40 bg-accent/50">
        <TriangleAlert aria-hidden />
        <AlertTitle className="line-clamp-none text-lg font-bold">仅供参考，不保证录取</AlertTitle>
        <AlertDescription>
          <p>跨年分数不可直接等同；河北数据是投档线，非最终录取线。</p>
          <p>本页不考虑选科要求或专项资格，请查阅高校官方招生章程。</p>
          <p>艺术、体育批次可能采用综合分；仅可输入与所选批次相同口径的分数，不能直接套用普通文化课总分。</p>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle><h2 className="text-lg">填写模拟条件</h2></CardTitle>
          <CardDescription>科类与批次仅来自所选省份已收录的物理类 / 历史类真实录取数据，批次随科类变化。</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate autoComplete="off" onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="simulation-province">高考省份</Label>
                <select id="simulation-province" className={selectClass} value={form.province}
                  onChange={(e) => changeField("province", e.target.value)}>
                  <option value="河北">河北</option>
                  <option value="河南">河南</option>
                  <option value="其他">其他省份（暂无数据，采集中）</option>
                </select>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="simulation-category">科类</Label>
                <select id="simulation-category" className={selectClass} value={form.category}
                  disabled={optionsLoading || categories.length === 0}
                  aria-invalid={Boolean(validation.category)} aria-describedby={validation.category ? "simulation-category-error" : undefined}
                  onChange={(e) => changeField("category", e.target.value)}>
                  <option value="">请选择科类</option>
                  {categories.map((item) => <option key={item.category} value={item.category}>{item.category}</option>)}
                </select>
                {validation.category && <p id="simulation-category-error" role="alert" className="text-sm text-destructive">{validation.category}</p>}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="simulation-batch">批次</Label>
                <select id="simulation-batch" className={selectClass} value={form.batch}
                  disabled={optionsLoading || batches.length === 0}
                  aria-invalid={Boolean(validation.batch)} aria-describedby={validation.batch ? "simulation-batch-error" : undefined}
                  onChange={(e) => changeField("batch", e.target.value)}>
                  <option value="">{form.category ? "请选择批次" : "请先选择科类"}</option>
                  {batches.map((item) => <option key={item.batch} value={item.batch}>{item.batch}（{item.year} 年）</option>)}
                </select>
                {validation.batch && <p id="simulation-batch-error" role="alert" className="text-sm text-destructive">{validation.batch}</p>}
              </div>
            </div>

            {optionsLoading && <p role="status" className="text-sm text-muted-foreground">正在加载{form.province === "其他" ? "其他省份" : form.province}的科类与批次…</p>}
            {optionsError && (
              <Alert variant="destructive">
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  {optionsError}
                  <Button type="button" variant="outline" size="sm" disabled={optionsLoading} onClick={retryOptions}>重试加载选项</Button>
                </AlertDescription>
              </Alert>
            )}
            {!optionsLoading && !optionsError && options && (!options.available || categories.length === 0) && (
              <Alert role="status"><AlertDescription>{options.message ?? "暂无数据，采集中"}</AlertDescription></Alert>
            )}
            {!optionsLoading && form.category && batches.length === 0 && (
              <p role="status" className="text-sm text-muted-foreground">该科类暂无可用批次，请选择其他科类。</p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="simulation-score">我的分数（必填）</Label>
                <Input id="simulation-score" type="text" inputMode="numeric" pattern="[0-9]*" required
                  value={form.score} onChange={(e) => changeField("score", e.target.value)} placeholder="请输入分数"
                  aria-invalid={Boolean(validation.score)}
                  aria-describedby={`simulation-score-hint${validation.score ? " simulation-score-error" : ""}`} />
                <p id="simulation-score-hint" className="text-xs text-muted-foreground">请输入 0–750 的整数，含两端边界。</p>
                {validation.score && <p id="simulation-score-error" role="alert" className="text-sm text-destructive">{validation.score}</p>}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="simulation-rank">我的位次（选填）</Label>
                <Input id="simulation-rank" type="text" inputMode="numeric" pattern="[0-9]*"
                  value={form.rank} onChange={(e) => changeField("rank", e.target.value)} placeholder="可留空"
                  aria-invalid={Boolean(validation.rank)}
                  aria-describedby={`simulation-rank-hint${validation.rank ? " simulation-rank-error" : ""}`} />
                <p id="simulation-rank-hint" className="text-xs text-muted-foreground">选填正安全整数；留空或记录没有真实位次时，不展示位次及差值。</p>
                {validation.rank && <p id="simulation-rank-error" role="alert" className="text-sm text-destructive">{validation.rank}</p>}
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">本页不持久化输入或志愿表；刷新或离开页面后需重新填写。修改任意条件后，需重新提交规则匹配。</p>
              <Button type="submit" disabled={!canSubmit || loading}>
                {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {loading ? "规则匹配中…" : "开始规则匹配"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {form.province === "河北" && <HebeiScoreReference category={form.category} />}

      {!submitted && <p className="py-4 text-center text-sm text-muted-foreground">请填写条件并提交，查看冲 / 稳 / 保三档规则匹配结果。</p>}
      {submitted && (
        <section aria-labelledby="simulation-results-title" aria-busy={loading} className="flex min-w-0 flex-col gap-4">
          <div className="space-y-2">
            <h2 id="simulation-results-title" className="text-lg font-semibold">模拟填报 · 规则匹配结果</h2>
            <p className="break-words text-sm">
              本次提交：{submitted.input.province} · {submitted.input.category} · {submitted.input.batch} · 我的分数 {submitted.input.score} 分
              {submitted.input.rank !== null && <> · 我的位次 {submitted.input.rank}</>}
            </p>
            <p className="text-sm text-muted-foreground">每档每页最多 {SIMULATION_PAGE_SIZE} 所，三档同步翻页；总页数按三档匹配总数的最大值计算。</p>
          </div>

          {loading && <p role="status" className="py-8 text-center text-sm text-muted-foreground">正在加载第 {Math.floor(submitted.offset / SIMULATION_PAGE_SIZE) + 1} 页规则匹配结果…</p>}
          {queryError && (
            <Alert variant="destructive">
              <AlertTitle>规则匹配暂未完成</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                {queryError}
                <Button type="button" variant="outline" size="sm" disabled={loading}
                  onClick={() => void runSimulation(submitted)}>重试本次匹配</Button>
              </AlertDescription>
            </Alert>
          )}

          {result && (
            <>
              <Card className="gap-3 bg-muted/40">
                <CardHeader>
                  <CardTitle className="text-base">数据范围说明</CardTitle>
                  <CardDescription>本次范围：{result.province} / {result.category} / {result.batch} · 最新数据年份：{result.year ?? "暂无数据"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>最新年无记录的学校：{result.skipped_universities} 所。以全站已登记学校为基数，统计当前省份、科类、批次最新年无记录的学校。</p>
                  <p>无效分数记录：{result.invalid_score_rows} 条，与无记录学校数分别统计。</p>
                  <p>超出规则范围的数量（d &gt; 10）：{result.outside_range_count}，不纳入三档规则匹配。</p>
                  <p className="text-xs text-muted-foreground">有记录不代表三档都有匹配学校；空档不等于该范围暂无数据。</p>
                </CardContent>
              </Card>

              {!result.available ? (
                <Alert role="status"><AlertDescription>{result.message ?? "暂无数据，采集中"}</AlertDescription></Alert>
              ) : (
                <>
                  {result.message && <p role="status" className="text-sm text-muted-foreground">{result.message}</p>}
                  {maxTotal === 0 && <p role="status" className="text-sm text-muted-foreground">当前范围有记录，但暂无符合三档规则的学校，请结合上方无效分数与范围外数量查看。</p>}
                  <div className="grid items-start gap-4 lg:grid-cols-3">
                    {GROUPS.map((group) => {
                      const data = result.groups[group.key];
                      return (
                        <section key={group.key} aria-labelledby={`simulation-${group.key}`} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-muted/50 p-3">
                          <div className="space-y-1 p-1">
                            <h3 id={`simulation-${group.key}`} className={`text-lg font-semibold ${group.color}`}>{group.label} · {group.range}</h3>
                            <p className="text-xs text-muted-foreground">规则匹配共 {data.total} 所 · 本页 {data.items.length} 所</p>
                          </div>
                          {data.items.length === 0 ? (
                            <p className="p-4 text-sm text-muted-foreground">{data.total === 0 ? "本档暂无符合规则的学校。" : "本档本页无学校，其他档可能仍有结果，可同步翻页查看。"}</p>
                          ) : data.items.map((item) => (
                            <UniversityCard key={item.university_code} item={item} showRank={submitted.input.rank !== null && result.rank !== null} />
                          ))}
                        </section>
                      );
                    })}
                  </div>
                  <nav aria-label="规则匹配同步分页" className="flex flex-wrap items-center justify-center gap-3 text-sm">
                    <Button type="button" variant="outline" size="sm" disabled={loading || result.offset === 0}
                      onClick={() => void runSimulation({ input: submitted.input, offset: Math.max(0, result.offset - SIMULATION_PAGE_SIZE) })}>上一页</Button>
                    <span className="text-muted-foreground">第 {Math.floor(result.offset / SIMULATION_PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(maxTotal / SIMULATION_PAGE_SIZE))} 页</span>
                    <Button type="button" variant="outline" size="sm" disabled={loading || result.offset + SIMULATION_PAGE_SIZE >= maxTotal}
                      onClick={() => void runSimulation({ input: submitted.input, offset: result.offset + SIMULATION_PAGE_SIZE })}>下一页</Button>
                  </nav>
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
