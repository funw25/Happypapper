# HappyPaper

面向论文阅读的位置化评论与实时弹幕平台。读者在论文的具体位置留下评论，后来的读者读到同一位置时看到这些评论。

范围定义见 [docs/00-mvp-spec.md](docs/00-mvp-spec.md)，技术栈决策见 [docs/01-stack-decision.md](docs/01-stack-decision.md)。

## 运行

不需要 Docker，也不需要单独安装数据库：PGlite 在进程内运行 Postgres。

```bash
npm install --ignore-scripts   # esbuild 的 postinstall 在受限沙箱下会失败，忽略它不影响本项目
npm run db:migrate             # 建表
npm run db:seed                # 创建 admin / reader 两个本地账号
npm run pdf:worker             # 把 pdf.js worker 复制到 public/
npm run dev                    # http://localhost:3100
```

打开 `http://localhost:3100`，用 `reader@happypaper.local` / `reader12345` 登录，进论文点「开始阅读」。

本地账号：

| 邮箱 | 密码 | 角色 |
| --- | --- | --- |
| admin@happypaper.local | admin12345 | 管理员 |
| reader@happypaper.local | reader12345 | 普通用户 |
| florence@happypaper.com | florence12345 | 管理员（Florence） |
| alpha@happypaper.com | alpha12345 | 管理员（α） |

## 数据库后端

后端由 `DATABASE_URL` 决定，schema、迁移文件与查询代码两边完全一样：

| 环境变量 | 后端 | 用途 |
| --- | --- | --- |
| 不设置 | PGlite（数据目录 `PGLITE_DATA_DIR`，默认 `../happypaper-data/pgdata`） | 本地开发与全部验证脚本的默认形态，不需要装数据库 |
| `DATABASE_URL=postgres://…` | 真实 PostgreSQL（`pg` 连接池） | 部署形态 |

`npm run db:migrate` / `db:seed` / `db:reset` 都按这个规则选后端：PGlite 下 reset 删数据目录，Postgres 下 reset 重建 `public` schema。备份不同：PGlite 用 `npm run db:backup`，Postgres 用 `pg_dump`（`db:backup` 检测到 `DATABASE_URL` 时会直接打印该用的命令并退出，不会生成一份错的备份）。

**本地想用真实 Postgres 验证**，不必先装数据库：

```bash
npm run pg:start     # 前台起一个真实 PostgreSQL 18（embedded-postgres，数据在 .pgdata-dev/）
# 另一个终端：
$env:DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5433/happypaper"
npm run db:migrate ; npm run db:seed ; npm run dev
```

`pg:start` 只是本地验证工具，生产不经过它。**已验证**（2026-10-16，PostgreSQL 18.4）：9 个迁移全部应用且重跑幂等、种子账号写入成功、`verify:smoke` 63/63、`verify:settings` 27/27、`verify:account` 31/31 全部对着真实 Postgres 跑通，数据确认落在 Postgres 表中；切回默认 PGlite 后原有 4 篇论文与评论未受影响。

## 存储后端

PDF 存放位置由 `STORAGE_DRIVER` 决定，接口只有 `put` / `getStream` / `stat` / `delete`，因此切换驱动不需要改任何业务代码：

