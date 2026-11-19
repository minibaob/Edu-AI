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

// 每次运行生成的临时口令，不在任何输出中打印；测试结束即丢弃。
const PASSWORD = `pw-${crypto.randomUUID()}-${crypto.randomUUID()}`;

function fixture() {
  const control = { mode: 'ok', dropTable: null, writes: [] };
  const db = createFakeDb(control);
  const handle = createApplication({ db, origin: PUBLIC_ORIGIN });
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

// ---- 模块5：高校与录取数据（公开读） ----
// 种子数据只存在于测试用的假数据库中，不进入生产库；分数/位次为测试值。

async function seedUniversities(db) {
  const now = new Date().toISOString();
  await db.from('universities').insertIfAbsent({
    code: '90001', name: '测试大学A', province: '河北', city: '测试市', type: '综合', level: '本科',
    tags: '公办|双一流', admission_url: 'https://example-a.edu.cn', source: '测试来源', note: null, created_at: now,
  }, { onConflict: 'code' });
  await db.from('universities').insertIfAbsent({
    code: '90002', name: '测试大学B', province: '河南', city: null, type: '理工', level: '本科',
    tags: '民办', admission_url: null, source: '测试来源', note: null, created_at: now,
  }, { onConflict: 'code' });
  await db.from('admission_scores').insertIfAbsent({
    id: crypto.randomUUID(), university_code: '90001', province: '河北', year: 2025, category: '物理类',
    batch: '本科批', subject_requirement: '物理+化学', min_score: 600, min_rank: 12345, admitted_count: 30,
    source: '测试来源', note: null, created_at: now,
  }, { onConflict: 'id' });
  await db.from('admission_scores').insertIfAbsent({
    id: crypto.randomUUID(), university_code: '90001', province: '河北', year: 2024, category: '历史类',
    batch: '本科批', subject_requirement: null, min_score: null, min_rank: null, admitted_count: null,
    source: '测试来源', note: null, created_at: now,
  }, { onConflict: 'id' });
  await db.from('enrollment_plans').insertIfAbsent({
    id: crypto.randomUUID(), university_code: '90001', province: '河北', year: 2025, major_code: null,
    major_name: '测试专业', batch: '本科批', subject_requirement: null, plan_count: 10, tuition: 5000,
    source: '测试来源', note: null, created_at: now,
  }, { onConflict: 'id' });
}

test('高校列表：空库、关键词、枚举筛选与分页', async () => {
  const { handle } = fixture();
  const empty = await call(handle, ctx('/api/universities'));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { total: 0, items: [] });

  const { db, handle: h2 } = fixture();
  await seedUniversities(db);
  const all = await call(h2, ctx('/api/universities'));
  assert.equal(all.body.total, 2);
  assert.equal(all.body.items[0].name, '测试大学A');
  assert.deepEqual(all.body.items[0].tags, ['公办', '双一流']);

  const byQ = await call(h2, ctx('/api/universities?q=%E5%A4%A7%E5%AD%A6B'));
  assert.equal(byQ.body.total, 1);
  assert.equal(byQ.body.items[0].code, '90002');

  const byProvince = await call(h2, ctx('/api/universities?province=%E6%B2%B3%E5%8D%97'));
  assert.equal(byProvince.body.total, 1);
  const byType = await call(h2, ctx('/api/universities?type=%E7%90%86%E5%B7%A5'));
  assert.equal(byType.body.total, 1);
  const byTag = await call(h2, ctx('/api/universities?tag=%E5%8F%8C%E4%B8%80%E6%B5%81'));
  assert.equal(byTag.body.total, 1);

  const page = await call(h2, ctx('/api/universities?limit=1&offset=1'));
  assert.equal(page.body.total, 2);
  assert.equal(page.body.items.length, 1);
  assert.equal(page.body.items[0].code, '90002');
});

test('高校列表：非法筛选参数返回 400', async () => {
  const { handle } = fixture();
  for (const query of ['limit=0', 'limit=101', 'limit=abc', 'offset=-1', 'province=火星', 'type=不存在', 'level=研究生', 'tag=藤校', 'q=' + 'x'.repeat(51)]) {
    const res = await call(handle, ctx(`/api/universities?${query}`));
    assert.equal(res.status, 400, query);
    assert.equal(res.body.error, 'invalid_filter');
  }
});

