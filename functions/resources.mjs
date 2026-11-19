// 模块4：学习资料库。
// 读接口公开；写接口（登记、收藏）必须登录，归属一律来自会话，绝不信任浏览器提交的 owner_id。
// 文件直传未接通：登记只接受来源链接型资料；file_* 字段由 validateResourceInput 拒绝。
import { AppError, errorJson, json, readJson, rows } from './http.mjs';
import { requireSession, validateSession } from './sessions.mjs';
import { GRADES, SUBJECTS, RESOURCE_TYPES, isUuid, parseListQuery, validateResourceInput } from './validate.mjs';

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

export async function listResources(db, request) {
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

export async function getResource(db, request, id) {
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

export async function createResource(db, request, session) {
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

export async function favoriteResource(db, request, session, id) {
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

export async function unfavoriteResource(db, request, session, id) {
  if (!isUuid(id)) throw new AppError('not_found', 404);
  await db.from('favorites').update({ revoked_at: new Date().toISOString() })
    .eq('user_id', session.userId).eq('resource_id', id);
  return json({ favorited: false });
}

export async function listFavorites(db, request, session) {
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