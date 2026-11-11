/**
 * Deterministic section tagger: derives `platforms`, `vendors`, `topics`, `room_sizes` for ONE record
 * from that record's own text (heading path + body). Keyword/alias rules only: no LLM, no network.
 *
 * Merge rule (see `tagRecord`):
 *   tags(record) = source.always (identity tags, on every section of the source)
 *                  UNION detectTags(record heading path + record body)
 * Nothing else is copied from the manifest. `expect` in the manifest is report-only.
 *
 * Only vocab tokens from @avispl/shared are ever emitted (HydraDB `contains` matches whole
 * comma-separated items). A tag means "this section talks about X" (retrieval), never "X was deployed".
 *
 * What is NOT read: the page title in the breadcrumb, link targets (URLs), image alt text. Navigation
 * and site chrome are already removed by clean.ts before a record exists.
 */
import {
  HYDRA_METADATA_SCHEMA, PLATFORMS, ROOM_SIZES, TOPICS, VENDORS, joinList, splitList,
  type Industry, type Platform, type RoomSize, type Topic, type Vendor,
} from "@avispl/shared";

export const TAG_FIELDS = ["platforms", "vendors", "topics", "room_sizes"] as const;
export type TagField = (typeof TAG_FIELDS)[number];

export const TAG_VOCAB: { readonly [K in TagField]: readonly string[] } = {
  platforms: PLATFORMS, vendors: VENDORS, topics: TOPICS, room_sizes: ROOM_SIZES,
};

/** Comma-joined vocab tokens per field, as written in the manifest (`always`, `expect`). */
export type TagLists = Partial<Record<TagField, string>>;
export type TagSets = Record<TagField, string[]>;

export const TAG_MAX_LENGTH: Record<TagField, number> = Object.fromEntries(
  TAG_FIELDS.map((f) => [f, HYDRA_METADATA_SCHEMA.find((d) => d.name === f)?.max_length ?? 64]),
) as Record<TagField, number>;

// ---------------------------------------------------------------------------------------------
// Text preparation
// ---------------------------------------------------------------------------------------------

export interface TagLine { text: string; heading: boolean }

const HEADING_LINE_RE = /^\s*(?:[-*+]\s+)?#{1,6}\s+\S/;

