"use client";

import { useState } from "react";

/** 忘记密码（AUTH-006）。响应文案不区分邮箱是否存在，避免被用来枚举用户。 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);

    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    setPending(false);

    if (!response.ok) {
      setError(body.detail ?? "申请失败，请稍后再试");
      return;
    }
    setMessage(body.detail ?? "如果该邮箱在我们的记录里，重置链接已经发出。");
  }

  return (
    <main className="hp-page-narrow max-w-sm">
      <h1 className="hp-page-title mb-6">忘记密码</h1>
      <form className="hp-card hp-stack p-6" onSubmit={submit}>
        <div className="hp-field">
          <label className="hp-label" htmlFor="email">
            邮箱
          </label>
          <input
            id="email"
            className="hp-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
          <p className="hp-hint">我们会向这个地址发送一封带重置链接的邮件，链接一小时内有效。</p>
        </div>

        <button type="submit" className="hp-btn hp-btn-primary w-full" disabled={pending}>
          {pending ? "发送中…" : "发送重置链接"}
        </button>
        {message ? <p className="hp-success">{message}</p> : null}
        {error ? <p className="hp-error">{error}</p> : null}

        <p className="hp-hint">
          想起来了？<a className="ml-1 text-[var(--paper-accent)] hover:underline" href="/login">返回登录</a>
        </p>
      </form>
    </main>
  );
}
