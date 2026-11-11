/**
 * Expert briefs: knowledge records written in our own words from the scraped sections of ONE source at ONE
 * journey stage. They sit next to the verbatim section records in HydraDB and give the agent a dense,
 * self-contained answer per source and stage.
 *
 * A brief may only restate what its sections say (CLAUDE.md rule 1). `checkBrief` enforces what a program can:
 * every number must occur in the sections, and long word-for-word runs are reported. Names that do not occur in
 * the sections are reported for a human to read.
 *
 * Authored files: packages/ingest/knowledge/briefs/<sourceId>.<stage>[.<slug>].json  (tracked in git)
 * Built file:     packages/ingest/data/records.knowledge.jsonl                       (ingested by packages/hydra)
 */
import { createHash } from "node:crypto";
import {
  ChunkMetadataSchema,
  JOURNEY_STAGES,
  joinList,
  splitList,
  type ChunkMetadata,
  type IngestRecord,
  type JourneyStage,
} from "@avispl/shared";
import { z } from "zod";

export const KNOWLEDGE_RECORDS_FILENAME = "records.knowledge.jsonl";

export const BriefSchema = z
  .object({
    sourceId: z.string().min(1),
    stage: z.enum(JOURNEY_STAGES),
    /** Distinguishes several briefs of one source and stage. Lowercase letters, digits, dashes. */
    slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
    /** Searchable heading (HydraDB embeds it). States the subject, not "Overview". */
    section: z.string().min(8).max(140),
    /** Markdown, without the breadcrumb line (the build adds it). */
    body: z.string().min(200),
    /** Ids of the section records this brief restates. All from the same source. */
    basedOn: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type Brief = z.infer<typeof BriefSchema>;

export const STAGE_LABELS: Record<JourneyStage, string> = {
  plan_design: "Plan and design",
  choose_platform: "Choose platform and devices",
  deploy: "Deploy",
  run_support: "Run and support",
  proof: "Proof",
};

export const MIN_WORDS = 90;
export const MAX_WORDS = 520;
/** A run of this many consecutive source words in a brief counts as copied text. */
export const VERBATIM_RUN = 12;

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/\]\([^)]*\)/g, " ")
    .replace(/[’‘]/g, "'")
    .split(/[^a-z0-9'%]+/)
    .filter(Boolean);

/** Numeric tokens as written: 1,200  99.9%  24/7  4K  2025. Trailing punctuation is dropped. */
export function numberTokens(s: string): string[] {
  const text = s.replace(/\]\([^)]*\)/g, " ");
  return (text.match(/\d[\d,.:/×x-]*\d|\d/g) ?? []).map((t) => t.replace(/[.,:/-]+$/, ""));
}

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
];

/** True when a number written in the brief also occurs in the source (as digits, or 0 to 12 spelled out). */
function numberInSource(token: string, sourceText: string, sourceNumbers: Set<string>): boolean {
  if (sourceNumbers.has(token)) return true;
  const plain = token.replace(/,/g, "");
  for (const n of sourceNumbers) if (n.replace(/,/g, "") === plain) return true;
  // A part of a compound in the source, e.g. brief "24" for source "24/7", or "2025" for "2024-2025".
  for (const n of sourceNumbers) if (n.split(/[^\d.,]+/).includes(token)) return true;
  const asInt = Number(plain);
  if (Number.isInteger(asInt) && asInt >= 0 && asInt <= 12) {
    return new RegExp(`\\b${NUMBER_WORDS[asInt]}\\b`, "i").test(sourceText);
  }
  return false;
}

const COMMON_CAPITALISED = new Set(
  (
    "AVI-SPL AV UC IT AI The This These Those It Its A An And Or But For With Without When Where What Which Who Why How " +
    "Use Not No Only Each Every All Any Some Most Also Both Then They Their There Here If In On At By Of To From As Is Are " +
    "Plan Design Deploy Run Support Proof Choose Platform Devices Stage Source Page Section Limits Facts Key Note Customer " +
    "Customers Organisation Organization Result Results Challenge Solution Outcome Outcomes Scope Services Service Room Rooms " +
    "Meeting Meetings January February March April May June July August September October November December"
  ).split(" "),
);

