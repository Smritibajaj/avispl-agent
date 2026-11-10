/**
 * Boilerplate removal for avispl.com markdown (Firecrawl output), by STRUCTURE and REPEATED BLOCKS.
 * We never drop a paragraph because it lacks the words "meeting room". Headings, tables (whole),
 * lists, disclaimers and footnotes are kept unless the block is structurally navigation/form/footer.
 */
import { createHash } from "node:crypto";
import type { JourneyStage } from "@avispl/shared";

// ---------- block model ----------

/** Split markdown into blocks: headings alone, tables whole, fenced code whole, paragraphs/lists by blank line. */
export function toBlocks(md: string): string[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let cur: string[] = [];
  let fence = false;
  const flush = () => {
    if (cur.some((l) => l.trim())) blocks.push(cur.join("\n").trim());
    cur = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (!fence) flush();
      fence = !fence;
      cur.push(line);
      if (!fence) flush();
      continue;
    }
    if (fence) { cur.push(line); continue; }
    const isTable = /^\s*\|/.test(line);
    const prevIsTable = cur.length > 0 && /^\s*\|/.test(cur[cur.length - 1] ?? "");
    if (/^#{1,6}\s/.test(line)) { flush(); blocks.push(line.trim()); continue; }
    if (!line.trim()) { flush(); continue; }
    if (isTable !== prevIsTable && cur.length) flush();
    cur.push(line);
  }
  flush();
  return blocks;
}

const LINK_RE = /!?\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g;
/** URL part "(...)" allowing one level of balanced parentheses inside the URL (e.g. "image(1).png"). */
const URL_PART = String.raw`\((?:[^()\s]|\([^()]*\))*(?:\s+"[^"]*")?\)`;
const IMG_RE = new RegExp(String.raw`!\[[^\]]*\]` + URL_PART, "g");
const LINKED_IMG_RE = new RegExp(String.raw`\[!\[[^\]]*\]` + URL_PART + String.raw`\]` + URL_PART, "g");

/** Visible text of a block (links -> their text, images removed, markdown markers stripped). */
export function visibleText(block: string): string {
  return block
    .replace(LINKED_IMG_RE, "")
    .replace(IMG_RE, "")
    .replace(LINK_RE, "$1")
    .replace(/^\s*(#{1,6}|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`|>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function linkStats(block: string): { links: number; linkTextLen: number; textLen: number; density: number } {
  const noImg = block.replace(LINKED_IMG_RE, "").replace(IMG_RE, "");
  let links = 0;
  let linkTextLen = 0;
  for (const m of noImg.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)) {
    links++;
    linkTextLen += (m[1] ?? "").trim().length;
  }
  const textLen = visibleText(block).length;
  return { links, linkTextLen, textLen, density: textLen ? linkTextLen / textLen : 0 };
}

/** Text left after removing every link/image construct (nested linked images included). */
export function stripLinks(block: string): string {
  let t = block;
  for (let i = 0; i < 3; i++) t = t.replace(/!?\[(?:[^\[\]]|\[[^\]]*\])*\]\([^)]*\)/g, "");
  return t.replace(/[\\*_#\s]+/g, " ").trim();
}

export const wordCount = (s: string): number => visibleText(s).split(/\s+/).filter(Boolean).length;

const count = (text: string, terms: readonly string[]) => {
  const t = text.toLowerCase();
  return terms.filter((x) => t.includes(x.toLowerCase())).length;
};

// ---------- signatures (structure-level, never used on prose alone) ----------

/** Mega-menu items for non-meeting-room solutions. Only used together with high link density. */
export const MEGA_MENU_TERMS = [
  "Video Walls", "Broadcast", "Simulation", "Command and Control", "Command Center", "Esports",
  "Digital Signage", "Experience Center", "Immersive", "Live Events", "Audio Visual",
] as const;

export const COUNTRY_TERMS = [
  "United States", "Canada", "United Kingdom", "Ireland", "Germany", "Spain", "Mexico", "India",
  "United Arab Emirates", "Japan", "Peru", "Colombia", "Chile", "Argentina", "Netherlands", "Brazil",
  "Singapore", "Australia", "France", "Belgium", "Switzerland", "Qatar", "Saudi Arabia",
] as const;
const REGIONAL_DOMAIN_RE = /avispl\.(co\.uk|ca|mx|ie|in|ae|de|es|pe|com\.co|cl|com\.ar|jp|nl|com\.br|sg)\b/gi;

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida",
  "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska",
  "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas",
  "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
] as const;

