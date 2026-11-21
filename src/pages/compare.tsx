import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Loader2, Scale, Search, TriangleAlert, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, errorMessage, getUniversities } from "@/src/lib/api";
import type { University } from "@/src/lib/api";
import { Link, useRoute } from "@/src/lib/router";
import { COMPARE_MAX_SCHOOLS, getCompare } from "@/src/lib/compare";
import type { CompareInput, CompareItem, CompareResponse } from "@/src/lib/compare";
import { getSimulationOptions } from "@/src/lib/simulation";
import type { SimulationOptions } from "@/src/lib/simulation";

const selectClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive";

type SelectedSchool = { code: string; name: string };
type FormValues = { province: string; category: string; batch: string };
type ValidationErrors = Partial<Record<"schools" | "category" | "batch", string>>;
type Submission = { input: CompareInput };

function nd(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "暂无数据" : String(value);
}

function parseInitial(route: string): { codes: string[]; province: string } {
  const params = new URLSearchParams(route.split("?")[1] ?? "");
  const codes = (params.get("codes") ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter((code) => /^[0-9A-Za-z]{1,32}$/.test(code))
    .filter((code, index, all) => all.indexOf(code) === index)
    .slice(0, COMPARE_MAX_SCHOOLS);
  const province = params.get("province") ?? "";
  return { codes, province: ["河北", "河南"].includes(province) ? province : "河北" };
}

export default function ComparePage() {
  const route = useRoute();
  const [initial] = useState(() => parseInitial(route));
  const [schools, setSchools] = useState<SelectedSchool[]>([]);
  const [schoolsResolved, setSchoolsResolved] = useState(false);
  const [form, setForm] = useState<FormValues>({ province: initial.province, category: "", batch: "" });
  const [options, setOptions] = useState<SimulationOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchResults, setSearchResults] = useState<University[]>([]);
  const [searching, setSearching] = useState(false);
  const [validation, setValidation] = useState<ValidationErrors>({});
  const [submitted, setSubmitted] = useState<Submission | null>(null);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryError, setQueryError] = useState("");
  const optionsSequence = useRef(0);
  const querySequence = useRef(0);
  const searchSequence = useRef(0);
  const matching = useRef(false);

  // 从列表页带过来的院校代码，先按代码原样显示，再用搜索接口逐个解析名称。
  useEffect(() => {
    let cancelled = false;
    setSchools(initial.codes.map((code) => ({ code, name: code })));
    if (initial.codes.length === 0) { setSchoolsResolved(true); return; }
    Promise.all(initial.codes.map(async (code) => {
      try {
        const found = await getUniversities({ q: code, limit: 10 });
        const exact = found.items.find((item) => item.code === code);
        return { code, name: exact?.name ?? code };
      } catch {
        return { code, name: code };
      }
    })).then((resolved) => {
      if (!cancelled) { setSchools(resolved); setSchoolsResolved(true); }
    });
    return () => { cancelled = true; };
    // 只在挂载时解析一次初始参数。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sequence = ++optionsSequence.current;
    setOptions(null);
    setOptionsLoading(true);
    setOptionsError("");
    getSimulationOptions(form.province)
      .then((data) => { if (sequence === optionsSequence.current) setOptions(data); })
      .catch((err) => {
        if (sequence !== optionsSequence.current) return;
        setOptionsError(err instanceof ApiError && err.status === 400
          ? "省份条件无效，请重新选择省份。" : errorMessage(err));
      })
      .finally(() => { if (sequence === optionsSequence.current) setOptionsLoading(false); });
    return () => { if (sequence === optionsSequence.current) optionsSequence.current += 1; };
  }, [form.province, optionsRetry]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!debouncedSearch) { setSearchResults([]); setSearching(false); return; }
    const sequence = ++searchSequence.current;
    setSearching(true);
    getUniversities({ q: debouncedSearch, limit: 10 })
      .then((data) => { if (sequence === searchSequence.current) setSearchResults(data.items); })
      .catch(() => { if (sequence === searchSequence.current) setSearchResults([]); })
      .finally(() => { if (sequence === searchSequence.current) setSearching(false); });
    return () => { if (sequence === searchSequence.current) searchSequence.current += 1; };
  }, [debouncedSearch]);

  useEffect(() => () => {
    querySequence.current += 1;
    matching.current = false;
  }, []);

  const categories = options?.available ? options.options : [];
  const batches = categories.find((item) => item.category === form.category)?.batches ?? [];
  const canSubmit = !optionsLoading && !optionsError && categories.length > 0 && schoolsResolved;
  const selectedCodes = new Set(schools.map((school) => school.code));

  // 在输入事件内立即作废请求，而非等下一轮 effect，避免旧响应回填。
  function clearResults() {
    querySequence.current += 1;
    matching.current = false;
    setLoading(false);
    setResult(null);
    setSubmitted(null);
    setQueryError("");
    setValidation({});
  }

  function changeField(field: keyof FormValues, value: string) {
    if (form[field] === value) return;
    clearResults();
    if (field === "province") {
      optionsSequence.current += 1;
      setOptions(null);
      setOptionsError("");
      setOptionsLoading(true);
    }
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "province") next.category = "";
      if (field === "province" || field === "category") next.batch = "";
      return next;
    });
  }

  function addSchool(university: University) {
    if (selectedCodes.has(university.code) || schools.length >= COMPARE_MAX_SCHOOLS) return;
    clearResults();
    setSchools((current) => [...current, { code: university.code, name: university.name }]);
    setSearch("");
    setSearchResults([]);
  }

  function removeSchool(code: string) {
    clearResults();
    setSchools((current) => current.filter((school) => school.code !== code));
  }

  function retryOptions() {
    if (optionsLoading) return;
    clearResults();
    setOptionsLoading(true);
    setOptionsRetry((value) => value + 1);
  }

  async function runCompare(submission: Submission) {
    if (matching.current) return;
    matching.current = true;
    const sequence = ++querySequence.current;
    setSubmitted(submission);
    setResult(null);
    setQueryError("");
    setLoading(true);
    try {
      const data = await getCompare(submission.input);
      if (sequence === querySequence.current) setResult(data);
    } catch (err) {
      if (sequence !== querySequence.current) return;
      setQueryError(err instanceof ApiError && err.status === 400
        ? "条件无效：请重新选择 2–3 所院校与已收录的科类和批次。"
        : errorMessage(err));
    } finally {
      if (sequence === querySequence.current) {
        matching.current = false;
        setLoading(false);
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (matching.current || !canSubmit) return;
    const errors: ValidationErrors = {};
    if (schools.length < 2) errors.schools = "至少选择 2 所院校才能对比，最多 3 所。";
    if (!categories.some((item) => item.category === form.category)) errors.category = "请选择已收录的科类。";
    if (!batches.some((item) => item.batch === form.batch)) errors.batch = "请选择该科类下已收录的批次。";
    setValidation(errors);
    if (Object.keys(errors).length > 0) return;
    void runCompare({
      input: {
        codes: schools.map((school) => school.code),
        province: form.province, category: form.category, batch: form.batch,
      },
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="edu-gradient-soft rounded-2xl border border-primary/15 p-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Scale className="size-6 shrink-0 text-primary" aria-hidden /> 院校对比
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">选 2–3 所高校并排对照，分数与计划都按所选省份、科类、批次取最新一年数据。</p>
      </header>

      <Card className="gap-3 border-primary/20">
        <CardHeader><CardTitle><h2 className="text-base">对照口径说明</h2></CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm leading-relaxed">
          <p className="font-medium">每所学校显示所选省份、科类、批次下最新一年有数据的录取最低分，并标明年份与来源。</p>
          <p>招生计划数为同省、同批次最新一年各专业计划数之和，并标明年份与专业行数。</p>
          <p className="text-muted-foreground">没有数据的格子显示「暂无数据」，不跨年份、跨批次拼数字，不编造数据。</p>
        </CardContent>
      </Card>

      <Alert className="border-primary/40 bg-accent/50">
        <TriangleAlert aria-hidden />
        <AlertTitle className="line-clamp-none text-lg font-bold">各校年份可能不同</AlertTitle>
        <AlertDescription>
          <p>每所学校显示各自最新有数据的年份，对照时请以每格标注的年份为准；跨年分数不可直接等同。</p>
          <p>河北数据是投档线，非最终录取线；艺术、体育批次可能采用综合分。</p>
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle><h2 className="text-lg">选择对比条件</h2></CardTitle>
          <CardDescription>科类与批次仅来自所选省份已收录的物理类 / 历史类真实录取数据，批次随科类变化。</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate autoComplete="off" onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="compare-province">高考省份</Label>
                <select id="compare-province" className={selectClass} value={form.province}
                  onChange={(e) => changeField("province", e.target.value)}>
                  <option value="河北">河北</option>
                  <option value="河南">河南</option>
                </select>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="compare-category">科类</Label>
                <select id="compare-category" className={selectClass} value={form.category}
                  disabled={optionsLoading || categories.length === 0}
                  aria-invalid={Boolean(validation.category)} aria-describedby={validation.category ? "compare-category-error" : undefined}
                  onChange={(e) => changeField("category", e.target.value)}>
                  <option value="">请选择科类</option>
                  {categories.map((item) => <option key={item.category} value={item.category}>{item.category}</option>)}
                </select>
                {validation.category && <p id="compare-category-error" role="alert" className="text-sm text-destructive">{validation.category}</p>}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="compare-batch">批次</Label>
                <select id="compare-batch" className={selectClass} value={form.batch}
                  disabled={optionsLoading || batches.length === 0}
                  aria-invalid={Boolean(validation.batch)} aria-describedby={validation.batch ? "compare-batch-error" : undefined}
                  onChange={(e) => changeField("batch", e.target.value)}>
                  <option value="">{form.category ? "请选择批次" : "请先选择科类"}</option>
                  {batches.map((item) => <option key={item.batch} value={item.batch}>{item.batch}（{item.year} 年）</option>)}
                </select>
                {validation.batch && <p id="compare-batch-error" role="alert" className="text-sm text-destructive">{validation.batch}</p>}
              </div>
            </div>

            {optionsLoading && <p role="status" className="text-sm text-muted-foreground">正在加载{form.province}的科类与批次…</p>}
            {optionsError && (
              <Alert variant="destructive">
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  {optionsError}
                  <Button type="button" variant="outline" size="sm" disabled={optionsLoading} onClick={retryOptions}>重试加载选项</Button>
                </AlertDescription>
              </Alert>
            )}
            {!optionsLoading && !optionsError && options && (!options.available || categories.length === 0) && (
              <Alert role="status"><AlertDescription>{options.message ?? "暂无数据，采集中"}</AlertDescription></Alert>
            )}
            {!optionsLoading && form.category && batches.length === 0 && (
              <p role="status" className="text-sm text-muted-foreground">该科类暂无可用批次，请选择其他科类。</p>
            )}

            <div className="flex min-w-0 flex-col gap-2">
              <Label htmlFor="compare-search">选择院校（{schools.length} / {COMPARE_MAX_SCHOOLS}）</Label>
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="compare-search" className="pl-9" placeholder="搜索学校名称或院校代码"
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  disabled={schools.length >= COMPARE_MAX_SCHOOLS}
                  aria-label="搜索院校加入对比"
                />
              </div>
              {searching && <p role="status" className="text-sm text-muted-foreground">正在搜索院校…</p>}
              {!searching && debouncedSearch && searchResults.length > 0 && (
                <Card>
                  <CardContent className="p-0">
                    <ul className="divide-y divide-border">
                      {searchResults.map((university) => {
                        const selected = selectedCodes.has(university.code);
                        const full = schools.length >= COMPARE_MAX_SCHOOLS && !selected;
                        return (
                          <li key={university.code} className="flex items-center justify-between gap-3 px-4 py-2">
                            <span className="min-w-0">
                              <span className="font-medium">{university.name}</span>
                              <span className="ml-2 text-xs text-muted-foreground">院校代码 {university.code}</span>
                            </span>
                            <Button type="button" variant="outline" size="sm" disabled={selected || full}
                              onClick={() => addSchool(university)}>
                              {selected ? "已选" : "加入对比"}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              )}
              {!searching && debouncedSearch && searchResults.length === 0 && (
                <p role="status" className="text-sm text-muted-foreground">没有匹配的院校</p>
              )}
              {schools.length > 0 && (
                <div className="flex flex-wrap gap-2" aria-label="已选院校">
                  {schools.map((school) => (
                    <Badge key={school.code} variant="secondary" className="gap-1 py-1 pl-3 pr-1 text-sm">
                      {school.name}
                      <button type="button" onClick={() => removeSchool(school.code)}
                        aria-label={`移除${school.name}`} className="rounded-full p-0.5 hover:bg-accent">
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              {validation.schools && <p role="alert" className="text-sm text-destructive">{validation.schools}</p>}
              <p className="text-xs text-muted-foreground">也可以在高校查询列表页勾选院校后直接进入对比。</p>
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">本页不持久化选择；刷新或离开页面后需重新选择。修改任意条件后，需重新提交对比。</p>
              <Button type="submit" disabled={!canSubmit || loading}>
                {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {loading ? "正在对比…" : "开始对比"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {!submitted && <p className="py-4 text-center text-sm text-muted-foreground">请选择 2–3 所院校与科类、批次，提交后并排对照。</p>}
      {submitted && (
        <section aria-labelledby="compare-results-title" aria-busy={loading} className="flex min-w-0 flex-col gap-4">
          <div className="space-y-2">
            <h2 id="compare-results-title" className="text-lg font-semibold">院校对比结果</h2>
            <p className="break-words text-sm">
              本次对照：{submitted.input.province} · {submitted.input.category} · {submitted.input.batch}
            </p>
          </div>

          {loading && <p role="status" className="py-8 text-center text-sm text-muted-foreground">正在加载对比数据…</p>}
          {queryError && (
            <Alert variant="destructive">
              <AlertTitle>对比暂未完成</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                {queryError}
                <Button type="button" variant="outline" size="sm" disabled={loading}
                  onClick={() => void runCompare(submitted)}>重试本次对比</Button>
              </AlertDescription>
            </Alert>
          )}

          {result && <CompareTable result={result} province={submitted.input.province} />}
        </section>
      )}
    </div>
  );
}

function CompareTable({ result, province }: { result: CompareResponse; province: string }) {
  const items = result.items;
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">对照项</th>
                {items.map((item) => (
                  <th key={item.code} className="px-4 py-3 font-medium">
                    {item.found && item.name ? (
                      <Link
                        to={`/universities/${encodeURIComponent(item.code)}?province=${encodeURIComponent(province)}`}
                        className="text-primary underline"
                      >
                        {item.name}
                      </Link>
                    ) : (
                      <span>{item.code}</span>
                    )}
                    <span className="mt-0.5 block text-xs font-normal">院校代码 {item.code}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60 align-top">
                <td className="px-4 py-3 text-muted-foreground">所在地</td>
                {items.map((item) => (
                  <td key={item.code} className="px-4 py-3">
                    {item.found ? nd(item.province ? `${item.province}${item.city ? ` · ${item.city}` : ""}` : null) : "暂无数据"}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-border/60 align-top">
                <td className="px-4 py-3 text-muted-foreground">办学类型</td>
                {items.map((item) => <td key={item.code} className="px-4 py-3">{nd(item.type)}</td>)}
              </tr>
              <tr className="border-b border-border/60 align-top">
                <td className="px-4 py-3 text-muted-foreground">办学层次</td>
                {items.map((item) => <td key={item.code} className="px-4 py-3">{nd(item.level)}</td>)}
              </tr>
              <tr className="border-b border-border/60 align-top">
                <td className="px-4 py-3 text-muted-foreground">标签</td>
                {items.map((item) => (
                  <td key={item.code} className="px-4 py-3">
                    {item.tags
                      ? <span className="flex flex-wrap gap-1">{item.tags.split("|").filter(Boolean).map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</span>
                      : "暂无数据"}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-border/60 align-top">
                <td className="px-4 py-3 text-muted-foreground">招生计划数</td>
                {items.map((item) => (
                  <td key={item.code} className="px-4 py-3">
                    {item.plans === null ? (
                      "暂无数据"
                    ) : item.plans.total_count === null ? (
                      <>
                        暂无数据
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {item.plans.year} 年有 {item.plans.rows} 条计划记录，计划数均未收录
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold">{item.plans.total_count} 人</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {item.plans.year} 年 · 共 {item.plans.majors} 个专业
                        </span>
                        {item.plans.sources.map((source) => (
                          <span key={source} className="mt-1 block text-xs text-muted-foreground break-words">来源：{source}</span>
                        ))}
                      </>
                    )}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-border/60 align-top">
                <td className="px-4 py-3 text-muted-foreground">录取最低分</td>
                {items.map((item) => (
                  <td key={item.code} className="px-4 py-3">
                    {item.score === null ? (
                      "暂无数据"
                    ) : item.score.min_score === null ? (
                      <>
                        暂无数据
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {item.score.year} 年有 {item.score.rows} 条记录，最低分均无法解析
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold">{item.score.min_score} 分</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{item.score.year} 年</span>
                        {item.score.source && (
                          <span className="mt-1 block text-xs text-muted-foreground break-words">来源：{item.score.source}</span>
                        )}
                        {item.score.invalid_rows > 0 && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            另有 {item.score.invalid_rows} 条记录无法解析，已跳过
                          </span>
                        )}
                      </>
                    )}
                  </td>
                ))}
              </tr>
              <tr className="align-top">
                <td className="px-4 py-3 text-muted-foreground">基础信息来源</td>
                {items.map((item) => (
                  <td key={item.code} className="px-4 py-3 text-xs text-muted-foreground break-words">
                    {nd(item.source)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
