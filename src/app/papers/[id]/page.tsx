import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { PaperActions } from "@/components/paper-actions";
import { RetryPdfButton } from "@/components/papers/retry-pdf-button";
import { currentUser } from "@/lib/session";
import {
  paperAvailability,
  paperSourceLinks,
  sourceLabel,
  STAGE_LABELS,
} from "@/lib/papers/availability";
import { getFavorite, getPaper, getProgress } from "@/lib/papers/queries";

export const dynamic = "force-dynamic";

export default async function PaperDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const paper = await getPaper(id);
  if (!paper) notFound();

  const user = await currentUser();
  const isOwner = Boolean(user && paper.uploadedBy === user.id);
  const isAdmin = user?.role === "admin";

  if (paper.visibility === "private" && !isOwner && !isAdmin) {
    notFound();
  }

  const [favorited, progress] = await Promise.all([
    getFavorite(user?.id ?? null, paper.id),
    getProgress(user?.id ?? null, paper.id),
  ]);

  const availability = paperAvailability(paper);
  const links = paperSourceLinks(paper);

  return (
    <>
      <SiteHeader />
      <main className="hp-page-narrow">
        <h1 className="text-2xl leading-snug font-semibold">{paper.title}</h1>

        <p className="mt-3 text-sm text-[var(--paper-muted)]">
          {paper.authors.length > 0 ? paper.authors.join(", ") : "作者未知"}
        </p>
        <p className="mt-1 text-sm text-[var(--paper-muted)]">
          {[
            paper.year ? String(paper.year) : null,
            paper.venue,
            paper.doi ? `DOI ${paper.doi}` : paper.externalId,
            paper.license ? `许可 ${paper.license}` : null,
            `来源 ${sourceLabel(paper.source)}`,
            paper.visibility === "private" ? "私有" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {availability.readingAvailable ? (
            <Link href={`/read/${paper.id}`} className="hp-btn hp-btn-primary">
              {progress ? `继续阅读（第 ${progress.page} 页）` : "开始阅读"}
            </Link>
          ) : (
            <>
              <span className="hp-tag">{STAGE_LABELS[availability.stage]}</span>
              {user ? <RetryPdfButton paperId={paper.id} /> : null}
            </>
          )}
          <Link href={`/read/${paper.id}#comments`} className="hp-btn">
            查看 {paper.commentCount} 条评论
          </Link>
        </div>

        <div className="mt-6">
          <PaperActions
            paperId={paper.id}
            initialFavorited={favorited}
            initialTags={paper.tags}
            canEdit={Boolean(user)}
          />
        </div>

        {!availability.readingAvailable ? (
          <section className="hp-notice mt-6">
            <p>
              这篇论文已保存元数据，但本站没有可用的 PDF 副本
              {availability.errorLabel ? `：${availability.errorLabel}。` : "。"}
              {user ? "可以重试获取，或" : ""}
              在下方打开来源网站阅读原文。
            </p>
            {!user ? <p className="hp-hint mt-1">登录后可以重试获取 PDF。</p> : null}
          </section>
        ) : null}

        {!paper.hasTextLayer && availability.readingAvailable ? (
          <p className="hp-notice mt-6">
            该 PDF 未检测到文本层，句子级定位不可用，评论将锚定到页面位置。
          </p>
        ) : null}

        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">摘要</h2>
          <p className="text-sm leading-7 whitespace-pre-line">
            {paper.abstract ?? "该论文没有可用的摘要。"}
          </p>
        </section>

        <section className="hp-card mt-8 p-4 text-sm">
          <h2 className="mb-2 font-semibold">来源与文件状态</h2>
          <ul className="space-y-1 text-[var(--paper-muted)]">
            <li>元数据：已找到（{sourceLabel(paper.source)}）</li>
            <li>
              PDF：
              {availability.pdfCached
                ? "已缓存到本站"
                : availability.pdfAvailable
                  ? "找到候选地址，尚未缓存"
                  : "没有找到公开可用的 PDF"}
            </li>
            <li>阅读：{availability.readingAvailable ? "可以在线阅读" : "不可在线阅读"}</li>
            <li>文本层：{paper.hasTextLayer ? "有（支持句子级定位）" : "无（仅页面级定位）"}</li>
            {paper.pdfCheckedAt ? (
              <li>
                最近一次尝试：
                {new Date(paper.pdfCheckedAt).toLocaleString("zh-CN", { hour12: false })}
                {availability.errorLabel ? ` · ${availability.errorLabel}` : ""}
              </li>
            ) : null}
            {links.landing ? (
              <li className="truncate">
                来源网站：
                <a
                  className="ml-1 text-[var(--paper-accent)] hover:underline"
                  href={links.landing}
                  target="_blank"
                  rel="noreferrer"
                >
                  {links.landing}
                </a>
              </li>
            ) : null}
            {links.doi ? (
              <li className="truncate">
                DOI：
                <a
                  className="ml-1 text-[var(--paper-accent)] hover:underline"
                  href={links.doi}
                  target="_blank"
                  rel="noreferrer"
                >
                  {links.doi}
                </a>
              </li>
            ) : null}
            {links.pdf ? (
              <li className="truncate">
                {availability.pdfCached ? "原始来源" : "候选 PDF 地址（未验证）"}：
                <a
                  className="ml-1 text-[var(--paper-accent)] hover:underline"
                  href={links.pdf}
                  target="_blank"
                  rel="noreferrer"
                >
                  {links.pdf}
                </a>
              </li>
            ) : null}
          </ul>
        </section>
      </main>
    </>
  );
}
