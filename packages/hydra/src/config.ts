import { HydraConfigError } from "./errors";

/**
 * Configuration from env. Pure: does NOT load .env (apps/web imports this through the store, and Next.js
 * loads env itself). Scripts call `loadDotEnv()` from scripts/env.ts first.
 */

export const DEFAULT_BASE_URL = "https://api.hydradb.com";
export const DEFAULT_COLLECTION = "meeting-room-journey";
/** The only database writes are allowed against without an explicit `--allow-non-dev` flag. */
export const DEV_DATABASE = "avispl_meeting_room_dev";
export const PROD_DATABASE = "avispl_meeting_room_v0";

/** HydraDB: lowercase letters, digits, `-`, `_`, up to 255 chars (create-tenant docs). */
const DATABASE_RE = /^[a-z0-9_-]{1,255}$/;

export interface HydraConfig {
  apiKey: string;
  baseUrl: string;
  database: string;
  collection: string;
}

export interface HydraConfigInput {
  apiKey?: string;
  baseUrl?: string;
  database?: string;
  collection?: string;
}

type Env = Record<string, string | undefined>;

export function resolveConfig(
  input: HydraConfigInput = {},
  env: Env = typeof process !== "undefined" ? process.env : {},
  opts: { requireKey?: boolean } = {},
): HydraConfig {
  const apiKey = (input.apiKey ?? env.HYDRADB_API_KEY ?? "").trim();
  const baseUrl = (input.baseUrl ?? env.HYDRADB_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const database = (input.database ?? env.HYDRADB_DATABASE ?? "").trim();
  const collection = (input.collection ?? env.HYDRADB_COLLECTION ?? DEFAULT_COLLECTION).trim();

  if (opts.requireKey !== false && !apiKey) {
    throw new HydraConfigError("HYDRADB_API_KEY is not set (put it in the repo-root .env; never commit it)");
  }
  if (!database) throw new HydraConfigError("HYDRADB_DATABASE is not set (dev: avispl_meeting_room_dev)");
  if (!DATABASE_RE.test(database)) {
    throw new HydraConfigError(`HYDRADB_DATABASE "${database}" must match ${DATABASE_RE} (lowercase, digits, - and _)`);
  }
  if (!collection) throw new HydraConfigError("HYDRADB_COLLECTION is empty");
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("protocol");
  } catch {
    throw new HydraConfigError(`HYDRADB_BASE_URL "${baseUrl}" is not a valid http(s) URL`);
  }
  return { apiKey, baseUrl, database, collection };
}

/** Safe for logs: never includes the key, only whether one is present. */
export function describeConfig(c: HydraConfig): string {
  return `baseUrl=${c.baseUrl} database=${c.database} collection=${c.collection} apiKey=${c.apiKey ? "set" : "MISSING"}`;
}

export const isMockBaseUrl = (baseUrl: string): boolean => {
  try {
    const h = new URL(baseUrl).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
};
