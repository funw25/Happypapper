import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError, PRIVATE_RESPONSE_HEADERS } from "@/lib/api";
import { storage } from "@/lib/storage";
import { getReadablePaper } from "@/lib/papers/access";
import { getPaperVersion } from "@/lib/papers/versions";

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

export async function readPaperPdf(request: Request, id: string, requestedVersion?: string) {
  try {
    const user = await currentUser();
    const paper = await getReadablePaper(id, user?.id);
    if (!paper) return jsonError("NOT_FOUND", 404);
    const version = await getPaperVersion(paper, requestedVersion);
    if (requestedVersion && (!version || version.processingState === "unavailable")) {
      return jsonError("NOT_FOUND", 404);
    }
    const pdfKey = version && version.processingState !== "unavailable" ? version.pdfKey : paper.pdfPath;
    if (!pdfKey) return jsonError("NOT_FOUND", 404);

    const info = await storage.stat(pdfKey);
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
    const body = request.method === "HEAD" ? null : await storage.getStream(pdfKey, range);
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
