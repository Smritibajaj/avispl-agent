# Decisions and verified facts (read this before coding)

Date: 2026-11-10. These supersede `plan.original.md` wherever they differ. Source: HydraDB v2 docs and Chrome checks of the live pages.

## 1. HydraDB v2 (verified from docs.hydradb.com)

- Base URL `https://api.hydradb.com`, headers `Authorization: Bearer <key>` and `API-Version: 2`. SDK: TypeScript `@hydradb/sdk` (`HydraDBClient`, camelCase options), Python `hydradb-sdk`.
- A **database** is created with `database_metadata_schema` (`client.databases.create({ database, databaseMetadataSchema })`). Wait for `GET /databases/status` -> `infra.ready_for_ingestion: true` before ingesting. Collections are created on first write. We use ONE collection: `meeting-room-journey`.
- Schema is additive only. Embedding flags only at creation, only on VARCHAR, max 6. Max 32 fields. Undeclared `metadata` keys are rejected on ingest (so a filter on them matches nothing).
- Multi-value = comma-joined VARCHAR, filter with `contains` / `contains_any`. No arrays.
- Filters (`metadata_filters`): top-level keys take operator objects `{equals}`, `{contains}`, `{contains_any:[...]}`; multiple keys = AND; no range/fuzzy. Keys under `additional_metadata` take bare values. A valid filter with no match returns EMPTY (HydraDB never widens) -> our store must implement the relax-and-retry.
- Size caps: `metadata` 16 KiB, `additional_metadata` 1 KiB (compact JSON, bytes).
- **Two ingest paths** (`POST /context/ingest`, multipart, `type=knowledge`):
  - Files (`documents` + `document_metadata`): PDF/DOCX/MD/CSV/TXT. Each `document_metadata` item allows ONLY `id`, `metadata`, `additional_metadata`, `relations`. `title`, `url`, `timestamp` return 400.
  - App sources (`app_knowledge`, JSON string): allows `id`, `title`, `url`, `timestamp`, `kind`, `provider`, `external_id`, `fields{kind,title,body}`, `metadata`, `additional_metadata`, `relations{ids}`. **We use this path for scraped pages** (title and url are native).
  - `upsert` defaults to true: same `id` replaces.
- Indexing: poll `GET /context/status` (`queued -> processing -> graph_creation -> completed | errored`). Searchable at `graph_creation`; graph traversal needs `completed`.
- Query (`POST /query`, `client.query({...})`): `type: "knowledge"`, `query_by: "hybrid"|"text"`, `mode: "fast"|"thinking"|"auto"` (omitted = auto), `alpha` (0.8 default; lower for literal tokens), `recency_bias` (0.4 default; we use 0.1), `max_results` (default 10, max 250), `metadata_filters`, `graph_context` (default true; thinking mode always includes it), `query_forceful_relations` (thinking only).
- Response: `data.chunks[]` (`chunk_uuid`, `id` = source id, `chunk_content`, `source_title`, `relevancy_score`, `metadata`), `data.sources[]` (`id`, `title`, `type`, `url`), `data.graph_context.query_paths[].triplets[]` (`source{name,type}`, `relation{canonical_predicate, context}`, `target{name,type}`) with `source_chunk_ids`, `chunk_relations`, `chunk_id_to_group_ids`, and `data.additional_context` (linked sources).
- Graph is extracted automatically at ingest. Forceful links between whole sources: `relations.ids`. Bring Your Own Graph exists (`origin: "byog"`), but is NOT built in v0 unless native extraction proves inadequate (docs/plan Phase 7).
- Connected Subgraph endpoint is item-level (threads/links), not entity traversal. There is no documented get-chunk-by-id call: cache chunk text from query results.
- NOT verified: exact `contains` semantics (token vs substring) -> vocab has no substring collisions (`checks.ts`); whether chunk `metadata` includes every declared field; pricing/credits (blog posts disagree) -> check dashboard before bulk ingest.
- HydraDB MCP (`https://mcp.hydradb.com`) is for dev-time inspection/ops. The app's runtime path uses the SDK (typed, hard filters enforced in our code). The user will wire MCPs themselves.

