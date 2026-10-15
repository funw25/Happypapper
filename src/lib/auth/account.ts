import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import {
  passwordResetLink,
  sendMail,
  verificationLink,
} from "@/lib/mailer";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { consumeToken, invalidateTokens, issueToken } from "@/lib/auth/tokens";

/**
 * 账号闭环的服务层（docs/03-requirements.md AUTH-006、AUTH-007、AUTH-011 至
 * AUTH-013）。所有写操作都以用户 id 为入口，接口层不从请求体取目标用户。
 */
export class AccountError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type LoginMethods = {
  hasPassword: boolean;
  githubLogin: string | null;
  /** 可用于登录的方式数量；为 0 时账号无法再登录，任何解绑都必须被拒绝。 */
  count: number;
};

export async function githubLoginFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ providerAccountId: accounts.providerAccountId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "github")))
    .limit(1);
  return row?.providerAccountId ?? null;
}

export async function loginMethods(userId: string): Promise<LoginMethods> {
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const githubLogin = await githubLoginFor(userId);
  const hasPassword = Boolean(row?.passwordHash);
  return {
    hasPassword,
    githubLogin,
    count: (hasPassword ? 1 : 0) + (githubLogin ? 1 : 0),
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normaliseEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new AccountError("INVALID_EMAIL", 400, "邮箱格式不正确");
  }
  return email;
}

async function emailTakenByOther(email: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), ne(users.id, userId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * 发起密码找回。无论邮箱是否存在都返回成功：接口的响应差异会被用来枚举站点用户。
 * 邮箱存在时才签发令牌并发送链接。
 */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) return;

  const [user] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) return;

  const token = await issueToken(user.id, "password_reset");
  await sendMail({
    to: email,
    subject: "HappyPaper 密码重置",
    text: `你在 HappyPaper 申请了重置密码，链接一小时内有效。如果不是你本人操作，忽略这封邮件即可。`,
    link: passwordResetLink(token),
  });
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const problem = passwordProblem(newPassword);
  if (problem) throw new AccountError("INVALID_PASSWORD", 400, problem);

  const consumed = await consumeToken(rawToken, "password_reset");
  if (!consumed) {
    throw new AccountError("INVALID_TOKEN", 400, "链接无效或已过期，请重新申请");
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, consumed.userId));
  await invalidateTokens(consumed.userId, "password_reset");
}

/** 发送邮箱验证链接；已验证过的地址不重复发送，除非调用方明确要求。 */
export async function sendEmailVerification(userId: string, force = false): Promise<boolean> {
  const [user] = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new AccountError("NOT_FOUND", 404, "账号不存在");
  if (user.emailVerified && !force) return false;

  const token = await issueToken(userId, "email_verify");
  await sendMail({
    to: user.email,
    subject: "验证你的 HappyPaper 邮箱",
    text: "点开链接即可完成邮箱验证，链接 24 小时内有效。",
    link: verificationLink(token),
  });
  return true;
}

/**
 * 修改邮箱（AUTH-007、PROFILE-008）：新地址先进入 pending_email，验证链接发到新
 * 地址；在链接被打开之前，旧地址仍然是登录与找回密码的依据。
 */
export async function requestEmailChange(userId: string, rawEmail: string): Promise<string> {
  const email = normaliseEmail(rawEmail);
  if (await emailTakenByOther(email, userId)) {
    throw new AccountError("EMAIL_TAKEN", 409, "这个邮箱已经绑定了其他账号");
  }

  await db.update(users).set({ pendingEmail: email }).where(eq(users.id, userId));
  const token = await issueToken(userId, "email_change");
  await sendMail({
    to: email,
    subject: "确认你的新 HappyPaper 邮箱",
    text: "点开链接即可把这个地址设为账号邮箱，链接 24 小时内有效。",
    link: verificationLink(token),
  });
  return email;
}

export type ConfirmedEmail = { kind: "verified" | "changed"; email: string };

/** 确认邮箱验证或邮箱修改令牌。两种用途共用一个页面。 */
export async function confirmEmailToken(rawToken: string): Promise<ConfirmedEmail> {
  const verified = await consumeToken(rawToken, "email_verify");
  if (verified) {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, verified.userId))
      .limit(1);
    if (!user) throw new AccountError("NOT_FOUND", 404, "账号不存在");
    await db
      .update(users)
      .set({ emailVerified: new Date() })
      .where(eq(users.id, verified.userId));
    return { kind: "verified", email: user.email };
  }

  const changed = await consumeToken(rawToken, "email_change");
  if (changed) {
    const [user] = await db
      .select({ email: users.email, pendingEmail: users.pendingEmail })
      .from(users)
      .where(eq(users.id, changed.userId))
      .limit(1);
    if (!user?.pendingEmail) {
      throw new AccountError("INVALID_TOKEN", 400, "链接无效或已过期，请重新申请");
    }
    // 令牌签发到被打开之间，新地址可能已被别的账号占用。
    if (await emailTakenByOther(user.pendingEmail, changed.userId)) {
      await db.update(users).set({ pendingEmail: null }).where(eq(users.id, changed.userId));
      throw new AccountError("EMAIL_TAKEN", 409, "这个邮箱已被其他账号使用");
    }
    await db
      .update(users)
      .set({ email: user.pendingEmail, pendingEmail: null, emailVerified: new Date() })
      .where(eq(users.id, changed.userId));
    return { kind: "changed", email: user.pendingEmail };
  }

  throw new AccountError("INVALID_TOKEN", 400, "链接无效或已过期，请重新申请");
}

/** 取消尚未确认的邮箱修改。 */
export async function cancelEmailChange(userId: string): Promise<void> {
  await db.update(users).set({ pendingEmail: null }).where(eq(users.id, userId));
  await invalidateTokens(userId, "email_change");
}

/** 该 GitHub 身份属于哪个账号；null 表示尚未被任何账号绑定。 */
export async function findGithubOwner(providerAccountId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.provider, "github"), eq(accounts.providerAccountId, providerAccountId)))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * 解绑保护（AUTH-012）：账号必须保留至少一种可登录方式。只绑定 GitHub、又没有
 * 本地密码的账号不能解绑，必须先设置密码。
 */
export async function unlinkGithub(userId: string): Promise<void> {
  const methods = await loginMethods(userId);
  if (!methods.githubLogin) {
    throw new AccountError("NOT_LINKED", 400, "当前账号没有绑定 GitHub");
  }
  if (!methods.hasPassword) {
    throw new AccountError(
      "LAST_LOGIN_METHOD",
      409,
      "这是账号唯一的登录方式，请先在账号安全页设置密码再解绑",
    );
  }

  await db
    .delete(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "github")));
}
