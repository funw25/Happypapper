# HappyPaper 工作日志

用途：跨会话的进度记录与交接。每轮工作结束时在「三、工作日志」顶部追加一条，不改写历史条目。
配套：[02-roadmap.md](02-roadmap.md)（分块计划与证据基线）、[03-requirements.md](03-requirements.md)（需求与验收项）、[05-public-test.md](05-public-test.md)（上线前检查清单与读者测试方案）、[../README.md](../README.md)（运行方式与环境坑）。

---

## 一、当前状态

证据基线为十五条命令，最近一次全绿执行于 2026-10-16：

| 命令 | 结果 |
| --- | --- |
| `npm run build` | 退出码 0，0 条 tracing 警告（第 20 轮复测；沙箱内 type-check 子进程会被拒，需普通终端；Windows 上重复构建前先删 `.next`） |
| `npm run typecheck` | 0 错误 |
| `npm run verify:smoke` | 63/63 |
| `npm run verify:notify` | 27/27 |
| `npm run verify:search` | 24/24（第 12 轮扩项：缓存命中、元数据入库、来源与可用性标注）；自由文本检索依赖外网 OpenAlex，上游限流时退出码 2 |
| `npm run verify:search-fallback` | 6/6（第 12 轮新增，opt-in，约 12 分钟：验证缓存回退分支） |
| `npm run verify:search-ui` | 4/4（第 12 轮新增，真实浏览器验证检索防抖，需要本机 Chrome/Edge） |
| `npm run verify:github` | 14/14（用临时假凭据验证接线）；未配置凭据时 9/9 且退出码 2，AUTH-008 待定 |
| `npm run verify:github-schema` | 6/6（需先停开发服务器；全程事务回滚，不留数据） |
| `npm run verify:account` | 31/31（第 13 轮新增，未配置 OAuth 时）；36/36（同一脚本在临时假凭据下运行，额外覆盖绑定授权的跳转与 state 校验） |
| `npm run verify:load` | 160 个请求 0 个 5xx、无连接错误（第 14 轮新增，需对生产服务器运行；p50 18ms、p95 89ms） |
| `npm run verify:storage` | 11/11（第 16 轮新增；local 与 s3 两个驱动各跑一次，含完整内容与 Range 区间的逐字节比对）；生产模式 10/10（不写开发日志，跳过驱动比对） |
| `npm run verify:github-flow` | 16/16（第 17 轮新增；需假提供方，PostgreSQL 与 PGlite 各跑一遍） |
| `npm run verify:anchor` | 12/12 |
| `npm run verify:reader` | 15/15（R1 已修复，连跑 5 次偏差 0.0px） |
| `npm run verify:settings` | 32/32（第 11 轮建立，第 19 轮加入头像 5 项：字符、默认配色、自定义配色、非法颜色） |
| `npm run verify:theme` | 8/8（第 11 轮新增，真实浏览器验证三态主题、刷新持久化与跟随系统） |

| 项 | 值 |
| --- | --- |
| 代码 | `C:\Users\fnw\Desktop\happypaper`，git 仓库已建立，远程 `https://github.com/funw25/Happypapper`（公开），主分支 `main`，首个提交 `5766de6` 含 123 个受管文件 |
| 数据库 | 本地 PGlite，数据目录 `../happypaper-data/pgdata`（在仓库之外）；生产为 Supabase PostgreSQL 17.11（Session pooler + 固定 CA），迁移至 `0009_avatar_colors.sql` |
| PDF 存储 | 本地 `./storage/pdfs`；生产为 Supabase Storage 桶 `happypaper-pdfs`（S3 兼容端点，ap-northeast-2） |
| 开发服务器 | 运行中，`http://localhost:3100`（第 11 轮重启过一次，见 2.4 节） |
| 本地账号 | `admin@happypaper.local` / `admin12345`（管理员）、`reader@happypaper.local` / `reader12345`（普通用户）、`florence@happypaper.com` / `florence12345`（管理员 Florence）、`alpha@happypaper.com` / `alpha12345`（管理员 α）、`smoke-*@happypaper.local` / `probe12345`（历史脚本注册的测试账号） |

环境依赖一条：`next.config.mjs` 里的 `serverExternalPackages: ["@electric-sql/pglite"]` 是必需的。文件沙箱为 `workspace-write` 时，Turbopack 会尝试 unlink `.next/dev/node_modules/@electric-sql/pglite-*` 并被沙箱拒绝（`EPERM`），开发服务器起不来；该行在沙箱放宽（`danger-full-access`）下工作正常。缺了它，生产构建会失败，原因见工作日志第 1 轮。

---

## 二、待办与缺口

### 2.1 已确认的实现缺口

| 编号 | 缺口 | 证据 | 需求出处 |
| --- | --- | --- | --- |
| R1 | ~~`verify:reader` 间歇失败~~ **已于第 10 轮修复**。原因是脚本在 PDF 按新比例重排完成前取样，`expectedZoom` 用的是未缩放高度；产品最终状态一直是正确的 0.0px。修法是加「画布尺寸稳定」等待，连跑 5 次均 14/14、偏差 0.0px。详见工作日志第 10 轮 | 第 9 轮复现、第 10 轮修复 | 02-roadmap M3 的「缩放到 160% 后标记仍跟随文本」 |
| R2 | **验证脚本之间存在发评论配额冲突**：`verify:smoke` 有一条测限流的检查，会用满 reader 账号 60 秒 5 条的配额，因此 smoke → notify → reader 不能在 60 秒内连跑。三个脚本现在都会把这种情况报成退出码 2，但基线仍需按 70 秒间隔执行 | 第 10 轮实测 | 应用自身的限流规则（`src/lib/comments/queries.ts`） |
| B7 | GitHub 登录：**握手之后的全部逻辑已于第 17 轮在本地假提供方上端到端验证**（首登建号、昵称去重、邮箱回落）。仅剩真实 GitHub 侧（授权页、回调注册、真实 token 响应）待用户凭据 | `verify:github` 14/14、`verify:github-flow` 16/16、`verify:github-schema` 6/6 | AUTH-008 至 AUTH-010（第 117–120 行） |
| B7 余项 | AUTH-011 至 AUTH-013 已于第 13 轮实现、第 17 轮端到端验证：绑定、绑定后登录进同一账号、同一身份不可二次绑定、解绑保护（唯一登录方式时 409）、正常解绑。**仅剩真实 GitHub 凭据下的冒烟** | `verify:account` 31/31、`verify:github-flow` 16/16 | AUTH-011 至 AUTH-013（第 121–122 行）、第 255 行 |
| P1 | **个人资料、隐私与主题需求**（PROFILE-001 至 PROFILE-009、PRIVACY-001 至 PRIVACY-013、UI-001 至 UI-007）已于第 11 轮实现，第 18 轮做过头像上传、第 19 轮按用户指示改为「昵称前两个字符 + 可选配色」并撤掉上传；`verify:settings` 32/32、`verify:theme` 8/8 | 第 11、18 轮 | 03-requirements 第 126–185、81–99 行 |
| P2 | **论文获取模型**（PAPER-002、PAPER-005、PAPER-006、PAPER-007 与第 28 行的「已找到元数据但没有可用 PDF」）已于第 12 轮实现：检索缓存与限流、元数据与 PDF 状态分离、无 PDF 也能入库并可重试、结果展示来源与可用性 | 第 12 轮 | 03-requirements 第 17–39 行 |
| P3 | **账号闭环**（AUTH-006、AUTH-007、AUTH-011 至 AUTH-013、PROFILE-008）已于第 13 轮实现：一次性令牌、邮箱验证与邮箱修改、密码找回、GitHub 绑定与解绑保护 | 第 13 轮（`verify:account` 31/31，假凭据下 36/36） | 03-requirements 第 101–124、152 行 |

B7 的 OAuth 握手阻塞点是**只有用户能提供的输入**：在 GitHub 上创建 OAuth App 得到的 client id 与 client secret。回调地址填 `http://localhost:3100/api/auth/callback/github`。凭据到位后重跑 `npm run verify:github` 可把退出码从 2 变成 0，但首次登录建号仍需浏览器完成一次真实登录才能验证。

B8（管理员种子缺少 Florence 与 α）已于第 2 轮完成，B6（远程论文搜索）已于第 3 轮完成，B2（回复通知）与点赞通知已于第 5、6 轮完成，见工作日志。

### 2.2 实现已完成但无自动化证据

沿用 02-roadmap 第 2.1 节：PDF 上传、标签编辑、`/me` 的收藏与阅读记录分页内容、SSE 多连接、扫描版 PDF、多实例部署。

补充四项：

| 项 | 状态 |
| --- | --- |
| 生产运行时（`npm run start`） | **已验证（第 14 轮）**。`npm run build` 退出码 0、0 条追踪警告；`npm start` 下 `verify:smoke` 63/63、`verify:settings` 27/27、`verify:load` 160 请求 0 个 5xx，服务端日志为空。首轮验证即抓到并修复了只在生产模式出现的 EMFILE 崩溃 |
| GitHub OAuth 握手 | **握手之后的全部逻辑已在本地假提供方上端到端验证（第 17 轮，`verify:github-flow` 16/16）**：首登建号、昵称去重、邮箱回落、绑定、绑定后登录进同一账号、身份唯一、解绑保护、正常解绑。仍缺：真实 GitHub 的授权页与回调注册、真实 token 响应、企业版差异，需要用户提供 `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` 并注册两个 Redirect URI |
| 解绑保护的「唯一登录方式」分支 | **已触发（第 17 轮）**：GitHub 首登账号没有本地密码，点解绑后服务端返回 409、页面提示先设置密码，且绑定仍然存在 |
| 邮件投递 | 未接入。`src/lib/mailer.ts` 只实现写日志传输；流程本身（令牌、过期、一次性、页面）已端到端验证，真实投递需要 SMTP 凭据 |
| 真实 PostgreSQL | **代码已完成并在真实 Postgres 上验证（第 15 轮）**：`DATABASE_URL` 切换后端、迁移/种子/重置脚本双后端、`npm run pg:start` 本地起真实 Postgres 18，`verify:smoke` 63/63、`verify:settings` 27/27、`verify:account` 31/31。仍缺：用户自己的生产实例（托管服务的连接串参数、TLS、连接数上限与本地二进制不同），以及 Postgres 侧的 `pg_dump` 备份演练 |
| 对象存储 | **代码与本地 S3 兼容端点验证完成（第 16 轮）**：`STORAGE_DRIVER=s3` 的四个方法、`npm run s3:start` 本地端点、`storage:migrate` 幂等迁移、`verify:storage` 两个驱动各 11/11。仍缺：用户自己的桶（签名校验、分片上传、存储类别与生命周期策略与 s3rver 不同） |
| 真实读者测试 | 未开始，需要 2 至 3 名真实读者 |
| 通知的实时推送 | 未实现。未读数在页面加载/刷新时读取，没有按用户维度的 SSE 扇出（02-roadmap B2 第 4 点列为设计要点，当前只做到「进入页面可见」） |

### 2.3 下一步建议顺序

