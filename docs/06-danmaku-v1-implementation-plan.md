# HappyPaper 弹幕阅读社区第一阶段实施规格

- 版本：1.0
- 日期：2026-11-21，Asia/Singapore
- 目标仓库：https://github.com/funw25/Happypapper
- 审阅基线：`b089dfae29afe11fed548e165cb0aeff8e46891d`
- 适用对象：负责实现、测试和维护本项目的 AI 编程助手及开发者
- 交付目标：在已有项目上完成可供真实读者使用的论文弹幕社区。

## 0. 给执行 AI 的入口

### 0.1 本阶段的产品目标

用户能够搜索或上传论文，打开论文阅读器，在整个论文阅读区域观看按发布时间或热度排序的弹幕，选中句子或框选区域发表弹幕和评论，点击弹幕定位原文，进行点赞与回复，并通过邮箱账号维护个人资料、阅读记录和通知。

弹幕是本阶段核心功能。不要把它弱化成可有可无的装饰，也不要把主要工作改成 AI 问答、自动综述、科研 Agent 或模型训练。研究与 AI 能力可以在后续阶段增加，不是本阶段完成的前置条件。

### 0.2 文档中的三类约定

- **已确认需求**：用户明确提出，执行时必须保留，见第 1 节。
- **实施默认值**：为避免 AI 反复询问而给出的具体决定，可以直接实施；修改时写入决策记录并解释原因。涉及产品核心、可见性或数据删除的变化不得自行扩大范围。
- **代码基线事实**：来自上述提交的静态审阅。它们不是本次运行测试的成绩。执行前应检查当前分支，已修复的问题不要重复修复。

这是仓库实施文档，不要求创建新网站项目或迁移到其他托管产品。保留既有 Next.js 应用和可复用业务代码。用户已经确定本阶段以弹幕社区为主；仓库旧规划中不同的阶段顺序，不应覆盖这一产品目标。

### 0.3 执行顺序

按 `M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7` 推进，任务和验收见第 19 节。每完成一个阶段，应用仍须能启动；数据库迁移须保留原数据。一个阶段的任务可以拆成小提交，不要等所有功能完成才验证。

执行时：

1. 读取当前仓库适用的 `AGENTS.md`，检查分支、工作区改动、现有 README 和迁移。
2. 对照本文记录差异，再决定需要新增或修改的文件。
3. 未安装依赖时按锁文件安装；先复现当前基线，不把历史日志当成当前结果。
4. 为功能缺口和已发现缺陷建立可执行检查，修改后运行对应测试。
5. 凭据暂缺时完成可独立验证的代码与本地契约测试，明确标记外部集成待验，不能伪造成功。
6. 在阶段记录中写明修改、命令、结果、未完成项和下一阶段。

### 0.4 不得采用的完成方式

- 仅制作静态页面、按钮无后端行为，或用模拟数据替代正式链路。
- 通过关闭类型检查、跳过失败断言、删除旧数据或重置生产库使检查通过。
- 为完成邮箱验证而在生产环境增加测试令牌接口、固定万能验证码或自动把所有邮箱标为已验证。
- 将本来私有的文件、评论、阅读历史或匿名作者身份公开。
- 自动升级所有依赖、整体重写技术栈或创建不必要的微服务。
- 自动推送、部署到生产、购买服务、注册外部账号或向真实用户群发邮件；这些操作需要对应授权。本文授权的实现工作应先完成到可检查状态。

## 1. 已确认需求与本版范围

### 1.1 用户明确确认的需求

| 编号 | 需求 | 必须体现的行为 |
| --- | --- | --- |
| U-01 | 保留并优先完成论文弹幕的初衷 | 阅读器有可持续播放、可互动的真实弹幕 |
| U-02 | 弹幕漂浮在整个论文界面 | 覆盖阅读区域可视窗口的多个高度，不限于页面顶部一小条 |
| U-03 | 按时间排序 | 时间指发布时间，最新优先；不是阅读进度或视频时间轴 |
| U-04 | 按热度排序 | 高赞、多人讨论内容优先 |
| U-05 | 搜索和导入论文 | 明确来源、查询方式、无全文时的处理 |
| U-06 | 上传文件与格式处理 | 文件能进入统一阅读和定位流程 |
| U-07 | 句子定位与弹幕、评论 | 选中原文发表，之后能回到原文 |
| U-08 | 邮箱注册 | 真实邮箱验证、登录、找回密码 |
| U-09 | 网站与个人主页 | 能发现论文、继续阅读、查看个人公开贡献与私人内容 |

### 1.2 V1 必须完成

- 桌面浏览器优先；窄屏能基本阅读和操作，不出现完全不可用的遮挡。
- PDF 上传、标识符导入、统一论文搜索。
- DOCX 转 PDF，转换完成后预览确认；安排在核心弹幕之后完成。
- 有文字层 PDF 的选区评论，所有可正常打开 PDF 的页面和区域评论。
- 全文／当前页弹幕范围，最新／热门两种排序。
- 统一评论线程、点赞、回复、删除、举报和管理员处理。
- 邮箱注册、验证、密码找回、站内通知、隐私设置。
- 网站首页、论文详情、阅读器、我的空间、公开个人主页。
- 数据迁移、访问控制、自动化验证、部署和备份说明。

### 1.3 不作为 V1 交付条件

OCR 文字选区、多图片上传、LaTeX/ZIP 在线编译、BibTeX/RIS 批量导入、原生 App、关注关系、私信、复杂声望、个性化推荐、跨版本自动迁移评论、团队共享私有论文、多实例实时总线，以及所有 AI 生成或训练功能。

扫描 PDF 在 V1 中仍可阅读、框选区域和按页评论，只是不承诺句子级选区。公式和图片通过区域定位支持。

## 2. 当前仓库与改造边界

### 2.1 可复用部分

| 代码位置 | 已有能力 | 改造方向 |
| --- | --- | --- |
| `src/app/` | Next.js 页面与 Route Handlers | 保留路由骨架，逐步调整契约 |
| `src/components/reader/pdf-reader.tsx` | PDF 渲染、文字选区、评论、基础弹幕 | 拆分阅读器职责，新增独立播放队列 |
| `src/lib/anchor.ts` | 引用归一化、前后文匹配、坐标回退 | 增加文档版本、多矩形和状态 |
| `src/lib/papers/openalex.ts` | OpenAlex 元数据和搜索 | 抽出 provider 接口，补 arXiv/Crossref |
| `src/lib/papers/import.ts` | PDF 下载与上传 | 改为可恢复后台任务、真实格式校验 |
| `src/lib/storage.ts` | 本地和 S3 适配器 | 保存不可变原件、阅读 PDF 与解析产物 |
| `src/lib/realtime.ts` | 单进程 SSE 订阅 | 增加事件游标、恢复与权限撤回 |
| `src/lib/auth/`、`src/lib/mailer.ts` | 密码、令牌、邮箱流程 | 真实投递、原子消费、会话撤销 |
| `src/db/`、`drizzle/` | Drizzle、Postgres/PGlite、迁移 | 增量迁移，不替换旧库 |
| `scripts/verify-*.mjs` | API、浏览器和存储检查 | 保留有效测试，增加新场景 |

### 2.2 实施前需要核查的缺口

以下是审阅基线中的静态发现，不代表已在当前运行环境复现：

1. 评论列表、发布和 SSE 缺少与私有论文阅读页相同的访问检查。
2. 评论发布缺少父评论同论文校验；句子页码只验证大于零，没有已解析总页数上界。
3. 评论 DTO 返回作者用户 ID，匿名时只隐藏名字；首页最新讨论的用户名查询未统一处理匿名。
4. 公开主页评论查询和统计需要同时过滤论文可见性、匿名状态和主页展示偏好。
5. 弹幕候选先被按页内位置重新排序，再截取少量内容，不能正确实现全文最新／热门队列。
6. PDF 文本层检测仅查找文件前段的 `/Font`，应改为实际逐页文字提取结果。
7. arXiv PDF 候选地址移除了版本后缀，可能把用户指定旧版替换成最新版。
8. 远程下载将整个响应读入内存后再检查真实大小，需要流式上限与超时。
9. 邮件仅写日志；令牌消费采用先读后写，需要防止并发重复消费。
10. 上传公开权利确认主要在前端，服务端需要持久化并验证提交的确认。
11. 论文标签写接口只检查登录，必须补论文管理权限。
12. 多份旧路线图和历史测试数量不一致；以当前代码和本轮实测更新状态。

现有前端手工创建文字 span 的宽度、字体和变换需要复核。优先采用当前 PDF.js 版本的文字层能力或等效准确实现，禁止只保证标记点正确而让选中的可见文字错位。

## 3. 产品默认值

下面是可以直接实施的初始值，放入集中配置，不散落在多个组件中。

| 项目 | 默认值 | 说明 |
| --- | --- | --- |
| 弹幕开关 | 开 | 遵循用户已保存的关闭设置；减少动态效果模式另见第 8 节 |
| 弹幕排序 | `latest` | 前端文案“最新” |
| 弹幕范围 | `document` | 当前 PDF 版本全文 + 该论文的全文讨论 |
| 弹幕密度 | 中，最多 6 条同时在场 | 低 3、中 6、高 10；实际受窗口高度限制 |
| 移动速度 | 约 100 CSS px/s | 用户可选慢／标准／快，所有同轨内容同速 |
| 字体 | 18 CSS px | 可选 16/18/22，不随 PDF 缩放 |
| 不透明度 | 0.8 | 用户可调，保证背景对比度 |
| 弹幕最大长度 | 80 个 Unicode code point | 前后端相同计数函数；不是 UTF-16 `string.length` |
| 评论最大长度 | 2,000 个 Unicode code point | 引用文本单独最多 2,000 |
| 弹幕列表批量 | 默认 50，最大 100 | 禁止无限量返回 |
| 本地待播缓冲 | 最多 200 条 | 满时暂停预取，不跳过未接收的分页 |
| 评论列表 | 默认 30，最大 100 | 回复单独分页 |
| 文件大小 | 60 MiB | 与旧上限对齐，流式强制执行 |
| PDF 页数 | 初始上限 300 页 | 可配置；超限在导入时解释原因 |
| 私有上传 | 默认开启 | 公开必须主动确认 |
| 评论发送限流 | 每账号 60 秒 5 条 | 回复包含在内；应原子执行 |
| 外部搜索防抖 | 400 ms | 回车立即检索；取消过期响应 |
| 公开评论排序 | 最新／热门 | 侧栏可另选按原文位置；不改变弹幕排序 |
| 邮箱验证有效期 | 24 小时 | 重发使旧令牌失效 |
| 密码重置有效期 | 1 小时 | 保留现有语义；一次性 |

默认值不是已测量的性能结论，也不等于外部服务的限额。外部限额按供应商文档、响应头和当前账号配置处理。

## 4. 页面与用户路径

### 4.1 路由与职责

| 页面 | 路由 | 内容 |
| --- | --- | --- |
| 首页 | `/` | 搜索、热门讨论论文、最近新增、最新公开讨论 |
| 搜索结果 | `/papers?q=&field=&source=&sort=` | 本站与外部结果、筛选、可读状态 |
| 添加论文 | `/papers/new` | 标识符、PDF、DOCX 三个入口 |
| 论文详情 | `/papers/[id]` | 元数据、版本、阅读状态、讨论概况、收藏 |
| 阅读器 | `/read/[id]?version=&page=&comment=` | PDF、弹幕、原文标记、评论侧栏 |
| 我的空间 | `/me?tab=` | 继续阅读、收藏、上传、我的评论、通知 |
| 公开主页 | `/u/[handle]` | 稳定地址、昵称、简介、公开贡献 |
| 注册/登录 | 复用现有路由 | 邮箱账号；登录后返回原操作位置 |
| 设置 | 复用 `/settings/*` | 资料、账号、隐私、弹幕、通知 |
| 管理 | `/admin` | 举报、内容、用户、论文下架 |

阅读器深链接必须真正读取 `comment` 并加载对应线程、版本和页码。旧 `#c123` 链接提供兼容解析；不要只写链接却不处理跳转。

### 4.2 首页

