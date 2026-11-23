// 模块5 扩展：意向方向（学科门类）→ 开设该方向的院校名单 的服务端派生缓存。
// 适配器只有 eq / order / limit / range / select，没有 IN，所以整省招生计划只能分页取；
// 串行逐页读在河南（18.3 万行）会超过网关时限（线上表现为 504 + 函数 500），
// 因此先数总行数再多段并行 range 读，并把结果按 (majors 行数, 该省计划行数) 版本缓存进 data_meta。
// 行数变化即自动重建；专业目录（majors）为空时直接返回 catalog_missing，不做整省扫描。
import { AppError, rows } from './http.mjs';
import { PILOT_PROVINCES } from './validate.mjs';

const CACHE_PREFIX = 'discipline_schools:';
const PARALLEL_PAGE = 2000;
const PARALLEL_CONCURRENCY = 8;
const CURSOR_PAGE = 500;
const MAJORS_PAGE = 500;
const CACHE_SCHOOL_LIMIT = 20000;

function cacheKey(province) {
  return `${CACHE_PREFIX}${province}`;
}

async function readMetaRow(db, key) {
  const found = rows(await db.from('data_meta').select('value').eq('key', key).limit(1));
  if (found.length !== 1) return null;
  const raw = found[0].value;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeMetaRow(db, key, value) {
  const now = new Date().toISOString();
  const payload = { key, value: JSON.stringify(value), updated_at: now };
  const created = rows(await db.from('data_meta').insertIfAbsent(payload, { onConflict: 'key' }).select('key'));
  if (created.length === 1) return true;
  const updated = rows(await db.from('data_meta').update({ value: payload.value, updated_at: now })
    .eq('key', key).select('key'));
  return updated.length === 1;
}

async function deleteMetaRow(db, key) {
  await db.from('data_meta').delete().eq('key', key);
}

async function countRows(db, table, filters = {}) {
  let query = db.from(table).select('id', { count: 'exact' }).limit(1);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const result = await query;
  rows(result);
  if (!Number.isSafeInteger(result.count) || result.count < 0) throw new AppError('database_unavailable', 503);
  return result.count;
}

async function readAllMajors(db) {
  const out = [];
  let lastKey;
  for (;;) {
    const page = rows(await db.from('majors').select('code,category').order('code').range(out.length, out.length + MAJORS_PAGE - 1));
    if (page.length === 0) return out;
    const nextKey = page[page.length - 1].code;
    if (nextKey === lastKey) throw new AppError('database_unavailable', 503);
    lastKey = nextKey;
    out.push(...page);
  }
}

// 游标逐页读（并行分段不可信时的兜底，慢但完整）。
async function readPlansByCursor(db, province) {
  const out = [];
  let lastKey;
  for (;;) {
    const page = rows(await db.from('enrollment_plans').select('id,school_name,major_code')
      .eq('province', province).order('id').range(out.length, out.length + CURSOR_PAGE - 1));
    if (page.length === 0) return out;
    const nextKey = page[page.length - 1].id;
    if (nextKey === lastKey) throw new AppError('database_unavailable', 503);
    lastKey = nextKey;
    out.push(...page);
  }
}

async function readPlansForProvince(db, province, total) {
  const offsets = [];
  for (let from = 0; from < total; from += PARALLEL_PAGE) offsets.push(from);
  const pages = new Array(offsets.length);
  for (let i = 0; i < offsets.length; i += PARALLEL_CONCURRENCY) {
    const batch = offsets.slice(i, i + PARALLEL_CONCURRENCY);
    const results = await Promise.all(batch.map(async (from) => rows(await db.from('enrollment_plans')
      .select('id,school_name,major_code').eq('province', province).order('id').range(from, from + PARALLEL_PAGE - 1))));
    batch.forEach((_, index) => { pages[i + index] = results[index]; });
  }
  const flat = pages.flat();
  // 行数对不上说明适配器没有按 range 前进（整表返回或漏段），宁可退回游标读也不给不完整的筛选结果。
  if (flat.length !== total) return readPlansByCursor(db, province);
  const seen = new Set();
  for (const row of flat) {
    if (seen.has(row.id)) return readPlansByCursor(db, province);
    seen.add(row.id);
  }
  return flat;
}

// 返回 { 院校名: [该省招生计划里出现过的学科门类] }。
async function buildSchoolCategories(db, province, plansTotal) {
  const majors = await readAllMajors(db);
  const categoryByMajor = new Map(majors.map((major) => [major.code, major.category]));
  const plans = await readPlansForProvince(db, province, plansTotal);
  const schools = new Map();
  for (const plan of plans) {
    const category = categoryByMajor.get(plan.major_code);
    if (!category) continue;
    const name = typeof plan.school_name === 'string' && plan.school_name !== '' ? plan.school_name : null;
    if (!name) continue;
    const set = schools.get(name) ?? new Set();
    set.add(category);
    schools.set(name, set);
  }
  return Object.fromEntries([...schools].map(([name, set]) => [name, [...set]]));
}

// 命中缓存要求行数完全一致；专业目录或招生计划一变即重建（导入路由也会主动删缓存）。
export async function getDisciplineSchoolCategories(db, province) {
  const majorsRows = await countRows(db, 'majors');
  if (majorsRows === 0) return { status: 'catalog_missing', schools: {} };
  const plansRows = await countRows(db, 'enrollment_plans', { province });
  const cached = await readMetaRow(db, cacheKey(province));
  if (cached && cached.majors_rows === majorsRows && cached.plans_rows === plansRows
    && cached.schools && typeof cached.schools === 'object' && !Array.isArray(cached.schools)) {
    return { status: 'ok', schools: cached.schools };
  }
  const schools = await buildSchoolCategories(db, province, plansRows);
  if (Object.keys(schools).length <= CACHE_SCHOOL_LIMIT) {
    const persisted = await writeMetaRow(db, cacheKey(province), {
      majors_rows: majorsRows, plans_rows: plansRows, schools, generated_at: new Date().toISOString(),
    });
    // 缓存写失败只影响下次还要重建，不影响本次结果；删掉半截行避免脏数据长期驻留。
    if (!persisted) await deleteMetaRow(db, cacheKey(province));
  }
  return { status: 'ok', schools };
}

// 管理员导入 majors / enrollment_plans 之后调用：缓存立即失效，下次查询重建。
export async function invalidateDisciplineCaches(db) {
  for (const province of PILOT_PROVINCES) await deleteMetaRow(db, cacheKey(province));
}
