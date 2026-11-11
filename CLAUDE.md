# CLAUDE.md — AVI-SPL meeting-room journey agent

Customer-facing chat agent: AVI-SPL's meeting-room expert. It interviews the customer, then gives a short plan and offers a meeting with an AVI-SPL expert. AVI-SPL facts come only from AVI-SPL meeting-room content in HydraDB, with precise citations shown as links; its own expert guidance is uncited and never dressed up as an AVI-SPL claim. The context graph (the reason we use HydraDB) is shown on `/graph`.

Read first, every session: `docs/DECISIONS.md` (verified facts and rules), `README.md` (layout), `packages/shared/src/*` (the contract).
`docs/plan.original.md` is the older brief; where it conflicts with DECISIONS.md, DECISIONS.md wins.

## Layout and ownership

| Path | Owner | Purpose |
|---|---|---|
| `packages/shared` | main session (integrator) only | vocab, metadata schema, `KnowledgeStore`, `IngestRecord`, disclosure marker |
| `packages/hydra` | `hydra-agent` | HydraDB database setup, ingest, `createHydraKnowledgeStore`, client-profiles database |
| `packages/ingest` | `ingest-agent` | 60-source manifest, Firecrawl scrape, clean, split, `records.jsonl` |
| `apps/web` | `web-agent` | Next.js chat UI + AI SDK 7 agent + graph panel |

Data flow: ingest writes `packages/ingest/data/records.jsonl` -> hydra creates the database, ingests, serves queries -> web calls `KnowledgeStore.search()`.

## Hard rules

1. Never invent: URL suffixes, licensing text, room specs, outcomes, SLAs, prices. A mention is not a deployment.
2. The Microsoft licensing disclosure is OFF by default (owner decision 2026-11-10: no disclosure required; see `docs/DECISIONS.md` section 6). Answers do not append it; licensing statements appear only as cited source content, never invented (rule 1). If it is switched back on with `LICENSING_DISCLOSURE=on`, it is reproduced word for word from `packages/shared/content/disclosure.txt`, never paraphrased; while that file holds `__PENDING_APPROVAL__`, nothing may paraphrase or invent it.
3. Never ingest or cite a truncated URL. Only crawl `avispl.com` (never the regional sites).
4. `golden_queries` and `priority` stay in the local manifest; never send them to HydraDB.
5. Never commit `.env`; never print keys.
6. Spending: see rule 6 in `docs/DECISIONS.md`. Ask before anything beyond it.
7. Stay inside your own directory. Contract changes go through the main session: say exactly what you need.
8. Do not claim a source was extracted or a feature works until you ran it and looked at the output. Report failures plainly.

## Commands

```bash
pnpm install
pnpm --filter @avispl/shared test      # vocab + schema limit checks
pnpm typecheck                         # all packages
pnpm build
pnpm dev                               # apps/web
pnpm hydra <script>                    # packages/hydra scripts
pnpm ingest <script>                   # packages/ingest scripts
```

Node >= 22, pnpm 10. AI SDK is v7 (`ai@^7`): verify API names from the installed package types, not from older tutorials.

## Subagents

Defined in `.claude/agents/`: `hydra-agent`, `ingest-agent`, `web-agent`. They are independent and can run in parallel. Kickoff prompt and integration checklist: `docs/KICKOFF.md`.
