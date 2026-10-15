# HappyPaper 路线图与进度交接

版本：v1.0｜用途：新会话的起点文档
配套：[00-mvp-spec.md](00-mvp-spec.md)（范围与定位模型）、[01-stack-decision.md](01-stack-decision.md)（技术栈决策）、[../README.md](../README.md)（运行、验证、环境坑）

---

## 1. 当前状态

MVP 已按 `00-mvp-spec.md` 冻结的范围实现完毕，四个验证脚本全部通过。应用可以本机运行，路径为 `http://localhost:3100`。

| 项 | 值 |
| --- | --- |
| 代码 | `C:\Users\fnw\Desktop\happypaper` |
| 数据库 | PGlite，数据目录 `../happypaper-data/pgdata`（在仓库之外，原因见 README 环境注意第 1 条） |
| PDF 存储 | `./storage/pdfs`，经 `src/lib/storage.ts` 的 `StorageAdapter` 访问 |
| 迁移 | `drizzle/` 下 3 个手写 SQL，由 `scripts/db-migrate.mjs` 应用 |
| 运行时 | Node v24.21.0、Next 16.4.0、React 19.3、TypeScript 7.0.2、pdfjs-dist 6.4.299、PGlite 0.5.9、drizzle-orm 0.45.4、next-auth 5.0.0-beta.32 |
| 启动 | `npm run db:migrate` → `npm run db:seed` → `npm run pdf:worker` → `npm run dev` |

八张业务表加一张 `_migrations`：`users`、`papers`、`comments`、`comment_likes`、`reports`、`reading_progress`、`favorites`、`banned_words`。

## 2. 已验证的程度

七条命令构成当前的证据基线。改动任何一条路径后应全部重跑。

| 命令 | 结果 | 证明的内容 |
| --- | --- | --- |
| `npm run build` | 退出码 0，无错误输出 | 生产构建全流程走通：Turbopack 编译、类型检查、页面数据收集、静态页面生成；构建过程不打开数据库，stderr 只剩 6 条追踪警告 |
| `npm run typecheck` | 0 错误 | 类型层完整 |
| `npm run verify:smoke` | 63/63 | 认证、导入、PDF Range、进度、收藏、评论增删改查、点赞、回复、举报、越权拒绝、敏感词、限流、SSE 在线人数与新评论推送、四个页面的访问控制、举报处理、隐藏恢复、禁言、论文下架、Florence 与 α 两个具名管理员的后台权限 |
| `npm run verify:notify` | 27/27 | 回复通知与点赞通知：他人回复后被回复者收到未读通知、未读数增加、通知带回复者与论文页码、自己回复自己不产生通知、站点头部未读角标、`/me` 通知分页、不能标记他人的通知、按 id 只标一条、全部已读后归零、匿名访问被拒；点赞通知默认开启、点赞产生通知、重复点赞不堆积、点赞自己不通知、可关闭与重新开启、取消点赞撤回通知、非法设置值被拒、通知页渲染开关 |
| `npm run verify:search` | 12/12 | 远程论文检索：空关键词拒绝、按标题/作者/arXiv ID/DOI 检索、结果字段完整性、在库标记、从结果进入详情页、排序单调不增、非法排序回退、按出版商筛选收窄命中数、未知来源回退。与 smoke 分开，因为上游 OpenAlex 按 IP 限流；上游不可用时退出码 2 |
| `npm run verify:github` | 14/14（凭据齐全时）/ 9/9 且退出码 2（无凭据时） | GitHub 登录接线与首登昵称规则：昵称占用加后缀、为空回落默认名、长度截断、候选耗尽仍可用、无邮箱回落 noreply；密码登录仍注册、凭据存在时注册 GitHub provider 并显示按钮、发起登录跳转到 GitHub 授权页并带 client_id 与正确回调、使用 PKCE 且下发 CSRF/PKCE cookie；凭据缺失时断言 GitHub 被正确关闭并以退出码 2 报告 AUTH-008 待定。**不含** OAuth 回调、token 交换与首登建号，那需要真实 GitHub 账号与浏览器 |
| `npm run verify:github-schema` | 6/6 | OAuth 首次登录要写的表结构：可以创建没有本地密码的账号、可以把 GitHub 身份写入 `accounts`、同一 GitHub 身份不能被重复绑定、同名账号被拒绝、删除账号会级联删除绑定、检查过程不留下数据。需要先停开发服务器（PGlite 单进程），全程事务回滚 |
| `npm run verify:anchor` | 12/12 | 用真实 PDF 第 4 页的 175 个文本项验证引用定位，覆盖重新分块、大小写、空格、连字符换行；同一句出现两次时用前后文选中正确的一处 |
| `npm run verify:reader` | 15/15 | 真实浏览器：画布与文本层渲染、选区转锚点、发布、服务端保存引用与前后文、刷新后位置标记偏差 0.0px、缩放到 160% 后标记仍跟随文本、无前端异常。缩放项曾间歇失败（固定偏差 54.6px），原因是脚本在重排完成前取样；已改为等画布尺寸稳定后取样，连跑 5 次均为 0.0px，见 `docs/04-worklog.md` 第 2.1 节 R1 |

