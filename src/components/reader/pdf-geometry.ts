import type { PageViewport } from "pdfjs-dist";
import { clamp01 } from "@/lib/anchor";
import type { AnchorRect } from "@/lib/anchor-v2";

function bounds(points: number[][]) {
  const left = Math.min(...points.map(([x]) => x));
  const right = Math.max(...points.map(([x]) => x));
  const top = Math.min(...points.map(([, y]) => y));
  const bottom = Math.max(...points.map(([, y]) => y));
  return { left, right, top, bottom };
}

export type PdfGeometry = { screen: PageViewport; standard: PageViewport; page: number };

export function toAnchorRect(
  view: PdfGeometry, left: number, top: number, right: number, bottom: number,
): AnchorRect | null {
  const { screen, standard } = view;
  function convert(x: number, y: number) {
    const [pdfX, pdfY] = screen.convertToPdfPoint(x, y);
    return standard.convertToViewportPoint(pdfX, pdfY);
  }
  const rect = bounds([convert(left, top), convert(right, top), convert(left, bottom), convert(right, bottom)]);
  const x = clamp01(rect.left / standard.width);
  const y = clamp01(rect.top / standard.height);
  const width = clamp01(rect.right / standard.width) - x;
  const height = clamp01(rect.bottom / standard.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function toReaderRect(view: PdfGeometry, rect: AnchorRect) {
  const { screen, standard } = view;
  const x = rect.x * standard.width;
  const y = rect.y * standard.height;
  const right = (rect.x + rect.width) * standard.width;
  const bottom = (rect.y + rect.height) * standard.height;
  function convert(left: number, top: number) {
    const [pdfX, pdfY] = standard.convertToPdfPoint(left, top);
    return screen.convertToViewportPoint(pdfX, pdfY);
  }
  const area = bounds([convert(x, y), convert(right, y), convert(x, bottom), convert(right, bottom)]);
  return { left: area.left, top: area.top, width: area.right - area.left, height: area.bottom - area.top };
}
