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
  cleanMarkdown, cleanPdfPageText, findRepeatedBlocks, repairHeadings, visibleText, leakageSignals, parseCaseStudyLabels, sectionRelevance, stageForHeading,
  type CaseLabel, type CleanResult,
} from "./clean";
import { MIN_SUBSTANTIVE_WORDS, chunkSections, clipName, isLinkOnly, isThin, parseSections, substantiveWords, stableId, withBreadcrumb, type Chunk, type SplitEvent } from "./split";
import { applyRelations } from "./relations";
import { TAG_FIELDS, detectIndustry, detectStage, tagInputFromBody, tagRecord, type RecordTags } from "./tagger";
import { ROOM_SIZES, splitList } from "@avispl/shared";
import type { PdfExtract } from "./pdf";
import { CONFIG_DIR, DATA_DIR, PDF_DIR, RAW_DIR, REPORTS_DIR, REVIEW_DIR } from "./paths";
import { PREP, prepRaw } from "./new-prep";

/** Sources numbered from here on (added 2026-11-11) get the page-specific repairs of new-prep.ts before cleaning. */
export const PREP_FROM_N = 64;

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

/**
 * Stage of one record. The page (or page range, or case-study heading) gives the default; a record that is plainly
 * about deployment/training or about monitoring/managed services/support gets that stage (tagger.detectStage).
 * Case-study and proof material is never moved by its text: `findCaseStudies` looks for stage "proof".
 */
export function stageForRecord(m: Pick<MetaInput, "source" | "stage" | "body" | "pageTitle">): JourneyStage {
  if (m.source.contentType === "case_study" || m.source.derivedFrom) return m.stage;
  if (m.stage === "proof" && m.source.contentType !== "industry_page") return m.stage;
  return detectStage(tagInputFromBody(m.body, m.pageTitle))?.stage ?? m.stage;
}

/**
 * Room-size tags added by hand in data/config/manual-tags.json (keyed by record id), merged with what the tagger
 * found. They steer search filters only; the record text is untouched. An id that no longer exists is ignored.
 */
export async function applyManualTags(records: IngestRecord[]): Promise<number> {
  const file = join(CONFIG_DIR, "manual-tags.json");
  if (!existsSync(file)) return 0;
  const { tags } = JSON.parse(await readFile(file, "utf8")) as { tags: Record<string, { room_sizes?: string[] }> };
  let n = 0;
  for (const r of records) {
    const add = tags[r.id]?.room_sizes;
    if (!add?.length) continue;
    const have = new Set([...splitList(r.metadata.room_sizes), ...add]);
    const merged = ROOM_SIZES.filter((v) => have.has(v)).join(",");
    if (merged !== r.metadata.room_sizes) n++;
    r.metadata.room_sizes = merged;
  }
  return n;
}

