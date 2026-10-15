# HappyPaper MVP 规格（冻结版）

版本：v1.0｜状态：待确认后进入实施

## 1. MVP 定义

> 公开论文 + 桌面端 PDF 阅读 + 按页面和文本选区发布评论 + 后来读者按阅读位置看到历史评论。

该定义同时是验收口径：任何不在下表"范围内"的功能，MVP 阶段不实现。

## 2. 范围边界

### 2.1 范围内

| 模块 | MVP 内容 |
| --- | --- |
| 论文 | arXiv ID / DOI 导入元数据；PDF 上传；列表 + 关键词搜索；标签；详情页 |
| 阅读 | PDF.js 在线阅读；翻页与缩放；阅读进度保存；最近阅读 |
| 定位 | 页码 + 页内归一化坐标 + 文本引用（quote/offset）；段落 ID 字段预留 |
| 评论 | 就地发布；三种展示形态；点赞、回复、举报、删除自己的 |
| 筛选 | 全部 / 高赞 / 疑问 / 解释 / 方法 / 结果；排序：时间、热度 |
| 实时 | SSE 推送同页新评论；论文在线阅读人数 |
| 用户 | 匿名阅读；登录后发布；用户主页；我的评论 / 收藏 / 阅读记录；声望 |
| 管理 | 举报队列、删除内容、禁言、敏感词过滤 |
| 合规 | 侵权投诉入口与下架流程 |

### 2.2 范围外（推迟）

| 项 | 推迟理由 |
| --- | --- |
| 用户关注、领域社区、专家认证 | 社区阶段功能，MVP 无网络效应可验证 |
| AI 总结与自动分类 | 依赖评论量，冷启动阶段无收益 |
| 论文引用关系图 | 与"定位评论"核心假设无关 |
| Elasticsearch / 独立搜索服务 | `pg_trgm` 足够支撑万级论文 |
| Redis | 单实例部署下限流与在线状态用 Postgres 与进程内 Map 即可 |
| S3 对象存储 | 单机磁盘 + 存储接口抽象，迁移成本可控 |
| 独立 NestJS / FastAPI 后端 | 前后端同仓同进程，减少一次部署与一次序列化 |
| 移动端 | 已确认先做 PC |

## 3. 位置定位模型

系统的核心资产是定位数据。锚点分层存储，按可靠性从高到低回退。

### 3.1 锚点分层

| 层 | 字段 | 稳定性 | 用途 |
| --- | --- | --- | --- |
| L1 | `page` + `y_norm`（0–1） | 高 | 主定位，渲染差异下仍能定位 |
| L2 | `quote` + `char_start` + `char_end` + `quote_prefix/suffix` | 中 | 精确到句子；跨字号、跨缩放恢复 |
| L3 | `block_id` | 低（MVP 不启用） | 段落级聚合，待文本层稳定后开启 |

### 3.2 存储格式

```json
{
  "page": 4,
  "y_norm": 0.42,
  "x_norm": 0.18,
  "quote": "We observed a significant improvement...",
  "quote_prefix": "On the third trial,",
  "quote_suffix": "compared with the baseline.",
  "char_start": 1840,
  "char_end": 1883,
  "block_id": null,
  "anchor_version": 1
}
```

`anchor_version` 用于将来更换定位算法时做数据迁移分区。

### 3.3 定位恢复算法

评论渲染时按顺序尝试，命中即停：

1. 取当页文本层字符串 `T`（按文本项顺序拼接，项间补空格）。
2. 归一化 `T` 与 `quote`：Unicode NFKC、折叠空白、去行末连字符。用 `quote_prefix` / `quote_suffix` 在多个匹配中消歧。
3. 命中 → 由字符区间反查 DOM 文本项，读取其 `getBoundingClientRect()`，重算 `y_norm`。
4. 未命中 → 回退 `y_norm` 定位。
5. `y_norm` 缺失 → 锚定页面顶部，并标记 `anchor_degraded`。

### 3.4 选区到偏移的采集

阅读器给每个文本项 span 加 `data-item-index`。选中后：

1. 由 `Range.startContainer` 向上找最近的 `[data-item-index]`，得到起始项序号与项内偏移。
2. `char_start` = 前序所有文本项长度之和（含分隔空格）+ 项内偏移。
3. `char_end` 同理取 `Range.endContainer`。
4. `y_norm = (选区顶端 - 页面容器顶端) / 页面容器高度`。

