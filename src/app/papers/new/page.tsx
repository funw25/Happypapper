"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "identifier" | "upload";

export default function NewPaperPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [year, setYear] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [rightsClaimed, setRightsClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submitIdentifier(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch("/api/papers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier }),
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);

    if (!response.ok) {
      setError(payload.detail ?? "导入失败");
      return;
    }
    router.push(`/papers/${payload.paper.id}`);
  }

  async function submitUpload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("请选择 PDF 文件");
      return;
    }
    if (visibility === "public" && !rightsClaimed) {
      setError("转为公开前需确认你拥有该 PDF 的分发权利");
      return;
    }

    setPending(true);
    setError(null);

    const form = new FormData();
    form.set("file", file);
    form.set("title", title);
    form.set("authors", authors);
    form.set("year", year);
    form.set("visibility", visibility);

    const response = await fetch("/api/papers", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({}));
    setPending(false);

    if (!response.ok) {
      setError(payload.detail ?? "上传失败");
      return;
    }
    router.push(`/papers/${payload.paper.id}`);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-1 text-xl font-semibold">添加论文</h1>
      <p className="mb-6 text-sm text-[var(--paper-muted)]">
        公开论文按 arXiv ID 或 DOI 导入并缓存开放获取 PDF；没有公开 PDF 时仍会保存元数据记录，
        之后可以在详情页重试或打开来源网站。本地或未公开的论文用上传方式添加。
      </p>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          className={`hp-btn ${mode === "identifier" ? "hp-btn-primary" : ""}`}
          onClick={() => setMode("identifier")}
        >
          arXiv / DOI
        </button>
        <button
          type="button"
          className={`hp-btn ${mode === "upload" ? "hp-btn-primary" : ""}`}
          onClick={() => setMode("upload")}
        >
          上传 PDF
        </button>
      </div>

      {mode === "identifier" ? (
        <form onSubmit={submitIdentifier} className="hp-card space-y-4 p-6">
          <label className="block space-y-1 text-sm">
            <span className="text-[var(--paper-muted)]">arXiv ID 或 DOI</span>
            <input
              className="hp-input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="1706.03762 或 10.1145/3292500.3330701"
              required
            />
          </label>
          {error ? <p className="text-sm text-[var(--paper-danger)]">{error}</p> : null}
          <button className="hp-btn hp-btn-primary w-full" type="submit" disabled={pending}>
            {pending ? "导入中…" : "导入"}
          </button>
        </form>
      ) : (
        <form onSubmit={submitUpload} className="hp-card space-y-4 p-6">
          <label className="block space-y-1 text-sm">
            <span className="text-[var(--paper-muted)]">PDF 文件</span>
            <input
              className="hp-input"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-[var(--paper-muted)]">标题（留空则用文件名）</span>
            <input className="hp-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-[var(--paper-muted)]">作者（逗号分隔）</span>
            <input className="hp-input" value={authors} onChange={(e) => setAuthors(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-[var(--paper-muted)]">年份</span>
            <input
              className="hp-input"
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-[var(--paper-muted)]">可见性</span>
            <select
              className="hp-input"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as "private" | "public")}
            >
              <option value="private">私有（仅自己可见）</option>
              <option value="public">公开</option>
            </select>
          </label>
          {visibility === "public" ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={rightsClaimed}
                onChange={(e) => setRightsClaimed(e.target.checked)}
              />
              <span className="text-[var(--paper-muted)]">
                我确认拥有该 PDF 的分发权利，或该文献为开放获取。
              </span>
            </label>
          ) : null}
          {error ? <p className="text-sm text-[var(--paper-danger)]">{error}</p> : null}
          <button className="hp-btn hp-btn-primary w-full" type="submit" disabled={pending}>
            {pending ? "上传中…" : "上传"}
          </button>
        </form>
      )}
    </main>
  );
}
