/**
 * Local PDF extraction with unpdf, per page. Only runs on files the user provides:
 *   tsx src/pdf.ts --file <path> --source <id> [--url <exact citation url>] [--edition <e>]
 * Output: data/pdf/<source>.json with page-range sections (page_range, edition).
 * `page_ranges_needed` sources require ranges in data/config/page-ranges.json (never the whole document).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { getSource, isTruncated } from "./sources";
import { CONFIG_DIR, PDF_DIR } from "./paths";
import { wordCount } from "./clean";
import { MAX_WORDS, MIN_WORDS } from "./split";
import { INDUSTRIES, JOURNEY_STAGES, type Industry, type JourneyStage } from "@avispl/shared";

/**
 * Lines that repeat on many pages (running header/footer: "12 | CATALOG ... call (866) ...", bare page numbers).
 * Digits are normalised so "| 12" and "| 13" count as the same line. Needs >= 3 pages and >= 25% of all pages,
 * so a short PDF never loses real content.
 */
export function findRunningLines(pages: string[]): Set<string> {
  const key = (l: string) => l.trim().replace(/\d+/g, "#");
  const seen = new Map<string, number>();
  for (const p of pages) for (const k of new Set(p.split("\n").map(key).filter(Boolean))) seen.set(k, (seen.get(k) ?? 0) + 1);
  const min = Math.max(3, Math.ceil(pages.length * 0.25));
  return new Set([...seen].filter(([, n]) => n >= min).map(([k]) => k));
}
export const stripRunningLines = (page: string, running: Set<string>): string =>
  page.split("\n").filter((l) => !running.has(l.trim().replace(/\d+/g, "#"))).join("\n");

/**
 * One entry of data/config/page-ranges.json. `stage` / `industry` override the source's values for this range
 * (a catalog holds articles for several journey stages and case studies from several industries).
 * `why` is a note for the human reviewer and is never copied into records.
 */
export interface PdfRange { range: string; title?: string; stage?: JourneyStage; industry?: Industry; why?: string }
export interface PdfSection { page_range: string; title: string; text: string; words: number; stage?: JourneyStage; industry?: Industry }
export interface PdfExtract {
  sourceId: string; url: string; edition: string; file: string; totalPages: number; extractedAt: string;
  sections: PdfSection[];
}

export function parseRange(r: string, total: number): [number, number] {
  const m = /^(\d+)(?:-(\d+))?$/.exec(r.trim());
  if (!m) throw new Error(`bad page range "${r}"`);
  const a = Number(m[1]);
  const b = Number(m[2] ?? m[1]);
  if (a < 1 || b < a || b > total) throw new Error(`page range ${r} outside 1-${total}`);
  return [a, b];
}

/** Group pages into 300-900 word ranges when no explicit ranges are configured. */
export function autoRanges(pages: string[]): PdfRange[] {
  const out: PdfRange[] = [];
  let start = 1;
  let w = 0;
  pages.forEach((p, i) => {
    w += wordCount(p);
    const last = i === pages.length - 1;
    const nextW = last ? 0 : wordCount(pages[i + 1] ?? "");
    if (last || (w >= MIN_WORDS && w + nextW > MAX_WORDS) || w >= MAX_WORDS) {
      out.push({ range: start === i + 1 ? `${start}` : `${start}-${i + 1}` });
      start = i + 2;
      w = 0;
    }
  });
  return out;
}

export async function loadRanges(sourceId: string): Promise<PdfRange[]> {
  const f = join(CONFIG_DIR, "page-ranges.json");
  if (!existsSync(f)) return [];
  const cfg = JSON.parse(await readFile(f, "utf8")) as Record<string, unknown>;
  const v = cfg[sourceId];
  return Array.isArray(v) ? (v as PdfRange[]) : [];
}

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = arg("--file");
  const sourceId = arg("--source");
  if (!file || !sourceId) throw new Error("usage: pdf --file <path> --source <id> [--url <url>] [--edition <e>]");
  const s = getSource(sourceId);
  if (!s) throw new Error(`unknown source ${sourceId}`);
  if (s.contentType !== "pdf" && s.contentType !== "ebook") throw new Error(`${sourceId} is not a PDF/eBook source`);
  const url = arg("--url") ?? s.url;
  if (!url || isTruncated(url)) throw new Error(`${sourceId}: no usable citation URL (truncated or missing). Pass --url with the full URL from Nancy.`);
  if (s.status === "dead_link" && !arg("--url")) throw new Error(`${sourceId}: manifest URL is a 404; pass --url with the current PDF URL.`);

  const data = new Uint8Array(await readFile(file));
  const pdf = await getDocumentProxy(data);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  let ranges = await loadRanges(sourceId);
  if (s.status === "page_ranges_needed" && !ranges.length)
    throw new Error(`${sourceId} needs page ranges in data/config/page-ranges.json first (do not ingest all ${totalPages} pages).`);
  if (!ranges.length) ranges = autoRanges(text);
  const running = findRunningLines(text);
  const sections: PdfSection[] = ranges.map((r) => {
    const [a, b] = parseRange(r.range, totalPages);
    if (r.stage && !JOURNEY_STAGES.includes(r.stage)) throw new Error(`${sourceId} ${r.range}: unknown stage "${r.stage}"`);
    if (r.industry && !INDUSTRIES.includes(r.industry)) throw new Error(`${sourceId} ${r.range}: unknown industry "${r.industry}"`);
    const body = text.slice(a - 1, b).map((t, i) => `<!-- page ${a + i} -->\n${stripRunningLines(t, running).trim()}`).join("\n\n");
    return {
      page_range: a === b ? `${a}` : `${a}-${b}`, title: r.title ?? (a === b ? `p. ${a}` : `pp. ${a}-${b}`), text: body, words: wordCount(body),
      ...(r.stage ? { stage: r.stage } : {}), ...(r.industry ? { industry: r.industry } : {}),
    };
  });
  const out: PdfExtract = {
    sourceId, url, edition: arg("--edition") ?? s.defaults?.edition ?? "", file, totalPages,
    extractedAt: new Date().toISOString(), sections,
  };
  await mkdir(PDF_DIR, { recursive: true });
  await writeFile(join(PDF_DIR, `${sourceId}.json`), JSON.stringify(out, null, 2));
  console.log(`${sourceId}: ${totalPages} pages, ${sections.length} range(s): ${sections.map((x) => `${x.page_range} (${x.words}w)`).join(", ")}`);
  const empty = sections.filter((x) => x.words < 20);
  if (empty.length) console.warn(`WARNING: ${empty.length} range(s) have almost no text (scanned/image pages?): ${empty.map((x) => x.page_range).join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
