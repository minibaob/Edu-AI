// EduAI 应用路由：注册 / 登录 / 退出 / 当前用户 / 个人资料 / 修改密码。
// 应用身份一律来自本应用自己的会话校验（数据库中的会话摘要），
// 绝不使用 ctx.user、平台身份、Host 头或浏览器提交的 owner_id。
import { AppError, applicationPath, errorJson, json, readJson, requireTrustedOrigin, rows } from './http.mjs';
import { canonicalUsername, validatePassword, validateProfile } from './validate.mjs';
import { hashPassword, verifyPassword, verifyPasswordAgainstDummy } from './passwords.mjs';
import { SESSION_TTL_MS, clearSessionCookie, createSession, revokeSession, sessionCookie, validateSession } from './sessions.mjs';
import { consume } from './limiter.mjs';

const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
const encoder = new TextEncoder();
const USER_COLUMNS = 'id,username,display_name,grade,province,subjects,role,created_at';
const CREDENTIAL_COLUMNS = 'id,username,password_salt,password_hash,password_iterations';

class SessionRequired extends Error {
  constructor(state) {
    super('login_required');
    this.state = state;
  }
}

const retryAfter = (result) => ({ 'retry-after': String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) });

// Cookie 存在但无效（过期 / 已撤销 / 被篡改）时顺手清掉，避免浏览器一直带着失效凭据。
function unauthorized(state) {
  return state === 'invalid'
    ? errorJson('login_required', 401, { 'set-cookie': clearSessionCookie() })
    : errorJson('login_required', 401);
}

async function requireSession(db, request) {
  const result = await validateSession(db, request);
  if (result.state !== 'valid') throw new SessionRequired(result.state);
  return result.session;
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name ?? null,
    grade: row.grade ?? null,
    province: row.province ?? null,
    subjects: row.subjects ? JSON.parse(row.subjects) : [],
    role: row.role,
    created_at: row.created_at,
  };
}

// 会话凭据只在服务端校验；用户资料单独读取（会话表里只有摘要、用户 ID 与时间）。
async function loadUser(db, userId, columns = USER_COLUMNS) {
  const found = rows(await db.from('users').select(columns).eq('id', userId).limit(1));
  if (found.length !== 1 || typeof found[0]?.username !== 'string') {
    throw new SessionRequired('invalid');
  }
  return found[0];
}

function boundedPassword(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || encoder.encode(raw).length > 256) {
    throw new AppError('invalid_input', 400);
  }
  return raw;
}

async function register(db, request) {
  const body = await readJson(request);
  const username = canonicalUsername(body?.username);
  const password = validatePassword(body?.password);
  const profile = validateProfile(body);
  // 注册同样受限流约束（按规范化用户名计数）。
  const limit = await consume(db, 'register', username);
  if (!limit.allowed) return errorJson('rate_limited', 429, retryAfter(limit));

  const existing = rows(await db.from('users').select('id').eq('username', username).limit(1));
  if (existing.length > 0) return errorJson('username_taken', 409);

  const derived = await hashPassword(password);
  const id = crypto.randomUUID();
  // 唯一性由数据库在 username 上判定：并发注册同名时只有一个写入者成功。
  const created = rows(await db.from('users').insertIfAbsent({
    id,
    username,
    password_salt: derived.salt,
    password_hash: derived.hash,
    password_iterations: derived.iterations,
    role: 'student',
    ...profile,
    created_at: new Date().toISOString(),
  }, { onConflict: 'username' }).select(USER_COLUMNS));

  if (created.length !== 1) {
    const winner = rows(await db.from('users').select('id').eq('username', username).limit(1));
    if (winner.length === 1) return errorJson('username_taken', 409);
    // 既没写成、也读不到同名记录：结果无法确认，不做任何重放。
    return errorJson('registration_unconfirmed', 503);
  }

  const { token } = await createSession(db, id);
  return json({ user: publicUser(created[0]) }, 201, { 'set-cookie': sessionCookie(token, SESSION_TTL_SECONDS) });
}

