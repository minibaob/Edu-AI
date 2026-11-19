// 模块5 高校与录取数据查询：列表（搜索 + 筛选 + 分页）、详情（历年录取数据 + 招生计划）、专业目录。
// 数据真实性：没有数据的字段一律显示「暂无数据」；真实数据为空时只展示明确标注的演示数据
// （99999 示例大学，格式示例），绝不把演示数据当成官方数据。
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DemoBadge } from "@/src/components/demo-badge";
import { navigate, useRoute } from "@/src/lib/router";
import { ApiError, errorMessage } from "@/src/lib/api";
import { PROVINCES } from "@/src/lib/options";
import {
  DEMO_UNIVERSITY,
  DEMO_UNIVERSITY_DETAIL,
  getUniversity,
  listMajors,
  listUniversities,
} from "@/src/lib/universities";
import type { University, UniversityDetail } from "@/src/lib/universities";
import { cn } from "@/lib/utils";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const PAGE_SIZE = 20;
const UNIVERSITY_TYPES = ["综合", "理工", "农林", "医药", "师范", "语言", "财经", "政法", "体育", "艺术", "军事", "其他"];
const UNIVERSITY_LEVELS = ["本科", "专科"];
const UNIVERSITY_TAGS = ["双一流", "985", "211", "公办", "民办", "中外合作"];
const MAJOR_CATEGORIES = ["哲学", "经济学", "法学", "教育学", "文学", "历史学", "理学", "工学", "农学", "医学", "军事学", "管理学", "艺术学", "交叉学科"];
const PILOT_PROVINCES = ["河北", "河南"];

function hashCode(): string | null {
  const query = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(query).get("code");
}

function noData(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "暂无数据" : String(value);
}

