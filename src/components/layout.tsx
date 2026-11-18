import type { ReactNode } from "react";
import { BookOpen, Building2, Compass, GraduationCap, Home, LogOut, User } from "lucide-react";
import { Link, navigate, useRoute } from "@/src/lib/router";
import { useAuth } from "@/src/lib/auth";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "首页", icon: Home },
  { to: "/resources", label: "学习资料库", icon: BookOpen },
  { to: "/universities", label: "高校查询", icon: Building2 },
  { to: "/assessment", label: "兴趣测评", icon: Compass },
];

export function Layout({ children }: { children: ReactNode }) {
  const route = useRoute();
  const { user, logout } = useAuth();

  async function handleLogout() {
    try {
      await logout();
      navigate("/");
    } catch {
      // 退出失败时保留登录状态，用户可重试。
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4">
          <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="EduAI 智学未来 首页">
            <span className="edu-gradient flex size-9 items-center justify-center rounded-lg text-white">
              <GraduationCap className="size-5" aria-hidden />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-base font-bold">EduAI 智学未来</span>
              <span className="hidden text-xs text-muted-foreground sm:block">
                AI-Powered Learning &amp; Growth Platform
              </span>
            </span>
          </Link>
          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="主导航">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
                  route === item.to && "bg-accent text-primary"
                )}
                aria-current={route === item.to ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <Link
              to="/profile"
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
                route === "/profile" && "bg-accent text-primary"
              )}
            >
              <User className="size-4" aria-hidden />
              <span className="hidden max-w-28 truncate sm:inline">
                {user ? user.display_name || user.username : "个人中心"}
              </span>
            </Link>
            {user ? (
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <LogOut className="size-4" aria-hidden />
                <span className="hidden sm:inline">退出</span>
              </button>
            ) : (
              <Link
                to="/login"
                className="edu-gradient rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                登录 / 注册
              </Link>
            )}
          </div>
        </div>
        <nav
          className="scrollbar-none flex gap-1 overflow-x-auto border-t border-border px-3 py-1.5 md:hidden"
          aria-label="主导航（移动端）"
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground",
                route === item.to && "bg-accent font-medium text-primary"
              )}
              aria-current={route === item.to ? "page" : undefined}
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="font-medium text-foreground">让学习更智能，让成长有方向。</p>
          <p>站内资料仅供学习交流，版权归原作者所有 · 录取数据以各省教育考试院官方公布为准</p>
        </div>
      </footer>
    </div>
  );
}