`verify:reader` 用 `puppeteer-core` 驱动本机已安装的 Chrome 或 Edge，不下载浏览器。

### 2.1 明确未被验证的部分

以下路径已实现但没有任何自动化证据，下一批工作开始前应知道它们的状态：

| 项 | 状态 |
| --- | --- |
| PDF 上传 | `importFromUpload` 与 `/papers/new` 的上传表单从未被测试执行过；冒烟测试只走 arXiv 导入 |
| 标签编辑 | `PATCH /api/papers/[id]` 已实现，无测试 |
| `/me` 的收藏与阅读记录分页 | 只验证了页面返回 200，未验证内容 |
| SSE 多连接 | 只验证过单个读者，在线阅读人数在多连接下的计数未验证 |
| 扫描版 PDF | `detectTextLayer` 已实现，从未用无文本层的 PDF 试过 |
| 多实例部署 | SSE 与在线人数依赖单进程内存，多实例行为未验证 |

另有一条在 B1 修复前观察到的问题，已完成硬杀复测，按本条自定的判据关闭：

**本地数据在开发服务器崩溃后曾丢失。** 数据目录回到 `npm run db:reset` 写入的状态——运行期导入的论文、写入的评论、注册的用户全部消失。单独验证过：普通 Node 进程被强杀时已提交的行会保留，所以「进程被杀必然丢数据」这个解释不成立，丢失只出现在开发服务器这条路径。该路径当时持续报 `Aborted()` 与 `PGlite failed to initialize properly`，而这个初始化失败正是 B1 修掉的根因，因此症状应当已随之消失。B1 修复后开发服务器 stderr 完全干净，但没有做过硬杀复测。

复测方法（约 5 分钟）：起开发服务器 → 跑 `verify:smoke` → 强杀 `next dev` 子进程 → 直接查 `papers` 行数。行数保留则本条关闭；行数归零则本地库仍需当一次性数据使用，且 B3 的性质要从「上线前要做」改成「数据可信之前要做」。

**复测结果。** 按上述方法执行：开发服务器在运行 → `verify:smoke` 61/61 → `taskkill /F` 强杀 `next dev` 及其子进程（不做优雅关闭）→ 用独立 Node 进程直接查询数据目录，得到 `papers=2`、`comments=28`、`users=8`。`db:reset` 的初始状态是 0/0/2，因此已提交的行全部保留。随后重启开发服务器，`/api/papers` 返回 200 与这 2 篇论文，stderr 为空，数据目录在被强杀后仍能正常打开、无需 `db:reset`。行数保留，本条关闭。

## 3. 下一批分块

五个块，按依赖顺序排列。每个块的判据是：一个交付物、一条能证明它的命令、块与块之间应用始终可用。