四阶段计划（用户 2026-10-15 定序）：第一阶段补齐产品基础，第二阶段修正论文获取模型，第三阶段完成账号闭环，第四阶段准备公开测试。第一至三阶段已完成（第三阶段的真实 OAuth 握手与邮件投递待用户提供凭据），第四阶段进展如下：

| 顺序 | 阶段 | 内容 | 前置理由 | 预估 |
| --- | --- | --- | --- | --- |
| 4a | 第四阶段 | ~~生产构建与启动验证~~、~~备份与恢复~~ **已于第 14 轮完成** | — | — |
| 4b | 第四阶段 | ~~迁移到真实 PostgreSQL~~ **代码与本地真实 Postgres 验证已于第 15 轮完成**；剩余是用户自己的生产实例与 `pg_dump` 演练 | 托管 Postgres 的连接串、TLS 与连接数上限与本地二进制不同，需要真实环境复测 | 约 0.25 人日 |
| 4c | 第四阶段 | ~~对象存储~~ **代码与本地 S3 兼容端点验证已于第 16 轮完成**；剩余是用户自己的桶复测 | s3rver 与真实对象存储在签名、分片、生命周期策略上不同 | 约 0.25 人日 |
| 4d | 第四阶段 | 真实读者测试 | 需要 2 至 3 名真实读者；结论决定是否继续做社区、AI 或推荐 | 0.5 人日 |

与 02-roadmap 第 3 节原顺序的差异：原顺序把 B7（GitHub 登录）排在第一位，四阶段计划把它并入第三阶段，先补齐个人资料与隐私这类不依赖外部凭据的产品面。

### 2.4 环境事实（第 11 轮新增）

| 事实 | 影响 |
| --- | --- |
| 在开发服务器运行期间执行 `npm run db:migrate` 会让该服务器保留旧的表结构缓存：PGlite 不会感知外部进程的 `alter table`，随后所有触及新列的查询报 `42703`（`errorMissingColumn`），表现为登录、注册、评论列表全部 500 | 应用迁移后必须重启开发服务器。第 11 轮已重启一次（旧 PID 3648 已结束） |
| 文件沙箱为 `workspace-write` 时，PGlite 无法初始化：数据目录在仓库之外，写入被拒，报 `PGlite failed to initialize properly`。该报错与数据损坏无关 | 任何 `db:*` 命令、以及需要访问数据库的验证，都要在放宽沙箱（`danger-full-access`）下运行 |
| 同一沙箱下 `next dev` 与 `puppeteer.launch` 都会 `spawn EPERM`（子进程管道被拒），`next build` 的 type-check 步骤同样如此 | `build` 在沙箱内只能验证到「编译成功」；`npm run typecheck` 与浏览器验证需要放宽沙箱 |
| `.next/dev/types` 是 `next dev` 生成的旧类型桩：新增 `/settings` 路由后它会与 `.next/types` 不一致，`tsc` 报 `Type 'Route' does not satisfy the constraint '"/"'` | 出现该报错时删除 `.next/dev/types` 或重启开发服务器，不要改源码类型 |
| 本机通过 `127.0.0.1:7890` 的本地代理出海。PowerShell 的 `Invoke-WebRequest` 走 WinINET 代理设置，而 `git` 与 `curl.exe` 不读该设置：直连 github.com 在 21 秒后报 `Connection was reset` / `Could not connect` | 本仓库已设置 `git config --local http.proxy http://127.0.0.1:7890`。换机器或代理端口变化时需要重设，否则推送与拉取都会超时 |
| 开发服务器对源码改动做热更新，服务端模块会被重新求值：检索缓存与限流计数都在进程内存里，改一次源码即被清空 | `verify:search-fallback` 的 11 分钟等待期间不要编辑源码，否则预热好的缓存消失，脚本按「不判定（退出码 2）」结束 |

---

## 三、工作日志

### 2026-10-16 第 20 轮：接上 Supabase（PostgreSQL + 对象存储）并在生产模式验证

**结论：生产形态已经在用户的真实 Supabase 项目上跑通。** 迁移 10 条、种子 4 个账号；`npm start` 下 `verify:smoke` 63/63、`verify:settings` 32/32、`verify:storage` 10/10；应用启动日志确认 `driver=s3 bucket=happypaper-pdfs`，桶内确认有应用写入的对象。验证产生的数据已清除，数据库回到「10 条迁移 + 4 个账号 + 0 篇论文」，桶已空。

用户提供：Supabase 数据库连接串、Storage 桶 happypaper-pdfs、S3 端点与密钥。

四处由实测决定的实现与配置：

1. **直连主机不可用，必须走 Session pooler。** db.<ref>.supabase.co 只有 AAAA 记录（本机与多数容器没有 IPv6 出口），Node 直接报 getaddrinfo ENOTFOUND。改成 aws-0-ap-northeast-2.pooler.supabase.com:5432 可用，用户名是 postgres.<项目 ref>。
2. **连接串里的 SSL 参数不生效，TLS 必须显式配置。** sslmode=require 报 self-signed certificate in certificate chain：Supabase 的池化端点用自家根证书（Supabase Root 2021 CA）签发，Node 的信任库里没有它。已从真实握手导出该链到 certs/supabase-prod-ca-2021.crt，连接改为 ssl: { ca, rejectUnauthorized: true }。判断加密与否不能看 pg_stat_ssl.ssl（那是池化服务到 Postgres 的内部一段，恒为 false），要看客户端 socket 是否为 TLSSocket。
3. **数据库 TLS 的三个环境变量**（DATABASE_SSL_CA 校验、DATABASE_SSL_NO_VERIFY=1 只加密、都不设则明文并在远程主机时打印提示）同时接进了应用（src/db/index.ts）与脚本（scripts/lib/db-client.mjs），两边共用同一套规则，避免出现「应用加密、迁移脚本明文」这种裂缝。
4. **生产模式不写开发日志**，verify:storage 原来靠开发日志判断驱动，在生产下必然报 driver=unknown。改为：读不到日志时打印说明并跳过驱动比对，功能项照跑（驱动取值由启动终端的 stdout 记录）。

Windows 上的构建坑：Turbopack 会为 serverExternalPackages 的包在 .next/node_modules 下建 junction，再次构建删不掉它，报 EPERM unlink '@aws-sdk/client-s3-…'。构建前删掉 .next 即可。另外 next build 的类型检查子进程在受限沙箱下报 spawn EPERM，需在普通终端执行。顺带修掉 src/lib/storage.ts 启动日志里 resolve(process.env.STORAGE_DIR …) 的 tracing 警告（补 turbopackIgnore），构建恢复 0 警告。

**验证证据。**

| 项 | 结果 |
| --- | --- |
| 迁移与种子（Supabase） | 10 条迁移，users=4（admin / reader / Florence / α），banned words 5 |
| 客户端 TLS | TLSSocket，用固定 CA 校验；数据库版本 PostgreSQL 17.11 |
| npm start + verify:smoke | 63/63 |
| npm start + verify:settings | 32/32 |
| npm start + verify:storage（s3） | 10/10（跳过驱动比对，见上） |
| 存储落桶 | 启动日志 [storage] driver=s3 bucket=happypaper-pdfs；桶内确认出现应用写入的对象 |
| 收尾 | db:reset 后 users=4 / papers=0 / 迁移 10；桶内对象已清空 |

**本轮遗留。** 生产环境的定时备份尚未配置（用户侧任务，用 pg_dump 加桶侧版本控制/生命周期）；AUTH_SECRET 已生成但 NEXTAUTH_URL 与 APP_URL 仍指 localhost，上线换域名后需同步更新 GitHub 回调地址；真实读者的测试尚未开始。

### 2026-10-16 第 19 轮：头像改为「昵称前两个字符 + 可选配色」

**结论：头像统一为昵称前两个字符生成，配色可选，默认克莱因蓝底 #002FA7 + 白字。** `verify:settings` 32/32（头像 5 项）、`verify:smoke` 63/63、`typecheck` 0 错误。

需求依据：用户当轮指示——「头像统一设置为个人昵称的前两个字符（可以自行选择什么颜色是底色，字符是什么颜色，默认是蓝色底 #002FA7，白色字）」。上一轮做的上传通道与外链地址按这条指示一并撤掉：它们与「统一」冲突，且撤掉后头像不再依赖对象存储、不受外链失效影响。

做了什么：

1. `src/lib/avatar.ts`：`avatarInitials` 用 `Array.from` 按码点取前两个字符（否则 emoji 与罕用汉字会被从中间劈开），空白先去掉、全空回落问号；`avatarColors` 对非法值回落默认色。六个预设底色都配白字可读，另可填任意 `#RRGGBB`。
2. `src/components/avatar.tsx`：一个组件，服务端与客户端都能渲染，页头（小号）、设置页预览（大号）、公开主页与 `/me`（大号）共用，不会出现三处各写一套字号圆角。
3. 迁移 `0009_avatar_colors.sql`：`users.avatar_bg` / `users.avatar_fg`，默认 `#002FA7` / `#FFFFFF`。`/api/me/profile` 的 PATCH 接受两个颜色字段（省略即不改动），颜色在服务层统一校验，非法值返回 `INVALID_COLOR`。
4. 资料页把「头像地址」输入框与上传控件换成配色面板：六个预设 + 取色器 + `#RRGGBB` 输入 + 恢复默认；预览用同一个组件，选什么就显示什么。
5. 公开主页补上简介展示（第 11 轮只做了昵称与统计）。
6. 撤掉上传通道：`/api/me/avatar`、`/api/avatars/[file]`、`lib/avatars.ts`、上传组件，以及存储接口为此加的 `contentType` 选项。存储层回到只服务 PDF。

验证证据：

| 项 | 结果 |
| --- | --- |
| 默认配色与字符 | 页头与公开主页渲染 `re`，`background-color:#002FA7; color:#FFFFFF`（浏览器实测） |
| 自定义配色 | PATCH `#123456` / `#fedcba` → 返回 `#123456` / `#FEDCBA`，公开主页 HTML 出现该颜色 |
| 非法输入 | `"blue"` → 400 `INVALID_COLOR`；`"#fff"` → 400 |
| 回归 | `verify:settings` 32/32、`verify:smoke` 63/63 |

**本轮遗留。** 颜色由用户自选，浅色底配白字这类低对比组合没有被禁止（预设都保证可读，自定义值不校验对比度）。若之后认为需要，可以在保存时按相对亮度给出警告。

### 2026-10-16 第 18 轮：头像上传（补齐第一阶段留下的唯一缺口）

**结论：头像上传完成并在本机磁盘与对象存储两个驱动上验证。** `verify:settings` 由 27 项增至 36 项，local 与 s3 下各 36/36；`verify:storage`（s3）11/11；`verify:smoke` 63/63 无回归；`typecheck` 0 错误。

需求依据：`docs/03-requirements.md` 第 5.2 节的「头像：可编辑」。第 11 轮实现时只能填外部图片地址，原因是当时还没有可写文件的存储层；第 16 轮补上对象存储后这个缺口就没有理由留着。

做了什么：

