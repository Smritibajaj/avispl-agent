/**
 * db:create — create the database from HYDRA_METADATA_SCHEMA (purpose stripped, enable_match added on
 * filter fields), idempotent (409 = exists), then wait for infra.ready_for_ingestion.
 * Usage: pnpm hydra db:create [--database <name>] [--dry-run] [--allow-non-dev] [--timeout <s>]
 */
import { HydraApi } from "../client";
import { HydraValidationError } from "../errors";
import { checkSchemaLimits, toSdkSchema, toWireSchema } from "../schema";
import { CreateDatabaseRequestSchema } from "../wire";
import { waitReady } from "../database";
import { parseArgs, printJson, run, scriptConfig } from "./common";

run(async () => {
  const args = parseArgs();
  const dryRun = args.flags.has("dry-run");
  const cfg = scriptConfig(args, { write: true, dryRun });
  const wire = { database: cfg.database, database_metadata_schema: toWireSchema() };
  const parsed = CreateDatabaseRequestSchema.safeParse(wire);
  const limits = checkSchemaLimits(wire.database_metadata_schema);
  if (!parsed.success || limits.length) {
    throw new HydraValidationError("schema invalid", [...(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)), ...limits]);
  }
  if (dryRun) {
    printJson(`DRY RUN: POST ${cfg.baseUrl}/databases`, wire);
    console.log(`[hydra] validated: ${wire.database_metadata_schema.length} fields, not sent`);
    return;
  }
  const api = new HydraApi(cfg);
  const res = await api.createDatabase(toSdkSchema());
  if (res.created) console.log(`[hydra] create accepted: ${res.status ?? ""} ${res.message ?? ""}`);
  else {
    console.log(`[hydra] database "${cfg.database}" already exists (409): not re-created. Schema changes are additive only.`);
    try {
      const remote = (await api.metadataSchema()) as Record<string, unknown> | undefined;
      const list = (remote?.databaseMetadataSchema ?? remote?.database_metadata_schema ?? remote?.schema ?? []) as { name?: string }[];
      const remoteNames = new Set(list.map((f) => f.name));
      const missing = wire.database_metadata_schema.filter((f) => !remoteNames.has(f.name)).map((f) => f.name);
      if (list.length && missing.length) console.log(`[hydra] WARNING remote schema lacks: ${missing.join(", ")} (add via PATCH metadata-schema; embedding flags cannot be added later)`);
      else if (list.length) console.log(`[hydra] remote schema has all ${wire.database_metadata_schema.length} declared field names`);
    } catch (e) {
      console.log(`[hydra] could not read remote schema: ${(e as Error).message}`);
    }
  }
  await waitReady(api, Number(args.values.get("timeout") ?? 600) * 1000, (l) => console.log(l));
});
