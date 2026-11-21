import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, navigate, useRoute } from "@/src/lib/router";
import {
  errorMessage, getUniversities, getUniversityDetail,
} from "@/src/lib/api";
import type { ScoreRow, UniversitiesResponse, UniversityDetail } from "@/src/lib/api";

const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const PAGE_SIZE = 30;

function nd(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "暂无数据" : String(value);
}

function distinct<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export default function UniversitiesPage({ code }: { code?: string }) {
  const route = useRoute();
  const requestedProvince = new URLSearchParams(route.split("?")[1]).get("province") ?? "";
  const [data, setData] = useState<UniversitiesResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getUniversities()
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retry]);

  const provinces = distinct([...(data?.score_facets.provinces ?? []), ...(data?.plan_facets.provinces ?? [])]);
  const province = provinces.includes(requestedProvince) ? requestedProvince : "";

  function chooseProvince(value: string) {
    const path = !province && code ? `/universities/${code}` : "/universities";
    navigate(value ? `${path}?province=${encodeURIComponent(value)}` : "/universities");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Building2 className="size-6 text-primary" aria-hidden /> 高校与录取数据查询
        </h1>
        <p className="text-sm text-muted-foreground">先选择参加高考的省份，再选择高校，查看该省录取分数和招生计划。</p>
      </div>
      {loading && <p role="status" className="py-12 text-center text-sm text-muted-foreground">正在加载省份与院校数据…</p>}
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {error}<Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>重试加载</Button>
          </AlertDescription>
        </Alert>
      )}
      {!loading && !error && data && (
        <>
          <Card className="border-primary/20 bg-accent/30">
            <CardHeader>
              <CardTitle className="text-base">第一步：选择高考省份</CardTitle>
              <CardDescription>这里选择的是生源省份，不是大学所在地。仅提供已收录的官方数据。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Label htmlFor="admission-province">高考省份</Label>
              <select id="admission-province" className={`${selectClass} w-full bg-card sm:max-w-xs`}
                value={province} onChange={(e) => chooseProvince(e.target.value)} disabled={provinces.length === 0}>
                <option value="">请选择高考省份</option>
                {provinces.map((item) => <option key={item} value={item}>{item}省</option>)}
              </select>
              {requestedProvince && !province && <p role="alert" className="text-sm text-destructive">该省份暂无已收录数据，请重新选择。</p>}
              {provinces.length === 0 && <p className="text-sm text-muted-foreground">暂无可查询的省份，官方数据整理导入后即可查询。</p>}
            </CardContent>
          </Card>
          {!province && provinces.length > 0 && <p className="py-8 text-center text-sm text-muted-foreground">请先选择高考省份，再查找高校。</p>}
          {province && (code
            ? <DetailView key={`${province}:${code}`} code={code} province={province} />
            : <ListView key={province} data={data} province={province} />)}
        </>
      )}
    </div>
  );
}

