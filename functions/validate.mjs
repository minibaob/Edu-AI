// 输入规范化与有界校验。只做纯函数，不触碰数据库。
import { AppError } from './http.mjs';

export const USERNAME_MIN_CHARS = 2;
export const USERNAME_MAX_CHARS = 20;
export const PASSWORD_MIN_CHARS = 8;
export const PASSWORD_MAX_BYTES = 256;
export const DISPLAY_NAME_MAX_CHARS = 30;

export const GRADES = ['高一', '高二', '高三'];
export const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治'];
export const PROVINCES = [
  '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
  '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
  '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州',
  '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆',
];

// 规范用户名：去首尾空白 + 转小写；允许中文、字母、数字、下划线和连字符。
// 数据库在 username 上另有 UNIQUE 约束，规范形式是唯一性的判定依据。
export function canonicalUsername(raw) {
  if (typeof raw !== 'string') throw new AppError('invalid_username', 400);
  const canonical = raw.trim().toLowerCase();
  if ([...canonical].length < USERNAME_MIN_CHARS || [...canonical].length > USERNAME_MAX_CHARS) {
    throw new AppError('invalid_username', 400);
  }
  if (!/^[a-z0-9\u4e00-\u9fa5][a-z0-9_\-\u4e00-\u9fa5]*$/.test(canonical)) {
    throw new AppError('invalid_username', 400);
  }
  return canonical;
}

// 密码只做有界校验，绝不记录、绝不回显。长度按码点计，上限按 UTF-8 字节计。
export function validatePassword(raw) {
  if (typeof raw !== 'string') throw new AppError('invalid_password', 400);
  if ([...raw].length < PASSWORD_MIN_CHARS) throw new AppError('invalid_password', 400);
  if (new TextEncoder().encode(raw).length > PASSWORD_MAX_BYTES) throw new AppError('invalid_password', 400);
  return raw;
}

// 个人资料全部选填（最小化收集）：空值一律规范为 null。
export function validateProfile(body) {
  const profile = {};

  const displayName = body?.display_name;
  if (displayName === undefined || displayName === null || displayName === '') {
    profile.display_name = null;
  } else if (typeof displayName === 'string' && [...displayName.trim()].length <= DISPLAY_NAME_MAX_CHARS) {
    profile.display_name = displayName.trim() || null;
  } else {
    throw new AppError('invalid_profile', 400);
  }

  const grade = body?.grade;
  if (grade === undefined || grade === null || grade === '') profile.grade = null;
  else if (GRADES.includes(grade)) profile.grade = grade;
  else throw new AppError('invalid_profile', 400);

  const province = body?.province;
  if (province === undefined || province === null || province === '') profile.province = null;
  else if (PROVINCES.includes(province)) profile.province = province;
  else throw new AppError('invalid_profile', 400);

  const subjects = body?.subjects;
  if (subjects === undefined || subjects === null) profile.subjects = null;
  else if (Array.isArray(subjects) && subjects.length <= SUBJECTS.length
    && subjects.every((s) => SUBJECTS.includes(s))
    && new Set(subjects).size === subjects.length) {
    profile.subjects = subjects.length > 0 ? JSON.stringify(subjects) : null;
  } else {
    throw new AppError('invalid_profile', 400);
  }

  return profile;
}

export function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

// 列表查询通用参数：q（关键词 ≤50 字）、分页 limit 1–100（默认 20）、offset ≥0。
export function parseListQuery(search) {
  const params = new URLSearchParams(search ?? '');
  const q = (params.get('q') ?? '').trim();
  if ([...q].length > 50) throw new AppError('invalid_filter', 400);
  const limitRaw = params.get('limit');
  const offsetRaw = params.get('offset');
  const limit = limitRaw === null ? 20 : Number(limitRaw);
  const offset = offsetRaw === null ? 0 : Number(offsetRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError('invalid_filter', 400);
  if (!Number.isInteger(offset) || offset < 0) throw new AppError('invalid_filter', 400);
  return { q, limit, offset };
}

// ---- 模块4：学习资料库 ----
export const RESOURCE_TYPES = ['教材', '知识点', '笔记', '试卷', '模拟卷', '真题', '其他'];
const RESOURCE_TITLE_MIN = 2;
const RESOURCE_TITLE_MAX = 100;
const RESOURCE_DESC_MAX = 500;
const RESOURCE_URL_MAX = 500;

// 来源链接型资料登记：标题/类型/来源链接/来源名称必填，版权承诺必须勾选。
// 文件直传待平台 Storage 适配器接通后开启：body 里出现任何 file_* 字段即拒绝，
// 并返回 file_upload_unavailable，绝不把文件元数据写成“已上传”。
export function validateResourceInput(body) {
  if (body?.file_name !== undefined && body?.file_name !== null
    || body?.file_size !== undefined && body?.file_size !== null
    || body?.mime !== undefined && body?.mime !== null
    || body?.storage_key !== undefined && body?.storage_key !== null) {
    throw new AppError('file_upload_unavailable', 400);
  }
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if ([...title].length < RESOURCE_TITLE_MIN || [...title].length > RESOURCE_TITLE_MAX) {
    throw new AppError('invalid_resource', 400);
  }
  const grade = body?.grade;
  if (grade !== undefined && grade !== null && grade !== '' && !GRADES.includes(grade)) {
    throw new AppError('invalid_resource', 400);
  }
  const subject = body?.subject;
  if (subject !== undefined && subject !== null && subject !== '' && !SUBJECTS.includes(subject)) {
    throw new AppError('invalid_resource', 400);
  }
  if (!RESOURCE_TYPES.includes(body?.type)) throw new AppError('invalid_resource', 400);
  const sourceUrl = typeof body?.source_url === 'string' ? body.source_url.trim() : '';
  if (sourceUrl.length === 0 || sourceUrl.length > RESOURCE_URL_MAX) throw new AppError('invalid_resource', 400);
  let parsed;
  try { parsed = new URL(sourceUrl); } catch { throw new AppError('invalid_resource', 400); }
  if (parsed.protocol !== 'https:') throw new AppError('invalid_resource', 400);
  const sourceName = typeof body?.source_name === 'string' ? body.source_name.trim() : '';
  if ([...sourceName].length < 1 || [...sourceName].length > 50) throw new AppError('invalid_resource', 400);
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  if ([...description].length > RESOURCE_DESC_MAX) throw new AppError('invalid_resource', 400);
  if (body?.copyright_confirmed !== true) throw new AppError('invalid_resource', 400);
  return {
    title,
    grade: grade || null,
    subject: subject || null,
    type: body.type,
    source_url: sourceUrl,
    source_name: sourceName,
    description: description === '' ? null : description,
  };
}