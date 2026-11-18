import { Building2 } from "lucide-react";
import { PagePlaceholder } from "@/src/components/page-placeholder";

export default function UniversitiesPage() {
  return (
    <PagePlaceholder
      icon={Building2}
      title="高校与录取数据查询"
      description="首批试点：河北省、河南省 · 数据以官方公布为准"
      features={[
        "高校查询与高校详情",
        "专业信息与历年录取分数 / 位次",
        "招生计划展示",
        "省份、年份、选科条件筛选",
        "数据来源标注，无数据显示「暂无数据」",
      ]}
    />
  );
}