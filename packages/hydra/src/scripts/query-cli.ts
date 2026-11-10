/**
 * query:cli — run one question through createHydraKnowledgeStore and print hits, scores and triplets.
 * Usage: pnpm hydra query:cli "<question>" [--stage plan_design] [--content-type page] [--platform microsoft,cisco]
 *        [--vendor logitech] [--topic copilot] [--room-size small] [--industry legal] [--exact "MTR,Rally"]
 *        [--max 8] [--json] [--dry-run] [--database <name>]
 */
import type { SearchFilters, SearchRequest } from "@avispl/shared";
import { createHydraKnowledgeStore, planSearch, type StoreDiagnostic } from "../store";
import { HydraValidationError } from "../errors";
import { QueryRequestWireSchema } from "../wire";
import { parseArgs, printJson, run, scriptConfig } from "./common";

const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

run(async () => {
  const args = parseArgs();
  const dryRun = args.flags.has("dry-run");
  const question = args.positionals.join(" ").trim();
  if (!question) throw new HydraValidationError('usage: pnpm hydra query:cli "<question>" [--stage ...]');
  const cfg = scriptConfig(args, { write: false, dryRun });

  const filters: Record<string, unknown> = {
    journey_stage: args.values.get("stage"),
    content_type: args.values.get("content-type"),
    platforms: list(args.values.get("platform")),
    vendors: list(args.values.get("vendor")),
    topics: list(args.values.get("topic")),
    room_size: args.values.get("room-size"),
    industry: args.values.get("industry"),
  };
  for (const k of Object.keys(filters)) if (filters[k] === undefined) delete filters[k];
  const req: SearchRequest = {
    query: question,
    filters: filters as SearchFilters,
    exactTerms: list(args.values.get("exact")),
    maxResults: args.values.get("max") ? Number(args.values.get("max")) : undefined,
  };

  const plan = planSearch(req, cfg);
  for (const r of plan.requests) {
    const v = QueryRequestWireSchema.safeParse(r);
    if (!v.success) throw new HydraValidationError("query request invalid", v.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  if (plan.droppedFilterValues.length) console.error(`[hydra] dropped (not in vocab): ${plan.droppedFilterValues.join(", ")}`);
  if (dryRun) {
    plan.requests.forEach((r, i) => printJson(`DRY RUN: POST ${cfg.baseUrl}/query #${i + 1}`, r));
    console.log("[hydra] validated, not sent (relax retry would resend with ONLY the hard filters if this returned nothing)");
    return;
  }

  const diags: StoreDiagnostic[] = [];
  const store = createHydraKnowledgeStore({ database: cfg.database, collection: cfg.collection, timeoutMs: Number(args.values.get("timeout") ?? 15) * 1000, onDiagnostic: (d) => diags.push(d) });
  const res = await store.search(req);
  if (args.flags.has("json")) {
    printJson("response", { ...res, diagnostics: diags });
    return;
  }
  console.log(`\n${res.hits.length} hit(s), relaxed=${res.relaxed}, ${res.latencyMs} ms`);
  console.log(`applied filters: ${JSON.stringify(res.appliedFilters)}`);
  for (const h of res.hits) {
    const flags = Object.entries(h.flags).filter(([, v]) => v).map(([k]) => k);
    console.log(`\n[${h.ref}] score=${h.score.toFixed(3)} ${h.journeyStage}/${h.contentType} ${h.title}`);
    console.log(`     ${h.sourceUrl}${h.pageRange ? ` p.${h.pageRange}` : ""}  section="${h.section}" source=${h.sourceId} chunk=${h.chunkId}${flags.length ? ` flags=${flags.join(",")}` : ""}`);
    console.log(`     ${h.text.replace(/\s+/g, " ").slice(0, 220)}${h.text.length > 220 ? "…" : ""}`);
  }
  console.log(`\ngraph: ${res.graph.length} triplet(s)`);
  for (const t of res.graph.slice(0, 25)) {
    const refs = t.chunkIds.map((c) => res.hits.find((h) => h.chunkId === c)?.ref ?? c).join(",");
    console.log(`  (${t.source.name}:${t.source.type}) -[${t.relation}]-> (${t.target.name}:${t.target.type})${t.score !== undefined ? ` score=${t.score.toFixed(2)}` : ""}${refs ? ` [${refs}]` : ""}${t.origin ? ` origin=${t.origin}` : ""}`);
    if (t.context) console.log(`      "${t.context.slice(0, 160)}"`);
  }
  if (res.linked?.length) {
    console.log(`\nlinked (additional_context): ${res.linked.length}`);
    for (const l of res.linked) console.log(`  ${l.sourceId} ${l.title} ${l.sourceUrl}`);
  }
  if (diags.length) {
    console.log(`\ndiagnostics (${diags.length}):`);
    for (const d of diags.slice(0, 30)) console.log(`  ${d.kind}${d.chunkId ? ` ${d.chunkId}` : ""}: ${d.detail}`);
  }
});