| 编号 | 状态 | 目标 | 交付物 | 验收命令 | 预估 |
| --- | --- | --- | --- | --- | --- |
| B1 | 完成 | 生产构建可用 | `next build` 通过 | `npm run build` | 0.5 人日 |
| B1 余项 | 完成 | 生产运行时与构建产物 | `npm start` 下功能可用、0 条追踪警告、备份与恢复可用 | `npm run verify:load`、`npm run verify:smoke`（对生产服务器）、`npm run db:backup` + `node scripts/db-restore.mjs --from …` | 0.5 人日 |
| B2 | 完成 | 回复通知 | 被回复者能看到通知 | `npm run verify:notify` | 1 人日 |
| B3 | 进行中 | 部署与迁移到真实 Postgres | 公网可访问的实例 | 三个验证脚本跑在远端 | 1 人日 |
| B4 | 未开始 | 密码找回 | 忘记密码可自助恢复 | 冒烟测试新增两项 | 0.5 人日 |
| B5 | 未开始 | 真人冷启动验证 | 2 至 3 名真实读者的使用结论 | 不下代码，看行为 | 0.5 人日 |
| B6 | 完成 | 远程论文搜索 | 按标题、作者、arXiv ID 或 DOI 检索，结果可进入详情页 | `verify:smoke` 的检索项 | 1 人日 |
| B6 余项 | 完成 | 论文获取模型 | 检索缓存与限流、元数据与 PDF 状态分离、无 PDF 也能入库、外部来源与错误状态 | `npm run verify:search`（含缓存与元数据入库项）、`npm run verify:search-fallback` | 1 人日 |
| B3 余项 | 完成 | 对象存储 | PDF 可放在 S3 兼容存储，切换驱动不需要改业务代码 | `npm run verify:storage`（local 与 s3 各 11/11）、`npm run storage:migrate` | 0.5 人日 |
| B7 | 进行中 | GitHub 登录 | GitHub OAuth 登录与账号绑定 | `npm run verify:github` | 1 人日 |
| B8 | 完成 | 管理员种子 | Florence 与 α 两个管理员账号 | `verify:smoke` 的管理员权限项 | 0.25 人日 |

B6 与 B8 在 B2 之前完成，依据是 B5 冷启动验证要求真实读者自行找到论文，而 B6 未完成时读者必须自带 arXiv ID 或 DOI。B7 与 B8 的需求出处为 `docs/03-requirements.md` 的 AUTH-008 至 AUTH-013 与第 2.3 节。分块状态与每轮记录以 `docs/04-worklog.md` 为准。B6 余项与产品基础（个人资料、隐私设置与主题）按四阶段计划实施，阶段顺序与依据见 `docs/04-worklog.md` 第 2.3 节。

顺序理由：B1 是上线的前置未知数且最便宜，先做。B2 修的是功能链上最明显的断裂——有人回复你，你完全不知道，回复功能因此形同虚设。B3 之后才谈得上让外部读者访问，B4 依赖 B3 确定的域名与邮件通道。B5 必须排在 B2 与 B3 之后，否则回复看不到、外人也进不来，验证没有意义。

### B1 生产构建验证（完成）

`npm run build` 退出码 0，stderr 无错误行，只剩 `src/lib/storage.ts` 的 6 条追踪警告；连续两次构建结果一致。修复前的同一命令虽然也返回 0，但 stderr 有 18 条 `ERR_INVALID_ARG_TYPE`，以及 `Error: PGlite failed to initialize properly` 与 `RuntimeError: Aborted()` 若干条。

**根因。** Turbopack 把 `@electric-sql/pglite` 里的 `new URL("./pglite.wasm", import.meta.url)` 重写成 `new __turbopack_context__.U(<asset>)`。`U` 是 Turbopack 运行时内置的 `relativeURL` 垫片（见 `.next/server/chunks/ssr/[turbopack]_runtime.js`），它把 `origin` 与 `protocol` 覆盖为空串，且不通过 `instanceof URL` 检查。PGlite 把这个对象交给 `fs.promises.readFile`，Node 以 `ERR_INVALID_ARG_TYPE` 拒绝，Emscripten 随即 `abort()`，PGlite 报初始化失败。该行为已用一段独立脚本按同样方式复现：真实 `URL` 可读，`relativeURL` 报同一条错误。

**修复一。** `next.config.mjs` 增加 `serverExternalPackages: ["@electric-sql/pglite"]`，让该包在运行时按 Node 语义加载，`import.meta.url` 与 `URL` 不被重写。

**缺陷二。** `src/db/index.ts` 原先在模块顶层调用 `createDb()`。`next build` 为收集页面数据用 30 个 worker 并行导入每个路由模块，于是 30 个 PGlite 实例同时打开同一个数据目录，抢不到锁的实例 `abort()` 并把 `Error: PGlite failed to initialize properly` 写入 stderr。该输出随竞态出现：只修缺陷一时，一次构建干净、下一次构建复现。中止的实例还可能让数据目录在下次启动时不可用，需要 `npm run db:reset` 重建。

**修复二。** `src/db/index.ts` 改为首次查询时才创建实例，`db` 用 Proxy 转发属性，导入该模块不再有副作用。构建过程因此完全不打开数据库，也不必在构建前停掉开发服务器。

