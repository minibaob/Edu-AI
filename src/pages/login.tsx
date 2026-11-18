import { LogIn } from "lucide-react";
import { PagePlaceholder } from "@/src/components/page-placeholder";

export default function LoginPage() {
  return (
    <PagePlaceholder
      icon={LogIn}
      title="登录 / 注册"
      description="学生账号系统"
      features={[
        "用户名 + 密码注册与登录",
        "退出登录与登录状态保持",
        "按需填写年级、学科、省份",
        "最小化收集个人信息，不强制邮箱和手机号",
      ]}
    />
  );
}