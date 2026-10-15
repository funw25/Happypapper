import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { SettingsNav } from "@/components/settings/settings-nav";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings/profile");

  return (
    <>
      <SiteHeader />
      <main className="hp-page-narrow">
        <h1 className="hp-page-title">设置</h1>
        <p className="hp-hint mt-1">
          这些设置只对 <span className="font-medium">{user.name}</span> 生效，保存后立即写入账号。
        </p>
        <div className="mt-6">
          <SettingsNav />
        </div>
        <div className="mt-6">{children}</div>
      </main>
    </>
  );
}
