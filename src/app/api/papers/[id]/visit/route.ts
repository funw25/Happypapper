import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { papers, paperVisits } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { canReadPaper, getReadablePaper } from "@/lib/papers/access";
import { errorFromUnknown, jsonError, PRIVATE_RESPONSE_HEADERS } from "@/lib/api";

const COOKIE = "hp-visitor";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const origin = request.headers.get("origin");
    // Next's internal request URL can use localhost behind the public host.
    const publicOrigin = new URL(process.env.APP_URL ?? process.env.AUTH_URL ?? request.url).origin;
    if (!origin || origin !== publicOrigin) return jsonError("FORBIDDEN", 403);
    const { id } = await ctx.params;
    const user = await currentUser();
    if (!await getReadablePaper(id, user?.id)) return jsonError("NOT_FOUND", 404);
    const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
    if (!secret) return jsonError("NOT_CONFIGURED", 503);
    const sign = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
    const jar = await cookies();
    const token = jar.get(COOKIE)?.value ?? "";
    const [value, signature] = token.split(".");
    const valid = /^[0-9a-f-]{36}$/.test(value ?? "") && /^[a-f0-9]{64}$/.test(signature ?? "") &&
      timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(sign(value), "hex"));
    const visitor = valid ? value : crypto.randomUUID();
    const visitDay = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    const visitorKey = sign("visit:" + visitDay + ":" + (user ? "user:" + user.id : "visitor:" + visitor));
    const counted = await db.transaction(async (tx) => {
      const [paper] = await tx.select().from(papers).where(eq(papers.id, id)).for("update");
      if (!canReadPaper(paper, user?.id)) return null;
      return tx.insert(paperVisits).values({ paperId: id, visitDay, visitorKey })
        .onConflictDoNothing().returning({ paperId: paperVisits.paperId });
    });
    if (counted === null) return jsonError("NOT_FOUND", 404);
    if (!valid) jar.set(COOKIE, visitor + "." + sign(visitor), {
      httpOnly: true, sameSite: "lax", secure: publicOrigin.startsWith("https:"),
      path: "/", maxAge: 365 * 24 * 3600,
    });
    return Response.json({ counted: counted.length > 0 }, { headers: PRIVATE_RESPONSE_HEADERS });
  } catch (error) { return errorFromUnknown(error); }
}
