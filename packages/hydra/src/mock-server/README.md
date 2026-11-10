# HydraDB mock server (offline plumbing tests)

**This is not HydraDB.** It is a HydraDB-v2-compatible *subset* that proves our wiring (SDK calls, wire
shapes, filters, relax-and-retry, merge/dedupe/per-source cap, citation mapping). It proves **nothing about
relevance, ranking, chunking or graph quality**: search is plain keyword matching (SQLite FTS5 via `node:sqlite`,
or a small in-memory BM25 when FTS5 is unavailable), `graph_context` is always empty, and every response carries
`meta.mock: true` (plus the `X-HydraDB-Mock: true` header). Only the hosted dev database tells the truth.

## Run

```bash
pnpm hydra mock                                            # http://0.0.0.0:4010
docker compose -f packages/hydra/docker/docker-compose.yml up --build   # same, in node:22-slim
HYDRADB_BASE_URL=http://localhost:4010 HYDRADB_API_KEY=anything HYDRADB_DATABASE=avispl_meeting_room_dev pnpm hydra db:create
```

Env: `PORT` (4010), `HOST`, `MOCK_SEARCH` (`auto|fts5|bm25`), `MOCK_READY_AFTER_MS` (provisioning delay, 500),
`MOCK_STEP_MS` (per indexing step, 300), `MOCK_GRAPH` (`none` default | `metadata`; docker-compose sets `metadata`). State is in memory and lost on restart.

## Demo graph (`MOCK_GRAPH=metadata`, opt-in)

Lets the UI graph panel be exercised offline. Triplets are built deterministically from each RETURNED chunk's
declared metadata only (never free text): page_title -covers_stage-> journey_stage, -mentions_platform-> platforms,
-mentions_vendor-> vendors, -covers_topic-> topics; case studies: cs_organization -case_study_of-> page_title and
-located_in-> cs_location. Neutral predicates only (a mention is not a deployment). Shape = v2
`graph_context.query_paths[].triplets[]`, one path per returned chunk, `relation.chunk_id` and `source_chunk_ids`
= that chunk, `relation.context` = "mock: derived from metadata". It says nothing about HydraDB's real graph.

## Endpoints

| Endpoint | Notes |
|---|---|
| `POST /databases` | schema rules: <=32 fields, <=6 embedding flags, flags only on VARCHAR, no ARRAY, unique names, unknown options (e.g. `purpose`) rejected; 409 `DATABASE_ALREADY_EXISTS` |
| `GET /databases/status` | `infra.ready_for_ingestion` turns true after `MOCK_READY_AFTER_MS` |
| `GET /databases/{db}/metadata-schema` | returns the declared schema |
| `POST /context/ingest` | multipart, `type=knowledge`, `app_knowledge` only (documents/memories -> 400); 422 before ready; 202 |
| `GET /context/status` | `queued -> processing -> graph_creation -> completed` by elapsed time; unknown id -> `errored`/`FILE_NOT_FOUND` |
| `POST /query` | `equals` / `contains` / `contains_any`, bare forms, nested `additional_metadata`; forceful relations in thinking mode -> `additional_context` |
| `DELETE /context` | `X-HydraDB-Delete-Status: strict` -> 409 `SOURCE_PROCESSING` while indexing, 404 if nothing deleted |

## Rules it enforces (stricter than or equal to the docs, so our bugs surface here)

- Bearer token required (any non-empty value); `API-Version` must be `2` if sent.
- Undeclared `metadata` keys -> 400; wrong types -> 400; VARCHAR `max_length` checked in **bytes**; arrays on VARCHAR -> 400.
- `metadata` > 16 KiB or `additional_metadata` > 1 KiB (compact JSON, UTF-8 bytes) -> 400 for the whole request.
- Unknown `app_knowledge[]` item fields -> 400 (catches `golden_queries`/`priority` leaks). Ids with commas -> 400.
- Filters: undeclared key or misspelled operator -> 200 with **empty** results (never widened); `null` -> 400;
  two operators in one object -> 400; `contains`/`contains_any` on non-VARCHAR -> 400; type mismatch -> 400.
- `contains` is comma-member (token) matching, as the docs describe it. Whether the real API does substring
  matching is exactly what `pnpm hydra smoke` measures; do not treat the mock's answer as evidence.
- Linked (forceful-relation) chunks follow the request's filters, as documented.

Not implemented: documents/files, memories, BYOG, connectors, webhooks, ACLs, `collections` (multi), `ids`/`titles`
scoping, recency, alpha, real thinking-mode behaviour, graph.
