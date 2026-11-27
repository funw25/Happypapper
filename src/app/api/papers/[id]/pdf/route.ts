import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError, PRIVATE_RESPONSE_HEADERS } from "@/lib/api";
import { readPaperPdf } from "@/lib/papers/pdf-response";
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

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return readPaperPdf(request, id);
}

export const HEAD = GET;
