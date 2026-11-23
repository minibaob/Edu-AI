import { api } from "@/src/lib/api";

export const SIMULATION_PAGE_SIZE = 20;

// 意向方向选项：键固定不变，后端按 DISCIPLINE_CATEGORIES（functions/simulation.mjs）
// 把键映射到专业目录学科门类；不选就是不限。
export const DISCIPLINE_OPTIONS = [
  { key: "gongke", label: "工科" },
  { key: "like", label: "理科" },
  { key: "yike", label: "医科" },
  { key: "shangke", label: "商科" },
  { key: "wenke", label: "文科" },
] as const;

export type DisciplineKey = (typeof DISCIPLINE_OPTIONS)[number]["key"];

export function disciplineLabel(key: string): string {
  return DISCIPLINE_OPTIONS.find((option) => option.key === key)?.label ?? key;
}

// 固定展示规则，不根据输入或接口返回改写分档含义。
export const SIMULATION_RULES = {
  delta: "设 d = 该校最新一年 min_score − 我的 score；",
  chong: "冲：0 < d ≤ 10（该校线比我高 10 分以内，够一够）；",
  wen: "稳：−10 ≤ d ≤ 0（该校线和我差不多，或比我低 10 分以内）；",
  bao: "保：d < −10（该校线比我低 10 分以上）。",
} as const;

export type SimulationOptions = {
  province: string;
  available: boolean;
  message: string | null;
  options: { category: string; batches: { batch: string; year: number }[] }[];
  rules: { delta: string; chong: string; wen: string; bao: string };
  provinces: string[];
};

export type SimulationInput = {
  province: string;
  category: string;
  batch: string;
  score: number;
  rank: number | null;
  disciplines: string[];
  provinces: string[];
};

export type SimulationItem = {
  university_code: string;
  name: string;
  min_score: number;
  year: number;
  source: string;
  d: number;
  min_rank?: number;
  rank_difference?: number;
};

export type SimulationGroup = { total: number; items: SimulationItem[] };

export type SimulationResponse = SimulationInput & {
  year: number | null;
  available: boolean;
  message: string | null;
  offset: number;
  limit: typeof SIMULATION_PAGE_SIZE;
  skipped_universities: number;
  invalid_score_rows: number;
  outside_range_count: number;
  groups: { chong: SimulationGroup; wen: SimulationGroup; bao: SimulationGroup };
};

export function getSimulationOptions(province: string): Promise<SimulationOptions> {
  const params = new URLSearchParams({ province });
  return api<SimulationOptions>(`/api/simulation/options?${params}`);
}

// 查询参数仅用于本次 GET 请求，不同步到浏览器路由或持久化存储。
export function getSimulation(input: SimulationInput, offset = 0): Promise<SimulationResponse> {
  const params = new URLSearchParams({
    province: input.province,
    category: input.category,
    batch: input.batch,
    score: String(input.score),
    offset: String(offset),
  });
  if (input.rank !== null) params.set("rank", String(input.rank));
  if (input.disciplines.length > 0) params.set("disciplines", input.disciplines.join(","));
  if (input.provinces.length > 0) params.set("provinces", input.provinces.join(","));
  return api<SimulationResponse>(`/api/simulation?${params}`);
}
