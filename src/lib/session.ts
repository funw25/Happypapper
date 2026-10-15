import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export type CurrentUser = {
  id: string;
  name: string;
  role: string;
  avatarBg: string;
  avatarFg: string;
};

export async function currentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      avatarBg: users.avatarBg,
      avatarFg: users.avatarFg,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return row ?? null;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("FORBIDDEN");
  return user;
}