| `STORAGE_DRIVER` | 后端 | 配置 |
| --- | --- | --- |
| 未设置（默认） | 本机磁盘 `storage/pdfs` | `STORAGE_DIR` |
| `s3` | 任意 S3 兼容对象存储（AWS S3、R2、MinIO、OSS 的 S3 端点） | `S3_BUCKET`（必需）、`S3_REGION`、`S3_ENDPOINT`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_FORCE_PATH_STYLE` |

规则与数据库一致：显式写了 `STORAGE_DRIVER` 就用它，没写但配置了 `S3_BUCKET` 就用 s3，否则用本机磁盘。服务器启动时会打印一行 `[storage] driver=…`，`verify:storage` 就靠这一行确认自己验的是哪个驱动，而不是靠猜。

**本地想验证对象存储**，不必先准备桶：

```bash
npm run s3:start                 # 前台起一个 S3 兼容服务端（s3rver，数据在 .s3-dev/）
# 另一个终端：
$env:STORAGE_DRIVER = "s3" ; $env:S3_BUCKET = "happypaper-pdfs"
$env:S3_ENDPOINT = "http://127.0.0.1:4568"
$env:S3_ACCESS_KEY_ID = "S3RVER" ; $env:S3_SECRET_ACCESS_KEY = "S3RVER"
npm run storage:migrate          # 把 storage/pdfs 里已有的 PDF 复制进桶（幂等）
npm run dev
npm run verify:storage           # 加 EXPECT_STORAGE_DRIVER=s3
```

`storage:migrate` 是切换驱动时**必需**的一步：`pdf_path` 存的是对象键、不含驱动信息，切到 s3 之后库里的键指向的正是桶里的对象，原来的文件不会自己跟过去；少了这一步页面会显示「可在线阅读」而点开是 404。脚本幂等，已存在且大小相同的对象跳过。

**头像不使用存储**：全站统一的头像是昵称的前两个字符，底色与字色由用户在资料页选择（默认克莱因蓝底 `#002FA7` + 白字），由 `src/components/avatar.tsx` 渲染。因此头像不受外链失效影响，也不需要对象存储参与；`users.image` 只记录 OAuth 提供方给的头像地址，不用于展示。颜色取值统一走 `src/lib/avatar.ts`，非法值回落默认色，页面不会渲染出透明头像。

**已验证**（2026-10-16）：`verify:storage` 在 local 与 s3 两个驱动下各 11/11（上传、完整下载逐字节比对、Range 区间逐字节比对、越界 416、下架删除后 404），S3 侧 `verify:smoke` 63/63，桶内对象数与迁移数一致，切回 local 后原有 8 个 PDF 照常提供；`verify:settings` 36/36 在 local 与 s3 下各跑一遍（头像 9 项包含「保存资料时不带头像字段不会清掉上传的头像」）。本机验证用的是 s3rver，不等于真实对象存储：签名校验、存储类别与生命周期策略仍需在你的桶上复测一次。

### 环境注意

1. **数据库不在项目目录内。** 数据目录由 `PGLITE_DATA_DIR` 指定，默认 `../happypaper-data/pgdata`，即仓库旁边。原因是 Next.js 开发服务器会监视项目树，而 Postgres 每次查询都会写 WAL 与统计文件；数据库放在项目内会形成「写文件 → 重新编译 → 页面重载 → 再查询」的死循环。
2. **用 `localhost` 而不是 `127.0.0.1` 打开。** 两个来源都已加入 `allowedDevOrigins`；若新增其他来源，需要同步加进 `next.config.mjs`，否则页面会渲染但不 hydrate。
3. **迁移前先停掉开发服务器。** PGlite 同一时刻只允许一个进程打开数据目录。
4. **被强杀后** PGlite 可能在下次启动时直接 abort（Postgres 崩溃恢复在它的单进程模式下不生效）。恢复命令：

```bash
npm run db:reset     # 删除数据目录，重新执行全部迁移与种子
```

