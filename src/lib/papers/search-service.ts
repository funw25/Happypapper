import { consume } from "@/lib/rate-limit";
import {
  OpenAlexError,
  searchWorks,
  type PaperPublisher,
  type PaperSearchOutcome,
  type PaperSearchResult,
  type PaperSort,
} from "./openalex";

/**
 * 远程检索的服务层：缓存、回退与限流（docs/03-requirements.md PAPER-001 至
 * PAPER-006）。
 *
 * 三件事按顺序发生：
 * 1. 命中新鲜缓存直接返回，不消耗限流额度，也不打上游。
 * 2. 未命中缓存时先过自己的限流窗口；超限时如果有旧缓存就回退展示旧结果。
 * 3. 上游失败（限流或不可用）时同样回退到旧结果，并把失败原因一并返回，由页面
 *    说明「这是缓存结果」而不是假装成功。
 */
const FRESH_MS = 10 * 60 * 1000;
const STALE_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 200;
const SEARCH_LIMIT = 30;
const SEARCH_WINDOW_MS = 60_000;

type CacheEntry = { outcome: PaperSearchOutcome; storedAt: number };

const cache = new Map<string, CacheEntry>();

export type RemoteSearchError = {
  code: "UPSTREAM_RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | "SEARCH_RATE_LIMITED";
  message: string;
  retryAfterSeconds: number | null;
};

export type RemoteSearchOutcome = {
  ok: boolean;
  results: PaperSearchResult[];
  total: number | null;
  cached: boolean;
  stale: boolean;
  cachedAt: number | null;
  error: RemoteSearchError | null;
};

export function searchCacheKey(input: {
  query: string;
  sort: PaperSort;
  publisher: PaperPublisher | null;
  limit: number;
}): string {
  return [
    input.query.trim().toLowerCase().replace(/\s+/g, " "),
    input.sort,
    input.publisher?.key ?? "all",
    input.limit,
  ].join("|");
}

function readCache(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > STALE_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function writeCache(key: string, outcome: PaperSearchOutcome) {
  if (cache.size >= MAX_ENTRIES) {
    // Oldest write goes first; Map preserves insertion order and a refreshed key
    // is re-inserted below, so this approximates least-recently-stored.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.delete(key);
  cache.set(key, { outcome, storedAt: Date.now() });
}

function fromCache(entry: CacheEntry, error: RemoteSearchError | null, stale: boolean): RemoteSearchOutcome {
  return {
    ok: error === null,
    results: entry.outcome.results,
    total: entry.outcome.total,
    cached: true,
    stale,
    cachedAt: entry.storedAt,
    error,
  };
}

function describeUpstream(error: OpenAlexError): RemoteSearchError {
  if (error.kind === "rate_limited") {
    return {
      code: "UPSTREAM_RATE_LIMITED",
      message:
        error.retryAfterSeconds !== null
          ? `上游检索服务已限流，约 ${Math.ceil(error.retryAfterSeconds / 60)} 分钟后恢复`
          : "上游检索服务已限流，请稍后再试",
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  return {
    code: "UPSTREAM_UNAVAILABLE",
    message: "上游检索服务暂时不可用，请稍后再试",
    retryAfterSeconds: null,
  };
}

export async function runRemoteSearch(input: {
  query: string;
  sort: PaperSort;
  publisher: PaperPublisher | null;
  limit?: number;
  /** 限流维度：登录用户用 id，匿名请求用来源地址。 */
  identity: string;
}): Promise<RemoteSearchOutcome> {
  const query = input.query.trim();
  if (!query) {
    return { ok: true, results: [], total: 0, cached: false, stale: false, cachedAt: null, error: null };
  }

  const limit = input.limit ?? 12;
  const key = searchCacheKey({ query, sort: input.sort, publisher: input.publisher, limit });

  const hit = readCache(key);
  if (hit && Date.now() - hit.storedAt <= FRESH_MS) {
    return fromCache(hit, null, false);
  }

  const decision = consume(`search:${input.identity}`, {
    limit: SEARCH_LIMIT,
    windowMs: SEARCH_WINDOW_MS,
  });
  if (!decision.allowed) {
    const error: RemoteSearchError = {
      code: "SEARCH_RATE_LIMITED",
      message: `搜索过于频繁，请 ${decision.retryAfterSeconds} 秒后再试`,
      retryAfterSeconds: decision.retryAfterSeconds,
    };
    return hit ? fromCache(hit, error, true) : { ok: false, results: [], total: null, cached: false, stale: false, cachedAt: null, error };
  }

  try {
    const outcome = await searchWorks(query, limit, input.sort, input.publisher);
    writeCache(key, outcome);
    return {
      ok: true,
      results: outcome.results,
      total: outcome.total,
      cached: false,
      stale: false,
      cachedAt: Date.now(),
      error: null,
    };
  } catch (error) {
    if (!(error instanceof OpenAlexError)) throw error;
    const described = describeUpstream(error);
    return hit
      ? fromCache(hit, described, true)
      : { ok: false, results: [], total: null, cached: false, stale: false, cachedAt: null, error: described };
  }
}