const FORM_TERMS = [
  "First Name", "Last Name", "Email", "Business Email", "Phone", "Company", "Job Title", "Country",
  "State", "Province", "Comments", "Submit", "Zip", "Postal Code", "required field", "Select",
] as const;

const CTA_ONLY_RE = /^(learn more|read more|view more|download( now)?|contact( us)?|watch( the)?( video)?|get started|view all|see all|explore|request a demo|book a demo|talk to an expert|let'?s talk|skip to (main )?content|scroll to bottom of the hero section|open image gallery|open gallery|play video|watch now|back to top|menu|search|close|×|x)$/i;

/** One form field label per block (Firecrawl renders each <label> as its own paragraph). */
const FORM_LABEL_RE = /^(first ?name|last ?name|full ?name|(work |business )?e-?mail( address)?|company( name)?|organi[sz]ation|job ?title|title|state|province|country|phone( number)?|zip( code)?|postal code|comments?|message|form type|regional office|asset|how can we help\??)\s*\\?\*?\s*$/i;
const CONSENT_RE = /\b(privacy|consent|unsubscribe|submit|i agree|personal information|communications from|opt[- ]?in)\b/i;

/** Disclaimers / footnotes are protected from the repeated-block heuristic and the CTA rule. */
export function isDisclaimer(block: string): boolean {
  const t = visibleText(block);
  return (
    /^(\*|†|‡|§|¹|²|³|\[\d+\]|\(\d+\)|note:|disclaimer|footnote|source:)/i.test(block.trim()) ||
    /\b(licen[cs]e|licensing|estimate[sd]?|subject to|may vary|depend(s|ing)? on|not all features|availability)\b/i.test(t)
  );
}

export type BoilerplateKind =
  | "mega_menu" | "nav_links" | "country_list" | "state_list" | "contact_form" | "footer"
  | "logo_marquee" | "cookie_banner" | "cta_only" | "repeated" | "card_links" | "form" | "duplicate" | "empty_heading"
  | "cta_block" | "eyebrow" | "counter";

const CTA_LINK_RE = /\b(listen|watch|read|download|connect|contact|book|request|learn|explore|discover|schedule|talk to|get started|register|sign up|find out|view|take a (virtual )?tour|visit|see how|let'?s)\b/i;
const linkTexts = (b: string) => [...b.replace(LINKED_IMG_RE, "").replace(IMG_RE, "").matchAll(/\[([^\]]*)\]\([^)]*\)/g)].map((m) => (m[1] ?? "").replace(/[*_]/g, "").trim());

/**
 * Call-to-action paragraph: has a CTA link ("Listen to our podcast", "Read the Case Study", "Connect with us")
 * and the text outside links is empty or a short prompt question. Lists are never CTA blocks
 * (bullet lists of links are content, e.g. supported vendors).
 */
