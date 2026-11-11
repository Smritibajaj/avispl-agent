/**
 * Controlled vocabularies. These are the ONLY values allowed in the matching metadata fields.
 *
 * RULE (multi-value lists only: PLATFORMS, VENDORS, TOPICS, ROOM_SIZES): no token may be a substring of
 * another token in the same list. Single-value fields use `equals`, so they are exempt.
 * HydraDB's `contains` operator semantics (token vs substring) are not documented precisely,
 * so we make the question irrelevant. `checks.ts` enforces this.
 * (This is why it is `ai_features`, not `ai`, and `accessibility_ada`, not `ada`.)
 */

export const JOURNEY_STAGES = [
  "plan_design",
  "choose_platform",
  "deploy",
  "run_support",
  "proof",
] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

export const CONTENT_TYPES = [
  "page",
  "ebook",
  "interactive_ebook",
  "pdf",
  "blog",
  "case_study",
  "webcast",
  "industry_page",
  "disclosure",
  "support_info",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const PLATFORMS = ["microsoft", "cisco", "zoom", "google"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const VENDORS = [
  "logitech",
  "crestron",
  "neat",
  "hp_poly",
  "qsys",
  "shure",
  "sennheiser",
  "lg",
  "legrand",
  "sony",
] as const;
export type Vendor = (typeof VENDORS)[number];

export const TOPICS = [
  "copilot",
  "places",
  "teams_premium",
  "meeting_equity",
  "interoperability",
  "ease_of_use",
  "ai_features",
  "sustainability",
  "security",
  "accessibility_ada",
  "standardization",
  "monitoring",
  "managed_services",
  "support_maintenance",
  "deployment",
  "training",
  "real_time_design",
  "hybrid_meetings",
  "roi",
] as const;
export type Topic = (typeof TOPICS)[number];

export const ROOM_SIZES = [
  "mobile",
  "huddle",
  "small",
  "medium",
  "large",
  "classroom",
] as const;
export type RoomSize = (typeof ROOM_SIZES)[number];

export const INDUSTRIES = [
  "financial_services",
  "legal",
  "healthcare",
  "higher_education",
  "real_estate",
  "government",
  "transportation",
  "technology",
  "nonprofit",
  "retail",
  "general",
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const STATUSES = ["published", "needs_review"] as const;
export type Status = (typeof STATUSES)[number];

/** HydraDB multi-value convention: comma-joined VARCHAR, filtered with `contains` / `contains_any`. */
export const joinList = (values: readonly string[]): string => values.join(",");
export const splitList = (value: string | undefined | null): string[] =>
  value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
