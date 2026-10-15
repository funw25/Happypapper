import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/settings/profile-form";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { currentUser } from "@/lib/session";
import { getAccountSettings } from "@/lib/me/settings";

export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings/profile");

  const settings = await getAccountSettings(user.id);
  if (!settings) redirect("/login");

  return (
    <div className="hp-stack">
      <ProfileForm
        initial={{ name: settings.name, avatarUrl: settings.avatarUrl, bio: settings.bio }}
      />

      <section className="hp-card p-6">
        <h2 className="hp-section-title">外观</h2>
        <p className="hp-hint mt-1">
          主题保存在这台设备的浏览器中，刷新页面后保持；跟随系统时会随操作系统切换。
        </p>
        <div className="mt-3 flex items-center gap-3">
          <ThemeToggle />
          <span className="hp-hint">浅色 / 深色 / 跟随系统</span>
        </div>
      </section>

      <section className="hp-card p-6">
        <h2 className="hp-section-title">公开主页</h2>
        <p className="hp-hint mt-1">其他读者看到的页面，展示昵称、头像、简介和公开评论。</p>
        <Link
          href={`/u/${encodeURIComponent(settings.name)}`}
          className="hp-btn mt-3"
        >
          查看 /u/{settings.name}
        </Link>
      </section>
    </div>
  );
}
