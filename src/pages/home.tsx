// 首页 / 学习仪表盘：统计数字来自后端 /api/stats 的真实计数（资料总数、
// 高校收录、登录后的收藏与测评数），空数据如实显示「暂无数据」，不再展示
// 演示数字。今日任务保存在本机浏览器（localStorage），首次访问以示例任务
// 起步。个性化推荐仍是演示内容，保留「演示数据」标签。
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle2,
  Circle,
  Compass,
  Lightbulb,
  Plus,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DemoBadge } from "@/src/components/demo-badge";
import { Link } from "@/src/lib/router";
import { useAuth } from "@/src/lib/auth";
import { errorMessage } from "@/src/lib/api";
import {
  DEMO_RECOMMENDATIONS,
  DEMO_TASKS,
  GROWTH_TIPS,
} from "@/src/lib/demo";
import { fetchStats } from "@/src/lib/stats";
import type { HomeStats } from "@/src/lib/stats";
import { cn } from "@/lib/utils";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

const QUICK_ENTRIES = [
  { to: "/resources", title: "学习资料库", desc: "按年级学科找资料", icon: BookOpen },
  { to: "/universities", title: "高校查询", desc: "河北 / 河南录取数据", icon: Building2 },
  { to: "/assessment", title: "兴趣测评", desc: "探索专业与职业方向", icon: Compass },
  { to: "/profile", title: "个人中心", desc: "管理资料与学习设置", icon: User },
];

const TASK_SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "政治", "其他"];

type Task = { id: string; text: string; subject: string; done: boolean };

const TASKS_KEY = "eduai:home:tasks";

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Task[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // 本机存储不可用时用示例任务起步，不阻塞页面。
  }
  return DEMO_TASKS.map((t) => ({ ...t }));
}

function statValue(value: number | null, unit: string, emptyText: string): string {
  if (value === null || value === 0) return emptyText;
  return `${value} ${unit}`;
}

