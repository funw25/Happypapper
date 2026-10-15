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

export const dynamic = "force-dynamic";

export default async function ReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page: pageParam } = await searchParams;
  const paper = await getPaper(id);
  if (!paper) notFound();

  const user = await currentUser();
  const isOwner = Boolean(user && paper.uploadedBy === user.id);
  const isAdmin = user?.role === "admin";
  if (paper.visibility === "private" && !isOwner && !isAdmin) notFound();

  if (!paper.pdfPath) {
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

  const progress = await getProgress(user?.id ?? null, id);
  const privacy = user ? await getPrivacySettings(user.id) : null;
  const requestedPage = Number(pageParam);
  const initialPage =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : (progress?.page ?? 1);

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
          paperId={paper.id}
          hasTextLayer={paper.hasTextLayer}
          initialPage={initialPage}
          currentUserId={user?.id ?? null}
          anonymousDefault={privacy?.anonymousDefault ?? false}
        />
      </div>
    </div>
  );
}
