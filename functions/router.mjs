// EduAI 应用路由：注册 / 登录 / 退出 / 当前用户 / 个人资料 / 修改密码。
// 应用身份一律来自本应用自己的会话校验（数据库中的会话摘要），
// 绝不使用 ctx.user、平台身份、Host 头或浏览器提交的 owner_id。
import { AppError, applicationPath, errorJson, json, readJson, requireTrustedOrigin, rows } from './http.mjs';
import { canonicalUsername, validatePassword, validateProfile } from './validate.mjs';
import { isUuid, parseListQuery, parseMajorQuery, parseUniversityQuery, validateFileResourceInput, validateResourceInput } from './validate.mjs';
import { GRADES, RESOURCE_TYPES, SUBJECTS } from './validate.mjs';
import { scoreAssessment, validateAnswers } from './assessment.mjs';
import {
  OPTIONS as RIASEC30_OPTIONS, QUESTIONS as RIASEC30_QUESTIONS,
  computeResult as computeRiasec30, publicResult as riasec30PublicResult, validateAnswers as validateRiasec30Answers,
} from './assessment30.mjs';
import {
  OPTIONS as MBTI_OPTIONS, QUESTIONS as MBTI_QUESTIONS,
  computeResult as computeMbti, publicResult as mbtiPublicResult, validateAnswers as validateMbtiAnswers,
} from './mbti.mjs';
import { importChunk, listUniversities as listUniversitiesIndex, readMeta, universityDetail as fetchUniversityDetail, updateMeta } from './universities.mjs';
import { listRecommendations } from './recommendations.mjs';
import { simulateAdmissions, simulationOptions } from './simulation.mjs';
import { compareUniversities } from './compare.mjs';
import { FILE_MAX_BYTES, assertOwnedKey, storageKeyFor, validateUploadIntent } from './resource-files.mjs';
import { verifyUploadedObject } from './storage-validation.mjs';
import { hashPassword, verifyPassword, verifyPasswordAgainstDummy } from './passwords.mjs';
import { SESSION_TTL_MS, clearSessionCookie, createSession, revokeSession, sessionCookie, validateSession } from './sessions.mjs';
import { consume } from './limiter.mjs';
import { createWrongQuestion, deleteWrongQuestion, getWrongQuestion, listWrongQuestions, reviewWrongQuestion, updateWrongQuestion, wrongQuestionStats } from './wrong-questions.mjs';
import { completeStudyTask, createStudyTask, deleteStudyTask, getStudyTask, listStudyTasks, updateStudyTask } from './study-tasks.mjs';

