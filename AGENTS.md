# EduAI 智学未来 · 项目开发指令

任何 AI 助手（Qoder Agent 等）和开发者在本仓库工作时，必须遵守本文件。

## 一、项目定位

- 项目名称：EduAI / 智学未来
- 英文副标题：AI-Powered Learning & Growth Platform
- 口号：让学习更智能，让成长有方向。
- 服务对象：高一至高三学生。提供学习资源、升学信息查询、兴趣探索和个人成长管理，帮助学生发现潜力、降低教育信息差。
- 开发团队：大学生开发者。不要把开发团队和平台用户混淆；网站文案面向高中生用户。

## 二、当前阶段限制（第一阶段：无 AI 版本）

本阶段不开发任何 AI 功能。禁止：

1. 接入 Qwen API 或其他模型 API；
2. 开发 AI 聊天界面；
3. 开发 AI 多智能体；
4. 开发 AI 自动生成试题和解析；
5. 开发 AI 志愿推荐；
6. 开发 AI 自动资料识别；
7. 开发 AI 自动分析学生数据；
8. 添加需要付费的 AI 服务依赖。

不要为未来 AI 功能提前编写复杂代码。未来 AI 功能属于第二阶段，不得影响首版进度。学生社区也不属于首版范围，不得开发。

## 三、首版页面

1. 首页 / 学习仪表盘；
2. 学习资料库；
3. 高校与录取数据查询；
4. 兴趣测评与职业探索；
5. 登录注册与个人中心。

## 四、核心功能要求

### 用户系统
注册、登录、退出、登录状态保持、基础个人资料管理、学生角色权限；年级/学科/省份等资料按需填写（全部选填，最小化收集个人信息，不强制邮箱和手机号）。

### 首页
欢迎区域、学习概览、今日任务、快捷入口、个性化推荐、学习成长提示。允许演示数据，但必须带明显的「演示数据」标签，与真实数据严格区分。

### 学习资料库
年级分类、学科分类、关键词搜索、资料详情、文件上传、文件下载、收藏、资料来源标注。上传必须限制文件类型和大小、校验登录权限、要求版权承诺；不得未经授权公开版权资料。

### 高校与录取数据
首批试点：河北省、河南省。实现高校查询、高校详情、专业信息、历年录取数据、分数和位次展示、招生计划展示、省份/年份/选科筛选、数据来源标注。

**不得编造任何高校或录取数据。** 没有数据的字段一律显示「暂无数据」。真实数据由开发者从各省教育考试院等官方渠道整理后导入。不开发 AI 志愿推荐，只做数据查询和普通条件筛选。

### 兴趣测评与职业探索
测评介绍、兴趣问题、学生答题、固定评分规则、兴趣倾向结果、专业方向展示、职业方向展示、重新测评。所有结果用明确的规则计算（霍兰德 RIASEC 简化版），不调用 AI 模型。测评只用于兴趣探索，不是心理诊断，不能绝对决定学生未来职业，页面必须有此声明。

### 个人中心
个人资料、年级设置、学科设置、省份设置、基础账号设置。

## 五、视觉设计

现代 SaaS 教育平台风格：蓝白色基底、蓝紫渐变、简洁现代、专业温暖积极、统一组件、电脑优先、手机浏览器兼容、中文为主。设计变量见 `src/globals.css` 的 `--site-*` 与 `--edu-*` 定义，新样式必须复用这些变量和 `components/ui/` 现有组件。

## 六、技术架构（已确定，不要更换）

- 前端：React 19 + Vite + Tailwind 4 + shadcn 组件（`components/ui/`），静态构建输出 `dist/`。
- 路由：自研轻量哈希路由 `src/lib/router.tsx`（`#/resources` 等），不引入额外路由依赖。
- 后端：Qoder Sites 单个 `app` Edge Function（`functions/index.ts`，Deno 运行时），业务路由在 `functions/router.mjs`，前端通过同源 `/functions/v1/app/api/...` 调用。
- 数据库：平台托管 PostgreSQL，Function 内通过注入的 `_qoder/backend.mjs` 适配器访问；表结构脚本在 `db/`，通过平台审核迁移流程应用，浏览器永远不直接访问数据库。
- 认证：应用自持用户名/密码（PBKDF2 派生、数据库会话摘要、`__Host-` Cookie、固定来源 CSRF 校验、数据库限流）。不使用平台身份，不做身份回退。
- 文件存储：平台 Storage，Function 内签名上传/下载，服务端校验实际存储的字节数与 MIME 类型。
- 本地测试：`node --test dev/check.mjs`（凭据无关假数据库，`dev/fake-db.mjs` 只用于测试，绝不打进 Function 包）。

