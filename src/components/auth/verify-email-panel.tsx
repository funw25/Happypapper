"use client";

import { useState } from "react";

/**
 * 邮箱确认（AUTH-007）。邮件链接只打开本页，真正的确认由按钮触发的 POST 完成：
 * 邮件网关与安全扫描器会预取链接，GET 即生效会让令牌在用户点开前被消耗。
 */
export function VerifyEmailPanel({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null);

  async function confirm() {
    setPending(true);
    const response = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    setPending(false);
    setResult({ ok: response.ok, detail: body.detail ?? (response.ok ? "邮箱已确认" : "链接无效或已过期") });
  }

  if (!token) {
    return (
      <div className="hp-card hp-stack p-6">
        <p className="hp-error">链接里没有令牌，请从邮件里重新打开，或在账号安全页重新发送。</p>
        <a className="hp-btn" href="/settings/account">
          去账号安全页
        </a>
      </div>
    );
  }

  return (
    <div className="hp-card hp-stack p-6">
      {result ? (
        <>
          <p className={result.ok ? "hp-success" : "hp-error"}>{result.detail}</p>
          <a className="hp-btn hp-btn-primary" href={result.ok ? "/settings/account" : "/login"}>
            {result.ok ? "回到账号安全页" : "去登录"}
          </a>
        </>
      ) : (
        <>
          <p className="text-sm">点下面的按钮完成确认。链接只能使用一次，24 小时内有效。</p>
          <button type="button" className="hp-btn hp-btn-primary" onClick={confirm} disabled={pending}>
            {pending ? "确认中…" : "确认这个邮箱"}
          </button>
        </>
      )}
    </div>
  );
}
