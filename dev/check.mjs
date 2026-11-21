// 本地契约检查：直接调用真实的 functions/ 模块（router / http / validate / passwords /
// sessions / limiter），只替换数据层为凭据无关的假数据库。
// 不证明真实 Provider、网关准入或部署环境行为。
//   node --test dev/check.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../functions/router.mjs';
const PUBLIC_ORIGIN = 'https://eduai.test';
import { PBKDF2_ITERATIONS } from '../functions/passwords.mjs';
import { SESSION_COOKIE, SESSION_TTL_MS, sha256Hex } from '../functions/sessions.mjs';
import { LIMITS } from '../functions/limiter.mjs';
import { createFakeDb } from './fake-db.mjs';
import { createFakeStorage } from './fake-storage.mjs';
import { FILE_MAX_BYTES, storageKeyFor } from '../functions/resource-files.mjs';

// 每次运行生成的临时口令，不在任何输出中打印；测试结束即丢弃。
const PASSWORD = `pw-${crypto.randomUUID()}-${crypto.randomUUID()}`;

function fixture(storage) {
  const control = { mode: 'ok', dropTable: null, writes: [] };
  const db = createFakeDb(control);
  const handle = createApplication({ db, origin: PUBLIC_ORIGIN, storage });
  return { control, db, handle };
}

