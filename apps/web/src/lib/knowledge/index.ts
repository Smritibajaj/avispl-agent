import type { KnowledgeStore } from "@avispl/shared";

/**
 * SERVER ONLY. Never import this from a client component (the store reads API keys from env).
 * The knowledge base is HydraDB: HYDRADB_API_KEY and HYDRADB_DATABASE must be set (see .env.example).
 */
let cached: Promise<KnowledgeStore> | undefined;

export function getStore(): Promise<KnowledgeStore> {
  if (cached) return cached;
  const store: Promise<KnowledgeStore> = import("@avispl/hydra").then(({ createHydraKnowledgeStore }) =>
    createHydraKnowledgeStore({
      apiKey: process.env.HYDRADB_API_KEY,
      baseUrl: process.env.HYDRADB_BASE_URL,
      database: process.env.HYDRADB_DATABASE,
      collection: process.env.HYDRADB_COLLECTION,
    }),
  );
  // Do not cache a failed construction (missing key, bad database name); the next request retries.
  store.catch(() => {
    if (cached === store) cached = undefined;
  });
  cached = store;
  return store;
}
