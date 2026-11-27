import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { KIND_FILTERS, type CommentDTO } from "@/lib/comments/types";
import type { DanmakuItem, DanmakuPage } from "@/lib/comments/danmaku-types";
import type { ReaderEvent } from "@/lib/realtime-types";
import { CommentCard } from "./comment-card";

const PAGE_SIZE = 40;
const MAX_PENDING = 200;
const PREFETCH_BELOW = 50;
const HOT_REFRESH_MS = 30_000;

type Active = { item: DanmakuItem; lane: number; top: number };
type Queued = DanmakuItem & { liveAt?: string };
type Queue = {
  url: string;
  pending: Queued[];
  played: Set<string>;
  cursor: string | null | undefined;
  request: AbortController | null;
  error: string | null;
  recovered: boolean;
  refreshLatest: boolean;
  dirtyHot: boolean;
  hotStarted: number;
};

type Props = {
  paperId: string;
  versionId: string | null;
  versionLabel: string;
  page: number;
  ready: boolean;
  selecting: boolean;
  editing: boolean;
  viewerId: string | null;
  events: EventTarget;
  onJump: (comment: CommentDTO) => void;
  onChanged: () => void;
  children: ReactNode;
};

export function DanmakuPlayer({ paperId, versionId, versionLabel, page, ready, selecting, editing,
  viewerId, events, onJump, onChanged, children }: Props) {
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<"latest" | "hot">("latest");
  const [scope, setScope] = useState<"document" | "page">("document");
  const [kind, setKind] = useState("all");
  const [density, setDensity] = useState(6);
  const [font, setFont] = useState(14);
  const [opacity, setOpacity] = useState(90);
  const [manualPause, setManualPause] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [showList, setShowList] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommentDTO | null>(null);
  const [detailStatus, setDetailStatus] = useState<"loading" | "missing">("loading");
  const [refreshDetail, setRefreshDetail] = useState(0);
  const [replay, setReplay] = useState(0);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState<Active[]>([]);
  const [preview, setPreview] = useState<DanmakuItem[]>([]);
  const [feedStatus, setFeedStatus] = useState<"loading" | "ready" | "finished" | "error">("loading");
  const [truncated, setTruncated] = useState(false);

  const overlay = useRef<HTMLDivElement>(null);
  const queue = useRef<Queue | null>(null);
  const playedByFilter = useRef(new Map<string, Set<string>>());
  const removed = useRef(new Set<string>());
  const liveRequests = useRef(new Map<string, AbortController>());
  const activeRef = useRef<Active[]>([]);
  const previousOverlay = useRef("");
  const context = JSON.stringify([paperId, versionId, scope, scope === "page" ? page : null]);
  const params = new URLSearchParams({ scope, sort: mode, kind, limit: String(PAGE_SIZE) });
  if (scope === "page") params.set("page", String(page));
  if (versionId) params.set("version", versionId);
  const feedUrl = `/api/papers/${paperId}/danmaku?${params}`;
  const lineHeight = Math.ceil(font * 1.5) + 4;
  const tracks = Math.max(0, Math.min(density, Math.floor((layout.height - 16 + 8) / (lineHeight + 8))));
  const paused = manualPause || hidden || editing || selecting || showList || selected !== null;

  const replaceActive = useCallback((next: Active[]) => {
    activeRef.current = next;
    setActive(next);
  }, []);

  const finish = useCallback((id: string) => {
    replaceActive(activeRef.current.filter(({ item }) => item.id !== id));
  }, [replaceActive]);

  useEffect(() => {
    const element = overlay.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      setLayout((current) => current.width === width && current.height === height ? current : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useLayoutEffect(() => {
    const overlayKey = JSON.stringify([context, enabled, layout.width, layout.height, font, density, replay]);
    if (previousOverlay.current !== overlayKey) replaceActive([]);
    previousOverlay.current = overlayKey;
  }, [context, enabled, layout.width, layout.height, font, density, replay, replaceActive]);

  useEffect(() => {
    setSelected(null);
    setShowList(false);
  }, [context]);

  useEffect(() => {
    if (!enabled) return;
    let played = playedByFilter.current.get(feedUrl);
    if (!played) {
      played = new Set<string>();
      playedByFilter.current.set(feedUrl, played);
    }
    const current: Queue = { url: feedUrl, pending: [], played, cursor: undefined, request: null,
      error: null, recovered: false, refreshLatest: false, dirtyHot: false, hotStarted: Date.now() };
    queue.current = current;
    setPreview([]);
    setTruncated(false);
    setFeedStatus("loading");
    return () => {
      queue.current?.request?.abort();
      queue.current = null;
    };
  }, [feedUrl, enabled, replay]);

  const updatePreview = (current: Queue) => setPreview(current.pending.slice(0, 8));

  function enqueue(current: Queue, items: Queued[]) {
    const known = new Set([...current.pending.map((item) => item.id), ...activeRef.current.map(({ item }) => item.id)]);
    const fresh = items.filter((item) => {
      if (known.has(item.id) || current.played.has(item.id) || removed.current.has(item.id)) return false;
      known.add(item.id);
      return true;
    });
    if (fresh.some((item) => item.liveAt)) {
      current.pending.unshift(...fresh);
      current.pending.sort((a, b) => {
        const time = (b.liveAt ?? "").localeCompare(a.liveAt ?? "");
        return time || (a.liveAt && b.liveAt ? (BigInt(a.id) > BigInt(b.id) ? -1 : 1) : 0);
      });
    } else current.pending.push(...fresh);
    updatePreview(current);
  }

  async function fetchPage(current: Queue) {
    const request = new AbortController();
    current.request = request;
    const cursor = current.cursor;
    const url = cursor ? `${current.url}&cursor=${encodeURIComponent(cursor)}` : current.url;
    try {
      const response = await fetch(url, { signal: request.signal });
      if (request.signal.aborted) return;
      if (response.status === 410 && cursor && !current.recovered) {
        current.recovered = true;
        current.cursor = undefined;
        current.pending = [];
        updatePreview(current);
        return;
      }
      if (response.status === 404) {
        current.pending = [];
        current.cursor = null;
        updatePreview(current);
        replaceActive([]);
        setSelected(null);
        throw new Error("论文或版本已不可用");
      }
      if (!response.ok) throw new Error("弹幕暂时无法加载");
      const result: DanmakuPage = await response.json();
      if (request.signal.aborted) return;
      // Live arrivals can fill the buffer while a page is in flight. Keep
      // its original cursor and retry after the buffer has room.
      if (current.pending.length + result.items.length > MAX_PENDING) return;
      enqueue(current, result.items);
      current.cursor = result.nextCursor;
      current.recovered = false;
      setTruncated(result.truncated);
      setFeedStatus("ready");
    } catch (error) {
      if (request.signal.aborted) return;
      current.error = error instanceof Error ? error.message : "弹幕暂时无法加载";
      setFeedStatus("error");
    } finally {
      current.request = null;
    }
  }

  const tick = useEffectEvent(() => {
    const current = queue.current;
    if (!current || current.url !== feedUrl || current.error) return;
    const rerank = mode === "hot" && current.dirtyHot && Date.now() - current.hotStarted >= HOT_REFRESH_MS;
    if (rerank) {
      if (activeRef.current.length || current.request) return;
      current.dirtyHot = false;
      current.hotStarted = Date.now();
      current.cursor = undefined;
      current.pending = [];
      updatePreview(current);
    }
    if (current.cursor === null && current.refreshLatest && current.pending.length < PREFETCH_BELOW) {
      current.refreshLatest = false;
      current.cursor = undefined;
    }
    if (current.cursor !== null && current.pending.length < PREFETCH_BELOW && !current.request) void fetchPage(current);
    if (current.cursor === null && !current.pending.length && !activeRef.current.length) setFeedStatus("finished");
    if (!ready || paused || !layout.width || !tracks || !current.pending.length) return;

    const next = [...activeRef.current];
    const used = new Set(next.map(({ lane }) => lane));
    for (let lane = 0; lane < tracks && current.pending.length; lane++) {
      if (used.has(lane)) continue;
      const item = current.pending.shift();
      if (!item || next.some((playing) => playing.item.id === item.id) || current.played.has(item.id)) continue;
      current.played.add(item.id);
      const space = layout.height - lineHeight - 16;
      next.push({ item, lane, top: 8 + (tracks === 1 ? space / 2 : lane * space / (tracks - 1)) });
    }
    if (next.length > activeRef.current.length) {
      replaceActive(next);
      updatePreview(current);
    }
  });

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => tick(), 120);
    return () => clearInterval(timer);
  }, [enabled]);

  const acceptComment = useEffectEvent((comment: CommentDTO) => {
    const current = queue.current;
    if (!current || current.url !== feedUrl) return;
    if (comment.parentId !== null) {
      if (mode === "hot") current.dirtyHot = true;
      return;
    }
    const text = comment.danmakuText?.trim();
    const wholePaper = comment.anchor?.type === "paper";
    if (!text || !comment.visibleInDanmaku || (kind !== "all" && comment.kind !== kind) ||
        (!wholePaper && comment.paperVersionId !== versionId) || (scope === "page" && (wholePaper || page !== comment.page))) return;
    if (mode === "hot" && !comment.viewer.isMine) {
      current.dirtyHot = true;
      return;
    }
    if (current.pending.length >= MAX_PENDING) {
      if (mode === "latest") current.refreshLatest = true;
      else current.dirtyHot = true;
      return;
    }
    enqueue(current, [{ id: String(comment.id), text, page: wholePaper ? null : comment.page, liveAt: comment.createdAt }]);
    setFeedStatus("ready");
  });

  const receive = useEffectEvent((message: ReaderEvent) => {
    if (message.type === "comment:new") { acceptComment(message.comment); return; }
    const current = queue.current;
    if (!current || current.url !== feedUrl || !message.commentId) return;
    const id = message.commentId;
    if (mode === "hot") current.dirtyHot = true;
    if (message.type === "comment.removed") {
      liveRequests.current.get(id)?.abort();
      liveRequests.current.delete(id);
      removed.current.add(id);
      current.pending = current.pending.filter((item) => item.id !== id);
      finish(id);
      if (id === selected) { setSelected(null); setDetail(null); }
      updatePreview(current);
      return;
    }
    if (id === selected) setRefreshDetail((value) => value + 1);
    if (message.type === "comment.metrics") return;
    removed.current.delete(id);
    liveRequests.current.get(id)?.abort();
    const request = new AbortController();
    liveRequests.current.set(id, request);
    void fetch(`/api/comments/${id}`, { signal: request.signal }).then(async (response) => {
      const comment: CommentDTO | null = response.ok ? (await response.json()).comment : null;
      if (!comment || request.signal.aborted || queue.current !== current) return;
      if (message.type === "comment.updated") {
        current.pending = current.pending.filter((item) => item.id !== id);
        finish(id);
        updatePreview(current);
      }
      acceptComment(comment);
    }).catch(() => {}).finally(() => {
      if (liveRequests.current.get(id) === request) liveRequests.current.delete(id);
    });
  });

  useEffect(() => () => {
    for (const request of liveRequests.current.values()) request.abort();
    liveRequests.current.clear();
  }, []);

  const reconnect = useEffectEvent(() => {
    const current = queue.current;
    if (!current) return;
    current.request?.abort();
    // Replace the entire query generation so an earlier response cannot
    // mutate the recovered cursor. Keep the played set for this scope.
    queue.current = { ...current, pending: [], cursor: undefined, request: null,
      error: null, recovered: false, refreshLatest: false, dirtyHot: false, hotStarted: Date.now() };
    replaceActive([]);
    setPreview([]);
    setSelected(null);
    setFeedStatus("loading");
  });

  useEffect(() => {
    const listener = (event: Event) => receive((event as CustomEvent<ReaderEvent>).detail);
    const connected = () => reconnect();
    let accessCheck: AbortController | null = null;
    const recheckAccess = () => {
      if (accessCheck) return;
      const request = new AbortController();
      accessCheck = request;
      void fetch(`/api/papers/${paperId}`, { signal: request.signal }).then((response) => {
        if (response.status !== 404 || request.signal.aborted) return;
        const current = queue.current;
        current?.request?.abort();
        if (current) {
          current.pending = [];
          current.cursor = null;
          current.error = "论文已不可用";
        }
        replaceActive([]);
        setPreview([]);
        setSelected(null);
        setFeedStatus("error");
      }).catch(() => {}).finally(() => { accessCheck = null; });
    };
    events.addEventListener("comment", listener);
    events.addEventListener("disconnected", recheckAccess);
    events.addEventListener("connected", connected);
    return () => {
      events.removeEventListener("comment", listener);
      events.removeEventListener("disconnected", recheckAccess);
      events.removeEventListener("connected", connected);
      accessCheck?.abort();
    };
  }, [events, paperId, replaceActive]);

  useEffect(() => {
    if (!selected) return;
    const request = new AbortController();
    setDetailStatus("loading");
    void fetch(`/api/comments/${selected}`, { signal: request.signal }).then(async (response) => {
      const result = response.ok ? (await response.json()).comment as CommentDTO : null;
      if (request.signal.aborted) return;
      setDetail(result);
      if (!result) setDetailStatus("missing");
    }).catch(() => {
      if (!request.signal.aborted) { setDetail(null); setDetailStatus("missing"); }
    });
    return () => request.abort();
  }, [selected, refreshDetail]);

  function openDetail(id: string) {
    setDetail(null);
    setShowList(false);
    setSelected(id);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--paper-line)] px-4 py-2 text-xs">
        <label className="flex items-center gap-1"><input type="checkbox" checked={enabled}
          onChange={(event) => { setEnabled(event.target.checked); setSelected(null); setShowList(false); }} /> 弹幕</label>
        {enabled ? <>
          <select aria-label="弹幕范围" className="hp-input w-auto" value={scope}
            onChange={(event) => setScope(event.target.value === "page" ? "page" : "document")}>
            <option value="document">全文</option><option value="page">当前页</option>
          </select>
          <select aria-label="弹幕排序" className="hp-input w-auto" value={mode}
            onChange={(event) => setMode(event.target.value === "hot" ? "hot" : "latest")}>
            <option value="latest">最新</option><option value="hot">热门</option>
          </select>
          <select aria-label="弹幕类型" className="hp-input w-auto" value={kind} onChange={(event) => setKind(event.target.value)}>
            {KIND_FILTERS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            <option value="other">其他</option>
          </select>
          <button className="hp-btn" type="button" onClick={() => setManualPause(!manualPause)}>{manualPause ? "播放弹幕" : "暂停弹幕"}</button>
          <button className="hp-btn" type="button" onClick={() => { playedByFilter.current.delete(feedUrl); setReplay(replay + 1); }}>重播本范围</button>
          <button className="hp-btn" type="button" aria-expanded={showList} onClick={() => { setSelected(null); setShowList(!showList); }}>弹幕列表</button>
          <label className="flex items-center gap-1">密度 <input type="range" min="0" max="20" value={density}
            onChange={(event) => setDensity(Number(event.target.value))} /> {density}</label>
          <label className="flex items-center gap-1">字号 <input type="range" min="12" max="22" value={font}
            onChange={(event) => setFont(Number(event.target.value))} /></label>
          <label className="flex items-center gap-1">不透明度 <input type="range" min="30" max="100" value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))} /></label>
          {feedStatus === "error" ? <button type="button" className="hp-btn" onClick={() => {
            const current = queue.current;
            if (!current) return;
            current.error = null;
            if (current.cursor === null) current.cursor = undefined;
            setFeedStatus("loading");
          }}>重试加载弹幕</button> : null}
          {truncated ? <span>热门范围包含前 10,000 条</span> : null}
        </> : null}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {children}
        <div ref={overlay} data-danmaku-overlay className="pointer-events-none absolute inset-0 z-[11] overflow-hidden"
          style={{ opacity: selecting ? opacity / 300 : opacity / 100 }}>
          {active.map((entry) => <FlyingItem key={entry.item.id} entry={entry} width={layout.width} font={font}
            lineHeight={lineHeight} paused={paused} selecting={selecting} finish={finish} onOpen={openDetail} />)}
        </div>
        {showList || selected ? <section aria-label={selected ? "弹幕详情" : "弹幕列表"}
          className="hp-card absolute top-3 right-3 z-[15] max-h-[90%] w-[min(92%,360px)] overflow-auto p-3 text-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs text-[var(--paper-muted)]">{versionLabel}</span>
            <button type="button" className="hp-btn" autoFocus onClick={() => { setSelected(null); setShowList(false); }}>关闭</button>
          </div>
          {selected ? (detail?.id.toString() === selected ? <CommentCard comment={detail} paperId={paperId} currentUserId={viewerId} inOverlay
            onChanged={() => { setRefreshDetail((value) => value + 1); onChanged(); }} onJump={(comment) => { onJump(comment); setSelected(null); }} /> :
            <p role="status">{detailStatus === "missing" ? "这条讨论已不可用" : "正在加载讨论"}</p>) : (
            preview.length ? <ul className="space-y-2">{preview.map((item) => <li key={item.id}>
              <button type="button" className="w-full text-left hover:underline" onClick={() => openDetail(item.id)}>{label(item)} · {item.text}</button>
            </li>)}</ul> : <p role="status">{feedStatus === "finished" ? "本轮弹幕已播完，正在等待新讨论。" : "暂无待播弹幕。"}</p>
          )}
        </section> : null}
      </div>
    </>
  );
}