// 网关会把 app 段替换成物理函数名；这里同时覆盖物理名与逻辑名两种形态。
function ctx(path, { method = 'GET', body, cookie, origin = PUBLIC_ORIGIN, headers = {}, logical = false } = {}) {
  const merged = { ...headers };
  if (origin !== null) merged.origin = origin;
  if (cookie) merged.cookie = cookie;
  if (body !== undefined) merged['content-type'] = 'application/json';
  const target = logical
    ? `${PUBLIC_ORIGIN}/functions/v1/app${path}`
    : `https://provider.internal/functions/v1/app-d${'a'.repeat(32)}${path}`;
  return {
    request: new Request(target, { method, headers: merged, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    requestId: 'local-check',
  };
}

const call = async (handle, context) => {
  const response = await handle(context);
  let body = null;
  try { body = await response.clone().json(); } catch { body = null; }
  return { status: response.status, body, setCookie: response.headers.get('set-cookie'), headers: response.headers };
};

const cookiePair = (result) => {
  const header = result.setCookie;
  if (!header) return null;
  return header.split(';')[0];
};

const register = (handle, username, password = PASSWORD, extra = {}) =>
  call(handle, ctx('/api/register', { method: 'POST', body: { username, password, ...extra } }));
const login = (handle, username, password = PASSWORD) => call(handle, ctx('/api/login', { method: 'POST', body: { username, password } }));
const me = (handle, cookie) => call(handle, ctx('/api/me', { cookie }));
const uniqueName = (prefix = 'user') => `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;

test('河北一分一段参考：三年来源、日期和官方普通类PDF地址对应正确', async () => {
  const { readFile } = await import('node:fs/promises');
  const references = JSON.parse(await readFile(new URL('../src/lib/hebei-score-references.json', import.meta.url), 'utf8'));
  assert.equal(references.province, '河北');
  assert.equal(references.source, '河北省教育考试院');
  assert.equal(references.scoreBasis, '含优惠分');
  assert.equal(references.format, 'scanned-pdf');
  assert.deepEqual(references.categories, ['物理类', '历史类']);
  assert.deepEqual(references.years.map((item) => item.year), [2026, 2025, 2024]);
  const verified = {
    2026: ['https://www.hebeea.edu.cn/c/2026-06-24/493215.html', 'https://file.hebeea.edu.cn/upload/resources/file/2026/06/24/27144.pdf'],
    2025: ['https://www.hebeea.edu.cn/c/2025-06-24/488903.html', 'https://file.hebeea.edu.cn/files/article/2025/06/20250624193800_658.pdf'],
    2024: ['https://www.hebeea.edu.cn/c/2024-06-24/489444.html', 'https://file.hebeea.edu.cn/files/article/2024/06/20240624195327_41.pdf'],
  };
  for (const item of references.years) {
    assert.equal(item.publishedAt, `${item.year}-06-24`);
    assert.deepEqual([item.sourceUrl, item.pdfUrl], verified[item.year]);
  }
  assert.equal(references.years[0].reportUrl, 'https://www.hebtv.com/19/19js/zx/snsz/12389865.shtml');
});

const simulationPath = (extra = {}) => `/api/simulation?${new URLSearchParams({ province: '河北', category: '物理类', batch: '本科批', score: '600', ...extra })}`;
async function seedSimulation(db, records) {
  const schools = [...new Map(records.map((row) => [row.university_code, { code: row.university_code, name: `测试院校${row.university_code}` }])).values()];
  assert.equal((await db.from('universities').insertIfAbsent(schools, { onConflict: 'code' })).error, null);
  const scores = records.map((row, i) => ({
    id: `simulation-${String(i).padStart(5, '0')}`, province: '河北', category: '物理类', batch: '本科批', year: 2026,
    school_name: `测试院校${row.university_code}`, source: '本地合成 fixture（非真实高校数据）', min_rank: null, ...row,
  }));
  assert.equal((await db.from('admission_scores').insertIfAbsent(scores, { onConflict: 'id' })).error, null);
}

test('模拟填报：公开只读，冲稳保边界10/0/-10/-11、绝对分差排序和原文来源', async () => {
  const { db, handle, control } = fixture();
  await seedSimulation(db, [610, 600, 590, 589, 611, 601, 599].map((score, i) => ({
    university_code: `u${i}`, min_score: String(score), source: '测试来源 原文 / <标签> & 标点。',
  })));
  control.writes.length = 0;
  const result = await call(handle, ctx(simulationPath(), { origin: null }));
  assert.equal(result.status, 200);
  assert.equal(result.body.year, 2026);
  assert.deepEqual(Object.fromEntries(Object.entries(result.body.groups).map(([k, g]) => [k, g.items.map((r) => r.d)])), {
    chong: [1, 10], wen: [0, -1, -10], bao: [-11],
  });
  assert.equal(result.body.outside_range_count, 1);
  assert.equal(result.body.skipped_universities, 0);
  assert.equal(result.body.limit, 20);
  for (const group of Object.values(result.body.groups)) {
    assert.equal(group.total, group.items.length);
    assert.ok(group.items.every((r) => r.year === 2026 && r.source === '测试来源 原文 / <标签> & 标点。' && r.d === r.min_score - 600));
  }
  assert.deepEqual(control.writes, []);
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.equal((await call(handle, ctx('/api/simulation', { method: 'POST', body: {} }))).status, 405);
  assert.equal((await call(handle, ctx('/api/simulation/options', { method: 'POST', body: {} }))).status, 405);
});

test('河北一分一段参考：查阅往年不改变模拟最新年、不补高校空位次、不写库', async () => {
  const { db, handle, control } = fixture();
  await seedSimulation(db, [
    { university_code: 'current', min_score: '600', year: 2026, min_rank: null },
    { university_code: 'previous', min_score: '605', year: 2024, min_rank: 10000 },
  ]);
  control.writes.length = 0;
  const current = await call(handle, ctx(simulationPath({ rank: '20000' })));
  for (const year of ['2024', '2025']) {
    const res = await call(handle, ctx(simulationPath({ rank: '20000', year })));
    assert.deepEqual(res.body, current.body);
    assert.equal(res.body.year, 2026);
    assert.equal('min_rank' in res.body.groups.wen.items[0], false);
    assert.equal('rank_difference' in res.body.groups.wen.items[0], false);
  }
  assert.deepEqual(control.writes, []);
});

test('模拟填报：最新年严格按省科类批次选取，旧年/他省/其他科类批次不凑数', async () => {
  const { db, handle } = fixture();
  await seedSimulation(db, [
    { university_code: 'latest', min_score: '605', year: 2026 },
    { university_code: 'older-only', min_score: '600', year: 2025 },
    { university_code: 'henan', min_score: '598', province: '河南', year: 2025 },
    { university_code: 'history', min_score: '599', category: '历史类', year: 2027 },
    { university_code: 'college', min_score: '580', batch: '专科批', year: 2028 },
  ]);
  const result = await call(handle, ctx(simulationPath()));
  assert.equal(result.body.year, 2026);
  assert.deepEqual(result.body.groups.chong.items.map((r) => r.university_code), ['latest']);
  assert.equal(result.body.groups.wen.total, 0);
  assert.equal(result.body.groups.bao.total, 0);
  assert.equal(result.body.skipped_universities, 4);
  assert.equal('skipped_items' in result.body, false);
  const henan = await call(handle, ctx(simulationPath({ province: '河南' })));
  assert.equal(henan.body.year, 2025);
  assert.deepEqual(henan.body.groups.wen.items.map((r) => r.university_code), ['henan']);
  const none = await call(handle, ctx(simulationPath({ batch: '不存在的批次' })));
  assert.equal(none.status, 200);
  assert.equal(none.body.year, null);
  assert.equal(none.body.available, false);
  assert.equal(none.body.skipped_universities, 5);
});

test('模拟填报：不支持省份和空库返回暂无数据，非法分数位次/筛选400', async () => {
  const { db, handle } = fixture();
  await seedSimulation(db, [{ university_code: 'local', min_score: '600' }]);
  const other = await call(handle, ctx(simulationPath({ province: '广东' })));
  assert.equal(other.status, 200);
  assert.equal(other.body.message, '暂无数据，采集中');
  assert.equal(other.body.available, false);
  assert.equal(other.body.skipped_universities, 1);
  assert.ok(Object.values(other.body.groups).every((g) => g.total === 0 && g.items.length === 0));
  for (const score of ['', '-1', '751', '600.5', '1e2', 'Infinity', 'NaN', '0x10', '600分']) {
    assert.equal((await call(handle, ctx(simulationPath({ score })))).status, 400, score);
  }
  assert.equal((await call(handle, ctx('/api/simulation?province=河北&category=物理类&batch=本科批'))).status, 400);
  for (const rank of ['0', '-1', '1.2', 'NaN', '9007199254740992', '1e4', ' 2 ']) {
    assert.equal((await call(handle, ctx(simulationPath({ rank })))).status, 400, rank);
  }
  for (const extra of [{ category: '综合' }, { batch: '' }, { offset: '-1' }, { offset: '1.5' }, { offset: '1000001' }]) {
    assert.equal((await call(handle, ctx(simulationPath(extra)))).status, 400);
  }
  assert.equal((await call(handle, ctx(`${simulationPath()}&score=500`))).status, 400);
  for (const score of ['0', '750']) assert.equal((await call(handle, ctx(simulationPath({ score })))).status, 200);
  assert.equal((await call(handle, ctx(simulationPath({ rank: '' })))).status, 200);
  const empty = await call(fixture().handle, ctx(simulationPath()));
  assert.equal(empty.status, 200);
  assert.equal(empty.body.message, '暂无数据，采集中');
});

test('模拟填报：跳过无法完整解析的最低分，保留小数，不用旧年补无效分数', async () => {
  const { db, handle } = fixture();
  const bad = [null, '', ' ', 'abc', '600分', 'Infinity', 'NaN', '0x258', '600/700'];
  await seedSimulation(db, [
    ...bad.map((min_score, i) => ({ university_code: `bad${i}`, min_score })),
    { university_code: 'decimal', min_score: '599.5' },
    { university_code: 'bad0', min_score: '600', year: 2025, id: 'old-valid' },
  ]);
  const result = await call(handle, ctx(simulationPath()));
  assert.equal(result.body.invalid_score_rows, bad.length);
  assert.equal(result.body.skipped_universities, 0, '有记录但分数无效不能统计为无记录');
  assert.equal(result.body.groups.wen.total, 1);
  assert.equal(result.body.groups.wen.items[0].d, -0.5);
  const onlyInvalid = fixture();
  await seedSimulation(onlyInvalid.db, [
    { university_code: 'a', min_score: null },
    { university_code: 'a', min_score: '600', year: 2025 },
  ]);
  const res = await call(onlyInvalid.handle, ctx(simulationPath()));
  assert.equal(res.body.year, 2026);
  assert.equal(res.body.invalid_score_rows, 1);
  assert.ok(Object.values(res.body.groups).every((g) => g.total === 0));
});

test('模拟填报：位次仅有真实值并提交位次时展示，不参与分档排序', async () => {
  const { db, handle } = fixture();
  await seedSimulation(db, [
    { university_code: 'has-rank', min_score: '600', min_rank: 12345 },
    { university_code: 'no-rank', min_score: '601', min_rank: null },
  ]);
  const plain = (await call(handle, ctx(simulationPath()))).body;
  const ranked = (await call(handle, ctx(simulationPath({ rank: '12000' })))).body;
  assert.equal(ranked.groups.wen.items[0].min_rank, 12345);
  assert.equal(ranked.groups.wen.items[0].rank_difference, 345);
  assert.equal('min_rank' in plain.groups.wen.items[0], false);
  assert.equal('rank_difference' in plain.groups.wen.items[0], false);
  assert.equal('min_rank' in ranked.groups.chong.items[0], false);
  assert.equal('rank_difference' in ranked.groups.chong.items[0], false);
  for (const key of ['chong', 'wen', 'bao']) {
    assert.deepEqual(plain.groups[key].items.map((r) => r.university_code), ranked.groups[key].items.map((r) => r.university_code));
  }
  const worse = (await call(handle, ctx(simulationPath({ rank: '13000' })))).body;
  assert.equal(worse.groups.wen.items[0].rank_difference, -655);
});

test('模拟填报：完整读取超千行、每档20所、offset无重叠且同分稳定排序', async () => {
  const { db, handle } = fixture();
  await seedSimulation(db, Array.from({ length: 1203 }, (_, i) => ({
    university_code: `u${String(i).padStart(4, '0')}`, min_score: ['605', '595', '589'][i % 3],
  })));
  const first = (await call(handle, ctx(simulationPath()))).body;
  const second = (await call(handle, ctx(simulationPath({ offset: '20' })))).body;
  const last = (await call(handle, ctx(simulationPath({ offset: '400' })))).body;
  assert.equal(first.skipped_universities, 0);
  for (const key of ['chong', 'wen', 'bao']) {
    assert.equal(first.groups[key].total, 401);
    assert.equal(first.groups[key].items.length, 20);
    assert.equal(second.groups[key].items.length, 20);
    assert.equal(last.groups[key].items.length, 1);
    const codes = [...first.groups[key].items, ...second.groups[key].items].map((r) => r.university_code);
    assert.equal(new Set(codes).size, 40);
    assert.deepEqual(codes, [...codes].sort());
  }
  const past = (await call(handle, ctx(simulationPath({ offset: '1000' })))).body;
  assert.ok(Object.values(past.groups).every((g) => g.total === 401 && g.items.length === 0));
});

test('模拟填报：选项仅本省真实科类批次，年份按每个组合独立取最新', async () => {
  const { db, handle } = fixture();
  await seedSimulation(db, [
    { university_code: 'a', min_score: '600', year: 2025 },
    { university_code: 'b', min_score: '600', year: 2026 },
    { university_code: 'c', min_score: '600', category: '历史类', batch: '专科批', year: 2024 },
    { university_code: 'd', min_score: '600', category: '艺术类', batch: '艺术批', year: 2026 },
    { university_code: 'e', min_score: '600', province: '河南', batch: '高职高专批', year: 2025 },
  ]);
  const res = await call(handle, ctx('/api/simulation/options?province=河北'));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.options, [
    { category: '物理类', batches: [{ batch: '本科批', year: 2026 }] },
    { category: '历史类', batches: [{ batch: '专科批', year: 2024 }] },
  ]);
  assert.equal(res.body.rules.chong, '冲：0 < d ≤ 10（该校线比我高 10 分以内，够一够）。');
  const other = await call(handle, ctx('/api/simulation/options?province=广东'));
  assert.equal(other.body.available, false);
  assert.deepEqual(other.body.options, []);
});

test('模拟填报：数据库分页被截短时继续读取，仅读两表且从不写库', async () => {
  const { db } = fixture();
  await seedSimulation(db, Array.from({ length: 83 }, (_, i) => ({ university_code: `s${i}`, min_score: '600' })));
  const touched = new Set();
  const readOnly = { from(table) {
    assert.ok(['admission_scores', 'universities'].includes(table));
    touched.add(table);
    return { select(columns) {
      const query = db.from(table).select(columns);
      const range = query.range.bind(query);
      query.range = (from, to) => range(from, Math.min(to, from + 16));
      return query;
    } };
  } };
  const handle = createApplication({ db: readOnly, origin: PUBLIC_ORIGIN });
  const result = await call(handle, ctx(simulationPath()));
  assert.equal(result.status, 200);
  assert.equal(result.body.groups.wen.total, 83);
  assert.equal(result.body.skipped_universities, 0);
  assert.deepEqual([...touched].sort(), ['admission_scores', 'universities']);
});

test('模拟填报：选项扫描跨页，不因500行上限漏掉真实科类批次', async () => {
  const { db, handle } = fixture();
  await seedSimulation(db, [
    ...Array.from({ length: 501 }, (_, i) => ({ university_code: `s${i}`, min_score: '600' })),
    { university_code: 'last-page', min_score: '400', category: '历史类', batch: '专科批', year: 2025 },
  ]);
  const result = await call(handle, ctx('/api/simulation/options?province=河北'));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.options[1], { category: '历史类', batches: [{ batch: '专科批', year: 2025 }] });
});

test('模拟填报：适配器忽略分页时明确失败，不能重复累计或无限读取', async () => {
  const db = { from(table) {
    const query = {
      select() { return query; }, order() { return query; },
      range() { return Promise.resolve({ data: table === 'universities' ? [{ code: 'u1', name: '本地测试' }] : [], error: null }); },
    };
    return query;
  } };
  const result = await call(createApplication({ db, origin: PUBLIC_ORIGIN }), ctx(simulationPath()));
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'database_unavailable');
});

test('模拟填报：数据库中途失败不可返回部分结果冒充总数', async () => {
  const { db } = fixture();
  await seedSimulation(db, Array.from({ length: 501 }, (_, i) => ({ university_code: `s${i}`, min_score: '600' })));
  const failingDb = { from(table) { return { select(columns) {
    const query = db.from(table).select(columns);
    const range = query.range.bind(query);
    query.range = (from, to) => table === 'admission_scores' && from > 0
      ? Promise.resolve({ data: null, error: { code: 'read_failed' } }) : range(from, to);
    return query;
  } }; } };
  const result = await call(createApplication({ db: failingDb, origin: PUBLIC_ORIGIN }), ctx(simulationPath()));
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'database_unavailable');
  assert.equal('groups' in result.body, false);
});

// --- 院校对比 ---
const comparePath = (query = {}) => {
  const params = new URLSearchParams({
    codes: 'u100,u200', province: '河北', category: '物理类', batch: '本科批', ...query,
  });
  return `/api/universities/compare?${params}`;
};

const seedCompare = async (db) => {
  await db.from('universities').insertIfAbsent([
    { code: 'u100', name: '甲大学', province: '北京', city: '北京市', type: '综合', level: '本科', tags: '双一流|985', website: 'https://a.edu.cn', source: '教育部名单' },
    { code: 'u200', name: '乙大学', province: '上海', city: '上海市', type: '理工', level: '本科', tags: '双一流', website: 'https://b.edu.cn', source: '教育部名单' },
    { code: 'u300', name: '丙大学', province: '河北', city: '石家庄市', type: '师范', level: '本科', tags: null, website: null, source: '教育部名单' },
  ], { onConflict: 'code' });
  await db.from('admission_scores').insertIfAbsent([
    { id: 'cmp-s1', university_code: 'u100', school_name: '甲大学', province: '河北', year: 2025, category: '物理类', batch: '本科批', min_score: '640', source: '省教育考试院' },
    { id: 'cmp-s2', university_code: 'u100', school_name: '甲大学', province: '河北', year: 2025, category: '物理类', batch: '本科批', min_score: '635', source: '省教育考试院' },
    { id: 'cmp-s3', university_code: 'u100', school_name: '甲大学', province: '河北', year: 2024, category: '物理类', batch: '本科批', min_score: '700', source: '省教育考试院' },
    { id: 'cmp-s4', university_code: 'u200', school_name: '乙大学', province: '河北', year: 2026, category: '物理类', batch: '本科批', min_score: '620', source: '省教育考试院' },
    { id: 'cmp-s5', university_code: 'u200', school_name: '乙大学', province: '河北', year: 2026, category: '物理类', batch: '本科批', min_score: 'abc', source: '省教育考试院' },
    { id: 'cmp-s6', university_code: 'u200', school_name: '乙大学', province: '河北', year: 2025, category: '物理类', batch: '本科批', min_score: '500', source: '省教育考试院' },
  ], { onConflict: 'id' });
  await db.from('enrollment_plans').insertIfAbsent([
    { id: 'cmp-p1', school_name: '甲大学', province: '河北', year: 2025, major_name: '数学', batch: '本科批', plan_count: 10, source: '省教育考试院' },
    { id: 'cmp-p2', school_name: '甲大学', province: '河北', year: 2025, major_name: '物理', batch: '本科批', plan_count: 25, source: '省教育考试院' },
    { id: 'cmp-p3', school_name: '甲大学', province: '河北', year: 2025, major_name: '化学', batch: '本科批', plan_count: null, source: '省教育考试院' },
    { id: 'cmp-p4', school_name: '甲大学', province: '河北', year: 2024, major_name: '数学', batch: '本科批', plan_count: 999, source: '省教育考试院' },
    // 乙大学计划最新年 2025，与其分数最新年 2026 不同：分数与计划各标各的年份。
    { id: 'cmp-p5', school_name: '乙大学', province: '河北', year: 2025, major_name: '计算机', batch: '本科批', plan_count: 8, source: '省教育考试院' },
  ], { onConflict: 'id' });
};

test('院校对比：同一组合下各校取最新一年最低分与计划数，并标明年份与来源', async () => {
  const { handle, db } = fixture();
  await seedCompare(db);
  const result = await call(handle, ctx(comparePath()));
  assert.equal(result.status, 200);
  assert.equal(result.body.province, '河北');
  assert.equal(result.body.category, '物理类');
  assert.equal(result.body.batch, '本科批');
  const [a, b] = result.body.items;
  assert.equal(a.code, 'u100');
  assert.equal(a.name, '甲大学');
  assert.equal(a.found, true);
  assert.equal(a.city, '北京市');
  assert.equal(a.type, '综合');
  assert.equal(a.level, '本科');
  assert.equal(a.tags, '双一流|985');
  // 2025 年两行取最小 635；2024 年的 700 不参与（旧年份不拼进最新年）。
  assert.equal(a.score.min_score, 635);
  assert.equal(a.score.year, 2025);
  assert.equal(a.score.source, '省教育考试院');
  assert.equal(a.score.rows, 2);
  assert.equal(a.score.invalid_rows, 0);
  // 计划：2025 年两行有效计划数之和 35，计划数为空的一行不计入；2024 年的 999 不参与。
  assert.equal(a.plans.total_count, 35);
  assert.equal(a.plans.year, 2025);
  assert.equal(a.plans.majors, 2);
  assert.equal(a.plans.rows, 3);
  assert.deepEqual(a.plans.sources, ['省教育考试院']);
  // 乙大学：最新一年 2026，最低分 620，无法解析的 'abc' 跳过并计数；计划年份独立于分数年份。
  assert.equal(b.score.min_score, 620);
  assert.equal(b.score.year, 2026);
  assert.equal(b.score.rows, 2);
  assert.equal(b.score.invalid_rows, 1);
  assert.equal(b.plans.total_count, 8);
  assert.equal(b.plans.year, 2025);
});

test('院校对比：缺失的分数或计划返回 null，未知代码标 found:false', async () => {
  const { handle, db } = fixture();
  await seedCompare(db);
  const result = await call(handle, ctx(comparePath({ codes: 'u300,u999' })));
  assert.equal(result.status, 200);
  const [c, missing] = result.body.items;
  assert.equal(c.code, 'u300');
  assert.equal(c.found, true);
  assert.equal(c.score, null);
  assert.equal(c.plans, null);
  assert.equal(missing.code, 'u999');
  assert.equal(missing.found, false);
  assert.equal(missing.name, null);
  assert.equal(missing.score, null);
  assert.equal(missing.plans, null);
});

test('院校对比：院校数量与省份科类批次校验不通过返回 400', async () => {
  const { handle, db } = fixture();
  await seedCompare(db);
  const cases = [
    { codes: 'u100' },
    { codes: 'u100,u200,u300,u400' },
    { codes: 'u100,u100' },
    { province: '江苏' },
    { category: '理科' },
    { batch: '' },
    { codes: '' },
  ];
  for (const query of cases) {
    const result = await call(handle, ctx(comparePath(query)));
    assert.equal(result.status, 400, JSON.stringify(query));
    assert.equal(result.body.error, 'invalid_input');
  }
});

test('院校对比：最新一年分数全部无法解析时最低分为空并计数', async () => {
  const { handle, db } = fixture();
  await db.from('universities').insertIfAbsent([{ code: 'u100', name: '甲大学', province: '北京', city: '北京市', type: '综合', level: '本科', tags: null, website: null, source: '教育部名单' }], { onConflict: 'code' });
  await db.from('admission_scores').insertIfAbsent([
    { id: 'cmp-x1', university_code: 'u100', school_name: '甲大学', province: '河北', year: 2026, category: '物理类', batch: '本科批', min_score: '待公布', source: '省教育考试院' },
    { id: 'cmp-x2', university_code: 'u100', school_name: '甲大学', province: '河北', year: 2026, category: '物理类', batch: '本科批', min_score: '未公布', source: '省教育考试院' },
    { id: 'cmp-x3', university_code: 'u100', school_name: '甲大学', province: '河北', year: 2025, category: '物理类', batch: '本科批', min_score: '600', source: '省教育考试院' },
  ], { onConflict: 'id' });
  const result = await call(handle, ctx(comparePath({ codes: 'u100,u200' })));
  assert.equal(result.status, 200);
  const [a] = result.body.items;
  assert.equal(a.score.min_score, null);
  assert.equal(a.score.year, 2026);
  assert.equal(a.score.rows, 2);
  assert.equal(a.score.invalid_rows, 2);
});

const WRONG_QUESTION = {
  subject: '数学', grade: '高二', chapter: '函数', source: '练习',
  question: '本地测试题：2 + 3 = ?', correct_answer: '5', my_answer: '4', reason: '计算失误', note: '本地合成测试数据',
};
const wrongPath = '/api/wrong-questions';
const newWrong = (handle, cookie, extra = {}) => call(handle, ctx(wrongPath, { method: 'POST', cookie, body: { ...WRONG_QUESTION, ...extra } }));

test('模块10：所有私有与公开接口均需会话，未登录写操作401，CSRF不放行', async () => {
  const { handle, db } = fixture();
  const id = crypto.randomUUID();
  for (const [path, method] of [[wrongPath, 'GET'], [wrongPath, 'POST'], [`${wrongPath}/public`, 'GET'], [`${wrongPath}/stats`, 'GET'], [`${wrongPath}/${id}`, 'GET'], [`${wrongPath}/${id}`, 'PATCH'], [`${wrongPath}/${id}`, 'DELETE'], [`${wrongPath}/${id}/review`, 'POST']]) {
    assert.equal((await call(handle, ctx(path, { method, ...(['POST', 'PATCH'].includes(method) ? { body: WRONG_QUESTION } : {}) }))).status, 401);
  }
  const cookie = cookiePair(await register(handle, uniqueName()));
  const created = await newWrong(handle, cookie);
  for (const [path, method] of [[wrongPath, 'POST'], [`${wrongPath}/${created.body.item.id}`, 'PATCH'], [`${wrongPath}/${created.body.item.id}`, 'DELETE'], [`${wrongPath}/${created.body.item.id}/review`, 'POST']]) {
    assert.equal((await call(handle, ctx(path, { method, cookie, origin: 'https://evil.test', ...(method === 'DELETE' ? {} : { body: WRONG_QUESTION }) }))).status, 403);
  }
  assert.equal(db.dump('wrong_questions').length, 1);
  assert.equal((await call(handle, ctx(`${wrongPath}/public`, { method: 'POST', cookie, body: {} }))).status, 405);
});

test('模块10：归属只认会话，默认私有，A/B详情修改删除复习隔离', async () => {
  const { handle, db } = fixture();
  const a = await register(handle, uniqueName()), b = await register(handle, uniqueName());
  const ca = cookiePair(a), cb = cookiePair(b);
  const created = await newWrong(handle, ca, { user_id: b.body.user.id, owner_id: b.body.user.id, review_count: 90, status: 'done' });
  assert.equal(created.status, 201);
  assert.equal(created.body.user_id, a.body.user.id);
  assert.equal(created.body.item.user_id, a.body.user.id);
  assert.equal(created.body.item.status, 'todo');
  assert.equal(created.body.item.visibility, 'private');
  assert.equal(created.body.item.review_count, 0);
  assert.equal(created.body.item.last_reviewed_at, null);
  const path = `${wrongPath}/${created.body.item.id}`;
  for (const [target, method, body] of [[path, 'GET'], [path, 'PATCH', { note: '篡改' }], [path, 'DELETE'], [`${path}/review`, 'POST']]) {
    assert.equal((await call(handle, ctx(target, { cookie: cb, method, body }))).status, 404);
  }
  assert.equal((await call(handle, ctx(`${wrongPath}?user_id=${a.body.user.id}`, { cookie: cb }))).body.total, 0);
  assert.deepEqual((await call(handle, ctx(`${wrongPath}/stats`, { cookie: cb }))).body, { user_id: b.body.user.id, total: 0, todo: 0 });
  assert.equal(db.dump('wrong_questions')[0].note, WRONG_QUESTION.note);
  assert.equal((await call(handle, ctx(path, { cookie: ca }))).status, 200);
});

test('模块10：提交时账号一致性前置条件，跨标签页换号不可写入旧账号草稿', async () => {
  const { handle, db } = fixture();
  const a = await register(handle, uniqueName()), b = await register(handle, uniqueName());
  const ca = cookiePair(a), cb = cookiePair(b);
  assert.equal((await call(handle, ctx(`${wrongPath}/stats`, { cookie: ca }))).body.user_id, a.body.user.id);
  const changed = await newWrong(handle, cb, { expected_user_id: a.body.user.id, user_id: a.body.user.id });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, 'wrong_question_session_changed');
  assert.equal(db.dump('wrong_questions').length, 0);
  const valid = await newWrong(handle, cb, { expected_user_id: b.body.user.id, user_id: a.body.user.id });
  assert.equal(valid.status, 201);
  assert.equal(valid.body.item.user_id, b.body.user.id);
});

test('模块10：字段长度、对象形状、错因/状态/来源/学科白名单与公开确认', async () => {
  const { handle } = fixture();
  const cookie = cookiePair(await register(handle, uniqueName()));
  for (const extra of [{ subject: '其他' }, { source: '自动生成' }, { reason: 'unknown' }, { grade: '初一' }, { question: '' }, { question: ' '.repeat(3) }, { question: '题'.repeat(5001) }, { correct_answer: '答'.repeat(3001) }, { my_answer: null }, { my_answer: '答'.repeat(3001) }, { chapter: '章'.repeat(101) }, { note: '注'.repeat(2001) }, { visibility: 'public' }]) {
    assert.equal((await newWrong(handle, cookie, extra)).status, 400, JSON.stringify(Object.keys(extra)));
  }
  for (const body of [null, [], 'text']) assert.equal((await call(handle, ctx(wrongPath, { method: 'POST', cookie, body }))).status, 400);
  const created = await newWrong(handle, cookie, { chapter: null, grade: null, note: null });
  const path = `${wrongPath}/${created.body.item.id}`;
  for (const body of [{ status: 'unknown' }, { reason: 'unknown' }, { visibility: 'friends' }, { visibility: 'public' }, { visibility: 'public', public_confirmed: 'true' }, { note: 'n'.repeat(2001) }, { user_id: crypto.randomUUID() }, { review_count: 100 }, {}, []]) {
    assert.equal((await call(handle, ctx(path, { method: 'PATCH', cookie, body }))).status, 400);
  }
  const updated = await call(handle, ctx(path, { method: 'PATCH', cookie, body: { status: 'reviewing', reason: '概念不清', note: '' } }));
  assert.equal(updated.status, 200);
  assert.equal(updated.body.item.status, 'reviewing');
  assert.equal(updated.body.item.reason, '概念不清');
  assert.equal(updated.body.item.note, null);
  assert.equal((await call(handle, ctx(`${wrongPath}/bad-id`, { cookie }))).status, 404);
  const oversized = await newWrong(handle, cookie, { question: 'x'.repeat(70000) });
  assert.equal(oversized.status, 413);
});

test('模块10：数据库内筛选分页、稳定排序、超过500条的真实总数与待复习数', async () => {
  const { handle, db } = fixture();
  const a = await register(handle, uniqueName()), b = await register(handle, uniqueName());
  const cookie = cookiePair(a);
  const rows = Array.from({ length: 507 }, (_, i) => ({
    ...WRONG_QUESTION, id: crypto.randomUUID(), user_id: a.body.user.id, subject: i === 506 ? '英语' : '数学',
    status: i < 505 ? 'todo' : 'done', visibility: 'private', review_count: 0, last_reviewed_at: null,
    created_at: '2026-11-20T00:00:00.000Z',
  }));
  await db.from('wrong_questions').insertIfAbsent(rows, { onConflict: 'id' });
  await newWrong(handle, cookiePair(b));
  const first = await call(handle, ctx(`${wrongPath}?limit=20&offset=0`, { cookie }));
  const second = await call(handle, ctx(`${wrongPath}?limit=20&offset=20`, { cookie }));
  assert.equal(first.body.total, 507);
  assert.equal(first.body.items.length, 20);
  assert.equal(new Set([...first.body.items, ...second.body.items].map((r) => r.id)).size, 40);
  assert.deepEqual(first.body.items.map((r) => r.id), [...rows].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 20).map((r) => r.id));
  const filtered = await call(handle, ctx(`${wrongPath}?subject=英语&chapter=函数&reason=计算失误&status=done`, { cookie }));
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.items[0].id, rows[506].id);
  assert.equal((await call(handle, ctx(`${wrongPath}?chapter=未收录`, { cookie }))).body.total, 0);
  const end = await call(handle, ctx(`${wrongPath}?offset=1000`, { cookie }));
  assert.equal(end.body.total, 507);
  assert.equal(end.body.items.length, 0);
  assert.deepEqual((await call(handle, ctx(`${wrongPath}/stats`, { cookie }))).body, { user_id: a.body.user.id, total: 507, todo: 505 });
  for (const query of ['status=bad', 'reason=bad', 'subject=bad', 'limit=0', 'limit=101', 'offset=-1', 'offset=NaN', 'offset=1.5', 'offset=9007199254740992']) {
    assert.equal((await call(handle, ctx(`${wrongPath}?${query}`, { cookie }))).status, 400, query);
  }
});

test('模块10：公开投影仅五字段，公开与撤回立即改变后续请求的可见性', async () => {
  const { handle } = fixture();
  const a = await register(handle, uniqueName()), b = await register(handle, uniqueName());
  const ca = cookiePair(a), cb = cookiePair(b);
  const created = await newWrong(handle, ca, { my_answer: 'PRIVATE_ANSWER', note: 'PRIVATE_NOTE' });
  const path = `${wrongPath}/${created.body.item.id}`;
  assert.equal((await call(handle, ctx(`${wrongPath}/public`, { cookie: cb }))).body.total, 0);
  const publish = await call(handle, ctx(path, { method: 'PATCH', cookie: ca, body: { visibility: 'public', public_confirmed: true } }));
  assert.equal(publish.status, 200);
  const shared = await call(handle, ctx(`${wrongPath}/public`, { cookie: cb }));
  assert.equal(shared.body.total, 1);
  assert.deepEqual(Object.keys(shared.body.items[0]).sort(), ['subject', 'chapter', 'question', 'correct_answer', 'reason'].sort());
  assert.ok(!JSON.stringify(shared.body).includes('PRIVATE_'));
  assert.ok(!JSON.stringify(shared.body).includes(a.body.user.username));
  assert.equal((await call(handle, ctx(path, { cookie: cb }))).status, 404, '公开不开放私有详情');
  assert.equal((await call(handle, ctx(`${wrongPath}/public?subject=英语`, { cookie: cb }))).body.total, 0);
  assert.equal((await call(handle, ctx(`${wrongPath}/public?status=todo`, { cookie: cb }))).status, 400);
  assert.equal((await call(handle, ctx(path, { method: 'PATCH', cookie: ca, body: { visibility: 'private' } }))).status, 200);
  assert.equal((await call(handle, ctx(`${wrongPath}/public`, { cookie: cb }))).body.total, 0);
  assert.equal((await call(handle, ctx(path, { cookie: ca }))).body.item.my_answer, 'PRIVATE_ANSWER');
});

test('模块10：复习计数每次加一，并发条件更新不丢失，状态不自动变更', async () => {
  const { handle, db } = fixture();
  const cookie = cookiePair(await register(handle, uniqueName()));
  const created = await newWrong(handle, cookie);
  const path = `${wrongPath}/${created.body.item.id}`;
  const reviewed = await call(handle, ctx(`${path}/review`, { method: 'POST', cookie, body: { review_count: 99 } }));
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.item.review_count, 1);
  assert.equal(reviewed.body.item.status, 'todo');
  assert.ok(Number.isFinite(Date.parse(reviewed.body.item.last_reviewed_at)));
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => call(handle, ctx(`${path}/review`, { method: 'POST', cookie }))));
  assert.ok(concurrent.every((r) => r.status === 200));
  assert.equal(db.dump('wrong_questions')[0].review_count, 7);
  const marked = await call(handle, ctx(path, { method: 'PATCH', cookie, body: { status: 'done' } }));
  assert.equal(marked.body.item.review_count, 7);
  assert.equal((await call(handle, ctx(`${wrongPath}/stats`, { cookie }))).body.todo, 0);
});

test('模块10：删除真实移除记录并更新统计，其他用户不能删除', async () => {
  const { handle, db } = fixture();
  const a = await register(handle, uniqueName()), b = await register(handle, uniqueName());
  const ca = cookiePair(a), cb = cookiePair(b);
  const created = await newWrong(handle, ca);
  const path = `${wrongPath}/${created.body.item.id}`;
  assert.equal((await call(handle, ctx(path, { method: 'DELETE', cookie: cb }))).status, 404);
  assert.equal((await call(handle, ctx(path, { method: 'DELETE', cookie: ca }))).status, 200);
  assert.equal(db.dump('wrong_questions').length, 0);
  assert.equal((await call(handle, ctx(path, { cookie: ca }))).status, 404);
  assert.equal((await call(handle, ctx(path, { method: 'DELETE', cookie: ca }))).status, 404);
  assert.equal((await call(handle, ctx(`${wrongPath}/stats`, { cookie: ca }))).body.total, 0);
});

test('模块10：创建修改复习删除的响应丢失不重放，明确拒绝不落库', async () => {
  const { handle, db, control } = fixture();
  const cookie = cookiePair(await register(handle, uniqueName()));
  const countWrites = () => control.writes.filter((table) => table === 'wrong_questions').length;
  control.dropTable = 'wrong_questions';
  const beforeCreate = countWrites();
  assert.equal((await newWrong(handle, cookie)).body.error, 'wrong_question_unconfirmed');
  assert.equal(countWrites() - beforeCreate, 1);
  assert.equal(db.dump('wrong_questions').length, 1);
  const path = `${wrongPath}/${db.dump('wrong_questions')[0].id}`;
  for (const [target, method, body] of [[path, 'PATCH', { status: 'reviewing' }], [`${path}/review`, 'POST'], [path, 'DELETE']]) {
    control.dropTable = 'wrong_questions';
    const before = countWrites();
    const response = await call(handle, ctx(target, { cookie, method, body }));
    assert.equal(response.status, 503);
    assert.equal(response.body.error, 'wrong_question_unconfirmed');
    assert.equal(countWrites() - before, 1);
  }
  assert.equal(db.dump('wrong_questions').length, 0);
  control.rejectTable = 'wrong_questions';
  assert.equal((await newWrong(handle, cookie)).status, 503);
  assert.equal(db.dump('wrong_questions').length, 0);
});

test('模块10：计数缺失或数据库失败不可伪装为零', async () => {
  const { handle, db } = fixture();
  const cookie = cookiePair(await register(handle, uniqueName()));
  for (const fail of [false, true]) {
    const wrapped = { from(table) {
      const source = db.from(table);
      if (table !== 'wrong_questions') return source;
      return { ...source, select(...args) {
        const query = source.select(...args);
        const originalThen = query.then.bind(query);
        query.then = (resolve, reject) => originalThen((result) => resolve(fail ? { error: { code: 'missing_table' } } : { ...result, count: null }), reject);
        return query;
      } };
    } };
    const broken = createApplication({ db: wrapped, origin: PUBLIC_ORIGIN });
    for (const path of [wrongPath, `${wrongPath}/public`, `${wrongPath}/stats`]) {
      const result = await call(broken, ctx(path, { cookie }));
      assert.equal(result.status, 503);
      assert.equal(result.body.error, 'database_unavailable');
      assert.equal(result.body.total, undefined);
    }
  }
});

test('注册：规范化用户名、签发会话、只保存派生结果、资料默认为空', async () => {
  const { db, handle } = fixture();
  const created = await register(handle, '  Alpha_01  ');
  assert.equal(created.status, 201);
  assert.equal(created.body.user.username, 'alpha_01');
  assert.equal(created.body.user.role, 'student');
  assert.equal(created.body.user.display_name, null);
  assert.equal(created.body.user.grade, null);
  assert.deepEqual(created.body.user.subjects, []);

  const cookie = cookiePair(created);
  assert.ok(cookie && cookie.startsWith(`${SESSION_COOKIE}=`), '应签发会话 Cookie');
  assert.match(created.setCookie, /HttpOnly/);
  assert.match(created.setCookie, /Secure/);
  assert.match(created.setCookie, /SameSite=Lax/);
  assert.match(created.setCookie, /Path=\//);
  assert.ok(!/Domain=/i.test(created.setCookie), '__Host- Cookie 不能带 Domain');

  const users = db.dump('users');
  assert.equal(users.length, 1);
  assert.equal(users[0].password_iterations, PBKDF2_ITERATIONS);
  // 绝不保存明文口令，也不把口令写进会话表或限流表。
  const stored = JSON.stringify([...users, ...db.dump('sessions'), ...db.dump('auth_limiter')]);
  assert.ok(!stored.includes(PASSWORD), '数据库中不得出现明文口令');
  assert.ok(users[0].password_salt.length > 0);

  // 会话表只保存摘要：不出现明文令牌。
  const token = cookie.slice(SESSION_COOKIE.length + 1);
  assert.ok(!JSON.stringify(db.dump('sessions')).includes(token), '会话表不得保存明文令牌');
  assert.equal(db.dump('sessions')[0].token_digest, await sha256Hex(token));

  const who = await me(handle, cookie);
  assert.equal(who.status, 200);
  assert.deepEqual(who.body.user, created.body.user);
});

test('注册：中文用户名与选填资料', async () => {
  const { handle } = fixture();
  const created = await register(handle, '小明同学', PASSWORD, {
    display_name: '小明', grade: '高二', province: '河北', subjects: ['数学', '物理'],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.username, '小明同学');
  assert.equal(created.body.user.display_name, '小明');
  assert.equal(created.body.user.grade, '高二');
  assert.equal(created.body.user.province, '河北');
  assert.deepEqual(created.body.user.subjects, ['数学', '物理']);

  const bad = await register(handle, uniqueName(), PASSWORD, { grade: '大四' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_profile');
  const badSubjects = await register(handle, uniqueName(), PASSWORD, { subjects: ['数学', '奥数'] });
  assert.equal(badSubjects.status, 400);
});

test('注册：用户名唯一（大小写与空白变体并发只有一个成功）', async () => {
  const { db, handle } = fixture();
  const results = await Promise.all([
    register(handle, 'Bravo01'), register(handle, 'bravo01'),
    register(handle, ' BRAVO01 '), register(handle, 'Bravo01'),
  ]);
  assert.equal(results.filter((r) => r.status === 201).length, 1, '只能有一个注册成功');
  assert.equal(results.filter((r) => r.status === 409 && r.body.error === 'username_taken').length, 3);
  assert.equal(db.dump('users').filter((row) => row.username === 'bravo01').length, 1);
});

test('注册：用户名与口令策略', async () => {
  const { handle } = fixture();
  for (const bad of ['a', 'x'.repeat(21), '_leading', 'bad name', 'bad@name', '']) {
    const result = await register(handle, bad);
    assert.equal(result.status, 400, `用户名应被拒绝: ${JSON.stringify(bad)}`);
    assert.equal(result.body.error, 'invalid_username');
  }
  assert.equal((await register(handle, uniqueName(), 'short')).body.error, 'invalid_password');
  assert.equal((await register(handle, uniqueName(), 'x'.repeat(257))).body.error, 'invalid_password');
  // 恰好 8 个字符可以通过。
  assert.equal((await register(handle, uniqueName(), 'a'.repeat(8))).status, 201);
});

test('登录：未注册账号与错误口令返回相同错误码，成功后读取当前账号', async () => {
  const { handle } = fixture();
  const name = uniqueName();
  await register(handle, name);

  const unknown = await login(handle, uniqueName('ghost'));
  const wrong = await login(handle, name, `${PASSWORD}-wrong`);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(unknown.body, { error: 'invalid_credentials' });
  assert.deepEqual(wrong.body, { error: 'invalid_credentials' });

  const ok = await login(handle, name.toUpperCase());
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.username, name);
  assert.equal((await me(handle, cookiePair(ok))).body.user.username, name);
});

test('会话：缺失、过期、被撤销、被篡改都返回 401', async () => {
  const { db, handle } = fixture();
  const created = await register(handle, uniqueName());
  const cookie = cookiePair(created);
  const userId = created.body.user.id;

  const missing = await me(handle, null);
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, 'login_required');
  assert.equal(missing.setCookie, null, '未带 Cookie 时不应下发清除指令');

  const expiredToken = 'A'.repeat(43);
  await db.from('sessions').insertIfAbsent({
    token_digest: await sha256Hex(expiredToken), user_id: userId,
    created_at: new Date(Date.now() - SESSION_TTL_MS * 2).toISOString(),
    expires_at: new Date(Date.now() - 1000).toISOString(), revoked_at: null,
  }, { onConflict: 'token_digest' }).select('token_digest');
  const expired = await me(handle, `${SESSION_COOKIE}=${expiredToken}`);
  assert.equal(expired.status, 401);
  assert.match(expired.setCookie ?? '', /Max-Age=0/, '失效会话应顺手清除 Cookie');

  assert.equal((await me(handle, `${SESSION_COOKIE}=${'B'.repeat(43)}`)).status, 401);

  const logout = await call(handle, ctx('/api/logout', { method: 'POST', cookie }));
  assert.equal(logout.status, 200);
  assert.match(logout.setCookie ?? '', /Max-Age=0/);
  assert.ok(db.dump('sessions').some((row) => row.revoked_at != null), '退出应撤销数据库中的会话');
  assert.equal((await me(handle, cookie)).status, 401, '撤销后旧 Cookie 不得再通过校验');
});

test('CSRF：跨来源的不安全方法被拒绝，即使带着有效会话', async () => {
  const { handle } = fixture();
  const cookie = cookiePair(await register(handle, uniqueName()));

  const foreignLogout = await call(handle, ctx('/api/logout', { method: 'POST', cookie, origin: 'https://evil.test' }));
  assert.equal(foreignLogout.status, 403);
  assert.equal(foreignLogout.body.error, 'origin_forbidden');

  const foreignProfile = await call(handle, ctx('/api/profile', {
    method: 'POST', cookie, origin: 'https://evil.test', body: { grade: '高三' },
  }));
  assert.equal(foreignProfile.status, 403);

  assert.equal((await call(handle, ctx('/api/logout', { method: 'POST', cookie, origin: null }))).status, 403);
  assert.equal((await me(handle, cookie)).status, 200, '跨来源请求没有产生副作用');
});

test('资料：归属来自会话，A/B 互相隔离，未登录拒绝', async () => {
  const { db, handle } = fixture();
  const a = await register(handle, uniqueName('alpha'));
  const b = await register(handle, uniqueName('bravo'));
  const cookieA = cookiePair(a), cookieB = cookiePair(b);

  const updated = await call(handle, ctx('/api/profile', {
    method: 'POST', cookie: cookieA,
    body: { display_name: '甲同学', grade: '高一', province: '河南', subjects: ['英语'], id: b.body.user.id },
  }));
  assert.equal(updated.status, 200);
  assert.equal(updated.body.user.id, a.body.user.id, '请求体中的 id 不得改变归属');
  assert.equal(updated.body.user.grade, '高一');

  const bMe = await me(handle, cookieB);
  assert.equal(bMe.body.user.grade, null, 'B 的资料不受 A 的写入影响');
  assert.equal(db.dump('users').find((u) => u.id === b.body.user.id).display_name, null);

  assert.equal((await call(handle, ctx('/api/profile', { method: 'POST', body: { grade: '高一' } }))).status, 401);
  assert.equal((await call(handle, ctx('/api/profile', { method: 'POST', cookie: cookieA, body: { province: '火星' } }))).status, 400);

  // 清空资料：空值规范为 null。
  const cleared = await call(handle, ctx('/api/profile', { method: 'POST', cookie: cookieA, body: { grade: '', subjects: [] } }));
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.user.grade, null);
  assert.deepEqual(cleared.body.user.subjects, []);
});

test('修改密码：旧口令校验、新口令生效、错误旧口令拒绝', async () => {
  const { handle } = fixture();
  const name = uniqueName();
  const cookie = cookiePair(await register(handle, name));
  const newPassword = `np-${crypto.randomUUID()}`;

  const wrong = await call(handle, ctx('/api/password', {
    method: 'POST', cookie, body: { current_password: 'wrong-current', new_password: newPassword },
  }));
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, 'invalid_credentials');

  const ok = await call(handle, ctx('/api/password', {
    method: 'POST', cookie, body: { current_password: PASSWORD, new_password: newPassword },
  }));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true });

  assert.equal((await login(handle, name, PASSWORD)).status, 401, '旧口令不得再登录');
  assert.equal((await login(handle, name, newPassword)).status, 200, '新口令可以登录');
  assert.equal((await call(handle, ctx('/api/password', { method: 'POST', body: {} }))).status, 401);
});

test('限流：连续失败（含不存在的账号）在窗口内被封顶', async () => {
  const { db, handle } = fixture();
  const name = uniqueName();
  await register(handle, name);

  const statuses = [];
  for (let index = 0; index < LIMITS.login.maxAttempts; index += 1) {
    statuses.push((await login(handle, name, `${PASSWORD}-bad`)).status);
  }
  assert.deepEqual(statuses, Array(LIMITS.login.maxAttempts).fill(401));
  const blocked = await login(handle, name, PASSWORD);
  assert.equal(blocked.status, 429, '达到上限后即使口令正确也应被限流');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);

  const ghost = uniqueName('ghost');
  const ghostStatuses = [];
  for (let index = 0; index < LIMITS.login.maxAttempts + 1; index += 1) {
    ghostStatuses.push((await login(handle, ghost, PASSWORD)).status);
  }
  assert.equal(ghostStatuses.at(-1), 429);
  assert.ok(db.dump('auth_limiter').some((row) => row.key === `login:${ghost}`));
});

test('限流：修改密码尝试同样有上限', async () => {
  const { handle } = fixture();
  const name = uniqueName();
  const cookie = cookiePair(await register(handle, name));
  const statuses = [];
  for (let index = 0; index < LIMITS.password.maxAttempts + 1; index += 1) {
    statuses.push((await call(handle, ctx('/api/password', {
      method: 'POST', cookie, body: { current_password: 'bad', new_password: `np-${crypto.randomUUID()}` },
    }))).status);
  }
  assert.equal(statuses.at(-1), 429);
});

test('写入结果未知：不重放、不谎报成功', async () => {
  const { control, db, handle } = fixture();
  const name = uniqueName();
  await register(handle, name);

  const sessionsBefore = db.dump('sessions').length;
  const writeCount = () => control.writes.filter((table) => table === 'sessions').length;
  let attempts = writeCount();

  control.dropTable = 'sessions';
  const uncertain = await login(handle, name);
  assert.equal(uncertain.status, 503);
  assert.equal(uncertain.body.error, 'service_unavailable');
  assert.equal(cookiePair(uncertain), null, '结果未知时不得下发会话 Cookie');
  assert.equal(db.dump('sessions').length, sessionsBefore + 1, '写入已提交（结果未知≠被拒绝）');
  assert.equal(writeCount() - attempts, 1, '结果未知时写入只能尝试一次');
  attempts = writeCount();

  control.rejectTable = 'sessions';
  const rejected = await login(handle, name);
  assert.equal(rejected.status, 503);
  assert.equal(cookiePair(rejected), null);
  assert.equal(db.dump('sessions').length, sessionsBefore + 1, '被拒绝的写入不得落库');
  assert.equal(writeCount() - attempts, 1, '被拒绝时写入也只能尝试一次');
});

test('响应头与路由：no-store、未知路径、错误方法', async () => {
  const { handle } = fixture();
  const health = await call(handle, ctx('/api/health'));
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { ok: true });
  assert.match(health.headers.get('cache-control') ?? '', /no-store/);
  assert.match(health.headers.get('referrer-policy') ?? '', /no-referrer/);

  assert.equal((await call(handle, ctx('/api/health', { logical: true }))).status, 200);
  assert.equal((await call(handle, ctx('/api/unknown'))).status, 404);
  assert.equal((await call(handle, ctx('/api/me', { method: 'POST', body: {} }))).status, 405);
  assert.equal((await call(handle, ctx('/api/login', { method: 'POST' }))).status, 400);
});

test('专业目录：空库、门类筛选与关键词搜索', async () => {
  const { db, handle } = fixture();
  const empty = await call(handle, ctx('/api/majors'));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { total: 0, items: [] });

  await db.from('majors').insertIfAbsent({
    code: '080901', name: '计算机科学与技术', category: '工学', years: 4, degree: '学士', source: '测试来源', note: null, created_at: new Date().toISOString(),
  }, { onConflict: 'code' });
  await db.from('majors').insertIfAbsent({
    code: '050101', name: '汉语言文学', category: '文学', years: 4, degree: '学士', source: '测试来源', note: null, created_at: new Date().toISOString(),
  }, { onConflict: 'code' });

  const all = await call(handle, ctx('/api/majors'));
  assert.equal(all.body.total, 2);
  const byCategory = await call(handle, ctx('/api/majors?category=%E5%B7%A5%E5%AD%A6'));
  assert.equal(byCategory.body.total, 1);
  assert.equal(byCategory.body.items[0].code, '080901');
  const byQ = await call(handle, ctx('/api/majors?q=%E6%B1%89%E8%AF%AD'));
  assert.equal(byQ.body.total, 1);
  assert.equal((await call(handle, ctx('/api/majors?category=不存在'))).status, 400);
});
// ---- 模块4：学习资料库 ----
// 种子数据只存在于测试用的假数据库中，不进入生产库。

const RESOURCE_BODY = {
  title: '高中数学函数专题讲义',
  grade: '高一',
  subject: '数学',
  type: '笔记',
  source_url: 'https://example.edu.cn/math/functions',
  source_name: '示例出版社官网',
  description: '函数单调性与奇偶性讲义',
  copyright_confirmed: true,
};

async function seedResource(db, ownerId, overrides = {}) {
  const id = crypto.randomUUID();
  await db.from('resources').insertIfAbsent({
    id,
    owner_id: ownerId,
    title: '种子资料',
    grade: '高二',
    subject: '英语',
    type: '试卷',
    source_url: 'https://example.edu.cn/seed',
    source_name: '种子来源',
    description: null,
    file_name: null,
    file_size: null,
    mime: null,
    storage_key: null,
    copyright_confirmed: true,
    created_at: new Date().toISOString(),
    ...overrides,
  }, { onConflict: 'id' });
  return id;
}

test('资料列表：空库、搜索、筛选与分页', async () => {
  const { handle } = fixture();
  const empty = await call(handle, ctx('/api/resources'));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { total: 0, items: [] });

  const { db, handle: h2 } = fixture();
  const idA = await seedResource(db, null, { title: '数学函数讲义', subject: '数学', type: '笔记' });
  await seedResource(db, null, { title: '英语阅读真题', subject: '英语', type: '真题' });
  void idA;
  const all = await call(h2, ctx('/api/resources'));
  assert.equal(all.body.total, 2);
  const byQ = await call(h2, ctx('/api/resources?q=%E5%87%BD%E6%95%B0'));
  assert.equal(byQ.body.total, 1);
  const bySubject = await call(h2, ctx('/api/resources?subject=%E8%8B%B1%E8%AF%AD'));
  assert.equal(bySubject.body.total, 1);
  const byType = await call(h2, ctx('/api/resources?type=%E7%9C%9F%E9%A2%98'));
  assert.equal(byType.body.total, 1);
  const page = await call(h2, ctx('/api/resources?limit=1&offset=1'));
  assert.equal(page.body.items.length, 1);
  assert.equal((await call(h2, ctx('/api/resources?grade=%E5%A4%A7%E4%B8%80'))).status, 400);
  assert.equal((await call(h2, ctx('/api/resources?limit=0'))).status, 400);
});

test('资料登记：校验、归属来自会话、文件字段被拒绝', async () => {
  const { handle } = fixture();
  assert.equal((await call(handle, ctx('/api/resources', { method: 'POST', body: RESOURCE_BODY }))).status, 401);

  const name = uniqueName();
  const cookie = cookiePair(await register(handle, name));
  const meRes = await me(handle, cookie);
  const userId = meRes.body.user.id;

  const badCases = [
    [{ ...RESOURCE_BODY, title: '短' }, 'invalid_resource'],
    [{ ...RESOURCE_BODY, type: '视频' }, 'invalid_resource'],
    [{ ...RESOURCE_BODY, source_url: 'http://example.edu.cn/x' }, 'invalid_resource'],
    [{ ...RESOURCE_BODY, source_url: 'not-a-url' }, 'invalid_resource'],
    [{ ...RESOURCE_BODY, copyright_confirmed: false }, 'invalid_resource'],
    [{ ...RESOURCE_BODY, file_name: 'a.pdf', file_size: 123, mime: 'application/pdf' }, 'invalid_resource'],
  ];
  for (const [body, code] of badCases) {
    const res = await call(handle, ctx('/api/resources', { method: 'POST', cookie, body }));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error, code);
  }

  const created = await call(handle, ctx('/api/resources', {
    method: 'POST', cookie, body: { ...RESOURCE_BODY, owner_id: '00000000-0000-0000-0000-000000000000' },
  }));
  assert.equal(created.status, 201);
  assert.equal(created.body.resource.owner_id, userId, '归属只来自会话，浏览器提交的 owner_id 必须被忽略');
  assert.equal(created.body.resource.file_name, null);

  const mine = await call(handle, ctx('/api/resources?mine=1', { cookie }));
  assert.equal(mine.body.total, 1);
  assert.equal((await call(handle, ctx('/api/resources?mine=1'))).status, 401);
});

test('资料详情：公开读、未知 id 404', async () => {
  const { db, handle } = fixture();
  const id = await seedResource(db, null);
  const detail = await call(handle, ctx(`/api/resources/${id}`));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.resource.title, '种子资料');
  assert.equal(detail.body.resource.favorited, false);
  assert.equal((await call(handle, ctx('/api/resources/00000000-0000-0000-0000-000000000000'))).status, 404);
  assert.equal((await call(handle, ctx('/api/resources/not-a-uuid'))).status, 404);
});

test('收藏：增删、再收藏、A/B 隔离', async () => {
  const { db, handle } = fixture();
  const id = await seedResource(db, null);
  assert.equal((await call(handle, ctx(`/api/resources/${id}/favorite`, { method: 'POST' }))).status, 401);

  const cookieA = cookiePair(await register(handle, uniqueName()));
  const cookieB = cookiePair(await register(handle, uniqueName()));

  assert.equal((await call(handle, ctx(`/api/resources/${id}/favorite`, { method: 'POST', body: {} }))).status, 401);
  const fav = await call(handle, ctx(`/api/resources/${id}/favorite`, { method: 'POST', cookie: cookieA }));
  assert.equal(fav.status, 200);
  assert.deepEqual(fav.body, { favorited: true });

  // 列表接口标注当前会话的收藏状态（修复：列表曾始终显示未收藏）。
  const listA = await call(handle, ctx('/api/resources', { cookie: cookieA }));
  assert.equal(listA.body.items.find((item) => item.id === id)?.favorited, true, 'A 的列表应标注已收藏');
  const listB = await call(handle, ctx('/api/resources', { cookie: cookieB }));
  assert.equal(listB.body.items.find((item) => item.id === id)?.favorited, false, 'B 的列表不标注 A 的收藏');
  const listAnon = await call(handle, ctx('/api/resources'));
  assert.equal(listAnon.body.items.find((item) => item.id === id)?.favorited, false, '匿名列表不标注收藏');

  const favsA = await call(handle, ctx('/api/favorites', { cookie: cookieA }));
  assert.equal(favsA.body.total, 1);
  assert.equal(favsA.body.items[0].id, id);
  const favsB = await call(handle, ctx('/api/favorites', { cookie: cookieB }));
  assert.equal(favsB.body.total, 0, 'B 看不到 A 的收藏');

  const detailB = await call(handle, ctx(`/api/resources/${id}`, { cookie: cookieB }));
  assert.equal(detailB.body.resource.favorited, false);

  // B 取消 A 的收藏：只改自己的记录，A 的收藏不受影响。
  const unFavB = await call(handle, ctx(`/api/resources/${id}/unfavorite`, { method: 'POST', cookie: cookieB }));
  assert.equal(unFavB.status, 200);
  assert.equal((await call(handle, ctx('/api/favorites', { cookie: cookieA }))).body.total, 1);

  const unFavA = await call(handle, ctx(`/api/resources/${id}/unfavorite`, { method: 'POST', cookie: cookieA }));
  assert.deepEqual(unFavA.body, { favorited: false });
  assert.equal((await call(handle, ctx('/api/favorites', { cookie: cookieA }))).body.total, 0);

  // 再收藏：撤销标记清除，重新生效。
  await call(handle, ctx(`/api/resources/${id}/favorite`, { method: 'POST', cookie: cookieA }));
  assert.equal((await call(handle, ctx('/api/favorites', { cookie: cookieA }))).body.total, 1);

  assert.equal((await call(handle, ctx('/api/resources/00000000-0000-0000-0000-000000000000/favorite', { method: 'POST', cookie: cookieA }))).status, 404);
});
// ---- 模块6：兴趣测评（RIASEC 固定规则计分） ----

test('测评保存：未登录拒绝、非法答案 400、后端按固定规则重算分数', async () => {
  const { handle } = fixture();
  assert.equal((await call(handle, ctx('/api/assessments', { method: 'POST', body: { answers: Array(24).fill(3) } }))).status, 401);
  assert.equal((await call(handle, ctx('/api/assessments'))).status, 401);

  const cookie = cookiePair(await register(handle, uniqueName()));
  const badAnswers = [
    Array(23).fill(3),
    Array(25).fill(3),
    Array(24).fill(0),
    Array(24).fill(6),
    [...Array(23).fill(3), 2.5],
    [...Array(23).fill(3), '3'],
    'not-an-array',
    null,
  ];
  for (const answers of badAnswers) {
    const res = await call(handle, ctx('/api/assessments', { method: 'POST', cookie, body: { answers } }));
    assert.equal(res.status, 400, JSON.stringify(answers));
    assert.equal(res.body.error, 'invalid_assessment');
  }

  // R 维度位置（每 6 道第 1 道）全 5 分，其余全 1 分：R 应为 100，其余为 0。
  const rOnly = Array.from({ length: 24 }, (_, i) => (i % 6 === 0 ? 5 : 1));
  const saved = await call(handle, ctx('/api/assessments', { method: 'POST', cookie, body: { answers: rOnly } }));
  assert.equal(saved.status, 201);
  assert.deepEqual(saved.body.assessment.scores, { R: 100, I: 0, A: 0, S: 0, E: 0, C: 0 });
  assert.equal(saved.body.assessment.top_types[0], 'R');
  assert.ok(saved.body.assessment.id);

  // 混合答案：5/4/3/2/1 循环（24 道）→ R=63、I=38、A=44、S=50、E=56、C=63；
  // R 与 C 并列最高时按 R/I/A/S/E/C 固定顺序排。
  const mixed = [5, 4, 3, 2, 1, 5, 4, 3, 2, 1, 5, 4, 3, 2, 1, 5, 4, 3, 2, 1, 5, 4, 3, 2];
  const savedMixed = await call(handle, ctx('/api/assessments', { method: 'POST', cookie, body: { answers: mixed } }));
  assert.deepEqual(savedMixed.body.assessment.scores, { R: 63, I: 38, A: 44, S: 50, E: 56, C: 63 });
  assert.deepEqual(savedMixed.body.assessment.top_types, ['R', 'C']);
});

test('24 题测评保存（POST /api/assessments）：只写 assessment_results、归属来自会话、并入个人历史', async () => {
  const { db, handle } = fixture();
  const cookieA = cookiePair(await register(handle, uniqueName()));
  const cookieB = cookiePair(await register(handle, uniqueName()));
  const saved = await call(handle, ctx('/api/assessments', { method: 'POST', cookie: cookieA, body: { answers: Array(24).fill(3) } }));
  assert.equal(saved.status, 201);

  const dump = db.dump('assessment_results');
  assert.equal(dump.length, 1);
  assert.deepEqual(JSON.parse(dump[0].scores), { R: 50, I: 50, A: 50, S: 50, E: 50, C: 50 });
  assert.equal(dump[0].user_id, (await me(handle, cookieA)).body.user.id);
  // GET 历史合并两张表：24 题记录带 version=24 出现在个人历史，B 看不到。
  const listA = await call(handle, ctx('/api/assessments', { cookie: cookieA }));
  assert.equal(listA.body.total, 1);
  assert.equal(listA.body.items[0].kind, 'riasec');
  assert.equal(listA.body.items[0].version, 24);
  assert.deepEqual(listA.body.items[0].scores, { R: 50, I: 50, A: 50, S: 50, E: 50, C: 50 });
  assert.deepEqual(listA.body.items[0].top_types, ['R', 'I']);
  const listB = await call(handle, ctx('/api/assessments', { cookie: cookieB }));
  assert.equal(listB.body.total, 0, 'B 看不到 A 的测评记录');
});

test('前后端题目维度顺序一致（防漂移）', async () => {
  const fs = await import('node:fs');
  const { QUESTION_DIMENSIONS } = await import('../functions/assessment.mjs');
  const frontend = fs.readFileSync(new URL('../src/lib/assessment.ts', import.meta.url), 'utf-8');
  const found = [...frontend.matchAll(/dimension:\s*"([RIASEC])"/g)].map((m) => m[1]);
  assert.equal(found.length, 24);
  assert.deepEqual(found, QUESTION_DIMENSIONS);
});
// ---- 模块3：首页统计见下方「真实计数，空数据与触顶如实显示」测试 ----

// tick：测评重测需要 created_at 递增，分开两次提交。
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// ---- 霍兰德兴趣测评（30 题三档版，与 24 题 5 级量表版并存，用户自选） ----
import { QUESTIONS, computeResult, validateAnswers } from '../functions/assessment30.mjs';

const allAnswers = (value) => Object.fromEntries(QUESTIONS.map((q) => [q.id, value]));
const dimAnswers = (dim, value) => Object.fromEntries(QUESTIONS.map((q) => [q.id, q.dim === dim ? value : 0]));
const submit = (handle, cookie, answers) => call(handle, ctx('/api/assessment/submit', { method: 'POST', cookie, body: { answers } }));
const latest = (handle, cookie) => call(handle, ctx('/api/assessment/latest', { cookie }));

test('测评：题库与计分规则固定（满分、同分顺序、非法答案拒绝）', async () => {
  assert.equal(QUESTIONS.length, 30);
  for (const dim of ['R', 'I', 'A', 'S', 'E', 'C']) {
    assert.equal(QUESTIONS.filter((q) => q.dim === dim).length, 5);
  }
  const full = computeResult(dimAnswers('I', 2));
  assert.equal(full.scores.I, 10);
  assert.equal(full.scores.R, 0);
  assert.equal(full.code[0], 'I');
  // 全部同分：按 R→I→A→S→E→C 固定顺序取前三。
  assert.equal(computeResult(allAnswers(1)).code, 'RIA');
  assert.equal(computeResult(allAnswers(0)).code, 'RIA');

  const { handle } = fixture();
  const cookie = cookiePair(await register(handle, uniqueName()));
  const bad = [
    undefined,
    {},
    { ...allAnswers(1), extra: 1 },
    (() => { const a = allAnswers(1); delete a.r1; return a; })(),
    { ...allAnswers(1), r1: 3 },
    { ...allAnswers(1), r1: -1 },
    { ...allAnswers(1), r1: 1.5 },
    { ...allAnswers(1), r1: '2' },
  ];
  for (const answers of bad) {
    const result = await submit(handle, cookie, answers);
    assert.equal(result.status, 400, `非法答案应被拒绝: ${JSON.stringify(answers)?.slice(0, 60)}`);
    assert.equal(result.body.error, 'invalid_answers');
  }
  assert.throws(() => validateAnswers({ answers: [] }), /invalid_answers/);
});

test('测评：登录门槛、提交保存、latest 读取与重新测评', async () => {
  const { db, handle } = fixture();
  assert.equal((await call(handle, ctx('/api/assessment/questions'))).status, 401);
  assert.equal((await latest(handle, null)).status, 401);
  assert.equal((await submit(handle, null, allAnswers(1))).status, 401);

  const cookie = cookiePair(await register(handle, uniqueName()));
  const questions = await call(handle, ctx('/api/assessment/questions', { cookie }));
  assert.equal(questions.status, 200);
  assert.equal(questions.body.questions.length, 30);
  assert.deepEqual(questions.body.options.map((o) => o.value), [0, 1, 2]);
  assert.ok(!('dim' in questions.body.questions[0]), '题库接口不暴露维度归属');
  assert.equal((await latest(handle, cookie)).body.result, null);

  const first = await submit(handle, cookie, dimAnswers('A', 2));
  assert.equal(first.status, 201);
  assert.equal(first.body.result.code[0], 'A');
  assert.equal(first.body.result.scores.A, 10);
  assert.equal(first.body.result.top.length, 3);
  assert.ok(first.body.result.dimensions.every((d) => Array.isArray(d.majors) && Array.isArray(d.careers)));

  await tick();
  const second = await submit(handle, cookie, dimAnswers('S', 2));
  assert.equal(second.status, 201);
  const current = await latest(handle, cookie);
  assert.equal(current.body.result.id, second.body.result.id, '重新测评后 latest 应为新记录');
  assert.equal(current.body.result.code[0], 'S');
  assert.equal(db.dump('assessments').length, 2, '历史保留，不覆盖');

  // 错误方法与跨来源 CSRF。
  assert.equal((await call(handle, ctx('/api/assessment/submit', { cookie }))).status, 405);
  assert.equal((await call(handle, ctx('/api/assessment/latest', { method: 'POST', cookie, body: {} }))).status, 405);
  assert.equal((await call(handle, ctx('/api/assessment/submit', { method: 'POST', cookie, origin: 'https://evil.test', body: { answers: allAnswers(1) } }))).status, 403);
});

test('测评：归属来自会话，A/B 互相隔离；写入结果未知不重放', async () => {
  const { control, db, handle } = fixture();
  const a = await register(handle, uniqueName('alpha'));
  const b = await register(handle, uniqueName('bravo'));
  const cookieA = cookiePair(a), cookieB = cookiePair(b);

  const created = await submit(handle, cookieA, dimAnswers('E', 2));
  assert.equal(created.status, 201);
  assert.equal((await latest(handle, cookieB)).body.result, null, 'B 不得看到 A 的测评结果');
  assert.equal(db.dump('assessments')[0].user_id, a.body.user.id);

  const writesBefore = control.writes.filter((t) => t === 'assessments').length;
  await tick();
  control.dropTable = 'assessments';
  const uncertain = await submit(handle, cookieA, allAnswers(2));
  assert.equal(uncertain.status, 503);
  assert.equal(uncertain.body.error, 'assessment_unconfirmed');
  assert.equal(db.dump('assessments').length, 2, '写入已提交但结果未知');
  assert.equal(control.writes.filter((t) => t === 'assessments').length - writesBefore, 1, '结果未知时不得重放');
  // 刷新后 latest 应能看到已提交的那次结果。
  assert.equal((await latest(handle, cookieA)).body.result.code, 'RIA');
});

// ---- 模块6扩展：MBTI 风格性格倾向测评（简化版，固定规则计分） ----
import {
  DICHOTOMIES, QUESTIONS as MBTI_QUESTIONS, TYPES,
  computeResult as computeMbti, validateAnswers as validateMbtiAnswers,
} from '../functions/mbti.mjs';

const mbtiAll = (value) => Object.fromEntries(MBTI_QUESTIONS.map((q) => [q.id, value]));
const mbtiSubmit = (handle, cookie, answers) => call(handle, ctx('/api/mbti/submit', { method: 'POST', cookie, body: { answers } }));
const mbtiLatest = (handle, cookie) => call(handle, ctx('/api/mbti/latest', { cookie }));

test('MBTI：题库与计分规则固定（28 题、每维度 7 票、非法答案拒绝）', async () => {
  assert.equal(MBTI_QUESTIONS.length, 28);
  for (const dichotomy of DICHOTOMIES) {
    assert.equal(MBTI_QUESTIONS.filter((q) => q.dim === dichotomy.key).length, 7);
  }
  assert.equal(Object.keys(TYPES).length, 16);

  // 全选 A：四个维度都取第一个字母 → ESTJ；全选 B → INFP。
  const allA = computeMbti(mbtiAll(0));
  assert.equal(allA.code, 'ESTJ');
  assert.deepEqual(allA.scores, { E: 7, I: 0, S: 7, N: 0, T: 7, F: 0, J: 7, P: 0 });
  assert.equal(computeMbti(mbtiAll(1)).code, 'INFP');
  // 混合：E/I 全 B、S/N 全 A、T/F 全 B、J/P 全 A → ISFJ。
  const mixedValues = { EI: 1, SN: 0, TF: 1, JP: 0 };
  const mixed = Object.fromEntries(MBTI_QUESTIONS.map((q) => [q.id, mixedValues[q.dim]]));
  assert.equal(computeMbti(mixed).code, 'ISFJ');

  const { handle } = fixture();
  const cookie = cookiePair(await register(handle, uniqueName()));
  const bad = [
    undefined,
    {},
    { ...mbtiAll(0), extra: 1 },
    (() => { const a = mbtiAll(0); delete a.ei1; return a; })(),
    { ...mbtiAll(0), ei1: 2 },
    { ...mbtiAll(0), ei1: -1 },
    { ...mbtiAll(0), ei1: 0.5 },
    { ...mbtiAll(0), ei1: '1' },
  ];
  for (const answers of bad) {
    const result = await mbtiSubmit(handle, cookie, answers);
    assert.equal(result.status, 400, `非法答案应被拒绝: ${JSON.stringify(answers)?.slice(0, 60)}`);
    assert.equal(result.body.error, 'invalid_answers');
  }
  assert.throws(() => validateMbtiAnswers({ answers: [] }), /invalid_answers/);
});

test('MBTI：登录门槛、提交保存、latest 读取、重新测评与 RIASEC 互不干扰', async () => {
  const { db, handle } = fixture();
  assert.equal((await call(handle, ctx('/api/mbti/questions'))).status, 401);
  assert.equal((await mbtiLatest(handle, null)).status, 401);
  assert.equal((await mbtiSubmit(handle, null, mbtiAll(0))).status, 401);

  const cookie = cookiePair(await register(handle, uniqueName()));
  const questions = await call(handle, ctx('/api/mbti/questions', { cookie }));
  assert.equal(questions.status, 200);
  assert.equal(questions.body.questions.length, 28);
  assert.ok(questions.body.questions.every((q) => typeof q.a === 'string' && typeof q.b === 'string'));
  assert.ok(!('dim' in questions.body.questions[0]), '题库接口不暴露维度归属');
  assert.equal((await mbtiLatest(handle, cookie)).body.result, null);

  const first = await mbtiSubmit(handle, cookie, mbtiAll(0));
  assert.equal(first.status, 201);
  assert.equal(first.body.result.code, 'ESTJ');
  assert.equal(first.body.result.type.name, TYPES.ESTJ.name);
  assert.equal(first.body.result.dichotomies.length, 4);
  assert.ok(first.body.result.dichotomies.every((d) => d.poles.length === 2 && d.poles.every((p) => typeof p.count === 'number')));

  await tick();
  const second = await mbtiSubmit(handle, cookie, mbtiAll(1));
  assert.equal(second.status, 201);
  assert.equal(second.body.result.code, 'INFP');
  const current = await mbtiLatest(handle, cookie);
  assert.equal(current.body.result.id, second.body.result.id, '重新测评后 latest 应为新记录');
  assert.equal(db.dump('assessments').length, 2, '历史保留，不覆盖');
  assert.ok(db.dump('assessments').every((row) => row.kind === 'mbti'));

  // 同一账号再做霍兰德（24 题 5 级量表，写 assessment_results 表）：两种测评互不干扰。
  const riasec = await call(handle, ctx('/api/assessments', { method: 'POST', cookie, body: { answers: Array(24).fill(3) } }));
  assert.equal(riasec.status, 201);
  assert.equal((await mbtiLatest(handle, cookie)).body.result.code, 'INFP');
  assert.equal(db.dump('assessments').length, 2, '霍兰德记录不进 assessments 表');
  assert.equal(db.dump('assessment_results').length, 1);

  // 错误方法与跨来源 CSRF。
  assert.equal((await call(handle, ctx('/api/mbti/submit', { cookie }))).status, 405);
  assert.equal((await call(handle, ctx('/api/mbti/latest', { method: 'POST', cookie, body: {} }))).status, 405);
  assert.equal((await call(handle, ctx('/api/mbti/questions', { method: 'POST', cookie, body: {} }))).status, 405);
  assert.equal((await call(handle, ctx('/api/mbti/submit', { method: 'POST', cookie, origin: 'https://evil.test', body: { answers: mbtiAll(0) } }))).status, 403);
});

test('MBTI：归属来自会话，A/B 互相隔离；写入结果未知不重放', async () => {
  const { control, db, handle } = fixture();
  const a = await register(handle, uniqueName('alpha'));
  const b = await register(handle, uniqueName('bravo'));
  const cookieA = cookiePair(a), cookieB = cookiePair(b);

  const created = await mbtiSubmit(handle, cookieA, mbtiAll(1));
  assert.equal(created.status, 201);
  assert.equal((await mbtiLatest(handle, cookieB)).body.result, null, 'B 不得看到 A 的测评结果');
  assert.equal(db.dump('assessments')[0].user_id, a.body.user.id);
  assert.equal(db.dump('assessments')[0].kind, 'mbti');

  const writesBefore = control.writes.filter((t) => t === 'assessments').length;
  await tick();
  control.dropTable = 'assessments';
  const uncertain = await mbtiSubmit(handle, cookieA, mbtiAll(0));
  assert.equal(uncertain.status, 503);
  assert.equal(uncertain.body.error, 'assessment_unconfirmed');
  assert.equal(db.dump('assessments').length, 2, '写入已提交但结果未知');
  assert.equal(control.writes.filter((t) => t === 'assessments').length - writesBefore, 1, '结果未知时不得重放');
  // 刷新后 latest 应能看到已提交的那次结果。
  assert.equal((await mbtiLatest(handle, cookieA)).body.result.code, 'ESTJ');
});


// ===== 模块5：高校与录取数据（匿名查询 + 管理员导入）=====
const UNI_SOURCE = '河南省阳光高考信息平台（河南省教育厅）《往年参考 - 清华大学 - 录取分数查询》；整理日期：2026-11-18';
const UNIVERSITY_ROW = { code: '10003', name: '清华大学', province: null, city: null, type: null, level: null, tags: null, website: null, source: UNI_SOURCE, note: null };
const UNIVERSITY_ROW2 = { code: '10001', name: '北京大学', province: null, city: null, type: null, level: null, tags: null, website: null, source: UNI_SOURCE, note: null };
const SCORE_ROW = { university_code: '10003', school_name: '清华大学', province: '河南', year: 2025, category: '物理类', batch: '本科批', subject_requirement: null, min_score: '700', min_rank: 108, admitted_count: null, source: UNI_SOURCE, note: '按该校本科批各专业最低分取最低值' };
const SCORE_DECIMAL = { ...SCORE_ROW, category: '历史类', batch: '艺术本科批', min_score: '339.75', min_rank: null, note: '艺术类综合分' };
const PLAN_ROW = { university_code: '00031', school_name: '清华大学', province: '河南', year: 2025, major_code: null, major_name: '工科试验班', batch: '本科批', subject_requirement: '物理+化学', plan_count: 5, tuition: 5000, source: UNI_SOURCE, note: '办学地点：北京' };
const PLAN_ROW2 = { ...PLAN_ROW, note: '办学地点：深圳' };
const RUN_ID = 'a'.repeat(64);

async function adminFixture() {
  const f = fixture();
  const reg = await register(f.handle, uniqueName('admin'));
  await f.db.from('users').update({ role: 'admin' }).eq('id', reg.body.user.id);
  return { ...f, cookie: cookiePair(reg), adminId: reg.body.user.id };
}
const postImport = (handle, cookie, body) => call(handle, ctx('/api/admin/import', { method: 'POST', cookie, body }));
const postMeta = (handle, cookie, body) => call(handle, ctx('/api/admin/meta', { method: 'POST', cookie, body }));
const chunk = (table, rows, chunkIndex = 0) => ({ table, run_id: RUN_ID, chunk_index: chunkIndex, rows });

test('模块5：匿名查询空库返回空列表；未知院校代码 404', async () => {
  const { handle } = fixture();
  const list = await call(handle, ctx('/api/universities'));
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items, []);
  assert.equal(list.body.total, 0);
  assert.deepEqual(list.body.counts, { universities: 0, admission_scores: 0, enrollment_plans: 0 });
  const detail = await call(handle, ctx('/api/universities/99999'));
  assert.equal(detail.status, 404);
  assert.equal(detail.body.error, 'not_found');
});

test('模块5：导入需管理员；匿名 401、学生 403、admin 200', async () => {
  const { handle, cookie } = await adminFixture();
  const anon = await postImport(handle, null, chunk('universities', [UNIVERSITY_ROW]));
  assert.equal(anon.status, 401);
  const student = await register(handle, uniqueName('stu'));
  const forbidden = await postImport(handle, cookiePair(student), chunk('universities', [UNIVERSITY_ROW]));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error, 'admin_required');
  const ok = await postImport(handle, cookie, chunk('universities', [UNIVERSITY_ROW]));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.inserted, 1);
});

test('模块5：院校导入幂等（同 run+chunk 重试不重复）', async () => {
  const { handle, cookie, db } = await adminFixture();
  const first = await postImport(handle, cookie, chunk('universities', [UNIVERSITY_ROW, UNIVERSITY_ROW2]));
  assert.equal(first.body.inserted, 2);
  const retry = await postImport(handle, cookie, chunk('universities', [UNIVERSITY_ROW, UNIVERSITY_ROW2]));
  assert.equal(retry.status, 200);
  assert.equal(retry.body.inserted, 0, '确定性主键使重试不重复插入');
  assert.equal(db.dump('universities').length, 2);
});

test('模块5：重导入补全基础信息（只补空列、不覆盖非空、计数不增）', async () => {
  const { handle, cookie, db } = await adminFixture();
  await postImport(handle, cookie, chunk('universities', [UNIVERSITY_ROW]));
  const filledRow = { ...UNIVERSITY_ROW, province: '北京', city: '北京市', type: '综合', level: '本科', tags: '985|211|双一流|公办', website: 'https://www.join-tsinghua.edu.cn' };
  const fill = await postImport(handle, cookie, chunk('universities', [filledRow], 1));
  assert.equal(fill.status, 200);
  assert.equal(fill.body.inserted, 0);
  assert.equal(fill.body.filled, 1);
  const row = db.dump('universities').find((r) => r.code === '10003');
  assert.equal(row.province, '北京');
  assert.equal(row.website, 'https://www.join-tsinghua.edu.cn');
  assert.equal(row.tags, '985|211|双一流|公办');
  const counts = JSON.parse(db.dump('data_meta').find((r) => r.key === 'counts').value);
  assert.equal(counts.universities, 1, '补全不新增计数');
  // 已有非空值不被后续导入覆盖；空列仍可继续补。
  const overwrite = await postImport(handle, cookie, chunk('universities', [{ ...filledRow, province: '上海', city: null }], 2));
  assert.equal(overwrite.body.filled, 0);
  const after = db.dump('universities').find((r) => r.code === '10003');
  assert.equal(after.province, '北京', '非空省份不被覆盖');
  assert.equal(after.city, '北京市');
  // 基础信息通用：详情不因查询省份不同而改变。
  const henan = await call(handle, ctx('/api/universities/10003?province=河南'));
  const hebei = await call(handle, ctx('/api/universities/10003?province=河北'));
  assert.equal(henan.body.university.province, '北京');
  assert.equal(hebei.body.university.province, '北京');
  assert.equal(hebei.body.university.website, 'https://www.join-tsinghua.edu.cn');
});

test('模块5：导入行服务端复核（省份/科类/分数/来源）', async () => {
  const { handle, cookie } = await adminFixture();
  await postImport(handle, cookie, chunk('universities', [UNIVERSITY_ROW]));
  const badProvince = await postImport(handle, cookie, chunk('admission_scores', [{ ...SCORE_ROW, province: '广东' }]));
  assert.equal(badProvince.status, 400);
  const badScore = await postImport(handle, cookie, chunk('admission_scores', [{ ...SCORE_ROW, min_score: '700.555' }]));
  assert.equal(badScore.status, 400);
  const badSource = await postImport(handle, cookie, chunk('admission_scores', [{ ...SCORE_ROW, source: '' }]));
  assert.equal(badSource.status, 400);
  const badTable = await postImport(handle, cookie, chunk('users', [UNIVERSITY_ROW]));
  assert.equal(badTable.status, 400);
  const okDecimal = await postImport(handle, cookie, chunk('admission_scores', [SCORE_DECIMAL]));
  assert.equal(okDecimal.status, 200, '艺术/体育综合分允许两位小数');
});

test('模块5：录取/计划导入与详情查询（计划按名称关联、同键多行保留）', async () => {
  const { handle, cookie, db } = await adminFixture();
  await postImport(handle, cookie, chunk('universities', [UNIVERSITY_ROW]));
  await postImport(handle, cookie, chunk('admission_scores', [SCORE_ROW, SCORE_DECIMAL]));
  const plans = await postImport(handle, cookie, chunk('enrollment_plans', [PLAN_ROW, PLAN_ROW2]));
  assert.equal(plans.body.inserted, 2, '同专业同批次不同办学地点的两行都保留');
  assert.equal(db.dump('enrollment_plans').length, 2);

  await postMeta(handle, cookie, { key: 'universities_index', value: [{ code: '10003', name: '清华大学' }] });
  await postMeta(handle, cookie, { key: 'plan_facets', value: { provinces: ['河南'], years: [2025], batches: ['本科批'] } });
  await postMeta(handle, cookie, { key: 'counts', value: { universities: 1, admission_scores: 2, enrollment_plans: 2 } });

  const list = await call(handle, ctx('/api/universities'));
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].code, '10003');
  assert.equal(list.body.items[0].name, '清华大学');
  assert.equal(list.body.counts.admission_scores, 2);

  const detail = await call(handle, ctx('/api/universities/10003?year=2025'));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.university.name, '清华大学');
  assert.equal(detail.body.scores.length, 2);
  assert.ok(detail.body.scores.some((s) => s.min_score === '339.75'), '小数综合分原值保留');
  assert.equal(detail.body.plan_year, 2025);
  assert.equal(detail.body.plans.length, 2, '计划表用报考代码 00031，仍按学校名称关联到 10003');
  assert.ok(detail.body.plans.every((p) => p.school_name === '清华大学'));

  const noYear = await call(handle, ctx('/api/universities/10003?year=2024'));
  assert.equal(noYear.body.plans.length, 0, '无该年计划时返回空（前端显示暂无数据）');
});

// 列表服务端筛选/分页的 fixture：仅测试用，不代表真实招生口径。
const LIST_SCHOOLS = [
  { code: '10003', name: '清华大学', province: '北京', city: '北京市', type: '综合', level: '本科', tags: '985|211|双一流|公办', website: null, source: UNI_SOURCE, note: null },
  { code: '10001', name: '北京大学', province: '北京', city: '北京市', type: '综合', level: '本科', tags: '985|211|双一流|公办', website: null, source: UNI_SOURCE, note: null },
  { code: '10010', name: '北京航空航天大学', province: '北京', city: '北京市', type: '理工', level: '本科', tags: '985|211|双一流|公办', website: null, source: UNI_SOURCE, note: null },
  { code: '10055', name: '南开大学', province: '天津', city: '天津市', type: '综合', level: '本科', tags: '985|211|双一流|公办', website: null, source: UNI_SOURCE, note: null },
  { code: '10334', name: '浙江理工大学', province: '浙江', city: '杭州市', type: '理工', level: '本科', tags: '公办', website: null, source: UNI_SOURCE, note: null },
  { code: '10486', name: '武汉大学', province: '湖北', city: '武汉市', type: '综合', level: '本科', tags: '985|211|双一流|公办', website: null, source: UNI_SOURCE, note: null },
  { code: '10183', name: '吉林大学', province: '吉林', city: '长春市', type: '综合', level: '本科', tags: '985|211|双一流|公办', website: null, source: UNI_SOURCE, note: null },
  { code: '11078', name: '广州大学', province: '广东', city: '广州市', type: '综合', level: '本科', tags: '公办', website: null, source: UNI_SOURCE, note: null },
  { code: '12808', name: '北京工业职业技术学院', province: '北京', city: '北京市', type: '理工', level: '专科', tags: '公办', website: null, source: UNI_SOURCE, note: null },
  { code: '13000', name: '三亚学院', province: '海南', city: '三亚市', type: '综合', level: '本科', tags: '民办', website: null, source: UNI_SOURCE, note: null },
  { code: 'T001', name: '测试学院', province: '北京', city: '北京市', type: '其他', level: '本科', tags: '民办', website: null, source: UNI_SOURCE, note: null },
];
async function seedListSchools(db, rows = LIST_SCHOOLS) {
  assert.equal((await db.from('universities').insertIfAbsent(rows, { onConflict: 'code' })).error, null);
}

test('模块5：高校列表服务端筛选（省份/类型/层次/标签）', async () => {
  const { db, handle } = fixture();
  await seedListSchools(db);
  const byProvince = await call(handle, ctx('/api/universities?province=北京'));
  assert.equal(byProvince.status, 200);
  assert.equal(byProvince.body.total, 5);
  assert.deepEqual(byProvince.body.items.map((u) => u.code).sort(), ['10001', '10003', '10010', '12808', 'T001']);
  const byType = await call(handle, ctx('/api/universities?type=理工'));
  assert.equal(byType.body.total, 3);
  const byLevel = await call(handle, ctx('/api/universities?level=专科'));
  assert.equal(byLevel.body.total, 1);
  assert.equal(byLevel.body.items[0].code, '12808');
  const byTag = await call(handle, ctx('/api/universities?tag=民办'));
  assert.equal(byTag.body.total, 2);
  const combined = await call(handle, ctx('/api/universities?province=北京&type=理工'));
  assert.equal(combined.body.total, 2);
  assert.deepEqual(combined.body.items.map((u) => u.code).sort(), ['10010', '12808']);
  // 筛选面与计数照常返回（来自 data_meta，未写入时为空/零）。
  assert.deepEqual(byProvince.body.score_facets, { provinces: [], years: [], categories: [], batches: [] });
  assert.deepEqual(byProvince.body.counts, { universities: 0, admission_scores: 0, enrollment_plans: 0 });
});

test('模块5：高校列表 q 搜索（名称/代码子串，不区分大小写）', async () => {
  const { db, handle } = fixture();
  await seedListSchools(db);
  const byName = await call(handle, ctx('/api/universities?q=清华'));
  assert.equal(byName.body.total, 1);
  assert.equal(byName.body.items[0].code, '10003');
  const byCode = await call(handle, ctx('/api/universities?q=10003'));
  assert.equal(byCode.body.total, 1);
  const all = await call(handle, ctx('/api/universities?q=大学'));
  assert.equal(all.body.total, 8, '名称含“大学”的 8 所（测试学院/三亚学院/北京工业职业技术学院不含）');
  const lower = await call(handle, ctx('/api/universities?q=t001'));
  assert.equal(lower.body.total, 1, '小写 q 匹配大写代码');
  assert.equal(lower.body.items[0].code, 'T001');
  const none = await call(handle, ctx('/api/universities?q=不存在的学校'));
  assert.equal(none.body.total, 0);
  assert.deepEqual(none.body.items, []);
});

test('模块5：高校列表服务端分页（limit/offset 无重叠、总数一致、越界空页、默认 20）', async () => {
  const { db, handle } = fixture();
  await seedListSchools(db);
  const pages = [];
  for (const offset of [0, 2, 4, 6, 8, 10]) {
    const res = await call(handle, ctx(`/api/universities?limit=2&offset=${offset}`));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 11);
    pages.push(res.body.items.map((u) => u.code));
  }
  assert.deepEqual(pages.map((p) => p.length), [2, 2, 2, 2, 2, 1]);
  const seen = pages.flat();
  assert.equal(new Set(seen).size, 11, '各页无重叠');
  assert.deepEqual([...seen].sort(), LIST_SCHOOLS.map((s) => s.code).sort(), '分页合起来是全部');
  // 每页按名称升序（与 majors 列表同一排序口径）。
  const first = await call(handle, ctx('/api/universities?limit=11'));
  const names = first.body.items.map((u) => u.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'zh')));
  // offset 越界返回空页，总数不变。
  const beyond = await call(handle, ctx('/api/universities?limit=2&offset=20'));
  assert.equal(beyond.status, 200);
  assert.equal(beyond.body.total, 11);
  assert.deepEqual(beyond.body.items, []);
  // 默认 limit 20：25 所只返回前 20；limit=100 可取全。
  const many = Array.from({ length: 25 }, (_, i) => ({
    code: `9${String(i).padStart(4, '0')}`, name: `测试院校${String(i).padStart(2, '0')}`,
    province: '北京', city: null, type: '综合', level: '本科', tags: '公办', website: null, source: UNI_SOURCE, note: null,
  }));
  const f2 = fixture();
  await seedListSchools(f2.db, many);
  const def = await call(f2.handle, ctx('/api/universities'));
  assert.equal(def.body.total, 25);
  assert.equal(def.body.items.length, 20);
  const maxed = await call(f2.handle, ctx('/api/universities?limit=100'));
  assert.equal(maxed.body.items.length, 25);
});

test('模块5：高校列表非法参数返回 400、不 500', async () => {
  const { db, handle } = fixture();
  await seedListSchools(db);
  const cases = [
    '/api/universities?limit=0',
    '/api/universities?limit=101',
    '/api/universities?limit=abc',
    '/api/universities?limit=1.5',
    '/api/universities?offset=-1',
    '/api/universities?offset=1.5',
    '/api/universities?province=火星',
    '/api/universities?type=不存在',
    '/api/universities?level=博士',
    '/api/universities?tag=不存在',
    `/api/universities?q=${'学'.repeat(51)}`,
  ];
  for (const path of cases) {
    const res = await call(handle, ctx(path));
    assert.equal(res.status, 400, path);
    assert.equal(res.body.error, 'invalid_filter', path);
  }
  // 边界合法值仍 200：limit=1、limit=100、offset=0。
  for (const path of ['/api/universities?limit=1', '/api/universities?limit=100', '/api/universities?offset=0']) {
    assert.equal((await call(handle, ctx(path))).status, 200, path);
  }
});

test('模块5：按高考省份查询详情，省份条件先于截断，默认计划年份取该省实际数据', async () => {
  const { handle, db } = fixture();
  await db.from('universities').insertIfAbsent([UNIVERSITY_ROW, UNIVERSITY_ROW2], { onConflict: 'code' });
  await db.from('data_meta').insertIfAbsent({ key: 'plan_facets', value: JSON.stringify({ provinces: ['河北', '河南'], years: [2025, 2026] }) }, { onConflict: 'key' });
  await db.from('admission_scores').insertIfAbsent([
    ...Array.from({ length: 500 }, (_, i) => ({ ...SCORE_ROW, id: `henan-${i}`, year: 2026 })),
    { ...SCORE_ROW, id: 'hebei-score', province: '河北', year: 2025 },
  ], { onConflict: 'id' });
  await db.from('enrollment_plans').insertIfAbsent([
    ...Array.from({ length: 1000 }, (_, i) => ({ ...PLAN_ROW, id: `henan-plan-${i}`, major_name: 'A', year: 2025 })),
    { ...PLAN_ROW, id: 'henan-latest', year: 2026 },
    { ...PLAN_ROW, id: 'hebei-plan', province: '河北', year: 2025, major_name: 'Z' },
  ], { onConflict: 'id' });

  const hebei = await call(handle, ctx('/api/universities/10003?province=河北'));
  assert.equal(hebei.status, 200);
  assert.deepEqual(hebei.body.scores.map((row) => row.id), ['hebei-score']);
  assert.deepEqual(hebei.body.plans.map((row) => row.id), ['hebei-plan']);
  assert.equal(hebei.body.plan_year, 2025);
  const henan = await call(handle, ctx('/api/universities/10003?province=河南'));
  assert.equal(henan.body.plan_year, 2026);
  assert.ok(henan.body.scores.every((row) => row.province === '河南'));
  assert.deepEqual(henan.body.plans.map((row) => row.id), ['henan-latest']);
  const emptyYear = await call(handle, ctx('/api/universities/10003?province=河北&year=2026'));
  assert.equal(emptyYear.body.plan_year, 2026);
  assert.deepEqual(emptyYear.body.plans, []);
  const emptySchool = await call(handle, ctx('/api/universities/10001?province=河北'));
  assert.equal(emptySchool.status, 200);
  assert.deepEqual(emptySchool.body.scores, []);
  assert.deepEqual(emptySchool.body.plans, []);
  assert.equal(emptySchool.body.plan_year, null);
  assert.equal((await call(handle, ctx('/api/universities/10003?province=广东'))).status, 400);
  assert.equal((await call(handle, ctx('/api/universities/10003?province='))).status, 400);
});

test('模块5：元数据需管理员且形状受校验', async () => {
  const { handle, cookie } = await adminFixture();
  const student = await register(handle, uniqueName('stu2'));
  assert.equal((await postMeta(handle, cookiePair(student), { key: 'counts', value: { universities: 1, admission_scores: 0, enrollment_plans: 0 } })).status, 403);
  assert.equal((await postMeta(handle, cookie, { key: 'evil', value: {} })).status, 400);
  assert.equal((await postMeta(handle, cookie, { key: 'counts', value: { universities: -1, admission_scores: 0, enrollment_plans: 0 } })).status, 400);
  const ok = await postMeta(handle, cookie, { key: 'counts', value: { universities: 1, admission_scores: 0, enrollment_plans: 0 } });
  assert.equal(ok.status, 200);
  const again = await postMeta(handle, cookie, { key: 'counts', value: { universities: 2, admission_scores: 0, enrollment_plans: 0 } });
  assert.equal(again.status, 200, '已存在的键走更新路径');
});

test('模块5：大院校索引元数据（>8KB）可保存并回读', async () => {
  const { handle, cookie, db } = await adminFixture();
  const index = Array.from({ length: 300 }, (_, i) => ({ code: `C${i}`, name: `示例院校名称较长用于超出默认正文上限${i}` }));
  const saved = await postMeta(handle, cookie, { key: 'universities_index', value: index });
  assert.equal(saved.status, 200, '院校索引不受默认 8KB 正文上限限制');
  const stored = JSON.parse(db.dump('data_meta').find((r) => r.key === 'universities_index').value);
  assert.equal(stored.length, 300, '超大索引完整落库');
  const list = await call(handle, ctx('/api/universities'));
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 0, '列表读 universities 表，索引元数据不再作为列表源');
});

test('模块5：写入被拒不回退；响应丢失经确定性主键恢复不重复', async () => {
  const { handle, cookie, db, control } = await adminFixture();
  await postImport(handle, cookie, chunk('universities', [UNIVERSITY_ROW]));
  control.rejectTable = 'enrollment_plans';
  const rejected = await postImport(handle, cookie, chunk('enrollment_plans', [PLAN_ROW]));
  assert.equal(rejected.status, 503);
  assert.equal(rejected.body.error, 'database_unavailable');
  assert.equal(db.dump('enrollment_plans').length, 0, '明确拒绝不得落库');

  control.dropTable = 'enrollment_plans';
  const dropped = await postImport(handle, cookie, chunk('enrollment_plans', [PLAN_ROW, PLAN_ROW2]));
  assert.equal(dropped.status, 200, '批量响应丢失后逐行回退恢复');
  assert.equal(db.dump('enrollment_plans').length, 2, '已提交行不重复插入');
  const retry = await postImport(handle, cookie, chunk('enrollment_plans', [PLAN_ROW, PLAN_ROW2]));
  assert.equal(retry.body.inserted, 0);
  assert.equal(db.dump('enrollment_plans').length, 2);
});

test('模块5：多省增量导入元数据合并（索引/筛选面并集、计数服务端累加且幂等）', async () => {
  const { handle, cookie, db } = await adminFixture();
  // 河南批次
  await postImport(handle, cookie, chunk('universities', [UNIVERSITY_ROW]));
  await postImport(handle, cookie, chunk('admission_scores', [{ ...SCORE_ROW, category: '理科' }]));
  await postImport(handle, cookie, chunk('enrollment_plans', [PLAN_ROW]));
  await postMeta(handle, cookie, { key: 'universities_index', value: [{ code: '10003', name: '清华大学' }] });
  await postMeta(handle, cookie, { key: 'score_facets', value: { provinces: ['河南'], years: [2025], categories: ['理科'], batches: ['本科批'] } });
  await postMeta(handle, cookie, { key: 'plan_facets', value: { provinces: ['河南'], years: [2025], batches: ['本科批'] } });
  // 河北批次：新校 + 已有院校的他省录取/计划（国标代码相同）
  await postImport(handle, cookie, chunk('universities', [UNIVERSITY_ROW2], 1));
  await postImport(handle, cookie, chunk('admission_scores', [{ ...SCORE_ROW, province: '河北', year: 2026 }], 1));
  await postImport(handle, cookie, chunk('enrollment_plans', [{ ...PLAN_ROW, province: '河北', year: 2026 }], 1));
  await postMeta(handle, cookie, { key: 'universities_index', value: [{ code: '10001', name: '北京大学' }] });
  await postMeta(handle, cookie, { key: 'score_facets', value: { provinces: ['河北'], years: [2026], categories: ['物理类'], batches: ['本科批'] } });
  await postMeta(handle, cookie, { key: 'plan_facets', value: { provinces: ['河北'], years: [2026], batches: ['本科批'] } });

  const list = await call(handle, ctx('/api/universities'));
  assert.equal(list.body.total, 2, '两省导入后院校表共 2 所');
  const storedIndex = JSON.parse(db.dump('data_meta').find((r) => r.key === 'universities_index').value);
  assert.deepEqual(storedIndex.map((u) => u.code).sort(), ['10001', '10003'], '院校索引为两省并集，不被新文件覆盖');
  assert.deepEqual(list.body.score_facets.provinces, ['河北', '河南']);
  assert.deepEqual(list.body.score_facets.years, [2025, 2026]);
  assert.deepEqual(list.body.score_facets.categories, ['物理类', '理科']);
  assert.deepEqual(list.body.plan_facets.provinces, ['河北', '河南']);
  assert.deepEqual(list.body.plan_facets.years, [2025, 2026]);
  assert.deepEqual(list.body.counts, { universities: 2, admission_scores: 2, enrollment_plans: 2 }, '计数按实际插入行数服务端累加');

  const retry = await postImport(handle, cookie, chunk('admission_scores', [{ ...SCORE_ROW, province: '河北', year: 2026 }], 1));
  assert.equal(retry.body.inserted, 0);
  const after = await call(handle, ctx('/api/universities'));
  assert.equal(after.body.counts.admission_scores, 2, '幂等重跑不增计数');
  const detail = await call(handle, ctx('/api/universities/10003?year=2026'));
  assert.equal(detail.body.scores.length, 2, '已有院校的两省录取按国标代码都可查');
  assert.equal(detail.body.scores[0].province, '河北', '年份倒序');
  assert.equal(detail.body.plans.length, 1, '已有院校的他省计划按名称可查');
});

// ---- 模块4 扩展：文件直传直下（平台 Storage 签名上传/下载 + 回读校验） ----
const FILE_BODY = {
  title: '高中数学函数专题讲义',
  grade: '高一',
  subject: '数学',
  type: '笔记',
  source_name: '自己整理',
  description: '函数单调性与奇偶性',
  copyright_confirmed: true,
};
const bytesOf = (n) => new Uint8Array(n).fill(65);
const uploadUrl = (handle, cookie, body) =>
  call(handle, ctx('/api/resources/upload-url', { method: 'POST', cookie, body }));
const finalizeFile = (handle, cookie, body) =>
  call(handle, ctx('/api/resources', { method: 'POST', cookie, body }));

test('测评记录：登录门槛、只看自己的、三种测评按时间倒序共存', async () => {
  const { handle } = fixture();
  assert.equal((await call(handle, ctx('/api/assessments'))).status, 401);
  assert.equal((await call(handle, ctx('/api/assessments', { method: 'POST', body: {} }))).status, 401);
  const cookieA = cookiePair(await register(handle, uniqueName()));
  const cookieB = cookiePair(await register(handle, uniqueName()));
  assert.equal((await call(handle, ctx('/api/assessments', { cookie: cookieA }))).body.total, 0);

  await submit(handle, cookieA, allAnswers(2));
  await tick();
  await call(handle, ctx('/api/assessments', { method: 'POST', cookie: cookieA, body: { answers: Array(24).fill(3) } }));
  await tick();
  await mbtiSubmit(handle, cookieA, mbtiAll(0));

  const listA = await call(handle, ctx('/api/assessments', { cookie: cookieA }));
  assert.equal(listA.body.total, 3);
  assert.equal(listA.body.items[0].kind, 'mbti');
  assert.equal(listA.body.items[0].version, null);
  assert.equal(listA.body.items[0].code, 'ESTJ');
  assert.deepEqual(listA.body.items[0].top_types, ['ESTJ']);
  assert.equal(listA.body.items[1].kind, 'riasec');
  assert.equal(listA.body.items[1].version, 24);
  assert.deepEqual(listA.body.items[1].scores, { R: 50, I: 50, A: 50, S: 50, E: 50, C: 50 });
  assert.deepEqual(listA.body.items[1].top_types, ['R', 'I']);
  assert.equal(listA.body.items[2].kind, 'riasec');
  assert.equal(listA.body.items[2].version, 30);
  assert.deepEqual(listA.body.items[2].scores, { R: 10, I: 10, A: 10, S: 10, E: 10, C: 10 });
  assert.deepEqual(listA.body.items[2].top_types, ['R', 'I', 'A']);
  const listB = await call(handle, ctx('/api/assessments', { cookie: cookieB }));
  assert.equal(listB.body.total, 0, 'B 看不到 A 的测评记录');
});

// ---- 模块3：首页统计（真实计数，空数据与触顶如实显示） ----

test('首页统计：公开读；未登录个人计数为 null；计数反映真实行数与导入元数据', async () => {
  const { db, handle } = fixture();

  const anon = await call(handle, ctx('/api/stats'));
  assert.equal(anon.status, 200);
  assert.deepEqual(anon.body.stats, {
    resources_total: 0,
    resources_capped: false,
    universities_total: null,
    favorites_count: null,
    favorites_capped: false,
    assessments_count: null,
    assessments_capped: false,
  });

  const created = await register(handle, uniqueName());
  const cookie = cookiePair(created);
  const userId = created.body.user.id;
  const mine = await call(handle, ctx('/api/stats', { cookie }));
  assert.deepEqual(mine.body.stats, {
    resources_total: 0,
    resources_capped: false,
    universities_total: null,
    favorites_count: 0,
    favorites_capped: false,
    assessments_count: 0,
    assessments_capped: false,
  });

  // 直接向假数据库写入行，验证计数逻辑（各写入接口在各自测试里覆盖）。
  await db.from('resources').insertIfAbsent({ id: 'r1', title: '资料一' }, { onConflict: 'id' });
  await db.from('resources').insertIfAbsent({ id: 'r2', title: '资料二' }, { onConflict: 'id' });
  await db.from('data_meta').insertIfAbsent({
    key: 'counts',
    value: JSON.stringify({ universities: 2400, admission_scores: 11005, enrollment_plans: 183493 }),
  }, { onConflict: 'key' });
  await db.from('favorites').insertIfAbsent(
    { user_id: userId, resource_id: 'r1', created_at: new Date().toISOString(), revoked_at: null },
    { onConflict: 'user_id,resource_id' },
  );
  await db.from('favorites').insertIfAbsent(
    { user_id: userId, resource_id: 'r2', revoked_at: new Date().toISOString(), created_at: new Date().toISOString() },
    { onConflict: 'user_id,resource_id' },
  );
  await db.from('assessments').insertIfAbsent(
    { id: 'a1', user_id: userId, kind: 'riasec', answers: '[]', scores: '{}', code: 'RIA', created_at: new Date().toISOString() },
    { onConflict: 'id' },
  );
  await db.from('assessment_results').insertIfAbsent(
    { id: 'ar1', user_id: userId, answers: '[]', scores: '{"R":50}', top_types: '["R","I"]', created_at: new Date().toISOString() },
    { onConflict: 'id' },
  );

  const counted = await call(handle, ctx('/api/stats', { cookie }));
  assert.deepEqual(counted.body.stats, {
    resources_total: 2,
    resources_capped: false,
    universities_total: 2400,
    favorites_count: 1, // 已取消收藏的那条不计入
    favorites_capped: false,
    assessments_count: 2, // 两张测评表合并计数，与个人中心历史一致
    assessments_capped: false,
  });

  // 别人的收藏不计入自己的统计；错误方法 405。
  const other = await register(handle, uniqueName());
  const otherStats = await call(handle, ctx('/api/stats', { cookie: cookiePair(other) }));
  assert.equal(otherStats.body.stats.favorites_count, 0);
  assert.equal(otherStats.body.stats.assessments_count, 0);
  assert.equal((await call(handle, ctx('/api/stats', { method: 'POST', body: {} }))).status, 405);
});

test('首页统计：计数触顶如实报告 capped，不把截断值当真实总数', async () => {
  const { db, handle } = fixture();
  const cookie = cookiePair(await register(handle, uniqueName()));
  const userId = (await me(handle, cookie)).body.user.id;
  const batch = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, title: `资料${i}` }));
  await db.from('resources').insertIfAbsent(batch, { onConflict: 'id' });
  const favs = Array.from({ length: 500 }, (_, i) => ({
    user_id: userId, resource_id: `r${i}`, created_at: new Date().toISOString(), revoked_at: null,
  }));
  await db.from('favorites').insertIfAbsent(favs, { onConflict: 'user_id,resource_id' });

  const s = (await call(handle, ctx('/api/stats', { cookie }))).body.stats;
  assert.equal(s.resources_total, 500);
  assert.equal(s.resources_capped, true);
  assert.equal(s.favorites_count, 500);
  assert.equal(s.favorites_capped, true);
});

test('模块4文件：上传需登录，类型/大小/路径校验，存储路径由会话派生', async () => {
  const storage = createFakeStorage();
  const { handle } = fixture(storage);
  assert.equal((await uploadUrl(handle, null, { file_name: 'a.pdf', file_size: 10 })).status, 401);

  const cookie = cookiePair(await register(handle, uniqueName()));
  const userId = (await me(handle, cookie)).body.user.id;
  const ok = await uploadUrl(handle, cookie, { file_name: '讲义.pdf', file_size: 1024 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.contentType, 'application/pdf');
  assert.equal(ok.body.maxBytes, FILE_MAX_BYTES);
  assert.ok(ok.body.storageKey.startsWith(`resources/${await sha256Hex(userId)}/`), '目录段必须是会话用户 ID 的摘要');
  assert.ok(ok.body.storageKey.endsWith('.pdf'));
  assert.ok(ok.body.uploadUrl.includes(ok.body.storageKey));

  assert.equal((await uploadUrl(handle, cookie, { file_name: 'evil.exe', file_size: 10 })).body.error, 'unsupported_file_type');
  assert.equal((await uploadUrl(handle, cookie, { file_name: 'a.pdf', file_size: FILE_MAX_BYTES + 1 })).body.error, 'file_too_large');
  assert.equal((await uploadUrl(handle, cookie, { file_name: 'a.pdf', file_size: 0 })).body.error, 'invalid_file');
  assert.equal((await uploadUrl(handle, cookie, { file_name: '../escape.pdf', file_size: 10 })).body.error, 'invalid_file');
  assert.equal((await uploadUrl(handle, cookie, { file_name: 'noext', file_size: 10 })).body.error, 'unsupported_file_type');
  assert.equal((await call(handle, ctx('/api/resources/upload-url', { cookie }))).status, 405);
});

test('模块4文件：上传→回读校验→登记→下载全流程，落库取实测值', async () => {
  const storage = createFakeStorage();
  const { handle, db } = fixture(storage);
  const cookie = cookiePair(await register(handle, uniqueName()));
  const userId = (await me(handle, cookie)).body.user.id;

  const intent = await uploadUrl(handle, cookie, { file_name: '笔记.txt', file_size: 2048 });
  const key = intent.body.storageKey;
  storage.put(key, bytesOf(2048), 'text/plain'); // 模拟浏览器 PUT 到签名 URL
  const created = await finalizeFile(handle, cookie, {
    ...FILE_BODY, storage_key: key, file_name: '笔记.txt', file_size: 2048,
    owner_id: '00000000-0000-0000-0000-000000000000',
  });
  assert.equal(created.status, 201);
  const res = created.body.resource;
  assert.equal(res.has_file, true);
  assert.equal(res.file_name, '笔记.txt');
  assert.equal(res.file_size, 2048);
  assert.equal(res.mime, 'text/plain');
  assert.equal(res.source_url, '');
  assert.equal(res.owner_id, userId, '归属只来自会话');
  assert.ok(!('storage_key' in res), '存储路径不暴露给浏览器');
  assert.equal(db.dump('resources')[0].storage_key, key);

  // 下载：登录用户（含他人，共享资料库）可签发；匿名拒绝。
  const dl = await call(handle, ctx(`/api/resources/${res.id}/file`, { cookie }));
  assert.equal(dl.status, 200);
  assert.ok(dl.body.downloadUrl.includes(key));
  assert.equal(dl.body.file_name, '笔记.txt');
  const cookieB = cookiePair(await register(handle, uniqueName()));
  assert.equal((await call(handle, ctx(`/api/resources/${res.id}/file`, { cookie: cookieB }))).status, 200);
  assert.equal((await call(handle, ctx(`/api/resources/${res.id}/file`))).status, 401);
  assert.equal((await call(handle, ctx(`/api/resources/${res.id}/file`, { method: 'POST', cookie }))).status, 405);

  // 链接型资料没有文件可下载。
  const link = await call(handle, ctx('/api/resources', { method: 'POST', cookie, body: { ...FILE_BODY, source_url: 'https://example.edu.cn/x' } }));
  assert.equal((await call(handle, ctx(`/api/resources/${link.body.resource.id}/file`, { cookie }))).body.error, 'file_not_found');
});

test('模块4文件：归属与回读校验拒绝非法登记，失败不落库并清理对象', async () => {
  const storage = createFakeStorage();
  const { handle, db } = fixture(storage);
  const cookieA = cookiePair(await register(handle, uniqueName()));
  const cookieB = cookiePair(await register(handle, uniqueName()));
  const intentA = await uploadUrl(handle, cookieA, { file_name: 'a.pdf', file_size: 100 });
  const keyA = intentA.body.storageKey;

  // B 不能登记签发给 A 的对象（前缀不匹配）。
  storage.put(keyA, bytesOf(100), 'application/pdf');
  assert.equal((await finalizeFile(handle, cookieB, { ...FILE_BODY, storage_key: keyA, file_name: 'a.pdf', file_size: 100 })).body.error, 'file_forbidden');

  // 篡改 / 穿越路径一律拒绝。
  assert.equal((await finalizeFile(handle, cookieA, { ...FILE_BODY, storage_key: 'resources/../x.pdf', file_name: 'a.pdf', file_size: 100 })).body.error, 'invalid_file');
  assert.equal((await finalizeFile(handle, cookieA, { ...FILE_BODY, storage_key: 'other/dir/a.pdf', file_name: 'a.pdf', file_size: 100 })).body.error, 'invalid_file');

  // 大小不符：声明 100 实际 200 → 拒绝、清理对象、不落库。
  const mismatch = await uploadUrl(handle, cookieA, { file_name: 'm.pdf', file_size: 100 });
  storage.put(mismatch.body.storageKey, bytesOf(200), 'application/pdf');
  const mRes = await finalizeFile(handle, cookieA, { ...FILE_BODY, storage_key: mismatch.body.storageKey, file_name: 'm.pdf', file_size: 100 });
  assert.equal(mRes.body.error, 'file_validation_failed');
  assert.equal(storage.has(mismatch.body.storageKey), false, '校验失败应清理已上传对象');

  // MIME 不符：声明 pdf 实际存成 html → 拒绝。
  const mime = await uploadUrl(handle, cookieA, { file_name: 't.pdf', file_size: 100 });
  storage.put(mime.body.storageKey, bytesOf(100), 'text/html');
  assert.equal((await finalizeFile(handle, cookieA, { ...FILE_BODY, storage_key: mime.body.storageKey, file_name: 't.pdf', file_size: 100 })).body.error, 'file_validation_failed');

  // 从未上传（对象不存在）→ 拒绝。
  const absent = await uploadUrl(handle, cookieA, { file_name: 'n.pdf', file_size: 100 });
  assert.equal((await finalizeFile(handle, cookieA, { ...FILE_BODY, storage_key: absent.body.storageKey, file_name: 'n.pdf', file_size: 100 })).body.error, 'file_validation_failed');

  // 扩展名与存储路径不一致 → 拒绝。
  const ext = await uploadUrl(handle, cookieA, { file_name: 'e.pdf', file_size: 100 });
  storage.put(ext.body.storageKey, bytesOf(100), 'application/pdf');
  assert.equal((await finalizeFile(handle, cookieA, { ...FILE_BODY, storage_key: ext.body.storageKey, file_name: 'e.txt', file_size: 100 })).body.error, 'invalid_file');

  assert.equal(db.dump('resources').length, 0, '所有非法登记都不得落库');
});

test('模块4文件：固定来源校验（CSRF）覆盖上传与登记', async () => {
  const storage = createFakeStorage();
  const { handle } = fixture(storage);
  const cookie = cookiePair(await register(handle, uniqueName()));
  const evil = await call(handle, ctx('/api/resources/upload-url', { method: 'POST', cookie, origin: 'https://evil.test', body: { file_name: 'a.pdf', file_size: 10 } }));
  assert.equal(evil.status, 403);
  assert.equal(evil.body.error, 'origin_forbidden');
});

// ---- 阶段8：全站权限矩阵（匿名拒绝、学生越权拒绝、参数篡改无效） ----

test('阶段8权限：受保护接口匿名一律 401，学生访问管理员接口 403，公开读不受影响', async () => {
  const storage = createFakeStorage();
  const { handle } = fixture(storage);
  const rid = '00000000-0000-0000-0000-000000000000';

  const anonGets = [
    '/api/me', '/api/favorites', '/api/assessments',
    '/api/assessment/questions', '/api/assessment/latest',
    '/api/mbti/questions', '/api/mbti/latest',
    '/api/resources?mine=1', `/api/resources/${rid}/file`,
  ];
  for (const path of anonGets) {
    const res = await call(handle, ctx(path));
    assert.equal(res.status, 401, `匿名 GET ${path} 应 401`);
    assert.equal(res.body.error, 'login_required');
  }
  const anonPosts = [
    ['/api/profile', { grade: '高一' }],
    ['/api/password', { current_password: 'wrong', new_password: 'yyyyyyyy' }],
    ['/api/assessments', { answers: Array(24).fill(3) }],
    ['/api/assessment/submit', { answers: {} }],
    ['/api/mbti/submit', { answers: {} }],
    ['/api/resources', RESOURCE_BODY],
    ['/api/resources/upload-url', { file_name: 'a.pdf', file_size: 10 }],
    [`/api/resources/${rid}/favorite`, {}],
    [`/api/resources/${rid}/unfavorite`, {}],
    ['/api/admin/import', chunk('universities', [UNIVERSITY_ROW])],
    ['/api/admin/meta', { key: 'counts', value: {} }],
  ];
  for (const [path, body] of anonPosts) {
    const res = await call(handle, ctx(path, { method: 'POST', body }));
    assert.equal(res.status, 401, `匿名 POST ${path} 应 401`);
    assert.equal(res.body.error, 'login_required');
  }

  // 公开读接口匿名可用（共享学习资料与官方数据查询）。
  assert.equal((await call(handle, ctx('/api/resources'))).status, 200);
  assert.equal((await call(handle, ctx(`/api/resources/${rid}`))).status, 404, '公开读但未知 id 仍 404');
  assert.equal((await call(handle, ctx('/api/universities'))).status, 200);
  assert.equal((await call(handle, ctx('/api/majors'))).status, 200);
  assert.equal((await call(handle, ctx('/api/stats'))).status, 200);

  // 学生（非管理员）访问导入/元数据接口一律 403。
  const student = cookiePair(await register(handle, uniqueName('stu')));
  const imp = await postImport(handle, student, chunk('universities', [UNIVERSITY_ROW]));
  assert.equal(imp.status, 403);
  assert.equal(imp.body.error, 'admin_required');
  const meta = await postMeta(handle, student, { key: 'counts', value: { universities: 0, admission_scores: 0, enrollment_plans: 0 } });
  assert.equal(meta.status, 403);
  assert.equal(meta.body.error, 'admin_required');
});

test('阶段8权限：请求体篡改 id/role/user_id 一律无效，归属只来自会话', async () => {
  const { db, handle } = fixture();
  const a = await register(handle, uniqueName('alpha'));
  const b = await register(handle, uniqueName('bravo'));
  const cookieA = cookiePair(a), cookieB = cookiePair(b);
  const idA = a.body.user.id, idB = b.body.user.id;

  // 资料：试图提升角色、改用户名、指向他人 id，全部被白名单忽略。
  const tampered = await call(handle, ctx('/api/profile', {
    method: 'POST', cookie: cookieA,
    body: { display_name: '甲同学', id: idB, user_id: idB, role: 'admin', username: 'hacked', password_hash: 'x' },
  }));
  assert.equal(tampered.status, 200);
  assert.equal(tampered.body.user.id, idA);
  assert.equal(tampered.body.user.role, 'student');
  assert.equal(tampered.body.user.username, a.body.user.username);
  const rowA = db.dump('users').find((u) => u.id === idA);
  const rowB = db.dump('users').find((u) => u.id === idB);
  assert.equal(rowA.role, 'student', 'role 不得通过资料接口提升');
  assert.notEqual(rowA.password_hash, 'x');
  assert.equal(rowB.role, 'student');
  assert.equal(rowB.display_name, null, 'B 的资料不受影响');

  // 三种测评提交塞 user_id：写入成功但归属仍是会话用户。
  const saved24 = await call(handle, ctx('/api/assessments', { method: 'POST', cookie: cookieA, body: { answers: Array(24).fill(3), user_id: idB } }));
  assert.equal(saved24.status, 201);
  assert.equal(db.dump('assessment_results')[0].user_id, idA);
  const saved30 = await call(handle, ctx('/api/assessment/submit', { method: 'POST', cookie: cookieA, body: { answers: allAnswers(1), user_id: idB } }));
  assert.equal(saved30.status, 201);
  const savedMbti = await call(handle, ctx('/api/mbti/submit', { method: 'POST', cookie: cookieA, body: { answers: mbtiAll(0), user_id: idB } }));
  assert.equal(savedMbti.status, 201);
  assert.ok(db.dump('assessments').every((row) => row.user_id === idA));

  // B 的历史看不到 A 的任何记录；A 能看到自己全部三条。
  assert.equal((await call(handle, ctx('/api/assessments', { cookie: cookieB }))).body.total, 0);
  assert.equal((await call(handle, ctx('/api/assessments', { cookie: cookieA }))).body.total, 3);

  // 改密请求体塞他人 id 无效：B 的原口令仍可登录。
  const pw = await call(handle, ctx('/api/password', {
    method: 'POST', cookie: cookieA,
    body: { current_password: PASSWORD, new_password: `np-${crypto.randomUUID()}`, id: idB, user_id: idB },
  }));
  assert.equal(pw.status, 200);
  assert.equal((await login(handle, b.body.user.username, PASSWORD)).status, 200, 'B 的口令不得被 A 的请求改动');
});

test('首页推荐：公开读；空库如实为空，匿名按最新真实资料推荐', async () => {
  const { handle } = fixture();
  const empty = await call(handle, ctx('/api/recommendations'));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { personalized: false, items: [] });

  const { db, handle: h2 } = fixture();
  await seedResource(db, null, { title: '旧资料', created_at: '2026-01-01T00:00:00.000Z' });
  const newer = await seedResource(db, null, { title: '新资料', created_at: '2026-02-01T00:00:00.000Z' });
  const res = await call(h2, ctx('/api/recommendations'));
  assert.equal(res.status, 200);
  assert.equal(res.body.personalized, false);
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.items[0].id, newer);
  assert.equal(res.body.items[0].reason, '资料库最新收录');
  assert.equal(res.body.items[0].link, `/resources?id=${newer}`);
  assert.ok(res.body.items.every((item) => item.kind === 'resource'));
});

test('首页推荐：登录按年级/选科匹配真实资料，高校推荐来自本省真实录取行', async () => {
  const { db, handle } = fixture();
  const reg = await register(handle, uniqueName('rec'), PASSWORD, { grade: '高二', province: '河北', subjects: ['数学'] });
  assert.equal(reg.status, 201);
  const cookie = cookiePair(reg);
  const matchId = await seedResource(db, null, { title: '高二数学匹配资料', grade: '高二', subject: '数学', created_at: '2026-01-01T00:00:00.000Z' });
  await seedResource(db, null, { title: '不相关最新资料', grade: '高一', subject: '英语', created_at: '2026-03-01T00:00:00.000Z' });

  // 该省还没有录取数据时不出高校推荐，不编造。
  const before = await call(handle, ctx('/api/recommendations', { cookie }));
  assert.equal(before.body.personalized, true);
  assert.equal(before.body.items.length, 2);
  assert.ok(before.body.items.every((item) => item.kind === 'resource'));

  await db.from('admission_scores').insertIfAbsent({ id: crypto.randomUUID(), ...SCORE_ROW, province: '河北' }, { onConflict: 'id' });
  const res = await call(handle, ctx('/api/recommendations', { cookie }));
  assert.equal(res.body.items[0].id, matchId);
  assert.equal(res.body.items[0].reason, '匹配你的年级「高二」与选科「数学」');
  const uni = res.body.items.find((item) => item.kind === 'university');
  assert.ok(uni, '有本省真实录取行时应出高校推荐');
  assert.equal(uni.title, SCORE_ROW.school_name);
  assert.equal(uni.link, `/universities/${SCORE_ROW.university_code}`);
  assert.equal(uni.reason, '在你设置的省份「河北」有历年录取数据');

  // 匿名在同一库上：无个性化、无高校推荐，仍按最新真实资料。
  const anon = await call(handle, ctx('/api/recommendations'));
  assert.equal(anon.body.personalized, false);
  assert.ok(anon.body.items.every((item) => item.kind === 'resource'));
  assert.equal(anon.body.items[0].title, '不相关最新资料');
});

// ---- 阶段5：内容管理（上传者删除 / 管理员下架，软删除全链路过滤） ----
test('阶段5内容管理：上传者删除自己的资料，删除后全链路不可见，文件被清理', async () => {
  const storage = createFakeStorage();
  const { handle, db } = fixture(storage);
  const cookieA = cookiePair(await register(handle, uniqueName()));
  const cookieB = cookiePair(await register(handle, uniqueName()));

  const intent = await uploadUrl(handle, cookieA, { file_name: '讲义.pdf', file_size: 100 });
  const key = intent.body.storageKey;
  storage.put(key, bytesOf(100), 'application/pdf');
  const fileRes = (await finalizeFile(handle, cookieA, { ...FILE_BODY, storage_key: key, file_name: '讲义.pdf', file_size: 100 })).body.resource;
  const linkRes = (await call(handle, ctx('/api/resources', { method: 'POST', cookie: cookieA, body: { ...FILE_BODY, source_url: 'https://example.edu.cn/x' } }))).body.resource;
  assert.equal((await call(handle, ctx(`/api/resources/${fileRes.id}/favorite`, { method: 'POST', cookie: cookieB }))).status, 200);

  // 未登录 401；他人学生 403；归属只认会话。
  assert.equal((await call(handle, ctx(`/api/resources/${fileRes.id}`, { method: 'DELETE' }))).status, 401);
  const forbidden = await call(handle, ctx(`/api/resources/${fileRes.id}`, { method: 'DELETE', cookie: cookieB }));
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error, 'resource_forbidden');

  const deleted = await call(handle, ctx(`/api/resources/${fileRes.id}`, { method: 'DELETE', cookie: cookieA }));
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { deleted: true });
  assert.equal(storage.has(key), false, '删除应清理存储对象');

  // 详情/列表/下载/收藏全链路不可见。
  assert.equal((await call(handle, ctx(`/api/resources/${fileRes.id}`))).status, 404);
  const list = await call(handle, ctx('/api/resources'));
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].id, linkRes.id);
  assert.equal((await call(handle, ctx(`/api/resources/${fileRes.id}/file`, { cookie: cookieB }))).body.error, 'file_not_found');
  assert.equal((await call(handle, ctx(`/api/resources/${fileRes.id}/favorite`, { method: 'POST', cookie: cookieB }))).status, 404);
  assert.equal((await call(handle, ctx('/api/favorites', { cookie: cookieB }))).body.total, 0);
  assert.equal((await call(handle, ctx('/api/stats'))).body.stats.resources_total, 1);

  // 重复删除 404；软删除保留行与审计标记。
  assert.equal((await call(handle, ctx(`/api/resources/${fileRes.id}`, { method: 'DELETE', cookie: cookieA }))).status, 404);
  const dump = db.dump('resources');
  assert.equal(dump.length, 2, '软删除不物理删除');
  assert.ok(dump.find((r) => r.id === fileRes.id).deleted_at, '应记录删除时间');

  // 链接型资料同样可删，不涉及存储。
  assert.equal((await call(handle, ctx(`/api/resources/${linkRes.id}`, { method: 'DELETE', cookie: cookieA }))).status, 200);
  assert.equal((await call(handle, ctx('/api/resources'))).body.total, 0);
  assert.equal((await call(handle, ctx('/api/stats'))).body.stats.resources_total, 0);
});

test('阶段5内容管理：管理员可下架任意资料；CSRF 覆盖 DELETE；错误方法 405', async () => {
  const { handle, cookie: adminCookie } = await adminFixture();
  const studentCookie = cookiePair(await register(handle, uniqueName()));
  const res = (await call(handle, ctx('/api/resources', { method: 'POST', cookie: studentCookie, body: { ...FILE_BODY, source_url: 'https://example.edu.cn/y' } }))).body.resource;

  const evil = await call(handle, ctx(`/api/resources/${res.id}`, { method: 'DELETE', cookie: adminCookie, origin: 'https://evil.test' }));
  assert.equal(evil.status, 403);
  assert.equal(evil.body.error, 'origin_forbidden');

  const taken = await call(handle, ctx(`/api/resources/${res.id}`, { method: 'DELETE', cookie: adminCookie }));
  assert.equal(taken.status, 200);
  assert.equal((await call(handle, ctx('/api/resources'))).body.total, 0);
  assert.equal((await call(handle, ctx(`/api/resources/${res.id}`))).status, 404);
  assert.equal((await call(handle, ctx(`/api/resources/${res.id}`, { method: 'PUT', cookie: adminCookie }))).status, 405);
});