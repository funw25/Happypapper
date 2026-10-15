/**
 * 邮件发送层（docs/03-requirements.md AUTH-006、AUTH-007、PROFILE-008）。
 *
 * 目前只有一种传输方式：写入服务器日志。原因是本机没有可用的 SMTP 凭据，而没有
 * 任何传输方式就无法把邮箱验证与密码找回跑通；假装发送成功更糟——用户会一直等
 * 一封不会来的邮件。接入真实发信只需在这里加一个分支并读 SMTP_URL 之类的配置，
 * 调用方（令牌签发、页面文案）不需要改动。
 *
 * 链接一律用绝对地址：邮件在浏览器外打开，相对路径没有意义。
 */
export type MailTransport = "log";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  /** 邮件里的主要链接，便于日志与测试脚本直接取用。 */
  link: string;
};

export function mailTransport(): MailTransport {
  return "log";
}

/** 是否已配置可投递的邮件通道；未配置时页面不应承诺「邮件已发送」。 */
export function mailConfigured(): boolean {
  return mailTransport() !== "log";
}

export function appUrl(): string {
  const configured = process.env.APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
  return (configured || "http://localhost:3100").replace(/\/$/, "");
}

export async function sendMail(message: MailMessage): Promise<{ delivered: boolean }> {
  // 单行 JSON，便于在开发服务器日志里检索，也便于人工复制链接。
  console.log(
    `[mail] ${JSON.stringify({
      transport: mailTransport(),
      to: message.to,
      subject: message.subject,
      link: message.link,
      text: message.text,
    })}`,
  );
  return { delivered: mailConfigured() };
}

export function verificationLink(token: string): string {
  return `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
}

export function passwordResetLink(token: string): string {
  return `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}
