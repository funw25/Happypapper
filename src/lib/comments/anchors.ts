import { z } from "zod";
import type { Paper } from "@/db/schema";
import { clamp01, normalizeForMatch } from "@/lib/anchor";
import { codePointCount, TEXT_INDEX_VERSION, type AnchorV2 } from "@/lib/anchor-v2";
import { getPaperVersion, getVersionPage } from "@/lib/papers/versions";
import { CommentError } from "./queries";

const rect = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1),
}).refine((r) => r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001);

const base = z.object({ version: z.literal(2) });
const position = base.extend({
  paperVersionId: z.uuid(), page: z.number().int().positive().max(10_000), rects: z.array(rect).max(120),
});

export const anchorV2Schema = z.discriminatedUnion("type", [
  base.extend({ type: z.literal("paper") }),
  position.extend({ type: z.literal("page") }),
  position.extend({ type: z.literal("region"), rects: z.array(rect).min(1).max(120) }),
  position.extend({
    type: z.literal("text"),
    quote: z.string().trim().min(1).refine((value) => codePointCount(value) <= 2_000),
    prefix: z.string().max(256).optional(),
    suffix: z.string().max(256).optional(),
    charStart: z.number().int().nonnegative().optional(),
    charEnd: z.number().int().positive().optional(),
    textIndexVersion: z.literal(TEXT_INDEX_VERSION).optional(),
  }),
]);

export const legacyAnchorSchema = z.object({
  page: z.number().int().positive().max(10_000),
  yNorm: z.number().min(0).max(1),
  xNorm: z.number().min(0).max(1).nullable().optional(),
  quote: z.string().max(2000).nullable().optional(),
  quotePrefix: z.string().max(200).nullable().optional(),
  quoteSuffix: z.string().max(200).nullable().optional(),
  charStart: z.number().int().min(0).nullable().optional(),
  charEnd: z.number().int().min(0).nullable().optional(),
  blockId: z.string().max(120).nullable().optional(),
});

function invalidAnchor(message = "原文位置不可用，请重新选择") {
  return new CommentError("INVALID_ANCHOR", 400, message);
}

export async function resolveAnchor(
  paper: Paper, input: z.infer<typeof anchorV2Schema> | z.infer<typeof legacyAnchorSchema>,
) {
  const format = "type" in input ? input : null;
  const legacy = "yNorm" in input ? input : null;
  if (format?.type === "paper") {
    return {
      page: 1, yNorm: 0, paperVersionId: null, anchorV2: format,
      anchorVersion: 2, anchorDegraded: false,
    };
  }

  const page = format?.page ?? legacy?.page ?? 1;
  const version = await getPaperVersion(paper, format?.paperVersionId);
  if (format && (!version || version.processingState === "unavailable")) throw invalidAnchor("该 PDF 版本不可用");
  if (version?.pageCount && page > version.pageCount) throw invalidAnchor("页码超出 PDF 范围");

  if (format?.type === "text" && version?.processingState === "ready") {
    const pageRow = await getVersionPage(version.id, page);
    const needle = normalizeForMatch(format.quote);
    const text = pageRow?.normalizedText ?? "";
    if (!needle || !text.includes(needle)) throw invalidAnchor("找不到选中的原文，请重新选择");
    if (format.charStart !== undefined || format.charEnd !== undefined) {
      if (format.charStart === undefined || format.charEnd === undefined ||
          format.charStart >= format.charEnd || format.textIndexVersion !== TEXT_INDEX_VERSION ||
          Array.from(text).slice(format.charStart, format.charEnd).join("") !== needle) {
        throw invalidAnchor("选区已变化，请重新选择原文");
      }
    }
  }

  const anchorV2: AnchorV2 | null = format ?? (version && legacy ? {
    type: legacy.quote ? "text" : "page", version: 2, paperVersionId: version.id, page, rects: [],
    quote: legacy.quote ?? undefined, prefix: legacy.quotePrefix ?? undefined, suffix: legacy.quoteSuffix ?? undefined,
  } : null);
  const first = format?.rects[0];
  return {
    page, yNorm: clamp01(first?.y ?? legacy?.yNorm ?? 0), xNorm: first?.x ?? legacy?.xNorm ?? null,
    quote: (format?.type === "text" ? format.quote : legacy?.quote) ?? null,
    quotePrefix: (format?.type === "text" ? format.prefix : legacy?.quotePrefix) ?? null,
    quoteSuffix: (format?.type === "text" ? format.suffix : legacy?.quoteSuffix) ?? null,
    charStart: (format?.type === "text" ? format.charStart : legacy?.charStart) ?? null,
    charEnd: (format?.type === "text" ? format.charEnd : legacy?.charEnd) ?? null,
    blockId: legacy?.blockId ?? null,
    paperVersionId: version?.id ?? null, anchorV2, anchorVersion: format ? 2 : 1,
    anchorDegraded: !format || (format.type === "text" && version?.processingState !== "ready"),
  };
}
