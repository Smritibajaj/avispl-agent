/** Print, per record in data/records.jsonl, each detected tag with the text snippet that triggered it. Read-only. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RECORDS_FILENAME, type IngestRecord } from "@avispl/shared";
import { DATA_DIR } from "../paths";
import { getSource } from "../sources";
import { explainTags, tagInputFromBody, TAG_FIELDS } from "../tagger";

const only = process.argv.includes("--source") ? process.argv[process.argv.indexOf("--source") + 1] : undefined;
const records = readFileSync(join(DATA_DIR, RECORDS_FILENAME), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as IngestRecord);
for (const r of records) {
  if (only && r.sourceId !== only) continue;
  const always = getSource(r.sourceId)?.always ?? {};
  console.log(`\n## ${r.sourceId} › ${r.metadata.section}`);
  console.log(`   ${TAG_FIELDS.map((f) => `${f}=${r.metadata[f] || "-"}`).join("  ")}`);
  console.log(`   always: ${JSON.stringify(always)}`);
  for (const [tag, why] of Object.entries(explainTags(tagInputFromBody(r.body, r.metadata.page_title)))) console.log(`   ${tag.padEnd(20)} <- "${why}"`);
}
