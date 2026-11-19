import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Brain, RefreshCw } from "lucide-react";
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
type Question = { id: string; text: string; a: string; b: string };
type Pole = { letter: string; name: string; description: string; count: number };
type Dichotomy = { key: string; name: string; letter: string; poles: Pole[] };
type TypeInfo = { name: string; description: string; strengths: string[]; growth: string };
type Result = {
  id: string;
  created_at: string;
  code: string;
  scores: Record<string, number>;
  type: TypeInfo | null;
  dichotomies: Dichotomy[];
};

const DISCLAIMER =
  "本测评为自研简化版，借鉴 MBTI 四维框架，不是官方 MBTI 测评；仅供自我探索参考，不是心理诊断，也不能绝对决定你的未来专业或职业。性格倾向会随成长与经历变化，每种类型都有自己的优势。";
const SOURCE_NOTE =
  "题库与类型文案为自研简化内容，参考 MBTI 四维框架（E/I、S/N、T/F、J/P）整理，不代表官方 MBTI 解释。";
const RULES =
  "共 28 题，每题二选一：选 A 计该维度第一个字母 1 票，选 B 计第二个字母 1 票。每个维度 7 票必分胜负，得票多的字母进入你的四字母类型。计分全部由固定规则完成，不调用任何 AI 模型。";

export default function MbtiAssessment({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const [view, setView] = useState<"intro" | "quiz" | "result">("intro");
  const [questions, setQuestions] = useState<Question[]>([]);
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
          api<{ questions: Question[]; options: Option[] }>("/api/mbti/questions"),
          api<{ result: Result | null }>("/api/mbti/latest"),
        ]);
        if (cancelled) return;
        setQuestions(bank.questions);
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
      const submitted = await api<{ result: Result }>("/api/mbti/submit", {
        method: "POST",
        body: { answers },
      });
      setResult(submitted.result);
      setView("result");
    } catch (err) {
      setError(errorMessage(err));
      // 结果未确认时先读一次 latest：已保存就直接展示，避免重复提交。
      try {
        const last = await api<{ result: Result | null }>("/api/mbti/latest");
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
            <CardTitle>性格倾向问题（{answeredCount}/{questions.length}）</CardTitle>
            <CardDescription>没有对错之分，凭第一感觉选择更接近你平时状态的一项，全部答完后提交。</CardDescription>
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
                className="flex flex-col gap-2"
                value={answers[question.id] === undefined ? "" : String(answers[question.id])}
                onValueChange={(value) => setAnswers((prev) => ({ ...prev, [question.id]: Number(value) }))}
              >
                <Label className="flex cursor-pointer items-start gap-2 text-sm font-normal leading-relaxed">
                  <RadioGroupItem value="0" aria-label={`A. ${question.a}`} className="mt-0.5" />
                  A. {question.a}
                </Label>
                <Label className="flex cursor-pointer items-start gap-2 text-sm font-normal leading-relaxed">
                  <RadioGroupItem value="1" aria-label={`B. ${question.b}`} className="mt-0.5" />
                  B. {question.b}
                </Label>
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
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Brain className="size-5" aria-hidden />你的性格倾向类型
              <Badge className="edu-gradient text-white text-base px-3 py-1">{result.code}</Badge>
              {result.type && <span className="text-base font-medium">{result.type.name}</span>}
            </CardTitle>
            <CardDescription>
              完成于 {new Date(result.created_at).toLocaleString("zh-CN")} · 简化版结果，仅供自我探索参考
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {result.type && <p className="text-sm">{result.type.description}</p>}
            <Alert><AlertDescription>{DISCLAIMER}</AlertDescription></Alert>
            <Separator />
            <div className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold">四个维度的倾向（每维度 7 票）</h2>
              {result.dichotomies.map((dichotomy) => (
                <div key={dichotomy.key} className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{dichotomy.name}</span>
                    <span className="text-muted-foreground">
                      你的倾向：{dichotomy.letter} · {dichotomy.poles.find((pole) => pole.letter === dichotomy.letter)?.name}
                    </span>
                  </div>
                  {dichotomy.poles.map((pole) => (
                    <div key={pole.letter} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between text-sm">
                        <span className={pole.letter === dichotomy.letter ? "font-medium" : "text-muted-foreground"}>
                          {pole.letter} · {pole.name}
                        </span>
                        <span className="font-medium tabular-nums">{pole.count}/7</span>
                      </div>
                      <Progress value={(pole.count / 7) * 100} aria-label={`${pole.name}票数`} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {result.type && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">类型解读与成长建议</CardTitle>
              <CardDescription>{result.code} · {result.type.name}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">常见优势</h3>
                <div className="flex flex-wrap gap-2">
                  {result.type.strengths.map((strength) => <Badge key={strength} variant="secondary">{strength}</Badge>)}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">可以尝试的成长方向</h3>
                <p className="text-sm text-muted-foreground">{result.type.growth}</p>
              </div>
            </CardContent>
          </Card>
        )}

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
          <CardTitle className="flex items-center gap-2"><Brain className="size-5" aria-hidden />MBTI 风格性格倾向测评（简化版）</CardTitle>
          <CardDescription>自研简化题目 · 固定规则计分 · 不调用任何 AI 模型 · 非官方 MBTI</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            这个测评从四个维度看你的性格倾向：能量来源（外向 E / 内向 I）、信息获取（实感 S / 直觉 N）、
            决策方式（思考 T / 情感 F）、生活节奏（判断 J / 感知 P）。
            28 道二选一题目帮你得到一个四字母类型，了解自己的偏好与可能的成长方向。
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