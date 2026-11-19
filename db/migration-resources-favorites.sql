-- 模块4：学习资料库（来源链接型登记 + 收藏软删除）。
-- 文件直传待平台 Storage 适配器在 Function 内接通后开启；在此之前 file_* 列保持 NULL，
-- 登记接口拒绝任何 file_* 字段（file_upload_unavailable），绝不把元数据写成“已上传”。
-- 收藏用 revoked_at 软删除（取消收藏即标记撤销），不物理删除；复合主键防重复收藏。
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