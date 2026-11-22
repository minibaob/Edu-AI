// 院校对比：公开只读。按用户选定的省份 + 科类 + 批次，
// 每所学校取该组合下最新一年有数据的录取最低分（标明年份与来源），
// 招生计划取同省同批次最新一年的各专业计划数之和（标明年份）。
// 分数与计划的年份各自独立取最新，各标各的年份，不跨年拼数字。
// 不建新表、不写库、不编造数据；缺失一律返回 null，前端显示「暂无数据」。
import { AppError, json, rows } from './http.mjs';
import { PILOT_PROVINCES } from './validate.mjs';

const CATEGORIES = ['物理类', '历史类'];
const UNIVERSITY_COLUMNS = 'code,name,province,city,type,level,tags,website,source,note';
const SCORE_COLUMNS = 'id,university_code,school_name,province,year,category,batch,subject_requirement,min_score,min_rank,admitted_count,source,note';
const PLAN_COLUMNS = 'id,university_code,school_name,province,year,major_code,major_name,batch,subject_requirement,plan_count,tuition,source,note';
// 与 simulation.mjs 同一口径：仅接受纯数字（含小数与符号），艺术/体育综合分带小数可通过。
const SCORE_NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
export const COMPARE_MAX_SCHOOLS = 3;

function parameter(params, key, maxLength = 120) {
  if (params.getAll(key).length > 1) throw new AppError('invalid_input', 400);
  const value = params.get(key);
  if (value !== null && value.length > maxLength) throw new AppError('invalid_input', 400);
  return value;
}

function parseCodes(raw) {
  if (raw === null || raw.trim() === '') throw new AppError('invalid_input', 400);
  const codes = raw.split(',').map((code) => code.trim()).filter(Boolean);
  if (codes.length < 2 || codes.length > COMPARE_MAX_SCHOOLS) throw new AppError('invalid_input', 400);
  if (new Set(codes).size !== codes.length) throw new AppError('invalid_input', 400);
  for (const code of codes) {
    if (!/^[0-9A-Za-z]{1,32}$/.test(code)) throw new AppError('invalid_input', 400);
  }
  return codes;
}

async function latestYear(db, table, filters) {
  let query = db.from(table).select('year');
  for (const [name, value] of Object.entries(filters)) query = query.eq(name, value);
  const found = rows(await query.order('year', { ascending: false }).limit(1));
  return found.length === 1 ? found[0].year : null;
}

async function compareOne(db, code, province, category, batch) {
  const notFound = {
    code, name: null, found: false, province: null, city: null, type: null, level: null,
    tags: null, website: null, source: null, data_source: null, score: null, plans: null,
  };
  const found = rows(await db.from('universities').select(UNIVERSITY_COLUMNS).eq('code', code).limit(1));
  if (found.length !== 1) return notFound;
  const u = found[0];
  const base = {
    code: u.code, name: u.name, found: true,
    province: u.province ?? null, city: u.city ?? null, type: u.type ?? null, level: u.level ?? null,
    tags: u.tags ?? null, website: u.website ?? null, source: u.source ?? null,
  };

  // 分数：该组合最新一年；最低分取该年各行有效分数的最小值，无法解析的行跳过并计数。
  let score = null;
  const scoreYear = await latestYear(db, 'admission_scores', {
    university_code: code, province, category, batch,
  });
  if (scoreYear !== null) {
    const scoreRows = rows(await db.from('admission_scores').select(SCORE_COLUMNS)
      .eq('university_code', code).eq('province', province).eq('category', category)
      .eq('batch', batch).eq('year', scoreYear).limit(500));
    let minScore = null;
    let minSource = null;
    let invalid = 0;
    for (const row of scoreRows) {
      const raw = String(row.min_score ?? '').trim();
      if (!SCORE_NUMBER.test(raw)) { invalid += 1; continue; }
      const value = Number(raw);
      if (!Number.isFinite(value)) { invalid += 1; continue; }
      if (minScore === null || value < minScore) { minScore = value; minSource = row.source; }
    }
    score = {
      min_score: minScore, year: scoreYear, source: minSource,
      rows: scoreRows.length, invalid_rows: invalid,
    };
  }

  // 计划：同省同批次最新一年（与分数年份独立，各标各的年份），各专业计划数之和；
  // 计划数为空的行不计入总数与专业行数。
  let plans = null;
  const planYear = await latestYear(db, 'enrollment_plans', {
    school_name: u.name, province, batch,
  });
  if (planYear !== null) {
    const planRows = rows(await db.from('enrollment_plans').select(PLAN_COLUMNS)
      .eq('school_name', u.name).eq('province', province).eq('batch', batch).eq('year', planYear).limit(1000));
    let total = 0;
    let counted = 0;
    const sources = new Set();
    for (const row of planRows) {
      if (typeof row.plan_count === 'number' && Number.isFinite(row.plan_count)) {
        total += row.plan_count;
        counted += 1;
      }
      if (row.source) sources.add(row.source);
    }
    plans = {
      total_count: counted > 0 ? total : null, year: planYear,
      majors: counted, rows: planRows.length, sources: [...sources],
    };
  }

  // 本次对照的数据来源：取所选组合（省份+科类+批次）下最低分行的来源；
  // 分数缺失时退到同省同批次计划行的来源；两者都没有为 null。
  // 注意：universities.source 是建库时该行来自哪个省 CSV 的静态口径
  // （例如只在河南 CSV 里有的学校会写河南 2025 年的来源），与本次对照的
  // 省份/科类/批次无关，不能当作本次对照的来源展示。
  const dataSource = score?.source
    ?? (plans && plans.sources.length > 0 ? plans.sources.join('；') : null)
    ?? null;

  return { ...base, data_source: dataSource, score, plans };
}

export async function compareUniversities(db, request) {
  const params = new URL(request.url).searchParams;
  const codes = parseCodes(params.get('codes'));
  const province = parameter(params, 'province');
  const category = parameter(params, 'category');
  const batch = parameter(params, 'batch', 60);
  if (!PILOT_PROVINCES.includes(province)) throw new AppError('invalid_input', 400);
  if (!CATEGORIES.includes(category)) throw new AppError('invalid_input', 400);
  if (!batch?.trim()) throw new AppError('invalid_input', 400);
  const items = [];
  for (const code of codes) items.push(await compareOne(db, code, province, category, batch.trim()));
  return json({ province, category, batch: batch.trim(), items });
}