/** Markdown -> visible text lines. Drops images (alt text is not body text) and link targets; keeps link labels. */
export function toTagLines(markdown: string, heading = false): TagLine[] {
  let t = markdown.replace(/\r/g, "").replace(/[   ]/g, " ").replace(/[‘’]/g, "'").replace(/[‐‑]/g, "-");
  t = t.replace(/\\\\?\n/g, " "); // hard line breaks inside one markdown block ("\\\n")
  for (let i = 0; i < 2; i++) t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " "); // images, also inside links
  t = t.replace(/\[((?:[^\[\]]|\[[^\]]*\])*)\]\([^)]*\)/g, "$1"); // [label](url) -> label
  t = t.replace(/<[^>\n]{1,200}>/g, " ").replace(/\bhttps?:\/\/\S+/g, " ").replace(/\bwww\.\S+/g, " ");
  const out: TagLine[] = [];
  for (const rawLine of t.split("\n")) {
    const isHeading = heading || HEADING_LINE_RE.test(rawLine);
    // table rows: every cell is its own line so "whole item" rules can see a cell
    const cells = /^\s*\|.*\|\s*$/.test(rawLine) ? rawLine.split("|") : [rawLine];
    for (const cell of cells) {
      const text = cell
        .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:#{1,6}\s+)?/, "")
        .replace(/[*_`\\]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (text && !/^[-:| ]+$/.test(text)) out.push({ text, heading: isHeading });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

interface Rule<T extends string> {
  tag: T;
  /** Matched against every line (headings included). */
  any?: RegExp[];
  /** Matched against non-heading lines only (rules that rely on mid-sentence capitalisation; headings are title case). */
  prose?: RegExp[];
}

/**
 * "Capitalised mid-sentence" = the word before is lowercase (or a list comma / slash / ampersand / open paren),
 * so the capital is a proper noun and not a sentence start. Used for brand names that are also English words.
 */
const MID = String.raw`(?<=[a-z],? |[a-z]\/|& |\()`;
const re = (src: string, flags = ""): RegExp => new RegExp(src, flags);

/** Brand names that can stand next to an ambiguous brand in a list ("Neat, Logitech and Poly"). */
const BRAND = String.raw`(?:Logitech|Poly|HP|Cisco|Crestron|Yealink|Jabra|Lenovo|Microsoft|Zoom|Google|Shure|Q-SYS|Sennheiser|Yamaha|Biamp|Barco|LG|Samsung|Legrand|Pexip)`;

export const PLATFORM_RULES: Rule<Platform>[] = [
  {
    tag: "microsoft",
    any: [
      /\bMicrosoft\b/i, /\bMS Teams\b/, /\bMTRs?\b/, /\b(?:M365|O365|Office 365)\b/, /\bCopilot\b/, /\bSurface Hubs?\b/,
      /\bSkype for Business\b/i,
      // "Teams" the product: capital T plus a product word. Lowercase "teams" (people) never matches.
      /\bTeams (?:Rooms?|Phones?|Premium|Panels?|Certified|[Dd]evices?|[Mm]eetings?|[Cc]alling|[Aa]pp|[Cc]lient|[Aa]dmin\w*|[Ee]nvironment|[Cc]hat|[Cc]hannels?)\b/,
    ],
    prose: [re(`${MID}Teams\\b`)],
  },
  { tag: "cisco", any: [/\bCisco\b/i, /\bWebex\b/i] },
  {
    tag: "zoom",
    // Capital Z only; not the camera function ("Pan-Tilt-Zoom", "Optical Zoom", "Zoom in").
    any: [/(?<![-\/])(?<!\b(?:Tilt|Pan|Optical|Digital|and),? )\bZoom\b(?! (?:in|out|into|level|lens|function|ratio|range)\b)/, /\bZoom Rooms?\b/i, /^ZOOM$/],
  },
  {
    tag: "google",
    any: [/\bgoogle (?:meet|workspace)\b/i, /\bGoogle\b(?! (?:Maps|Analytics|Search|Ads|Play|Translate|Earth|Reviews)\b)/],
  },
];

export const VENDOR_RULES: Rule<Vendor>[] = [
  { tag: "logitech", any: [/\bLogitech\b/i, /\bLogi\b/] },
  { tag: "crestron", any: [/\bCrestron\b/i] },
  {
    tag: "neat",
    // Never the adjective: capital N plus a product word, or next to another brand, or capitalised mid-sentence.
    any: [
      /\b(?:Neat|NEAT) (?:Bar|BAR|Board|BOARD|Pad|PAD|Frame|FRAME|Center|CENTER|Centre|Symmetry|Pulse|PULSE|[Dd]evices?|DEVICES?)\b/, /\bNeatframe\b/i,
      re(`\\bNeat(?:,| and| or| &| \\/|\\/) ?(?:and |or )?${BRAND}\\b`), re(`\\b${BRAND}(?:,| and| or| &| \\/|\\/) ?(?:and |or )?Neat\\b`),
      /^(?:Neat|NEAT)$/, // a list item / table cell that is only the brand
    ],
    prose: [re(`${MID}Neat\\b(?!-)`)],
  },
  { tag: "hp_poly", any: [/\bHP ?[|\/&-]? ?Poly\b/i, /\bPoly\b/, /\bPOLY\b/, /\bPolycom\b/i] },
  { tag: "qsys", any: [/\bQ[- ]?SYS\b/i, /\bQSC\b/] },
  { tag: "shure", any: [/\bShure\b/, /\bSHURE\b/] },
  { tag: "sennheiser", any: [/\bSennheiser\b/i] },
  { tag: "lg", any: [/\bLG\b/] },
  { tag: "legrand", any: [/\bLegrand\b/i] },
];

export const TOPIC_RULES: Rule<Topic>[] = [
  { tag: "copilot", any: [/\bCopilot\b/i] },
  {
    tag: "places",
    // The product only, never the plain English plural.
    any: [
      /\bMicrosoft Places\b/i,
      /\bPlaces (?:app|Finder|Explorer|Directory|licen[cs]\w+|features?|deployment|integration|rollout)\b/,
      /\bPlaces,? (?:and|with|in|for|&) (?:Microsoft |MS )?(?:Teams|Copilot|Outlook)\b/,
      /\b(?:Teams(?: Premium| Rooms?| Panels?| Phones?)?|Copilot|Outlook),? (?:and|with|&|or) (?:Microsoft )?Places\b/,
      // capital P + singular verb: grammatical only for the product ("Places helps employees ...")
      /\bPlaces (?:helps|enables|lets|allows|provides|offers|is|uses|brings|makes|gives|has|works|integrates|shows)\b/,
    ],
    prose: [re(`${MID}Places\\b`)],
  },
  { tag: "teams_premium", any: [/\bTeams Premium\b/i] },
  {
    tag: "meeting_equity",
    any: [/\bmeeting equity\b/i, /\bequitable\b/i, /\binclusive (?:meetings?|hybrid|collaboration|experiences?)\b/i, /\bbowling[- ]alley\b/i, /\bequal (?:footing|presence|participation|voice)\b/i],
  },
  {
    tag: "interoperability",
    any: [/\binterop\w*/i, /\bcross-platform\b/i, /\b(?:platform|vendor)[- ]agnostic\b/i, /\bmulti-platform\b/i, /\bdirect guest join\b/i, /\bCVI\b/],
  },
  {
    tag: "ease_of_use",
    any: [/\bease of use\b/i, /\beasy[- ]to[- ]use\b/i, /\buser[- ]friendly\b/i, /\bone[- ]touch\b/i, /\bintuitive(?:ness|ly)?\b/i, /\bsimple to (?:use|operate|join)\b/i, /\beasy to (?:use|join|operate)\b/i],
  },
  {
    tag: "ai_features",
    any: [/\bAI\b/, /\bartificial intelligence\b/i, /\bmachine learning\b/i, /\bCopilot\b/i, /\bintelligent recap\b/i, /\bauto[- ]?framing\b/i],
  },
  {
    tag: "sustainability",
    any: [/\bsustainab\w+/i, /\bcarbon\b/i, /\beco-friendly\b/i, /\benvironmental(?:ly)? (?:footprint|impact|friendly|goals?)\b/i, /\benergy[- ](?:efficien\w+|consumption|sav\w+|use|usage)\b/i, /\brecycl\w+/i, /\bemissions\b/i, /\bnet[- ]zero\b/i, /\be-waste\b/i, /\bESG\b/],
  },
  {
    tag: "security",
    any: [/\bsecur(?:e|ed|ely|ity)\b/i, /\bcybersecurity\b/i, /\bencrypt\w+/i, /\bzero trust\b/i, /\bdata (?:protection|privacy|loss)\b/i, /\binformation leaks?\b/i, /\bsafeguard\w*/i],
  },
  {
    tag: "accessibility_ada",
    any: [/\bADA\b/, /\baccessibility\b/i, /\bAmericans with Disabilities\b/i, /\bdisabilit\w+/i, /\bassistive\b/i, /\baccessible (?:to|for) (?:all|everyone)\b/i, /\b(?:hearing|vision|visual)[- ](?:challenges|impair\w+|loss|loops?)\b/i, /\bhearing and vision\b/i, /\b(?:closed|live) captions?\b/i, /\bwheelchairs?\b/i],
  },
  {
    tag: "standardization",
    any: [/\bstandardi[sz]\w+/i, /\breference designs?\b/i, /\b(?:technology|room|design|global|AV|enterprise|collaboration) standards?\b/i, /\bstandard(?:ized)? (?:room|design|configuration)s?\b/i, /\brepeatable (?:designs?|deployments?|rooms?)\b/i],
  },
  {
    tag: "monitoring",
    // Not "monitor(s)": that is usually a display.
    any: [/\bmonitoring\b/i, /\bmonitored\b/i, /\b(?:remotely|proactively|continuously) monitors?\b/i, /\breal-time (?:alerts?|visibility|status)\b/i, /\bdevice health\b/i, /\bdashboards?\b/i, /\bproactive (?:alerts?|detection)\b/i],
  },
  {
    tag: "managed_services",
    any: [/\bmanaged services?\b/i, /\bmanaged service provider\b/i, /\bfully managed\b/i, /\bas[- ]a[- ]service\b/i, /\b[CX]aaS\b/, /\bon-?site (?:staff\w*|technicians?|resources?|managers?|personnel)\b/i, /\boutsourc\w+/i],
  },
  {
    tag: "support_maintenance",
    // Bare "support" is too generic ("We support your preferred platforms").
    any: [
      /\bmaintenance\b/i, /\bhelp ?desk\b/i, /\bservice desk\b/i, /\bbreak[- \/]?fix\b/i, /\bwarrant(?:y|ies)\b/i, /\btroubleshoot\w*/i,
      /\b24 ?[\/x] ?7\b/i, /\bSLAs?\b/, /\btickets?\b/i, /\bticketing\b/i, /\bincident (?:management|resolution|response)\b/i,
      /\b(?:remote|on-?site|technical|IT|expert|application|ongoing|dedicated|proactive|priority|lifecycle|post-installation|adoption and) support\b/i,
      /\bsupport (?:services?|staff|teams?|desk|plans?|contracts?|agreements?|engineers?|technicians?|cent(?:er|re)s?)\b/i,
    ],
  },
  {
    tag: "deployment",
    // Nouns and service phrases only. Verb forms are too generic: the imperative "Deploy the latest tools" is not a deployment section.
    any: [/\bdeployments?\b/i, /\broll-?outs?\b/i, /\binstallations?\b/i, /\bimplementations?\b/i, /\bcommissioning\b/i, /\b(?:plan|design|build|install),? (?:and )?deploy\b/i, /\bdeploy,? (?:and|&) (?:manage|support)\b/i],
  },
  {
    tag: "training",
    // "training room" is a room type, not the topic.
    any: [/\btraining\b(?! (?:rooms?|spaces?|cent(?:er|re)s?|facilit\w+)\b)/i, /\buser adoption\b/i, /\badoption (?:services?|programs?)\b/i, /\bonboarding\b/i, /\bchange management\b/i],
  },
  { tag: "real_time_design", any: [/\breal[- ]time design\b/i] },
  { tag: "hybrid_meetings", any: [/\bhybrid\b/i, /\bremote (?:participants?|attendees?|users?)\b/i, /\bin-room and remote\b/i] },
  { tag: "roi", any: [/\bROI\b/, /\breturn on (?:your )?investment\b/i, /\bTCO\b/, /\btotal cost of ownership\b/i, /\bcost savings?\b/i, /\bpayback\b/i] },
];

// ---- room sizes: a size word counts only when it qualifies a room/space, or in a list of bare size items ----

const SIZE_WORD = String.raw`(?:extra[- ]large|x-?large|small(?:er)?|medium|mid(?:size)?|large(?:r)?|huddle|mobile|classroom)(?:[- ]sized?)?`;
/** A product name in brackets right after the size word: "small (TeamConnect Bar S) or mid-sized (TeamConnect Bar M) spaces". */
const SIZE_NOTE = String.raw`(?: \([^()]{1,40}\))?`;
const SIZE_GROUP_RE = re(
  String.raw`\b(${SIZE_WORD}${SIZE_NOTE}(?: ?(?:,|\/|&|-to-|-|and|or|to) ?(?:and |or )?${SIZE_WORD}${SIZE_NOTE})*)[- ]+(?:(?:meeting|conference|collaboration|team|teams|microsoft|signature|zoom|webex|google|hybrid|video|focus|training|huddle|board|divisible|multipurpose|and)[- ]+){0,3}(?:rooms?|spaces?|boardrooms?)\b`,
  "gi",
);
const SIZE_ITEM_RE = /^(mobile|huddle|small|medium|large|classroom)s?(?: (?:rooms?|spaces?))?$/i;

const sizeOf = (word: string): RoomSize | null => {
  const w = word.toLowerCase();
  if (w.startsWith("small")) return "small";
  if (w.startsWith("medium") || w.startsWith("mid")) return "medium";
  if (w.startsWith("large") || w.startsWith("extra") || w.startsWith("x")) return "large";
  if (w.startsWith("huddle")) return "huddle";
  if (w.startsWith("mobile")) return "mobile";
  if (w.startsWith("classroom")) return "classroom";
  return null;
};

export function detectRoomSizes(lines: TagLine[]): RoomSize[] {
  const found = new Set<RoomSize>();
  const bareItems = new Set<RoomSize>();
  for (const { text } of lines) {
    for (const m of text.matchAll(SIZE_GROUP_RE)) {
      for (const w of m[1]!.replace(/\([^()]*\)/g, " ").matchAll(/extra[- ]large|x-?large|small|medium|mid|large|huddle|mobile|classroom/gi)) {
        const s = sizeOf(w[0]);
        if (s) found.add(s);
      }
    }
    if (/\bhuddle\)? (?:rooms?|spaces?|areas?)\b/i.test(text)) found.add("huddle");
    if (/\bclassrooms?\b/i.test(text)) found.add("classroom");
    if (/\bmobile (?:(?:video|meeting|collaboration|display|AV) )?(?:carts?|units?|stands?)\b/i.test(text)) found.add("mobile");
    const item = SIZE_ITEM_RE.exec(text);
    if (item) {
      const s = sizeOf(item[1]!)!;
      if (/ (?:rooms?|spaces?)$/i.test(text)) found.add(s);
      else bareItems.add(s);
    }
  }
  // "Small / Medium / Large" as bare list items or table cells: only trusted when at least two sizes appear that way
  // (a lone "Mobile" item is more likely a device type).
  if (bareItems.size >= 2) for (const s of bareItems) found.add(s);
  return ROOM_SIZES.filter((s) => found.has(s));
}

// ---------------------------------------------------------------------------------------------
// Industry and journey stage (single-value fields)
// ---------------------------------------------------------------------------------------------

/** Industry names as they appear in a HEADING. Deliberately narrow: "education" alone is not higher education. */
export const INDUSTRY_HEADING_RULES: { industry: Industry; re: RegExp }[] = [
  { industry: "financial_services", re: /\b(?:financial services|financial institutions?|banks?|banking|wealth management)\b/i },
  { industry: "legal", re: /\b(?:law firms?|legal (?:industry|sector|services)|courtrooms?)\b/i },
  { industry: "healthcare", re: /\b(?:healthcare|health care|hospitals?|clinical|telehealth)\b/i },
  { industry: "higher_education", re: /\b(?:higher education|higher ed|universit(?:y|ies)|colleges?)\b/i },
  { industry: "real_estate", re: /\b(?:commercial real estate|real estate (?:firms?|industry|sector|compan(?:y|ies)))\b/i },
  { industry: "government", re: /\b(?:government|public sector|federal|municipal)\b/i },
  { industry: "transportation", re: /\b(?:airports?|airlines?|transportation)\b/i },
  { industry: "nonprofit", re: /\b(?:non-?profits?)\b/i },
  { industry: "retail", re: /\b(?:retail(?:ers?)?)\b/i },
];

/**
 * Industry of ONE record when its own heading names exactly one industry (e.g. "Government Workspaces").
 * Body text is not used: partner pages list industries in passing ("from retail to healthcare"), which says
 * nothing about what the record is about. Returns null when the heading names none or several.
 */
export function detectIndustry(input: TagInput): Industry | null {
  const heading = ownHeading(input.headingPath);
  if (!heading || heading.includes("; ")) return null; // a joined label names several cards, not one subject
  const hits = INDUSTRY_HEADING_RULES.filter((r) => r.re.test(heading)).map((r) => r.industry);
  return hits.length === 1 ? hits[0]! : null;
}

const DEPLOY_TERMS = /\b(?:deploy(?:s|ed|ing|ment|ments)?|install(?:s|ed|ing|ation|ations|ers?)?|implement(?:ed|ing|ation|ations)|roll(?:ed|ing)?[- ]?outs?|commission(?:ed|ing)|training|trained|trainers?|user adoption|adoption (?:services?|programs?)|onboarding|change management|program manage(?:r|rs|ment)|project manage(?:r|rs|ment)|go-live|procure(?:s|d|ment)?|staging)\b/i;
const RUN_TERMS = /\b(?:monitor(?:s|ed|ing)|managed services?|maintenance|help ?desk|service desk|tickets?|ticketing|incidents?|break[\/ -]?fix|troubleshoot\w*|preventative|preventive|24 ?[\/x] ?7|around the clock|(?:remote|on-?site|technical|lifecycle|ongoing|proactive|field|live|phone|global|priority) (?:support|assistance)|support (?:teams?|services?|plans?|options?|levels?|contracts?|agreements?|desk|coverage|staff|engineers?|technicians?)|downtime|dispatch|SLAs?|outsourc\w+|room sweeps?|self-healing|warrant(?:y|ies))\b/i;
const DEPLOY_HEADING = /\b(?:deploy(?:ment|ments|ing)?|install(?:ation|ations|ing)?|implementation|roll-?outs?|training|adoption|commissioning|program management|project management)\b/i;
const RUN_HEADING = /\b(?:managed services?|monitoring|maintenance|help ?desk|service desk|incident management|support (?:options|levels?|services?|plans?)|(?:enhanced|elite|enterprise|remote|on-?site|technical|ongoing|proactive|lifecycle) support)\b/i;

export interface StageEvidence { stage: "deploy" | "run_support"; sentences: number; deploy: number; run: number; heading: boolean }

/**
 * Journey stage a record is PLAINLY about, from its own text, or null to keep the page's stage.
 * Only "deploy" (deployment, installation, training) and "run_support" (monitoring, managed services, support)
 * are ever detected. A stage is assigned when
 *   - the record's own heading names it AND at least a third of its sentences are about it, or
 *   - at least three sentences and 60% of all sentences (of four or more) are about it,
 * and in both cases it clearly outweighs the other stage (twice as many sentences).
 */
export function detectStage(input: TagInput): StageEvidence | null {
  const heading = ownHeading(input.headingPath);
  const sentences = toTagLines(input.body)
    .filter((l) => !l.heading)
    .flatMap((l) => l.text.split(/(?<=[.!?])\s+/))
    .filter((t) => t.split(/\s+/).length >= 4);
  if (sentences.length === 0) return null;
  const d = sentences.filter((t) => DEPLOY_TERMS.test(t)).length;
  const r = sentences.filter((t) => RUN_TERMS.test(t)).length;
  const n = sentences.length;
  const pick = (stage: "deploy" | "run_support", own: number, other: number, headingRe: RegExp, otherHeadingRe: RegExp): StageEvidence | null => {
    const inHeading = headingRe.test(heading) && !otherHeadingRe.test(heading);
    const byHeading = inHeading && own >= 1 && own / n >= 1 / 3;
    const byBody = own >= 3 && n >= 4 && own / n >= 0.6 && !otherHeadingRe.test(heading);
    return (byHeading || byBody) && own >= other * 2 ? { stage, sentences: n, deploy: d, run: r, heading: inHeading } : null;
  };
  return pick("deploy", d, r, DEPLOY_HEADING, RUN_HEADING) ?? pick("run_support", r, d, RUN_HEADING, DEPLOY_HEADING);
}

// ---------------------------------------------------------------------------------------------
// Detection and merge
// ---------------------------------------------------------------------------------------------

/** tag -> the first text snippet that triggered it (evidence for review). */
function matchRules<T extends string>(rules: Rule<T>[], lines: TagLine[]): Map<T, string> {
  const out = new Map<T, string>();
  for (const r of rules) {
    for (const l of lines) {
      const hit = [...(r.any ?? []), ...(l.heading ? [] : r.prose ?? [])].map((x) => x.exec(l.text)).find(Boolean);
      if (hit) {
        const at = hit.index;
        out.set(r.tag, l.text.slice(Math.max(0, at - 25), at + hit[0].length + 25).trim());
        break;
      }
    }
  }
  return out;
}
const applyRules = <T extends string>(rules: Rule<T>[], lines: TagLine[]): T[] => [...matchRules(rules, lines).keys()];

export const ownHeading = (headingPath: string | undefined): string => headingPath?.split(" › ").pop()?.trim() ?? "";

const linesOf = (input: TagInput): TagLine[] => [
  ...toTagLines(ownHeading(input.headingPath), true),
  ...toTagLines(input.body),
];

/**
 * Runs of consecutive plain text lines joined into one line (soft line breaks inside a paragraph). Headings, list
 * items and table rows end a run. Used for room sizes only: brand rules rely on real sentence starts.
 */
export function joinedRuns(markdown: string): TagLine[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => { if (run.length > 1) out.push(run.join(" ")); run = []; };
  for (const line of markdown.replace(/\r/g, "").split("\n")) {
    if (!line.trim() || /^\s*(?:[-*+•|#>]|\d+[.)]\s)/.test(line)) { flush(); continue; }
    run.push(line.trim());
  }
  flush();
  return out.flatMap((t) => toTagLines(t));
}

/** Why each platform/vendor/topic tag was detected: tag -> matching snippet. For inspection and review only. */
export function explainTags(input: TagInput): Record<string, string> {
  const lines = linesOf(input);
  return Object.fromEntries([...matchRules(PLATFORM_RULES, lines), ...matchRules(VENDOR_RULES, lines), ...matchRules(TOPIC_RULES, lines)]);
}

export interface TagInput {
  /**
   * Heading path of the section WITHOUT the page title ("Parent › Section"). Only the LAST element (the section's
   * own heading) is read. Ancestor headings are ignored on purpose: on avispl.com an H2 such as
   * "Real-Time Design with Cisco" is followed by unrelated H3 blocks, and inheriting it put `real_time_design`
   * on every later section of the page. What a whole page is about belongs in the manifest `always` field.
   */
  headingPath?: string;
  /** Section body (markdown). */
  body: string;
}

export function detectTags(input: TagInput): TagSets {
  const lines = linesOf(input);
  return {
    platforms: applyRules(PLATFORM_RULES, lines),
    vendors: applyRules(VENDOR_RULES, lines),
    topics: applyRules(TOPIC_RULES, lines),
    // PDF text is hard-wrapped ("huddle" / "spaces" on two lines): size phrases are also read across the wrap.
    room_sizes: detectRoomSizes([...lines, ...joinedRuns(input.body)]),
  };
}

/** Problems with a manifest tag list (unknown token, duplicates). Empty = OK. */
export function validateTagLists(lists: TagLists | undefined, label: string): string[] {
  const problems: string[] = [];
  for (const f of TAG_FIELDS) {
    const items = splitList(lists?.[f]);
    for (const t of items) if (!TAG_VOCAB[f].includes(t)) problems.push(`${label}.${f}: "${t}" is not in the vocab`);
    if (new Set(items).size !== items.length) problems.push(`${label}.${f}: duplicate token`);
  }
  return problems;
}

/**
 * Join in vocab order, whole tokens only, within `max` chars. If the cap is ever hit, detected tokens are
 * dropped from the end first; identity (`keep`) tokens last. A token is never cut.
 */
export function fitTagList(field: TagField, tokens: Iterable<string>, keep: Iterable<string> = [], max = TAG_MAX_LENGTH[field]): string {
  const want = new Set(tokens);
  const keepSet = new Set(keep);
  const ordered = TAG_VOCAB[field].filter((t) => want.has(t));
  const drop = [...ordered.filter((t) => !keepSet.has(t)).reverse(), ...ordered.filter((t) => keepSet.has(t)).reverse()];
  const out = new Set(ordered);
  for (const t of drop) {
    if (joinList(ordered.filter((x) => out.has(x))).length <= max) break;
    out.delete(t);
  }
  return joinList(ordered.filter((x) => out.has(x)));
}

export interface RecordTags {
  /** Final metadata values (comma-joined vocab tokens, vocab order). */
  values: Record<TagField, string>;
  /** From the manifest `always` field (source identity). */
  identity: TagSets;
  /** Supported by this record's own text. */
  detected: TagSets;
}

/** THE merge rule: identity tags of the source UNION tags detected in this record's text. */
export function tagRecord(always: TagLists | undefined, input: TagInput): RecordTags {
  const detected = detectTags(input);
  const identity = {} as TagSets;
  const values = {} as Record<TagField, string>;
  for (const f of TAG_FIELDS) {
    identity[f] = splitList(always?.[f]).filter((t) => TAG_VOCAB[f].includes(t));
    values[f] = fitTagList(f, [...identity[f], ...detected[f]], identity[f]);
  }
  return { values, identity, detected };
}

/**
 * Split a record body ("Page › Parent › Section\n\n<markdown>") into tagger input. The page title is dropped:
 * it would put the same tag on every section, which is what `always` is for (explicitly, per source).
 */
export function tagInputFromBody(body: string, pageTitle: string): TagInput {
  const nl = body.indexOf("\n");
  const first = (nl === -1 ? body : body.slice(0, nl)).trim();
  const rest = nl === -1 ? "" : body.slice(nl + 1);
  const prefix = `${pageTitle} › `;
  if (pageTitle && first.startsWith(prefix)) return { headingPath: first.slice(prefix.length), body: rest };
  if (pageTitle && first === pageTitle) return { body: rest };
  return { body };
}
