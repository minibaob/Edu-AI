// 模块5 官方数据导入模板的离线校验：只检查格式/枚举/范围/重复键/跨表引用。
// 不连接数据库、不导入数据。用法：node db/import/validate.mjs <存放四个CSV的目录> [已有universities.csv]
// 增量批次（如河北只登记新校）传第二个参数：跨表引用按「本批次 + 已有清单」并集检查。
import fs from 'node:fs';
import path from 'node:path';

const PROVINCES = ['北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆'];
const PILOT_PROVINCES = ['河北', '河南'];
const UNIVERSITY_TYPES = ['综合', '理工', '农林', '医药', '师范', '语言', '财经', '政法', '体育', '艺术', '军事', '其他'];
const UNIVERSITY_LEVELS = ['本科', '专科'];
const TAGS = ['双一流', '985', '211', '公办', '民办', '中外合作'];
const MAJOR_CATEGORIES = ['哲学', '经济学', '法学', '教育学', '文学', '历史学', '理学', '工学', '农学', '医学', '军事学', '管理学', '艺术学', '交叉学科'];
const DEGREES = ['学士', '第二学士', '硕士', '博士'];
const SCORE_CATEGORIES = ['物理类', '历史类', '理科', '文科', '综合', '艺术类', '体育类'];
const CURRENT_YEAR = new Date().getFullYear();

const FILES = {
  'universities.csv': ['院校代码', '学校名称', '所在省份', '所在城市', '办学类型', '办学层次', '标签', '招生网址', '数据来源', '备注'],
  'majors.csv': ['专业代码', '专业名称', '学科门类', '学制', '授予学位', '数据来源', '备注'],
  'admission_scores.csv': ['院校代码', '省份', '年份', '科类', '批次', '选科要求', '最低分', '最低位次', '录取人数', '数据来源', '备注', '学校名称'],
  'enrollment_plans.csv': ['院校代码', '省份', '年份', '专业代码', '专业名称', '批次', '选科要求', '计划数', '学费', '数据来源', '备注', '学校名称'],
};

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const src = text.replace(/^﻿/, '');
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

const errors = [];
const warnings = [];
const fail = (file, line, message) => errors.push(`${file} 第${line}行：${message}`);
const warn = (file, line, message) => warnings.push(`${file} 第${line}行：${message}`);

function intInRange(value, min, max) {
  if (!/^\d+$/.test(value)) return false;
  const n = Number(value);
  return n >= min && n <= max;
}

// 艺术/体育类综合分带小数（官方公布口径），最多两位小数。
function scoreInRange(value, min, max) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return false;
  const n = Number(value);
  return n >= min && n <= max;
}

function checkEnum(file, line, label, value, allowed, required) {
  if (value === '') {
    if (required) fail(file, line, `${label} 必填`);
    return;
  }
  if (!allowed.includes(value)) fail(file, line, `${label}「${value}」不在允许值内：${allowed.join('/')}`);
}

function checkRequired(file, line, label, value) {
  if (value === '') fail(file, line, `${label} 必填`);
}

function checkInt(file, line, label, value, min, max, required) {
  if (value === '') {
    if (required) fail(file, line, `${label} 必填`);
    return;
  }
  if (!intInRange(value, min, max)) fail(file, line, `${label} 应为 ${min}–${max} 的整数（当前「${value}」）`);
}

function loadTable(dir, name) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    errors.push(`缺少文件 ${name}（可从 db/import/templates/ 复制后填写）`);
    return [];
  }
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (rows.length === 0) {
    errors.push(`${name} 为空文件（至少需要表头）`);
    return [];
  }
  const header = rows[0].map((cell) => cell.trim());
  const expected = FILES[name];
  if (header.length !== expected.length || header.some((cell, i) => cell !== expected[i])) {
    errors.push(`${name} 表头不符：应为 ${expected.join(',')}`);
    return [];
  }
  return rows.slice(1).map((cells, index) => {
    const record = { __line: index + 2 };
    expected.forEach((key, i) => { record[key] = (cells[i] ?? '').trim(); });
    if (cells.length > expected.length) fail(name, record.__line, `列数多于表头（${cells.length} > ${expected.length}），请检查是否有多余逗号`);
    return record;
  });
}