function label(item: DanmakuItem) { return item.page === null ? "全文" : `P${item.page}`; }

function FlyingItem({ entry, width, font, lineHeight, paused, selecting, finish, onOpen }: {
  entry: Active; width: number; font: number; lineHeight: number; paused: boolean; selecting: boolean;
  finish: (id: string) => void; onOpen: (id: string) => void;
}) {
  const element = useRef<HTMLButtonElement>(null);
  const animation = useRef<Animation | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  useLayoutEffect(() => {
    if (!element.current) return;
    const textWidth = element.current.offsetWidth;
    const motion = element.current.animate([
      { transform: `translateX(${width}px)` }, { transform: `translateX(${-textWidth}px)` },
    ], { duration: (width + textWidth) / 130 * 1000, easing: "linear", fill: "both" });
    motion.pause();
    motion.onfinish = () => finish(entry.item.id);
    animation.current = motion;
    return () => { motion.cancel(); animation.current = null; };
  }, [entry.item.id, width, font, finish]);

  useLayoutEffect(() => {
    if (paused || hovered || focused) animation.current?.pause();
    else animation.current?.play();
  }, [paused, hovered, focused, width, font]);

  return <button ref={element} type="button" className={`hp-danmaku ${selecting ? "pointer-events-none" : "pointer-events-auto"}`}
    tabIndex={selecting ? -1 : 0} data-danmaku-id={entry.item.id}
    data-danmaku-lane={entry.lane} aria-label={`${label(entry.item)} · ${entry.item.text}`}
    style={{ top: entry.top, fontSize: font, lineHeight: `${lineHeight - 4}px` }}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onClick={() => onOpen(entry.item.id)}>
    <span aria-hidden="true" className="mr-2 text-[var(--paper-muted)]">{label(entry.item)}</span>{entry.item.text}
  </button>;
}
