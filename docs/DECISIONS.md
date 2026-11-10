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
