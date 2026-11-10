import { z } from "zod";
import {
  CONTENT_TYPES,
  INDUSTRIES,
  JOURNEY_STAGES,
  STATUSES,
} from "./vocab";

/**
 * HydraDB v2 `database_metadata_schema`, as verified against
 * https://docs.hydradb.com/essentials/v2/metadata.md (2026-11-10):
 *  - declared at database creation; later changes are ADDITIVE ONLY (no rename/retype/reflag)
 *  - embedding flags can only be set at creation, only on VARCHAR, max 6 flags total
 *  - max 32 fields; undeclared `metadata` keys are REJECTED on ingest
 *  - `metadata` <= 16 KiB per item, `additional_metadata` <= 1 KiB per item
 *  - arrays are NOT supported -> comma-joined VARCHAR + `contains` / `contains_any`
 *  - chunk results return `metadata`, so every citation field lives here
 */
export interface MetadataFieldDef {
  name: string;
  data_type: "VARCHAR" | "BOOL" | "INT32";
  max_length?: number;
  enable_dense_embedding?: boolean;
  enable_sparse_embedding?: boolean;
  /** Human note, not sent to HydraDB. */
  purpose: string;
}

export const HYDRA_METADATA_SCHEMA: MetadataFieldDef[] = [
  { name: "journey_stage", data_type: "VARCHAR", max_length: 32, purpose: "main filter (JourneyStage)" },
  { name: "content_type", data_type: "VARCHAR", max_length: 32, purpose: "filter (ContentType)" },
  { name: "platforms", data_type: "VARCHAR", max_length: 64, purpose: "comma list; contains_any" },
  { name: "vendors", data_type: "VARCHAR", max_length: 256, purpose: "comma list" },
  { name: "topics", data_type: "VARCHAR", max_length: 256, purpose: "comma list" },
  { name: "room_sizes", data_type: "VARCHAR", max_length: 128, purpose: "comma list" },
  { name: "industry", data_type: "VARCHAR", max_length: 32, purpose: "from manual URL map, NOT the page's MARKET field" },
  { name: "status", data_type: "VARCHAR", max_length: 16, purpose: "published | needs_review; queries always send published" },
  { name: "meeting_room_relevant", data_type: "BOOL", purpose: "hard filter; false for off-scope sections" },
  { name: "requires_disclosure", data_type: "BOOL", purpose: "Copilot / Places / Teams Premium chunks" },
  { name: "legacy_platform", data_type: "BOOL", purpose: "Skype for Business / Polycom era proof" },
  { name: "metrics_are_estimates", data_type: "BOOL", purpose: "e.g. Bernalillo analytics + client estimates" },
  { name: "edition", data_type: "VARCHAR", max_length: 16, purpose: "PDFs: 2021 | 2024-25 | 2025-winter" },
  { name: "source_url", data_type: "VARCHAR", max_length: 512, purpose: "citation (exact URL, never truncated)" },
  { name: "page_title", data_type: "VARCHAR", max_length: 160, purpose: "citation" },
  {
    name: "section",
    data_type: "VARCHAR",
    max_length: 160,
    enable_dense_embedding: true,
    enable_sparse_embedding: true,
    purpose: "citation + searchable heading (uses 2 of 6 embedding flags)",
  },
  { name: "page_range", data_type: "VARCHAR", max_length: 16, purpose: "PDF citation, e.g. 41-47" },
  { name: "last_modified", data_type: "VARCHAR", max_length: 10, purpose: "YYYY-MM-DD from page metadata" },
  { name: "cs_organization", data_type: "VARCHAR", max_length: 160, purpose: "case study" },
  { name: "cs_location", data_type: "VARCHAR", max_length: 80, purpose: "case study" },
  { name: "cs_rooms_count", data_type: "INT32", purpose: "case study; used for sorting in code" },
  { name: "last_crawled", data_type: "VARCHAR", max_length: 10, purpose: "freshness, YYYY-MM-DD" },
];

/** Runtime validation for `metadata` on every ingested record. */
export const ChunkMetadataSchema = z.object({
  journey_stage: z.enum(JOURNEY_STAGES),
  content_type: z.enum(CONTENT_TYPES),
  platforms: z.string().max(64),
  vendors: z.string().max(256),
  topics: z.string().max(256),
  room_sizes: z.string().max(128),
  industry: z.enum(INDUSTRIES),
  status: z.enum(STATUSES),
  meeting_room_relevant: z.boolean(),
  requires_disclosure: z.boolean(),
  legacy_platform: z.boolean(),
  metrics_are_estimates: z.boolean(),
  edition: z.string().max(16),
  source_url: z.string().url().max(512).refine((u) => !u.includes("…") && !u.includes("..."), "truncated URL"),
  page_title: z.string().max(160),
  section: z.string().max(160),
  page_range: z.string().max(16),
  last_modified: z.string().max(10),
  cs_organization: z.string().max(160),
  cs_location: z.string().max(80),
  cs_rooms_count: z.number().int(),
  last_crawled: z.string().max(10),
});
export type ChunkMetadata = z.infer<typeof ChunkMetadataSchema>;

/** Empty/default values so every key is always present (HydraDB rejects missing types, not missing keys, but we keep rows uniform). */
export const EMPTY_METADATA_DEFAULTS = {
  platforms: "",
  vendors: "",
  topics: "",
  room_sizes: "",
  edition: "",
  page_range: "",
  last_modified: "",
  cs_organization: "",
  cs_location: "",
  cs_rooms_count: 0,
  requires_disclosure: false,
  legacy_platform: false,
  metrics_are_estimates: false,
  meeting_room_relevant: true,
  status: "needs_review",
  industry: "general",
} as const;

/** Soft cap for `additional_metadata` (HydraDB hard cap is 1024 bytes of compact JSON). */
export interface AdditionalMetadata {
  contentHash: string;
  parentUrl?: string;
  crawlNotes?: string;
}
export const ADDITIONAL_METADATA_MAX_BYTES = 1024;
