import { redirect } from "next/navigation";
import { PrivacyForm } from "@/components/settings/privacy-form";
import { currentUser } from "@/lib/session";
import { getPrivacySettings } from "@/lib/me/settings";

export const dynamic = "force-dynamic";

export default async function PrivacySettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings/privacy");

  const settings = await getPrivacySettings(user.id);
  if (!settings) redirect("/login");

  return (
    <div className="hp-stack">
      <PrivacyForm initial={settings} />

      <section className="hp-card hp-stack p-6">
        <h2 className="hp-section-title">删除评论</h2>
        <p className="hp-hint">
          你可以在阅读器或“我的评论”中删除自己的评论；删除后普通读者不可见，管理员仍可查看审核记录。
        </p>
      </section>
    </div>
  );
}
