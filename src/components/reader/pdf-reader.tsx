"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { buildPageIndex, buildQuoteContext, clamp01, findQuote, normalizeForMatch, uniqueQuoteOffset } from "@/lib/anchor";
import { codePointCount, joinPdfText, TEXT_INDEX_VERSION, type AnchorV2 } from "@/lib/anchor-v2";
import { toAnchorRect, toReaderRect, type PdfGeometry } from "./pdf-geometry";
import { useRouter } from "next/navigation";
import Link from "next/link";
import "pdfjs-dist/web/pdf_viewer.css";
import {
  KIND_FILTERS,
  KIND_LABELS,
  type CommentDTO,
  type CommentListResponse,
} from "@/lib/comments/types";
import { CommentCard } from "./comment-card";
import { DanmakuPlayer } from "./danmaku-player";
import type { RealtimeEvent } from "@/lib/realtime";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type TextSpanItem = { str: string; hasEOL: boolean; top: number };

type Props = {
  paperId: string;
  versionId: string | null;
  versionLabel: string;
  versions: { id: string; label: string; pageCount: number | null }[];
  initialCommentId: number | null;
  initialPage: number;
  initialYNorm: number;
  canPublish: boolean;
  currentUserId: string | null;
  /** Account preference that seeds the composer's "anonymous" checkbox. */
  anonymousDefault: boolean;
};

const KINDS = ["question", "explain", "method", "result", "other"] as const;