export function buildMetadata(m: MetaInput): ChunkMetadata {
  const d = m.source.defaults ?? {};
  const tags = recordTags(m.source, m.body, m.pageTitle).values;
  // The manifest's curated industry wins; a record of a general page gets one only when its own heading names it.
  const industry = m.industry ?? m.source.industry ?? detectIndustry(tagInputFromBody(m.body, m.pageTitle)) ?? "general";
  return {
    ...EMPTY_METADATA_DEFAULTS,
    journey_stage: stageForRecord(m),
    content_type: m.source.contentType,
    platforms: tags.platforms,
    vendors: tags.vendors,
    topics: tags.topics,
    room_sizes: tags.room_sizes,
    industry,
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
    section: clipName(m.section, 160),
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
  // HydraDB counts VARCHAR max_length in bytes; zod counts characters
  for (const [k, max] of [["section", 160], ["page_title", 160]] as const) {
    const n = Buffer.byteLength(r.metadata[k], "utf8");
    if (n > max) throw new Error(`${r.sourceId} ${r.id}: metadata.${k} is ${n} bytes (max ${max})`);
  }
}

function fitAdditional(a: AdditionalMetadata): AdditionalMetadata {
  const out: AdditionalMetadata = { ...a };
  while (Buffer.byteLength(JSON.stringify(out), "utf8") >= ADDITIONAL_METADATA_MAX_BYTES && out.crawlNotes) {
    out.crawlNotes = out.crawlNotes.length > 40 ? clip(out.crawlNotes, Math.floor(out.crawlNotes.length * 0.8)) : undefined;
    if (!out.crawlNotes) delete out.crawlNotes;
  }
  return out;
}

/**
 * Sections reviewed by hand that hold no fact a customer could use (viewer instructions). Dropped by exact heading.
 * Keep this list short: structure rules in clean.ts / split.ts handle everything that can be recognised generally.
 */
export const NO_FACT_SECTIONS: Record<string, { section: string; reason: string }[]> = {
  "concept-catalog-landing": [{ section: "View the digital magazine", reason: "only tells the reader where to click to open the flip-book viewer" }],
};

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
  events: SplitEvent[];
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
  const events: SplitEvent[] = [];
  const noFact = NO_FACT_SECTIONS[source.id] ?? [];
  const chunks = chunkSections(sections, pageTitle, { events, relevanceFor: partial ? sectionRelevance : undefined }).filter((c) => {
    const hit = noFact.find((x) => x.section === c.section);
    if (hit) events.push({ kind: "dropped_thin", section: c.section, words: c.words, text: `no usable fact: ${hit.reason}` });
    return !hit;
  });
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
    leakage: leakageSignals(md), events,
  };
}

/** Pages under this many words (title pages, a lone pull quote) join the page next to them. */
export const PDF_MIN_PAGE_WORDS = 60;

export interface PdfPageGroup { from: number; to: number; text: string }

/**
 * One record per PDF page (cleaned), so a citation points at the page. A page under PDF_MIN_PAGE_WORDS joins the
 * following page of the same range (the last one joins the page before it).
 */
export function pdfPageGroups(text: string, pageRange: string): PdfPageGroup[] {
  const [first, lastOfRange = first] = pageRange.split("-").map(Number) as [number, number?];
  const parts = text.split(/<!--\s*page (\d+)\s*-->/);
  // no page markers: the text cannot be attributed to single pages, so it stays one record for the whole range
  if (parts.length === 1) return [{ from: first, to: lastOfRange, text: cleanPdfPageText(text) }];
  const pages: PdfPageGroup[] = [];
  if (parts[0]?.trim()) pages.push({ from: first, to: first, text: cleanPdfPageText(parts[0]) });
  for (let i = 1; i < parts.length; i += 2) {
    const n = Number(parts[i]);
    pages.push({ from: n, to: n, text: cleanPdfPageText(parts[i + 1] ?? "") });
  }
  const wc = (t: string) => t.split(/\s+/).filter(Boolean).length;
  const out: PdfPageGroup[] = [];
  let carry: PdfPageGroup | null = null;
  for (const p of pages.filter((x) => x.text)) {
    const cur: PdfPageGroup = carry ? { from: carry.from, to: p.to, text: `${carry.text}\n${p.text}` } : p;
    carry = null;
    if (wc(cur.text) < PDF_MIN_PAGE_WORDS) { carry = cur; continue; }
    out.push(cur);
  }
  if (carry) {
    const last = out[out.length - 1];
    if (last) out[out.length - 1] = { from: last.from, to: carry.to, text: `${last.text}\n${carry.text}` };
    else out.push(carry);
  }
  return out;
}

/** A PDF page above this many words is split once, at the heading-like line nearest its middle. */
export const PDF_SPLIT_OVER_WORDS = 360;

/**
 * Split one over-long page in two at a heading-like line: a short line without end punctuation that follows a
 * line ending a sentence and is followed by more text. The candidate nearest the middle wins; none -> no split.
 */
