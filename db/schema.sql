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

CREATE TABLE app.universities (
  code text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  province text NOT NULL,
  city text,
  type text NOT NULL,
  level text NOT NULL,
  tags text,
  admission_url text,
  source text NOT NULL,
  note text,
  created_at timestamptz NOT NULL
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

CREATE TABLE app.admission_scores (
  id uuid PRIMARY KEY,
  university_code text NOT NULL REFERENCES app.universities (code),
  province text NOT NULL,
  year integer NOT NULL,
  category text NOT NULL,
  batch text NOT NULL,
  subject_requirement text,
  min_score integer,
  min_rank integer,
  admitted_count integer,
  source text NOT NULL,
  note text,
  created_at timestamptz NOT NULL,
  UNIQUE (university_code, province, year, category, batch)
);

CREATE TABLE app.enrollment_plans (
  id uuid PRIMARY KEY,
  university_code text NOT NULL REFERENCES app.universities (code),
  province text NOT NULL,
  year integer NOT NULL,
  major_code text REFERENCES app.majors (code),
  major_name text NOT NULL,
  batch text,
  subject_requirement text,
  plan_count integer,
  tuition integer,
  source text NOT NULL,
  note text,
  created_at timestamptz NOT NULL,
  UNIQUE (university_code, province, year, major_name, batch)
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

-- EduAI 模块6：兴趣测评记录（霍兰德 RIASEC 简化版，规则评分，不调用 AI）。
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