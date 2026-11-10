import type { HydraApi } from "./client";
import { HydraError } from "./errors";
import { toSdkSchema } from "./schema";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll GET /databases/status until infra.ready_for_ingestion is true. */
export async function waitReady(api: HydraApi, timeoutMs: number, log: (l: string) => void = () => {}, intervalMs = 3000) {
  const t0 = Date.now();
  for (;;) {
    const s = await api.databaseStatus();
    if (s.readyForIngestion) {
      log(`[hydra] ready_for_ingestion=true after ${Math.round((Date.now() - t0) / 1000)}s`);
      return { ...s, waitedMs: Date.now() - t0 };
    }
    if (Date.now() - t0 > timeoutMs)
      throw new HydraError("timeout", `database not ready after ${Math.round(timeoutMs / 1000)}s: ${JSON.stringify(s.infra)}`);
    log(`[hydra] waiting for provisioning: ${JSON.stringify(s.infra)}`);
    await sleep(intervalMs);
  }
}

/** Create (idempotent) + wait for readiness. */
export async function ensureDatabase(api: HydraApi, opts: { timeoutMs?: number; intervalMs?: number; log?: (l: string) => void } = {}) {
  const created = await api.createDatabase(toSdkSchema());
  const ready = await waitReady(api, opts.timeoutMs ?? 600_000, opts.log, opts.intervalMs);
  return { created: created.created, ...ready };
}
