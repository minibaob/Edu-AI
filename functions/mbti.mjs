// 模块6扩展：MBTI 风格性格倾向测评（简化版）。题库、计分规则与类型文案的唯一来源。
// 自研简化题目，非官方 MBTI 量表；全部为固定规则与固定内容，不调用任何 AI 模型。
import { AppError } from './http.mjs';

// 四个二分维度；letters 第一个字母对应选项 A，第二个字母对应选项 B。
export const DICHOTOMIES = [
  {
    key: 'EI', letters: ['E', 'I'], name: '能量来源',
    poles: [
      { letter: 'E', name: '外向', description: '在与人互动、讨论和活动中获得能量，倾向于先行动再完善。' },
      { letter: 'I', name: '内向', description: '在独处、思考和专注中获得能量，倾向于先想清楚再行动。' },
    ],
  },
  {
    key: 'SN', letters: ['S', 'N'], name: '信息获取',
    poles: [
      { letter: 'S', name: '实感', description: '关注具体事实、细节和实际经验，重视可验证的信息。' },
      { letter: 'N', name: '直觉', description: '关注可能性、联系和整体图景，喜欢追问背后的含义。' },
    ],
  },
  {
    key: 'TF', letters: ['T', 'F'], name: '决策方式',
    poles: [
      { letter: 'T', name: '思考', description: '依据逻辑、标准和因果分析做决定，重视公平与一致。' },
      { letter: 'F', name: '情感', description: '依据价值观和对他人的影响做决定，重视和谐与共情。' },
    ],
  },
  {
    key: 'JP', letters: ['J', 'P'], name: '生活节奏',
    poles: [
      { letter: 'J', name: '判断', description: '偏好计划、秩序和尽早确定，喜欢把事情安排妥当。' },
      { letter: 'P', name: '感知', description: '偏好灵活、开放和随情况调整，喜欢保留多种可能。' },
    ],
  },
];

export const OPTIONS = [
  { value: 0, label: 'A' },
  { value: 1, label: 'B' },
];

