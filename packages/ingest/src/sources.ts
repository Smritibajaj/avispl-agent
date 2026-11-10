/**
 * The 60-source manifest (numbering = docs/plan.original.md section 3) plus one derived source.
 * Statuses follow docs/DECISIONS.md section 2. `goldenQueries` and `priority` are LOCAL ONLY:
 * prepare.ts never copies them into IngestRecord.metadata / additional.
 *
 * Industry for case studies is curated here by hand, never read from the page's MARKET label.
 * Section tags (platforms, vendors, topics, room_sizes) are per RECORD, not per source:
 *   record tags = `always` (source identity, every section) UNION tags the tagger finds in that section's text.
 * `defaults` holds only flags / edition / cs_* fields. `expect` is report-only. See src/tagger.ts.
 */
import type { SourceEntry } from "@avispl/shared";
import { TAG_FIELDS, validateTagLists, type TagField, type TagLists } from "./tagger";

export interface ScrapeProfile {
  /** Firecrawl `onlyMainContent` (default true). Symphony may need false. */
  onlyMainContent?: boolean;
  /** Firecrawl `waitFor` in ms (JS-rendered pages). */
  waitFor?: number;
  /** Scroll down N times with waits (Firecrawl `actions`), for lazy/JS content. */
  scrolls?: number;
  /** Request rawHtml too, for debugging thin results. */
  rawHtml?: boolean;
}

/** Curated per-source values that are NOT section tags: flags, edition, case-study fields. */
export type SourceDefaults = Omit<NonNullable<SourceEntry["defaults"]>, TagField>;

export interface ManifestEntry extends SourceEntry {
  /**
   * Flags / edition / cs_* only. `platforms`, `vendors`, `topics`, `room_sizes` are NOT allowed here any more
   * (type error + manifest validation): section tags come from `always` plus the tagger (src/tagger.ts).
   */
  defaults?: SourceDefaults;
  /**
   * Source IDENTITY tags: what the whole source is about (the platform of a platform page, the vendor of a
   * vendor page, the one subject of a service page). Put on EVERY record of the source, whether or not the
   * section text repeats it. Keep this small; everything else must be detected in the section text.
   */
  always?: TagLists;
  /**
   * REPORT ONLY, never copied into records: tags the brief leads us to expect somewhere in this source.
   * prepare-report lists the ones no section produced, so a tagger gap or a thin scrape gets noticed.
   */
  expect?: TagLists;
  /**
   * Set on sources that were NOT in the 60-source brief (docs/plan.original.md section 3): when and how they were
   * found. Such sources take n > 60; the brief's numbers 1..60 are never reused or renumbered.
   */
  addedAfterBrief?: string;
  /** Derived (hand-assembled) source: body built from another source's scraped content. Never scraped itself. */
  derivedFrom?: string;
  scrape?: ScrapeProfile;
}

const P = "https://pages.avispl.com/hubfs";

