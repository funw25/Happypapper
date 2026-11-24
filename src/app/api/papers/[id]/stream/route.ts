import { jsonError } from "@/lib/api";
import { getReadablePaper } from "@/lib/papers/access";
import { currentUser } from "@/lib/session";
import { broadcastPresence, subscribe, unsubscribe, viewerCount, type RealtimeEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const KEEP_ALIVE_MS = 25_000;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: paperId } = await ctx.params;
  const viewerId = (await currentUser())?.id ?? null;
  if (!await getReadablePaper(paperId, viewerId)) return jsonError("NOT_FOUND", 404);

  const subscriberId = crypto.randomUUID();
  const encoder = new TextEncoder();
  let shutdown = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let pending = Promise.resolve();
      let keepAlive: ReturnType<typeof setInterval> | undefined;

      shutdown = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        request.signal.removeEventListener("abort", shutdown);
        unsubscribe(subscriberId);
        broadcastPresence(paperId);
        try {
          controller.close();
        } catch {
          // A client may already have cancelled the body.
        }
      };

      const writeIfAllowed = (chunk: string) => {
        pending = pending.then(async () => {
          if (closed) return;
          if (!await getReadablePaper(paperId, viewerId)) {
            shutdown();
            return;
          }
          if (!closed) controller.enqueue(encoder.encode(chunk));
        }).catch(shutdown);
      };

      const send = (event: RealtimeEvent) => {
        writeIfAllowed("event: " + event.type + "\n" + "data: " + JSON.stringify(event) + "\n\n");
      };

      if (request.signal.aborted) {
        shutdown();
        return;
      }
      request.signal.addEventListener("abort", shutdown, { once: true });
      subscribe({ id: subscriberId, paperId, userId: viewerId, send, close: shutdown });
      send({ type: "presence", viewers: viewerCount(paperId) });
      broadcastPresence(paperId, subscriberId);
      keepAlive = setInterval(() => writeIfAllowed(": ping\n\n"), KEEP_ALIVE_MS);
    },
    cancel() {
      shutdown();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "private, no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
