-- main e2048e46 合并版增量迁移（2026-11-19）。
-- 对照线上库：resources/favorites 已由模块4迁移建好且与 schema.sql 一致，跳过不重建。
-- 只新建缺失的 majors、assessment_results；只补可空列，绝不删表重建。
-- 平台受限 DDL：ADD COLUMN 必须可空且无默认值。
-- 访问策略：function_backend 固定私有策略（accessPolicies: []）。

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

CREATE TABLE app.assessment_results (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id),
  answers text NOT NULL,
  scores text NOT NULL,
  top_types text NOT NULL,
  created_at timestamptz NOT NULL
);

ALTER TABLE app.universities ADD COLUMN admission_url text;
ALTER TABLE app.universities ADD COLUMN created_at timestamptz;
ALTER TABLE app.admission_scores ADD COLUMN created_at timestamptz;
ALTER TABLE app.enrollment_plans ADD COLUMN created_at timestamptz;