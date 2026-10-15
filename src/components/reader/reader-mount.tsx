"use client";

import dynamic from "next/dynamic";

/**
 * The reader only exists in the browser: it drives pdf.js, canvas rendering and
 * DOM ranges. Loading it with ssr disabled keeps the browser build of
 * pdfjs-dist out of the server render, where its WASM bootstrap fails.
 */
const PdfReader = dynamic(() => import("./pdf-reader").then((mod) => mod.PdfReader), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-[var(--paper-muted)]">
      正在加载阅读器…
    </div>
  ),
});

export function ReaderMount(props: React.ComponentProps<typeof PdfReader>) {
  return <PdfReader {...props} />;
}
