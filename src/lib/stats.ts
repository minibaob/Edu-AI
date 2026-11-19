// 首页统计：GET /api/stats（公开读）。
// 数字为 null 表示该项暂无数据（表尚未迁移或查询失败）；个人计数在未登录时
// 也为 null，前端据此显示「登录后查看」。
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

export async function fetchStats(): Promise<HomeStats> {
  const data = await api<{ stats: HomeStats }>("/api/stats");
  return data.stats;
}
