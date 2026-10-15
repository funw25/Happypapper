/**
 * Shape of a comment as it crosses the wire. Kept free of server imports so
 * client components can use it without pulling Drizzle into the bundle.
 */
export type CommentDTO = {
  id: number;
  parentId: number | null;
  content: string;
  kind: string;
  page: number;
  yNorm: number;
  xNorm: number | null;
  quote: string | null;
  quotePrefix: string | null;
  quoteSuffix: string | null;
  charStart: number | null;
  charEnd: number | null;
  blockId: string | null;
  anchorDegraded: boolean;
  displayMode: string;
  likeCount: number;
  replyCount: number;
  createdAt: string;
  userId: string | null;
  authorName: string | null;
  likedByMe: boolean;
  /** Published under an anonymous identity (PRIVACY-001). The server already
   *  withholds the real name, so `authorName` is null for these rows. */
  isAnonymous: boolean;
  /** Author's choice at publish time: whether this comment floats in danmaku. */
  visibleInDanmaku: boolean;
};

export const ANONYMOUS_LABEL = "匿名用户";

export type CommentListResponse = {
  roots: CommentDTO[];
  replies: CommentDTO[];
};

export const KIND_LABELS: Record<string, string> = {
  question: "疑问",
  explain: "解释",
  method: "方法",
  result: "结果",
  other: "其他",
};

export const KIND_FILTERS = [
  { value: "all", label: "全部" },
  { value: "question", label: "疑问" },
  { value: "explain", label: "解释" },
  { value: "method", label: "方法" },
  { value: "result", label: "结果" },
] as const;