export function isCtaBlock(b: string): boolean {
  if (/^#{1,6}\s/.test(b) || b.split("\n").every((l) => /^\s*([-*+]|\d+\.)\s/.test(l))) return false;
  const links = linkTexts(b);
  if (!links.length || !links.some((t) => CTA_LINK_RE.test(t))) return false;
  const prose = stripLinks(b);
  const words = prose.split(/\s+/).filter(Boolean).length;
  return words === 0 || (words <= 25 && /\?/.test(prose));
}

/** Classify a block as boilerplate by structure. Returns null for content. */
export function classifyBoilerplate(block: string): BoilerplateKind | null {
  const text = visibleText(block);
  const ls = linkStats(block);
  const lines = block.split("\n").filter((l) => l.trim());
  const imgOnly = lines.length > 0 && lines.every((l) => {
    const stripped = l.replace(LINKED_IMG_RE, "").replace(IMG_RE, "").replace(/^\s*[-*+]\s*/, "").trim();
    return stripped === "";
  });
  if (imgOnly) return "logo_marquee"; // logo strips / decorative images: no text content

  const states = count(text, US_STATES);
  if (states >= 10) return "state_list";
  const countries = count(text, COUNTRY_TERMS) + (block.match(REGIONAL_DOMAIN_RE) ?? []).length;
  if (countries >= 5 && (ls.density > 0.4 || text.length / Math.max(lines.length, 1) < 40)) return "country_list";

  const avgLine = text.length / Math.max(lines.length, 1);
  if (count(text, FORM_TERMS) >= 4 && avgLine < 60) return "contact_form";

  if (/(©|\(c\)|copyright)\s*(\d{4})?.{0,40}(avi-spl|all rights reserved)/i.test(text) || /all rights reserved/i.test(text))
    return "footer";
  if (/\bcookies?\b/i.test(text) && /\b(accept|consent|preferences|reject)\b/i.test(text) && text.length < 600)
    return "cookie_banner";

  if (ls.links >= 3 && ls.density > 0.5 && count(text, MEGA_MENU_TERMS) >= 2) return "mega_menu";
  // Linked image "cards" (cross-sell tiles to other solutions/resources): no prose outside the links.
  if ((block.match(/\[!\[/g) ?? []).length >= 2 && stripLinks(block).length < 30) return "card_links";
  // Inline runs of links (menus). Bullet lists of links are kept: in main-content scrapes they are
  // page content (e.g. a list of supported vendors or offerings).
  const isList = lines.every((l) => /^\s*([-*+]|\d+\.)\s/.test(l));
  if (!isList && ls.links >= 4 && ls.density > 0.75) return "nav_links";
  if (/(privacy policy|terms of (use|service)|cookie policy|sitemap|accessibility statement)/i.test(text) && ls.density > 0.6)
    return "footer";

  if (!/^#{1,6}\s/.test(block) && text.length <= 40 && CTA_ONLY_RE.test(text.replace(/[›»→>]+$/, "").trim()) && !isDisclaimer(block))
    return "cta_only";
  return null;
}

/** Normalised fingerprint of a block for the cross-page repeated-block heuristic. */
export const blockKey = (block: string): string =>
  createHash("sha1").update(visibleText(block).toLowerCase()).digest("hex").slice(0, 16);

/**
 * Blocks that occur on many different pages are site chrome. Returns the set of keys that appear on
 * at least `minPages` pages AND at least `minShare` of pages. Headings and disclaimers are never counted.
 */
export function findRepeatedBlocks(pages: string[], minPages = 3, minShare = 0.4): Set<string> {
  const seen = new Map<string, number>();
  for (const md of pages) {
    const keys = new Set(
      toBlocks(md)
        .filter((b) => !/^#{1,6}\s/.test(b) && !isDisclaimer(b) && visibleText(b).length >= 15)
        .map(blockKey),
    );
    for (const k of keys) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const need = Math.max(minPages, Math.ceil(pages.length * minShare));
  return new Set([...seen.entries()].filter(([, n]) => n >= need).map(([k]) => k));
}

export interface CleanResult {
  markdown: string;
  removed: { kind: BoilerplateKind; preview: string }[];
}

const isHeading = (b: string) => /^#{1,6}\s/.test(b);
const levelOf = (b: string) => /^(#{1,6})\s/.exec(b)?.[1]!.length ?? 0;
const tokens = (b: string) => new Set(visibleText(b).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
const jaccard = (a: Set<string>, b: Set<string>) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.max(1, a.size + b.size - inter);
};
/** Heading lines: collapse whitespace runs (never split or join words). */
export const normalizeHeadingLine = (b: string): string =>
  isHeading(b)
    ? b.replace(/^(#{1,6})\s+/, "$1 ").replace(/\s+/g, " ").trim()
    : b.replace(/^(\s*[-*+]\s+#{1,6}[ \t]+)(.*)$/gm, (_m, pre: string, t: string) => pre + t.replace(/\s+/g, " ").trim());

/** Clean one page. `repeated` comes from findRepeatedBlocks over all scraped avispl.com pages. */
export function cleanMarkdown(md: string, repeated: Set<string> = new Set()): CleanResult {
  const removed: CleanResult["removed"] = [];
  const drop = (kind: BoilerplateKind, b: string) => removed.push({ kind, preview: visibleText(b).slice(0, 80) });

  // pass 1: per-block structural classification
  let kept: string[] = [];
  for (const raw of toBlocks(md)) {
    const kind = classifyBoilerplate(raw) ?? (repeated.has(blockKey(raw)) && !isHeading(raw) && !isDisclaimer(raw) ? "repeated" : null);
    if (kind) { drop(kind, raw); continue; }
    // strip inline images and linked images; keep the rest of the block
    const block = normalizeHeadingLine(raw.replace(LINKED_IMG_RE, "").replace(IMG_RE, "").replace(/[ \t]+$/gm, ""));
    if (!block.trim() || !visibleText(block)) continue;
    kept.push(block);
  }

  // pass 2: form regions (one label per block): >=3 field labels within 6 blocks
  const isLabel = (b: string) => !isHeading(b) && visibleText(b).length <= 40 && FORM_LABEL_RE.test(visibleText(b).replace(/\\/g, ""));
  const cut = new Set<number>();
  for (let i = 0; i < kept.length; i++) {
    if (!isLabel(kept[i]!)) continue;
    const window = kept.slice(i, i + 6).filter(isLabel).length;
    if (window < 3) continue;
    let a = i;
    while (a > 0 && !isHeading(kept[a - 1]!) && visibleText(kept[a - 1]!).length <= 40) a--;
    if (a > 0 && isHeading(kept[a - 1]!) && /demo|contact|form|request|get in touch|talk|sign up|subscribe/i.test(kept[a - 1]!)) a--;
    let b = i;
    while (b + 1 < kept.length && !isHeading(kept[b + 1]!) && (visibleText(kept[b + 1]!).length <= 40 || CONSENT_RE.test(kept[b + 1]!) || count(kept[b + 1]!, US_STATES) >= 10)) b++;
    for (let k = a; k <= b; k++) cut.add(k);
    i = b;
  }
  kept = kept.filter((b, i) => (cut.has(i) ? (drop("form", b), false) : true));

  // pass 3: stat figures ("84%" + "reduction in support tickets") and ordinals before headings ("01")
  const merged: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    const b = kept[i]!;
    const next = kept[i + 1];
    if (/^\d{1,2}$/.test(b.trim()) && next && isHeading(next)) { drop("cta_only", b); continue; }
    if (/^[<>~]?[\d.,]+\s*(%|x|\+|k|m|pt|pts)?$/i.test(b.trim()) && next && !isHeading(next) && wordCount(next) <= 12) {
      merged.push(`${b.trim()} ${next.trim()}`);
      i++;
      continue;
    }
    merged.push(b);
  }

  // pass 3b: CTA paragraphs, standalone counters ("13"), isolated eyebrow labels before a heading
  //   ("Services", "14 Case Studies"): <= 3 words, no sentence punctuation, previous kept block is a
  //   heading or a long block (runs of short labels, e.g. tab names, are kept).
  const short = (b: string) => !isHeading(b) && wordCount(b) <= 3 && !/[.!?:]$/.test(visibleText(b));
  const tidy: string[] = [];
  for (let i = 0; i < merged.length; i++) {
    const b = merged[i]!;
    if (isCtaBlock(b)) { drop("cta_block", b); continue; }
    if (/^\d{1,3}$/.test(b.trim())) { drop("counter", b); continue; }
    const prev = tidy[tidy.length - 1];
    const next = merged[i + 1];
    // Not under H4-H6: those carry label values ("#### Location" / "Ottawa, CA") and card items.
    const prevIsSmallHeading = prev !== undefined && isHeading(prev) && levelOf(prev) >= 4;
    if (short(b) && next && isHeading(next) && !prevIsSmallHeading && (!prev || isHeading(prev) || !short(prev))) { drop("eyebrow", b); continue; }
    tidy.push(b);
  }
  merged.length = 0;
  merged.push(...tidy);

  // pass 4: duplicates (responsive desktop/mobile copies) and near-duplicate adjacent headings
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const b of merged) {
    const key = `${isHeading(b) ? "h" : "p"}:${visibleText(b).toLowerCase()}`; // headings only dedupe against headings
    const prev = deduped[deduped.length - 1];
    if (isHeading(b) && prev && isHeading(prev) && levelOf(prev) === levelOf(b) && jaccard(tokens(prev), tokens(b)) >= 0.8) { drop("duplicate", b); continue; }
    // only substantial blocks: short values legitimately repeat (e.g. ORGANIZATION and LOCATION labels)
    if (!isHeading(b) && key.split(/\s+/).length >= 8 && seen.has(key)) { drop("duplicate", b); continue; }
    if (isHeading(b) && seen.has(key)) { drop("duplicate", b); continue; }
    seen.add(key);
    deduped.push(b);
  }

  // pass 5: headings with no content of their own.
  //  - followed by a deeper heading: a real parent, keep.
  //  - followed by a HIGHER-level heading (inverted pillar markup, H4 -> H3 -> H2): fold the text as a bold
  //    context line under that next heading (text kept, no section boundary). Only for H1-H4.
  //  - followed by a same-level heading or nothing: drop.
  //  - runs of >= 2 empty sibling H4-H6 headings (item names whose cards held only images, e.g. room
  //    design names): kept as a bullet list of the names.
  const out: string[] = [];
  let pending: string[] = [];
  let items: string[] = [];
  const flushItems = () => {
    if (items.length >= 2) out.push(items.map((t) => `- ${t}`).join("\n"));
    else for (const t of items) removed.push({ kind: "empty_heading", preview: t });
    items = [];
  };
  for (let i = 0; i < deduped.length; i++) {
    const b = deduped[i]!;
    const next = deduped[i + 1];
    const lv = levelOf(b);
    const nlv = next && isHeading(next) ? levelOf(next) : 0;
    const empty = isHeading(b) && (!next || (nlv > 0 && nlv <= lv));
    if (isHeading(b) && empty && lv >= 4 && (items.length || (nlv === lv))) { items.push(visibleText(b)); continue; }
    flushItems();
    if (!isHeading(b)) { out.push(b); continue; }
    if (next && nlv && nlv < lv && lv <= 4) { pending.push(visibleText(b)); continue; }
    if (empty) { drop("empty_heading", b); pending = []; continue; }
    out.push(b);
    if (pending.length) { out.push(`**${pending.join(" › ")}**`); pending = []; }
  }
  flushItems();
  return { markdown: out.join("\n\n").trim() + "\n", removed };
}

// ---------- heading repair from the DOM ----------

const decodeEntities = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;/g, "–").replace(/&mdash;/g, "—")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

/** Heading texts from HTML in document order: <br> -> space, tags removed, entities decoded, whitespace collapsed. */
export function domHeadings(html: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  for (const m of html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const text = decodeEntities(m[2]!.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (text) out.push({ level: Number(m[1]), text });
  }
  return out;
}

const headingKey = (s: string) => s.replace(/\\(.)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, "").toLowerCase();

/**
 * Replace each markdown heading's text with the DOM heading text that has the same characters ignoring
 * whitespace (so only spacing changes, never words). Unmatched headings only get whitespace collapsed.
 */
export function repairHeadings(md: string, html: string | undefined): { markdown: string; repaired: number; unmatched: string[] } {
  const dom = html ? domHeadings(html) : [];
  const used = new Set<number>();
  let repaired = 0;
  const unmatched: string[] = [];
  const markdown = md.replace(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm, (_line, hashes: string, text: string) => {
    const key = headingKey(text);
    const idx = dom.findIndex((d, i) => !used.has(i) && headingKey(d.text) === key);
    if (idx >= 0) {
      used.add(idx);
      const fixed = dom[idx]!.text;
      if (fixed !== text.replace(/\s+/g, " ").trim()) repaired++;
      return `${hashes} ${fixed}`;
    }
    const collapsed = text.replace(/\s+/g, " ").trim();
    if (html) unmatched.push(collapsed); // spacing could not be verified against the DOM: report, do not guess
    return `${hashes} ${collapsed}`;
  });
  return { markdown, repaired, unmatched };
}

// ---------- case studies ----------

export const CASE_LABELS = ["ORGANIZATION", "LOCATION", "MARKET", "SERVICES", "SOLUTIONS", "SOLUTION"] as const;
export type CaseLabel = "organization" | "location" | "market" | "services" | "solution";

const labelOf = (line: string): { label: CaseLabel; inline?: string } | null => {
  const s = line.replace(/^#{1,6}\s+/, "").replace(/[*_]/g, "").trim();
  for (const L of CASE_LABELS) {
    const re = new RegExp(`^${L}\\s*(?:[:\\-–]\\s*(.*))?$`, "i");
    const m = re.exec(s);
    if (m) {
      // Guard against prose: the label must be uppercase on the page, or followed by a colon.
      const raw = s.slice(0, L.length);
      // Label-style headings are small (H4-H6, e.g. "#### Market"); an H2 "Solution" is a real section.
      const headingLine = /^#{4,6}\s/.test(line);
      if (raw !== L && !headingLine && !/[:\-–]/.test(s.slice(L.length, L.length + 3))) continue;
      const label = (L === "SOLUTIONS" ? "solution" : L.toLowerCase()) as CaseLabel;
      const inline = m[1]?.trim();
      return inline ? { label, inline } : { label };
    }
  }
  return null;
};

/**
 * Parse the case-study label block by LABEL, not position. Values may be inline ("LOCATION: Ottawa")
 * or on the following lines (multi-line lists allowed). The label lines are removed from the body.
 * MARKET is returned for reporting only; industry always comes from the manifest.
 */
export function parseCaseStudyLabels(md: string): { labels: Partial<Record<CaseLabel, string>>; body: string } {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const labels: Partial<Record<CaseLabel, string>> = {};
  const drop = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const lab = labelOf(lines[i] ?? "");
    if (!lab || labels[lab.label] !== undefined) continue;
    drop.add(i);
    if (lab.inline) { labels[lab.label] = lab.inline; continue; }
    const vals: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j] ?? "";
      if (labelOf(l) || /^#{1,6}\s/.test(l)) break;
      if (!l.trim()) {
        if (vals.length) {
          // continue only if the next non-empty line is a list item (loose list)
          let k = j + 1;
          while (k < lines.length && !(lines[k] ?? "").trim()) k++;
          if (!/^\s*[-*+]\s/.test(lines[k] ?? "")) break;
        }
        drop.add(j);
        continue;
      }
      if (vals.length && l.length > 200) break; // a body paragraph, not a label value
      vals.push(l.replace(/^\s*[-*+]\s+/, "").replace(/[*_]/g, "").trim());
      drop.add(j);
    }
    if (vals.length) labels[lab.label] = vals.join("; ");
  }
  const body = lines.filter((_, i) => !drop.has(i)).join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return { labels, body };
}

/** Section heading -> journey stage (case studies). Unknown headings keep the source stage. */
export function stageForHeading(heading: string | null | undefined, fallback: JourneyStage): JourneyStage {
  const h = (heading ?? "").replace(/[#*_]/g, "").trim().toLowerCase();
  if (/^plan(ning)?\b/.test(h)) return "plan_design";
  if (/^deploy(ment)?\b/.test(h)) return "deploy";
  if (/^operat(e|ion|ions)\b/.test(h)) return "run_support";
  if (/\b(challenge|result|results|impact|outcome|outcomes)\b/.test(h)) return "proof";
  return fallback;
}

// ---------- partial-scope relevance ----------

const POS = [
  "meeting room", "meeting space", "conference room", "huddle", "boardroom", "board room", "teams rooms",
  "teams room", "zoom rooms", "hybrid meeting", "hybrid work", "hybrid collaboration", "video conferenc",
  "collaboration space", "collaboration room", "unified communication", "room system", "workspace",
  "meeting equity", "remote participant", "classroom",
];
const NEG = [
  "video wall", "simulation", "esports", "digital signage", "signage", "broadcast", "command center",
  "command and control", "virtual reality", "fit-out", "lobby", "auditorium", "theater", "theatre",
];

/**
 * Section-level meeting-room relevance for partial_scope sources.
 * "keep" = meeting-room content (relevant=true); "uncertain" = kept but relevant=false until reviewed;
 * "drop" = clearly another solution area (video walls, simulation...). Scored per SECTION, never per paragraph.
 */
export function sectionRelevance(text: string): "keep" | "uncertain" | "drop" {
  const t = text.toLowerCase();
  const pos = POS.reduce((n, w) => n + (t.split(w).length - 1), 0);
  const neg = NEG.reduce((n, w) => n + (t.split(w).length - 1), 0);
  if (pos > 0 && pos >= neg) return "keep";
  if (neg > 0 && pos === 0) return "drop";
  return "uncertain";
}

/** Leakage probe for scrape-quality reports: boilerplate signals still present after cleaning. */
export function leakageSignals(md: string): string[] {
  const t = visibleText(md);
  const out: string[] = [];
  const states = count(t, US_STATES);
  if (states >= 10) out.push(`${states} US state names`);
  const countries = count(t, COUNTRY_TERMS) + (md.match(REGIONAL_DOMAIN_RE) ?? []).length;
  if (countries >= 5) out.push(`${countries} country/regional-site tokens`);
  const menu = count(t, MEGA_MENU_TERMS);
  if (menu >= 3) out.push(`${menu} mega-menu terms (check: may be real content)`);
  if (/all rights reserved|©/i.test(t)) out.push("copyright/footer text");
  if (/first name.*last name|business email/i.test(t)) out.push("form labels");
  return out;
}
