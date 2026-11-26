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

// 意向方向只在选了才查，走 functions/discipline-cache.mjs 的派生缓存：
// 先数专业目录行数，为空直接返回 catalog_missing、不扫招生计划；
// 有目录时按校名聚合「该校在本省招生计划里出现过的学科门类」，按行数版本
// 缓存进 data_meta。计划表按校名关联院校（计划表用省报考代码，与录取表
// 国标代码不同源，见 db/schema.sql 注释）；没有招生计划行的学校在方向筛选下排除。

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
    disciplines_status: null,
    offset, limit: RESULT_PAGE_SIZE, skipped_universities: universities.length,
    invalid_score_rows: 0, outside_range_count: 0,
    groups: { chong: { total: 0, items: [] }, wen: { total: 0, items: [] }, bao: { total: 0, items: [] } },
  };
  if (!supported) return json(response);

  const scoped = (columns) => db.from('admission_scores').select(columns)
    .eq('province', province).eq('category', category).eq('batch', batch);
  // 最新年单行查询；专业目录由派生缓存内部先数行数、按需再读，不在这里另读。
  const latest = await rows(await scoped('year').order('year', { ascending: false }).limit(1));
  if (!latest.length) return json(response);
  const year = latest[0].year;
  // 录取行与方向派生互不依赖，并行读；一次匹配的串行往返仍是“最长的一组”。
  const [records, derived] = await Promise.all([
    readPages(() => scoped(SCORE_COLUMNS).eq('year', year), 'id'),
    disciplineCategories.length > 0
      ? getDisciplineSchoolCategories(db, province)
      : null,
  ]);
  let disciplineSchools = null;
  if (derived) {
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
