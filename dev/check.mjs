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

// ---- 模块6：兴趣测评（固定规则计分） ----
import { QUESTIONS, computeResult, validateAnswers } from '../functions/assessment.mjs';

const allAnswers = (value) => Object.fromEntries(QUESTIONS.map((q) => [q.id, value]));
const dimAnswers = (dim, value) => Object.fromEntries(QUESTIONS.map((q) => [q.id, q.dim === dim ? value : 0]));
const submit = (handle, cookie, answers) => call(handle, ctx('/api/assessment/submit', { method: 'POST', cookie, body: { answers } }));
const latest = (handle, cookie) => call(handle, ctx('/api/assessment/latest', { cookie }));
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

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

  // 同一账号再做霍兰德：两种测评的 latest 互不干扰。
  await tick();
  const riasec = await submit(handle, cookie, dimAnswers('A', 2));
  assert.equal(riasec.status, 201);
  assert.equal((await latest(handle, cookie)).body.result.code[0], 'A');
  assert.equal((await mbtiLatest(handle, cookie)).body.result.code, 'INFP');
  assert.equal(db.dump('assessments').length, 3);
  assert.equal(db.dump('assessments').filter((row) => row.kind === 'riasec').length, 1);

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

test('模块5：匿名查询空库返回空索引；未知院校代码 404', async () => {
  const { handle } = fixture();
  const list = await call(handle, ctx('/api/universities'));
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.universities, []);
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
  assert.deepEqual(list.body.universities, [{ code: '10003', name: '清华大学' }]);
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
  const { handle, cookie } = await adminFixture();
  const index = Array.from({ length: 300 }, (_, i) => ({ code: `C${i}`, name: `示例院校名称较长用于超出默认正文上限${i}` }));
  const saved = await postMeta(handle, cookie, { key: 'universities_index', value: index });
  assert.equal(saved.status, 200, '院校索引不受默认 8KB 正文上限限制');
  const list = await call(handle, ctx('/api/universities'));
  assert.equal(list.body.universities.length, 300);
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