/**
 * db:status — GET /databases/status (and the remote metadata schema with --schema).
 * Usage: pnpm hydra db:status [--database <name>] [--schema] [--dry-run]
 */
import { HydraApi } from "../client";
import { parseArgs, printJson, run, scriptConfig } from "./common";

run(async () => {
  const args = parseArgs();
  const dryRun = args.flags.has("dry-run");
  const cfg = scriptConfig(args, { write: false, dryRun });
  if (dryRun) {
    console.log(`DRY RUN: GET ${cfg.baseUrl}/databases/status?database=${encodeURIComponent(cfg.database)} (not sent)`);
    return;
  }
  const api = new HydraApi(cfg);
  const s = await api.databaseStatus();
  printJson("database status", { database: cfg.database, ready_for_ingestion: s.readyForIngestion, infra: s.infra, message: s.message });
  if (args.flags.has("schema")) printJson("metadata schema", await api.metadataSchema());
});
