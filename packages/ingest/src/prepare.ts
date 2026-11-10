/**
 * Build IngestRecord[] from data/raw/*.json (Firecrawl) and data/pdf/*.json (unpdf), validate, write
 * data/records.jsonl and data/reports/prepare-report.md. Every record starts as `needs_review`; only
 * `publish --source <id>` (approvals bound to the content hash) flips records to `published`.
 * `priority` and `goldenQueries` are never copied into records.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ADDITIONAL_METADATA_MAX_BYTES, ChunkMetadataSchema, EMPTY_METADATA_DEFAULTS, RECORDS_FILENAME,
  type AdditionalMetadata, type ChunkMetadata, type IngestRecord, type Industry, type JourneyStage,
} from "@avispl/shared";
import { SOURCES, getSource, isTruncated, type ManifestEntry } from "./sources";
import { canScrape, type RawScrape } from "./scrape";
import {
  cleanMarkdown, findRepeatedBlocks, repairHeadings, visibleText, leakageSignals, parseCaseStudyLabels, sectionRelevance, stageForHeading,
  type CaseLabel, type CleanResult,
} from "./clean";
import { MIN_SUBSTANTIVE_WORDS, chunkSections, isLinkOnly, isThin, parseSections, substantiveWords, stableId, withBreadcrumb, type Chunk } from "./split";
import { applyRelations } from "./relations";
import { TAG_FIELDS, tagInputFromBody, tagRecord, type RecordTags } from "./tagger";
import { splitList } from "@avispl/shared";
import type { PdfExtract } from "./pdf";
import { DATA_DIR, PDF_DIR, RAW_DIR, REPORTS_DIR, REVIEW_DIR } from "./paths";

const SCRAPE_ERRORS_FILE = join(REPORTS_DIR, "scrape-errors.json");

export const APPROVALS_FILE = join(REVIEW_DIR, "approvals.json");
export type Approvals = Record<string, string>; // record id -> approved contentHash

/** Shorten at a word boundary within n chars. Never adds an ellipsis ("…" would look like a truncated citation). */
export const clip = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n + 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.5 ? cut.slice(0, sp) : t.slice(0, n)).replace(/[\s,;:–—-]+$/, "");
};
const day = (iso: unknown): string => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : "");
export const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const DISCLOSURE_RE = /\b(copilot|microsoft places|teams premium)\b/i;

export function pageTitleOf(source: ManifestEntry, raw?: Pick<RawScrape, "metadata">): string {
  const t = typeof raw?.metadata?.title === "string" ? (raw.metadata.title as string) : "";
  const cleaned = t.replace(/\s+[|\-–]\s+AVI-SPL\b.*$/i, "").trim();
  return clip(cleaned || source.title, 160);
}

export interface MetaInput {
  source: ManifestEntry;
  stage: JourneyStage;
  url: string;
  pageTitle: string;
  section: string;
  body: string;
  relevant: boolean;
  lastModified?: string;
  lastCrawled: string;
  labels?: Partial<Record<CaseLabel, string>>;
  pageRange?: string;
  edition?: string;
  /** Per-record override of the source's curated industry (PDF page ranges holding a case study). */
  industry?: Industry;
}

/**
 * Section tags for one record: the source's identity tags (`always`) plus what the tagger finds in this
 * record's own heading path + body. The page title in the breadcrumb is not read. Pure function of the
 * record text and the manifest, so the report can recompute provenance from a finished record.
 */
export const recordTags = (source: ManifestEntry, body: string, pageTitle: string): RecordTags =>
  tagRecord(source.always, tagInputFromBody(body, pageTitle));

