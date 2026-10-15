# 技术栈方案对比与决策

版本：v1.0｜对应规格：`docs/00-mvp-spec.md`

## 1. 结论

采纳方案 1（Next.js 单体 + 自建 Postgres，自托管长驻进程），并附带三个约束条件，见第 6 节。

方案 2 的真实收益是长驻后台进程与 Python 文本处理生态，这两点可以在需要时用一个追加的 worker 进程拿到，不必从第一天就把 API 拆成两个服务。方案 3 首版最快，代价是把实时、存储、权限三条关键路径交给供应商，且 RLS 与管理后台会形成两套权限模型。

## 2. 评估维度

维度按本产品的实际约束排序，前三项是硬约束。

| 优先级 | 维度 | 与本产品的关系 |
| --- | --- | --- |
| 1 | SSE 长连接能力 | 同页新评论推送与在线阅读人数依赖长连接 |
| 2 | PDF 存储与读取 | 阅读器每次打开都要按 Range 请求 PDF 字节 |
| 3 | 定位数据写入与查询 | 核心资产，写入频率高于普通 CRUD |
| 4 | 后台任务宿主 | arXiv 抓取、PDF 文本层抽取需要长驻或定时进程 |
| 5 | 类型与契约一致性 | 锚点结构跨前后端传递，字段漂移会静默破坏定位 |
| 6 | 迁移与部署成本 | 决定 MVP 之后能否平滑演进 |

定位查询本身在三个方案中都是同一条 SQL（`paper_id + page + y_norm` 范围扫描），不构成区分度。区分度集中在实时通道、文件存储、后台任务、权限模型四处。

## 3. 方案 1：Next.js 单体 + 自建 Postgres

### 形态

Next.js 15 App Router 同时承载页面与 `/api` 路由，Drizzle 直连 Postgres，Auth.js 处理会话，SSE 由 route handler 的 `ReadableStream` 提供，在线状态保存在进程内 `Map`，PDF 存本机磁盘并经 `StorageAdapter` 接口访问。

### 优势

1. SSE 与在线状态在单进程内实现约 50 行代码，无跨服务协调。
2. 前后端共享 TypeScript 类型，锚点结构只有一处定义。
3. 本机磁盘直接作为 PDF 存储，省掉对象存储的配置与费用。
4. 一次部署，一个 `pnpm dev` 启动全部。
5. 领域逻辑集中在 `src/server/`，日后拆服务时按目录搬迁。

### 代价

