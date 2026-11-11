# HydraDB schema documentation

How AVI-SPL meeting-room content is stored in HydraDB, which fields exist, which values are allowed, and how the agent queries them.
Everything here is taken from the code, so if the two ever disagree, the code wins and this file should be fixed:

| Topic | Source of truth |
|---|---|
| Field list and limits | `packages/shared/src/metadata.ts` (`HYDRA_METADATA_SCHEMA`, `ChunkMetadataSchema`) |
| Allowed values | `packages/shared/src/vocab.ts` |
| Wire names, `enable_match`, create checks | `packages/hydra/src/schema.ts` |
| Filters | `packages/hydra/src/filters.ts` |
| Query defaults, graph mapping | `packages/hydra/src/store.ts` |
| Record shape, byte limits | `packages/shared/src/records.ts`, `packages/hydra/src/records.ts` |
| App contract | `packages/shared/src/store.ts` |

---

## 1. Layout

| Level | Name | Notes |
|---|---|---|
| Database (dev) | `avispl_meeting_room_dev` | All writes go here. Anything else needs `--allow-non-dev`. |
| Database (prod) | `avispl_meeting_room_v0` | Do not write without an explicit decision. |
| Collection | `meeting-room-journey` | One collection for everything (`DEFAULT_COLLECTION`). Override with `HYDRADB_COLLECTION`. |
| Item | one `app_knowledge[]` entry | One section of a page, or one page range of a PDF. |

Database names match `^[a-z0-9_-]{1,255}$`. Config comes from `HYDRADB_DATABASE`, `HYDRADB_COLLECTION`, `HYDRADB_TIMEOUT_MS` and the API key in the environment (never commit keys).

## 2. One item (what gets ingested)

Type: `IngestRecord`. Written by `packages/ingest` as `records.jsonl`, read by `packages/hydra`.

| Field | Meaning |
|---|---|
| `id` | Stable id, `sha1(canonicalUrl + "#" + sectionSlug)`. Max 255 chars, **no commas**. Re-ingest (upsert) replaces the item. |
| `sourceId` | Source manifest slug, for example `ref-designs-page`. |
| `title` | Breadcrumb, for example `Symphony › Incident management`. |
| `url` | Exact citation URL, max 512 chars, never truncated (`…` or `...` is rejected). |
| `body` | Markdown. First line is the breadcrumb. Target 300 to 900 words, tables kept whole. |
| `metadata` | The 22 declared fields below. Undeclared keys are rejected by HydraDB, and rejected earlier by our strict zod schema. |
| `additional` | `contentHash` (required), `parentUrl`, `crawlNotes`. Compact JSON must be at most **1024 bytes**. |
| `relationIds` | Ids of other items to link (forceful relations). Only used in the second ingest phase. |
| `timestamp` | ISO date-time, used for recency ranking (page modified time, else crawl time). |

Size limits: `metadata` at most 16 KiB of compact JSON. `VARCHAR max_length` is counted in **bytes**, not characters.

## 3. Metadata fields (22 of 32 allowed)

Declared once at database creation. Types: `VARCHAR`, `BOOL`, `INT32`.
"Filter" means `enable_match: true` is set, so it can be used in `metadata_filters`.

| # | Field | Type | Max | Filter | Values and purpose |
|---|---|---|---|---|---|
| 1 | `journey_stage` | VARCHAR | 32 | yes | One of the 5 stages (section 4). Main filter. |
| 2 | `content_type` | VARCHAR | 32 | yes | One of 10 types (section 4). |
| 3 | `platforms` | VARCHAR | 64 | yes | Comma list from the platform vocabulary. |
| 4 | `vendors` | VARCHAR | 256 | yes | Comma list from the vendor vocabulary. |
| 5 | `topics` | VARCHAR | 256 | yes | Comma list from the topic vocabulary. |
| 6 | `room_sizes` | VARCHAR | 128 | yes | Comma list from the room-size vocabulary. |
| 7 | `industry` | VARCHAR | 32 | yes | Single value. Comes from a manual URL map, **not** from the page's own MARKET field. |
| 8 | `status` | VARCHAR | 16 | yes | `published` or `needs_review`. Queries always send `published`. |
| 9 | `meeting_room_relevant` | BOOL | | yes | `false` for off-scope sections. Queries always send `true`. |
| 10 | `requires_disclosure` | BOOL | | | Copilot, Places, Teams Premium chunks (licensing disclosure switch). |
| 11 | `legacy_platform` | BOOL | | | Skype for Business / Polycom era proof. |
| 12 | `metrics_are_estimates` | BOOL | | | For example Bernalillo analytics plus client estimates. |
| 13 | `edition` | VARCHAR | 16 | | PDFs: `2021`, `2024-25`, `2025-winter`. |
| 14 | `source_url` | VARCHAR | 512 | | Citation URL. **Sent to HydraDB as `page_url`** (section 5). |
| 15 | `page_title` | VARCHAR | 160 | | Citation. |
| 16 | `section` | VARCHAR | 160 | | Citation and searchable heading. **Dense and sparse embedding flags** (2 of the 6 allowed). |
| 17 | `page_range` | VARCHAR | 16 | | PDF citation, for example `41-47`. |
| 18 | `last_modified` | VARCHAR | 10 | | `YYYY-MM-DD` from page metadata. |
| 19 | `cs_organization` | VARCHAR | 160 | | Case study customer. |
| 20 | `cs_location` | VARCHAR | 80 | | Case study location. |
| 21 | `cs_rooms_count` | INT32 | | | Case study room count, used for sorting in code. Default `0`. |
| 22 | `last_crawled` | VARCHAR | 10 | | `YYYY-MM-DD` freshness. |

