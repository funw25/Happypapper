"use client";

import { useState } from "react";
import { ANONYMOUS_LABEL, KIND_LABELS, type CommentDTO } from "@/lib/comments/types";

const REPORT_REASONS = [
  { value: "spam", label: "垃圾信息" },
  { value: "abuse", label: "攻击性内容" },
  { value: "offtopic", label: "与论文无关" },
  { value: "copyright", label: "版权问题" },
  { value: "other", label: "其他" },
];

export function CommentCard({
  comment,
  paperId,
  currentUserId,
  isReply = false,
  onChanged,
  onJump,
}: {
  comment: CommentDTO;
  paperId: string;
  currentUserId: string | null;
  isReply?: boolean;
  onChanged: () => void;
  onJump?: (comment: CommentDTO) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("spam");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const isMine = Boolean(currentUserId && comment.userId === currentUserId);

  async function toggleLike() {
    setBusy(true);
    const response = await fetch(`/api/comments/${comment.id}/like`, {
      method: comment.likedByMe ? "DELETE" : "POST",
    });
    setBusy(false);
    if (response.status === 401) {
      setNotice("请先登录");
      return;
    }
    if (!response.ok) {
      setNotice("操作失败");
      return;
    }
    onChanged();
  }

  async function submitReply() {
    const content = replyText.trim();
    if (!content) return;
    setBusy(true);
    const response = await fetch(`/api/papers/${paperId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content,
        kind: comment.kind,
        parentId: comment.id,
        displayMode: comment.displayMode,
        anchor: {
          page: comment.page,
          yNorm: comment.yNorm,
          xNorm: comment.xNorm,
          quote: comment.quote,
          quotePrefix: comment.quotePrefix,
          quoteSuffix: comment.quoteSuffix,
          charStart: comment.charStart,
          charEnd: comment.charEnd,
          blockId: comment.blockId,
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setNotice(payload.detail ?? "回复失败");
      return;
    }
    setReplyText("");
    setReplying(false);
    setNotice(null);
    onChanged();
  }

  async function submitReport() {
    setBusy(true);
    const response = await fetch(`/api/comments/${comment.id}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reportReason }),
    });
    setBusy(false);
    setReporting(false);
    setNotice(response.ok ? "已提交举报" : "举报失败");
  }

  async function remove() {
    if (!window.confirm("删除这条评论？")) return;
    setBusy(true);
    const response = await fetch(`/api/comments/${comment.id}`, { method: "DELETE" });
    setBusy(false);
    if (!response.ok) {
      setNotice("删除失败");
      return;
    }
    onChanged();
  }

  return (
    <article
      id={`c${comment.id}`}
      className={`rounded-lg border border-[var(--paper-line)] bg-[var(--paper-surface)] p-3 ${isReply ? "ml-6" : ""}`}
    >
      <div className="flex items-center gap-2 text-xs text-[var(--paper-muted)]">
        <span className="font-medium text-[var(--paper-fg)]">
          {comment.isAnonymous ? ANONYMOUS_LABEL : (comment.authorName ?? "已注销")}
        </span>
        <span className="rounded-full border border-[var(--paper-line)] px-1.5">
          {KIND_LABELS[comment.kind] ?? comment.kind}
        </span>
        <span>第 {comment.page} 页</span>
        {comment.anchorDegraded ? <span title="未绑定文本，仅按页面位置定位">页面级</span> : null}
        <span className="ml-auto">
          {new Date(comment.createdAt).toLocaleString("zh-CN", { hour12: false })}
        </span>
      </div>

      {comment.quote ? (
        <button
          type="button"
          onClick={() => onJump?.(comment)}
          className="mt-2 block w-full border-l-2 border-[var(--paper-accent)] bg-[var(--paper-bg)] px-2 py-1 text-left text-xs text-[var(--paper-muted)] hover:underline"
          title="跳转到该位置"
        >
          “{comment.quote.length > 90 ? `${comment.quote.slice(0, 90)}…` : comment.quote}”
        </button>
      ) : null}

      <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">{comment.content}</p>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--paper-muted)]">
        <button type="button" disabled={busy} onClick={toggleLike} className="hover:text-[var(--paper-accent)]">
          {comment.likedByMe ? "♥" : "♡"} {comment.likeCount}
        </button>
        {!isReply ? (
          <button
            type="button"
            className="hover:text-[var(--paper-accent)]"
            onClick={() => setReplying((v) => !v)}
          >
            回复 {comment.replyCount > 0 ? comment.replyCount : ""}
          </button>
        ) : null}
        <button
          type="button"
          className="hover:text-[var(--paper-accent)]"
          onClick={() => onJump?.(comment)}
        >
          定位
        </button>
        {isMine ? (
          <button type="button" className="hover:text-[var(--paper-danger)]" onClick={remove}>
            删除
          </button>
        ) : (
          <button
            type="button"
            className="hover:text-[var(--paper-danger)]"
            onClick={() => setReporting((v) => !v)}
          >
            举报
          </button>
        )}
        {notice ? <span className="text-[var(--paper-accent)]">{notice}</span> : null}
      </div>

      {replying ? (
        <div className="mt-2 space-y-2">
          <textarea
            className="hp-input min-h-[64px]"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="回复这条评论"
          />
          <div className="flex gap-2">
            <button type="button" className="hp-btn hp-btn-primary" disabled={busy} onClick={submitReply}>
              发送回复
            </button>
            <button type="button" className="hp-btn" onClick={() => setReplying(false)}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      {reporting ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className="hp-input w-auto"
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
          >
            {REPORT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button type="button" className="hp-btn" disabled={busy} onClick={submitReport}>
            提交举报
          </button>
          <button type="button" className="hp-btn" onClick={() => setReporting(false)}>
            取消
          </button>
        </div>
      ) : null}
    </article>
  );
}
