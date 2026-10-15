"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ProfileFormValues = {
  name: string;
  avatarUrl: string | null;
  bio: string | null;
};

export function ProfileForm({ initial }: { initial: ProfileFormValues }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const avatarPreview = avatarUrl.trim().startsWith("http") ? avatarUrl.trim() : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(null);

    const response = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, avatarUrl: avatarUrl.trim() || null, bio }),
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);

    if (!response.ok) {
      setError(payload.detail ?? "保存失败");
      return;
    }

    setSaved("已保存");
    router.refresh();
  }

  return (
    <form className="hp-card hp-stack p-6" onSubmit={submit}>
      <h2 className="hp-section-title">个人资料</h2>

      <div className="flex items-center gap-4">
        {avatarPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarPreview}
            alt="头像预览"
            className="h-16 w-16 rounded-full border border-[var(--paper-line)] object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[var(--paper-line)] bg-[var(--paper-surface-muted)] text-lg text-[var(--paper-muted)]">
            {name.slice(0, 1) || "?"}
          </div>
        )}
        <div className="hp-field flex-1">
          <label className="hp-label" htmlFor="avatarUrl">
            头像地址
          </label>
          <input
            id="avatarUrl"
            className="hp-input"
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
            placeholder="https://example.com/avatar.png"
          />
          <p className="hp-hint">填写公开可访问的图片链接，留空则使用昵称首字。</p>
        </div>
      </div>

      <div className="hp-field">
        <label className="hp-label" htmlFor="name">
          昵称
        </label>
        <input
          id="name"
          className="hp-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={24}
          required
        />
        <p className="hp-hint">
          2 到 24 个字符，全站唯一。昵称同时用于个人主页地址 /u/昵称，历史评论会跟随新昵称显示。
        </p>
      </div>

      <div className="hp-field">
        <label className="hp-label" htmlFor="bio">
          个人简介
        </label>
        <textarea
          id="bio"
          className="hp-input"
          rows={4}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          maxLength={300}
          placeholder="研究方向、在读单位，或者想聊的话题。"
        />
        <p className="hp-hint">{bio.length} / 300</p>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="hp-btn hp-btn-primary" disabled={pending}>
          {pending ? "保存中…" : "保存资料"}
        </button>
        {saved ? <span className="hp-success">{saved}</span> : null}
        {error ? <span className="hp-error">{error}</span> : null}
      </div>
    </form>
  );
}
