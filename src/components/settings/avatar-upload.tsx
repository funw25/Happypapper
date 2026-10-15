"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 上传头像（docs/03-requirements.md 第 5.2 节）。类型与大小都在服务端校验，这里
 * 只做即时反馈；成功后服务端返回带时间戳的新地址，因此不需要手动清理浏览器缓存。
 */
export function AvatarUpload({ current }: { current: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setPending(true);
    setMessage(null);
    setError(null);

    const form = new FormData();
    form.set("avatar", file);
    const response = await fetch("/api/me/avatar", { method: "POST", body: form });
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    setPending(false);

    if (!response.ok) {
      setError(body.detail ?? "上传失败");
      return;
    }
    setMessage(body.detail ?? "头像已更新");
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="hp-field">
      <span className="hp-label">上传头像</span>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          id="avatarFile"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hp-input w-auto"
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        {current ? (
          <span className="hp-hint">
            当前头像 <code className="text-xs">{current.slice(0, 42)}</code>
          </span>
        ) : null}
      </div>
      <p className="hp-hint">PNG、JPEG、WebP 或 GIF，最大 2MB。上传后会自动替换旧头像。</p>
      {message ? <p className="hp-success">{message}</p> : null}
      {error ? <p className="hp-error">{error}</p> : null}
    </div>
  );
}
