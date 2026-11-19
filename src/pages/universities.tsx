import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/src/lib/router";
import {
  errorMessage, getUniversities, getUniversityDetail,
} from "@/src/lib/api";
import type { PlanRow, ScoreRow, UniversitiesResponse, UniversityDetail } from "@/src/lib/api";

const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const PAGE_SIZE = 30;
const SERIES_COLORS = ["#2563eb", "#7c3aed", "#0891b2", "#db2777", "#ca8a04", "#16a34a"];

function nd(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "暂无数据" : String(value);
}

function distinct<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export default function UniversitiesPage({ code }: { code?: string }) {
  return code ? <DetailView code={code} /> : <ListView />;
}

function ListView() {
  const [data, setData] = useState<UniversitiesResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [provinceFilter, setProvinceFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getUniversities();
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const list = data?.universities ?? [];
  const provinces = distinct(list.map((u) => u.province).filter((v): v is string => !!v)).sort();
  const types = distinct(list.map((u) => u.type).filter((v): v is string => !!v)).sort();
  const levels = distinct(list.map((u) => u.level).filter((v): v is string => !!v)).sort();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((u) =>
      (provinceFilter === "" || u.province === provinceFilter)
      && (typeFilter === "" || u.type === typeFilter)
      && (levelFilter === "" || u.level === levelFilter)
      && (!q || u.name.toLowerCase().includes(q) || u.code.toLowerCase().includes(q)));
  }, [list, query, provinceFilter, typeFilter, levelFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  function resetPage() { setPage(0); }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Building2 className="size-6 text-primary" aria-hidden /> 高校与录取数据查询
        </h1>
        <p className="text-sm text-muted-foreground">
          首批试点：河北省、河南省 · 数据以各省教育考试院官方公布为准，仅供参考
        </p>
      </div>

      {loading && <p className="py-12 text-center text-sm text-muted-foreground">正在加载院校数据…</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {!loading && !error && data && data.universities.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>暂无院校数据</CardTitle>
            <CardDescription>
              官方数据整理导入后即可查询。管理员可在「数据导入」页上传按模板整理的 CSV。
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {!loading && !error && data && data.universities.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>共 {data.counts.universities} 所院校</span>
            <span>· {data.counts.admission_scores} 条录取记录</span>
            <span>· {data.counts.enrollment_plans} 条招生计划</span>
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs text-accent-foreground">
              试点省份：{(data.score_facets.provinces ?? []).join('、') || '暂无数据'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                className="pl-9"
                placeholder="搜索学校名称或院校代码"
                value={query}
                onChange={(e) => { setQuery(e.target.value); resetPage(); }}
                aria-label="搜索院校"
              />
            </div>
            {provinces.length > 0 && (
              <FilterSelect label="所在地区" value={provinceFilter} onChange={(v) => { setProvinceFilter(v); resetPage(); }}
                options={provinces.map((p) => ({ value: p, label: p }))} />
            )}
            {types.length > 0 && (
              <FilterSelect label="办学类型" value={typeFilter} onChange={(v) => { setTypeFilter(v); resetPage(); }}
                options={types.map((t) => ({ value: t, label: t }))} />
            )}
            {levels.length > 0 && (
              <FilterSelect label="办学层次" value={levelFilter} onChange={(v) => { setLevelFilter(v); resetPage(); }}
                options={levels.map((l) => ({ value: l, label: l }))} />
            )}
          </div>

          {provinces.length === 0 && types.length === 0 && levels.length === 0 && (
            <p className="text-xs text-muted-foreground">
              官方来源暂未含地区/办学类型等院校属性；补充导入后将在此展示并可用于筛选。
            </p>
          )}

          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {visible.map((u) => (
                  <li key={u.code}>
                    <Link
                      to={`/universities/${u.code}`}
                      className="flex flex-col gap-1 px-4 py-3 hover:bg-accent"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-medium">{u.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">院校代码 {u.code}</span>
                      </span>
                      {(u.province || u.city || u.type || u.level || u.tags) && (
                        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {u.province && <span>{u.province}{u.city ? ` · ${u.city}` : ""}</span>}
                          {u.type && <span>{u.type}</span>}
                          {u.level && <span>{u.level}</span>}
                          {u.tags && (
                            <span className="rounded-full bg-accent px-2 py-0.5 text-accent-foreground">{u.tags}</span>
                          )}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
                {visible.length === 0 && (
                  <li className="px-4 py-8 text-center text-sm text-muted-foreground">没有匹配的院校</li>
                )}
              </ul>
            </CardContent>
          </Card>

          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <Button variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
                上一页
              </Button>
              <span className="text-muted-foreground">第 {current + 1} / {pageCount} 页</span>
              <Button variant="outline" size="sm" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>
                下一页
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DetailView({ code }: { code: string }) {
  const [data, setData] = useState<UniversityDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [provinceFilter, setProvinceFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [planProvinceFilter, setPlanProvinceFilter] = useState("");
  const [planSubjectFilter, setPlanSubjectFilter] = useState("");
  const [metric, setMetric] = useState<"score" | "rank">("score");

  async function load(planYear?: number) {
    setLoading(true);
    setError("");
    try {
      setData(await getUniversityDetail(code, planYear));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // 切换院校时重置筛选，避免上一所的省份/年份筛选把新院校数据滤成「暂无数据」。
    setYearFilter("");
    setCategoryFilter("");
    setBatchFilter("");
    setProvinceFilter("");
    setSubjectFilter("");
    setPlanProvinceFilter("");
    setPlanSubjectFilter("");
    load();
  }, [code]);

  const scores = data?.scores ?? [];
  const scoreYears = distinct(scores.map((s) => s.year)).sort((a, b) => b - a);
  const scoreCategories = distinct(scores.map((s) => s.category));
  const scoreBatches = distinct(scores.map((s) => s.batch));
  const scoreProvinces = distinct(scores.map((s) => s.province));
  const scoreSubjects = distinct(scores.map((s) => s.subject_requirement).filter((v): v is string => !!v));
  const plans = data?.plans ?? [];
  const planProvinces = distinct(plans.map((p) => p.province));
  const planSubjects = distinct(plans.map((p) => p.subject_requirement).filter((v): v is string => !!v));

  const filteredScores = scores.filter((s) =>
    (yearFilter === "" || s.year === Number(yearFilter))
    && (categoryFilter === "" || s.category === categoryFilter)
    && (batchFilter === "" || s.batch === batchFilter)
    && (provinceFilter === "" || s.province === provinceFilter)
    && (subjectFilter === "" || s.subject_requirement === subjectFilter));

  const filteredPlans = plans.filter((p) =>
    (planProvinceFilter === "" || p.province === planProvinceFilter)
    && (planSubjectFilter === "" || p.subject_requirement === planSubjectFilter));

  const majorGroups = useMemo(() => {
    const map = new Map<string, {
      name: string; code: string | null; subject: string | null;
      count: number | null; tuitions: number[];
    }>();
    for (const p of filteredPlans) {
      const key = `${p.major_name}|${p.major_code ?? ""}|${p.subject_requirement ?? ""}`;
      const group = map.get(key) ?? {
        name: p.major_name, code: p.major_code, subject: p.subject_requirement,
        count: null, tuitions: [],
      };
      if (typeof p.plan_count === "number") group.count = (group.count ?? 0) + p.plan_count;
      if (typeof p.tuition === "number" && !group.tuitions.includes(p.tuition)) group.tuitions.push(p.tuition);
      map.set(key, group);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  }, [filteredPlans]);

  const u = data?.university;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/universities" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> 返回院校列表
      </Link>

      {loading && <p className="py-12 text-center text-sm text-muted-foreground">正在加载院校详情…</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {!loading && !error && u && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{u.name}</CardTitle>
              <CardDescription>院校代码 {u.code}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <div><dt className="text-muted-foreground">所在省份</dt><dd>{nd(u.province)}</dd></div>
                <div><dt className="text-muted-foreground">所在城市</dt><dd>{nd(u.city)}</dd></div>
                <div><dt className="text-muted-foreground">办学类型</dt><dd>{nd(u.type)}</dd></div>
                <div><dt className="text-muted-foreground">办学层次</dt><dd>{nd(u.level)}</dd></div>
                <div><dt className="text-muted-foreground">标签</dt><dd>{nd(u.tags)}</dd></div>
                <div>
                  <dt className="text-muted-foreground">招生网址</dt>
                  <dd>
                    {u.website
                      ? <a href={u.website} target="_blank" rel="noreferrer" className="text-primary underline break-all">{u.website}</a>
                      : "暂无数据"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">历年录取分数 / 位次</CardTitle>
              <CardDescription>
                最低分含艺术/体育类综合分（带小数，口径见各条备注）；缺失字段显示「暂无数据」。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                <FilterSelect label="省份" value={provinceFilter} onChange={setProvinceFilter}
                  options={scoreProvinces.map((p) => ({ value: p, label: p }))} />
                <FilterSelect label="年份" value={yearFilter} onChange={setYearFilter}
                  options={scoreYears.map((y) => ({ value: String(y), label: `${y} 年` }))} />
                <FilterSelect label="科类" value={categoryFilter} onChange={setCategoryFilter}
                  options={scoreCategories.map((c) => ({ value: c, label: c }))} />
                <FilterSelect label="批次" value={batchFilter} onChange={setBatchFilter}
                  options={scoreBatches.map((b) => ({ value: b, label: b }))} />
                {scoreSubjects.length > 0 && (
                  <FilterSelect label="选科要求" value={subjectFilter} onChange={setSubjectFilter}
                    options={scoreSubjects.map((s) => ({ value: s, label: s }))} />
                )}
              </div>
              <ScoreTable rows={filteredScores} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">历年变化趋势</CardTitle>
              <CardDescription>
                仅用上方筛选后表格中的数值字段绘制（艺术/体育综合分按原值）；缺失值不绘点。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Button variant={metric === "score" ? "secondary" : "outline"} size="sm" onClick={() => setMetric("score")}>
                  最低分
                </Button>
                <Button variant={metric === "rank" ? "secondary" : "outline"} size="sm" onClick={() => setMetric("rank")}>
                  最低位次
                </Button>
              </div>
              <TrendChart rows={filteredScores} metric={metric} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">招生计划</CardTitle>
              <CardDescription>按学校名称关联当年各试点省份招生计划；同专业可能因办学地点不同有多行。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {data && data.plan_years.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="plan-year">年份</Label>
                    <select
                      id="plan-year" className={selectClass}
                      value={data.plan_year ?? ""}
                      onChange={(e) => load(Number(e.target.value))}
                    >
                      {data.plan_years.map((y) => <option key={y} value={y}>{y} 年</option>)}
                    </select>
                  </div>
                  <FilterSelect label="省份" value={planProvinceFilter} onChange={setPlanProvinceFilter}
                    options={planProvinces.map((p) => ({ value: p, label: p }))} />
                  {planSubjects.length > 0 && (
                    <FilterSelect label="选科要求" value={planSubjectFilter} onChange={setPlanSubjectFilter}
                      options={planSubjects.map((s) => ({ value: s, label: s }))} />
                  )}
                </div>
              )}
              <PlanTable rows={filteredPlans} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">专业列表（{nd(data?.plan_year)} 年招生计划汇总）</CardTitle>
              <CardDescription>
                由上方筛选后的招生计划按专业归并（计划数求和、学费去重列出），非独立官方专业目录；官方专业目录数据导入后另行展示。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {majorGroups.length === 0
                ? <p className="py-6 text-center text-sm text-muted-foreground">暂无数据</p>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="px-2 py-2 font-medium">专业名称</th>
                          <th className="px-2 py-2 font-medium">专业代码</th>
                          <th className="px-2 py-2 font-medium">选科要求</th>
                          <th className="px-2 py-2 font-medium">计划数合计</th>
                          <th className="px-2 py-2 font-medium">学费（元/学年）</th>
                        </tr>
                      </thead>
                      <tbody>
                        {majorGroups.map((m) => (
                          <tr key={`${m.name}|${m.code ?? ""}|${m.subject ?? ""}`} className="border-b border-border/60">
                            <td className="px-2 py-2 font-medium">{m.name}</td>
                            <td className="px-2 py-2">{nd(m.code)}</td>
                            <td className="px-2 py-2">{nd(m.subject)}</td>
                            <td className="px-2 py-2">{nd(m.count)}</td>
                            <td className="px-2 py-2">{m.tuitions.length > 0 ? m.tuitions.sort((a, b) => a - b).join(" / ") : "暂无数据"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            数据来源：{u.source}。录取与计划数据以各省教育考试院及高校官方公布为准，本站仅作查询展示，不构成志愿填报建议。
          </p>
        </>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-muted-foreground">{label}</Label>
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">全部</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function TrendChart({ rows, metric }: { rows: ScoreRow[]; metric: "score" | "rank" }) {
  const series = useMemo(() => {
    const map = new Map<string, { label: string; points: { year: number; value: number }[] }>();
    for (const s of rows) {
      const value = metric === "score"
        ? (s.min_score === null || s.min_score === "" ? NaN : Number(s.min_score))
        : (s.min_rank ?? NaN);
      if (!Number.isFinite(value)) continue;
      const label = `${s.province} · ${s.category} · ${s.batch}${s.subject_requirement ? ` · ${s.subject_requirement}` : ""}`;
      const entry = map.get(label) ?? { label, points: [] };
      entry.points.push({ year: s.year, value });
      map.set(label, entry);
    }
    return [...map.values()]
      .map((s) => ({ ...s, points: s.points.sort((a, b) => a.year - b.year) }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh"));
  }, [rows, metric]);

  if (series.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">暂无数据</p>;
  if (series.length > SERIES_COLORS.length) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        当前筛选含 {series.length} 个省份/科类/批次/选科组合，请先收窄筛选再查看趋势。
      </p>
    );
  }

  const years = distinct(series.flatMap((s) => s.points.map((p) => p.year))).sort((a, b) => a - b);
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const W = 640, H = 240;
  const pad = { l: 64, r: 16, t: 16, b: 32 };
  const x = (year: number) => years.length === 1
    ? pad.l + (W - pad.l - pad.r) / 2
    : pad.l + ((year - years[0]) / (years[years.length - 1] - years[0])) * (W - pad.l - pad.r);
  const y = (v: number) => max === min
    ? pad.t + (H - pad.t - pad.b) / 2
    : pad.t + ((max - v) / (max - min)) * (H - pad.t - pad.b);
  const fmt = (v: number) => (metric === "rank" ? String(Math.round(v)) : String(v));
  const yTicks = max === min ? [min] : [min, (min + max) / 2, max];

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={metric === "score" ? "历年最低分趋势图" : "历年最低位次趋势图"}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.15} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.6}>
              {fmt(v)}
            </text>
          </g>
        ))}
        {years.map((yr) => (
          <text key={yr} x={x(yr)} y={H - 10} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.6}>
            {yr}
          </text>
        ))}
        {series.map((s, i) => (
          <g key={s.label} stroke={SERIES_COLORS[i]} fill={SERIES_COLORS[i]}>
            {s.points.length > 1 && (
              <polyline
                fill="none" strokeWidth={2}
                points={s.points.map((p) => `${x(p.year)},${y(p.value)}`).join(" ")}
              />
            )}
            {s.points.map((p) => (
              <circle key={`${p.year}-${p.value}`} cx={x(p.year)} cy={y(p.value)} r={3.5}>
                <title>{`${s.label} ${p.year} 年：${fmt(p.value)}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: SERIES_COLORS[i] }} aria-hidden />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScoreTable({ rows }: { rows: ScoreRow[] }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">暂无数据</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-2 py-2 font-medium">省份</th>
            <th className="px-2 py-2 font-medium">年份</th>
            <th className="px-2 py-2 font-medium">科类</th>
            <th className="px-2 py-2 font-medium">批次</th>
            <th className="px-2 py-2 font-medium">选科要求</th>
            <th className="px-2 py-2 font-medium">最低分</th>
            <th className="px-2 py-2 font-medium">最低位次</th>
            <th className="px-2 py-2 font-medium">录取人数</th>
            <th className="px-2 py-2 font-medium">说明 / 来源</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="border-b border-border/60 align-top">
              <td className="px-2 py-2">{s.province}</td>
              <td className="px-2 py-2">{s.year}</td>
              <td className="px-2 py-2">{s.category}</td>
              <td className="px-2 py-2">{s.batch}</td>
              <td className="px-2 py-2">{nd(s.subject_requirement)}</td>
              <td className="px-2 py-2 font-medium">{nd(s.min_score)}</td>
              <td className="px-2 py-2">{nd(s.min_rank)}</td>
              <td className="px-2 py-2">{nd(s.admitted_count)}</td>
              <td className="px-2 py-2">
                <details>
                  <summary className="cursor-pointer text-xs text-primary">查看</summary>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">{nd(s.note)}</p>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">来源：{s.source}</p>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlanTable({ rows }: { rows: PlanRow[] }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">暂无数据</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-2 py-2 font-medium">省份</th>
            <th className="px-2 py-2 font-medium">专业名称</th>
            <th className="px-2 py-2 font-medium">专业代码</th>
            <th className="px-2 py-2 font-medium">批次</th>
            <th className="px-2 py-2 font-medium">选科要求</th>
            <th className="px-2 py-2 font-medium">计划数</th>
            <th className="px-2 py-2 font-medium">学费（元/学年）</th>
            <th className="px-2 py-2 font-medium">备注 / 来源</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-border/60 align-top">
              <td className="px-2 py-2">{p.province}</td>
              <td className="px-2 py-2 font-medium">{p.major_name}</td>
              <td className="px-2 py-2">{nd(p.major_code)}</td>
              <td className="px-2 py-2">{nd(p.batch)}</td>
              <td className="px-2 py-2">{nd(p.subject_requirement)}</td>
              <td className="px-2 py-2">{nd(p.plan_count)}</td>
              <td className="px-2 py-2">{nd(p.tuition)}</td>
              <td className="px-2 py-2">
                <details>
                  <summary className="cursor-pointer text-xs text-primary">查看</summary>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">{nd(p.note)}</p>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">来源：{p.source}</p>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}