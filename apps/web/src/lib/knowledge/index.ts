import type { KnowledgeStore } from "@avispl/shared";
import { MockKnowledgeStore } from "./mock-store";

/** SERVER ONLY. Never import this from a client component (the hydra backend reads API keys from env). */
export type BackendName = "mock" | "hydra";

export const backendName = (): BackendName =>
  process.env.KNOWLEDGE_BACKEND?.trim().toLowerCase() === "hydra" ? "hydra" : "mock";

/**
 * Where the data comes from, for honest labelling. The hydra store does not expose the mock server's
 * `meta.mock` flag, so a hydra base URL on localhost / 127.0.0.1 is treated as the offline mock (:4010).
 */
export type BackendTarget = "fixtures" | "offline-mock" | "hosted";
export const backendTarget = (): BackendTarget => {
  if (backendName() === "mock") return "fixtures";
  const base = process.env.HYDRADB_BASE_URL?.trim() || "https://api.hydradb.com";
  try {
    const host = new URL(base).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host === "host.docker.internal") return "offline-mock";
  } catch {
    /* invalid URL: the store reports it on first search */
  }
  return "hosted";
};

let cached: { name: BackendName; store: Promise<KnowledgeStore> } | undefined;

export function getStore(): Promise<KnowledgeStore> {
  const name = backendName();
  if (cached?.name === name) return cached.store;
  const store: Promise<KnowledgeStore> =
    name === "hydra"
      ? import("@avispl/hydra").then(({ createHydraKnowledgeStore }) =>
          createHydraKnowledgeStore({
            apiKey: process.env.HYDRADB_API_KEY,
            baseUrl: process.env.HYDRADB_BASE_URL,
            database: process.env.HYDRADB_DATABASE,
            collection: process.env.HYDRADB_COLLECTION,
          }),
        )
      : Promise.resolve(new MockKnowledgeStore());
  // Do not cache a failed construction (e.g. the hydra stub throwing); the next request retries.
  store.catch(() => {
    if (cached?.store === store) cached = undefined;
  });
  cached = { name, store };
  return store;
}

export { MockKnowledgeStore };
