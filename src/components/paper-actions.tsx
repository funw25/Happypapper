"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PaperActions({
  paperId,
  initialFavorited,
  initialTags,
  canEdit,
}: {
  paperId: string;
  initialFavorited: boolean;
  initialTags: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(initialFavorited);
  const [tags, setTags] = useState(initialTags);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggleFavorite() {
    const next = !favorited;
    const response = await fetch(`/api/papers/${paperId}/favorite`, {
      method: next ? "POST" : "DELETE",
    });
    if (response.status === 401) {
      setMessage("请先登录");
      return;
    }
    if (!response.ok) {
      setMessage("操作失败");
      return;
    }
    setFavorited(next);
    setMessage(null);
    router.refresh();
  }

  function addTag() {
    const value = draft.trim();
    if (!value) return;
    if (tags.includes(value)) {
      setDraft("");
      return;
    }
    if (tags.length >= 8) {
      setMessage("最多 8 个标签");
      return;
    }
    setTags([...tags, value]);
    setDraft("");
  }

  async function saveTags() {
    const response = await fetch(`/api/papers/${paperId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    if (response.status === 401) {
      setMessage("请先登录");
      return;
    }
    if (!response.ok) {
      setMessage("标签保存失败");
      return;
    }
    setEditing(false);
    setMessage(null);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="hp-btn" onClick={toggleFavorite}>
          {favorited ? "★ 已收藏" : "☆ 收藏"}
        </button>
        {canEdit ? (
          <button
            type="button"
            className="hp-btn"
            onClick={() => {
              setEditing((v) => !v);
              setTags(initialTags);
            }}
          >
            {editing ? "取消编辑标签" : "编辑标签"}
          </button>
        ) : null}
        {message ? <span className="text-sm text-[var(--paper-danger)]">{message}</span> : null}
      </div>

      {editing ? (
        <div className="hp-card space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--paper-line)] px-2 py-0.5 text-xs"
              >
                {tag}
                <button
                  type="button"
                  className="text-[var(--paper-muted)] hover:text-[var(--paper-danger)]"
                  onClick={() => setTags(tags.filter((t) => t !== tag))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="hp-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="输入标签后回车"
            />
            <button type="button" className="hp-btn" onClick={addTag}>
              添加
            </button>
            <button type="button" className="hp-btn hp-btn-primary" onClick={saveTags}>
              保存
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.length === 0 ? (
            <span className="text-sm text-[var(--paper-muted)]">暂无标签</span>
          ) : (
            tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-[var(--paper-line)] px-2 py-0.5 text-xs text-[var(--paper-muted)]"
              >
                {tag}
              </span>
            ))
          )}
        </div>
      )}
    </div>
  );
}
