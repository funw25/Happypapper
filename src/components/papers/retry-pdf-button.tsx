"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Retries the remote PDF fetch for a paper that only has metadata
 * (docs/03-requirements.md PAPER-006). The candidate list is rebuilt on the
 * server from the stored metadata, so this sends no URL of its own.
 */
export function RetryPdfButton({ paperId }: { paperId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/papers/${paperId}/pdf`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        pdfCached?: boolean;
        pdfError?: string | null;
        detail?: string;
      };

      if (response.status === 401) {
        setMessage("请先登录后重试");
        return;
      }
      if (!response.ok) {
        setMessage(body.detail ?? "重试失败");
        return;
      }
      if (body.pdfCached) {
        setMessage("已获取 PDF，可以开始阅读");
        router.refresh();
        return;
      }
      setMessage(body.detail ?? "仍然没有拿到 PDF，可以稍后再试或打开来源网站");
      router.refresh();
    } catch {
      setMessage("网络错误");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" className="hp-btn" onClick={run} disabled={busy}>
        {busy ? "重试中…" : "重试获取 PDF"}
      </button>
      {message ? <span className="hp-hint">{message}</span> : null}
    </span>
  );
}