export const SOURCES: ManifestEntry[] = [
  // ---------------- 3.1 Plan and design ----------------
  {
    id: "ref-designs-page", n: 1, title: "Reference Designs",
    url: "https://avispl.com/solutions/reference-designs/",
    stage: "plan_design", contentType: "page", priority: "P0", goldenQueries: ["Q1"], status: "ready",
    always: { topics: "standardization" }, expect: { room_sizes: "mobile,small,medium,large,classroom" },
  },
  {
    id: "ref-designs-pdf", n: 2, title: "Reference Designs PDF (2021)",
    url: "https://avispl.com/wp-content/uploads/2021/04/Reference_Designs.pdf",
    stage: "plan_design", contentType: "pdf", priority: "P0", goldenQueries: ["Q1"], status: "dead_link",
    note: "404 in Chrome 2026-11-10. Ask Nancy for the current Reference Designs PDF.",
    defaults: { edition: "2021" }, always: { topics: "standardization" }, expect: { room_sizes: "mobile,small,medium,large,classroom" },
  },
  {
    id: "sustainability-screened-rooms", n: 3, title: "Sustainability-screened meeting rooms (Logitech)",
    url: "https://avispl.com/solutions/reference-designs/sustainability-screened-meeting-rooms/",
    stage: "plan_design", contentType: "page", priority: "P1", goldenQueries: ["Q1"], status: "ready",
    always: { vendors: "logitech", topics: "sustainability" }, expect: { topics: "standardization" },
  },
  {
    id: "meeting-rooms", n: 4, title: "Meeting Rooms",
    url: "https://avispl.com/solutions/meeting-rooms/",
    stage: "plan_design", contentType: "page", priority: "P0", goldenQueries: ["Q1"], status: "ready",
    expect: {
      topics: "meeting_equity,interoperability,ease_of_use,ai_features,sustainability,security,accessibility_ada",
    },
  },
  {
    id: "standardization-ebook", n: 5, title: "Building a Scalable Model for Meeting Room Standardization",
    url: "https://avispl.com/resource/scalable-meeting-room-standardization/",
    stage: "plan_design", contentType: "ebook", priority: "P0", goldenQueries: ["Q1"], status: "gated",
    note: "Landing shows a summary + 6 topics only; the eBook arrives after a form. Need the file from Nancy.",
    always: { topics: "standardization" },
  },
  {
    id: "bowling-alley-ebook", n: 6, title: "Avoid the Bowling Alley Effect",
    url: null,
    truncatedUrl: `${P}/2023/2023%20PDFs/AVI-SPL%20Avoid%20the%20Bowling%20Alley%20Effect%20…`,
    stage: "plan_design", contentType: "ebook", priority: "P1", goldenQueries: ["Q1"], status: "needs_resolution",
    note: "URL truncated in the brief. Never guess the suffix; need the full URL from Nancy.",
    always: { topics: "meeting_equity" }, expect: { topics: "hybrid_meetings" },
  },
  {
    id: "hybrid-meeting-hacks", n: 7, title: "Top 5 Hybrid Meeting Hacks",
    url: null,
    truncatedUrl: `${P}/2023/2023%20PDFs/AVI-SPL%20Top%205%20Hybrid%20Meeting%20Hacks%20(1).…`,
    stage: "plan_design", contentType: "ebook", priority: "P1", goldenQueries: ["Q1"], status: "needs_resolution",
    note: "URL truncated in the brief. Never guess the suffix.",
    always: { topics: "hybrid_meetings" },
  },
  {
    id: "concept-catalog-landing", n: 8, title: "Concept Catalog",
    url: "https://avispl.com/resource/concept-catalog/",
    stage: "plan_design", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
  },
  {
    id: "concept-catalog-2025-winter", n: 9, title: "Concept Catalog 2025 Winter",
    url: `${P}/2025/2025%20pdf%20assets/2025%20Concept%20Catalog/AVI-SPL%202025%20Winter%20Concept%20Catalog.pdf`,
    stage: "plan_design", alsoStages: ["choose_platform", "deploy", "proof"], contentType: "pdf", priority: "P2",
    goldenQueries: [], status: "page_ranges_needed",
    note: "Truncated in the brief; full URL read verbatim on 2026-11-10 from the scraped html of the Concept Catalog landing page (#8, data/raw/concept-catalog-landing.json), HTTP 200 application/pdf. 80-page PDF: only selected page ranges (data/config/page-ranges.json) are in scope.",
    defaults: { edition: "2025-winter" },
  },
  {
    id: "concept-catalog-2024-25", n: 10, title: "Concept Catalog 2024-2025 Winter update",
    url: `${P}/2024/2024%20PDFs/Concept%20Catalog%202024-2025%20Winter%20update.pdf`,
    stage: "plan_design", alsoStages: ["choose_platform", "run_support", "proof"], contentType: "pdf", priority: "P1",
    goldenQueries: ["Q2"], status: "page_ranges_needed",
    note: "84-page PDF, cover is VR/immersive. Only selected page ranges (data/config/page-ranges.json) are in scope.",
    defaults: { edition: "2024-25", requires_disclosure: true },
    expect: { platforms: "microsoft", topics: "copilot,places" },
  },
  {
    id: "qsys-sustainability-guide", n: 11, title: "Q-SYS Sustainability Guide",
    url: `${P}/2024/2024%20PDFs/AVI-SPL%20Q-SYS%20Sustainability%20Guide.12.24.pdf`,
    stage: "plan_design", contentType: "pdf", priority: "P2", goldenQueries: [], status: "ready",
    always: { vendors: "qsys", topics: "sustainability" },
  },
  {
    id: "real-time-design", n: 12, title: "Real-Time Design",
    url: "https://avispl.com/services/real-time-design/",
    stage: "plan_design", contentType: "page", priority: "P1", goldenQueries: ["Q1"], status: "ready",
    always: { topics: "real_time_design" },
  },

  // ---------------- 3.2 Choose platform and devices ----------------
  {
    id: "microsoft-practice", n: 13, title: "Microsoft practice",
    url: "https://avispl.com/microsoft/",
    stage: "choose_platform", contentType: "page", priority: "P0", goldenQueries: ["Q2"], status: "ready",
    defaults: { requires_disclosure: true }, always: { platforms: "microsoft" }, expect: { topics: "copilot,places,teams_premium" },
  },
  {
    id: "microsoft-teams", n: 14, title: "Microsoft Teams and Teams Rooms",
    url: "https://avispl.com/microsoft-teams",
    stage: "choose_platform", contentType: "page", priority: "P1", goldenQueries: ["Q1", "Q2"], status: "ready",
    always: { platforms: "microsoft" },
  },
  {
    id: "microsoft-teams-services", n: 15, title: "Microsoft Teams Services",
    url: "https://avispl.com/microsoft-teams-services/",
    stage: "choose_platform", contentType: "page", priority: "P1", goldenQueries: ["Q2"], status: "ready",
    always: { platforms: "microsoft" },
  },
  {
    id: "teams-room-experience-tours", n: 16, title: "Signature Teams Room Experience Tours",
    url: "https://avispl.com/microsoft-teams-room-experience-tours/",
    stage: "choose_platform", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
    always: { platforms: "microsoft" },
  },
  {
    id: "legrand-signature-rooms-blog", n: 17, title: "Scalable Signature Teams Rooms with Legrand AV",
    url: "https://avispl.com/blog/scalable-signature-teams-rooms-with-legrand-av/",
    stage: "choose_platform", contentType: "blog", priority: "P2", goldenQueries: [], status: "ready",
    always: { platforms: "microsoft", vendors: "legrand" },
  },
  {
    id: "places-blog", n: 18, title: "Why Microsoft Places is a workplace management gamechanger",
    url: "https://avispl.com/blog/why-microsoft-places-is-a-workplace-management-gamechanger/",
    stage: "choose_platform", contentType: "blog", priority: "P1", goldenQueries: ["Q2"], status: "ready",
    defaults: { requires_disclosure: true }, always: { platforms: "microsoft", topics: "places" },
  },
  {
    id: "smart-workplace-landing", n: 19, title: "Smart Workplace Microsoft Teams interactive eBook",
    url: "https://avispl.com/resource/smart-workplace-microsoft-teams-interactive-ebook/",
    stage: "choose_platform", contentType: "page", priority: "P1", goldenQueries: ["Q2"], status: "ready",
    defaults: { requires_disclosure: true }, always: { platforms: "microsoft" }, expect: { topics: "copilot,places,teams_premium" },
  },
  {
    id: "smart-workplace-ebook", n: 20, title: "Smart Workplace with Teams (interactive eBook)",
    url: "https://microsoft-offers.avispl.com/smart-workplace-with-teams",
    stage: "choose_platform", contentType: "interactive_ebook", priority: "P0", goldenQueries: ["Q2"], status: "ready",
    note: "HSV-built, JS-rendered. Holds the licensing paragraph (disclosure needs Nancy's sign-off).",
    defaults: { requires_disclosure: true }, always: { platforms: "microsoft" }, expect: { topics: "copilot,places,teams_premium" },
    scrape: { waitFor: 4000, scrolls: 6, rawHtml: true },
  },
  {
    id: "evolution-of-work-ebook", n: 21, title: "Evolution of Work (interactive eBook)",
    url: "https://microsoft-offers.avispl.com/evolution-of-work",
    stage: "choose_platform", contentType: "interactive_ebook", priority: "P2", goldenQueries: [], status: "ready",
    always: { platforms: "microsoft" },
    scrape: { waitFor: 4000, scrolls: 6 },
  },
  {
    id: "elevate-ebook", n: 22, title: "Elevate (interactive eBook)",
    url: "https://elevate.avispl.com/",
    stage: "choose_platform", contentType: "interactive_ebook", priority: "P2", goldenQueries: [], status: "ready",
    note: "Cover page only (14 words with main content, 49 without: menu + GET STARTED). The content sits on sub-pages /why-now, /journey, /experiences, /why-avispl, /partners, which are not in the brief and are not scraped. No records.",
    scrape: { waitFor: 4000, scrolls: 6 },
  },
  {
    id: "cisco", n: 23, title: "Cisco", url: "https://avispl.com/cisco/",
    stage: "choose_platform", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
    always: { platforms: "cisco" },
  },
  {
    id: "zoom", n: 24, title: "Zoom", url: "https://avispl.com/zoom/",
    stage: "choose_platform", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
    always: { platforms: "zoom" },
  },
  {
    id: "google-meet", n: 25, title: "Google Meet", url: "https://avispl.com/google/",
    stage: "choose_platform", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
    always: { platforms: "google" },
  },
  {
    id: "crestron", n: 26, title: "Crestron", url: "https://avispl.com/crestron/",
    stage: "choose_platform", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
    always: { vendors: "crestron" },
  },
  {
    id: "logitech", n: 27, title: "Logitech", url: "https://avispl.com/logitech/",
    stage: "choose_platform", contentType: "page", priority: "P2", goldenQueries: [], status: "partial_scope",
    note: "Meeting-room products plus Education/Government/Personal workspace sections.",
    always: { vendors: "logitech" },
  },
  {
    id: "neat", n: 28, title: "Neat", url: "https://avispl.com/neat/",
    stage: "choose_platform", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
    always: { vendors: "neat" },
  },
  {
    id: "hp-poly", n: 29, title: "HP Poly", url: "https://avispl.com/hp-poly/",
    stage: "choose_platform", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
    always: { vendors: "hp_poly" },
  },
  {
    id: "q-sys", n: 30, title: "Q-SYS", url: "https://avispl.com/q-sys/",
    stage: "choose_platform", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
    always: { vendors: "qsys" },
  },
  {
    id: "shure", n: 31, title: "Shure", url: "https://avispl.com/shure/",
    stage: "choose_platform", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
    always: { vendors: "shure" },
  },
  {
    id: "sennheiser", n: 32, title: "Sennheiser", url: "https://avispl.com/sennheiser/",
    stage: "choose_platform", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
    always: { vendors: "sennheiser" },
  },
  {
    id: "lg", n: 33, title: "LG", url: "https://avispl.com/lg/",
    stage: "choose_platform", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
    always: { vendors: "lg" },
  },
  {
    id: "future-ready-meeting-spaces", n: 34, title: "Future-Ready Meeting Spaces Made Simple",
    url: "https://avispl.com/resource/future-ready-meeting-spaces-made-simple/",
    stage: "choose_platform", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
    always: { platforms: "microsoft", vendors: "lg" },
  },
  {
    id: "lg-express-teams-room-pdf", n: 35, title: "LG Express Teams Room bundle PDF",
    url: `${P}/2025/2025%20pdf%20assets/AVI-SPL%20LG%20Deploy%20Future-Ready%20Meeting%20Spaces%20with%20Ease.pdf`,
    stage: "choose_platform", contentType: "pdf", priority: "P2", goldenQueries: [], status: "ready",
    note: "Truncated in the brief; full URL read verbatim on 2026-11-10 from the scraped Future-Ready Meeting Spaces page (#34, data/raw/future-ready-meeting-spaces.json), HTTP 200 application/pdf. 2 pages, fully in scope.",
    always: { platforms: "microsoft", vendors: "lg" },
  },
  {
    id: "express-lane-webcast", n: 36, title: "Express Lane to Intelligent Collaboration with Microsoft Teams Rooms",
    url: "https://avispl.com/resource/express-lane-intelligent-collaboration-microsoft-teams-rooms/",
    stage: "choose_platform", contentType: "webcast", priority: "P2", goldenQueries: [], status: "ready",
    always: { platforms: "microsoft" },
  },

  // ---------------- 3.3 Deploy ----------------
  {
    id: "professional-services", n: 37, title: "Professional Services",
    url: "https://avispl.com/services/professional-services/",
    stage: "deploy", contentType: "page", priority: "P1", goldenQueries: [], status: "ready",
    always: { topics: "deployment" },
  },
  {
    id: "global-deployment", n: 38, title: "Global Deployment",
    url: "https://avispl.com/services/global-deployment/",
    stage: "deploy", contentType: "page", priority: "P1", goldenQueries: ["Q1"], status: "ready",
    always: { topics: "deployment" }, expect: { topics: "standardization" },
  },
  {
    id: "collaboration-as-a-service", n: 39, title: "Collaboration as a Service",
    url: "https://avispl.com/services/collaboration-as-a-service/",
    stage: "deploy", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
    always: { topics: "managed_services" },
  },

  // ---------------- 3.4 Run and support ----------------
  {
    id: "symphony", n: 40, title: "Symphony", url: "https://avispl.com/symphony/",
    stage: "run_support", contentType: "page", priority: "P0", goldenQueries: ["Q3"], status: "ready",
    note: "Content lives in `main` as separate heading+paragraph blocks; verify extraction per run.",
    always: { topics: "monitoring" }, expect: { topics: "managed_services" },
  },
  {
    id: "symphony-docs", n: 41, title: "Symphony documentation",
    url: "https://symphony.knowledgeowl.com/help/documentation",
    stage: "run_support", contentType: "page", priority: "P1", goldenQueries: ["Q3"], status: "login_required",
    note: "KnowledgeOwl reader login. Never scrape; need an export from AVI-SPL.",
    always: { topics: "monitoring" },
  },
  {
    id: "meeting-room-roi-blog", n: 42, title: "How to Go Beyond Traditional Meeting Room ROI Calculations",
    url: "https://avispl.com/blog/beyond-traditional-meeting-room-roi-calculations/",
    stage: "run_support", contentType: "blog", priority: "P2", goldenQueries: [], status: "ready",
    always: { topics: "roi" },
  },
  {
    id: "managed-services", n: 43, title: "Managed Services",
    url: "https://avispl.com/services/managed-services/",
    stage: "run_support", contentType: "page", priority: "P1", goldenQueries: ["Q3"], status: "ready",
    always: { topics: "managed_services" }, expect: { topics: "monitoring" },
  },
  {
    id: "support-maintenance", n: 44, title: "Support and Maintenance",
    url: "https://avispl.com/services/support-and-maintenance/",
    stage: "run_support", contentType: "page", priority: "P1", goldenQueries: ["Q3"], status: "ready",
    always: { topics: "support_maintenance" },
  },
  {
    id: "help-desk", n: 45, title: "Help Desk portal",
    url: "https://avispl.service-now.com/support",
    stage: "run_support", contentType: "page", priority: "P1", goldenQueries: ["Q3"], status: "login_required",
    note: "ServiceNow login portal. Replaced by the derived `support-howto` record (content from #44).",
    always: { topics: "support_maintenance" },
  },

  // ---------------- 3.5 Proof and industry ----------------
  {
    id: "case-studies-index", n: 46, title: "Case studies",
    url: "https://avispl.com/resources/case-studies/",
    stage: "proof", contentType: "page", priority: "P2", goldenQueries: [], status: "ready",
  },
  {
    id: "idrc", n: 47, title: "IDRC case study",
    url: "https://avispl.com/resources/case-studies/idrc-case-study/",
    stage: "proof", contentType: "case_study", priority: "P0", goldenQueries: ["Q2"], status: "ready",
    note: "Cite only for capabilities the page says were deployed (a mention is not a deployment).",
    industry: "government",
    defaults: { requires_disclosure: true }, always: { platforms: "microsoft" }, expect: { topics: "teams_premium,places" },
  },
  {
    id: "global-tech-security-leader", n: 48, title: "Global Technology Security Leader case study",
    url: "https://avispl.com/resources/case-studies/global-technology-security-leader/",
    stage: "proof", contentType: "case_study", priority: "P1", goldenQueries: [], status: "ready",
    industry: "technology",
  },
  {
    id: "cbre-berlin", n: 49, title: "CBRE Berlin case study",
    url: "https://avispl.com/resources/case-studies/cbre-berlin-case-study/",
    stage: "proof", contentType: "case_study", priority: "P2", goldenQueries: [], status: "partial_scope",
    note: "Mixed: video wall, signage, fit-out alongside meeting rooms.",
    industry: "real_estate",
    defaults: { cs_organization: "CBRE", cs_location: "Berlin" },
  },
  {
    id: "financial-institution-transformation", n: 50, title: "How One Financial Institution Transformed Collaboration",
    url: "https://avispl.com/resources/case-studies/how-one-financial-institution-transformed-collaboration/",
    stage: "proof", contentType: "case_study", priority: "P2", goldenQueries: [], status: "ready",
    note: "Skype for Business / Polycom era.",
    industry: "financial_services",
    defaults: { legacy_platform: true, cs_location: "London" },
  },
  {
    id: "national-bank-of-canada", n: 51, title: "National Bank of Canada case study",
    url: "https://avispl.com/resources/case-studies/national-bank-of-canada-case-study/",
    stage: "proof", contentType: "case_study", priority: "P2", goldenQueries: [], status: "ready",
    industry: "financial_services",
    defaults: { cs_organization: "National Bank of Canada" },
  },
  {
    id: "carrollton-bank", n: 52, title: "Carrollton Bank case study",
    url: "https://avispl.com/resources/case-studies/carrollton-bank-case-study/",
    stage: "proof", contentType: "case_study", priority: "P2", goldenQueries: [], status: "off_scope",
    note: "Teams Phone / cloud calling, not meeting rooms.",
    industry: "financial_services",
  },
  {
    id: "truepoint", n: 53, title: "Truepoint case study",
    url: "https://avispl.com/resources/case-studies/truepoint/",
    stage: "proof", contentType: "case_study", priority: "P2", goldenQueries: [], status: "ready",
    note: "Wealth management firm (industry curated; confirm on scrape).",
    industry: "financial_services",
  },
  {
    id: "7-eleven", n: 54, title: "7-Eleven case study",
    url: "https://avispl.com/resources/case-studies/7-eleven/",
    stage: "proof", contentType: "case_study", priority: "P2", goldenQueries: [], status: "ready",
    note: "Skype for Business / Polycom era.",
    industry: "retail",
    defaults: { legacy_platform: true, cs_organization: "7-Eleven" },
  },
  {
    id: "tampa-skycenter-one", n: 55, title: "Tampa International Airport SkyCenter One case study",
    url: "https://avispl.com/resources/case-studies/tampa-international-airport-skycenter-one/",
    stage: "proof", contentType: "case_study", priority: "P2", goldenQueries: [], status: "partial_scope",
    note: "Mixed: video wall, signage, fit-out alongside meeting rooms.",
    industry: "transportation",
  },
  {
    id: "bernalillo-county", n: 56, title: "Bernalillo County case study",
    url: "https://avispl.com/resources/case-studies/bernalillo-county/",
    stage: "proof", alsoStages: ["run_support"], contentType: "case_study", priority: "P0", goldenQueries: ["Q3"],
    status: "ready",
    note: "Numbers are analytics + client estimates (footnote on page).",
    industry: "government",
    defaults: { metrics_are_estimates: true }, always: { topics: "managed_services" },
  },
  {
    id: "industry-financial-services", n: 57, title: "Financial Services industry",
    url: "https://avispl.com/industries/financial-services/",
    stage: "proof", contentType: "industry_page", priority: "P2", goldenQueries: [], status: "ready",
    industry: "financial_services",
  },
  {
    id: "industry-legal", n: 58, title: "Legal industry",
    url: "https://avispl.com/industries/legal/",
    stage: "proof", contentType: "industry_page", priority: "P2", goldenQueries: [], status: "ready",
    industry: "legal",
  },
  {
    id: "industry-healthcare", n: 59, title: "Healthcare industry",
    url: "https://avispl.com/industries/healthcare/",
    stage: "proof", contentType: "industry_page", priority: "P2", goldenQueries: [], status: "partial_scope",
    note: "Mostly simulation/esports/video walls; one hybrid-collaboration bullet.",
    industry: "healthcare",
  },
  {
    id: "industry-higher-education", n: 60, title: "Higher Education industry",
    url: "https://avispl.com/industries/higher-education/",
    stage: "proof", contentType: "industry_page", priority: "P2", goldenQueries: [], status: "partial_scope",
    note: "Mostly simulation/esports/video walls; one hybrid-collaboration bullet.",
    industry: "higher_education",
  },

  // ---------------- Added after the brief (not in the 60; numbered from 62, never renumber 1..60) ----------------
  {
    id: "standardization-guide-blog", n: 62, title: "Meeting Room Standardization at Scale",
    url: "https://avispl.com/blog/meeting-room-standardization-guide/",
    stage: "plan_design", contentType: "blog", priority: "P1", goldenQueries: ["Q1"], status: "gated",
    addedAfterBrief: "2026-11-10, found via avispl.com site search",
    note: "Scraped once on 2026-11-10 (data/raw/standardization-guide-blog.json): about 150 words of body, a teaser for the gated eBook (#5) with an 'Inside the eBook' bullet list and a download button. Not ingested, same as #5. The H1 on the page is 'Building a Scalable Model for Meeting Room Standardization'.",
    always: { topics: "standardization" },
  },
  {
    id: "teams-rooms-faq", n: 63, title: "Microsoft Teams Rooms FAQ for IT Leaders",
    url: "https://avispl.com/resource/microsoft-teams-rooms-faq/",
    stage: "choose_platform", contentType: "page", priority: "P1", goldenQueries: ["Q2"], status: "ready",
    addedAfterBrief: "2026-11-10, found via avispl.com site search",
    note: "Public, not gated: full FAQ text scraped 2026-11-10. Contains the page's own licensing caveats (Teams Premium / Copilot); these stay in the records only and are never copied to the shared disclosure file.",
    always: { platforms: "microsoft" },
  },

  // ---------------- Derived (not in the 60) ----------------
  {
    id: "support-howto", n: 61, title: "How to get support",
    url: "https://avispl.com/services/support-and-maintenance/",
    stage: "run_support", contentType: "support_info", priority: "P1", goldenQueries: ["Q3"], status: "ready",
    derivedFrom: "support-maintenance",
    note: "Hand-assembled from #44 only (replaces login-only #45). Never invent phone numbers or hours.",
    always: { topics: "support_maintenance" },
  },
];