export default function HomePage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskSubject, setNewTaskSubject] = useState(TASK_SUBJECTS[1]);
  const doneCount = tasks.filter((t) => t.done).length;

  useEffect(() => {
    let cancelled = false;
    fetchStats()
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((err) => {
        if (!cancelled) setStatsError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    } catch {
      // 本机存储不可用时忽略，任务仍可在本次会话中使用。
    }
  }, [tasks]);

  function addTask() {
    const text = newTaskText.trim();
    if (!text) return;
    setTasks((prev) => [
      ...prev,
      { id: `t-${Date.now()}`, text, subject: newTaskSubject, done: false },
    ]);
    setNewTaskText("");
  }

  const statCards = [
    {
      label: "资料总数",
      display: stats
        ? stats.resources_capped
          ? `${stats.resources_total}+ 份`
          : statValue(stats.resources_total, "份", "暂无数据")
        : statsError ? "加载失败" : "加载中…",
    },
    {
      label: "高校收录",
      display: stats ? statValue(stats.universities_total, "所", "暂无数据") : statsError ? "加载失败" : "加载中…",
    },
    {
      label: "我的收藏",
      display: stats
        ? stats.favorites_count === null
          ? "登录后查看"
          : `${stats.favorites_count}${stats.favorites_capped ? "+" : ""} 份`
        : statsError
          ? "加载失败"
          : "加载中…",
    },
    {
      label: "已完成测评",
      display: stats
        ? stats.assessments_count === null
          ? "登录后查看"
          : `${stats.assessments_count}${stats.assessments_capped ? "+" : ""} 次`
        : statsError
          ? "加载失败"
          : "加载中…",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className="edu-gradient relative overflow-hidden rounded-2xl px-6 py-10 text-white sm:px-10">
        <div className="relative z-10 flex max-w-2xl flex-col gap-4">
          <p className="text-sm font-medium text-white/85">
            {greeting()}，{user ? user.display_name || user.username : "同学"}
          </p>
          <h1 className="text-3xl font-bold leading-snug sm:text-4xl">
            让学习更智能，让成长有方向
          </h1>
          <p className="text-sm leading-relaxed text-white/90 sm:text-base">
            EduAI 智学未来为高中生提供学习资源、高校录取数据查询、兴趣探索和个人成长管理，
            帮助你发现潜力、降低教育信息差。
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            {user ? (
              <Button asChild className="bg-white text-primary hover:bg-white/90">
                <Link to="/profile">进入个人中心</Link>
              </Button>
            ) : (
              <Button asChild className="bg-white text-primary hover:bg-white/90">
                <Link to="/login">登录 / 注册</Link>
              </Button>
            )}
            <Button
              asChild
              variant="outline"
              className="border-white/60 bg-transparent text-white hover:bg-white/15 hover:text-white"
            >
              <Link to="/assessment">
                先做一次兴趣测评
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
        <Sparkles
          className="absolute -right-6 -top-6 size-44 text-white/15"
          aria-hidden
        />
      </section>

      <section aria-labelledby="overview-title">
        <div className="mb-3 flex items-center gap-2">
          <h2 id="overview-title" className="text-lg font-semibold">学习概览</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statCards.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="flex flex-col gap-1 p-5">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold">{stat.display}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {statsError
            ? `统计暂时无法加载（${statsError}），请稍后刷新重试。`
            : "数字来自资料库与高校数据的实际收录；登录后显示你的收藏与测评数。资料或高校显示「暂无数据」，表示数据尚未导入。"}
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3" aria-labelledby="tasks-title">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle id="tasks-title" className="text-lg">今日任务</CardTitle>
              <span className="text-sm text-muted-foreground">
                {doneCount}/{tasks.length} 已完成
              </span>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {tasks.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  还没有任务，在下方添加一个吧。
                </p>
              ) : (
                tasks.map((task) => (
                  <div
                    key={task.id}
                    className="group flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-accent"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setTasks((prev) =>
                          prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t))
                        )
                      }
                      className="flex flex-1 items-center gap-3 text-left"
                      aria-pressed={task.done}
                      aria-label={task.done ? `标记「${task.text}」为未完成` : `标记「${task.text}」为已完成`}
                    >
                      {task.done ? (
                        <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden />
                      ) : (
                        <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      <span
                        className={cn(
                          "flex-1 text-sm",
                          task.done && "text-muted-foreground line-through"
                        )}
                      >
                        {task.text}
                      </span>
                    </button>
                    <Badge variant="secondary" className="shrink-0">{task.subject}</Badge>
                    <button
                      type="button"
                      onClick={() => setTasks((prev) => prev.filter((t) => t.id !== task.id))}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`删除任务「${task.text}」`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                ))
              )}
              <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row">
                <Input
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addTask();
                  }}
                  placeholder="添加一个今日任务…"
                  aria-label="新任务内容"
                  maxLength={100}
                />
                <div className="flex gap-2">
                  <select
                    value={newTaskSubject}
                    onChange={(e) => setNewTaskSubject(e.target.value)}
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    aria-label="任务学科"
                  >
                    {TASK_SUBJECTS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <Button type="button" onClick={addTask} disabled={!newTaskText.trim()}>
                    <Plus className="size-4" aria-hidden /> 添加
                  </Button>
                </div>
              </div>
              <p className="px-2 pt-2 text-xs text-muted-foreground">
                任务仅保存在本机浏览器，不会同步到账号；首次访问会显示几条示例任务，可直接删除或修改。
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="lg:col-span-2" aria-labelledby="quick-title">
          <h2 id="quick-title" className="mb-3 text-lg font-semibold">快捷入口</h2>
          <div className="grid grid-cols-2 gap-3">
            {QUICK_ENTRIES.map((entry) => (
              <Link
                key={entry.to}
                to={entry.to}
                className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 hover:border-primary/40 hover:shadow-sm"
              >
                <span className="edu-gradient-soft flex size-10 items-center justify-center rounded-lg text-primary">
                  <entry.icon className="size-5" aria-hidden />
                </span>
                <span className="text-sm font-semibold group-hover:text-primary">
                  {entry.title}
                </span>
                <span className="text-xs text-muted-foreground">{entry.desc}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="recommend-title">
        <div className="mb-3 flex items-center gap-2">
          <h2 id="recommend-title" className="text-lg font-semibold">个性化推荐</h2>
          <DemoBadge />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {DEMO_RECOMMENDATIONS.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex flex-col gap-2 p-5">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{item.subject}</Badge>
                  <Badge variant="outline">{item.grade}</Badge>
                </div>
                <p className="text-sm font-medium leading-snug">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.reason}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          登录后将根据你填写的年级、学科和省份生成真实推荐。
        </p>
      </section>

      <section aria-labelledby="tips-title">
        <Card className="edu-gradient-soft border-primary/15">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:gap-4">
            <span className="edu-gradient flex size-10 shrink-0 items-center justify-center rounded-lg text-white">
              <Lightbulb className="size-5" aria-hidden />
            </span>
            <div>
              <h2 id="tips-title" className="text-base font-semibold">学习成长提示</h2>
              <ul className="mt-2 grid gap-1.5 text-sm text-muted-foreground md:grid-cols-2">
                {GROWTH_TIPS.map((tip) => (
                  <li key={tip} className="flex gap-2">
                    <span className="text-primary" aria-hidden>·</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
