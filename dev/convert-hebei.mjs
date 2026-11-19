// 把官方整理的 河北.xlsx 转成模块5导入模板 CSV（只转换，不修改任何数值）。
// 用法：node dev/convert-hebei.mjs <河北.xlsx路径> <输出目录> [河南universities.csv路径]
// 河北计划表官方无「学校名称」列：优先用录取表「院校代码→学校名称」交叉表补齐；
// 交叉表没有的代码（河北报考代码）从官方来源引文提取校名（两种引文格式），
// 两种途径都有时强制一致，否则报错停止——不猜测、不编造。
// 院校清单按学校名称对已有河南清单去重，只登记新校，避免同名院校重复条目。
// xlsx 仅为本地开发转换依赖，不写入 package.json，不进入 Function 包。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const [srcPath, outDir, henanCsv] = process.argv.slice(2);
if (!srcPath || !outDir) {
  console.error('用法：node dev/convert-hebei.mjs <河北.xlsx路径> <输出目录> [河南universities.csv路径]');
  process.exit(2);
}

const HEADERS = {
  universities: ['院校代码', '学校名称', '所在省份', '所在城市', '办学类型', '办学层次', '标签', '招生网址', '数据来源', '备注'],
  majors: ['专业代码', '专业名称', '学科门类', '学制', '授予学位', '数据来源', '备注'],
  scores: ['院校代码', '省份', '年份', '科类', '批次', '选科要求', '最低分', '最低位次', '录取人数', '数据来源', '备注', '学校名称'],
  plans: ['院校代码', '省份', '年份', '专业代码', '专业名称', '批次', '选科要求', '计划数', '学费', '数据来源', '备注', '学校名称'],
};
const PLAN_SOURCE_HEADERS = HEADERS.plans.filter((h) => h !== '学校名称');

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}

function readSheet(workbook, name) {
  const ws = workbook.Sheets[name];
  if (!ws) throw new Error(`缺少工作表「${name}」`);
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  const header = grid[0].map(cellText);
  const rows = [];
  for (let i = 1; i < grid.length; i += 1) {
    const record = {};
    header.forEach((key, j) => { record[key] = cellText(grid[i][j]); });
    if (Object.values(record).some((v) => v !== '')) rows.push(record);
  }
  return { header, rows };
}

