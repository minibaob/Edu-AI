-- 阶段5 内容管理：resources 软删除标记。
-- 平台受限 DDL：新增列必须可空、不带默认值；存量行保持 NULL（未删除）。
ALTER TABLE app.resources ADD COLUMN deleted_at timestamptz;