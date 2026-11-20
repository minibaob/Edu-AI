// 首页个性化推荐：GET /api/recommendations（公开读）。
// 内容全部来自资料库与录取数据的真实行，按登录用户的年级/选科/省份规则匹配；
// items 为空表示暂无可推荐的真实内容，前端如实显示空态。
import { api } from "@/src/lib/api";

export type Recommendation = {
  kind: "resource" | "university";
  id: string;
  title: string;
  badges: string[];
  reason: string;
  link: string;
};

export type Recommendations = { personalized: boolean; items: Recommendation[] };

export const fetchRecommendations = () => api<Recommendations>("/api/recommendations");