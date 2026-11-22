// 首页统计：GET /api/stats（公开读）。
// 数字为 null 表示该项暂无数据（表尚未迁移或查询失败）；个人计数在未登录时
// 也为 null，前端据此显示「登录后查看」。
// 统计只是展示数字：60 秒内复用上一次成功结果，站内返回首页不再等一次往返；
// 失败不缓存，下次仍会重取；资料库列表页始终实时查询，是计数的权威口径。
import { api } from "@/src/lib/api";

export type HomeStats = {
  resources_total: number | null;
  resources_capped: boolean;
  universities_total: number | null;
  favorites_count: number | null;
  favorites_capped: boolean;
  assessments_count: number | null;
  assessments_capped: boolean;
};

const CACHE_TTL_MS = 60_000;
let cached: { at: number; data: HomeStats } | null = null;

export async function fetchStats(): Promise<HomeStats> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
  const data = await api<{ stats: HomeStats }>("/api/stats");
  cached = { at: Date.now(), data: data.stats };
  return data.stats;
}
