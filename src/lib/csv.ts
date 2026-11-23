// 模块5 导入页用的 CSV 解析与列映射（与 db/import/validate.mjs 的解析规则一致）。
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

export type ImportTable = "universities" | "majors" | "admission_scores" | "enrollment_plans";

export const CSV_COLUMNS: Record<ImportTable, Record<string, string>> = {
  universities: {
    院校代码: "code", 学校名称: "name", 所在省份: "province", 所在城市: "city",
    办学类型: "type", 办学层次: "level", 标签: "tags", 招生网址: "website",
    数据来源: "source", 备注: "note",
  },
  majors: {
    专业代码: "code", 专业名称: "name", 学科门类: "category", 学制: "years",
    授予学位: "degree", 数据来源: "source", 备注: "note",
  },
  admission_scores: {
    院校代码: "university_code", 省份: "province", 年份: "year", 科类: "category",
    批次: "batch", 选科要求: "subject_requirement", 最低分: "min_score",
    最低位次: "min_rank", 录取人数: "admitted_count", 数据来源: "source",
    备注: "note", 学校名称: "school_name",
  },
  enrollment_plans: {
    院校代码: "university_code", 省份: "province", 年份: "year", 专业代码: "major_code",
    专业名称: "major_name", 批次: "batch", 选科要求: "subject_requirement",
    计划数: "plan_count", 学费: "tuition", 数据来源: "source", 备注: "note",
    学校名称: "school_name",
  },
};

const INT_COLUMNS = new Set(["year", "years", "min_rank", "admitted_count", "plan_count", "tuition"]);

export type ImportRecord = Record<string, string | number | null>;

// 表头按名称映射到数据库列；空值转 null，整数列转 number，最低分保留字符串原值。
export function toRecords(table: ImportTable, grid: string[][]): ImportRecord[] {
  const header = grid[0].map((h) => h.trim());
  const mapping = CSV_COLUMNS[table];
  const indexes = header.map((h) => mapping[h] ?? null);
  if (indexes.some((col, i) => col === null && header[i] !== "")) {
    throw new Error(`存在无法识别的列：${header.filter((h) => !mapping[h]).join("、")}`);
  }
  const records: ImportRecord[] = [];
  for (let r = 1; r < grid.length; r += 1) {
    const record: ImportRecord = {};
    let nonEmpty = false;
    indexes.forEach((col, i) => {
      if (!col) return;
      const raw = (grid[r][i] ?? "").trim();
      if (raw === "") { record[col] = null; return; }
      nonEmpty = true;
      record[col] = INT_COLUMNS.has(col) && /^\d+$/.test(raw) ? Number(raw) : raw;
    });
    if (nonEmpty) records.push(record);
  }
  return records;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}