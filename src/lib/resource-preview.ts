// 资料在线预览的轻量判定（不进懒加载块，列表页也要用）。
// 站点静态资料：source_url 指向本站 /resources/ 下的文件（含线上地址，本地开发时按同源路径取）。
const SITE_HOSTS = new Set(["eduai-o1pbxkl2opq.qoder.zone"]);

export type PreviewKind = "markdown" | "text" | "pdf" | "image" | "unsupported";

export function siteFilePath(sourceUrl: string): string | null {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    const knownHost = url.host === window.location.host || SITE_HOSTS.has(url.host);
    if (!knownHost || !url.pathname.startsWith("/resources/")) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

export function previewKind(fileName: string): PreviewKind {
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  if (ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "txt" || ext === "csv" || ext === "log") return "text";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  return "unsupported";
}