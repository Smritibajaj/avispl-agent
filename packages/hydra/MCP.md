# HydraDB MCP (dev-time inspection only)

1. HydraDB hosts an MCP server at `https://mcp.hydradb.com` (docs: https://docs.hydradb.com/plugins/mcp). In Claude Code: `claude mcp add --transport http hydradb https://mcp.hydradb.com`, then `/mcp` -> hydradb -> Authenticate (browser sign-in, no key in config).
2. When approving, pick `avispl_meeting_room_dev` and choose "Not allowed" for other databases, so the session can never touch `avispl_meeting_room_v0`. The MCP can read AND write: treat writes like any other spend (DECISIONS.md rule 6).
3. Use it to inspect what actually landed: list/inspect sources, check indexing status, run ad-hoc queries, look at graph relations for a record id after `pnpm hydra ingest`.
4. The app never depends on MCP at runtime: apps/web calls `createHydraKnowledgeStore` (typed SDK, hard filters enforced in our code). Anything learned via MCP that changes behaviour goes into code + `docs/DECISIONS.md`, not into prompts.
5. API-key mode (headers `Authorization: Bearer <key>` + `X-HydraDB-Database`) also exists; if you use it, keep the key in your MCP client's secret store, never in this repo. The user wires MCPs themselves.
