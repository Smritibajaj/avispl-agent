import type { ChunkMetadata, GraphTriplet } from "@avispl/shared";
import { EMPTY_METADATA_DEFAULTS } from "@avispl/shared";

/**
 * SYNTHETIC demo fixtures for KNOWLEDGE_BACKEND=mock.
 *
 * Every record is marked "DEMO FIXTURE, not AVI-SPL content". The text is deliberately placeholder
 * wording that describes WHAT a real section would cover, never what AVI-SPL offers or achieved.
 * URLs point at example.com so nothing can be mistaken for (or clicked through to) a real AVI-SPL page.
 * The fixtures exist only to exercise the UI: journey stages, flags, editions, page ranges, a graph,
 * hard filters (an off-scope and an unpublished record) and the three golden-query flows.
 */
export const FIXTURE_MARK = "DEMO FIXTURE, not AVI-SPL content.";

export interface Fixture {
  chunkId: string;
  sourceId: string;
  title: string;
  text: string;
  metadata: ChunkMetadata;
}

const base = (
  partial: Partial<ChunkMetadata> &
    Pick<ChunkMetadata, "journey_stage" | "content_type" | "source_url" | "page_title" | "section">,
): ChunkMetadata => ({
  ...EMPTY_METADATA_DEFAULTS,
  status: "published",
  last_crawled: "2026-11-10",
  last_modified: "2026-01-15",
  ...partial,
});

const url = (slug: string) => `https://example.com/demo-fixture/${slug}`;

