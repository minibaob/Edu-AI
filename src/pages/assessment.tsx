import { Compass } from "lucide-react";
import { PagePlaceholder } from "@/src/components/page-placeholder";

export default function AssessmentPage() {
  return (
    <PagePlaceholder
      icon={Compass}
      title="兴趣测评与职业探索"
      description="固定规则计分的兴趣探索，不调用任何 AI 模型"
      features={[
        "约 30 道兴趣问题，逐题作答",
        "明确的固定评分规则",
        "兴趣倾向结果与专业 / 职业方向展示",
        "支持重新测评",
        "仅供兴趣探索参考，不是心理诊断",
      ]}
    />
  );
}