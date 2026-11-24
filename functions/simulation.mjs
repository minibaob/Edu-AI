import { AppError, json, rows } from './http.mjs';

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
// 单次分页往返取回的行数：与 functions/universities.mjs 的 limit(1000) 同一上限。
// readPages 的空页收尾与不前进守卫不变，适配器截短分页时仍能读全（见契约测试）。
const READ_PAGE_SIZE = 1000;
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

// 意向方向只在选了才查：专业目录 + 本省招生计划。计划表按校名关联院校
// （计划表用省报考代码，与录取表国标代码不同源，见 db/schema.sql 注释），
// 因此用 school_name 匹配；没有招生计划行的学校在方向筛选下排除。
// 专业目录为空时，没有任何专业代码能命中所选门类，方向集合注定为空，
// 直接跳过招生计划全表读取——结果与读完再过滤完全一致。
// （两省专业目录 CSV 目前均为 0 行：线上选了方向必走这条路，之前要先串行
// 读完本省全部招生计划——河北 27,175 行约 56 次往返、河南 183,494 行约 368 次——
// 才得到同一个空集。）
async function loadDisciplineSchools(db, province, majors, disciplineCategories) {
  const wanted = new Set(disciplineCategories);
  const categoryByMajor = new Map(majors.map((major) => [major.code, major.category]));
  const schools = new Set();
  if (!majors.some((major) => wanted.has(major.category))) return schools;
  const plans = await readPages(() => db.from('enrollment_plans')
    .select('id,school_name,major_code').eq('province', province), 'id');
  for (const plan of plans) {
    if (!plan.major_code || !wanted.has(categoryByMajor.get(plan.major_code))) continue;
    if (typeof plan.school_name === 'string' && plan.school_name !== '') schools.add(plan.school_name);
  }
  return schools;
}

export async function simulationOptions(db, request) {
  const params = new URL(request.url).searchParams;
  const province = parameter(params, 'province');
  const supported = PROVINCES.includes(province);
  // 两张表互不依赖，并行读（之前是串行：高校全表 7 次往返后再读全省录取行 35 次）。
  // 不支持省份时不碰录取表，只返回省份列表。
  const [schools, records] = await Promise.all([
    readPages(() => db.from('universities').select('code,province'), 'code'),
    supported
      ? readPages(() => db.from('admission_scores')
        .select('id,category,batch,year').eq('province', province), 'id')
      : [],
  ]);
  // 想去的省份选项：已登记学校的所在省（去重、中文排序），与考生省份无关。
  const provinces = [...new Set(schools.map((row) => row.province).filter((value) => typeof value === 'string' && value.trim() !== ''))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (!supported) {
    return json({ province, available: false, message: '暂无数据，采集中', options: [], rules: SIMULATION_RULES, provinces });
  }
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

  // 高校全表只读一次：skipped_universities 计数、想去省份筛选、校名兜底都要它。
  // 先读它：不支持省份时直接返回，不再碰录取表；数据库分页异常时也在这里先暴露为 503。
  const universities = await readPages(() => db.from('universities').select('code,name,province'), 'code');
  const response = {
    province, category, batch, score, rank, disciplines, provinces, year: null, available: false, message: '暂无数据，采集中',
    offset, limit: RESULT_PAGE_SIZE, skipped_universities: universities.length,
    invalid_score_rows: 0, outside_range_count: 0,
    groups: { chong: { total: 0, items: [] }, wen: { total: 0, items: [] }, bao: { total: 0, items: [] } },
  };
  if (!supported) return json(response);

  const scoped = (columns) => db.from('admission_scores').select(columns)
    .eq('province', province).eq('category', category).eq('batch', batch);
  // 最新年与专业目录互不依赖，并行读；录取行要等最新年、招生计划要等目录结果，
  // 第二组也并行。一次匹配的串行往返从“各表页数之和”降到“最长的一组”。
  const [latest, majors] = await Promise.all([
    rows(await scoped('year').order('year', { ascending: false }).limit(1)),
    disciplineCategories.length > 0
      ? readPages(() => db.from('majors').select('code,category'), 'code')
      : [],
  ]);
  if (!latest.length) return json(response);
  const year = latest[0].year;
  const [records, disciplineSchools] = await Promise.all([
    readPages(() => scoped(SCORE_COLUMNS).eq('year', year), 'id'),
    disciplineCategories.length > 0
      ? loadDisciplineSchools(db, province, majors, disciplineCategories)
      : null,
  ]);

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
