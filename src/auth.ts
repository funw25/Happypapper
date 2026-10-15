import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import { githubCredentials, githubProviderOptions, resolveGithubIdentity } from "@/lib/auth/github";

const github = githubCredentials();

/**
 * GitHub is registered only when credentials exist, so a checkout without them
 * behaves exactly as before rather than showing a button that cannot finish.
 * `GITHUB_BASE_URL` switches all three endpoints at once (GitHub Enterprise, or
 * the local fake provider used to verify the handshake).
 */
const githubProvider = github
  ? [
      GitHub({
        ...githubProviderOptions(),
        // GitHub does not always return a usable email or a unique display name;
        // this normalises both before the adapter inserts a row.
        profile: (profile) => resolveGithubIdentity(profile),
      }),
    ]
  : [];

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  // The adapter is what records an OAuth identity; without it a GitHub login
  // would have nowhere to be stored.
  adapter: DrizzleAdapter(db, { usersTable: users, accountsTable: accounts }),
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (raw) => {
        const email = typeof raw?.email === "string" ? raw.email.trim().toLowerCase() : "";
        const password = typeof raw?.password === "string" ? raw.password : "";
        if (!email || !password) return null;

        const [found] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!found) return null;
        // OAuth-only accounts have no hash to compare against.
        if (!found.passwordHash) return null;

        const ok = await bcrypt.compare(password, found.passwordHash);
        if (!ok) return null;

        return {
          id: found.id,
          email: found.email,
          name: found.name,
          role: found.role,
        };
      },
    }),
    ...githubProvider,
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.role = (user as { role?: string }).role ?? "user";
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.uid ?? "");
        session.user.role = String(token.role ?? "user");
      }
      return session;
    },
  },
});