### 常用命令

```bash
npm ci                    # 安装依赖（Node 22.13+ 或 24+）
npm run dev               # 本地开发 http://127.0.0.1:5173
npm run build             # 类型检查 + 静态构建
node --test dev/check.mjs # 后端契约测试
```

## 七、开发原则

1. 修改代码前阅读现有项目。
2. 每次只开发一个明确模块。
3. 复杂任务先输出实施计划。
4. 未经确认不得进行大范围修改。
5. 不得擅自删除现有功能。
6. 每次修改后运行测试（`npm run build` 和 `node --test dev/check.mjs`）。
7. 说明修改了哪些文件。
8. 说明如何运行和测试。
9. 遇到错误先分析原因。
10. 不得虚构测试结果。

## 八、安全要求

- 不得把密钥提交到 GitHub；`.env` 已被 gitignore，站点配置值只进平台 Sites 设置。
- 不得暴露数据库管理密钥；数据库凭据由平台注入 Function，不进源码。
- 文件上传必须限制类型和大小；资料访问必须做权限校验（归属只来自已验证会话，绝不信任浏览器提交的 owner_id）。
- 不得未经授权公开版权资料；不使用真实学生隐私作为演示数据。
- 遵循最小化收集个人信息原则。
- 会话令牌明文不落库、不记录日志；口令只存 PBKDF2 派生结果。

## 九、协作流程

- `main` 分支保持稳定，不直接推送；每个模块开 `feature/<name>` 分支，完成后发 Pull Request，合并前通过构建和测试。
- 分工按目录/模块划分减少冲突：前端页面在 `src/pages/`，后端路由在 `functions/`，数据脚本在 `db/`。
- **网站发布统一由仓库所有者（minibaob）在其 Qoder 账号下操作**；其他开发者只做本地开发和测试，不初始化站点、不发布。
- Qoder Sites 站点描述文件（`*.qoder.site`）已被 gitignore，不要提交。
- 直连 GitHub 不通时可用本地代理推送：`git -c http.proxy=socks5://127.0.0.1:10808 push`（端口按各自代理调整）。

## 十、当前进度

