import { useState } from "react";
import type { FormEvent } from "react";
import { KeyRound, LogIn, Save, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/src/lib/auth";
import { errorMessage } from "@/src/lib/api";
import { Link } from "@/src/lib/router";
import { GRADES, PROVINCES, SUBJECTS } from "@/src/lib/options";
import { cn } from "@/lib/utils";

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

  const [initializedFor, setInitializedFor] = useState<string | null>(user?.id ?? null);
  if (user && initializedFor !== user.id) {
    setInitializedFor(user.id);
    setDisplayName(user.display_name ?? "");
    setGrade(user.grade ?? "");
    setProvince(user.province ?? "");
    setSubjects(user.subjects ?? []);
  }

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
              <p>角色：学生</p>
              <p>注册时间：{new Date(user.created_at).toLocaleDateString("zh-CN")}</p>
              <p className="text-xs">我们只保存用户名和你自愿填写的资料，不收集邮箱和手机号。</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}