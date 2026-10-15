import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { PaperSearchForm } from "@/components/papers/search-form";
import { ImportPaperButton } from "@/components/papers/import-paper-button";
import { currentUser } from "@/lib/session";
import {
  findPublisher,
  isPaperSort,
  PAPER_PUBLISHERS,
  type PaperSearchResult,
  type PaperSort,
} from "@/lib/papers/openalex";
import { runRemoteSearch } from "@/lib/papers/search-service";
import { findImported, listPapers } from "@/lib/papers/queries";

export const dynamic = "force-dynamic";

const SORT_LABELS: { value: PaperSort; label: string }[] = [
  { value: "relevance", label: "相关度" },
  { value: "cited", label: "引用数" },
  { value: "recent", label: "发表时间" },
];

function minutesAgo(at: number): number {
  return Math.max(1, Math.round((Date.now() - at) / 60000));
}

function resultLanding(result: PaperSearchResult): string | null {
  if (result.source === "arxiv") {
    return `https://arxiv.org/abs/${result.externalId.replace(/v\d+$/i, "")}`;
  }
  return result.doi ? `https://doi.org/${result.doi}` : null;
}

export default async function PapersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    tag?: string;
    mode?: string;
    sort?: string;
    source?: string;
  }>;
}) {
  const { q, tag, mode, sort, source } = await searchParams;
  const query = q?.trim() ?? "";
  const remoteMode = mode === "remote";
  const activeSort: PaperSort = isPaperSort(sort) ? sort : "relevance";
  const publisher = findPublisher(source);
  const user = await currentUser();

  const remoteQuery = remoteMode ? query : "";
  const rows = await listPapers({
    q: remoteMode ? undefined : query || undefined,
    tag,
    limit: 50,
  });

  let remote: PaperSearchResult[] = [];
  let remoteTotal: number | null = null;
  let remoteError: string | null = null;
  let remoteStale = false;
  let remoteCachedAt: number | null = null;
  let imported = new Map<string, string>();
  if (remoteQuery) {
    const outcome = await runRemoteSearch({
      query: remoteQuery,
      sort: activeSort,
      publisher,
      identity: user ? `user:${user.id}` : "page:anonymous",
    });
    remote = outcome.results;
    remoteTotal = outcome.total;
    remoteError = outcome.error?.message ?? null;
    remoteStale = outcome.stale;
    remoteCachedAt = outcome.cachedAt;
    imported = await findImported(
      remote.map((result) => ({
        source: result.source,
        externalId: result.externalId,
        doi: result.doi,
      })),
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="hp-page max-w-4xl">
        <PaperSearchForm
          initialQuery={query}
          initialSort={activeSort}
          initialSource={publisher?.key ?? ""}
          initialMode={remoteMode ? "remote" : "local"}
          options={{ sorts: SORT_LABELS, publishers: PAPER_PUBLISHERS }}
        />

        {remoteQuery ? (
          <section className="mt-6">
            <h2 className="hp-section-title mb-3">
              远程检索“{remoteQuery}”（{remote.length}
              {remoteTotal !== null ? ` / 命中 ${remoteTotal}` : ""}）
              <span className="hp-hint ml-2">
                排序：{SORT_LABELS.find((o) => o.value === activeSort)?.label}
                {publisher ? ` · 来源：${publisher.label}` : ""}
              </span>
            </h2>

            {remoteError ? (
              <p className="hp-notice mb-3">
                {remoteError}
                {remoteStale && remoteCachedAt
                  ? `。以下为 ${minutesAgo(remoteCachedAt)} 分钟前的缓存结果。`
                  : "。"}
              </p>
            ) : null}

            {remote.length === 0 ? (
              <p className="hp-card p-6 text-sm text-[var(--paper-muted)]">
                {remoteError
                  ? "这次没有可用结果，稍后再试，或用 arXiv ID / DOI 直接检索。"
                  : "没有匹配的论文。可以换关键词，或用 arXiv ID / DOI 直接检索。"}
              </p>
            ) : (
              <ul className="space-y-3">
                {remote.map((result) => {
                  const key = `${result.source}:${result.externalId}`;
                  const existingId =
                    imported.get(key) ??
                    (result.doi ? imported.get(`doi:${result.doi}`) : undefined);
                  const landing = resultLanding(result);
                  return (
                    <li key={key} className="hp-card p-4">
                      <div className="flex items-start justify-between gap-4">
                        <span className="font-medium">{result.title}</span>
                        <span className="hp-tag shrink-0">
                          {result.source === "arxiv" ? "arXiv" : "DOI"}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-[var(--paper-muted)]">
                        {result.abstract ?? "无摘要"}
                      </p>
                      <p className="hp-meta mt-2">
                        {result.authors.slice(0, 4).join(", ")}
                        {result.authors.length > 4 ? " 等" : ""}
                        {result.year ? ` · ${result.year}` : ""}
                        {result.venue ? ` · ${result.venue}` : ""}
                        {result.citedByCount !== null ? ` · 被引 ${result.citedByCount}` : ""}
                        {result.license ? ` · ${result.license}` : ""}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                        <span className="hp-tag">
                          {result.pdfUrl ? "有公开 PDF" : "仅元数据，无可用 PDF"}
                        </span>
                        {landing ? (
                          <a
                            href={landing}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-[var(--paper-muted)] hover:text-[var(--paper-accent)] hover:underline"
                          >
                            打开来源网站 ↗
                          </a>
                        ) : null}
                        {existingId ? (
                          <Link href={`/papers/${existingId}`} className="hp-btn">
                            已在库中，去详情
                          </Link>
                        ) : (
                          <>
                            <ImportPaperButton
                              identifier={result.externalId}
                              hasPdf={result.pdfUrl !== null}
                            />
                            <Link
                              href={`/papers/new?title=${encodeURIComponent(result.title)}`}
                              className="text-xs text-[var(--paper-muted)] hover:underline"
                            >
                              改用本地 PDF
                            </Link>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : (
          <>
            <h2 className="mt-6 mb-3 text-base font-semibold">
              {query ? `本地库中“${query}”的结果` : "本地论文库"}（{rows.length}）
            </h2>

            {rows.length === 0 ? (
              <p className="hp-card p-6 text-sm text-[var(--paper-muted)]">
                本地库没有匹配的论文。要在 arXiv / DOI 全库里检索，把上方切换成“远程搜索”。
              </p>
            ) : (
              <ul className="space-y-3">
                {rows.map((paper) => (
                  <li key={paper.id} className="hp-card p-4">
                    <div className="flex items-start justify-between gap-4">
                      <Link href={`/papers/${paper.id}`} className="font-medium hover:underline">
                        {paper.title}
                      </Link>
                      <span className="hp-meta shrink-0">{paper.commentCount} 条评论</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--paper-muted)]">
                      {paper.abstract ?? "无摘要"}
                    </p>
                    <p className="hp-meta mt-2">
                      {paper.authors.slice(0, 4).join(", ")}
                      {paper.year ? ` · ${paper.year}` : ""}
                      {paper.venue ? ` · ${paper.venue}` : ""}
                      {paper.source === "upload" ? " · 用户上传" : ""}
                      {paper.visibility === "private" ? " · 私有" : ""}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="hp-tag">
                        {paper.pdfPath
                          ? "可在线阅读"
                          : paper.pdfFetchError
                            ? "仅有元数据（PDF 获取失败）"
                            : "仅有元数据"}
                      </span>
                      {paper.pdfPath === null && paper.pdfUrl ? (
                        <a
                          href={paper.source === "arxiv" && paper.externalId
                            ? `https://arxiv.org/abs/${paper.externalId}`
                            : paper.pdfUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-[var(--paper-muted)] hover:text-[var(--paper-accent)] hover:underline"
                        >
                          打开来源网站 ↗
                        </a>
                      ) : null}
                    </p>
                    {paper.tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {paper.tags.map((t) => (
                          <Link
                            key={t}
                            href={`/papers?tag=${encodeURIComponent(t)}`}
                            className="hp-tag hover:text-[var(--paper-accent)]"
                          >
                            {t}
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </>
  );
}