export const FIXTURES: Fixture[] = [
  {
    chunkId: "fx-plan-room-patterns#small-medium-large",
    sourceId: "fx-plan-room-patterns",
    title: "[Demo] Room patterns › Small, medium and large rooms",
    text: `${FIXTURE_MARK} Placeholder for a reference-design section. A real record here would list room patterns for small, medium and large meeting rooms on Microsoft Teams, with the design considerations for each size. This fixture states no hardware, capacity, price or compatibility.`,
    metadata: base({
      journey_stage: "plan_design",
      content_type: "page",
      platforms: "microsoft",
      topics: "standardization,hybrid_meetings",
      room_sizes: "small,medium,large",
      source_url: url("room-patterns"),
      page_title: "[Demo] Room patterns",
      section: "Small, medium and large rooms",
    }),
  },
  {
    chunkId: "fx-plan-standardization#scalable-model",
    sourceId: "fx-plan-standardization",
    title: "[Demo] Standardisation guide › Building a repeatable model",
    text: `${FIXTURE_MARK} Placeholder for a standardisation eBook section. A real record here would explain how an organisation with many rooms across several offices can standardise on a small set of room designs, and what to decide before a multi-site rollout and deployment.`,
    metadata: base({
      journey_stage: "plan_design",
      content_type: "ebook",
      topics: "standardization,deployment",
      room_sizes: "small,medium,large",
      source_url: url("standardization-guide"),
      page_title: "[Demo] Standardisation guide",
      section: "Building a repeatable model",
    }),
  },
  {
    chunkId: "fx-plan-equity#remote-participants",
    sourceId: "fx-plan-equity",
    title: "[Demo] Meeting equity › Remote participants",
    text: `${FIXTURE_MARK} Placeholder for a meeting-equity section. A real record here would describe what to think about for remote participants in hybrid meetings: being seen, being heard, and taking part equally with people in the room.`,
    metadata: base({
      journey_stage: "plan_design",
      content_type: "page",
      platforms: "microsoft",
      topics: "meeting_equity,hybrid_meetings,ease_of_use",
      source_url: url("meeting-equity"),
      page_title: "[Demo] Meeting equity",
      section: "Remote participants",
    }),
  },
  {
    chunkId: "fx-plan-designs-pdf#p4-7",
    sourceId: "fx-plan-designs-pdf",
    title: "[Demo] Reference designs PDF (2021 edition) › Room sizes",
    text: `${FIXTURE_MARK} Placeholder for an older PDF edition. A real record here would show reference designs by room size, small, medium and large, from the 2021 edition, which may be superseded by newer material.`,
    metadata: base({
      journey_stage: "plan_design",
      content_type: "pdf",
      platforms: "microsoft",
      topics: "standardization",
      room_sizes: "small,medium,large",
      edition: "2021",
      page_range: "4-7",
      last_modified: "2021-04-01",
      source_url: url("reference-designs-2021.pdf"),
      page_title: "[Demo] Reference designs PDF",
      section: "Room sizes",
    }),
  },
  {
    chunkId: "fx-platform-microsoft#copilot-places",
    sourceId: "fx-platform-microsoft",
    title: "[Demo] Microsoft practice › Copilot and Microsoft Places in Teams Rooms",
    text: `${FIXTURE_MARK} Placeholder for a platform section. A real record here would describe what needs to be in place to use Copilot and Microsoft Places in Teams Rooms. It would include licensing prerequisites such as Teams Premium. This fixture names no licence, price or requirement.`,
    metadata: base({
      journey_stage: "choose_platform",
      content_type: "page",
      platforms: "microsoft",
      topics: "copilot,places,teams_premium,ai_features",
      requires_disclosure: true,
      source_url: url("microsoft-practice"),
      page_title: "[Demo] Microsoft practice",
      section: "Copilot and Microsoft Places in Teams Rooms",
    }),
  },
  {
    chunkId: "fx-platform-ebook#smart-workplace",
    sourceId: "fx-platform-ebook",
    title: "[Demo] Smart workplace interactive eBook › Workplace management with Places",
    text: `${FIXTURE_MARK} Placeholder for an interactive eBook section. A real record here would explain how Microsoft Places and Copilot relate to Teams Rooms and workplace management. It would carry a licensing note that must be shown word for word.`,
    metadata: base({
      journey_stage: "choose_platform",
      content_type: "interactive_ebook",
      platforms: "microsoft",
      topics: "places,copilot,teams_premium",
      requires_disclosure: true,
      source_url: url("smart-workplace-ebook"),
      page_title: "[Demo] Smart workplace interactive eBook",
      section: "Workplace management with Places",
    }),
  },
  {
    chunkId: "fx-proof-cs-alpha#overview",
    sourceId: "fx-proof-cs-alpha",
    title: "[Demo] Case study: Example Org Alpha › Overview",
    text: `${FIXTURE_MARK} Placeholder for a case study. A real record here would say which capabilities were deployed for an organisation, for example Microsoft Teams Rooms standardised across offices. This fixture does not claim that any Copilot or Places deployment happened.`,
    metadata: base({
      journey_stage: "proof",
      content_type: "case_study",
      platforms: "microsoft",
      topics: "standardization,hybrid_meetings,deployment",
      industry: "financial_services",
      cs_organization: "Example Org Alpha (fictional)",
      cs_location: "Exampletown",
      cs_rooms_count: 120,
      source_url: url("case-study-alpha"),
      page_title: "[Demo] Case study: Example Org Alpha",
      section: "Overview",
    }),
  },
  {
    chunkId: "fx-proof-cs-legacy#overview",
    sourceId: "fx-proof-cs-legacy",
    title: "[Demo] Case study: Example Org Legacy › Overview",
    text: `${FIXTURE_MARK} Placeholder for an older case study from a previous platform generation (for example Skype for Business era). A real record here would describe a large multi-office room deployment and standardization on that older platform.`,
    metadata: base({
      journey_stage: "proof",
      content_type: "case_study",
      platforms: "microsoft",
      topics: "standardization,deployment",
      industry: "financial_services",
      legacy_platform: true,
      cs_organization: "Example Org Legacy (fictional)",
      cs_location: "Sampleville",
      cs_rooms_count: 300,
      last_modified: "2017-06-01",
      source_url: url("case-study-legacy"),
      page_title: "[Demo] Case study: Example Org Legacy",
      section: "Overview",
    }),
  },
  {
    chunkId: "fx-proof-cs-county#results",
    sourceId: "fx-proof-cs-county",
    title: "[Demo] Case study: Example County › Results",
    text: `${FIXTURE_MARK} Placeholder for a public-sector case study about monitoring and managed services for meeting rooms. A real record here would report results; any figures in such a source are analytics plus client estimates, so this fixture flags them as estimates and states none.`,
    metadata: base({
      journey_stage: "proof",
      content_type: "case_study",
      platforms: "microsoft",
      topics: "monitoring,managed_services,support_maintenance",
      industry: "government",
      metrics_are_estimates: true,
      cs_organization: "Example County (fictional)",
      cs_location: "Demo County",
      cs_rooms_count: 45,
      source_url: url("case-study-county"),
      page_title: "[Demo] Case study: Example County",
      section: "Results",
    }),
  },
  {
    chunkId: "fx-run-monitoring#remote-monitoring",
    sourceId: "fx-run-monitoring",
    title: "[Demo] Monitoring platform › Remote monitoring and incident management",
    text: `${FIXTURE_MARK} Placeholder for a monitoring section. A real record here would explain how installed rooms are monitored remotely, how incidents are detected and escalated, and what managed services add. This fixture states no response or repair time.`,
    metadata: base({
      journey_stage: "run_support",
      content_type: "page",
      topics: "monitoring,managed_services",
      source_url: url("monitoring-platform"),
      page_title: "[Demo] Monitoring platform",
      section: "Remote monitoring and incident management",
    }),
  },
  {
    chunkId: "fx-run-support#escalation",
    sourceId: "fx-run-support",
    title: "[Demo] Support and maintenance › How to get support and escalation",
    text: `${FIXTURE_MARK} Placeholder for a support section. A real record here would describe how to contact support when a room fails, for example before an important meeting, the escalation path and the support and maintenance options. No SLA or repair time is stated here.`,
    metadata: base({
      journey_stage: "run_support",
      content_type: "support_info",
      topics: "support_maintenance,managed_services,monitoring",
      source_url: url("support-and-maintenance"),
      page_title: "[Demo] Support and maintenance",
      section: "How to get support and escalation",
    }),
  },
  // Hard-filter probes: these must NEVER be returned, whatever the model asks for.
  {
    chunkId: "fx-offscope-videowall#overview",
    sourceId: "fx-offscope-videowall",
    title: "[Demo] Off-scope video wall section",
    text: `${FIXTURE_MARK} Placeholder for an off-scope section (video walls, broadcast). It is marked not meeting-room relevant and must never be retrieved. Mentions monitoring and Microsoft Teams Rooms only to probe the hard filter.`,
    metadata: base({
      journey_stage: "plan_design",
      content_type: "page",
      platforms: "microsoft",
      topics: "monitoring",
      meeting_room_relevant: false,
      source_url: url("off-scope-video-wall"),
      page_title: "[Demo] Off-scope",
      section: "Video walls",
    }),
  },
  {
    chunkId: "fx-unpublished#draft",
    sourceId: "fx-unpublished",
    title: "[Demo] Unpublished draft",
    text: `${FIXTURE_MARK} Placeholder for a needs_review draft. Mentions Copilot, Places, monitoring and standardization only to probe the published-status hard filter.`,
    metadata: base({
      journey_stage: "choose_platform",
      content_type: "page",
      platforms: "microsoft",
      topics: "copilot,places,monitoring,standardization",
      status: "needs_review",
      source_url: url("unpublished-draft"),
      page_title: "[Demo] Unpublished draft",
      section: "Draft",
    }),
  },
];

