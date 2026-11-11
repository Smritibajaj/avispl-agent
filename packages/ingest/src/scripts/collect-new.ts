/**
 * One-off collector for the sources added on 2026-11-11 (n >= 64). Scrapes each new source ONCE (no retries,
 * so the number of Firecrawl requests equals the number of pages attempted) and saves data/raw/<id>.json.
 * Sources that already have a raw file are skipped, so re-running never spends another scrape on them.
 * Usage: tsx src/scripts/collect-new.ts [--dry-run] [--max N]
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { Firecrawl } from "firecrawl";
import { SOURCES } from "../sources";
import { canScrape, scrapeOne } from "../scrape";
import { PKG_ROOT, RAW_DIR, rawPath } from "../paths";

loadEnv({ path: join(PKG_ROOT, "..", "..", ".env"), quiet: true });

export const NEW_SOURCE_MIN_N = 64;
export const newSources = () => SOURCES.filter((s) => s.n >= NEW_SOURCE_MIN_N && !s.derivedFrom);

async function main() {
  const dry = process.argv.includes("--dry-run");
  const i = process.argv.indexOf("--max");
  const max = i >= 0 ? Number(process.argv[i + 1]) : 15;
  const todo = newSources().filter((s) => canScrape(s).ok && !existsSync(rawPath(s.id))).slice(0, max);
  console.log(`${todo.length} to scrape (cap ${max})${dry ? " [dry-run]" : ""}`);
  for (const s of todo) console.log(`  ${s.id} ${s.url}`);
  if (dry) return;
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  console.log(apiKey ? "using FIRECRAWL_API_KEY" : "no FIRECRAWL_API_KEY: keyless");
  const fc = new Firecrawl(apiKey ? { apiKey } : {});
  await mkdir(RAW_DIR, { recursive: true });
  let requests = 0;
  const queue = [...todo];
  await Promise.all([0, 1].map(async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      requests++;
      try {
        const raw = await scrapeOne(fc, s, {}, 1);
        await writeFile(rawPath(s.id), JSON.stringify(raw, null, 2));
        const words = raw.markdown.split(/\s+/).filter(Boolean).length;
        const heads = (raw.markdown.match(/^#{1,6} /gm) ?? []).length;
        console.log(`ok ${s.id}: ${words} words, ${heads} headings, status ${String(raw.metadata.statusCode ?? "?")}`);
      } catch (e) {
        console.error(`FAILED ${s.id}: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
      }
    }
  }));
  console.log(`Firecrawl scrape requests sent: ${requests}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
