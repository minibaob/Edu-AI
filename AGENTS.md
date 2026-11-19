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
- [x] 模块3：首页接入真实数据（统计数字来自 GET /api/stats 真实计数，空数据如实显示「暂无数据」；今日任务保存在本机浏览器，可添加/删除；个性化推荐仍为演示内容，保留「演示数据」标签；契约测试 14 项通过）
- [x] 模块4：学习资料库（浏览/搜索/筛选/详情/收藏/登记来源链接型资料 + 文件直传直下。文件流：POST /api/resources/upload-url 签发（路径由会话 userId 哈希派生、扩展名白名单定 MIME、10MB 上限）→ 浏览器 PUT 签名 URL → POST /api/resources 带 storage_key 时服务端回读对象实测字节数/MIME 校验通过才落库（失败清理对象、不落库）；GET /api/resources/:id/file 登录后可取 300 秒签名下载 URL。前端登记卡双模式（链接/文件，文档与图片两个可见选择器）、详情页下载附件、列表附件标识；登记后列表自动刷新。resources/favorites 表已应用；契约测试共 41 项通过；本地浏览器实测上传→下载字节一致、类型/大小/空文件拒绝、归属隔离、未登录 401 全部通过。**已随 2026-11-19 河北数据版本统一发布（actionId e5f6a7b8-c9d0-4e1f-9a2b-3c4d5e6f7a8b）；线上文件上传/下载的真实浏览器验收待所有者进行**）
- [x] 模块5：高校与录取数据查询 + 官方数据导入工具（后端公开读接口 /api/universities、/api/universities/:code、/api/majors，前端列表/详情/专业目录，空字段显示「暂无数据」；导入工具 db/import/to-sql.mjs；契约测试 17 项通过。新表 universities/majors/admission_scores/enrollment_plans 待平台审核迁移后应用，真实数据待官方渠道整理导入；上线前真实浏览器验证待做。**河南部分已完成，河北待官方数据**：用户提供河南省阳光高考信息平台官方《河南.xlsx》，经 dev/convert-henan.mjs 原样转换为模板 CSV——院校 2400 所、2025 录取 11005 条、2024–2026 招生计划 183493 条，未编造/修改任何数据；艺术体育类综合分保留小数（min_score 为 text），缺失字段一律「暂无数据」。新增 universities/admission_scores/enrollment_plans/data_meta 四表（迁移已应用）；录取用国标代码、计划用河南报考代码，两表按**学校名称**关联；后端 functions/universities.mjs + import-validate.mjs：匿名查询 /api/universities 与 /api/universities/:code?year=，管理员导入 /api/admin/import（500 行/块、2MB 上限、内容哈希 run_id + 确定性主键幂等、数组写入失败逐行回退）与 /api/admin/meta（索引/筛选面/计数）；前端高校查询列表（搜索/分页/计数）+ 详情（年份/科类/批次筛选、计划年份切换、来源标注）+ 管理员数据导入页（①院校②录取③计划顺序、断点续传）。契约测试共 27 项通过；本地浏览器实测 19.7 万行真实数据灌入、列表/详情/筛选/管理员登录/浏览器上传幂等全部通过。**河南+河北均已上线**：河北官方《河北.xlsx》经 dev/convert-hebei.mjs 原样转换（新登记院校 227、录取 16749、计划 27175；计划表缺学校名称列，用录取交叉表 + 来源引文提取补齐并交叉验证 0 冲突；跨省按校名去重避免重复院校行；validate.mjs 支持传入已有院校登记表做跨批引用校验）；后端元数据改为服务端合并（universities_index 按 code 并集、筛选面逐字段并集、counts 按实际插入行数累加，幂等复跑不重复累加，管理员可显式修复 counts）；前端列表/详情增加省份列与省份筛选、切换院校时重置筛选。线上经真实导入路由完成河北导入（并行会话已预导入同字节 CSV，本次幂等复跑 inserted 0），counts 修复为 {universities:2627, admission_scores:27754, enrollment_plans:210668}；清华 2026 详情录取 10 条/计划 83 条与本地 fixture 一致。契约测试共 43 项通过。）
- [x] 模块6：兴趣测评（24 道 5 级量表，固定 RIASEC 规则评分，不调用 AI；登录后保存到账号，未登录保存本机；契约测试 16 项通过。新表 assessment_results 待平台审核迁移后应用；题目与专业映射为今晚拟定，需用户确认后用于演示）与职业探索。**扩展：MBTI 风格性格倾向测评简化版**——自研 28 题二选一、四维 E/I·S/N·T/F·J/P 每维 7 票计票、16 型固定文案，非官方 MBTI 且页面标注；后端 functions/mbti.mjs 单一计分源，/api/mbti/questions|submit|latest 沿用登录门槛与会话归属；assessments 表加可空 kind 列区分 riasec/mbti（平台受限 DDL 不允许新增列带默认值，旧行已回填 riasec）；前端测评页双入口，两种测评独立保存互不干扰；契约测试共 19 项通过；本地浏览器实测 MBTI 全选A→ESTJ、重测全选B→INFP、刷新持久化、霍兰德 ACI 不受影响、未登录引导全部通过；kind 列迁移已应用，已随新版本发布。**合并注意（2026-11-19）：霍兰德 24 题 5 级量表版（用户 2026-11-19 上午逐题审过并要求 4 处逻辑修正）与河南分支的 30 题三档版并存，用户在测评页三入口中任选；30 题版后端为 functions/assessment30.mjs（路由 /api/assessment/*），结果写入 assessments 表（kind='riasec'）；MBTI 扩展完整保留。**
- [x] 模块7：个人中心（表单初始值改用 useEffect 同步，不再渲染期间 setState；新增「我的收藏」「我的测评记录」两区，接口 404 时如实显示「尚未上线」；契约测试 13 项通过）。2026-11-19 回归修复：测评历史改读 assessments 表双 kind（MBTI 显示类型码与「票」、霍兰德显示维度与「分」）；首页统计修复收藏复合主键读取（favorites 无 id 列）、院校总数取 counts 元数据（未导入为 null）、计数触顶如实加「+」；本地浏览器实测双 kind 历史与登录后计数正确。
- [x] 模块8：云端分配、测试、部署上线（站点 https://eduai-o1pbxkl2opq.qoder.zone ，selected 访问；数据库/函数/存储已就绪，线上共 12 表：users/sessions/auth_limiter/assessments/universities/admission_scores/enrollment_plans/data_meta/majors/resources/favorites/assessment_results，assessments 含 kind 列区分霍兰德/MBTI。2026-11-19 统一发布 actionId e5f6a7b8-c9d0-4e1f-9a2b-3c4d5e6f7a8b（publishOperationId 01a1f37a-e2b0-7de6-bd8b-b5a779a51d1e，succeeded/committed）：含模块4 文件直传、河北数据与多省元数据合并、模块3/7 回归修复。河北命令行导入期间经所有者授权临时公开访问，导入完成后已恢复 selected（targets 与原策略一致为空）。注意：站点地址在设置中改过，functions/http.mjs 的 PUBLIC_ORIGIN 必须与当前地址一致，否则写请求被 CSRF 校验拒绝。）

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
| 线上数据 | 所有者导入三个 CSV 后线上查询验证 | pending | 线上数据库为空；selected 访问需所有者浏览器登录；导入顺序 ①院校②录取③计划 |

注：应用内预览面板的 fetch 不携带平台登录态，网关返回 401 sites_gateway_login_required（网关层拦截不进函数日志），属预期；线上验收必须在已登录 Qoder 的浏览器中进行。前端已对该错误码显示明确引导文案。

### 运行时验收表（2026-11-19 晚，目标：河北数据 + 多省元数据合并 + 模块3/7 回归修复 + 模块4 文件直传统一发布）

| 层 | 检查 | 状态 | 证据 / 阻塞 |
| --- | --- | --- | --- |
| 数据转换 | 官方 河北.xlsx → 模板 CSV（不编造/不修改；校名补齐交叉验证 0 冲突） | passed | dev/convert-hebei.mjs；validate.mjs 传河南登记表后 0 错误 |
| 本地 | 构建 + 43 项契约测试（含多省元数据合并、双 kind 历史、stats 真实计数与 capped） | passed | `npm run build`、`node --test dev/check.mjs` 43/43 |
| 本地浏览器 | 两省 fixture：首页 2627 所/登录后收藏与测评计数；个人中心 MBTI「ESTJ·票」与霍兰德「R/I/A·分」并存 | passed | dev/server-local.mjs（EDUAI_SEED_DIR 两省）+ 浏览器 DOM 实测 |
| 线上导入 | 河北三表经真实导入路由幂等完成；counts 修复 {2627,27754,210668}；清华 2026 录取 10/计划 83 与本地一致 | passed | 临时公开期间命令行导入（所有者授权），IMPORT COMPLETE + VERIFY 行 |
| 控制面 | 统一发布 succeeded/committed；selected 访问恢复（与原策略一致） | passed | actionId e5f6a7b8-c9d0-4e1f-9a2b-3c4d5e6f7a8b；get_publish_status published=true |
| 线上浏览器 | 所有者登录后的查询/上传/测评真实流程 | pending | selected 访问需所有者在已登录 Qoder 的浏览器验证；临时导入凭据文件已删除 |