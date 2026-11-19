// 模块6：霍兰德 RIASEC 简化版兴趣测评（30 题三档版）。
// 与 24 题 5 级量表版（functions/assessment.mjs）并存，用户自选；路由为 /api/assessment/*。
// 题库、选项、计分规则与方向对照表的唯一来源。全部为固定规则与固定内容，不调用任何 AI 模型。
// 对照表参考霍兰德职业兴趣理论（RIASEC）与普通高等学校本科专业目录通用名称整理，仅供兴趣探索参考。
import { AppError } from './http.mjs';

export const DIMENSION_ORDER = ['R', 'I', 'A', 'S', 'E', 'C'];

export const DIMENSIONS = [
  {
    key: 'R', name: '现实型', english: 'Realistic', keyword: '动手操作',
    description: '偏好具体任务与工具、机器、户外活动，重视看得见摸得着的成果。',
    majors: ['机械工程', '土木工程', '电子信息工程', '农业工程', '动物医学'],
    careers: ['机械工程师', '土木工程师', '电子技术员', '农艺师', '兽医'],
  },
  {
    key: 'I', name: '研究型', english: 'Investigative', keyword: '观察分析',
    description: '偏好观察、实验与推理，喜欢弄清现象背后的原理与规律。',
    majors: ['数学与应用数学', '物理学', '生物科学', '化学', '计算机科学与技术'],
    careers: ['科研人员', '数据分析师', '软件工程师', '实验研究员', '医生'],
  },
  {
    key: 'A', name: '艺术型', english: 'Artistic', keyword: '创造表达',
    description: '偏好自由表达与创作，重视美感、想象与新颖的表达方式。',
    majors: ['美术学', '设计学类', '音乐学', '戏剧影视文学', '汉语言文学'],
    careers: ['设计师', '插画师', '作家', '音乐人', '影视编导'],
  },
  {
    key: 'S', name: '社会型', english: 'Social', keyword: '助人合作',
    description: '偏好与人相处，乐于帮助、教导、照顾与服务他人。',
    majors: ['教育学', '学前教育', '护理学', '社会学', '心理学'],
    careers: ['教师', '护士', '社会工作者', '心理咨询师', '培训师'],
  },
  {
    key: 'E', name: '企业型', english: 'Enterprising', keyword: '影响领导',
    description: '偏好影响与带领他人，喜欢目标、竞争、经营与公开表达。',
    majors: ['工商管理', '市场营销', '法学', '国际经济与贸易', '公共事业管理'],
    careers: ['企业管理者', '市场营销人员', '律师', '创业者', '项目经理'],
  },
  {
    key: 'C', name: '常规型', english: 'Conventional', keyword: '秩序精确',
    description: '偏好有序、明确的任务，重视准确、细节、规范与可预期的流程。',
    majors: ['会计学', '财务管理', '审计学', '档案学', '统计学'],
    careers: ['会计师', '审计师', '出纳', '档案管理员', '统计人员'],
  },
];

export const OPTIONS = [
  { value: 0, label: '不喜欢' },
  { value: 1, label: '一般' },
  { value: 2, label: '喜欢' },
];

