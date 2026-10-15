import { redirect } from "next/navigation";
import { EmailForm } from "@/components/settings/email-form";
import { GithubLink } from "@/components/settings/github-link";
import { PasswordForm } from "@/components/settings/password-form";
import { currentUser } from "@/lib/session";
import { getAccountSettings } from "@/lib/me/settings";
import { githubEnabled } from "@/lib/auth/github";
import { mailConfigured } from "@/lib/mailer";

export const dynamic = "force-dynamic";

const GITHUB_NOTICES: Record<string, string> = {
  linked: "GitHub 已绑定。",
  unauthorized: "绑定需要先登录。",
  not_configured: "本站还没有配置 GitHub OAuth 应用。",
  cancelled: "GitHub 授权被取消。",
  state_missing: "授权状态已过期，请重新发起绑定。",
  state_mismatch: "授权状态不匹配，请重新发起绑定。",
  token_exchange_failed: "与 GitHub 换取访问令牌失败，请重试。",
  profile_fetch_failed: "读取 GitHub 资料失败，请重试。",
  already_linked: "这个 GitHub 账号已经绑定了另一个 HappyPaper 账号。",
};

export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string; reason?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings/account");

  const settings = await getAccountSettings(user.id);
  if (!settings) redirect("/login");

  const { github, reason } = await searchParams;
  const githubNotice =
    github === "linked"
      ? { ok: true, text: GITHUB_NOTICES.linked }
      : github === "error"
        ? { ok: false, text: GITHUB_NOTICES[reason ?? ""] ?? "GitHub 绑定失败，请重试。" }
        : null;

  return (
    <div className="hp-stack">
      {githubNotice ? (
        <p className={githubNotice.ok ? "hp-notice" : "hp-error"}>{githubNotice.text}</p>
      ) : null}

      <EmailForm
        email={settings.email}
        verified={settings.emailVerified}
        pendingEmail={settings.pendingEmail}
      />

      {!mailConfigured() ? (
        <p className="hp-hint">
          本站还没有配置邮件发送通道，验证与重置链接目前写入服务器日志，由管理员转达。
        </p>
      ) : null}

      <PasswordForm hasPassword={settings.hasPassword} />

      <GithubLink
        githubLogin={settings.githubLogin}
        hasPassword={settings.hasPassword}
        configured={githubEnabled()}
      />
    </div>
  );
}
