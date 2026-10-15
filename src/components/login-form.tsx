"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

/** NextAuth error codes mapped to something a reader can act on (AUTH-013). */
const ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked: "该邮箱已经用密码注册过。请先用密码登录，再在设置里绑定 GitHub。",
  AccessDenied: "GitHub 拒绝或取消了授权。",
  Configuration: "GitHub 登录的配置不完整，请联系管理员。",
  OAuthSignin: "无法发起 GitHub 登录，请稍后重试。",
  OAuthCallback: "GitHub 回调校验失败，请重试。",
  CredentialsSignin: "邮箱或密码不正确。",
};

export function LoginForm({
  githubEnabled,
  initialError,
}: {
  githubEnabled: boolean;
  initialError?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    initialError ? (ERROR_MESSAGES[initialError] ?? "登录失败，请重试。") : null,
  );
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = await signIn("credentials", { email, password, redirect: false });

    setPending(false);
    if (!result || result.error) {
      setError("邮箱或密码不正确");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-xl font-semibold">登录</h1>
      <form onSubmit={onSubmit} className="hp-card space-y-4 p-6">
        <label className="block space-y-1 text-sm">
          <span className="text-[var(--paper-muted)]">邮箱</span>
          <input
            className="hp-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-[var(--paper-muted)]">密码</span>
          <input
            className="hp-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? <p className="text-sm text-[var(--paper-danger)]">{error}</p> : null}
        <button className="hp-btn hp-btn-primary w-full" disabled={pending} type="submit">
          {pending ? "登录中…" : "登录"}
        </button>
        <p className="text-xs text-[var(--paper-muted)]">
          <a className="hover:text-[var(--paper-accent)] hover:underline" href="/forgot-password">
            忘记密码？
          </a>
        </p>
      </form>

      {githubEnabled ? (
        <div className="mt-4">
          <button
            type="button"
            className="hp-btn w-full"
            data-github-signin
            onClick={() => signIn("github", { callbackUrl: "/" })}
          >
            用 GitHub 登录
          </button>
          <p className="mt-2 text-xs text-[var(--paper-muted)]">
            首次使用 GitHub 登录会自动创建账号，昵称取自 GitHub，重复时会自动加后缀。
          </p>
        </div>
      ) : null}

      <p className="mt-4 text-sm text-[var(--paper-muted)]">
        还没有账号？
        <Link href="/register" className="ml-1 text-[var(--paper-accent)]">
          注册
        </Link>
      </p>
    </main>
  );
}
