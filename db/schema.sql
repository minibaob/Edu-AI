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

-- 模块6：测评结果（霍兰德 RIASEC 与 MBTI 简化版共用）。answers/scores 为 jsonb，形状由 Function 校验；
-- kind 区分测评类型（riasec / mbti），Function 每次写入都显式提供；
-- 每次提交一行（重新测评不覆盖历史），latest 按 kind + created_at 倒序取第一行。
-- 注：云端 kind 列为可空（平台受限 DDL 不允许新增列带默认值），旧行已回填 riasec。
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

-- 模块5：高校与录取数据。全部来自官方公开渠道整理导入，Function 只读查询；
-- 写入仅管理员导入路由（应用会话 role=admin），浏览器不直接写数据库。
-- 缺失字段一律可空，网站显示「暂无数据」。最低分用 text 保存官方原值
-- （艺术/体育类综合分带小数），展示与排序在前端按数值解析。
CREATE TABLE app.universities (
  code text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  province text,
  city text,
  type text,
  level text,
  tags text,
  website text,
  source text NOT NULL,
  note text
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
  note text
);
CREATE INDEX enrollment_plans_school_idx ON app.enrollment_plans (school_name, province, year);

-- 导入完成后写入的展示元数据：院校索引、筛选选项、行数（管理员导入路由维护）。
CREATE TABLE app.data_meta (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);