// EduAI 应用路由：注册 / 登录 / 退出 / 当前用户 / 个人资料 / 修改密码。
// 应用身份一律来自本应用自己的会话校验（数据库中的会话摘要），
// 绝不使用 ctx.user、平台身份、Host 头或浏览器提交的 owner_id。
import { AppError, applicationPath, errorJson, json, readJson, requireTrustedOrigin, rows } from './http.mjs';
import { canonicalUsername, validatePassword, validateProfile } from './validate.mjs';
import { isUuid, parseListQuery, parseMajorQuery, parseUniversityQuery, validateResourceInput, validateUniversityCode } from './validate.mjs';
import { GRADES, RESOURCE_TYPES, SUBJECTS } from './validate.mjs';
import { scoreAssessment, validateAnswers } from './assessment.mjs';
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

// ---- 首页统计：公开读；个人计数只在登录后返回 ----
// 计数上限 500 行（假数据库/适配器按读取上限截断）；表尚未迁移或查询失败时
// 该项返回 null，前端显示「暂无数据」，不让整个接口 500。
async function countRows(db, table, filters = {}) {
  try {
    let query = db.from(table).select('id').limit(500);
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
  const universitiesTotal = await countRows(db, 'universities');
  let favoritesCount = null;
  let assessmentsCount = null;
  if (userId) {
    try {
      const mine = rows(await db.from('favorites').select('id,revoked_at').eq('user_id', userId).limit(500));
      favoritesCount = mine.filter((row) => row.revoked_at == null).length;
    } catch {
      favoritesCount = null;
    }
    assessmentsCount = await countRows(db, 'assessment_results', { user_id: userId });
  }
  return json({
    stats: {
      resources_total: resourcesTotal,
      universities_total: universitiesTotal,
      favorites_count: favoritesCount,
      assessments_count: assessmentsCount,
    },
  });
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

// ---- 模块5：高校与录取数据（公开读接口，无需登录） ----
// 数据层适配器只提供等值筛选：先按可等值条件取数（上限 500 行），再在内存中做
// 关键词/枚举筛选与分页。首期数据量小（试点两省），该做法够用；数据量上千后
// 应改由数据库端筛选（见改进建议）。空字段一律返回 null，前端显示「暂无数据」。
const READ_LIMIT = 500;
const UNIVERSITY_COLUMNS = 'code,name,province,city,type,level,tags,admission_url,source,note';
const MAJOR_COLUMNS = 'code,name,category,years,degree,source,note';
const SCORE_COLUMNS = 'id,university_code,province,year,category,batch,subject_requirement,min_score,min_rank,admitted_count,source,note';
const PLAN_COLUMNS = 'id,university_code,province,year,major_code,major_name,batch,subject_requirement,plan_count,tuition,source,note';

async function fetchAll(db, table, columns) {
  return rows(await db.from(table).select(columns).limit(READ_LIMIT));
}

function splitTags(value) {
  if (typeof value !== 'string' || value === '') return [];
  return value.split('|').map((t) => t.trim()).filter(Boolean);
}

function publicUniversity(row) {
  return {
    code: row.code,
    name: row.name,
    province: row.province,
    city: row.city ?? null,
    type: row.type,
    level: row.level,
    tags: splitTags(row.tags),
    admission_url: row.admission_url ?? null,
    source: row.source,
    note: row.note ?? null,
  };
}

function publicMajor(row) {
  return {
    code: row.code,
    name: row.name,
    category: row.category,
    years: row.years,
    degree: row.degree ?? null,
    source: row.source,
    note: row.note ?? null,
  };
}

function byYearDesc(a, b) {
  return (b.year - a.year) || String(a.province).localeCompare(String(b.province), 'zh')
    || String(a.category ?? a.major_name ?? '').localeCompare(String(b.category ?? b.major_name ?? ''), 'zh')
    || String(a.batch ?? '').localeCompare(String(b.batch ?? ''), 'zh');
}

async function listUniversities(db, request) {
  const query = parseUniversityQuery(new URL(request.url).search);
  const all = await fetchAll(db, 'universities', UNIVERSITY_COLUMNS);
  const needle = query.q.toLowerCase();
  const filtered = all.filter((row) => {
    if (query.province && row.province !== query.province) return false;
    if (query.type && row.type !== query.type) return false;
    if (query.level && row.level !== query.level) return false;
    if (query.tag && !splitTags(row.tags).includes(query.tag)) return false;
    if (needle && !(String(row.name).toLowerCase().includes(needle) || String(row.code).toLowerCase().includes(needle))) return false;
    return true;
  });
  filtered.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  const total = filtered.length;
  const items = filtered.slice(query.offset, query.offset + query.limit).map(publicUniversity);
  return json({ total, items });
}

async function getUniversity(db, code) {
  validateUniversityCode(code);
  const found = rows(await db.from('universities').select(UNIVERSITY_COLUMNS).eq('code', code).limit(1));
  if (found.length !== 1) throw new AppError('not_found', 404);
  const scores = (await fetchAll(db, 'admission_scores', SCORE_COLUMNS))
    .filter((row) => row.university_code === code)
    .sort(byYearDesc)
    .map((row) => ({
      id: row.id, province: row.province, year: row.year, category: row.category,
      batch: row.batch, subject_requirement: row.subject_requirement ?? null,
      min_score: row.min_score ?? null, min_rank: row.min_rank ?? null,
      admitted_count: row.admitted_count ?? null, source: row.source, note: row.note ?? null,
    }));
  const plans = (await fetchAll(db, 'enrollment_plans', PLAN_COLUMNS))
    .filter((row) => row.university_code === code)
    .sort(byYearDesc)
    .map((row) => ({
      id: row.id, province: row.province, year: row.year, major_code: row.major_code ?? null,
      major_name: row.major_name, batch: row.batch ?? null,
      subject_requirement: row.subject_requirement ?? null, plan_count: row.plan_count ?? null,
      tuition: row.tuition ?? null, source: row.source, note: row.note ?? null,
    }));
  return json({ university: publicUniversity(found[0]), scores, plans });
}

async function listMajors(db, request) {
  const query = parseMajorQuery(new URL(request.url).search);
  const all = await fetchAll(db, 'majors', MAJOR_COLUMNS);
  const needle = query.q.toLowerCase();
  const filtered = all.filter((row) => {
    if (query.category && row.category !== query.category) return false;
    if (needle && !(String(row.name).toLowerCase().includes(needle) || String(row.code).toLowerCase().includes(needle))) return false;
    return true;
  });
  filtered.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
  const total = filtered.length;
  const items = filtered.slice(query.offset, query.offset + query.limit).map(publicMajor);
  return json({ total, items });
}
// ---- 模块4：学习资料库 ----
// 读接口公开；写接口（登记、收藏）必须登录，归属一律来自会话，绝不信任浏览器提交的 owner_id。
// 文件直传未接通：登记只接受来源链接型资料；file_* 字段由 validateResourceInput 拒绝。
const RESOURCE_COLUMNS = 'id,owner_id,title,grade,subject,type,source_url,source_name,description,file_name,file_size,mime,storage_key,copyright_confirmed,created_at';
const FAVORITE_COLUMNS = 'user_id,resource_id,created_at,revoked_at';

function publicResource(row, favorited = false) {
  return {
    id: row.id,
    owner_id: row.owner_id ?? null,
    title: row.title,
    grade: row.grade ?? null,
    subject: row.subject ?? null,
    type: row.type,
    source_url: row.source_url,
    source_name: row.source_name,
    description: row.description ?? null,
    file_name: row.file_name ?? null,
    file_size: row.file_size ?? null,
    mime: row.mime ?? null,
    copyright_confirmed: row.copyright_confirmed === true,
    favorited,
    created_at: row.created_at,
  };
}

function parseResourceQuery(request) {
  const params = new URLSearchParams(new URL(request.url).search);
  const base = parseListQuery(new URL(request.url).search);
  const pick = (name, allowed) => {
    const value = params.get(name);
    if (value === null || value === '') return null;
    if (!allowed.includes(value)) throw new AppError('invalid_filter', 400);
    return value;
  };
  return {
    ...base,
    grade: pick('grade', GRADES),
    subject: pick('subject', SUBJECTS),
    type: pick('type', RESOURCE_TYPES),
    mine: params.get('mine') === '1',
  };
}

async function listResources(db, request) {
  const query = parseResourceQuery(request);
  let mineUserId = null;
  if (query.mine) {
    const session = await requireSession(db, request);
    mineUserId = session.userId;
  }
  const all = rows(await db.from('resources').select(RESOURCE_COLUMNS).limit(500));
  const needle = query.q.toLowerCase();
  const filtered = all.filter((row) => {
    if (mineUserId !== null && row.owner_id !== mineUserId) return false;
    if (query.grade && row.grade !== query.grade) return false;
    if (query.subject && row.subject !== query.subject) return false;
    if (query.type && row.type !== query.type) return false;
    if (needle && !(String(row.title).toLowerCase().includes(needle)
      || String(row.description ?? '').toLowerCase().includes(needle)
      || String(row.source_name).toLowerCase().includes(needle))) return false;
    return true;
  });
  filtered.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const total = filtered.length;
  const items = filtered.slice(query.offset, query.offset + query.limit).map((row) => publicResource(row));
  return json({ total, items });
}

async function getResource(db, request, id) {
  if (!isUuid(id)) throw new AppError('not_found', 404);
  const found = rows(await db.from('resources').select(RESOURCE_COLUMNS).eq('id', id).limit(1));
  if (found.length !== 1) throw new AppError('not_found', 404);
  let favorited = false;
  try {
    const result = await validateSession(db, request);
    if (result.state === 'valid' && result.session) {
      const fav = rows(await db.from('favorites').select(FAVORITE_COLUMNS)
        .eq('user_id', result.session.userId).eq('resource_id', id).limit(1));
      favorited = fav.length === 1 && !fav[0].revoked_at;
    }
  } catch {
    favorited = false;
  }
  return json({ resource: publicResource(found[0], favorited) });
}

async function createResource(db, request, session) {
  const body = await readJson(request);
  const input = validateResourceInput(body);
  const id = crypto.randomUUID();
  const created = rows(await db.from('resources').insertIfAbsent({
    id,
    owner_id: session.userId,
    ...input,
    file_name: null,
    file_size: null,
    mime: null,
    storage_key: null,
    copyright_confirmed: true,
    created_at: new Date().toISOString(),
  }, { onConflict: 'id' }).select(RESOURCE_COLUMNS));
  if (created.length !== 1) return errorJson('resource_unconfirmed', 503);
  return json({ resource: publicResource(created[0]) }, 201);
}

async function favoriteResource(db, request, session, id) {
  if (!isUuid(id)) throw new AppError('not_found', 404);
  const found = rows(await db.from('resources').select('id').eq('id', id).limit(1));
  if (found.length !== 1) throw new AppError('not_found', 404);
  const inserted = rows(await db.from('favorites').insertIfAbsent({
    user_id: session.userId, resource_id: id, created_at: new Date().toISOString(), revoked_at: null,
  }, { onConflict: 'user_id,resource_id' }).select(FAVORITE_COLUMNS));
  if (inserted.length !== 1) {
    // 已收藏过（曾取消）：把撤销标记清掉，重新生效；只改自己的收藏。
    await db.from('favorites').update({ revoked_at: null })
      .eq('user_id', session.userId).eq('resource_id', id);
  }
  return json({ favorited: true });
}

async function unfavoriteResource(db, request, session, id) {
  if (!isUuid(id)) throw new AppError('not_found', 404);
  await db.from('favorites').update({ revoked_at: new Date().toISOString() })
    .eq('user_id', session.userId).eq('resource_id', id);
  return json({ favorited: false });
}

async function listFavorites(db, request, session) {
  const favs = rows(await db.from('favorites').select(FAVORITE_COLUMNS).eq('user_id', session.userId).limit(500));
  const active = favs.filter((f) => !f.revoked_at);
  const all = rows(await db.from('resources').select(RESOURCE_COLUMNS).limit(500));
  const byId = new Map(all.map((row) => [row.id, row]));
  const items = active
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((f) => byId.get(f.resource_id))
    .filter(Boolean)
    .map((row) => publicResource(row, true));
  return json({ total: items.length, items });
}
// ---- 模块6：兴趣测评记录（登录后保存/查看自己的记录） ----
// 分数由后端按固定规则从答案重算，不信任浏览器提交的分数。
const ASSESSMENT_COLUMNS = 'id,user_id,answers,scores,top_types,created_at';

async function saveAssessment(db, request, session) {
  const body = await readJson(request);
  const answers = validateAnswers(body?.answers);
  const { scores, top_types } = scoreAssessment(answers);
  const id = crypto.randomUUID();
  const created = rows(await db.from('assessment_results').insertIfAbsent({
    id,
    user_id: session.userId,
    answers: JSON.stringify(answers),
    scores: JSON.stringify(scores),
    top_types: JSON.stringify(top_types),
    created_at: new Date().toISOString(),
  }, { onConflict: 'id' }).select(ASSESSMENT_COLUMNS));
  if (created.length !== 1) return errorJson('assessment_unconfirmed', 503);
  const row = created[0];
  return json({
    assessment: {
      id: row.id, scores: JSON.parse(row.scores), top_types: JSON.parse(row.top_types), created_at: row.created_at,
    },
  }, 201);
}

async function listAssessments(db, request, session) {
  const all = rows(await db.from('assessment_results').select(ASSESSMENT_COLUMNS).eq('user_id', session.userId).limit(500));
  all.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const items = all.slice(0, 20).map((row) => ({
    id: row.id, scores: JSON.parse(row.scores), top_types: JSON.parse(row.top_types), created_at: row.created_at,
  }));
  return json({ total: all.length, items });
}

async function route(db, request, origin) {
  requireTrustedOrigin(request, origin);
  const path = applicationPath(request);

  if (path === '/api/health' && request.method === 'GET') return json({ ok: true });
  if (path === '/api/stats' && request.method === 'GET') return stats(db, request);
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

  if (path === '/api/universities' && request.method === 'GET') return listUniversities(db, request);
  const universityDetail = path.match(/^\/api\/universities\/([0-9A-Za-z]{1,10})$/);
  if (universityDetail && request.method === 'GET') return getUniversity(db, universityDetail[1]);
  if (path === '/api/majors' && request.method === 'GET') return listMajors(db, request);
  if (path === '/api/resources' && request.method === 'GET') return listResources(db, request);
  if (path === '/api/resources' && request.method === 'POST') {
    const session = await requireSession(db, request);
    return createResource(db, request, session);
  }
  if (path === '/api/favorites' && request.method === 'GET') {
    const session = await requireSession(db, request);
    return listFavorites(db, request, session);
  }
  const favoriteMatch = path.match(/^\/api\/resources\/([0-9a-f-]{36})\/(favorite|unfavorite)$/);
  if (favoriteMatch && request.method === 'POST') {
    const session = await requireSession(db, request);
    return favoriteMatch[2] === 'favorite'
      ? favoriteResource(db, request, session, favoriteMatch[1])
      : unfavoriteResource(db, request, session, favoriteMatch[1]);
  }
  const resourceDetail = path.match(/^\/api\/resources\/([0-9a-f-]{36})$/);
  if (resourceDetail && request.method === 'GET') return getResource(db, request, resourceDetail[1]);

  if (path === '/api/assessments' && request.method === 'GET') {
    const session = await requireSession(db, request);
    return listAssessments(db, request, session);
  }
  if (path === '/api/assessments' && request.method === 'POST') {
    const session = await requireSession(db, request);
    return saveAssessment(db, request, session);
  }

  if (['/api/me', '/api/profile', '/api/password', '/api/logout', '/api/register', '/api/login', '/api/health', '/api/universities', '/api/majors', '/api/resources', '/api/favorites', '/api/assessments', '/api/stats'].includes(path)
    || universityDetail || resourceDetail || favoriteMatch) {
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