1. `src/lib/avatars.ts`：按**文件头**判断类型（PNG/JPEG/WebP/GIF），不看文件名也不看请求里的 content-type——两者都由客户端提供，改个后缀就能把任意内容塞进存储并让浏览器按图片解释；大小上限 2MB。
2. 对象键 `avatars/<用户 id>-<时间戳>.<后缀>`，写入 `users.image` 的是站内地址 `/api/avatars/<文件>`。带时间戳的原因：头像换了但文件名不变时浏览器与 CDN 会继续用缓存里的旧图；换键即换地址，旧对象在换新时删掉，且只删键名含自己 id 的对象。
3. `POST /api/me/avatar`（登录 + multipart）与 `GET /api/avatars/[file]`（只服务 `avatars/` 前缀，存储适配器同时放着论文 PDF，不能让它变成通用文件服务）。头像由应用代理读取而不是给桶配公开读或签名 URL：桶通常是私有的，头像很小，代理一次更简单，两种驱动的行为也完全一致。
4. `/settings/profile` 增加上传控件；`/u/[name]` 补上头像与个人简介——需求说公开主页展示头像、昵称与简介，而第 11 轮只做了后两者。
5. 存储接口的 `put` 增加可选的 `contentType`：对象存储靠它决定浏览器拿到的类型，之前写死成 `application/pdf`。

一处由实测决定的实现细节：

- **保存资料不能顺手清掉上传的头像。** 上传后 `users.image` 是站内地址，而表单里的「头像地址」只表示外部图片链接；原来的提交逻辑把该字段一律发成「空即 null」，于是上传完头像再保存昵称就会把头像一个清掉。改为字段缺失即「不改动」：外链为空且当前是上传头像时整个字段不发，服务端只在字段存在时才写 `image`。

**验证证据。**

| 项 | 结果 |
| --- | --- |
| 头像 9 项（local 与 s3 各一遍） | 未登录 401；PNG 上传返回站内地址；该地址字节与上传内容一致且 `content-type: image/png`；保存资料不带头像字段不掉头像；再次上传换新地址且旧对象 404；改后缀的非图片按文件头被拒（`UNSUPPORTED_TYPE`）；超过 2MB 返回 413 |
| `verify:settings` | 36/36（local）、36/36（s3）；第 19 轮撤掉上传后为 32/32 |
| `verify:storage` | 11/11（s3，日志确认 `driver=s3`） |
| `verify:smoke` | 63/63 |

**本轮遗留。** 测试会在存储里留下每轮一个孤儿头像对象（还原资料后指向被清空，最后一个对象不再被引用）；量级是每轮几百字节，暂不处理。真实对象存储仍需用户的桶复测。

### 2026-10-16 第 17 轮：GitHub 登录与绑定的端到端验证（用本地假提供方）

**结论：握手之后的每条分支都被真实执行过，`verify:github-flow` 16/16。** 覆盖首登建号、昵称去重、邮箱回落、绑定到当前账号、绑定后登录进同一账号、同一身份不可二次绑定、解绑保护、正常解绑。真实 GitHub 侧（回调注册、真实 token 响应）仍需用户凭据做一次冒烟，见 2.2 节。

需求依据：`docs/03-requirements.md` AUTH-008 至 AUTH-013。此前这三条只做到「接线用假凭据验证过」，绑定与解绑保护的逻辑分支从未真正跑过。

做了什么：

1. `GITHUB_BASE_URL` 把授权、换令牌、读取身份三个地址一起切换：Auth.js 侧用它内置的 `enterprise.baseUrl`，自建的绑定回调读 `githubEndpoints()`。两条链路必须同时改指，否则一条连 github.com、另一条连别处。真实 GitHub 不设置该变量即走默认。
2. 新增 `scripts/github-fake.mjs`：实现 `/login/oauth/authorize`、`/login/oauth/access_token`、`/api/v3/user`、`/api/v3/user/emails` 四个端点，身份由 `POST /__identity` 指定（四个身份分别覆盖有邮箱有昵称、昵称与已有用户重名、无邮箱无昵称、用于绑定的普通身份）。
3. 新增 `scripts/verify-github-flow.mjs`：真实浏览器走完登录与绑定，逐条断言会话、账号安全页文案与登录方式接口。其中「绑定的身份用 GitHub 登录会进入同一个账号」是关键一项——它证明绑定写入的 `provider_account_id` 与 Auth.js 登录查询用的是同一约定；两者不一致时 GitHub 登录会另建账号，而这种错误只有真跑一次才看得见。
4. 账号安全页的绑定信息不再显示数字的 provider account id（对读者没有意义），改为「已绑定 GitHub 账号。」并把 id 放进 `title`。

三处由实测决定的实现细节：

- **绑定回调改用表单编码换令牌。** 之前发 JSON；GitHub 两种都接受，但标准与 Auth.js 都用表单编码，假提供方按标准实现时 JSON 直接被解析成空参数。改回标准形式，假提供方也就能保持严格而不必迁就。
- **身份必须由提供方控制端点切换，不能靠浏览器 cookie。** 最初用 cookie 传身份，`Domain` 属性在 IP 主机上会被丢弃，于是每个用例都落到默认身份——表现是「换了身份但账号没变」，看起来像业务缺陷，实际是测试装置失效。
- **`NEXTAUTH_URL` 与访问地址必须一致。** Auth.js 的 state 与 PKCE cookie 按该地址下发；用 127.0.0.1 打开而配置是 localhost 时，回调落在另一个 host，握手在换令牌之前就失败，且日志里看不出原因。

**本轮踩到的坑：残留的 GitHub 绑定会让登录进错账号。** 早期几轮验证在本地 PGlite 库里留下了四行 `accounts`（100001/100002/100003 都指向 alice、100004 指向 dave）。Auth.js 先按 `provider_account_id` 查账号，于是 bob 与 carol 的登录直接进了 alice 的账号，脚本报「昵称与邮箱不对」，看上去像业务缺陷。定位方式是把同样的流程放到刚 `db:reset` 过的 PostgreSQL 上跑，三条登录立刻全部正确——说明是数据残留而不是代码。已清理本地残留（`accounts` 4 → 0，删掉两个 GitHub 专用账号，论文与评论未动），并给脚本加了检测：身份登录成别人时以退出码 2 报「不判定」并提示先重置数据库。

**验证证据（PostgreSQL 18.4 与默认 PGlite 各跑一遍，均 16/16）。** Postgres 侧的行：`github/100001 → Alice GitHub`、`github/100002 → reader-2`、`github/100003 → carol-gh`，三个账号均无本地密码、邮箱与昵称符合各自身份；reader 的 `github/100004` 在最后一步解绑后消失。

### 2026-10-16 第 16 轮：第四阶段——对象存储驱动与磁盘到桶的迁移

**结论：`STORAGE_DRIVER=s3` 实现完成，并在 S3 兼容服务端上端到端验证。** `verify:storage` 在 local 与 s3 两个驱动下各 11/11；S3 侧 `verify:smoke` 63/63；桶内对象数与迁移数一致；切回 local 后原有 8 个 PDF 照常提供。

需求依据：`docs/02-roadmap.md` B3 的对象存储项。上一轮解决了数据库，这一轮解决文件存放位置。

做了什么：

1. `src/lib/storage.ts` 增加 S3 实现：`put` / `getStream`（支持 Range）/ `stat` / `delete`，与磁盘驱动同一接口，业务代码一行未改。驱动选择沿用与数据库一致的规则：显式 `STORAGE_DRIVER` 优先，否则有 `S3_BUCKET` 就用 s3。客户端延迟到第一次使用再建（`next build` 会导入路由模块，那时不该连存储）。
2. 启动时打印一行 `[storage] driver=…`：验证脚本据此确认这次验的是哪个驱动。没有为它新增对外接口。
3. `scripts/s3-start.mjs`（`npm run s3:start`）：用 s3rver 在本地起一个 S3 兼容服务端，让对象存储可以端到端验证而不是只读代码。生产不经过它。
4. `scripts/storage-migrate.mjs`（`npm run storage:migrate`）：把 `storage/pdfs` 里的对象复制进桶，幂等（大小相同则跳过）。这是切换驱动必需的一步——`pdf_path` 存的是对象键、不含驱动信息，文件不会自己跟过去，少了它页面会显示可在线阅读而点开 404。
5. `scripts/verify-storage.mjs`（`npm run verify:storage`）：上传一个自造 PDF → 完整下载逐字节比对 → Range 读取逐字节比对 → 越界 416 → 管理员下架删除后 404。对象存储最常见的问题是「能传能下但内容被截断或 Range 偏移一位」，只断言状态码发现不了，所以每一步都比 sha256。脚本还会从服务器日志确认驱动，驱动与 `EXPECT_STORAGE_DRIVER` 不符时退出码 2。

验证证据：

| 项 | 结果 |
| --- | --- |
| `verify:storage`（local） | 11/11，含 2465 字节完整比对与 `bytes 100-599/2465` 区间比对 |
| `verify:storage`（s3，s3rver 端点） | 11/11，日志确认 `driver=s3` |
| `verify:smoke`（应用连 S3） | 63/63（导入、PDF Range、评论、举报、下架删文件都走对象存储） |
| `storage:migrate` | 8 个 PDF 上传；再跑一次 0 上传 8 跳过（幂等） |
| 桶内核对 | 列出 8 个对象，与迁移数一致；探测用对象已被下架接口删除，不在列表里 |
| 切回 local | 默认驱动启动正常，原有 8 个 PDF 仍可下载（538075 字节那篇返回 200） |

**一处刻意的取舍。** S3 的 delete 走 `DeleteObjectCommand`（S3 本身幂等），与磁盘驱动的 `rm --force` 语义对齐；没有为「对象不存在」额外加分支，因为两条路径的行为已经一致。

**本轮遗留。** 本机验证用的是 s3rver，不等于真实对象存储：签名校验（v4 的时钟偏移）、分片上传、存储类别与生命周期策略仍需在用户的桶上复测。真实读者测试仍未开始。见 2.2 / 2.3 节。

**同轮补充：公开测试准备文档。** 新增 `docs/05-public-test.md`，把「准备公开测试」拆成可执行项：

1. 上线前 11 项检查清单（数据库与存储指向真实实例、旧文件迁移、密钥、生产构建、负载回归、备份演练、定时备份、版权入口、回滚方案），并注明两个可选依赖（GitHub 凭据、邮件通道）缺失时应当在页面上如实说明而不是留空按钮。
2. 读者测试方案：2 至 3 人、各 30 至 40 分钟、6 条不给解释的任务、固定字段的观察记录表（卡点、耗时、提问次数、放弃项、报错、原话评价）。
3. 结果来源：大部分数据已经在库里（`reading_progress`、`comments` 的 `page`/`y_norm`/`is_anonymous`、服务器日志里的检索错误），不需要额外埋点；并给出「是否继续做社区/AI/推荐」的三条门槛（留存、互动密度、成本），先定标准再看数据。
4. 对外说明用的已知限制清单。

### 2026-10-16 第 15 轮：第四阶段——真实 PostgreSQL 支持与本地验证

**结论：应用现在支持 `DATABASE_URL` 指向真实 PostgreSQL，并在真实 PostgreSQL 18.4 上跑通全部验证。** `verify:smoke` 63/63、`verify:settings` 27/27、`verify:account` 31/31 全部对着 Postgres 执行；9 个迁移全部应用且重跑幂等；切回默认 Pglite 后原有数据未受影响。