5. **`PGLITE_DATA_DIR` 必须由 `serverExternalPackages` 保住。** `next.config.mjs` 里的 `serverExternalPackages: ["@electric-sql/pglite"]` 不是可选优化。缺了它，Turbopack 会把 PGlite 加载 `pglite.wasm` 用的 `new URL("./pglite.wasm", import.meta.url)` 重写成自己的 `relativeURL` 垫片，`fs` 以 `ERR_INVALID_ARG_TYPE` 拒绝，于是开发服务器与生产构建的 stderr 都刷满 `RuntimeError: Aborted()` 与 `PGlite failed to initialize properly`。加回这一行后 stderr 完全干净。
6. **开发服务器崩溃后先删 `.next` 再重启。** 修改 `next.config.mjs` 会触发服务器自动重启，重启期间 Turbopack 的持久缓存可能损坏并 panic（`failed to open ... .sst`），进程直接 Aborting。处理方式：`Remove-Item .next -Recurse -Force`，然后 `npm run dev`。
7. **后台启停要确认子进程真的退出。** `npm run dev` 会派生出 `next dev` 子进程；包装进程结束时子进程可能仍然存活并占着 3100 端口与数据库目录锁，表现为再次启动时报 `EADDRINUSE`、或直接操作数据库时报 PGlite abort。
8. **本地数据在修复前不可信，修复后未复测。** 在第 5 条的修复之前观察到：开发服务器崩溃后，数据目录回到 `npm run db:reset` 写入的状态，运行期导入的论文、评论、注册用户全部消失；单独验证过普通 Node 进程被强杀时已提交的行会保留，所以丢失只出现在开发服务器这条路径。修复针对的正是那条路径的初始化失败，症状应当随之消失，但尚未做硬杀复测。复测方法：起服务器、跑 `verify:smoke`、强杀 `next dev` 子进程、再查 `papers` 行数。
9. **推送需要代理。** 本机出海经 `127.0.0.1:7890` 的本地代理，PowerShell 的 `Invoke-WebRequest` 走 WinINET 设置因此能访问 github.com，而 `git` 与 `curl.exe` 不读该设置，直连会在约 21 秒后失败。仓库已设置 `git config --local http.proxy http://127.0.0.1:7890`；换机器或代理端口变化时需要重设。
10. **改源码会清空检索缓存。** 开发服务器热更新会重新求值服务端模块，而检索结果缓存与限流计数都在进程内存里。`verify:search-fallback` 需要连续 11 分钟不发请求，运行期间不要编辑源码，否则脚本按「不判定」结束。
11. **GitHub OAuth 需要两个回调地址。** 登录走 `http://localhost:3100/api/auth/callback/github`（Auth.js），账号绑定走 `http://localhost:3100/api/me/github/callback`（自建，因为 Auth.js 不支持把身份绑到当前账号）。GitHub OAuth App 只允许填一个回调地址，因此两个流程都要用时请注册 GitHub App 并把两个地址都加进 Redirect URIs；只填一个时另一个流程会在授权页报 `redirect_uri_mismatch`。
12. **邮件通道未配置。** `src/lib/mailer.ts` 目前只有写日志一种传输方式，验证与重置链接以 `[mail] {...}` 形式写入 `.next/dev/logs/next-development.log`，由管理员转达。接入 SMTP 只需在该文件加一个传输分支，页面与令牌逻辑不用改；`verify:account` 正是从这份日志里取令牌，因此配置真实邮件后脚本改从邮箱取链接即可，断言不变。

## 验证

七个脚本都可重复执行，退出码 0 表示全部通过。

```bash
npm run verify:smoke          # 63 项，需要开发服务器在运行
npm run verify:notify         # 27 项，回复与点赞通知、通知开关，需要开发服务器在运行
npm run verify:search         # 24 项，远程论文检索与缓存，需要开发服务器 + 外网；被上游限流时退出码 2
npm run verify:search-fallback # 5 项，缓存回退分支，约 13 分钟，按需运行
npm run verify:search-ui      # 4 项，检索表单防抖与结果渲染，需要开发服务器 + 本机 Chrome/Edge
npm run verify:github         # 14 项，GitHub 登录接线与首登昵称规则；无凭据时 9 项通过并退出码 2（表示待定）
npm run verify:github-schema  # 6 项，OAuth 首登要写的表结构；需要先停掉开发服务器
npm run verify:account        # 31 至 36 项，邮箱验证、修改邮箱、密码找回与解绑保护，需要开发服务器
npm run verify:anchor         # 12 项，独立运行，读取 storage/pdfs 里最新的 PDF
npm run verify:reader         # 15 项，需要开发服务器 + 本机 Chrome/Edge
npm run verify:settings       # 27 项，个人资料、密码、隐私设置与评论署名联动，需要开发服务器
npm run verify:theme          # 8 项，三态主题与深色令牌，需要开发服务器 + 本机 Chrome/Edge
npm run typecheck             # tsc --noEmit
```

`verify:github-schema` 直接打开 PGlite，而 PGlite 同一时刻只允许一个进程，所以它必须在开发服务器停止时运行；检测到 3100 端口有监听时它会以退出码 2 说明原因并退出。它在一个事务里插入、断言、回滚，因此不留任何数据。

