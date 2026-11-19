// EduAI 应用路由：注册 / 登录 / 退出 / 当前用户 / 个人资料 / 修改密码 / 兴趣测评。
// 应用身份一律来自本应用自己的会话校验（数据库中的会话摘要），
// 绝不使用 ctx.user、平台身份、Host 头或浏览器提交的 owner_id。
import { AppError, applicationPath, errorJson, json, readJson, requireTrustedOrigin, rows } from './http.mjs';
import { canonicalUsername, validatePassword, validateProfile } from './validate.mjs';
import { hashPassword, verifyPassword, verifyPasswordAgainstDummy } from './passwords.mjs';
import { SESSION_TTL_MS, SessionRequired, clearSessionCookie, createSession, requireSession, revokeSession, sessionCookie, unauthorized, validateSession } from './sessions.mjs';
import { consume } from './limiter.mjs';
import { OPTIONS, QUESTIONS, computeResult, publicResult, validateAnswers } from './assessment.mjs';
import {
  OPTIONS as MBTI_OPTIONS, QUESTIONS as MBTI_QUESTIONS,
  computeResult as computeMbti, publicResult as mbtiPublicResult, validateAnswers as validateMbtiAnswers,
} from './mbti.mjs';
import { importChunk, listUniversities, readMeta, universityDetail, updateMeta } from './universities.mjs';
import { createResource, favoriteResource, getResource, listFavorites, listResources, unfavoriteResource } from './resources.mjs';

const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
const encoder = new TextEncoder();
const USER_COLUMNS = 'id,username,display_name,grade,province,subjects,role,created_at';
const CREDENTIAL_COLUMNS = 'id,username,password_salt,password_hash,password_iterations';

const retryAfter = (result) => ({ 'retry-after': String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) });