export function buildMetadata(m: MetaInput): ChunkMetadata {
  const d = m.source.defaults ?? {};
  const tags = recordTags(m.source, m.body, m.pageTitle).values;
  return {
    ...EMPTY_METADATA_DEFAULTS,
    journey_stage: m.stage,
    content_type: m.source.contentType,
    platforms: tags.platforms,
    vendors: tags.vendors,
    topics: tags.topics,
    room_sizes: tags.room_sizes,
    industry: m.industry ?? m.source.industry ?? "general",
    status: "needs_review",
    meeting_room_relevant: m.relevant,
    // Per record, like the tags: only sections that actually talk about Copilot, Teams Premium or Places carry the
    // licensing flag. A source-level default would put the disclosure under unrelated answers (e.g. monitoring).
    requires_disclosure: DISCLOSURE_RE.test(m.body) || /(^|,)(copilot|places|teams_premium)(,|$)/.test(tags.topics),
    legacy_platform: Boolean(d.legacy_platform),
    metrics_are_estimates: Boolean(d.metrics_are_estimates),
    edition: clip(m.edition ?? d.edition ?? "", 16),
    source_url: m.url,
    page_title: clip(m.pageTitle, 160),
    section: clip(m.section, 160),
    page_range: clip(m.pageRange ?? "", 16),
    last_modified: m.lastModified ?? "",
    cs_organization: clip(d.cs_organization ?? m.labels?.organization ?? "", 160),
    cs_location: clip(d.cs_location ?? m.labels?.location ?? "", 80),
    cs_rooms_count: d.cs_rooms_count ?? 0,
    last_crawled: m.lastCrawled,
  };
}

