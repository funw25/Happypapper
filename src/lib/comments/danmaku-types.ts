export type DanmakuItem = { id: string; text: string; page: number | null };

export type DanmakuPage = {
  items: DanmakuItem[];
  nextCursor: string | null;
  truncated: boolean;
};
