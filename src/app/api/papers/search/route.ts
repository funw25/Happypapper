import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { currentUser } from "@/lib/session";
import { findPublisher, isPaperSort } from "@/lib/papers/openalex";
import { runRemoteSearch } from "@/lib/papers/search-service";
import { findImported } from "@/lib/papers/queries";

/**
 * Remote paper search (docs/03-requirements.md PAPER-001 to PAPER-003).
 * Reading is anonymous, so this endpoint does not require a session.
 *
 * `sort` selects relevance, citation count or recency; `source` restricts the
 * query to one publisher (see PAPER_PUBLISHERS). Unknown values fall back to
 * the default rather than failing, because both arrive from user-editable URLs.
 *
 * Results carry `cached`/`stale` and an `error` object: a throttled upstream can
 * still answer from the cache, and the client is expected to say so rather than
 * present old results as fresh (PAPER-006).
 */
function requesterIdentity(request: Request, userId: string | null): string {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${forwarded || "local"}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return jsonError("INVALID_INPUT", 400, "请填写标题、作者、arXiv ID 或 DOI");
  }

  const rawSort = url.searchParams.get("sort");
  const sort = isPaperSort(rawSort) ? rawSort : "relevance";
  const publisher = findPublisher(url.searchParams.get("source"));
  const user = await currentUser();

  const outcome = await runRemoteSearch({
    query: q,
    sort,
    publisher,
    limit: 12,
    identity: requesterIdentity(request, user?.id ?? null),
  });

  const payload = {
    query: q,
    sort,
    source: publisher?.key ?? null,
    total: outcome.total,
    cached: outcome.cached,
    stale: outcome.stale,
    cachedAt: outcome.cachedAt ? new Date(outcome.cachedAt).toISOString() : null,
    // `error` is always a machine-readable code and `detail` always the human
    // sentence, matching the shape of jsonError so clients parse one format
    // whether results came back or not. A stale answer carries both results and
    // an error, which is the point: show the cache, say why it is old.
    error: outcome.error?.code ?? null,
    detail: outcome.error?.message ?? null,
    retryAfterSeconds: outcome.error?.retryAfterSeconds ?? null,
    results: [] as unknown[],
  };

  if (!outcome.ok && outcome.results.length === 0) {
    const status = outcome.error?.code === "SEARCH_RATE_LIMITED" ? 429 : 503;
    const response = NextResponse.json(
      { ...payload, results: [], error: outcome.error?.code ?? "SEARCH_FAILED", detail: outcome.error?.message ?? "论文检索服务暂时不可用" },
      { status },
    );
    if (outcome.error?.retryAfterSeconds) {
      response.headers.set("retry-after", String(outcome.error.retryAfterSeconds));
    }
    return response;
  }

  const imported = await findImported(
    outcome.results.map((result) => ({
      source: result.source,
      externalId: result.externalId,
      doi: result.doi,
    })),
  );

  return NextResponse.json({
    ...payload,
    results: outcome.results.map((result) => ({
      ...result,
      hasPdf: result.pdfUrl !== null,
      importedPaperId:
        imported.get(`${result.source}:${result.externalId}`) ??
        (result.doi ? (imported.get(`doi:${result.doi}`) ?? null) : null),
    })),
  });
}
