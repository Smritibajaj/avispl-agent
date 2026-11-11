/**
 * delete-stale — remove records that no longer exist locally, AFTER the current records are indexed.
 * Usage: pnpm hydra delete-stale --previous <old records.jsonl> [--file <current records.jsonl>] [--dry-run]
 *                                [--database <name>] [--allow-non-dev]
 *
 * Order of work (the live site reads this database, so it must never be left half-loaded):
 *   1. stale = ids in --previous that are not in the current file. Nothing else is ever deleted.
 *   2. Every CURRENT id must report indexing status graph_creation or completed (searchable). If any is
 *      missing, queued, processing or errored, the script stops before deleting anything.
 *   3. Stale ids are deleted in small batches (strict status). The first failed batch stops the run.
 *   4. The stale ids are checked again: none may still report an indexing status.
 */
import { readFile } from "node:fs/promises";
import { HydraApi } from "../client";
import { HydraError, HydraValidationError } from "../errors";
import { parseRecordsJsonl } from "../records";
import { DEFAULT_RECORDS, parseArgs, printJson, run, scriptConfig, sleep } from "./common";

const SEARCHABLE = new Set(["graph_creation", "completed"]);

async function idsOf(file: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new HydraError("config", `cannot read ${file}`);
  }
  return text.split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { id: string }).id);
}

run(async () => {
  const args = parseArgs();
  const dryRun = args.flags.has("dry-run");
  const cfg = scriptConfig(args, { write: true, dryRun });
  const previousFile = args.values.get("previous");
  if (!previousFile) throw new HydraValidationError("usage: pnpm hydra delete-stale --previous <old records.jsonl> [--file <current>] [--dry-run]");
  const file = args.values.get("file") ?? DEFAULT_RECORDS;

  const { records, problems } = parseRecordsJsonl(await readFile(file, "utf8"));
  if (problems.length) throw new HydraValidationError(`${problems.length} invalid record(s) in ${file}; nothing deleted`);
  if (!records.length) throw new HydraValidationError(`${file} contains no records; refusing to delete anything`);
  const current = new Set(records.map((r) => r.id));
  const stale = [...new Set(await idsOf(previousFile))].filter((id) => !current.has(id));
  console.log(`[hydra] current ${current.size} record(s); previous file lists ${stale.length} id(s) that no longer exist`);
  if (!stale.length) return;
  if (dryRun) {
    printJson("DRY RUN: would delete (after checking that every current id is indexed)", stale);
    return;
  }

  const api = new HydraApi(cfg);
  // 2. every current record must be searchable before anything is removed
  const notReady: { id: string; status: string }[] = [];
  const ids = [...current];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const statuses = new Map((await api.contextStatus(chunk)).map((s) => [s.id, s.indexingStatus]));
    for (const id of chunk) {
      const st = statuses.get(id) ?? "missing";
      if (!SEARCHABLE.has(st)) notReady.push({ id, status: st });
    }
  }
  if (notReady.length) {
    for (const n of notReady.slice(0, 20)) console.error(`  NOT READY ${n.id}: ${n.status}`);
    throw new HydraError("response", `${notReady.length} current record(s) are not indexed yet; nothing deleted. Run the ingest again or wait, then retry.`);
  }
  console.log(`[hydra] all ${ids.length} current records are indexed (graph_creation or completed); deleting ${stale.length} stale id(s)`);

  // 3. delete, small batches, stop at the first failure
  let deleted = 0;
  for (let i = 0; i < stale.length; i += 10) {
    const batch = stale.slice(i, i + 10);
    const res = (await api.deleteContext(batch)) as { success?: boolean; results?: { id?: string; deleted?: boolean }[] } | undefined;
    const failed = (res?.results ?? []).filter((r) => r.deleted === false).map((r) => r.id);
    if (res?.success === false || failed.length) {
      throw new HydraError("response", `delete batch ${i / 10 + 1} reported a failure (${failed.join(", ") || "success=false"}); stopped after ${deleted} deletion(s)`);
    }
    deleted += batch.length;
    console.log(`  batch ${i / 10 + 1}: deleted ${batch.length} (${deleted}/${stale.length})`);
  }

  // 4. the stale ids must be gone
  await sleep(3000);
  const left: string[] = [];
  for (let i = 0; i < stale.length; i += 50) {
    try {
      // a deleted (or never ingested) id answers errored / FILE_NOT_FOUND (seen live 2026-11-11)
      for (const s of await api.contextStatus(stale.slice(i, i + 50))) if (s.indexingStatus && s.errorCode !== "FILE_NOT_FOUND") left.push(`${s.id}=${s.indexingStatus}`);
    } catch (e) {
      // an "unknown id" error for deleted ids is the expected answer on some API versions
      console.log(`  status check of deleted ids answered: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`[hydra] deleted ${deleted} stale id(s); still reporting a status afterwards: ${left.length}${left.length ? ` (${left.slice(0, 10).join(", ")})` : ""}`);
  if (left.length) process.exitCode = 2;
});