// 28 题：四个维度各 7 题，按 E/I→S/N→T/F→J/P 交错排列，避免连续同维度产生答题惯性。
// 每题选项 A 计第一个字母、选项 B 计第二个字母；选项文案不暴露维度归属。
export const QUESTIONS = [
  { id: 'ei1', dim: 'EI', text: '经过一周紧张学习后，你更想怎样放松？', a: '约朋友聊天、运动或参加活动', b: '独自看书、听歌或安静休息' },
  { id: 'sn1', dim: 'SN', text: '学习新知识时，你更习惯从哪里入手？', a: '具体例题、步骤和事实细节', b: '整体框架、概念之间的联系' },
  { id: 'tf1', dim: 'TF', text: '小组讨论出现分歧时，你更看重什么？', a: '谁的方案更有道理、更符合目标', b: '大家的感受和团队气氛' },
  { id: 'jp1', dim: 'JP', text: '面对一个两周后截止的任务，你通常会？', a: '先定好计划，按步骤提前完成', b: '先收集想法，临近截止时集中冲刺' },
  { id: 'ei2', dim: 'EI', text: '在课堂或小组讨论中，你更常？', a: '边说边想，主动发言', b: '先想清楚，再找机会表达' },
  { id: 'sn2', dim: 'SN', text: '阅读一篇文章时，你更容易注意到？', a: '具体的数据、事例和细节', b: '作者的言外之意和可能的延伸' },
  { id: 'tf2', dim: 'TF', text: '朋友向你倾诉烦恼时，你更倾向于？', a: '帮 TA 分析问题、找出解决办法', b: '先安慰情绪、表示理解和支持' },
  { id: 'jp2', dim: 'JP', text: '你的书桌和文件通常是什么状态？', a: '分类摆放，有固定位置', b: '看起来随意，但自己找得到' },
  { id: 'ei3', dim: 'EI', text: '参加有很多陌生人的活动时，你感觉？', a: '兴奋，乐于认识新朋友', b: '消耗精力，更想和熟人待在一起' },
  { id: 'sn3', dim: 'SN', text: '做手工或实验时，你更喜欢？', a: '按明确的步骤操作', b: '自己尝试不同的做法' },
  { id: 'tf3', dim: 'TF', text: '评价一个决定是否正确，你更看重？', a: '逻辑是否成立、结果是否有效', b: '是否照顾到相关人的处境' },
  { id: 'jp3', dim: 'JP', text: '假期安排上，你更偏好？', a: '提前定好行程，按计划进行', b: '保留弹性，看当时的心情和情况' },
  { id: 'ei4', dim: 'EI', text: '遇到难题时，你更倾向于？', a: '找人讨论，在交流中理清思路', b: '自己先琢磨，想通了再交流' },
  { id: 'sn4', dim: 'SN', text: '你更容易记住的是？', a: '确切的时间、数字和事实', b: '大致的印象、联想和灵感' },
  { id: 'tf4', dim: 'TF', text: '给同学提意见时，你更注意？', a: '指出问题所在，就事论事', b: '措辞委婉，顾及对方的感受' },
  { id: 'jp4', dim: 'JP', text: '计划被临时打乱时，你的第一反应是？', a: '有些烦躁，想尽快恢复安排', b: '无所谓，顺势调整就好' },
  { id: 'ei5', dim: 'EI', text: '你更喜欢的学习方式是？', a: '小组讨论、互相提问', b: '独立自习、深入钻研' },
  { id: 'sn5', dim: 'SN', text: '展望未来时，你更多在想？', a: '接下来具体要做的每一步', b: '各种可能性和长远的图景' },
  { id: 'tf5', dim: 'TF', text: '你认为「公平」更接近？', a: '对所有人用同一套标准', b: '考虑每个人的具体情况' },
  { id: 'jp5', dim: 'JP', text: '完成作业或任务时，你更倾向？', a: '尽早做完，心里踏实', b: '截止前完成就行，中途可以换着做' },
  { id: 'ei6', dim: 'EI', text: '长时间独自学习后，你会？', a: '想找人说话、换个热闹环境', b: '感觉充实，还想继续专注' },
  { id: 'sn6', dim: 'SN', text: '听老师讲一个新概念时，你更想？', a: '马上看例题，弄清怎么用', b: '先追问为什么、还能推广到哪里' },
  { id: 'tf6', dim: 'TF', text: '被批评时，你更在意？', a: '批评的内容是否有道理', b: '对方表达的方式和态度' },
  { id: 'jp6', dim: 'JP', text: '你更认同哪种说法？', a: '先定目标再行动，效率更高', b: '边做边看，方向可以慢慢清晰' },
  { id: 'ei7', dim: 'EI', text: '认识新朋友这件事对你来说？', a: '自然又愉快，朋友越多越好', b: '需要契机，朋友少而深就够了' },
  { id: 'sn7', dim: 'SN', text: '你更信任哪种判断依据？', a: '亲身经历和可靠的事实', b: '灵感、直觉和对趋势的预感' },
  { id: 'tf7', dim: 'TF', text: '团队要淘汰一个方案时，你更支持？', a: '按客观标准比较，择优留下', b: '充分沟通，尽量照顾提出者的感受' },
  { id: 'jp7', dim: 'JP', text: '临近考试，你的复习状态更接近？', a: '按复习表推进，逐项打勾', b: '按状态灵活安排，抓重点突击' },
];

export const RULES_SUMMARY = '共 28 题，每题二选一：选 A 计该维度第一个字母 1 票，选 B 计第二个字母 1 票；每个维度 7 票必分胜负，得票多的字母进入你的四字母类型。计分全部由固定规则完成，不调用任何 AI 模型。';