附带修一处缺口：`scripts/verify-reader.mjs` 存在但 `package.json` 没有对应脚本，README 与本文档都引用 `npm run verify:reader`，已补上。

四项关注点的结论：

| 关注点 | 结论 |
| --- | --- |
| PGlite 的 WASM 与 data 文件按 `PGLITE_DATA_DIR` 加载 | 已修。构建不再创建实例，也就不再打开数据库；WASM 路径在生产打包下不再被重写。PGlite 的实际读写由开发服务器上的四条验证覆盖，生产运行时的加载未验证（见下） |
| `pdfjs-dist` 客户端打包与 `public/pdf.worker.min.mjs` 路径 | 编译通过，路由与客户端 chunk 正常产出。生产服务器的实际请求未验证 |
| `reader-mount.tsx` 的 `ssr: false` 动态导入 | 编译通过，`/read/[id]` 仍产出为动态路由。生产服务器的实际渲染未验证 |
| `allowedDevOrigins` 是否产生连带依赖 | 未产生。该配置不进入生产路径，构建无相关报错 |

本次只验证到构建结束。生产运行时（`npm run start` 后请求页面与 PDF worker）仍无自动化证据：PGlite 数据目录同一时刻只允许一个进程打开，起生产服务器要先停掉开发服务器，且 `verify:smoke` 与 `verify:reader` 都写死了开发服务器地址。

遗留警告：`src/lib/storage.ts` 的动态文件系统访问使 Turbopack 追踪整个项目，共 6 条。实测无功能影响——`.next` 合计 67.3 MB，`.next/server` 17.1 MB，`storage/pdfs` 下的 PDF 未被复制进去。未处理。

### B2 回复通知（完成）

设计要点与实现结果：

1. `notifications` 表已建（`drizzle/0003_notifications.sql`），字段与索引同设计，另加 `(user_id, created_at desc)` 供分页。
2. 触发点：回复他人评论时写入一条；点赞他人评论时也写入一条。父评论匿名、作者与操作者是同一人时不写入。点赞通知按用户偏好开关，默认开启（`users.notify_likes`），取消点赞会撤回对应通知，重复点赞不堆积。
3. 站内信已实现；邮件通知仍推迟到 B3 确定邮件通道之后。
4. 未读数走 HTTP 接口读，未接 SSE 按用户扇出。头部角标在页面加载/刷新时更新，未做实时推送。
5. 入口：站点头部「通知」加未读角标；`/me?tab=notifications` 列出通知、提供「全部标为已读」与「点赞通知」开关。

验收命令为 `npm run verify:notify`（27 项），见第 2 节证据表。第 4 点的 SSE 按用户扇出未做，记在 `docs/04-worklog.md` 的待办里。

### B3 部署与迁移到真实 Postgres

这一步的改动集中在 `src/db/index.ts` 与基础设施，与其他功能线的文件几乎不重叠，因此适合单开一个会话。

1. 换驱动：`drizzle-orm/pglite` → `drizzle-orm/node-postgres`，`PGLITE_DATA_DIR` → `DATABASE_URL`。
2. 迁移应用方式：`scripts/db-migrate.mjs` 直接改用 `pg` 客户端执行同一批 SQL，`_migrations` 表逻辑不变。
3. 部署目标必须是长驻 Node 进程（本机 Docker、云 VM、Fly.io、Railway）。放到 Vercel Serverless 会让 SSE 受函数时长限制，同时本机磁盘不可用。
4. 复核 SSE 的单进程假设。多实例时需要引入共享总线，`src/lib/realtime.ts` 的注释已标注这一点。
5. 存储：`StorageAdapter` 换 S3 兼容实现，接口只有 `put`、`getStream`、`stat`、`delete` 四个方法。
6. `AUTH_SECRET`、`NEXTAUTH_URL` 换成生产值。
7. 上线前置条件（`00-mvp-spec.md` 第 8 节）：`/legal/takedown` 已有，投诉处理时限的记录字段尚未落到数据库。

### B4 密码找回

需要先决定邮件通道：自建 SMTP 或托管服务。邮箱验证可以推迟，密码找回必须先上——真人用户第一天就会忘记密码，忘记即账号作废。当前注册流程没有验证环节，`users` 表也没有验证状态字段。

### B5 真人冷启动验证

