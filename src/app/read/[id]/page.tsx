import Link from "next/link";
import { notFound } from "next/navigation";
import { ReaderMount } from "@/components/reader/reader-mount";
import { currentUser } from "@/lib/session";
import { getPrivacySettings } from "@/lib/me/settings";
import {
  paperAvailability,
  paperSourceLinks,
  STAGE_LABELS,
} from "@/lib/papers/availability";
import { getPaper, getProgress } from "@/lib/papers/queries";
import { canInteract, canReadPaper } from "@/lib/papers/access";
import { getPaperVersion, listPaperVersions } from "@/lib/papers/versions";
import { getComment } from "@/lib/comments/queries";

export const dynamic = "force-dynamic";

export default async function ReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; version?: string; comment?: string }>;
}) {
  const { id } = await params;
  const { page: pageParam, version: versionParam, comment: commentParam } = await searchParams;
  const paper = await getPaper(id);
  if (!paper) notFound();

  const user = await currentUser();
  if (!canReadPaper(paper, user?.id)) notFound();

  const requestedComment = Number(commentParam);
  const linkedComment = Number.isSafeInteger(requestedComment) && requestedComment > 0
    ? await getComment(requestedComment, user?.id) : null;
  const target = linkedComment?.paperId === paper.id && linkedComment.status === "visible" ? linkedComment : null;
  const selected = await getPaperVersion(paper, target?.paperVersionId ?? versionParam);
  if ((versionParam && !selected) || selected?.processingState === "unavailable") notFound();

  if (!paper.pdfPath && !selected) {
    const availability = paperAvailability(paper);
    const links = paperSourceLinks(paper);
    return (
      <main className="hp-page-narrow">
        <h1 className="mb-3 text-lg font-semibold">{paper.title}</h1>
        <p className="text-[var(--paper-muted)]">
          {STAGE_LABELS[availability.stage]}
          {availability.errorLabel ? `：${availability.errorLabel}` : ""}
          。本站只能阅读已缓存的 PDF，可以先在详情页重试获取，或直接打开来源网站。
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/papers/${paper.id}`} className="hp-btn hp-btn-primary">
            返回详情并重试
          </Link>
          {links.landing ? (
            <a href={links.landing} target="_blank" rel="noreferrer" className="hp-btn">
              打开来源网站 ↗
            </a>
          ) : null}
          {links.pdf ? (
            <a href={links.pdf} target="_blank" rel="noreferrer" className="hp-btn">
              打开候选 PDF ↗
            </a>
          ) : null}
        </div>
      </main>
    );
  }

  const [progress, versions] = await Promise.all([
    getProgress(user?.id ?? null, id, selected?.id),
    listPaperVersions(id),
  ]);
  const privacy = user ? await getPrivacySettings(user.id) : null;
  const requestedPage = Number(pageParam);
  const initialPage =
    target && target.anchorV2?.type !== "paper" ? target.page
      : Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : (progress?.page ?? 1);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--paper-line)] bg-[var(--paper-surface)] px-4">
        <Link href={`/papers/${paper.id}`} className="text-sm text-[var(--paper-muted)] hover:text-[var(--paper-accent)]">
          ← 详情
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium" title={paper.title}>
          {paper.title}
        </h1>
        <Link href="/" className="text-sm text-[var(--paper-muted)] hover:text-[var(--paper-accent)]">
          HappyPaper
        </Link>
      </header>
      <div className="min-h-0 flex-1">
        <ReaderMount
          key={`${selected?.id ?? paper.id}:${target?.id ?? "reader"}`}
          paperId={paper.id}
          versionId={selected?.id ?? null}
          versionLabel={selected?.versionLabel ?? "PDF"}
          versions={versions.filter((version) => version.state !== "unavailable")}
          initialCommentId={target?.id ?? null}
          initialPage={initialPage}
          initialYNorm={target || pageParam ? 0 : progress?.yNorm ?? 0}
          currentUserId={user?.id ?? null}
          canPublish={canInteract(user)}
          anonymousDefault={privacy?.anonymousDefault ?? false}
        />
      </div>
    </div>
  );
}
