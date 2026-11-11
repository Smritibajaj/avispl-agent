/**
 * Split cleaned markdown into sections at H2/H3 (H1 also starts a section; the page-title H1 is dropped).
 * One record covers one topic, roughly 80-300 words (see chunkSections). Tables and lists are never split. Breadcrumb first line: "Page › Section".
 * Stable id: sha1(canonicalUrl + "#" + sectionSlug).
 */
import { createHash } from "node:crypto";
import type { JourneyStage } from "@avispl/shared";
import { stripLinks, toBlocks, visibleText, wordCount } from "./clean";

export const MIN_WORDS = 300;
export const MAX_WORDS = 900;
/** Sections below this are merged with an adjacent section of the same stage (citations need real sections). */
export const TINY_WORDS = 20;
/** Headed sections with less substantive text than this are dropped (and reported). */
export const MIN_SUBSTANTIVE_WORDS = 12;

/** Words of a section excluding its own heading, link text, and bold-only context lines. */
export function substantiveWords(s: Pick<Section, "blocks" | "heading">): number {
  const content = (s.heading ? s.blocks.slice(1) : s.blocks).filter((b) => !/^\*\*[^*]+\*\*$/.test(b.trim()));
  return stripLinks(content.join("\n\n")).replace(/[#>|]/g, " ").split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}
/** A headed section too thin to cite on its own (orphan card fragments, heading + CTA). */
export const isThin = (s: Pick<Section, "blocks" | "heading">): boolean =>
  s.heading !== null && substantiveWords(s) < MIN_SUBSTANTIVE_WORDS && !isLabelIndex(s);

/**
 * A short index of Title-case labels (e.g. the tab names of an interactive eBook pillar): >= 2 blocks of
 * <= 4 words, each starting uppercase, none ending in sentence punctuation. Kept and merged FORWARD.
 * Sentence fragments from stripped cards ("support airport operations.") do not qualify.
 */
export function isLabelIndex(s: Pick<Section, "blocks" | "heading">): boolean {
  const content = (s.heading ? s.blocks.slice(1) : s.blocks).filter((b) => !/^\*\*[^*]+\*\*$/.test(b.trim()));
  const labels = content.flatMap((b) => b.split("\n")).map((l) => l.replace(/^\s*[-*+]\s+/, "").trim()).filter(Boolean);
  return labels.length >= 2 && labels.every((l) => /^[A-Z0-9]/.test(l) && l.split(/\s+/).length <= 4 && !/[.!?]$/.test(l));
}

const DATE_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}\b/gi;
/** A section whose only content is links (plus dates / counters), e.g. blog teaser lists or a lone CTA. */
export function isLinkOnly(s: Pick<Section, "blocks" | "heading">): boolean {
  const content = s.heading ? s.blocks.slice(1) : s.blocks;
  if (!content.length) return false;
  const all = content.join("\n\n");
  if (!/\]\(/.test(all)) return false;
  const prose = stripLinks(all).replace(DATE_RE, " ").replace(/\b\d+\b/g, " ").trim();
  return prose.split(/\s+/).filter(Boolean).length < 3;
}

export interface Section {
  /** Heading text without #, null for intro content before the first heading. */
  heading: string | null;
  level: number;
  /** H2 parent for H3 sections. */
  parent: string | null;
  /** Markdown blocks of the section, heading line included. */
  blocks: string[];
  stage: JourneyStage;
  relevance: "keep" | "uncertain" | "drop";
}

export interface Chunk {
  slug: string;
  /** ONE heading: the `section` citation field. */
  section: string;
  /** Breadcrumb path without the page title: "Section" or "Parent › Section". */
  sectionPath: string;
  body: string; // markdown, WITHOUT breadcrumb (added by withBreadcrumb)
  words: number;
  stage: JourneyStage;
  relevance: "keep" | "uncertain";
}

export const slugify = (s: string): string =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "section";

export const stableId = (canonicalUrl: string, sectionSlug: string): string =>
  createHash("sha1").update(`${canonicalUrl}#${sectionSlug}`).digest("hex");

const headingText = (b: string) => b.replace(/^#{1,6}\s+/, "").replace(/[*_`]/g, "").replace(/\s+#+\s*$/, "").trim();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function parseSections(
  md: string,
  pageTitle: string,
  opts: { stageFor?: (heading: string | null) => JourneyStage; relevanceFor?: (text: string) => Section["relevance"]; defaultStage: JourneyStage },
): Section[] {
  const stageFor = opts.stageFor ?? (() => opts.defaultStage);
  const relevanceFor = opts.relevanceFor ?? (() => "keep" as const);
  const sections: Section[] = [];
  let cur: Section = { heading: null, level: 1, parent: null, blocks: [], stage: stageFor(null), relevance: "keep" };
  let h2: string | null = null;
  let droppedTitle = false;
  for (const b of toBlocks(md)) {
    const m = /^(#{1,3})\s/.exec(b);
    if (m) {
      const level = m[1]!.length;
      const text = headingText(b);
      if (level === 1 && !droppedTitle && (norm(text) === norm(pageTitle) || sections.length === 0 && cur.blocks.length === 0)) {
        droppedTitle = true; // page title: it is in the breadcrumb already
        continue;
      }
      sections.push(cur);
      if (level <= 2) h2 = text;
      // H3 inherits the stage of its H2 unless its own heading maps to a stage
      const own = stageFor(text);
      const parentStage = level === 3 && h2 ? stageFor(h2) : opts.defaultStage;
      cur = {
        heading: text, level, parent: level === 3 ? h2 : null, blocks: [b],
        stage: own !== opts.defaultStage ? own : parentStage, relevance: "keep",
      };
      continue;
    }
    cur.blocks.push(b);
  }
  sections.push(cur);
  const nonEmpty = sections.filter((s) => s.blocks.some((b) => !/^#{1,6}\s/.test(b)) || s.blocks.length > 0);
  for (const s of nonEmpty) s.relevance = relevanceFor(s.blocks.join("\n\n"));
  return nonEmpty.filter((s) => s.blocks.length > 0);
}

const pathOf = (s: Section): string =>
  s.heading ? (s.parent && s.level === 3 ? `${s.parent} › ${s.heading}` : s.heading) : "Overview";

// ---------------------------------------------------------------------------------------------
// One topic per record
// ---------------------------------------------------------------------------------------------

/** A leading untitled intro under this many words joins the first headed section of the page. */
export const SHORT_WORDS = 40;
/** A family (H2 + its H3 children) whose members are ALL under this is one topic shown as cards: one record. */
export const FAMILY_MEMBER_WORDS = 60;
/** Soft upper size of one record. */
export const TARGET_MAX_WORDS = 300;
/** Sections above this are split at paragraph boundaries. */
export const SPLIT_OVER_WORDS = 330;
/** A section with H4-H6 sub-headings is split at them once it is longer than this. */
export const SUBHEAD_SPLIT_OVER = 150;
/** A sub-heading unit at least this long is its own record; smaller neighbours are packed together. */
export const OWN_RECORD_WORDS = 60;

export type SplitEvent =
  | { kind: "dropped_thin"; section: string; words: number; text: string }
  | { kind: "merged_intro"; section: string; into: string; words: number }
  | { kind: "merged_family"; section: string; members: string[] }
  | { kind: "split_faq" | "split_subheadings" | "split_long"; section: string; words: number; into: string[] };

export interface ChunkOptions {
  /** Re-scored for every piece of a split section (partial_scope sources). */
  relevanceFor?: (text: string) => Section["relevance"];
  /** Collects what was merged, split and dropped (for the report). */
  events?: SplitEvent[];
}

interface Piece { section: string; path: string; blocks: string[] }
interface Unit { head: string; blocks: string[] }

const words = (blocks: string[]) => wordCount(blocks.join("\n\n"));
const isHeadingBlock = (b: string) => /^#{1,6}\s/.test(b);
const isSubHeading = (b: string) => /^#{4,6}\s/.test(b);
const isListBlock = (b: string) => b.split("\n").every((l) => /^\s*([-*+]|\d+[.)])\s/.test(l));
const isBoldLabel = (b: string) => /^\*\*[^*\n]+\*\*$/.test(b.trim()) && wordCount(b) <= 15;
/** A question paragraph of an FAQ: one line, ends with "?", not a heading or list. */
export const isQuestionBlock = (b: string): boolean => {
  if (isHeadingBlock(b) || isListBlock(b) || b.includes("\n")) return false;
  const t = b.replace(/[*_]/g, "").trim();
  const n = wordCount(b);
  return /\?$/.test(t) && n >= 3 && n <= 30;
};
const sameText = (a: string, b: string) => norm(a.replace(/[*_`#]/g, "")) === norm(b);

/** Join sub-heading names into one section label, whole names only, within `max` chars. */
export function joinNames(names: string[], max = 160): string {
  let out = "";
  for (const n of names) {
    const next = out ? `${out}; ${n}` : n;
    if (bytes(next) > max) break;
    out = next;
  }
  return out || clipName(names[0] ?? "", max);
}

function toUnits(blocks: string[], starts: (b: string) => boolean, headOf: (b: string) => string): { intro: string[]; units: Unit[] } {
  const intro: string[] = [];
  const units: Unit[] = [];
  for (const b of blocks) {
    if (starts(b)) units.push({ head: headOf(b), blocks: [b] });
    else if (units.length) units[units.length - 1]!.blocks.push(b);
    else intro.push(b);
  }
  return { intro, units };
}

/**
 * Split an oversized run of blocks into balanced parts at paragraph boundaries. Never separates a paragraph that
 * ends with ":" from the list after it, a heading or bold label from what follows, or a quote from its short
 * attribution lines. A bold label line is a preferred boundary.
 */
export function splitBalanced(blocks: string[]): string[][] {
  const atoms: string[][] = [];
  let glueNext = false;
  for (const b of blocks) {
    const prev = atoms[atoms.length - 1];
    const attribution = !isHeadingBlock(b) && !isListBlock(b) && !isBoldLabel(b) && wordCount(b) <= 8 && !/[.!?:]["”’)]?$/.test(b.trim());
    // a list (also a loose one, one item per block) stays whole and with the paragraph that introduces it
    if (prev && (glueNext || attribution || isListBlock(b))) prev.push(b);
    else atoms.push([b]);
    glueNext = isHeadingBlock(b) || isBoldLabel(b) || /:\s*$/.test(b.replace(/[*_]/g, "").trim());
  }
  const total = words(blocks);
  const k = Math.max(1, Math.ceil(total / 280));
  const target = total / k;
  const parts: string[][] = [];
  let cur: string[] = [];
  let w = 0;
  for (const a of atoms) {
    const aw = words(a);
    const labelStart = isBoldLabel(a[0]!) && w >= 80;
    if (cur.length && (labelStart || (w >= 80 && w + aw > target * 1.1))) {
      parts.push(cur);
      cur = [];
      w = 0;
    }
    cur.push(...a);
    w += aw;
  }
  if (cur.length) parts.push(cur);
  const last = parts[parts.length - 1];
  if (parts.length > 1 && last && words(last) < 60 && !isBoldLabel(last[0]!)) {
    parts.pop();
    parts[parts.length - 1]!.push(...last);
  }
  return parts;
}

/** One section (or merged group) -> the records it becomes. */
function explode(blocks: string[], section: string, path: string, events?: SplitEvent[]): Piece[] {
  const total = words(blocks);
  const first: Piece = { section, path, blocks };
  let pieces: Piece[] = [first];

  const faq = toUnits(blocks, isQuestionBlock, (b) => visibleText(b));
  const sub = toUnits(blocks, isSubHeading, headingText);
  const introWords = (intro: string[]) => words(intro.filter((b) => !isHeadingBlock(b)));
  const build = (intro: string[], groups: Unit[][]): Piece[] => {
    const out: Piece[] = groups.map((g) => {
      const name = clipName(g.length === 1 ? g[0]!.head : joinNames(g.map((u) => u.head)));
      return { section: name, path: `${path} › ${name}`, blocks: g.flatMap((u) => u.blocks) };
    });
    if (!intro.length || !out.length) return out;
    // Only the section heading before the first unit: it is already in every unit's breadcrumb.
    if (introWords(intro) === 0) return out;
    // A short lead-in stays with the first unit; a real intro keeps the section's own name.
    if (introWords(intro) < SHORT_WORDS) out[0]!.blocks.unshift(...intro);
    else out.unshift({ section, path, blocks: intro });
    return out;
  };

  if (faq.units.length >= 3) {
    const keptUnits = faq.units.filter((u) => {
      const n = substantiveWords({ heading: null, blocks: u.blocks.slice(1) });
      if (n >= MIN_SUBSTANTIVE_WORDS) return true;
      events?.push({ kind: "dropped_thin", section: `${section} › ${u.head}`, words: n, text: visibleText(u.blocks.slice(1).join(" ")).slice(0, 120) });
      return false;
    });
    pieces = build(faq.intro, keptUnits.map((u) => [u]));
    events?.push({ kind: "split_faq", section, words: total, into: pieces.map((p) => p.section) });
  } else if (sub.units.length >= 2 && total > SUBHEAD_SPLIT_OVER) {
    const groups: Unit[][] = [];
    let pack: Unit[] = [];
    let packWords = 0;
    const flush = () => {
      if (!pack.length) return;
      const prev = groups[groups.length - 1];
      // a lone small card joins the group before it rather than standing as a fragment
      if (packWords < SHORT_WORDS && prev) prev.push(...pack);
      else groups.push(pack);
      pack = [];
      packWords = 0;
    };
    for (const u of sub.units) {
      const w = words(u.blocks);
      if (w >= OWN_RECORD_WORDS) { flush(); groups.push([u]); continue; }
      if (pack.length && packWords + w > TARGET_MAX_WORDS) flush();
      pack.push(u);
      packWords += w;
    }
    flush();
    pieces = build(sub.intro, groups);
    if (pieces.length > 1) events?.push({ kind: "split_subheadings", section, words: total, into: pieces.map((p) => p.section) });
  }

  const out: Piece[] = [];
  for (const p of pieces) {
    const w = words(p.blocks);
    if (w <= SPLIT_OVER_WORDS) { out.push(p); continue; }
    const parts = splitBalanced(p.blocks);
    const named = parts.map((blocksOfPart, i): Piece => {
      if (i === 0) return { ...p, blocks: blocksOfPart };
      const label = isBoldLabel(blocksOfPart[0]!) ? clipName(visibleText(blocksOfPart[0]!)) : "";
      const name = label || `${p.section} (part ${i + 1})`;
      return { section: name, path: label ? `${p.path} › ${label}` : `${p.path} (part ${i + 1})`, blocks: blocksOfPart };
    });
    if (named.length > 1) events?.push({ kind: "split_long", section: p.section, words: w, into: named.map((x) => `${x.section} (${words(x.blocks)}w)`) });
    out.push(...named);
  }
  return out;
}

/** HydraDB VARCHAR limits count UTF-8 bytes, not characters ("’" and "™" are three bytes each). */
const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/** Shorten a section name at a word boundary so it fits `max` BYTES. Never adds an ellipsis. */
export function clipName(s: string, max = 160): string {
  let t = s.replace(/\s+/g, " ").trim();
  if (bytes(t) <= max) return t;
  while (bytes(t) > max) {
    const sp = t.lastIndexOf(" ");
    t = sp > 0 ? t.slice(0, sp) : t.slice(0, -1);
  }
  return t.replace(/[\s,;:–—-]+$/, "");
}

/**
 * One record per topic:
 *  1. Sections with no usable text (link-only, under MIN_SUBSTANTIVE_WORDS) are dropped.
 *  2. A family (H2 + its H3 children) whose members are all short cards becomes one record named after the H2.
 *  3. A short untitled page intro joins the first headed section; label indexes merge forward; untitled
 *     fragments join the section before them.
 *  4. FAQ sections become one record per question; sections with H4-H6 sub-headings are split at them;
 *     anything still over SPLIT_OVER_WORDS is split at paragraph boundaries ("(part n)").
 * The record's own heading line is not repeated in the body: it is the last element of the breadcrumb.
 */
export function chunkSections(sections: Section[], _pageTitle?: string, opts: ChunkOptions = {}): Chunk[] {
  const events = opts.events;
  type Kept = Section & { relevance: "keep" | "uncertain" };
  const keptAll = sections.filter((s): s is Kept => s.relevance !== "drop" && !isLinkOnly(s) && !isThin(s));

  // 2. families of short cards
  const kept: Kept[] = [];
  for (let i = 0; i < keptAll.length; i++) {
    const s = keptAll[i]!;
    const kids: Kept[] = [];
    if (s.level === 2 && s.heading) {
      for (let j = i + 1; j < keptAll.length; j++) {
        const c = keptAll[j]!;
        if (c.level !== 3 || c.parent !== s.heading) break;
        kids.push(c);
      }
    }
    const family = [s, ...kids];
    const short = family.every((m) => substantiveWords(m) < FAMILY_MEMBER_WORDS);
    const uniform = family.every((m) => m.stage === s.stage && m.relevance === s.relevance);
    if (kids.length >= 2 && short && uniform && words(family.flatMap((m) => m.blocks)) <= TARGET_MAX_WORDS) {
      kept.push({ ...s, blocks: family.flatMap((m) => m.blocks) });
      events?.push({ kind: "merged_family", section: s.heading!, members: kids.map((k) => k.heading ?? "") });
      i += kids.length;
      continue;
    }
    kept.push(s);
  }

  // 3. grouping
  type Group = { parts: Kept[]; words: number };
  const groups: Group[] = [];
  const compatible = (g: Group, s: Section) => g.parts[0]!.stage === s.stage && g.parts[0]!.relevance === s.relevance;
  let carry: Group | null = null; // leading section(s) waiting to merge forward
  for (const s of kept) {
    const w = wordCount(s.blocks.join("\n\n"));
    const last = groups[groups.length - 1];
    if (substantiveWords(s) < MIN_SUBSTANTIVE_WORDS && isLabelIndex(s)) {
      // label index introduces what follows: merge forward
      if (carry && compatible(carry, s)) { carry.parts.push(s); carry.words += w; }
      else { if (carry) groups.push(carry); carry = { parts: [s], words: w }; }
      continue;
    }
    // Untitled tiny blocks (e.g. text between a stripped heading and the next one) join the previous section;
    // headed sections that passed the substance floor stay their own record (one heading per citation).
    if (w < TINY_WORDS && !s.heading && last && compatible(last, s) && last.words + w <= MAX_WORDS) {
      last.parts.push(s);
      last.words += w;
      continue;
    }
    if (carry && compatible(carry, s)) {
      const lead = carry.parts.find((p) => !p.heading);
      if (lead && s.heading) events?.push({ kind: "merged_intro", section: "Overview", into: s.heading, words: carry.words });
      groups.push({ parts: [...carry.parts, s], words: carry.words + w });
      carry = null;
      continue;
    }
    if (carry) { groups.push(carry); carry = null; }
    if (!last && (w < TINY_WORDS || (!s.heading && w < SHORT_WORDS))) { carry = { parts: [s], words: w }; continue; }
    groups.push({ parts: [s], words: w });
  }
  if (carry) groups.push(carry);

  // 4. records
  const chunks: Chunk[] = [];
  const slugs = new Map<string, number>();
  for (const g of groups) {
    const named = g.parts.find((p) => p.heading) ?? g.parts[0]!;
    const section = named.heading ?? "Overview";
    const path = pathOf(named);
    const { stage } = g.parts[0]!;
    const groupRelevance = g.parts[0]!.relevance;
    const pieces = explode(g.parts.flatMap((p) => p.blocks), section, path, events);
    for (const p of pieces) {
      // the record's own heading (or FAQ question) is already the last element of the breadcrumb
      const lead = p.blocks[0];
      const blocks = lead !== undefined && (isHeadingBlock(lead) || isQuestionBlock(lead) || isBoldLabel(lead)) && sameText(visibleText(lead), p.section)
        ? p.blocks.slice(1) : [...p.blocks];
      // a page-title H1 that names this record (blog headline under its date line) is the breadcrumb too
      const h1 = blocks.findIndex((b) => /^#\s/.test(b) && sameText(visibleText(b), p.section));
      if (h1 >= 0) blocks.splice(h1, 1);
      const body = blocks.join("\n\n").trim();
      const sub = substantiveWords({ heading: null, blocks });
      if (sub < MIN_SUBSTANTIVE_WORDS && !isLabelIndex({ heading: null, blocks })) {
        events?.push({ kind: "dropped_thin", section: p.section, words: sub, text: visibleText(body).slice(0, 120) });
        continue;
      }
      let relevance: "keep" | "uncertain" = groupRelevance;
      if (pieces.length > 1 && opts.relevanceFor) {
        const r = opts.relevanceFor(p.blocks.join("\n\n"));
        if (r === "drop") {
          events?.push({ kind: "dropped_thin", section: p.section, words: sub, text: "other solution area (partial_scope)" });
          continue;
        }
        relevance = r;
      }
      let slug = slugify(p.path);
      const n = slugs.get(slug) ?? 0;
      slugs.set(slug, n + 1);
      if (n) slug = `${slug}-${n + 1}`;
      chunks.push({ slug, section: p.section, sectionPath: p.path, body, words: wordCount(body), stage, relevance });
    }
  }
  return chunks;
}

export const breadcrumb = (pageTitle: string, sectionPath: string): string => `${pageTitle} › ${sectionPath}`;

export const withBreadcrumb = (pageTitle: string, c: Pick<Chunk, "sectionPath" | "body">): string =>
  `${breadcrumb(pageTitle, c.sectionPath)}\n\n${c.body}\n`;
