// 模块5 导入行校验：管理员导入路由对每一行做服务端复核（不信任浏览器）。
// 规则与 db/import/validate.mjs 的离线校验一致；缺失字段返回 null，网站显示「暂无数据」。
import { AppError } from './http.mjs';

const PILOT_PROVINCES = ['河北', '河南'];
const SCORE_CATEGORIES = ['物理类', '历史类', '理科', '文科', '综合', '艺术类', '体育类'];
const CURRENT_YEAR = new Date().getFullYear();

const bad = () => { throw new AppError('invalid_input', 400); };

function textOrNull(value, max, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) bad();
    return null;
  }
  if (typeof value !== 'string') bad();
  const trimmed = value.trim();
  if (trimmed === '') { if (required) bad(); return null; }
  if (trimmed.length > max) bad();
  return trimmed;
}

function intOrNull(value, min, max, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) bad();
    return null;
  }
  const n = typeof value === 'number' ? value : (/^\d+$/.test(String(value)) ? Number(value) : NaN);
  if (!Number.isInteger(n) || n < min || n > max) bad();
  return n;
}

// 最低分保留官方原值（艺术/体育类综合分带小数），最多两位小数。
function scoreOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) bad();
  const n = Number(s);
  if (n < 0 || n > 750) bad();
  return s;
}

function enumOrNull(value, allowed, required = false) {
  const t = textOrNull(value, 40, required);
  if (t !== null && !allowed.includes(t)) bad();
  return t;
}

export function validateUniversityRow(raw) {
  if (!raw || typeof raw !== 'object') bad();
  const website = textOrNull(raw.website, 300);
  if (website !== null && !/^https:\/\/\S+$/.test(website)) bad();
  return {
    code: textOrNull(raw.code, 32, true),
    name: textOrNull(raw.name, 120, true),
    province: textOrNull(raw.province, 20),
    city: textOrNull(raw.city, 40),
    type: textOrNull(raw.type, 20),
    level: textOrNull(raw.level, 20),
    tags: textOrNull(raw.tags, 120),
    website,
    source: textOrNull(raw.source, 500, true),
    note: textOrNull(raw.note, 2000),
  };
}

export function validateScoreRow(raw) {
  if (!raw || typeof raw !== 'object') bad();
  return {
    university_code: textOrNull(raw.university_code, 32, true),
    school_name: textOrNull(raw.school_name, 120),
    province: enumOrNull(raw.province, PILOT_PROVINCES, true),
    year: intOrNull(raw.year, 2000, CURRENT_YEAR, true),
    category: enumOrNull(raw.category, SCORE_CATEGORIES, true),
    batch: textOrNull(raw.batch, 60, true),
    subject_requirement: textOrNull(raw.subject_requirement, 100),
    min_score: scoreOrNull(raw.min_score),
    min_rank: intOrNull(raw.min_rank, 1, 10000000),
    admitted_count: intOrNull(raw.admitted_count, 0, 100000),
    source: textOrNull(raw.source, 500, true),
    note: textOrNull(raw.note, 2000),
  };
}

export function validatePlanRow(raw) {
  if (!raw || typeof raw !== 'object') bad();
  return {
    university_code: textOrNull(raw.university_code, 32, true),
    school_name: textOrNull(raw.school_name, 120, true),
    province: enumOrNull(raw.province, PILOT_PROVINCES, true),
    year: intOrNull(raw.year, 2000, CURRENT_YEAR, true),
    major_code: textOrNull(raw.major_code, 16),
    major_name: textOrNull(raw.major_name, 200, true),
    batch: textOrNull(raw.batch, 60),
    subject_requirement: textOrNull(raw.subject_requirement, 100),
    plan_count: intOrNull(raw.plan_count, 0, 100000),
    tuition: intOrNull(raw.tuition, 0, 1000000),
    source: textOrNull(raw.source, 500, true),
    note: textOrNull(raw.note, 2000),
  };
}

export const IMPORT_VALIDATORS = {
  universities: validateUniversityRow,
  admission_scores: validateScoreRow,
  enrollment_plans: validatePlanRow,
};