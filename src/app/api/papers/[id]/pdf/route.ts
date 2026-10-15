import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { storage } from "@/lib/storage";
import { paperAvailability } from "@/lib/papers/availability";
import { ImportError, attachRemotePdf } from "@/lib/papers/import";
import { getPaper } from "@/lib/papers/queries";

/**
 * Retries the remote PDF fetch for a paper that has metadata but no cached copy
 * (docs/03-requirements.md PAPER-006). Any signed-in reader may trigger it for a
 * public paper; a private paper is limited to its uploader and admins.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录后重试");

    const paper = await getPaper(id);
    if (!paper) return jsonError("NOT_FOUND", 404, "论文不存在");
    if (paper.visibility === "private" && paper.uploadedBy !== user.id && user.role !== "admin") {
      return jsonError("FORBIDDEN", 403, "没有权限");
    }

    const outcome = await attachRemotePdf(id);
    return NextResponse.json({
      paper: outcome.paper,
      pdfCached: outcome.pdfCached,
      pdfError: outcome.pdfError,
      availability: paperAvailability(outcome.paper),
    });
  } catch (error) {
    if (error instanceof ImportError) {
      return jsonError(error.code, error.status, error.message);
    }
    return errorFromUnknown(error);
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const paper = await getPaper(id);
  if (!paper?.pdfPath) {
    return new Response("PDF not available", { status: 404 });
  }

  if (paper.visibility === "private") {
    const user = await currentUser();
    if (!user || (paper.uploadedBy !== user.id && user.role !== "admin")) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  const info = await storage.stat(paper.pdfPath);
  if (!info) {
    return new Response("PDF file missing", { status: 404 });
  }

  const rangeHeader = request.headers.get("range");
  const baseHeaders: Record<string, string> = {
    "content-type": "application/pdf",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  };

  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
      if (Number.isNaN(start) || start > end || start >= info.size) {
        return new Response("Range not satisfiable", {
          status: 416,
          headers: { "content-range": `bytes */${info.size}` },
        });
      }
      const stream = await storage.getStream(paper.pdfPath, { start, end });
      return new Response(stream, {
        status: 206,
        headers: {
          ...baseHeaders,
          "content-range": `bytes ${start}-${end}/${info.size}`,
          "content-length": String(end - start + 1),
        },
      });
    }
  }

  const stream = await storage.getStream(paper.pdfPath);
  return new Response(stream, {
    status: 200,
    headers: { ...baseHeaders, "content-length": String(info.size) },
  });
}
