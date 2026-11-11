import type { ClientProfile } from "@avispl/hydra";

/**
 * SERVER ONLY. Saves what a customer told the advisor.
 * Always one `[client-profile]` JSON log line, and an upsert into the
 * clients database `avispl_clients_dev` (owner decision 2026-11-11; create it once with `pnpm hydra clients:create`). A failed save never breaks the
 * chat: it is logged and the caller carries on.
 */
export async function saveProfile(p: ClientProfile, log: (line: string) => void = console.warn): Promise<"saved" | "logged"> {
  log(`[client-profile] ${JSON.stringify(p)}`);
  try {
    const { saveClientProfile } = await import("@avispl/hydra");
    const res = await saveClientProfile(p);
    log(`[client-profile] stored ${res.id} in ${res.database}`);
    return "saved";
  } catch (e) {
    console.error("client profile not stored:", e instanceof Error ? `${e.name}: ${e.message}` : e);
    return "logged";
  }
}