## 2. What we saw on the live pages (Chrome, 2026-11-10)

| Source | Observation | Manifest status |
|---|---|---|
| #2 Reference_Designs.pdf (2021) | 404 | `dead_link` (ask Nancy for the current PDF; Q1 depends on it) |
| #5 Standardization eBook landing | Summary + 6 topics only; the eBook arrives after a form | `gated` |
| #41 Symphony docs (KnowledgeOwl) | Reader login page | `login_required` |
| #45 Help Desk (ServiceNow) | Login/portal | `login_required` (replace with ONE hand-written "How to get support" record, content from #44) |
| #52 Carrollton Bank | Teams Phone / cloud calling, not meeting rooms | `off_scope` |
| #10 Concept Catalog 2024-25 | 84-page PDF; cover is VR/immersive; Chrome gives no text | `page_ranges_needed` |
| #6, #7, #9, #35 | URL truncated with an ellipsis in the brief | `needs_resolution` (never guess suffixes) |
| #59 Healthcare, #60 Higher Ed | Mostly simulation/esports/video walls; one hybrid-collaboration bullet each | `partial_scope` |
| #27 Logitech | Meeting-room products plus Education/Government/Personal workspace sections | `partial_scope` |
| #50 Financial institution (London), #54 7-Eleven | Skype for Business / Polycom era | `ready` with `legacy_platform: true` |
| #56 Bernalillo County | Numbers are analytics + client estimates (footnote on page) | `ready` with `metrics_are_estimates: true` |
| #55 Tampa, #49 CBRE | Mixed (video wall, signage, fit-out) | `partial_scope` |
| Symphony page | Content lives in `main` as separate heading+paragraph blocks; generic "article" extraction returns only a blog teaser | scrape must be verified per page |
| Smart Workplace HSV eBook | Reads fine in a real browser; a licensing paragraph sits near the top (features depend on Teams Premium/Copilot licences, tenant setup, region) | disclosure text still needs Nancy's exact sign-off |

Boilerplate to strip on every avispl.com page: the mega-menu (Video Walls, broadcast, simulation...), the 15-country site list, the 50-state contact form, footer, logo marquee. Only crawl `avispl.com` (never the regional sites).

## 3. Rules for all agents

1. Do not invent: URL suffixes, licensing text, room specs, outcomes, SLAs, prices.
2. A mention is not a deployment. IDRC may be cited only for capabilities the page says were deployed.
3. Never ingest or cite a truncated URL (`ChunkMetadataSchema` rejects "…").
4. `golden_queries` and `priority` are LOCAL manifest fields. Never send them to HydraDB.
5. Never commit `.env`. Never print keys.
6. Credits: the user runs this on their own machine with their own keys. Allowed without asking: Firecrawl scrape of the 7 P0 pages (listed in the ingest brief) and a HydraDB smoke test of at most 20 clearly synthetic records in the DEV database only. Everything beyond that (the remaining sources, any production database, bulk ingest) needs the user's explicit yes in chat first.
7. Do not edit `packages/shared` (owned by the integrator). If you need a contract change, say exactly what in your final report.
8. Stay inside your own directory.

## 4. Local testing vs production (decided 2026-11-10)

- The GitHub repo `hydra-db/hydradb` is an AGPL Rust graph database (Cypher/Bolt, run with cargo). Its README does not mention the hosted v2 API (`/context/ingest`, `/query`, metadata schema, hybrid search). We do NOT assume Docker gives us the hosted API. Founders contact from the docs: founders@hydradb.com.
- The SDK docs show only a token option, no base-URL override. Agent C must check the installed `@hydradb/sdk` types; if no override exists, use a thin raw-fetch client for the 4 endpoints we need.
- Environments:
  1. **dev** = hosted HydraDB, database `avispl_meeting_room_dev` (real behaviour: graph, hybrid ranking). The user has the key and runs Claude Code on their own machine, so agents CAN use `HYDRADB_API_KEY` from `.env` (dev database only, until the user approves production).
  2. **prod** = hosted HydraDB, database `avispl_meeting_room_v0`, same schema.
  3. **offline** = `packages/hydra` mock server in Docker (port 4010): HydraDB-compatible SUBSET for plumbing tests only. It proves nothing about relevance or graph quality and must label its responses `mock: true`.
