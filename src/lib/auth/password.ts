import bcrypt from "bcryptjs";

/**
 * 密码规则的唯一出处：注册、账号安全页修改密码、通过邮件重置密码三处必须一致，
 * 分开写会漂移（一处允许 8 位、另一处要求 10 位这种）。
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;
export const PASSWORD_RULE = `密码需要 ${MIN_PASSWORD_LENGTH} 到 ${MAX_PASSWORD_LENGTH} 位`;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return PASSWORD_RULE;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}
