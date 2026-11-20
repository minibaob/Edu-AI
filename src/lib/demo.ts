// 首页演示数据：仅用于未登录/未接入真实数据时展示界面，全部带“演示数据”标签。
// 不使用任何真实学生隐私信息。

export const DEMO_STATS = [
  { label: "本周学习时长", value: "6.5", unit: "小时" },
  { label: "已完成任务", value: "8", unit: "项" },
  { label: "收藏资料", value: "12", unit: "份" },
  { label: "连续学习", value: "5", unit: "天" },
];

export const DEMO_TASKS = [
  { id: "t1", text: "完成数学《函数单调性》练习 10 题", subject: "数学", done: true },
  { id: "t2", text: "背诵英语必修三 Unit 2 单词", subject: "英语", done: false },
  { id: "t3", text: "整理物理《牛顿运动定律》错题", subject: "物理", done: false },
  { id: "t4", text: "阅读语文素材：人物传记一则", subject: "语文", done: false },
];

export const GROWTH_TIPS = [
  "把大目标拆成每天 30 分钟的小任务，坚持比突击更有效。",
  "整理错题时写下「当时为什么错」，比抄一遍答案更有用。",
  "选科和志愿先看官方数据，再听他人经验，信息差就是这样缩小的。",
  "兴趣测评只是探索的起点，不是对你未来的定义。",
];