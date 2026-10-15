import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { listPapers, listRecentComments } from "@/lib/papers/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [latest, recent] = await Promise.all([listPapers({ limit: 6 }), listRecentComments(6)]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <form action="/papers" className="hp-card flex flex-wrap gap-2 p-3">
          <select className="hp-input" name="mode" defaultValue="local">
            <option value="local">本地论文库</option>
            <option value="remote">远程搜索</option>
          </select>
          <input
            className="hp-input"
            name="q"
            placeholder="标题、作者，或粘贴 arXiv ID / DOI"
          />
          <button className="hp-btn hp-btn-primary" type="submit">
            搜索
          </button>
        </form>

        <div className="mt-8 grid gap-8 lg:grid-cols-[2fr_1fr]">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">最新论文</h2>
              <Link href="/papers" className="text-sm text-[var(--paper-accent)]">
                全部
              </Link>
            </div>
            {latest.length === 0 ? (
              <EmptyPapers />
            ) : (
              <ul className="space-y-3">
                {latest.map((paper) => (
                  <li key={paper.id} className="hp-card p-4">
                    <Link href={`/papers/${paper.id}`} className="font-medium hover:underline">
                      {paper.title}
                    </Link>
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--paper-muted)]">
                      {paper.abstract ?? "无摘要"}
                    </p>
                    <p className="mt-2 text-xs text-[var(--paper-muted)]">
                      {paper.authors.slice(0, 3).join(", ")}
                      {paper.year ? ` · ${paper.year}` : ""}
                      {paper.venue ? ` · ${paper.venue}` : ""}
                      {` · ${paper.commentCount} 条评论`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold">最新讨论</h2>
            {recent.length === 0 ? (
              <p className="hp-card p-4 text-sm text-[var(--paper-muted)]">还没有评论。</p>
            ) : (
              <ul className="space-y-3">
                {recent.map((comment) => (
                  <li key={comment.id} className="hp-card p-3 text-sm">
                    <Link
                      href={`/read/${comment.paperId}?page=${comment.page}#c${comment.id}`}
                      className="line-clamp-2 hover:underline"
                    >
                      {comment.content}
                    </Link>
                    <p className="mt-1 text-xs text-[var(--paper-muted)]">
                      {comment.userName ?? "匿名"} · 第 {comment.page} 页 ·{" "}
                      <span className="line-clamp-1 inline">{comment.paperTitle}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

function EmptyPapers() {
  return (
    <div className="hp-card p-6 text-sm text-[var(--paper-muted)]">
      <p>论文库为空。添加第一篇论文开始验证定位评论。</p>
      <Link href="/papers/new" className="hp-btn hp-btn-primary mt-3">
        添加论文
      </Link>
    </div>
  );
}
