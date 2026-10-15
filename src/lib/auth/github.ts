import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { fallbackEmail, uniqueDisplayName } from "@/lib/auth/naming";

/**
 * GitHub OAuth is registered only when both variables are present, so a checkout
 * without credentials keeps working exactly as before instead of offering a
 * button that cannot complete. The names follow the Auth.js v5 convention.
 */
export function githubCredentials(): { id: string; secret: string } | null {
  const id = process.env.AUTH_GITHUB_ID?.trim();
  const secret = process.env.AUTH_GITHUB_SECRET?.trim();
  if (!id || !secret) return null;
  return { id, secret };
}

export function githubEnabled(): boolean {
  return githubCredentials() !== null;
}

/** A GitHub profile cannot be inserted as-is: this table requires a unique
 *  display name and a non-null email, and GitHub guarantees neither. */
export async function resolveGithubIdentity(profile: {
  id: number | string;
  login?: string | null;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}): Promise<{ id: string; name: string; email: string; image: string | null }> {
  const login = profile.login?.trim() || `github${profile.id}`;
  const email = profile.email?.trim() || fallbackEmail(login);

  const name = await uniqueDisplayName(profile.name?.trim() || login, async (candidate) => {
    const taken = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.name, candidate))
      .limit(1);
    return taken.length > 0;
  });

  return {
    id: String(profile.id),
    name,
    email,
    image: profile.avatar_url ?? null,
  };
}
