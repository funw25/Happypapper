"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { buildPageIndex, buildQuoteContext, clamp01, findQuote } from "@/lib/anchor";
import {
  KIND_FILTERS,
  KIND_LABELS,
  type CommentDTO,
  type CommentListResponse,
} from "@/lib/comments/types";
import { CommentCard } from "./comment-card";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type TextSpanItem = { str: string; left: number; top: number; height: number };

type DraftAnchor = {
  page: number;
  yNorm: number;
  xNorm: number | null;
  quote: string | null;
  quotePrefix: string | null;
  quoteSuffix: string | null;
  charStart: number | null;
  charEnd: number | null;
};

type Props = {
  paperId: string;
  hasTextLayer: boolean;
  initialPage: number;
  currentUserId: string | null;
  /** Account preference that seeds the composer's "anonymous" checkbox. */
  anonymousDefault: boolean;
};

const KINDS = ["question", "explain", "method", "result", "other"] as const;

export function PdfReader({
  paperId,
  hasTextLayer,
  initialPage,
  currentUserId,
  anonymousDefault,
}: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(Math.max(1, initialPage));
  const [scale, setScale] = useState(1.3);
  const [items, setItems] = useState<TextSpanItem[]>([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState<string | null>(null);

  const [draft, setDraft] = useState<DraftAnchor | null>(null);
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("question");
  const [displayMode, setDisplayMode] = useState<"position" | "immediate">("position");
  const [anonymous, setAnonymous] = useState(anonymousDefault);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [kindFilter, setKindFilter] = useState("all");
  const [sort, setSort] = useState<"time" | "hot">("time");
  const [danmakuOn, setDanmakuOn] = useState(true);
  const [density, setDensity] = useState(6);
  const [comments, setComments] = useState<CommentListResponse>({ roots: [], replies: [] });
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [reachNorm, setReachNorm] = useState(0);
  const [viewers, setViewers] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  // ---- document loading -------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const task = pdfjs.getDocument({
      url: `/api/papers/${paperId}/pdf`,
      withCredentials: true,
    });

    task.promise.then(
      (loaded) => {
        if (cancelled) {
          // Do not destroy the loading task here. React StrictMode mounts the
          // effect twice in development, and destroying the first task tears
          // down the shared PDFWorker, leaving the second task pending forever.
          return;
        }
        setDoc(loaded);
        setNumPages(loaded.numPages);
        setPageNumber((current) => Math.min(Math.max(1, current), loaded.numPages));
      },
      (error: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setErrorText(error instanceof Error ? error.message : "PDF 加载失败");
      },
    );

    return () => {
      cancelled = true;
    };
  }, [paperId]);

  const fitWidth = useCallback(async () => {
    if (!doc) return;
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const available = (scrollerRef.current?.clientWidth ?? 900) - 48;
    setScale(Math.min(3, Math.max(0.5, Number((available / base.width).toFixed(2)))));
  }, [doc, pageNumber]);

  // ---- page rendering ---------------------------------------------------
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;

    (async () => {
      setStatus("loading");
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });

      const canvas = canvasRef.current;
      const layer = textLayerRef.current;
      if (!canvas || !layer) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);

      renderTaskRef.current?.cancel();
      const task = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      renderTaskRef.current = task;

      try {
        await task.promise;
      } catch {
        return;
      }
      if (cancelled) return;

      const textContent = await page.getTextContent();
      if (cancelled) return;

      layer.replaceChildren();
      const fragment = document.createDocumentFragment();
      const built: TextSpanItem[] = [];

      for (const raw of textContent.items) {
        if (!("str" in raw)) continue;
        const { str, transform } = raw as { str: string; transform: number[] };
        if (!str) continue;

        const tx = pdfjs.Util.transform(viewport.transform, transform);
        const fontHeight = Math.hypot(tx[2], tx[3]) || 10;
        const angle = Math.atan2(tx[1], tx[0]);
        const top = tx[5] - fontHeight;

        const span = document.createElement("span");
        span.textContent = str;
        span.dataset.i = String(built.length);
        span.style.position = "absolute";
        span.style.left = `${tx[4]}px`;
        span.style.top = `${top}px`;
        span.style.fontSize = `${fontHeight}px`;
        span.style.fontFamily = "sans-serif";
        span.style.lineHeight = "1";
        span.style.whiteSpace = "pre";
        span.style.color = "transparent";
        span.style.transformOrigin = "0% 0%";
        span.style.cursor = "text";
        if (angle) span.style.transform = `rotate(${angle}rad)`;

        fragment.appendChild(span);
        built.push({ str, left: tx[4], top, height: fontHeight });
      }

      layer.appendChild(fragment);
      setItems(built);
      setPageSize({ width: viewport.width, height: viewport.height });
      setStatus("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, scale]);

  // ---- selection to anchor ---------------------------------------------
  const flatText = useMemo(() => items.map((item) => item.str).join(" "), [items]);
  const itemStarts = useMemo(() => {
    const starts: number[] = [];
    let acc = 0;
    for (const item of items) {
      starts.push(acc);
      acc += item.str.length + 1;
    }
    return starts;
  }, [items]);
  const pageIndex = useMemo(() => buildPageIndex(items.map((item) => ({ text: item.str }))), [items]);

  const locateOffset = useCallback(
    (node: Node, offset: number): number | null => {
      let element: Node | null = node;
      while (element && !(element instanceof HTMLElement && element.dataset.i !== undefined)) {
        element = element.parentNode;
      }
      if (!(element instanceof HTMLElement)) return null;
      const index = Number(element.dataset.i);
      if (!Number.isInteger(index)) return null;
      const local = node.nodeType === Node.TEXT_NODE ? offset : 0;
      return (itemStarts[index] ?? 0) + local;
    },
    [itemStarts],
  );

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    const layer = textLayerRef.current;
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !layer) return;

    const range = selection.getRangeAt(0);
    if (!layer.contains(range.startContainer) || !layer.contains(range.endContainer)) return;

    const start = locateOffset(range.startContainer, range.startOffset);
    const end = locateOffset(range.endContainer, range.endOffset);
    if (start === null || end === null || end <= start) return;

    const context = buildQuoteContext(flatText, start, end);
    const index = items.findIndex((_, i) => (itemStarts[i] ?? 0) > start);
    const anchorItem = items[(index === -1 ? items.length : index) - 1];
    if (!anchorItem) return;

    setDraft({
      page: pageNumber,
      yNorm: clamp01(anchorItem.top / (pageSize.height || 1)),
      xNorm: clamp01(anchorItem.left / (pageSize.width || 1)),
      quote: context.quote || null,
      quotePrefix: context.quotePrefix || null,
      quoteSuffix: context.quoteSuffix || null,
      charStart: start,
      charEnd: end,
    });
  }, [flatText, itemStarts, items, locateOffset, pageNumber, pageSize.height, pageSize.width]);

  // ---- comments ---------------------------------------------------------
  const loadComments = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(pageNumber),
      spread: "1",
      kind: kindFilter,
      sort,
    });
    const response = await fetch(`/api/papers/${paperId}/comments?${params}`);
    if (!response.ok) return;
    setComments((await response.json()) as CommentListResponse);
  }, [paperId, pageNumber, kindFilter, sort]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  // ---- live channel -----------------------------------------------------
  const loadCommentsRef = useRef(loadComments);
  useEffect(() => {
    loadCommentsRef.current = loadComments;
  }, [loadComments]);

  useEffect(() => {
    const source = new EventSource(`/api/papers/${paperId}/stream`);

    source.addEventListener("presence", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { viewers?: number };
      setViewers(payload.viewers ?? 0);
    });

    const refresh = () => void loadCommentsRef.current();
    source.addEventListener("comment:new", refresh);
    source.addEventListener("comment:update", refresh);

    // EventSource reconnects on its own; closing on unmount is all that is needed.
    return () => source.close();
  }, [paperId]);

  // ---- reading progress -------------------------------------------------
  useEffect(() => {
    if (!currentUserId || status !== "ready") return;
    const timer = setTimeout(() => {
      void fetch(`/api/papers/${paperId}/progress`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          page: pageNumber,
          yNorm: reachNorm,
          progress: numPages > 1 ? (pageNumber - 1) / (numPages - 1) : 1,
        }),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [paperId, pageNumber, numPages, reachNorm, currentUserId, status]);

  // ---- anchoring of existing comments -----------------------------------
  const resolveTop = useCallback(
    (comment: CommentDTO): number => {
      const hit = findQuote(pageIndex, comment.quote, comment.quotePrefix, comment.quoteSuffix);
      if (hit) {
        const item = items[hit.partIndex];
        if (item) return item.top;
      }
      return clamp01(comment.yNorm) * (pageSize.height || 0);
    },
    [items, pageIndex, pageSize.height],
  );

  const placed = useMemo(
    () =>
      comments.roots
        .filter((comment) => comment.page === pageNumber)
        .map((comment) => ({ comment, top: resolveTop(comment) }))
        .sort((a, b) => a.top - b.top),
    [comments.roots, pageNumber, resolveTop],
  );

  const danmakuItems = useMemo(() => {
    if (!danmakuOn) return [];
    const pool = placed.filter((entry) =>
      entry.comment.visibleInDanmaku !== false &&
      (entry.comment.displayMode === "immediate" ? true : entry.comment.yNorm <= reachNorm + 0.92),
    );
    return pool.slice(0, density).map((entry, i) => ({
      key: `${entry.comment.id}`,
      text: entry.comment.content,
      lane: i % 6,
      delay: i * 0.7,
    }));
  }, [danmakuOn, density, placed, reachNorm]);

  const jumpTo = useCallback(
    (comment: CommentDTO) => {
      const top = resolveTop(comment);
      const scroller = scrollerRef.current;
      if (scroller) scroller.scrollTo({ top: Math.max(0, top - 120), behavior: "smooth" });
      setHighlightId(comment.id);
      window.setTimeout(() => setHighlightId((current) => (current === comment.id ? null : current)), 2500);
    },
    [resolveTop],
  );

  const repliesFor = useCallback(
    (rootId: number) => comments.replies.filter((reply) => reply.parentId === rootId),
    [comments.replies],
  );

  // ---- publishing -------------------------------------------------------
  async function submit() {
    const text = content.trim();
    if (!text) {
      setNotice("请输入内容");
      return;
    }
    if (!currentUserId) {
      setNotice("请先登录后发布");
      return;
    }

    const anchor =
      draft ??
      ({
        page: pageNumber,
        yNorm: clamp01(reachNorm + 0.25),
        xNorm: null,
        quote: null,
        quotePrefix: null,
        quoteSuffix: null,
        charStart: null,
        charEnd: null,
      } satisfies DraftAnchor);

    setPending(true);
    const response = await fetch(`/api/papers/${paperId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text, kind, displayMode, anchor, anonymous }),
    });
    const payload = await response.json().catch(() => ({}));
    setPending(false);

    if (!response.ok) {
      setNotice(payload.detail ?? "发布失败");
      return;
    }

    setContent("");
    setDraft(null);
    setNotice("已发布");
    window.getSelection()?.removeAllRanges();
    await loadComments();
  }

  function publishAtPage() {
    setDraft({
      page: pageNumber,
      yNorm: clamp01(reachNorm + 0.2),
      xNorm: null,
      quote: null,
      quotePrefix: null,
      quoteSuffix: null,
      charStart: null,
      charEnd: null,
    });
    setNotice(null);
  }

  const highlightEntry = highlightId
    ? placed.find((entry) => entry.comment.id === highlightId)
    : undefined;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--paper-line)] bg-[var(--paper-surface)] px-4 py-2 text-sm">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="hp-btn px-2 py-0.5"
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            >
              ‹
            </button>
            <span className="tabular-nums">
              {pageNumber} / {numPages || "…"}
            </span>
            <button
              type="button"
              className="hp-btn px-2 py-0.5"
              disabled={numPages > 0 && pageNumber >= numPages}
              onClick={() => setPageNumber((p) => Math.min(numPages || p + 1, p + 1))}
            >
              ›
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button type="button" className="hp-btn px-2 py-0.5" onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))))}>
              −
            </button>
            <span className="tabular-nums">{Math.round(scale * 100)}%</span>
            <button type="button" className="hp-btn px-2 py-0.5" onClick={() => setScale((s) => Math.min(3, Number((s + 0.15).toFixed(2))))}>
              +
            </button>
            <button type="button" className="hp-btn px-2 py-0.5" onClick={() => void fitWidth()}>
              适应宽度
            </button>
          </div>

          <label className="flex items-center gap-1">
            <input type="checkbox" checked={danmakuOn} onChange={(e) => setDanmakuOn(e.target.checked)} />
            弹幕
          </label>
          <label className="flex items-center gap-1">
            密度
            <input
              type="range"
              min={0}
              max={20}
              value={density}
              onChange={(e) => setDensity(Number(e.target.value))}
            />
            <span className="tabular-nums">{density}</span>
          </label>

          <select className="hp-input w-auto py-0.5" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            {KIND_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
          <select
            className="hp-input w-auto py-0.5"
            value={sort}
            onChange={(e) => setSort(e.target.value === "hot" ? "hot" : "time")}
          >
            <option value="time">按时间</option>
            <option value="hot">按热度</option>
          </select>

          <span className="ml-auto flex items-center gap-1 text-[var(--paper-muted)]" title="当前正在阅读这篇论文的人数">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--paper-accent)]" />
            {viewers} 人在读
          </span>
        </div>

        {/* page */}
        <div
          ref={scrollerRef}
          className="min-h-0 flex-1 overflow-auto bg-[var(--paper-reader-bg)] px-6 py-4"
          onScroll={(event) => {
            const el = event.currentTarget;
            if (pageSize.height > 0) setReachNorm(clamp01(el.scrollTop / pageSize.height));
          }}
        >
          <div
            ref={pageRef}
            className="relative mx-auto bg-[var(--paper-surface)] shadow"
            style={{ width: pageSize.width || undefined, height: pageSize.height || undefined }}
          >
            <canvas ref={canvasRef} className="block" />
            <div
              ref={textLayerRef}
              className="hp-text-layer absolute inset-0 overflow-hidden"
              onMouseUp={handleMouseUp}
            />

            {/* position markers */}
            <div className="pointer-events-none absolute top-0 right-0 h-full w-16">
              {placed.map((entry) => (
                <button
                  key={entry.comment.id}
                  type="button"
                  title={entry.comment.content.slice(0, 80)}
                  onClick={() => {
                    jumpTo(entry.comment);
                    document.getElementById(`c${entry.comment.id}`)?.scrollIntoView({ block: "center" });
                  }}
                  className={`pointer-events-auto absolute right-1 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border text-[10px] ${
                    entry.comment.userId === currentUserId
                      ? "border-[var(--paper-accent)] bg-[var(--paper-accent)] text-[var(--paper-accent-fg)]"
                      : "border-[var(--paper-line)] bg-[var(--paper-surface)] text-[var(--paper-muted)]"
                  }`}
                  style={{ top: `${entry.top}px` }}
                >
                  {entry.comment.likeCount > 0 ? entry.comment.likeCount : "•"}
                </button>
              ))}
            </div>

            {/* highlight band */}
            {highlightEntry ? (
              <div
                className="pointer-events-none absolute right-0 left-0 h-6 bg-[var(--paper-accent)]/20"
                style={{ top: `${highlightEntry.top}px` }}
              />
            ) : null}

            {/* danmaku */}
            {danmakuOn ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden">
                {danmakuItems.map((entry) => (
                  <div
                    key={entry.key}
                    className="hp-danmaku text-sm"
                    style={{ top: `${entry.lane * 26 + 8}px`, animationDelay: `${entry.delay}s` }}
                  >
                    {entry.text}
                  </div>
                ))}
              </div>
            ) : null}

            {status === "error" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--paper-overlay)] text-sm text-[var(--paper-danger)]">
                {errorText ?? "PDF 加载失败"}
              </div>
            ) : null}
          </div>
        </div>

        {/* compose */}
        <div className="border-t border-[var(--paper-line)] bg-[var(--paper-surface)] px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-[var(--paper-muted)]">
            {draft ? (
              <>
                <span>
                  锚点：第 {draft.page} 页 · y={draft.yNorm.toFixed(2)}
                  {draft.quote ? ` · “${draft.quote.slice(0, 40)}${draft.quote.length > 40 ? "…" : ""}”` : " · 页面级"}
                </span>
                <button type="button" className="hover:text-[var(--paper-danger)]" onClick={() => setDraft(null)}>
                  清除
                </button>
              </>
            ) : (
              <>
                <span>
                  {hasTextLayer
                    ? "在页面上选中文字即可绑定到句子"
                    : "该 PDF 无文本层，评论将绑定到页面位置"}
                </span>
                <button type="button" className="hover:text-[var(--paper-accent)]" onClick={publishAtPage}>
                  不选文本，按页面位置发布
                </button>
              </>
            )}
            {notice ? <span className="text-[var(--paper-accent)]">{notice}</span> : null}
          </div>

          <div className="flex gap-2">
            <select
              className="hp-input w-auto"
              value={kind}
              onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {KIND_LABELS[value]}
                </option>
              ))}
            </select>
            <select
              className="hp-input w-auto"
              value={displayMode}
              onChange={(e) => setDisplayMode(e.target.value === "immediate" ? "immediate" : "position")}
            >
              <option value="position">按阅读位置显示</option>
              <option value="immediate">立即显示</option>
            </select>
            <label
              className="flex shrink-0 items-center gap-1 text-xs text-[var(--paper-muted)]"
              title="以匿名身份发布这条评论"
            >
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
              />
              匿名发布
            </label>
            <input
              className="hp-input"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="写下你的问题、解释或质疑，回车发送"
              maxLength={1000}
            />
            <button type="button" className="hp-btn hp-btn-primary" disabled={pending} onClick={() => void submit()}>
              {pending ? "发送中…" : "发送"}
            </button>
          </div>
        </div>
      </div>

      {/* sidebar */}
      <aside className="hidden w-[360px] shrink-0 flex-col border-l border-[var(--paper-line)] bg-[var(--paper-bg)] lg:flex">
        <div className="border-b border-[var(--paper-line)] px-4 py-3 text-sm font-medium">
          第 {pageNumber} 页附近 · {comments.roots.length} 条
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3">
          {comments.roots.length === 0 ? (
            <p className="text-sm text-[var(--paper-muted)]">
              这一页还没有评论。选中一句话写下第一条，后来的读者会在同一位置看到它。
            </p>
          ) : (
            comments.roots.map((comment) => (
              <div key={comment.id} className="space-y-2">
                <CommentCard
                  comment={comment}
                  paperId={paperId}
                  currentUserId={currentUserId}
                  onChanged={loadComments}
                  onJump={jumpTo}
                />
                {repliesFor(comment.id).map((reply) => (
                  <CommentCard
                    key={reply.id}
                    comment={reply}
                    paperId={paperId}
                    currentUserId={currentUserId}
                    isReply
                    onChanged={loadComments}
                    onJump={jumpTo}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
