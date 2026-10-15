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
