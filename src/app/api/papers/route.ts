import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError, PRIVATE_RESPONSE_HEADERS } from "@/lib/api";
import { ImportError, importFromIdentifier, importFromUpload } from "@/lib/papers/import";
import { paperAvailability } from "@/lib/papers/availability";
import { canInteract } from "@/lib/papers/access";
import { listPapers } from "@/lib/papers/queries";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const tag = url.searchParams.get("tag")?.trim() || undefined;
  const rows = await listPapers({ q, tag, limit: 50 });
  return NextResponse.json({ papers: rows });
}

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");
    if (!canInteract(user)) return jsonError("EMAIL_UNVERIFIED", 403, "验证邮箱后即可导入论文");

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return jsonError("NO_FILE", 400, "请选择 PDF 文件");
      }
      const visibility = form.get("visibility") === "public" ? "public" : "private";
      if (visibility === "public" && form.get("rightsClaimed") !== "true") {
        return jsonError("RIGHTS_REQUIRED", 422, "请先确认你拥有此文件的公开分发权利");
      }
      const rawYear = form.get("year");
      const paper = await importFromUpload(file, user.id, {
        title: typeof form.get("title") === "string" ? String(form.get("title")) : undefined,
        authors: typeof form.get("authors") === "string" ? String(form.get("authors")) : undefined,
        year: rawYear ? Number(rawYear) || null : null,
        visibility,
      });
      return NextResponse.json({ paper, created: true }, { status: 201, headers: PRIVATE_RESPONSE_HEADERS });
    }

    const body = await request.json().catch(() => null);
    const identifier = typeof body?.identifier === "string" ? body.identifier : "";
    if (!identifier.trim()) {
      return jsonError("INVALID_INPUT", 400, "请填写 arXiv ID 或 DOI");
    }

    const result = await importFromIdentifier(identifier, user.id);
    return NextResponse.json(
      {
        paper: result.paper,
        created: result.created,
        pdfCached: result.pdfCached,
        pdfError: result.pdfError,
        availability: paperAvailability(result.paper),
      },
      { status: result.created ? 201 : 200, headers: PRIVATE_RESPONSE_HEADERS },
    );
  } catch (error) {
    if (error instanceof ImportError) {
      return jsonError(error.code, error.status, error.message);
    }
    return errorFromUnknown(error);
  }
}
