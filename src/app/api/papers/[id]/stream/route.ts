import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { jsonError } from "@/lib/api";
import { getReadablePaper } from "@/lib/papers/access";
import { currentUser } from "@/lib/session";
import { eventsAfter, paperRevision, parseRevision } from "@/lib/paper-events";
import { broadcastPresence, setSubscriberRevision, subscribe, unsubscribe, viewerCount } from "@/lib/realtime";
import type { StreamEvent } from "@/lib/realtime-types";

export const dynamic = "force-dynamic";
const KEEP_ALIVE_MS = 25_000;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: paperId } = await ctx.params;
  const viewerId = (await currentUser())?.id ?? null;
  if (!await getReadablePaper(paperId, viewerId)) return jsonError("NOT_FOUND", 404);
  const session = viewerId ? await auth() : null;
  const expiresAt = session?.expires ? Date.parse(session.expires) : Infinity;
  const cursor = request.headers.get("last-event-id") || new URL(request.url).searchParams.get("after");
  const after = cursor === null ? null : parseRevision(cursor, paperId);
  if (cursor !== null && after === null) return jsonError("INVALID_CURSOR", 400);

  const subscriberId = crypto.randomUUID();
  const encoder = new TextEncoder();
  let shutdown = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let queued = 0;
      let pending = Promise.resolve();
      let keepAlive: ReturnType<typeof setInterval> | undefined;
      shutdown = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        request.signal.removeEventListener("abort", shutdown);
        unsubscribe(subscriberId);
        broadcastPresence(paperId);
        try { controller.close(); } catch { /* Already cancelled. */ }
      };
      const revoke = () => {
        if (closed) return;
        try { controller.enqueue(encoder.encode('event: stream.revoked\ndata: {"type":"stream.revoked"}\n\n')); }
        finally { shutdown(); }
      };
      const writeIfAllowed = (chunk: string) => {
        if (closed) return;
        if (++queued > 1100) { shutdown(); return; }
        pending = pending.then(async () => {
          if (closed) return;
          const exists = viewerId ? await db.select({ id: users.id }).from(users).where(eq(users.id, viewerId)).limit(1) : [true];
          if (Date.now() >= expiresAt || !exists.length || !await getReadablePaper(paperId, viewerId)) {
            revoke(); return;
          }
          if (!closed) {
            if ((controller.desiredSize ?? 0) < -1024) { shutdown(); return; }
            controller.enqueue(encoder.encode(chunk));
          }
        }).catch(shutdown).finally(() => { queued--; });
      };
      const send = (event: StreamEvent) => {
        const revision = "revision" in event ? event.revision : null;
        writeIfAllowed((revision === null ? "" : `id: ${paperId}:${revision}\n`) +
          "event: " + event.type + "\ndata: " + JSON.stringify(event) + "\n\n");
      };
      if (request.signal.aborted) { shutdown(); return; }
      request.signal.addEventListener("abort", shutdown, { once: true });
      // Register before the watermark read. A null cursor prevents the poller
      // overtaking replay; subsequent commits stay buffered in paper_events.
      subscribe({ id: subscriberId, paperId, userId: viewerId, revision: null, send, close: shutdown, revoke });
      void (async () => {
        const head = await paperRevision(paperId);
        if (closed) return;
        if (head === null) { revoke(); return; }
        if (after !== null) {
          const batch = await eventsAfter(paperId, after, head);
          if (closed) return;
          if (batch.reset) send({ type: "stream.reset", paperId, revision: String(head) });
          else for (const event of batch.events) send(event);
        }
        send({ type: "stream.ready", paperId, revision: String(head) });
        setSubscriberRevision(subscriberId, head);
        send({ type: "presence", viewers: viewerCount(paperId) });
        broadcastPresence(paperId, subscriberId);
        keepAlive = setInterval(() => writeIfAllowed(": ping\n\n"), KEEP_ALIVE_MS);
      })().catch(shutdown);
    },
    cancel() { shutdown(); },
  });
  return new Response(stream, { headers: {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "private, no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no",
  } });
}
