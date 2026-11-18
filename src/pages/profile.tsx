import { User } from "lucide-react";
import { PagePlaceholder } from "@/src/components/page-placeholder";

export default function ProfilePage() {
  return (
    <PagePlaceholder
      icon={User}
      title="个人中心"
      description="管理个人资料与学习设置"
      features={[
        "个人资料管理",
        "年级 / 学科 / 省份设置（按需填写）",
        "基础账号设置",
        "我的收藏与测评记录",
      ]}
    />
  );
}