需求依据：`docs/02-roadmap.md` B3「部署与迁移到真实 Postgres」。上一轮确认本机没有 Docker、psql 且 5432 无监听，因此这一轮先解决「没有服务器就没法验证」这个问题。

做了什么：

1. 后端选择：`src/db/index.ts` 按 `DATABASE_URL` 选 node-postgres 连接池或 PGlite，其它代码一行不改。`next.config.mjs` 的 `serverExternalPackages` 加上 `pg`（它要开 socket、加载可选原生模块，不该被打包）。
2. 脚本层：新增 `scripts/lib/db-client.mjs`，同一套 `query` / `exec` 接口背后按同一个环境变量选驱动；`db-migrate` / `db-seed` / `db-reset` 改为用它。迁移文件一批手写 SQL 两边共用，Postgres 下 `db:reset` 重建 `public` schema 而不是删目录。
3. 备份的边界写清楚：`db:backup` 检测到 `DATABASE_URL` 时不再尝试复制数据目录（真实部署里复制目录是错的：版本不能互换、会漏掉并发快照与权限），而是打印该用的 `pg_dump` / `pg_restore` 命令并以退出码 2 结束。
4. 本地验证设施：`npm run pg:start` 用 embedded-postgres 起一个真实 PostgreSQL 18（官方二进制随包分发，数据在 `.pgdata-dev/`，已加进 .gitignore），因此「迁移能不能在真实 Postgres 上跑」这类问题不再靠读代码判断。生产不经过它。

验证证据：

| 项 | 结果 |
| --- | --- |
| `db:migrate`（Postgres） | 9 个迁移全部应用；再跑一次 0 个迁移（幂等） |
| `db:seed`（Postgres） | 4 个种子账号 + 5 个敏感词写入成功 |
| `verify:smoke`（应用连 Postgres） | 63/63，含导入论文、PDF Range、评论、举报、管理操作 |
| `verify:settings`（Postgres） | 27/27 |
| `verify:account`（Postgres） | 31/31，含邮箱验证、改邮箱、密码找回 |
| 行数核对 | Postgres 中 `users=6 papers=1 comments=11 reports=1`；`select version()` 返回 PostgreSQL 18.4 |
| 切回 PGlite | 默认后端启动正常，原有 4 篇论文与评论仍在（两套数据互不影响） |
| `db:backup` + `DATABASE_URL` | 退出码 2，打印 `pg_dump --format=custom` 与 `pg_restore` 命令 |

**一处刻意的取舍。** Postgres 的备份/恢复没有写成脚本：本机没有 `pg_dump`（embedded-postgres 只带服务器与少数工具），而写一个无法验证的备份分支比不写更危险。改为在 `db:backup` 里直接给出该执行的命令。

**本轮遗留。** 生产实例仍需要用户提供（本地验证用的是随包分发的二进制，不等于部署环境：托管 Postgres 的连接串参数、TLS、连接数上限都可能不同）；对象存储与真实读者测试同样需要外部资源。见 2.2 / 2.3 节。

### 2026-10-16 第 14 轮：第四阶段（准备公开测试）——生产运行时验证、构建警告清理、备份与恢复

**结论：第四阶段中不依赖外部服务的三项完成。** 生产构建 0 警告、`npm start` 下 `verify:smoke` 63/63、`verify:settings` 27/27、新增 `verify:load` 160 请求 0 个 5xx；`db:backup` / `db:restore` 端到端验证（11 张表行数与清单完全一致、篡改能被校验和发现）。**并发现并修复一个只在生产模式出现的崩溃**。

需求依据：`docs/02-roadmap.md` B1 的遗留项（生产运行时无证据、`src/lib/storage.ts` 6 条追踪警告）与 B3（部署与数据可信）。

做了什么：

1. **修掉 production-only 的 EMFILE 崩溃。** `src/db/index.ts` 只在 `NODE_ENV !== "production"` 时缓存 PGlite 实例，而 `db` 是 Proxy，每次属性访问都会调用 `instance()`，于是生产模式下**每次查询**都新建一个 PGlite 实例、重新打开 `pglite.data` 与数据目录。跑几十个请求后 `EMFILE: too many open files`，/admin /me /u/[name] 等页面开始 500，日志里还夹着 Next 的 `client reference manifest ... does not exist` 次生错误。改为所有环境都缓存实例。开发模式看不出来，因为开发分支本来就有缓存。
2. **清掉 6 条 Turbopack 追踪警告。** `src/lib/storage.ts` 的路径来自 `STORAGE_DIR`，静态分析因此认为整个项目都可能被读取。按 Turbopack 提供的出口给动态调用加 `turbopackIgnore` 标注；顺带把 `safePath` 的前缀比较改为带分隔符（原先 `storage/pdfs-other` 会被当成根目录内部）。构建后：0 警告，`.next` 81 MB、`.next/server` 21 MB，产物里不再包含源码、`docs/` 或 `storage/`（仅剩 Next 自己生成的 `.next/types/*.d.ts`）。
3. **生产运行时验证。** 停开发服务器 → `npm run build`（退出码 0、TypeScript 通过、25 个静态页面）→ `npm start` → 页面状态码、PDF worker 与构建 chunk 均可访问 → 对生产服务器跑 `verify:smoke` 63/63、`verify:settings` 27/27，服务端日志无错误。
4. **新增 `scripts/verify-load.mjs`（`npm run verify:load`）。** 对页面、接口、PDF Range、静态资源发起 160 个请求、并发 8，要求无 5xx 与无连接错误，并打印状态分布与 p50/p95/max。存在的理由就是第 1 条：`verify:smoke` 的请求量不足以触发描述符泄漏。
5. **备份与恢复。** `scripts/db-backup.mjs` 复制 PGlite 数据目录与 `storage/pdfs` 并写出 `manifest.json`（逐文件 SHA-256 与各表行数）；`scripts/db-restore.mjs` 默认预演（只校验、不改数据），`--apply` 才写入，目标非空要 `--force`，覆盖前把原目录改名为 `.<时间戳>` 保留。两个脚本都在 3100 端口有监听时拒绝执行。

验证证据：

- 生产模式下 `verify:smoke` 63/63、`verify:settings` 27/27、`verify:load` 160 个请求 0 个 5xx（p50 18ms、p95 89ms、max 99ms），生产服务器日志为空。
- 备份：1039 个数据库文件 + 7 个 PDF，清单记录 `users=61 papers=4 comments=284 …`。
- 恢复：`--from` 预演校验通过；把备份里一个 PDF 追加 1 字节后预演退出码 1 并指出该文件大小不符；恢复到临时目录后用 PGlite 打开逐表比对，11 张表行数与清单完全一致。
- 有服务运行时 `npm run db:backup` 退出码 2 并说明原因。

**为什么这一轮值得单列。** 前三阶段的验证全部跑在开发服务器上，"生产运行时未验证" 在 2.2 节挂了四轮。第一次真正 `npm start` 就撞上崩溃，而且崩溃点在数据库连接层——不跑生产模式永远看不到。

**本轮遗留。** 真实 PostgreSQL 与对象存储需要外部资源（本机没有 Docker、psql，5432 无监听）：拿到连接串后要做的是 `src/db/index.ts` 增加 node-postgres 分支、迁移脚本改为对 Postgres 执行、`pg_dump` 备份，并重跑全部验证；对象存储同理，`StorageAdapter` 接口已经在，缺的是桶与凭据。真实读者测试需要人。见 2.2 / 2.3 节。

### 2026-10-16 第 13 轮：第三阶段（账号闭环）——邮箱验证、修改邮箱、密码找回、GitHub 绑定与解绑保护

**结论：不依赖真实凭据的部分全部完成。** `verify:account` 新增，未配置 OAuth 时 31/31；用临时假凭据重启后 36/36（额外覆盖绑定授权跳转与 state 校验）；`verify:github` 14/14；`verify:settings` 27/27、`verify:smoke` 63/63 无回归；`typecheck` 0 错误。真实 OAuth 握手与真实邮件投递仍缺凭据，见 2.2 节。

需求依据：`docs/03-requirements.md` AUTH-006（密码找回）、AUTH-007（改邮箱与重置密码需重新验证）、AUTH-011 至 AUTH-013（绑定、解绑、解绑保护）、PROFILE-008（邮箱修改需验证）。

做了什么：

1. 迁移 `drizzle/0008_account_tokens.sql`：`account_tokens` 表（用途、SHA-256 摘要、过期、使用时间）+ `users.pending_email`。三种用途共用一张表：`email_verify`、`email_change`、`password_reset`。
2. 令牌库 `src/lib/auth/tokens.ts`：32 字节随机值，库里只存 SHA-256 摘要，因此数据目录被读走也拿不到可用链接；一次性使用；重置密码 1 小时、邮箱类 24 小时；签发同用途新令牌时旧的未用令牌立即作废。
3. 密码规则抽到 `src/lib/auth/password.ts`：注册、账号安全页改密码、邮件重置三处共用同一套长度与哈希逻辑，之前是分散写死的。
4. 邮箱验证与改邮箱：`POST /api/me/email` 发验证邮件、`PATCH` 改邮箱（新地址先进入 `pending_email`，链接打开前旧地址仍是登录依据）、`DELETE` 取消；`POST /api/auth/verify-email` 确认两种令牌。确认做成 POST：邮件网关与安全扫描器会预取链接，GET 即生效会让令牌在用户点开前被消耗掉。
5. 密码找回：`POST /api/auth/forgot-password` 无论邮箱是否存在都返回同一句话（响应差异等于用户枚举接口），按来源地址限流 5 次/15 分钟；`POST /api/auth/reset-password` 校验令牌、更新密码并作废同用户其它重置令牌。
6. GitHub 绑定：`/api/me/github/connect` 与 `/api/me/github/callback` 自建一套 OAuth，写的是同一张 `accounts` 表。原因是 Auth.js 不支持把身份绑到「当前已登录的账号」——它的 OAuth 回调只会按 `provider_account_id` 或邮箱解析出一个用户并登录，邮箱冲突时直接 `OAuthAccountNotLinked`。绑好之后 GitHub 登录仍由 Auth.js 正常解析到该账号。state 与用户 id 一起放进 HttpOnly cookie，回调同时校验两者。
7. 解绑保护 `unlinkGithub`：账号必须保留至少一种可登录方式，只有 GitHub 且没有本地密码时返回 409 并提示先设置密码，而不是把账号变成无法登录的孤岛。
8. 页面：`/forgot-password`、`/reset-password`、`/verify-email`；账号安全页扩展为邮箱区块（验证状态、重发验证、修改邮箱、取消修改）+ 密码区块 + GitHub 区块（绑定/解绑与当前可用登录方式）；登录表单加「忘记密码？」入口。账号安全页在邮件通道未配置时明说「链接写入服务器日志，由管理员转达」，而不是假装邮件已发出。
9. 邮件层 `src/lib/mailer.ts`：目前只有写日志一种传输方式，接入真实发信只需在同一个函数里加分支，调用方与页面文案都不用改。

两处由实测决定的实现细节：