- 首屏提供明显搜索框：“搜索标题、作者，或粘贴 DOI / arXiv 链接”。
- 登录用户最前显示最近阅读的 3 篇论文及继续阅读按钮；不在匿名缓存中混入个人数据。
- “本周热议”显示公开论文过去 7 天的有效讨论活跃度；“最近加入”显示最近公开时间，不以私有上传时间排序。
- “最新讨论”只显示公开、可见内容；统一匿名 DTO，不单独直连用户名。
- 空站点显示添加入口和明确标注的演示入口。不得把测试脚本产生的内容当真实社区活跃。

本周热议初始算法：`2 × 独立发言人数 + 独立点赞人数`，按过去 7 天的有效事件去重，排除自赞和已隐藏/删除内容，同分按最后有效活动时间。学术引用数单独标识，不与站内热度混淆。

### 4.3 论文详情

展示标题、作者、年份、来源、摘要、标识符链接、版本列表、公开评论数、收藏按钮和阅读入口。状态分别显示：仅有元数据、处理中、可阅读、处理失败、已下架。

无 PDF 时允许保存到收藏和打开来源网站，不显示可用的“在线阅读”按钮。用户可上传私人副本；该副本不能被自动转成公共附件。管理员与所有者的维护按钮必须由服务端能力字段控制。

### 4.4 阅读器布局

```text
┌ 标题 / 版本 / 返回 ────────────────────────────┐
│ 翻页 缩放 适宽  弹幕开关 最新/热门 全文/当前页 设置 │
├──────────────────────────┬───────────────────┤
│ PDF 阅读区                │ 评论侧栏          │
│                          │ 当前定位/全文筛选  │
│   ← P4 这里为什么这样推导 │ 引用原文          │
│                          │ 评论与回复        │
│   ← P8 这个实验很有意思   │ 点赞/举报/删除    │
│                          │                   │
│ 原文选区 → 发弹幕/写评论  │ 编辑框            │
└──────────────────────────┴───────────────────┘
```

弹幕层覆盖阅读区域的可视窗口，不跟着某一页顶部滚走，也不覆盖工具栏与评论栏。PDF 保留翻页、缩放、适宽、页码跳转、选区、区域框选和进度保存。V1 可以继续单页阅读，不强制一次重构为连续滚动。

桌面默认展开侧栏。窄屏把侧栏改为抽屉，降低同时在场弹幕数，保留全部功能入口。工具栏溢出时使用折叠菜单，不裁掉排序与弹幕开关。

### 4.5 我的空间与公开主页

我的空间必须分页展示：阅读记录、收藏、上传任务与论文、自己的评论（包含匿名和私有）、回复通知、点赞通知。个人上传失败可以重试，未完成任务可取消。

公开主页显示昵称、字母头像及配色、简介、研究兴趣、可选 HTTPS 个人网站、加入时间、公开贡献。头像保留现有昵称字母方案，V1 不增加图片上传。

公开统计与列表必须使用同一过滤口径：论文公开、未下架、评论可见、非匿名、允许在主页展示。关闭主页评论时隐藏相关列表与贡献统计，不能借统计反推匿名或私有活动。阅读历史和邮箱不公开。

个人收藏默认私有；可以逐项标记公开，但仍只允许公开论文进入公开收藏。昵称可修改，主页地址使用稳定 `handle`。迁移时为既有用户生成唯一 handle，保留旧昵称地址别名；旧别名不转给其他人。

## 5. 论文检索与元数据

### 5.1 输入路由

| 输入 | 本站行为 | 外部行为 |
| --- | --- | --- |
| DOI / DOI URL | 在用户可访问记录中精确匹配 | Crossref 查元数据，OpenAlex 补信息；非 Crossref DOI 继续回退 |
| arXiv ID / abs / pdf URL | 保留 ID 与明确版本 | arXiv 官方 API；OpenAlex 可补充 |
| 标题 / 主题词 | 标题、摘要、作者检索 | OpenAlex 综合查询 |
| `field=author` | 作者字段检索 | provider 对应作者查询与消歧；同名可返回多组 |
| 本站合法论文 URL | 按访问权限定位 | 不发外部请求 |
| 不支持的任意 URL | 提示粘贴标题/标识符或上传文件 | V1 不实现任意网页抓取 |

DOI 规范化需要处理 `doi:` 前缀、doi.org URL、URL 解码和空白；不要随意删除合法 DOI 中的括号和标点。arXiv 同时处理新旧格式；有 `v2` 时必须保存和请求 v2，无版本时解析到当次明确版本并冻结。

### 5.2 统一结果模型

```ts
type SearchHit = {
  key: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
  identifiers: { type: 'doi' | 'arxiv' | 'openalex'; value: string }[];
  sourceUrl: string | null;
  pdfCandidateAvailable: boolean;
  readableInSite: boolean;
  importedPaperId: string | null;
  citedByCount: number | null;
  discussionCount: number | null;
  providers: string[];
};
```

`pdfCandidateAvailable` 仅表示有候选链接；只有本站成功解析且可访问的 PDF 才能令 `readableInSite=true`。外部字段缺失用 `null`，不编造摘要、作者或年份。

### 5.3 查询和排序约定

前端先展示本站结果，再独立加载外部结果，两区分别标明来源。全部模式允许两区展示，外部失败不覆盖已成功的本站结果。不能假装不同 provider 的相关度分数可直接全局比较。

外部默认由 OpenAlex 返回相关度顺序；arXiv/Crossref 用于精确解析和明确降级。筛选：年份范围、是否本站可读、来源；排序：相关度、最新发表、引用数。引用数缺失放在末尾，不能当成零引用事实。

本地初期继续 PostgreSQL 查询；组合标题精确匹配、标题词匹配、摘要和作者匹配的确定性权重。中英文都要有基本检索用例；不要把纯英文词干配置宣传为完整中文语义检索。规模扩大后再优化索引。

搜索结果各区独立游标分页，每页默认 20，最多 50。游标绑定规范化 query、filters 和 provider，不允许用一个 query 的游标查另一 query。

### 5.4 上游适配器

建议接口：`search(query, filters, cursor)`、`resolve(identifier)`，返回标准元数据、provider 状态和候选全文链接。网络请求仅在服务端执行，API key 不发给浏览器。