| 脚本 | 覆盖 |
| --- | --- |
| `verify:smoke` | 登录注册、论文导入、PDF Range 读取、阅读进度、收藏、发布定位评论、锚点字段落库与读回、点赞、回复、举报、管理员删除、越权删除被拒、敏感词、空内容、非法锚点、限流、删除自己的评论、匿名写入被拒、SSE 在线人数与新评论推送、`/me` `/u/[name]` `/admin` `/legal/takedown` 的访问控制、举报处理、隐藏/恢复评论、禁言/解除禁言、论文下架与恢复、Florence 与 α 两个具名管理员的后台权限 |
| `verify:notify` | 回复通知与点赞通知：他人回复后被回复者收到未读通知、未读数增加、通知含回复者与论文页码、自己回复自己不产生通知、站点头部未读角标、`/me` 通知分页、不能标记他人的通知、按 id 只标一条、全部已读后归零、匿名访问被拒；点赞通知默认开启、点赞产生通知、重复点赞不堆积、点赞自己不通知、可关闭与重新开启、取消点赞撤回通知、非法设置值被拒、通知页渲染开关 |
| `verify:search` | 远程检索：空关键词拒绝、按标题/作者/arXiv ID/DOI 检索、结果字段完整性、在库标记、从结果进入详情页、排序单调性、非法排序回退、按出版商筛选收窄命中数、未知来源回退；缓存：重复检索命中缓存、缓存带时间戳且不算失败；来源与可用性：结果卡片标注 arXiv/DOI 与「有公开 PDF / 仅元数据」、提供来源网站链接；论文获取模型：没有公开 PDF 的 DOI 仍能保存元数据记录、响应把元数据与 PDF 状态分开、失败原因入库、详情页给出原因与重试入口、无缓存副本时阅读器页说明原因而不是假装可读、重试接口从已存元数据重建候选且失败原因保留 |
| `verify:search-fallback` | 缓存回退分支（约 13 分钟，按需运行）：标识符检索写入缓存、重复检索命中缓存、等待超过新鲜期、用互不相同且立刻 404 的 DOI 打满自身限流、再请求已缓存的关键词并断言返回缓存结果且标记 `stale` 与失败原因。单独成脚本的原因：该分支要求「同一关键词先成功缓存、缓存过期、之后又打不到上游」，用真实上游限流做触发器时时间点不可控 |
| `verify:search-ui` | 真实浏览器：在远程模式下逐字快速输入 10 个字符，断言只落地 1 至 2 次检索跳转且最后一次带上完整关键词（防抖生效）；结果区渲染出论文或可理解的空状态；用键盘清空关键词后回到本地论文库视图 |
| `verify:github` | GitHub 登录接线与首登昵称规则：昵称未被占用时保持原样、被占用时自动加后缀、为空时回落默认名、长度截断、候选耗尽时仍返回可用昵称、无邮箱时回落 noreply；密码登录仍注册、凭据存在时注册 GitHub provider 并显示按钮、发起登录跳转到 GitHub 授权页、带 client_id、回调指向本应用、使用 PKCE 并下发 CSRF 与 PKCE cookie；凭据缺失时断言 GitHub 被正确关闭并以退出码 2 报告 AUTH-008 待定。**不含** OAuth 回调、token 交换与首登建号，那需要真实 GitHub 账号与浏览器 |
| `verify:github-schema` | OAuth 首次登录要写的表结构：可以创建没有本地密码的账号、可以把 GitHub 身份写入 `accounts`、同一 GitHub 身份不能被重复绑定、同名账号被拒绝、删除账号会级联删除绑定、检查过程不留下数据。需要先停开发服务器，全程事务回滚 |
| `verify:account` | 账号闭环：三个页面可访问；账号安全页含邮箱验证、修改邮箱与 GitHub 绑定入口；给当前邮箱发验证邮件并从开发服务器日志取回令牌、确认后邮箱标记已验证、同一令牌不能重复使用；改成他人占用的邮箱返回 409、改成新地址先进入待确认状态、确认后新邮箱生效且旧邮箱不再能登录；未绑定 GitHub 时解绑返回 `NOT_LINKED`、未登录的解绑与绑定发起返回 401；配置 OAuth 后绑定发起跳转 GitHub 授权页并带 client_id、自建回调地址、只读 scope 与 HttpOnly state cookie，回调在 state 不匹配或缺 cookie 时回到账号页说明原因；未注册邮箱申请找回返回同样响应（不枚举用户）、过短新密码被拒、令牌一次性、新旧密码登录结果、找回接口限流。邮件通道未配置时链接写入开发服务器日志，脚本按请求偏移从日志取令牌，没有测试专用旁路 |
| `verify:github-flow` | GitHub 登录与绑定的完整链路（真实浏览器 + 真实 HTTP + 本地假提供方）：首登自动建号并使用 GitHub 昵称邮箱；昵称与已有用户重名时自动加后缀；无公开邮箱时回落到登录名与占位邮箱；邮箱账号可把 GitHub 绑到当前账号并报告两种登录方式；绑定的身份用 GitHub 登录会进入同一个账号（证明绑定写入的 `provider_account_id` 与 Auth.js 登录查询用的是同一约定）；同一 GitHub 身份不能绑到第二个账号；只剩 GitHub 一种登录方式时拒绝解绑且绑定保留；有本地密码时可以解绑 |
| `verify:anchor` | 用真实 PDF（Attention Is All You Need 第 4 页的 175 个文本项）验证引用定位，并验证**重新分块、大小写变化、空格变化、连字符换行**后仍能定位；同一句出现两次时用前后文选中正确的一处 |
| `verify:reader` | 真实浏览器：登录后打开阅读器，确认画布与文本层渲染、在文本层建立选区并转成锚点草稿、发布评论、服务端保存引用与前后文，**刷新后位置标记偏差 0.0px**、**缩放到 160% 后标记仍跟随文本**、无前端异常 |
| `verify:settings` | `/settings/profile`、`/settings/account`、`/settings/privacy` 三个页面可访问且未登录被重定向；昵称、头像配色、简介保存后刷新仍在；占用他人昵称返回 409、过短昵称 400；**头像**：设置页与公开主页都按昵称前两个字符渲染、默认配色为 #002FA7 + 白字、自定义配色保存后自动转大写并出现在公开主页、非法颜色与三位简写被拒；三个隐私开关保存后刷新生效；默认匿名设置使新评论的署名在接口响应里就是 `null` 且 `isAnonymous` 为真；关闭弹幕后新评论 `visibleInDanmaku` 为假；关闭主页评论后公开主页不列评论并给出说明；显式取消匿名时按公开昵称署名；密码修改的三种结果（当前密码错误 403、新密码过短 400、正确 200）与用新密码重新登录；结束时还原资料、隐私设置与密码 |
| `verify:theme` | 真实浏览器：设置页出现三态主题控件；浅色与深色下 `<html data-theme>`、页面背景与文字颜色、卡片表面色实际互换且深色卡片不是白底；刷新后仍保持已选主题；模拟系统深色时「跟随系统」解析为深色、系统改为浅色后无需改设置即跟随；论文库页沿用同一主题。截图输出到 `.verify/screenshots/` |
| `verify:load` | 生产运行时负载回归：对页面、接口、PDF Range、静态资源共 160 个请求、并发 8，要求无 5xx、无连接错误，并打印状态分布与 p50/p95/max 延迟。用来盯住「文件描述符或数据库实例随请求增长」这类只有生产模式才暴露的问题 |

