/**
 * Paper metadata comes from OpenAlex: one endpoint covers both arXiv IDs and
 * DOIs, needs no API key, and reports open-access PDF locations.
 */

export type ParsedIdentifier = { source: "arxiv" | "doi"; id: string };

export type PaperMetadata = {
  source: "arxiv" | "doi";
  externalId: string;
  title: string;
  abstract: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  pdfCandidates: string[];
  license: string | null;
};

const OPENALEX = "https://api.openalex.org/works";
const MAILTO = "happypaper-dev@example.com";

/**
 * Upstream failures are classified rather than collapsed into one error string:
 * the search page and the API report a throttle differently from an outage, and
 * only the throttle carries a usable "try again in N seconds".
 */
export type OpenAlexFailure = "rate_limited" | "unavailable" | "not_found";

export class OpenAlexError extends Error {
  constructor(
    readonly kind: OpenAlexFailure,
    readonly status: number | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`OPENALEX_${kind.toUpperCase()}${status ? `:${status}` : ""}`);
  }
}

/**
 * OpenAlex answers 429 when calls arrive faster than its ~10/s budget, and
 * occasionally returns a transient 5xx. Both are worth one short retry: without
 * it a single throttled request turns a whole search into an error, which is
 * what happened before this helper existed.
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// A hung upstream connection must not hold a page render open indefinitely.
const REQUEST_TIMEOUT_MS = 9000;

function classify(status: number, retryAfterSeconds: number | null): OpenAlexError {
  if (status === 404) return new OpenAlexError("not_found", status);
  if (status === 429) return new OpenAlexError("rate_limited", status, retryAfterSeconds);
  return new OpenAlexError("unavailable", status, retryAfterSeconds);
}

async function fetchOpenAlex(url: string, attempt = 0): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout or a DNS/socket failure is an outage, not a throttle; retrying a
    // nine-second timeout doubles the wait for a reader who is staring at a
    // spinner, so this path reports immediately.
    throw new OpenAlexError("unavailable", null, null);
  }

  if (RETRYABLE_STATUS.has(response.status) && attempt < 2) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "0");
    // The advertised Retry-After can be an hour; an interactive search must not
    // hold the request open, so the wait is capped and a persistent 429 is
    // reported to the reader rather than waited out.
    const delayMs = Math.min(
      retryAfter > 0 ? retryAfter * 1000 : 500 * (attempt + 1),
      2000,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fetchOpenAlex(url, attempt + 1);
  }
  return response;
}

/** Sends the request and converts a non-ok status into a classified error. */
async function requestOpenAlex(url: string): Promise<unknown> {
  const response = await fetchOpenAlex(url);
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "0");
    throw classify(response.status, retryAfter > 0 ? retryAfter : null);
  }
  return response.json();
}

export function parseIdentifier(input: string): ParsedIdentifier | null {
  const raw = input.trim();
  if (!raw) return null;

  const arxivUrl = raw.match(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+)/i);
  if (arxivUrl) {
    return { source: "arxiv", id: arxivUrl[1].replace(/\.pdf$/i, "") };
  }

  const arxivBare = raw.match(/^(?:arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:\.pdf)?$/i);
  if (arxivBare) {
    return { source: "arxiv", id: arxivBare[1] };
  }

  const doi = raw.match(/(10\.\d{4,9}\/[^\s"'<>]+)/i);
  if (doi) {
    return { source: "doi", id: doi[1].replace(/[.,;]$/, "").toLowerCase() };
  }

  return null;
}

function reconstructAbstract(inverted: Record<string, number[]> | null | undefined): string | null {
  if (!inverted) return null;
  const entries: [number, string][] = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const position of positions) entries.push([position, word]);
  }
  if (entries.length === 0) return null;
  entries.sort((a, b) => a[0] - b[0]);
  return entries.map(([, word]) => word).join(" ");
}