// 管理员 = 应用会话 + 数据库 role=admin（由所有者通过平台工具授予）；不使用平台身份。
async function requireAdmin(db, request) {
  const session = await requireSession(db, request);
  const user = await loadUser(db, session.userId);
  if (user.role !== 'admin') throw new AppError('admin_required', 403);
  return session;
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

async function submitAssessment(db, request, session, kind, validate, compute, toPublic) {
  const body = await readJson(request);
  const answers = validate(body);
  const { scores, code } = compute(answers);
  const id = crypto.randomUUID();
  let created;
  try {
    created = rows(await db.from('assessments').insertIfAbsent({
      id,
      user_id: session.userId,
      kind,
      answers: JSON.stringify(answers),
      scores: JSON.stringify(scores),
      code,
      created_at: new Date().toISOString(),
    }, { onConflict: 'id' }).select('id,kind,code,scores,created_at'));
  } catch (error) {
    // 数据层明确拒绝保留 database_unavailable；响应丢失等未知结果不重放、不谎报成功。
    if (error instanceof AppError) throw error;
    return errorJson('assessment_unconfirmed', 503);
  }
  if (created.length !== 1) return errorJson('assessment_unconfirmed', 503);
  return json({ result: toPublic(created[0]) }, 201);
}

async function latestAssessment(db, session, kind, toPublic) {
  const found = rows(await db.from('assessments').select('id,kind,code,scores,created_at')
    .eq('user_id', session.userId).eq('kind', kind)
    .order('created_at', { ascending: false }).limit(1));
  return json({ result: found.length === 1 ? toPublic(found[0]) : null });
}

// ---- 模块3：首页统计（公开读；个人计数只在登录后返回） ----
// 适配器无 count 能力：按读取上限 500 行计数，触顶时 capped=true，前端显示「500+」，
// 不把截断值当真实总数。院校总数用导入元数据里的精确计数。表未迁移或查询失败返回 null。
const COUNT_LIMIT = 500;

async function countRows(db, table, filters = {}) {
  try {
    let query = db.from(table).select('id').limit(COUNT_LIMIT);
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
    return rows(await query).length;
  } catch {
    return null;
  }
}

async function stats(db, request) {
  const session = await validateSession(db, request);
  const userId = session.state === 'valid' ? session.session.userId : null;
  const resourcesTotal = await countRows(db, 'resources');
  let universitiesTotal = null;
  try {
    const counts = await readMeta(db, 'counts');
    if (counts && typeof counts.universities === 'number') universitiesTotal = counts.universities;
  } catch {
    universitiesTotal = null;
  }
  let favoritesCount = null;
  let favoritesCapped = false;
  let assessmentsCount = null;
  let assessmentsCapped = false;
  if (userId) {
    try {
      // favorites 是复合主键（无 id 列），只取判定撤销所需的列。
      const mine = rows(await db.from('favorites').select('resource_id,revoked_at')
        .eq('user_id', userId).limit(COUNT_LIMIT));
      favoritesCapped = mine.length === COUNT_LIMIT;
      favoritesCount = mine.filter((row) => row.revoked_at == null).length;
    } catch {
      favoritesCount = null;
    }
    assessmentsCount = await countRows(db, 'assessments', { user_id: userId });
    assessmentsCapped = assessmentsCount === COUNT_LIMIT;
  }
  return json({
    stats: {
      resources_total: resourcesTotal,
      resources_capped: resourcesTotal === COUNT_LIMIT,
      universities_total: universitiesTotal,
      favorites_count: favoritesCount,
      favorites_capped: favoritesCapped,
      assessments_count: assessmentsCount,
      assessments_capped: assessmentsCapped,
    },
  });
}

// ---- 模块7：个人中心测评记录（霍兰德 + MBTI 简化版，只看自己的） ----
async function listAssessmentHistory(db, session) {
  const found = rows(await db.from('assessments').select('id,kind,code,scores,created_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false }).limit(50));
  const items = found.map((row) => {
    const kind = row.kind ?? 'riasec';
    const scores = typeof row.scores === 'string' ? JSON.parse(row.scores) : row.scores;
    return {
      id: row.id,
      kind,
      code: row.code,
      scores,
      top_types: kind === 'mbti' ? [row.code] : String(row.code).split(''),
      created_at: row.created_at,
    };
  });
  return json({ total: items.length, items });
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

  if (path === '/api/assessment/questions' && request.method === 'GET') {
    await requireSession(db, request);
    return json({ questions: QUESTIONS.map(({ id, text }) => ({ id, text })), options: OPTIONS });
  }

  if (path === '/api/assessment/submit' && request.method === 'POST') {
    const session = await requireSession(db, request);
    return submitAssessment(db, request, session, 'riasec', validateAnswers, computeResult, publicResult);
  }

  if (path === '/api/assessment/latest' && request.method === 'GET') {
    const session = await requireSession(db, request);
    return latestAssessment(db, session, 'riasec', publicResult);
  }

  if (path === '/api/mbti/questions' && request.method === 'GET') {
    await requireSession(db, request);
    return json({ questions: MBTI_QUESTIONS.map(({ id, text, a, b }) => ({ id, text, a, b })), options: MBTI_OPTIONS });
  }

  if (path === '/api/mbti/submit' && request.method === 'POST') {
    const session = await requireSession(db, request);
    return submitAssessment(db, request, session, 'mbti', validateMbtiAnswers, computeMbti, mbtiPublicResult);
  }

  if (path === '/api/mbti/latest' && request.method === 'GET') {
    const session = await requireSession(db, request);
    return latestAssessment(db, session, 'mbti', mbtiPublicResult);
  }

  // 模块3/4/7：首页统计公开读；资料读公开、写登录；收藏与测评记录登录且只看自己的。
  if (path === '/api/stats' && request.method === 'GET') return stats(db, request);

  if (path === '/api/resources' && request.method === 'GET') return listResources(db, request);
  if (path === '/api/resources' && request.method === 'POST') {
    const session = await requireSession(db, request);
    return createResource(db, request, session);
  }
  if (path === '/api/favorites' && request.method === 'GET') {
    const session = await requireSession(db, request);
    return listFavorites(db, request, session);
  }
  if (path === '/api/assessments' && request.method === 'GET') {
    const session = await requireSession(db, request);
    return listAssessmentHistory(db, session);
  }
  const resourceAction = path.match(/^\/api\/resources\/([0-9a-f-]{36})\/(favorite|unfavorite)$/);
  if (resourceAction && request.method === 'POST') {
    const session = await requireSession(db, request);
    return resourceAction[2] === 'favorite'
      ? favoriteResource(db, request, session, resourceAction[1])
      : unfavoriteResource(db, request, session, resourceAction[1]);
  }
  const resourceDetail = path.match(/^\/api\/resources\/([0-9a-f-]{36})$/);
  if (resourceDetail && request.method === 'GET') return getResource(db, request, resourceDetail[1]);

  // 模块5：匿名只读查询。
  if (path === '/api/universities' && request.method === 'GET') return listUniversities(db);
  const detailMatch = path.match(/^\/api\/universities\/([A-Za-z0-9]{1,32})$/);
  if (detailMatch && request.method === 'GET') {
    const yearParam = new URL(request.url).searchParams.get('year');
    let planYear = null;
    if (yearParam !== null) {
      if (!/^\d{4}$/.test(yearParam)) throw new AppError('invalid_input', 400);
      planYear = Number(yearParam);
    }
    return universityDetail(db, detailMatch[1], planYear);
  }

  // 模块5：管理员导入（应用会话 role=admin）。
  if (path === '/api/admin/import' && request.method === 'POST') {
    await requireAdmin(db, request);
    return importChunk(db, request);
  }
  if (path === '/api/admin/meta' && request.method === 'POST') {
    await requireAdmin(db, request);
    return updateMeta(db, request);
  }

  if (['/api/me', '/api/profile', '/api/password', '/api/logout', '/api/register', '/api/login', '/api/health',
    '/api/assessment/questions', '/api/assessment/submit', '/api/assessment/latest',
    '/api/mbti/questions', '/api/mbti/submit', '/api/mbti/latest',
    '/api/universities', '/api/admin/import', '/api/admin/meta',
    '/api/stats', '/api/resources', '/api/favorites', '/api/assessments'].includes(path)
    || /^\/api\/resources\/[0-9a-f-]{36}(\/(favorite|unfavorite))?$/.test(path)) {
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