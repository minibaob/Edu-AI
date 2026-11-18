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
  invalid_username: "用户名需为 2–20 个字符，可用中文、字母、数字、下划线或连字符",
  invalid_password: "密码至少 8 个字符",
  invalid_profile: "资料格式不正确，请检查年级、省份和学科选择",
  username_taken: "该用户名已被注册，换一个试试",
  invalid_credentials: "用户名或密码不正确",
  rate_limited: "尝试次数过多，请稍后再试",
  login_required: "请先登录",
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
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return ERROR_MESSAGES[error.code] ?? "操作失败，请稍后重试";
  }
  return "操作失败，请稍后重试";
}