- `HYDRADB_BASE_URL` (default `https://api.hydradb.com`) selects the target.

## 5. HydraDB findings (hydra-agent, 2026-11-10; docs + SDK types + mock only, NOT live)

Verified from installed `@hydradb/sdk` 2.1.8 types and v2 docs:
- The SDK accepts a `baseUrl` override (corrects section 4). `packages/hydra` uses the SDK only; the same client targets hosted HydraDB and the mock.
- The query response has no `data.sources[]`; citations come from chunk `metadata`. `additional_context` is a map keyed by chunk id (it includes neighbouring chunks); forceful links are in `data.forceful_relations.declared`.
- `source_chunk_ids` is per query path; each triplet `relation` carries its own `chunk_id`. `origin` is documented only for BYOG.
- `enable_match` exists on schema fields; `packages/hydra/src/schema.ts` sets it on the 9 filter fields at creation (not in the shared contract yet).
- `context.chunks` / `context.inspect` exist (corrects "no get-chunk-by-id call"); unused.
- Ingest returns 202; forceful links "can be lost while ingestion rebuilds the graph". Delete returns 200 unless `X-HydraDB-Delete-Status: strict`; 409 `SOURCE_PROCESSING` while indexing.
- Reserved names: `source_id`, `chunk_id`, `metadata`. A misspelled filter operator silently returns empty. `metadata_filters` capped at 64 KiB / 500 values per list.

Still UNVERIFIED (needs `pnpm hydra smoke` against the DEV database with a real key):
- `contains` token vs substring; which metadata fields chunks return; whether `additional_metadata` comes back (if not, add a `manifest_source_id` VARCHAR(64) field to the shared schema, additive); real graph/triplet shape; thinking-mode latency vs the store's 5 s timeout; ingest -> `completed` time; whether `equals` works on `section` (it has embedding flags).

## 5. Verified by hydra-agent

Facts written by `pnpm hydra smoke` (packages/hydra/src/scripts/smoke.ts). Raw JSON in packages/hydra/smoke-results/.

