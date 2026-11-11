import { saveProfile } from "../../../lib/booking/client-profile-store";
import { parseMeetingRequest, recordMeetingRequest } from "../../../lib/booking/meeting-request";
import { clientIp, RateLimiter } from "../../../lib/rate-limit";

export const runtime = "nodejs";

// 5 requests per hour per IP: stops someone flooding the log.
const limiter = new RateLimiter(5, 60 * 60_000);

export async function POST(req: Request): Promise<Response> {
  const rl = limiter.check(clientIp(req));
  if (!rl.ok) return Response.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Please check the form and try again." }, { status: 400 });
  }
  const parsed = parseMeetingRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  recordMeetingRequest(parsed.value);
  const { chatId, answers, name, email, company, when, region, notes } = parsed.value;
  if (chatId) await saveProfile({ chatId, answers, contact: { name, email, company, when, region, notes }, at: new Date().toISOString() });
  return Response.json({ ok: true });
}
