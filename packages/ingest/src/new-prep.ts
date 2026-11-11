/**
 * Markdown repairs applied to a raw scrape BEFORE the shared clean/split code, for the sources added on 2026-11-11.
 * Every repair is taken from the page's own DOM (`raw.html`) or is pure re-formatting. Nothing is reworded or added.
 *  - fixAnimatedCounters: count-up numbers are captured mid-animation by the scraper ("32.2%" for a counter whose
 *    final value is 99.5). The final value is in the element's `data-target` attribute.
 *  - pairTabs: tab labels and tab panels arrive as two separate blocks; pair "label: panel text" using tab order.
 *  - cardsToList: heading + one-line cards (dropped as "thin" sections by the splitter) become one bullet list.
 *  - unlinkListItems: a bullet list of bare links (dropped as link-only) becomes a plain-text list.
 */
import type { RawScrape } from "./scrape";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const text = (html: string) => html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function fixAnimatedCounters(md: string, html: string): { markdown: string; fixed: string[] } {
  const fixed: string[] = [];
  let out = md;
  let from = 0;
  const re = /<span[^>]*data-target="([^"]+)"([^>]*)>([^<]*)<\/span>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const target = Number(m[1]);
    const shown = m[3]!.trim();
    if (!Number.isFinite(target) || !shown) continue;
    const decimals = Number(/data-decimals="(\d+)"/.exec(m[0])?.[1] ?? "0");
    const final = target.toFixed(decimals);
    if (shown === final) continue;
    // The rendered number sits alone at the start of a line (optionally followed by % or a label).
    const lineRe = new RegExp(`(^|\\n)${esc(shown)}(?=\\s|%|$)`, "g");
    lineRe.lastIndex = from;
    const hit = lineRe.exec(out);
    if (!hit) { fixed.push(`NOT FOUND in markdown: ${shown} (final ${final})`); continue; }
    const start = hit.index + hit[1]!.length;
    out = out.slice(0, start) + final + out.slice(start + shown.length);
    from = start + final.length;
    fixed.push(`${shown} -> ${final}`);
  }
  return { markdown: out.replace(/(\d)\n%/g, "$1%"), fixed };
}

export function pairTabs(md: string, html: string): { markdown: string; paired: number } {
  const labels = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1]!));
  const panels = [...html.matchAll(/<div id="panel-\d+"[^>]*role="tabpanel"[^>]*>([\s\S]*?)(?=<div id="panel-\d+"|<\/section>)/g)]
    .map((m) => [...m[1]!.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((p) => text(p[1]!)).filter(Boolean));
  if (!labels.length || labels.length !== panels.length || panels.some((p) => p.length !== 1)) return { markdown: md, paired: 0 };
  // The label block: all labels in order, separated only by whitespace.
  const block = new RegExp(labels.map((l) => l.split(" ").map(esc).join("\\s+")).join("\\s+"));
  const hit = block.exec(md);
  if (!hit) return { markdown: md, paired: 0 };
  let rest = md.slice(hit.index + hit[0].length);
  let paired = 0;
  labels.forEach((label, i) => {
    const para = panels[i]![0]!;
    // Whitespace-tolerant match (the page uses narrow no-break spaces in places).
    const hitPara = new RegExp(para.split(" ").map(esc).join("\\s+")).exec(rest);
    if (!hitPara) return;
    rest = rest.slice(0, hitPara.index) + `**${label}:** ${hitPara[0]}` + rest.slice(hitPara.index + hitPara[0].length);
    paired++;
  });
  if (paired !== labels.length) return { markdown: md, paired: 0 };
  return { markdown: md.slice(0, hit.index) + rest.replace(/^\s+/, ""), paired };
}

/** Under the heading matching `parent`, turn "### Card title\n\nOne line" cards into "- **Card title**: One line". */
export function cardsToList(md: string, parent: RegExp, maxWords = 14): { markdown: string; cards: number } {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^#{1,6} /.test(l) && parent.test(l));
  if (start < 0) return { markdown: md, cards: 0 };
  const level = /^#+/.exec(lines[start]!)![0].length;
  let end = lines.findIndex((l, i) => i > start && /^#{1,6} /.test(l) && /^#+/.exec(l)![0].length <= level);
  if (end < 0) end = lines.length;
  const out: string[] = [];
  let cards = 0;
  for (let i = start + 1; i < end; i++) {
    const h = /^#{1,6} (.+)$/.exec(lines[i]!);
    if (!h) { if (!/^!\[[^\]]*\]\([^)]*\)$/.test(lines[i]!.trim())) out.push(lines[i]!); continue; }
    let j = i + 1;
    while (j < end && !lines[j]!.trim()) j++;
    const body = lines[j] ?? "";
    if (j < end && !/^(#|!\[|\[)/.test(body.trim()) && body.trim().split(/\s+/).length <= maxWords) {
      out.push(`- **${h[1]!.trim()}**: ${body.trim()}`);
      cards++;
      i = j;
    } else { out.push(...lines.slice(i, end)); break; } // first non-card heading ends the card run
  }
  const listed = out.join("\n").replace(/\n{2,}(?=- \*\*)/g, "\n").replace(/^\n+/, "\n");
  return { markdown: [...lines.slice(0, start + 1), listed, ...lines.slice(end)].join("\n"), cards };
}

export const unlinkListItems = (md: string): string => md.replace(/^(\s*[-*] )\[\*\*([^\]*]+)\*\*\]\([^)]*\)\s*$/gm, "$1$2");

