# AVI-SPL meeting-room journey agent (monorepo)

Chat agent that answers only from AVI-SPL meeting-room content, with citations and a visible context graph.
Stack: pnpm + Turborepo, TypeScript, Next.js, Vercel AI SDK, HydraDB v2, Firecrawl.

```
apps/web            Next.js chat UI + AI SDK agent (consumer of KnowledgeStore)       -> Agent A
packages/ingest     manifest, Firecrawl scrape, clean, records.jsonl                   -> Agent B
packages/hydra      HydraDB setup + ingest + HydraKnowledgeStore (provider)            -> Agent C
packages/shared     contract: vocab, metadata schema, KnowledgeStore, records          -> integrator only
docs/               DECISIONS.md (verified facts), plan.original.md, source-brief.txt
```

Data flow: `ingest` writes `packages/ingest/data/records.jsonl` (type `IngestRecord`) -> `hydra` creates the database, ingests the records, serves queries -> `web` calls `KnowledgeStore.search()`.
`KNOWLEDGE_BACKEND=mock` lets the UI run with no keys.

## Commands

```bash
pnpm install
pnpm typecheck            # all packages
pnpm --filter @avispl/shared test
pnpm dev                  # apps/web
pnpm ingest <script>      # e.g. pnpm ingest manifest:report
pnpm hydra <script>       # e.g. pnpm hydra db:create
```

Env vars: see `.env.example`. Read `docs/DECISIONS.md` first.

## Deploy (Vercel)

See `docs/KICKOFF.md` section 5. Full run-on-your-machine instructions: `docs/KICKOFF.md`.
