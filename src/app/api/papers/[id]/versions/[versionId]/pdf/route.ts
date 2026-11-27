import { readPaperPdf } from "@/lib/papers/pdf-response";

export async function GET(request: Request, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await ctx.params;
  return readPaperPdf(request, id, versionId);
}

export const HEAD = GET;
