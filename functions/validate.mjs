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