"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(input: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    const response = await fetch(input, init);
    setBusy(false);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.detail ?? `失败（${response.status}）`);
      return false;
    }
    router.refresh();
    return true;
  }

  return { busy, error, run };
}

function Button({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`hp-btn px-2 py-0.5 text-xs ${danger ? "hover:border-[var(--paper-danger)] hover:text-[var(--paper-danger)]" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function ReportActions({ reportId, commentId }: { reportId: number; commentId: number }) {
  const { busy, error, run } = useAction();

  const setReport = (status: "resolved" | "rejected" | "open") =>
    run(`/api/admin/reports?id=${reportId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });

  const setComment = (status: "visible" | "hidden") =>
    run(`/api/admin/comments/${commentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={busy} danger onClick={() => void setComment("hidden")}>
        隐藏评论
      </Button>
      <Button disabled={busy} onClick={() => void setComment("visible")}>
        恢复评论
      </Button>
      <Button disabled={busy} onClick={() => void setReport("resolved")}>
        标记已处理
      </Button>
      <Button disabled={busy} onClick={() => void setReport("rejected")}>
        驳回举报
      </Button>
      <Button disabled={busy} onClick={() => void setReport("open")}>
        重开
      </Button>
      {error ? <span className="text-xs text-[var(--paper-danger)]">{error}</span> : null}
    </div>
  );
}

export function CommentStatusActions({
  commentId,
  status,
}: {
  commentId: number;
  status: string;
}) {
  const { busy, error, run } = useAction();

  const setStatus = (next: "visible" | "hidden") =>
    run(`/api/admin/comments/${commentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });

  return (
    <div className="flex items-center gap-2">
      <Button disabled={busy || status === "hidden"} danger onClick={() => void setStatus("hidden")}>
        隐藏
      </Button>
      <Button disabled={busy || status === "visible"} onClick={() => void setStatus("visible")}>
        恢复
      </Button>
      {error ? <span className="text-xs text-[var(--paper-danger)]">{error}</span> : null}
    </div>
  );
}

export function MuteActions({ userId, mutedUntil }: { userId: string; mutedUntil: string | null }) {
  const { busy, error, run } = useAction();

  const mute = (minutes: number | null) =>
    run(`/api/admin/users/${userId}/mute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ minutes }),
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={busy} danger onClick={() => void mute(60)}>
        禁言 1 小时
      </Button>
      <Button disabled={busy} danger onClick={() => void mute(60 * 24)}>
        禁言 24 小时
      </Button>
      <Button disabled={busy || !mutedUntil} onClick={() => void mute(null)}>
        解除禁言
      </Button>
      {error ? <span className="text-xs text-[var(--paper-danger)]">{error}</span> : null}
    </div>
  );
}

export function PaperVisibilityActions({
  paperId,
  visibility,
  hasFile,
}: {
  paperId: string;
  visibility: string;
  hasFile: boolean;
}) {
  const { busy, error, run } = useAction();

  const set = (body: Record<string, unknown>) =>
    run(`/api/admin/papers/${paperId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={busy || visibility === "private"}
        onClick={() => void set({ visibility: "private" })}
      >
        转为私有
      </Button>
      <Button
        disabled={busy || visibility === "public"}
        onClick={() => void set({ visibility: "public" })}
      >
        转为公开
      </Button>
      <Button
        disabled={busy || !hasFile}
        danger
        onClick={() => {
          if (!window.confirm("删除本站缓存的 PDF 并转为私有？此操作不可撤销。")) return;
          void set({ visibility: "private", removeFile: true });
        }}
      >
        下架并删除文件
      </Button>
      {error ? <span className="text-xs text-[var(--paper-danger)]">{error}</span> : null}
    </div>
  );
}
