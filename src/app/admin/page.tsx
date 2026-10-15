import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import {
  CommentStatusActions,
  MuteActions,
  PaperVisibilityActions,
  ReportActions,
} from "@/components/admin/admin-actions";
import { currentUser } from "@/lib/session";
import {
  adminStats,
  listFlaggedComments,
  listPapersForAdmin,
  listReports,
  listUsers,
} from "@/lib/admin/queries";
import { KIND_LABELS } from "@/lib/comments/types";

export const dynamic = "force-dynamic";

const REASON_LABELS: Record<string, string> = {
  spam: "垃圾信息",
  abuse: "攻击性内容",
  offtopic: "与论文无关",
  copyright: "版权问题",
  other: "其他",
};

const TABS = [
  { value: "reports", label: "举报队列" },
  { value: "comments", label: "内容审核" },
  { value: "papers", label: "论文与版权" },
  { value: "users", label: "用户" },
] as const;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") notFound();

  const { tab, status } = await searchParams;
  const active = TABS.some((t) => t.value === tab) ? (tab as string) : "reports";
  const reportStatus = ["open", "resolved", "rejected", "all"].includes(status ?? "")
    ? (status as "open" | "resolved" | "rejected" | "all")
    : "open";

  const stats = await adminStats();
  const [reports, flagged, users, papers] = await Promise.all([
    active === "reports" ? listReports(reportStatus) : Promise.resolve([]),
    active === "comments" ? listFlaggedComments() : Promise.resolve([]),
    active === "users" ? listUsers() : Promise.resolve([]),
    active === "papers" ? listPapersForAdmin() : Promise.resolve([]),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-xl font-semibold">管理后台</h1>
        <p className="mt-1 text-sm text-[var(--paper-muted)]">
          待处理举报 {stats.openReports} · 已隐藏评论 {stats.hiddenComments} · 论文 {stats.papers} · 评论{" "}
          {stats.comments} · 用户 {stats.users}
        </p>

        <nav className="mt-6 flex flex-wrap gap-2 border-b border-[var(--paper-line)]">
          {TABS.map((item) => (
            <Link
              key={item.value}
              href={`/admin?tab=${item.value}`}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                active === item.value
                  ? "border-[var(--paper-accent)] text-[var(--paper-accent)]"
                  : "border-transparent text-[var(--paper-muted)]"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {active === "reports" ? (
          <>
            <div className="mt-4 flex gap-3 text-xs text-[var(--paper-muted)]">
              {(["open", "resolved", "rejected", "all"] as const).map((value) => (
                <Link
                  key={value}
                  href={`/admin?tab=reports&status=${value}`}
                  className={reportStatus === value ? "text-[var(--paper-accent)]" : "hover:underline"}
                >
                  {{ open: "待处理", resolved: "已处理", rejected: "已驳回", all: "全部" }[value]}
                </Link>
              ))}
            </div>
            <div className="mt-3 space-y-3">
              {reports.length === 0 ? (
                <p className="hp-card p-6 text-sm text-[var(--paper-muted)]">没有举报。</p>
              ) : (
                reports.map((report) => (
                  <article key={report.id} className="hp-card p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--paper-muted)]">
                      <span className="rounded-full border border-[var(--paper-line)] px-1.5">
                        {REASON_LABELS[report.reason] ?? report.reason}
                      </span>
                      <span>举报人 {report.reporterName ?? "已注销"}</span>
                      <span>
                        {new Date(report.createdAt).toLocaleString("zh-CN", { hour12: false })}
                      </span>
                      <span className="ml-auto">状态 {report.status}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">{report.commentContent}</p>
                    {report.commentQuote ? (
                      <p className="mt-2 border-l-2 border-[var(--paper-accent)] pl-2 text-xs text-[var(--paper-muted)]">
                        “{report.commentQuote.slice(0, 90)}”
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-[var(--paper-muted)]">
                      评论 #{report.commentId} · 作者 {report.commentAuthor ?? "已注销"} · 第{" "}
                      {report.commentPage} 页 · 评论状态 {report.commentStatus} ·{" "}
                      <Link href={`/read/${report.paperId}?page=${report.commentPage}`} className="hover:underline">
                        {report.paperTitle}
                      </Link>
                    </p>
                    {report.detail ? (
                      <p className="mt-1 text-xs text-[var(--paper-muted)]">补充说明：{report.detail}</p>
                    ) : null}
                    <div className="mt-3">
                      <ReportActions reportId={report.id} commentId={report.commentId} />
                    </div>
                  </article>
                ))
              )}
            </div>
          </>
        ) : null}

        {active === "comments" ? (
          <div className="mt-4 space-y-3">
            {flagged.map((comment) => (
              <article key={comment.id} className="hp-card p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--paper-muted)]">
                  <span>{comment.authorName ?? "已注销"}</span>
                  <span className="rounded-full border border-[var(--paper-line)] px-1.5">
                    {KIND_LABELS[comment.kind] ?? comment.kind}
                  </span>
                  <span>第 {comment.page} 页</span>
                  <span>♥ {comment.likeCount}</span>
                  {comment.openReports > 0 ? (
                    <span className="text-[var(--paper-danger)]">{comment.openReports} 条待处理举报</span>
                  ) : null}
                  <span className="ml-auto">状态 {comment.status}</span>
                </div>
                <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">{comment.content}</p>
                <p className="mt-2 text-xs text-[var(--paper-muted)]">
                  <Link href={`/read/${comment.paperId}?page=${comment.page}`} className="hover:underline">
                    {comment.paperTitle}
                  </Link>
                </p>
                <div className="mt-3">
                  <CommentStatusActions commentId={comment.id} status={comment.status} />
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {active === "papers" ? (
          <div className="mt-4 space-y-3">
            {papers.map((paper) => (
              <article key={paper.id} className="hp-card p-4">
                <Link href={`/papers/${paper.id}`} className="text-sm font-medium hover:underline">
                  {paper.title}
                </Link>
                <p className="mt-1 text-xs text-[var(--paper-muted)]">
                  来源 {paper.source} · 可见性 {paper.visibility} ·{" "}
                  {paper.hasTextLayer ? "有文本层" : "无文本层"} · {paper.commentCount} 条评论 ·{" "}
                  {new Date(paper.createdAt).toLocaleDateString("zh-CN")}
                </p>
                <div className="mt-3">
                  <PaperVisibilityActions
                    paperId={paper.id}
                    visibility={paper.visibility}
                    hasFile={paper.hasFile}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {active === "users" ? (
          <div className="mt-4 space-y-3">
            {users.map((account) => (
              <article key={account.id} className="hp-card p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/u/${encodeURIComponent(account.name)}`} className="font-medium hover:underline">
                    {account.name}
                  </Link>
                  <span className="text-xs text-[var(--paper-muted)]">{account.email}</span>
                  <span className="rounded-full border border-[var(--paper-line)] px-1.5 text-xs">
                    {account.role === "admin" ? "管理员" : "用户"}
                  </span>
                  {account.mutedUntil && new Date(account.mutedUntil).getTime() > Date.now() ? (
                    <span className="text-xs text-[var(--paper-danger)]">
                      禁言至 {new Date(account.mutedUntil).toLocaleString("zh-CN", { hour12: false })}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-[var(--paper-muted)]">
                  声望 {account.reputation} · {account.commentCount} 条评论 · 获赞 {account.receivedLikes} · 加入于{" "}
                  {new Date(account.createdAt).toLocaleDateString("zh-CN")}
                </p>
                <div className="mt-3">
                  <MuteActions
                    userId={account.id}
                    mutedUntil={
                      account.mutedUntil && new Date(account.mutedUntil).getTime() > Date.now()
                        ? account.mutedUntil.toISOString()
                        : null
                    }
                  />
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </main>
    </>
  );
}
