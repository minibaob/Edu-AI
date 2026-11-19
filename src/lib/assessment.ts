// 模块6 兴趣测评：霍兰德 RIASEC 简化版题库、计分规则与专业/职业映射。
// 全部结果由固定规则计算，不调用 AI。题目顺序必须与后端 functions/assessment.mjs 的
// QUESTION_DIMENSIONS 严格一致；改动时两边同步改，契约测试会校验。
// 注意：测评只用于兴趣探索，不是心理诊断，不能绝对决定学生未来职业。
import { api } from "@/src/lib/api";

export type DimensionCode = "R" | "I" | "A" | "S" | "E" | "C";

export const DIMENSION_ORDER: DimensionCode[] = ["R", "I", "A", "S", "E", "C"];

export const DIMENSIONS: Record<
  DimensionCode,
  { name: string; tagline: string; majors: string[]; careers: string[] }
> = {
  R: {
    name: "现实型",
    tagline: "动手实践型：喜欢操作、制作和户外活动",
    majors: ["机械工程", "土木工程", "电子信息工程", "农业工程", "运动训练"],
    careers: ["工程师", "技术员", "飞行员", "厨师", "农业技术员"],
  },
  I: {
    name: "研究型",
    tagline: "思考探索型：喜欢观察、研究和分析",
    majors: ["数学与应用数学", "物理学", "化学", "生物科学", "临床医学"],
    careers: ["科研人员", "医生", "数据分析师", "研发工程师", "药剂师"],
  },
  A: {
    name: "艺术型",
    tagline: "创造表达型：喜欢想象、设计和表达",
    majors: ["设计学", "美术学", "音乐学", "新闻传播学", "建筑学"],
    careers: ["设计师", "作家", "演员", "建筑师", "摄影师"],
  },
  S: {
    name: "社会型",
    tagline: "助人交流型：喜欢帮助别人、与人合作",
    majors: ["教育学", "社会学", "护理学", "社会工作", "心理学"],
    careers: ["教师", "心理咨询师", "护士", "社工", "人力资源"],
  },
  E: {
    name: "企业型",
    tagline: "领导开拓型：喜欢组织、说服和竞争",
    majors: ["工商管理", "市场营销", "金融学", "法学", "公共管理"],
    careers: ["企业管理者", "销售经理", "律师", "创业者", "公务员"],
  },
  C: {
    name: "常规型",
    tagline: "秩序条理型：喜欢规则、数据和细节",
    majors: ["会计学", "统计学", "档案学", "信息管理与信息系统", "图书馆学"],
    careers: ["会计", "审计", "行政管理", "图书管理员", "数据专员"],
  },
};

export const QUESTIONS: { text: string; dimension: DimensionCode }[] = [
  { text: "动手修理或组装东西让我觉得有意思", dimension: "R" },
  { text: "我想弄明白事物为什么会这样", dimension: "I" },
  { text: "我喜欢画画、写作或拍视频", dimension: "A" },
  { text: "我喜欢帮助同学解决困难", dimension: "S" },
  { text: "我喜欢带领大家一起完成一件事", dimension: "E" },
  { text: "我喜欢把东西整理得井井有条", dimension: "C" },
  { text: "我喜欢户外活动或操作机器设备", dimension: "R" },
  { text: "我喜欢做实验、观察并记录结果", dimension: "I" },
  { text: "我对音乐、戏剧或设计感兴趣", dimension: "A" },
  { text: "我喜欢和人聊天，愿意花时间陪别人", dimension: "S" },
  { text: "我对创业、做买卖感兴趣", dimension: "E" },
  { text: "做事按计划和步骤来让我更安心", dimension: "C" },
  { text: "做手工、木工或模型让我投入", dimension: "R" },
  { text: "解数学或逻辑难题让我兴奋", dimension: "I" },
  { text: "我喜欢用新奇的方式表达想法", dimension: "A" },
  { text: "我愿意倾听别人的烦恼", dimension: "S" },
  { text: "我喜欢说服别人接受自己的想法", dimension: "E" },
  { text: "我喜欢处理数据、表格和文件", dimension: "C" },
  { text: "喜欢动手做东西，拆拆装装也不觉得烦", dimension: "R" },
  { text: "我喜欢看科普文章、了解新发现", dimension: "I" },
  { text: "欣赏艺术作品时，我会想象自己来创作", dimension: "A" },
  { text: "教别人东西让我有成就感", dimension: "S" },
  { text: "我喜欢竞争，争取更好的结果", dimension: "E" },
  { text: "我做事细心，不喜欢出错", dimension: "C" },
];

export const LIKERT = ["非常不符合", "不太符合", "一般", "比较符合", "非常符合"];

export type AssessmentScores = Record<DimensionCode, number>;

export type AssessmentResult = {
  id?: string;
  answers: number[];
  scores: AssessmentScores;
  top_types: DimensionCode[];
  created_at: string;
};

// 与后端完全一致的计分规则（前端用于即时出结果；后端保存时会重算一次）。
export function scoreLocally(answers: number[]): { scores: AssessmentScores; top_types: DimensionCode[] } {
  const sums: Record<DimensionCode, number> = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
  answers.forEach((value, index) => {
    sums[QUESTIONS[index].dimension] += value;
  });
  const scores = {} as AssessmentScores;
  for (const code of DIMENSION_ORDER) {
    scores[code] = Math.round(((sums[code] - 4) / 16) * 100);
  }
  const top_types = [...DIMENSION_ORDER]
    .sort((a, b) => scores[b] - scores[a] || DIMENSION_ORDER.indexOf(a) - DIMENSION_ORDER.indexOf(b))
    .slice(0, 2);
  return { scores, top_types };
}

const STORAGE_KEY = "eduai:assessment:history";

export function loadLocalHistory(): AssessmentResult[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AssessmentResult[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalResult(result: AssessmentResult): void {
  try {
    const history = [result, ...loadLocalHistory()].slice(0, 10);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // 本机存储不可用时忽略，不影响出结果。
  }
}

export async function saveAssessment(answers: number[]): Promise<AssessmentResult> {
  const data = await api<{ assessment: { id: string; scores: AssessmentScores; top_types: DimensionCode[]; created_at: string } }>(
    "/api/assessments",
    { method: "POST", body: { answers } }
  );
  return { answers, scores: data.assessment.scores, top_types: data.assessment.top_types, created_at: data.assessment.created_at, id: data.assessment.id };
}

export async function listAssessments(): Promise<AssessmentResult[]> {
  const data = await api<{ total: number; items: { id: string; version?: number | null; scores: AssessmentScores; top_types: DimensionCode[]; created_at: string }[] }>("/api/assessments");
  // 历史接口合并了三种测评；本函数只服务 24 题版，按 version 过滤，避免混入 MBTI/30 题记录。
  return data.items.filter((item) => item.version === 24).map((item) => ({ answers: [], scores: item.scores, top_types: item.top_types, created_at: item.created_at, id: item.id }));
}
