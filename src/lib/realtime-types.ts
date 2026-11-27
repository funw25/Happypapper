import type { CommentDTO } from "./comments/types";

/** Client-safe wire types. Durable events never carry viewer-specific DTOs. */
export type PaperEvent = {
  eventId: string;
  paperId: string;
  revision: string;
  type: "comment.created" | "comment.updated" | "comment.removed" | "comment.metrics"
    | "paper.access_changed" | "paper.version_ready";
  commentId: string | null;
  paperVersionId: string | null;
  occurredAt: string;
};

export type StreamEvent = PaperEvent
  | { type: "presence"; viewers: number }
  | { type: "stream.ready" | "stream.reset"; paperId: string; revision: string }
  | { type: "stream.revoked" };

/** The local POST result shares ID-based deduplication with durable events. */
export type ReaderEvent = PaperEvent | { type: "comment:new"; comment: CommentDTO };
