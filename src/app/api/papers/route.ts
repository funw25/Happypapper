import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError, PRIVATE_RESPONSE_HEADERS } from "@/lib/api";
import { ImportError, importFromIdentifier, importFromUpload } from "@/lib/papers/import";
import { paperAvailability } from "@/lib/papers/availability";
import { MAX_PDF_BYTES } from "@/lib/pdf/limits";
import { canInteract } from "@/lib/papers/access";
import { listPapers } from "@/lib/papers/queries";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || undefined;
  const tag = url.searchParams.get("tag")?.trim() || undefined;
  const rows = await listPapers({ q, tag, limit: 50 });
  return NextResponse.json({ papers: rows });
}

async function readUpload(request: Request) {
  const limit = MAX_PDF_BYTES + 128 * 1024;
  if (Number(request.headers.get("content-length")) > limit) {
    throw new ImportError("PDF 超过 60 MiB 上限", "PDF_TOO_LARGE", 413);
  }
  let bytes = 0;
  const stream = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > limit) throw new ImportError("PDF 超过 60 MiB 上限", "PDF_TOO_LARGE", 413);
      controller.enqueue(chunk);
    },
  }));
  try {
    return await new Response(stream, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch (error) {
    if (bytes > limit || error instanceof ImportError) {
      throw new ImportError("PDF 超过 60 MiB 上限", "PDF_TOO_LARGE", 413);
    }
    throw new ImportError("无法读取上传文件，请重新选择 PDF", "INVALID_UPLOAD");
  }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");
    if (!canInteract(user)) return jsonError("EMAIL_UNVERIFIED", 403, "验证邮箱后即可导入论文");

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await readUpload(request);
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return jsonError("NO_FILE", 400, "请选择 PDF 文件");
      }
      const visibility = form.get("visibility") === "public" ? "public" : "private";
      const rawYear = form.get("year");
      const paper = await importFromUpload(file, user.id, {
        title: typeof form.get("title") === "string" ? String(form.get("title")) : undefined,
        authors: typeof form.get("authors") === "string" ? String(form.get("authors")) : undefined,
        year: rawYear ? Number(rawYear) || null : null,
        visibility,
        rightsClaimed: form.get("rightsClaimed") === "true",
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
