/**
 * In-process fan-out for the reader's live channel.
 *
 * One dev/demo server holds all connections, so a module-level registry is
 * enough. Running more than one instance would need a shared bus; the reader
 * degrades to polling-free static comments in that case, because a client only
 * ever sees events from the instance it connected to.
 */
export type RealtimeEvent =
  | { type: "comment:new"; comment: unknown }
  | { type: "comment:update"; id: number; likeCount: number; replyCount: number; status: string }
  | { type: "presence"; viewers: number };

type Subscriber = {
  id: string;
  paperId: string;
  userId: string | null;
  send: (event: RealtimeEvent) => void;
};

type Registry = {
  subscribers: Map<string, Subscriber>;
};

const globalForRealtime = globalThis as unknown as { __hpRealtime?: Registry };

const registry: Registry =
  globalForRealtime.__hpRealtime ?? (globalForRealtime.__hpRealtime = { subscribers: new Map() });

export function subscribe(subscriber: Subscriber) {
  registry.subscribers.set(subscriber.id, subscriber);
}

export function unsubscribe(id: string) {
  registry.subscribers.delete(id);
}

export function viewerCount(paperId: string): number {
  const seen = new Set<string>();
  for (const subscriber of registry.subscribers.values()) {
    if (subscriber.paperId !== paperId) continue;
    seen.add(subscriber.userId ?? subscriber.id);
  }
  return seen.size;
}

export function broadcast(paperId: string, event: RealtimeEvent) {
  for (const subscriber of registry.subscribers.values()) {
    if (subscriber.paperId !== paperId) continue;
    try {
      subscriber.send(event);
    } catch {
      registry.subscribers.delete(subscriber.id);
    }
  }
}

export function broadcastPresence(paperId: string) {
  broadcast(paperId, { type: "presence", viewers: viewerCount(paperId) });
}
