import { AppError, json, readJson, rows } from './http.mjs';
import { GRADES, SUBJECTS, isUuid } from './validate.mjs';

const SOURCES = ['作业', '考试', '练习', '资料'];
const REASONS = ['概念不清', '计算失误', '审题不清', '方法不会', '粗心'];
const STATUSES = ['todo', 'reviewing', 'done'];
const VISIBILITIES = ['private', 'public'];
const COLUMNS = 'id,user_id,subject,grade,chapter,source,question,correct_answer,my_answer,reason,note,status,review_count,last_reviewed_at,visibility,created_at';
const PUBLIC_COLUMNS = 'subject,chapter,question,correct_answer,reason';
const LIMITS = { chapter: 100, question: 5000, correct_answer: 3000, my_answer: 3000, note: 2000 };

function object(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('invalid_wrong_question', 400);
}

function text(value, name, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || value.length > LIMITS[name]) throw new AppError('invalid_wrong_question', 400);
  const normalized = value.trim();
  if (!normalized && !optional) throw new AppError('invalid_wrong_question', 400);
  return normalized || null;
}

function choice(value, allowed) {
  if (!allowed.includes(value)) throw new AppError('invalid_wrong_question', 400);
  return value;
}

function createInput(body) {
  object(body);
  if (body.visibility !== undefined && body.visibility !== 'private') throw new AppError('publication_confirmation_required', 400);
  const grade = body.grade == null || body.grade === '' ? null : choice(body.grade, GRADES);
  return {
    subject: choice(body.subject, SUBJECTS), grade,
    chapter: text(body.chapter, 'chapter', true), source: choice(body.source, SOURCES),
    question: text(body.question, 'question'), correct_answer: text(body.correct_answer, 'correct_answer'),
    my_answer: text(body.my_answer, 'my_answer'), reason: choice(body.reason, REASONS),
    note: text(body.note, 'note', true),
  };
}

function patchInput(body) {
  object(body);
  if (Object.keys(body).some((key) => !['status', 'reason', 'note', 'visibility', 'public_confirmed'].includes(key))) {
    throw new AppError('invalid_wrong_question', 400);
  }
  const update = {};
  if (Object.hasOwn(body, 'status')) update.status = choice(body.status, STATUSES);
  if (Object.hasOwn(body, 'reason')) update.reason = choice(body.reason, REASONS);
  if (Object.hasOwn(body, 'note')) update.note = text(body.note, 'note', true);
  if (Object.hasOwn(body, 'visibility')) {
    update.visibility = choice(body.visibility, VISIBILITIES);
    if (update.visibility === 'public' && body.public_confirmed !== true) {
      throw new AppError('publication_confirmation_required', 400);
    }
  }
  if (Object.keys(update).length === 0) throw new AppError('invalid_wrong_question', 400);
  return update;
}

function listInput(request, publicOnly) {
  const params = new URL(request.url).searchParams;
  const integer = (name, fallback, max) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw)) throw new AppError('invalid_filter', 400);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > max || (name === 'limit' && value < 1)) throw new AppError('invalid_filter', 400);
    return value;
  };
  const filters = {};
  for (const [name, allowed] of [['subject', SUBJECTS], ['reason', REASONS], ['status', STATUSES]]) {
    const value = params.get(name);
    if (!value) continue;
    if (!allowed.includes(value) || (publicOnly && name === 'status')) throw new AppError('invalid_filter', 400);
    filters[name] = value;
  }
  const chapter = params.get('chapter');
  if (chapter && chapter.length > LIMITS.chapter) throw new AppError('invalid_filter', 400);
  if (chapter?.trim()) filters.chapter = chapter.trim();
  return { filters, limit: integer('limit', 20, 100), offset: integer('offset', 0, 1000000) };
}

function exactCount(result) {
  rows(result);
  if (!Number.isSafeInteger(result.count) || result.count < 0) throw new AppError('database_unavailable', 503);
  return result.count;
}

