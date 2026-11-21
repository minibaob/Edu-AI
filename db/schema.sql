-- EduAI 模块2：自建账号认证（账号 + 会话 + 限流）。
-- 访问策略由平台为 function_backend 生成固定私有策略（accessPolicies: []）。
-- 个人资料字段全部可空：最小化收集，学生按需填写。

CREATE TABLE app.users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  password_iterations integer NOT NULL,
  role text NOT NULL DEFAULT 'student',
  display_name text,
  grade text,
  province text,
  subjects text,
  created_at timestamptz NOT NULL
);

-- 只保存令牌摘要、用户 ID 与时间；明文会话令牌从不落库。
CREATE TABLE app.sessions (
  token_digest text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

-- 固定窗口限流：每键一行，唯一主键用于原子判定（并发安全）。
CREATE TABLE app.auth_limiter (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL
);

-- EduAI 模块5：高校与录取数据（试点：河北、河南）。
-- 字段与 db/import/templates/ 四个 CSV 模板一一对应；所有数据必须来自官方公开渠道，
-- 导入前先用 node db/import/validate.mjs 校验，再用 node db/import/to-sql.mjs 生成入库 SQL。
-- 没有数据的字段一律 NULL，前端对应位置显示「暂无数据」，绝不编造分数、位次或排名。
-- 本文件追加新表，不改动模块2 已有三张表；新表由平台审核迁移流程应用。
--
-- 合并说明（main + feature/module5-henan，2026-11-19）：
-- * universities：两边列的并集（website 来自河南分支，admission_url 来自 main）。
--   官方分数文件往往不含院校属性，province/type/level 按河南分支改为可空。
-- * admission_scores：id 用 text（河南分支的导入 id 是 SHA-256 摘要，main 的 uuid
--   字符串同样能存）；min_score 用 text 保存官方原值（艺术/体育类综合分带小数）；
--   school_name 来自河南分支（计划表按学校名称关联院校时复用）。
-- * enrollment_plans：id 用 text；university_code 与 major_code 不设外键——计划表
--   用省报考代码，与录取表的国标代码不同源，外键会拦住河南真实数据；同专业同批次
--   可能因办学地点不同有多行，不设业务唯一键；school_name 关联院校。
-- * created_at 在三张表上均为可空：河南分支的管理员导入不写该列。

CREATE TABLE app.universities (
  code text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  province text,
  city text,
  type text,
  level text,
  tags text,
  website text,
  admission_url text,
  source text NOT NULL,
  note text,
  created_at timestamptz
);

CREATE TABLE app.majors (
  code text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  category text NOT NULL,
  years integer NOT NULL,
  degree text,
  source text NOT NULL,
  note text,
  created_at timestamptz NOT NULL
);

-- id 为导入 run+chunk+行号 的 SHA-256 摘要：同一文件重复导入幂等。
-- 录取表业务键唯一（官方数据每院校+省份+年份+科类+批次一行）。
CREATE TABLE app.admission_scores (
  id text PRIMARY KEY,
  university_code text NOT NULL REFERENCES app.universities (code),
  school_name text,
  province text NOT NULL,
  year integer NOT NULL,
  category text NOT NULL,
  batch text NOT NULL,
  subject_requirement text,
  min_score text,
  min_rank integer,
  admitted_count integer,
  source text NOT NULL,
  note text,
  created_at timestamptz,
  UNIQUE (university_code, province, year, category, batch)
);
CREATE INDEX admission_scores_university_idx ON app.admission_scores (university_code, province, year);

-- 计划表用省报考代码（与录取表国标代码不同源），按 school_name 关联院校；
-- 同专业同批次可能因办学地点不同有多行，不设业务唯一键。
CREATE TABLE app.enrollment_plans (
  id text PRIMARY KEY,
  university_code text NOT NULL,
  school_name text NOT NULL,
  province text NOT NULL,
  year integer NOT NULL,
  major_code text,
  major_name text NOT NULL,
  batch text,
  subject_requirement text,
  plan_count integer,
  tuition integer,
  source text NOT NULL,
  note text,
  created_at timestamptz
);
CREATE INDEX enrollment_plans_school_idx ON app.enrollment_plans (school_name, province, year);

-- 导入完成后写入的展示元数据：院校索引、筛选选项、行数（管理员导入路由维护）。
CREATE TABLE app.data_meta (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

-- EduAI 模块4：学习资料库。
-- 资源分两种：来源链接型（source_url 指向官方/公开页面，可直接打开）与文件型
-- （file_name/file_size/mime/storage_key，文件本体存平台 Storage）。
-- 文件直传待 Storage 适配器在 Function 内接通后开启（仓库内暂无 Storage 客户端，
-- 见改进建议）；在此之前只接受来源链接型登记，file_* 字段保持 NULL。
-- 收藏用 revoked_at 软删除（取消收藏即标记撤销），不物理删除。

CREATE TABLE app.resources (
  id uuid PRIMARY KEY,
  owner_id uuid REFERENCES app.users (id),
  title text NOT NULL,
  grade text,
  subject text,
  type text NOT NULL,
  source_url text NOT NULL,
  source_name text NOT NULL,
  description text,
  file_name text,
  file_size integer,
  mime text,
  storage_key text,
  copyright_confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

CREATE TABLE app.favorites (
  user_id uuid NOT NULL REFERENCES app.users (id),
  resource_id uuid NOT NULL REFERENCES app.resources (id),
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (user_id, resource_id)
);

-- EduAI 模块6：兴趣测评记录（霍兰德 RIASEC 简化版，24 题 5 级量表，规则评分，不调用 AI）。
-- 答案与得分以 JSON 文本保存；得分由后端按 functions/assessment.mjs 的固定规则
-- 从答案重算，不信任浏览器提交的分数。用户只能查看自己的记录。

CREATE TABLE app.assessment_results (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id),
  answers text NOT NULL,
  scores text NOT NULL,
  top_types text NOT NULL,
  created_at timestamptz NOT NULL
);

-- 模块6扩展：MBTI 风格性格倾向测评（简化版）与霍兰德共用本表，answers/scores 为 jsonb，
-- 形状由 Function 校验；kind 区分测评类型（riasec / mbti），Function 每次写入都显式提供；
-- 每次提交一行（重新测评不覆盖历史），latest 按 kind + created_at 倒序取第一行。
-- 注：云端 kind 列为可空（平台受限 DDL 不允许新增列带默认值），旧行已回填 riasec。
-- 合并说明：本分支的霍兰德走 assessment_results（24 题 5 级量表）；本表目前只由 MBTI
-- 写入（kind='mbti'）。
CREATE TABLE app.assessments (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id),
  kind text,
  answers jsonb NOT NULL,
  scores jsonb NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX assessments_user_created_at_idx ON app.assessments (user_id, created_at);

-- 平台不支持 CHECK，枚举与长度由 Function 白名单校验；新表使用固定私有策略。
CREATE TABLE app.wrong_questions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id),
  subject text NOT NULL,
  grade text,
  chapter text,
  source text NOT NULL,
  question text NOT NULL,
  correct_answer text NOT NULL,
  my_answer text NOT NULL,
  reason text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'todo',
  review_count integer NOT NULL DEFAULT 0,
  last_reviewed_at timestamptz,
  visibility text NOT NULL DEFAULT 'private',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wrong_questions_user_created_idx ON app.wrong_questions (user_id, created_at, id);
CREATE INDEX wrong_questions_user_status_idx ON app.wrong_questions (user_id, status);
CREATE INDEX wrong_questions_visibility_created_idx ON app.wrong_questions (visibility, created_at, id);
