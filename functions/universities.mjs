// 模块5：高校与录取数据。匿名只读查询 + 管理员（应用会话 role=admin）分块导入。
// 查询只用已验证的适配器能力（eq / order / limit / select / insertIfAbsent / update）：
// 院校索引与筛选选项存 data_meta，前端做搜索/分页；详情按代码/名称精确查询。
// 导入行 id = SHA-256(run_id|table|chunk_index|行号)，同一文件重复导入幂等；
// run_id 由文件内容摘要得出，浏览器不直接写数据库。
import { AppError, errorJson, json, readJson, rows } from './http.mjs';
import { sha256Hex } from './sessions.mjs';
import { IMPORT_VALIDATORS } from './import-validate.mjs';

const IMPORT_CHUNK_MAX = 500;
const IMPORT_BODY_LIMIT = 2 * 1024 * 1024;
const SCORE_COLUMNS = 'id,university_code,school_name,province,year,category,batch,subject_requirement,min_score,min_rank,admitted_count,source,note';
const PLAN_COLUMNS = 'id,university_code,school_name,province,year,major_code,major_name,batch,subject_requirement,plan_count,tuition,source,note';

function metaValue(row) {
  if (!row) return null;
  return typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
}

export async function readMeta(db, key) {
  const found = rows(await db.from('data_meta').select('value').eq('key', key).limit(1));
  return found.length === 1 ? metaValue(found[0]) : null;
}

// 列表页一次性取回院校索引与筛选选项（数据量小，前端搜索/分页）。
export async function listUniversities(db) {
  const [index, scoreFacets, planFacets, counts] = await Promise.all([
    readMeta(db, 'universities_index'),
    readMeta(db, 'score_facets'),
    readMeta(db, 'plan_facets'),
    readMeta(db, 'counts'),
  ]);
  return json({
    universities: Array.isArray(index) ? index : [],
    score_facets: scoreFacets ?? { provinces: [], years: [], categories: [], batches: [] },
    plan_facets: planFacets ?? { provinces: [], years: [], batches: [] },
    counts: counts ?? { universities: 0, admission_scores: 0, enrollment_plans: 0 },
  });
}

export async function universityDetail(db, code, planYear) {
  const found = rows(await db.from('universities').select('*').eq('code', code).limit(1));
  if (found.length !== 1) throw new AppError('not_found', 404);
  const university = found[0];

  const scores = rows(await db.from('admission_scores').select(SCORE_COLUMNS)
    .eq('university_code', code).order('year', { ascending: false }).limit(500));

  const planFacets = await readMeta(db, 'plan_facets');
  const planYears = Array.isArray(planFacets?.years) ? planFacets.years : [];
  let year = planYear;
  if (year === null || year === undefined) year = planYears.length > 0 ? Math.max(...planYears) : null;

  let plans = [];
  if (year !== null) {
    plans = rows(await db.from('enrollment_plans').select(PLAN_COLUMNS)
      .eq('school_name', university.name).eq('year', year)
      .order('major_name', { ascending: true }).limit(1000));
  }
  return json({ university, scores, plans, plan_year: year, plan_years: planYears });
}

async function insertRecords(db, table, records, conflict) {
  // 优先批量写入；适配器若不支持数组则逐行回退。确定性 id 使回退/重试不会重复插入。
  try {
    const result = await db.from(table).insertIfAbsent(records, { onConflict: conflict });
    if (result?.error) throw new AppError('database_unavailable', 503);
    return Array.isArray(result?.data) ? result.data.length : records.length;
  } catch (error) {
    if (error instanceof AppError) throw error;
    let inserted = 0;
    for (const record of records) {
      const result = await db.from(table).insertIfAbsent(record, { onConflict: conflict });
      if (result?.error) throw new AppError('database_unavailable', 503);
      if (Array.isArray(result?.data) && result.data.length > 0) inserted += 1;
    }
    return inserted;
  }
}

export async function importChunk(db, request) {
  const body = await readJson(request, IMPORT_BODY_LIMIT);
  const table = body?.table;
  const validator = IMPORT_VALIDATORS[table];
  if (!validator) throw new AppError('invalid_input', 400);
  const runId = body?.run_id;
  if (typeof runId !== 'string' || !/^[0-9a-f]{64}$/.test(runId)) throw new AppError('invalid_input', 400);
  const chunkIndex = body?.chunk_index;
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > 100000) throw new AppError('invalid_input', 400);
  const rawRows = body?.rows;
  if (!Array.isArray(rawRows) || rawRows.length === 0 || rawRows.length > IMPORT_CHUNK_MAX) {
    throw new AppError('invalid_input', 400);
  }

  const cleaned = rawRows.map(validator);
  let inserted;
  if (table === 'universities') {
    inserted = await insertRecords(db, table, cleaned, 'code');
  } else {
    const records = [];
    for (let i = 0; i < cleaned.length; i += 1) {
      const id = await sha256Hex(`${runId}|${table}|${chunkIndex}|${i}`);
      records.push({ id, ...cleaned[i] });
    }
    inserted = await insertRecords(db, table, records, 'id');
  }
  // 计数由服务端按实际插入行数累加：多省增量导入不覆盖他省计数，幂等重跑不增。
  if (inserted > 0) {
    const counts = (await readMeta(db, 'counts')) ?? { universities: 0, admission_scores: 0, enrollment_plans: 0 };
    counts[table] = (counts[table] ?? 0) + inserted;
    if (!(await writeMeta(db, 'counts', counts))) return errorJson('meta_unconfirmed', 503);
  }
  return json({ ok: true, table, chunk_index: chunkIndex, received: cleaned.length, inserted });
}

