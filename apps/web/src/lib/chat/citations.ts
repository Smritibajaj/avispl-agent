/** Parses `[S#]` citation markers out of answer text. Pure and unit-tested. */
export type Segment = { type: "text"; value: string } | { type: "cite"; refs: string[]; raw: string };

// [S1]  [S1, S2]  [S1; S3]  [S1,S2,S10]. Lowercase "s" is tolerated and normalised.
const CITE_RE = /\[\s*([Ss]\d{1,3}(?:\s*[,;]\s*[Ss]\d{1,3})*)\s*\]/g;

export function parseCitations(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", value: text.slice(last, idx) });
    const refs = (m[1] ?? "").split(/[,;]/).map((r) => r.trim().toUpperCase());
    out.push({ type: "cite", refs, raw: m[0] });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

/** Unique refs in order of first citation. */
export function citedRefs(text: string): string[] {
  const seen = new Set<string>();
  for (const s of parseCitations(text)) if (s.type === "cite") for (const r of s.refs) seen.add(r);
  return [...seen];
}

/** Refs the model cited that no tool result produced (should be empty; surfaced in the UI if not). */
export function unknownRefs(text: string, known: ReadonlySet<string>): string[] {
  return citedRefs(text).filter((r) => !known.has(r));
}
