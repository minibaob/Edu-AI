import { useState } from "react";
import { Brain, Compass, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/src/lib/auth";
import { Link } from "@/src/lib/router";
import RiasecAssessment from "@/src/pages/assessment-riasec";
import MbtiAssessment from "@/src/pages/assessment-mbti";

const DISCLAIMER =
  "两个测评都仅用于兴趣与自我探索参考，不是心理诊断，也不能绝对决定你的未来专业或职业方向。倾向会随学习和经历而变化，结果请当作认识自己的起点，而不是标签。";

export default function AssessmentPage() {
  const { user, loading } = useAuth();
  const [kind, setKind] = useState<"riasec" | "mbti" | null>(null);

  if (loading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">正在加载测评…</p>;
  }

  if (!user) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Compass className="size-5" aria-hidden />兴趣测评与职业探索</CardTitle>
            <CardDescription>霍兰德兴趣测评 + MBTI 风格性格倾向测评（简化版），全部固定规则计分，不调用任何 AI 模型。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              登录后即可作答：霍兰德兴趣测评（30 题）帮你发现兴趣倾向与可探索的专业、职业方向；
              MBTI 风格性格倾向测评（28 题，自研简化版，非官方 MBTI）帮你了解自己的性格偏好。
              测评结果保存在你的账号中，可随时重新测评。
            </p>
            <Alert><AlertDescription>{DISCLAIMER}</AlertDescription></Alert>
            <Button asChild className="edu-gradient text-white"><Link to="/login">登录后开始测评</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (kind === "riasec") return <RiasecAssessment onBack={() => setKind(null)} />;
  if (kind === "mbti") return <MbtiAssessment onBack={() => setKind(null)} />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Compass className="size-5" aria-hidden />兴趣测评与职业探索</h1>
        <p className="mt-1 text-sm text-muted-foreground">选择一个测评开始，两个测评相互独立，结果分别保存在你的账号中。</p>
      </div>
      <Alert><AlertDescription>{DISCLAIMER}</AlertDescription></Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-5" aria-hidden />霍兰德兴趣测评</CardTitle>
            <CardDescription>RIASEC 简化版 · 30 题 · 约 5 分钟</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <p className="flex-1 text-sm text-muted-foreground">
              用活动偏好题估计你在现实、研究、艺术、社会、企业、常规六个维度上的兴趣倾向，
              给出兴趣代码与可探索的专业类、职业方向。
            </p>
            <Button onClick={() => setKind("riasec")} className="edu-gradient text-white">进入兴趣测评</Button>
          </CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Brain className="size-5" aria-hidden />MBTI 风格性格倾向（简化版）</CardTitle>
            <CardDescription>自研简化题目 · 28 题 · 约 5 分钟 · 非官方 MBTI</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <p className="flex-1 text-sm text-muted-foreground">
              从能量来源、信息获取、决策方式、生活节奏四个维度了解你的性格偏好，
              得到一个四字母类型与成长建议，仅供自我探索参考。
            </p>
            <Button onClick={() => setKind("mbti")} className="edu-gradient text-white">进入性格测评</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}