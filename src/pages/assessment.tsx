// 模块6 兴趣测评与职业探索：介绍 → 逐题作答（24 道，5 级量表）→ 结果。
// 霍兰德 RIASEC 简化版，固定规则计分，不调用 AI；结果仅供兴趣探索参考，
// 不是心理诊断，不能绝对决定学生未来职业。登录后结果保存到账号，未登录时
// 保存在本机浏览器。
import { useState } from "react";
import { ArrowLeft, ArrowRight, Compass, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/src/lib/auth";
import { errorMessage } from "@/src/lib/api";
import {
  DIMENSIONS,
  DIMENSION_ORDER,
  LIKERT,
  QUESTIONS,
  loadLocalHistory,
  saveAssessment,
  saveLocalResult,
  scoreLocally,
} from "@/src/lib/assessment";
import type { AssessmentResult, DimensionCode } from "@/src/lib/assessment";
import { cn } from "@/lib/utils";

const DISCLAIMER =
  "兴趣测评仅用于自我探索，结果不代表能力高低，也不构成职业或升学的确定性判断；它不是心理诊断，不能代替专业升学指导。";

export default function AssessmentPage() {
  const { user } = useAuth();
  const [step, setStep] = useState<"intro" | "quiz" | "result">("intro");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>(() => Array(QUESTIONS.length).fill(0));
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [history, setHistory] = useState<AssessmentResult[]>(() => loadLocalHistory());

  const answeredCount = answers.filter((a) => a > 0).length;
  const current = QUESTIONS[index];
  const currentAnswer = answers[index];

  function setCurrentAnswer(value: number) {
    setAnswers((prev) => prev.map((a, i) => (i === index ? value : a)));
  }

  async function submit() {
    if (answers.some((a) => a === 0)) return;
    const { scores, top_types } = scoreLocally(answers);
    const local: AssessmentResult = {
      answers: [...answers],
      scores,
      top_types,
      created_at: new Date().toISOString(),
    };
    setResult(local);
    setStep("result");
    saveLocalResult(local);
    setHistory(loadLocalHistory());
    if (user) {
      try {
        const saved = await saveAssessment(answers);
        setResult({ ...local, id: saved.id, created_at: saved.created_at });
        setSaveNote("结果已保存到你的账号，可在个人中心查看。");
      } catch (err) {
        setSaveNote(`保存到账号失败（${errorMessage(err)}），结果已保存在本机浏览器。`);
      }
    } else {
      setSaveNote("未登录：结果已保存在本机浏览器，登录后可保存到账号。");
    }
  }

  function retake() {
    setAnswers(Array(QUESTIONS.length).fill(0));
    setIndex(0);
    setResult(null);
    setSaveNote(null);
    setStep("quiz");
  }

  // ---- 介绍页 ----
  if (step === "intro") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="edu-gradient flex size-11 items-center justify-center rounded-xl text-white">
            <Compass className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold">兴趣测评与职业探索</h1>
            <p className="text-sm text-muted-foreground">霍兰德 RIASEC 简化版 · 固定规则计分，不调用 AI</p>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">先了解一下自己</CardTitle>
            <CardDescription>
              24 道题，每题按符合程度打分，约 3 分钟。做完会看到你的兴趣倾向、相关专业和职业方向。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              {DIMENSION_ORDER.map((code) => (
                <div key={code} className="rounded-lg border border-border p-3">
                  <p className="font-semibold">
                    {code} · {DIMENSIONS[code].name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{DIMENSIONS[code].tagline}</p>
                </div>
              ))}
            </div>
            <Alert>
              <AlertDescription>{DISCLAIMER}</AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Button className="edu-gradient text-white" onClick={() => setStep("quiz")}>
                开始测评 <ArrowRight className="size-4" aria-hidden />
              </Button>
              {history.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setResult(history[0]);
                    setStep("result");
                  }}
                >
                  查看上次结果
                </Button>
              )}
            </div>
            {history.length > 0 && (
              <p className="text-xs text-muted-foreground">
                本机保存了 {history.length} 次测评记录（最近一次：
                {new Date(history[0].created_at).toLocaleDateString("zh-CN")}）。
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- 结果页 ----
  if (step === "result" && result) {
    const sorted = [...DIMENSION_ORDER].sort((a, b) => result.scores[b] - result.scores[a]);
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="edu-gradient flex size-11 items-center justify-center rounded-xl text-white">
            <Compass className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold">你的兴趣倾向</h1>
            <p className="text-sm text-muted-foreground">
              {new Date(result.created_at).toLocaleDateString("zh-CN")} · 24 题 · 固定规则计分
            </p>
          </div>
        </div>
        {saveNote && (
          <Alert>
            <AlertDescription>{saveNote}</AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">六个维度得分</CardTitle>
            <CardDescription>分数越高，该方向的兴趣倾向越明显。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {sorted.map((code) => (
              <div key={code} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">
                    {code} · {DIMENSIONS[code].name}
                    {result.top_types.includes(code) && (
                      <Badge variant="secondary" className="ml-2">主要倾向</Badge>
                    )}
                  </span>
                  <span className="font-semibold">{result.scores[code]} 分</span>
                </div>
                <Progress value={result.scores[code]} />
                <p className="text-xs text-muted-foreground">{DIMENSIONS[code].tagline}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        {result.top_types.map((code: DimensionCode) => (
          <Card key={code}>
            <CardHeader>
              <CardTitle className="text-lg">
                {code} · {DIMENSIONS[code].name}
              </CardTitle>
              <CardDescription>{DIMENSIONS[code].tagline}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <div>
                <p className="mb-2 font-medium">相关专业方向</p>
                <div className="flex flex-wrap gap-1.5">
                  {DIMENSIONS[code].majors.map((m) => (
                    <Badge key={m} variant="secondary">{m}</Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 font-medium">相关职业方向</p>
                <div className="flex flex-wrap gap-1.5">
                  {DIMENSIONS[code].careers.map((c) => (
                    <Badge key={c} variant="outline">{c}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        <Alert>
          <AlertDescription>{DISCLAIMER}</AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button onClick={retake}>
            <RotateCcw className="size-4" aria-hidden /> 重新测评
          </Button>
          <Button variant="outline" onClick={() => { setStep("intro"); setResult(null); }}>返回介绍</Button>
        </div>
      </div>
    );
  }

  // ---- 答题页 ----
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">兴趣测评</h1>
        <span className="text-sm text-muted-foreground">
          第 {index + 1} / {QUESTIONS.length} 题 · 已答 {answeredCount} 题
        </span>
      </div>
      <Progress value={((index + 1) / QUESTIONS.length) * 100} />
      <Card>
        <CardHeader>
          <CardTitle className="text-lg leading-snug">{current.text}</CardTitle>
          <CardDescription>请选择最符合你实际情况的一项（没有对错之分）。</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={currentAnswer === 0 ? "" : String(currentAnswer)}
            onValueChange={(v) => setCurrentAnswer(Number(v))}
            className="flex flex-col gap-2"
          >
            {LIKERT.map((label, i) => (
              <div
                key={label}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-4 py-3 hover:border-primary/40",
                  currentAnswer === i + 1 && "border-primary bg-primary/5"
                )}
              >
                <RadioGroupItem value={String(i + 1)} id={`q${index}-opt${i}`} />
                <Label htmlFor={`q${index}-opt${i}`} className="flex-1 cursor-pointer text-sm">
                  {label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>
      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ArrowLeft className="size-4" aria-hidden /> 上一题
        </Button>
        {index < QUESTIONS.length - 1 ? (
          <Button disabled={currentAnswer === 0} onClick={() => setIndex(index + 1)}>
            下一题 <ArrowRight className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button disabled={currentAnswer === 0} onClick={() => void submit()}>
            查看结果
          </Button>
        )}
      </div>
      <p className="text-center text-xs text-muted-foreground">{DISCLAIMER}</p>
    </div>
  );
}