type OpenAlexLocation = {
  pdf_url?: string | null;
  landing_page_url?: string | null;
  license?: string | null;
  is_oa?: boolean | null;
};

type OpenAlexWork = {
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  publication_date?: string | null;
  cited_by_count?: number | null;
  ids?: { arxiv?: string | null; doi?: string | null } | null;
  authorships?: { author?: { display_name?: string | null } | null }[];
  primary_location?:
    | { landing_page_url?: string | null; source?: { display_name?: string | null } | null }
    | null;
  best_oa_location?: OpenAlexLocation | null;
  open_access?: { oa_url?: string | null } | null;
  locations?: OpenAlexLocation[] | null;
  abstract_inverted_index?: Record<string, number[]> | null;
};

/**
 * Resolves an identifier to the DOI OpenAlex can look up. arXiv preprints are
 * registered with DataCite under the 10.48550 prefix; OpenAlex dropped its
 * `arxiv:` lookup path, so the DOI is the reliable route to both kinds of ID.
 */
function toLookupDoi(parsed: ParsedIdentifier): string {
  if (parsed.source === "doi") return parsed.id;
  return `10.48550/arxiv.${parsed.id.replace(/v\d+$/i, "")}`;
}

/**
 * OpenAlex ranks a single "best" open-access location, and that ranking is not
 * trustworthy: for arXiv papers it can select a scraper mirror that no longer
 * serves the file. Return every candidate so the importer can try them in
 * order. The canonical arXiv URL goes first because the identifier names it.
 */
function pdfCandidates(work: OpenAlexWork, parsed: ParsedIdentifier): string[] {
  const candidates: string[] = [];
  if (parsed.source === "arxiv") {
    candidates.push(`https://arxiv.org/pdf/${parsed.id.replace(/v\d+$/i, "")}`);
  }
  if (work.best_oa_location?.pdf_url) candidates.push(work.best_oa_location.pdf_url);
  if (work.open_access?.oa_url) candidates.push(work.open_access.oa_url);
  for (const location of work.locations ?? []) {
    if (location.pdf_url) candidates.push(location.pdf_url);
  }
  return Array.from(new Set(candidates));
}

export async function fetchMetadata(parsed: ParsedIdentifier): Promise<PaperMetadata> {
  const url = `${OPENALEX}/doi:${encodeURIComponent(toLookupDoi(parsed))}?mailto=${MAILTO}`;

  const work = (await requestOpenAlex(url)) as OpenAlexWork;
  const candidates = pdfCandidates(work, parsed);

  return {
    source: parsed.source,
    externalId: parsed.id,
    title: work.title ?? work.display_name ?? "Untitled",
    abstract: reconstructAbstract(work.abstract_inverted_index),
    authors: (work.authorships ?? [])
      .map((a) => a.author?.display_name)
      .filter((n): n is string => Boolean(n)),
    year: work.publication_year ?? null,
    venue: work.primary_location?.source?.display_name ?? null,
    doi: work.doi ? work.doi.replace(/^https?:\/\/doi\.org\//i, "") : null,
    pdfCandidates: candidates,
    license: work.best_oa_location?.license ?? null,
  };
}

export type PaperSort = "relevance" | "cited" | "recent";

const SORT_PARAMS: Record<PaperSort, string> = {
  relevance: "relevance_score:desc",
  cited: "cited_by_count:desc",
  recent: "publication_date:desc",
};

export function isPaperSort(value: string | null | undefined): value is PaperSort {
  return value === "relevance" || value === "cited" || value === "recent";
}

export type PaperSearchResult = {
  source: "arxiv" | "doi";
  externalId: string;
  title: string;
  abstract: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  pdfUrl: string | null;
  license: string | null;
  citedByCount: number | null;
};

const MAX_SEARCH_RESULTS = 20;
const ARXIV_DOI_PREFIX = "10.48550/arxiv.";

function normalizeDoi(raw: string | null | undefined): string | null {
  const value = raw?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim().toLowerCase();
  return value ? value : null;
}

/**
 * OpenAlex does not always expose `ids.arxiv`, and for some arXiv papers the
 * canonical `doi` field points at a mirror instead. A location URL is the
 * remaining signal that the record is the arXiv preprint, and the arXiv ID is
 * the identifier that resolves to the canonical PDF, so prefer it when found.
 */
function arxivIdFromWork(work: OpenAlexWork): string | null {
  const fromIds = work.ids?.arxiv?.match(/([^/\s]+)$/)?.[1];
  if (fromIds) return fromIds.replace(/v\d+$/i, "");

  const doi = normalizeDoi(work.doi);
  if (doi?.startsWith(ARXIV_DOI_PREFIX)) return doi.slice(ARXIV_DOI_PREFIX.length);

  const urls = [
    work.primary_location?.landing_page_url,
    work.best_oa_location?.landing_page_url,
    work.best_oa_location?.pdf_url,
    ...(work.locations ?? []).flatMap((location) => [location.landing_page_url, location.pdf_url]),
  ];
  for (const url of urls) {
    const match = url?.match(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+)/i);
    if (match) return match[1].replace(/\.pdf$/i, "").replace(/v\d+$/i, "");
  }
  return null;
}