function csvField(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function writeCsv(file, header, rows) {
  const lines = [header.join(',')];
  for (const row of rows) lines.push(header.map((key) => csvField(row[key] ?? '')).join(','));
  fs.writeFileSync(file, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const out = [];
  let row = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\r') { /* CRLF */ }
    else if (c === '\n') { row.push(cur); out.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length > 0) { row.push(cur); out.push(row); }
  return out;
}

// 官方来源引文两种格式：「X招生网《…》」与「掌上高考…数据库《X2026年河北省招生计划》」。
function nameFromSource(source) {
  const i = source.indexOf('《');
  if (i < 0) return '';
  const prefix = source.slice(0, i);
  if (prefix.endsWith('招生网')) return prefix.slice(0, -3);
  const m = source.slice(i).match(/^《(.+?)(20\d{2})年河北省招生计划》/);
  return m ? m[1] : '';
}

function distinct(rows, key) {
  return [...new Set(rows.map((r) => r[key]).filter((v) => v !== ''))].sort();
}

function countEmpty(rows, key) {
  return rows.filter((r) => r[key] === '').length;
}

const workbook = XLSX.readFile(srcPath, { cellDates: false });
const scoresSheet = readSheet(workbook, '录取数据');
const plansSheet = readSheet(workbook, '招生计划');
for (const [label, sheet, expected] of [
  ['录取数据', scoresSheet, HEADERS.scores],
  ['招生计划', plansSheet, PLAN_SOURCE_HEADERS],
]) {
  const missing = expected.filter((h) => !sheet.header.includes(h));
  if (missing.length > 0) throw new Error(`${label} 缺少列：${missing.join('、')}`);
}
const scores = scoresSheet.rows;
const plans = plansSheet.rows;

const codeToName = new Map();
for (const row of scores) {
  const existing = codeToName.get(row['院校代码']);
  if (existing && existing !== row['学校名称']) {
    throw new Error(`录取表同代码不同名称：${row['院校代码']}（${existing} / ${row['学校名称']}）`);
  }
  codeToName.set(row['院校代码'], row['学校名称']);
}

let viaCrosswalk = 0;
let viaSource = 0;
for (const row of plans) {
  const cross = codeToName.get(row['院校代码']) ?? '';
  const fromSource = nameFromSource(row['数据来源']);
  if (cross && fromSource && cross !== fromSource) {
    throw new Error(`校名交叉校验不一致：代码 ${row['院校代码']}（录取表 ${cross} / 来源 ${fromSource}）`);
  }
  const name = cross || fromSource;
  if (!name) throw new Error(`计划行无法确定学校名称：代码 ${row['院校代码']} 来源 ${row['数据来源']}`);
  if (cross) viaCrosswalk += 1; else viaSource += 1;
  row['学校名称'] = name;
}

const existingNames = new Set();
if (henanCsv) {
  const grid = parseCsv(henanCsv);
  const nameIndex = grid[0].indexOf('学校名称');
  for (const row of grid.slice(1)) if (row[nameIndex]) existingNames.add(row[nameIndex]);
}

const universities = new Map(); // 学校名称 -> row（新校 only）
let skippedExisting = 0;
function addUniversity(code, name, source) {
  if (code === '' || name === '') return;
  if (existingNames.has(name)) { skippedExisting += 1; return; }
  if (universities.has(name)) return;
  universities.set(name, {
    '院校代码': code, '学校名称': name, '所在省份': '', '所在城市': '',
    '办学类型': '', '办学层次': '', '标签': '', '招生网址': '',
    '数据来源': source, '备注': '',
  });
}
for (const row of scores) addUniversity(row['院校代码'], row['学校名称'], row['数据来源']);
for (const row of plans) addUniversity(row['院校代码'], row['学校名称'], row['数据来源']);

const scoreKeys = new Map();
for (const row of scores) {
  const key = [row['院校代码'], row['省份'], row['年份'], row['科类'], row['批次']].join('|');
  scoreKeys.set(key, (scoreKeys.get(key) ?? 0) + 1);
}
let scoreDup = 0;
for (const n of scoreKeys.values()) if (n > 1) scoreDup += n - 1;
const planKeys = new Map();
for (const row of plans) {
  const key = [row['院校代码'], row['省份'], row['年份'], row['专业代码'] || row['专业名称'], row['批次'], row['选科要求']].join('|');
  planKeys.set(key, (planKeys.get(key) ?? 0) + 1);
}
let planDup = 0;
for (const n of planKeys.values()) if (n > 1) planDup += n - 1;

fs.mkdirSync(outDir, { recursive: true });
writeCsv(path.join(outDir, 'universities.csv'), HEADERS.universities, [...universities.values()]);
writeCsv(path.join(outDir, 'majors.csv'), HEADERS.majors, []);
writeCsv(path.join(outDir, 'admission_scores.csv'), HEADERS.scores, scores);
writeCsv(path.join(outDir, 'enrollment_plans.csv'), HEADERS.plans, plans);

const report = {
  录取行数: scores.length,
  计划行数: plans.length,
  新登记院校数: universities.size,
  跳过已有院校行数: skippedExisting,
  计划校名_交叉表: viaCrosswalk,
  计划校名_来源引文: viaSource,
  录取_年份: distinct(scores, '年份'),
  录取_科类: distinct(scores, '科类'),
  录取_批次: distinct(scores, '批次'),
  计划_年份: distinct(plans, '年份'),
  计划_批次: distinct(plans, '批次'),
  录取_空值: Object.fromEntries(HEADERS.scores.map((h) => [h, countEmpty(scores, h)])),
  计划_空值: Object.fromEntries(HEADERS.plans.map((h) => [h, countEmpty(plans, h)])),
  录取重复键多余行数: scoreDup,
  计划重复键多余行数: planDup,
};
console.log(JSON.stringify(report, null, 2));
console.log(`已写出 4 个 CSV 到 ${outDir}`);