/**
 * Display-name collision handling for first login.
 *
 * `users.name` is unique and `not null`, while a GitHub display name is neither
 * unique nor guaranteed to be present. This is the rule that reconciles the two,
 * kept free of database imports and React so it can be exercised directly.
 */
export const MAX_NAME_LENGTH = 40;
const BASE_MAX_LENGTH = 32;
const MAX_SUFFIX_ATTEMPTS = 50;

export const FALLBACK_NAME = "reader";

export async function uniqueDisplayName(
  baseName: string,
  isTaken: (candidate: string) => boolean | Promise<boolean>,
): Promise<string> {
  const base = baseName.trim().slice(0, BASE_MAX_LENGTH) || FALLBACK_NAME;
  if (!(await isTaken(base))) return base;

  for (let suffix = 2; suffix <= MAX_SUFFIX_ATTEMPTS; suffix++) {
    const candidate = `${base}-${suffix}`.slice(0, MAX_NAME_LENGTH);
    if (!(await isTaken(candidate))) return candidate;
  }

  // Every numbered candidate is taken. A time suffix keeps first login from
  // failing outright, which matters because the account is created here.
  return `${base}-${Date.now().toString(36)}`.slice(0, MAX_NAME_LENGTH);
}

/**
 * GitHub only returns an email when the account publishes one (or when the
 * `user:email` scope resolves it), and `users.email` is `not null`.
 */
export function fallbackEmail(login: string): string {
  const handle = login.trim().replace(/[^A-Za-z0-9-]/g, "") || "user";
  return `${handle}@users.noreply.github.com`;
}
