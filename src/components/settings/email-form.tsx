"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 账号安全页的邮箱区块（AUTH-007、PROFILE-008）。
 *
 * 两个动作分开：给当前地址重发验证邮件；把账号邮箱改成一个新地址。后者先进入
 * 待确认状态，链接被打开之前旧地址仍然是登录依据。
 */
export function EmailForm({
  email,
  verified,
  pendingEmail,
}: {
  email: string;
  verified: boolean;
  pendingEmail: string | null;
}) {
  const router = useRouter();
  const [newEmail, setNewEmail] = useState("");
  const [pending, setPending] = useState<"verify" | "change" | "cancel" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, init: RequestInit, kind: "verify" | "change" | "cancel") {
    setPending(kind);
    setMessage(null);
    setError(null);
    const response = await fetch(path, init);
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    setPending(null);

    if (!response.ok) {
      setError(body.detail ?? "操作失败");
      return false;
    }
    setMessage(body.detail ?? "已完成");
    router.refresh();
    return true;
  }

  const sendVerification = () =>
    call("/api/me/email", { method: "POST" }, "verify");

  const change = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await call(
      "/api/me/email",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: newEmail }),
      },
      "change",
    );
    if (ok) setNewEmail("");
  };

  return (
    <section className="hp-card hp-stack p-6">
      <h2 className="hp-section-title">登录邮箱</h2>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{email}</span>
        <span className="hp-tag">{verified ? "已验证" : "未验证"}</span>
      </div>

      {pendingEmail ? (
        <div className="hp-notice">
          <p>
            待确认的新邮箱：<span className="font-medium">{pendingEmail}</span>
            。确认链接已发到该地址，打开后才会生效。
          </p>
          <div className="mt-2">
            <button
              type="button"
              className="hp-btn"
              disabled={pending !== null}
              onClick={() => void call("/api/me/email", { method: "DELETE" }, "cancel")}
            >
              {pending === "cancel" ? "取消中…" : "取消这次修改"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="hp-btn"
          disabled={pending !== null || verified}
          onClick={() => void sendVerification()}
        >
          {pending === "verify" ? "发送中…" : verified ? "邮箱已验证" : "发送验证邮件"}
        </button>
      </div>

      <form className="hp-stack" onSubmit={change}>
        <div className="hp-field">
          <label className="hp-label" htmlFor="newEmail">
            修改邮箱
          </label>
          <input
            id="newEmail"
            className="hp-input"
            type="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            placeholder="new@example.com"
            required
          />
          <p className="hp-hint">确认链接会发到新地址；在链接被打开之前，当前邮箱仍然有效。</p>
        </div>
        <div>
          <button type="submit" className="hp-btn" disabled={pending !== null}>
            {pending === "change" ? "提交中…" : "发送确认链接"}
          </button>
        </div>
      </form>

      {message ? <p className="hp-success">{message}</p> : null}
      {error ? <p className="hp-error">{error}</p> : null}
    </section>
  );
}