export function PdfReader({
  paperId,
  versionId,
  versionLabel,
  versions,
  initialCommentId,
  initialPage,
  initialYNorm,
  canPublish,
  currentUserId,
  anonymousDefault,
}: Props) {
  const router = useRouter();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(Math.max(1, initialPage));
  const [scale, setScale] = useState(1.3);
  const [items, setItems] = useState<TextSpanItem[]>([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState<string | null>(null);

  const [draft, setDraft] = useState<AnchorV2 | null>(null);
  const [composerMode, setComposerMode] = useState<"comment" | "danmaku">("comment");
  const [danmakuText, setDanmakuText] = useState("");
  const [regionMode, setRegionMode] = useState(false);
  const [regionDrag, setRegionDrag] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [pendingJump, setPendingJump] = useState<CommentDTO | null>(null);
  const [returnPosition, setReturnPosition] = useState<{ page: number; scrollTop: number } | null>(null);
  const [restorePosition, setRestorePosition] = useState<{ page: number; scrollTop: number } | null>(null);
  const [retryPdf, setRetryPdf] = useState(0);
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("question");
  const [anonymous, setAnonymous] = useState(anonymousDefault);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [kindFilter, setKindFilter] = useState("all");
  const [sort, setSort] = useState<"time" | "hot">("time");
  const [selectingText, setSelectingText] = useState(false);
  const [editing, setEditing] = useState(false);
  const [danmakuEvents] = useState(() => new EventTarget());
  const [comments, setComments] = useState<CommentListResponse>({ roots: [], replies: [] });
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [reachNorm, setReachNorm] = useState(0);
  const [viewers, setViewers] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [geometry, setGeometry] = useState<PdfGeometry | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionOriginRef = useRef<{ x: number; y: number } | null>(null);
  const requestRef = useRef<{ value: string; key: string } | null>(null);
  const firstPositionRef = useRef(true);
  const deepLinkRef = useRef(false);
  const fetchRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setStatus("loading");
    setErrorText(null);
    const pdfUrl = versionId
      ? "/api/papers/" + paperId + "/versions/" + versionId + "/pdf"
      : "/api/papers/" + paperId + "/pdf";
    const worker = new pdfjs.PDFWorker();
    const task = pdfjs.getDocument({ url: pdfUrl, worker, withCredentials: true });

    void task.promise.then((loaded) => {
      if (cancelled) return;
      setDoc(loaded);
      setNumPages(loaded.numPages);
      setPageNumber((current) => Math.min(Math.max(1, current), loaded.numPages));
    }).catch(() => {
      if (cancelled) return;
      setStatus("error");
      setErrorText("PDF 加载失败，请重试或回到论文详情查看来源。");
    });

    return () => {
      cancelled = true;
      void task.destroy().catch(() => {}).finally(() => worker.destroy());
    };
  }, [paperId, versionId, retryPdf]);

  const fitWidth = useCallback(async () => {
    if (!doc) return;
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const available = (scrollerRef.current?.clientWidth ?? 900) - 48;
    setScale(Math.min(3, Math.max(0.5, Number((available / base.width).toFixed(2)))));
  }, [doc, pageNumber]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let render: ReturnType<Awaited<ReturnType<typeof doc.getPage>>["render"]> | undefined;
    let textLayer: pdfjs.TextLayer | undefined;

    void (async () => {
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
      canvas.style.width = viewport.width + "px";
      canvas.style.height = viewport.height + "px";
      setPageSize({ width: viewport.width, height: viewport.height });

      layer.replaceChildren();
      layer.style.setProperty("--total-scale-factor", String(viewport.scale * viewport.userUnit));
      render = page.render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      void render.promise.catch(() => {});
      const content = await page.getTextContent();
      if (cancelled) return;
      textLayer = new pdfjs.TextLayer({ textContentSource: content, container: layer, viewport });
      await Promise.all([render.promise, textLayer.render()]);
      if (cancelled) return;

      const origin = pageRef.current?.getBoundingClientRect().top ?? 0;
      const texts = content.items.filter((item) => "str" in item);
      const built = texts.map((item, index) => {
        const span = textLayer?.textDivs[index];
        if (span) span.dataset.i = String(index);
        return { str: item.str, hasEOL: item.hasEOL, top: span ? span.getBoundingClientRect().top - origin : 0 };
      });
      setItems(built);
      setGeometry({ page: pageNumber, screen: viewport, standard: page.getViewport({ scale: 1, rotation: 0 }) });
      setStatus("ready");
    })().catch(() => {
      if (cancelled) return;
      setStatus("error");
      setErrorText("这一页暂时无法渲染。请重试，或前往相邻页面。");
    });

    return () => {
      cancelled = true;
      render?.cancel();
      textLayer?.cancel();
    };
  }, [doc, pageNumber, scale]);

  const flatText = useMemo(() => joinPdfText(items.map((item) => ({ text: item.str, hasEOL: item.hasEOL }))), [items]);
  const itemStarts = useMemo(() => {
    let offset = 0;
    return items.map((item) => {
      const start = offset;
      offset += item.str.length + 1;
      return start;
    });
  }, [items]);
  const normalizedPage = useMemo(() => normalizeForMatch(flatText), [flatText]);
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
    const page = pageRef.current?.getBoundingClientRect();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !layer || !page ||
        !geometry || geometry.page !== pageNumber || !versionId || status !== "ready") return;

    const range = selection.getRangeAt(0);
    if (!layer.contains(range.startContainer) || !layer.contains(range.endContainer)) return;
    const start = locateOffset(range.startContainer, range.startOffset);
    const end = locateOffset(range.endContainer, range.endOffset);
    if (start === null || end === null || end <= start) return;

    const context = buildQuoteContext(flatText, start, end);
    const quote = context.quote.trim();
    if (!quote || codePointCount(quote) > 2000) {
      setNotice("请选择一段较短的原文，每条评论最多引用 2,000 个字符。");
      return;
    }
    const rects = Array.from(range.getClientRects()).slice(0, 120)
      .map((r) => toAnchorRect(geometry, r.left - page.left, r.top - page.top, r.right - page.left, r.bottom - page.top))
      .filter((r) => r !== null);
    const needle = normalizeForMatch(quote);
    const expected = normalizeForMatch(flatText.slice(0, start)).length;
    const offset = [expected, expected + 1].find((at) => normalizedPage.startsWith(needle, at))
      ?? uniqueQuoteOffset(normalizedPage, needle, context.quotePrefix, context.quoteSuffix);
    const charStart = offset === null ? undefined : codePointCount(normalizedPage.slice(0, offset));
    setDraft({
      version: 2, type: "text", paperVersionId: versionId, page: pageNumber, rects, quote,
      prefix: context.quotePrefix, suffix: context.quoteSuffix,
      charStart, charEnd: charStart === undefined ? undefined : charStart + codePointCount(needle),
      textIndexVersion: TEXT_INDEX_VERSION,
    });
    setNotice(null);
  }, [flatText, geometry, locateOffset, normalizedPage, pageNumber, status, versionId]);

  function chooseComposer(mode: "comment" | "danmaku") {
    setComposerMode(mode);
    window.getSelection()?.removeAllRanges();
    composerRef.current?.focus();
  }

  function updateRegion(event: React.PointerEvent<HTMLDivElement>, commit: boolean) {
    const origin = selectionOriginRef.current;
    const view = pageRef.current?.getBoundingClientRect();
    if (!origin || !view || !geometry || !versionId) return;
    const x = Math.max(0, Math.min(view.width, event.clientX - view.left));
    const y = Math.max(0, Math.min(view.height, event.clientY - view.top));
    const rect = { x: Math.min(x, origin.x), y: Math.min(y, origin.y), width: Math.abs(x - origin.x), height: Math.abs(y - origin.y) };
    if (!commit) {
      setRegionDrag(rect);
      return;
    }
    selectionOriginRef.current = null;
    setRegionDrag(null);
    if (rect.width < 6 || rect.height < 6) return;
    const normalized = toAnchorRect(geometry, rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
    if (!normalized) return;
    setDraft({ type: "region", version: 2, paperVersionId: versionId, page: pageNumber, rects: [normalized] });
    setRegionMode(false);
  }

  // ---- comments ---------------------------------------------------------
  const focusCommentId = pendingJump?.id ?? highlightId ?? initialCommentId;
  const loadComments = useCallback(async () => {
    fetchRef.current?.abort();
    const request = new AbortController();
    fetchRef.current = request;
    const params = new URLSearchParams({
      page: String(pageNumber),
      spread: "1",
      kind: kindFilter,
      sort,
    });
    if (versionId) params.set("version", versionId);
    if (focusCommentId) params.set("focus", String(focusCommentId));
    try {
      const response = await fetch(`/api/papers/${paperId}/comments?${params}`, { signal: request.signal });
      if (!response.ok) return;
      const result: CommentListResponse = await response.json();
      if (!request.signal.aborted) setComments(result);
    } catch (error) {
      if (!request.signal.aborted) console.error("无法读取评论", error);
    } finally {
      if (fetchRef.current === request) fetchRef.current = null;
    }
  }, [paperId, versionId, pageNumber, kindFilter, sort, focusCommentId]);

  useEffect(() => {
    void loadComments();
    return () => fetchRef.current?.abort();
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

    const refresh = (event: Event) => {
      const detail: RealtimeEvent = JSON.parse((event as MessageEvent<string>).data);
      danmakuEvents.dispatchEvent(new CustomEvent("comment", { detail }));
      void loadCommentsRef.current();
    };
    source.addEventListener("comment:new", refresh);
    source.addEventListener("comment:update", refresh);
    source.addEventListener("error", () => danmakuEvents.dispatchEvent(new Event("disconnected")));

    // EventSource reconnects on its own; closing on unmount is all that is needed.
    return () => source.close();
  }, [paperId, danmakuEvents]);

  useEffect(() => {
    const stopSelection = () => setSelectingText(false);
    window.addEventListener("pointerup", stopSelection);
    window.addEventListener("pointercancel", stopSelection);
    return () => {
      window.removeEventListener("pointerup", stopSelection);
      window.removeEventListener("pointercancel", stopSelection);
    };
  }, []);

  // ---- reading progress -------------------------------------------------
  useEffect(() => {
    if (!currentUserId || status !== "ready") return;
    const timer = setTimeout(() => {
      void fetch(`/api/papers/${paperId}/progress`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          versionId: versionId ?? undefined,
          page: pageNumber,
          yNorm: reachNorm,
          progress: numPages > 1 ? (pageNumber - 1) / (numPages - 1) : 1,
        }),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [paperId, versionId, pageNumber, numPages, reachNorm, currentUserId, status]);

  // ---- anchoring of existing comments -----------------------------------
  const resolveTop = useCallback(
    (comment: CommentDTO): number => {
      const rectangle = comment.anchor?.type !== "paper" ? comment.anchor?.rects[0] : undefined;
      if (rectangle && geometry?.page === comment.page) return toReaderRect(geometry, rectangle).top;
      const hit = findQuote(pageIndex, comment.quote, comment.quotePrefix, comment.quoteSuffix);
      if (hit) {
        const item = items[hit.partIndex];
        if (item) return item.top;
      }
      return clamp01(comment.yNorm) * (pageSize.height || 0);
    },
    [geometry, items, pageIndex, pageSize.height],
  );

  const placed = useMemo(
    () =>
      comments.roots
        .filter((comment) => comment.page === pageNumber && comment.anchor?.type !== "paper")
        .map((comment) => ({ comment, top: resolveTop(comment) }))
        .sort((a, b) => a.top - b.top),
    [comments.roots, pageNumber, resolveTop],
  );

  const jumpTo = useCallback((comment: CommentDTO) => {
    if (comment.anchor?.type === "paper") {
      setNotice("这条讨论面向整篇论文。");
      return;
    }
    setReturnPosition({ page: pageNumber, scrollTop: scrollerRef.current?.scrollTop ?? 0 });
    setPendingJump(comment);
    setPageNumber(comment.page);
  }, [pageNumber]);

  useEffect(() => {
    if (status !== "ready" || geometry?.page !== pageNumber) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    if (pendingJump?.page === pageNumber) {
      scroller.scrollTo({ top: Math.max(0, resolveTop(pendingJump) - 120), behavior: "smooth" });
      setHighlightId(pendingJump.id);
      setPendingJump(null);
    } else if (restorePosition?.page === pageNumber) {
      scroller.scrollTo({ top: restorePosition.scrollTop });
      setRestorePosition(null);
    } else if (firstPositionRef.current) {
      firstPositionRef.current = false;
      if (initialYNorm) scroller.scrollTo({ top: initialYNorm * pageSize.height });
    }
  }, [geometry, initialYNorm, pageNumber, pageSize.height, pendingJump, resolveTop, restorePosition, status]);

  useEffect(() => {
    if (initialCommentId) return;
    const url = new URL(window.location.href);
    const legacyId = /^#c(\d+)$/.exec(url.hash)?.[1];
    if (!legacyId || url.searchParams.has("comment")) return;
    url.searchParams.set("comment", legacyId);
    router.replace(url.pathname + url.search, { scroll: false });
  }, [initialCommentId, router]);

  useEffect(() => {
    const id = initialCommentId;
    if (!id || deepLinkRef.current || status !== "ready") return;
    const linked = [...comments.roots, ...comments.replies].find((comment) => comment.id === id);
    if (!linked) return;
    deepLinkRef.current = true;
    if (linked.anchor?.type !== "paper") {
      setPageNumber(linked.page);
      setPendingJump(linked);
    }
    setSidebarOpen(true);
    window.requestAnimationFrame(() => document.getElementById("c" + id)?.scrollIntoView({ block: "nearest" }));
  }, [comments, initialCommentId, status]);

  const repliesFor = useCallback(
    (rootId: number) => comments.replies.filter((reply) => reply.parentId === rootId),
    [comments.replies],
  );

  async function submit() {
    if (pending) return;
    const text = content.trim();
    const short = danmakuText.trim() || text;
    if (!text || codePointCount(text) > 2000) {
      setNotice("请输入 1–2,000 个字符的评论。");
      return;
    }
    if (!currentUserId || !canPublish) {
      setNotice(currentUserId ? "验证邮箱后即可发布。" : "登录后即可发布。");
      return;
    }
    if (composerMode === "danmaku" && codePointCount(short) > 80) {
      setNotice("请为弹幕填写不超过 80 个字符的文字。");
      return;
    }
    const body = JSON.stringify({
      content: text, kind, anonymous, anchor: draft ?? { type: "paper", version: 2 },
      danmaku: composerMode === "danmaku" ? { enabled: true, text: short } : { enabled: false },
    });
    if (!requestRef.current || requestRef.current.value !== body) {
      requestRef.current = { value: body, key: crypto.randomUUID() };
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/papers/" + paperId + "/comments", {
        method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": requestRef.current.key },
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(payload.detail ?? "发布失败，草稿已保留。");
        return;
      }
      requestRef.current = null;
      setContent("");
      setDanmakuText("");
      setDraft(null);
      setNotice(composerMode === "danmaku" ? "弹幕已发布" : "评论已发布");
      if (payload.comment) danmakuEvents.dispatchEvent(new CustomEvent<RealtimeEvent>("comment", {
        detail: { type: "comment:new", comment: payload.comment as CommentDTO },
      }));
      window.getSelection()?.removeAllRanges();
      await loadComments();
    } catch {
      setNotice("连接暂时中断，草稿已保留，可以重试。");
    } finally {
      setPending(false);
    }
  }

  const highlighted = highlightId ? [...comments.roots, ...comments.replies].find((comment) => comment.id === highlightId) : null;
  const highlightRects = highlighted && geometry?.page === highlighted.page && highlighted.anchor?.type !== "paper"
    ? (highlighted.anchor?.rects ?? []).map((rect) => toReaderRect(geometry, rect))
    : [];
  const draftLabel = draft?.type === "text" ? "原文选区" : draft?.type === "region" ? "区域" : draft?.type === "page" ? "本页" : "全文讨论";

  return (
    <div className="relative flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--paper-line)] bg-[var(--paper-surface)] px-4 py-2 text-sm">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="hp-btn px-2 py-0.5"
              disabled={pageNumber <= 1}
              aria-label="上一页"
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
              aria-label="下一页"
              onClick={() => setPageNumber((p) => Math.min(numPages || p + 1, p + 1))}
            >
              ›
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button type="button" className="hp-btn px-2 py-0.5" onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))))}>
              −
            </button>
            <select className="hp-input w-auto py-0.5 tabular-nums" aria-label="缩放比例"
              value={Math.round(scale * 100)} onChange={(event) => setScale(Number(event.target.value) / 100)}>
              {[...new Set([80, 100, 130, 160, 200, Math.round(scale * 100)])].sort((a, b) => a - b).map((zoom) => (
                <option key={zoom} value={zoom}>{zoom}%</option>
              ))}
            </select>
            <button type="button" className="hp-btn px-2 py-0.5" onClick={() => setScale((s) => Math.min(3, Number((s + 0.15).toFixed(2))))}>
              +
            </button>
            <button type="button" className="hp-btn px-2 py-0.5" onClick={() => void fitWidth()}>
              适应宽度
            </button>
          </div>

          {versions.length > 1 ? (
            <select aria-label="PDF 版本" className="hp-input w-auto" value={versionId ?? ""} onChange={(event) => {
              const version = event.target.value;
              if ((content || draft) && !window.confirm("切换版本会离开当前草稿的位置。继续切换？")) return;
              router.push("/read/" + paperId + "?version=" + version);
            }}>
              {versions.map((version) => <option key={version.id} value={version.id}>{version.label}</option>)}
            </select>
          ) : <span className="text-xs text-[var(--paper-muted)]">{versionLabel}</span>}
          <button type="button" className="hp-btn" aria-pressed={regionMode} disabled={!geometry || status !== "ready"}
            onClick={() => { setRegionMode(!regionMode); setRegionDrag(null); }}>
            {regionMode ? "退出框选" : "框选区域"}
          </button>
          {returnPosition ? (
            <button type="button" className="hp-btn" onClick={() => {
              setPageNumber(returnPosition.page);
              setRestorePosition(returnPosition);
              setHighlightId(null);
              setReturnPosition(null);
            }}>返回阅读位置</button>
          ) : null}
          <button type="button" className="hp-btn lg:hidden" onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-expanded={sidebarOpen} aria-controls="reader-comments">讨论</button>

          <select aria-label="讨论类型" className="hp-input w-auto py-0.5" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            {KIND_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
          <select
            aria-label="讨论排序"
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

        <DanmakuPlayer paperId={paperId} versionId={versionId} versionLabel={versionLabel} page={pageNumber} ready={!!doc}
          selecting={selectingText || regionMode || draft?.type === "text" || draft?.type === "region"}
          editing={editing} viewerId={currentUserId} events={danmakuEvents} onJump={jumpTo} onChanged={loadComments}>
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
            data-pdf-page={geometry?.page}
            data-pdf-status={status}
            className="relative mx-auto bg-[var(--paper-surface)] shadow"
            style={{ width: pageSize.width || undefined, height: pageSize.height || undefined }}
          >
            <canvas ref={canvasRef} className="block" />
            <div
              ref={textLayerRef}
              className="textLayer hp-text-layer"
              onPointerDown={() => setSelectingText(true)}
              onMouseUp={handleMouseUp}
              onKeyUp={handleMouseUp}
            />
            {regionMode ? (
              <div className="absolute inset-0 z-10 touch-none cursor-crosshair" aria-label="在页面上拖动选择区域"
                onPointerDown={(event) => {
                  const area = event.currentTarget.getBoundingClientRect();
                  selectionOriginRef.current = { x: event.clientX - area.left, y: event.clientY - area.top };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => updateRegion(event, false)}
                onPointerUp={(event) => updateRegion(event, true)}
                onPointerCancel={() => { selectionOriginRef.current = null; setRegionDrag(null); }}>
                {regionDrag ? <div className="pointer-events-none absolute border-2 border-[var(--paper-accent)] bg-[var(--paper-accent)]/15"
                  style={{ left: regionDrag.x, top: regionDrag.y, width: regionDrag.width, height: regionDrag.height }} /> : null}
              </div>
            ) : null}

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
                    entry.comment.viewer.isMine
                      ? "border-[var(--paper-accent)] bg-[var(--paper-accent)] text-[var(--paper-accent-fg)]"
                      : "border-[var(--paper-line)] bg-[var(--paper-surface)] text-[var(--paper-muted)]"
                  }`}
                  style={{ top: `${entry.top}px` }}
                >
                  {entry.comment.likeCount > 0 ? entry.comment.likeCount : "•"}
                </button>
              ))}
            </div>

            {highlightRects.map((rect, index) => (
              <div key={index} data-anchor-highlight className="pointer-events-none absolute z-[1] rounded-[2px] bg-amber-300/45"
                style={rect} />
            ))}
            {highlighted && highlightRects.length === 0 && highlighted.page === pageNumber && highlighted.anchor?.type !== "paper" ? (
              <div className="pointer-events-none absolute inset-x-0 h-5 bg-[var(--paper-accent)]/15"
                style={{ top: resolveTop(highlighted) }} />
            ) : null}

            {status === "error" ? (
              <div role="alert" className="absolute inset-x-0 top-0 z-20 p-6 text-center">
                <div className="hp-card mx-auto max-w-md p-4 text-sm">
                  <p>{errorText ?? "PDF 加载失败"}</p>
                  <button type="button" className="hp-btn mt-2" onClick={() => setRetryPdf((count) => count + 1)}>重新加载 PDF</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        </DanmakuPlayer>

        <form className="shrink-0 border-t border-[var(--paper-line)] bg-[var(--paper-surface)] px-4 py-3"
          onFocus={() => setEditing(true)}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setEditing(false); }}
          onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--paper-muted)]">
            <span className="hp-tag" data-anchor-label>{draftLabel}{draft && draft.type !== "paper" ? " · 第 " + draft.page + " 页" : ""}</span>
            {draft?.type === "text" ? <span className="max-w-64 truncate" title={draft.quote}>“{draft.quote}”</span> : null}
            {draft ? (
              <>
                <button type="button" className="hp-btn text-xs" onClick={() => chooseComposer("danmaku")}>发弹幕</button>
                <button type="button" className="hp-btn text-xs" onClick={() => chooseComposer("comment")}>写评论</button>
                <button type="button" className="text-[var(--paper-muted)] underline" onClick={() => setDraft(null)}>清除位置</button>
              </>
            ) : (
              <button type="button" className="text-[var(--paper-muted)] underline" disabled={!versionId} onClick={() => {
                if (versionId) setDraft({ type: "page", version: 2, paperVersionId: versionId, page: pageNumber, rects: [] });
              }}>对本页评论</button>
            )}
          </div>
          {!canPublish ? (
            <p className="text-sm text-[var(--paper-muted)]">
              {currentUserId
                ? <Link className="underline" href="/settings/account" target="_blank">验证邮箱后发表</Link>
                : <Link className="underline" href={"/login?next=" + encodeURIComponent("/read/" + paperId + "?page=" + pageNumber)} target="_blank">登录后参与讨论</Link>}
            </p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--paper-muted)]">
                <button type="button" className={"hp-btn " + (composerMode === "comment" ? "hp-btn-primary" : "")}
                  aria-pressed={composerMode === "comment"} onClick={() => setComposerMode("comment")}>评论</button>
                <button type="button" className={"hp-btn " + (composerMode === "danmaku" ? "hp-btn-primary" : "")}
                  aria-pressed={composerMode === "danmaku"} onClick={() => setComposerMode("danmaku")}>弹幕</button>
                <select aria-label="评论类型" className="hp-input w-auto" value={kind}
                  onChange={(event) => setKind(event.target.value as (typeof KINDS)[number])}>
                  {KINDS.map((key) => <option key={key} value={key}>{KIND_LABELS[key]}</option>)}
                </select>
                <label className="flex items-center gap-1"><input type="checkbox" checked={anonymous}
                  onChange={(event) => setAnonymous(event.target.checked)} /> 匿名</label>
                <span className="ml-auto tabular-nums">{codePointCount(content)} / 2000</span>
              </div>
              <div className="flex items-end gap-2">
                <textarea ref={composerRef} aria-label="评论正文" className="hp-input min-h-11 flex-1 resize-y" rows={1}
                  value={content} disabled={pending} onChange={(event) => setContent(event.target.value)}
                  placeholder={composerMode === "danmaku" ? "写下想让其他读者看到的弹幕" : "写下问题、解释或想法"}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void submit(); }
                  }} />
                <button type="submit" className="hp-btn hp-btn-primary shrink-0" disabled={pending || !content.trim()}>
                  {pending ? "发布中…" : "发送"}
                </button>
              </div>
              {composerMode === "danmaku" && (codePointCount(content) > 80 || danmakuText) ? (
                <label className="mt-2 block text-xs text-[var(--paper-muted)]">
                  弹幕短文案 · {codePointCount(danmakuText)} / 80
                  <input className="hp-input mt-1" aria-label="弹幕短文案" value={danmakuText} disabled={pending}
                    onChange={(event) => setDanmakuText(event.target.value)} />
                </label>
              ) : null}
            </>
          )}
          {notice ? <p role="status" className="mt-2 text-xs text-[var(--paper-accent)]">{notice}</p> : null}
        </form>
      </div>

      {/* sidebar */}
      <aside id="reader-comments" className={"z-20 w-[min(360px,94vw)] shrink-0 flex-col border-l border-[var(--paper-line)] bg-[var(--paper-bg)] lg:static lg:flex " +
        (sidebarOpen ? "absolute inset-y-0 right-0 flex shadow-xl" : "hidden")}>
        <div className="flex items-center justify-between gap-2 border-b border-[var(--paper-line)] px-4 py-3 text-sm font-medium">
          <span>论文讨论 · {comments.roots.length} 条</span>
          <button type="button" className="hp-btn lg:hidden" onClick={() => setSidebarOpen(false)}>关闭</button>
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