`verify:search` 与 `verify:smoke` 分开，原因是每次检索会向上游 OpenAlex 发两个请求，而 OpenAlex 按 IP 限流（实测会回 `Retry-After: 24511`，约 6.8 小时）。把它放进主基线会让基线依赖一个有速率限制的外部服务。脚本内两次检索之间默认间隔 1200ms，可用 `SEARCH_GAP_MS` 调大；上游不可用时退出码 2，表示结论待定而不是代码回归。接口区分三类失败：`UPSTREAM_RATE_LIMITED`（上游限流）、`UPSTREAM_UNAVAILABLE`（上游故障或超时）、`SEARCH_RATE_LIMITED`（本项目的限流，回 429 并带 `Retry-After`），三者都会在有缓存时回退展示缓存结果并在响应里标记 `stale`。

`verify:reader` 用 `puppeteer-core` 驱动本机已安装的 Chrome 或 Edge，不下载浏览器。换路径用 `CHROME_PATH`。

### 没有真实 GitHub 凭据时怎么验证登录

真实的 client id / secret 只有账号所有者能拿到，但握手之后的代码都在本地。`npm run github:fake` 起一个实现同样 HTTP 契约的假提供方，`GITHUB_BASE_URL` 让登录（Auth.js 的 `enterprise.baseUrl`）与绑定（自建回调）两条链路同时改指到它：

