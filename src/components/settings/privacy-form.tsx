"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type PrivacyValues = {
  anonymousDefault: boolean;
  profileCommentsVisible: boolean;
  danmakuVisible: boolean;
};

const ROWS: { key: keyof PrivacyValues; title: string; detail: string }[] = [
  {
    key: "anonymousDefault",
    title: "默认匿名发布评论",
    detail: "开启后，新评论以“匿名用户”署名，管理员处理举报时仍能看到真实作者。",
  },
  {
    key: "profileCommentsVisible",
    title: "在个人主页展示我的评论",
    detail: "关闭后其他读者在你的公开主页看不到评论列表，评论本身不会被删除。",
  },
  {
    key: "danmakuVisible",
    title: "新评论进入弹幕流",
    detail: "关闭后新评论只出现在阅读器侧栏，不会飘过阅读区域。",
  },
];

export function PrivacyForm({ initial }: { initial: PrivacyValues }) {
  const router = useRouter();
  const [values, setValues] = useState<PrivacyValues>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(null);

    const response = await fetch("/api/me/privacy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);

    if (!response.ok) {
      setError(payload.detail ?? "保存失败");
      return;
    }

    setValues(payload.privacy as PrivacyValues);
    setSaved("已保存");
    router.refresh();
  }

  return (
    <form className="hp-card hp-stack p-6" onSubmit={submit}>
      <h2 className="hp-section-title">匿名与可见性</h2>
      <p className="hp-hint">
        这些开关只影响之后发布的新评论。历史评论保留发布时的设置，需要单独处理时请联系管理员。
      </p>

      <div className="hp-stack gap-3">
        {ROWS.map((row) => (
          <label
            key={row.key}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--paper-line)] p-3"
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={values[row.key]}
              onChange={(event) =>
                setValues((current) => ({ ...current, [row.key]: event.target.checked }))
              }
            />
            <span>
              <span className="hp-label">{row.title}</span>
              <span className="hp-hint block">{row.detail}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="hp-btn hp-btn-primary" disabled={pending}>
          {pending ? "保存中…" : "保存隐私设置"}
        </button>
        {saved ? <span className="hp-success">{saved}</span> : null}
        {error ? <span className="hp-error">{error}</span> : null}
      </div>
    </form>
  );
}
