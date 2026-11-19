// 模块6 兴趣测评评分：霍兰德 RIASEC 简化版，固定规则，不调用 AI。
// 题目共 24 道，每维度 4 道，5 级量表（1=非常不符合 … 5=非常符合）。
// 题目顺序与前端 src/lib/assessment.ts 的 QUESTIONS 严格一致（交错排列，
// 每 6 道为一个 R/I/A/S/E/C 循环）；改动顺序时两边必须同步改，契约测试会校验。
// 计分：每维度 4 道之和（4–20）归一化为 0–100；取前两名，得分相同时按
// R/I/A/S/E/C 的固定顺序排，绝不使用随机结果。
import { AppError } from './http.mjs';

export const DIMENSION_ORDER = ['R', 'I', 'A', 'S', 'E', 'C'];
export const QUESTION_DIMENSIONS = [
  'R', 'I', 'A', 'S', 'E', 'C',
  'R', 'I', 'A', 'S', 'E', 'C',
  'R', 'I', 'A', 'S', 'E', 'C',
  'R', 'I', 'A', 'S', 'E', 'C',
];

export function validateAnswers(raw) {
  if (!Array.isArray(raw) || raw.length !== QUESTION_DIMENSIONS.length) {
    throw new AppError('invalid_assessment', 400);
  }
  if (!raw.every((v) => Number.isInteger(v) && v >= 1 && v <= 5)) {
    throw new AppError('invalid_assessment', 400);
  }
  return raw;
}

export function scoreAssessment(answers) {
  const sums = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
  answers.forEach((value, index) => {
    sums[QUESTION_DIMENSIONS[index]] += value;
  });
  const scores = {};
  for (const code of DIMENSION_ORDER) {
    scores[code] = Math.round(((sums[code] - 4) / 16) * 100);
  }
  const top_types = [...DIMENSION_ORDER]
    .sort((a, b) => scores[b] - scores[a] || DIMENSION_ORDER.indexOf(a) - DIMENSION_ORDER.indexOf(b))
    .slice(0, 2);
  return { scores, top_types };
}
