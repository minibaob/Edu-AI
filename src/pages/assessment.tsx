import { useState } from "react";
import { ArrowLeft, Brain, Compass, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/src/lib/auth";
import { Link } from "@/src/lib/router";
import MbtiAssessment from "@/src/pages/assessment-mbti";
import RiasecAssessment30 from "@/src/pages/assessment-riasec";
import { ArrowRight, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  "三个测评都仅用于兴趣与自我探索参考，不是心理诊断，也不能绝对决定你的未来专业或职业方向。倾向会随学习和经历而变化，结果请当作认识自己的起点，而不是标签。";

export default function AssessmentPage() {
  const { user, loading } = useAuth();
  const [kind, setKind] = useState<"riasec24" | "riasec30" | "mbti" | null>(null);

  if (loading) {
    return <p className="py-16 text-center text-sm text-muted-foreground">正在加载测评…</p>;
  }

  if (!user) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Compass className="size-5" aria-hidden />兴趣测评与职业探索</CardTitle>
            <CardDescription>霍兰德兴趣测评（24 题 / 30 题两个版本）+ MBTI 风格性格倾向测评（简化版），全部固定规则计分，不调用任何 AI 模型。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              登录后即可作答：霍兰德兴趣测评有两个版本（24 题或 30 题，任选一个），帮你发现兴趣倾向与可探索的专业、职业方向；
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

  if (kind === "riasec24") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={() => setKind(null)}>
            <ArrowLeft className="size-4" aria-hidden /> 返回测评选择
          </Button>
        </div>
        <RiasecQuiz />
      </div>
    );
  }
  if (kind === "riasec30") return <RiasecAssessment30 onBack={() => setKind(null)} />;
  if (kind === "mbti") return <MbtiAssessment onBack={() => setKind(null)} />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Compass className="size-5" aria-hidden />兴趣测评与职业探索</h1>
        <p className="mt-1 text-sm text-muted-foreground">选择一个测评开始，三个测评相互独立，结果分别保存在你的账号中。</p>
      </div>
      <Alert><AlertDescription>{DISCLAIMER}</AlertDescription></Alert>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-5" aria-hidden />霍兰德兴趣测评（24 题）</CardTitle>
            <CardDescription>RIASEC 简化版 · 24 题 · 约 5 分钟</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <p className="flex-1 text-sm text-muted-foreground">
              用 24 道活动偏好题、每题按符合程度打分（5 级量表），估计你在现实、研究、艺术、社会、企业、常规六个维度上的兴趣倾向，
              给出兴趣代码与可探索的专业类、职业方向。
            </p>
            <Button onClick={() => setKind("riasec24")} className="edu-gradient text-white">进入 24 题版</Button>
          </CardContent>
        </Card>
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-5" aria-hidden />霍兰德兴趣测评（30 题）</CardTitle>
            <CardDescription>RIASEC 简化版 · 30 题 · 约 5 分钟</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            <p className="flex-1 text-sm text-muted-foreground">
              用 30 道活动偏好题、每题按喜欢程度三档选择（不喜欢 / 一般 / 喜欢），估计你在现实、研究、艺术、社会、企业、常规六个维度上的兴趣倾向，
              给出兴趣代码与可探索的专业类、职业方向。
            </p>
            <Button onClick={() => setKind("riasec30")} className="edu-gradient text-white">进入 30 题版</Button>
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

// ---- 霍兰德兴趣测评（24 道，5 级量表）：介绍 → 逐题作答 → 结果 ----
// 固定规则计分，不调用 AI；结果仅供兴趣探索参考，不是心理诊断。登录后结果保存
// 到账号，未登录时保存在本机浏览器。题目顺序与后端 functions/assessment.mjs 的
// QUESTION_DIMENSIONS 严格一致，契约测试会校验防漂移。
const RIASEC_DISCLAIMER =
  "兴趣测评仅用于自我探索，结果不代表能力高低，也不构成职业或升学的确定性判断；它不是心理诊断，不能代替专业升学指导。";

function RiasecQuiz() {
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
              <AlertDescription>{RIASEC_DISCLAIMER}</AlertDescription>
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
          <AlertDescription>{RIASEC_DISCLAIMER}</AlertDescription>
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
      <p className="text-center text-xs text-muted-foreground">{RIASEC_DISCLAIMER}</p>
    </div>
  );
}