扫描版 PDF 无文本层时，仅保留 L1 锚点，界面提示该论文不支持句子级定位。

## 4. 数据模型

单表 `comments` 承载评论与回复（`parent_id` 自引用），不设独立 `Reply` 表。理由：回复与评论共享定位、状态、点赞与举报逻辑，分表会产生两套几乎相同的读写路径。

```sql
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  name          text unique not null,
  avatar_url    text,
  password_hash text not null,
  role          text not null default 'user',      -- user | admin
  reputation    int  not null default 0,
  muted_until   timestamptz,
  created_at    timestamptz not null default now()
);

create table papers (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,                      -- arxiv | doi | upload
  external_id  text,                               -- arxiv id 或 doi
  title        text not null,
  abstract     text,
  authors      jsonb not null default '[]',
  year         int,
  venue        text,
  tags         text[] not null default '{}',
  pdf_path     text,                               -- 本机存储相对路径
  pdf_url      text,                               -- 外部合法来源
  license      text,
  visibility   text not null default 'public',     -- public | private
  uploaded_by  uuid references users(id) on delete set null,
  has_text_layer boolean not null default true,
  created_at   timestamptz not null default now()
);
create index on papers using gin (title gin_trgm_ops);
create index on papers using gin (tags);

create table comments (
  id            bigserial primary key,
  paper_id      uuid not null references papers(id) on delete cascade,
  user_id       uuid references users(id) on delete set null,  -- null 表示匿名
  parent_id     bigint references comments(id) on delete cascade,
  content       text not null,
  kind          text not null default 'other',     -- question|explain|method|result|other
  page          int  not null,
  y_norm        real not null,
  x_norm        real,
  quote         text,
  quote_prefix  text,
  quote_suffix  text,
  char_start    int,
  char_end      int,
  block_id      text,
  anchor_version smallint not null default 1,
  anchor_degraded boolean not null default false,
  status        text not null default 'visible',   -- visible|hidden|deleted
  like_count    int  not null default 0,
  reply_count   int  not null default 0,
  created_at    timestamptz not null default now()
);
create index on comments (paper_id, page, y_norm);
create index on comments (paper_id, created_at desc);
create index on comments (parent_id);

create table comment_likes (
  user_id    uuid not null references users(id) on delete cascade,
  comment_id bigint not null references comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);

create table reports (
  id          bigserial primary key,
  comment_id  bigint not null references comments(id) on delete cascade,
  reporter_id uuid not null references users(id) on delete cascade,
  reason      text not null,                       -- spam|abuse|offtopic|copyright|other
  detail      text,
  status      text not null default 'open',        -- open|resolved|rejected
  handled_by  uuid references users(id) on delete set null,
  handled_at  timestamptz,
  created_at  timestamptz not null default now()
);
create unique index on reports (comment_id, reporter_id);

create table reading_progress (
  user_id    uuid not null references users(id) on delete cascade,
  paper_id   uuid not null references papers(id) on delete cascade,
  page       int  not null default 1,
  y_norm     real not null default 0,
  progress   real not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, paper_id)
);

create table favorites (
  user_id    uuid not null references users(id) on delete cascade,
  paper_id   uuid not null references papers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, paper_id)
);

create table banned_words (
  word text primary key
);
```

`CommentLike` 与 `Reply` 的独立表设计在 MVP 中合并，减少两张表与两条聚合更新路径。

## 5. 接口面