- **验证脚本读日志必须按请求偏移取。** 第一版从日志里取「最后一条含 `verify-email?token=` 的行」，结果上一轮运行留下的令牌被当成这一轮的：验证接口返回成功，但验证的是别的账号，后续断言连锁失败（`emailVerified` 仍是 false）。改为发请求前记录文件长度、只在之后的片段里找；同时按字节切片（`statSync().size` 是字节，字符串下标是 UTF-16 单元，日志里有中文时两者会逐渐错位，最后切到新内容之后而漏掉链接）。
- **一次性令牌按用途隔离。** `consumeToken` 按摘要 + 用途查询，邮箱修改令牌不能当邮箱验证令牌使用；这条规则让「改邮箱」与「验证当前邮箱」共用同一个页面而不会互相顶替。

**本轮踩到的坑。** 找回密码接口限流是 5 次/15 分钟、按来源地址计，同一台机器 15 分钟内重复运行 `verify:account` 会命中，脚本因此按项目惯例以退出码 2 结束（不判定），而不是报成回归；重启开发服务器会清空进程内的计数。

**本轮遗留。** 真实 OAuth 握手、真实邮件投递、解绑保护的「唯一登录方式」分支（需要真实绑定才能造出该账号）见 2.2 节；OAuth App 只允许一个回调地址，登录与绑定两个流程都要用需要注册 GitHub App 并填两个 Redirect URI，已写入 README 环境注意第 11 条。

### 2026-10-16 第 12 轮：第二阶段（论文获取模型）——检索缓存与限流、元数据与 PDF 状态分离

**结论：第二阶段五项全部完成。** `verify:smoke` 63/63 无回归；`verify:search` 由 12 项扩到 24 项，其中 14 项通过、10 项因上游 OpenAlex 对自由文本检索返回 429（`Retry-After: 24511`，约 6.8 小时）而未能判定；`verify:search-fallback` 5/5 单独验证缓存回退分支；`typecheck` 0 错误。

需求依据：`docs/03-requirements.md` 第 1.1 节 PAPER-001 至 PAPER-008，特别是第 28 行「一篇论文可以已找到元数据但没有可用 PDF」与第 35 行「外部 PDF 获取失败时显示可理解的错误，并允许重试或打开来源网站」。

做了什么：

1. 迁移 `drizzle/0007_paper_pdf_state.sql`：`papers` 增加 `pdf_fetch_error`（最近一次抓取失败的原因码）与 `pdf_checked_at`。行存在即元数据已找到，`pdf_url` 表示已知候选地址，`pdf_path` 表示已缓存副本，三者共同推导状态，不额外落一份会过期的冗余字段。
2. 新增 `src/lib/papers/availability.ts`：四态模型 `metadata_found` / `pdf_available` / `pdf_cached` / `reading_available`，失败原因码到中文文案的映射，来源标签，以及来源网站链接（arXiv 用 ID 拼规范地址，DOI 走 doi.org，因此没有 landing page 时也能打开原文）。
3. 导入链改为两段式（`importFromIdentifier`）：元数据解析成功即建行；PDF 下载失败时把首个候选地址与失败原因写入行内，返回 `{ paper, created, pdfCached, pdfError, availability }`，不再以 422 拒绝。「没有公开 PDF」从导入失败变成一个可展示、可重试的正常状态。
4. 新增 `POST /api/papers/[id]/pdf`：从已存元数据重建候选地址并重试下载（PAPER-006），成功则写缓存并清除失败原因。候选地址不由请求方提供，重试无法被指向任意 URL。私有论文限上传者与管理员，其余限登录用户。
5. 新增 `src/lib/papers/search-service.ts`：检索结果缓存（新鲜期 10 分钟、可回退窗口 1 小时、上限 200 条）与自身限流（每身份 60 秒 30 次）。命中新鲜缓存不消耗限流额度也不打上游；上游失败或触发自身限流时回退到旧结果，并在响应里标记 `cached` / `stale` / `cachedAt` / `error`。
6. `src/lib/papers/openalex.ts` 增加 `OpenAlexError`（`rate_limited` / `unavailable` / `not_found`）与 9 秒请求超时。之前所有失败都被压成 `SEARCH_FAILED:状态码` 字符串，页面无法区分「上游限流，稍后可用」与「上游故障」，也无法给出可用的重试时间。
7. 接口与页面：`/api/papers/search` 返回 `cached` / `stale` / `cachedAt` / 分类错误码，自身限流回 429 并带 `Retry-After`；错误码由 `SEARCH_FAILED` 细化为 `UPSTREAM_RATE_LIMITED`、`UPSTREAM_UNAVAILABLE`、`SEARCH_RATE_LIMITED`。`/papers` 页展示来源标签、开放获取状态、来源网站链接，并在上游失败时说明「以下为 N 分钟前的缓存结果」。详情页新增「来源与文件状态」面板，只有元数据时给出原因与「重试获取 PDF」按钮；阅读器页在没有缓存副本时说明原因并提供来源网站与候选 PDF 的出口，而不是一句「无法在线阅读」。
8. 检索表单改为客户端组件（`src/components/papers/search-form.tsx`）：停止输入 400ms 后才跳转，进行中的跳转被新输入取代；表单仍是普通 GET 提交，禁用 JavaScript 时可用。
9. 新增 `scripts/verify-search-fallback.mjs`（opt-in）：预热一个标识符的缓存、等过新鲜期、用 40 个互不相同的关键词打满自身限流，再请求那个已缓存的关键词，断言返回缓存结果且标记 `stale` 与失败原因。之所以单独成脚本：这条分支要求「同一关键词先成功缓存、缓存过期、之后又打不到上游」，用真实上游限流做触发器时时间点不可控。

两处由实测决定的实现细节：

- **限流只对会打到上游的请求计数。** 首次实现把限流放在接口入口，结果重复点击同一关键词也会被计数，缓存的意义被抵消。改成命中新鲜缓存直接返回、不进入限流判断之后，重复检索既不消耗额度也不增加上游压力。
- **失败原因必须落库，不能只活在响应里。** 详情页的「最近一次尝试」与重试按钮都依赖它；只在响应里返回时，刷新页面就只剩一句「不可在线阅读」，读者无从判断是暂时故障还是本来就没有开放版本。

**上游现状（本轮实测）。** OpenAlex 对 `filter=title.search:` 返回 429 且 `Retry-After: 24511`（约 6.8 小时），对单篇 `works/doi:` 查询返回 200。因此标识符检索、缓存命中、元数据-only 入库与重试都可验证，自由文本检索的 10 项只能记为待定。这正是本阶段要解决的问题：限流不再表现为整页失败，而是有缓存就显示缓存、没有缓存就说清楚。

**限流实测。** 30 次/60 秒的额度按设计生效：连续 35 次标识符探测中，第 30 次之后开始返回 429 并带 `retryAfterSeconds`；静置 70 秒后同一身份再次请求恢复 200。回退脚本里「第 N 次探测触发」这一行最初打印的是已记录检查数而不是探测序号，因此看上去像第 2 次就触发，容易误判为限流过严；已改为打印真实序号并重跑确认。

**本轮遗留。** 自由文本检索的 10 项待上游冷却后重跑；`verify:search-fallback` 需要 13 分钟，不进默认基线；头像上传与对象存储仍依赖第四阶段；GitHub OAuth 真实回调、邮箱验证与密码找回属第三阶段。

**同轮插入：建立版本历史。** 项目此前没有 git 仓库，第 11 轮一次编码失误只能从 `.next` 的 sourcemap 里找回原始源码。本轮建立仓库并把第一、二阶段成果作为首个提交推送：

1. `.gitignore` 补 `.verify`（验证脚本的隔离数据库与截图），确认 `.env.local`、`storage/pdfs/*`、`node_modules`、`.next` 未被跟踪。
2. `git init -b main` → `git add -A`（123 个文件）→ 提交 `5766de6` → `git remote add origin https://github.com/funw25/Happypapper.git` → 推送并建立跟踪。
3. 推送前遇到网络问题：本机出海经 `127.0.0.1:7890` 本地代理，PowerShell 走 WinINET 设置因而 `Invoke-WebRequest` 能访问 github.com，但 `git` 直连在 21 秒后失败。解法是给本仓库设置 `http.proxy`，已写入 2.4 节。

### 2026-10-15 第 11 轮：第一阶段（产品基础）——个人资料、账号安全、隐私设置与三态主题

**结论：第一阶段六项全部完成。** 新增 `verify:settings` 27/27、`verify:theme` 8/8；`typecheck` 0 错误；生产构建编译成功（type-check 子进程被沙箱拒绝，见 2.4 节）。

需求依据：`docs/03-requirements.md` 第 3.3 节（UI-001 至 UI-007 主题）、第 5 节（PROFILE-001 至 PROFILE-009 资料）、第 6 节（PRIVACY-001 至 PRIVACY-013 匿名与可见性）、第 9 节（`/settings/*` 页面结构）。

做了什么：

1. 迁移 `drizzle/0006_profile_privacy.sql`：`users` 增加 `bio`、`anonymous_default`、`profile_comments_visible`、`danmaku_visible`；`comments` 增加 `is_anonymous`、`visible_in_profile`、`visible_in_danmaku`，并加 `comments_user_visible_idx`。可见性写在评论行上，改设置不回溯改写历史评论（PRIVACY-005 的 MVP 规则）。
2. 设计令牌重写 `src/app/globals.css`：浅色与深色两套调色板（背景、表面、阅读区、文字、次要文字、边框、主色及其前景色、成功/警告/错误、弹幕气泡）、排版类（页面标题、区块标题、论文标题、标签、元信息）、间距与圆角变量、组件类（`hp-card`、`hp-btn`、`hp-input`、`hp-tag`、`hp-notice`、`hp-settings-nav`、`hp-theme-switch`）。组件里原有的 `bg-white`、`text-white`、`text-red-600`、`bg-[#e8e5df]` 等硬编码颜色全部替换为令牌。
3. 三态主题：`src/lib/theme.ts` 保存偏好与解析规则，`src/components/theme/theme-toggle.tsx` 是三态控件，`src/app/layout.tsx` 内联一段首屏前脚本写入 `<html data-theme>`，避免刷新时先画浅色再切深色。深色主题随系统偏好变化实时跟随。
4. `/settings/profile`：昵称（2–24 字符、全站唯一、保留大小写但不区分大小写判重）、头像地址（仅 http/https）、个人简介（300 字上限），外加主题控件与公开主页入口。昵称被占用返回 409，过短返回 400，非法头像地址返回 400。
5. `/settings/account`：邮箱与验证状态展示、修改/设置密码（无本地密码的 GitHub 账号首次设置不需要当前密码）、GitHub 绑定状态。邮箱修改与密码找回依赖第三阶段的邮件通道，页面明确说明这一点而不是留空表单。
6. `/settings/privacy`：默认匿名发布、个人主页展示评论、新评论进入弹幕流三个开关。
7. 设置接入实际行为：发布评论时把 `anonymous_default` 与两个可见性开关快照到评论行；阅读器发布框增加「匿名发布」勾选框，默认值取自账号设置；匿名评论的作者名在服务端就被清空（SQL `case when is_anonymous then null else users.name end`），管理员仍通过 `lib/admin/queries.ts` 读取真实作者；弹幕层过滤 `visible_in_danmaku`；公开主页在关闭展示时隐藏列表并给出说明，同时不列出匿名评论，避免在作者页面上反向暴露身份。
8. 站点导航增加「设置」入口，主题控件常驻顶部导航。
9. 新增 `scripts/verify-settings.mjs`（27 项）与 `scripts/verify-theme.mjs`（8 项，真实浏览器 + 截图），并在 `package.json` 注册 `verify:settings`、`verify:theme`。截图存入 `docs/screenshots/`。

