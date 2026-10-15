import { currentUser } from "@/lib/session";
import { broadcastPresence, subscribe, unsubscribe, viewerCount, type RealtimeEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const KEEP_ALIVE_MS = 25_000;

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: paperId } = await ctx.params;
  const user = await currentUser();
  const subscriberId = crypto.randomUUID();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const send = (event: RealtimeEvent) => {
        write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      subscribe({ id: subscriberId, paperId, userId: user?.id ?? null, send });
      send({ type: "presence", viewers: viewerCount(paperId) });
      broadcastPresence(paperId);

      const keepAlive = setInterval(() => write(": ping\n\n"), KEEP_ALIVE_MS);

      const shutdown = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe(subscriberId);
        broadcastPresence(paperId);
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };

      request.signal.addEventListener("abort", shutdown);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
