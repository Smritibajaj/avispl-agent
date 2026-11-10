import { EMPTY_METADATA_DEFAULTS, type ChunkMetadata, type IngestRecord } from "@avispl/shared";

/**
 * SYNTHETIC fixtures for offline tests (mock server). Not AVI-SPL content: every body says so, every URL is
 * on the reserved `.example` domain, and nothing here may be ingested into a real database except through
 * the smoke script (which builds its own records, status needs_review, section "SMOKE TEST").
 */
const BASE = "https://synthetic.example/fixtures";

function rec(
  id: string,
  sourceId: string,
  meta: Partial<ChunkMetadata> & Pick<ChunkMetadata, "journey_stage" | "content_type" | "section">,
  body: string,
  relationIds: string[] = [],
): IngestRecord {
  const url = `${BASE}/${sourceId}`;
  const metadata: ChunkMetadata = {
    ...EMPTY_METADATA_DEFAULTS,
    status: "published",
    source_url: url,
    page_title: `Synthetic page ${sourceId}`,
    last_crawled: "2026-11-10",
    ...meta,
  };
  return {
    id,
    sourceId,
    title: `Synthetic › ${meta.section}`,
    url,
    body: `SYNTHETIC FIXTURE (not AVI-SPL content).\n\n${body}`,
    metadata,
    additional: { contentHash: `sha1-${id}` },
    relationIds,
    timestamp: "2026-11-01T00:00:00Z",
  };
}

export const SYNTHETIC_RECORDS: IngestRecord[] = [
  rec(
    "fx-plan-small",
    "fx-plan-rooms",
    { journey_stage: "plan_design", content_type: "page", section: "Small and medium rooms", platforms: "microsoft", topics: "meeting_equity,standardization", room_sizes: "small,medium" },
    "Zebrafruit planning notes for small rooms and medium rooms. Camera framing and microphone pickup keep remote participants equal.",
    ["fx-plan-guide"],
  ),
  rec(
    "fx-plan-large",
    "fx-plan-rooms",
    { journey_stage: "plan_design", content_type: "page", section: "Large rooms", platforms: "microsoft,cisco", topics: "meeting_equity", room_sizes: "large" },
    "Zebrafruit planning notes for large rooms with multiple displays and ceiling microphones.",
  ),
  rec(
    "fx-plan-guide",
    "fx-plan-guide",
    { journey_stage: "plan_design", content_type: "ebook", section: "Standardization guide", topics: "standardization" },
    "Quokkaberry standardization guide: repeatable room templates across sites.",
  ),
  rec(
    "fx-platform-ms",
    "fx-platform",
    { journey_stage: "choose_platform", content_type: "page", section: "Platform choice", platforms: "microsoft,cisco", vendors: "logitech,neat", topics: "copilot,places", requires_disclosure: true },
    "Platform notes: the synthetic part number MTRX-4242 appears only here. This one names no fruit.",
  ),
  rec(
    "fx-proof-legacy",
    "fx-proof",
    { journey_stage: "proof", content_type: "case_study", section: "Legacy case", industry: "financial_services", legacy_platform: true, cs_organization: "Synthetic Bank", cs_rooms_count: 40 },
    "Zebrafruit case study from a synthetic bank with forty rooms on a legacy platform.",
  ),
  rec(
    "fx-run-support",
    "fx-run",
    { journey_stage: "run_support", content_type: "support_info", section: "Support", topics: "monitoring,support_maintenance" },
    "Monitoring and escalation notes for synthetic rooms.",
  ),
  // Must NEVER be returned by the store (hard filters):
  rec(
    "fx-unpublished",
    "fx-hidden",
    { journey_stage: "plan_design", content_type: "page", section: "Unpublished draft", status: "needs_review", room_sizes: "small" },
    "Zebrafruit zebrafruit zebrafruit draft that is not published.",
  ),
  rec(
    "fx-offscope",
    "fx-hidden",
    { journey_stage: "plan_design", content_type: "page", section: "Video wall (off scope)", meeting_room_relevant: false, room_sizes: "small" },
    "Zebrafruit zebrafruit video wall content that is off scope.",
  ),
  // Four records of ONE source: the store must keep at most 3.
  ...[1, 2, 3, 4].map((n) =>
    rec(`fx-cap-${n}`, "fx-cap-source", { journey_stage: "deploy", content_type: "page", section: `Cap section ${n}`, topics: "deployment" }, `Wombatcap deployment section number ${n}.`),
  ),
];
