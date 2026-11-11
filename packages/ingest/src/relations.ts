/**
 * Forceful relations (HydraDB `relations.ids`, used in thinking mode): curated SOURCE-level links,
 * resolved to the PRIMARY record id (first record in page order) of each target source.
 * Links to sources with no records yet (blocked / not scraped) are reported as unresolved, never invented.
 */
import type { IngestRecord } from "@avispl/shared";

/** Groups: every source in a group is linked to every other source in that group. */
export const RELATION_GROUPS: { name: string; sources: string[] }[] = [
  { name: "reference designs page <-> PDF", sources: ["ref-designs-page", "ref-designs-pdf"] },
  { name: "standardization eBook <-> reference designs", sources: ["standardization-ebook", "ref-designs-page"] },
  { name: "Microsoft practice <-> Smart Workplace eBook <-> IDRC", sources: ["microsoft-practice", "smart-workplace-ebook", "idrc"] },
  { name: "Smart Workplace landing <-> eBook", sources: ["smart-workplace-landing", "smart-workplace-ebook"] },
  {
    name: "Symphony <-> Managed Services <-> Support and Maintenance <-> Bernalillo",
    sources: ["symphony", "managed-services", "support-maintenance", "bernalillo-county"],
  },
  { name: "Support and Maintenance <-> How to get support", sources: ["support-maintenance", "support-howto"] },
];

/**
 * Sources added after the brief -> sources they should pull in. One-directional: the records of the target
 * sources are not changed (their relationIds stay as the groups above define them).
 */
export const ONE_WAY_RELATIONS: Record<string, string[]> = {
  "design-planning": ["real-time-design", "ref-designs-page"],
  "teams-rooms-express-install": ["teams-rooms-faq", "express-lane-webcast", "microsoft-practice"],
  "standardization-ebook-landing": ["ref-designs-page"],
  "cisco-powered-meeting-rooms-blog": ["cisco", "managed-services"],
  "financial-services-collab-blog": ["industry-financial-services", "standardization-ebook-landing"],
  "heriot-watt-university": ["industry-higher-education"],
  "implementation-support": ["professional-services", "global-deployment", "end-user-training"],
  "end-user-training": ["professional-services", "implementation-support"],
  "onsite-managed-services": ["managed-services", "enterprise-managed-services"],
  "enterprise-managed-services": ["managed-services", "onsite-managed-services", "symphony"],
  "enterprise-maintenance": ["support-maintenance", "managed-services"],
  "symphony-multi-vendor-blog": ["symphony", "rmit-symphony"],
  "symphony-ai-hp-poly-blog": ["symphony", "hp-poly"],
  "rmit-symphony": ["symphony", "managed-services"],
};

export function relatedSources(sourceId: string, groups = RELATION_GROUPS): string[] {
  const out = new Set<string>();
  for (const g of groups) if (g.sources.includes(sourceId)) for (const s of g.sources) if (s !== sourceId) out.add(s);
  return [...out];
}

/** Primary record per source = first record of that source in the given order. */
export function primaryRecordIds(records: Pick<IngestRecord, "id" | "sourceId">[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of records) if (!m.has(r.sourceId)) m.set(r.sourceId, r.id);
  return m;
}

/** Mutates `relationIds` on every record. Returns unresolved links as "from -> to". */
export function applyRelations(records: IngestRecord[], groups = RELATION_GROUPS, oneWay: Record<string, string[]> = ONE_WAY_RELATIONS): string[] {
  const primary = primaryRecordIds(records);
  const unresolved = new Set<string>();
  for (const r of records) {
    const ids: string[] = [];
    for (const target of [...relatedSources(r.sourceId, groups), ...(oneWay[r.sourceId] ?? [])]) {
      const id = primary.get(target);
      if (id) ids.push(id);
      else unresolved.add(`${r.sourceId} -> ${target}`);
    }
    r.relationIds = [...new Set(ids)].filter((id) => id !== r.id);
  }
  return [...unresolved].sort();
}
