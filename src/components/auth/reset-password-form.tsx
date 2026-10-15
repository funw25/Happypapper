"use client";

import { useState } from "react";

/** 重设密码（AUTH-006）。令牌来自邮件链接，一次性使用。 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("新密码至少 8 位");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }

    setPending(true);
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    setPending(false);

    if (!response.ok) {
      setError(body.detail ?? "重置失败，请重新申请链接");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <main className="hp-page-narrow max-w-sm">
        <h1 className="hp-page-title mb-6">密码已重置</h1>
        <div className="hp-card hp-stack p-6">
          <p className="text-sm">请用新密码登录。旧密码已经失效。</p>
          <a className="hp-btn hp-btn-primary" href="/login">
            去登录
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="hp-page-narrow max-w-sm">
      <h1 className="hp-page-title mb-6">设置新密码</h1>
      <form className="hp-card hp-stack p-6" onSubmit={submit}>
        <div className="hp-field">
          <label className="hp-label" htmlFor="password">
            新密码
          </label>
          <input
            id="password"
            className="hp-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            required
          />
          <p className="hp-hint">8 到 72 位。</p>
        </div>
        <div className="hp-field">
          <label className="hp-label" htmlFor="confirm">
            确认新密码
          </label>
          <input
            id="confirm"
            className="hp-input"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            required
          />
        </div>

        <button type="submit" className="hp-btn hp-btn-primary w-full" disabled={pending}>
          {pending ? "提交中…" : "设置新密码"}
        </button>
        {error ? <p className="hp-error">{error}</p> : null}
      </form>
    </main>
  );
}
