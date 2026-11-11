/**
 * clients:create — create the client-profiles database (its own schema, see client-profiles.ts), idempotent,
 * then wait until it is ready. Usage: pnpm hydra clients:create [--dry-run]
 */
import { HydraApi } from "../client";
import { CLIENT_PROFILE_SCHEMA, clientProfileSdkSchema, clientsConfig } from "../client-profiles";
import { waitReady } from "../database";
import { checkSchemaLimits } from "../schema";
import { HydraValidationError } from "../errors";
import { loadDotEnv, parseArgs, printJson, run } from "./common";

run(async () => {
  const args = parseArgs();
  const dryRun = args.flags.has("dry-run");
  loadDotEnv();
  const cfg = clientsConfig(process.env, { requireKey: !dryRun });
  const limits = checkSchemaLimits(CLIENT_PROFILE_SCHEMA);
  if (limits.length) throw new HydraValidationError("schema invalid", limits);
  if (dryRun) {
    printJson(`DRY RUN: POST ${cfg.baseUrl}/databases`, { database: cfg.database, database_metadata_schema: CLIENT_PROFILE_SCHEMA });
    return;
  }
  const api = new HydraApi(cfg);
  const res = await api.createDatabase(clientProfileSdkSchema());
  console.log(res.created ? `[hydra] create accepted for "${cfg.database}"` : `[hydra] database "${cfg.database}" already exists: not re-created`);
  await waitReady(api, 600_000, (l) => console.log(l));
});
