import { useState } from "react";
import type { FormEvent } from "react";
import { GraduationCap, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/src/lib/auth";
import { errorMessage } from "@/src/lib/api";
import { Link, navigate } from "@/src/lib/router";
import { GRADES, PROVINCES } from "@/src/lib/options";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export default function LoginPage() {
  const { user, loading, backendAvailable, login, register } = useAuth();

  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regDisplayName, setRegDisplayName] = useState("");
  const [regGrade, setRegGrade] = useState("");
  const [regProvince, setRegProvince] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(loginName, loginPassword);
      navigate("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register(regName, regPassword, {
        display_name: regDisplayName,
        grade: regGrade,
        province: regProvince,
      });
      navigate("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">正在检查登录状态…</p>;
  }

  if (user) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>您已登录</CardTitle>
          <CardDescription>
            当前账号：{user.display_name || user.username}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button asChild><Link to="/profile">进入个人中心</Link></Button>
          <Button asChild variant="outline"><Link to="/">返回首页</Link></Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex flex-col items-center gap-2 pt-4 text-center">
        <span className="edu-gradient flex size-12 items-center justify-center rounded-xl text-white">
          <GraduationCap className="size-7" aria-hidden />
        </span>
        <h1 className="text-xl font-bold">欢迎来到 EduAI 智学未来</h1>
        <p className="text-sm text-muted-foreground">让学习更智能，让成长有方向</p>
      </div>

      {!backendAvailable && (
        <Alert className="border-amber-300 bg-amber-50 text-amber-800">
          <AlertDescription>
            当前未连接到后端服务（本地预览属正常现象）。登录注册功能将在网站部署后生效。
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-6">
          <Tabs defaultValue="login">
            <TabsList className="mb-4 grid w-full grid-cols-2">
              <TabsTrigger value="login"><LogIn className="size-4" aria-hidden />登录</TabsTrigger>
              <TabsTrigger value="register"><UserPlus className="size-4" aria-hidden />注册</TabsTrigger>
            </TabsList>

            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="login-username">用户名</Label>
                  <Input
                    id="login-username"
                    value={loginName}
                    onChange={(e) => setLoginName(e.target.value)}
                    autoComplete="username"
                    required
                    placeholder="输入用户名"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="login-password">密码</Label>
                  <Input
                    id="login-password"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    placeholder="输入密码"
                  />
                </div>
                <Button type="submit" disabled={busy} className="edu-gradient text-white">
                  {busy ? "登录中…" : "登录"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  登录后 7 天内在本浏览器保持登录状态。
                </p>
              </form>
            </TabsContent>

            <TabsContent value="register">
              <form onSubmit={handleRegister} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="reg-username">用户名</Label>
                  <Input
                    id="reg-username"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    autoComplete="username"
                    required
                    minLength={2}
                    maxLength={20}
                    placeholder="2–20 个字符，可用中文、字母、数字"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="reg-password">密码</Label>
                  <Input
                    id="reg-password"
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    placeholder="至少 8 个字符"
                  />
                </div>

                <details className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                    选填资料（可跳过，之后在个人中心补充）
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="reg-display-name">昵称</Label>
                      <Input
                        id="reg-display-name"
                        value={regDisplayName}
                        onChange={(e) => setRegDisplayName(e.target.value)}
                        maxLength={30}
                        placeholder="希望别人怎么称呼你"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="reg-grade">年级</Label>
                      <select id="reg-grade" className={selectClass} value={regGrade} onChange={(e) => setRegGrade(e.target.value)}>
                        <option value="">暂不填写</option>
                        {GRADES.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="reg-province">省份</Label>
                      <select id="reg-province" className={selectClass} value={regProvince} onChange={(e) => setRegProvince(e.target.value)}>
                        <option value="">暂不填写</option>
                        {PROVINCES.map((province) => <option key={province} value={province}>{province}</option>)}
                      </select>
                    </div>
                  </div>
                </details>

                <Button type="submit" disabled={busy} className="edu-gradient text-white">
                  {busy ? "注册中…" : "注册并登录"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  我们只收集用户名和你自愿填写的资料，不要求邮箱和手机号。
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}