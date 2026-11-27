import { createHash } from "node:crypto";
import { z } from "zod";
import { clientIdentity, errorFromUnknown, jsonError, PRIVATE_RESPONSE_HEADERS } from "@/lib/api";
import { listDanmaku } from "@/lib/comments/danmaku";
import { COMMENT_KINDS } from "@/lib/comments/queries";
import { getReadablePaper } from "@/lib/papers/access";
import { getPaperVersion } from "@/lib/papers/versions";
import { currentUser } from "@/lib/session";

const querySchema = z.object({
  version: z.uuid().optional(),
  scope: z.enum(["document", "page"]).default("document"),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  sort: z.enum(["latest", "hot"]).default("latest"),
  kind: z.enum(["all", ...COMMENT_KINDS]).default("all"),
  limit: z.coerce.number().int().min(1).max(60).default(40),
  cursor: z.string().min(1).max(768).optional(),
});

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewerId = (await currentUser())?.id ?? null;
    const paper = await getReadablePaper(id, viewerId);
    if (!paper) return jsonError("NOT_FOUND", 404);
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "弹幕列表参数无效");
    const { version, scope, page, sort, kind, limit, cursor } = parsed.data;
    const selected = await getPaperVersion(paper, version);
    if ((version && !selected) || selected?.processingState === "unavailable") return jsonError("NOT_FOUND", 404);
    if (scope === "page" && (!page || (selected?.pageCount && page > selected.pageCount))) {
      return jsonError("INVALID_PAGE", 400, "页码超出 PDF 范围");
    }
    const session = createHash("sha256").update(JSON.stringify([
      clientIdentity(request, viewerId), request.headers.get("cookie"), paper.visibility, paper.uploadedBy,
    ])).digest("hex");
    const data = await listDanmaku({ paperId: paper.id, viewerId, versionId: selected?.id ?? null,
      page: scope === "page" ? page ?? null : null, kind }, sort, session, limit, cursor);
    if (!data) return jsonError("CURSOR_EXPIRED", 410, "弹幕列表已过期，请重新加载");
    return Response.json(data, { headers: PRIVATE_RESPONSE_HEADERS });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
