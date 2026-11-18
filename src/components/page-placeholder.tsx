import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function PagePlaceholder({
  icon: Icon,
  title,
  description,
  features,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  features: string[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="edu-gradient flex size-11 items-center justify-center rounded-xl text-white">
          <Icon className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Card>
        <CardContent className="flex flex-col items-start gap-3 p-6">
          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
            功能开发中
          </Badge>
          <p className="text-sm text-muted-foreground">本模块将提供：</p>
          <ul className="grid gap-1.5 text-sm md:grid-cols-2">
            {features.map((feature) => (
              <li key={feature} className="flex gap-2">
                <span className="text-primary" aria-hidden>·</span>
                {feature}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}