export default function UniversitiesPage() {
  const route = useRoute();
  const selectedCode = hashCode();
  const [tab, setTab] = useState<"universities" | "majors">("universities");

  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [province, setProvince] = useState("");
  const [type, setType] = useState("");
  const [level, setLevel] = useState("");
  const [tag, setTag] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<University[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [detail, setDetail] = useState<UniversityDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isDemoDetail, setIsDemoDetail] = useState(false);

  const [scoreProvince, setScoreProvince] = useState("");
  const [scoreYear, setScoreYear] = useState("");
  const [scoreCategory, setScoreCategory] = useState("");

  const [majorQ, setMajorQ] = useState("");
  const [majorCategory, setMajorCategory] = useState("");
  const [majorItems, setMajorItems] = useState<{ code: string; name: string; category: string; years: number; degree: string | null; source: string; note: string | null }[]>([]);
  const [majorTotal, setMajorTotal] = useState(0);
  const [majorLoading, setMajorLoading] = useState(false);
  const [majorError, setMajorError] = useState<string | null>(null);

  const filtersActive = appliedQ !== "" || province !== "" || type !== "" || level !== "" || tag !== "";

  const loadList = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listUniversities({
        q: appliedQ || undefined,
        province: province || undefined,
        type: type || undefined,
        level: level || undefined,
        tag: tag || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      setTotal(data.total);
      setItems(data.items);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [appliedQ, province, type, level, tag, offset]);

  useEffect(() => {
    if (!selectedCode) void loadList();
  }, [selectedCode, loadList]);

  useEffect(() => {
    if (!selectedCode) return;
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setIsDemoDetail(false);
    setDetailLoading(true);
    setScoreProvince("");
    setScoreYear("");
    setScoreCategory("");
    (async () => {
      try {
        const data = await getUniversity(selectedCode);
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (!cancelled) {
          if (selectedCode === DEMO_UNIVERSITY.code && err instanceof ApiError && err.status === 404) {
            setDetail(DEMO_UNIVERSITY_DETAIL);
            setIsDemoDetail(true);
          } else {
            setDetailError(errorMessage(err));
          }
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCode, route]);

  const loadMajors = useCallback(async () => {
    setMajorLoading(true);
    setMajorError(null);
    try {
      const data = await listMajors({ q: majorQ || undefined, category: majorCategory || undefined, limit: 50 });
      setMajorTotal(data.total);
      setMajorItems(data.items);
    } catch (err) {
      setMajorError(errorMessage(err));
    } finally {
      setMajorLoading(false);
    }
  }, [majorQ, majorCategory]);

  useEffect(() => {
    if (tab === "majors") void loadMajors();
  }, [tab, loadMajors]);

  const scoreYears = useMemo(
    () => [...new Set((detail?.scores ?? []).map((s) => s.year))].sort((a, b) => b - a),
    [detail]
  );
  const filteredScores = useMemo(
    () =>
      (detail?.scores ?? []).filter(
        (s) =>
          (scoreProvince === "" || s.province === scoreProvince) &&
          (scoreYear === "" || String(s.year) === scoreYear) &&
          (scoreCategory === "" || s.category === scoreCategory)
      ),
    [detail, scoreProvince, scoreYear, scoreCategory]
  );

  function openDetail(code: string) {
    navigate(`/universities?code=${encodeURIComponent(code)}`);
  }

  function applySearch() {
    setAppliedQ(q.trim());
    setOffset(0);
  }

  // ---- 详情页 ----
  if (selectedCode) {
    return (
      <div className="flex flex-col gap-4">
        <Button variant="outline" className="w-fit" onClick={() => navigate("/universities")}>
          <ArrowLeft className="size-4" aria-hidden /> 返回高校列表
        </Button>
        {detailLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
        {detailError && (
          <Alert variant="destructive">
            <AlertDescription>{detailError}</AlertDescription>
          </Alert>
        )}
        {detail && (
          <>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-xl">{detail.university.name}</CardTitle>
                  {isDemoDetail && <DemoBadge />}
                </div>
                <CardDescription>
                  院校代码 {detail.university.code} · {detail.university.province}
                  {detail.university.city ? ` ${detail.university.city}` : ""} · {detail.university.type} · {detail.university.level}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  {detail.university.tags.map((t) => (
                    <Badge key={t} variant="secondary">{t}</Badge>
                  ))}
                </div>
                {detail.university.admission_url && (
                  <p>
                    <a
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      href={detail.university.admission_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      招生网 <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">数据来源：{detail.university.source}</p>
                {detail.university.note && <p className="text-xs text-muted-foreground">备注：{detail.university.note}</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">历年录取数据</CardTitle>
                <CardDescription>分数与位次以各省教育考试院官方公布为准；空字段显示「暂无数据」。</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="grid grid-cols-3 gap-3">
                  <select className={selectClass} value={scoreProvince} onChange={(e) => setScoreProvince(e.target.value)} aria-label="招生省份">
                    <option value="">全部省份</option>
                    {PILOT_PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select className={selectClass} value={scoreYear} onChange={(e) => setScoreYear(e.target.value)} aria-label="年份">
                    <option value="">全部年份</option>
                    {scoreYears.map((y) => <option key={y} value={String(y)}>{y} 年</option>)}
                  </select>
                  <select className={selectClass} value={scoreCategory} onChange={(e) => setScoreCategory(e.target.value)} aria-label="科类">
                    <option value="">全部科类</option>
                    {["物理类", "历史类", "理科", "文科", "综合", "艺术类", "体育类"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                {filteredScores.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">暂无数据</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>年份</TableHead>
                          <TableHead>省份</TableHead>
                          <TableHead>科类</TableHead>
                          <TableHead>批次</TableHead>
                          <TableHead>选科要求</TableHead>
                          <TableHead className="text-right">最低分</TableHead>
                          <TableHead className="text-right">最低位次</TableHead>
                          <TableHead className="text-right">录取人数</TableHead>
                          <TableHead>数据来源</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredScores.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell>{s.year}</TableCell>
                            <TableCell>{s.province}</TableCell>
                            <TableCell>{s.category}</TableCell>
                            <TableCell>{s.batch}</TableCell>
                            <TableCell>{noData(s.subject_requirement)}</TableCell>
                            <TableCell className="text-right">{noData(s.min_score)}</TableCell>
                            <TableCell className="text-right">{noData(s.min_rank)}</TableCell>
                            <TableCell className="text-right">{noData(s.admitted_count)}</TableCell>
                            <TableCell className="max-w-56 truncate text-xs text-muted-foreground" title={s.source}>{s.source}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">招生计划</CardTitle>
                <CardDescription>分省分专业计划数与学费（有可靠数据时展示）。</CardDescription>
              </CardHeader>
              <CardContent>
                {detail.plans.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">暂无数据</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>年份</TableHead>
                          <TableHead>省份</TableHead>
                          <TableHead>专业</TableHead>
                          <TableHead>批次</TableHead>
                          <TableHead>选科要求</TableHead>
                          <TableHead className="text-right">计划数</TableHead>
                          <TableHead className="text-right">学费（元/年）</TableHead>
                          <TableHead>数据来源</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.plans.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell>{p.year}</TableCell>
                            <TableCell>{p.province}</TableCell>
                            <TableCell>{p.major_name}</TableCell>
                            <TableCell>{noData(p.batch)}</TableCell>
                            <TableCell>{noData(p.subject_requirement)}</TableCell>
                            <TableCell className="text-right">{noData(p.plan_count)}</TableCell>
                            <TableCell className="text-right">{noData(p.tuition)}</TableCell>
                            <TableCell className="max-w-56 truncate text-xs text-muted-foreground" title={p.source}>{p.source}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    );
  }

  // ---- 列表页 ----
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="edu-gradient flex size-11 items-center justify-center rounded-xl text-white">
          <Building2 className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-bold">高校与录取数据查询</h1>
          <p className="text-sm text-muted-foreground">首批试点：河北、河南。数据来自官方公开渠道，空字段显示「暂无数据」。</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant={tab === "universities" ? "default" : "outline"} onClick={() => setTab("universities")}>高校列表</Button>
        <Button variant={tab === "majors" ? "default" : "outline"} onClick={() => setTab("majors")}>专业目录</Button>
      </div>

      {tab === "majors" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">专业目录</CardTitle>
            <CardDescription>教育部《普通高等学校本科专业目录》规范名称与代码。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  className="pl-9"
                  placeholder="搜索专业名称或代码"
                  value={majorQ}
                  onChange={(e) => setMajorQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void loadMajors(); }}
                />
              </div>
              <select className={selectClass} value={majorCategory} onChange={(e) => setMajorCategory(e.target.value)} aria-label="学科门类">
                <option value="">全部学科门类</option>
                {MAJOR_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <Button className="w-fit" onClick={() => void loadMajors()}>搜索</Button>
            {majorError && (
              <Alert variant="destructive"><AlertDescription>{majorError}</AlertDescription></Alert>
            )}
            {majorLoading ? (
              <div className="flex flex-col gap-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
            ) : majorItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">暂无数据</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">共 {majorTotal} 个专业</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>专业代码</TableHead>
                        <TableHead>专业名称</TableHead>
                        <TableHead>学科门类</TableHead>
                        <TableHead>学制</TableHead>
                        <TableHead>授予学位</TableHead>
                        <TableHead>数据来源</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {majorItems.map((m) => (
                        <TableRow key={m.code}>
                          <TableCell>{m.code}</TableCell>
                          <TableCell className="font-medium">{m.name}</TableCell>
                          <TableCell>{m.category}</TableCell>
                          <TableCell>{m.years} 年</TableCell>
                          <TableCell>{noData(m.degree)}</TableCell>
                          <TableCell className="max-w-56 truncate text-xs text-muted-foreground" title={m.source}>{m.source}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    className="pl-9"
                    placeholder="搜索高校名称或院校代码"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
                  />
                </div>
                <Button onClick={applySearch}>搜索</Button>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <select className={selectClass} value={province} onChange={(e) => { setProvince(e.target.value); setOffset(0); }} aria-label="所在省份">
                  <option value="">全部省份</option>
                  {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <select className={selectClass} value={type} onChange={(e) => { setType(e.target.value); setOffset(0); }} aria-label="办学类型">
                  <option value="">全部类型</option>
                  {UNIVERSITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className={selectClass} value={level} onChange={(e) => { setLevel(e.target.value); setOffset(0); }} aria-label="办学层次">
                  <option value="">本科 / 专科</option>
                  {UNIVERSITY_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <select className={selectClass} value={tag} onChange={(e) => { setTag(e.target.value); setOffset(0); }} aria-label="标签">
                  <option value="">全部标签</option>
                  {UNIVERSITY_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </CardContent>
          </Card>

          {loadError && (
            <Alert variant="destructive">
              <AlertDescription>
                {loadError}
                <Button variant="outline" size="sm" className="ml-3" onClick={() => void loadList()}>重试</Button>
              </AlertDescription>
            </Alert>
          )}

          {loading ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : items.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col gap-4 p-6">
                {filtersActive ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">没有符合条件的高校，换个筛选条件试试</p>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">暂无真实数据，数据收集中</p>
                      <DemoBadge />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      高校与录取数据正在按官方渠道整理导入。下面这所是界面格式演示，点击可查看录取数据表的样子。
                    </p>
                    <UniversityCard university={DEMO_UNIVERSITY} demo onOpen={openDetail} />
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">共 {total} 所高校</p>
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((u) => (
                  <UniversityCard key={u.code} university={u} onOpen={openDetail} />
                ))}
              </div>
              <div className="flex items-center justify-between">
                <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</Button>
                <span className="text-sm text-muted-foreground">第 {Math.floor(offset / PAGE_SIZE) + 1} 页</span>
                <Button variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>下一页</Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function UniversityCard({ university, demo = false, onOpen }: { university: University; demo?: boolean; onOpen: (code: string) => void }) {
  return (
    <Card className={cn("hover:border-primary/40", demo && "border-amber-300 bg-amber-50/40")}>
      <CardContent className="flex flex-col gap-2 p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold leading-snug">{university.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              院校代码 {university.code} · {university.province}
              {university.city ? ` ${university.city}` : ""} · {university.type} · {university.level}
            </p>
          </div>
          {demo && <DemoBadge />}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {university.tags.map((t) => (
            <Badge key={t} variant="secondary">{t}</Badge>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="max-w-64 truncate text-xs text-muted-foreground" title={university.source}>
            来源：{university.source}
          </span>
          <Button size="sm" onClick={() => onOpen(university.code)}>查看详情</Button>
        </div>
      </CardContent>
    </Card>
  );
}