async function owned(db, session, id) {
  if (!isUuid(id)) throw new AppError('not_found', 404);
  const found = rows(await db.from('wrong_questions').select(COLUMNS).eq('user_id', session.userId).eq('id', id).limit(1));
  if (found.length !== 1) throw new AppError('not_found', 404);
  return found[0];
}

async function write(query) {
  try {
    return rows(await query);
  } catch (error) {
    if (error instanceof AppError) throw error;
    // A transport failure may follow a committed write; never replay it.
    throw new AppError('wrong_question_unconfirmed', 503);
  }
}

export async function listWrongQuestions(db, request, session, publicOnly = false) {
  const { filters, limit, offset } = listInput(request, publicOnly);
  const columns = publicOnly ? PUBLIC_COLUMNS : COLUMNS;
  let query = db.from('wrong_questions').select(columns, { count: 'exact' });
  query = publicOnly ? query.eq('visibility', 'public') : query.eq('user_id', session.userId);
  for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
  const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
  const total = exactCount(result);
  const items = rows(result).map((row) => Object.fromEntries(columns.split(',').map((key) => [key, row[key]])));
  return json({ ...(publicOnly ? {} : { user_id: session.userId }), items, total });
}

export async function wrongQuestionStats(db, session) {
  const results = await Promise.all([
    db.from('wrong_questions').select('id', { count: 'exact' }).eq('user_id', session.userId).limit(1),
    db.from('wrong_questions').select('id', { count: 'exact' }).eq('user_id', session.userId).eq('status', 'todo').limit(1),
  ]);
  return json({ user_id: session.userId, total: exactCount(results[0]), todo: exactCount(results[1]) });
}

export async function getWrongQuestion(db, session, id) {
  return json({ user_id: session.userId, item: await owned(db, session, id) });
}

export async function createWrongQuestion(db, request, session) {
  const body = await readJson(request, 65536);
  object(body);
  // This is a consistency precondition, never the source of ownership.
  if (Object.hasOwn(body, 'expected_user_id') && body.expected_user_id !== session.userId) {
    throw new AppError('wrong_question_session_changed', 409);
  }
  const input = createInput(body);
  const created = await write(db.from('wrong_questions').insertIfAbsent({
    ...input, id: crypto.randomUUID(), user_id: session.userId,
    status: 'todo', review_count: 0, last_reviewed_at: null, visibility: 'private', created_at: new Date().toISOString(),
  }, { onConflict: 'id' }).select(COLUMNS));
  if (created.length !== 1) throw new AppError('wrong_question_unconfirmed', 503);
  return json({ user_id: session.userId, item: created[0] }, 201);
}

export async function updateWrongQuestion(db, request, session, id) {
  await owned(db, session, id);
  const input = patchInput(await readJson(request, 65536));
  const updated = await write(db.from('wrong_questions').update(input).eq('user_id', session.userId).eq('id', id).select(COLUMNS));
  if (updated.length !== 1) throw new AppError('not_found', 404);
  return json({ user_id: session.userId, item: updated[0] });
}

export async function deleteWrongQuestion(db, session, id) {
  if (!isUuid(id)) throw new AppError('not_found', 404);
  const deleted = await write(db.from('wrong_questions').delete().eq('user_id', session.userId).eq('id', id).select('id'));
  if (deleted.length !== 1) throw new AppError('not_found', 404);
  return json({ ok: true });
}

export async function reviewWrongQuestion(db, session, id) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await owned(db, session, id);
    if (!Number.isInteger(current.review_count) || current.review_count < 0 || current.review_count >= 2147483647) {
      throw new AppError('review_busy', 409);
    }
    const updated = await write(db.from('wrong_questions').update({
      review_count: current.review_count + 1, last_reviewed_at: new Date().toISOString(),
    }).eq('user_id', session.userId).eq('id', id).eq('review_count', current.review_count).select(COLUMNS));
    if (updated.length === 1) return json({ user_id: session.userId, item: updated[0] });
    // An empty conditional UPDATE confirms no write; only this case is retried.
  }
  throw new AppError('review_busy', 409);
}
