import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Compass, Heart, KeyRound, LogIn, Save, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/src/lib/auth";
import { ApiError, api, errorMessage } from "@/src/lib/api";
import { Link } from "@/src/lib/router";
import { GRADES, PROVINCES, SUBJECTS } from "@/src/lib/options";
import { cn } from "@/lib/utils";

const DIMENSION_NAMES: Record<string, string> = {
  R: "现实型",
  I: "研究型",
  A: "艺术型",
  S: "社会型",
  E: "企业型",
  C: "常规型",
};

type FavoriteItem = {
  id: string;
  title: string;
  grade: string;
  subject: string;
  type: string;
  source_name: string;
  created_at: string;
};

type AssessmentItem = {
  id: string;
  kind: string;
  code: string;
  scores: Record<string, number>;
  top_types: string[];
  created_at: string;
};

type SectionState = "loading" | "ready" | "unavailable" | "error";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export default function ProfilePage() {
  const { user, loading, backendAvailable, logout, updateProfile, changePassword } = useAuth();

  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [grade, setGrade] = useState(user?.grade ?? "");
  const [province, setProvince] = useState(user?.province ?? "");
  const [subjects, setSubjects] = useState<string[]>(user?.subjects ?? []);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 表单初始值随登录用户变化同步（useEffect），不在渲染期间 setState。
  const [formUserId, setFormUserId] = useState<string | null>(user?.id ?? null);
  useEffect(() => {
    if (!user || user.id === formUserId) return;
    setFormUserId(user.id);
    setDisplayName(user.display_name ?? "");
    setGrade(user.grade ?? "");
    setProvince(user.province ?? "");
    setSubjects(user.subjects ?? []);
  }, [user, formUserId]);

  // 我的收藏 / 我的测评记录：接口随模块 4（资料库）与模块 6（测评）上线后
  // 生效；接口尚未合并时返回 404，前端如实显示「尚未上线」，不编造数据。
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [favoritesState, setFavoritesState] = useState<SectionState>("loading");
  const [favoritesError, setFavoritesError] = useState("");
  const [assessments, setAssessments] = useState<AssessmentItem[]>([]);
  const [assessmentsState, setAssessmentsState] = useState<SectionState>("loading");
  const [assessmentsError, setAssessmentsError] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api<{ total: number; items: FavoriteItem[] }>("/api/favorites")
      .then((data) => {
        if (cancelled) return;
        setFavorites(data.items);
        setFavoritesState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setFavoritesState("unavailable");
        } else {
          setFavoritesState("error");
          setFavoritesError(errorMessage(err));
        }
      });
    api<{ total: number; items: AssessmentItem[] }>("/api/assessments")
      .then((data) => {
        if (cancelled) return;
        setAssessments(data.items);
        setAssessmentsState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setAssessmentsState("unavailable");
        } else {
          setAssessmentsState("error");
          setAssessmentsError(errorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function handleProfile(event: FormEvent) {
    event.preventDefault();
    setProfileMsg(null);
    setProfileBusy(true);
    try {
      await updateProfile({ display_name: displayName, grade, province, subjects });
      setProfileMsg({ ok: true, text: "资料已保存" });
    } catch (err) {
      setProfileMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setProfileBusy(false);
    }
  }

  async function handlePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordMsg(null);
    setPasswordBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordMsg({ ok: true, text: "密码已修改，下次登录请使用新密码" });
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setPasswordMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // 退出失败时保留界面状态，用户可重试。
    }
  }

  if (loading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">正在检查登录状态…</p>;
  }

  if (!user) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="size-5" aria-hidden />个人中心</CardTitle>
          <CardDescription>登录后可管理个人资料、年级、学科、省份和账号设置。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!backendAvailable && (
            <Alert className="border-amber-300 bg-amber-50 text-amber-800">
              <AlertDescription>当前未连接到后端服务，登录功能将在网站部署后生效。</AlertDescription>
            </Alert>
          )}
          <Button asChild className="edu-gradient text-white">
            <Link to="/login"><LogIn className="size-4" aria-hidden />去登录 / 注册</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="edu-gradient flex size-11 items-center justify-center rounded-xl text-white">
            <User className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold">{user.display_name || user.username}</h1>
            <p className="text-sm text-muted-foreground">
              账号 {user.username} · <Badge variant="secondary">学生</Badge>
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={handleLogout}>退出登录</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">个人资料</CardTitle>
            <CardDescription>全部选填。填写后首页推荐和资料筛选会更贴合你的情况。</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleProfile} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="profile-display-name">昵称</Label>
                <Input
                  id="profile-display-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={30}
                  placeholder="希望别人怎么称呼你"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-grade">年级</Label>
                  <select id="profile-grade" className={selectClass} value={grade} onChange={(e) => setGrade(e.target.value)}>
                    <option value="">未设置</option>
                    {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-province">省份</Label>
                  <select id="profile-province" className={selectClass} value={province} onChange={(e) => setProvince(e.target.value)}>
                    <option value="">未设置</option>
                    {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>关注学科（可多选）</Label>
                <div className="flex flex-wrap gap-2">
                  {SUBJECTS.map((subject) => {
                    const active = subjects.includes(subject);
                    return (
                      <button
                        key={subject}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setSubjects((prev) =>
                            active ? prev.filter((s) => s !== subject) : [...prev, subject]
                          )
                        }
                        className={cn(
                          "rounded-full border px-3.5 py-1.5 text-sm",
                          active
                            ? "edu-gradient border-transparent text-white"
                            : "border-border bg-card text-muted-foreground hover:border-primary/40"
                        )}
                      >
                        {subject}
                      </button>
                    );
                  })}
                </div>
              </div>
              {profileMsg && (
                <Alert variant={profileMsg.ok ? "default" : "destructive"}>
                  <AlertDescription>{profileMsg.text}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={profileBusy} className="edu-gradient text-white">
                <Save className="size-4" aria-hidden />{profileBusy ? "保存中…" : "保存资料"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="size-5" aria-hidden />修改密码</CardTitle>
              <CardDescription>需要验证当前密码。修改成功后请使用新密码登录。</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePassword} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="current-password">当前密码</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="new-password">新密码</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    placeholder="至少 8 个字符"
                  />
                </div>
                {passwordMsg && (
                  <Alert variant={passwordMsg.ok ? "default" : "destructive"}>
                    <AlertDescription>{passwordMsg.text}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" variant="outline" disabled={passwordBusy}>
                  {passwordBusy ? "修改中…" : "修改密码"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">账号信息</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p>用户名：{user.username}</p>
              <p>角色：{user.role === "admin" ? "管理员" : "学生"}</p>
              <p>注册时间：{new Date(user.created_at).toLocaleDateString("zh-CN")}</p>
              <p className="text-xs">我们只保存用户名和你自愿填写的资料，不收集邮箱和手机号。</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Heart className="size-5" aria-hidden />我的收藏
            </CardTitle>
            <CardDescription>你在资料库里收藏的资料，只对你自己可见。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {favoritesState === "loading" && (
              <p className="text-sm text-muted-foreground">正在加载收藏…</p>
            )}
            {favoritesState === "unavailable" && (
              <p className="text-sm text-muted-foreground">
                资料库模块尚未上线，收藏功能随它一起开启。
              </p>
            )}
            {favoritesState === "error" && (
              <Alert variant="destructive">
                <AlertDescription>收藏暂时无法加载（{favoritesError}）。</AlertDescription>
              </Alert>
            )}
            {favoritesState === "ready" && favorites.length === 0 && (
              <p className="text-sm text-muted-foreground">
                还没有收藏，在<Link to="/resources" className="text-primary underline underline-offset-2">资料库</Link>里点爱心就能收藏。
              </p>
            )}
            {favoritesState === "ready" && favorites.map((fav) => (
              <Link
                key={fav.id}
                to={`/resources?id=${fav.id}`}
                className="rounded-lg border border-border p-3 hover:border-primary/40"
              >
                <p className="text-sm font-medium leading-snug">{fav.title}</p>
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{fav.grade}</Badge>
                  <Badge variant="secondary">{fav.subject}</Badge>
                  <Badge variant="outline">{fav.type}</Badge>
                  <span className="text-xs text-muted-foreground">来源：{fav.source_name}</span>
                </p>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Compass className="size-5" aria-hidden />我的测评记录
            </CardTitle>
            <CardDescription>霍兰德与性格倾向测评的结果记录，仅供你自己查看和回顾。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {assessmentsState === "loading" && (
              <p className="text-sm text-muted-foreground">正在加载测评记录…</p>
            )}
            {assessmentsState === "unavailable" && (
              <p className="text-sm text-muted-foreground">
                测评模块尚未上线，测评记录随它一起开启。
              </p>
            )}
            {assessmentsState === "error" && (
              <Alert variant="destructive">
                <AlertDescription>测评记录暂时无法加载（{assessmentsError}）。</AlertDescription>
              </Alert>
            )}
            {assessmentsState === "ready" && assessments.length === 0 && (
              <p className="text-sm text-muted-foreground">
                还没有测评记录，<Link to="/assessment" className="text-primary underline underline-offset-2">去做一次兴趣测评</Link>吧。
              </p>
            )}
            {assessmentsState === "ready" && assessments.map((item) => (
              <div key={item.id} className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">
                  {new Date(item.created_at).toLocaleDateString("zh-CN")}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {item.kind === "mbti"
                      ? `性格倾向（简化版）：${item.code}`
                      : `主要倾向：${item.top_types.map((code) => `${code} · ${DIMENSION_NAMES[code] ?? code}`).join("、")}`}
                  </span>
                </p>
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(item.scores).map(([code, score]) => (
                    <Badge key={code} variant="secondary">
                      {code} {score} {item.kind === "mbti" ? "票" : "分"}
                    </Badge>
                  ))}
                </p>
              </div>
            ))}
            {assessmentsState === "ready" && assessments.length > 0 && (
              <Button asChild variant="outline" className="mt-1 self-start">
                <Link to="/assessment">重新测评</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}