1. 需要长驻 Node 进程。部署到 Vercel Serverless 时 SSE 受函数执行时长上限约束，需要引入第三方 pub/sub 中转；Vercel 官方知识库对实时数据给出的方案正是外接发布订阅服务（[Vercel KB](https://vercel.com/kb/guide/publish-and-subscribe-to-realtime-data-on-vercel?from=graph&source_path=%2Fdocs%2Ffunctions%2Flimitations&source_site=vercel-docs&relationship=inbound&surface=html)），其 Edge Function 另有独立的执行时长限制（[Vercel Changelog](https://vercel.com/changelog/new-execution-duration-limit-for-edge-functions?from=graph&source_path=%2Fdocs%2Ffluid-compute&source_site=vercel-docs&relationship=inbound)）。本机磁盘在同一环境下也不可用。
2. 含原生模块的库（PDF 解析、canvas）在 Next.js 打包时需要额外配置，可能触发 `serverExternalPackages`。
3. 定时与批量任务只能塞进 route handler、独立脚本或系统 cron。
4. 进程内在线状态在单实例下正确，多实例时失效。

### 工期

8.5 人日，与规格里程碑一致。

## 4. 方案 2：Next.js 前端 + NestJS / FastAPI 后端

### 形态

前端只负责渲染，后端独立进程暴露 REST，数据库与认证在后端。选 FastAPI 时可复用 Python 的 PDF 与文本处理库。

### 优势

1. 后台任务有天然宿主：批量导入、PDF 文本抽取、后续的 AI 分类都在长驻进程内。
2. API 可独立扩缩与版本化，发布节奏与前端解耦。
3. 选 FastAPI 时可直接使用 PyMuPDF、GROBID、sentence-transformers，后期做段落切分与评论分类无需跨语言桥接。
4. Node 运行时的打包限制不再影响后端依赖。

### 代价

1. 两个进程、两套依赖、两套部署配置，本地开发需要同时启动并处理端口与跨域。
2. 契约重复：DTO 与前端类型各写一份，锚点字段的漂移不会在编译期暴露。缓解手段是 OpenAPI 代码生成，这本身又是一项维护工作。
3. 认证需要跨服务传递：Auth.js 的会话在后端要再验一次 JWT 或走内省。
4. 实时通道需要额外决策：SSE 从后端出会绕过 Next.js 的同源会话，从前端出则后端推送要再加一跳。
5. 每个功能都要改两处，M1 到 M5 的成本按功能数重复支付。
6. 跨服务每次请求增加一跳网络延迟。

### 工期

11 人日左右（+2.5），且该差额随功能增长而扩大。

### 关键判断

方案 2 的两项真实收益，都可以在方案 1 的框架内以追加 `apps/worker`（Python 或 Node）的方式获得。API 层保持单体，后台任务独立进程，这是方案 1 的扩展路径，不构成迁移。因此方案 2 从第一天起就支付拆分成本，换取的收益在 M5 之前用不到。

## 5. 方案 3：Supabase 托管（DB + Auth + Storage + Realtime）

### 形态

Postgres、认证、对象存储、实时通道全部由 Supabase 提供，前端部署到 Vercel 或本地。

### 优势

1. 首版最快：Auth、Storage、Realtime 三项都不用自己实现。Supabase Realtime 提供 broadcast 与 presence，直接覆盖"新评论推送"与"在线阅读人数"。
2. RLS 让"公开可读、登录可写、仅作者可删"在数据库层表达，不依赖应用代码自觉。
3. Drizzle 可直连，定位查询与方案 1 完全相同。
4. 无本机 Docker 依赖，Windows 上少一层环境问题。

### 代价

1. RLS 策略随功能增长而复杂。管理后台需要跨用户读删，必须使用 service role 连接，该连接绕过 RLS，于是形成两套并存的权限路径，审计面扩大。
2. 连接池约束：Supabase 的 transaction pooler（端口 6543）不支持预处理语句，用 `node-postgres` 驱动时需显式关闭，否则报错或行为异常（[Supabase 文档](https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL)）。
3. Realtime 通道的订阅授权依赖 RLS，策略写错即为越权读，且错误不会在开发环境暴露。
4. 实时与存储绑定供应商，迁移需要重写这两层。
5. 本地开发依赖云端实例，离线与网络抖动会影响开发体验。

### 工期

6.5 人日左右（省去约 2 人日的认证、存储、实时实现），代价集中在长期可迁移性与权限模型复杂度。

## 6. 对比

| 维度 | 方案 1 单体自托管 | 方案 2 前后端分离 | 方案 3 Supabase |
| --- | --- | --- | --- |
| 首版工期 | 8.5 人日 | 11 人日 | 6.5 人日 |
| SSE / 实时 | 自建，约 50 行 | 自建，需跨服务设计 | 现成 Realtime |
| PDF 存储 | 本机磁盘 | 本机磁盘或对象存储 | Supabase Storage |
| 后台任务 | 需另起脚本 | 天然宿主 | Edge Function 或外部 |
| 类型一致性 | 高，单一来源 | 中，两份契约 | 高，Drizzle 直连 |
| 权限模型 | 单一路径 | 单一路径 | 双路径（RLS + service role） |
| 部署自由度 | 中，需长驻进程 | 高 | 低，绑定供应商 |
| 迁移成本 | 低 | 低 | 高 |
| Python 生态 | 无，需另起 worker | FastAPI 原生 | 无 |

## 7. 决策与约束条件

采纳方案 1，同时满足以下三条：

1. 部署目标为长驻 Node 进程：本机 Docker、云 VM、Fly.io 或 Railway 均可。不使用 Vercel Serverless 承载 SSE。
2. PDF 读取经 `StorageAdapter` 接口，本机磁盘为默认实现，接口方法限定为 `put`、`getStream`、`stat`、`delete` 四项。
3. 领域逻辑集中在 `src/server/`，route handler 只做 HTTP 映射与鉴权。该约束保证日后拆服务时按目录搬迁而非重写。

理由：MVP 要验证的假设是"后来读者能否在正确位置看到历史评论"，该假设的验证不依赖后端拆分，也不依赖托管服务。方案 2 的成本在每个功能上重复支付。方案 3 省下约 2 人日，将三条关键路径交给外部，并在管理后台处引入第二套权限模型。

## 8. 切换触发条件

| 触发条件 | 动作 | 是否属于方案 1 的扩展 |
| --- | --- | --- |
| 需要 GROBID 或 PyMuPDF 批量解析 | 追加 `apps/worker`（Python） | 是，API 保持不动 |
| 单机 SSE 连接数成为瓶颈 | 引入 Redis pub/sub 做多实例扇出 | 是 |
| 论文量超过约 50 万 | 引入专用搜索引擎 | 是 |
| 出现专职后端且需要独立发布节奏 | 重新评估方案 2 | 方案变更 |
| 需要零运维上线且可接受供应商绑定 | 重新评估方案 3 | 方案变更 |

前三条触发条件均不需要放弃当前架构，这也是选择方案 1 的核心理由。