- [x] 模块1：项目骨架 + 设计系统 + 路由 + 首页仪表盘（演示数据带标签）
- [x] 模块2：用户系统（后端注册/登录/退出/会话/资料/改密 + 前端登录注册页/个人中心/导航栏登录状态；契约测试 13 项通过；真实浏览器登录流程待部署后验证）
- [x] 模块3：首页接入真实数据（/api/stats 公开读：资料/收藏/测评按真实行计数，院校总数用导入元数据精确计数；适配器无 count 能力，计数触顶 500 时如实返回 capped、前端显示「500+」，不把截断值当总数；今日任务存本机 localStorage；演示区域保留「演示数据」标签。移植自并行分支并适配线上基线）
- [x] 模块4：学习资料库（来源链接型登记：标题/类型/https 来源链接/来源名称/版权承诺必填，年级学科选填；搜索/年级/学科/类型筛选/分页/我登记的/我的收藏；收藏软删除 revoked_at、复合主键防重、再收藏清除撤销标记；归属只来自会话；文件直传未开放，任何 file_* 字段拒绝 file_upload_unavailable；resources/favorites 两表迁移已应用。移植自并行分支）
- [ ] 模块5：高校与录取数据查询 + 官方数据导入工具（**河南部分已完成，河北待官方数据**：用户提供河南省阳光高考信息平台官方《河南.xlsx》，经 dev/convert-henan.mjs 原样转换为模板 CSV——院校 2400 所、2025 录取 11005 条、2024–2026 招生计划 183493 条，未编造/修改任何数据；艺术体育类综合分保留小数（min_score 为 text），缺失字段一律「暂无数据」。新增 universities/admission_scores/enrollment_plans/data_meta 四表（迁移已应用）；录取用国标代码、计划用河南报考代码，两表按**学校名称**关联；后端 functions/universities.mjs + import-validate.mjs：匿名查询 /api/universities 与 /api/universities/:code?year=，管理员导入 /api/admin/import（500 行/块、2MB 上限、内容哈希 run_id + 确定性主键幂等、数组写入失败逐行回退）与 /api/admin/meta（索引/筛选面/计数）；前端高校查询列表（搜索/分页/计数）+ 详情（年份/科类/批次筛选、计划年份切换、来源标注）+ 管理员数据导入页（①院校②录取③计划顺序、断点续传）。契约测试共 27 项通过；本地浏览器实测 19.7 万行真实数据灌入、列表/详情/筛选/管理员登录/浏览器上传幂等全部通过。**线上数据已导入**：所有者账号 romeoee 经浏览器在 #/admin/import 上传三个 CSV（2400/11005/183493），henan-import 管理员账号 CLI 全量重跑验证幂等（全部块 inserted=0），精确计数核对一致；临时口令文件已删除）
- [x] 模块6：兴趣测评与职业探索（霍兰德 RIASEC 简化版，30 题固定规则计分，不调用 AI；后端 functions/assessment.mjs 单一计分源 + 登录门槛 + 会话归属 + 重测保留历史；前端介绍/答题/结果/重测四态，含免责声明；契约测试 16 项通过；本地浏览器实测注册→答题→结果→重测→刷新持久化全部通过；assessments 表迁移已应用，已随新版本发布。**扩展：MBTI 风格性格倾向测评简化版**——自研 28 题二选一、四维 E/I·S/N·T/F·J/P 每维 7 票计票、16 型固定文案，非官方 MBTI 且页面标注；后端 functions/mbti.mjs 单一计分源，/api/mbti/questions|submit|latest 沿用登录门槛与会话归属；assessments 表加可空 kind 列区分 riasec/mbti（平台受限 DDL 不允许新增列带默认值，旧行已回填 riasec）；前端测评页双入口，两种测评独立保存互不干扰；契约测试共 19 项通过；本地浏览器实测 MBTI 全选A→ESTJ、重测全选B→INFP、刷新持久化、霍兰德 ACI 不受影响、未登录引导全部通过；kind 列迁移已应用，已随新版本发布）
- [x] 模块7：个人中心完善（资料保存/修改密码/账号信息/我的收藏列表/我的测评记录：霍兰德与 MBTI 按时间倒序共存、MBTI 显示四字母类型与票数、霍兰德显示维度中文名与分数；接口未上线时如实显示「尚未上线」不编造。移植自并行分支并适配双测评）
- [x] 模块8：云端分配、测试、部署上线（站点 https://eduai-o1pbxkl2opq.qoder.zone ，selected 访问；数据库/函数/存储已就绪，users/sessions/auth_limiter/assessments/universities/admission_scores/enrollment_plans/data_meta/resources/favorites 十表已应用，assessments 含 kind 列区分霍兰德/MBTI；各版本发布记录见运行时验收表。注意：站点地址在设置中改过，functions/http.mjs 的 PUBLIC_ORIGIN 必须与当前地址一致，否则写请求被 CSRF 校验拒绝）

### 运行时验收表（2026-11-18，目标：含模块6 MBTI 扩展的发布版本）

| 层 | 检查 | 状态 | 证据 / 阻塞 |
| --- | --- | --- | --- |
| 本地 | 构建 + 19 项契约测试（认证 13 + 霍兰德 3 + MBTI 3） | passed | `node --test dev/check.mjs` 全部通过 |
| 本地浏览器 | 霍兰德与 MBTI 全流程（双入口/答题/结果/重测/刷新持久化/互不干扰/未登录引导） | passed | 本地 fixture（dev/server-local.mjs + 假数据库）实测；MBTI 全选A→ESTJ、全选B→INFP，霍兰德 ACI，均与固定规则复核一致 |
| 控制面 | kind 列迁移应用、旧行回填、发布提交 | passed | 迁移操作 succeeded；旧测评行已回填 riasec（affected_rows=1）；发布操作 succeeded/committed，published=true |
| 线上浏览器 | 注册/登录/测评真实流程 | pending | 站点 selected 访问，需所有者在已登录 Qoder 的浏览器中验证（平台登录与应用登录是两步）；匿名探测返回 401 sites_gateway_login_required 属预期 |
| 隔离 | A/B 账号隔离、未授权访问 | passed（本地）/ pending（线上） | 契约测试覆盖归属与隔离；线上验证待浏览器准入后进行 |