Defaults when a value is unknown (`EMPTY_METADATA_DEFAULTS`): empty strings for lists and text, `0` for `cs_rooms_count`, `false` for the three flags, `meeting_room_relevant: true`, `status: needs_review`, `industry: general`. Every key is always present so rows stay uniform.

### Limits that shape the design
- At most 32 fields and at most 6 embedding flags (we use 2).
- Embedding flags can only be set at creation, and only on `VARCHAR`.
- Later changes are **additive only**: no rename, retype or re-flag. Adding a field later is possible, fixing a wrong one is not.
- Arrays are not supported, so lists are comma-joined strings.
- Chunk results return `metadata`, so every citation field (URL, title, section, dates) is stored there.

## 4. Controlled vocabularies

Only these values are accepted in the matching fields (`vocab.ts`). The model's filter values are checked against them and unknown values are dropped.

| Vocabulary | Values |
|---|---|
| `journey_stage` | `plan_design`, `choose_platform`, `deploy`, `run_support`, `proof` |
| `content_type` | `page`, `ebook`, `interactive_ebook`, `pdf`, `blog`, `case_study`, `webcast`, `industry_page`, `disclosure`, `support_info` |
| `platforms` | `microsoft`, `cisco`, `zoom`, `google` |
| `vendors` | `logitech`, `crestron`, `neat`, `hp_poly`, `qsys`, `shure`, `sennheiser`, `lg`, `legrand`, `sony` |
| `topics` | `copilot`, `places`, `teams_premium`, `meeting_equity`, `interoperability`, `ease_of_use`, `ai_features`, `sustainability`, `security`, `accessibility_ada`, `standardization`, `monitoring`, `managed_services`, `support_maintenance`, `deployment`, `training`, `real_time_design`, `hybrid_meetings`, `roi` |
| `room_sizes` | `mobile`, `huddle`, `small`, `medium`, `large`, `classroom` |
| `industry` | `financial_services`, `legal`, `healthcare`, `higher_education`, `real_estate`, `government`, `transportation`, `technology`, `nonprofit`, `retail`, `general` |
| `status` | `published`, `needs_review` |

**Substring rule.** In the four comma-list vocabularies (platforms, vendors, topics, room sizes) no token may be a substring of another, because the exact semantics of HydraDB's `contains` are not documented. That is why it is `ai_features` and not `ai`, and `accessibility_ada` and not `ada`. `pnpm` checks enforce this (`packages/shared/src/checks.ts`). Single-value fields use `equals` and are exempt.

Lists are written with `joinList` and read with `splitList` (`a,b,c`).

## 5. Wire-name alias: `source_url` is `page_url`

HydraDB rejects a field called `source_url` at database creation (400 `INVALID_INPUT`, verified by probe on 2026-11-10). The reserved list is not fully documented (`source_id`, `chunk_id`, `metadata` are known). So:

- Code and the shared contract keep the logical name `source_url`.
- The wire name is `page_url`. `toWireMetadata` renames on ingest, `fromWireMetadata` renames back on query.
- Never use the logical name in direct API calls or in the HydraDB dashboard. Look for `page_url` there.

## 6. Hard filters and model filters

Every query gets two **hard filters**, added last by the store so the model can never override them:

```json
{ "status": { "equals": "published" }, "meeting_room_relevant": { "equals": true } }
```

The model may add filters through the search tools (`SearchFilters`). Only whitelisted keys with vocabulary values are sent:

| Model key | Operator | Wire field |
|---|---|---|
| `journey_stage` | `equals` | `journey_stage` |
| `content_type` | `equals` | `content_type` |
| `industry` | `equals` | `industry` |
| `platforms` | `contains_any` | `platforms` |
| `vendors` | `contains_any` | `vendors` |
| `topics` | `contains_any` | `topics` |
| `room_size` | `contains` | `room_sizes` |

