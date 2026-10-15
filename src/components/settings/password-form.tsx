"use client";

import { useState } from "react";

/**
 * Password change form. For an account created through GitHub there is no local
 * password yet, so the current-password field is hidden and the first save sets
 * one (AUTH-007).
 */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(null);

    if (newPassword.length < 8) {
      setError("新密码至少 8 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    setPending(true);
    const response = await fetch("/api/me/password", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);

    if (!response.ok) {
      setError(payload.detail ?? "修改失败");
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSaved(hasPassword ? "密码已更新" : "已设置密码，可以用邮箱密码登录");
  }

  return (
    <form className="hp-card hp-stack p-6" onSubmit={submit}>
      <h2 className="hp-section-title">{hasPassword ? "修改密码" : "设置密码"}</h2>
      {hasPassword ? null : (
        <p className="hp-hint">
          当前账号通过 GitHub 登录，还没有本地密码。设置后可以同时使用邮箱密码登录。
        </p>
      )}

      {hasPassword ? (
        <div className="hp-field">
          <label className="hp-label" htmlFor="currentPassword">
            当前密码
          </label>
          <input
            id="currentPassword"
            type="password"
            className="hp-input"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
      ) : null}

      <div className="hp-field">
        <label className="hp-label" htmlFor="newPassword">
          新密码
        </label>
        <input
          id="newPassword"
          type="password"
          className="hp-input"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
        />
        <p className="hp-hint">8 到 72 位。</p>
      </div>

      <div className="hp-field">
        <label className="hp-label" htmlFor="confirmPassword">
          确认新密码
        </label>
        <input
          id="confirmPassword"
          type="password"
          className="hp-input"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          required
        />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="hp-btn hp-btn-primary" disabled={pending}>
          {pending ? "提交中…" : hasPassword ? "更新密码" : "设置密码"}
        </button>
        {saved ? <span className="hp-success">{saved}</span> : null}
        {error ? <span className="hp-error">{error}</span> : null}
      </div>
    </form>
  );
}
