import { useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import references from "@/src/lib/hebei-score-references.json";

export default function HebeiScoreReference({ category }: { category: string }) {
  const [year, setYear] = useState(references.years[0].year);
  const selected = references.years.find((item) => item.year === year)!;
  const column = category === "物理类" ? "物理" : category === "历史类" ? "历史" : null;

  return (
    <section aria-labelledby="hebei-reference-title" id="hebei-score-reference">
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-5 shrink-0 text-primary" aria-hidden />
            <h2 id="hebei-reference-title" className="text-lg">河北历年一分一段参考</h2>
          </CardTitle>
          <CardDescription>2024–2026 年普通类物理、历史科目组合成绩统计表（{references.scoreBasis}），仅供查阅参考。</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor="hebei-reference-year">参考年份</Label>
            <select id="hebei-reference-year" value={year} onChange={(event) => setYear(Number(event.target.value))}
              className="h-9 rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
              {references.years.map((item) => <option key={item.year} value={item.year}>{item.year} 年</option>)}
            </select>
            <span className="text-xs text-muted-foreground">选择参考年份不会改变模拟填报条件和结果。</span>
          </div>
          <div className="space-y-2" aria-live="polite">
            <h3 className="text-sm font-semibold">{selected.year}年河北省普通高校招生物理科目组合、历史科目组合考生成绩统计表</h3>
            <p className="text-xs text-muted-foreground">来源：{references.source} · 发布日期：{selected.publishedAt} · 链接核验：{references.verifiedAt}</p>
            <p className="text-sm">
              {column ? `当前选择${category}，请阅读原表的「${column}（含优惠分）」列。` : "同一份原表并列展示物理、历史两科数据，请阅读与你科类对应的列。"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={selected.pdfUrl} target="_blank" rel="noopener noreferrer" aria-label={`打开${year}年河北一分一段官方原表（新标签页）`}>
                打开官方原表 <ExternalLink className="size-4" aria-hidden />
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`查看${year}年河北考试院发布原文（新标签页）`}>查看官方发布原文</a>
            </Button>
            {selected.reportUrl && (
              <Button asChild variant="link">
                <a href={selected.reportUrl} target="_blank" rel="noopener noreferrer">河北广播电视台报道</a>
              </Button>
            )}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            官方文件为扫描 PDF，暂不提供站内按分数检索。考试院不允许第三方网页内嵌，原表将在新标签页打开；如原表暂时无法打开，可从官方发布原文进入附件。本站不复制转载扫描件。
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>「人数」是对应分数档人数，「累计人数」包括该档及更高分档；同分考生不能仅凭累计人数确定个人精确位次。</li>
            <li>高分端的「及以上」是合并档，不可当作单一分数；表中空白不补零、不估算。</li>
            <li>不同年份、科类及省份不可混用，也不能把普通类表直接用于艺术、体育综合分。</li>
            <li>本表仅作参考，不自动回填你的位次、不补充高校缺失位次，也不参与冲／稳／保分档；仅供参考，不保证录取。</li>
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