Unknown keys (for example `status`) are ignored, unknown values are dropped and reported as a diagnostic. If model filters return nothing, the store retries once with the hard filters only and sets `relaxed: true`.

## 7. Query settings

Main query (`MAIN_QUERY` in `packages/hydra/src/store.ts`):

| Setting | Value |
|---|---|
| `type` | `knowledge` |
| `query_by` | `hybrid` |
| `mode` | `thinking` |
| `max_results` | 20 (then deduped and capped to the request, default 8) |
| `alpha` | 0.8 |
| `recency_bias` | 0.1 |
| `graph_context` | `true` |
| `query_forceful_relations` | `true` |
| `response_format` | `structured` |

If the model sends `exactTerms` (product names, SKUs) a second keyword-only query (`query_by: text`, no graph) runs in parallel and results are merged by reciprocal-rank fusion (k = 60). At most 3 chunks per source are kept. Hosted queries were measured at about 7 to 9 seconds, so the per-query timeout defaults to 12 s.

## 8. What the app gets back

`SearchResponse` (`packages/shared/src/store.ts`):

- `hits[]` (`EvidenceHit`): `ref` (`S1`, `S2`...), `chunkId`, `sourceId`, `text`, `title`, `sourceUrl`, `pageTitle`, `section`, `pageRange`, `journeyStage`, `contentType`, `lastModified`, `edition`, `csOrganization`, `csRoomsCount`, `flags` (`legacyPlatform`, `metricsAreEstimates`, `requiresDisclosure`), `score`.
- `graph[]` (`GraphTriplet`): see section 9.
- `linked[]`: text of linked sources pulled in by forceful relations.
- `relaxed`, `appliedFilters`, `latencyMs`.

A chunk without a valid citation URL is dropped, never shown.

## 9. Knowledge graph

HydraDB extracts entities and relations from item bodies at ingest. With `graph_context: true` a query returns `graph_context.query_paths[].triplets[]`, which the store maps to:

```ts
GraphTriplet {
  source:   { name, type }      // entity
  relation: string              // canonical_predicate
  target:   { name, type }      // entity
  context?: string              // sentence it was extracted from
  chunkIds: string[]            // hits whose traversal produced it
  origin?:  "extracted" | "byog" | "declared"
  score?:   number
}
```

- Triplets are deduped by `source|relation|target` (case-insensitive) and capped at 60.
- The graph exists only after an item's ingest status is `completed` (the pipeline goes `queued` > `processing` > `graph_creation` > `completed`, or `errored`).
- The `/graph` page calls `GET /api/graph?q=...`, which runs one search and returns these triplets plus source titles and URLs.
- There is no custom graph schema: entities and relations come from HydraDB's own extraction. We do not control entity types.

## 10. Ingest flow

1. `packages/ingest` scrapes sources from the manifest (Firecrawl) and writes `records.jsonl`.
2. Pre-check (no network): zod strict schema, id has no comma, URL not truncated, metadata under 16 KiB, `additional_metadata` under 1 KiB, each VARCHAR within its byte limit, vocabulary values valid.
3. Phase 1: `POST /context/ingest` in small batches, then poll `GET /context/status` until `completed` or `errored`.
4. Phase 2: add `relationIds` (forceful relations) once targets exist.
5. Upsert by `id` replaces an item, so a re-crawl is safe.

Local-only data (`priority`, `goldenQueries`) lives in the source manifest and must never reach HydraDB; the strict schema blocks it.

Commands (dev database only): `pnpm hydra db:status`, `pnpm hydra smoke`. Run `pnpm hydra --help` for the rest.

### Manual tags
`packages/ingest/data/config/manual-tags.json` adds `room_sizes`, `platforms` or `vendors` to single records (keyed by record id) when the text does not use the words the tagger looks for. Tags only steer search filters; they are never shown to the customer. Each entry needs a `why`.

## 10b. Client profiles (separate database)

What a customer tells the advisor is stored in its own database, never in the knowledge database (`packages/hydra/src/client-profiles.ts`).

| Point | Value |
|---|---|
| Database | `avispl_clients_dev` (`HYDRADB_CLIENTS_DATABASE`). Any other name is refused by the code. Create once: `pnpm hydra clients:create`. |
| Collection | `client-profiles` |
| When | When the advisor delivers a plan (its answer carries the booking button), and again when the customer sends the "Book a meeting" form. |
| Item id | `client-<chatId>`: one item per conversation, later saves replace it (upsert). |
| Body | Markdown: contact block (only after a meeting request: name, work email, company, region, best time, notes) and the question and answer pairs. |
| Fallback | Every save is also one `[client-profile]` log line; if HydraDB rejects the save the chat carries on. |

Fields (15, no embedding flags; "Filter" = `enable_match`):

