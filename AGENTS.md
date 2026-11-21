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
- [x] 模块3：首页接入真实数据（统计数字来自 GET /api/stats 真实计数，空数据如实显示「暂无数据」；今日任务保存在本机浏览器，可添加/删除；**个性化推荐已接入真实数据（2026-11-19 开发，PR #5 于 2026-11-20 合并，已随 main 37708b5 发布上线）**：新增公开接口 GET /api/recommendations（functions/recommendations.mjs），纯规则匹配不调用 AI——资料推荐按登录用户年级/选科匹配真实资料行（无匹配按最新收录），高校推荐取用户省份有真实录取数据的院校（admission_scores 行；官方数据未含院校所在省份，不编造）；前端推荐区移除「演示数据」标签与 DEMO_RECOMMENDATIONS，卡片可跳转资料/高校详情，空库/加载失败如实显示；新增 2 项契约测试，共 47 项通过；本地浏览器实测匿名最新收录、登录个性化匹配与高校卡、双跳转、退出回落匿名全部通过）
- [x] 模块4：学习资料库（浏览/搜索/筛选/详情/收藏/登记来源链接型资料 + 文件直传直下。文件流：POST /api/resources/upload-url 签发（路径由会话 userId 哈希派生、扩展名白名单定 MIME、10MB 上限）→ 浏览器 PUT 签名 URL → POST /api/resources 带 storage_key 时服务端回读对象实测字节数/MIME 校验通过才落库（失败清理对象、不落库）；GET /api/resources/:id/file 登录后可取 300 秒签名下载 URL。前端登记卡双模式（链接/文件，文档与图片两个可见选择器）、详情页下载附件、列表附件标识；登记后列表自动刷新。resources/favorites 表已应用；契约测试共 41 项通过；本地浏览器实测上传→下载字节一致、类型/大小/空文件拒绝、归属隔离、未登录 401 全部通过。**已随 2026-11-19 河北数据版本统一发布（actionId e5f6a7b8-c9d0-4e1f-9a2b-3c4d5e6f7a8b）；线上文件上传/下载的真实浏览器验收待所有者进行**）
- [x] 模块5：高校与录取数据查询 + 官方数据导入工具（后端公开读接口 /api/universities、/api/universities/:code、/api/majors，前端列表/详情/专业目录，空字段显示「暂无数据」；导入工具 db/import/to-sql.mjs；契约测试 17 项通过。新表 universities/majors/admission_scores/enrollment_plans 待平台审核迁移后应用，真实数据待官方渠道整理导入；上线前真实浏览器验证待做。**河南部分已完成，河北待官方数据**：用户提供河南省阳光高考信息平台官方《河南.xlsx》，经 dev/convert-henan.mjs 原样转换为模板 CSV——院校 2400 所、2025 录取 11005 条、2024–2026 招生计划 183493 条，未编造/修改任何数据；艺术体育类综合分保留小数（min_score 为 text），缺失字段一律「暂无数据」。新增 universities/admission_scores/enrollment_plans/data_meta 四表（迁移已应用）；录取用国标代码、计划用河南报考代码，两表按**学校名称**关联；后端 functions/universities.mjs + import-validate.mjs：匿名查询 /api/universities 与 /api/universities/:code?year=，管理员导入 /api/admin/import（500 行/块、2MB 上限、内容哈希 run_id + 确定性主键幂等、数组写入失败逐行回退）与 /api/admin/meta（索引/筛选面/计数）；前端高校查询列表（搜索/分页/计数）+ 详情（年份/科类/批次筛选、计划年份切换、来源标注）+ 管理员数据导入页（①院校②录取③计划顺序、断点续传）。契约测试共 27 项通过；本地浏览器实测 19.7 万行真实数据灌入、列表/详情/筛选/管理员登录/浏览器上传幂等全部通过。**河南+河北均已上线**：河北官方《河北.xlsx》经 dev/convert-hebei.mjs 原样转换（新登记院校 227、录取 16749、计划 27175；计划表缺学校名称列，用录取交叉表 + 来源引文提取补齐并交叉验证 0 冲突；跨省按校名去重避免重复院校行；validate.mjs 支持传入已有院校登记表做跨批引用校验）；后端元数据改为服务端合并（universities_index 按 code 并集、筛选面逐字段并集、counts 按实际插入行数累加，幂等复跑不重复累加，管理员可显式修复 counts）；前端列表/详情增加省份列与省份筛选、切换院校时重置筛选。线上经真实导入路由完成河北导入（并行会话已预导入同字节 CSV，本次幂等复跑 inserted 0），counts 修复为 {universities:2627, admission_scores:27754, enrollment_plans:210668}；清华 2026 详情录取 10 条/计划 83 条与本地 fixture 一致。契约测试共 43 项通过。）
- [x] 模块6：兴趣测评（24 道 5 级量表，固定 RIASEC 规则评分，不调用 AI；登录后保存到账号，未登录保存本机；契约测试 16 项通过。新表 assessment_results 待平台审核迁移后应用；题目与专业映射为今晚拟定，需用户确认后用于演示）与职业探索。**扩展：MBTI 风格性格倾向测评简化版**——自研 28 题二选一、四维 E/I·S/N·T/F·J/P 每维 7 票计票、16 型固定文案，非官方 MBTI 且页面标注；后端 functions/mbti.mjs 单一计分源，/api/mbti/questions|submit|latest 沿用登录门槛与会话归属；assessments 表加可空 kind 列区分 riasec/mbti（平台受限 DDL 不允许新增列带默认值，旧行已回填 riasec）；前端测评页双入口，两种测评独立保存互不干扰；契约测试共 19 项通过；本地浏览器实测 MBTI 全选A→ESTJ、重测全选B→INFP、刷新持久化、霍兰德 ACI 不受影响、未登录引导全部通过；kind 列迁移已应用，已随新版本发布。**合并注意（2026-11-19）：霍兰德 24 题 5 级量表版（用户 2026-11-19 上午逐题审过并要求 4 处逻辑修正）与河南分支的 30 题三档版并存，用户在测评页三入口中任选；30 题版后端为 functions/assessment30.mjs（路由 /api/assessment/*），结果写入 assessments 表（kind='riasec'）；MBTI 扩展完整保留。**
- [x] 模块7：个人中心（表单初始值改用 useEffect 同步，不再渲染期间 setState；新增「我的收藏」「我的测评记录」两区，接口 404 时如实显示「尚未上线」；契约测试 13 项通过）。2026-11-19 回归修复：测评历史改读 assessments 表双 kind（MBTI 显示类型码与「票」、霍兰德显示维度与「分」）；首页统计修复收藏复合主键读取（favorites 无 id 列）、院校总数取 counts 元数据（未导入为 null）、计数触顶如实加「+」；本地浏览器实测双 kind 历史与登录后计数正确。
- [x] 模块8：云端分配、测试、部署上线（站点 https://eduai-o1pbxkl2opq.qoder.zone ，selected 访问；数据库/函数/存储已就绪，线上共 12 表：users/sessions/auth_limiter/assessments/universities/admission_scores/enrollment_plans/data_meta/majors/resources/favorites/assessment_results，assessments 含 kind 列区分霍兰德/MBTI。2026-11-19 统一发布 actionId e5f6a7b8-c9d0-4e1f-9a2b-3c4d5e6f7a8b（publishOperationId 01a1f37a-e2b0-7de6-bd8b-b5a779a51d1e，succeeded/committed）：含模块4 文件直传、河北数据与多省元数据合并、模块3/7 回归修复。河北命令行导入期间经所有者授权临时公开访问，导入完成后已恢复 selected（targets 与原策略一致为空）。注意：站点地址在设置中改过，functions/http.mjs 的 PUBLIC_ORIGIN 必须与当前地址一致，否则写请求被 CSRF 校验拒绝。）
- [x] 阶段8：个人中心完善与全站权限审计（分支 feature/profile-permissions，基于 main b40e0f0。①测评历史合并两张表：GET /api/assessments 同时读 assessments（30 题霍兰德/MBTI）与 assessment_results（24 题霍兰德），新增 version 字段区分题量，按时间倒序取前 50——修复 24 题版保存提示「可在个人中心查看」但历史不显示的缺口；②首页统计 assessments_count 改为两表求和，与个人中心一致，任一表不可读如实返回 null；③退出登录改两步确认（确认退出/取消）；④账号信息增加未成年人隐私提示（资料仅自己可见、勿填真实姓名/联系方式）；⑤src/lib/assessment.ts 的 listAssessments 按 version=24 过滤防止混入 MBTI/30 题记录。权限审计结论：前端个人中心/测评未登录引导、数据导入页登录+admin 双守卫；后端归属一律来自会话，validateProfile 严格白名单（id/role/user_id/username/password_hash 篡改被忽略），收藏/测评/改密/文件下载全部会话作用域，storage_key 归属复核，CSRF 固定来源，日志只记来源域名、明文令牌与口令不落库。新增 2 项权限矩阵契约测试（匿名 401 矩阵 20 接口、学生 403、三种测评 user_id 篡改无效、改密塞他人 id 无效），更新 3 项旧测试至合并历史新预期；契约测试共 45 项通过。本地浏览器实测：A 账号三种测评记录分标「霍兰德（24 题）/（30 题）/性格倾向 ESTJ」、收藏显示、资料表单保存生效、首页计数=3 与历史一致、退出两步确认（取消保持登录/确认后 401）、B 账号历史与收藏全空且无 A 数据泄露、匿名 401 与登录引导、隐私提示在页。无新表、无迁移、无角色系统改动。**已发布上线（2026-11-19，所有者批准）**：PR #3 合并后 main 4e51557 构建发布，actionId 9c8b7a6d-5e4f-4a3b-8c1d-0e9f8a7b6c5d（publishOperationId 01a1f454-6377-7c29-a3b7-cca108758dbf，succeeded/committed，published=true），站点地址与 selected 访问不变，线上 Function operation_id 与本次发布一致；匿名探测根路径与 API 均返回 401 sites_gateway_login_required（网关拦截属预期）。线上真实浏览器验收（阶段8 历史/退出/隐私 + 此前待验的文件上传下载与两省查询）待所有者在已登录 Qoder 的浏览器进行。）
- [x] 阶段9：全站测试与修复（分支 `feature/phase9-qa`，**PR #4 于 2026-11-20 合并，已随 main 37708b5 发布上线：actionId a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d，publishOperationId 01a1f870-cde9-7a4c-bcda-dd98a9173f4e，succeeded/committed，published=true，地址与 selected 访问不变；同版本含模块3 真实个性化推荐（PR #5）**）：功能测试 18 项、异常测试 10 项、三端页面测试（375/820/1280 iframe 视口实测：6/5/5 页无横向溢出、移动/桌面导航正确切换、详情表格在 overflow-x-auto 容器内滚动、加载/错误/空状态文案齐全）、安全检查 6 项（无硬编码密钥、匿名 401 矩阵、参数化查询无 SQL 拼接、上传白名单+10MB+服务端回读校验、A/B 数据隔离、CSRF/PBKDF2 60万迭代/会话摘要/限流）全部通过。修复 1 个缺陷：资源列表收藏状态刷新后丢失——`functions/router.mjs` 的 listResources 在有效会话下查询收藏集合并逐条填充 `favorited`（匿名/会话无效/收藏表读取失败按未收藏显示，与详情接口策略一致；mine 过滤只对 mine=1 生效，与会话解析分离，避免列表被误过滤）；`dev/check.mjs` 新增 3 项断言（A 列表标注已收藏/B 不标注/匿名不标注），契约测试 45/45、`npm run build` 通过、浏览器复测（收藏→切换视图状态保持→取消收藏计数归零）通过。测试报告见 `阶段9测试报告.md`。如实说明的未测项：线上改密浏览器实测（本地被运行环境权限策略拦截，改密由契约测试覆盖）、三端截图（应用内浏览器表面被隐藏，改用 DOM 结构+几何指标）、线上真实浏览器验收（待所有者在已登录 Qoder 的浏览器进行）；数据观察：郑州大学 2025 河南计划「安全工程（第104组）」学费 700 元/学年，待人工核对官方原表后决定是否处理。

- [x] 模块10：错题本（分支 `feature/wrong-questions`，基于 main 37708b5，**待 PR 合并与发布**）：后端 functions/wrong-questions.mjs 提供错题增删改查、复习计数 +1、公开/不公开切换与统计；归属只认已验证会话的 user_id（浏览器提交 owner_id 无效），错因/状态白名单校验，未登录写操作 401，A/B 归属隔离；新表 wrong_questions（db/schema.sql 同步）+ db/migration-wrong-questions.sql **待平台审核迁移**（平台访问受限未应用，不 drop/recreate 任何表）；前端错题本页（录入/编辑/删除/筛选/复习/公开切换）+ 顶部导航/首页/个人中心入口与统计；不含任何 AI 功能。契约测试 59/59、`npm run build` 通过；本地浏览器实测 17 项（含跨标签页会话变化、提交瞬间换号 409、分页筛选）全部通过。
- [x] 高校省份优先与基础信息补全（2026-11-21，同分支待合并）：高校查询改为省份优先（先选考生省份再选高校；详情换省返回选校为既有验证行为，保留）；两省 universities.csv 并集 2627 所高校基础信息补全——所在省份/城市/层次/标签全量（2 所港澳高校省份按枚举留空并注明），办学类型 2622（5 所公开口径冲突或未公布留空注明），招生网址 2403 全部 curl https 实测可达（含 39 个站点 WAF 412 挑战响应、TLS 校验通过，逐行备注），224 所确不可达或无公开记录留空并逐行备注原因；来源：教育部《全国高等学校名单》（截至 2026-06-17）、DaoSword《高等教育数据宽表 v20230118》、掌上高考院校库 + 新建校定向检索，快照与实测缓存见 db/import/basic-info-sources/（README 含口径）；dev/fill-university-info.mjs 只补空列、可重复运行；管理端重导入 universities 走补空 patch（不覆盖已有非空值）；基础信息全国通用、不随考生省份变化（接口 + UI 双重验证）。离线校验两目录 0 错误（增量批次须传并集参照），契约 59/59，浏览器基础信息专项 14/14 + 省份优先/错题本套件回归全过；**线上需所有者重导入 universities.csv 并发布，未发布**。
- [x] 文案：资料库「登记资料/我登记的」更名「上传资料/我上传的」（2026-11-20 用户要求，同分支待合并）。
- [x] 志愿模拟填报（规则版，2026-11-21，分支 `feature/simulation-rules`，PR #8 于 2026-11-21 合并进 main 4792311，提交 4b0426d）：新增公开只读接口 GET /api/simulation 与 /api/simulation/options（functions/simulation.mjs）+ 前端模拟填报页（src/pages/simulation.tsx）与首页入口；按真实录取数据分档：设 d = 该校最新一年 min_score − 我的 score，冲 0<d≤10、稳 −10≤d≤0、保 d<−10，每档按 |d| 排序、每档 20 条 offset 翻页；只用各省最新一年（河北 2026、河南 2025，从数据推导不写死），不支持省份返回「暂无数据，采集中」；不建新表、只读 admission_scores 与 universities；页面统一称「规则匹配/模拟填报」，不出现「AI 推荐/智能推荐/预测录取率」；位次只作参考、不参与分档；另附河北 2024–2026 一分一段官方原表外链（src/lib/hebei-score-references.json，扫描 PDF 不镜像、不内嵌、不回填位次）。契约测试新增 7 项（PR #8 合并时共 74 项通过）；线上发布与真实浏览器验收待所有者进行。

- [x] 阶段5：资料库补全（2026-11-19，提交 5dcde19，分支 feature/resource-inline-viewer，含此前的在线预览与三角函数 PDF）：①上传状态——文件 PUT 改 XHR 真实进度，登记卡显示签发/上传百分比/服务端校验三阶段；②内容管理（最小范围）——resources 加可空 deleted_at 软删除列（迁移 phase5-resources-deleted-at-v1 已应用），DELETE /api/resources/:id 仅上传者或 admin，列表/详情/下载/收藏/首页统计全链路过滤已删除行并清理存储对象，详情页两步确认删除，管理员页新增资料管理区（逐页取全、两步确认下架）。教材版本无真实数据支持，按规格不显示。契约测试共 45 项通过；本地浏览器实测上传三阶段/所有者删除/管理员下架全流程通过（期间修复管理区 limit=500 超接口单页上限 100 的问题）。已发布 actionId e5f6a7b8-9c0d-4e1f-8a2b-3c4d5e6f7a81（publishOperationId 01a1f452-4585-7cc7-b2e0-3f1317cd476a，succeeded/committed，published=true，selected 访问不变）；线上真实浏览器验收待所有者进行。**2026-11-21 回归修复**：线上被并行会话用阶段9 旧 actionId（a1b2c3d4…）从主树覆盖发布，导致在线预览与三角函数 PDF 丢失（详情页回退为「打开来源」）；已将 feature/resource-inline-viewer 合并进 feature/wrong-questions（merge 提交 251d63a，dev/check.mjs 冲突取两套测试并集，61/61 通过，构建通过），并以新 actionId f5a6b7c8-d9e0-4f1a-9b2c-3d4e5f6a7b8c 重新发布上线（publishOperationId 01a1fc54-eb8c-7b94-826b-ad7f47da4e90，succeeded/committed，published=true，地址与 selected 访问不变）；线上三角函数资料与预览的真实浏览器验收待所有者进行。

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