// 30 题：六个维度各 5 题，按 R→I→A→S→E→C 交错排列，避免连续同维度产生答题惯性。
export const QUESTIONS = [
  { id: 'r1', dim: 'R', text: '动手组装、修理或制作实物（如模型、工具、小装置）' },
  { id: 'i1', dim: 'I', text: '做实验并观察、记录结果' },
  { id: 'a1', dim: 'A', text: '绘画、设计、摄影或做手工创作' },
  { id: 's1', dim: 'S', text: '给同学讲解题目、帮助别人学会' },
  { id: 'e1', dim: 'E', text: '担任组织者或负责人，带领团队达成目标' },
  { id: 'c1', dim: 'C', text: '整理文件、表格或数据，使其井井有条' },
  { id: 'r2', dim: 'R', text: '操作机器、设备或工具完成任务' },
  { id: 'i2', dim: 'I', text: '钻研数学或逻辑难题' },
  { id: 'a2', dim: 'A', text: '写作、写诗或编故事' },
  { id: 's2', dim: 'S', text: '参加志愿服务或公益活动' },
  { id: 'e2', dim: 'E', text: '说服别人接受自己的观点或方案' },
  { id: 'c2', dim: 'C', text: '按明确流程和规则核对、检查细节' },
  { id: 'r3', dim: 'R', text: '参加户外体力活动或运动训练' },
  { id: 'i3', dim: 'I', text: '阅读科普书籍，弄清现象背后的原理' },
  { id: 'a3', dim: 'A', text: '演奏乐器、唱歌或参与戏剧表演' },
  { id: 's3', dim: 'S', text: '倾听朋友的烦恼并安慰、支持他们' },
  { id: 'e3', dim: 'E', text: '策划活动、拉赞助或做推广' },
  { id: 'c3', dim: 'C', text: '记录账目、清单或日程安排' },
  { id: 'r4', dim: 'R', text: '照料植物、动物或参与种植养殖' },
  { id: 'i4', dim: 'I', text: '分析数据，寻找规律和证据' },
  { id: 'a4', dim: 'A', text: '欣赏并评价音乐、美术或影视作品' },
  { id: 's4', dim: 'S', text: '组织小组合作、协调大家分工' },
  { id: 'e4', dim: 'E', text: '参与竞选、辩论或公开演讲' },
  { id: 'c4', dim: 'C', text: '归档资料、维护目录和编号' },
  { id: 'r5', dim: 'R', text: '按图纸或步骤搭建、安装具体物件' },
  { id: 'i5', dim: 'I', text: '独立研究一个感兴趣的问题并写出小结' },
  { id: 'a5', dim: 'A', text: '用新颖的方式布置、装饰或表达想法' },
  { id: 's5', dim: 'S', text: '教别人一项技能或照顾他人' },
  { id: 'e5', dim: 'E', text: '尝试小买卖、项目经营或资源调配' },
  { id: 'c5', dim: 'C', text: '执行有明确标准的任务并保证准确' },
];

export const RULES_SUMMARY = '共 30 题，每题三档：不喜欢 0 分、一般 1 分、喜欢 2 分；每个维度 5 题，满分 10 分；得分最高的三个维度组成兴趣代码，同分时按 R→I→A→S→E→C 固定顺序排列。';

// 答案必须是覆盖全部 30 题、取值 0/1/2 的整数映射；多余键、缺题、非法值一律拒绝。
export function validateAnswers(body) {
  const raw = body?.answers;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('invalid_answers', 400);
  const keys = Object.keys(raw);
  if (keys.length !== QUESTIONS.length) throw new AppError('invalid_answers', 400);
  const answers = {};
  for (const question of QUESTIONS) {
    const value = raw[question.id];
    if (!Number.isInteger(value) || value < 0 || value > 2) throw new AppError('invalid_answers', 400);
    answers[question.id] = value;
  }
  return answers;
}

export function computeResult(answers) {
  const scores = Object.fromEntries(DIMENSION_ORDER.map((key) => [key, 0]));
  for (const question of QUESTIONS) scores[question.dim] += answers[question.id];
  const code = [...DIMENSION_ORDER]
    .sort((a, b) => scores[b] - scores[a] || DIMENSION_ORDER.indexOf(a) - DIMENSION_ORDER.indexOf(b))
    .slice(0, 3)
    .join('');
  return { scores, code };
}

export function publicResult(row) {
  const scores = typeof row.scores === 'string' ? JSON.parse(row.scores) : row.scores;
  const code = row.code;
  const byKey = Object.fromEntries(DIMENSIONS.map((dimension) => [dimension.key, dimension]));
  return {
    id: row.id,
    created_at: row.created_at,
    code,
    scores,
    dimensions: DIMENSIONS.map((dimension) => ({ ...dimension, score: scores[dimension.key] })),
    top: [...code].map((key) => ({ ...byKey[key], score: scores[key] })),
  };
}