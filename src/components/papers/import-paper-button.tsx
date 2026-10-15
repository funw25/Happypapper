"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Imports a remote search result through the identifier import path
 * (docs/03-requirements.md PAPER-003、PAPER-006). A result without an open PDF
 * is still saved: the row keeps the metadata and the failure reason, and the
 * detail page offers a retry. The button label says which of the two will happen.
 */
export function ImportPaperButton({
  identifier,
  hasPdf,
}: {
  identifier: string;
  hasPdf: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/papers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        paper?: { id?: string };
        pdfCached?: boolean;
        detail?: string;
      };

      if (response.status === 401) {
        setMessage("请先登录");
        return;
      }
      if (!response.ok || !body.paper?.id) {
        setMessage(body.detail ?? "导入失败");
        return;
      }
      router.push(`/papers/${body.paper.id}`);
    } catch {
      setMessage("网络错误");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="hp-btn hp-btn-primary" onClick={run} disabled={busy}>
        {busy ? "保存中…" : hasPdf ? "导入并进入详情" : "保存论文记录"}
      </button>
      {message ? <span className="hp-error">{message}</span> : null}
    </span>
  );
}
