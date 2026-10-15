import { LoginForm } from "@/components/login-form";
import { githubEnabled } from "@/lib/auth/github";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <LoginForm githubEnabled={githubEnabled()} initialError={error} />;
}