// 16 型固定文案：自研简化描述，仅供自我探索参考，不代表官方 MBTI 解释。
export const TYPES = {
  ISTJ: { name: '严谨务实者', description: '安静、认真，重视责任与秩序，靠事实和坚持把事情做扎实。', strengths: ['可靠守信', '注重细节', '执行稳定'], growth: '尝试接受计划外的变化，多表达自己的想法。' },
  ISFJ: { name: '细致守护者', description: '温和、体贴，默默照顾身边人的需要，把承诺记在心上。', strengths: ['耐心细致', '乐于助人', '忠诚可靠'], growth: '在照顾他人之余，记得留出精力给自己。' },
  INFJ: { name: '理想洞察者', description: '安静而有主见，关注意义与价值，希望帮助他人成长。', strengths: ['洞察力强', '有理想', '坚持原则'], growth: '把理想拆成可执行的小步骤，避免过度内耗。' },
  INTJ: { name: '战略规划者', description: '独立、有远见，喜欢构建体系，用长期规划达成目标。', strengths: ['战略思维', '独立自主', '追求高效'], growth: '多听取不同意见，给计划留出弹性。' },
  ISTP: { name: '灵巧探索者', description: '冷静、动手能力强，喜欢拆解问题，在实践中找答案。', strengths: ['动手能力强', '临场冷静', '善于排障'], growth: '尝试提前规划，并坚持完成长期任务。' },
  ISFP: { name: '温和创作者', description: '安静、友善，重视内心感受，用行动和作品表达自己。', strengths: ['审美敏锐', '温和包容', '活在当下'], growth: '练习表达立场，为自己的目标多做长远打算。' },
  INFP: { name: '理想共情者', description: '真诚、富有想象力，忠于自己的价值观，关心人的可能性。', strengths: ['共情力强', '富有创意', '价值坚定'], growth: '把想法落到具体行动，接受不完美的开始。' },
  INTP: { name: '逻辑钻研者', description: '好奇、爱思考，喜欢追问原理，构建自己的理解框架。', strengths: ['逻辑严密', '求知欲强', '独立思考'], growth: '给思考设定截止时间，推动想法落地。' },
  ESTP: { name: '活力行动派', description: '精力充沛、反应快，喜欢真实世界的挑战与即时反馈。', strengths: ['行动力强', '适应力好', '善于应变'], growth: '行动前多想一步长期后果，培养耐心。' },
  ESFP: { name: '热情感染者', description: '开朗、友善，喜欢与人相处，把快乐带给身边的人。', strengths: ['热情洋溢', '善于合作', '观察敏锐'], growth: '为重要目标预留专注时间，练习延迟满足。' },
  ENFP: { name: '创意激励者', description: '热情、点子多，善于发现人和事的可能性，感染他人。', strengths: ['创意丰富', '善于激励', '兴趣广泛'], growth: '一次专注一件事，把灵感坚持做完。' },
  ENTP: { name: '思辨探索者', description: '机敏、爱辩论，喜欢挑战既有思路，探索新的可能。', strengths: ['思维敏捷', '勇于创新', '善于论辩'], growth: '兼顾他人感受，把辩论变成建设性讨论。' },
  ESTJ: { name: '果断组织者', description: '务实、果断，善于制定规则并组织资源，推动事情落地。', strengths: ['组织力强', '决断明快', '重视效率'], growth: '多倾听不同声音，给他人留出自主空间。' },
  ESFJ: { name: '热心协调者', description: '热心、周到，重视和谐与合作，把集体照顾得井井有条。', strengths: ['热心周到', '善于协调', '责任感强'], growth: '不必让所有人满意，学会温和地拒绝。' },
  ENFJ: { name: '感召引领者', description: '热情、有担当，善于理解并激励他人，带领团队成长。', strengths: ['感召力强', '善解人意', '有责任感'], growth: '先照顾自己的节奏，避免承担过多。' },
  ENTJ: { name: '目标领航者', description: '自信、有魄力，着眼长远目标，善于组织人和资源。', strengths: ['目标明确', '领导果断', '战略清晰'], growth: '放慢节奏倾听细节，允许他人按自己的方式成长。' },
};

// 答案必须是覆盖全部 28 题、取值 0/1 的整数映射；多余键、缺题、非法值一律拒绝。
export function validateAnswers(body) {
  const raw = body?.answers;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError('invalid_answers', 400);
  const keys = Object.keys(raw);
  if (keys.length !== QUESTIONS.length) throw new AppError('invalid_answers', 400);
  const answers = {};
  for (const question of QUESTIONS) {
    const value = raw[question.id];
    if (!Number.isInteger(value) || value < 0 || value > 1) throw new AppError('invalid_answers', 400);
    answers[question.id] = value;
  }
  return answers;
}

export function computeResult(answers) {
  const scores = {};
  for (const dichotomy of DICHOTOMIES) {
    for (const letter of dichotomy.letters) scores[letter] = 0;
  }
  for (const question of QUESTIONS) {
    const dichotomy = DICHOTOMIES.find((entry) => entry.key === question.dim);
    scores[dichotomy.letters[answers[question.id]]] += 1;
  }
  const code = DICHOTOMIES
    .map((dichotomy) => (scores[dichotomy.letters[0]] > scores[dichotomy.letters[1]] ? dichotomy.letters[0] : dichotomy.letters[1]))
    .join('');
  return { scores, code };
}

export function publicResult(row) {
  const scores = typeof row.scores === 'string' ? JSON.parse(row.scores) : row.scores;
  const code = row.code;
  return {
    id: row.id,
    created_at: row.created_at,
    code,
    scores,
    type: TYPES[code] ?? null,
    dichotomies: DICHOTOMIES.map((dichotomy) => ({
      key: dichotomy.key,
      name: dichotomy.name,
      letter: code[DICHOTOMIES.indexOf(dichotomy)],
      poles: dichotomy.poles.map((pole) => ({ ...pole, count: scores[pole.letter] })),
    })),
  };
}