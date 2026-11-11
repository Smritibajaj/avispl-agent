/**
 * Builds data/records.new.jsonl: records for the sources added on 2026-11-11 (manifest n >= 64) plus the
 * design-picture transcriptions in data/images/transcriptions.json. Same record shape and the same
 * clean/split/tag code as prepare.ts (imported, not modified). NEVER writes data/records.jsonl.
 * SUPERSEDED 2026-11-11: prepare.ts now builds these sources itself (same new-prep fixes), so `pnpm ingest records`
 * gives the full set. This script is kept for inspecting the new sources alone. Its design-picture record is NOT
 * part of the knowledge base (owner decision: its sentences are not AVI-SPL's and it states no fact).
 * Usage: tsx src/scripts/build-new-records.ts
 */
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IngestRecord } from "@avispl/shared";
import { RECORDS_FILENAME } from "@avispl/shared";
import { getSource } from "../sources";
import { canScrape, type RawScrape } from "../scrape";
import { findRepeatedBlocks } from "../clean";
import { stableId } from "../split";
import { buildMetadata, buildPageRecords, sha1, validateRecord } from "../prepare";
import { DATA_DIR, RAW_DIR } from "../paths";
import { newSources } from "./collect-new";
import { PREP, prepRaw } from "../new-prep";
import { ONE_WAY_RELATIONS as NEW_RELATIONS } from "../relations";

export const NEW_RECORDS_FILE = join(DATA_DIR, "records.new.jsonl");
const TRANSCRIPTIONS_FILE = join(DATA_DIR, "images", "transcriptions.json");

interface ImageEntry {
  file: string; imageUrl: string; pageUrl: string; sourceId: string; pageCaption: string; section: string;
  kind: string; legibleText: string[]; hasDesignInformation: boolean; neutralLine?: string; note?: string; record: boolean;
}

