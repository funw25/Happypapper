"use client";

import { useRef, useState } from "react";
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
  inOverlay = false,
  onChanged,
  onJump,
}: {
  comment: CommentDTO;
  paperId: string;
  currentUserId: string | null;
  isReply?: boolean;
  inOverlay?: boolean;
  onChanged: () => void;
  onJump?: (comment: CommentDTO) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("spam");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const isMine = comment.viewer.isMine;
  const replyRequest = useRef<{ content: string; key: string } | null>(null);

  async function share() {
    const url = new URL("/read/" + paperId, window.location.origin);
    if (comment.paperVersionId) url.searchParams.set("version", comment.paperVersionId);
    if (comment.anchor?.type !== "paper") url.searchParams.set("page", String(comment.page));
    url.searchParams.set("comment", String(comment.id));
    try {
      await navigator.clipboard.writeText(url.href);
      setNotice("已复制讨论链接");
    } catch {
      setNotice("无法复制链接，可以通过地址栏分享当前阅读页。");
    }
  }

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
      const error = await response.json().catch(() => ({}));
      setNotice(error.detail ?? "点赞失败，请重试");
      return;
    }
    onChanged();
  }

  async function submitReply() {
    const content = replyText.trim();
    if (!content || busy) return;
    if (replyRequest.current?.content !== content) replyRequest.current = { content, key: crypto.randomUUID() };
    setBusy(true);
    try {
      const response = await fetch("/api/papers/" + paperId + "/comments", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": replyRequest.current.key },
        body: JSON.stringify({
          content, kind: comment.kind, parentId: comment.id,
          anchor: comment.anchor ?? { page: comment.page, yNorm: comment.yNorm },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.detail ?? "回复失败");
        return;
      }
      replyRequest.current = null;
      setReplyText("");
      setReplying(false);
      setNotice(null);
      onChanged();
    } catch {
      setNotice("连接暂时中断，回复已保留，可以重试。");
    } finally {
      setBusy(false);
    }
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
      id={inOverlay ? undefined : `c${comment.id}`}
      className={`rounded-lg border border-[var(--paper-line)] bg-[var(--paper-surface)] p-3 ${isReply ? "ml-6" : ""}`}
    >
      <div className="flex items-center gap-2 text-xs text-[var(--paper-muted)]">
        <span className="font-medium text-[var(--paper-fg)]">
          {comment.isAnonymous ? ANONYMOUS_LABEL : (comment.authorName ?? "已注销")}
        </span>
        <span className="rounded-full border border-[var(--paper-line)] px-1.5">
          {KIND_LABELS[comment.kind] ?? comment.kind}
        </span>
        <span>{comment.anchor?.type === "paper" ? "全文" : "第 " + comment.page + " 页"}</span>
        {comment.anchor?.type === "region" ? <span>区域</span> : null}
        {comment.anchorDegraded && comment.anchor?.type !== "paper"
          ? <span title="已保留页码。打开该页后可查看旧版定位线索。">页码定位</span> : null}
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
        {comment.anchor?.type !== "paper" && !comment.quote ? (
          <button type="button" onClick={() => onJump?.(comment)} className="underline">定位原文</button>
        ) : null}
        <button type="button" onClick={() => void share()} className="underline">复制链接</button>
        <button type="button" disabled={busy || (isMine && !comment.likedByMe)} onClick={toggleLike}
          title={isMine && !comment.likedByMe ? "不能点赞自己的评论" : undefined} className="hover:text-[var(--paper-accent)]">
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
