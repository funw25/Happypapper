import { discoverRankings } from "@/lib/discover";
import { errorFromUnknown, jsonError, PRIVATE_RESPONSE_HEADERS } from "@/lib/api";

export async function GET(request: Request) {
  const period = new URL(request.url).searchParams.get("period") ?? "all";
  if (period !== "all" && period !== "today") return jsonError("INVALID_INPUT", 400);
  try { return Response.json(await discoverRankings(period), { headers: PRIVATE_RESPONSE_HEADERS }); }
  catch (error) { return errorFromUnknown(error); }
}