const readJsonl = async (f: string): Promise<IngestRecord[]> =>
  existsSync(f) ? (await readFile(f, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as IngestRecord) : [];

/**
 * One record per page for its design pictures. The body holds only what is legible in the pictures; when a
 * picture carries no printed information, only its neutral line. Image URLs go to `additional.crawlNotes` (not cited).
 */
export function buildImageRecords(images: ImageEntry[], transcribedAt: string): IngestRecord[] {
  const byPage = new Map<string, ImageEntry[]>();
  for (const im of images.filter((x) => x.record)) byPage.set(im.pageUrl, [...(byPage.get(im.pageUrl) ?? []), im]);
  const out: IngestRecord[] = [];
  for (const [pageUrl, ims] of byPage) {
    const source = getSource(ims[0]!.sourceId);
    if (!source || source.url !== pageUrl) throw new Error(`image page ${pageUrl} does not match source ${ims[0]!.sourceId}`);
    const section = "Room design pictures";
    const lines = ims.map((im) => `- ${im.section}: ${im.neutralLine}`);
    const noInfo = ims.every((im) => !im.hasDesignInformation);
    const body = [
      `${source.title} › ${section}`,
      `### ${section}`,
      `The ${source.title} page shows each room design as a picture with its name as the caption:`,
      lines.join("\n"),
      noInfo
        ? "The pictures are illustrations of the rooms. They carry no printed labels, callouts, capacities, dimensions or equipment names, so this page does not state the equipment or size of each design."
        : "",
    ].filter(Boolean).join("\n\n") + "\n";
    const metadata = buildMetadata({
      source, stage: source.stage, url: pageUrl, pageTitle: source.title, section, body, relevant: true, lastCrawled: transcribedAt,
    });
    out.push({
      id: stableId(pageUrl, "room-design-pictures"), sourceId: source.id, title: `${source.title} › ${section}`, url: pageUrl, body, metadata,
      additional: { contentHash: sha1(body), parentUrl: pageUrl, crawlNotes: `transcribed from images: ${ims.map((i) => i.imageUrl.split("/").pop()).join(", ")} (https://avispl.com/wp-content/uploads/2025/01/)` },
      relationIds: [], timestamp: `${transcribedAt}T00:00:00.000Z`,
    });
  }
  return out;
}

async function main() {
  const raws = new Map<string, RawScrape>();
  for (const f of (await readdir(RAW_DIR)).filter((x) => x.endsWith(".json"))) {
    const r = JSON.parse(await readFile(join(RAW_DIR, f), "utf8")) as RawScrape;
    if (f === `${r.id}.json`) raws.set(r.id, r);
  }
  const repeated = findRepeatedBlocks([...raws.values()].filter((r) => /(^|\.)avispl\.com$/.test(new URL(r.url).hostname)).map((r) => r.markdown));

  const records: IngestRecord[] = [];
  const rows: string[] = [];
  for (const s of newSources()) {
    const can = canScrape(s);
    const raw = raws.get(s.id);
    if (!can.ok || !raw) { rows.push(`${s.id}\tSKIPPED (${can.reason ?? "no raw file"})\t0\t0\t${s.stage}`); continue; }
    const rule = PREP[s.id];
    const prep = prepRaw(raw, s.title, rule);
    const b = buildPageRecords(s, prep.raw, repeated);
    const kept = b.records.filter((r) => !rule?.dropSections?.test(r.metadata.section));
    records.push(...kept);
    const words = kept.reduce((n, r) => n + r.body.split(/\s+/).filter(Boolean).length, 0);
    rows.push(`${s.id}\tok\t${words}\t${kept.length}\t${[...new Set(kept.map((r) => r.metadata.journey_stage))].join(",")}\tleakage: ${b.leakage.join("; ") || "none"}\tdropped thin: ${b.thinSections.join(" / ") || "none"}\tlink-only: ${b.linkOnlySections.join(" / ") || "none"}\tprep: ${prep.notes.join("; ") || "none"}`);
  }

  const t = JSON.parse(await readFile(TRANSCRIPTIONS_FILE, "utf8")) as { transcribedAt: string; images: ImageEntry[] };
  const imageRecords = buildImageRecords(t.images, t.transcribedAt);
  records.push(...imageRecords);
  rows.push(`design pictures\tok\t${imageRecords.reduce((n, r) => n + r.body.split(/\s+/).length, 0)}\t${imageRecords.length}\t${imageRecords.map((r) => r.metadata.journey_stage).join(",")}`);

  // Relations: primary record (first in file order) of each target, from the existing records.jsonl (read only) or the new records.
  const existing = await readJsonl(join(DATA_DIR, RECORDS_FILENAME));
  const primary = new Map<string, string>();
  for (const r of [...existing, ...records]) if (!primary.has(r.sourceId)) primary.set(r.sourceId, r.id);
  const unresolved: string[] = [];
  for (const r of records) {
    const isImage = imageRecords.includes(r);
    const targets = isImage ? [r.sourceId] : NEW_RELATIONS[r.sourceId] ?? [];
    const ids = targets.map((tg) => primary.get(tg) ?? (unresolved.push(`${r.sourceId} -> ${tg}`), "")).filter(Boolean);
    r.relationIds = [...new Set(ids)].filter((id) => id !== r.id);
  }

  const errors: string[] = [];
  const existingIds = new Set(existing.map((r) => r.id));
  const seen = new Set<string>();
  for (const r of records) {
    try { validateRecord(r); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
    if (seen.has(r.id)) errors.push(`duplicate id ${r.id} (${r.sourceId})`);
    if (existingIds.has(r.id)) errors.push(`id ${r.id} (${r.sourceId}) already exists in ${RECORDS_FILENAME}`);
    if (r.metadata.status !== "needs_review") errors.push(`${r.id}: status must be needs_review`);
    seen.add(r.id);
  }
  await writeFile(NEW_RECORDS_FILE, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log("source\tstatus\twords\trecords\tstages");
  for (const row of rows) console.log(row);
  const byStage = new Map<string, number>();
  for (const r of records) byStage.set(r.metadata.journey_stage, (byStage.get(r.metadata.journey_stage) ?? 0) + 1);
  console.log(`\nrecords: ${records.length} -> ${NEW_RECORDS_FILE}`);
  console.log(`by stage: ${[...byStage].map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`unresolved relations: ${[...new Set(unresolved)].join("; ") || "none"}`);
  if (errors.length) { for (const e of errors) console.error("ERROR:", e); process.exit(1); }
  console.log("all records valid (ChunkMetadataSchema strict, url, additional < 1024 bytes, no local-only fields, unique ids)");
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