function firstPdfUrl(work: OpenAlexWork): string | null {
  if (work.best_oa_location?.pdf_url) return work.best_oa_location.pdf_url;
  for (const location of work.locations ?? []) {
    if (location.pdf_url) return location.pdf_url;
  }
  return null;
}

function toSearchResult(work: OpenAlexWork): PaperSearchResult | null {
  const doi = normalizeDoi(work.doi);
  const arxivId = arxivIdFromWork(work);
  // Import resolves a paper from its identifier, so a record carrying neither a
  // DOI nor an arXiv ID cannot be opened and is left out of the results.
  if (!arxivId && !doi) return null;

  return {
    source: arxivId ? "arxiv" : "doi",
    externalId: arxivId ?? (doi as string),
    title: work.title ?? work.display_name ?? "Untitled",
    abstract: reconstructAbstract(work.abstract_inverted_index),
    authors: (work.authorships ?? [])
      .map((a) => a.author?.display_name)
      .filter((n): n is string => Boolean(n)),
    year: work.publication_year ?? null,
    venue: work.primary_location?.source?.display_name ?? null,
    doi,
    pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}` : firstPdfUrl(work),
    license: work.best_oa_location?.license ?? null,
    citedByCount: work.cited_by_count ?? 0,
  };
}

export type PaperPublisher = { key: string; label: string; id: string };

/**
 * "Source" is a publisher filter, not a site integration. OpenAlex can restrict
 * a query to one publisher's works; CNKI has no public API at all, and the IEEE
 * Xplore metadata API needs a key plus a subscription. The ids below are
 * OpenAlex `host_organization` ids, each verified against the filter below.
 */
export const PAPER_PUBLISHERS: PaperPublisher[] = [
  { key: "ieee", label: "IEEE", id: "P4310320439" },
  { key: "acm", label: "ACM", id: "P4310319798" },
  { key: "elsevier", label: "Elsevier", id: "P4310320990" },
  { key: "springer", label: "Springer Nature", id: "P4310319965" },
  { key: "wiley", label: "Wiley", id: "P4310320595" },
];

export function findPublisher(key: string | null | undefined): PaperPublisher | null {
  if (!key) return null;
  return PAPER_PUBLISHERS.find((publisher) => publisher.key === key) ?? null;
}

export type PaperSearchOutcome = { results: PaperSearchResult[]; total: number | null };

async function worksByFilter(
  filter: string,
  perPage: number,
  sort: PaperSort,
): Promise<{ works: OpenAlexWork[]; count: number | null }> {
  const url =
    `${OPENALEX}?filter=${encodeURIComponent(filter)}&per-page=${perPage}` +
    `&sort=${encodeURIComponent(SORT_PARAMS[sort])}&mailto=${MAILTO}`;
  const body = (await requestOpenAlex(url)) as {
    results?: OpenAlexWork[] | null;
    meta?: { count?: number } | null;
  };
  return { works: body.results ?? [], count: body.meta?.count ?? null };
}

/**
 * Searches arXiv and DOI records by title or author. OpenAlex combines filters
 * with AND, so one free-text query runs as two requests — one against the
 * title, one against the raw author name — with the two lists interleaved.
 * An identifier query skips the relevance search and resolves a single record.
 */
export async function searchWorks(
  query: string,
  limit = 10,
  sort: PaperSort = "relevance",
  publisher: PaperPublisher | null = null,
): Promise<PaperSearchOutcome> {
  const trimmed = query.trim();
  if (!trimmed) return { results: [], total: 0 };

  const capped = Math.min(Math.max(limit, 1), MAX_SEARCH_RESULTS);
  const publisherFilter = publisher
    ? `,primary_location.source.host_organization:${publisher.id}`
    : "";

  // An identifier names one record exactly, so a publisher filter is not applied
  // to it: doing so would hide the paper the reader just pasted.
  const parsed = parseIdentifier(trimmed);
  if (parsed) {
    try {
      const metadata = await fetchMetadata(parsed);
      return {
        results: [
          {
            source: metadata.source,
            externalId: metadata.externalId,
            title: metadata.title,
            abstract: metadata.abstract,
            authors: metadata.authors,
            year: metadata.year,
            venue: metadata.venue,
            doi: metadata.doi,
            pdfUrl: metadata.pdfCandidates[0] ?? null,
            license: metadata.license,
            citedByCount: null,
          },
        ],
        total: 1,
      };
    } catch (error) {
      if (error instanceof OpenAlexError && error.kind === "not_found") {
        return { results: [], total: 0 };
      }
      throw error;
    }
  }

  // A single upstream hiccup must not fail the whole search: OpenAlex
  // intermittently times out on connect, and the two index queries are
  // independent, so one answering is enough to return results.
  const [titleOutcome, authorOutcome] = await Promise.allSettled([
    worksByFilter(`title.search:${trimmed}${publisherFilter}`, capped, sort),
    worksByFilter(`raw_author_name.search:${trimmed}${publisherFilter}`, capped, sort),
  ]);
  if (titleOutcome.status === "rejected" && authorOutcome.status === "rejected") {
    throw titleOutcome.reason;
  }

  const byTitle = titleOutcome.status === "fulfilled" ? titleOutcome.value.works : [];
  const byAuthor = authorOutcome.status === "fulfilled" ? authorOutcome.value.works : [];
  const total =
    titleOutcome.status === "fulfilled"
      ? titleOutcome.value.count
      : authorOutcome.status === "fulfilled"
        ? authorOutcome.value.count
        : null;

  // Interleaved rather than title-first: a title query can fill the whole cap on
  // its own, which would truncate every author match away and make an author
  // query return only works that merely mention the name in their title.
  const pool: PaperSearchResult[] = [];
  const seen = new Set<string>();
  const rounds = Math.max(byTitle.length, byAuthor.length);
  for (let index = 0; index < rounds; index++) {
    for (const work of [byTitle[index], byAuthor[index]]) {
      if (!work) continue;
      const result = toSearchResult(work);
      if (!result) continue;
      const key = `${result.source}:${result.externalId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(result);
    }
  }

  // Interleaving mixes two independently sorted lists, so an explicit sort has
  // to be applied to the merged pool; otherwise the result order would not be
  // the order the reader asked for.
  if (sort === "cited") {
    pool.sort((a, b) => (b.citedByCount ?? 0) - (a.citedByCount ?? 0));
  } else if (sort === "recent") {
    pool.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  }

  return { results: pool.slice(0, capped), total };
}
