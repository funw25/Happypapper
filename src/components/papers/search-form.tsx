"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * 检索表单（docs/03-requirements.md PAPER-001、PAPER-006）。
 *
 * 输入停止 400ms 后才发起请求，避免逐字触发上游检索；请求由 Next 的路由跳转
 * 承担，进行中的跳转在再次输入时被取代，因此不会出现旧结果覆盖新结果。表单本身
 * 仍是一次普通 GET 提交，禁用 JavaScript 时按回车也能检索。
 */
export type SearchFormOptions = {
  sorts: { value: string; label: string }[];
  publishers: { key: string; label: string }[];
};

export function PaperSearchForm({
  initialQuery,
  initialSort,
  initialSource,
  initialMode,
  options,
}: {
  initialQuery: string;
  initialSort: string;
  initialSource: string;
  initialMode: "local" | "remote";
  options: SearchFormOptions;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState(initialSort);
  const [source, setSource] = useState(initialSource);
  const [mode, setMode] = useState<"local" | "remote">(initialMode);
  const [pending, startTransition] = useTransition();
  const firstRender = useRef(true);

  function target(next: { query: string; sort: string; source: string; mode: string }) {
    const params = new URLSearchParams();
    params.set("mode", next.mode);
    if (next.query.trim()) params.set("q", next.query.trim());
    params.set("sort", next.sort);
    if (next.source) params.set("source", next.source);
    return `/papers?${params.toString()}`;
  }

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const trimmed = query.trim();
    // An empty box means "show the library", which the local mode already does.
    const timer = setTimeout(() => {
      startTransition(() => {
        router.push(target({ query: trimmed, sort, source, mode }), { scroll: false });
      });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort, source, mode]);

  return (
    <form
      action="/papers"
      className="hp-card flex flex-wrap items-center gap-2 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => {
          router.push(target({ query, sort, source, mode }), { scroll: false });
        });
      }}
    >
      <select
        className="hp-input w-auto"
        name="mode"
        value={mode}
        onChange={(event) => setMode(event.target.value === "remote" ? "remote" : "local")}
      >
        <option value="local">本地论文库</option>
        <option value="remote">远程搜索</option>
      </select>
      <input
        className="hp-input flex-1"
        name="q"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="标题、作者、arXiv ID 或 DOI"
        aria-label="检索关键词"
      />
      <select
        className="hp-input w-auto"
        name="sort"
        value={sort}
        onChange={(event) => setSort(event.target.value)}
      >
        {options.sorts.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        className="hp-input w-auto"
        name="source"
        value={source}
        onChange={(event) => setSource(event.target.value)}
      >
        <option value="">全部来源</option>
        {options.publishers.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      <button className="hp-btn hp-btn-primary" type="submit" disabled={pending}>
        {pending ? "检索中…" : "搜索"}
      </button>
      <Link href="/papers/new" className="hp-btn">
        从来源导入 / 上传 PDF
      </Link>
    </form>
  );
}
