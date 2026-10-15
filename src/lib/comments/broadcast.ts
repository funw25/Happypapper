import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { broadcast } from "@/lib/realtime";

/** Push the current counters so other readers stay in sync without a refetch. */
export async function broadcastCommentCounts(paperId: string, commentId: number) {
  const [row] = await db
    .select({
      likeCount: comments.likeCount,
      replyCount: comments.replyCount,
      status: comments.status,
    })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);

  if (!row) return;

  broadcast(paperId, {
    type: "comment:update",
    id: commentId,
    likeCount: row.likeCount,
    replyCount: row.replyCount,
    status: row.status,
  });
}
