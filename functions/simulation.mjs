import { AppError, json, rows } from './http.mjs';
import { getDisciplineSchoolCategories } from './discipline-cache.mjs';

const PROVINCES = ['河北', '河南'];
const CATEGORIES = ['物理类', '历史类'];
// 意向方向（前端复选框键）→ 专业目录学科门类。目录值取自 functions/validate.mjs 的
// MAJOR_CATEGORIES（14 个官方学科门类）与 db/import/模板填写说明.md，不自造分类。
// 商科、文科是前端展示用的合类，各自对应多个门类。
export const DISCIPLINE_CATEGORIES = Object.freeze({
  gongke: ['工学'],
  like: ['理学'],
  yike: ['医学'],
  shangke: ['管理学', '经济学'],
  wenke: ['文学', '法学', '教育学', '历史学', '哲学'],
});
const DISCIPLINE_KEYS = Object.keys(DISCIPLINE_CATEGORIES);
const MAX_PROVINCES = 34;
const READ_PAGE_SIZE = 500;
const RESULT_PAGE_SIZE = 20;
const SCORE_COLUMNS = 'id,university_code,school_name,min_score,min_rank,year,source';
export const SIMULATION_THRESHOLDS = Object.freeze({ chongMax: 10, wenMin: -10 });
export const SIMULATION_RULES = Object.freeze({
  delta: '设 d = 该校最新一年 min_score − 我的 score。',
  chong: `冲：0 < d ≤ ${SIMULATION_THRESHOLDS.chongMax}（该校线比我高 10 分以内，够一够）。`,
  wen: '稳：−10 ≤ d ≤ 0（该校线和我差不多，或比我低 10 分以内）。',
  bao: '保：d < −10（该校线比我低 10 分以上）。',
});

function parameter(params, key, maxLength = 120) {
  if (params.getAll(key).length > 1) throw new AppError('invalid_input', 400);
  const value = params.get(key);
  if (value !== null && value.length > maxLength) throw new AppError('invalid_input', 400);
  return value;
}

function integer(value, min, max, code) {
  if (value === null || !/^\d+$/.test(value)) throw new AppError(code, 400);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new AppError(code, 400);
  return number;
}

// 逗号分隔的可选多选参数：去空、去重、保序；未传或全空返回 []（不过滤）。
function parseList(value) {
  if (value === null || value === undefined) return [];
  const seen = new Set();
  for (const part of String(value).split(',')) {
    const item = part.trim();
    if (item !== '' && !seen.has(item)) seen.add(item);
  }
  return [...seen];
}

async function readPages(makeQuery, key) {
  const result = [];
  let lastKey;
  for (;;) {
    const page = rows(await makeQuery().order(key).range(result.length, result.length + READ_PAGE_SIZE - 1));
    if (page.length === 0) return result;
    const nextKey = page[page.length - 1][key];
    // Refuse a non-advancing adapter rather than return a silently truncated total.
    if (nextKey === lastKey) throw new AppError('database_unavailable', 503);
    lastKey = nextKey;
    result.push(...page);
  }
}

