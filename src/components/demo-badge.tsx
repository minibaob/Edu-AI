import { Badge } from "@/components/ui/badge";

export function DemoBadge({ label = "演示数据" }: { label?: string }) {
  return (
    <Badge
      variant="outline"
      className="border-amber-300 bg-amber-50 text-amber-700"
      title="此内容为界面演示样例，不是您的真实数据"
    >
      {label}
    </Badge>
  );
}