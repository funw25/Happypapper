import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError, PRIVATE_RESPONSE_HEADERS } from "@/lib/api";
import { storage } from "@/lib/storage";
import { paperAvailability } from "@/lib/papers/availability";
import { canInteract, getReadablePaper } from "@/lib/papers/access";
import { ImportError, attachRemotePdf } from "@/lib/papers/import";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    if (!await getReadablePaper(id, user?.id)) return jsonError("NOT_FOUND", 404);
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录后重试");
    if (!canInteract(user)) return jsonError("EMAIL_UNVERIFIED", 403, "验证邮箱后即可获取 PDF");

    const outcome = await attachRemotePdf(id, user.id);
    return NextResponse.json({
      paper: outcome.paper,
      pdfCached: outcome.pdfCached,
      pdfError: outcome.pdfError,
      availability: paperAvailability(outcome.paper),
    }, { headers: PRIVATE_RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof ImportError) return jsonError(error.code, error.status, error.message);
    return errorFromUnknown(error);
  }
}

function parseRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;

  if (!match[1]) {
    const suffix = Number(match[2]);
    return suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : null;
  }

  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}

async function readPdf(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    const paper = await getReadablePaper(id, user?.id);
    if (!paper?.pdfPath) return jsonError("NOT_FOUND", 404);

    const info = await storage.stat(paper.pdfPath);
    if (!info) return jsonError("NOT_FOUND", 404);

    const headers: Record<string, string> = {
      "content-type": "application/pdf",
      "accept-ranges": "bytes",
      ...PRIVATE_RESPONSE_HEADERS,
    };

    const rangeHeader = request.headers.get("range");
    const range = rangeHeader ? parseRange(rangeHeader, info.size) : undefined;
    if (range === null) {
      return new Response(null, { status: 416, headers: { ...headers, "content-range": "bytes */" + info.size } });
    }
    if (range) {
      headers["content-range"] = "bytes " + range.start + "-" + range.end + "/" + info.size;
      headers["content-length"] = String(range.end - range.start + 1);
    } else {
      headers["content-length"] = String(info.size);
    }
    const body = request.method === "HEAD" ? null : await storage.getStream(paper.pdfPath, range);
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    return errorFromUnknown(error);
  }
}

export const GET = readPdf;
export const HEAD = readPdf;