```bash
npm run github:fake                                   # 另一个终端，默认 127.0.0.1:4569
$env:GITHUB_BASE_URL = "http://127.0.0.1:4569"
$env:AUTH_GITHUB_ID = "fake-client-id"
$env:AUTH_GITHUB_SECRET = "fake-client-secret"
npm run dev
$env:SMOKE_BASE = "http://localhost:3100"             # 必须与 NEXTAUTH_URL 一致
npm run verify:github-flow
```

两个前提：访问地址与 `NEXTAUTH_URL` 一致（否则 Auth.js 的 state/PKCE cookie 跨 host 带不过去），以及数据库里没有旧的 GitHub 绑定残留（早期失败的运行会留下把某个身份指到别的账号的行，Auth.js 先按 `provider_account_id` 查账号，于是登录成别人）。脚本检测到这种残留时以退出码 2 报「不判定」并提示 `npm run db:reset`，而不是报成回归。真实的 GitHub 侧（回调注册、token 交换的真实响应、企业版差异）仍需自己的凭据做一次冒烟。

**已修复的不稳定**：`verify:reader` 的「缩放后位置标记跟随文本重新定位」曾间歇失败（固定偏差 54.6px）。原因是脚本在 PDF 按新比例重排完成前就取样，`expectedZoom` 用的是未缩放高度；产品最终状态一直是正确的。脚本已改为等画布尺寸稳定后再取样，连跑 5 次偏差均为 0.0px。详见 [docs/04-worklog.md](docs/04-worklog.md) 第 2.1 节 R1。

**脚本之间有配额冲突**：`verify:smoke`、`verify:notify`、`verify:reader` 都会发布评论，而应用的限流是每账号 60 秒 5 条。`verify:smoke` 自己就会把 reader 的配额用满（它有一条专门测限流的检查），所以这几个脚本不能在 60 秒内连跑。触发时它们打印说明并以退出码 2 结束，表示结论待定而不是回归。

冒烟测试默认导入 arXiv `1706.03762`。换一篇用 `SMOKE_IDENTIFIER` 覆盖。

## 生产验证与备份

**生产环境配置（`\.env.production.local`）。** `next build` / `next start` 会自动加载该文件（已被 `.gitignore` 忽略）。本项目当前接的是 Supabase，三处与服务商有关的细节值得记下来：