const dir = process.argv[2];
if (!dir) {
  console.error('用法：node db/import/validate.mjs <存放四个CSV的目录> [已有universities.csv]');
  process.exit(2);
}

const universities = loadTable(dir, 'universities.csv');
const majors = loadTable(dir, 'majors.csv');
const scores = loadTable(dir, 'admission_scores.csv');
const plans = loadTable(dir, 'enrollment_plans.csv');

const universityCodes = new Set();
const universityNames = new Set();
for (const row of universities) {
  const f = 'universities.csv', l = row.__line;
  checkRequired(f, l, '院校代码', row['院校代码']);
  checkRequired(f, l, '学校名称', row['学校名称']);
  // 官方分数文件往往不含院校属性字段，缺失时网站显示「暂无数据」，故改为选填。
  checkEnum(f, l, '所在省份', row['所在省份'], PROVINCES, false);
  checkEnum(f, l, '办学类型', row['办学类型'], UNIVERSITY_TYPES, false);
  checkEnum(f, l, '办学层次', row['办学层次'], UNIVERSITY_LEVELS, false);
  checkRequired(f, l, '数据来源', row['数据来源']);
  if (row['标签'] !== '') {
    for (const tag of row['标签'].split('|')) {
      if (!TAGS.includes(tag)) fail(f, l, `标签「${tag}」不在允许值内：${TAGS.join('/')}（多个用 | 分隔）`);
    }
  }
  if (row['招生网址'] !== '' && !/^https:\/\/\S+$/.test(row['招生网址'])) fail(f, l, '招生网址 应为 https:// 开头的完整网址');
  if (row['院校代码'] !== '') {
    if (universityCodes.has(row['院校代码'])) fail(f, l, `院校代码「${row['院校代码']}」重复`);
    universityCodes.add(row['院校代码']);
  }
  if (row['学校名称'] !== '') {
    if (universityNames.has(row['学校名称'])) fail(f, l, `学校名称「${row['学校名称']}」重复`);
    universityNames.add(row['学校名称']);
  }
}

const existingRegistry = process.argv[3];
if (existingRegistry) {
  const grid = parseCsv(fs.readFileSync(existingRegistry, 'utf8'));
  const header = (grid[0] ?? []).map((cell) => cell.trim());
  const codeIndex = header.indexOf('院校代码');
  const nameIndex = header.indexOf('学校名称');
  if (codeIndex < 0 || nameIndex < 0) {
    errors.push(`已有清单 ${existingRegistry} 表头缺少 院校代码/学校名称`);
  } else {
    for (const row of grid.slice(1)) {
      if (row[codeIndex]) universityCodes.add(row[codeIndex].trim());
      if (row[nameIndex]) universityNames.add(row[nameIndex].trim());
    }
  }
}

const majorCodes = new Set();
for (const row of majors) {
  const f = 'majors.csv', l = row.__line;
  checkRequired(f, l, '专业代码', row['专业代码']);
  checkRequired(f, l, '专业名称', row['专业名称']);
  checkEnum(f, l, '学科门类', row['学科门类'], MAJOR_CATEGORIES, true);
  checkInt(f, l, '学制', row['学制'], 2, 8, true);
  checkEnum(f, l, '授予学位', row['授予学位'], DEGREES, false);
  checkRequired(f, l, '数据来源', row['数据来源']);
  if (row['专业代码'] !== '') {
    if (!/^\d{4,6}$/.test(row['专业代码'])) fail(f, l, `专业代码 应为 4–6 位数字（当前「${row['专业代码']}」）`);
    if (majorCodes.has(row['专业代码'])) fail(f, l, `专业代码「${row['专业代码']}」重复`);
    majorCodes.add(row['专业代码']);
  }
}

