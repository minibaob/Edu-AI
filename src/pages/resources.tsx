import { BookOpen } from "lucide-react";
import { PagePlaceholder } from "@/src/components/page-placeholder";

export default function ResourcesPage() {
  return (
    <PagePlaceholder
      icon={BookOpen}
      title="学习资料库"
      description="按年级、学科查找和分享学习资料"
      features={[
        "年级 / 学科分类浏览",
        "关键词搜索与资料详情",
        "文件上传（类型与大小限制、版权承诺）",
        "文件下载与收藏",
        "资料来源标注",
      ]}
    />
  );
}