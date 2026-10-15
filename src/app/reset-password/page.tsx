import { SiteHeader } from "@/components/site-header";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata = { title: "重置密码 · HappyPaper" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <>
      <SiteHeader />
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <main className="hp-page-narrow max-w-sm">
          <h1 className="hp-page-title mb-6">重置密码</h1>
          <div className="hp-card hp-stack p-6">
            <p className="hp-error">链接里没有令牌，请从邮件里重新打开，或重新申请一次。</p>
            <a className="hp-btn hp-btn-primary" href="/forgot-password">
              重新申请
            </a>
          </div>
        </main>
      )}
    </>
  );
}
