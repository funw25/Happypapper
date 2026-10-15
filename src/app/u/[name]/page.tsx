import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { Avatar } from "@/components/avatar";
import { commentsByUser, profileByName } from "@/lib/me/queries";
import { KIND_LABELS } from "@/lib/comments/types";

export const dynamic = "force-dynamic";

export default async function UserPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const profile = await profileByName(decodeURIComponent(name));
  if (!profile) notFound();

  const comments = profile.profileCommentsVisible
    ? await commentsByUser(profile.id, 30, { publicProfile: true })
    : [];
  const muted = profile.mutedUntil && profile.mutedUntil.getTime() > Date.now();

  return (
    <>
      <SiteHeader />
      <main className="hp-page-narrow">
        <div className="flex items-center gap-4">
          <Avatar
            size="lg"
            name={profile.name}
            avatarBg={profile.avatarBg}
            avatarFg={profile.avatarFg}
          />
          <div className="min-w-0">
            <h1 className="hp-page-title">{profile.name}</h1>
            <p className="hp-hint">
              {[
                `声望 ${profile.reputation}`,
                `${profile.commentCount} 条评论`,
                `获赞 ${profile.receivedLikes}`,
                profile.role === "admin" ? "管理员" : null,
                muted ? "禁言中" : null,
                `加入于 ${new Date(profile.createdAt).toLocaleDateString("zh-CN")}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        {profile.bio ? (
          <p className="hp-card mt-4 p-4 text-sm leading-6 whitespace-pre-line">{profile.bio}</p>
        ) : null}

        <h2 className="mt-8 mb-3 text-base font-semibold">最近的评论</h2>
        {!profile.profileCommentsVisible ? (
          <p className="hp-card p-6 text-sm text-[var(--paper-muted)]">
            这位读者选择不在个人主页展示自己的评论。评论仍然保留在论文阅读器中。
          </p>
        ) : comments.length === 0 ? (
          <p className="hp-card p-6 text-sm text-[var(--paper-muted)]">这位读者还没有公开的评论。</p>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => (
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
                </p>
              </article>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