const META_KEYS = ['universities_index', 'score_facets', 'plan_facets', 'counts'];

function validateMetaValue(key, value) {
  if (!value || typeof value !== 'object') throw new AppError('invalid_input', 400);
  if (key === 'universities_index') {
    if (!Array.isArray(value) || value.length > 10000) throw new AppError('invalid_input', 400);
    const INDEX_TEXT_FIELDS = ['province', 'city', 'type', 'level', 'tags'];
    for (const item of value) {
      if (typeof item?.code !== 'string' || typeof item?.name !== 'string'
        || item.code.length > 32 || item.name.length > 120) throw new AppError('invalid_input', 400);
      for (const field of INDEX_TEXT_FIELDS) {
        const v = item[field];
        if (v !== undefined && v !== null && (typeof v !== 'string' || v.length > 60)) throw new AppError('invalid_input', 400);
      }
    }
    return value.map((item) => {
      const out = { code: item.code, name: item.name };
      for (const field of INDEX_TEXT_FIELDS) {
        if (typeof item[field] === 'string' && item[field] !== '') out[field] = item[field];
      }
      return out;
    });
  }
  if (key === 'counts') {
    const out = {};
    for (const k of ['universities', 'admission_scores', 'enrollment_plans']) {
      const n = value[k];
      if (!Number.isInteger(n) || n < 0 || n > 10000000) throw new AppError('invalid_input', 400);
      out[k] = n;
    }
    return out;
  }
  // score_facets / plan_facets：有界的字符串/整数数组。
  const out = {};
  for (const field of ['provinces', 'years', 'categories', 'batches']) {
    const arr = value[field];
    if (arr === undefined) continue;
    if (!Array.isArray(arr) || arr.length > 200) throw new AppError('invalid_input', 400);
    out[field] = arr.map((v) => {
      if (field === 'years') {
        if (!Number.isInteger(v) || v < 2000 || v > 2100) throw new AppError('invalid_input', 400);
        return v;
      }
      if (typeof v !== 'string' || v.length > 60) throw new AppError('invalid_input', 400);
      return v;
    });
  }
  return out;
}

async function writeMeta(db, key, value) {
  const now = new Date().toISOString();
  const payload = { key, value: JSON.stringify(value), updated_at: now };
  const created = rows(await db.from('data_meta').insertIfAbsent(payload, { onConflict: 'key' }).select('key'));
  if (created.length !== 1) {
    const updated = rows(await db.from('data_meta').update({ value: payload.value, updated_at: now })
      .eq('key', key).select('key'));
    if (updated.length !== 1) return false;
  }
  return true;
}

// 多省增量导入：索引按代码并集、筛选面按字段并集，已有省份的元数据不被新文件覆盖。
async function mergeMeta(db, key, value) {
  if (key === 'counts') return value;
  const existing = await readMeta(db, key);
  if (key === 'universities_index') {
    const base = Array.isArray(existing) ? existing : [];
    const byCode = new Map(base.map((item) => [item.code, { ...item }]));
    for (const item of value) {
      const prev = byCode.get(item.code);
      // 同代码再次导入时按字段补全/更新（如旧索引只有 code/name，新批次带地区/类型）。
      byCode.set(item.code, prev ? { ...prev, ...item } : { ...item });
    }
    const merged = [...byCode.values()];
    if (merged.length > 10000) throw new AppError('invalid_input', 400);
    return merged;
  }
  const base = existing && typeof existing === 'object' ? existing : {};
  const merged = { ...base };
  for (const field of Object.keys(value)) {
    const prev = Array.isArray(base[field]) ? base[field] : [];
    const union = [...new Set([...prev, ...value[field]])];
    merged[field] = field === 'years' ? union.sort((a, b) => a - b) : union.sort();
  }
  return merged;
}

export async function updateMeta(db, request) {
  // 院校索引可达数百 KB，使用与导入相同的较大正文上限。
  const body = await readJson(request, IMPORT_BODY_LIMIT);
  const key = body?.key;
  if (!META_KEYS.includes(key)) throw new AppError('invalid_input', 400);
  const value = validateMetaValue(key, body?.value);
  const merged = await mergeMeta(db, key, value);
  if (!(await writeMeta(db, key, merged))) return errorJson('meta_unconfirmed', 503);
  return json({ ok: true, key });
}