/**
 * @avispl/hydra public surface. apps/web only needs `createHydraKnowledgeStore`.
 * Everything here is free of node:fs / dotenv so it is safe to import from Next.js server code.
 */
export { createHydraKnowledgeStore, MAIN_QUERY, PER_SOURCE_CAP, DEFAULT_MAX_RESULTS } from "./store";
export type { HydraStoreOptions, StoreDiagnostic } from "./store";
export { HydraError, HydraConfigError, HydraValidationError } from "./errors";
export type { HydraErrorKind } from "./errors";
export { resolveConfig, DEFAULT_BASE_URL, DEFAULT_COLLECTION, DEV_DATABASE } from "./config";
export type { HydraConfig } from "./config";
export { HARD_FILTERS, buildModelFilters, withHardFilters } from "./filters";