const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
const encoder = new TextEncoder();
const USER_COLUMNS = 'id,username,display_name,grade,province,subjects,role,created_at';
const CREDENTIAL_COLUMNS = 'id,username,password_salt,password_hash,password_iterations';
const COUNT_LIMIT = 500;

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
  let resourcesTotal = null;
  let resourcesCapped = false;
  try {
    const all = rows(await db.from('resources').select('id,deleted_at').limit(COUNT_LIMIT));
    resourcesCapped = all.length === COUNT_LIMIT;
    resourcesTotal = all.filter((row) => row.deleted_at == null).length;
  } catch {
    resourcesTotal = null;
  }
  // 院校总量只来自导入时服务端维护的 counts 元数据（精确值）；未导入时为 null。
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
      // favorites 是 (user_id, resource_id) 复合主键，没有 id 列。
      const mine = rows(await db.from('favorites').select('resource_id,revoked_at').eq('user_id', userId).limit(COUNT_LIMIT));
      favoritesCapped = mine.length === COUNT_LIMIT;
      favoritesCount = mine.filter((row) => row.revoked_at == null).length;
    } catch {
      favoritesCount = null;
    }
    const assessmentsNew = await countRows(db, 'assessments', { user_id: userId });
    const assessmentsLegacy = await countRows(db, 'assessment_results', { user_id: userId });
    // 历史合并两张表（30 题/MBTI 在 assessments，24 题在 assessment_results）；
    // 任一表不可读时总数无法确认，如实返回 null。
    assessmentsCount = assessmentsNew == null || assessmentsLegacy == null ? null : assessmentsNew + assessmentsLegacy;
    assessmentsCapped = assessmentsNew === COUNT_LIMIT || assessmentsLegacy === COUNT_LIMIT;
  }
  return json({
    stats: {
      resources_total: resourcesTotal,
      resources_capped: resourcesCapped,
      universities_total: universitiesTotal,
      favorites_count: favoritesCount,
      favorites_capped: favoritesCapped,
      assessments_count: assessmentsCount,
      assessments_capped: assessmentsCapped,
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

// 管理员 = 应用会话 + 数据库 role=admin（由所有者通过平台工具授予）；不使用平台身份。
async function requireAdmin(db, request) {
  const session = await requireSession(db, request);
  const user = await loadUser(db, session.userId);
  if (user.role !== 'admin') throw new AppError('admin_required', 403);
  return session;
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


// ---- 模块5：高校与录取数据 ----
// 查询与导入实现在 functions/universities.mjs（河南真实数据：院校索引存 data_meta，
// 详情按学校名称关联招生计划，管理员分块导入）；此处只保留专业目录（/api/majors）。
const READ_LIMIT = 500;
const MAJOR_COLUMNS = 'code,name,category,years,degree,source,note';

async function fetchAll(db, table, columns) {
  return rows(await db.from(table).select(columns).limit(READ_LIMIT));
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
// 读接口公开；写接口（登记、收藏、文件上传）必须登录，归属一律来自会话，绝不信任浏览器提交的 owner_id。
// 文件型资料走平台 Storage 签名直传：签发上传 URL → 浏览器 PUT → 登记时服务端回读实际字节，
// 用 storage-validation 复核大小与 MIME 后才落库；下载同样由服务端按数据库行签发短时 URL。
const RESOURCE_COLUMNS = 'id,owner_id,title,grade,subject,type,source_url,source_name,description,file_name,file_size,mime,storage_key,copyright_confirmed,created_at,deleted_at';
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
    has_file: row.storage_key != null,
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
  let session = null;
  if (query.mine) {
    session = await requireSession(db, request);
  } else {
    try {
      const result = await validateSession(db, request);
      if (result.state === 'valid' && result.session) session = result.session;
    } catch {
      // 匿名或会话无效：列表照常返回，不标注收藏。
    }
  }
  const mineUserId = query.mine ? session.userId : null;
  const favoriteIds = new Set();
  if (session) {
    try {
      const favs = rows(await db.from('favorites').select(FAVORITE_COLUMNS)
        .eq('user_id', session.userId).limit(COUNT_LIMIT));
      for (const fav of favs) {
        if (!fav.revoked_at) favoriteIds.add(fav.resource_id);
      }
    } catch {
      // 收藏表读取失败时按未收藏显示，与详情接口策略一致。
    }
  }
  const all = rows(await db.from('resources').select(RESOURCE_COLUMNS).limit(500));
  const needle = query.q.toLowerCase();
  const filtered = all.filter((row) => {
    if (row.deleted_at != null) return false;
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
  const items = filtered.slice(query.offset, query.offset + query.limit)
    .map((row) => publicResource(row, favoriteIds.has(row.id)));
  return json({ total, items });
}

async function getResource(db, request, id) {
  if (!isUuid(id)) throw new AppError('not_found', 404);
  const found = rows(await db.from('resources').select(RESOURCE_COLUMNS).eq('id', id).limit(1));
  if (found.length !== 1 || found[0].deleted_at != null) throw new AppError('not_found', 404);
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

async function createResource(db, body, session) {
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
    deleted_at: null,
    created_at: new Date().toISOString(),
  }, { onConflict: 'id' }).select(RESOURCE_COLUMNS));
  if (created.length !== 1) return errorJson('resource_unconfirmed', 503);
  return json({ resource: publicResource(created[0]) }, 201);
}

// 文件直传第一步：校验文件意图，服务端派生存储路径并签发上传 URL。
// 路径目录段是会话用户 ID 的 SHA-256 摘要，登记时据此复核归属。
async function requestUploadUrl(storage, request, session) {
  if (!storage) throw new AppError('file_upload_unavailable', 503);
  const intent = validateUploadIntent(await readJson(request));
  const storageKey = await storageKeyFor(session.userId, intent.ext);
  let signed;
  try {
    signed = await storage.createSignedUploadUrl(storageKey, { upsert: false });
  } catch {
    throw new AppError('storage_unavailable', 503);
  }
  return json({
    uploadUrl: signed.signedUrl, storageKey, contentType: intent.mime, maxBytes: FILE_MAX_BYTES,
  });
}

// 文件直传第二步：回读已上传对象，实测字节数与 MIME 通过后才登记。
// 浏览器声明的大小只作期望值；落库的 file_size/mime 一律取实测结果。
async function createFileResource(db, storage, body, session) {
  if (!storage) throw new AppError('file_upload_unavailable', 503);
  const input = validateFileResourceInput(body);
  const intent = validateUploadIntent(body);
  await assertOwnedKey(body.storage_key, session.userId);
  if (body.storage_key.slice(body.storage_key.lastIndexOf('.') + 1) !== intent.ext) {
    throw new AppError('invalid_file', 400);
  }
  let actual;
  try {
    const object = await storage.download(body.storage_key);
    actual = await verifyUploadedObject(object, {
      maxBytes: FILE_MAX_BYTES,
      expectedBytes: intent.size,
      allowedContentTypes: [intent.mime],
    });
  } catch {
    // 校验失败不落库；同一上传意图下尽力清理已上传对象，失败不掩盖原错误。
    try { await storage.remove([body.storage_key]); } catch { /* 清理尽力而为 */ }
    throw new AppError('file_validation_failed', 400);
  }
  const id = crypto.randomUUID();
  const created = rows(await db.from('resources').insertIfAbsent({
    id,
    owner_id: session.userId,
    ...input,
    source_url: '',
    file_name: intent.name,
    file_size: actual.size,
    mime: actual.contentType,
    storage_key: body.storage_key,
    copyright_confirmed: true,
    deleted_at: null,
    created_at: new Date().toISOString(),
  }, { onConflict: 'id' }).select(RESOURCE_COLUMNS));
  if (created.length !== 1) return errorJson('resource_unconfirmed', 503);
  return json({ resource: publicResource(created[0]) }, 201);
}

// 文件下载：登录后按数据库行（服务端持有的路径）签发 300 秒下载 URL。
// 资料库是共享学习资料，任何已登录学生可下载；路径绝不来自浏览器输入。
async function resourceFileUrl(db, storage, session, id) {
  if (!isUuid(id)) throw new AppError('not_found', 404);
  if (!storage) throw new AppError('file_upload_unavailable', 503);
  const found = rows(await db.from('resources').select(RESOURCE_COLUMNS).eq('id', id).limit(1));
  if (found.length !== 1 || found[0].storage_key == null || found[0].deleted_at != null) throw new AppError('file_not_found', 404);
  let signed;
  try {
    signed = await storage.createSignedUrl(found[0].storage_key, 300);
  } catch {
    throw new AppError('storage_unavailable', 503);
  }
  return json({
    downloadUrl: signed.signedUrl,
    file_name: found[0].file_name,
    file_size: found[0].file_size,
    mime: found[0].mime,
  });
}

// 内容管理：上传者删除自己的资料，管理员可下架任意资料。软删除保留审计记录，
// 列表/详情/下载/收藏全链路过滤已删除行；存储对象尽力清理，失败不阻断下架
// （下载入口已按 deleted_at 拦截，对象不再可达）。
async function deleteResource(db, storage, session, id) {
  if (!isUuid(id)) throw new AppError('not_found', 404);
  const found = rows(await db.from('resources').select(RESOURCE_COLUMNS).eq('id', id).limit(1));
  if (found.length !== 1 || found[0].deleted_at != null) throw new AppError('not_found', 404);
  const row = found[0];
  if (row.owner_id !== session.userId) {
    const user = await loadUser(db, session.userId);
    if (user.role !== 'admin') throw new AppError('resource_forbidden', 403);
  }
  const updated = rows(await db.from('resources').update({ deleted_at: new Date().toISOString() })
    .eq('id', id).select('id'));
  if (updated.length !== 1) return errorJson('resource_unconfirmed', 503);
  if (row.storage_key != null && storage) {
    try { await storage.remove([row.storage_key]); } catch { /* 清理尽力而为 */ }
  }
  return json({ deleted: true });
}

async function favoriteResource(db, request, session, id) {
  if (!isUuid(id)) throw new AppError('not_found', 404);
  const found = rows(await db.from('resources').select('id,deleted_at').eq('id', id).limit(1));
  if (found.length !== 1 || found[0].deleted_at != null) throw new AppError('not_found', 404);
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
  const byId = new Map(all.filter((row) => row.deleted_at == null).map((row) => [row.id, row]));
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

// 个人测评历史：合并 assessments（30 题霍兰德 / MBTI）与 assessment_results
// （24 题 5 级量表霍兰德）两张表，只读会话用户自己的记录，按时间倒序取前 50。
// version 区分霍兰德题量（24/30），MBTI 为 null。
async function listAssessments(db, request, session) {
  const found = rows(await db.from('assessments').select('id,kind,code,scores,created_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false }).limit(50));
  const items = found.map((row) => {
    const kind = row.kind ?? 'riasec';
    const scores = typeof row.scores === 'string' ? JSON.parse(row.scores) : row.scores;
    return {
      id: row.id,
      kind,
      version: kind === 'riasec' ? 30 : null,
      code: row.code,
      scores,
      top_types: kind === 'mbti' ? [row.code] : String(row.code).split(''),
      created_at: row.created_at,
    };
  });
  const legacy = rows(await db.from('assessment_results').select('id,scores,top_types,created_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false }).limit(50));
  for (const row of legacy) {
    const topTypes = typeof row.top_types === 'string' ? JSON.parse(row.top_types) : row.top_types;
    items.push({
      id: row.id,
      kind: 'riasec',
      version: 24,
      code: topTypes.join(''),
      scores: typeof row.scores === 'string' ? JSON.parse(row.scores) : row.scores,
      top_types: topTypes,
      created_at: row.created_at,
    });
  }
  items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const page = items.slice(0, 50);
  return json({ total: page.length, items: page });
}

async function route(db, request, origin, storage) {
  requireTrustedOrigin(request, origin);
  const path = applicationPath(request);

  if (path === '/api/health' && request.method === 'GET') return json({ ok: true });
  if (path === '/api/stats' && request.method === 'GET') return stats(db, request);
  if (path === '/api/recommendations' && request.method === 'GET') return listRecommendations(db, request);
  if (path === '/api/simulation' || path === '/api/simulation/options') {
    if (request.method !== 'GET') throw new AppError('method_not_allowed', 405);
    return path.endsWith('/options') ? simulationOptions(db, request) : simulateAdmissions(db, request);
  }
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

  if (path === '/api/wrong-questions' || path.startsWith('/api/wrong-questions/')) {
    const session = await requireSession(db, request);
    if (path === '/api/wrong-questions') {
      if (request.method === 'GET') return listWrongQuestions(db, request, session);
      if (request.method === 'POST') return createWrongQuestion(db, request, session);
      throw new AppError('method_not_allowed', 405);
    }
    if (path === '/api/wrong-questions/public' || path === '/api/wrong-questions/stats') {
      if (request.method !== 'GET') throw new AppError('method_not_allowed', 405);
      return path.endsWith('/public') ? listWrongQuestions(db, request, session, true) : wrongQuestionStats(db, session);
    }
    const match = path.match(/^\/api\/wrong-questions\/([^/]+)(\/review)?$/);
    if (!match) throw new AppError('not_found', 404);
    if (match[2]) {
      if (request.method === 'POST') return reviewWrongQuestion(db, session, match[1]);
    } else {
      if (request.method === 'GET') return getWrongQuestion(db, session, match[1]);
      if (request.method === 'PATCH') return updateWrongQuestion(db, request, session, match[1]);
      if (request.method === 'DELETE') return deleteWrongQuestion(db, session, match[1]);
    }
    throw new AppError('method_not_allowed', 405);
  }

  // 模块9：任务同步到账号（普通任务；未登录一律 401，归属只认会话）。
  if (path === '/api/study-tasks' || path.startsWith('/api/study-tasks/')) {
    const session = await requireSession(db, request);
    if (path === '/api/study-tasks') {
      if (request.method === 'GET') return listStudyTasks(db, request, session);
      if (request.method === 'POST') return createStudyTask(db, request, session);
      throw new AppError('method_not_allowed', 405);
    }
    const match = path.match(/^\/api\/study-tasks\/([^/]+)(\/complete)?$/);
    if (!match) throw new AppError('not_found', 404);
    if (match[2]) {
      if (request.method === 'POST') return completeStudyTask(db, session, match[1]);
    } else {
      if (request.method === 'GET') return getStudyTask(db, session, match[1]);
      if (request.method === 'PATCH') return updateStudyTask(db, request, session, match[1]);
      if (request.method === 'DELETE') return deleteStudyTask(db, session, match[1]);
    }
    throw new AppError('method_not_allowed', 405);
  }

  // 模块5：匿名只读查询（院校索引存 data_meta，前端做搜索/分页；详情按学校名称关联计划）。
  if (path === '/api/universities' && request.method === 'GET') {
    return listUniversitiesIndex(db, parseUniversityQuery(new URL(request.url).search));
  }
  // 院校对比：公开只读（2–3 所并排，最新一年分数与计划）。必须在详情路由之前，
  // 否则 /api/universities/compare 会被详情的 code 正则匹配走。
  if (path === '/api/universities/compare' && request.method === 'GET') {
    return compareUniversities(db, request);
  }
  const universityDetail = path.match(/^\/api\/universities\/([A-Za-z0-9]{1,32})$/);
  if (universityDetail && request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    const yearParam = params.get('year');
    const province = params.get('province');
    if (province !== null && !['河北', '河南'].includes(province)) throw new AppError('invalid_input', 400);
    let planYear = null;
    if (yearParam !== null) {
      if (!/^\d{4}$/.test(yearParam)) throw new AppError('invalid_input', 400);
      planYear = Number(yearParam);
    }
    return fetchUniversityDetail(db, universityDetail[1], planYear, province);
  }
  if (path === '/api/majors' && request.method === 'GET') return listMajors(db, request);
  if (path === '/api/resources' && request.method === 'GET') return listResources(db, request);
  if (path === '/api/resources/upload-url' && request.method === 'POST') {
    const session = await requireSession(db, request);
    return requestUploadUrl(storage, request, session);
  }
  if (path === '/api/resources' && request.method === 'POST') {
    const session = await requireSession(db, request);
    const body = await readJson(request);
    return body?.storage_key != null
      ? createFileResource(db, storage, body, session)
      : createResource(db, body, session);
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
  const resourceFileMatch = path.match(/^\/api\/resources\/([0-9a-f-]{36})\/file$/);
  if (resourceFileMatch && request.method === 'GET') {
    const session = await requireSession(db, request);
    return resourceFileUrl(db, storage, session, resourceFileMatch[1]);
  }
  const resourceDetail = path.match(/^\/api\/resources\/([0-9a-f-]{36})$/);
  if (resourceDetail && request.method === 'GET') return getResource(db, request, resourceDetail[1]);
  if (resourceDetail && request.method === 'DELETE') {
    const session = await requireSession(db, request);
    return deleteResource(db, storage, session, resourceDetail[1]);
  }

  if (path === '/api/assessments' && request.method === 'GET') {
    const session = await requireSession(db, request);
    return listAssessments(db, request, session);
  }
  if (path === '/api/assessments' && request.method === 'POST') {
    const session = await requireSession(db, request);
    return saveAssessment(db, request, session);
  }
  if (path === '/api/assessment/questions' && request.method === 'GET') {
    await requireSession(db, request);
    return json({ questions: RIASEC30_QUESTIONS.map(({ id, text }) => ({ id, text })), options: RIASEC30_OPTIONS });
  }
  if (path === '/api/assessment/submit' && request.method === 'POST') {
    const session = await requireSession(db, request);
    return submitAssessment(db, request, session, 'riasec', validateRiasec30Answers, computeRiasec30, riasec30PublicResult);
  }
  if (path === '/api/assessment/latest' && request.method === 'GET') {
    const session = await requireSession(db, request);
    return latestAssessment(db, session, 'riasec', riasec30PublicResult);
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

  // 模块5：管理员导入（应用会话 role=admin）。
  if (path === '/api/admin/import' && request.method === 'POST') {
    await requireAdmin(db, request);
    return importChunk(db, request);
  }
  if (path === '/api/admin/meta' && request.method === 'POST') {
    await requireAdmin(db, request);
    return updateMeta(db, request);
  }

  if (['/api/me', '/api/profile', '/api/password', '/api/logout', '/api/register', '/api/login', '/api/health', '/api/universities', '/api/universities/compare', '/api/majors', '/api/resources', '/api/resources/upload-url', '/api/favorites', '/api/assessments', '/api/stats', '/api/recommendations', '/api/assessment/questions', '/api/assessment/submit', '/api/assessment/latest', '/api/mbti/questions', '/api/mbti/submit', '/api/mbti/latest', '/api/admin/import', '/api/admin/meta'].includes(path)
    || universityDetail || resourceDetail || resourceFileMatch || favoriteMatch) {
    throw new AppError('method_not_allowed', 405);
  }
  throw new AppError('not_found', 404);
}

// 依赖注入只用于本地测试；ctx 只用于取 request，不使用其中的平台身份。
// storage 为平台注入的 Storage 适配器（生产来自 _qoder/storage.mjs，测试用假存储）。
export function createApplication({ db, origin, storage }) {
  return async function handle(ctx) {
    try {
      return await route(db, ctx.request, typeof origin === 'function' ? origin() : origin, storage);
    } catch (error) {
      if (error instanceof SessionRequired) return unauthorized(error.state);
      if (error instanceof AppError) return errorJson(error.code, error.status);
      return errorJson('service_unavailable', 503);
    }
  };
}