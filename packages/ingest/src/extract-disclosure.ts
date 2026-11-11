/**
 * Find the licensing paragraph in the scraped Smart Workplace eBook and write it, verbatim, to
 * data/review/disclosure-candidate.txt for the content owner to approve. NEVER writes packages/shared/content/disclosure.txt.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REVIEW_DIR, rawPath } from "./paths";
import { cleanMarkdown, repairHeadings, toBlocks, visibleText } from "./clean";
import type { RawScrape } from "./scrape";

const SOURCE_ID = "smart-workplace-ebook";

/** Score blocks: licensing words + Microsoft feature names. Returns candidates best-first, verbatim markdown. */
export function findDisclosureCandidates(md: string): { block: string; score: number; index: number }[] {
  const out: { block: string; score: number; index: number }[] = [];
  toBlocks(md).forEach((block, index) => {
    if (/^#{1,6}\s/.test(block)) return;
    const t = visibleText(block);
    let score = 0;
    if (/\blicen[cs](e|es|ing)\b/i.test(t)) score += 3;
    if (/\b(teams premium|copilot|microsoft places)\b/i.test(t)) score += 2;
    if (/\b(tenant|region|availability|subject to|may (vary|require)|depend(s|ing)? on|requires?)\b/i.test(t)) score += 1;
    if (score >= 4) out.push({ block, score, index });
  });
  return out.sort((a, b) => b.score - a.score || a.index - b.index);
}

async function main() {
  const f = rawPath(SOURCE_ID);
  if (!existsSync(f)) throw new Error(`${f} not found: scrape ${SOURCE_ID} first (pnpm ingest scrape --only ${SOURCE_ID})`);
  const raw = JSON.parse(await readFile(f, "utf8")) as RawScrape;
  const md = cleanMarkdown(repairHeadings(raw.markdown, raw.html).markdown).markdown;
  const c = findDisclosureCandidates(md);
  await mkdir(REVIEW_DIR, { recursive: true });
  const out = join(REVIEW_DIR, "disclosure-candidate.txt");
  const header = [
    "DISCLOSURE CANDIDATE — NOT APPROVED. For the content owner's review only.",
    `Source: ${raw.url} (scraped ${raw.scrapedAt})`,
    "Extracted verbatim from the scraped markdown (markdown formatting may be present).",
    "After approval, the integrator copies the exact approved text into packages/shared/content/disclosure.txt.",
    "",
  ];
  if (!c.length) {
    await writeFile(out, [...header, "NO CANDIDATE FOUND: the scrape did not contain a licensing paragraph. Check the page in a browser."].join("\n") + "\n");
    console.error(`no licensing paragraph found in ${SOURCE_ID}; wrote ${out}`);
    process.exit(2);
  }
  const body = c.slice(0, 3).map((x, i) => `--- candidate ${i + 1} (score ${x.score}, block #${x.index}) ---\n${x.block}`).join("\n\n");
  await writeFile(out, [...header, body].join("\n") + "\n");
  console.log(`wrote ${c.length > 3 ? 3 : c.length} candidate(s) to ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