- OpenAlex：支持 `OPENALEX_API_KEY`，按当前官方认证、预算与分页要求接入；不要继续依赖“永远无需密钥”的旧注释。[认证文档](https://help.openalex.org/api/authentication/)
- arXiv：使用官方 API 解析标识符、版本及链接，按官方访问要求节流。[API 手册](https://info.arxiv.org/help/api/user-manual.html)
- Crossref：负责 DOI 元数据，不假设返回可下载全文。[REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
- 搜索字段与参数用当前文档核对，并为请求建立 fixture 契约测试。[OpenAlex 搜索](https://help.openalex.org/api/searching/)

初始搜索超时每 provider 8 秒，总交互预算 12 秒。遇到 429 尊重 `Retry-After`：若超过剩余交互预算，立即返回限流状态和缓存，不缩短等待后继续轰击上游。重试仅限可恢复网络/5xx，最多 1 次，使用退避和抖动。

缓存键包含 query、provider、filters、sort、cursor 和适配器版本；仅缓存公开元数据。可访问的本站匹配在每次请求时另外计算，避免缓存泄露私人副本。新鲜期 10 分钟、过期回退最多 1 小时，相同并发请求合并。上游失败返回 `partial` 和各 provider 状态。

## 6. 导入、上传、转换与存储

### 6.1 格式策略

统一阅读格式为 PDF，保留原文件。PDF 不做破坏式重新排版；DOCX 转换产生一个固定阅读 PDF。每个 PDF 版本保存 SHA-256、来源、页数、页面尺寸、解析器版本和逐页文字层情况。

文字层 JSON 是定位辅助数据，不替代 PDF。扫描页仍可阅读。PDF 中一部分页有文字、一部分没有时，能力按页显示，不使用全篇一个布尔值决定全部功能。

### 6.2 状态机

```text
上传: received → validating → [converting] → parsing → awaiting_confirmation → ready
远程: metadata_ready → fetching → validating → parsing → ready
任一步: → failed / cancelled
公开管理: ready → removed（独立于技术处理状态）
```

本地上传完成后预览，用户确认标题、作者、年份、可见性及转换结果。PDF 预览不必重新渲染全部页面；至少首页、随机中间页、页数和处理提示可查看。DOCX 转换必须有确认步骤。确认前不得进入公共列表。

远程标识符先保存元数据，下载失败时记录仍保留，支持重试。不要在 PDF 全部下载后才创建元数据记录。

### 6.3 文件验证

- 同时检查扩展名、声明类型、文件签名与真实解析结果；只找 `%PDF-` 不足以证明有效 PDF。
- 上传与下载均在超过 60 MiB 时停止读取；不能依靠不可信 Content-Length。
- 解析后检查页数上限、加密/密码保护情况；V1 对需要密码的文件给出 `PDF_ENCRYPTED`，不保存密码。
- DOCX 检查 ZIP 结构、解压后总大小和条目数，防止过量资源消耗；不接受宏格式 DOCM。
- 远程候选 URL 限 HTTP(S)，每次重定向重新检查协议、主机和解析地址，拒绝回环、内网、云元数据与本地文件目标；阻止 DNS 重绑定绕过。最多 5 次跳转。
- 下载最多尝试 3 个候选，每个候选总时限 30 秒；整个任务 120 秒。失败记录分类原因，不把 HTML 错误页存成 PDF。
- 转换子进程独立临时目录和用户配置目录，关闭宏与网络资源，设置 CPU/内存/时限；输出成功后检查 PDF，再发布产物。

### 6.4 原件、阅读件与去重

对象键采用不可变结构，例如 `papers/{paperId}/versions/{versionId}/source.docx`、`document.pdf`、`text-index.json`、`thumbnail.webp`。存储适配器统一处理本地和 S3；数据库不存永久公共桶 URL。

先写临时对象并完成检查，再提交版本可用状态。对象写入成功而数据库提交失败时，任务重试复用同一目标键，垃圾清理只删除确认无引用且超过保留期的孤儿对象。不能在用户请求中直接遍历删除整个存储目录。

同一篇论文下、同一个可见范围的完全相同 PDF 可以复用既有版本。全局内容哈希可以用于内部优化，但任何响应不得泄露其他用户是否上传过相同私人文件。

V1 采用论文级可见性：同一 paper 的所有版本和讨论继承该 paper 的访问范围。不在同一个 paper 中混放公开版与私人版。用户给公开论文上传私人副本时创建独立私有 paper，可记录内部关联，但不继承公共文件权限，也不合并私人评论。

### 6.5 公开确认

前端公开勾选必须提交到服务端，记录 `rightsConfirmedAt`、确认文案版本和操作者。缺少确认时服务端拒绝公开上传。远程元数据公开不等于全文自动允许再分发；全文公开资格与来源说明单独记录，不确定时保留元数据和来源入口。

从 private 改 public 是实际发布动作：显示将公开文件及既有讨论，要求所有者明确确认，再由服务端原子切换。只修改标题或文件处理完成不能隐式公开。用户将 public 改 private 时撤回公开检索、评论、文件访问和 SSE，已有公开缓存需失效。

### 6.6 任务系统

任务持久化到数据库，包含状态、阶段、attempts、nextRunAt、leaseUntil、错误码和结果版本 ID。生产 PostgreSQL 用独立 Node worker 领取任务，使用事务锁和租约，避免两个 worker 同时处理同一任务。任务幂等键绑定用户、输入与操作类型。

PGlite 模式不能另起第二个打开同一数据库目录的 worker。开发默认选择同一 Web 进程内任务执行器，共用数据库实例；启动执行器必须发生在运行时，不能在 `next build` 导入模块时启动。子进程转换文件可以独立运行，但不得直接打开 PGlite。为独立 worker 测试使用真实 PostgreSQL。

任务重试仅针对瞬时错误，最多 3 次；格式不支持、密码保护、超限等永久错误不自动反复执行。用户可以修正输入后创建新任务。状态查询只对任务所有者和管理员开放。

## 7. 锚点与评论模型

### 7.1 四种根评论目标

```ts
type AnchorV2 =
  | { type: 'paper'; version: 2 }
  | {
      type: 'page' | 'region' | 'text';
      version: 2;
      paperVersionId: string;
      page: number;
      rects: { x: number; y: number; width: number; height: number }[];
      quote?: string;
      prefix?: string;
      suffix?: string;
      charStart?: number;
      charEnd?: number;
      textIndexVersion?: string;
    };
```

`paper` 表示全文讨论，不伪造 page=1。`page` 可使用空 rects，定位页顶；`region` 必须有矩形；`text` 必须有非空 quote，允许多个跨行矩形。V1 同一选区不跨 PDF 页面；跨页时提示分开发表。

### 7.2 坐标与文字索引

矩形使用 PDF 未旋转 CropBox 对应的标准页面坐标，归一化为左上原点、x/y/width/height 在 0–1。浏览器选区通过当前 viewport 的逆变换回到标准坐标；渲染时再做正向变换，处理 PDF 内置旋转和不同页尺寸。不能简单除以 CSS 容器宽高而忽略旋转。

字符偏移采用统一规范化文本流中的 Unicode code point 下标，区间 `[start,end)`。浏览器 DOM Range 的 UTF-16 偏移必须转换，并维护规范化前后及文字 item 的映射。NFKC、空白折叠和断行连字符处理会改变长度，必须保存映射，不可直接拿原始 offset 在归一化文本上截取。

采用引用、prefix/suffix、位置与文档状态结合的设计，参考 [W3C Web Annotation](https://www.w3.org/TR/annotation-model/)，但只有实现字符和坐标约定后才可声称兼容。

### 7.3 定位恢复

1. 确认 version ID 对应同一 PDF 内容，禁止静默切到最新版。
2. 若 textIndexVersion 一致，检查字符区间文字与 quote 是否匹配。
3. 在当前页查找规范化 quote，使用上下文消歧；仍有多个同分候选时不能随便选第一处。
4. 找不到可靠文字位置时使用保存的 rects；无 rects 时回到页码。
5. 显示 `exact / region / page / unavailable`，只有 exact 才声称定位原句。

图片或公式区域不需要文字匹配。锚点存储数据保持不变，缩放只重新计算屏幕位置。旧锚点的回退结果不得覆盖原始数据。

### 7.4 发布交互

选中文字后出现“发弹幕 / 写评论”。选择区域模式后拖动框选，退出框选不影响正常选字。无选区直接发言时默认全文讨论；“对本页评论”是单独按钮，不能凭滚动位置猜测用户要绑定的句子。

发布时预览锚点：原文摘要、页码、区域缩略标识。用户可清除锚点改成全文讨论。失败保留草稿，网络重试携带同一幂等键，不重复写入。进入登录流程前只保存必要草稿到当前会话；退出登录时清理含私人原文的草稿。

### 7.5 评论与弹幕字段

- `content`：完整评论，1–2,000 code points，纯文本或安全的有限 Markdown；V1 默认纯文本。
- `danmakuEnabled`：是否允许作为弹幕播放。
- `danmakuText`：弹幕短文案，1–80 code points。短评论可由用户确认复用正文，长评论必须明确填写。
- `kind`：question/explain/method/result/other。
- `isAnonymous`：发布时确定；V1 不做事后匿名与实名互转，避免缓存和身份关联不一致。
- `visibleInProfile`：是否进入公开主页，同时受用户总开关、匿名和论文权限约束。
- `status`：visible/hidden/deleted。

未开启弹幕的评论不进入弹幕候选。回复默认且在 V1 固定不作为弹幕，不使用自动摘要填充弹幕文字。

### 7.6 线程与修改

根评论下回复采用平铺展示，可记录 `replyToId` 指向回复对象。所有回复保存 `rootId`，根评论 `rootId=null`；对根评论回复时 `replyToId` 为根 ID。校验 root、replyTo 与 paper 一致，继承根锚点，客户端不得另指定版本和坐标。根评论已删除或隐藏时不允许新增回复；删除根的旧回复按下述占位规则保留可读状态，隐藏根的整个线程对普通用户不可读。

本人可编辑正文和弹幕短文案，更新 `revision`、`editedAt`，不改变 `createdAt` 或原锚点。本人可软删除；根评论删除后从弹幕和列表候选移除，已有回复通过线程入口保留根占位“原评论已删除”。管理员隐藏根内容时整个线程对普通用户隐藏，恢复后按原状态过滤。

隐藏/删除不能通过直接按 ID 获取、主页、通知预览、搜索或 SSE 继续读到原文。保留删除占位时也不返回原作者、锚点引用或正文。管理员审计是独立受限接口。

## 8. 弹幕排序与播放引擎

### 8.1 候选范围与排序分离

候选必须同时满足：当前用户可读取论文；论文未下架；根评论可见；启用弹幕；短文案有效。

- `scope=document`：包含当前 PDF 版本的句子、区域、页级根评论，以及该 paper 的全文根评论。
- `scope=page`：只包含当前 PDF 版本、当前页的句子、区域和页级根评论，不混入全文讨论。
- 其他版本评论不默认混播。版本切换后明确更换候选集合。
- `kind` 是可选分类过滤；默认 all。
- 回复不进入候选，即使回复很多，热度也体现在根评论上。

“全文”表示当前版本全文，不表示跨版本混合，更不表示全站弹幕。页面上的显示位置与原文锚点位置独立：弹幕可以在任一可用轨道飘过，点击后再回到锚点。

### 8.2 两种排序的精确定义

**最新：** `created_at DESC, id DESC`。修改内容不提升发布时间。禁止在客户端再按页码或 y 坐标排序。

**热门：** `hot_score DESC, created_at DESC, id DESC`。

```text
hot_score = 2 × effective_like_count + min(distinct_replier_count, 10)
```

- effective_like_count 是对该根评论点赞的不同有效账号数，不包含作者自己。V1 拒绝自赞，重复 POST 点赞幂等。
- distinct_replier_count 是当前可见回复的不同作者数，不包含根作者；一人多条只算一人。
- 删除/隐藏回复后重新计算相关人数；恢复后重新计算。
- 回复本身的赞不累加到根热度，防止指标含义不清。
- V1 不加时间衰减、不将举报量直接当作负分。举报走审核。
- 热度同分时保持确定性顺序。计数由数据库事务更新，客户端不能提交计数。

### 8.3 分页与排序快照

最新列表使用 `(createdAt,id)` keyset cursor；首次请求记录 `snapshotRevision`，本轮历史分页只取该修订水位之前创建的内容，新内容由实时队列处理。不得使用 OFFSET 分页导致插入时重复或跳项。

热门列表使用排序快照：在创建时固定候选 ID 与排序键，后续用 opaque cursor 读取该快照。快照只存 ID 与排序键，不缓存包含用户权限或正文的 DTO。每次读取重新校验论文权限和内容状态。

V1 单实例可使用有上限的服务端内存快照，不必另建通用缓存平台：TTL 10 分钟；每个用户会话、论文和筛选最多 2 个；全局设置条目和内存上限。初始每份最多 10,000 个候选，超出时返回 `truncated=true` 和实际覆盖说明，不能谎称已经播放全部内容。常规评论侧栏仍可继续分页查看全部。上线后按实测规模调整。

快照绑定 paper、version、scope、kind、sort、viewer/session 和 `accessRevision`，游标签名校验。过期或因进程重启丢失返回 `410 CURSOR_EXPIRED`，客户端重新申请快照并保留本会话已播集合。

热门收到点赞/回复变化时标记 `rankingDirty`，不改在场弹幕。当前播放批次结束后，且距离上次重算至少 30 秒，丢弃旧的未播放热门候选、创建新快照并过滤已播 ID。无变化时继续旧快照。不要每一个点赞都立即重建整个列表。

### 8.4 队列状态

```ts
type PlaybackState = {
  mode: 'latest' | 'hot';
  scope: 'document' | 'page';
  pending: DanmakuItem[];
  active: ActiveDanmaku[];
  playedIds: Set<string>;
  queuedIds: Set<string>;
  pauseReasons: Set<'manual' | 'selection' | 'composer' | 'hidden' | 'detail'>;
  rankingDirty: boolean;
  cursor: string | null;
};
```

队列规则：

1. 状态更新以服务器 comment ID 去重；挂载、重新渲染和点赞不得重播相同内容。
2. 只有成功进入轨道后才标记为已播。因缓冲已满未被接收的响应保留，不能提前推进游标丢掉记录。
3. pending 最多 200；预取在低于 50 时触发，一次仅一个正在进行的分页请求。旧 query 响应丢弃并取消请求。
4. 最新模式新增事件按 `(createdAt,id)` 插入待播队列前部，当前在场轨迹不变。新事件洪峰时先记录待获取水位，稍后从持久事件补齐，不无限增长内存。
5. 热门模式新内容提示“有 N 条新讨论”，批次更新时参与排名。
6. 本人发布成功后立即安排一次本地展示反馈，标记为已入队；HTTP 响应与 SSE 不得各播放一次。若 SSE 先到，通过返回的本人 clientMutationId 与本地草稿合并。
7. 首次播放完候选后等待新内容，不自动无限循环。提供“重播本范围”，明确清空对应已播集合。
8. 关闭弹幕取消动画和调度，保留设置与本会话已播集合；重新开启只继续未播内容。
9. 切换排序时当前在场内容自然退出，清空旧 pending，加载新排序。保留按排序/范围划分的已播集合，来回切换不无故重复。
10. 当前页模式翻页时取消旧页在场和待播内容；全文模式翻页不清空队列。切换 PDF 版本时取消所有版本相关内容，重建队列。
11. 隐藏、删除、撤销弹幕展示或失去访问权限时立即移除相应 active、pending 和缓存项。
12. 设置或客户端状态只影响观看方式，不能修改其他人的内容展示权限。

### 8.5 轨道调度和碰撞

弹幕渲染层为阅读区域上的绝对定位 viewport overlay，容器不随页面内容滚动。使用可测量的 DOM 文本和 transform 动画；第一版不要求 Canvas。

- 计算可用高度 H、行高 L（字号 × 1.5）、轨道间隙 8px；轨道数受实际高度限制，轨道均匀覆盖阅读区。
- 文字只显示一行，视觉宽度不超过阅读区 75%，过长时省略号；保存的 danmakuText 不截断，点击查看全文。
- 每条起点 x=W，终点 x=-w，速度 v，同轨同速，时长 `(W+w)/v`。不硬编码所有文字为同一秒数，否则不同宽度会追尾。
- 同轨新条目仅在前一条右缘距离新起点至少 `gap=24px` 后进入。初版可限制每轨一条以确保稳定，测试通过后可开启同轨多条。
- 悬停暂停整个轨道并停止往该轨道加入内容，不能只冻结一条让后面的追撞。
- 密度是同时在场数量上限，不是从数据库只取前 6 条。候选多时持续轮播。
- 窗口尺寸变化后重新计算轨道，确保在场项不重叠；允许结束当前批次再布置新批次，不允许锚点数据随窗口改写。

动画生命周期必须随卸载、关闭、换版本清理，不以 CSS infinite 动画反复播放同一个数组。更新计数不重新设置 animation start time。

### 8.6 输入、选区与可访问性

overlay 空白区 `pointer-events:none`，可点击弹幕本体使用明确的交互区域。用户在 PDF 正文开始选区时暂停并淡化弹幕；存在有效选区或编辑框聚焦时保持暂停，关闭编辑工具或主动取消选择后恢复。

暂停原因用集合管理。例如手动暂停后，结束文字选择不能擅自恢复；页面从后台回来也不能解除手动暂停。

提供键盘可达的开关、排序、密度和评论入口；在弹幕详情中可用键盘跳原文。`prefers-reduced-motion` 首次访问默认暂停移动弹幕，提供静态最新讨论入口及主动开启动画选项，不删掉弹幕能力。

弹幕支持 P4 等页码标识；全文讨论使用“全文”。点击打开评论详情，再点击“查看原文”跳转，避免单击时读者突然丢失当前阅读位置。跳转后提供“返回刚才位置”。

## 9. 实时同步与一致性

### 9.1 单实例部署边界

V1 使用一个长驻 Node Web 实例提供 SSE，PostgreSQL 和对象存储持久化。文件任务可有独立 worker，但不能直接调用另一进程的内存广播；完成状态写数据库，由 Web 事件分发器读取。

不得在未加共享总线时部署多个 Web 实例、cluster workers 或依赖短生命周期函数提供长连接。后续多实例扩展另做，不在本阶段强行引入 Redis。

### 9.2 持久事件

新增 `paper_events`，每个 paper 具有单调递增 `contentRevision`。每次评论、点赞、回复、可见性或版本状态变更，在同一事务中先锁定 paper 行、增加 revision，再写业务变更和事件。统一锁顺序为 paper → comment → user-specific rows，防止并发死锁。

采用 paper 行锁是为了保证每篇论文的 revision 与提交顺序一致，不能简单使用全局自增 ID 并假设分配顺序等于提交顺序。V1 低中等写入量接受这项串行化；扩展前再测瓶颈。

事件只包含 ID、版本、操作类型、修订号等最小信息，不含正文、真实作者、邮箱或对某个读者专属的能力字段。客户端根据事件通过授权 REST 接口获取 DTO。

```json
{
  "eventId": "paper-uuid:42",
  "paperId": "paper-uuid",
  "revision": "42",
  "type": "comment.created",
  "commentId": "123",
  "paperVersionId": "version-uuid",
  "occurredAt": "2026-11-21T03:10:00Z"
}
```

事件类型：`comment.created`、`comment.updated`、`comment.removed`、`comment.metrics`、`paper.access_changed`、`paper.version_ready`。在线人数和心跳属于临时事件，不写持久表。

### 9.3 建连、重连与去重

- 建连时校验用户、paper 可见性、下架状态和会话有效性。首次进入先取得列表快照的 `snapshotRevision=R`，再使用 `after=R` 建立 SSE；或先建连缓冲再取快照。禁止无水位地“先取列表、再只订阅未来事件”，否则会漏掉两者之间的新评论。
- SSE 使用 `id: paperId:revision`；浏览器 Last-Event-ID 或显式 `after` 用于断线补发，拒绝跨 paper 游标。
- 先注册临时缓冲，再读取数据库水位并补发到该水位，最后排空缓冲中更晚事件并去重，避免补发和订阅之间漏消息。
- 事件保存至少 7 天。补发超过 1,000 条或游标已清理时发 `stream.reset`，客户端重取列表、活跃弹幕状态和新快照，保留已播集合。
- Web 分发器按正在订阅的 paper 查询新增 revision，建议 500ms–1s 间隔，合并查询并限制批量；没有订阅时不空转扫描全部历史事件。
- 心跳 25 秒；代理禁用缓冲，连接关闭统一清理 timer 和 subscriber，包含 enqueue 失败路径。
- HTTP 提交成功表示业务已持久化；SSE 暂时不可用不回滚成功评论。恢复后从事件表补齐。

### 9.4 权限变化和内容撤回

论文公开转私有、下架、账号会话失效时，重新评估订阅权限。向原订阅发送无敏感内容的失效信号后关闭无权限连接，清理前端正文和评论缓存。每次推送前使用当前访问状态，不只在建连时检查一次。

普通评论删除/隐藏后发送移除事件，所有相关页面和本地弹幕同步消失。匿名到实名不支持；修改昵称或头像仍应使相关公开 DTO 缓存失效。

在线人数只作为近似展示：登录用户同论文多连接按账号去重，匿名使用随机会话 ID，不把连接数称作独立真实用户数。UI 文案可使用“在线阅读”。

## 10. 账号、邮件和通知

### 10.1 注册与身份

邮箱密码为主入口，不要求学校邮箱。昵称与稳定 handle 分开；handle 唯一且 URL 安全。邮箱在服务端规范化并唯一约束，不因大小写建立重复账号。

未登录用户可读公开内容；未验证账号可登录、修改个人设置、收藏和保存自己的进度，发布评论、点赞、回复、上传和触发远程下载要求验证邮箱。查询公开元数据不要求验证。

既有账号迁移保留密码和 ID，不直接标记为已验证。显示验证提示，仍允许查看自己的已有内容。已有 GitHub 登录保留兼容；提供方明确验证过的邮箱可以按可信声明处理，缺少可信验证时仍走邮箱验证；占位邮箱不得视为已验证。

### 10.2 邮件实现

增加真实 SMTP 传输，复用 mailer 接口；选择具体库时核对当前官方文档并锁定版本。配置 `MAIL_TRANSPORT=smtp`、`SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`、`MAIL_FROM`、TLS 方式和 `APP_URL`。

开发使用本地邮件捕获服务或明确的 log transport。生产开启注册时必须存在真实投递配置；缺失时健康检查报告未就绪，页面不得显示“邮件已发送”。日志不得包含生产重置令牌或完整邮件链接。

邮件发送记录包括消息 ID、用途、尝试次数和状态，重试不得生成多个彼此作废的新令牌。需要跨进程重试时，账号令牌表仍只存摘要；邮件 outbox 的短期内容使用专用 `MAIL_OUTBOX_ENCRYPTION_KEY` 加密，发送进程解密取得同一个链接，发送成功或过期后清除密文。密钥不与密文一起入库。不能从摘要还原链接，也不能为方便重试把明文 token 写入普通日志或任务 JSON。邮件 provider 接受消息不等于收件箱投递成功；验收需真实受控邮箱收到一封验证和重置邮件。

### 10.3 令牌、密码和会话

- 令牌使用加密随机值，数据库只存摘要，绑定用途和目标邮箱。
- 用带 `used_at IS NULL AND expires_at > now()` 的条件更新或行锁原子消费；不能先 SELECT 再无条件 UPDATE。
- 密码重置、邮箱切换与令牌消费处在同一事务，失败不能只消耗令牌却未完成账号修改。
- 修改邮箱验证的令牌绑定新邮箱值，不能引用后来被替换的 `pendingEmail` 误改到另一个地址。
- 密码保留现有 bcrypt 实现时限制输入不超过 72 UTF-8 bytes，最低长度默认 10 code points；前后端提示一致。不得静默截断。未来更换哈希算法需要版本化兼容迁移。
- 重置密码或主动“退出其他会话”增加 `users.sessionVersion`；JWT 保存版本，服务端每次受保护请求校验，不能只清本浏览器 cookie。
- 找回密码无论邮箱是否存在返回相同公开提示；统一控制响应和发送频率。

初始邮件限流：同账号重发间隔 60 秒、每小时 5 次；注册和找回同时有 IP 维度保护。测试隔离账号和时间，不靠固定睡眠绕过真实限流。

### 10.4 通知

回复发送给被回复对象作者；同一事件不重复通知，自回复不通知。对根讨论的订阅通知先不做，避免一次回复通知所有参与者。点赞默认开启，可关闭，同一内容的新增赞可以合并显示。

匿名回复在通知中只显示“匿名用户”，不能通过 actorName、头像、个人链接泄露；点赞没有匿名模式，但不公开点赞人列表。通知指向可用线程深链接。

通知预览使用当前授权内容，不保存可永久绕过删除/私有状态的正文快照。目标隐藏、删除或无权限时返回通用占位和不可点击状态。只允许所有者查询、标记已读。

站点头部未读角标初版每 30 秒及窗口重新聚焦时刷新；离开页面取消轮询。可用当前登录会话校验，不需要单独增加第二套实时基础设施。

## 11. 权限与公开数据规则

### 11.1 统一策略

建立 `canReadPaper`、`canManagePaper`、`canInteract`、`canModerate` 与统一 DTO 投影函数。所有页面、Route Handler、下载、任务、通知、主页、搜索和 SSE 调用同一策略。

| 动作 | 访客 | 未验证账号 | 已验证账号 | 私有论文所有者 | 管理员 |
| --- | --- | --- | --- | --- | --- |
| 看公开论文/评论/弹幕 | 可 | 可 | 可 | 可 | 可 |
| 看私有论文/讨论 | 不可 | 仅自己的 | 仅自己的 | 可 | 经管理接口可审计 |
| 收藏/保存进度 | 不可 | 可，限可读内容 | 可 | 可 | 可 |
| 发布/点赞/回复/导入 | 不可 | 不可 | 可，限可读内容 | 仍需验证 | 需有效管理或账号权限 |
| 修改论文元数据/版本/公开状态 | 不可 | 可管理自己的既有元数据；公开需验证 | 仅自己的 | 可 | 可 |
| 编辑/删除评论 | 不可 | 可删除自己的既有内容 | 本人可编辑/删除 | 不能编辑别人正文 | 可隐藏/恢复，不能冒充作者编辑 |
| 查看真实匿名作者 | 不可 | 不可 | 不可 | 不可 | 仅审计接口且记录访问 |

对无权读取的私有对象统一 404，避免暴露存在性。已知公开对象的登录、验证或管理权限不足使用 401/403。管理员身份不能通过客户端参数传入。

`papers.status=removed` 独立于 visibility；被下架不能通过重试 PDF 下载或切换私有重新公开。恢复需要管理员流程。

### 11.2 匿名 DTO

公开接口只返回匿名 author 对象或公开 author 对象，不返回内部 `userId`、邮箱、认证账号字段。本人操作通过 `viewer.canEdit`、`viewer.canDelete`、`viewer.isMine` 表示。管理员列表使用另一个明确受限 DTO，不在普通 DTO 中增加隐藏但可读的字段。

不得将 ORM 行 `...created` 或 `getTableColumns(users)` 直接序列化为公开 JSON。搜索、首页、站内通知和 SSE 均执行同样规则。

### 11.3 内容和文件防护

服务端校验输入、纯文本转义、URL 协议、CSRF/Origin 和鉴权。基于 cookie 的写接口必须验证 Origin 与站点配置；仅设置 SameSite 不视为所有检查完成。

敏感词、频率限制、重复内容提示、举报、管理员隐藏/恢复/禁言继续保留。限流用原子窗口/事务锁实现，不能用并发下会穿透的先计数后写入作为唯一保护。限流返回 Retry-After 和可理解提示，不丢失草稿。

PDF 经授权代理或短期授权访问，桶保持私有。私有 PDF 与包含身份数据的接口默认 `Cache-Control: private, no-store`。撤回权限后不能继续从共享 CDN 缓存获取。浏览器已下载的文件无法被远程收回，产品不作这种承诺。

HTTP Range 支持合法的单区间、尾部区间与开放结束区间；无效范围返回 416。多区间 V1 可明确拒绝，不能错误返回另一个范围。HEAD 与 GET 使用同等权限。

## 12. 数据模型与迁移

以下是目标逻辑结构，字段可按既有命名映射；主外键、约束和语义不能省略。时间存 UTC timestamptz，展示时本地化。公开 JSON 中所有 bigint ID 和 revision 使用十进制字符串，避免 JavaScript 精度丢失。

### 12.1 表结构增量

| 表 | 关键新增/调整字段 | 约束与索引 |
| --- | --- | --- |
| users | handle、interests、website、session_version、reading_preferences | handle 唯一；邮件唯一；设置使用白名单 schema |
| user_handle_aliases | alias、user_id | alias 唯一，改名后保持旧路由 |
| papers | status、default_version_id、content_revision、access_revision、published_at | status active/removed；版本必须属于本 paper |
| paper_identifiers | paper_id、namespace、normalized_value、scope_key | public 记录 scope_key=public，私有为 owner ID；相同 scope 的 namespace/value 唯一 |
| paper_versions | id、paper_id、version_label、source_type、source_url、source_key、pdf_key、sha256、page_count、processing_state、parser_version、rights_confirmation | ready 后文件不可变；(paper_id,sha256) 对有效哈希唯一；失败版本允许 hash null |
| paper_pages | version_id、page、width、height、rotation、text_status、text_index_key | (version_id,page) 主键；逐页能力 |
| comments | root_id、reply_to_id、anchor_v2、paper_version_id、target_type、danmaku_enabled、danmaku_text、edited_at、deleted_at、revision、created_revision、distinct_replier_count、hot_score | 索引见后；非根继承根目标；不允许跨 paper 关联 |
| comment_likes | 保留 user/comment 联合主键 | 幂等点赞，自赞校验 |
| reading_progress | 增加 version_id | (user_id,paper_id,version_id) 唯一；进度不是阅读理解完成率 |
| favorites | 增加 visibility，默认 private | 公开展示仍检查 paper 状态 |
| import_jobs | owner、paper、version、kind、state、stage、attempts、lease、next_run_at、error、result | 按 state/next_run_at 领取；任务所有权 |
| paper_events | paper_id、revision、type、entity_id、payload、created_at | (paper_id,revision) 主键，保留窗口索引 |
| request_dedup | user_id、operation、key、request_hash、resource_id、expires_at | (user,operation,key) 唯一；正文不同复用 key 返回 409 |
| mail_deliveries | purpose、token_ref、recipient、status、attempts、provider_message_id、encrypted_payload、payload_expires_at | 受限信息；内容短期加密，成功/过期清除，不记录明文 token |
| moderation_actions | actor、action、target、reason、timestamp | 审计追加；限制查询权限 |

已有 accounts、account_tokens、notifications、reports、banned_words 等表继续使用并补必要字段。不要重复建立第二套身份或通知系统。

评论推荐索引：

- `(paper_id, status, created_at DESC, id DESC)`。
- `(paper_id, paper_version_id, page, status)`；若 page 放在 JSON，使用明确生成列或表达式索引并同步校验。
- `(paper_id, danmaku_enabled, status, hot_score DESC, created_at DESC, id DESC)`。
- `(root_id, status, created_at ASC, id ASC)`。
- `(user_id, status, created_at DESC)`。

纸面全文评论没有 versionId/page；版本根评论必须有版本且属于 paper。跨表一致性使用外键、复合外键或事务内校验；不要声称普通 CHECK 可以查另一张表。

### 12.2 热度、事件与幂等事务

写操作统一事务：取得 paper 锁 → 校验当前状态/权限 → 校验幂等键 → 业务写入 → 更新根指标 → 分配 contentRevision → 写 paper_events → 写幂等结果 → 提交。幂等重放不再计入发言额度、不再发通知、不再增加热度。

幂等保留至少 24 小时。请求相同返回原 resource；原资源已删时返回当前删除状态，不复活内容。请求不同但 key 相同返回 `409 IDEMPOTENCY_CONFLICT`。

### 12.3 增量迁移步骤

1. 备份并记录基线表行数，使用独立测试数据库验证迁移；不执行无关 `db:reset`。
2. 新增表与可空字段，保留旧列，部署可同时读旧/新格式的兼容代码。
3. 为每篇有旧 pdf_path 的论文建立 legacy 版本，读取文件后补哈希/页数；文件缺失标记 unavailable，不删除论文和评论。
4. 为旧根评论建立 AnchorV2：有 quote 的映射 text，有坐标但无 quote 的映射 region/page。旧 anchor_version 和原值保留以便审计；不凭空添加不存在的矩形尺寸。
5. 为旧回复计算根和 replyTo，检查循环、跨论文父子关系，异常隔离到迁移报告，不静默移动到另一论文。
6. 旧 `visibleInDanmaku=false` 保持关闭；true 且正文≤80 时复用正文；长正文生成明确省略的 legacy 展示短文案并保留完整正文/legacy 标记，通知作者可编辑。新发布仍须作者自己填写短文案。
7. 旧 `displayMode=position/immediate` 保留兼容字段，不再控制新播放顺序；观看偏好统一最新/热门。旧 page/yNorm 路由兼容解析。
8. 阅读进度绑定当时 legacy 版本；如果没有版本只保留旧记录，待版本可用时明确转换，不把页数猜成最新版。
9. 回填公开身份 handle、匿名过滤与统计；不批量验证邮箱、不修改密码。
10. 在两种数据库模式验证约束、回填可重跑和数据计数。完成代码切换与观察窗口后，再另一个迁移清理旧列。

同一个 paper 的重复来源记录先报告，不能仅凭标题相似强行合并。新增唯一约束前先解决既有冲突。不要将预印本与出版版的标识符别名推断当成已经核实的同一文献。

## 13. API 契约

以下路径可复用旧路由。对旧客户端提供限期适配；变更前更新前端和验证脚本。不可保留一个绕过新权限的旧接口。

### 13.1 通用约定

- 新接口成功统一 `{ data, meta? }`；旧接口在适配阶段保留原结构，内部调用同一服务。
- 错误 `{ error: { code, message, fields?, retryAfterSeconds? }, requestId }`。
- 游标为 opaque string，不暴露未授权对象或内部 SQL。
- 不能把客户端传来的 userId、role、likeCount、hotScore、visibility 权限当可信值。
- 所有列表限制 limit，并验证 page、versionId、sort、scope；非法值返回 400，缺省使用默认值。
- dates 使用 ISO 8601 UTC；ID 使用字符串。兼容旧数字 ID 时仅接受安全整数并转字符串。

### 13.2 端点列表

| 方法与路径 | 请求摘要 | 响应与权限 |
| --- | --- | --- |
| GET `/api/papers` | q/field/sort/cursor/limit | 本站可读论文；公开与个人结果分清缓存 |
| GET `/api/papers/search` | q/field/source/filters/providerCursor | 公开远程元数据与当前用户可见匹配，含 partial/provider 状态 |
| POST `/api/papers/imports` | identifier + Idempotency-Key | 202 paperId/jobId；要求验证邮箱 |
| POST `/api/papers/uploads` | multipart file + metadata，默认 private | 202 paperId/versionId/jobId；验证邮箱、大小限制 |
| GET `/api/import-jobs/[id]` | 无 | 状态、阶段、可重试性，仅所有者/管理员 |
| POST `/api/import-jobs/[id]/retry` | Idempotency-Key | 可恢复任务重试，仍受权限和限额 |
| POST `/api/import-jobs/[id]/cancel` | 无 | queued/running 取消；已发布不通过此接口删除 |
| GET `/api/papers/[id]` | 无 | 脱敏详情、版本与 viewer 能力 |
| PATCH `/api/papers/[id]` | 标题/作者/标签等允许字段 | 所有者/管理员；公开切换走单独确认 |
| POST `/api/papers/[id]/publication` | visibility、confirmed、rightsStatementVersion | 发布/撤回公开，更新 accessRevision |
| POST `/api/papers/[id]/versions/[versionId]/confirm` | metadata、previewConfirmed、visibility、rightsConfirmed | 完成上传预览；公开要求全部确认 |
| GET/HEAD `/api/papers/[id]/versions/[versionId]/pdf` | Range | 授权 PDF；200/206/416 |
| GET `/api/papers/[id]/comments` | version/scope/page/kind/sort/cursor/limit | 根评论分页，全文/当前页筛选 |
| POST `/api/papers/[id]/comments` | content/anchor/danmaku/kind/anonymous + Idempotency-Key | 创建根评论；验证邮箱与访问权限 |
| GET `/api/comments/[id]` | 无 | 单条与根引用；可访问才返回 |
| PATCH `/api/comments/[id]` | content/danmaku + expectedRevision | 本人编辑；冲突 409 |
| DELETE `/api/comments/[id]` | 无 | 本人软删除，重复删除幂等 |
| GET `/api/comments/[id]/replies` | cursor/limit | 根下可见回复分页 |
| POST `/api/comments/[id]/replies` | content/replyToId + Idempotency-Key | 根下回复，继承目标 |
| POST/DELETE `/api/comments/[id]/like` | 无 | 幂等赞/取消；更新权威计数 |
| POST `/api/comments/[id]/report` | reason/detail | 登录报告；同用户目标去重 |
| GET `/api/papers/[id]/danmaku` | version/scope/page/mode/kind/cursor/limit | 弹幕候选和快照信息 |
| GET `/api/papers/[id]/stream` | after，Last-Event-ID | 授权 SSE，支持补发/重置 |
| GET/PUT `/api/papers/[id]/progress` | version/page/yNorm | 本人进度，仅可读版本 |
| POST/DELETE `/api/papers/[id]/favorite` | 可选收藏公开偏好 | 本人收藏；公开需目标公开 |
| GET `/api/me/notifications` | cursor/limit | 本人通知与未读数 |
| POST `/api/me/notifications/read` | ids 或 all | 仅本人，幂等 |
| PATCH `/api/me/reader-preferences` | 白名单阅读偏好 | 账号默认设置 |
| POST `/api/register` | email/password/name | 创建未验证账号并发送验证流程 |
| POST `/api/auth/verify-email` | token，或复用既有确认流程 | 原子验证，不通过 GET 无确认变更敏感账号状态 |
| POST `/api/auth/forgot-password` | email | 相同公开提示 |
| POST `/api/auth/reset-password` | token/password | 原子重置并撤销会话 |
| POST `/api/me/sessions/revoke` | 当前密码或近期身份确认 | 撤销其他/全部会话的明确选项 |

注册后的重发邮件、邮箱修改和密码修改沿用既有路由，按第 10 节实现。邮件中的 GET 链接打开确认页面，不应让邮件扫描器自动消费令牌；用户确认操作再 POST。

### 13.3 创建评论示例

```json
{
  "content": "这里除以根号 d 是为了控制内积的尺度吗？",
  "kind": "question",
  "anonymous": false,
  "danmaku": { "enabled": true, "text": "这里为什么要除以 √d？" },
  "anchor": {
    "type": "text",
    "version": 2,
    "paperVersionId": "11111111-1111-4111-8111-111111111111",
    "page": 4,
    "rects": [{ "x": 0.12, "y": 0.31, "width": 0.53, "height": 0.025 }],
    "quote": "scaled dot-product attention",
    "prefix": "",
    "suffix": "",
    "charStart": 120,
    "charEnd": 148,
    "textIndexVersion": "pdfjs-v1-normalizer-v2"
  }
}
```

示例位置只是格式说明，不能作为真实论文定位 fixture。服务端校验 quote 与索引一致；无法核验的 legacy 锚点按已知降级状态处理。

### 13.4 评论公开响应示例

```json
{
  "data": {
    "id": "123",
    "paperId": "22222222-2222-4222-8222-222222222222",
    "rootId": null,
    "content": "这里为什么要除以 √d？",
    "author": { "kind": "anonymous", "displayName": "匿名用户" },
    "anchor": { "type": "paper", "version": 2 },
    "danmaku": { "enabled": true, "text": "这里为什么要除以 √d？" },
    "metrics": { "likes": 3, "replies": 2, "distinctRepliers": 2, "hotScore": 8 },
    "viewer": { "isMine": false, "canEdit": false, "canDelete": false, "liked": false },
    "revision": "1",
    "createdAt": "2026-11-21T03:10:00Z"
  }
}
```

实名 author 只包含公开 handle、displayName、avatar 配色与主页 URL。匿名 author 中不允许追加 accountId、userId、真实头像或隐藏字段。

### 13.5 弹幕响应元信息

```json
{
  "data": { "items": [] },
  "meta": {
    "mode": "hot",
    "scope": "document",
    "snapshotId": "opaque-id",
    "snapshotRevision": "42",
    "nextCursor": null,
    "hasMore": false,
    "truncated": false,
    "expiresAt": "2026-11-21T03:20:00Z"
  }
}
```

### 13.6 错误码

| HTTP | 代码 | 前端处理 |
| --- | --- | --- |
| 400 | INVALID_INPUT / INVALID_ANCHOR / UNSUPPORTED_FORMAT | 标注字段，保留草稿 |
| 401 | UNAUTHORIZED | 登录并返回当前论文/草稿 |
| 403 | EMAIL_UNVERIFIED / MUTED / FORBIDDEN | 验证邮箱/禁言说明/权限说明 |
| 404 | NOT_FOUND | 不透露私有对象存在性 |
| 409 | IDEMPOTENCY_CONFLICT / REVISION_CONFLICT / VERSION_MISMATCH | 不覆盖他人或旧编辑；重新加载确认 |
| 410 | CURSOR_EXPIRED | 保留已播 ID，创建新快照 |
| 413 | FILE_TOO_LARGE / TOO_MANY_PAGES | 解释限制 |
| 422 | PDF_INVALID / PDF_ENCRYPTED / CONVERSION_FAILED | 显示具体可恢复建议 |
| 429 | RATE_LIMITED / SEARCH_RATE_LIMITED | 倒计时，保留输入 |
| 502/503 | UPSTREAM_UNAVAILABLE / MAIL_UNAVAILABLE | 可重试、展示缓存或待处理状态 |

具体外部 provider 错误放 provider 状态里，不把一个上游失败错误地转换成整个本站服务不可用。

## 14. 前端组件和状态边界

### 14.1 建议组件拆分

保留现有页面入口，逐步将 `PdfReader` 拆为以下职责。文件名可适当适配，不要求先整体搬目录再开发。

```text
src/components/reader/
  reader-shell.tsx           布局、版本、侧栏
  pdf-viewport.tsx           PDF 加载、渲染、翻页、缩放
  pdf-text-layer.tsx         正确的文字层和选区映射
  anchor-overlay.tsx         选区高亮、区域框选、位置标记
  reader-toolbar.tsx         阅读、弹幕和范围设置
  selection-actions.tsx      发弹幕/写评论工具条
  comment-composer.tsx       草稿、验证、幂等提交
  comment-panel.tsx          根评论与线程分页
  comment-card.tsx           展示、互动和操作
  danmaku-overlay.tsx        仅负责在场弹幕渲染
  danmaku-settings.tsx       观看偏好
  hooks/use-pdf-document.ts
  hooks/use-anchor.ts
  hooks/use-danmaku-feed.ts
  hooks/use-danmaku-player.ts
  hooks/use-paper-stream.ts
  hooks/use-reading-progress.ts

src/lib/danmaku/
  ranking.ts                热度规则的共享定义
  scheduler.ts              可独立测试的轨道和队列状态机
  preferences.ts            默认值与输入校验
  types.ts                  请求/响应/事件类型
```

排序和游标来自服务端，动画位置在客户端计算。不要让 React 每个动画帧更新整个阅读器树。调度器维护在场记录，通过 transform/animation 或一个受控帧循环更新弹幕层。

### 14.2 状态所有权

| 状态 | 所有者 | 生命周期 |
| --- | --- | --- |
| 论文、版本、评论、热度 | 服务端数据库 | 持久 |
| 用户阅读偏好 | 登录后数据库；访客 localStorage | 跨访问 |
| 本次手动暂停、悬停、选区 | 阅读器本地状态 | 当前页面 |
| 已播集合和队列 | 播放器 | 当前阅读会话，重播才明确清除 |
| PDF 页码和位置 | 本地即时 + 服务端防抖保存 | 与版本绑定 |
| 未提交草稿 | 当前用户会话 | 发布、丢弃、退出登录时清理 |
| 排序快照 | 服务端有界缓存 | TTL，过期可恢复 |

登录时优先使用已保存账号设置；账号从未保存时可提示采用当前设备偏好，不能静默把另一账号的偏好覆盖过来。公开缓存不包含 `viewer` 字段。

### 14.3 加载与错误体验

- PDF 加载失败保留标题、来源入口与重试，不显示空白无限 spinner。
- 页渲染切换时取消旧任务，旧 Promise 不覆盖新页；组件卸载释放 document、renderTask、事件和订阅。
- 评论写入失败保留内容、引用与幂等键；收到明确成功后才清空。
- 切换版本时提示当前草稿绑定旧版本，保留旧稿或由用户丢弃，不能自动迁移。
- SSE 离线显示轻提示，不阻止已加载 PDF 阅读；HTTP 评论提交根据网络状态独立反馈。
- 游标失效自动恢复但不无限循环重试；连续失败显示“重新加载弹幕”。
- 页码切换、回复详情和登录回跳都保存“返回原阅读位置”。

### 14.4 阅读进度

保存 `{versionId,page,yNorm}`，yNorm 对当前页面阅读位置定义明确。800ms 防抖，页切换/离开时尽力刷新；服务器按客户端会话序列或更新时间拒绝旧请求覆盖新进度。

进度只代表阅读位置，首页用“读到第 X 页”，不宣称已读懂百分之多少。更换版本后默认页顶并说明不同版本，不把旧页码硬套到新版本。

## 15. 后端模块和配置

### 15.1 服务分层

Route Handler 只做鉴权入口、schema 解析、调用服务和响应转换。业务规则集中到可测试服务，数据库访问不在每个页面复制。

```text
src/lib/papers/providers/    openalex / arxiv / crossref
src/lib/papers/search.ts     聚合、缓存、provider 状态
src/lib/papers/versions.ts   版本与公开确认
src/lib/papers/access.ts     统一访问策略
src/lib/imports/             导入任务、领取、重试、下载
src/lib/comments/service.ts  发布、线程、编辑、点赞、删除
src/lib/comments/dto.ts      普通/本人/管理员投影
src/lib/realtime/            事件记录、轮询分发、补发
src/lib/auth/                密码、令牌、会话、限流
src/lib/mail/                传输、模板、投递记录
src/lib/config/              类型化环境变量和产品参数
scripts/worker.mjs           PostgreSQL 后台任务入口
```

外部客户端、存储、转换器、时钟和邮件传输可以注入，便于离线测试。不要为了测试增加只在 URL 参数触发的生产后门。

### 15.2 环境变量

生成 `.env.example`，只写占位值和含义，不写真实凭据。

| 类别 | 变量 | 规则 |
| --- | --- | --- |
| 应用 | APP_URL、AUTH_SECRET、NODE_ENV | 生产必须真实 HTTPS 基址与随机密钥 |
| 数据库 | DATABASE_URL、DATABASE_SSL_CA | 生产 PostgreSQL；明确 TLS 校验 |
| 本地数据库 | PGLITE_DATA_DIR | 目录在源码监视树之外；一次一个进程 |
| 存储 | STORAGE_DRIVER、STORAGE_DIR、S3_BUCKET、S3_REGION、S3_ENDPOINT、S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY、S3_FORCE_PATH_STYLE | 沿用适配器；生产桶私有 |
| 学术 API | OPENALEX_API_KEY、ACADEMIC_CONTACT_EMAIL | 服务端使用；联系人不得伪造 |
| 邮件 | MAIL_TRANSPORT、MAIL_FROM、SMTP_HOST、SMTP_PORT、SMTP_USER、SMTP_PASSWORD、SMTP_SECURE、MAIL_OUTBOX_ENCRYPTION_KEY | 生产 smtp；本地捕获服务单独配置；outbox 专用加密密钥 |
| 文件 | MAX_UPLOAD_BYTES、MAX_PDF_PAGES、CONVERSION_TIMEOUT_MS、LIBREOFFICE_BIN | 默认见第 3/6 节 |
| 任务 | JOB_EXECUTION_MODE、JOB_CONCURRENCY | embedded 或 worker；禁止 PGlite+外部 DB worker |
| SSE | EVENT_RETENTION_DAYS、SSE_HEARTBEAT_MS | 默认 7 天、25,000ms |
| 测试 | TEST_DATABASE_URL、TEST_STORAGE_DIR、TEST_MAIL_HOST | 必须独立测试资源，不能默认指生产 |

服务启动时验证配置，日志只显示驱动名、已脱敏主机与状态。不要打印连接串、API key、密码、邮件令牌或完整私人下载 URL。健康检查区分 `live`（进程活着）与 `ready`（必需依赖可用）；默认健康接口不暴露基础设施细节。

### 15.3 依赖策略

沿用已有 package-lock，并核对实际可安装版本与 Node 兼容范围。需要调整依赖时说明具体不兼容原因、最小变更和验证命令，不凭模型记忆整体升级。新增转换组件和浏览器测试工具时记录版本。

保留现有有效验证脚本。新的测试框架可按项目现状采用，避免为一个组件同时引入两套浏览器测试栈。CI 使用明确安装的浏览器，不依赖开发者电脑上的 Chrome 路径。

## 16. 测试数据和验收用例

### 16.1 测试数据集

建立 `tests/fixtures/` 和来源清单，使用自建或可合法用于测试的小文件。测试文件固定，不从“storage 目录里最新一个文件”决定输入。

| Fixture | 内容 | 用途 |
| --- | --- | --- |
| F01 | 单栏英文、有文字层、至少 5 页 | 基本选区与跳转 |
| F02 | 双栏、相似重复句子 | 阅读顺序和上下文消歧 |
| F03 | 中文、英文混排、emoji/非 BMP 字符 | Unicode 计数与 offset |
| F04 | 连字、软连字符、跨行单词 | 规范化映射 |
| F05 | 公式、表格、图片 | 区域锚点 |
| F06 | 旋转 90° 页面、非默认 CropBox | 坐标变换 |
| F07 | 不同页面尺寸 | 缩放与页码定位 |
| F08 | 无文字扫描 PDF | 页面/区域降级 |
| F09 | 文字页与扫描页混合 | 逐页能力 |
| F10 | 同一论文两版，分页与文字有变化 | 不跨版本错配 |
| F11 | 损坏 PDF、HTML 假 PDF、加密 PDF | 拒绝与错误状态 |
| F12 | DOCX，含中文字体、公式、表格 | 转换和预览确认 |

大文件/超页数样本按脚本生成，不必把大二进制提交仓库。外部 API fixture 覆盖成功、字段缺失、404、429、超时、5xx 与不可用全文，保存脱敏响应并记录来源日期。

账号 fixture 至少包含：访客、未验证用户、已验证用户 A、已验证用户 B、管理员、被禁言用户。所有账号仅写入明确的测试数据库。私有论文至少属于两个不同用户。

### 16.2 核心功能用例

以下 ID 用于实现记录和测试追踪，每条都要有明确自动或人工验证方式。

| ID | 场景 | 通过条件 |
| --- | --- | --- |
| A01 | 选中跨文字 item 的句子发表 | 保存正确引用和页码，刷新恢复同一语句 |
| A02 | 同页两次相同句子 | 用上下文定位正确出现位置，无法消歧时降级 |
| A03 | 80%/100%/160%/200% 缩放 | 高亮仍覆盖同一原文，坐标不被改写 |
| A04 | 改变窗口、侧栏开关、设备像素比 | 高亮与标记重新对齐 |
| A05 | 旋转/CropBox/不同页尺寸 | 正反坐标映射正确 |
| A06 | 中文、emoji、连字、连字符 | 字数和选区映射一致，无截断代理对 |
| A07 | 无文字页框选 | 正常发布，标记区域定位，不宣称句子精确 |
| A08 | V1 评论后打开 V2 | 不把 V1 评论标在 V2 文字上；可返回 V1 |
| A09 | 非法页码、越界矩形、伪造 version | 服务端拒绝，数据库不新增 |
| A10 | 已有深链接 | 加载对应版本/页/线程，返回原位置可用 |
| D01 | 最新排序 | 严格按 createdAt/id，页码不干扰 |
| D02 | 热门排序 | 公式正确；重复赞、自赞、多人回复计数正确 |
| D03 | 100 条候选、密度 6 | 持续播放后续项，不仅循环前 6 条 |
| D04 | 全文候选含不同页和全文讨论 | 都可播放并显示正确位置标签 |
| D05 | 当前页模式 | 不出现其他页、其他版本或全文根讨论 |
| D06 | 候选播放结束 | 等待新内容；只有主动重播才重放 |
| D07 | 点赞、重渲染、SSE 重复到达 | 在场动画不重启，同一 ID 不重复入队 |
| D08 | 热度变化与分页 | 当前轨迹稳定，新批次重排，无静默丢项 |
| D09 | 悬停、长短文字、窗口变窄 | 无追尾；碰撞检查按真实宽度 |
| D10 | 选字、编辑、手动暂停、后台 | 暂停原因互不错误解除 |
| D11 | 开关和切换模式/页面/版本 | 队列生命周期符合第 8 节 |
| D12 | 删除/隐藏在场弹幕 | 及时移除，不再从旧缓存出现 |
| D13 | 快照过期或 Web 重启 | 可恢复、保留已播集合、无无限重试 |
| D14 | 本人 POST 与 SSE 到达次序颠倒 | 只展示一次，草稿状态正确 |
| C01 | 根评论和回复 | 回复继承正确 paper/根锚点，分页完整 |
| C02 | 跨论文 replyTo/root | 返回错误，无跨论文关联 |
| C03 | 超长、空白、HTML 内容 | 长度校验、纯文本安全展示 |
| C04 | 网络超时重复提交同幂等键 | 仅一条评论、一次通知和一次事件 |
| C05 | 编辑冲突 | expectedRevision 过旧返回 409，不静默覆盖 |
| C06 | 删除根评论但已有回复 | 根占位不泄露原内容，回复按规则可访问 |
| C07 | 同一用户高并发发言 | 原子限流，不超过配置额度 |
| C08 | 同时赞/取消赞/回复 | 最终计数与明细一致，不出现负数 |
| R01 | 两浏览器同论文 | 新增、修改、点赞、删除同步 |
| R02 | 断网期间多人发言再连接 | 按 revision 补齐或 reset 重建 |
| R03 | 补发期间同时新增 | 无订阅窗口丢失，无重复业务效果 |
| R04 | SSE abort/enqueue 失败/切换论文 | 定时器、连接和在线计数清理 |
| R05 | 私有化或下架时连接仍开着 | 立即撤回访问，后续内容不泄露 |

定位视觉验收使用稳定渲染后的实际矩形；建议普通文字边界偏差目标不超过 5 CSS px，同时必须校验引用正确，不能只有像素正确而命中错句。复杂字体样本若达不到，记录原因并显示降级，不能修改测试期望掩盖错位。

### 16.3 搜索、导入、账号与隐私用例

| ID | 场景 | 通过条件 |
| --- | --- | --- |
| S01 | 标题、作者、DOI、arXiv 输入 | 走正确 provider 和本地查询 |
| S02 | 明确 arXiv v1 | 下载和保存确实为 v1，不丢后缀 |
| S03 | 一个上游 429/超时 | 本站结果可用，缓存/partial 有明确说明 |
| S04 | 多请求相同查询 | 合并上游请求，缓存无私人匹配泄露 |
| S05 | 缺摘要/作者/引用数 | 展示未知，不编造值 |
| S06 | 连续输入后旧请求较晚返回 | 不覆盖最终关键词结果 |
| I01 | 标识符只有元数据无 PDF | 记录保留，不能假装可读，可重试 |
| I02 | 有效 PDF 上传 | 逐页信息、哈希、预览和可见性正确 |
| I03 | 伪 PDF/加密/过大/超页数 | 明确拒绝，任务无无限重试 |
| I04 | 没有 Content-Length 的大流 | 达上限即中断，不读完整响应 |
| I05 | 内网 URL/重定向到内网 | 下载器拒绝，所有跳转均检查 |
| I06 | DOCX 转换超时/字体缺失 | 清晰失败或预览提示，不发布坏 PDF |
| I07 | worker 处理一半被终止 | 租约后可重试，同一任务不重复发布 |
| I08 | 文件已写入而事务失败 | 重试可恢复，不丢已有对象、不重复版本 |
| I09 | 不带公开确认直接调用 API | 服务端拒绝公开 |
| I10 | Range 普通/尾部/越界/HEAD | 字节与状态符合约定，权限一致 |
| E01 | 注册并验证邮箱 | 真正完成验证；未验证不能发言 |
| E02 | 两次并发消费同令牌 | 只有一次成功 |
| E03 | 邮件链接被扫描器 GET | 不提前消费敏感令牌 |
| E04 | 找回不存在与存在邮箱 | 公开响应一致，只有存在账号收到邮件 |
| E05 | 密码重置后使用旧 JWT | 被拒绝，不能继续访问受保护接口 |
| E06 | 更换待验证新邮箱后点旧链接 | 不验证到错误目标邮箱 |
| E07 | 邮件未配置/发送失败 | 不显示虚假投递成功 |
| P01 | 访客/另一用户请求私有 PDF、评论、SSE | 均不可读取，不能只隐藏页面 |
| P02 | 匿名评论出现在首页、列表、通知、SSE | 无真实姓名、userId、头像、个人链接泄露 |
| P03 | 公开主页列表和统计 | 排除私有、匿名、隐藏和不展示内容 |
| P04 | 私人文件与其他用户文件哈希相同 | 不暴露他人的上传或授权状态 |
| P05 | 改 paperId/versionId/commentId/jobId | 各接口防止越权读写 |
| P06 | public 改 private / 下架 | 搜索、缓存、通知、文件和实时一致撤回 |
| P07 | 用户修改别人的标签或版本 | 被拒绝 |
| P08 | 昵称变更 | 新显示名生效，旧公开地址仍指向本人 |
| N01 | 回复别人/自己/匿名回复 | 接收者与署名正确，不自通知 |
| N02 | 重复赞/取消赞/关闭通知 | 无重复堆积，未读数一致 |
| N03 | 标记他人通知已读 | 被拒绝 |

### 16.4 真实性与人工验收

浏览器自动化覆盖主流程，另外人工检查 F02/F05/F06/F12 的版式与选区；截图需标明样本、缩放、浏览器和版本。不能用自生成“成功截图”代替实际页面截图。

受控真实服务验收至少包含一次 OpenAlex 查询、一个 arXiv 指定版本解析、一个 Crossref DOI、真实 SMTP 验证与重置邮件、真实部署下的双浏览器互动。外部不可用时记录为 pending，不与离线单元测试混写为全绿。

## 17. 性能、测试命令与 CI

### 17.1 初始性能目标

这些是待实测目标，不是现有成绩。测试报告必须记录硬件、浏览器、网络、数据量、冷热缓存和并发方式。

建议基准场景：4 vCPU / 8 GiB 应用环境、独立 PostgreSQL、10,000 条根评论与相关回复、50 个模拟读者、100 条 SSE 连接；客户端固定一台桌面设备，测试报告写明型号和浏览器。

| 指标 | 初始目标 |
| --- | --- |
| 评论列表/弹幕批次 API | 稳态 p95 < 500ms，不含外部搜索 |
| 发布到另一客户端可见 | 同区域网络稳态 p95 < 2s |
| 弹幕与阅读交互 | 常规桌面目标接近 60fps，无持续长任务阻塞选区 |
| 连续使用 | 30 分钟翻页/切换后，无持续增长的订阅、定时器和 PDF 实例 |
| 负载回归 | 预设负载下无非预期 5xx，错误与限流按设计返回 |
| 上游不可用 | 本站阅读和已缓存内容不被阻塞 |

浏览器帧率失败时先分析 DOM 数量、每帧 React 更新、文字测量和 PDF 资源；不能只降低测试负载。大 PDF 首屏时间分下载与渲染分别记录，不承诺所有 60 MiB 文件同样快。

### 17.2 新增验证命令

下列是计划新增的脚本名，并非声称仓库已经存在。实施时把它们接到 package.json 并保证文档与实际命令一致。

| 命令 | 范围 | 依赖 |
| --- | --- | --- |
| `npm run verify:privacy` | P 系列和越权检查 | 独立测试服务器/库 |
| `npm run verify:versions` | 版本迁移、锚点、进度 | 固定 PDF fixtures |
| `npm run verify:danmaku` | 排序、快照、队列、轨道逻辑 | 可控时钟，无真实外网 |
| `npm run verify:reader-v1` | 浏览器选区、播放、点击定位 | 测试浏览器 |
| `npm run verify:realtime` | 双客户端、重连、撤回权限 | 测试服务器 |
| `npm run verify:imports` | 上传、下载、转换、任务恢复 | 本地 HTTP fixtures、转换器 |
| `npm run verify:search-contract` | 各 provider 契约与失败 | 脱敏 fixtures |
| `npm run verify:mail` | 令牌、邮件、会话撤销 | 本地邮件捕获服务 |
| `npm run verify:migrations` | 旧数据升级与重复执行 | PostgreSQL 和串行 PGlite |
| `npm run verify:core` | 上述离线主流程的统一入口 | 本地可重复环境 |
| `npm run verify:external` | 真实学术 API 与受控邮箱 | 有凭据，显式按需执行 |

已有 `typecheck`、`build`、`verify:smoke`、`verify:anchor`、`verify:storage`、`verify:load` 等检查继续维护。旧 smoke 账号未验证时应调整测试种子，不关闭产品邮箱验证规则。

### 17.3 CI

每次 PR：锁文件安装 → 类型检查 → 单元/领域检查 → 迁移 → 本地 API 集成 → 生产构建 → 核心浏览器冒烟。使用独立 PostgreSQL service、临时存储和固定邮件/学术 API fixture，不依赖真实上游限流状态。

PGlite 兼容检查单独串行，不能多个测试进程打开同一目录。每个测试用户、论文和限流 bucket 隔离；时间相关测试注入时钟，不用十几分钟真实等待作为默认 CI。

失败保存日志和必要截图，脱敏邮件、token 和连接信息。外部真实检查与主 CI 分开，失败分类为代码回归/环境未就绪/上游不可用，不把 pending 当通过。

## 18. 部署、运行与恢复

### 18.1 部署形态

初版采用长驻 Node Web + PostgreSQL + 私有 S3 兼容存储 + 文件任务 worker + SMTP。可以使用 Docker Compose 统一启动，但不要为部署要求先重写应用。开发保留单进程 PGlite 和本地磁盘选项。

生产任务 worker 使用与 Web 相同提交、schema 与配置版本。反向代理支持 SSE 长连接和禁止缓冲；上传上限与应用一致，不能反向代理允许无上限而应用解析时才发现问题。

### 18.2 发布顺序

1. 备份数据库和对象引用清单，确认上一版本可用。
2. 在测试环境对当前数据副本演练迁移与回填，检查约束冲突和文件缺失报告。
3. 应用兼容性迁移，部署能读新旧数据的代码。
4. 完成回填，验证计数、权限和样本文件；切换新读取路径。
5. 在生产形态执行 smoke、双浏览器、邮件、上传与版本定位检查。
6. 观察错误、任务积压、SSE 和对象访问，再计划独立的旧列清理。

本文不授权直接部署生产。开发 AI 应准备可审核的构建、迁移说明与发布步骤，只有获得相应部署授权后执行真实发布。

### 18.3 备份和回滚

PostgreSQL 使用可恢复备份与独立恢复演练；对象存储开启合适保留机制或定时备份。数据库恢复不能只校验表行数，还应检查关键文件存在性和 SHA-256。

旧列清理前可回退兼容应用；清理后需明确恢复策略。优先修复前滚，不宣称任意 SQL 迁移可无损逆向执行。PGlite 文件备份按单进程约束停写执行，不能复制运行中目录后声称一致备份。

公开测试前完成一次受控恢复演练并记录所用版本、备份时间和结果。默认种子管理员密码不得进入生产账号；生产初始化单独创建/设置，不复用开发常量。

### 18.4 最少观测项

- API 请求 ID、延迟、错误码，按接口聚合。
- 搜索 provider 请求量、缓存命中、限流与失败。
- 文件任务阶段耗时、失败原因、重试与积压。
- 选区定位 exact/region/page/unavailable 比例，不记录私人 quote 原文。
- SSE 活跃连接、重连、补发/reset 和资源清理。
- 弹幕候选数、播放数、关闭率、点击原文次数；不把一次动画等同阅读或认可。
- 邮件接收请求、provider 接受/失败和退信状态（可用时）。

日志用于排错而非记录全量私人阅读内容。用户行为采集只收所需数据，公开测试页面说明用途；V1 不新增第三方广告追踪。

## 19. 分阶段任务与交付物

任务初始均为待实现。阶段完成后在独立 `docs/implementation-status.md` 中记录结果；本规格保持规则清晰，不在正文堆叠执行日志。

### M0 基线与访问边界

目标：明确现状，先阻止私人/匿名内容通过已有接口泄露。

- [ ] M0-01 检查工作区、锁文件、运行说明、现有迁移，建立可启动基线。
- [ ] M0-02 建立独立测试库、用户和固定 PDF fixture，停止依赖最新缓存 PDF。
- [ ] M0-03 统一 paper 读/管理权限；覆盖评论、点赞、标签、PDF、任务、主页、SSE。
- [ ] M0-04 引入显式 DTO；移除匿名 userId，修复首页、主页统计与通知署名。
- [ ] M0-05 将既有缺陷形成回归检查；记录当前构建和 smoke 的实际结果。

主要文件：session、papers/access、comments/dto、相关 Route Handlers、me 查询、首页。

完成证据：P01/P02/P03/P05/P07 通过；现有公开阅读与非匿名互动不回归；提交本阶段结果。若现有代码已有修复，用测试确认并跳过重复改写。

### M1 PDF 版本与定位评论

目标：上传一个 PDF，在具体原文位置发表，刷新后仍准确返回。

- [ ] M1-01 新增版本、页面信息、任务骨架和 AnchorV2；编写兼容旧数据迁移。
- [ ] M1-02 实现 PDF 验证、逐页文字层与哈希，固定不可变版本。
- [ ] M1-03 完成句子、区域、页面、全文四种目标及选择工具条。
- [ ] M1-04 统一 Unicode/归一化映射和旋转坐标，修复文字层错位。
- [ ] M1-05 评论正文/短文案、草稿、幂等发布、根与回复约束。
- [ ] M1-06 深链接、原文高亮、回到刚才位置、版本进度。

完成证据：A01–A10、C01–C04、I02/I03 通过；旧论文与评论可读取；本地 PDF 上传→选句→发表→刷新→定位的浏览器录像或截图。

阶段内可用测试已验证账号，不以外部 SMTP 未配置为由阻塞所有开发，也不把这种测试账号方案部署为公开注册逻辑。

### M2 核心弹幕体验

目标：整篇论文的弹幕真实连续播放，最新／热门模式正确。

- [ ] M2-01 新增弹幕查询、全文/当前页范围、热度公式和稳定排序。
- [ ] M2-02 最新 keyset、热门快照、过期恢复和服务端限额。
- [ ] M2-03 独立候选、pending、active、played 队列；支持持续加载和主动重播。
- [ ] M2-04 全阅读区轨道、文字测量、防碰撞、开关、字号、透明度与密度。
- [ ] M2-05 悬停、选区、编辑、手动和后台暂停原因管理。
- [ ] M2-06 弹幕详情、点赞、原文跳转、版本与页码标签。

完成证据：D01–D11/D13，通过 100 条不同长度弹幕连续播放；不能仅展示少量 CSS 循环动画。此阶段先通过受控接口刷新验证，不等待实时通道全部完成。

### M3 互动与可靠实时

目标：多个读者形成真实讨论，断线后可恢复一致状态。

- [ ] M3-01 统一根线程、回复分页、编辑冲突、删除占位、举报和管理隐藏。
- [ ] M3-02 点赞与有效回复人数事务、原子发言限流、自赞规则。
- [ ] M3-03 paper revision 与持久事件、单实例分发、SSE 补发和 reset。
- [ ] M3-04 POST/SSE 去重、匿名投影、删除在场内容、权限撤回。
- [ ] M3-05 两浏览器互动、断线、重启、订阅清理和负载初测。

完成证据：C05–C08、D12/D14、R01–R05、N01 基本通知创建通过。M1→M3 完成后，核心弹幕体验应可以在受控账号下完整演示。

### M4 搜索、元数据与导入

目标：用户不必提前准备文件，也能找到论文并进入可用的阅读流程。

- [ ] M4-01 provider 标准接口，本站/外部分区结果，明确输入路由。
- [ ] M4-02 OpenAlex 凭据、参数、缓存、请求合并、超时和限流处理。
- [ ] M4-03 arXiv 精确版本解析，Crossref DOI 解析与失败回退。
- [ ] M4-04 元数据先入库、后台全文获取、状态查询、重试、来源入口。
- [ ] M4-05 公开标识符去重、私人副本隔离、不确定匹配人工确认。
- [ ] M4-06 上传/下载流式限制、跳转地址检查、Range 与对象一致性。

完成证据：S01–S06、I01/I04/I05/I07/I08/I10；无全文仍有可理解的详情页；每个真实 provider 至少一个受控测试或明确 pending 原因。

### M5 邮箱账号与通知

目标：真实新用户能完成注册、验证和回访交流。

- [ ] M5-01 SMTP 和开发邮件捕获，生产配置健康检查。
- [ ] M5-02 注册、验证、重发、邮箱修改、密码找回的真实链路。
- [ ] M5-03 原子令牌消费、绑定目标邮箱、sessionVersion 与限流。
- [ ] M5-04 回复/点赞通知、匿名通知、未读角标与通知偏好。
- [ ] M5-05 未验证账号行为、旧账号过渡、OAuth 兼容。

完成证据：E01–E07、N01–N03；受控真实邮箱收到验证/重置邮件，链接可用且一次性。缺少 SMTP 凭据时交付代码与捕获服务测试，并标记“真实邮件待验，不能公开注册”。

### M6 页面、DOCX 与个人空间

目标：整理可发现、可持续使用的完整产品。

- [ ] M6-01 网站首页、继续阅读、本周热议、最近加入、最新公开讨论。
- [ ] M6-02 详情页的版本选择、可读状态、收藏、来源和管理操作。
- [ ] M6-03 我的上传/收藏/进度/评论/通知分页。
- [ ] M6-04 稳定 handle、公开主页、匿名及私人统计过滤、资料和偏好。
- [ ] M6-05 DOCX 后台转换、预览确认、错误提示和公开确认服务端检查。
- [ ] M6-06 窄屏抽屉、键盘操作、减少动态效果与空/加载/失败状态。

完成证据：F12 转换视觉检查、I06/I09、P04/P06/P08、主页隐私用例；首次访问用户能独立理解如何阅读和发弹幕。

### M7 集成、部署准备与试用

目标：给出真实可验证的 V1 完成结论。

- [ ] M7-01 整理 `.env.example`、README 快速启动、部署、迁移和恢复说明。
- [ ] M7-02 CI、生产构建、离线核心测试、旧功能回归和真实外部验证。
- [ ] M7-03 旧数据迁移演练、对象校验、备份恢复和版本回退准备。
- [ ] M7-04 固定负载性能检查与 30 分钟浏览器资源观察。
- [ ] M7-05 清理开发密码、测试内容和日志敏感信息。
- [ ] M7-06 邀请经用户同意的 3–5 名读者做任务测试，记录卡点并修复。

完成证据：第 20 节全部门槛满足；若部署或真实邮箱等需要外部条件，准确区分“实现完成”“集成待验”“公开可用”，不合并声称上线成功。

## 20. 最终完成标准

### 20.1 必须演示的完整场景

1. 一个新用户通过邮箱注册并验证。
2. 搜索一篇论文，识别可读状态，导入指定版本。
3. 打开 PDF，选中一句话发送短弹幕，同时在侧栏看到完整评论。
4. 第二个账号打开同一版本，在全文最新模式看到这条弹幕。
5. 点击弹幕查看引用，跳到原文，回复并点赞。
6. 热门模式按公式显示正确顺序；第一用户收到匿名/实名规则正确的通知。
7. 刷新、缩放、短暂断线后，内容与定位仍正确；已播内容不无故反复出现。
8. 上传一个私人 PDF，另一账号不能通过任何页面/API/SSE/主页读取。
9. 上传 DOCX，转换预览后确认；扫描 PDF 可以区域评论。
10. 删除或管理员隐藏弹幕，另一浏览器的在场弹幕和旧链接同步失效。

### 20.2 必须交付的工程材料

- 可启动的源码与锁文件、增量迁移、回填脚本和环境示例。
- 本文需求到实现/测试的映射与阶段状态记录。
- 固定测试 fixtures 来源、自动化脚本、CI。
- 真实执行的构建/测试结果，不能只有“预计可通过”。
- 三张以上实际界面截图：全文弹幕、定位讨论、个人空间；另附匿名/私有验证证据。
- 生产部署、备份恢复、已知限制和待验外部项。

### 20.3 不阻止 V1 的限制

没有 OCR、没有 LaTeX 在线编译、没有推荐算法、没有 AI、没有多实例部署，不阻止 V1 完成。没有真实弹幕队列、没有权限隔离、不能邮箱验证、只能使用假数据，则不能称作公开可用 V1。

## 21. 可直接复制给 AI 的实施指令

下面这段与本文件一起交给编程 AI。AI 不需要读本次聊天才能理解目标。

```text
请在 https://github.com/funw25/Happypapper 的现有项目上实施
《HappyPaper 弹幕阅读社区第一阶段实施规格》
（docs/06-danmaku-v1-implementation-plan.md）。

产品目标：保留并优先实现论文弹幕社区。用户可以搜索/上传论文，
在 PDF 阅读区观看全文弹幕，按发布时间最新优先或热度优先播放，
选中句子或框选区域发表弹幕/评论，点击定位原文并点赞回复。
使用邮箱注册与验证，完成首页、我的空间、公开主页和通知。
本阶段不要扩展 AI 问答、科研 Agent、推荐或模型训练。

先读取适用的 AGENTS.md，检查当前分支、未提交修改、README、
package-lock、数据库 schema、迁移与现有验证脚本。
审阅基线为 b089dfae29afe11fed548e165cb0aeff8e46891d，
如果当前仓库更晚，以实际代码判断哪些缺口已修复。
不要覆盖无关改动，不要重置已有用户数据。

按文档 M0 到 M7 依次完成；先完成受控账号下的
“PDF 上传→选句→弹幕→另一读者观看与回复”闭环。
每阶段运行对应验证，保持应用可启动。
实施默认值可以直接采用，不需要逐项再问。
只有影响核心需求、私密性、数据损失或需要真实外部凭据的
必要问题才向用户提出，同时继续独立工作。

重点：
1. 时间模式是发布时间最新优先，不是按阅读位置或视频时间轴。
2. 弹幕覆盖整个论文阅读区域，排序与原文锚点位置分离。
3. 密度是同时播放上限，不是只取前几条无限循环。
4. 评论和弹幕同源；版本不可变；私有和匿名规则覆盖所有接口。
5. 热门分页用稳定快照；SSE 可重连补发并去重。
6. PGlite 不允许多个进程打开同一目录；生产 worker 用 PostgreSQL。
7. 真实 SMTP、外部 API、对象存储未验证时如实标记待验。

每阶段输出：实现文件、迁移影响、执行命令与结果、
仍未完成项，以及 docs/implementation-status.md 的更新。
不要把静态检查、模拟响应或历史测试成绩当作本轮真实验收。
不要自行执行生产发布、购买服务或向真实用户群发邮件。
完成代码与发布准备后，再依照用户授权执行外部操作。
```

如果只安排一个工作批次，可将最后一段替换为：

```text
本次只执行 M0 和 M1，确保 PDF 版本、权限、句子/区域锚点、
评论发表和刷新恢复可用。保持数据兼容，跑完对应验收，
交付明确的下一批 M2 任务，不提前扩展搜索源或 AI 功能。
```

## 22. 决策、来源与后续维护

### 22.1 本版关键决策

| 决策 | 选择 | 原因 |
| --- | --- | --- |
| 产品主线 | 论文弹幕阅读与讨论 | 用户明确要求优先实现初衷 |
| 展示格式 | PDF + 独立索引/锚点 | 保留论文布局和已有 PDF.js 基础 |
| 内容模型 | 一条评论、多种展示 | 点赞回复和删除保持一致 |
| 排序 | 最新/热门两种 | 用户明确确认 |
| 默认范围 | 当前 PDF 版本全文 | 满足全文观看，同时避免跨版本错位 |
| 文件版本 | 不可变版本，旧评论留在旧版本 | 防止替换文件破坏定位 |
| 后端 | 现有 Next.js 单体 + 文件 worker | 控制改造成本，隔离耗时转换 |
| 实时 | 单 Web 实例 SSE + 持久事件 | 支持重连恢复，不提前引入分布式组件 |
| 注册 | 邮箱密码 + 真实验证 | 对应用户需求，保留既有 OAuth 兼容 |
| 上传公开 | 默认私有，服务端确认 | 防止处理流程隐式公开 |
| 研究/AI | 后续独立阶段 | 不占用本阶段核心路径 |

### 22.2 来源

仓库基线：[提交 b089dfa](https://github.com/funw25/Happypapper/tree/b089dfae29afe11fed548e165cb0aeff8e46891d)。核心路径包括 reader、anchor、papers、comments、auth、mailer、schema、realtime 和 scripts。

外部接口与格式参考：

- [OpenAlex 搜索](https://help.openalex.org/api/searching/)与[认证](https://help.openalex.org/api/authentication/)：参数、密钥、限流和分页应在接入时再次核对。
- [arXiv API 手册](https://info.arxiv.org/help/api/user-manual.html)：标识符、版本、字段查询和论文链接。
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)：DOI 元数据。
- [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)：引用、上下文、字符区间和资源状态。
- [LibreOffice PDF 转换参数](https://help.libreoffice.org/latest/en-GB/text/shared/guide/pdf_params.html?DbPAR=IMPRESS&System=UNIX)：后台转换能力；具体输出需视觉验收。
- [PDF.js 官方示例](https://mozilla.github.io/pdf.js/examples/)：阅读与渲染集成，实际 API 与锁定版本保持一致。

### 22.3 文档维护规则

用户后续明确修改优先于本版默认值。产品规则变更先更新对应章节，再改代码和测试；保持需求、接口、数据库和验收一致。新增功能不等于自动扩大 V1 范围。

执行记录放 `docs/implementation-status.md`，建议字段：任务 ID、状态、提交、变更摘要、验证命令、结果、证据路径、外部依赖、下一步。旧文档保留历史，README 链接到本规格作为本阶段实施入口，避免两份相互冲突的“当前计划”。

文档状态：规划完成，代码实施未开始。本次产物不包含对 GitHub 仓库的代码修改或生产发布。
