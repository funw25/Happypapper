"use client";

import { useState } from "react";

/**
 * Like notifications default to on; this is the opt-out. It lives on the
 * notifications tab so the switch sits next to what it controls.
 */
export function LikeNotificationToggle({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/me/notifications/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ likeNotifications: next }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        likeNotifications?: boolean;
        detail?: string;
      };
      if (!response.ok) {
        setMessage(body.detail ?? "保存失败");
        return;
      }
      setEnabled(Boolean(body.likeNotifications));
    } catch {
      setMessage("网络错误");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="hp-btn" onClick={toggle} disabled={busy} data-like-notifications={enabled}>
        {enabled ? "点赞通知：开" : "点赞通知：关"}
      </button>
      {message ? <span className="text-xs text-[var(--paper-danger)]">{message}</span> : null}
    </span>
  );
}
