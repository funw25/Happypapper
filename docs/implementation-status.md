# HappyPaper 弹幕 V1 实施状态

更新时间为 2026-11-24（Asia/Singapore）。实施分支为 codex/danmaku-v1，起点为 b089dfae29afe11fed548e165cb0aeff8e46891d。

| 阶段 | 状态 | 已完成与下一步 |
| --- | --- | --- |
| M0 | 本地通过 | 访问策略、匿名投影、固定样本和脱离外部服务的权限验证。 |
| M1 | 待验收 | PDF 版本、真实解析、AnchorV2 和选区回放。 |
| M2 | 待开始 | 全文最新/热门队列、弹幕控件和播放体验。 |
| M3 | 待开始 | 线程、事务、事件补发和双读者闭环。 |
| M4 | 待开始 | 检索、后台导入、服务商实测。 |
| M5 | 待开始 | 邮件投递、会话、通知。 |
| M6 | 待开始 | 首页、个人空间、DOCX、窄屏和可访问性。 |
| M7 | 待开始 | 迁移恢复、CI、负载和发布验收。 |

## M0 权限与运行基线

| 任务 | 变更与主要位置 | 本轮证据 |
| --- | --- | --- |
| M0-01 | 检查仓库、锁文件、Next.js 运行入口和十个已有迁移。Next.js 从 16.4.0 更新至 16.4.6。 | 锁文件安装成功。原始基线运行原冒烟 63/63。更新后 npm audit --omit=dev 返回 0 项。 |
| M0-02 | tests/fixtures 固定五页 PDF，scripts/lib/verification-runtime.mjs 启动测试库、文件目录和应用。 | verify:anchor 12/12。verify:access 使用两名已验证读者、访客、未验证读者、禁言用户和管理员。 |
| M0-03 | src/lib/papers/access.ts 统一读取与操作条件，接入阅读器、列表、PDF、收藏、进度、评论、标签及 SSE。 | verify:access 验证 P01、P05、P07，并检查 P06 的下架与恢复。 |
| M0-04 | 评论按字段投影，界面用 viewer 权限渲染操作。首页、个人主页、通知仅显示相应可见内容。 | verify:access 验证 P02、P03 以及匿名回复通知。 |
| M0-05 | scripts/verify-access.mjs 通过真实 HTTP 浏览器端所用的 API 连接本机 Next.js，不依赖远程 PDF。 | verify:access 78 项通过。类型检查、Next.js 生产构建与 git diff --check 通过。 |

迁移 0010 新增 papers.status，已有行默认 active，原有 visibility、PDF、账号和评论均保留。旧数据的 private 状态同时可能代表私有上传或历史下架，缺少独立信息可区分，迁移保留原状态。从本次开始下架和私有可以独立设置。第一轮迁移与权限验证只使用测试库。

P01、P02、P03、P05、P07 的阶段验证覆盖当前路由和数据模型。后续新增版本、任务、通知配置等路由需要继续接入统一策略。远端推送等待 GitHub 仓库写权限。尚待实际浏览器验收、PostgreSQL 兼容验证、持久化授权确认、生产 SMTP、外部对象存储与真实部署联调。
