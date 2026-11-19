// 模块4 学习资料库：前端 API 客户端。
// 资料分两种：来源链接型（source_url，可直接打开）与文件型（平台 Storage 签名直传）。
import { api } from "@/src/lib/api";

export type Resource = {
  id: string;
  owner_id: string | null;
  title: string;
  grade: string | null;
  subject: string | null;
  type: string;
  source_url: string;
  source_name: string;
  description: string | null;
  file_name: string | null;
  file_size: number | null;
  mime: string | null;
  has_file: boolean;
  copyright_confirmed: boolean;
  favorited: boolean;
  created_at: string;
};

export type ResourceFilters = {
  q?: string;
  grade?: string;
  subject?: string;
  type?: string;
  mine?: boolean;
  limit?: number;
  offset?: number;
};

export type ResourceInput = {
  title: string;
  grade?: string;
  subject?: string;
  type: string;
  source_url?: string;
  source_name: string;
  description?: string;
  copyright_confirmed: boolean;
  storage_key?: string;
  file_name?: string;
  file_size?: number;
};

export async function listResources(filters: ResourceFilters = {}): Promise<{ total: number; items: Resource[] }> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.grade) params.set("grade", filters.grade);
  if (filters.subject) params.set("subject", filters.subject);
  if (filters.type) params.set("type", filters.type);
  if (filters.mine) params.set("mine", "1");
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  const query = params.toString();
  return api<{ total: number; items: Resource[] }>(`/api/resources${query ? `?${query}` : ""}`);
}

export async function getResource(id: string): Promise<{ resource: Resource }> {
  return api<{ resource: Resource }>(`/api/resources/${encodeURIComponent(id)}`);
}

export async function createResource(input: ResourceInput): Promise<{ resource: Resource }> {
  return api<{ resource: Resource }>("/api/resources", { method: "POST", body: input });
}

export async function favoriteResource(id: string): Promise<{ favorited: boolean }> {
  return api<{ favorited: boolean }>(`/api/resources/${encodeURIComponent(id)}/favorite`, { method: "POST" });
}

export async function unfavoriteResource(id: string): Promise<{ favorited: boolean }> {
  return api<{ favorited: boolean }>(`/api/resources/${encodeURIComponent(id)}/unfavorite`, { method: "POST" });
}

export async function listFavorites(): Promise<{ total: number; items: Resource[] }> {
  return api<{ total: number; items: Resource[] }>("/api/favorites");
}

// ---- 文件直传直下 ----
export type UploadIntent = {
  uploadUrl: string;
  storageKey: string;
  contentType: string;
  maxBytes: number;
};

export async function requestUploadUrl(input: { file_name: string; file_size: number }): Promise<UploadIntent> {
  return api<UploadIntent>("/api/resources/upload-url", { method: "POST", body: input });
}

// 浏览器把文件 PUT 到签名 URL（同源），Content-Type 用服务端签发时给定的值。
export async function putFileToSignedUrl(uploadUrl: string, file: File, contentType: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": contentType },
      body: file,
    });
  } catch {
    throw new Error("network");
  }
  if (!response.ok) throw new Error("upload_failed");
}

export async function getFileDownloadUrl(id: string): Promise<{ downloadUrl: string; file_name: string; file_size: number; mime: string }> {
  return api(`/api/resources/${encodeURIComponent(id)}/file`);
}
