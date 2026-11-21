// 资料在线预览：打开详情直接展示内容，不强制下载。
// 站点静态文件与 Storage 附件统一取字节后预览：md 渲染排版与 LaTeX 公式（KaTeX），
// pdf 用浏览器内嵌阅读器（blob 地址，避免签名 URL 的 attachment 头触发下载），图片直接显示。
// 外部平台链接无法内嵌，保留明确的「打开来源」入口。markdown 经 DOMPurify 消毒后才注入。
import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Download, ExternalLink, Eye, FileText, LogIn, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/src/lib/router";
import { errorMessage } from "@/src/lib/api";
import { getFileDownloadUrl } from "@/src/lib/resources";
import type { Resource } from "@/src/lib/resources";
import { previewKind, siteFilePath } from "@/src/lib/resource-preview";
import type { PreviewKind } from "@/src/lib/resource-preview";

function renderMarkdown(source: string): string {
  // 先把公式摘出来，避免 markdown 把 v_0 之类渲染成斜体；占位符用私用区字符，消毒后再回填。
  const blocks: string[] = [];
  const stash = (tex: string, displayMode: boolean) => {
    blocks.push(katex.renderToString(tex, { displayMode, throwOnError: false, strict: false, trust: false }));
    return `\uE000${blocks.length - 1}\uE001`;
  };
  const prepared = source
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex: string) => stash(tex, true))
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => stash(tex, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex: string) => stash(tex, false));
  const raw = marked.parse(prepared, { async: false, gfm: true }) as string;
  const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  return clean.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => blocks[Number(i)] ?? "");
}

type Target =
  | { mode: "static"; path: string; kind: PreviewKind }
  | { mode: "storage"; kind: PreviewKind }
  | { mode: "external" }
  | { mode: "login" };

type ReadyState = {
  status: "ready";
  kind: PreviewKind;
  fileName: string;
  text?: string;
  objectUrl?: string;
};
type State = { status: "loading" } | { status: "error"; message: string } | ReadyState;

export default function ResourceViewer({ resource, loggedIn }: { resource: Resource; loggedIn: boolean }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);

  const target = useMemo<Target>(() => {
    if (resource.has_file) {
      if (!loggedIn) return { mode: "login" };
      return { mode: "storage", kind: previewKind(resource.file_name ?? "") };
    }
    const path = siteFilePath(resource.source_url);
    if (path) return { mode: "static", path, kind: previewKind(path) };
    return { mode: "external" };
  }, [resource, loggedIn]);

  useEffect(() => {
    if ((target.mode !== "static" && target.mode !== "storage") || target.kind === "unsupported") return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: "loading" });
    (async () => {
      let url: string;
      let fileName: string;
      if (target.mode === "storage") {
        const signed = await getFileDownloadUrl(resource.id);
        url = signed.downloadUrl;
        fileName = signed.file_name;
      } else {
        url = target.path;
        fileName = decodeURIComponent(target.path.slice(target.path.lastIndexOf("/") + 1));
      }
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) throw new Error("load_failed");
      if (target.kind === "markdown" || target.kind === "text") {
        const text = await response.text();
        if (!cancelled) setState({ status: "ready", kind: target.kind, fileName, text });
        return;
      }
      const bytes = await response.arrayBuffer();
      if (cancelled) return;
      // 强制按预览类型给 MIME，签名 URL 可能回 attachment/octet-stream，直接内嵌会触发下载。
      const mime = target.kind === "pdf" ? "application/pdf" : response.headers.get("content-type") ?? "application/octet-stream";
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      setState({ status: "ready", kind: target.kind, fileName, objectUrl });
    })().catch((err) => {
      if (!cancelled) setState({ status: "error", message: errorMessage(err) });
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [target, resource.id, retry]);

  const markdownHtml = useMemo(
    () => (state.status === "ready" && state.kind === "markdown" && state.text != null ? renderMarkdown(state.text) : null),
    [state]
  );

  if (target.mode === "external") {
    return (
      <Card className="edu-gradient-soft border-primary/20">
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <ExternalLink className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">这份资料存放在外部平台，无法在本站直接展示，请前往来源页面查看。</span>
          <Button asChild size="sm" variant="outline">
            <a href={resource.source_url} target="_blank" rel="noreferrer">
              打开来源 <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (target.mode === "login") {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">登录后可在线预览这份附件，无需下载。</span>
          <Button asChild size="sm" variant="outline">
            <Link to="/login"><LogIn className="size-3.5" aria-hidden /> 去登录</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (target.kind === "unsupported") return null;

  if (state.status === "loading") return <Skeleton className="h-64 w-full" />;

  if (state.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>内容加载失败：{state.message}</span>
          <Button variant="outline" size="sm" onClick={() => setRetry((v) => v + 1)}>
            <RotateCw className="size-3.5" aria-hidden /> 重试
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const downloadName = state.fileName || resource.title;
  return (
    <section className="overflow-hidden rounded-xl border bg-card" aria-label="资料内容预览">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2.5">
        <Eye className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="text-sm font-medium">内容预览</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={downloadName}>{downloadName}</span>
        {state.kind === "pdf" && state.objectUrl && (
          <Button asChild size="sm" variant="outline">
            <a href={state.objectUrl} target="_blank" rel="noreferrer">
              新窗口打开 <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </Button>
        )}
        {target.mode === "static" && (
          <Button asChild size="sm" variant="outline">
            <a href={target.path} download={downloadName}>
              <Download className="size-3.5" aria-hidden /> 下载文件
            </a>
          </Button>
        )}
      </div>
      {state.kind === "markdown" && markdownHtml != null && (
        <div className="resource-md px-5 py-4 sm:px-7 sm:py-6" dangerouslySetInnerHTML={{ __html: markdownHtml }} />
      )}
      {state.kind === "text" && state.text != null && (
        <pre className="scrollbar-thin max-h-[70vh] overflow-auto whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed">{state.text}</pre>
      )}
      {state.kind === "pdf" && state.objectUrl && (
        <div>
          <iframe
            src={state.objectUrl}
            title={`${resource.title}（PDF 预览）`}
            className="h-[75vh] min-h-[420px] w-full border-0 bg-muted"
          />
          <p className="px-4 py-2 text-xs text-muted-foreground">
            若上方未显示内容（部分手机浏览器不支持内嵌 PDF），请点「新窗口打开」或下载查看。
          </p>
        </div>
      )}
      {state.kind === "image" && state.objectUrl && (
        <div className="flex justify-center bg-muted/40 p-4">
          <img src={state.objectUrl} alt={resource.title} className="max-h-[75vh] max-w-full rounded-lg object-contain" />
        </div>
      )}
    </section>
  );
}