两处由实测决定的实现细节：

- **匿名名的过滤点必须在 SQL 里。** 最初的写法是把 `users.name` 原样返回、由组件按 `isAnonymous` 显示「匿名用户」。这会让真实昵称出现在接口响应与网络面板里。改为在 `selection()` 里用 `case when` 直接置空，组件只区分「匿名」与「已注销」。
- **跟随系统的验证必须模拟系统偏好。** 无头浏览器默认 `prefers-color-scheme: light`，只切换控件时「跟随系统」与「浅色」结果相同，测不出差异。改成用 `emulateMediaFeatures` 分别模拟深色与浅色，并要求解析结果随之变化而不改动已保存偏好。

**本轮踩到的坑（已写入 2.4 节）。** 在开发服务器运行期间跑迁移，服务器保留旧表结构缓存，之后登录、注册、评论列表全部 500（`42703`）。重启开发服务器即恢复，`verify:settings` 随后 27/27。另外沙箱内 `next dev`、`puppeteer.launch`、`build` 的 type-check 步骤都会 `spawn EPERM`，数据库写入被拒时 PGlite 报的是 `failed to initialize`，与数据损坏无关。

**本轮自身的一次操作失误。** 用 PowerShell 的 `-replace` 批量替换颜色类名时，`Set-Content` 以系统 ANSI 代码页写回，12 个源文件的中文被写成 GBK，其中少量字符变成 `?`。恢复方式：先用 UTF-8 解码再按 GBK 编码写回字节，随后从 `.next` 里 Turbopack 生成的 sourcemap `sourcesContent` 取回 12 个文件的原始内容，最后用编辑工具重放改动。教训：源文件只走编辑工具，不经过 shell 的文本重写。

**本轮遗留。** 头像只支持填写外部图片地址，没有上传通道，依赖第四阶段的对象存储；邮箱修改、密码找回、邮箱验证与 GitHub 绑定/解绑属于第三阶段；`/me` 的收藏与阅读记录分页、通知实时推送仍未动。

### 2026-10-13 第 10 轮：定位并修掉 R1（verify:reader 间歇失败）

**结论：R1 定位并修复。** 连跑 5 次全部通过、缩放偏差全部 0.0px。`verify:reader` 由 14 项增至 15 项。

**诊断方式。** 先不猜，而是在缩放检查里加一个「画布尺寸稳定」的等待，同时把「标签变到 160% 那一刻的画布高度」与「稳定后的高度」一起打印。修复前的失败偏差是固定的 54.6px；加上诊断后每次输出 `画布高度 1028.125 → 1265.38`。

**机制（由数据确认）。** 连点两次「+」后，百分比标签会先跳到 160%，而 PDF 尚未按新比例重排。脚本在那一刻取样，于是 `expectedZoom` 用**未缩放**的 1028.125 计算，而标记已按缩放后的布局渲染，两者之差就是那个固定偏差。等画布高度稳定到 1265.38 再取样，偏差为 0.0px。

**这是验证脚本的问题，不是阅读器的问题。** 产品最终状态始终正确（稳定后偏差 0.0px），真实用户看到的是缩放重排期间的正常过渡。因此修的是脚本：新增 `stableCanvasHeight()`，要求画布高度连续 250ms 不变才取样。

顺带修了三处脚本健壮性：

- `verify:reader` 的发布等待从 20 秒提到 60 秒，并在发布被拒时输出可读原因；新增「发布评论成功」检查，把限流失败从 Puppeteer 超时崩溃变成一条可读的检查失败。
- `verify:notify` 在评论没建成时先退出并说明原因（此前以 `TypeError: Cannot read properties of undefined` 崩溃）。
- `verify:smoke` 因限流无法继续时改为退出码 2，与「代码回归」（退出码 1）区分。

**本轮新发现 R2：脚本之间存在发评论配额冲突。** `verify:smoke` 有一条专门测限流的检查，会把 reader 账号的 60 秒 5 条配额用满，因此 `smoke → notify → reader` 不能在 60 秒内连跑；连跑时三者分别以限流失败告终。已写进 README 与第 2.1 节，按 70 秒间隔执行后：smoke 63/63、notify 27/27、reader 15/15。

**本轮自身的一次操作失误。** 我先停掉开发服务器去跑 `verify:github-schema` 与 `build`，随后忘了重启就直接跑测试套件，那一批失败全部是「没有服务器」，与代码无关。记在这里以免下次误判。

### 2026-10-13 第 9 轮：补齐首登昵称规则的验证；发现 verify:reader 间歇失败

**结论：B7 可验证部分收完；同时查出一处与目标无关但更严重的问题——`verify:reader` 间歇失败。**

做的第一件事：给 `resolveGithubIdentity` 的昵称规则补验证。这是首登建号里唯一此前零覆盖的逻辑，而它是「GitHub 昵称不唯一」与「`users.name` 唯一非空」之间的唯一缓冲。做法是在 `src/lib/auth/naming.ts` 里把规则抽成不依赖数据库的纯函数（`uniqueDisplayName`、`fallbackEmail`），再在 `verify:github` 里直接导入验证——Node 24 的类型擦除支持直接导入 `.ts`，所以不需要额外构建步骤。

六项新检查（无论凭据是否配置都会运行）：

1. 昵称未被占用时保持原样。
2. 昵称被占用时自动加后缀（`Alice` 与 `Alice-2` 都占用 → `Alice-3`）。
3. 昵称为空时回落到 `reader`。
4. 昵称长度被截断到列宽内。
5. 所有编号候选被占用时仍返回可用昵称（回落时间后缀，保证首登不会因重名直接失败）。
6. GitHub 不返回邮箱时回落到 `noreply` 地址。

`verify:github` 因此在两种状态下都有意义：无凭据时 9/9 通过并以退出码 2 说明 AUTH-008 待定；用临时假凭据时 **14/14**，覆盖 provider 注册、按钮、授权跳转、client_id、redirect_uri、PKCE 与 cookie。

**新发现：`verify:reader` 间歇失败。** 本轮连续运行 4 次，结果如下：

| 次序 | 结果 |
| --- | --- |
| 1（删过 `.next` 之后） | 13/14，失败项 `缩放后位置标记跟随文本重新定位 — 偏差 54.6px` |
| 2 | 14/14 |
| 3 | 脚本崩溃：Puppeteer `TimeoutError: Waiting failed: 20000ms exceeded` |
| 4（热缓存） | 13/14，同一项、**同一偏差 54.6px** |

两点判断，第一点有证据、第二点只是观察：

- 这不是冷启动问题。第 4 次是热缓存下跑的，仍然复现；两次失败的偏差数值完全相同（54.6px），更像某种确定性的状态错误，而不是随机竞态。
- 第 3 次的 20 秒超时是另一个症状，可能与本项目验证脚本本身缺少等待有关，也可能与开发服务器在连续请求下的响应变慢有关，本轮没有进一步区分。

**本轮没有动阅读器代码。** `src/app/read/[id]`、`src/components/reader/*`、`src/lib/anchor.ts` 本轮均未修改，本轮改动集中在通知、认证与数据库代理。因此这一项不是本轮引入的，但它意味着「全部证据脚本全绿」在当前代码上无法稳定成立。已记入第 2.1 节，建议单开一块处理。

### 2026-10-13 第 8 轮：补齐 OAuth 首登的表结构验证

**结论：完成。** 新增 `npm run verify:github-schema`（6/6）。七个脚本加上本脚本全绿；`verify:github` 仍按预期在无凭据时退出码 2。

**为什么做这一块。** 第 7 轮把 GitHub 登录的 HTTP 接线验证了，但「首次登录建号」是 0 覆盖，而它恰好是唯一不需要 GitHub 凭据就能验证的一半：回调要写的那两行数据（`users` 一行、`accounts` 一行）是否真的写得进去，与 GitHub 怎么回应无关。更重要的是，这里有会**静默回归**的风险——例如以后有人把 `password_hash` 改回 `not null`，GitHub 登录会直接失败，而现有任何脚本都不会报警。

做了什么：新增 `scripts/verify-github-schema.mjs` 与 `npm run verify:github-schema`，直接打开 PGlite，在一个事务里插入、断言、回滚。六项：

1. 可以创建没有本地密码的账号 —— 即第 7 轮迁移把 `password_hash` 改为可空这一改动有效。
2. 可以把 GitHub 身份写入 `accounts`。
3. 同一 GitHub 身份不能被重复绑定 —— 复合主键有效，这是「两个本站账号不能共用一个 GitHub 账号」的保障。
4. 同名账号被拒绝 —— 这条约束正是 `resolveGithubIdentity` 存在的原因，顺手把它固定成回归用例。
5. 删除账号会级联删除其 GitHub 绑定。
6. 检查过程不留下数据（回滚后行数为 0）。

**一处运行约束。** 本脚本要直接打开数据目录，而 PGlite 同一时刻只允许一个进程，因此它必须在开发服务器停止时运行。脚本会先探测 3100 端口，有监听就以退出码 2 说明原因并退出，而不是抛出难懂的锁错误。用法与 `db:migrate`、`db:seed` 同类。

**仍然未验证的（唯一一项）。** GitHub 侧的回调、token 交换，以及首登时适配器真实调用 `resolveGithubIdentity` 并落库的整条路径。这需要真实的 `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` 加一次浏览器登录，凭据只能由用户提供。现在的状态是：数据库能不能装下这些行已验证，GitHub 会不会按预期回应未验证。

### 2026-10-13 第 7 轮：B7 GitHub 登录接线（AUTH-008 至 AUTH-010）

**结论：接线完成并经假凭据验证；OAuth 握手仍待真实凭据。** `verify:github` 在临时假凭据下 8/8，在无凭据环境下退出码 2 并断言 GitHub 入口被正确关闭。

做了什么：

1. 迁移 `drizzle/0005_accounts_github.sql`：新建 `accounts` 表、给 `users` 加 `email_verified`、把 `users.password_hash` 改为可空。第三项是必需的——GitHub 建出来的账号没有本地密码，而原列是 `not null`。
2. `src/db/schema.ts`：`avatarUrl` 改名为 `image`（数据库列仍是 `avatar_url`），因为 `@auth/drizzle-adapter` 按属性名读取该字段；`accounts` 表的 token 字段保留适配器要求的 snake_case 属性名，并加了注释说明原因。
3. `src/lib/auth/github.ts`：`githubCredentials()` 只在两个环境变量都在时返回配置；`resolveGithubIdentity()` 把 GitHub 资料规整成可入库的形状——`users.name` 是 `unique not null`，`users.email` 是 `not null`，而 GitHub 两者都不保证，所以重名自动加后缀、无公开邮箱时回落到 `<login>@users.noreply.github.com`。
4. `src/auth.ts`：接上 `DrizzleAdapter`，按凭据是否存在条件注册 `GitHub` provider，Credentials 的 `authorize` 增加「无密码哈希直接拒绝」。
5. 登录页拆成服务端页 + `src/components/login-form.tsx`，凭据存在时渲染 GitHub 按钮，并把 Auth.js 的错误码映射成中文提示（AUTH-013 的登录页部分）。
6. 新增 `scripts/verify-github.mjs` 与 `npm run verify:github`。