function ListView({ data, province }: { data: UniversitiesResponse; province: string }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const list = data?.universities ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((u) => u.name.toLowerCase().includes(q) || u.code.toLowerCase().includes(q));
  }, [data, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">第二步：选择高校 · {province}考生</h2>
        <p className="text-sm text-muted-foreground">下方为全站已收录院校名录；所选省份未收录该校数据时，详情会显示「暂无数据」。</p>
      </div>

      {data.universities.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>暂无院校数据</CardTitle>
            <CardDescription>
              官方数据整理导入后即可查询。管理员可在「数据导入」页上传按模板整理的 CSV。
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {data.universities.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">院校名录共 {data.universities.length} 所 · 当前匹配 {filtered.length} 所</p>

          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              className="pl-9"
              placeholder="搜索学校名称或院校代码"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              aria-label="搜索院校"
            />
          </div>

          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {visible.map((u) => (
                  <li key={u.code}>
                    <Link
                      to={`/universities/${encodeURIComponent(u.code)}?province=${encodeURIComponent(province)}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent"
                    >
                      <span className="font-medium">{u.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">院校代码 {u.code}</span>
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

function DetailView({ code, province }: { code: string; province: string }) {
  const [data, setData] = useState<UniversityDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");
  const [planYear, setPlanYear] = useState<number>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getUniversityDetail(code, planYear, province)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [code, province, planYear, retry]);

  const scores = (data?.scores ?? []).filter((s) => s.province === province);
  const scoreYears = distinct(scores.map((s) => s.year)).sort((a, b) => b - a);
  const scoreCategories = distinct(scores.map((s) => s.category));
  const scoreBatches = distinct(scores.map((s) => s.batch));
  const filteredPlans = (data?.plans ?? []).filter((p) => p.province === province);

  const filteredScores = scores.filter((s) =>
    (yearFilter === "" || s.year === Number(yearFilter))
    && (categoryFilter === "" || s.category === categoryFilter)
    && (batchFilter === "" || s.batch === batchFilter));

  const u = data?.university;

  return (
    <div className="flex flex-col gap-4">
      <Link to={`/universities?province=${encodeURIComponent(province)}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> 返回{province}考生院校查询
      </Link>

      {loading && <p role="status" className="py-12 text-center text-sm text-muted-foreground">正在加载{province}录取与招生数据…</p>}
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {error}<Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>重试详情</Button>
          </AlertDescription>
        </Alert>
      )}

      {!loading && !error && u && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{u.name}</CardTitle>
              <CardDescription>院校代码 {u.code} · 当前查看：{province}考生数据</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <div><dt className="text-muted-foreground">所在省份</dt><dd>{nd(u.province)}</dd></div>
                <div><dt className="text-muted-foreground">所在城市</dt><dd>{nd(u.city)}</dd></div>
                <div><dt className="text-muted-foreground">办学类型</dt><dd>{nd(u.type)}</dd></div>
                <div><dt className="text-muted-foreground">办学层次</dt><dd>{nd(u.level)}</dd></div>
                <div>
                  <dt className="text-muted-foreground">标签</dt>
                  <dd>
                    {u.tags
                      ? <span className="flex flex-wrap gap-1">{u.tags.split("|").filter(Boolean).map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</span>
                      : "暂无数据"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">招生网址</dt>
                  <dd>
                    {u.website
                      ? <a href={u.website} target="_blank" rel="noreferrer" className="text-primary underline break-all">{u.website}</a>
                      : "暂无数据"}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                基础信息为全国通用，不随考生省份变化；录取分数与招生计划按考生省份查询。
              </p>
              <p className="mt-1 text-xs text-muted-foreground break-words">数据来源：{u.source}</p>
              {u.note && <p className="mt-1 text-xs text-muted-foreground break-words">{u.note}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{province} · 历年录取分数 / 位次</CardTitle>
              <CardDescription>
                最低分含艺术/体育类综合分（带小数，口径见各条备注）；缺失字段显示「暂无数据」。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                <FilterSelect label="年份" value={yearFilter} onChange={setYearFilter}
                  options={scoreYears.map((y) => ({ value: String(y), label: `${y} 年` }))} />
                <FilterSelect label="科类" value={categoryFilter} onChange={setCategoryFilter}
                  options={scoreCategories.map((c) => ({ value: c, label: c }))} />
                <FilterSelect label="批次" value={batchFilter} onChange={setBatchFilter}
                  options={scoreBatches.map((b) => ({ value: b, label: b }))} />
              </div>
              <ScoreTable rows={filteredScores} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{province} · 招生计划</CardTitle>
              <CardDescription>仅显示面向{province}考生的已收录计划，默认展示该校在本省最新有数据的年份；同专业可能因办学地点不同有多行。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {data && data.plan_years.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="plan-year">年份</Label>
                    <select
                      id="plan-year" className={selectClass}
                      value={data.plan_year ?? ""}
                      onChange={(e) => setPlanYear(Number(e.target.value))}
                    >
                      {data.plan_year === null && <option value="" disabled>暂无已收录计划</option>}
                      {data.plan_years.map((y) => <option key={y} value={y}>{y} 年</option>)}
                    </select>
                  </div>
                </div>
              )}
              <PlanTable rows={filteredPlans} />
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

function PlanTable({ rows }: { rows: UniversityDetail["plans"] }) {
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