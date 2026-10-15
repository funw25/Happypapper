/**
 * Position anchoring shared by the reader (client) and the API (server).
 *
 * Anchors are layered, most reliable first:
 *   L1  page + yNorm                     survives font, zoom and layout changes
 *   L2  quote + prefix/suffix            pins the exact sentence
 *   L3  blockId                          reserved for a later paragraph pass
 */

export type Anchor = {
  page: number;
  yNorm: number;
  xNorm?: number | null;
  quote?: string | null;
  quotePrefix?: string | null;
  quoteSuffix?: string | null;
  charStart?: number | null;
  charEnd?: number | null;
  blockId?: string | null;
  anchorVersion?: number;
};

export const ANCHOR_VERSION = 1;
export const CONTEXT_LENGTH = 32;

/** Collapse everything that differs between two renderings of the same text. */
export function normalizeForMatch(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\u00ad/g, "")
    .replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, "$1$2")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type PageIndex = {
  normalized: string;
  segments: { start: number; end: number; part: number }[];
};

/**
 * Build a searchable index over the page's text items, keeping a map from
 * normalized offsets back to the original text item so a hit can be turned
 * back into a DOM element.
 */
export function buildPageIndex(parts: { text: string }[]): PageIndex {
  let normalized = "";
  const segments: PageIndex["segments"] = [];

  parts.forEach((part, i) => {
    const piece = normalizeForMatch(part.text);
    if (!piece) return;
    if (normalized.length > 0) normalized += " ";
    const start = normalized.length;
    normalized += piece;
    segments.push({ start, end: normalized.length, part: i });
  });

  return { normalized, segments };
}

export function partAtOffset(index: PageIndex, offset: number): number | null {
  for (const segment of index.segments) {
    if (offset >= segment.start && offset < segment.end) return segment.part;
  }
  return null;
}

export type QuoteHit = { partIndex: number; offset: number; length: number };

/**
 * Stored prefixes and suffixes come from normalizeForMatch, which trims their
 * outer edge, while the page index keeps a separator space between text items.
 * Compare with one character of slack and anchor at the matching edge.
 */
function contextBefore(haystack: string, at: number, context: string): boolean {
  if (!context) return false;
  const from = Math.max(0, at - context.length - 1);
  return haystack.slice(from, at).trimEnd().endsWith(context);
}

function contextAfter(haystack: string, at: number, context: string): boolean {
  if (!context) return false;
  const to = Math.min(haystack.length, at + context.length + 1);
  return haystack.slice(at, to).trimStart().startsWith(context);
}

/** Locate a stored quote inside the current rendering of the page. */
export function findQuote(
  index: PageIndex,
  quote: string | null | undefined,
  prefix?: string | null,
  suffix?: string | null,
): QuoteHit | null {
  const needle = normalizeForMatch(quote ?? "");
  if (!needle) return null;

  const hits: number[] = [];
  let from = 0;
  for (;;) {
    const at = index.normalized.indexOf(needle, from);
    if (at === -1) break;
    hits.push(at);
    from = at + 1;
    if (hits.length >= 32) break;
  }
  if (hits.length === 0) return null;

  let chosen = hits[0];
  if (hits.length > 1 && (prefix || suffix)) {
    const before = normalizeForMatch(prefix ?? "");
    const after = normalizeForMatch(suffix ?? "");
    let best = -1;
    for (const at of hits) {
      let score = 0;
      if (before && contextBefore(index.normalized, at, before)) score += 2;
      const end = at + needle.length;
      if (after && contextAfter(index.normalized, end, after)) score += 2;
      if (score > best) {
        best = score;
        chosen = at;
        if (score === 4) break;
      }
    }
  }

  const partIndex = partAtOffset(index, chosen);
  if (partIndex === null) return null;
  return { partIndex, offset: chosen, length: needle.length };
}

/** Store a little surrounding text so ambiguous quotes can be disambiguated later. */
export function buildQuoteContext(flatText: string, start: number, end: number) {
  return {
    quote: flatText.slice(start, end),
    quotePrefix: flatText.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    quoteSuffix: flatText.slice(end, end + CONTEXT_LENGTH),
  };
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