/** Capitalised words inside sentences that never occur in the source: candidates for an invented name. */
export function unknownNames(body: string, sourceText: string): string[] {
  const src = sourceText.toLowerCase();
  const found = new Set<string>();
  for (const line of body.split("\n")) {
    const clean = line.replace(/^[\s>*#-]+/, "").replace(/\*\*/g, "");
    const tokens = clean.split(/\s+/);
    tokens.forEach((raw, i) => {
      const w = raw.replace(/^[("'“‘[]+|[)"'”’\].,;:!?]+$/g, "");
      if (!/^[A-Z][A-Za-z0-9-]{2,}$/.test(w)) return;
      const prev = tokens[i - 1] ?? "";
      if (i === 0 || /[.:!?]$/.test(prev)) return; // sentence start
      if (COMMON_CAPITALISED.has(w)) return;
      if (src.includes(w.toLowerCase())) return;
      found.add(w);
    });
  }
  return [...found];
}

/** Longest runs of consecutive words the brief shares with the source, VERBATIM_RUN words or more. */
export function verbatimRuns(body: string, sourceText: string): string[] {
  const b = words(body);
  const s = words(sourceText);
  const grams = new Set<string>();
  for (let i = 0; i + VERBATIM_RUN <= s.length; i++) grams.add(s.slice(i, i + VERBATIM_RUN).join(" "));
  const runs: string[] = [];
  for (let i = 0; i + VERBATIM_RUN <= b.length; i++) {
    if (!grams.has(b.slice(i, i + VERBATIM_RUN).join(" "))) continue;
    let end = i + VERBATIM_RUN;
    while (end < b.length && grams.has(b.slice(end - VERBATIM_RUN + 1, end + 1).join(" "))) end++;
    runs.push(b.slice(i, end).join(" "));
    i = end - 1;
  }
  return runs;
}

export interface BriefCheck {
  errors: string[];
  warnings: string[];
}

/** `sections` are the records named in `brief.basedOn` (already resolved). */
export function checkBrief(brief: Brief, sections: IngestRecord[]): BriefCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sourceText = sections.map((r) => `${r.title}\n${r.body}\n${r.metadata.page_title}\n${r.metadata.cs_organization}\n${r.metadata.cs_location}`).join("\n");
  const sourceNumbers = new Set(numberTokens(sourceText));

  for (const r of sections) {
    if (r.sourceId !== brief.sourceId) errors.push(`basedOn ${r.id} belongs to ${r.sourceId}, not ${brief.sourceId}`);
    if (!r.metadata.meeting_room_relevant) errors.push(`basedOn ${r.id} is not meeting-room relevant`);
    if (r.metadata.status !== "published") errors.push(`basedOn ${r.id} is not published`);
  }
  if (new Set(sections.map((r) => r.url)).size > 1) errors.push("basedOn sections have different URLs (one brief cites one URL)");

  const text = `${brief.section}\n${brief.body}`;
  const invented = [...new Set(numberTokens(text))].filter((t) => !numberInSource(t, sourceText, sourceNumbers));
  if (invented.length) errors.push(`numbers not in the source sections: ${invented.join(", ")}`);

  const n = words(brief.body).length;
  if (n < MIN_WORDS) errors.push(`body has ${n} words (min ${MIN_WORDS})`);
  if (n > MAX_WORDS) errors.push(`body has ${n} words (max ${MAX_WORDS})`);
  if (/…|\.\.\./.test(text)) errors.push("contains an ellipsis");
  if (/https?:\/\//.test(brief.body)) errors.push("body contains a URL (the record carries the citation URL)");

  const runs = verbatimRuns(brief.body, sourceText);
  if (runs.length) warnings.push(`copied runs: ${runs.map((r) => `"${r}"`).join(" | ")}`);
  const names = unknownNames(text, sourceText);
  if (names.length) warnings.push(`names not in the source sections: ${names.join(", ")}`);
  return { errors, warnings };
}

const unionList = (sections: IngestRecord[], key: "platforms" | "vendors" | "topics" | "room_sizes", order: readonly string[]) => {
  const seen = new Set(sections.flatMap((r) => splitList(r.metadata[key])));
  return joinList(order.filter((v) => seen.has(v)).concat([...seen].filter((v) => !order.includes(v))));
};

function pageRange(sections: IngestRecord[]): string {
  const pages = sections.flatMap((r) => (r.metadata.page_range.match(/\d+/g) ?? []).map(Number));
  if (!pages.length) return "";
  const lo = Math.min(...pages);
  const hi = Math.max(...pages);
  return lo === hi ? String(lo) : `${lo}-${hi}`;
}

export const briefId = (url: string, brief: Pick<Brief, "stage" | "slug">) => sha1(`${url}#expert-brief/${brief.stage}/${brief.slug}`);

/** Build the record. Tags are the union of the sections' tags; nothing is tagged that the sections were not. */
export function buildBriefRecord(
  brief: Brief,
  sections: IngestRecord[],
  vocab: { platforms: readonly string[]; vendors: readonly string[]; topics: readonly string[]; roomSizes: readonly string[] },
): IngestRecord {
  const first = sections[0]!;
  const m = first.metadata;
  const title = `${m.page_title} › ${brief.section}`;
  const body = `${title}\n\n${brief.body.trim()}\n`;
  const latest = (pick: (r: IngestRecord) => string | undefined) => sections.map(pick).filter(Boolean).sort().at(-1) ?? "";
  const metadata: ChunkMetadata = ChunkMetadataSchema.parse({
    journey_stage: brief.stage,
    content_type: m.content_type,
    platforms: unionList(sections, "platforms", vocab.platforms),
    vendors: unionList(sections, "vendors", vocab.vendors),
    topics: unionList(sections, "topics", vocab.topics),
    room_sizes: unionList(sections, "room_sizes", vocab.roomSizes),
    industry: m.industry,
    status: "published",
    meeting_room_relevant: true,
    requires_disclosure: sections.some((r) => r.metadata.requires_disclosure),
    legacy_platform: sections.some((r) => r.metadata.legacy_platform),
    metrics_are_estimates: sections.some((r) => r.metadata.metrics_are_estimates),
    edition: m.edition,
    source_url: first.url,
    page_title: m.page_title,
    section: brief.section,
    page_range: pageRange(sections),
    last_modified: latest((r) => r.metadata.last_modified),
    cs_organization: m.cs_organization,
    cs_location: m.cs_location,
    cs_rooms_count: m.cs_rooms_count,
    last_crawled: latest((r) => r.metadata.last_crawled),
  });
  const record: IngestRecord = {
    id: briefId(first.url, brief),
    sourceId: brief.sourceId,
    title,
    url: first.url,
    body,
    metadata,
    additional: {
      contentHash: sha1(body),
      crawlNotes: `expert brief (${STAGE_LABELS[brief.stage]}): restated in our own words from ${sections.length} section(s) of this source`,
    },
    relationIds: sections.map((r) => r.id),
  };
  const timestamp = latest((r) => r.timestamp);
  if (timestamp) record.timestamp = timestamp;
  return record;
}