const scoreKeys = new Set();
for (const row of scores) {
  const f = 'admission_scores.csv', l = row.__line;
  checkRequired(f, l, '院校代码', row['院校代码']);
  checkEnum(f, l, '省份', row['省份'], PILOT_PROVINCES, true);
  checkInt(f, l, '年份', row['年份'], 2000, CURRENT_YEAR, true);
  checkEnum(f, l, '科类', row['科类'], SCORE_CATEGORIES, true);
  checkRequired(f, l, '批次', row['批次']);
  checkRequired(f, l, '数据来源', row['数据来源']);
  if (row['最低分'] !== '' && !scoreInRange(row['最低分'], 0, 750)) fail(f, l, `最低分 应为 0–750、最多两位小数（当前「${row['最低分']}」）`);
  checkInt(f, l, '最低位次', row['最低位次'], 1, 10000000, false);
  checkInt(f, l, '录取人数', row['录取人数'], 0, 100000, false);
  if (row['院校代码'] !== '' && !universityCodes.has(row['院校代码'])) fail(f, l, `院校代码「${row['院校代码']}」未在 universities.csv 中登记`);
  if (row['最低分'] === '' && row['最低位次'] === '' && row['录取人数'] === '') warn(f, l, '分数/位次/人数全为空，导入后该条将显示「暂无数据」');
  const key = [row['院校代码'], row['省份'], row['年份'], row['科类'], row['批次']].join('|');
  if (row['院校代码'] !== '' && scoreKeys.has(key)) fail(f, l, `录取记录重复（同院校+省份+年份+科类+批次）：${key}`);
  scoreKeys.add(key);
}

const planKeys = new Set();
for (const row of plans) {
  const f = 'enrollment_plans.csv', l = row.__line;
  checkRequired(f, l, '院校代码', row['院校代码']);
  checkEnum(f, l, '省份', row['省份'], PILOT_PROVINCES, true);
  checkInt(f, l, '年份', row['年份'], 2000, CURRENT_YEAR, true);
  checkRequired(f, l, '专业名称', row['专业名称']);
  checkRequired(f, l, '学校名称', row['学校名称']);
  checkRequired(f, l, '数据来源', row['数据来源']);
  checkInt(f, l, '计划数', row['计划数'], 0, 100000, false);
  checkInt(f, l, '学费', row['学费'], 0, 1000000, false);
  // 计划表用省报考代码（与录取表国标代码不同源），跨表关联按学校名称。
  if (row['学校名称'] !== '' && !universityNames.has(row['学校名称'])) fail(f, l, `学校名称「${row['学校名称']}」未在 universities.csv 中登记`);
  if (row['专业代码'] !== '' && majorCodes.size > 0 && !majorCodes.has(row['专业代码'])) fail(f, l, `专业代码「${row['专业代码']}」未在 majors.csv 中登记`);
  const key = [row['院校代码'], row['省份'], row['年份'], row['专业代码'] || row['专业名称'], row['批次']].join('|');
  // 官方计划中同专业同批次可能因办学地点/合作方不同而多行，重复只警告不报错。
  if (row['院校代码'] !== '' && planKeys.has(key)) warn(f, l, `招生计划键重复（同院校+省份+年份+专业+批次，可能为不同办学地点）：${key}`);
  planKeys.add(key);
}

for (const message of warnings.slice(0, 20)) console.log(`警告 ${message}`);
if (warnings.length > 20) console.log(`……其余 ${warnings.length - 20} 条警告省略（见合计）`);
for (const message of errors) console.log(`错误 ${message}`);
console.log(`\n合计：高校 ${universities.length} 行，专业 ${majors.length} 行，录取 ${scores.length} 行，计划 ${plans.length} 行；错误 ${errors.length}，警告 ${warnings.length}`);
if (errors.length > 0) {
  console.log('校验未通过：请修正后重新运行。');
  process.exit(1);
}
console.log('校验通过：格式与引用关系正确（数据真实性以官方来源为准）。');