### Smoke run 20261110173908 (2026-11-10T17:39:08.859Z, avispl_meeting_room_dev, @hydradb/sdk 2.1.8)
- Ingest: phase1 8/8 completed; ms to graph_creation {"min":2617,"median":2617,"max":2617,"n":8}; ms to completed {"min":15740,"median":28884,"max":28884,"n":8}; statuses seen ["graph_creation","completed"].
- Phase 2 relations: {"sent":1,"completed":1,"relationsCreated":1,"relationsErrors":[],"errored":[],"durationMs":20224}
- contains semantics: topics contains "equity" (substring of meeting_equity) -> HTTP 200, records [] => token (comma-member) match; contains "cisco" on "microsoft,cisco" -> ["#1","#3"]; equals "cisco" -> ["#3"]; contains_any [zoom,cisco] -> ["#1","#2","#3"].
- BOOL equals false -> ["#4"]; undeclared filter key -> HTTP 200 records []; valid no-match filter -> []; nested additional_metadata -> ["#3"]; text query exact token -> ["#5"].
- Chunk metadata returned: ["journey_stage","content_type","platforms","vendors","topics","room_sizes","industry","status","meeting_room_relevant","requires_disclosure","legacy_platform","metrics_are_estimates","edition","page_url","page_title","section","page_range","last_modified","cs_organization","cs_location","cs_rooms_count","last_crawled"]; MISSING: []; additional_metadata returned: true; data.sources present: true.
- data keys ["tabular_data","chunks","sources","graph_context","additional_context","graph","forceful_relations"]; chunk keys ["chunk_uuid","id","collection","sub_tenant_id","chunk_content","source_type","source_upload_time","source_title","source_last_updated_time","layout","relevancy_score","additional_metadata","metadata","extra_context_ids"]; chunks per record {"smoke-20261110173908-1":1,"smoke-20261110173908-2":1,"smoke-20261110173908-6":1,"smoke-20261110173908-8":1,"smoke-20261110173908-3":1,"smoke-20261110173908-5":1,"smoke-20261110173908-7":1,"smoke-20261110173908-4":1}.
- graph_context: keys ["query_paths","chunk_relations","chunk_id_to_group_ids"], query_paths 3, chunk_relations 14, path keys ["triplets","relevancy_score","combined_context","group_id","source_chunk_ids"], source_chunk_ids resolving to returned chunks null, origin present false. Example triplet: `{"source":{"entity_id":"8476c998da114ab579e9f13eceb66fb8","identifier":null,"name":"fjordlantern","namespace":"organizations","type":"ORGANIZATION"},"relation":{"canonical_predicate":"has standard room template","chunk_id":"smoke-20261110173908-6_chunk_0000","context":"Fjordlantern has a standard room template that specifies one display for huddle rooms and two displays for medium rooms.","raw_predicate":"has standard room template","relationship_id":"da1405ec9cdd7f19289b310bac697783","source_entity_id":"8476c998da114ab579e9f13eceb66fb8","target_entity_id":"769caf9846fef2fdc4ffe15280c7c990","temporal_details":null,"timestamp":1794332376.262029},"target":{"entity_id":"769caf9846fef2fdc4ffe15280c7c990","identifier":null,"name":"standard room template","namespace":"concepts","type":"CONCEPT"}}`
- additional_context: 0 entries, record ids []; forceful-relation target found: true; forceful_relations field: {"declared":[],"inferred":[]}.
- Latency (client wall ms, 20 results, filtered): thinking {"min":1880,"median":2716,"max":3389,"n":3}, fast {"min":625,"median":804,"max":819,"n":3}.
- Ingest rejections: [{"name":"undeclared_metadata_key","accepted":false,"status":400,"code":"INVALID_INPUT"},{"name":"additional_metadata_over_1KiB","accepted":false,"status":400,"code":"INVALID_INPUT"}].
- Store hard filters hide needs_review records: {"hits":0,"smokeHits":0,"relaxed":true,"latencyMs":294}.
- Cleanup: {"ids":8,"result":{"success":true,"message":"Successfully deleted 8 source(s)","results":[{"id":"smoke-20261110173908-1","deleted":true},{"id":"smoke-20261110173908-2","deleted":true},{"id":"smoke-20261110173908-3","deleted":true},{"id":"smoke-20261110173908-4","deleted":true},{"id":"smoke-202611101

## 6. Decisions on 2026-11-10 (evening)

- **Licensing disclosure approved by the project owner** ("approve all the things, nothing is pending on Nancy"). `packages/shared/content/disclosure.txt` now holds the paragraph from the Smart Workplace eBook page, copied verbatim from `packages/ingest/data/review/disclosure-candidate.txt`. Known wrinkle: it says "features listed below", which reads oddly at the end of a chat answer; wording may only change with a new approved text.
- `requires_disclosure` is set per record (text names Copilot, Microsoft Places or Teams Premium), no longer per source, so the disclosure is not appended to unrelated answers (monitoring, support).
- HydraDB reserves the metadata field name `source_url` (undocumented); the hydra package stores it as `page_url`.
- Ollama support removed; the app runs Claude models only. Graph panel removed from the UI at the owner's request.
- Dev database `avispl_meeting_room_dev` holds 251 published records from 54 sources. Still unavailable: Reference Designs PDF (404), standardization eBook (form), "Bowling Alley" and "Hybrid Meeting Hacks" eBooks (not found), Symphony docs (login), Elevate eBook sub-pages (not scraped).
- **Later the same evening: the owner decided no licensing disclosure is required.** It is switched OFF by default (`apps/web/src/config/disclosure.ts`). Answers no longer call `getLicensingDisclosure` or append the disclosure; licensing statements appear only as cited source content. `LICENSING_DISCLOSURE=on` in `.env` turns it back on (the approved text stays in `packages/shared/content/disclosure.txt`). This supersedes hard rule 2 in CLAUDE.md while the switch is off; the "never invent licensing text" part of rule 1 still applies.