注：私有网关拦截匿名请求（401 sites_gateway_login_required）属预期行为；改为公开访问需所有者单独授权。

### 运行时验收表（2026-11-19，目标：模块5 河南部分的发布版本）

| 层 | 检查 | 状态 | 证据 / 阻塞 |
| --- | --- | --- | --- |
| 数据转换 | 官方 河南.xlsx → 模板 CSV（不编造/不修改） | passed | dev/convert-henan.mjs；validate.mjs 0 错误；艺术/体育综合分小数保留；计划同键多行（办学地点不同）保留并警告 |
| 本地 | 构建 + 27 项契约测试（认证 13 + 霍兰德 3 + MBTI 3 + 模块5 8） | passed | `npm run build`、`node --test dev/check.mjs` 全部通过 |
| 本地浏览器 | 19.7 万行真实数据经真实导入路由灌入；列表 2400 所/80 页/计数；清华详情 700/108、687/12、暂无数据、计划按名称关联+年份切换；科类筛选；管理员登录→数据导入页；浏览器上传 universities.csv 5 块幂等（写入 0 行） | passed | dev/server-local.mjs + EDUAI_SEED_DIR 实测 |
| 控制面 | universities/admission_scores/enrollment_plans/data_meta 迁移应用 | passed | clientMigrationId module5-henan-tables-v1，操作 succeeded |
| 线上 | 发布含模块5 的版本 | passed | 发布操作 succeeded/committed，published=true（actionId 7c9e1f3a-5b2d-4a8e-9c1f-2e3d4a5b6c7d） |
| 线上数据 | 所有者导入三个 CSV 后线上查询验证 | passed | romeoee 浏览器上传完成；henan-import CLI 重跑幂等（inserted=0）；精确计数 2400/11005/183493 与索引 2400 核对一致 |

注：应用内预览面板的 fetch 不携带平台登录态，网关返回 401 sites_gateway_login_required（网关层拦截不进函数日志），属预期；线上验收必须在已登录 Qoder 的浏览器中进行。前端已对该错误码显示明确引导文案。

### 运行时验收表（2026-11-19，目标：并行分支合并移植版 = 线上基线 + 模块3/4/7）

背景：main 曾被并行会话合入另一套实现（majors 表、assessment_results 表、整数 min_score、计划表唯一键、500 行截断查询），与线上已验证的模块5/6  schema 冲突。经所有者选择「以线上版本为基线合并」：保留线上模块5/6 与全部数据不动，把并行分支的模块3/4/7 移植到基线分支 feature/phase1-reconcile，并以 `git merge -s ours main` 保留双方历史、内容以基线为准。移植适配点：stats 院校总数改用导入元数据精确计数、计数触顶如实 capped；修复并行版 stats 对 favorites 误选不存在的 id 列（复合主键）；测评历史改读 assessments 表并兼容 riasec/mbti 双 kind；不引入 majors/assessment_results/admission_url 等冲突设计。

| 层 | 检查 | 状态 | 证据 / 阻塞 |
| --- | --- | --- | --- |
| 本地 | 构建 + 34 项契约测试（认证 13 + 霍兰德 3 + MBTI 3 + 模块5 8 + 模块4 4 + 模块7 1 + 模块3 2） | passed | `npm run build`、`node --test dev/check.mjs` 全部通过 |
| 本地浏览器 | 注册→登记资料（版权承诺/来源链接）→列表/详情/收藏→我的收藏→双测评提交→个人中心记录与资料保存→刷新持久化→首页真实统计与演示标签 | passed | dev/server-local.mjs + 假数据库实测；统计 1 份/1 收藏/2 测评，院校无元数据时如实「暂无数据」 |
| 控制面 | resources/favorites 迁移应用 | passed | clientMigrationId module4-resources-favorites-v1，操作 succeeded；策略 function_backend 与现有表一致 |
| 线上 | 发布移植版 | pending | 待发布操作与回执 |
| 线上浏览器 | 移植功能真实流程抽查 | pending | selected 访问需所有者已登录 Qoder 的浏览器 |

注：资料文件直传仍未开放（平台 Storage 适配器未接通），登记接口对 file_* 字段明确拒绝；多省增量导入的元数据服务端合并更新仍为已知限制（当前元数据按整文件覆盖），待所有者确认后另行开发。