// 模块5 高校与录取数据：前端 API 客户端 + 演示数据。
// 演示数据仅用于真实数据为空时展示界面格式，取自仓库 db/import/模板填写说明.md
// 中的格式示例（99999 示例大学），全站统一用 DemoBadge 标注，绝不伪装成官方数据。
import { api } from "@/src/lib/api";

export type University = {
  code: string;
  name: string;
  province: string;
  city: string | null;
  type: string;
  level: string;
  tags: string[];
  admission_url: string | null;
  source: string;
  note: string | null;
};

export type AdmissionScore = {
  id: string;
  province: string;
  year: number;
  category: string;
  batch: string;
  subject_requirement: string | null;
  min_score: number | null;
  min_rank: number | null;
  admitted_count: number | null;
  source: string;
  note: string | null;
};

export type EnrollmentPlan = {
  id: string;
  province: string;
  year: number;
  major_code: string | null;
  major_name: string;
  batch: string | null;
  subject_requirement: string | null;
  plan_count: number | null;
  tuition: number | null;
  source: string;
  note: string | null;
};

export type UniversityDetail = {
  university: University;
  scores: AdmissionScore[];
  plans: EnrollmentPlan[];
};

export async function getUniversity(code: string): Promise<UniversityDetail> {
  return api<UniversityDetail>(`/api/universities/${encodeURIComponent(code)}`);
}

export async function listMajors(filters: { q?: string; category?: string; limit?: number; offset?: number } = {}): Promise<{
  total: number;
  items: { code: string; name: string; category: string; years: number; degree: string | null; source: string; note: string | null }[];
}> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  const query = params.toString();
  return api(`/api/majors${query ? `?${query}` : ""}`);
}

// 演示数据：与模板填写说明中的格式示例完全一致，仅用于演示界面格式。
export const DEMO_UNIVERSITY: University = {
  code: "99999",
  name: "示例大学（格式演示）",
  province: "河北",
  city: "示例市",
  type: "综合",
  level: "本科",
  tags: ["公办"],
  admission_url: "https://example.edu.cn",
  source: "××省教育考试院《××年录取统计》第12页（2026-11-18 整理）",
  note: "仅演示格式，非真实数据",
};

export const DEMO_UNIVERSITY_DETAIL: UniversityDetail = {
  university: DEMO_UNIVERSITY,
  scores: [
    {
      id: "demo-score-1",
      province: "河北",
      year: 2025,
      category: "物理类",
      batch: "本科批",
      subject_requirement: "物理+化学",
      min_score: 600,
      min_rank: 12345,
      admitted_count: 30,
      source: "××省教育考试院《××年录取统计》第12页（2026-11-18 整理）",
      note: "仅演示格式，非真实数据",
    },
  ],
  plans: [],
};
