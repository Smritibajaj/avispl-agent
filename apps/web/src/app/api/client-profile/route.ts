import { saveProfile } from "../../../lib/booking/client-profile-store";
import { clientProfileSchema } from "../../../lib/booking/client-profile";
import { clientIp, RateLimiter } from "../../../lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

// A chat saves its profile once per delivered plan: 20 per hour per IP is plenty.
const limiter = new RateLimiter(20, 60 * 60_000);

export async function POST(req: Request): Promise<Response> {
  const rl = limiter.check(clientIp(req));
  if (!rl.ok) return Response.json({ error: "Too many requests." }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = clientProfileSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  await saveProfile({ ...parsed.data, at: new Date().toISOString() });
  return Response.json({ ok: true });
}
