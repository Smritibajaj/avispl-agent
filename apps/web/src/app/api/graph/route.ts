import type { GraphTriplet } from "@avispl/shared";
import { disclosureEnabled } from "../../../config/disclosure";
import { getLicensingDisclosure } from "../../../lib/licensing/disclosure";
import { getStore } from "../../../lib/knowledge";
import { withholdLicensingText } from "../../../lib/licensing/licensing-guard";
import { clientIp, RateLimiter } from "../../../lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const limiter = new RateLimiter(30, 10 * 60_000);

/** The relationships HydraDB's context graph returns for one search, plus the pages they came from (titles and public URLs only). */
export async function GET(req: Request): Promise<Response> {
  const rl = limiter.check(clientIp(req));
  if (!rl.ok) return Response.json({ error: "Too many searches. Please wait a few minutes." }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  const q = (new URL(req.url).searchParams.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 2) return Response.json({ error: "Type a topic, for example \"Teams Rooms standardization\"." }, { status: 400 });
  try {
    const store = await getStore();
    const res = await store.search({ query: q, maxResults: 10 });
    let triplets: GraphTriplet[] = res.graph;
    if (disclosureEnabled() && (await getLicensingDisclosure()).pending)
      triplets = triplets.map((t) => (t.context ? { ...t, context: withholdLicensingText(t.context) } : t));
    return Response.json({
      query: q,
      backend: store.name,
      relaxed: res.relaxed,
      latencyMs: res.latencyMs ?? null,
      triplets,
      sources: res.hits.map((h) => ({ chunkId: h.chunkId, title: h.title, url: h.sourceUrl, section: h.section })),
    });
  } catch (e) {
    console.error("graph search failed:", e instanceof Error ? `${e.name}: ${e.message}` : e);
    return Response.json({ error: "The graph could not be loaded right now. Please try again." }, { status: 503 });
  }
}
