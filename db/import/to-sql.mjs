// 模块5 官方数据导入工具：把校验通过的四个 CSV 转成可入库的 SQL。
// 用法：node db/import/to-sql.mjs <存放四个CSV的目录> [输出文件]
//   1. 先调用 db/import/validate.mjs 校验，校验不通过直接退出，不生成 SQL。
//   2. 再把四张表转成 INSERT ... ON CONFLICT DO NOTHING，写到标准输出或指定文件。
// 生成的 SQL 由开发者通过平台审核迁移流程应用；浏览器不直接写数据库。
// 本工具不连接数据库、不编造数据：CSV 里没有的行就是没有，缺失字段写 NULL。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
const outFile = process.argv[3] || null;
if (!dir) {
  console.error('用法：node db/import/to-sql.mjs <存放四个CSV的目录> [输出文件]');
  process.exit(2);
}

// 先跑校验：不通过就不生成 SQL。
const here = path.dirname(fileURLToPath(import.meta.url));
const checked = spawnSync(process.execPath, [path.join(here, 'validate.mjs'), dir], { stdio: 'inherit' });
if (checked.status !== 0) {
  console.error('校验未通过：未生成 SQL。');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function readTable(name) {
  const text = fs.readFileSync(path.join(dir, name), 'utf-8');
  const rows = parseCsv(text);
  const header = rows[0];
  return rows.slice(1).map((cells, index) => {
    const row = { __line: index + 2 };
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}

// SQL 字面量转义：单引号加倍；只接受文本/整数/NULL，绝不拼接未经转义的原始输入。
function lit(value) {
  if (value === '' || value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}
function intLit(value) {
  if (value === '' || value === null || value === undefined) return 'NULL';
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`非整数值：${value}`);
  return String(n);
}
function tagsLit(value) {
  if (!value) return 'NULL';
  return lit(value.split('|').map((t) => t.trim()).filter(Boolean).join('|'));
}

const now = new Date().toISOString();
const universities = readTable('universities.csv');
const majors = readTable('majors.csv');
const scores = readTable('admission_scores.csv');
const plans = readTable('enrollment_plans.csv');

const lines = [];
lines.push('-- EduAI 模块5 官方数据导入（由 db/import/to-sql.mjs 生成）。');
lines.push('-- 来源目录：' + dir);
lines.push('-- 生成时间：' + now);
lines.push('-- 应用方式：通过平台审核迁移流程执行；重复执行安全（ON CONFLICT DO NOTHING）。');
lines.push('');

for (const u of universities) {
  lines.push(`INSERT INTO app.universities (code, name, province, city, type, level, tags, admission_url, source, note, created_at) VALUES (${lit(u['院校代码'])}, ${lit(u['学校名称'])}, ${lit(u['所在省份'])}, ${lit(u['所在城市'])}, ${lit(u['办学类型'])}, ${lit(u['办学层次'])}, ${tagsLit(u['标签'])}, ${lit(u['招生网址'])}, ${lit(u['数据来源'])}, ${lit(u['备注'])}, '${now}') ON CONFLICT (code) DO NOTHING;`);
}
for (const m of majors) {
  lines.push(`INSERT INTO app.majors (code, name, category, years, degree, source, note, created_at) VALUES (${lit(m['专业代码'])}, ${lit(m['专业名称'])}, ${lit(m['学科门类'])}, ${intLit(m['学制'])}, ${lit(m['授予学位'])}, ${lit(m['数据来源'])}, ${lit(m['备注'])}, '${now}') ON CONFLICT (code) DO NOTHING;`);
}
for (const s of scores) {
  lines.push(`INSERT INTO app.admission_scores (id, university_code, province, year, category, batch, subject_requirement, min_score, min_rank, admitted_count, source, note, created_at) VALUES (gen_random_uuid(), ${lit(s['院校代码'])}, ${lit(s['省份'])}, ${intLit(s['年份'])}, ${lit(s['科类'])}, ${lit(s['批次'])}, ${lit(s['选科要求'])}, ${intLit(s['最低分'])}, ${intLit(s['最低位次'])}, ${intLit(s['录取人数'])}, ${lit(s['数据来源'])}, ${lit(s['备注'])}, '${now}') ON CONFLICT (university_code, province, year, category, batch) DO NOTHING;`);
}
for (const p of plans) {
  lines.push(`INSERT INTO app.enrollment_plans (id, university_code, province, year, major_code, major_name, batch, subject_requirement, plan_count, tuition, source, note, created_at) VALUES (gen_random_uuid(), ${lit(p['院校代码'])}, ${lit(p['省份'])}, ${intLit(p['年份'])}, ${lit(p['专业代码'])}, ${lit(p['专业名称'])}, ${lit(p['批次'])}, ${lit(p['选科要求'])}, ${intLit(p['计划数'])}, ${intLit(p['学费'])}, ${lit(p['数据来源'])}, ${lit(p['备注'])}, '${now}') ON CONFLICT (university_code, province, year, major_name, batch) DO NOTHING;`);
}
lines.push('');
lines.push(`-- 合计：高校 ${universities.length} 行，专业 ${majors.length} 行，录取 ${scores.length} 行，计划 ${plans.length} 行。`);

const sql = lines.join('\n') + '\n';
if (outFile) {
  fs.writeFileSync(outFile, sql, 'utf-8');
  console.log(`已生成 ${outFile}：高校 ${universities.length} 行，专业 ${majors.length} 行，录取 ${scores.length} 行，计划 ${plans.length} 行。`);
} else {
  process.stdout.write(sql);
}
