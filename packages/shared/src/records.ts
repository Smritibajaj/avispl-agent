import type { ChunkMetadata, AdditionalMetadata } from "./metadata";
import type { ContentType, Industry, JourneyStage } from "./vocab";

/**
 * Status of a source in the manifest. Verified by hand in Chrome on 2026-11-10 unless noted.
 * Only `ready` and `partial_scope` sources may be scraped/ingested automatically.
 */
export type SourceStatus =
  | "ready" // reachable, public, meeting-room content
  | "partial_scope" // reachable but only some sections are meeting-room relevant
  | "page_ranges_needed" // big PDF: only selected page ranges are in scope
  | "needs_resolution" // URL truncated in the brief: resolve via landing page or ask Nancy. NEVER guess.
  | "dead_link" // 404
  | "gated" // behind a form: needs the file from Nancy
  | "login_required" // behind a login: needs an export from AVI-SPL, never scrape
  | "off_scope"; // reachable but not a meeting-room story

export type Priority = "P0" | "P1" | "P2";

export interface SourceEntry {
  /** Stable slug, e.g. "ref-designs-page". */
  id: string;
  /** 1..60 as numbered in docs/plan.original.md section 3. */
  n: number;
  title: string;
  /** Exact URL as given. `null` only when truncated (status needs_resolution) and then `truncatedUrl` is set. */
  url: string | null;
  truncatedUrl?: string;
  stage: JourneyStage;
  /** Extra stages this source also serves (rendered as separate sections when sections map to other stages). */
  alsoStages?: JourneyStage[];
  contentType: ContentType;
  priority: Priority;
  goldenQueries: ("Q1" | "Q2" | "Q3")[]; // LOCAL ONLY, never sent to HydraDB
  status: SourceStatus;
  /** Why this status (what was observed). */
  note?: string;
  industry?: Industry;
  /** Manually curated defaults that apply to all records of this source. */
  defaults?: Partial<
    Pick<
      ChunkMetadata,
      | "platforms"
      | "vendors"
      | "topics"
      | "room_sizes"
      | "legacy_platform"
      | "metrics_are_estimates"
      | "requires_disclosure"
      | "edition"
      | "cs_organization"
      | "cs_location"
      | "cs_rooms_count"
    >
  >;
}

/** One unit sent to HydraDB (one section of a page / a PDF page range). Becomes one `app_knowledge[]` item. */
export interface IngestRecord {
  /** Stable: sha1(canonicalUrl + "#" + sectionSlug). Re-ingest with upsert replaces it. */
  id: string;
  sourceId: string;
  /** "Symphony › Incident management" */
  title: string;
  /** Exact citation URL. Must pass ChunkMetadataSchema (no truncation). */
  url: string;
  /** Markdown. First line is the breadcrumb. Target 300–900 words; tables kept whole. */
  body: string;
  metadata: ChunkMetadata;
  additional: AdditionalMetadata;
  /** Forceful relations (HydraDB `relations.ids`): ids of OTHER records/sources to pull in. Thinking mode only. */
  relationIds: string[];
  /** ISO timestamp for recency ranking (page modified time, else crawl time). */
  timestamp?: string;
}

/** Output file written by packages/ingest and read by packages/hydra: JSONL, one IngestRecord per line. */
export const RECORDS_FILENAME = "records.jsonl";