| Field | Type | Max | Filter | Filled from |
|---|---|---|---|---|
| `company` | VARCHAR | 160 | yes | booking form |
| `sector` | VARCHAR | 64 | yes | answer to the sector question |
| `platform` | VARCHAR | 64 | yes | answer to the platform question |
| `project_type` | VARCHAR | 64 | yes | new rooms, upgrade or standardising |
| `journey_stage` | VARCHAR | 64 | yes | answer to the stage question |
| `room_sizes` | VARCHAR | 128 | yes | answer to the room sizes question |
| `priorities` | VARCHAR | 256 | | answer to the priorities question |
| `budget_level` | VARCHAR | 32 | yes | essential, standard or premium |
| `timeline` | VARCHAR | 64 | | answer to the timeline question |
| `support_need` | VARCHAR | 64 | | answer to the support question |
| `region` | VARCHAR | 80 | yes | booking form |
| `rooms_count` | INT32 | | | first "N rooms" found in the answers, else 0 |
| `meeting_requested` | BOOL | | yes | true once the booking form was sent |
| `created_on` | VARCHAR | 10 | | date of the save |
| `chat_id` | VARCHAR | 80 | | browser chat id |

Fields are matched to answers by the wording of the question the advisor asked, so they are best effort: a skipped or unrecognised question leaves the field empty, and the full question and answer list is always in the body. Name and work email are in the body only, never in a filterable field.

Personal data: keep access to this database limited, the booking form tells customers it is saved, and one profile is deleted with `pnpm hydra clients:delete --chat=<chat id>`. Still to decide before production: how long profiles are kept and who may read them. The advisor does not read profiles back.

### Manual tags
`packages/ingest/data/config/manual-tags.json` adds `room_sizes`, `platforms` or `vendors` to single records (keyed by record id) when the text does not use the words the tagger looks for. Tags only steer search filters; they are never shown to the customer. Each entry needs a `why`.

## 10b. Client profiles (second collection)

Owner decision 2026-11-11: what a customer tells the advisor is stored in the DEV database, collection `client-profiles` (`packages/hydra/src/client-profiles.ts`).

| Point | Value |
|---|---|
| When | When the advisor delivers a plan (its answer carries the booking button), and again when the customer sends the "Book a meeting" form. |
| Item id | `client-<chatId>`: one item per conversation, later saves replace it (upsert). |
| Body | Markdown: contact block (only after a meeting request: name, work email, company, region, best time, notes) and the question and answer pairs. |
| Metadata | Same 22 fields. `content_type: client_profile` (outside the knowledge vocabulary on purpose), `status: needs_review`, `meeting_room_relevant: false`, `page_title: Client profile`, `section: Intake answers` or `Meeting requested`, `cs_organization` = company, `cs_location` = region. |
| Safety | Different collection, and the hard filters would exclude these items anyway, so a profile can never be returned as evidence. Writes are refused for any database other than `avispl_meeting_room_dev` (or the local mock). |
| Fallback | Every save is also one `[client-profile]` log line. With `KNOWLEDGE_BACKEND=mock` only the log line is written. |

This collection holds personal data (name, work email). Keep database access limited, tell customers it is saved (the booking form does), and delete a profile on request by its id. The advisor does not read profiles back yet: they are for the AVI-SPL team.

## 11. Changing the schema safely

| Change | Possible? | How |
|---|---|---|
| Add a new field | Yes, additive | Add to `HYDRA_METADATA_SCHEMA` and `ChunkMetadataSchema`, keep under 32 fields, then update the database. Old items have no value, so backfill by re-ingest. |
| Add a vocabulary value | Yes | Edit `vocab.ts`, run the checks (substring rule), re-tag items. No database change. |
| Rename, retype, change length or embedding flags | **No** | Create a new database (for example `avispl_meeting_room_v1`), re-ingest everything, switch `HYDRADB_DATABASE`. |
| Add a filterable field | Only at creation | `enable_match` is fixed at creation, so decide before creating a database. |

## 12. Known gaps (from the data audit)

These are data gaps, not schema errors. The schema itself is sound.

- Tag coverage is thin for `platforms` and `room_sizes`, so filtering by them can miss relevant chunks. Fix by manual tags per source.
- Vendor vocabulary is short (10, `sony` added 2026-11-11). Jabra, Samsung, Epson, Salamander, Biamp, Huddly, Planar are not tagged. Adding them is additive in `vocab.ts` and must keep the substring rule passing.
- Source mix skews Microsoft.
- `cs_rooms_count` is now set in the source manifest for the 7 case studies whose page states a number (IDRC 70, Global Technology Security Leader 400, National Bank of Canada 425, 7-Eleven 100, Bernalillo County 120, Heriot-Watt 15, RMIT 1000). CBRE, the banking services firm, Truepoint and Tampa Airport state no room count and stay `0`.
- A few pages are missing or empty (Atmosphere case study, contact page, two blog posts) and need re-scraping through the ingest pipeline.
