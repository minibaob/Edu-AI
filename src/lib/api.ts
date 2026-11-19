export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const { method = "GET", body } = options;
  let response: Response;
  try {
    response = await fetch(`/functions/v1/app${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network", 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(typeof data?.error === "string" ? data.error : "unknown", response.status);
  }
  return data as T;
}

const ERROR_MESSAGES: Record<string, string> = {
  network: "无法连接服务器，请检查网络后重试",
  sites_gateway_login_required: "当前环境未携带平台登录态（应用内预览常见）。请在已登录 Qoder 的浏览器中打开站点地址后重试",
  invalid_username: "用户名需为 2–20 个字符，可用中文、字母、数字、下划线或连字符",
  invalid_password: "密码至少 8 个字符",
  invalid_profile: "资料格式不正确，请检查年级、省份和学科选择",
  username_taken: "该用户名已被注册，换一个试试",
  invalid_credentials: "用户名或密码不正确",
  rate_limited: "尝试次数过多，请稍后再试",
  login_required: "请先登录",
  invalid_filter: "筛选条件不正确，请重新选择",
  invalid_resource: "资料信息不正确，请检查标题、分类与来源",
  file_upload_unavailable: "文件服务暂时不可用，请稍后重试，或先登记来源链接型资料",
  invalid_file: "文件不正确，请检查文件名与大小后重试",
  unsupported_file_type: "不支持该文件类型，可上传 PDF、Word、PPT、Excel、文本、图片或 ZIP",
  file_too_large: "文件超过 10MB 上限，请压缩或拆分后再上传",
  file_forbidden: "不能登记他人上传的文件",
  file_validation_failed: "文件校验未通过（大小或类型不符），请重新上传",
  file_not_found: "该资料没有可下载的文件",
  storage_unavailable: "文件服务暂时不可用，请稍后重试",
  upload_failed: "文件上传失败，请检查网络后重试",
  resource_unconfirmed: "资料保存结果未确认，请刷新后查看",
  invalid_assessment: "测评答案不正确，请重新作答",
  not_found: "未找到相关内容",
  origin_forbidden: "请求来源不被允许，请刷新页面后重试",
  service_unavailable: "服务暂时不可用，请稍后重试",
  database_unavailable: "数据服务暂时不可用，请稍后重试",
  application_auth_not_configured: "站点认证尚未配置完成，请联系管理员",
  registration_unconfirmed: "注册结果未确认，请先尝试登录，勿重复注册",
  logout_unconfirmed: "退出未确认，请重试",
  profile_unconfirmed: "资料保存未确认，请刷新后查看",
  password_unconfirmed: "密码修改未确认，请先尝试用新密码登录",
  payload_too_large: "提交内容过大",
  invalid_input: "提交内容不正确",
  invalid_answers: "答题不完整或格式不正确，请检查后再提交",
  assessment_unconfirmed: "提交结果未确认，请先刷新查看是否已保存，勿重复提交",
  admin_required: "此操作需要管理员权限",
  meta_unconfirmed: "展示元数据保存未确认，请重试",
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return ERROR_MESSAGES[error.code] ?? "操作失败，请稍后重试";
  }
  if (error instanceof Error && ERROR_MESSAGES[error.message]) {
    return ERROR_MESSAGES[error.message];
  }
  return "操作失败，请稍后重试";
}

// ===== 模块5：高校与录取数据 =====
export type UniversityIndexItem = { code: string; name: string };
export type Facets = { provinces?: string[]; years?: number[]; categories?: string[]; batches?: string[] };
export type Counts = { universities: number; admission_scores: number; enrollment_plans: number };
export type UniversitiesResponse = {
  universities: UniversityIndexItem[];
  score_facets: Facets;
  plan_facets: Facets;
  counts: Counts;
};
export type University = {
  code: string; name: string; province: string | null; city: string | null;
  type: string | null; level: string | null; tags: string | null;
  website: string | null; source: string; note: string | null;
};
export type ScoreRow = {
  id: string; university_code: string; school_name: string | null; province: string;
  year: number; category: string; batch: string; subject_requirement: string | null;
  min_score: string | null; min_rank: number | null; admitted_count: number | null;
  source: string; note: string | null;
};
export type PlanRow = {
  id: string; university_code: string; school_name: string; province: string;
  year: number; major_code: string | null; major_name: string; batch: string | null;
  subject_requirement: string | null; plan_count: number | null; tuition: number | null;
  source: string; note: string | null;
};
export type UniversityDetail = {
  university: University; scores: ScoreRow[]; plans: PlanRow[];
  plan_year: number | null; plan_years: number[];
};

export const getUniversities = () => api<UniversitiesResponse>("/api/universities");
export const getUniversityDetail = (code: string, year?: number) =>
  api<UniversityDetail>(`/api/universities/${code}${year ? `?year=${year}` : ""}`);
export const postImportChunk = (body: {
  table: string; run_id: string; chunk_index: number; rows: unknown[];
}) => api<{ ok: boolean; received: number; inserted: number }>("/api/admin/import", { method: "POST", body });
export const postMeta = (key: string, value: unknown) =>
  api<{ ok: boolean }>("/api/admin/meta", { method: "POST", body: { key, value } });