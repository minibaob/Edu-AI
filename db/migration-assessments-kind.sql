-- 模块6扩展：assessments 表增加测评类型列（霍兰德 riasec / MBTI 简化版 mbti）。
-- 平台受限 DDL 要求新增列必须可空且无默认值；Function 每次写入都显式提供 kind。
-- 已有行全部为霍兰德结果，迁移后由所有者数据工具一次性回填为 'riasec'（2026-11-18 已执行，1 行）。
ALTER TABLE app.assessments ADD COLUMN kind text;