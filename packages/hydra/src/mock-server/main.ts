import { startMockServer } from "./server";

// Entry point: `pnpm hydra mock` locally, or the Docker image (port 4010).
const port = Number(process.env.PORT ?? process.env.MOCK_PORT ?? 4010);
const host = process.env.HOST ?? "0.0.0.0";
const search = (process.env.MOCK_SEARCH ?? "auto") as "auto" | "fts5" | "bm25";
const readyAfterMs = Number(process.env.MOCK_READY_AFTER_MS ?? 500);
const stepMs = Number(process.env.MOCK_STEP_MS ?? 300);
const graph = process.env.MOCK_GRAPH === "metadata" ? "metadata" : "none";

const mock = await startMockServer({ port, host, search, readyAfterMs, stepMs, graph });
console.log(`HydraDB MOCK (plumbing only, meta.mock=true) listening on ${mock.url} [search=${mock.engine.searchKind} graph=${graph}]`);
const stop = () => mock.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
