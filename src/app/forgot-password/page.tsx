import { SiteHeader } from "@/components/site-header";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata = { title: "忘记密码 · HappyPaper" };

export default function ForgotPasswordPage() {
  return (
    <>
      <SiteHeader />
      <ForgotPasswordForm />
    </>
  );
}
