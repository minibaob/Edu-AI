// 仅用于本地浏览器演练：把转换好的官方 CSV 通过真实导入路由灌入内存假数据库。
// 不打进 Function 包。账号 localadmin 仅为本地 fixture 管理员，与线上无关。
import fs from 'node:fs';
import path from 'node:path';

const ORIGIN = 'https://local.fixture';
export const LOCAL_ADMIN = { username: 'localadmin', password: 'local-admin-pw-123' };

function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const MAPS = {
  universities: { 院校代码: 'code', 学校名称: 'name', 所在省份: 'province', 所在城市: 'city', 办学类型: 'type', 办学层次: 'level', 标签: 'tags', 招生网址: 'website', 数据来源: 'source', 备注: 'note' },
  admission_scores: { 院校代码: 'university_code', 省份: 'province', 年份: 'year', 科类: 'category', 批次: 'batch', 选科要求: 'subject_requirement', 最低分: 'min_score', 最低位次: 'min_rank', 录取人数: 'admitted_count', 数据来源: 'source', 备注: 'note', 学校名称: 'school_name' },
  enrollment_plans: { 院校代码: 'university_code', 省份: 'province', 年份: 'year', 专业代码: 'major_code', 专业名称: 'major_name', 批次: 'batch', 选科要求: 'subject_requirement', 计划数: 'plan_count', 学费: 'tuition', 数据来源: 'source', 备注: 'note', 学校名称: 'school_name' },
};
const INT_COLUMNS = new Set(['year', 'min_rank', 'admitted_count', 'plan_count', 'tuition']);

function toRecords(table, grid) {
  const header = grid[0].map((h) => h.trim());
  const map = MAPS[table];
  const cols = header.map((h) => map[h] ?? null);
  const records = [];
  for (let r = 1; r < grid.length; r += 1) {
    const record = {}; let nonEmpty = false;
    cols.forEach((col, i) => {
      if (!col) return;
      const raw = (grid[r][i] ?? '').trim();
      if (raw === '') { record[col] = null; return; }
      nonEmpty = true;
      record[col] = INT_COLUMNS.has(col) && /^\d+$/.test(raw) ? Number(raw) : raw;
    });
    if (nonEmpty) records.push(record);
  }
  return records;
}

function dv(records, field) {
  const set = new Set();
  for (const r of records) { const v = r[field]; if (v !== null && v !== undefined && v !== '') set.add(v); }
  return [...set].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))));
}

async function call(handle, p, { method = 'GET', body, cookie } = {}) {
  const headers = { origin: ORIGIN };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const request = new Request(`${ORIGIN}/functions/v1/app${p}`, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const response = await handle({ request, requestId: 'seed' });
  const json = await response.json().catch(() => null);
  return { status: response.status, json, setCookie: response.headers.get('set-cookie') };
}

export async function seedLocal(handle, db, dir) {
  const reg = await call(handle, '/api/register', { method: 'POST', body: { username: LOCAL_ADMIN.username, password: LOCAL_ADMIN.password } });
  let cookie;
  if (reg.status === 201) cookie = reg.setCookie.split(';')[0];
  else {
    const li = await call(handle, '/api/login', { method: 'POST', body: { username: LOCAL_ADMIN.username, password: LOCAL_ADMIN.password } });
    if (li.status !== 200) throw new Error(`seed login failed ${li.status}`);
    cookie = li.setCookie.split(';')[0];
  }
  const me = await call(handle, '/api/me', { cookie });
  await db.from('users').update({ role: 'admin' }).eq('id', me.json.user.id);

  const counts = { universities: 0, admission_scores: 0, enrollment_plans: 0 };
  const runId = 'b'.repeat(64);
  for (const table of ['universities', 'admission_scores', 'enrollment_plans']) {
    const grid = parseCsv(fs.readFileSync(path.join(dir, `${table}.csv`), 'utf8'));
    const records = toRecords(table, grid);
    const total = Math.ceil(records.length / 500);
    let inserted = 0;
    for (let i = 0; i < total; i += 1) {
      const r = await call(handle, '/api/admin/import', {
        method: 'POST', cookie,
        body: { table, run_id: runId, chunk_index: i, rows: records.slice(i * 500, i * 500 + 500) },
      });
      if (r.status !== 200) throw new Error(`import ${table} chunk ${i} failed: ${r.status} ${JSON.stringify(r.json)}`);
      inserted += r.json.inserted;
    }
    counts[table] = records.length;
    if (table === 'universities') {
      const m = await call(handle, '/api/admin/meta', { method: 'POST', cookie, body: { key: 'universities_index', value: records.map((r) => ({ code: String(r.code), name: String(r.name) })) } });
      if (m.status !== 200) throw new Error(`meta universities_index failed: ${m.status} ${JSON.stringify(m.json)}`);
    } else if (table === 'admission_scores') {
      const m = await call(handle, '/api/admin/meta', { method: 'POST', cookie, body: { key: 'score_facets', value: { provinces: dv(records, 'province'), years: dv(records, 'year'), categories: dv(records, 'category'), batches: dv(records, 'batch') } } });
      if (m.status !== 200) throw new Error(`meta score_facets failed: ${m.status}`);
    } else {
      const m = await call(handle, '/api/admin/meta', { method: 'POST', cookie, body: { key: 'plan_facets', value: { provinces: dv(records, 'province'), years: dv(records, 'year'), batches: dv(records, 'batch') } } });
      if (m.status !== 200) throw new Error(`meta plan_facets failed: ${m.status}`);
    }
    console.log(`seeded ${table}: ${records.length} rows (inserted ${inserted})`);
  }
  await call(handle, '/api/admin/meta', { method: 'POST', cookie, body: { key: 'counts', value: counts } });
  console.log(`seed complete. 本地 fixture 管理员：${LOCAL_ADMIN.username} / ${LOCAL_ADMIN.password}（仅本地演练）`);
}