export function splitPdfPage(text: string): string[] {
  const lines = text.split("\n");
  const wc = (t: string) => t.split(/\s+/).filter(Boolean).length;
  const total = wc(text);
  if (total <= PDF_SPLIT_OVER_WORDS) return [text];
  const longest = Math.max(...lines.map((l) => l.length));
  let best = -1;
  let bestDist = Infinity;
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!.trim();
    const prev = (lines[i - 1] ?? "").trim();
    const headingLike = i > 0 && i < lines.length - 1 && /^[A-Z]/.test(l) && !/[.,;:!?]$/.test(l) && l.length < longest * 0.75
      && /[.!?]["”’)]?$/.test(prev) && l.split(/\s+/).length <= 14;
    if (headingLike && seen >= 80 && total - seen >= 80) {
      const dist = Math.abs(seen - total / 2);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    seen += wc(l);
  }
  return best < 0 ? [text] : [lines.slice(0, best).join("\n"), lines.slice(best).join("\n")];
}

export function buildPdfRecords(source: ManifestEntry, x: PdfExtract): IngestRecord[] {
  if (isTruncated(x.url)) throw new Error(`${source.id}: truncated url`);
  return x.sections.flatMap((sec) => {
    const pageGroups = pdfPageGroups(sec.text, sec.page_range);
    const groups = pageGroups.flatMap((g) => {
      const parts = splitPdfPage(g.text);
      return parts.map((text, i) => ({ ...g, text, part: parts.length > 1 ? i + 1 : 0 }));
    });
    return groups.map((g) => {
      const range = g.from === g.to ? `${g.from}` : `${g.from}-${g.to}`;
      const part = g.part > 1 ? `, part ${g.part}` : "";
      // the whole range in one record keeps the range title; otherwise the page is named
      const title = groups.length === 1 ? sec.title : `${sec.title} (${g.from === g.to ? "p." : "pp."} ${range}${part})`;
      const body = `${source.title} › ${title}\n\n${g.text}\n`;
      const metadata = buildMetadata({
        source, stage: sec.stage ?? source.stage, url: x.url, pageTitle: source.title, section: title, body, relevant: true,
        lastCrawled: day(x.extractedAt), pageRange: range, edition: x.edition, industry: sec.industry,
      });
      return {
        id: stableId(x.url, `pages-${range}${g.part > 1 ? `-part-${g.part}` : ""}`), sourceId: source.id, title: `${source.title} › ${title}`,
        url: x.url, body, metadata, additional: { contentHash: sha1(body) }, relationIds: [], timestamp: x.extractedAt,
      };
    });
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
    ...picked.map((c) => `### ${c.section}\n\n${c.body}`),
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

export interface DuplicateDrop { dropped: IngestRecord; keptId: string; keptSource: string; keptSection: string; share: number }

const sentencesOf = (body: string): string[] => {
  const nl = body.indexOf("\n");
  return visibleText(nl === -1 ? "" : body.slice(nl + 1))
    .split(/(?<=[.!?:])\s+/)
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter((t) => t.split(" ").length >= 4);
};

/**
 * The same passage ingested twice (two pages carrying one block, or a page repeating itself): a record is dropped
 * when at least 90% of its sentences (by words) also stand in ONE other record. Of two identical records the first
 * in manifest order stays. Derived records (the hand-assembled "How to get support") are quotations by design
 * and are neither dropped nor used as a reason to drop.
 */
export function dropDuplicates(records: IngestRecord[], isDerived: (sourceId: string) => boolean = () => false): { kept: IngestRecord[]; dropped: DuplicateDrop[] } {
  const sets = records.map((r) => (isDerived(r.sourceId) ? null : sentencesOf(r.body)));
  const dropped: DuplicateDrop[] = [];
  const gone = new Set<number>();
  for (let i = 0; i < records.length; i++) {
    const a = sets[i];
    if (!a || !a.length) continue;
    const total = a.reduce((n, t) => n + t.split(" ").length, 0);
    for (let j = 0; j < records.length; j++) {
      const b = sets[j];
      if (i === j || !b || gone.has(j)) continue;
      const inB = new Set(b);
      const shared = a.filter((t) => inB.has(t)).reduce((n, t) => n + t.split(" ").length, 0);
      const share = shared / total;
      if (share < 0.9) continue;
      const bTotal = b.reduce((n, t) => n + t.split(" ").length, 0);
      const identical = bTotal === total && b.every((t) => a.includes(t));
      if (identical && j > i) continue; // the earlier of two identical records stays
      if (!identical && bTotal < total) continue; // the fuller record stays
      const k = records[j]!;
      dropped.push({ dropped: records[i]!, keptId: k.id, keptSource: k.sourceId, keptSection: k.metadata.section, share });
      gone.add(i);
      break;
    }
  }
  return { kept: records.filter((_, i) => !gone.has(i)), dropped };
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

const argValue = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  // --sources-from <records.jsonl>: build only the sources that have records in that file (a refresh of the
  // existing knowledge base that must not pull in sources someone else is still adding to the manifest).
  const onlyFrom = argValue("--sources-from");
  const only = onlyFrom
    ? new Set((await readFile(onlyFrom, "utf8")).split("\n").filter(Boolean).map((l) => (JSON.parse(l) as IngestRecord).sourceId))
    : null;
  const wanted = (id: string) => !only || only.has(id);
  const rawFiles = existsSync(RAW_DIR) ? (await readdir(RAW_DIR)).filter((f) => f.endsWith(".json")) : [];
  const raws = new Map<string, RawScrape>();
  for (const f of rawFiles) {
    const r = await readJson<RawScrape>(join(RAW_DIR, f));
    if (f === `${r.id}.json` && wanted(r.id)) raws.set(r.id, r); // ignore A/B variants like <id>.nomain.json
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
  const prepNotes = new Map<string, string[]>();

  for (const s of SOURCES) {
    if (s.derivedFrom || !wanted(s.id)) continue;
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
    // Page-specific repairs taken from the page's own DOM (counters, tab widgets) come first; then the shared rules.
    const rule = PREP[s.id];
    const prep = s.n >= PREP_FROM_N || rule ? prepRaw(raw, s.title, rule) : { raw, notes: [] as string[] };
    const b = buildPageRecords(s, prep.raw, repeated);
    if (rule?.dropSections) b.records = b.records.filter((r) => !rule.dropSections!.test(r.metadata.section));
    prepNotes.set(s.id, prep.notes);
    builds.set(s.id, b);
    records.push(...b.records);
  }
  for (const s of SOURCES.filter((x) => x.derivedFrom && wanted(x.id))) {
    const from = builds.get(s.derivedFrom!);
    const fromSource = getSource(s.derivedFrom!);
    const rec = from && fromSource ? buildSupportHowto(s, from, fromSource) : null;
    if (rec) records.push(rec);
    else skipped.push({ s, reason: `derived from ${s.derivedFrom}, which has no records yet` });
  }

  const dedupe = dropDuplicates(records, (id) => Boolean(getSource(id)?.derivedFrom));
  records.length = 0;
  records.push(...dedupe.kept);

  await applyManualTags(records);
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
  await writeFile(join(REPORTS_DIR, "refine-events.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    duplicates: dedupe.dropped.map((d) => ({
      sourceId: d.dropped.sourceId, id: d.dropped.id, section: d.dropped.metadata.section, share: Math.round(d.share * 100) / 100,
      keptId: d.keptId, keptSource: d.keptSource, keptSection: d.keptSection,
    })),
    pages: Object.fromEntries([...builds].map(([id, b]) => [id, {
      events: b.events, prep: prepNotes.get(id) ?? [],
      removed: b.clean.removed.filter((r) => ["media_fallback", "blog_nav", "share_links", "anchor_nav", "related_posts", "logo_caption"].includes(r.kind)),
      linkOnlySections: b.linkOnlySections, thinSections: b.thinSections,
    }])),
  }, null, 2));
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
