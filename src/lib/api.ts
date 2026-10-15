import { NextResponse } from "next/server";

export function jsonError(code: string, status: number, detail?: string) {
  return NextResponse.json({ error: code, detail }, { status });
}

export function errorFromUnknown(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (message === "UNAUTHORIZED") return jsonError("UNAUTHORIZED", 401, "请先登录");
  if (message === "FORBIDDEN") return jsonError("FORBIDDEN", 403, "没有权限");
  console.error(error);
  return jsonError("INTERNAL_ERROR", 500);
}

/**
 * 限流维度：登录用户按账号，匿名请求按来源地址。放在这里而不是各接口各写一份，
 * 是为了避免一个接口按用户、另一个按 IP，导致同一操作有两套额度。
 */
export function clientIdentity(request: Request, userId: string | null): string {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${forwarded || "local"}`;
}
