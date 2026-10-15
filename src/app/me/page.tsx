import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { Avatar } from "@/components/avatar";
import { MarkAllReadButton } from "@/components/notifications/mark-read-button";
import { LikeNotificationToggle } from "@/components/notifications/like-notification-toggle";
import { currentUser } from "@/lib/session";
import { commentsByUser, favoritesByUser, readingByUser } from "@/lib/me/queries";
import { likeNotificationsEnabled, listNotifications } from "@/lib/notifications/queries";
import { KIND_LABELS } from "@/lib/comments/types";

export const dynamic = "force-dynamic";

const TABS = [
  { value: "comments", label: "我的评论" },
  { value: "notifications", label: "通知" },
  { value: "favorites", label: "收藏" },
  { value: "reading", label: "阅读记录" },
] as const;

export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { tab } = await searchParams;
  const active = TABS.some((t) => t.value === tab) ? (tab as string) : "comments";

  const [myComments, myFavorites, myReading, inbox, likeNotifications] = await Promise.all([
    active === "comments" ? commentsByUser(user.id) : Promise.resolve([]),
    active === "favorites" ? favoritesByUser(user.id) : Promise.resolve([]),
    active === "reading" ? readingByUser(user.id) : Promise.resolve([]),
    active === "notifications" ? listNotifications(user.id, 20, 0) : Promise.resolve(null),
    active === "notifications" ? likeNotificationsEnabled(user.id) : Promise.resolve(true),
  ]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex items-center gap-3">
          <Avatar size="lg" name={user.name} avatarBg={user.avatarBg} avatarFg={user.avatarFg} />
          <div>
            <h1 className="hp-page-title">{user.name} 的阅读空间</h1>
            <p className="hp-hint mt-1">
              <Link href={`/u/${encodeURIComponent(user.name)}`} className="text-[var(--paper-accent)] hover:underline">
                查看公开主页
              </Link>
            </p>
          </div>
        </div>

        <nav className="mt-6 flex gap-2 border-b border-[var(--paper-line)]">
          {TABS.map((item) => (
            <Link
              key={item.value}
              href={`/me?tab=${item.value}`}
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

        <div className="mt-4 space-y-3">
          {active === "comments" ? (
            myComments.length === 0 ? (
              <Empty text="还没有发布过评论。" />
            ) : (
              myComments.map((comment) => (
                <article key={comment.id} className="hp-card p-4">
                  <p className="text-sm leading-6 whitespace-pre-wrap">{comment.content}</p>
                  {comment.quote ? (
                    <p className="mt-2 border-l-2 border-[var(--paper-accent)] pl-2 text-xs text-[var(--paper-muted)]">
                      “{comment.quote.slice(0, 80)}
                      {comment.quote.length > 80 ? "…" : ""}”
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-[var(--paper-muted)]">
                    <span className="rounded-full border border-[var(--paper-line)] px-1.5">
                      {KIND_LABELS[comment.kind] ?? comment.kind}
                    </span>
                    <Link
                      href={`/read/${comment.paperId}?page=${comment.page}#c${comment.id}`}
                      className="ml-2 hover:underline"
                    >
                      {comment.paperTitle} · 第 {comment.page} 页
                    </Link>
                    <span className="ml-2">♥ {comment.likeCount}</span>
                    <span className="ml-2">
                      {new Date(comment.createdAt).toLocaleString("zh-CN", { hour12: false })}
                    </span>
                  </p>
                </article>
              ))
            )
          ) : null}

          {active === "notifications" ? (
            inbox === null || inbox.items.length === 0 ? (
              <Empty text="还没有通知。有人回复你的评论时会出现在这里。" />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-[var(--paper-muted)]">
                    共 {inbox.total} 条，未读 {inbox.unread} 条
                  </p>
                  <span className="flex flex-wrap items-center gap-2">
                    <LikeNotificationToggle initial={likeNotifications} />
                    <MarkAllReadButton unread={inbox.unread} />
                  </span>
                </div>
                {inbox.items.map((item) => (
                  <article
                    key={item.id}
                    className={`hp-card p-4 ${item.readAt ? "" : "border-l-2 border-[var(--paper-accent)]"}`}
                  >
                    <p className="text-sm">
                      <span className="font-medium">{item.actorName ?? "有人"}</span>
                      <span className="text-[var(--paper-muted)]">
                        {item.type === "like" ? " 赞了你的评论" : " 回复了你的评论"}
                      </span>
                      {item.readAt ? null : (
                        <span className="ml-2 rounded-full bg-[var(--paper-accent)] px-1.5 text-xs text-[var(--paper-accent-fg)]">
                          未读
                        </span>
                      )}
                    </p>
                    <p className="mt-1 line-clamp-2 border-l-2 border-[var(--paper-line)] pl-2 text-sm text-[var(--paper-muted)]">
                      {item.commentContent}
                    </p>
                    <p className="mt-2 text-xs text-[var(--paper-muted)]">
                      <Link
                        href={`/read/${item.paperId}?page=${item.page}#c${item.commentId}`}
                        className="hover:underline"
                      >
                        {item.paperTitle} · 第 {item.page} 页
                      </Link>
                      <span className="ml-2">
                        {new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}
                      </span>
                    </p>
                  </article>
                ))}
              </>
            )
          ) : null}

          {active === "favorites" ? (
            myFavorites.length === 0 ? (
              <Empty text="还没有收藏论文。" />
            ) : (
              myFavorites.map((paper) => (
                <article key={paper.paperId} className="hp-card p-4">
                  <Link href={`/papers/${paper.paperId}`} className="font-medium hover:underline">
                    {paper.title}
                  </Link>
                  <p className="mt-1 text-xs text-[var(--paper-muted)]">
                    {paper.authors.slice(0, 3).join(", ")}
                    {paper.year ? ` · ${paper.year}` : ""}
                    {paper.venue ? ` · ${paper.venue}` : ""}
                    {` · ${paper.commentCount} 条评论`}
                  </p>
                </article>
              ))
            )
          ) : null}

          {active === "reading" ? (
            myReading.length === 0 ? (
              <Empty text="还没有阅读记录。" />
            ) : (
              myReading.map((entry) => (
                <article key={entry.paperId} className="hp-card p-4">
                  <Link href={`/read/${entry.paperId}`} className="font-medium hover:underline">
                    {entry.title}
                  </Link>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--paper-line)]">
                    <div
                      className="h-full bg-[var(--paper-accent)]"
                      style={{ width: `${Math.round(Math.min(1, Math.max(0, entry.progress)) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-[var(--paper-muted)]">
                    读到第 {entry.page} 页 ·{" "}
                    {new Date(entry.updatedAt).toLocaleString("zh-CN", { hour12: false })}
                  </p>
                </article>
              ))
            )
          ) : null}
        </div>
      </main>
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="hp-card p-6 text-sm text-[var(--paper-muted)]">{text}</p>;
}
