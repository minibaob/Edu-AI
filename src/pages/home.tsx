import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle2,
  Circle,
  Compass,
  Lightbulb,
  Sparkles,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DemoBadge } from "@/src/components/demo-badge";
import { Link } from "@/src/lib/router";
import { useAuth } from "@/src/lib/auth";
import {
  DEMO_RECOMMENDATIONS,
  DEMO_STATS,
  DEMO_TASKS,
  GROWTH_TIPS,
} from "@/src/lib/demo";

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

export default function HomePage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState(DEMO_TASKS);
  const doneCount = tasks.filter((t) => t.done).length;

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
          <DemoBadge />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {DEMO_STATS.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="flex flex-col gap-1 p-5">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold">
                  {stat.value}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {stat.unit}
                  </span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3" aria-labelledby="tasks-title">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle id="tasks-title" className="text-lg">今日任务</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {doneCount}/{tasks.length} 已完成
                </span>
                <DemoBadge />
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() =>
                    setTasks((prev) =>
                      prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t))
                    )
                  }
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-accent"
                  aria-pressed={task.done}
                >
                  {task.done ? (
                    <CheckCircle2 className="size-5 shrink-0 text-primary" aria-hidden />
                  ) : (
                    <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span
                    className={
                      task.done
                        ? "flex-1 text-sm text-muted-foreground line-through"
                        : "flex-1 text-sm"
                    }
                  >
                    {task.text}
                  </span>
                  <Badge variant="secondary" className="shrink-0">{task.subject}</Badge>
                </button>
              ))}
              <p className="px-2 pt-2 text-xs text-muted-foreground">
                登录后可创建和保存自己的真实任务（即将上线）。
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