async function login(db, request) {
  const body = await readJson(request);
  const username = canonicalUsername(body?.username);
  // 先消费配额：对不存在的账号同样计数，避免用失败次数探测账号是否存在。
  const limit = await consume(db, 'login', username);
  if (!limit.allowed) return errorJson('rate_limited', 429, retryAfter(limit));

  const password = boundedPassword(body?.password);
  const found = rows(await db.from('users').select(CREDENTIAL_COLUMNS).eq('username', username).limit(1));

  if (found.length !== 1) {
    // 用户名不存在时也付出同等计算代价，再返回与密码错误相同的错误码。
    await verifyPasswordAgainstDummy(password);
    return errorJson('invalid_credentials', 401);
  }

  const user = found[0];
  const ok = await verifyPassword(password, {
    salt: user.password_salt, hash: user.password_hash, iterations: user.password_iterations,
  });
  if (!ok) return errorJson('invalid_credentials', 401);

  // 成功登录不重置窗口计数：固定窗口内已消费的配额继续累计。
  const { token } = await createSession(db, user.id);
  const profile = await loadUser(db, user.id);
  return json({ user: publicUser(profile) }, 200, { 'set-cookie': sessionCookie(token, SESSION_TTL_SECONDS) });
}

async function logout(db, request) {
  const result = await validateSession(db, request);
  if (result.state === 'valid' && result.session) {
    try {
      await revokeSession(db, result.session.digest);
    } catch {
      // 撤销结果未知：保留 Cookie，让用户可以在会话仍有效时重试退出；不重放、不谎报成功。
      return errorJson('logout_unconfirmed', 503);
    }
  }
  // 先撤销数据库会话，再清除 Cookie。
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}

async function updateProfile(db, request, session) {
  const body = await readJson(request);
  const profile = validateProfile(body);
  const updated = rows(await db.from('users').update(profile)
    .eq('id', session.userId).select(USER_COLUMNS));
  if (updated.length !== 1) return errorJson('profile_unconfirmed', 503);
  return json({ user: publicUser(updated[0]) });
}

async function changePassword(db, request, session) {
  const body = await readJson(request);
  const current = boundedPassword(body?.current_password);
  const next = validatePassword(body?.new_password);
  const user = await loadUser(db, session.userId, `${CREDENTIAL_COLUMNS},username`);

  const limit = await consume(db, 'password', user.username);
  if (!limit.allowed) return errorJson('rate_limited', 429, retryAfter(limit));

  const ok = await verifyPassword(current, {
    salt: user.password_salt, hash: user.password_hash, iterations: user.password_iterations,
  });
  if (!ok) return errorJson('invalid_credentials', 401);

  const derived = await hashPassword(next);
  const updated = rows(await db.from('users').update({
    password_salt: derived.salt, password_hash: derived.hash, password_iterations: derived.iterations,
  }).eq('id', session.userId).select('id'));
  if (updated.length !== 1) return errorJson('password_unconfirmed', 503);
  return json({ ok: true });
}

async function route(db, request, origin) {
  requireTrustedOrigin(request, origin);
  const path = applicationPath(request);

  if (path === '/api/health' && request.method === 'GET') return json({ ok: true });
  if (path === '/api/register' && request.method === 'POST') return register(db, request);
  if (path === '/api/login' && request.method === 'POST') return login(db, request);
  if (path === '/api/logout' && request.method === 'POST') return logout(db, request);

  if (path === '/api/me' && request.method === 'GET') {
    const session = await requireSession(db, request);
    return json({ user: publicUser(await loadUser(db, session.userId)) });
  }

  if (path === '/api/profile' && request.method === 'POST') {
    const session = await requireSession(db, request);
    return updateProfile(db, request, session);
  }

  if (path === '/api/password' && request.method === 'POST') {
    const session = await requireSession(db, request);
    return changePassword(db, request, session);
  }

  if (['/api/me', '/api/profile', '/api/password', '/api/logout', '/api/register', '/api/login', '/api/health'].includes(path)) {
    throw new AppError('method_not_allowed', 405);
  }
  throw new AppError('not_found', 404);
}

// 依赖注入只用于本地测试；ctx 只用于取 request，不使用其中的平台身份。
export function createApplication({ db, origin }) {
  return async function handle(ctx) {
    try {
      return await route(db, ctx.request, typeof origin === 'function' ? origin() : origin);
    } catch (error) {
      if (error instanceof SessionRequired) return unauthorized(error.state);
      if (error instanceof AppError) return errorJson(error.code, error.status);
      return errorJson('service_unavailable', 503);
    }
  };
}