import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { discoverRankings } from "@/lib/discover";

export const dynamic = "force-dynamic";
export const metadata = { title: "发现 · HappyPaper" };

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const period = (await searchParams).period === "today" ? "today" : "all";
  const data = await discoverRankings(period);
  return <>
    <SiteHeader />
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <h1 className="text-xl font-semibold">发现</h1>
      <nav aria-label="榜单时间" className="flex gap-4 text-sm">
        <Link href="/discover" aria-current={period === "all" ? "page" : undefined} className={period === "all" ? "font-semibold underline" : ""}>累计最多</Link>
        <Link href="/discover?period=today" aria-current={period === "today" ? "page" : undefined} className={period === "today" ? "font-semibold underline" : ""}>今日榜单</Link>
      </nav>
      <p className="text-sm text-[var(--paper-muted)]">{period === "today"
        ? `数据日期：${data.dataDate}；截止 ${data.cutoffLabel}。当日新增数据计入下一日榜单。`
        : "累计统计当前可见的弹幕、有效点赞及已记录的访问。"}</p>
      <section aria-labelledby="danmaku-ranking">
        <h2 id="danmaku-ranking" className="mb-2 font-semibold">弹幕最多的论文</h2>
        {data.danmaku.length ? <ol className="list-inside list-decimal space-y-2 text-sm">{data.danmaku.map((item) =>
          <li key={item.id}><Link href={`/papers/${item.id}`} className="hover:underline">{item.title}</Link> · {item.total} 条弹幕</li>)}</ol>
          : <p className="text-sm text-[var(--paper-muted)]">暂无弹幕数据。</p>}
      </section>
      <section aria-labelledby="like-ranking">
        <h2 id="like-ranking" className="mb-2 font-semibold">获赞最多的评论 / 弹幕</h2>
        {data.likes.length ? <ol className="list-inside list-decimal space-y-3 text-sm">{data.likes.map((item) => {
          const params = new URLSearchParams({ comment: String(item.id), page: String(item.page) });
          if (item.versionId) params.set("version", item.versionId);
          return <li key={item.id}><Link href={`/read/${item.paperId}?${params}`} className="hover:underline">{item.content.slice(0, 160)}</Link>
            <p className="text-xs text-[var(--paper-muted)]">{item.authorName ?? "匿名用户"} · {item.title} · {item.total} 赞</p></li>;
        })}</ol> : <p className="text-sm text-[var(--paper-muted)]">暂无点赞数据。</p>}
      </section>
      <section aria-labelledby="visit-ranking">
        <h2 id="visit-ranking" className="mb-2 font-semibold">点击最多的论文</h2>
        {data.visits.length ? <ol className="list-inside list-decimal space-y-2 text-sm">{data.visits.map((item) =>
          <li key={item.id}><Link href={`/papers/${item.id}`} className="hover:underline">{item.title}</Link> · {item.total} 次访问</li>)}</ol>
          : <p className="text-sm text-[var(--paper-muted)]">暂无访问数据。</p>}
        <p className="mt-2 text-xs text-[var(--paper-muted)]">打开论文详情或阅读器计为访问，同账号或访客同一论文每日计一次。从功能上线后开始记录。</p>
      </section>
      <p className="text-xs text-[var(--paper-muted)]">仅展示公开且未下架的论文和可见讨论。累计赞按当前有效点赞统计；今日榜单按截止时仍有效的新增点赞统计。每榜最多 20 项。</p>
    </main>
  </>;
}