REST，全部位于 `/api`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/papers?q=&tag=&sort=&cursor=` | 搜索与列表 |
| POST | `/api/papers` | 按 arXiv ID / DOI 导入 |
| POST | `/api/papers/:id/pdf` | 上传 PDF |
| GET | `/api/papers/:id` | 详情 |
| GET | `/api/papers/:id/comments?page=&sort=&kind=` | 定位评论查询 |
| POST | `/api/comments` | 发布（带锚点） |
| DELETE | `/api/comments/:id` | 删除自己的 |
| POST/DELETE | `/api/comments/:id/like` | 点赞 / 取消 |
| POST | `/api/comments/:id/report` | 举报 |
| GET/PUT | `/api/papers/:id/progress` | 阅读进度 |
| POST/DELETE | `/api/papers/:id/favorite` | 收藏 |
| GET | `/api/papers/:id/stream` | SSE：新评论 + 在线人数 |
| GET | `/api/me/{comments,favorites,reading}` | 我的 |
| GET/PATCH | `/api/admin/reports[/:id]` | 举报处理 |
| PATCH | `/api/admin/comments/:id` | 隐藏 / 恢复 |
| POST | `/api/admin/users/:id/mute` | 禁言 |

SSE 事件类型：`comment:new`、`comment:update`、`presence`。

## 6. 页面结构

| 路由 | 内容 |
| --- | --- |
| `/` | 搜索框、热门论文、最新讨论 |
| `/papers` | 列表 + 筛选 + 标签 |
| `/papers/[id]` | 标题、作者、摘要、标签、开始阅读 / 收藏 |
| `/read/[id]` | 阅读器（见下） |
| `/u/[name]` | 用户主页：声望、评论、收藏 |
| `/me` | 我的评论 / 收藏 / 阅读记录 |
| `/admin` | 举报队列、内容、用户 |
| `/login`、`/register` | 认证 |

阅读器布局：

```
┌──────────────────────────────────────────────┬────────────────┐
│ 页码 · 弹幕开关 · 密度 · 筛选 · 排序 · 在线人数 │                │
├──────────────────────────────────────────────┤   评论侧栏      │
│                                              │  按 y_norm 排序 │
│   PDF 页面 + 弹幕浮层 + 位置标记               │  当前页 ±1 页   │
│                                              │                │
├──────────────────────────────────────────────┤                │
│  发布框：类型 · 显示方式(立即/按位置) · 发送    │                │
└──────────────────────────────────────────────┴────────────────┘
```

三种展示形态同时存在：

1. **弹幕浮层**：新评论或进入页面时在当前页顶部飘过，约 6 秒消失。
2. **位置标记**：页面右缘按 `y_norm` 排列小圆点，悬停展开该位置评论。
3. **评论侧栏**：当前页 ±1 页的全部评论，按位置排列。

## 7. 技术栈

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 前端 | Next.js 16.4 App Router + React 19 + TypeScript 7 | 前后端同仓，路由与 API 一体 |
| 样式 | Tailwind CSS v4 + `globals.css` 中的少量语义类 | 阅读器需大量自定义布局 |
| PDF | `pdfjs-dist` 自封装（不引入 `react-pdf`） | 需要直接控制文本层 DOM 以采集字符偏移 |
| 数据库 | PGlite（Postgres 16 编译为 WASM，进程内、文件持久化）+ Drizzle ORM | 目标机器没有 Docker 与 Postgres 服务，PGlite 保留 Postgres 语义与 Drizzle 方言 |
| 认证 | Auth.js v5（Credentials，JWT 会话） | 会话现成，避免自建 JWT |
| 实时 | SSE（`ReadableStream`） | 单向推送足够，无需 WebSocket |
| 限流 | Postgres 计数查询 | 单实例，省掉 Redis |
| 存储 | 本机 `./storage/pdfs`，经 `StorageAdapter` 接口访问 | 迁移 S3 时只换实现 |
| 本地环境 | 无外部依赖，`npm run dev` | 不需要 Docker 与数据库服务 |

### 7.1 实现偏差记录

实施 M0 时环境与工具链有三处约束，处理方式如下。

| 原计划 | 实际 | 原因 |
| --- | --- | --- |
| Docker Compose + PostgreSQL 16 | PGlite 单进程 Postgres | 目标机器没有 Docker、没有 Postgres 服务、没有 WSL，无法启动数据库服务 |
| `drizzle-kit generate` 生成迁移 | 手写 `drizzle/0000_init.sql`，由 `scripts/db-migrate.mjs` 应用 | drizzle-kit 与 tsx 都依赖 esbuild，esbuild 以管道 stdio 启动子进程服务，DSH 文件沙箱以 EPERM 拒绝该 spawn |
| Next.js 15 | Next.js 16.4 | npm 解析到当前主版本；`serverExternalPackages` 在沙箱下会创建 `.next/dev/node_modules` 链接并被拒绝 unlink，因此该配置已移除 |

`apps/web` 的领域逻辑集中在 `src/lib`，route handler 只做 HTTP 映射。切换到真实的 Postgres 服务只需要改 `src/db/index.ts` 的驱动与 `drizzle/*.sql` 的应用方式，schema 与查询不变。

PGlite 带来三条开发约束，已写进 README：数据目录放在仓库之外（Next 开发服务器监视项目树，Postgres 每次查询都写文件，放在项目内会形成重编译死循环）；应用迁移前必须停掉开发服务器（数据目录同一时刻只允许一个进程打开）；被强杀后它可能在下次启动时直接 abort，此时用 `npm run db:reset` 重建。三条只在本地开发成立，换成真实 Postgres 后消失。

另外两处 Next.js 16 的行为在实施中才暴露，也已记入 README：开发服务器会拒绝非 `allowedDevOrigins` 来源的 `/_next/*` 资源，页面因此渲染但不 hydrate；阅读器只存在于浏览器，用 `next/dynamic` 的 `ssr: false` 加载，避免 pdf.js 的 WASM 引导在服务端执行。

### 7.2 实施进度

| 里程碑 | 状态 | 验证方式 |
| --- | --- | --- |
| M0 脚手架、schema、认证 | 完成 | `verify:smoke` 登录与注册项 |
| M1 论文导入、上传、列表、详情 | 完成 | `verify:smoke` 导入与列表项 |
| M2 PDF 阅读器、进度、最近阅读 | 完成 | `verify:reader` 渲染与翻页/缩放项 |
| M3 锚点采集与恢复、发布、侧栏、位置标记 | 完成 | `verify:anchor` 12 项 + `verify:reader` 刷新与缩放后 0.0px 偏差 |
| M4 弹幕浮层、筛选、点赞、回复、举报、SSE | 完成 | `verify:smoke` 互动项与 SSE 推送项 |
| M5 管理后台、投诉入口、在线人数 | 完成 | `verify:smoke` 举报处理、隐藏恢复、禁言、下架项 |

实施期间修正的三个缺陷，都留在验证脚本里作为回归用例：`findQuote` 的前后文消歧因归一化裁剪首尾空格而永远失配，导致重复句子选中错误的一处；React StrictMode 下销毁第一个 PDF 加载任务会连带拆掉共享的 PDFWorker，使阅读器在开发模式永远停在加载态；位置标记的 `-translate-y-1/2` 使标记中心而非上边缘对齐锚点。

## 8. 论文来源与版权策略

1. 元数据全部来自公开接口：arXiv API、Crossref / OpenAlex。
2. PDF 分三类处理：
   - arXiv：合法可获取，下载后本机缓存；
   - 其他公开来源：只存 `pdf_url`，不镜像；
   - 用户上传：默认 `visibility = private`，仅上传者可见；转为公开需勾选权利声明，并记录声明时间与 IP。
3. 上线前置条件：`/legal/takedown` 投诉入口、管理员下架按钮、处理时限记录字段。
4. 不抓取出版商付费墙内的 PDF。

## 9. 里程碑

| 编号 | 内容 | 预估 |
| --- | --- | --- |
| M0 | 仓库脚手架、Docker Compose、Drizzle schema 与迁移、认证 | 0.5 人日 |
| M1 | 论文导入（arXiv/DOI）、上传、列表搜索、详情页 | 1 人日 |
| M2 | PDF 阅读器、翻页缩放、进度保存、最近阅读 | 1.5 人日 |
| M3 | 锚点采集与恢复、发布评论、侧栏、位置标记 | 2 人日 |
| M4 | 弹幕浮层、筛选排序、点赞、回复、举报、SSE | 1.5 人日 |
| M5 | 管理后台、限流、敏感词、在线人数、投诉入口 | 1 人日 |

合计约 8.5 人日。M0–M3 结束时可验证核心假设，即"后来读者能否在正确位置看到历史评论"。

## 10. 验收标准

1. 用 arXiv ID 导入一篇论文，10 秒内在详情页看到标题、作者、摘要。
2. 打开阅读器，翻到第 4 页，选中一句话，发布评论，刷新页面后评论仍锚定在同一句话。
3. 浏览器窗口从 1440px 缩放到 1100px，该评论仍锚定同一句话（验证 L2 锚点恢复）。
4. 换一个账号打开同一页，在侧栏与浮层中看到上一条评论。
5. 点赞、回复、举报各执行一次，数据库状态正确。
6. 同一账号 60 秒内发布第 6 条评论被拒绝，返回明确提示。
7. 管理员在后台处理一条举报并隐藏该评论，普通用户侧栏不再显示。
8. 关闭浏览器再打开，阅读器恢复到上次页码。

## 11. 已知风险

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| PDF 无文本层 | 句子级定位不可用 | 降级为页面级，界面标注 |
| arXiv PDF 版式差异 | `y_norm` 偏移 | L2 文本匹配优先 |
| 用户上传侵权 PDF | 法律风险 | 默认私有 + 投诉入口 + 下架流程 |
| 冷启动无评论 | 浮层空转 | 侧栏空状态引导首批评论 |