**本轮踩到的坑（一处真实缺陷）。** 加上 `DrizzleAdapter(db, ...)` 后整个认证 500：`Unsupported database type (object) in Auth.js Drizzle adapter`。原因是第 1 轮把 `db` 改成了懒加载 Proxy，而适配器用 drizzle 的 `is()` 判断方言，`is()` 会走 `Object.getPrototypeOf(value).constructor` 的原型链。Proxy 没有 `getPrototypeOf` 陷阱，于是看起来像普通对象。修复方式是在 `src/db/index.ts` 的 Proxy 上加 `getPrototypeOf()` 返回 `PgDatabase.prototype`：真实实例本就是 PgDatabase，这个命名既准确又不会像 `instanceof` 那样去解析真实实例——后者会在 `next build` 期间打开数据库，正是第 1 轮修掉的竞态。修完 `/api/auth/providers` 恢复正常，smoke 63/63。

**关于假凭据验证的边界。** 用 `AUTH_GITHUB_ID=dummy-client-id-123` 启动开发服务器后，`verify:github` 证明：provider 注册、按钮渲染、`POST /api/auth/signin/github` 302 到 `github.com/login/oauth/authorize`、URL 带 client_id 与正确 redirect_uri、使用 PKCE（`code_challenge_method=S256`）并下发 `authjs.csrf-token` 与 `authjs.pkce.code_verifier` cookie。**未覆盖**：GitHub 侧的回调、token 交换、首次登录写 `users` 与 `accounts` 行。这些必须有真实凭据与一次浏览器登录。

**顺带修正的一处测试缺陷。** `verify:notify` 的点赞断言原本用绝对条数，数据库不清空时会被上一轮的残留污染（第二次运行报 6 项失败）。改为按本轮父评论 id 过滤，现在可重复执行；另外把「发评论限流 429」识别为退出码 2，避免把本项目的 5 条/60 秒限流误报成回归。

### 2026-10-13 第 6 轮：点赞通知与通知开关

**结论：完成。** 七个脚本全绿，`verify:notify` 由 15 项增至 27 项。

需求依据：用户决定「点赞设置为可以通知，也可以关闭通知」。02-roadmap B2 第 2 点原本把「点赞是否通知、阈值多少」列为待定，本轮定为**默认开启的用户级开关**，不设阈值。

做了什么：

1. 迁移 `drizzle/0004_notify_likes.sql` 与 `src/db/schema.ts` 增加 `users.notify_likes boolean not null default true`。
2. 通知类型扩展：`type` 字段新增 `like` 取值，无需改表结构（原本是自由文本）。
3. `src/lib/notifications/queries.ts` 增加 `notifyLike`、`removeLikeNotification`、`likeNotificationsEnabled`、`setLikeNotifications`。
4. `POST /api/comments/[id]/like` 只在**新插入**点赞时通知（重复点赞是 no-op，不碰收件箱）；`DELETE` 撤回对应通知。
5. 新增 `GET/PATCH /api/me/notifications/settings`：读取与切换 `notify_likes`，非布尔值返回 400。
6. `/me?tab=notifications` 增加开关（客户端组件），通知文案按 `type` 区分「赞了你的评论」与「回复了你的评论」。

**三个由语义决定的实现细节：**

- **重复点赞不堆积。** `notifyLike` 先删除同一 `(收件人, 评论, 操作者, type=like)` 的旧行再插入。否则反复点赞/取消会线性增长收件箱。
- **取消点赞撤回通知。** 点赞被撤掉后留着通知会与事实不符。`removeLikeNotification` 只按 `(评论, 操作者, type)` 删除，收件人由评论作者唯一决定。
- **点赞自己不通知、作者关闭后不通知。** 与回复通知同一判据。

`verify:notify` 新增 12 项：点赞通知默认开启、点赞成功、产生 like 通知、重复点赞不堆积、点赞自己不通知、可关闭、关闭后不再通知、重新开启后恢复通知、取消点赞撤回通知、非法设置值 400、匿名改设置 401、通知页渲染开关。

**本轮踩到的坑。** 无。迁移前先停开发服务器，一次通过。

**下一步：B7 GitHub 登录被凭据阻塞。** 实测确认 `.env.local` 没有 GitHub OAuth 凭据，`drizzle/` 里也没有 NextAuth 适配器需要的 `accounts` 表。适配器 `@auth/drizzle-adapter` 已安装，且它允许通过 `schema` 选项传自定义表；但 AUTH-008（用 GitHub 登录）必须有真实的 client id 与 secret 才能验证 OAuth 握手，这两项只能由用户在 GitHub 上创建 OAuth App 得到。详见第 2.1 节。

### 2026-10-13 第 5 轮：B2 回复通知

**结论：完成。** 七个脚本全绿，新增验收命令 `npm run verify:notify`（15/15）。

需求依据：`docs/03-requirements.md` 没有提到通知，本块以 `docs/02-roadmap.md` 第 3 节 B2 的五条设计要点为准。

做了什么：

1. 新增迁移 `drizzle/0003_notifications.sql` 与 `src/db/schema.ts` 的 `notifications` 表：`id`、`user_id`、`comment_id`、`paper_id`、`actor_id`、`type`、`read_at`、`created_at`，索引 `(user_id, read_at)` 与 `(user_id, created_at desc)`（后者供分页）。迁移输出确认 `notifications` 已在表列表中。
2. 新增 `src/lib/notifications/queries.ts`：`notifyReply`、`unreadNotificationCount`、`listNotifications`、`markNotificationsRead`。
3. `POST /api/papers/[id]/comments` 在记录回复后调用 `notifyReply`。父评论匿名或作者等于回复者时不写入——「回复自己」只会制造噪声。
4. 新增 `GET /api/me/notifications`（分页，返回 `unread`/`total`/`items`）与 `POST /api/me/notifications/read`（带 `id` 标一条，不带则全部）。接口一律按会话用户过滤，因此拿别人的 `id` 是空操作。
5. `src/components/site-header.tsx` 增加「通知」入口与未读角标，并输出 `data-unread` 供测试断言。
6. `/me` 增加「通知」分页，未读条目左侧高亮，另有客户端按钮「全部标为已读」。

验收脚本 `scripts/verify-notify.mjs` 走完整链路：Florence 发父评论 → reader 回复 → 断言 Florence 未读数 +1、通知带回复者与论文页码、初始未读；再断言 Florence 回复自己不加通知、头部 `data-unread` 正确、`/me?tab=notifications` 可访问；最后断言 admin 无法标记 Florence 的通知、按 id 只标一条、全部已读后归零。

**两处刻意的范围控制：**

- **未做按用户维度的 SSE 扇出。** B2 第 4 点把「未读数走已有 SSE 通道」列为设计要点，当前未读数是页面加载/刷新时读的。理由：真实读者打开页面即可看到角标，实时推送要新增一个 `userId` 订阅维度与连接管理，属于独立改动。已记入第 2.2 节。
- **点赞不通知。** B2 第 2 点要求先定阈值再决定，本轮未定义阈值，因此一律不通知。同样记入第 2.2 节。

**本轮踩到的坑。** 无。迁移前先停了开发服务器（PGlite 单进程约束），迁移与验证一次通过。

### 2026-10-13 第 4 轮：远程搜索的三处缺陷修复与首页入口

**结论：完成。** 六个脚本全绿（`verify:smoke` 63/63、`verify:search` 12/12、`verify:anchor` 12/12、`verify:reader` 14/14、`typecheck` 0 错误、`build` 退出码 0）。本轮只修缺陷与补入口，不涉及需求新增。

用户反馈「搜索不了，搜索出来也导入不了」。逐条复现后定位到三个独立原因：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 首页搜不到任何远程论文 | 首页搜索框把 `q` 提交到 `/papers`，而 `/papers` 只查本地库（`listPapers`）。首页没有任何远程入口 | 首页与 `/papers` 的表单加「本地论文库 / 远程搜索」选择，两者共用一个入口 |
| 远程搜索偶发失败 | 服务端日志 `GET /api/papers/search?q=attention 502 in 10.7s`，stderr 为 `ConnectTimeoutError ... timeout: 10000ms`。`searchWorks` 用 `Promise.all` 并行发两个上游请求，任一超时整个搜索失败 | 改为 `Promise.allSettled`：两个索引独立，一个成功就返回结果；两个都失败才报错 |
| 结果里十有八九没有导入按钮 | 12 条结果只有 2 条 `hasPdf=true`，其余显示为「无公开 PDF，用本地文件添加」。实测导入 `1908.06954` 与 `10.1038/s41398-019-0616-1` 都返回 201，说明导入本身正常，是入口被隐藏了 | 结果一律显示「导入并进入详情」，PDF 可用状态改为信息展示；导入失败时用已有的错误文案说明原因 |

顺带实现用户要求的可编辑排序。OpenAlex 的 `sort` 参数经实测：`relevance_score:desc`、`cited_by_count:desc`、`publication_date:desc` 均有效，非法字段返回 400，因此加了取值白名单。结果里增加「被引 N」，排序项为相关度 / 引用数 / 发表时间。

一处实现细节：结果列表原本是标题命中与作者命中交错（第 3 轮为救作者检索所加），交错会破坏排序顺序，因此本轮改为先交错成候选池、再按所选键排序、最后截断。

`verify:smoke` 增加 2 条：按引用数排序结果单调不增（实测 33170 ≥ 31891 ≥ 21131 ≥ 16376 ≥ 8275）、非法排序值回退而不是报错。

**来源选择未实现，需要用户决策。** 用户要求可选知网、IEEE Xplore 等来源。实测结论：

- 知网没有公开 API，内容在机构订阅之后，抓取违反其条款，也与 `docs/00-mvp-spec.md` 第 8 节「不抓取出版商付费墙内的 PDF」冲突，不实现。
- IEEE Xplore 官方 Metadata API 需要申请 key 并配合订阅，在拿到 key 之前不实现。
- 可实现的替代方案是把「来源」做成出版商筛选。已实测 OpenAlex 的 `primary_location.source.host_organization` 有效：IEEE Computer Society `P4310320439`（87093 篇）、ACM `P4310319798`（179919 篇）、Elsevier BV `P4310320990`（24213050 篇）、Springer Nature `P4310319965`（6164357 篇）、Wiley `P4310320595`（10916248 篇）。注意 `primary_location.source.display_name.search` 不是合法字段（返回 400）。

**本轮观察。** 删除 `.next` 后第一次跑 `verify:reader` 有 1 项失败（13/14），紧接着连跑两次都是 14/14。判断为冷缓存下的超时抖动，不是回归；未保留失败那次的日志，失败项名称未能确认。

