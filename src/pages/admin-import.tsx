import { useEffect, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Link } from "@/src/lib/router";
import { useAuth } from "@/src/lib/auth";
import { errorMessage, postImportChunk, postMeta } from "@/src/lib/api";
import { deleteResource, listResources } from "@/src/lib/resources";
import type { Resource } from "@/src/lib/resources";
import { parseCsv, sha256Hex, toRecords } from "@/src/lib/csv";
import type { ImportRecord, ImportTable } from "@/src/lib/csv";

const CHUNK_SIZE = 500;

const TABLES: { key: ImportTable; label: string; file: string }[] = [
  { key: "universities", label: "① 院校清单", file: "universities.csv" },
  { key: "majors", label: "② 专业目录（意向方向需要）", file: "majors.csv" },
  { key: "admission_scores", label: "③ 历年录取", file: "admission_scores.csv" },
  { key: "enrollment_plans", label: "④ 招生计划", file: "enrollment_plans.csv" },
];

type Status = "idle" | "uploading" | "done" | "error";
type TableState = {
  fileName: string; status: Status; totalChunks: number; nextChunk: number;
  inserted: number; filled: number; error: string;
};
const initial: TableState = { fileName: "", status: "idle", totalChunks: 0, nextChunk: 0, inserted: 0, filled: 0, error: "" };

function distinctValues(records: ImportRecord[], field: string): (string | number)[] {
  const set = new Set<string | number>();
  for (const r of records) {
    const v = r[field];
    if (v !== null && v !== undefined && v !== "") set.add(v);
  }
  return [...set].sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))));
}

export default function AdminImportPage() {
  const { user, loading } = useAuth();
  const [states, setStates] = useState<Record<ImportTable, TableState>>({
    universities: { ...initial }, majors: { ...initial }, admission_scores: { ...initial }, enrollment_plans: { ...initial },
  });
  const parsed = useRef<Partial<Record<ImportTable, { runId: string; records: ImportRecord[] }>>>({});

  function patch(table: ImportTable, partial: Partial<TableState>) {
    setStates((prev) => ({ ...prev, [table]: { ...prev[table], ...partial } }));
  }

  async function handleFile(table: ImportTable, file: File) {
    patch(table, { ...initial, fileName: file.name, status: "uploading" });
    try {
      const buffer = await file.arrayBuffer();
      const runId = await sha256Hex(buffer);
      const records = toRecords(table, parseCsv(new TextDecoder("utf-8").decode(buffer)));
      if (records.length === 0) throw new Error("文件没有数据行");
      parsed.current[table] = { runId, records };
      const totalChunks = Math.ceil(records.length / CHUNK_SIZE);
      patch(table, { totalChunks, nextChunk: 0, inserted: 0, filled: 0 });
      await upload(table, 0);
    } catch (err) {
      patch(table, { status: "error", error: err instanceof Error ? err.message : errorMessage(err) });
    }
  }

  async function upload(table: ImportTable, startChunk: number) {
    const entry = parsed.current[table];
    if (!entry) return;
    const { runId, records } = entry;
    const totalChunks = Math.ceil(records.length / CHUNK_SIZE);
    patch(table, { status: "uploading", error: "" });
    let inserted = states[table].inserted;
    let filled = states[table].filled;
    try {
      for (let i = startChunk; i < totalChunks; i += 1) {
        const rows = records.slice(i * CHUNK_SIZE, i * CHUNK_SIZE + CHUNK_SIZE);
        const result = await postImportChunk({ table, run_id: runId, chunk_index: i, rows });
        inserted += result.inserted;
        filled += result.filled ?? 0;
        patch(table, { nextChunk: i + 1, inserted, filled });
      }
      await publishMeta(table, records);
      patch(table, { status: "done", nextChunk: totalChunks });
    } catch (err) {
      patch(table, { status: "error", error: errorMessage(err) });
    }
  }

  async function publishMeta(table: ImportTable, records: ImportRecord[]) {
    if (table === "universities") {
      await postMeta("universities_index", records.map((r) => ({ code: String(r.code), name: String(r.name) })));
    } else if (table === "admission_scores") {
      await postMeta("score_facets", {
        provinces: distinctValues(records, "province"),
        years: distinctValues(records, "year"),
        categories: distinctValues(records, "category"),
        batches: distinctValues(records, "batch"),
      });
    } else if (table === "enrollment_plans") {
      await postMeta("plan_facets", {
        provinces: distinctValues(records, "province"),
        years: distinctValues(records, "year"),
        batches: distinctValues(records, "batch"),
      });
    }
    // majors 没有筛选面元数据：意向方向的派生缓存在服务端按行数版本自动重建。
  }

  if (loading) return <p className="py-16 text-center text-sm text-muted-foreground">正在检查登录状态…</p>;
  if (!user) {
    return (
      <Alert><AlertDescription>
        数据导入需要管理员登录。请先<Link to="/login" className="mx-1 text-primary underline">登录</Link>。
      </AlertDescription></Alert>
    );
  }
  if (user.role !== "admin") {
    return (
      <Alert><AlertDescription>
        当前账号（{user.display_name || user.username}）不是管理员。数据导入权限由站点所有者授予。
      </AlertDescription></Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Upload className="size-6 text-primary" aria-hidden /> 官方数据导入
        </h1>
        <p className="text-sm text-muted-foreground">
          上传按模板整理并通过 <code>node db/import/validate.mjs</code> 校验的 CSV。
          请按 ①→②→③ 顺序导入（录取表引用院校清单）。同一文件重复导入不会产生重复数据；
          重导入院校清单可为已有院校补全空白的基础信息列（不覆盖已有值）。
        </p>
      </div>

      {TABLES.map(({ key, label, file }) => {
        const s = states[key];
        return (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="text-base">{label} <span className="text-sm font-normal text-muted-foreground">（{file}）</span></CardTitle>
              <CardDescription>
                {s.fileName
                  ? `${s.fileName} · 共 ${s.totalChunks} 块 · 已写入 ${s.inserted} 行${s.filled > 0 ? ` · 补全基础信息 ${s.filled} 行` : ""}`
                  : "尚未选择文件"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Label htmlFor={`file-${key}`} className="sr-only">选择 {file}</Label>
                <input
                  id={`file-${key}`} type="file" accept=".csv,text/csv"
                  className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-foreground hover:file:bg-accent/80"
                  disabled={s.status === "uploading"}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(key, f); }}
                />
                {s.status === "error" && parsed.current[key] && (
                  <Button size="sm" variant="outline" onClick={() => upload(key, states[key].nextChunk)}>
                    从第 {states[key].nextChunk + 1} 块续传
                  </Button>
                )}
                {s.status === "done" && <span className="text-sm font-medium text-green-700">已完成</span>}
                {s.status === "uploading" && <span className="text-sm text-muted-foreground">导入中…（请勿关闭页面）</span>}
              </div>
              {s.status === "uploading" && s.totalChunks > 0 && (
                <div className="h-2 w-full overflow-hidden rounded-full bg-accent">
                  <div className="edu-gradient h-full transition-all" style={{ width: `${(s.nextChunk / s.totalChunks) * 100}%` }} />
                </div>
              )}
              {s.error && <Alert variant="destructive"><AlertDescription>{s.error}</AlertDescription></Alert>}
            </CardContent>
          </Card>
        );
      })}

      <p className="text-xs text-muted-foreground">
        导入完成后，院校索引与筛选选项会自动更新，前台「高校查询」即可检索。数据真实性以官方来源为准。
      </p>

      <ResourceModeration />
    </div>
  );
}

