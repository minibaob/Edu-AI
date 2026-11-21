import { api } from "@/src/lib/api";

export type CompareScore = {
  min_score: number | null;
  year: number;
  source: string | null;
  rows: number;
  invalid_rows: number;
};

export type ComparePlans = {
  total_count: number | null;
  year: number;
  majors: number;
  rows: number;
  sources: string[];
};

export type CompareItem = {
  code: string;
  name: string | null;
  found: boolean;
  province: string | null;
  city: string | null;
  type: string | null;
  level: string | null;
  tags: string | null;
  website: string | null;
  source: string | null;
  score: CompareScore | null;
  plans: ComparePlans | null;
};

export type CompareInput = {
  codes: string[];
  province: string;
  category: string;
  batch: string;
};

export type CompareResponse = CompareInput & { items: CompareItem[] };

export const COMPARE_MAX_SCHOOLS = 3;

// 查询参数仅用于本次 GET 请求，不同步到浏览器路由或持久化存储。
export function getCompare(input: CompareInput): Promise<CompareResponse> {
  const params = new URLSearchParams({
    codes: input.codes.join(","),
    province: input.province,
    category: input.category,
    batch: input.batch,
  });
  return api<CompareResponse>(`/api/universities/compare?${params}`);
}
