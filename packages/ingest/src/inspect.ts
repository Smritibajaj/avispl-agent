/**
 * Scrape-quality report for data/raw/*.json: headings, sections, words, leakage, removed boilerplate.
 *   tsx src/inspect.ts [--only <id>]   -> prints and writes data/reports/scrape-quality.md
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RAW_DIR, REPORTS_DIR } from "./paths";
import { cleanMarkdown, findRepeatedBlocks, leakageSignals, repairHeadings, wordCount } from "./clean";
import { getSource } from "./sources";
import type { RawScrape } from "./scrape";

async function main() {
  const i = process.argv.indexOf("--only");
  const only = i >= 0 ? process.argv[i + 1] : undefined;
  if (!existsSync(RAW_DIR)) throw new Error(`${RAW_DIR} does not exist: nothing scraped yet`);
  const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith(".json") && (!only || f.startsWith(only)));
  const raws = await Promise.all(files.map(async (f) => ({ f, r: JSON.parse(await readFile(join(RAW_DIR, f), "utf8")) as RawScrape })));
  const repeated = findRepeatedBlocks(raws.map((x) => x.r.markdown));
  const L = ["# Scrape quality", "", "| file | words raw | words clean | headings (H1/H2/H3) | removed | leakage |", "|---|---|---|---|---|---|"];
  for (const { f, r } of raws) {
    const c = cleanMarkdown(repairHeadings(r.markdown, r.html).markdown, repeated);
    const h = (lvl: number) => (c.markdown.match(new RegExp(`^#{${lvl}}\\s`, "gm")) ?? []).length;
    L.push(`| ${f} | ${wordCount(r.markdown)} | ${wordCount(c.markdown)} | ${h(1)}/${h(2)}/${h(3)} | ${c.removed.length} | ${leakageSignals(c.markdown).join("; ") || "none"} |`);
  }
  for (const { f, r } of raws) {
    const c = cleanMarkdown(repairHeadings(r.markdown, r.html).markdown, repeated);
    L.push("", `## ${f} (${getSource(r.id)?.title ?? r.id})`, "", "Headings:", ...(c.markdown.match(/^#{1,3}\s.*$/gm) ?? ["(none)"]).map((x) => `- ${x}`));
  }
  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(join(REPORTS_DIR, "scrape-quality.md"), L.join("\n") + "\n");
  console.log(L.join("\n"));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
