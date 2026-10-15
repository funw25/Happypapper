import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { ImportError, importFromIdentifier, importFromUpload } from "@/lib/papers/import";
import { paperAvailability } from "@/lib/papers/availability";
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

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return jsonError("NO_FILE", 400, "请选择 PDF 文件");
      }
      const rawYear = form.get("year");
      const paper = await importFromUpload(file, user.id, {
        title: typeof form.get("title") === "string" ? String(form.get("title")) : undefined,
        authors: typeof form.get("authors") === "string" ? String(form.get("authors")) : undefined,
        year: rawYear ? Number(rawYear) || null : null,
        visibility: form.get("visibility") === "public" ? "public" : "private",
      });
      return NextResponse.json({ paper, created: true }, { status: 201 });
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
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof ImportError) {
      return jsonError(error.code, error.status, error.message);
    }
    return errorFromUnknown(error);
  }
}
