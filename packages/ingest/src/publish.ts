/**
 * Flip a reviewed source's records to `published`:  tsx src/publish.ts --source <id> [--unpublish]
 * Approval is stored per record id + contentHash in data/review/approvals.json, so a later re-scrape
 * that changes the text puts the record back to needs_review automatically (prepare.ts re-applies approvals).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RECORDS_FILENAME, type IngestRecord } from "@avispl/shared";
import { DATA_DIR, REVIEW_DIR } from "./paths";
import { APPROVALS_FILE, type Approvals } from "./prepare";
import { getSource } from "./sources";

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const sourceId = arg("--source");
  const unpublish = process.argv.includes("--unpublish");
  if (!sourceId) throw new Error("usage: publish --source <id> [--unpublish]");
  if (!getSource(sourceId)) throw new Error(`unknown source ${sourceId}`);
  const file = join(DATA_DIR, RECORDS_FILENAME);
  if (!existsSync(file)) throw new Error(`${file} not found; run prepare first`);
  const records = (await readFile(file, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as IngestRecord);
  const approvals: Approvals = existsSync(APPROVALS_FILE) ? JSON.parse(await readFile(APPROVALS_FILE, "utf8")) : {};
  let n = 0;
  for (const r of records.filter((x) => x.sourceId === sourceId)) {
    r.metadata.status = unpublish ? "needs_review" : "published";
    if (unpublish) delete approvals[r.id];
    else approvals[r.id] = r.additional.contentHash;
    n++;
  }
  if (!n) throw new Error(`no records for ${sourceId} in ${RECORDS_FILENAME}`);
  await mkdir(REVIEW_DIR, { recursive: true });
  await writeFile(APPROVALS_FILE, JSON.stringify(approvals, null, 2));
  await writeFile(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`${unpublish ? "unpublished" : "published"} ${n} record(s) of ${sourceId}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