/**
 * Page chrome the shared cleaner leaves in (seen on the 2026-11-11 scrapes): the geo-redirect popup
 * ("We noticed you're in Canada..."), blog share links, the lone author line, and everything from
 * "Back to Blog" down ("You may also like" teasers of OTHER posts, which would also mis-tag the record).
 */
export function stripChrome(md: string): { markdown: string; removed: string[] } {
  const removed: string[] = [];
  let out = md;
  const cut = (re: RegExp, label: string) => {
    const m = re.exec(out);
    if (m) { out = out.slice(0, m.index).replace(/\s+$/, "") + "\n"; removed.push(label); }
  };
  cut(/\n\[Back to Blog\]\(https:\/\/avispl\.com\/blog\/\)/, "blog footer (Back to Blog / You may also like)");
  cut(/\nWe noticed you're in [^\n]*\n/, "geo-redirect popup");
  const before = out;
  out = out.replace(/^\[Share by Email\]\(mailto:[^\n]*$/gm, "").replace(/^AVI-SPL\s*$/gm, "");
  if (out !== before) removed.push("blog share links / author line");
  return { markdown: out, removed };
}

/**
 * A page whose last quotation is cut off on the page itself (no closing quote mark, no end punctuation): drop the
 * unfinished sentence, keep every complete sentence before it. `before` is the text that follows the cut on the page.
 */
export function dropTruncatedQuoteTail(md: string, before: RegExp): { markdown: string; dropped: string } {
  const m = before.exec(md);
  if (!m) return { markdown: md, dropped: "" };
  const head = md.slice(0, m.index).replace(/\s+$/, "");
  const lastPara = head.slice(head.lastIndexOf("\n\n") + 2);
  const open = (lastPara.match(/“/g) ?? []).length;
  const close = (lastPara.match(/”/g) ?? []).length;
  if (open <= close || /[.!?]["”’)]?$/.test(lastPara)) return { markdown: md, dropped: "" };
  const end = Math.max(lastPara.lastIndexOf(". "), lastPara.lastIndexOf("! "), lastPara.lastIndexOf("? "));
  if (end < 0) return { markdown: md, dropped: "" };
  const kept = lastPara.slice(0, end + 1);
  return { markdown: head.slice(0, head.length - lastPara.length) + kept + "\n\n" + md.slice(m.index).replace(/^\s+/, ""), dropped: lastPara.slice(end + 2) };
}

export interface PrepRule {
  /** Text that follows a quotation the page itself cuts off (see dropTruncatedQuoteTail). */
  truncatedQuoteBefore?: RegExp;
  counters?: boolean; tabs?: boolean; cards?: RegExp; unlinkLists?: boolean;
  /** Use the manifest title instead of the page's <title> (wrong on the page). */
  manifestTitle?: boolean;
  /** Sections dropped after splitting (teaser / CTA only). */
  dropSections?: RegExp;
}

export const PREP: Record<string, PrepRule> = {
  "design-planning": { unlinkLists: true },
  "implementation-support": { tabs: true },
  "end-user-training": { cards: /Tailored technology training/i, manifestTitle: true },
  "onsite-managed-services": { tabs: true },
  "enterprise-maintenance": { tabs: true },
  "enterprise-managed-services": { counters: true, dropSections: /^Resources$/ },
  "heriot-watt-university": { truncatedQuoteBefore: /\n## Project Partners\b/ },
  // Sources from the original brief with the same tab widget (labels and panels scraped as two separate blocks).
  // Checked 2026-11-11: each has one paragraph per panel. real-time-design also has tabs, but its panels are link
  // lists that already sit under their own headings, so it needs no repair.
  "meeting-rooms": { tabs: true },
  "global-deployment": { tabs: true },
  "industry-financial-services": { tabs: true },
  "industry-legal": { tabs: true },
  "industry-healthcare": { tabs: true },
  "industry-higher-education": { tabs: true },
};

export function prepRaw(raw: RawScrape, title: string, rule: PrepRule | undefined): { raw: RawScrape; notes: string[] } {
  const chrome = stripChrome(raw.markdown);
  const notes: string[] = chrome.removed.length ? [`chrome removed: ${chrome.removed.join(", ")}`] : [];
  if (!rule) return { raw: { ...raw, markdown: chrome.markdown }, notes };
  let md = chrome.markdown;
  const html = raw.html ?? "";
  if (rule.counters) { const r = fixAnimatedCounters(md, html); md = r.markdown; notes.push(`counters from data-target: ${r.fixed.join(", ") || "none"}`); }
  if (rule.tabs) { const r = pairTabs(md, html); md = r.markdown; notes.push(`tab labels paired: ${r.paired}`); }
  if (rule.cards) { const r = cardsToList(md, rule.cards); md = r.markdown; notes.push(`cards listed: ${r.cards}`); }
  if (rule.unlinkLists) md = unlinkListItems(md);
  if (rule.truncatedQuoteBefore) { const r = dropTruncatedQuoteTail(md, rule.truncatedQuoteBefore); md = r.markdown; notes.push(`unfinished quote sentence dropped: ${r.dropped ? `"${r.dropped}"` : "none"}`); }
  const metadata = rule.manifestTitle ? { ...raw.metadata, title } : raw.metadata;
  return { raw: { ...raw, markdown: md, metadata }, notes };
}