export async function simulationOptions(db, request) {
  const params = new URL(request.url).searchParams;
  const province = parameter(params, 'province');
  // 想去的省份选项：已登记学校的所在省（去重、中文排序），与考生省份无关。
  const schools = await readPages(() => db.from('universities').select('code,province'), 'code');
  const provinces = [...new Set(schools.map((row) => row.province).filter((value) => typeof value === 'string' && value.trim() !== ''))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (!PROVINCES.includes(province)) {
    return json({ province, available: false, message: '暂无数据，采集中', options: [], rules: SIMULATION_RULES, provinces });
  }
  const records = await readPages(() => db.from('admission_scores')
    .select('id,category,batch,year').eq('province', province), 'id');
  const options = CATEGORIES.flatMap((category) => {
    const years = new Map();
    for (const row of records) {
      if (row.category === category) years.set(row.batch, Math.max(years.get(row.batch) ?? 0, row.year));
    }
    return years.size === 0 ? [] : [{ category, batches: [...years].sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
      .map(([batch, year]) => ({ batch, year })) }];
  });
  return json({ province, available: options.length > 0, message: options.length ? null : '暂无数据，采集中', options, rules: SIMULATION_RULES, provinces });
}

export async function simulateAdmissions(db, request) {
  const params = new URL(request.url).searchParams;
  const province = parameter(params, 'province');
  const category = parameter(params, 'category');
  const batch = parameter(params, 'batch');
  const score = integer(parameter(params, 'score', 20), 0, 750, 'invalid_simulation_score');
  const rankText = parameter(params, 'rank', 20);
  const rank = rankText === null || rankText === '' ? null : integer(rankText, 1, Number.MAX_SAFE_INTEGER, 'invalid_simulation_rank');
  const offset = integer(parameter(params, 'offset', 20) ?? '0', 0, 1000000, 'invalid_filter');
  const disciplines = parseList(parameter(params, 'disciplines', 200));
  const provinces = parseList(parameter(params, 'provinces', 500));
  if (disciplines.some((key) => !DISCIPLINE_KEYS.includes(key))) throw new AppError('invalid_input', 400);
  if (provinces.length > MAX_PROVINCES) throw new AppError('invalid_input', 400);
  const provinceFilter = new Set(provinces);
  const disciplineCategories = [...new Set(disciplines.flatMap((key) => DISCIPLINE_CATEGORIES[key]))];
  const supported = PROVINCES.includes(province);
  if (!province || (supported && (!CATEGORIES.includes(category) || !batch?.trim()))) throw new AppError('invalid_input', 400);

  const universities = await readPages(() => db.from('universities').select('code,name,province'), 'code');
  const response = {
    province, category, batch, score, rank, disciplines, provinces, year: null, available: false, message: '暂无数据，采集中',
    disciplines_status: null,
    offset, limit: RESULT_PAGE_SIZE, skipped_universities: universities.length,
    invalid_score_rows: 0, outside_range_count: 0,
    groups: { chong: { total: 0, items: [] }, wen: { total: 0, items: [] }, bao: { total: 0, items: [] } },
  };
  if (!supported) return json(response);

  const scoped = (columns) => db.from('admission_scores').select(columns)
    .eq('province', province).eq('category', category).eq('batch', batch);
  const latest = rows(await scoped('year').order('year', { ascending: false }).limit(1));
  if (!latest.length) return json(response);
  const year = latest[0].year;
  const records = await readPages(() => scoped(SCORE_COLUMNS).eq('year', year), 'id');

  // 意向方向只在选了才查：走 discipline-cache 的派生缓存，按校名聚合「该校在本省招生计划里
  // 出现过的学科门类」。计划表按校名关联院校（计划表用省报考代码，与录取表国标代码不同源，
  // 见 db/schema.sql 注释）；没有招生计划行的学校在方向筛选下排除；专业目录为空时不做整省扫描。
  let disciplineSchools = null;
  if (disciplineCategories.length > 0) {
    const derived = await getDisciplineSchoolCategories(db, province);
    response.disciplines_status = derived.status;
    const wanted = new Set(disciplineCategories);
    disciplineSchools = new Set(Object.entries(derived.schools)
      .filter(([, categories]) => Array.isArray(categories) && categories.some((category) => wanted.has(category)))
      .map(([name]) => name));
  }

  const byCode = new Map(universities.map((university) => [university.code, university]));
  const present = new Set();
  const groups = { chong: [], wen: [], bao: [] };
  for (const row of records) {
    const university = byCode.get(row.university_code);
    if (university) present.add(university.code);
    // 意向筛选只影响分档与计数口径；skipped_universities 仍按原口径统计
    // （所选省/科类/批次最新年无记录的学校数），与筛选无关。
    if (provinceFilter.size > 0 && !provinceFilter.has(university?.province)) continue;
    if (disciplineSchools && !disciplineSchools.has(row.school_name || university?.name)) continue;
    const raw = String(row.min_score ?? '').trim();
    const minScore = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(minScore)) { response.invalid_score_rows += 1; continue; }
    const d = minScore - score;
    if (d > SIMULATION_THRESHOLDS.chongMax) { response.outside_range_count += 1; continue; }
    const group = d > 0 ? 'chong' : d >= SIMULATION_THRESHOLDS.wenMin ? 'wen' : 'bao';
    const item = {
      university_code: row.university_code, name: row.school_name || university?.name || '暂无数据',
      min_score: minScore, year, source: row.source, d,
    };
    if (rank !== null && Number.isSafeInteger(row.min_rank) && row.min_rank > 0) {
      item.min_rank = row.min_rank;
      item.rank_difference = row.min_rank - rank;
    }
    groups[group].push(item);
  }
  for (const [key, items] of Object.entries(groups)) {
    items.sort((a, b) => Math.abs(a.d) - Math.abs(b.d) || a.university_code.localeCompare(b.university_code));
    response.groups[key] = { total: items.length, items: items.slice(offset, offset + RESULT_PAGE_SIZE) };
  }
  return json({ ...response, year, available: records.length > 0, message: records.length ? null : '暂无数据，采集中', skipped_universities: universities.length - present.size });
}
