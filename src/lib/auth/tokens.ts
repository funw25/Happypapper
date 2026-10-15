import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accountTokens } from "@/db/schema";

/**
 * 一次性令牌（docs/03-requirements.md AUTH-006、AUTH-007）。
 *
 * 数据库里只放 SHA-256 摘要：即使数据目录被读走，也拿不到可用的链接。每个令牌
 * 只能用一次，并且有过期时间；同一用途的新令牌签发时，该用户旧的未用令牌立即
 * 作废，避免「点了重发，旧链接还能用」。
 */
export const TOKEN_PURPOSES = ["email_verify", "email_change", "password_reset"] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

export function isTokenPurpose(value: unknown): value is TokenPurpose {
  return typeof value === "string" && (TOKEN_PURPOSES as readonly string[]).includes(value);
}

/** 密码重置窗口短，邮箱确认窗口长：前者被盗用即等于账号被盗。 */
const TTL_MS: Record<TokenPurpose, number> = {
  password_reset: 60 * 60 * 1000,
  email_verify: 24 * 60 * 60 * 1000,
  email_change: 24 * 60 * 60 * 1000,
};

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function issueToken(userId: string, purpose: TokenPurpose): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const now = new Date();

  await db
    .update(accountTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(accountTokens.userId, userId),
        eq(accountTokens.purpose, purpose),
        isNull(accountTokens.usedAt),
      ),
    );

  await db.insert(accountTokens).values({
    userId,
    purpose,
    tokenHash: hashToken(raw),
    expiresAt: new Date(now.getTime() + TTL_MS[purpose]),
  });

  return raw;
}

export type ConsumedToken = { userId: string };

/**
 * 校验并立即作废一个令牌。返回 null 表示令牌不存在、用途不符、已用过或已过期，
 * 调用方不需要区分这些情况——区分只会告诉攻击者哪一步猜对了。
 */
export async function consumeToken(
  raw: string,
  purpose: TokenPurpose,
): Promise<ConsumedToken | null> {
  const token = raw.trim();
  if (!token) return null;

  const [row] = await db
    .select({ id: accountTokens.id, userId: accountTokens.userId })
    .from(accountTokens)
    .where(
      and(
        eq(accountTokens.tokenHash, hashToken(token)),
        eq(accountTokens.purpose, purpose),
        isNull(accountTokens.usedAt),
        gt(accountTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return null;

  await db.update(accountTokens).set({ usedAt: new Date() }).where(eq(accountTokens.id, row.id));
  return { userId: row.userId };
}

/** 找回密码成功后，同一用户的其它重置令牌一并作废。 */
export async function invalidateTokens(userId: string, purpose: TokenPurpose): Promise<void> {
  await db
    .update(accountTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(accountTokens.userId, userId),
        eq(accountTokens.purpose, purpose),
        isNull(accountTokens.usedAt),
      ),
    );
}
