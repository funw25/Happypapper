import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";

const bodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(24),
  password: z.string().min(8).max(72),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_INPUT", detail: "邮箱格式、用户名 2-24 字符、密码至少 8 位" },
      { status: 400 },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();
  const name = parsed.data.name.trim();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, email), eq(users.name, name)))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ error: "ALREADY_EXISTS" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const [created] = await db
    .insert(users)
    .values({ email, name, passwordHash })
    .returning({ id: users.id, name: users.name });

  return NextResponse.json({ user: created }, { status: 201 });
}
