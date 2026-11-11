# @avispl/hydra

HydraDB v2 provider: database setup, ingest of `packages/ingest/data/records.jsonl`, the `KnowledgeStore`
adapter (`createHydraKnowledgeStore`) used by apps/web, and the client-profiles database (`src/client-profiles.ts`).

One code path: the official `@hydradb/sdk` (2.1.8). Its `baseUrl` option (BaseClient.d.ts) targets either
`https://api.hydradb.com`.

```bash
pnpm hydra db:create [--dry-run]           # schema from HYDRA_METADATA_SCHEMA, idempotent, waits for ready
pnpm hydra db:status [--schema]
pnpm hydra ingest [--file f.jsonl] [--dry-run] [--confirm-bulk]   # 2 phases: records, then relations (upsert)
pnpm hydra query:cli "question" [--stage plan_design --room-size small --exact "Rally Bar"] [--dry-run]
pnpm hydra smoke [--dry-run] [--keep]      # DEV database only, 8 synthetic records, then deletes them
pnpm hydra clients:create                  # create the client-profiles database (once)
pnpm --filter @avispl/hydra test           # unit tests
```

Guards: writes go only to `avispl_meeting_room_dev` unless `--allow-non-dev`; more than 20 records against a
real database needs `--confirm-bulk`; the key is never printed (`apiKey=set|MISSING`).

Store behaviour (src/store.ts): hard filters `status=published` + `meeting_room_relevant=true` on every query
(applied last, model cannot override); model filters vocab-checked; main query hybrid/thinking/20/alpha 0.8/
recency 0.1/graph + forceful relations, 5 s timeout, no retries; `exactTerms` adds a parallel `query_by: "text"`
query merged by reciprocal-rank fusion; dedupe by chunk id; <= 3 chunks per source (`additional_metadata.sourceId`);
refs `S1..Sn` after merge; one relax retry with only the hard filters; hits without a citable URL are dropped.
Non-fatal problems go to `onDiagnostic`. See MCP.md for dev-time inspection with HydraDB's MCP server.