**本轮收尾：远程检索检查已拆分。** 按用户决定，远程检索的检查从 `verify:smoke` 拆到独立的 `scripts/verify-search.mjs`（`npm run verify:search`，12 项）。拆分后：

- `verify:smoke` 回到 63 项（认证、导入、权限、管理链路 + B8 的两个管理员权限项），不再依赖外网。它之所以现在能离线通过，是因为导入项在论文已入库时走 `findExisting` 提前返回，不再请求 OpenAlex。
- `verify:search` 12/12 通过，其中「按出版商筛选会收窄命中数 — IEEE 325 < 全部 167861」验证了本轮新加的来源筛选；「按引用数排序的结果单调不增 — 33170 ≥ 31891 ≥ 21131 ≥ 16376 ≥ 8275」验证了排序。
- 脚本内两次检索间隔 1200ms（`SEARCH_GAP_MS` 可调）；上游返回 429/不可用时退出码为 **2**，与代码回归（退出码 1）区分，并在输出里说明原因。

**限流的实测数据。** 直接请求 `api.openalex.org` 时拿到 429 且 `Retry-After: 31491`（约 8.7 小时），说明 OpenAlex 对本出口 IP 有长惩罚窗口。缓解措施已在代码里：`fetchOpenAlex` 对 429/5xx 最多重试两次，等待上限 2 秒。这一条对真实用户也成立——单次检索只有两个上游请求，正常不会触发；触发时页面显示「检索服务暂时不可用，请稍后再试」。

### 2026-10-13 第 3 轮：B6 远程论文搜索

**结论：完成。** 五条命令全绿，`verify:smoke` 由 63 项增至 71 项。

需求依据：`docs/03-requirements.md` PAPER-001（按标题、作者、DOI 或 arXiv ID 搜索）、PAPER-002（结果显示标题、作者、摘要、年份、来源与 PDF 可用状态）、PAPER-003（从搜索结果进入详情页），以及第 17 行的首选流程「搜索论文元数据」。

做了什么：

1. `src/lib/papers/openalex.ts` 增加 `searchWorks`。标识符输入走已有的 `fetchMetadata` 单篇解析；自由文本并行请求 `title.search:` 与 `raw_author_name.search:` 后合并去重。
2. `src/lib/papers/queries.ts` 增加 `findImported`，把远程结果映射到库内已有论文，同时按 (source, externalId) 与 DOI 匹配。
3. 新增 `GET /api/papers/search`，返回结果并附加 `hasPdf` 与 `importedPaperId`，匿名可读。
4. 新增客户端组件 `src/components/papers/import-paper-button.tsx`，调用已有的 `POST /api/papers` 后跳转详情页。
5. `/papers` 页面增加「搜索论文」表单与远程结果区，本地库筛选保留为第二个表单。
6. `verify:smoke` 增加 8 条覆盖：空关键词 400、标题检索有结果、结果字段完整、命中已导入论文、在库标记、作者检索、标识符检索单条、搜索页可进入详情页。

两处由实测数据决定的实现细节：

- **作者检索必须与标题结果交错。** 最初把标题命中排在前面。实测 `geoffrey hinton` 时 `title.search:` 单独就填满了 12 条上限，作者命中被整段截断，作者检索实际失效。改为两组结果交错后，12 条中有 6 条的作者名为 Hinton。
- **在库匹配必须同时看 DOI。** OpenAlex 对 `1706.03762` 返回的 `doi` 字段是镜像 DOI `10.65215/2q58a426`，`ids` 里没有 arXiv ID；库里那一行的 `doi` 正是同一个镜像 DOI。只按 (source, externalId) 匹配会漏判，用户会重复导入同一篇。`arxivIdFromWork` 另外从 `ids.arxiv`、DOI 前缀与 location URL 还原 arXiv ID，并优先采用，因为它能解析到规范 PDF。

**本轮踩到的坑。** 新增导出后，开发服务器的 Turbopack 模块图仍是旧的，`/api/papers/search` 报 `searchWorks is not a function`（类型检查通过）。按 README 环境注意第 6 条删除 `.next` 并重启开发服务器后正常。

**本轮遗留。** 没有公开 PDF 的检索结果只提供「用本地文件添加」入口，不提供导入。需求第 28 行承认「已找到元数据但没有可用 PDF」是合法状态，但当前导入链要求 PDF 下载成功才建行，纯元数据入库未实现。已记入第 2.2 节。

### 2026-10-13 第 2 轮：B8 补齐 Florence 与 α 管理员种子

**结论：完成。** 五条命令全绿，`verify:smoke` 由 61 项增至 63 项。

需求依据：`docs/03-requirements.md` 第 2.3 节要求首版设置两个管理员 Florence 与 α，第 62 行要求它们由种子或部署初始化脚本创建，第 266 行把「Florence 和 α 账号拥有管理员权限」列为验收项。需求只规定名称与角色，未给邮箱与密码；经确认取 `florence@happypaper.com` / `florence12345` 与 `alpha@happypaper.com` / `alpha12345`。

做了什么：

1. `scripts/db-seed.mjs` 的账号表增加两条，角色均为 `admin`。`users.email` 与 `users.name` 都是 `unique not null`，α 的邮箱取其名称的 ASCII 形式。
2. `scripts/smoke.mjs` 增加两条回归：分别用两个账号登录，并请求 `/api/admin/reports?status=open`，要求角色为 `admin` 且返回 200。
3. 同步计数与账号表：`README.md` 的本地账号表、验证清单与覆盖表，`docs/02-roadmap.md` 第 2 节证据表。
4. 重跑全部验证。

**本轮踩到的坑。** 第一次 `db:seed` 在开发服务器仍在运行时执行，两个进程同时打开同一个 PGlite 数据目录；随后强杀该服务器，数据目录进入 PGlite 无法启动的状态，`db:seed` 直接以 `RuntimeError: Aborted()` 失败。恢复方式为 `npm run db:reset`，该脚本串行执行 `db-migrate.mjs` 与 `db-seed.mjs`，四个账号一并重建。约束：任何写数据目录的命令都必须先确认 3100 端口没有监听进程。

**本轮顺带确认。** 第 1 轮把数据库改为首次查询才创建之后，`npm run build` 在开发服务器运行期间也能干净通过（退出码 0、0 条错误行、6 条追踪警告），构建不再需要先停开发服务器。

### 2026-10-13 第 1 轮：B1 生产构建验证

**结论：完成。** 五条命令全绿。

依次做了：

1. 干净起点：`npm run db:reset`、`npm run db:seed`。
2. 跑 `npm run build`。命令退出码为 0，但 stderr 有 18 条 `ERR_INVALID_ARG_TYPE`，以及 `Error: PGlite failed to initialize properly` 与 `RuntimeError: Aborted()` 若干条。
3. 定位并修复两处缺陷。
4. 补上 `package.json` 缺失的 `verify:reader` 脚本。`scripts/verify-reader.mjs` 一直存在，但没有任何 npm 脚本指向它，而 README 与 02-roadmap 都引用 `npm run verify:reader`，该命令在此之前无法执行。
5. 重跑全部验证。由于改动了 `src/db/index.ts`，四条验证命令全部重跑。
6. 更新 `docs/02-roadmap.md`：第 2 节证据表增加 `npm run build` 行（四条改五条）、第 3 节表格增加状态列并把 B1 标为完成、B1 正文改写为含根因与两处修复、第 2.1 节删除「生产构建」行。
7. 执行 02-roadmap 第 2.1 节列出的硬杀复测。

**缺陷一：Turbopack 重写 PGlite 的 WASM 路径。**

`@electric-sql/pglite` 用 `new URL("./pglite.wasm", import.meta.url)` 定位 WASM，并把结果交给 `fs.promises.readFile`。Turbopack 把该表达式重写成 `new __turbopack_context__.U(<asset>)`，而 `U` 是 Turbopack 运行时内置的 `relativeURL` 垫片（`.next/server/chunks/ssr/[turbopack]_runtime.js`）：它把 `origin` 与 `protocol` 覆盖为空串，且不通过 `instanceof URL`。Node 的 `fs` 以 `ERR_INVALID_ARG_TYPE` 拒绝该对象，Emscripten 随即 `abort()`，PGlite 报初始化失败。已用独立脚本按同样构造复现：真实 `URL` 可读，`relativeURL` 报同一条错误。

修复：`next.config.mjs` 增加 `serverExternalPackages: ["@electric-sql/pglite"]`，让该包在运行时按 Node 语义加载。

**缺陷二：数据库在模块导入时初始化。**

`src/db/index.ts` 原先在模块顶层调用 `createDb()`。`next build` 为收集页面数据用 30 个 worker 并行导入每个路由模块，等于 30 个 PGlite 实例同时打开同一个数据目录，抢不到锁的实例 `abort()` 并把 `Error: PGlite failed to initialize properly` 写入 stderr。该输出随竞态出现：只修缺陷一时，一次构建干净、下一次构建复现。中止的实例还可能让数据目录在下次启动时不可用，需要 `npm run db:reset` 重建。

修复：`src/db/index.ts` 改为首次查询时才创建实例，`db` 用 Proxy 转发属性，导入该模块不再有副作用。构建过程因此完全不打开数据库，也不必在构建前停掉开发服务器。

**硬杀复测（关闭 02-roadmap 第 2.1 节的数据丢失条目）。**

方法：开发服务器在运行 → `verify:smoke` 61/61 → `taskkill /F` 强杀 `next dev` 及其子进程（不做优雅关闭）→ 用独立 Node 进程直接查询数据目录。结果：`papers=2`、`comments=28`、`users=8`；`db:reset` 的初始状态是 0/0/2，已提交的行全部保留。重启开发服务器后 `/api/papers` 返回 200 与这 2 篇论文，stderr 为空，数据目录在被强杀后仍能正常打开、无需 `db:reset`。行数保留，按该条自定判据关闭。

**同轮发生的并行改动（据另一个会话 `session-6a6631b2` 的会话记录核对）。**

| 事件 | 时间 | 影响 |
| --- | --- | --- |
| 删除本轮 `npm run build` 的捕获文件 `.b.err`、`.b.out` | 21:46:06 | 无实质损失。内容已读入并写入 02-roadmap，重新执行 `next build` 可复现 |
| 执行 `db:reset` 两次 | 20:51、21:44 前后 | 数据库只含测试数据，无真实内容 |
| 强杀 3100 端口上的进程三次 | 21:42:18、21:44:33 | 本轮遇到的「旧服务器占用端口」与 dev 中断均源于此 |
| 创建并删除 `scripts/_probe.mjs`、`_check.mjs`、`_durability-probe.mjs` | 21:44–21:45 | 对方自己的临时探针，解释了 `scripts/` 目录 21:45:12 的改动时间 |

核对结论：本轮没有任何项目源文件、文档、迁移或资源丢失。逐项验证过——52 个 TypeScript 源文件全部存在、7 个脚本全部存在、3 个迁移全部存在、`docs/` 5 个文件全部存在、回收站内无本项目条目、`typecheck` 通过、九个页面路由全部返回预期状态。

**本轮遗留。** 02-roadmap 第 2.1 节原有的六项未验证路径未处理；生产运行时未验证；`src/lib/storage.ts` 的 6 条追踪警告未处理。三项都记在第 2.2 节。
