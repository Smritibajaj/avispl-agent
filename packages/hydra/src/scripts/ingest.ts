/**
 * ingest — read packages/ingest/data/records.jsonl, validate every record (zod + byte caps), then:
 *   phase 1: all records WITHOUT relations, poll /context/status until terminal
 *   phase 2: upsert records that have relationIds, WITH relations.ids
 * Usage: pnpm hydra ingest [--file <path>] [--dry-run] [--batch-size N] [--skip-relations]
 *                          [--database <name>] [--allow-non-dev] [--confirm-bulk]
 * More than 20 records against a real (non-mock) database needs --confirm-bulk (DECISIONS.md rule 6).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HydraApi } from "../client";
import { isMockBaseUrl } from "../config";
import { HydraError, HydraValidationError } from "../errors";
import { batchItems, planIngest, runIngest } from "../ingest";
import { parseRecordsJsonl } from "../records";
import { AppKnowledgeBatchSchema } from "../wire";
import { DEFAULT_RECORDS, PKG_ROOT, parseArgs, printJson, run, scriptConfig } from "./common";

run(async () => {
  const args = parseArgs();
  const dryRun = args.flags.has("dry-run");
  const cfg = scriptConfig(args, { write: true, dryRun });
  const file = args.values.get("file") ?? DEFAULT_RECORDS;
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new HydraError("config", `cannot read ${file} (has packages/ingest produced records.jsonl yet?)`);
  }
  const { records, problems, warnings } = parseRecordsJsonl(text);
  for (const p of problems) console.error(`INVALID line ${p.line ?? "?"} id=${p.id ?? "?"}: ${p.problems.join("; ")}`);
  for (const w of warnings) console.error(`warning id=${w.id}: ${w.problems.join("; ")}`);
  if (problems.length) throw new HydraValidationError(`${problems.length} invalid record(s) in ${file}; nothing sent`);
  if (!records.length) throw new HydraValidationError(`${file} contains no records; nothing to ingest`);

  const plan = planIngest(records, cfg);
  for (const f of plan.precheckFailures) console.error(`PRECHECK FAIL ${f.id}: ${f.message}`);
  const batchSize = Number(args.values.get("batch-size") ?? 20);
  const v1 = plan.phase1.length ? AppKnowledgeBatchSchema.safeParse(plan.phase1) : { success: true as const };
  const v2 = plan.phase2.length ? AppKnowledgeBatchSchema.safeParse(plan.phase2) : { success: true as const };
  if (!v1.success || !v2.success) {
    const issues = [...(!v1.success ? v1.error.issues : []), ...(!v2.success ? v2.error.issues : [])];
    throw new HydraValidationError("app_knowledge items invalid", issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const byStatus = records.reduce<Record<string, number>>((a, r) => ((a[r.metadata.status] = (a[r.metadata.status] ?? 0) + 1), a), {});
  console.log(`[hydra] ${records.length} valid records (${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(", ")}); phase1=${plan.phase1.length} phase2=${plan.phase2.length} precheck_failures=${plan.precheckFailures.length}`);

  if (dryRun) {
    const b1 = batchItems(plan.phase1, batchSize, 1_500_000);
    console.log(`DRY RUN: would POST ${cfg.baseUrl}/context/ingest ${b1.length} time(s) in phase 1 (form: type=knowledge, database=${cfg.database}, collection=${cfg.collection}, app_knowledge=<JSON>)`);
    if (plan.phase1[0]) printJson("first phase-1 app_knowledge item", plan.phase1[0]);
    if (plan.phase2[0]) printJson("first phase-2 app_knowledge item (upsert=true)", plan.phase2[0]);
    console.log("[hydra] validated, nothing sent");
    return;
  }
  if (plan.phase1.length > 20 && !isMockBaseUrl(cfg.baseUrl) && !args.flags.has("confirm-bulk")) {
    throw new HydraError("config", `${plan.phase1.length} records is a bulk ingest: get the user's explicit yes, then re-run with --confirm-bulk`);
  }

  const api = new HydraApi(cfg);
  const report = await runIngest(api, records, { batchSize, skipRelations: args.flags.has("skip-relations"), log: (l) => console.log(l) });
  const errored = [...report.precheckFailures, ...report.phase1.errored, ...(report.phase2?.errored ?? []), ...(report.phase2?.relationsErrors ?? [])];
  console.log(`[hydra] phase1: completed ${report.phase1.completed.length}/${report.phase1.sent}, errored ${report.phase1.errored.length}, pending ${report.phase1.pending.length}, ${Math.round(report.phase1.durationMs / 1000)}s`);
  if (report.phase2)
    console.log(`[hydra] phase2: completed ${report.phase2.completed.length}/${report.phase2.sent}, relations_created ${report.phase2.relationsCreated ?? 0}, errored ${report.phase2.errored.length}, pending ${report.phase2.pending.length}`);
  for (const e of errored) console.log(`  ERRORED ${e.id} [${e.stage}] ${e.code ?? ""} ${e.message}`);
  const dir = join(PKG_ROOT, "reports");
  await mkdir(dir, { recursive: true });
  const out = join(dir, `ingest-${cfg.database}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(out, JSON.stringify({ database: cfg.database, collection: cfg.collection, file, report }, null, 2));
  console.log(`[hydra] report written: ${out}`);
  if (errored.length || report.phase1.pending.length) process.exitCode = 2;
});
