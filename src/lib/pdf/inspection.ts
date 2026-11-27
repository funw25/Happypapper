import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { MAX_PDF_BYTES } from "./limits";
import { normalizeForMatch } from "@/lib/anchor";
import { TEXT_INDEX_VERSION, type PdfTextPart, joinPdfText } from "@/lib/anchor-v2";

export class PdfFormatError extends Error {
  constructor(readonly code: string, message: string, readonly status = 422) {
    super(message);
  }
}

type PageInfo = {
  page: number;
  width: number;
  height: number;
  rotation: number;
  textStatus: "text" | "image";
  normalizedText: string;
};

export async function inspectPdf(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_PDF_BYTES) throw new PdfFormatError("PDF_TOO_LARGE", "PDF 超过 60 MiB 上限", 413);
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new PdfFormatError("PDF_INVALID", "文件内容不是有效 PDF");
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    standardFontDataUrl: resolve("node_modules/pdfjs-dist/standard_fonts").split(sep).join("/") + "/",
  });
  try {
    const pdf = await task.promise;
    const configured = Number(process.env.MAX_PDF_PAGES ?? 300);
    const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : 300;
    if (!pdf.numPages || pdf.numPages > limit) {
      throw new PdfFormatError("PDF_PAGE_LIMIT", "PDF 页数超出上限（" + limit + " 页）");
    }

    const info: PageInfo[] = [];
    let textSize = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const dimensions = page.getViewport({ scale: 1, rotation: 0 });
      if (![dimensions.width, dimensions.height].every((value) => Number.isFinite(value) && value > 0)) {
        throw new PdfFormatError("PDF_INVALID", "PDF 包含无法读取尺寸的页面");
      }
      const parts: PdfTextPart[] = [];
      for (const item of (await page.getTextContent()).items) {
        if ("str" in item) parts.push({ text: item.str, hasEOL: item.hasEOL });
      }
      const normalizedText = normalizeForMatch(joinPdfText(parts));
      textSize += normalizedText.length;
      if (textSize > 4_000_000) throw new PdfFormatError("PDF_TEXT_LIMIT", "PDF 文本层过大，无法建立定位索引");
      info.push({
        page: number,
        width: dimensions.width,
        height: dimensions.height,
        rotation: page.rotate,
        textStatus: normalizedText ? "text" : "image",
        normalizedText,
      });
      page.cleanup();
    }
    return { sha256, pages: info, parserVersion: pdfjs.version + "/" + TEXT_INDEX_VERSION };
  } catch (error) {
    if (error instanceof PdfFormatError) throw error;
    if (error instanceof pdfjs.PasswordException) throw new PdfFormatError("PDF_ENCRYPTED", "请上传无需密码即可打开的 PDF");
    throw new PdfFormatError("PDF_INVALID", "PDF 已损坏或无法解析");
  } finally {
    await task.destroy().catch(() => {});
  }
}
