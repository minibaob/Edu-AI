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
  return code ? <DetailView code={code} /> : <ListView />;
}

function ListView() {
  const [data, setData] = useState<UniversitiesResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
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
              试点省份：河南（河北数据整理中）
            </span>
          </div>

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
                      to={`/universities/${u.code}`}
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

function DetailView({ code }: { code: string }) {
  const [data, setData] = useState<UniversityDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [batchFilter, setBatchFilter] = useState("");

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

  useEffect(() => { load(); }, [code]);

  const scores = data?.scores ?? [];
  const scoreYears = distinct(scores.map((s) => s.year)).sort((a, b) => b - a);
  const scoreCategories = distinct(scores.map((s) => s.category));
  const scoreBatches = distinct(scores.map((s) => s.batch));

  const filteredScores = scores.filter((s) =>
    (yearFilter === "" || s.year === Number(yearFilter))
    && (categoryFilter === "" || s.category === categoryFilter)
    && (batchFilter === "" || s.batch === batchFilter));

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
              <CardTitle className="text-base">招生计划</CardTitle>
              <CardDescription>按学校名称关联当年招生计划；同专业可能因办学地点不同有多行。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {data && data.plan_years.length > 0 && (
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
              )}
              <PlanTable rows={data?.plans ?? []} />
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