/** Synthetic graph. Entity names are prefixed "Demo" so they cannot be read as real relationships. */
export const FIXTURE_GRAPH: GraphTriplet[] = [
  {
    source: { name: "Demo room pattern", type: "design" },
    relation: "designed_for",
    target: { name: "Microsoft Teams Rooms", type: "platform" },
    context: "DEMO FIXTURE sentence: the room-pattern placeholder is written for Teams Rooms.",
    chunkIds: ["fx-plan-room-patterns#small-medium-large", "fx-plan-designs-pdf#p4-7"],
    origin: "extracted",
  },
  {
    source: { name: "Demo standardisation model", type: "practice" },
    relation: "uses",
    target: { name: "Demo room pattern", type: "design" },
    context: "DEMO FIXTURE sentence: the standardisation placeholder builds on the room patterns.",
    chunkIds: ["fx-plan-standardization#scalable-model"],
    origin: "extracted",
  },
  {
    source: { name: "Demo meeting equity", type: "topic" },
    relation: "addresses",
    target: { name: "Remote participants", type: "audience" },
    context: "DEMO FIXTURE sentence: the equity placeholder is about remote participants.",
    chunkIds: ["fx-plan-equity#remote-participants"],
    origin: "extracted",
  },
  {
    source: { name: "Copilot", type: "product" },
    relation: "requires_licence",
    target: { name: "Demo licensing note", type: "disclosure" },
    context: "DEMO FIXTURE sentence: licensing prerequisites apply; the real wording is pending approval.",
    chunkIds: ["fx-platform-microsoft#copilot-places", "fx-platform-ebook#smart-workplace"],
    origin: "extracted",
  },
  {
    source: { name: "Microsoft Places", type: "product" },
    relation: "integrates_with",
    target: { name: "Microsoft Teams Rooms", type: "platform" },
    context: "DEMO FIXTURE sentence: the Places placeholder relates Places to Teams Rooms.",
    chunkIds: ["fx-platform-ebook#smart-workplace"],
    origin: "extracted",
  },
  {
    source: { name: "Example Org Alpha (fictional)", type: "organization" },
    relation: "deployed",
    target: { name: "Microsoft Teams Rooms", type: "platform" },
    context: "DEMO FIXTURE sentence: the fictional organisation's placeholder case study names a Teams Rooms deployment.",
    chunkIds: ["fx-proof-cs-alpha#overview"],
    origin: "extracted",
  },
  {
    source: { name: "Demo monitoring platform", type: "service" },
    relation: "escalates_to",
    target: { name: "Demo support desk", type: "service" },
    context: "DEMO FIXTURE sentence: incidents detected by monitoring are escalated to support.",
    chunkIds: ["fx-run-monitoring#remote-monitoring", "fx-run-support#escalation"],
    origin: "extracted",
  },
  {
    source: { name: "Example County (fictional)", type: "organization" },
    relation: "uses",
    target: { name: "Demo monitoring platform", type: "service" },
    context: "DEMO FIXTURE sentence: the fictional county placeholder uses monitoring (figures are estimates).",
    chunkIds: ["fx-proof-cs-county#results"],
    origin: "extracted",
  },
];
