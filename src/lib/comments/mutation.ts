import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments, papers } from "@/db/schema";
import { canReadPaper } from "@/lib/papers/access";
import { CommentError } from "./queries";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** All comment mutations take the paper lock before the comment lock. */
export async function lockComment(tx: Transaction, paperId: string, commentId: number, viewerId: string,
  moderate = false) {
  const [paper] = await tx.select().from(papers).where(eq(papers.id, paperId)).for("update");
  if (!paper || (!moderate && !canReadPaper(paper, viewerId))) {
    throw new CommentError("NOT_FOUND", 404, "论文不可用");
  }
  const [comment] = await tx.select().from(comments).where(eq(comments.id, commentId)).for("update");
  if (!comment || comment.paperId !== paperId) throw new CommentError("NOT_FOUND", 404, "评论不可用");
  return comment;
}
