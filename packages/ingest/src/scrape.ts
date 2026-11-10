/**
 * Firecrawl `scrape` of curated manifest URLs only (never crawl/map). Concurrency 2, retry + backoff.
 * Usage: tsx src/scrape.ts [--only <id>] [--priority P0] [--dry-run] [--limit N]
 * Option names verified against node_modules/firecrawl/dist/index.d.ts (v4.52.0, ScrapeOptions):
 *   formats, onlyMainContent, waitFor, actions[{type:"wait",milliseconds}|{type:"scroll",direction}], timeout, maxAge.
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { config as loadEnv } from "dotenv";
import { join } from "node:path";
import { Firecrawl, type ScrapeOptions, type ActionOption } from "firecrawl";
import { SOURCES, SCRAPEABLE_STATUSES, isHostAllowed, isTruncated, type ManifestEntry } from "./sources";
import { PKG_ROOT, RAW_DIR, REPORTS_DIR, rawPath } from "./paths";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

// Repo-root .env (dotenv/config only looks in cwd).
loadEnv({ path: join(PKG_ROOT, "..", "..", ".env"), quiet: true });

export interface RawScrape {
  id: string;
  url: string;
  requestedAt: string;
  scrapedAt: string;
  attempts: number;
  options: ScrapeOptions;
  markdown: string;
  html?: string;
  rawHtml?: string;
  metadata: Record<string, unknown>;
  warning?: string;
}

export function canScrape(s: ManifestEntry): { ok: boolean; reason?: string } {
  if (s.derivedFrom) return { ok: false, reason: `derived from ${s.derivedFrom}` };
  if (!(SCRAPEABLE_STATUSES as readonly string[]).includes(s.status)) return { ok: false, reason: `status ${s.status}` };
  if (!s.url) return { ok: false, reason: "no url" };
  if (isTruncated(s.url)) return { ok: false, reason: "truncated url" };
  if (!isHostAllowed(s.url)) return { ok: false, reason: "host not allowed" };
  if (s.contentType === "pdf") return { ok: false, reason: "PDF: use pdf.ts on a local file" };
  return { ok: true };
}

export function buildOptions(s: ManifestEntry, overrides: Partial<ScrapeOptions> = {}): ScrapeOptions {
  const p = s.scrape ?? {};
  const actions: ActionOption[] = [];
  if (p.scrolls) {
    actions.push({ type: "wait", milliseconds: p.waitFor ?? 2000 });
    for (let i = 0; i < p.scrolls; i++) {
      actions.push({ type: "scroll", direction: "down" });
      actions.push({ type: "wait", milliseconds: 800 });
    }
  }
  // `html` is always requested: heading text is re-read from the DOM because Firecrawl's markdown
  // drops the whitespace between inline spans ("BernalilloCountyManaged...").
  const formats: ScrapeOptions["formats"] = p.rawHtml ? ["markdown", "html", "rawHtml"] : ["markdown", "html"];
  return {
    formats,
    onlyMainContent: p.onlyMainContent ?? true,
    ...(p.waitFor && !actions.length ? { waitFor: p.waitFor } : {}),
    ...(actions.length ? { actions } : {}),
    timeout: 90_000,
    ...overrides,
  };
}

/** Auth/VPN/4xx errors are not transient: do not burn retries (or credits) on them. 429 and 5xx are retried. */
export function isPermanent(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number; statusCode?: number })?.status ?? (e as { statusCode?: number })?.statusCode;
  if (/VPN or proxy|API key|Unauthorized|Payment Required|Insufficient credits/i.test(msg)) return true;
  return typeof status === "number" && status >= 400 && status < 500 && status !== 429 && status !== 408;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function scrapeOne(fc: Firecrawl, s: ManifestEntry, overrides: Partial<ScrapeOptions> = {}, tries = 4): Promise<RawScrape> {
  const options = buildOptions(s, overrides);
  const requestedAt = new Date().toISOString();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const doc = await fc.scrape(s.url!, options);
      return {
        id: s.id, url: s.url!, requestedAt, scrapedAt: new Date().toISOString(), attempts: attempt, options,
        markdown: doc.markdown ?? "",
        ...(doc.html ? { html: doc.html } : {}),
        ...(doc.rawHtml ? { rawHtml: doc.rawHtml } : {}),
        metadata: (doc.metadata ?? {}) as Record<string, unknown>,
        ...(doc.warning ? { warning: doc.warning } : {}),
      };
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (isPermanent(e)) {
        console.warn(`  [${s.id}] attempt ${attempt} failed (not retrying): ${msg.slice(0, 200)}`);
        break;
      }
      const wait = Math.min(60_000, 5_000 * 2 ** (attempt - 1));
      console.warn(`  [${s.id}] attempt ${attempt} failed: ${msg.slice(0, 200)}${attempt < tries ? ` (retry in ${wait / 1000}s)` : ""}`);
      if (attempt < tries) await sleep(wait);
    }
  }
  throw lastErr;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t);
  }));
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const only = arg("--only");
  const priority = arg("--priority");
  const limit = arg("--limit") ? Number(arg("--limit")) : Infinity;
  const dry = process.argv.includes("--dry-run");
  const noMain = process.argv.includes("--no-main-content");
  const suffix = arg("--suffix"); // save to <id><suffix>.json for A/B comparisons

  let selected = SOURCES.filter((s) => (!only || s.id === only) && (!priority || s.priority === priority));
  if (only && !selected.length) throw new Error(`unknown source id ${only}`);
  const plan = selected.map((s) => ({ s, ...canScrape(s) }));
  for (const p of plan.filter((p) => !p.ok)) console.log(`skip ${p.s.id}: ${p.reason}`);
  const todo = plan.filter((p) => p.ok).map((p) => p.s).slice(0, limit);
  console.log(`${todo.length} to scrape (concurrency 2)${dry ? " [dry-run]" : ""}: ${todo.map((s) => s.id).join(", ")}`);
  if (dry) {
    for (const s of todo) console.log(`  ${s.id} ${s.url} ${JSON.stringify(buildOptions(s))}`);
    return;
  }
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  console.log(apiKey ? "using FIRECRAWL_API_KEY" : "no FIRECRAWL_API_KEY: keyless free tier (rate-limited)");
  const fc = new Firecrawl(apiKey ? { apiKey } : {});
  await mkdir(RAW_DIR, { recursive: true });
  let failed = 0;
  const errFile = join(REPORTS_DIR, "scrape-errors.json");
  const errors: Record<string, { at: string; error: string }> = existsSync(errFile) ? JSON.parse(await readFile(errFile, "utf8")) : {};
  await pool(todo, 2, async (s) => {
    try {
      const raw = await scrapeOne(fc, s, noMain ? { onlyMainContent: false } : {});
      const file = suffix ? rawPath(`${s.id}${suffix}`) : rawPath(s.id);
      await writeFile(file, JSON.stringify(raw, null, 2));
      const words = raw.markdown.split(/\s+/).filter(Boolean).length;
      const heads = (raw.markdown.match(/^#{1,6} /gm) ?? []).length;
      console.log(`ok ${s.id}: ${raw.markdown.length} chars, ${words} words, ${heads} headings -> ${file}`);
      delete errors[s.id];
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      errors[s.id] = { at: new Date().toISOString(), error: msg.slice(0, 300) };
      console.error(`FAILED ${s.id}: ${msg}`);
    }
  });
  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(errFile, JSON.stringify(errors, null, 2));
  if (failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
