// 把官方整理的 河南.xlsx 转成模块5导入模板 CSV（只转换，不修改任何数值）。
// 用法：npm i --no-save xlsx && node dev/convert-henan.mjs <河南.xlsx路径> <输出目录>
// xlsx 仅为本地开发转换依赖，不写入 package.json，不进入 Function 包。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const [srcPath, outDir] = process.argv.slice(2);
if (!srcPath || !outDir) {
  console.error('用法：node dev/convert-henan.mjs <河南.xlsx路径> <输出目录>');
  process.exit(2);
}

const HEADERS = {
  universities: ['院校代码', '学校名称', '所在省份', '所在城市', '办学类型', '办学层次', '标签', '招生网址', '数据来源', '备注'],
  majors: ['专业代码', '专业名称', '学科门类', '学制', '授予学位', '数据来源', '备注'],
  scores: ['院校代码', '省份', '年份', '科类', '批次', '选科要求', '最低分', '最低位次', '录取人数', '数据来源', '备注', '学校名称'],
  plans: ['院校代码', '省份', '年份', '专业代码', '专业名称', '批次', '选科要求', '计划数', '学费', '数据来源', '备注', '学校名称'],
};

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
  ['招生计划', plansSheet, HEADERS.plans],
]) {
  const missing = expected.filter((h) => !sheet.header.includes(h));
  if (missing.length > 0) throw new Error(`${label} 缺少列：${missing.join('、')}`);
}

const scores = scoresSheet.rows;
const plans = plansSheet.rows;

// 院校清单从两张表按「学校名称」归并：录取表用国标代码，计划表用河南报考代码，
// 两套代码不同源，同名院校优先保留录取表代码；仅出现在计划表的院校用计划表代码登记。
const universities = new Map(); // 院校代码 -> row
const nameToCode = new Map(); // 学校名称 -> 院校代码
const collisions = [];
function addUniversity(code, name, source) {
  if (code === '' || name === '') return;
  if (nameToCode.has(name)) {
    const existing = nameToCode.get(name);
    if (existing !== code) collisions.push(`同名不同代码：${name}（${existing} / ${code}）`);
    return;
  }
  if (universities.has(code)) {
    collisions.push(`同代码不同名称：${code}（${universities.get(code)['学校名称']} / ${name}）`);
    return;
  }
  nameToCode.set(name, code);
  universities.set(code, {
    '院校代码': code, '学校名称': name, '所在省份': '', '所在城市': '',
    '办学类型': '', '办学层次': '', '标签': '', '招生网址': '',
    '数据来源': source, '备注': '',
  });
}
for (const row of scores) addUniversity(row['院校代码'], row['学校名称'], row['数据来源']);
for (const row of plans) addUniversity(row['院校代码'], row['学校名称'], row['数据来源']);

// 重复键统计（只报告，不删改数据）
const scoreKeys = new Map();
let scoreDup = 0;
for (const row of scores) {
  const key = [row['院校代码'], row['省份'], row['年份'], row['科类'], row['批次']].join('|');
  scoreKeys.set(key, (scoreKeys.get(key) ?? 0) + 1);
}
for (const n of scoreKeys.values()) if (n > 1) scoreDup += n - 1;
const planKeys = new Map();
let planDup = 0;
for (const row of plans) {
  const key = [row['院校代码'], row['省份'], row['年份'], row['专业代码'] || row['专业名称'], row['批次']].join('|');
  planKeys.set(key, (planKeys.get(key) ?? 0) + 1);
}
for (const n of planKeys.values()) if (n > 1) planDup += n - 1;

fs.mkdirSync(outDir, { recursive: true });
writeCsv(path.join(outDir, 'universities.csv'), HEADERS.universities, [...universities.values()]);
writeCsv(path.join(outDir, 'majors.csv'), HEADERS.majors, []);
writeCsv(path.join(outDir, 'admission_scores.csv'), HEADERS.scores, scores);
writeCsv(path.join(outDir, 'enrollment_plans.csv'), HEADERS.plans, plans);

const report = {
  录取行数: scores.length,
  计划行数: plans.length,
  院校数: universities.size,
  录取_年份: distinct(scores, '年份'),
  录取_科类: distinct(scores, '科类'),
  录取_批次: distinct(scores, '批次'),
  计划_年份: distinct(plans, '年份'),
  计划_批次: distinct(plans, '批次'),
  录取_空值: Object.fromEntries(HEADERS.scores.map((h) => [h, countEmpty(scores, h)])),
  计划_空值: Object.fromEntries(HEADERS.plans.map((h) => [h, countEmpty(plans, h)])),
  录取重复键多余行数: scoreDup,
  计划重复键多余行数: planDup,
  代码名称冲突: collisions.slice(0, 20),
  冲突总数: collisions.length,
};
console.log(JSON.stringify(report, null, 2));
console.log(`已写出 4 个 CSV 到 ${outDir}`);