"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Clears the unread badge from the notifications tab. */
export function MarkAllReadButton({ unread }: { unread: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (unread === 0) return null;

  async function run() {
    setBusy(true);
    try {
      await fetch("/api/me/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="hp-btn" onClick={run} disabled={busy}>
      {busy ? "处理中…" : `全部标为已读（${unread}）`}
    </button>
  );
}
