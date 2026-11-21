// 模块9：任务同步到账号（第一步：普通任务）。
// 只做普通任务（kind='normal'）；错题复习任务（kind='review' + task_questions
// 关联）是第三步（模块11）的内容，本步的 kind 白名单只放行 'normal'。
// 归属只认已验证会话的 user_id，绝不信任浏览器提交的 owner_id。
import { AppError, json, readJson, rows } from './http.mjs';
import { SUBJECTS, isUuid } from './validate.mjs';

const KINDS = ['normal'];
const TASK_SUBJECTS = [...SUBJECTS, '其他'];
const COLUMNS = 'id,user_id,title,subject,kind,due_date,done,done_at,created_at';
const LIMITS = { title: 100 };
const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function object(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('invalid_study_task', 400);
}

function title(value) {
  if (typeof value !== 'string' || value.length > LIMITS.title) throw new AppError('invalid_study_task', 400);
  const normalized = value.trim();
  if (!normalized) throw new AppError('invalid_study_task', 400);
  return normalized;
}

function subject(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !TASK_SUBJECTS.includes(value)) throw new AppError('invalid_study_task', 400);
  return value;
}

function dueDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DUE_DATE_RE.test(value)) throw new AppError('invalid_study_task', 400);
  // 拒绝 2026-13-01、2026-02-30 这类不存在的日期。
  if (Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new AppError('invalid_study_task', 400);
  }
  return value;
}

function createInput(body) {
  object(body);
  return {
    title: title(body.title),
    subject: subject(body.subject),
    kind: body.kind === undefined ? 'normal' : (KINDS.includes(body.kind) ? body.kind : (() => { throw new AppError('invalid_study_task', 400); })()),
    due_date: dueDate(body.due_date),
  };
}

function patchInput(body) {
  object(body);
  if (Object.keys(body).some((key) => !['title', 'subject', 'kind', 'due_date', 'done'].includes(key))) {
    throw new AppError('invalid_study_task', 400);
  }
  const update = {};
  if (Object.hasOwn(body, 'title')) update.title = title(body.title);
  if (Object.hasOwn(body, 'subject')) update.subject = subject(body.subject);
  if (Object.hasOwn(body, 'kind')) {
    if (!KINDS.includes(body.kind)) throw new AppError('invalid_study_task', 400);
    update.kind = body.kind;
  }
  if (Object.hasOwn(body, 'due_date')) update.due_date = dueDate(body.due_date);
  if (Object.hasOwn(body, 'done')) {
    if (typeof body.done !== 'boolean') throw new AppError('invalid_study_task', 400);
    update.done = body.done;
    update.done_at = body.done ? new Date().toISOString() : null;
  }
  if (Object.keys(update).length === 0) throw new AppError('invalid_study_task', 400);
  return update;
}

function listInput(request) {
  const params = new URL(request.url).searchParams;
  const integer = (name, fallback, max) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw)) throw new AppError('invalid_filter', 400);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > max || (name === 'limit' && value < 1)) throw new AppError('invalid_filter', 400);
    return value;
  };
  return { limit: integer('limit', 20, 100), offset: integer('offset', 0, 1000000) };
}

function exactCount(result) {
  rows(result);
  if (!Number.isSafeInteger(result.count) || result.count < 0) throw new AppError('database_unavailable', 503);
  return result.count;
}

async function owned(db, session, id) {
  if (!isUuid(id)) throw new AppError('not_found', 404);
  const found = rows(await db.from('study_tasks').select(COLUMNS).eq('user_id', session.userId).eq('id', id).limit(1));
  if (found.length !== 1) throw new AppError('not_found', 404);
  return found[0];
}

async function write(query) {
  try {
    return rows(await query);
  } catch (error) {
    if (error instanceof AppError) throw error;
    // A transport failure may follow a committed write; never replay it.
    throw new AppError('study_task_unconfirmed', 503);
  }
}

export async function listStudyTasks(db, request, session) {
  const { limit, offset } = listInput(request);
  const result = await db.from('study_tasks').select(COLUMNS, { count: 'exact' }).eq('user_id', session.userId)
    .order('due_date', { ascending: true }).order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(offset, offset + limit - 1);
  const total = exactCount(result);
  const items = rows(result).map((row) => Object.fromEntries(COLUMNS.split(',').map((key) => [key, row[key]])));
  return json({ user_id: session.userId, items, total });
}

export async function getStudyTask(db, session, id) {
  return json({ user_id: session.userId, item: await owned(db, session, id) });
}

export async function createStudyTask(db, request, session) {
  const body = await readJson(request, 65536);
  object(body);
  // This is a consistency precondition, never the source of ownership.
  if (Object.hasOwn(body, 'expected_user_id') && body.expected_user_id !== session.userId) {
    throw new AppError('study_task_session_changed', 409);
  }
  const input = createInput(body);
  const created = await write(db.from('study_tasks').insertIfAbsent({
    ...input, id: crypto.randomUUID(), user_id: session.userId,
    done: false, done_at: null, created_at: new Date().toISOString(),
  }, { onConflict: 'id' }).select(COLUMNS));
  if (created.length !== 1) throw new AppError('study_task_unconfirmed', 503);
  return json({ user_id: session.userId, item: created[0] }, 201);
}

export async function updateStudyTask(db, request, session, id) {
  await owned(db, session, id);
  const input = patchInput(await readJson(request, 65536));
  const updated = await write(db.from('study_tasks').update(input).eq('user_id', session.userId).eq('id', id).select(COLUMNS));
  if (updated.length !== 1) throw new AppError('not_found', 404);
  return json({ user_id: session.userId, item: updated[0] });
}

export async function deleteStudyTask(db, session, id) {
  if (!isUuid(id)) throw new AppError('not_found', 404);
  const deleted = await write(db.from('study_tasks').delete().eq('user_id', session.userId).eq('id', id).select('id'));
  if (deleted.length !== 1) throw new AppError('not_found', 404);
  return json({ ok: true });
}

export async function completeStudyTask(db, session, id) {
  const current = await owned(db, session, id);
  if (current.done) return json({ user_id: session.userId, item: current });
  const updated = await write(db.from('study_tasks').update({
    done: true, done_at: new Date().toISOString(),
  }).eq('user_id', session.userId).eq('id', id).eq('done', false).select(COLUMNS));
  if (updated.length === 1) return json({ user_id: session.userId, item: updated[0] });
  // 并发下已被另一请求完成：不重放，直接返回当前行。
  return json({ user_id: session.userId, item: await owned(db, session, id) });
}
