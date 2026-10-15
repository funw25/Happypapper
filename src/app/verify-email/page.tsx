import { SiteHeader } from "@/components/site-header";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";

export const metadata = { title: "确认邮箱 · HappyPaper" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <>
      <SiteHeader />
      <main className="hp-page-narrow max-w-sm">
        <h1 className="hp-page-title mb-6">确认邮箱</h1>
        <VerifyEmailPanel token={token ?? ""} />
      </main>
    </>
  );
}