现在库里所有评论都是测试脚本造的。让 2 至 3 人阅读同一篇论文、各自留下几条评论，观察他们是否主动回来第二次。这是唯一能证伪核心假设的环节，成本最低。结论应写回本文档，并据此决定是否投入第三阶段功能。

## 4. 暂不进行的部分

按 `00-mvp-spec.md` 第 2.2 节，以下项目在冷启动验证给出结论前不投入：AI 评论分类、关注与领域社区、专家认证、论文引用关系图、移动端、Elasticsearch 之类的独立搜索服务。

`RuntimeError: Aborted()` 与 `PGlite failed to initialize properly` 曾被认为只是噪声。B1 查明它是 Turbopack 重写 PGlite 的 WASM URL 导致初始化失败，并用 `serverExternalPackages` 修掉，见 B1 一节。这条不是噪声，是缺陷。

## 5. 已验证的缺陷与开发陷阱

已修的三处缺陷，回归用例分别留在验证脚本里：

| 缺陷 | 症状 | 回归用例 |
| --- | --- | --- |
| `findQuote` 前后文消歧失配 | 归一化会裁剪首尾空格，而页索引在文本项之间保留分隔空格，同一句出现两次时总选中第一处 | `verify:anchor` 的「同一句出现两次时用前后文选中正确的一处」 |
| React StrictMode 下销毁 PDF 加载任务 | 销毁第一个任务会连带拆掉共享的 PDFWorker，第二个任务永久挂起，阅读器停在加载态 | `verify:reader` 的文本层渲染项 |
| 位置标记对齐基准错误 | `-translate-y-1/2` 使标记中心对齐锚点，测试若按上边缘比较会固定偏差 10px | `verify:reader` 的三项位置检查 |

开发期陷阱，README 的「环境注意」有完整说明，共七条。四条与运行方式有关：数据目录必须在仓库之外、迁移前先停开发服务器、必须用 `localhost` 访问（`allowedDevOrigins` 已包含 `127.0.0.1` 与 `localhost`）、阅读器经 `ssr: false` 加载。三条与进程生命周期有关：

1. 开发服务器崩溃后先删 `.next` 再重启。改动 `next.config.mjs` 会触发自动重启，重启期间 Turbopack 的持久缓存可能损坏并 panic（`failed to open ... .sst`），进程直接 Aborting。
2. 本地数据在开发服务器崩溃后会丢失，处理方式见第 2 节末尾。
3. `npm run dev` 会派生出 `next dev` 子进程，包装进程结束后子进程可能仍活着并占着 3100 端口与数据库目录锁。停服务时要确认子进程真的退出，否则下一次启动报 `EADDRINUSE`，或直接操作数据库时报 PGlite abort。

## 6. 何时重新评估技术栈

`01-stack-decision.md` 第 8 节的触发条件在本轮实施后仍然成立，实测补充如下：

| 触发条件 | 状态 |
| --- | --- |
| 需要 GROBID 或 PyMuPDF 批量解析 | 未触发，追加 `apps/worker` 即可，API 保持不动 |
| 单机 SSE 连接数成为瓶颈 | 未触发，当前仅单连接验证 |
| 论文量超过约 50 万 | 未触发，当前论文量以个位数计 |
| 出现专职后端且需要独立发布节奏 | 未触发 |
| 零运维上线且可接受供应商绑定 | 未触发。B3 之前需要做一次明确选择 |

## 7. 新会话如何开始

第一条指令前先读三个文件：本文件、`docs/04-worklog.md`、`README.md`。范围与冻结口径见 `docs/00-mvp-spec.md`，当前需求与验收项见 `docs/03-requirements.md`，技术栈决策只在涉及部署或换库时读 `docs/01-stack-decision.md`。

确认环境的三条命令：

```bash
npm run db:reset      # 数据目录可能因上次强杀而不可用，这一步保证干净起点
npm run db:seed
npm run verify:smoke  # 需要 npm run dev 在另一个终端运行
```

启动指令模板：

```text
先读 docs/04-worklog.md 第 2.3 节拿到当前顺序，再按 docs/02-roadmap.md 的对应块执行。
失败时逐项定位并修复，不要绕过：不关类型检查，不把 PDF 或数据库模块排除出构建。
完成后重跑 npm run typecheck、verify:smoke、verify:anchor、verify:reader，
四项全绿才算完成。
```

每个块完成后更新三处：`docs/04-worklog.md` 追加一条记录，本文档第 2 节的证据表，第 3 节对应块的状态。其余文档保持不变。
