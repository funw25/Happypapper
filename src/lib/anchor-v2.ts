export const TEXT_INDEX_VERSION = "pdfjs-normalizer-v2";
export type AnchorRect = { x: number; y: number; width: number; height: number };
export type PdfTextPart = { text: string; hasEOL?: boolean };

export type AnchorV2 =
  | { type: "paper"; version: 2 }
  | {
      type: "page" | "region" | "text";
      version: 2;
      paperVersionId: string;
      page: number;
      rects: AnchorRect[];
      quote?: string;
      prefix?: string;
      suffix?: string;
      charStart?: number;
      charEnd?: number;
      textIndexVersion?: string;
    };

export function joinPdfText(parts: readonly PdfTextPart[]) {
  return parts.map((part, index) => part.text + (
    index === parts.length - 1 ? "" : part.hasEOL ? "\n" : " "
  )).join("");
}

export function codePointCount(value: string) {
  return Array.from(value).length;
}

