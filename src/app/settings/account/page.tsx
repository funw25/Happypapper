import { redirect } from "next/navigation";
import { PasswordForm } from "@/components/settings/password-form";
import { currentUser } from "@/lib/session";
import { getAccountSettings } from "@/lib/me/settings";
import { githubEnabled } from "@/lib/auth/github";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings/account");

  const settings = await getAccountSettings(user.id);
  if (!settings) redirect("/login");

  return (
    <div className="hp-stack">
      <section className="hp-card hp-stack p-6">
        <h2 className="hp-section-title">登录邮箱</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{settings.email}</span>
          <span className="hp-tag">
            {settings.emailVerified ? "已验证" : "未验证"}
          </span>
        </div>
        <p className="hp-hint">
          修改邮箱需要先向新地址发送验证链接，这条流程与密码找回一起在第三阶段实现；当前邮箱地址不可在此页面修改。
        </p>
      </section>

      <PasswordForm hasPassword={settings.hasPassword} />

      <section className="hp-card hp-stack p-6">
        <h2 className="hp-section-title">GitHub 账号</h2>
        {settings.githubLogin ? (
          <p className="text-sm">
            已绑定 GitHub 账号 <span className="font-medium">{settings.githubLogin}</span>。
          </p>
        ) : (
          <p className="text-sm">
            {githubEnabled()
              ? "还没有绑定 GitHub 账号。"
              : "本站还没有配置 GitHub OAuth 应用，绑定功能暂不可用。"}
          </p>
        )}
        <p className="hp-hint">
          解绑保护要求账号至少保留一种可登录方式；绑定与解绑流程在第三阶段与 GitHub OAuth 一起交付。
        </p>
      </section>
    </div>
  );
}
