# EduAI 智学未来

面向高一至高三学生的学习平台：学习资源库、高校与录取数据查询、兴趣测评、个人成长管理。帮助学生发现潜力、降低教育信息差。

- 线上站点：https://eduai-o1pbxkl2opq.qoder.zone（selected 访问）
- 口号：让学习更智能，让成长有方向。
- 开发团队：大学生开发者。网站文案面向高中生用户，不要把开发团队和平台用户混淆。

## 第一阶段边界（重要）

第一阶段是**无 AI 版本**，禁止：

- 接入 Qwen API 或其他模型 API；
- AI 聊天、多智能体、AI 生成试题与解析、AI 志愿推荐、AI 资料识别、AI 分析学生数据；
- 添加需要付费的 AI 服务依赖。

学生社区也不属于首版范围，不得开发。完整规则见 [AGENTS.md](./AGENTS.md)，开发前必读。

## 功能

| 模块 | 内容 | 状态 |
| --- | --- | --- |
| 1 骨架与首页 | 设计系统、哈希路由、学习仪表盘 | 已上线 |
| 2 账号 | 注册/登录/退出、PBKDF2 口令、会话、CSRF、限流 | 已上线 |
| 3 首页真实数据 | 统计来自后端真实计数，任务保存在本机浏览器 | 功能分支 `feature/module3-home` |
| 4 学习资料库 | 浏览/搜索/筛选、详情、收藏、登记来源链接型资料 | 功能分支 `feature/module4-resources` |
| 5 高校与录取数据 | 查询、筛选、详情、官方数据导入工具 | 功能分支 `feature/module5-universities` |
| 6 兴趣测评 | 24 道霍兰德 RIASEC 简化量表，固定规则计分，不调用 AI | 功能分支 `feature/module6-assessment` |
| 7 个人中心 | 资料与密码管理、我的收藏、我的测评记录 | 功能分支 `feature/module7-profile` |
| 8 部署 | Qoder Sites 部署（仅由仓库所有者在自己的 Qoder 账号操作） | 已上线 |

功能分支按 `模块 5 → 4 → 6 → 3 → 7` 的顺序合并（共享文件 `functions/router.mjs`、`functions/validate.mjs`、`src/lib/api.ts`、`dev/check.mjs`、`db/schema.sql`、`AGENTS.md` 需要按顺序解决冲突）。各分支的新数据库表（resources、favorites、universities、majors、admission_scores、enrollment_plans、assessment_results）需在平台审核迁移后才生效；迁移前相关接口返回空数据，前端如实显示「暂无数据」。

## 数据诚实规则

- **绝不编造分数、分数线、排名和录取数据。** 没有真实数据时显示「暂无数据」，不填充示例数字。
- 高校数据只接受官方来源（各省教育考试院、高校本科招生网、阳光高考），经 `db/import/` 的离线校验工具转换后入库；导入模板与填写说明见 `db/import/模板填写说明.md`。
- 兴趣测评只是兴趣探索，**不是心理诊断**，不能决定学生未来职业；计分规则固定写在 `functions/assessment.mjs`，前后端同一份规则，契约测试校验一致性。
- 只保存用户名和用户自愿填写的资料，不收集邮箱和手机号。

## 技术栈

- 前端：React 19 + Vite + Tailwind 4 + shadcn，哈希路由
- 后端：Qoder Sites Edge Function（Deno），`functions/` 目录
- 数据库：平台托管 PostgreSQL，表结构见 `db/schema.sql`

## 本地开发

需要 Node `^22.13.0 || >=24.0.0`：

```sh
npm ci
npm run dev
```

生产构建与契约检查：

```sh
npm run build
node --test dev/check.mjs
```

`dev/check.mjs` 直接调用真实的 `functions/` 模块，只把数据层替换为凭据无关的假数据库；它不证明真实 Provider、网关准入或部署环境行为。

Function 本地检查需要 Deno：

```sh
npm run check:function
npm run dev:function
```

若本机没有 Deno，`npm run check:function` / `npm run dev:function` 无法运行——如实记录，不要谎称已检查。前端仍可正常构建和运行。

## 目录

```
src/            前端页面与组件（src/pages、src/lib、src/components）
functions/      Edge Function：路由、校验、会话、限流、测评计分
db/             数据库表结构（db/schema.sql）与官方数据导入工具（db/import/）
dev/            本地契约检查（dev/check.mjs）与假数据库（dev/fake-db.mjs）
阶段0.txt–阶段11.txt   各阶段开发计划
AGENTS.md       项目开发指令（必读）
```

## 部署

部署与发布只由仓库所有者在自己的 Qoder 账号里操作，不在代码或文档中写任何部署凭据。站点地址变更后，须同步更新 `functions/http.mjs` 的 `PUBLIC_ORIGIN`，否则写请求会被 CSRF 校验拒绝。
