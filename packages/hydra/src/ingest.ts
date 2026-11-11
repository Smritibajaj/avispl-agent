import type { IngestRecord } from "@avispl/shared";
import type { AppKnowledgeItem, HydraApi } from "./client";
import { checkRecordLimits, jsonBytes, toAppKnowledgeItem } from "./records";

export const TERMINAL = new Set(["completed", "errored"]);
export const KNOWN_STATUSES = new Set(["queued", "processing", "graph_creation", "completed", "errored"]);

export interface IngestOptions {
  /** Items per POST /context/ingest. No per-request item cap is documented; we stay small. */
  batchSize?: number;
  /** Soft cap on the app_knowledge JSON string per request. */
  maxBatchBytes?: number;
  pollIntervalMs?: number;
  /** Give up waiting for terminal states after this long (per phase). */
  pollTimeoutMs?: number;
  /** Ids per GET /context/status call. */
  statusBatch?: number;
  log?: (line: string) => void;
  /** Skip phase 2 (relations). */
  skipRelations?: boolean;
  /** Ids already in the database that relations may point to (not sent again). */
  existingIds?: ReadonlySet<string>;
}

export interface IdFailure {
  id: string;
  stage: "precheck" | "ingest" | "indexing" | "relations";
  code?: string;
  message: string;
}

export interface PhaseReport {
  sent: number;
  accepted: number;
  completed: string[];
  errored: IdFailure[];
  /** Still not terminal when the poll timed out. */
  pending: { id: string; status: string }[];
  /** ms from send to first seen status, per id. */
  firstSeenMs: Record<string, Partial<Record<string, number>>>;
  durationMs: number;
  relationsCreated?: number;
  relationsErrors?: IdFailure[];
}

