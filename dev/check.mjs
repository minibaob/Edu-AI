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