/** One long-lived Web instance; the database is the durable event buffer. */
import { eventsAfter, paperRevision } from "./paper-events";
import type { StreamEvent } from "./realtime-types";

type Subscriber = {
  id: string;
  paperId: string;
  userId: string | null;
  // null during catch-up; PostgreSQL buffers concurrent writes durably.
  revision: bigint | null;
  send: (event: StreamEvent) => void;
  close: () => void;
  revoke: () => void;
};
type Registry = { subscribers: Map<string, Subscriber>; timer?: ReturnType<typeof setTimeout>; polling: boolean };
const globalForRealtime = globalThis as unknown as { __hpRealtimeV2?: Registry };
const registry: Registry = globalForRealtime.__hpRealtimeV2 ??= { subscribers: new Map(), polling: false };

function schedule() {
  if (registry.timer || registry.polling || !registry.subscribers.size) return;
  registry.timer = setTimeout(() => { registry.timer = undefined; void poll(); }, 500);
}

async function poll() {
  registry.polling = true;
  try {
    const groups = new Map<string, Subscriber[]>();
    for (const subscriber of registry.subscribers.values()) {
      if (subscriber.revision === null) continue;
      const group = groups.get(subscriber.paperId) ?? [];
      group.push(subscriber);
      groups.set(subscriber.paperId, group);
    }
    for (const [paperId, subscribers] of groups) {
      const head = await paperRevision(paperId);
      if (head === null) { for (const subscriber of subscribers) subscriber.revoke(); continue; }
      const after = subscribers.reduce((min, subscriber) => subscriber.revision! < min ? subscriber.revision! : min, head);
      const batch = await eventsAfter(paperId, after, head);
      for (const subscriber of subscribers) {
        if (!registry.subscribers.has(subscriber.id)) continue;
        if (batch.reset || subscriber.revision! > head) {
          subscriber.send({ type: "stream.reset", paperId, revision: String(head) });
        } else {
          for (const event of batch.events) {
            if (BigInt(event.revision) > subscriber.revision!) subscriber.send(event);
          }
        }
        subscriber.revision = head;
      }
    }
  } catch (error) {
    console.error("[stream] event dispatcher failed", error instanceof Error ? error.message : "unknown error");
  } finally { registry.polling = false; schedule(); }
}

export function subscribe(subscriber: Subscriber) {
  registry.subscribers.set(subscriber.id, subscriber);
  schedule();
}
export function setSubscriberRevision(id: string, revision: bigint) {
  const subscriber = registry.subscribers.get(id);
  if (subscriber) subscriber.revision = revision;
}
export function unsubscribe(id: string) {
  registry.subscribers.delete(id);
  if (!registry.subscribers.size) { clearTimeout(registry.timer); registry.timer = undefined; }
}
export function viewerCount(paperId: string): number {
  const seen = new Set<string>();
  for (const subscriber of registry.subscribers.values()) {
    if (subscriber.paperId === paperId) seen.add(subscriber.userId ?? subscriber.id);
  }
  return seen.size;
}
export function broadcastPresence(paperId: string, exceptId?: string) {
  for (const subscriber of registry.subscribers.values()) {
    if (subscriber.paperId !== paperId || subscriber.id === exceptId) continue;
    try { subscriber.send({ type: "presence", viewers: viewerCount(paperId) }); }
    catch { subscriber.close(); }
  }
}
export function revokePaperAccess(paperId: string, ownerId?: string | null) {
  for (const subscriber of registry.subscribers.values()) {
    if (subscriber.paperId === paperId && (!ownerId || subscriber.userId !== ownerId)) subscriber.revoke();
  }
}
