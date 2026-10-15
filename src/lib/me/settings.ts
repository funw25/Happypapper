import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";

/**
 * Read and write paths for the settings pages (docs/03-requirements.md 5, 6, 9).
 * Everything here is scoped to the signed-in user id: the API routes never take
 * a target user from the request body.
 */

export class SettingsError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type AccountSettings = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  pendingEmail: string | null;
  avatarUrl: string | null;
  bio: string | null;
  role: string;
  hasPassword: boolean;
  githubLogin: string | null;
};

export async function getAccountSettings(userId: string): Promise<AccountSettings | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      pendingEmail: users.pendingEmail,
      avatarUrl: users.image,
      bio: users.bio,
      role: users.role,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;

  const githubLogin = await githubLoginFor(userId);

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified !== null,
    pendingEmail: row.pendingEmail,
    avatarUrl: row.avatarUrl,
    bio: row.bio,
    role: row.role,
    hasPassword: Boolean(row.passwordHash),
    githubLogin,
  };
}

export async function githubLoginFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ providerAccountId: accounts.providerAccountId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "github")))
    .limit(1);
  return row?.providerAccountId ?? null;
}

export type PrivacySettings = {
  anonymousDefault: boolean;
  profileCommentsVisible: boolean;
  danmakuVisible: boolean;
};

export async function getPrivacySettings(userId: string): Promise<PrivacySettings | null> {
  const [row] = await db
    .select({
      anonymousDefault: users.anonymousDefault,
      profileCommentsVisible: users.profileCommentsVisible,
      danmakuVisible: users.danmakuVisible,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function updatePrivacySettings(
  userId: string,
  patch: Partial<PrivacySettings>,
): Promise<PrivacySettings> {
  const [row] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, userId))
    .returning({
      anonymousDefault: users.anonymousDefault,
      profileCommentsVisible: users.profileCommentsVisible,
      danmakuVisible: users.danmakuVisible,
    });
  if (!row) throw new SettingsError("NOT_FOUND", 404, "账号不存在");
  return row;
}

const NAME_PATTERN = /^[\p{L}\p{N}_.\- ]+$/u;

export async function updateProfile(
  userId: string,
  patch: { name: string; avatarUrl: string | null; bio: string | null },
): Promise<AccountSettings> {
  const name = patch.name.trim();
  if (name.length < 2 || name.length > 24) {
    throw new SettingsError("INVALID_NAME", 400, "昵称需要 2 到 24 个字符");
  }
  if (!NAME_PATTERN.test(name)) {
    throw new SettingsError("INVALID_NAME", 400, "昵称只能包含文字、数字、空格、下划线、连字符和点");
  }
  if (name.startsWith("@")) {
    throw new SettingsError("INVALID_NAME", 400, "昵称不能以 @ 开头");
  }

  const clash = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.name}) = lower(${name})`, ne(users.id, userId)))
    .limit(1);
  if (clash.length > 0) {
    throw new SettingsError("NAME_TAKEN", 409, "这个昵称已经被使用");
  }

  const bio = patch.bio?.trim() ? patch.bio.trim() : null;
  if (bio && bio.length > 300) {
    throw new SettingsError("INVALID_BIO", 400, "个人简介最多 300 字");
  }

  await db
    .update(users)
    .set({ name, image: patch.avatarUrl, bio })
    .where(eq(users.id, userId));

  const saved = await getAccountSettings(userId);
  if (!saved) throw new SettingsError("NOT_FOUND", 404, "账号不存在");
  return saved;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const problem = passwordProblem(newPassword);
  if (problem) {
    throw new SettingsError("INVALID_PASSWORD", 400, problem.replace("密码需要", "新密码需要"));
  }
  if (newPassword === currentPassword) {
    throw new SettingsError("SAME_PASSWORD", 400, "新密码不能与当前密码相同");
  }

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw new SettingsError("NOT_FOUND", 404, "账号不存在");

  // Accounts created through GitHub start without a local password; the first
  // password they set does not need a current password to compare against.
  if (row.passwordHash && !(await verifyPassword(currentPassword, row.passwordHash))) {
    throw new SettingsError("WRONG_PASSWORD", 403, "当前密码不正确");
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, userId));
}

export function normaliseAvatarUrl(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const value = raw.trim();
  if (value.length > 500) {
    throw new SettingsError("INVALID_AVATAR", 400, "头像地址过长");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SettingsError("INVALID_AVATAR", 400, "头像需要是完整的 http(s) 图片地址");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SettingsError("INVALID_AVATAR", 400, "头像只支持 http 或 https 地址");
  }
  return parsed.toString();
}
