import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_DATABASE, PROD_DATABASE, describeConfig, isMockBaseUrl, resolveConfig, type HydraConfig } from "../config";
import { HydraError } from "../errors";

export const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPO_ROOT = join(PKG_ROOT, "..", "..");
export const DEFAULT_RECORDS = join(REPO_ROOT, "packages", "ingest", "data", "records.jsonl");

/** Repo-root .env (never printed). */
export function loadDotEnv() {
  loadEnv({ path: join(REPO_ROOT, ".env"), quiet: true });
}

export interface Args {
  flags: Set<string>;
  values: Map<string, string>;
  positionals: string[];
}

export function parseArgs(argv = process.argv.slice(2)): Args {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positionals: string[] = [];
  const VALUED = new Set(["database", "collection", "file", "stage", "content-type", "platform", "topic", "room-size", "industry", "vendor", "max", "exact", "batch-size", "timeout", "previous"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (v !== undefined) values.set(k, v);
      else if (VALUED.has(k) && argv[i + 1] !== undefined) values.set(k, argv[++i]!);
      else flags.add(k);
    } else positionals.push(a);
  }
  return { flags, values, positionals };
}

/**
 * Config for scripts. `--database` overrides env. Writes to anything but the dev database (or a local mock)
 * need `--allow-non-dev` (DECISIONS.md rule 6: production needs the user's explicit yes first).
 */
export function scriptConfig(args: Args, opts: { write: boolean; dryRun: boolean }): HydraConfig {
  loadDotEnv();
  const cfg = resolveConfig(
    { database: args.values.get("database"), collection: args.values.get("collection") },
    process.env,
    { requireKey: !opts.dryRun },
  );
  if (opts.write && !opts.dryRun && cfg.database !== DEV_DATABASE && !isMockBaseUrl(cfg.baseUrl) && !args.flags.has("allow-non-dev")) {
    throw new HydraError(
      "config",
      `refusing to write to "${cfg.database}" (only ${DEV_DATABASE} is allowed without --allow-non-dev; ${PROD_DATABASE} needs the user's explicit approval)`,
    );
  }
  console.error(`[hydra] ${describeConfig(cfg)}${isMockBaseUrl(cfg.baseUrl) ? " (LOCAL MOCK)" : ""}`);
  return cfg;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function printJson(label: string, v: unknown) {
  console.log(`--- ${label} ---`);
  console.log(JSON.stringify(v, null, 2));
}

/** Run a script main with typed-error reporting (no stack traces with request internals). */
export function run(main: () => Promise<void>) {
  main().catch((e) => {
    if (e instanceof HydraError) {
      console.error(`[hydra] ${e.kind} error: ${e.message}${e.requestId ? ` (request_id ${e.requestId})` : ""}`);
    } else {
      console.error(`[hydra] error: ${e instanceof Error ? e.message : String(e)}`);
    }
    process.exit(1);
  });
}
