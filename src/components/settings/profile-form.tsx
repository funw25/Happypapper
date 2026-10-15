"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import {
  AVATAR_PALETTE,
  DEFAULT_AVATAR_BG,
  DEFAULT_AVATAR_FG,
  isHexColor,
} from "@/lib/avatar";

export type ProfileFormValues = {
  name: string;
  avatarBg: string;
  avatarFg: string;
  bio: string | null;
};

/**
 * 资料编辑（docs/03-requirements.md 第 5.2 节）。头像由昵称前两个字符生成，这里只
 * 选底色与字色；预览用的是与页头、公开主页完全相同的组件，选什么就显示什么。
 */
export function ProfileForm({ initial }: { initial: ProfileFormValues }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [avatarBg, setAvatarBg] = useState(initial.avatarBg);
  const [avatarFg, setAvatarFg] = useState(initial.avatarFg);
  const [bio, setBio] = useState(initial.bio ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(null);

    if (!isHexColor(avatarBg) || !isHexColor(avatarFg)) {
      setError("颜色需要 #RRGGBB 形式，例如 #002FA7");
      return;
    }

    setPending(true);
    const response = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, bio, avatarBg, avatarFg }),
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
        <Avatar name={name} avatarBg={avatarBg} avatarFg={avatarFg} size="lg" />
        <div className="hp-hint">
          <p>头像取昵称的前两个字符，全站统一使用这一种形态。</p>
          <p className="mt-1">改昵称时头像会跟着变。</p>
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
          2 到 24 个字符，全站唯一。昵称同时用于个人主页地址 /u/昵称与头像字符，历史评论会跟随新昵称显示。
        </p>
      </div>

      <fieldset className="hp-field">
        <legend className="hp-label">头像配色</legend>
        <div className="flex flex-wrap items-center gap-2">
          {AVATAR_PALETTE.map((option) => (
            <button
              key={option.bg}
              type="button"
              title={option.label}
              aria-label={`底色 ${option.label}`}
              aria-pressed={avatarBg.toUpperCase() === option.bg}
              onClick={() => {
                setAvatarBg(option.bg);
                setAvatarFg(DEFAULT_AVATAR_FG);
              }}
              className={`h-8 w-8 rounded-full border ${
                avatarBg.toUpperCase() === option.bg
                  ? "border-[var(--paper-accent)] ring-2 ring-[var(--paper-accent-soft)]"
                  : "border-[var(--paper-line)]"
              }`}
              style={{ backgroundColor: option.bg }}
            />
          ))}
          <button
            type="button"
            className="hp-btn text-xs"
            onClick={() => {
              setAvatarBg(DEFAULT_AVATAR_BG);
              setAvatarFg(DEFAULT_AVATAR_FG);
            }}
          >
            恢复默认
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm whitespace-nowrap">
            底色
            <input
              type="color"
              value={isHexColor(avatarBg) ? avatarBg : DEFAULT_AVATAR_BG}
              onChange={(event) => setAvatarBg(event.target.value.toUpperCase())}
              className="h-8 w-12 cursor-pointer rounded border border-[var(--paper-line)] bg-transparent"
            />
            <input
              className="hp-input w-28"
              value={avatarBg}
              onChange={(event) => setAvatarBg(event.target.value.toUpperCase())}
              maxLength={7}
            />
          </label>
          <label className="flex items-center gap-2 text-sm whitespace-nowrap">
            字色
            <input
              type="color"
              value={isHexColor(avatarFg) ? avatarFg : DEFAULT_AVATAR_FG}
              onChange={(event) => setAvatarFg(event.target.value.toUpperCase())}
              className="h-8 w-12 cursor-pointer rounded border border-[var(--paper-line)] bg-transparent"
            />
            <input
              className="hp-input w-28"
              value={avatarFg}
              onChange={(event) => setAvatarFg(event.target.value.toUpperCase())}
              maxLength={7}
            />
          </label>
        </div>
        <p className="hp-hint">默认克莱因蓝底 #002FA7 + 白字；也可以直接填任意 #RRGGBB。</p>
      </fieldset>

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
