# Kickoff: run this on your own machine with Claude Code

## 1. One-time setup (terminal)

```bash
tar -xzf avispl-agent.tar.gz && cd avispl-agent
git init && git add -A && git commit -m "scaffold"      # gives you a clean rollback point
cp .env.example .env                                     # then fill in the keys below
pnpm install                                             # Node >= 22, pnpm 10 (corepack enable)
pnpm --filter @avispl/shared test                        # should print "shared checks OK"
claude                                                   # start Claude Code in the repo root
```

`.env` keys: `HYDRADB_API_KEY` (required for hydra-agent's smoke test), `FIRECRAWL_API_KEY` (optional; keyless free tier works but is rate-limited), `AI_GATEWAY_API_KEY` (only if you want live model answers locally). Leave `HYDRADB_DATABASE=avispl_meeting_room_dev` until you have reviewed everything.

## 2. Paste this into Claude Code

```text
Read CLAUDE.md, docs/DECISIONS.md and docs/KICKOFF.md. Then launch three subagents IN PARALLEL
(one message, three Agent calls): hydra-agent, ingest-agent, web-agent. Each has its brief in
.claude/agents/. They own separate directories, so no worktrees are needed.
Do not do their work yourself. When all three report back, integrate (section 3 of KICKOFF.md),
fix mismatches in packages/shared only if truly needed, and report what is proven versus unverified.
Stop and ask me before: scraping beyond the 7 P0 pages, touching any non-dev HydraDB database,
or anything that spends money.
```

## 3. Integration checklist (main session, after the agents report)

1. `pnpm typecheck && pnpm test && pnpm build` all green.
2. `pnpm ingest manifest:report`, then review `packages/ingest/data/reports/prepare-report.md` and the P0 extraction quality.
3. Read hydra-agent's findings in `docs/DECISIONS.md` section 5. Decide whether `contains` semantics, chunk metadata and graph output match what the store and UI assume. Fix the store, not the data, if they differ.
4. Review a few records in `records.jsonl`, flip the good ones to `published` (`pnpm ingest publish --source <id>`), then `pnpm hydra ingest` into the DEV database. Wait for `completed`.
5. `pnpm dev`, ask the three golden queries (the suggestion chips). Check: citations are real and clickable; Q1 returns small/medium/large evidence plus meeting-equity guidance; Q2 shows Copilot/Places prerequisites and cites IDRC only for what it deployed, with the disclosure either verbatim (approved) or the pending message; Q3 explains monitoring and escalation with no repair-time promise; the graph panel shows real triplets that click through to evidence. Compare with and without graph context to see whether the graph adds value.
6. Negative tests: an aquarium question, a price question, an SLA question, and a prompt injection in retrieved text must all be handled politely and truthfully.
7. Send the content owner the open items: current Reference Designs PDF (the 2021 link is a 404), the gated standardization eBook, the four truncated PDF URLs, exact licensing wording, Symphony docs export, Concept Catalog page ranges, CTAs, and HydraDB budget.

## 4. Offline mock (removed)

The offline HydraDB mock, the web mock store and the demo model were removed on 2026-11-11 (owner decision). The app and the scripts talk to HydraDB only.

## 5. Deploy to Vercel (do it together, after step 3.5 passes)

1. Create a Vercel project from the repo. Set Root Directory to `apps/web` and keep "Include source files outside of the Root Directory" enabled so `packages/*` is available to the build. Vercel detects pnpm and Turborepo; confirm the install and build commands in project settings.
2. Environment variables (Production and Preview): `HYDRADB_API_KEY`, `HYDRADB_BASE_URL`, `HYDRADB_DATABASE` (production database name, created with `pnpm hydra db:create --database <name>` and ingested after your explicit approval), `HYDRADB_COLLECTION`, `CHAT_MODEL`. On Vercel the AI Gateway can authenticate with the project's OIDC token, so `AI_GATEWAY_API_KEY` is only needed locally.
3. Deploy a preview first, run the three golden queries on the preview URL, then promote to production.
4. Before the link goes to anyone outside the team: rate limiting on `/api/chat`, a cost cap on the model, and the content owner's sign-off on content and the disclosure.

I wrote these Vercel settings from general knowledge; check them against the current Vercel docs when you do it.

## 6. MCP

You said you will wire MCPs yourself. HydraDB documents an MCP server at https://mcp.hydradb.com (https://docs.hydradb.com/plugins/mcp). Use it in Claude Code to inspect the dev database. The app itself calls HydraDB through the typed adapter, not through MCP.
