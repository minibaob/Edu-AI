import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, RefreshCw, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/src/lib/auth";
import { api, errorMessage } from "@/src/lib/api";
import { Link } from "@/src/lib/router";

type Option = { value: number; label: string };
type Question = { id: string; text: string };
type Dimension = {
  key: string;
  name: string;
  english: string;
  keyword: string;
  description: string;
  majors: string[];
  careers: string[];
  score: number;
};
type Result = {
  id: string;
  created_at: string;
  code: string;
  scores: Record<string, number>;
  dimensions: Dimension[];
  top: Dimension[];
};

const DISCLAIMER =
  "本测评仅用于兴趣探索参考，不是心理诊断，也不能绝对决定你的未来职业方向。结果反映的是你当前对各类活动的偏好，兴趣会随学习和经历而变化。";
const SOURCE_NOTE =
  "专业与职业方向对照参考霍兰德职业兴趣理论（RIASEC）与普通高等学校本科专业目录通用名称整理，仅供探索参考。";
const RULES =
  "共 30 题，每题三档：不喜欢 0 分、一般 1 分、喜欢 2 分。六个维度各 5 题，满分 10 分；得分最高的三个维度组成你的兴趣代码，同分时按 R→I→A→S→E→C 固定顺序排列。计分全部由固定规则完成，不调用任何 AI 模型。";

export default function RiasecAssessment({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const [view, setView] = useState<"intro" | "quiz" | "result">("intro");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [bank, last] = await Promise.all([
          api<{ questions: Question[]; options: Option[] }>("/api/assessment/questions"),
          api<{ result: Result | null }>("/api/assessment/latest"),
        ]);
        if (cancelled) return;
        setQuestions(bank.questions);
        setOptions(bank.options);
        setResult(last.result);
        setReady(true);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const answeredCount = questions.filter((q) => answers[q.id] !== undefined).length;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const submitted = await api<{ result: Result }>("/api/assessment/submit", {
        method: "POST",
        body: { answers },
      });
      setResult(submitted.result);
      setView("result");
    } catch (err) {
      setError(errorMessage(err));
      // 结果未确认时先读一次 latest：已保存就直接展示，避免重复提交。
      try {
        const last = await api<{ result: Result | null }>("/api/assessment/latest");
        if (last.result && last.result.id !== result?.id) {
          setResult(last.result);
          setView("result");
          setError("");
        }
      } catch { /* 读取失败时保留原错误提示 */ }
    } finally {
      setBusy(false);
    }
  }

  function startQuiz() {
    setAnswers({});
    setError("");
    setView("quiz");
  }

  if (!ready && !error) {
    return <p className="py-16 text-center text-sm text-muted-foreground">正在加载测评…</p>;
  }

  if (view === "quiz") {
    return (
      <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>兴趣问题（{answeredCount}/{questions.length}）</CardTitle>
            <CardDescription>凭第一感觉选择你对每项活动的喜欢程度，全部答完后提交。</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={questions.length ? (answeredCount / questions.length) * 100 : 0} />
          </CardContent>
        </Card>

        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        {questions.map((question, index) => (
          <Card key={question.id}>
            <CardContent className="flex flex-col gap-3 p-4">
              <Label className="text-sm font-medium leading-relaxed">
                {index + 1}. {question.text}
              </Label>
              <RadioGroup
                className="flex flex-wrap gap-4"
                value={answers[question.id] === undefined ? "" : String(answers[question.id])}
                onValueChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: Number(value) }))}
              >
                {options.map((option) => (
                  <Label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm font-normal">
                    <RadioGroupItem value={String(option.value)} aria-label={option.label} />
                    {option.label}
                  </Label>
                ))}
              </RadioGroup>
            </CardContent>
          </Card>
        ))}

        <Button type="submit" disabled={busy || answeredCount !== questions.length} className="edu-gradient text-white">
          {busy ? "计分中…" : "提交并查看结果"}
        </Button>
        <p className="text-xs text-muted-foreground">{RULES}</p>
      </form>
    );
  }

  if (view === "result" && result) {
    const primary = result.top[0];
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Sparkles className="size-5" aria-hidden />你的兴趣代码
              <Badge className="edu-gradient text-white text-base px-3 py-1">{result.code}</Badge>
            </CardTitle>
            <CardDescription>
              主导倾向：{primary.name}（{primary.english}）· {primary.keyword} · 完成于 {new Date(result.created_at).toLocaleString("zh-CN")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm">{primary.description}</p>
            <Alert><AlertDescription>{DISCLAIMER}</AlertDescription></Alert>
            <Separator />
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">六维度得分（满分 10 分）</h2>
              {result.dimensions.map((dimension) => (
                <div key={dimension.key} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span>{dimension.key} · {dimension.name} <span className="text-muted-foreground">（{dimension.keyword}）</span></span>
                    <span className="font-medium tabular-nums">{dimension.score}/10</span>
                  </div>
                  <Progress value={dimension.score * 10} aria-label={`${dimension.name}得分`} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {result.top.map((dimension, index) => (
          <Card key={dimension.key}>
            <CardHeader>
              <CardTitle className="text-base">
                {index + 1}. {dimension.name}（{dimension.key}）· {dimension.score}/10
              </CardTitle>
              <CardDescription>{dimension.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">可探索的专业类</h3>
                <div className="flex flex-wrap gap-2">
                  {dimension.majors.map((major) => <Badge key={major} variant="secondary">{major}</Badge>)}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">可探索的职业方向</h3>
                <div className="flex flex-wrap gap-2">
                  {dimension.careers.map((career) => <Badge key={career} variant="outline">{career}</Badge>)}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        <p className="text-xs text-muted-foreground">{SOURCE_NOTE}</p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={startQuiz} className="edu-gradient text-white"><RefreshCw className="size-4" aria-hidden />重新测评</Button>
          <Button variant="outline" onClick={onBack}><ArrowLeft className="size-4" aria-hidden />返回测评选择</Button>
          <Button asChild variant="outline"><Link to="/">返回首页</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="size-5" aria-hidden />霍兰德兴趣测评</CardTitle>
          <CardDescription>霍兰德 RIASEC 简化版 · 固定规则计分 · 不调用任何 AI 模型</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            霍兰德职业兴趣理论把人的兴趣倾向分为六个维度：现实型 R、研究型 I、艺术型 A、社会型 S、企业型 E、常规型 C。
            本测评用 30 道活动偏好题估计你在六个维度上的倾向，并给出对应的专业类与职业方向供你探索。
          </p>
          <Alert><AlertDescription>{DISCLAIMER}</AlertDescription></Alert>
          <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">{RULES}</div>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="flex flex-wrap gap-3">
            <Button onClick={startQuiz} disabled={!ready} className="edu-gradient text-white">开始测评</Button>
            {result && (
              <Button variant="outline" onClick={() => setView("result")}>查看上次结果（{result.code}）</Button>
            )}
            <Button variant="outline" onClick={onBack}><ArrowLeft className="size-4" aria-hidden />返回测评选择</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}