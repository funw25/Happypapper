"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * GitHub 绑定与解绑（AUTH-011、AUTH-012）。
 *
 * 绑定跳到自建的 connect 路由（Auth.js 不支持把身份绑到当前账号）；解绑受服务端
 * 保护：只剩这一种登录方式时返回 409 并提示先设置密码。
 */
export function GithubLink({
  githubLogin,
  hasPassword,
  configured,
}: {
  githubLogin: string | null;
  hasPassword: boolean;
  configured: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastMethod = Boolean(githubLogin) && !hasPassword;

  async function unlink() {
    setPending(true);
    setMessage(null);
    setError(null);
    const response = await fetch("/api/me/github/unlink", { method: "POST" });
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    setPending(false);

    if (!response.ok) {
      setError(body.detail ?? "解绑失败");
      return;
    }
    setMessage(body.detail ?? "已解绑");
    router.refresh();
  }

  return (
    <section className="hp-card hp-stack p-6">
      <h2 className="hp-section-title">GitHub 账号</h2>
      {githubLogin ? (
        <p className="text-sm">
          已绑定 <span className="font-medium">{githubLogin}</span>。
        </p>
      ) : (
        <p className="text-sm">
          {configured ? "还没有绑定 GitHub 账号。" : "本站还没有配置 GitHub OAuth 应用，绑定功能暂不可用。"}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {githubLogin ? (
          <button type="button" className="hp-btn" disabled={pending || lastMethod} onClick={() => void unlink()}>
            {pending ? "解绑中…" : "解绑 GitHub"}
          </button>
        ) : (
          <a className={`hp-btn hp-btn-primary ${configured ? "" : "pointer-events-none opacity-50"}`} href="/api/me/github/connect">
            绑定 GitHub
          </a>
        )}
        <span className="hp-hint">
          当前可用的登录方式：
          {[hasPassword ? "邮箱密码" : null, githubLogin ? "GitHub" : null].filter(Boolean).join(" + ") ||
            "无（请先设置密码）"}
        </span>
      </div>

      {lastMethod ? (
        <p className="hp-hint">
          这是账号唯一的登录方式。请先在上面的表单里设置密码，之后即可解绑 GitHub。
        </p>
      ) : null}
      {message ? <p className="hp-success">{message}</p> : null}
      {error ? <p className="hp-error">{error}</p> : null}
    </section>
  );
}