export interface IngestReport {
  precheckFailures: IdFailure[];
  phase1: PhaseReport;
  phase2?: PhaseReport;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function batchItems(items: AppKnowledgeItem[], batchSize: number, maxBytes: number): AppKnowledgeItem[][] {
  const out: AppKnowledgeItem[][] = [];
  let cur: AppKnowledgeItem[] = [];
  let bytes = 2;
  for (const it of items) {
    const b = jsonBytes(it) + 1;
    if (cur.length && (cur.length >= batchSize || bytes + b > maxBytes)) {
      out.push(cur);
      cur = [];
      bytes = 2;
    }
    cur.push(it);
    bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Build phase-1 and phase-2 items and run the local pre-checks (no network). */
export function planIngest(
  records: IngestRecord[],
  target: { database: string; collection: string },
  /** Ids already in the database that a relation may point to, although they are not in `records`. */
  existingIds: ReadonlySet<string> = new Set(),
) {
  const knownIds = new Set([...records.map((r) => r.id), ...existingIds]);
  const precheckFailures: IdFailure[] = [];
  const phase1: AppKnowledgeItem[] = [];
  const phase2: AppKnowledgeItem[] = [];
  for (const r of records) {
    const item = toAppKnowledgeItem(r, target, { withRelations: false });
    const problems = checkRecordLimits(item);
    if (problems.length) {
      precheckFailures.push({ id: r.id, stage: "precheck", message: problems.join("; ") });
      continue;
    }
    phase1.push(item);
    const withRel = toAppKnowledgeItem(r, target, { withRelations: true, knownIds });
    if (withRel.relations?.ids.length) phase2.push(withRel);
  }
  // Phase-2 targets must have passed the pre-check too.
  const ok = new Set(phase1.map((i) => i.id));
  for (const it of phase2) if (it.relations) it.relations.ids = it.relations.ids.filter((x) => ok.has(x) || existingIds.has(x));
  return { precheckFailures, phase1, phase2: phase2.filter((i) => i.relations && i.relations.ids.length > 0) };
}

async function sendAndWait(
  api: HydraApi,
  items: AppKnowledgeItem[],
  opts: Required<Omit<IngestOptions, "log" | "skipRelations" | "existingIds">> & { log: (l: string) => void; upsert?: boolean; stage: "ingest" | "relations" },
): Promise<PhaseReport> {
  const t0 = Date.now();
  const errored: IdFailure[] = [];
  const relationsErrors: IdFailure[] = [];
  let accepted = 0;
  let relationsCreated = 0;
  const queued: string[] = [];
  const batches = batchItems(items, opts.batchSize, opts.maxBatchBytes);
  for (const [bi, batch] of batches.entries()) {
    const res = await api.ingestAppKnowledge(batch, opts.upsert !== undefined ? { upsert: opts.upsert } : {});
    opts.log(`  batch ${bi + 1}/${batches.length}: ${batch.length} items -> queued ${res.successCount}, failed ${res.failedCount}`);
    const byId = new Map(res.results.map((r) => [r.id, r]));
    for (const it of batch) {
      const r = byId.get(it.id);
      if (!r || r.status === "failed" || r.error) {
        errored.push({ id: it.id, stage: opts.stage, code: r?.errorCode ?? undefined, message: r?.error ?? "no result for id" });
        continue;
      }
      accepted++;
      queued.push(it.id);
      if (typeof r.relationsCreated === "number") relationsCreated += r.relationsCreated;
      if (r.relationsError) relationsErrors.push({ id: it.id, stage: "relations", message: r.relationsError });
    }
  }

  const firstSeenMs: PhaseReport["firstSeenMs"] = {};
  const sendDone = Date.now();
  const last = new Map<string, string>();
  let open = [...queued];
  const completed: string[] = [];
  while (open.length && Date.now() - sendDone < opts.pollTimeoutMs) {
    await sleep(opts.pollIntervalMs);
    for (let i = 0; i < open.length; i += opts.statusBatch) {
      const chunk = open.slice(i, i + opts.statusBatch);
      const statuses = await api.contextStatus(chunk);
      for (const s of statuses) {
        last.set(s.id, s.indexingStatus);
        const seen = (firstSeenMs[s.id] ??= {});
        if (seen[s.indexingStatus] === undefined) seen[s.indexingStatus] = Date.now() - t0;
        if (s.indexingStatus === "completed") completed.push(s.id);
        if (s.indexingStatus === "errored")
          errored.push({ id: s.id, stage: "indexing", code: s.errorCode, message: s.errorMessage || s.errorCode });
      }
    }
    open = open.filter((id) => !TERMINAL.has(last.get(id) ?? ""));
    const counts: Record<string, number> = {};
    for (const id of queued) {
      const st = last.get(id) ?? "unknown";
      counts[st] = (counts[st] ?? 0) + 1;
    }
    opts.log(`  status: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  }
  return {
    sent: items.length,
    accepted,
    completed: [...new Set(completed)],
    errored,
    pending: open.map((id) => ({ id, status: last.get(id) ?? "unknown" })),
    firstSeenMs,
    durationMs: Date.now() - t0,
    ...(opts.stage === "relations" ? { relationsCreated, relationsErrors } : {}),
  };
}

/**
 * Two phases so forceful-relation targets exist before anything points at them:
 *  1. every record WITHOUT `relations`; wait until terminal.
 *  2. upsert only records with relationIds (targets that completed in phase 1), WITH `relations: {ids}`.
 */
export async function runIngest(api: HydraApi, records: IngestRecord[], options: IngestOptions = {}): Promise<IngestReport> {
  const opts = {
    batchSize: options.batchSize ?? 20,
    maxBatchBytes: options.maxBatchBytes ?? 1_500_000,
    pollIntervalMs: options.pollIntervalMs ?? 3000,
    pollTimeoutMs: options.pollTimeoutMs ?? 15 * 60_000,
    statusBatch: options.statusBatch ?? 50,
    log: options.log ?? (() => {}),
  };
  const existing = options.existingIds ?? new Set<string>();
  const plan = planIngest(records, { database: api.config.database, collection: api.config.collection }, existing);
  for (const f of plan.precheckFailures) opts.log(`  precheck FAIL ${f.id}: ${f.message}`);

  opts.log(`phase 1: ${plan.phase1.length} items without relations`);
  const phase1 = await sendAndWait(api, plan.phase1, { ...opts, stage: "ingest" });

  if (options.skipRelations || plan.phase2.length === 0) {
    return { precheckFailures: plan.precheckFailures, phase1 };
  }
  const done = new Set(phase1.completed);
  const p2 = plan.phase2
    .filter((it) => done.has(it.id))
    .map((it) => ({ ...it, relations: { ids: it.relations!.ids.filter((x) => done.has(x) || existing.has(x)) } }))
    .filter((it) => it.relations.ids.length > 0);
  opts.log(`phase 2: ${p2.length} items re-ingested (upsert) with relations.ids`);
  const phase2 = await sendAndWait(api, p2, { ...opts, upsert: true, stage: "relations" });
  return { precheckFailures: plan.precheckFailures, phase1, phase2 };
}