// 阶段5 内容管理：管理员下架任意资料（软删除，存储文件同步清理）。
function ResourceModeration() {
  const [items, setItems] = useState<Resource[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      // 接口单页上限 100；服务端最多返回最近 500 份，逐页取全。
      const first = await listResources({ limit: 100, offset: 0 });
      let items = first.items;
      for (let offset = 100; offset < Math.min(first.total, 500); offset += 100) {
        const page = await listResources({ limit: 100, offset });
        items = items.concat(page.items);
      }
      if (!cancelled) { setItems(items); setTotal(first.total); }
    })().catch((err) => { if (!cancelled) setError(errorMessage(err)); });
    return () => { cancelled = true; };
  }, [version]);

  async function takedown(id: string) {
    setBusyId(id);
    try {
      await deleteResource(id);
      setArmedId(null);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(errorMessage(err));
      setArmedId(null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">资料管理</CardTitle>
        <CardDescription>
          对用户上传内容进行必要管理：下架违规或版权不明的资料。下架后前台不再展示、不可下载，上传的文件会被清理（软删除保留记录）。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {items === null && !error && <p className="text-sm text-muted-foreground">正在加载资料列表…</p>}
        {items !== null && items.length === 0 && <p className="text-sm text-muted-foreground">当前没有已登记的资料。</p>}
        {items !== null && items.length > 0 && (
          <>
            <p className="text-sm text-muted-foreground">共 {total} 份资料{total > 500 ? "（仅显示最近 500 份）" : ""}</p>
            <ul className="flex flex-col divide-y rounded-xl border">
              {items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link to={`/resources?id=${item.id}`} className="font-medium text-primary hover:underline">{item.title}</Link>
                    <p className="text-xs text-muted-foreground">
                      {item.grade ?? "年级未标"} · {item.subject ?? "学科未标"} · {item.type}
                      {" · 来源："}{item.source_name}
                      {item.has_file ? " · 含上传文件" : ""}
                      {" · "}{new Date(item.created_at).toLocaleDateString("zh-CN")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={armedId === item.id ? "destructive" : "outline"}
                    disabled={busyId !== null}
                    onClick={() => (armedId === item.id ? void takedown(item.id) : setArmedId(item.id))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {busyId === item.id ? "下架中…" : armedId === item.id ? "确认下架？" : "下架"}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}