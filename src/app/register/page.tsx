"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name, password }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setPending(false);
      setError(
        payload.error === "ALREADY_EXISTS" ? "邮箱或用户名已被占用" : (payload.detail ?? "注册失败"),
      );
      return;
    }

    const result = await signIn("credentials", { email, password, redirect: false });
    setPending(false);
    if (!result || result.error) {
      setError("注册成功，请手动登录");
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-xl font-semibold">注册</h1>
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
          <span className="text-[var(--paper-muted)]">用户名（2-24 字符）</span>
          <input
            className="hp-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            maxLength={24}
            required
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-[var(--paper-muted)]">密码（至少 8 位）</span>
          <input
            className="hp-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {error ? <p className="text-sm text-[var(--paper-danger)]">{error}</p> : null}
        <button className="hp-btn hp-btn-primary w-full" disabled={pending} type="submit">
          {pending ? "注册中…" : "注册并登录"}
        </button>
      </form>
      <p className="mt-4 text-sm text-[var(--paper-muted)]">
        已有账号？
        <Link href="/login" className="ml-1 text-[var(--paper-accent)]">
          登录
        </Link>
      </p>
    </main>
  );
}
