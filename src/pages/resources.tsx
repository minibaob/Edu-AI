// 模块4 学习资料库：浏览（搜索 + 年级/学科/类型筛选 + 分页）、详情、收藏、
// 登记来源链接型资料与文件直传（平台 Storage 签名上传，服务端回读校验后才登记）。
// 没有资料时展示空状态，不填充虚构资料。版权承诺为必填项。
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  BookOpen,
  Download,
  ExternalLink,
  Heart,
  LogIn,
  Search,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, navigate, useRoute } from "@/src/lib/router";
import { useAuth } from "@/src/lib/auth";
import { errorMessage } from "@/src/lib/api";
import { GRADES, SUBJECTS } from "@/src/lib/options";
import {
  createResource,
  favoriteResource,
  getFileDownloadUrl,
  getResource,
  listFavorites,
  listResources,
  putFileToSignedUrl,
  requestUploadUrl,
  unfavoriteResource,
} from "@/src/lib/resources";
import type { Resource } from "@/src/lib/resources";
import { cn } from "@/lib/utils";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const PAGE_SIZE = 20;
const RESOURCE_TYPES = ["教材", "知识点", "笔记", "试卷", "模拟卷", "真题", "其他"];
const FILE_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTS = new Set(["pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "md", "csv", "png", "jpg", "jpeg", "webp", "zip"]);
// 文档与图片分开两个可见选择器：微信等内置浏览器对混合 accept 的支持不一致。
const DOC_ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv,.zip";
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function filePrecheck(file: File): string | null {
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!ALLOWED_EXTS.has(ext)) return "不支持该文件类型，可上传 PDF、Word、PPT、Excel、文本、图片或 ZIP";
  if (file.size === 0) return "文件为空，请重新选择";
  if (file.size > FILE_MAX_BYTES) return "文件超过 10MB 上限，请压缩或拆分后再上传";
  return null;
}

function hashId(): string | null {
  const query = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(query).get("id");
}

export default function ResourcesPage() {
  const route = useRoute();
  const { user } = useAuth();
  const selectedId = hashId();
  const [tab, setTab] = useState<"all" | "favorites" | "mine">("all");

  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [type, setType] = useState("");
  const [offset, setOffset] = useState(0);
  const [listVersion, setListVersion] = useState(0);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [detail, setDetail] = useState<Resource | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [favBusy, setFavBusy] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [uploadMode, setUploadMode] = useState<"link" | "file">("link");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    grade: "",
    subject: "",
    type: "笔记",
    source_url: "",
    source_name: "",
    description: "",
    copyright_confirmed: false,
  });

  const loadList = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (tab === "favorites") {
        const data = await listFavorites();
        setTotal(data.total);
        setItems(data.items);
      } else {
        const data = await listResources({
          q: appliedQ || undefined,
          grade: grade || undefined,
          subject: subject || undefined,
          type: type || undefined,
          mine: tab === "mine",
          limit: PAGE_SIZE,
          offset,
        });
        setTotal(data.total);
        setItems(data.items);
      }
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, appliedQ, grade, subject, type, offset, listVersion]);

  useEffect(() => {
    if (!selectedId) void loadList();
  }, [selectedId, loadList]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    (async () => {
      try {
        const data = await getResource(selectedId);
        if (!cancelled) setDetail(data.resource);
      } catch (err) {
        if (!cancelled) setDetailError(errorMessage(err));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, route]);

  async function toggleFavorite(resource: Resource) {
    if (!user) return;
    setFavBusy(true);
    try {
      if (resource.favorited) {
        await unfavoriteResource(resource.id);
      } else {
        await favoriteResource(resource.id);
      }
      const next = { ...resource, favorited: !resource.favorited };
      setDetail((prev) => (prev && prev.id === resource.id ? next : prev));
      setItems((prev) => prev.map((item) => (item.id === resource.id ? next : item)));
    } catch {
      // 收藏失败时保持原状态，用户可重试。
    } finally {
      setFavBusy(false);
    }
  }

  function pickFile(list: FileList | null) {
    const picked = list?.[0] ?? null;
    setFile(picked);
    setFileError(picked ? filePrecheck(picked) : null);
  }

  async function downloadFile(resource: Resource) {
    setDownloadBusy(true);
    try {
      const { downloadUrl, file_name } = await getFileDownloadUrl(resource.id);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = file_name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (err) {
      setDetailError(errorMessage(err));
    } finally {
      setDownloadBusy(false);
    }
  }

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    setUploadMsg(null);
    if (uploadMode === "file") {
      if (!file) { setUploadMsg({ ok: false, text: "请先选择要上传的文件" }); return; }
      if (fileError) { setUploadMsg({ ok: false, text: fileError }); return; }
    }
    setUploadBusy(true);
    try {
      const base = {
        title: form.title.trim(),
        grade: form.grade || undefined,
        subject: form.subject || undefined,
        type: form.type,
        source_name: form.source_name.trim(),
        description: form.description.trim() || undefined,
        copyright_confirmed: form.copyright_confirmed,
      };
      if (uploadMode === "file" && file) {
        // 签发 → 浏览器 PUT 到签名 URL → 服务端回读校验通过后才登记。
        const intent = await requestUploadUrl({ file_name: file.name, file_size: file.size });
        await putFileToSignedUrl(intent.uploadUrl, file, intent.contentType);
        await createResource({
          ...base,
          storage_key: intent.storageKey,
          file_name: file.name,
          file_size: file.size,
        });
        setUploadMsg({ ok: true, text: "文件已上传并登记" });
        setFile(null);
        setFileError(null);
      } else {
        await createResource({ ...base, source_url: form.source_url.trim() });
        setUploadMsg({ ok: true, text: "资料已登记" });
      }
      setForm({
        title: "", grade: "", subject: "", type: "笔记",
        source_url: "", source_name: "", description: "", copyright_confirmed: false,
      });
      setTab("mine");
      setOffset(0);
      setListVersion((v) => v + 1);
    } catch (err) {
      setUploadMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setUploadBusy(false);
    }
  }

  // ---- 详情页 ----
  if (selectedId) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="outline" className="w-fit" onClick={() => navigate("/resources")}>
          <ArrowLeft className="size-4" aria-hidden /> 返回资料库
        </Button>
        {detailLoading && <Skeleton className="h-64 w-full" />}
        {detailError && (
          <Alert variant="destructive"><AlertDescription>{detailError}</AlertDescription></Alert>
        )}
        {detail && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">{detail.title}</CardTitle>
              <CardDescription>
                {detail.grade ?? "年级未标"} · {detail.subject ?? "学科未标"} · {detail.type}
                {" · "}
                {new Date(detail.created_at).toLocaleDateString("zh-CN")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <div className="flex flex-wrap gap-2">
                {detail.grade && <Badge variant="secondary">{detail.grade}</Badge>}
                {detail.subject && <Badge variant="secondary">{detail.subject}</Badge>}
                <Badge variant="outline">{detail.type}</Badge>
              </div>
              {detail.description && <p className="leading-relaxed">{detail.description}</p>}
              <p className="text-muted-foreground">
                来源：{detail.source_name}
                {detail.source_url && (
                  <>
                    {" · "}
                    <a
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      href={detail.source_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开来源 <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </>
                )}
              </p>
              {detail.has_file && detail.file_name && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 p-3">
                  <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {detail.file_name}
                    {detail.file_size != null && (
                      <span className="ml-2 text-xs text-muted-foreground">{formatBytes(detail.file_size)}</span>
                    )}
                  </span>
                  {user ? (
                    <Button size="sm" disabled={downloadBusy} onClick={() => void downloadFile(detail)}>
                      {downloadBusy ? "获取中…" : "下载附件"}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">登录后可下载</span>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  variant={detail.favorited ? "default" : "outline"}
                  disabled={!user || favBusy}
                  onClick={() => void toggleFavorite(detail)}
                >
                  <Heart className={cn("size-4", detail.favorited && "fill-current")} aria-hidden />
                  {detail.favorited ? "已收藏" : "收藏"}
                </Button>
                {!user && <span className="self-center text-xs text-muted-foreground">登录后可收藏</span>}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ---- 列表页 ----
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="edu-gradient flex size-11 items-center justify-center rounded-xl text-white">
            <BookOpen className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold">学习资料库</h1>
            <p className="text-sm text-muted-foreground">按年级、学科查找和分享学习资料，来源均有标注。</p>
          </div>
        </div>
        {user && (
          <Button onClick={() => setShowUpload((v) => !v)}>
            <Upload className="size-4" aria-hidden /> 上传资料
          </Button>
        )}
      </div>

      {showUpload && user && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">上传资料</CardTitle>
            <CardDescription>
              可登记来源链接型资料（官方页面、公开讲义等），或直接上传文件
              （PDF、Word、PPT、Excel、文本、图片、ZIP，单个不超过 10MB）。仅可分享你有权公开的内容。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpload} className="flex flex-col gap-4">
              <div className="flex gap-2" role="group" aria-label="登记方式">
                <Button type="button" size="sm" variant={uploadMode === "link" ? "default" : "outline"} onClick={() => setUploadMode("link")}>链接登记</Button>
                <Button type="button" size="sm" variant={uploadMode === "file" ? "default" : "outline"} onClick={() => setUploadMode("file")}>文件上传</Button>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="res-title">标题 *</Label>
                <Input
                  id="res-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  maxLength={100}
                  placeholder="例如：高中数学函数专题讲义"
                  required
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="res-grade">年级</Label>
                  <select id="res-grade" className={selectClass} value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })}>
                    <option value="">未标</option>
                    {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="res-subject">学科</Label>
                  <select id="res-subject" className={selectClass} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
                    <option value="">未标</option>
                    {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="res-type">资料类型 *</Label>
                  <select id="res-type" className={selectClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                    {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {uploadMode === "link" ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="res-url">来源链接 *</Label>
                  <Input
                    id="res-url"
                    value={form.source_url}
                    onChange={(e) => setForm({ ...form, source_url: e.target.value })}
                    placeholder="https:// 开头的官方或公开页面地址"
                    required
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label>选择文件 *（文档或图片，单个不超过 10MB）</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm hover:border-primary/50">
                      <Upload className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="shrink-0">选文档</span>
                      <input
                        type="file"
                        accept={DOC_ACCEPT}
                        className="w-full min-w-0 text-xs text-muted-foreground"
                        onChange={(e) => pickFile(e.target.files)}
                      />
                    </label>
                    <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm hover:border-primary/50">
                      <Upload className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="shrink-0">选图片</span>
                      <input
                        type="file"
                        accept={IMAGE_ACCEPT}
                        className="w-full min-w-0 text-xs text-muted-foreground"
                        onChange={(e) => pickFile(e.target.files)}
                      />
                    </label>
                  </div>
                  {file && !fileError && (
                    <p className="text-sm text-muted-foreground">已选择：{file.name}（{formatBytes(file.size)}）</p>
                  )}
                  {fileError && (
                    <Alert variant="destructive"><AlertDescription>{fileError}</AlertDescription></Alert>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="res-source">{uploadMode === "link" ? "来源名称 *" : "来源说明 *（如：本人整理 / 某官网公开资料）"}</Label>
                <Input
                  id="res-source"
                  value={form.source_name}
                  onChange={(e) => setForm({ ...form, source_name: e.target.value })}
                  maxLength={50}
                  placeholder={uploadMode === "link" ? "例如：人民教育出版社官网" : "例如：本人整理的课堂笔记"}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="res-desc">简介</Label>
                <Textarea
                  id="res-desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  maxLength={500}
                  placeholder="一句话说明这份资料讲什么、适合谁用"
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.copyright_confirmed}
                  onChange={(e) => setForm({ ...form, copyright_confirmed: e.target.checked })}
                />
                <span>我确认这份资料来源合法，不上传、不公开版权不明的资料 *</span>
              </label>
              {uploadMsg && (
                <Alert variant={uploadMsg.ok ? "default" : "destructive"}>
                  <AlertDescription>{uploadMsg.text}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={uploadBusy} className="w-fit">
                {uploadBusy ? (uploadMode === "file" ? "上传中…" : "登记中…") : "提交登记"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2">
        <Button variant={tab === "all" ? "default" : "outline"} onClick={() => { setTab("all"); setOffset(0); }}>全部资料</Button>
        <Button variant={tab === "favorites" ? "default" : "outline"} onClick={() => { setTab("favorites"); setOffset(0); }}>我的收藏</Button>
        <Button variant={tab === "mine" ? "default" : "outline"} onClick={() => { setTab("mine"); setOffset(0); }}>我上传的</Button>
      </div>

      {tab !== "all" && !user ? (
        <Card className="mx-auto w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-lg">请先登录</CardTitle>
            <CardDescription>登录后可查看自己的收藏和登记的资料。</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="edu-gradient text-white">
              <Link to="/login"><LogIn className="size-4" aria-hidden />去登录 / 注册</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {tab === "all" && (
            <Card>
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input
                      className="pl-9"
                      placeholder="搜索标题、简介或来源"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { setAppliedQ(q.trim()); setOffset(0); } }}
                    />
                  </div>
                  <Button onClick={() => { setAppliedQ(q.trim()); setOffset(0); }}>搜索</Button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <select className={selectClass} value={grade} onChange={(e) => { setGrade(e.target.value); setOffset(0); }} aria-label="年级">
                    <option value="">全部年级</option>
                    {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <select className={selectClass} value={subject} onChange={(e) => { setSubject(e.target.value); setOffset(0); }} aria-label="学科">
                    <option value="">全部学科</option>
                    {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select className={selectClass} value={type} onChange={(e) => { setType(e.target.value); setOffset(0); }} aria-label="资料类型">
                    <option value="">全部类型</option>
                    {RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </CardContent>
            </Card>
          )}

          {loadError && (
            <Alert variant="destructive">
              <AlertDescription>
                {loadError}
                <Button variant="outline" size="sm" className="ml-3" onClick={() => void loadList()}>重试</Button>
              </AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : items.length === 0 ? (
            <Card>
              <CardContent className="p-6">
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {tab === "favorites"
                    ? "还没有收藏的资料，去全部资料里找找喜欢的"
                    : tab === "mine"
                      ? "你还没有登记过资料"
                      : "暂无资料"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">共 {total} 份资料</p>
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((item) => (
                  <Card key={item.id} className="hover:border-primary/40">
                    <CardContent className="flex flex-col gap-2 p-5">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          className="text-left font-semibold leading-snug hover:text-primary"
                          onClick={() => navigate(`/resources?id=${encodeURIComponent(item.id)}`)}
                        >
                          {item.title}
                        </button>
                        <button
                          type="button"
                          aria-label={item.favorited ? "取消收藏" : "收藏"}
                          aria-pressed={item.favorited}
                          disabled={!user || favBusy}
                          onClick={() => void toggleFavorite(item)}
                          className={cn(
                            "shrink-0 rounded-full p-1.5 hover:bg-accent",
                            item.favorited ? "text-red-500" : "text-muted-foreground"
                          )}
                        >
                          <Heart className={cn("size-5", item.favorited && "fill-current")} aria-hidden />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {item.grade && <Badge variant="secondary">{item.grade}</Badge>}
                        {item.subject && <Badge variant="secondary">{item.subject}</Badge>}
                        <Badge variant="outline">{item.type}</Badge>
                      </div>
                      {item.description && (
                        <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
                      )}
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="max-w-56 truncate text-xs text-muted-foreground" title={item.source_name}>
                          来源：{item.source_name}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {item.has_file && (
                            <Badge variant="secondary" className="gap-1">
                              <Download className="size-3" aria-hidden />附件
                            </Badge>
                          )}
                          {item.source_url && (
                            <a
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              href={item.source_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              打开来源 <ExternalLink className="size-3" aria-hidden />
                            </a>
                          )}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {tab !== "favorites" && (
                <div className="flex items-center justify-between">
                  <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</Button>
                  <span className="text-sm text-muted-foreground">第 {Math.floor(offset / PAGE_SIZE) + 1} 页</span>
                  <Button variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>下一页</Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
