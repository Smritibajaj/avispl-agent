#!/usr/bin/env node
/**
 * Builds the data behind the /graph page from the records that were loaded into HydraDB.
 *
 *   pnpm --filter @avispl/web graph:build      (run again after every ingest)
 *
 * Reads packages/ingest/data/records.jsonl (local only, not deployed) and writes src/lib/kb-graph.json.
 * The output holds titles, public avispl.com URLs, section names and tags only: no record text.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const records = readFileSync(resolve(here, "../../../packages/ingest/data/records.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

const list = (v) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const sources = new Map();
for (const r of records) {
  const m = r.metadata;
  let s = sources.get(r.sourceId);
  if (!s) sources.set(r.sourceId, (s = { id: r.sourceId, title: m.page_title, type: m.content_type, url: m.source_url, records: 0, stages: {}, platforms: new Set(), vendors: new Set(), topics: new Set(), sections: [] }));
  s.records++;
  s.stages[m.journey_stage] = (s.stages[m.journey_stage] ?? 0) + 1;
  for (const p of list(m.platforms)) s.platforms.add(p);
  for (const v of list(m.vendors)) s.vendors.add(v);
  for (const t of list(m.topics)) s.topics.add(t);
  if (m.section && !s.sections.includes(m.section)) s.sections.push(m.section);
}
const out = {
  records: records.length,
  sources: [...sources.values()].map((s) => ({
    ...s,
    primaryStage: Object.entries(s.stages).sort((a, b) => b[1] - a[1])[0][0],
    platforms: [...s.platforms].sort(),
    vendors: [...s.vendors].sort(),
    topics: [...s.topics].sort(),
  })),
};
writeFileSync(resolve(here, "../src/lib/kb-graph.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`kb-graph.json: ${out.sources.length} sources from ${out.records} records`);