/** Hosts we are allowed to scrape (curated URLs only). */
export const ALLOWED_HOSTS = [
  "avispl.com",
  "pages.avispl.com",
  "microsoft-offers.avispl.com",
  "elevate.avispl.com",
] as const;

export const SCRAPEABLE_STATUSES = ["ready", "partial_scope"] as const;

export const isTruncated = (u: string): boolean => u.includes("…") || u.includes("...");

export const getSource = (id: string): ManifestEntry | undefined => SOURCES.find((s) => s.id === id);

export const isHostAllowed = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (ALLOWED_HOSTS as readonly string[]).includes(host) || host === "www.avispl.com";
  } catch {
    return false;
  }
};

export const BRIEF_SOURCE_COUNT = 60;
/** One of the 60 numbered sources of the brief (not derived, not added later). */
export const isBriefSource = (s: ManifestEntry): boolean => !s.derivedFrom && !s.addedAfterBrief;

/** Validation used by manifest:report and tests. Returns a list of problems (empty = OK). */
export function validateManifest(sources: ManifestEntry[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const s of sources) {
    if (ids.has(s.id)) problems.push(`duplicate id ${s.id}`);
    ids.add(s.id);
    if (s.url && isTruncated(s.url)) problems.push(`#${s.n} ${s.id}: truncated URL in \`url\``);
    if (s.status === "needs_resolution") {
      if (s.url !== null) problems.push(`#${s.n} ${s.id}: needs_resolution must have url: null`);
      if (!s.truncatedUrl) problems.push(`#${s.n} ${s.id}: needs_resolution must set truncatedUrl`);
    } else if (!s.url) {
      problems.push(`#${s.n} ${s.id}: url is null but status is ${s.status}`);
    }
    if (s.url && (SCRAPEABLE_STATUSES as readonly string[]).includes(s.status) && !s.derivedFrom && !isHostAllowed(s.url))
      problems.push(`#${s.n} ${s.id}: host not in allowlist`);
    for (const f of TAG_FIELDS) {
      if (s.defaults && f in s.defaults) problems.push(`#${s.n} ${s.id}: defaults.${f} is not allowed; use \`always\` (identity) or \`expect\` (report only)`);
    }
    problems.push(...validateTagLists(s.always, `#${s.n} ${s.id}: always`), ...validateTagLists(s.expect, `#${s.n} ${s.id}: expect`));
    if (s.contentType === "case_study" && !s.industry) problems.push(`#${s.n} ${s.id}: case study without curated industry`);
    if (s.derivedFrom && !ids.has(s.derivedFrom) && !sources.some((x) => x.id === s.derivedFrom))
      problems.push(`${s.id}: derivedFrom ${s.derivedFrom} not found`);
  }
  // The brief's sources are exactly n = 1..60. Anything else (derived, or added after the brief) takes n > 60.
  const brief = sources.filter(isBriefSource);
  const nums = new Set(brief.map((s) => s.n));
  for (let n = 1; n <= BRIEF_SOURCE_COUNT; n++) if (!nums.has(n)) problems.push(`source #${n} missing`);
  if (brief.length !== BRIEF_SOURCE_COUNT) problems.push(`expected ${BRIEF_SOURCE_COUNT} brief sources (n 1..${BRIEF_SOURCE_COUNT}), found ${brief.length}`);
  const seenN = new Set<number>();
  for (const s of sources) {
    if (seenN.has(s.n)) problems.push(`#${s.n} ${s.id}: duplicate source number`);
    seenN.add(s.n);
    const extra = Boolean(s.derivedFrom || s.addedAfterBrief);
    if (extra && s.n <= BRIEF_SOURCE_COUNT) problems.push(`#${s.n} ${s.id}: derived/added sources must use n > ${BRIEF_SOURCE_COUNT}`);
    if (!extra && s.n > BRIEF_SOURCE_COUNT) problems.push(`#${s.n} ${s.id}: n > ${BRIEF_SOURCE_COUNT} needs \`addedAfterBrief\` (or \`derivedFrom\`)`);
  }
  return problems;
}
