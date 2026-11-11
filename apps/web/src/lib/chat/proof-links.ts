import type { ContentType } from "@avispl/shared";

/** Client-safe: the pages an answer cited, as links the customer can open. Case studies (the proof) come first. */
export interface ProofLink {
  url: string;
  label: string;
  proof: boolean;
}

interface CitedHit {
  sourceUrl: string;
  pageTitle: string;
  title: string;
  contentType: ContentType;
  csOrganization?: string;
}

const MAX_LINKS = 6;

export function proofLinks(cited: readonly string[], hits: ReadonlyMap<string, CitedHit>, max = MAX_LINKS): ProofLink[] {
  const byUrl = new Map<string, ProofLink>();
  for (const ref of cited) {
    const h = hits.get(ref);
    if (!h || !/^https?:\/\//.test(h.sourceUrl) || byUrl.has(h.sourceUrl)) continue;
    const proof = h.contentType === "case_study";
    const name = (proof && h.csOrganization?.trim()) || h.pageTitle.trim() || h.title.split(" › ")[0]!.trim();
    byUrl.set(h.sourceUrl, { url: h.sourceUrl, label: proof ? `Case study: ${name}` : name, proof });
  }
  const all = [...byUrl.values()];
  return [...all.filter((l) => l.proof), ...all.filter((l) => !l.proof)].slice(0, max);
}
