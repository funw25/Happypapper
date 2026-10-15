-- 论文元数据与 PDF 状态分离（docs/03-requirements.md 1.1 节、第 28 行）
--
-- 行存在即表示元数据已找到。pdf_url 记录已知的开放获取地址，pdf_path 记录本站
-- 已缓存的副本；pdf_fetch_error 记录最近一次抓取失败的原因码，详情页据此提供
-- 重试入口与可理解的说明，而不是把「没有 PDF」伪装成导入失败。
alter table "papers" add column if not exists "pdf_fetch_error" text;
alter table "papers" add column if not exists "pdf_checked_at" timestamp with time zone;