test('高校详情：分数/计划按年份倒序，空字段为 null，未知代码 404', async () => {
  const { db, handle } = fixture();
  await seedUniversities(db);
  const detail = await call(handle, ctx('/api/universities/90001'));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.university.name, '测试大学A');
  assert.equal(detail.body.scores.length, 2);
  assert.equal(detail.body.scores[0].year, 2025);
  assert.equal(detail.body.scores[0].min_score, 600);
  assert.equal(detail.body.scores[1].min_score, null, '空字段必须返回 null，前端显示暂无数据');
  assert.equal(detail.body.scores[1].min_rank, null);
  assert.equal(detail.body.plans.length, 1);
  assert.equal(detail.body.plans[0].major_name, '测试专业');
  assert.equal(detail.body.plans[0].tuition, 5000);

  const missing = await call(handle, ctx('/api/universities/99998'));
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'not_found');
  assert.equal((await call(handle, ctx('/api/universities/!!!'))).status, 404);
  assert.equal((await call(handle, ctx('/api/universities/90001', { method: 'POST', body: {} }))).status, 405);
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
    [{ ...RESOURCE_BODY, file_name: 'a.pdf', file_size: 123, mime: 'application/pdf' }, 'file_upload_unavailable'],
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

test('测评记录：只看自己的，A/B 隔离', async () => {
  const { handle } = fixture();
  const cookieA = cookiePair(await register(handle, uniqueName()));
  const cookieB = cookiePair(await register(handle, uniqueName()));
  await call(handle, ctx('/api/assessments', { method: 'POST', cookie: cookieA, body: { answers: Array(24).fill(3) } }));

  const listA = await call(handle, ctx('/api/assessments', { cookie: cookieA }));
  assert.equal(listA.body.total, 1);
  assert.deepEqual(listA.body.items[0].scores, { R: 50, I: 50, A: 50, S: 50, E: 50, C: 50 });
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
// ---- 模块3：首页统计（真实计数，空数据如实显示） ----

test('首页统计：公开读；未登录时个人计数为 null；计数反映真实行数', async () => {
  const { db, handle } = fixture();

  const anon = await call(handle, ctx('/api/stats'));
  assert.equal(anon.status, 200);
  assert.deepEqual(anon.body.stats, {
    resources_total: 0,
    universities_total: 0,
    favorites_count: null,
    assessments_count: null,
  });

  const created = await register(handle, uniqueName());
  const cookie = cookiePair(created);
  const userId = created.body.user.id;
  const mine = await call(handle, ctx('/api/stats', { cookie }));
  assert.deepEqual(mine.body.stats, {
    resources_total: 0,
    universities_total: 0,
    favorites_count: 0,
    assessments_count: 0,
  });

  // 直接向假数据库写入行，验证计数逻辑（模块 4/5/6 的写入接口在各自的分
  // 支上测试，这里只测统计本身）。
  await db.from('resources').insertIfAbsent({ id: 'r1', title: '资料一' }, { onConflict: 'id' });
  await db.from('resources').insertIfAbsent({ id: 'r2', title: '资料二' }, { onConflict: 'id' });
  await db.from('universities').insertIfAbsent({ id: 'u1', code: '10001' }, { onConflict: 'id' });
  await db.from('favorites').insertIfAbsent(
    { user_id: userId, resource_id: 'r1', created_at: new Date().toISOString() },
    { onConflict: 'user_id,resource_id' }
  );
  await db.from('favorites').insertIfAbsent(
    { user_id: userId, resource_id: 'r2', revoked_at: new Date().toISOString(), created_at: new Date().toISOString() },
    { onConflict: 'user_id,resource_id' }
  );
  await db.from('assessment_results').insertIfAbsent(
    { id: 'a1', user_id: userId, answers: '[]', scores: '{}', top_types: '[]', created_at: new Date().toISOString() },
    { onConflict: 'id' }
  );

  const counted = await call(handle, ctx('/api/stats', { cookie }));
  assert.deepEqual(counted.body.stats, {
    resources_total: 2,
    universities_total: 1,
    favorites_count: 1, // 已取消收藏的那条不计入
    assessments_count: 1,
  });

  // 别人的收藏不计入自己的统计；错误方法 405。
  const other = await register(handle, uniqueName());
  const otherStats = await call(handle, ctx('/api/stats', { cookie: cookiePair(other) }));
  assert.equal(otherStats.body.stats.favorites_count, 0);
  assert.equal(otherStats.body.stats.assessments_count, 0);
  assert.equal((await call(handle, ctx('/api/stats', { method: 'POST', body: {} }))).status, 405);
});