```bash
# 数据库：直连主机 db.<ref>.supabase.co 只有 AAAA 记录，本机与多数容器没有 IPv6 出口，
# 因此必须用 Session pooler（IPv4），用户名是 postgres.<项目 ref>。
DATABASE_URL=postgresql://postgres.<ref>:<密码>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres
# TLS：连接串里的 sslmode 不生效，必须显式给 CA。Supabase 用自家根证书签发，
# 仓库里带了 certs/supabase-prod-ca-2021.crt（也可从控制台下载 prod-ca-2021.crt 覆盖）。
DATABASE_SSL_CA=./certs/supabase-prod-ca-2021.crt
# 对象存储：Supabase Storage 的 S3 兼容端点，需要 path-style（设了 S3_ENDPOINT 时自动开启）。
STORAGE_DRIVER=s3
S3_BUCKET=happypaper-pdfs
S3_ENDPOINT=https://<ref>.storage.supabase.co/storage/v1/s3
S3_REGION=ap-northeast-2
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

TLS 的三个环境变量：`DATABASE_SSL_CA` 指定 CA 文件（开启校验）、`DATABASE_SSL_NO_VERIFY=1` 只加密不校验、都不设则不加密（数据库主机不是本机时会打印一行提示）。`pg_stat_ssl.ssl` 在 Supabase 上恒为 `false`——那是池化服务到 Postgres 的内部一段，判断客户端这一段要看连接 socket 是否 `TLSSocket`。

**生产构建与启动（四条命令，按顺序）。** 生产模式与开发模式的行为不是一回事，2026-10-16 就是在这里抓到一次只在 `npm start` 下出现的崩溃。

```bash
# 1. 停开发服务器：PGlite 同一时刻只允许一个进程打开数据目录
# 2. 构建
npm run build          # 期望：退出码 0，0 条 tracing 警告，TypeScript 检查通过
# 3. 启动
npm start              # http://localhost:3100
# 4. 另一终端跑验证
npm run verify:smoke   # 63/63
npm run verify:settings # 32/32
npm run verify:load    # 160 个请求，无 5xx
EXPECT_STORAGE_DRIVER=s3 npm run verify:storage   # 10/10（生产模式不写开发日志，跳过驱动比对）
```

**Windows 上重复构建会失败。** Turbopack 会为 `serverExternalPackages` 里的包在 `.next/node_modules` 下建 junction，下一次构建删不掉它，报 `EPERM: operation not permitted, unlink '...\.next\node_modules\@aws-sdk\client-s3-…'`。构建前删掉 `.next` 即可：`Remove-Item -Recurse -Force .next`。另外类型检查子进程在受限沙箱里可能报 `spawn EPERM`，用普通终端（非沙箱）执行即可。

抓到的问题：开发服务器把 PGlite 实例缓存在模块作用域，生产分支没有缓存，于是**每次查询**都新建一个实例、重新打开 `pglite.data` 与数据目录，几十个请求后 `EMFILE: too many open files`，页面开始 500，并连带出现 `client reference manifest ... does not exist` 之类的次生错误。`verify:smoke` 单独跑不到那个请求量，所以加了 `verify:load` 作为回归闸门。构建产物里不再包含源码或 `storage/`（`src/lib/storage.ts` 的 `turbopackIgnore` 标注），`.next` 合计 81 MB、`.next/server` 21 MB。

**2026-10-16 已在 Supabase 上跑通。** 迁移 10 条、`db:seed` 建 4 个账号；`npm start` 下 `verify:smoke` 63/63、`verify:settings` 32/32、`verify:storage` 10/10（启动日志确认 `driver=s3 bucket=happypaper-pdfs`，桶内确认有应用写入的对象）。验证用的测试数据随后已用 `db:reset` 清掉、桶已清空。

抓到的问题：开发服务器把 PGlite 实例缓存在模块作用域，生产分支没有缓存，于是**每次查询**都新建一个实例、重新打开 `pglite.data` 与数据目录，几十个请求后 `EMFILE: too many open files`，页面开始 500，并连带出现 `client reference manifest ... does not exist` 之类的次生错误。`verify:smoke` 单独跑不到那个请求量，所以加了 `verify:load` 作为回归闸门。构建产物里不再包含源码或 `storage/`（`src/lib/storage.ts` 的 `turbopackIgnore` 标注），`.next` 合计 81 MB、`.next/server` 21 MB。

**备份与恢复。**

```bash
npm run db:backup                                   # 备份到 backups/<UTC 时间戳>/
node scripts/db-restore.mjs --from backups/2026-10-16_09-30-00          # 预演：只校验
node scripts/db-restore.mjs --from backups/... --apply [--force]        # 真正写入
```

备份内容为 PGlite 数据目录与 `storage/pdfs`，外加一份 `manifest.json`（逐文件大小与 SHA-256、各表行数）。三条约束：

1. **先停服务。** 两个脚本都会检测 3100 端口，有服务在跑时备份直接拒绝（运行中的 WAL 可能让备份在恢复时打不开）。
2. **预演是默认行为。** 不加 `--apply` 只核对校验和与行数，不改任何数据；目标目录非空时还要 `--force`。
3. **覆盖前先留退路。** 写入时把原目录改名为 `<目录>.before-restore-<时间戳>` 而不是删除。

`PGLITE_DATA_DIR` 与 `STORAGE_DIR` 可覆盖，因此可以恢复到别处做检查而不动线上数据。迁移到真实 PostgreSQL 后，数据库部分换成 `pg_dump` / `pg_restore`，"先停服务 + 清单 + 校验和" 这三条不变。

## 目录

```
src/app/                页面与 API 路由
src/app/read/[id]/      阅读器页
src/app/admin/          管理后台
src/components/reader/  PDF 阅读器、评论卡片
src/components/admin/   后台操作按钮
src/lib/anchor.ts       位置锚点：归一化、引用匹配、前后文提取
src/lib/realtime.ts     SSE 扇出与在线阅读人数
src/lib/comments/       评论查询、限流、敏感词、计数广播
src/lib/papers/         OpenAlex 元数据、导入与 PDF 下载、查询
src/lib/admin/          举报队列、用户、论文、统计
src/db/                 Drizzle schema 与数据库连接
drizzle/                手写 SQL 迁移，由 scripts/db-migrate.mjs 应用
scripts/                迁移、种子、重置、三个验证脚本
storage/pdfs/           缓存的 PDF 文件
../happypaper-data/     PGlite 数据目录（在仓库之外）
```

## 读者界面

阅读器把三种展示形态放在同一屏：

| 形态 | 位置 | 行为 |
| --- | --- | --- |
| 弹幕浮层 | 页面顶部 | 当前页评论从右向左飘过，可在工具栏关闭并调节密度 |
| 位置标记 | 页面右缘 | 按锚点 y 坐标排列，点击跳到该评论并高亮对应位置 |
| 评论侧栏 | 右侧 | 当前页 ±1 页的全部评论与回复，含点赞/回复/举报/删除 |

发布时选中文字即绑定到句子；未选中时按钮会把评论绑定到当前页面位置。弹幕来源可选「立即显示」或「按阅读位置显示」：前者进入该页即飘过，后者随阅读位置到达后才进入弹幕层。

## 已实现

- 邮箱密码注册与登录（Auth.js v5，JWT 会话）
- GitHub 登录接线：设置 `AUTH_GITHUB_ID` 与 `AUTH_GITHUB_SECRET` 后注册 GitHub provider 并在登录页显示按钮，首次登录自动建账号，昵称取自 GitHub 且重名时自动加后缀；未设置时该入口完全关闭。**OAuth 握手尚未用真实凭据验证过**
- 远程论文搜索：首页与 `/papers` 可切换「本地论文库 / 远程搜索」，按标题、作者、arXiv ID 或 DOI 检索 OpenAlex，排序可选相关度、引用数、发表时间；结果显示元数据、被引数与 PDF 可用状态，已入库的标记出来，可直接导入并进入详情页
- 本地论文库搜索与远程搜索共用一个入口，切换方式为表单里的来源选择
- 按 arXiv ID 或 DOI 导入论文：OpenAlex 元数据 + 开放获取 PDF 缓存到本机
- PDF 上传，默认私有，转公开需确认分发权利
- 论文列表、关键词搜索、标签筛选、论文详情页、收藏
- PDF 在线阅读器：翻页、缩放、适应宽度、阅读进度保存与恢复
- 文本层选区采集：页码 + 页内归一化坐标 + 引用文本 + 前后文 + 字符区间
- 定位恢复：引用匹配优先，失败回退页内坐标
- 评论发布、点赞、回复、举报、删除自己的
- 回复通知：有人回复你的评论时写入站内通知，站点头部「通知」显示未读角标，`/me?tab=notifications` 查看并可全部标为已读
- 点赞通知：他人点赞你的评论时写入通知，默认开启，可在 `/me?tab=notifications` 关闭；取消点赞会撤回对应通知，重复点赞不会堆积
- 筛选（全部/疑问/解释/方法/结果）与排序（时间/热度）
- 60 秒 5 条限流、敏感词过滤、禁言
- SSE 实时推送新评论与在线阅读人数
- 用户主页 `/u/[name]`、我的评论/收藏/阅读记录 `/me`
- 管理后台 `/admin`：举报队列、内容审核、论文与版权、用户
- 侵权投诉页 `/legal/takedown`

## 已知限制

- SSE 与在线阅读人数保存在单进程内存里，多实例部署需要加一层共享总线。
- 实时推送只在同一进程内扇出。
- 扫描版 PDF 无文本层时只能按页面位置定位，界面会标注。
