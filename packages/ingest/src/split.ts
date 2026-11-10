/**
 * Split cleaned markdown into sections at H2/H3 (H1 also starts a section; the page-title H1 is dropped).
 * Chunks target 300-900 words; small pages stay one record when all sections share one stage and relevance.
 * Tables and lists are never split. Breadcrumb first line: "Page › Section".
 * Stable id: sha1(canonicalUrl + "#" + sectionSlug).
 */
import { createHash } from "node:crypto";
import type { JourneyStage } from "@avispl/shared";
import { stripLinks, toBlocks, wordCount } from "./clean";

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

/** Split one oversized section at block boundaries (tables/lists/code stay whole). */
function splitLarge(blocks: string[]): string[][] {
  const parts: string[][] = [];
  let cur: string[] = [];
  let w = 0;
  for (const b of blocks) {
    const bw = wordCount(b);
    if (cur.length && w + bw > MAX_WORDS && w >= MIN_WORDS) {
      parts.push(cur);
      cur = [];
      w = 0;
    }
    cur.push(b);
    w += bw;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

/**
 * One record per H2/H3 section, also for pages under 900 words. Only TINY sections (< TINY_WORDS) are
 * merged with an adjacent section of the same stage + relevance; the merged record is named after its
 * first heading. Sections over MAX_WORDS are split at block boundaries into "(part n)".
 */
export function chunkSections(sections: Section[], _pageTitle?: string): Chunk[] {
  const kept = sections.filter((s): s is Section & { relevance: "keep" | "uncertain" } =>
    s.relevance !== "drop" && !isLinkOnly(s) && !isThin(s));
  type Group = { parts: (Section & { relevance: "keep" | "uncertain" })[]; words: number };
  const groups: Group[] = [];
  const compatible = (g: Group, s: Section) => g.parts[0]!.stage === s.stage && g.parts[0]!.relevance === s.relevance;
  let carry: Group | null = null; // tiny leading section(s) waiting to merge forward
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
      last.parts.push(s); // tiny: join the PREVIOUS section, whose heading names the record
      last.words += w;
      continue;
    }
    if (carry && compatible(carry, s)) {
      groups.push({ parts: [...carry.parts, s], words: carry.words + w });
      carry = null;
      continue;
    }
    if (carry) { groups.push(carry); carry = null; }
    if (w < TINY_WORDS && !last) { carry = { parts: [s], words: w }; continue; }
    groups.push({ parts: [s], words: w });
  }
  if (carry) groups.push(carry);

  const chunks: Chunk[] = [];
  const slugs = new Map<string, number>();
  const push = (section: string, path: string, blocks: string[], stage: JourneyStage, relevance: "keep" | "uncertain") => {
    let slug = slugify(path);
    const n = slugs.get(slug) ?? 0;
    slugs.set(slug, n + 1);
    if (n) slug = `${slug}-${n + 1}`;
    const body = blocks.join("\n\n").trim();
    chunks.push({ slug, section, sectionPath: path, body, words: wordCount(body), stage, relevance });
  };
  for (const g of groups) {
    const named = g.parts.find((p) => p.heading) ?? g.parts[0]!;
    const section = named.heading ?? "Overview";
    const path = pathOf(named);
    const blocks = g.parts.flatMap((p) => p.blocks);
    const { stage, relevance } = g.parts[0]!;
    if (g.words <= MAX_WORDS) { push(section, path, blocks, stage, relevance); continue; }
    splitLarge(blocks).forEach((p, i) => {
      if (i === 0) return push(section, path, p, stage, relevance);
      push(`${section} (part ${i + 1})`, `${path} (part ${i + 1})`, [`**${section} (part ${i + 1})**`, ...p], stage, relevance);
    });
  }
  return chunks;
}

export const breadcrumb = (pageTitle: string, sectionPath: string): string => `${pageTitle} › ${sectionPath}`;

export const withBreadcrumb = (pageTitle: string, c: Pick<Chunk, "sectionPath" | "body">): string =>
  `${breadcrumb(pageTitle, c.sectionPath)}\n\n${c.body}\n`;
