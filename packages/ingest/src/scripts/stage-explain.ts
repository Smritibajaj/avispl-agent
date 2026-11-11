/** Print every record whose journey stage differs from its page default, and near misses, with the evidence. Read-only. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RECORDS_FILENAME, type IngestRecord } from "@avispl/shared";
import { DATA_DIR } from "../paths";
import { getSource } from "../sources";
import { detectStage, tagInputFromBody } from "../tagger";

const file = process.argv[2] ?? join(DATA_DIR, RECORDS_FILENAME);
const records = (await readFile(file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as IngestRecord);
for (const r of records) {
  const src = getSource(r.sourceId);
  const first = r.body.split("\n", 1)[0] ?? "";
  const pageTitle = first.startsWith(`${r.metadata.page_title} › `) ? r.metadata.page_title : (first.split(" › ")[0] ?? "");
  const ev = detectStage(tagInputFromBody(r.body, pageTitle));
  const moved = src && r.metadata.journey_stage !== src.stage;
  if (!ev && !moved) continue;
  console.log(`${moved ? "MOVED" : ev && ev.stage !== r.metadata.journey_stage ? "DETECTED-NOT-APPLIED" : "same"} | ${r.sourceId} (${src?.stage}/${src?.contentType}) -> ${r.metadata.journey_stage} | ${r.metadata.section.slice(0, 70)} | ${ev ? `${ev.stage} d=${ev.deploy} r=${ev.run} n=${ev.sentences} heading=${ev.heading}` : "no text evidence (heading/page-range rule)"}`);
}
