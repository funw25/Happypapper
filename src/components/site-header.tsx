import Link from "next/link";
import { auth } from "@/auth";
import { currentUser } from "@/lib/session";
import { unreadNotificationCount } from "@/lib/notifications/queries";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Avatar } from "@/components/avatar";

export async function SiteHeader() {
  const session = await auth();
  const user = session?.user?.id ? await currentUser() : null;
  const unread = user ? await unreadNotificationCount(user.id) : 0;

  return (
    <header className="border-b border-[var(--paper-line)] bg-[var(--paper-surface)]">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Happy<span className="text-[var(--paper-accent)]">Paper</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-[var(--paper-muted)]">
          <Link href="/papers" className="hover:text-[var(--paper-accent)]">
            论文库
          </Link>
          <Link href="/papers/new" className="hover:text-[var(--paper-accent)]">
            添加论文
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <ThemeToggle />
          {user ? (
            <>
              {user.role === "admin" ? (
                <Link href="/admin" className="text-[var(--paper-muted)] hover:text-[var(--paper-accent)]">
                  管理
                </Link>
              ) : null}
              <Link
                href="/me?tab=notifications"
                className="text-[var(--paper-muted)] hover:text-[var(--paper-accent)]"
                data-unread={unread}
              >
                通知
                {unread > 0 ? (
                  <span className="ml-1 rounded-full bg-[var(--paper-accent)] px-1.5 py-0.5 text-xs text-[var(--paper-accent-fg)]">
                    {unread}
                  </span>
                ) : null}
              </Link>
              <Link href="/me" className="text-[var(--paper-muted)] hover:text-[var(--paper-accent)]">
                我的
              </Link>
              <Link
                href="/settings/profile"
                className="text-[var(--paper-muted)] hover:text-[var(--paper-accent)]"
              >
                设置
              </Link>
              <Link href={`/u/${encodeURIComponent(user.name)}`} className="font-medium">
                {user.name}
              </Link>
              <Avatar size="sm" name={user.name} avatarBg={user.avatarBg} avatarFg={user.avatarFg} />
            </>
          ) : (
            <>
              <Link href="/login" className="hp-btn">
                登录
              </Link>
              <Link href="/register" className="hp-btn hp-btn-primary">
                注册
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