/** Throws with a precise message if a record breaks the contract. */
export function validateRecord(r: IngestRecord): void {
  const parsed = ChunkMetadataSchema.strict().safeParse(r.metadata);
  if (!parsed.success) throw new Error(`${r.sourceId} ${r.id}: metadata invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  if (isTruncated(r.url)) throw new Error(`${r.sourceId} ${r.id}: truncated url`);
  if (r.url !== r.metadata.source_url) throw new Error(`${r.sourceId} ${r.id}: url != metadata.source_url`);
  const bytes = Buffer.byteLength(JSON.stringify(r.additional), "utf8");
  if (bytes >= ADDITIONAL_METADATA_MAX_BYTES) throw new Error(`${r.sourceId} ${r.id}: additional is ${bytes} bytes (max ${ADDITIONAL_METADATA_MAX_BYTES - 1})`);
  const leaked = ["priority", "goldenQueries", "golden_queries"].filter((k) => k in r.metadata || k in r.additional);
  if (leaked.length) throw new Error(`${r.sourceId} ${r.id}: local-only fields leaked: ${leaked.join(",")}`);
  if (!r.body.trim()) throw new Error(`${r.sourceId} ${r.id}: empty body`);
}

function fitAdditional(a: AdditionalMetadata): AdditionalMetadata {
  const out: AdditionalMetadata = { ...a };
  while (Buffer.byteLength(JSON.stringify(out), "utf8") >= ADDITIONAL_METADATA_MAX_BYTES && out.crawlNotes) {
    out.crawlNotes = out.crawlNotes.length > 40 ? clip(out.crawlNotes, Math.floor(out.crawlNotes.length * 0.8)) : undefined;
    if (!out.crawlNotes) delete out.crawlNotes;
  }
  return out;
}

export interface PageBuild {
  records: IngestRecord[];
  clean: CleanResult;
  labels: Partial<Record<CaseLabel, string>>;
  chunks: Chunk[];
  droppedSections: string[];
  uncertainSections: string[];
  linkOnlySections: string[];
  thinSections: string[];
  headingRepairs: number;
  unmatchedHeadings: string[];
  leakage: string[];
}

export function buildPageRecords(source: ManifestEntry, raw: RawScrape, repeated: Set<string> = new Set()): PageBuild {
  if (!source.url) throw new Error(`${source.id}: no url`);
  const url = source.url;
  const fixed = repairHeadings(raw.markdown, raw.html);
  const clean = cleanMarkdown(fixed.markdown, repeated);
  let md = clean.markdown;
  let labels: Partial<Record<CaseLabel, string>> = {};
  if (source.contentType === "case_study") {
    ({ labels, body: md } = parseCaseStudyLabels(md));
    // Page label values (except MARKET, which is unreliable) stay retrievable, reformatted not reworded.
    const glance = (["organization", "location", "services", "solution"] as const)
      .filter((k) => labels[k]).map((k) => `${k[0]!.toUpperCase()}${k.slice(1)}: ${labels[k]}`);
    if (glance.length) md = `**At a glance.** ${glance.join(" · ")}\n\n${md}`;
  }
  const pageTitle = pageTitleOf(source, raw);
  const partial = source.status === "partial_scope";
  const sections = parseSections(md, pageTitle, {
    defaultStage: source.stage,
    stageFor: source.contentType === "case_study" ? (h) => stageForHeading(h, source.stage) : undefined,
    relevanceFor: partial ? sectionRelevance : undefined,
  });
  const droppedSections = sections.filter((s) => s.relevance === "drop").map((s) => s.heading ?? "Overview");
  const linkOnlySections = sections.filter((s) => s.relevance !== "drop" && isLinkOnly(s)).map((s) => s.heading ?? "Overview");
  const thinSections = sections
    .filter((s) => s.relevance !== "drop" && !isLinkOnly(s) && isThin(s))
    .map((s) => `${s.heading} (${substantiveWords(s)} words: "${visibleText(s.blocks.slice(1).join(" ")).slice(0, 100)}")`);
  const chunks = chunkSections(sections, pageTitle);
  const lastCrawled = day(raw.scrapedAt);
  const lastModified = day(raw.metadata.modifiedTime) || day(raw.metadata["article:modified_time"]) || "";
  const notes: string[] = [];
  if (labels.market) notes.push(`page MARKET label "${labels.market}" ignored; industry curated`);
  const records = chunks.map((c): IngestRecord => {
    const body = withBreadcrumb(pageTitle, c);
    const metadata = buildMetadata({
      source, stage: c.stage, url, pageTitle, section: c.section, body, relevant: c.relevance === "keep",
      lastModified, lastCrawled, labels,
    });
    return {
      id: stableId(url, c.slug), sourceId: source.id, title: `${pageTitle} › ${c.sectionPath}`, url, body, metadata,
      additional: fitAdditional({ contentHash: sha1(body), ...(notes.length ? { crawlNotes: notes.join(" | ") } : {}) }),
      relationIds: [],
      timestamp: (typeof raw.metadata.modifiedTime === "string" && raw.metadata.modifiedTime) || raw.scrapedAt,
    };
  });
  return {
    records, clean, labels, chunks, droppedSections, linkOnlySections, thinSections, headingRepairs: fixed.repaired, unmatchedHeadings: fixed.unmatched,
    uncertainSections: chunks.filter((c) => c.relevance === "uncertain").map((c) => c.sectionPath),
    leakage: leakageSignals(md),
  };
}

export function buildPdfRecords(source: ManifestEntry, x: PdfExtract): IngestRecord[] {
  if (isTruncated(x.url)) throw new Error(`${source.id}: truncated url`);
  return x.sections.map((sec) => {
    const body = `${source.title} › ${sec.title}\n\n${sec.text}\n`;
    const metadata = buildMetadata({
      source, stage: sec.stage ?? source.stage, url: x.url, pageTitle: source.title, section: sec.title, body, relevant: true,
      lastCrawled: day(x.extractedAt), pageRange: sec.page_range, edition: x.edition, industry: sec.industry,
    });
    return {
      id: stableId(x.url, `pages-${sec.page_range}`), sourceId: source.id, title: `${source.title} › ${sec.title}`,
      url: x.url, body, metadata, additional: { contentHash: sha1(body) }, relationIds: [], timestamp: x.extractedAt,
    };
  });
}

const SUPPORT_RE = /\b(support|help ?desk|service desk|contact|ticket|portal|escalat|incident|24\/7|24x7|remote|on-?site|response)\b/i;

/**
 * "How to get support": quoted sections of Support and Maintenance only (no invented phone numbers/hours),
 * plus the Help Desk portal URL from the manifest with its login note.
 */
export function buildSupportHowto(derived: ManifestEntry, from: PageBuild, fromSource: ManifestEntry): IngestRecord | null {
  const picked = from.chunks.filter((c) => SUPPORT_RE.test(c.sectionPath) || SUPPORT_RE.test(c.body));
  if (!picked.length || !derived.url) return null;
  const helpDesk = getSource("help-desk");
  const body = [
    `${derived.title} › From ${fromSource.title}`,
    `The text below is quoted from the AVI-SPL ${fromSource.title} page (${fromSource.url}).`,
    ...picked.map((c) => c.body),
    helpDesk?.url ? `AVI-SPL Help Desk portal (customer login required): ${helpDesk.url}` : "",
  ].filter(Boolean).join("\n\n") + "\n";
  const base = from.records[0];
  const metadata = buildMetadata({
    source: derived, stage: derived.stage, url: derived.url, pageTitle: derived.title, section: `From ${fromSource.title}`,
    body, relevant: true, lastModified: base?.metadata.last_modified ?? "", lastCrawled: base?.metadata.last_crawled ?? "",
  });
  return {
    id: stableId(derived.url, "support-howto"), sourceId: derived.id, title: `${derived.title} › From ${fromSource.title}`,
    url: derived.url, body, metadata, additional: { contentHash: sha1(body), parentUrl: fromSource.url ?? undefined },
    relationIds: [], ...(base?.timestamp ? { timestamp: base.timestamp } : {}),
  };
}

export function applyApprovals(records: IngestRecord[], approvals: Approvals): number {
  let n = 0;
  for (const r of records) {
    if (approvals[r.id] && approvals[r.id] === r.additional.contentHash) {
      r.metadata.status = "published";
      n++;
    }
  }
  return n;
}

async function readJson<T>(f: string): Promise<T> {
  return JSON.parse(await readFile(f, "utf8")) as T;
}

async function main() {
  const rawFiles = existsSync(RAW_DIR) ? (await readdir(RAW_DIR)).filter((f) => f.endsWith(".json")) : [];
  const raws = new Map<string, RawScrape>();
  for (const f of rawFiles) {
    const r = await readJson<RawScrape>(join(RAW_DIR, f));
    if (f === `${r.id}.json`) raws.set(r.id, r); // ignore A/B variants like <id>.nomain.json
  }
  const pdfs = new Map<string, PdfExtract>();
  if (existsSync(PDF_DIR)) for (const f of (await readdir(PDF_DIR)).filter((x) => x.endsWith(".json"))) {
    const x = await readJson<PdfExtract>(join(PDF_DIR, f));
    pdfs.set(x.sourceId, x);
  }
  const avisplPages = [...raws.values()].filter((r) => /(^|\.)avispl\.com$/.test(new URL(r.url).hostname)).map((r) => r.markdown);
  const repeated = findRepeatedBlocks(avisplPages);

  const scrapeErrors: Record<string, { at: string; error: string }> = existsSync(SCRAPE_ERRORS_FILE)
    ? await readJson(SCRAPE_ERRORS_FILE) : {};
  const records: IngestRecord[] = [];
  const skipped: { s: ManifestEntry; reason: string }[] = [];
  const builds = new Map<string, PageBuild>();
  const errors: string[] = [];

  for (const s of SOURCES) {
    if (s.derivedFrom) continue;
    const pdf = pdfs.get(s.id);
    if (pdf) {
      try { records.push(...buildPdfRecords(s, pdf)); } catch (e) { errors.push(String(e)); }
      continue;
    }
    const can = canScrape(s);
    if (!can.ok) { skipped.push({ s, reason: `${can.reason}${s.note ? ` — ${s.note}` : ""}` }); continue; }
    const raw = raws.get(s.id);
    if (!raw) {
      const err = scrapeErrors[s.id];
      skipped.push({ s, reason: err ? `scrape FAILED ${err.at.slice(0, 10)}: ${err.error.slice(0, 160)}` : "not scraped yet (no data/raw file)" });
      continue;
    }
    if (raw.markdown.trim().length < 200) { skipped.push({ s, reason: `scrape too thin (${raw.markdown.length} chars)` }); continue; }
    const b = buildPageRecords(s, raw, repeated);
    builds.set(s.id, b);
    records.push(...b.records);
  }
  for (const s of SOURCES.filter((x) => x.derivedFrom)) {
    const from = builds.get(s.derivedFrom!);
    const fromSource = getSource(s.derivedFrom!);
    const rec = from && fromSource ? buildSupportHowto(s, from, fromSource) : null;
    if (rec) records.push(rec);
    else skipped.push({ s, reason: `derived from ${s.derivedFrom}, which has no records yet` });
  }

  const unresolved = applyRelations(records);
  const approvals: Approvals = existsSync(APPROVALS_FILE) ? await readJson<Approvals>(APPROVALS_FILE) : {};
  const published = applyApprovals(records, approvals);
  for (const r of records) {
    try { validateRecord(r); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
  }
  const ids = new Set<string>();
  for (const r of records) { if (ids.has(r.id)) errors.push(`duplicate record id ${r.id} (${r.sourceId})`); ids.add(r.id); }

  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, RECORDS_FILENAME), records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""));
  await writeFile(join(REPORTS_DIR, "prepare-report.md"), renderReport({ records, skipped, builds, unresolved, errors, published, repeated: repeated.size }));
  console.log(`records: ${records.length} (published ${published}, needs_review ${records.length - published}) from ${new Set(records.map((r) => r.sourceId)).size} source(s); skipped ${skipped.length}; unresolved relations ${unresolved.length}; errors ${errors.length}`);
  console.log(`wrote ${join(DATA_DIR, RECORDS_FILENAME)} and ${join(REPORTS_DIR, "prepare-report.md")}`);
  if (errors.length) { for (const e of errors) console.error("ERROR:", e); process.exit(1); }
}

/** The page title exactly as used in the record's breadcrumb line (`metadata.page_title` may be clipped). */
const pageTitleFromRecord = (r: IngestRecord): string => {
  const first = r.body.split("\n", 1)[0] ?? "";
  return first.startsWith(`${r.metadata.page_title} › `) || first === r.metadata.page_title ? r.metadata.page_title : (first.split(" › ")[0] ?? "");
};

function renderReport(x: {
  records: IngestRecord[]; skipped: { s: ManifestEntry; reason: string }[]; builds: Map<string, PageBuild>;
  unresolved: string[]; errors: string[]; published: number; repeated: number;
}): string {
  const L: string[] = [];
  L.push(`# Prepare report`, ``, `Generated ${new Date().toISOString()}. Records: **${x.records.length}** (published ${x.published}, needs_review ${x.records.length - x.published}).`, ``);
  if (!x.records.length) L.push(`> No records: no source has scraped content yet. See "Skipped sources".`, ``);
  L.push(`## Records per source`, ``, `| # | source | records | words (min/max) | stages | relevant=false |`, `|---|---|---|---|---|---|`);
  const bySource = new Map<string, IngestRecord[]>();
  for (const r of x.records) bySource.set(r.sourceId, [...(bySource.get(r.sourceId) ?? []), r]);
  for (const [id, rs] of bySource) {
    const ws = rs.map((r) => r.body.split(/\s+/).filter(Boolean).length);
    L.push(`| ${getSource(id)?.n ?? ""} | ${id} | ${rs.length} | ${Math.min(...ws)}/${Math.max(...ws)} | ${[...new Set(rs.map((r) => r.metadata.journey_stage))].join(", ")} | ${rs.filter((r) => !r.metadata.meeting_room_relevant).length} |`);
  }
  L.push(``, `## Records per stage`, ``);
  const byStage = new Map<string, number>();
  for (const r of x.records) byStage.set(r.metadata.journey_stage, (byStage.get(r.metadata.journey_stage) ?? 0) + 1);
  for (const [k, v] of byStage) L.push(`- ${k}: ${v}`);
  L.push(``, `## Tags per record`, ``,
    `Rule: tags = source \`always\` (identity, shown in **bold**) + tags detected in the record's own heading path and body (src/tagger.ts).`, ``,
    `| source | section | platforms | vendors | topics | room_sizes |`, `|---|---|---|---|---|---|`);
  for (const r of x.records) {
    const src = getSource(r.sourceId);
    const idn = src ? recordTags(src, r.body, pageTitleFromRecord(r)).identity : undefined;
    const cell = (f: (typeof TAG_FIELDS)[number]) =>
      splitList(r.metadata[f]).map((t) => (idn?.[f].includes(t) ? `**${t}**` : t)).join(", ") || "-";
    L.push(`| ${r.sourceId} | ${r.metadata.section.replace(/\|/g, "/")} | ${TAG_FIELDS.map(cell).join(" | ")} |`);
  }
  L.push(``, `### Expected tags no section produced`, ``,
    `Manifest \`expect\` is report-only. A tag listed here was expected somewhere in the source but neither an identity tag nor detected in any record: check the scrape for a missing section, or the tagger for a missing alias.`, ``);
  const gaps: string[] = [];
  for (const [id, rs] of bySource) {
    const src = getSource(id);
    for (const f of TAG_FIELDS) {
      const have = new Set(rs.flatMap((r) => splitList(r.metadata[f])));
      const missing = splitList(src?.expect?.[f]).filter((t) => !have.has(t));
      if (missing.length) gaps.push(`- ${id}: ${f} ${missing.join(", ")}`);
    }
  }
  L.push(...(gaps.length ? gaps : ["- none"]));
  L.push(``, `## Cleaning and structure per scraped page`, ``, `Repeated cross-page blocks detected: ${x.repeated}.`, ``);
  for (const [id, b] of x.builds) {
    const kinds = new Map<string, number>();
    for (const r of b.clean.removed) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
    L.push(`### ${id}`, ``,
      `- removed blocks: ${[...kinds].map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
      `- headings repaired from DOM: ${b.headingRepairs}; possibly still glued (no DOM match): ${b.unmatchedHeadings.join("; ") || "none"}`,
      `- records: ${b.chunks.map((c) => `"${c.section}" (${c.words}w, ${c.stage}${c.relevance === "uncertain" ? ", relevant=false" : ""})`).join("; ")}`,
      `- leakage signals after cleaning: ${b.leakage.join("; ") || "none"}`);
    if (Object.keys(b.labels).length) L.push(`- case-study labels: ${Object.entries(b.labels).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}`);
    if (b.droppedSections.length) L.push(`- partial_scope dropped sections: ${b.droppedSections.join("; ")}`);
    if (b.linkOnlySections.length) L.push(`- link-only sections dropped (teasers/CTAs): ${b.linkOnlySections.join("; ")}`);
    if (b.thinSections.length) L.push(`- thin sections dropped (< ${MIN_SUBSTANTIVE_WORDS} substantive words): ${b.thinSections.join("; ")}`);
    const content = b.clean.removed.filter((r) => ["cta_block", "eyebrow", "counter", "cta_only", "card_links", "empty_heading", "duplicate", "form", "state_list", "nav_links"].includes(r.kind));
    if (content.length) {
      L.push(`- dropped content-area blocks (buttons, CTAs, fragments, duplicates, forms; logos/images counted above):`);
      for (const r of content) L.push(`  - ${r.kind}: "${r.preview.replace(/\|/g, "/")}"`);
    }
    L.push(``);
  }
  L.push(`## Skipped sources`, ``, `| # | source | status | reason |`, `|---|---|---|---|`);
  for (const { s, reason } of x.skipped) L.push(`| ${s.n} | ${s.id} | ${s.status} | ${reason.replace(/\|/g, "/")} |`);
  L.push(``, `## Unresolved forceful relations (target has no records yet)`, ``);
  L.push(...(x.unresolved.length ? x.unresolved.map((u) => `- ${u}`) : ["- none"]));
  if (x.errors.length) L.push(``, `## Errors`, ``, ...x.errors.map((e) => `- ${e}`));
  return L.join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
