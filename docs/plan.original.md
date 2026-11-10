# AVI-SPL Meeting Room Journey AI Agent — Claude Code Implementation Plan

> Consolidated working dump of the project decisions, user-provided requirements, URL inventory, architecture, red-team findings, and ingestion plan discussed in ChatGPT. This is a **structured reconstruction**, not a verbatim transcript of every chat message. Preserve uncertainty: no complete crawl or HydraDB ingestion has been performed.

## 0. Mission

Build a customer-facing AVI-SPL meeting-room-journey chat agent. Restrict knowledge to meeting-room-related AVI-SPL material, not the wider site (aquariums, museums, broadcast, etc.). Answers must synthesize multiple sources, show precise clickable citations, surface verified customer proof, respect licensing disclosures and service limitations, and guide users to an appropriate next action.

**Demo stakeholder:** Nancy. **Key reason to use HydraDB:** demonstrate a **context/knowledge graph**, not only a document search index. **Implementation assistant:** Claude Code.

## 1. Three golden demo queries (verbatim)

**Q1 — Room standardisation:**
> We have about 40 meeting rooms across three offices, all on Microsoft Teams. Which AVI-SPL reference designs should we standardise on for small, medium and large rooms, and what should we think about for remote participants?

Must synthesize reference designs + standardisation eBook + meeting equity guidance. Do not invent capacity, hardware, pricing, or compatibility.

**Q2 — Copilot, Places, proof:**
> What do we need in place to use Copilot and Microsoft Places in our Teams Rooms, and has AVI-SPL done this for an organisation like ours?

Must synthesize Microsoft practice pages + Smart Workplace interactive eBook + IDRC case study. **Exact approved licensing disclosure that Nancy fought to include is critical**; retrieve and verify it, never invent it. Do not conflate mentioning Copilot with proof of a Copilot deployment.

**Q3 — Post-install monitoring and emergency:**
> Once the rooms are installed, how do we monitor them, and what happens if a room fails ten minutes before a board meeting?

Must synthesize Symphony + Support & Maintenance + Managed Services + Bernalillo County. Explain monitoring, escalation and options, but **do not promise ten-minute repair or specific SLAs without evidence**. Can lead to managed-services discussion.

## 2. Agreed technology direction

| Layer | Choice | Notes |
|---|---|---|
| Language/app | TypeScript, Next.js, React | Separate ingestion package from customer chat app initially |
| Agent | Vercel AI SDK `streamText` or `ToolLoopAgent` | No additional agent framework needed for v0 |
| Chat UI | AI Elements (Vercel/shadcn) preferred; assistant-ui alternative | Choose one; Vercel open-source chatbot starter possible |
| Knowledge store and graph | **HydraDB v2** | Required for visual graph demo; confirm exact SDK and graph behavior from docs |
| Crawling | **Firecrawl** | User opted to use Firecrawl; curated URL scrape rather than whole-domain crawl |
| Fallback browser extraction | Playwright/Crawlee if Firecrawl misses interactive content | Optional, not mandatory at outset |
| Cleaning | Markdown cleanup; optionally Readability/Turndown | Do not blindly filter on keyword presence |
| PDF fallback | `unpdf` / `pdf-parse` | Preserve page references, tables, section headings |
| LLM | AI SDK-compatible provider | Choice TBD; usage costs may apply |
| Testing | TypeScript retrieval and answer evaluation | Test golden queries plus paraphrases |
| Mastra | Deferred | Not needed for v0 |

**Important:** Previous discussion considered free SQLite FTS5 for an initial retrieval baseline because HydraDB is paid. Since user clarified HydraDB is required to **show the graph**, do not replace HydraDB in the final demo. A local baseline can be used for preliminary quality tests only.

## 3. User-provided complete source inventory

All URLs below were provided by the user. Some are **truncated with an ellipsis** and must be resolved before crawling. Source content and accessibility have **not** all been verified. Do not claim they have been crawled.

### 3.1 Plan and design

1. Reference Designs page — https://avispl.com/solutions/reference-designs/
2. Reference Designs PDF (2021, historical; request current version from Nancy) — https://avispl.com/wp-content/uploads/2021/04/Reference_Designs.pdf
3. Sustainability-screened meeting rooms (Logitech) — https://avispl.com/solutions/reference-designs/sustainability-screened-meeting-rooms/
4. Meeting Rooms solution page (meeting equity, interoperability, ease of use, AI, sustainability, security, ADA) — https://avispl.com/solutions/meeting-rooms/
5. Building a Scalable Model for Meeting Room Standardization eBook — https://avispl.com/resource/scalable-meeting-room-standardization/
6. Avoid the Bowling Alley Effect eBook — **TRUNCATED** https://pages.avispl.com/hubfs/2023/2023%20PDFs/AVI-SPL%20Avoid%20the%20Bowling%20Alley%20Effect%20…
7. Top 5 Hybrid Meeting Hacks — **TRUNCATED** https://pages.avispl.com/hubfs/2023/2023%20PDFs/AVI-SPL%20Top%205%20Hybrid%20Meeting%20Hacks%20(1).…
8. Concept Catalog landing — https://avispl.com/resource/concept-catalog/
9. Concept Catalog 2025 Winter PDF — **TRUNCATED** https://pages.avispl.com/hubfs/2025/2025%20pdf%20assets/2025%20Concept%20Catalog/AVI-SPL%202025%20W…
10. Concept Catalog 2024–25 Winter PDF (mentions immersive collaboration with Teams Rooms, Copilot and Places) — https://pages.avispl.com/hubfs/2024/2024%20PDFs/Concept%20Catalog%202024-2025%20Winter%20update.pdf
11. Q-SYS Sustainability Guide — https://pages.avispl.com/hubfs/2024/2024%20PDFs/AVI-SPL%20Q-SYS%20Sustainability%20Guide.12.24.pdf
12. Real-Time Design — https://avispl.com/services/real-time-design/

### 3.2 Choose platform and devices

13. Microsoft practice — https://avispl.com/microsoft/
14. Microsoft Teams and Teams Rooms — https://avispl.com/microsoft-teams
15. Microsoft Teams Services — https://avispl.com/microsoft-teams-services/
16. Signature Teams Room Experience Tours — https://avispl.com/microsoft-teams-room-experience-tours/
17. Scalable Signature Teams Rooms with Legrand AV blog — https://avispl.com/blog/scalable-signature-teams-rooms-with-legrand-av/
18. Why Microsoft Places is a workplace management gamechanger blog — https://avispl.com/blog/why-microsoft-places-is-a-workplace-management-gamechanger/
19. Smart Workplace Microsoft Teams interactive eBook landing — https://avispl.com/resource/smart-workplace-microsoft-teams-interactive-ebook/
20. HSV interactive eBook Smart Workplace with Teams — https://microsoft-offers.avispl.com/smart-workplace-with-teams
21. HSV interactive eBook Evolution of Work — https://microsoft-offers.avispl.com/evolution-of-work
22. HSV Elevate interactive eBook — https://elevate.avispl.com/
23. Cisco — https://avispl.com/cisco/
24. Zoom — https://avispl.com/zoom/
25. Google Meet — https://avispl.com/google/
26. Crestron — https://avispl.com/crestron/
27. Logitech — https://avispl.com/logitech/
28. Neat — https://avispl.com/neat/
29. HP Poly — https://avispl.com/hp-poly/
30. Q-SYS — https://avispl.com/q-sys/
31. Shure — https://avispl.com/shure/
32. Sennheiser — https://avispl.com/sennheiser/
33. LG — https://avispl.com/lg/
34. Future-Ready Meeting Spaces Made Simple — https://avispl.com/resource/future-ready-meeting-spaces-made-simple/
35. LG Express Teams Room bundle PDF — **TRUNCATED** https://pages.avispl.com/hubfs/2025/2025%20pdf%20assets/AVI-SPL%20LG%20Deploy%20Future-Ready%20Meet…
36. Express Lane to Intelligent Collaboration with Microsoft Teams Rooms webcast — https://avispl.com/resource/express-lane-intelligent-collaboration-microsoft-teams-rooms/

### 3.3 Deploy

37. Professional Services — https://avispl.com/services/professional-services/
38. Global Deployment — https://avispl.com/services/global-deployment/
39. Collaboration as a Service — https://avispl.com/services/collaboration-as-a-service/

### 3.4 Run and support

40. Symphony — https://avispl.com/symphony/
41. Symphony documentation — https://symphony.knowledgeowl.com/help/documentation
42. How to Go Beyond Traditional Meeting Room ROI Calculations — https://avispl.com/blog/beyond-traditional-meeting-room-roi-calculations/
43. Managed Services — https://avispl.com/services/managed-services/
44. Support and Maintenance — https://avispl.com/services/support-and-maintenance/
45. Help Desk portal — https://avispl.service-now.com/support

### 3.5 Proof and industry

46. Case studies index — https://avispl.com/resources/case-studies/
47. IDRC — https://avispl.com/resources/case-studies/idrc-case-study/
48. Global Technology Security Leader — https://avispl.com/resources/case-studies/global-technology-security-leader/
49. CBRE Berlin — https://avispl.com/resources/case-studies/cbre-berlin-case-study/
50. Financial Institution Transformation — https://avispl.com/resources/case-studies/how-one-financial-institution-transformed-collaboration/
51. National Bank of Canada — https://avispl.com/resources/case-studies/national-bank-of-canada-case-study/
52. Carrollton Bank — https://avispl.com/resources/case-studies/carrollton-bank-case-study/
53. Truepoint — https://avispl.com/resources/case-studies/truepoint/
54. 7-Eleven — https://avispl.com/resources/case-studies/7-eleven/
55. Tampa International Airport SkyCenter One — https://avispl.com/resources/case-studies/tampa-international-airport-skycenter-one/
56. Bernalillo County — https://avispl.com/resources/case-studies/bernalillo-county/
57. Financial Services industry — https://avispl.com/industries/financial-services/
58. Legal industry — https://avispl.com/industries/legal/
59. Healthcare industry — https://avispl.com/industries/healthcare/
60. Higher Education industry — https://avispl.com/industries/higher-education/

## 4. HydraDB documentation supplied by user

- Introduction: https://docs.hydradb.com/get-started/v2/introduction
- Quickstart: https://docs.hydradb.com/get-started/v2/quickstart.md
- Core concepts: https://docs.hydradb.com/get-started/v2/core-concepts
- Maintained agent guide: https://docs.hydradb.com/AGENTS.md
- Metadata and filters: https://docs.hydradb.com/essentials/v2/metadata.md
- Knowledge: https://docs.hydradb.com/essentials/v2/knowledge.md
- App Sources: https://docs.hydradb.com/essentials/v2/app-sources.md
- Databases and Collections: https://docs.hydradb.com/essentials/v2/multi-tenant.md
- Query: https://docs.hydradb.com/essentials/v2/query.md
- Semantic Search: https://docs.hydradb.com/essentials/v2/semantic-search.md
- API results: https://docs.hydradb.com/essentials/v2/api-results.md
- Context Graphs: https://docs.hydradb.com/essentials/v2/context-graphs.md
- Access Control: https://docs.hydradb.com/essentials/v2/access-control.md
- Query API: https://docs.hydradb.com/api-reference/v2/endpoint/query
- Create Database: https://docs.hydradb.com/api-reference/v2/endpoint/create-tenant
- Update Metadata Schema: https://docs.hydradb.com/api-reference/v2/endpoint/update-metadata-schema
- Source Status: https://docs.hydradb.com/api-reference/v2/endpoint/source-status
- SDKs: https://docs.hydradb.com/api-reference/v2/sdks
- MCP: https://docs.hydradb.com/plugins/mcp
- CLI: https://docs.hydradb.com/plugins/cli

**Claude Code instruction:** Read the HydraDB docs, especially AGENTS.md, quickstart, app sources, metadata, context graphs and SDKs **before** implementing. Previous chat suggested native automatic graph extraction and optional bring-your-own-graph, but verify exact behavior, limits and SDK signatures. Do not blindly copy speculative code. Verify pricing/credits before large ingestion.

## 5. Data model: portable logical schema

**Do not assume HydraDB has Neo4j-style node/edge collections.** These are logical contracts for extraction, inspection and optionally custom graph ingestion. Prefer HydraDB native knowledge and context graph where supported.

### Source record

```ts
type JourneyStage = 'plan_design' | 'platform_devices' | 'deploy' | 'run_support' | 'proof';
type SourceType = 'webpage' | 'pdf' | 'interactive_ebook' | 'documentation' | 'case_study' | 'industry_page' | 'blog' | 'webcast';
type Priority = 'P0' | 'P1' | 'P2';
interface SourceDocument {
  id: string;
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  sourceType: SourceType;
  primaryStage: JourneyStage;
  secondaryStages: JourneyStage[];
  priority: Priority;
  goldenQueries: ('Q1' | 'Q2' | 'Q3')[];
  topics: string[];
  platforms: string[];
  vendors: string[];
  products: string[];
  roomTypes: string[];
  industries: string[];
  publicationDate: string | null;
  documentVersion: string | null;
  crawledAt: string | null;
  contentHash: string | null;
  extractionStatus: 'pending' | 'success' | 'partial' | 'failed';
  reviewStatus: 'unreviewed' | 'approved' | 'needs_review' | 'deprecated';
  supersededBy: string | null;
  citationUrl: string;
  accessLevel: 'public' | 'restricted';
  chunkCount: number;
}
```

### Evidence chunk

```ts
interface EvidenceChunk {
  id: string;
  sourceId: string;
  text: string;
  headingPath: string[];
  sectionTitle: string;
  chunkIndex: number;
  pageStart: number | null;
  pageEnd: number | null;
  anchorId: string | null;
  citationUrl: string;
  topics: string[];
  platforms: string[];
  roomTypes: string[];
  journeyStages: JourneyStage[];
  claimTypes: ('capability' | 'prerequisite' | 'licensing' | 'recommendation' | 'case_study_evidence' | 'support_commitment' | 'limitation')[];
  goldenQueries: string[];
  contentHash: string;
  reviewStatus: string;
}
```

### Graph node and evidence-backed edge

```ts
type NodeType = 'JourneyStage' | 'RoomType' | 'ReferenceDesign' | 'Platform' | 'Product' | 'Vendor' | 'Capability' | 'Requirement' | 'Service' | 'Industry' | 'Customer' | 'CaseStudy' | 'SourceDocument';
interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  aliases: string[];
  description?: string;
  properties: Record<string, unknown>;
  sourceIds: string[];
  verificationStatus: 'verified' | 'pending_review' | 'conflicting' | 'deprecated';
}
type Relation = 'PART_OF_JOURNEY' | 'HAS_ROOM_TYPE' | 'DESIGNED_FOR' | 'COMPATIBLE_WITH' | 'PROVIDED_BY' | 'HAS_CAPABILITY' | 'REQUIRES' | 'HAS_LIMITATION' | 'DELIVERED_THROUGH' | 'MONITORED_BY' | 'IMPLEMENTED_IN' | 'IN_INDUSTRY' | 'DOCUMENTED_IN' | 'SUPERSEDES';
interface GraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationship: Relation;
  evidenceChunkIds: string[];
  extractionConfidence: number;
  verificationStatus: 'verified' | 'pending_review' | 'rejected';
  conditions?: string[];
  validFrom?: string;
  validUntil?: string;
}
```

### Claim registry (recommended for sensitive answers)

```ts
interface EvidenceClaim {
  id: string;
  statement: string;
  claimType: 'capability' | 'prerequisite' | 'licensing' | 'customer_proof' | 'support_sla' | 'limitation';
  product: string | null;
  customer: string | null;
  supportingChunkIds: string[];
  sourceIds: string[];
  evidenceStatus: 'verified' | 'needs_review' | 'conflicting' | 'expired';
  conditions: string[];
  disclosureRequired: boolean;
  disclosureText: string | null;
}
```

**Graph rules:** A mention is not a deployment; `MENTIONED_IN` is not `IMPLEMENTED_IN`. Every factual edge needs source evidence. LLM extraction confidence is not verification. Reject unsupported relationship assertions. Normalize aliases (`MTR`/`Microsoft Teams Rooms`) carefully. Store citations down to source section or PDF page when possible.

### Suggested HydraDB metadata fields

`journey_stage`, `source_type`, `priority`, `review_status`, `platforms`, `topics`, `room_types`, `industries`, `golden_queries`, `document_version`, `source_id`, and optionally an embedding-enabled summary field **only if supported by the current docs**. Validate supported data types, size limits, schema mutability, filter syntax and handling of multiple values. Keep operational crawl metadata locally if it does not belong in HydraDB.

## 6. Retrieval design

Expose AI SDK tools:

1. `searchKnowledgeBase({ query, journeyStages?, platforms?, roomTypes?, topics?, evidenceTypes?, limit? })`: hybrid/keyword+semantic retrieval, metadata filters, dedup, rerank, source diversity.
2. `getEvidence({ chunkIds })`: retrieve exact text and citation metadata; do not cite just titles.
3. `traverseKnowledgeGraph({ entity, relationshipTypes?, maxHops? })`: graph-aware expansion with evidence-backed edges; only if HydraDB exposes supported functionality.
4. Optional `findCustomerProof({ capability, industry? })`: restrict to verified case-study facts.

For each golden query, first define evidence coverage targets. If retrieval misses a required category, perform targeted secondary retrieval or explicitly qualify missing information. Never fabricate answers to fill gaps. Compare graph-assisted retrieval against ordinary hybrid retrieval to show graph adds value.

## 7. Red-team findings and acceptance criteria

**Major risks:** crawling everything before validating retrieval; assuming vector DB guarantees answer quality; stale 2021 designs; dynamic eBook omissions; licensing misstatements; misleading case study proof; invented emergency SLAs; graph that is merely decorative; missing evaluation and business CTA.

**Checklist:**

- [ ] Q1 returns small/medium/large reference-design evidence
- [ ] Q1 combines standardisation and meeting equity guidance
- [ ] Q1 avoids unsupported capacities/hardware
- [ ] Q2 returns Copilot/Places prerequisites
- [ ] Q2 reproduces the **exact approved licensing disclosure** after verification
- [ ] Q2 cites IDRC only for actual deployed capabilities
- [ ] Q3 returns Symphony monitoring evidence
- [ ] Q3 distinguishes incident support from guaranteed SLAs
- [ ] Q3 includes appropriate managed-services evidence and Bernalillo County proof
- [ ] All answers show accurate, clickable citations
- [ ] Paraphrases and follow-up questions retrieve equivalent evidence
- [ ] Missing or conflicting evidence produces qualified answers
- [ ] HydraDB graph is visible and useful for retrieval, not just decoration

**Ask Nancy/team:** Is the 2021 PDF superseded? What exact licensing disclosure is approved? Which CTAs should the agent offer (design consultation, sales, support)? What does the graph demo need to show? What is the HydraDB credit/budget limit?

## 8. Step-by-step Firecrawl → HydraDB ingestion pipeline

### Phase 0: Preflight

1. Read Firecrawl SDK docs and HydraDB v2 docs. Check current API and SDK method signatures; avoid outdated examples.
2. Confirm Firecrawl and HydraDB credentials, usage limits and cost ceilings. Never commit `.env`.
3. Resolve the four truncated PDF URLs using approved landing pages or request complete URLs; never invent them.
4. Build a 60-entry typed `sources.ts` manifest with `id`, `url`, `stage`, `sourceType`, `priority`, `goldenQueries` and status. P0 first.
5. Set crawling domain allowlist, request limits, retries and backoff. Respect site policies and permissions.

### Phase 1: Scaffold

```bash
mkdir avispl-ingestion && cd avispl-ingestion
npm init -y
npm install firecrawl dotenv zod
npm install -D typescript tsx @types/node
npx tsc --init
```

Suggested tree:

```text
avispl-ingestion/
  .env
  .gitignore
  package.json
  src/
    sources.ts
    scrape.ts
    crawl-all.ts
    clean.ts
    prepare-ingestion.ts
    ingest.ts
    validate.ts
    retrieval-eval.ts
  data/
    raw/
    cleaned/
    manifests/
    failed/
    reports/
```

`.env`:

```dotenv
FIRECRAWL_API_KEY=...
HYDRADB_API_KEY=...
HYDRADB_DATABASE=avispl_meeting_room_v0
```

`.gitignore`: `node_modules/`, `.env`, `data/`.

### Phase 2: Prove one URL scrape

Start with https://avispl.com/solutions/reference-designs/. Current Firecrawl SDK usage was previously proposed as:

```ts
import 'dotenv/config';
import { Firecrawl } from 'firecrawl';
import { mkdir, writeFile } from 'node:fs/promises';

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY! });
const url = 'https://avispl.com/solutions/reference-designs/';
const result = await firecrawl.scrape(url, {
  formats: ['markdown'],
  onlyMainContent: true,
});
const markdown = result.markdown ?? '';
if (markdown.trim().length < 200) throw new Error('Too little content');
await mkdir('data/raw', { recursive: true });
await writeFile('data/raw/reference-designs.md', markdown);
await writeFile('data/raw/reference-designs.metadata.json', JSON.stringify({
  url, title: result.metadata?.title ?? null,
  sourceUrl: result.metadata?.sourceURL ?? url,
  crawledAt: new Date().toISOString(), contentLength: markdown.length,
}, null, 2));
```

**Verify against current Firecrawl SDK before running.** Inspect the Markdown manually. A successful API response does not mean all content was extracted.

### Phase 3: Crawl P0 test batch

Begin with six pages: Reference Designs, Meeting Rooms, Microsoft practice, IDRC, Symphony, Bernalillo County. Add Smart Workplace eBook and critical licensing content next. Use `scrape` on curated URLs, not a whole-site crawl. Save one JSON file per source; record errors and retry state. Avoid excessive parallelism. For interactive eBooks, use Firecrawl rendering/actions if needed, with Playwright fallback. For PDFs, check section completeness, page references and tables; use `unpdf` fallback. If source content is inaccessible or incomplete, flag it rather than silently indexing it.

### Phase 4: Clean and enrich

- Remove navigation, footer and repeated boilerplate without deleting relevant sections.
- Preserve headings, tables, lists, disclaimers, source URLs, anchors, PDF page numbers.
- Extract canonical title, stage, topic, platform, room type, case-study customer, claims and dates.
- Avoid filtering paragraphs solely by whether they contain “meeting room”.
- Keep original extracted content for audit and content hash for incremental refresh.
- Mark review status; never mark approved automatically.
- Deduplicate canonical URLs and overlapping versions.

### Phase 5: Prepare ingestion

Create portable records `{ id, title, body, sourceUrl, metadata }`. Validate with Zod, check missing required fields, and emit JSON manifests. Chunk by heading/semantic section if required by HydraDB's ingestion path; otherwise test native document chunking first. Ensure every chunk can be traced to original page/section. Never feed malformed/truncated URL as citation.

### Phase 6: HydraDB database and ingestion

1. Create `avispl_meeting_room_v0` in HydraDB using documented v2 API/SDK.
2. Declare supported metadata schema before ingesting.
3. Ingest one approved Reference Designs record via the documented Knowledge or App Sources method.
4. Poll Source Status until indexing is complete.
5. Query it and inspect returned chunks, citations and context graph.
6. Expand to other P0 sources; then full manifest.
7. Keep idempotent source IDs and content hashes to prevent duplicates.

**Do not invent HydraDB SDK calls.** Consult https://docs.hydradb.com/AGENTS.md, quickstart, app sources and SDK reference first. Earlier chat mentioned possible `@hydradb/sdk`, `databaseMetadataSchema`, `appKnowledge`, `graphContext`, `queryBy`, `mode` and `maxResults` patterns, but they must be confirmed against actual current docs and SDK types before use.

### Phase 7: Validate native Context Graph

Check whether HydraDB automatically extracts useful relationships:
- Reference Design → Room Type
- Microsoft Places → Requirement / Licensing
- Symphony → Monitoring Capability
- Case Study → Actually Implemented Solution
- Service → Support Capability

Record incorrect/missing edges. If native extraction is inadequate, evaluate HydraDB's documented bring-your-own-graph feature; do not build custom graph upfront without evidence it is necessary. The visual graph should support clicking a relationship through to source evidence.

### Phase 8: Retrieval quality tests

For each golden query, record retrieved source IDs, rank, evidence snippets, citation URLs, relevant graph paths and gaps. Measure recall of mandatory source categories, precision of top results, citation correctness, and coverage. Test paraphrases and unsupported questions. Compare with/without graph expansion.

### Phase 9: AI SDK + chat UI

Create the Next.js chat app with Vercel AI SDK, AI Elements and streaming. Agent calls retrieval tools; response must be grounded in returned evidence. Show source cards, citations, evidence links and contextual CTA. Guard against invented product specs, licensing and SLA commitments. Keep credentials server-side.

### Phase 10: Full 60-source ingestion

Once the small batch passes, ingest the remaining valid URLs. Record success/partial/failed status, missing content, duplicate versions, cost, and last crawl. Resolve inaccessible/gated material with owner approval. Preserve provenance and freshness. Generate a final graph visualization and three demo transcripts.

## 9. Proposed implementation outputs for Claude Code

- `sources.ts` or `sources.json`: complete 60-entry inventory and metadata (four truncated URLs flagged)
- `src/scrape.ts` and batch crawler with bounded concurrency, retry/backoff, logs
- `src/clean.ts`: clean markdown, preserve source provenance
- `src/prepare-ingestion.ts`: validated portable records
- `src/hydradb.ts`: documented HydraDB v2 adapter (after docs verification)
- `src/ingest.ts`: idempotent ingestion and indexing-status check
- `src/graph-audit.ts`: inspect graph relationships and evidence
- `src/retrieval-eval.ts`: three golden queries plus paraphrases and metrics
- `reports/crawl-report.md`, `reports/graph-report.md`, `reports/evaluation.md`
- Chat app with AI SDK tools and AI Elements source cards
- README setup commands, environment variables, pricing warnings, failure recovery

## 10. Claude Code execution instructions

1. Treat this document as the project brief, not as evidence that pages were crawled or APIs verified.
2. First read current HydraDB and Firecrawl docs and validate API signatures.
3. Work in small, testable stages. After each stage, report created files, commands, observed outputs, errors and next action.
4. Do not spend paid Firecrawl/HydraDB credits on the full inventory without a budget check and user approval.
5. Do not claim a source was successfully extracted until it is inspected for completeness.
6. Do not invent missing URL suffixes, licensing text, room specs, case-study outcomes or SLAs.
7. Use evidence-backed graph edges, not hallucinated LLM relationships.
8. Prefer P0-first end-to-end vertical slice before all 60 sources.
9. Preserve exact source URLs and citations, and log redirects.
10. Ask the user for missing keys, approval to spend credits, current design PDF and Nancy-approved licensing disclosure when necessary.

## 11. Suggested first Claude Code prompt

> Read `plan.md` completely. Start with **Phase 0 and Phase 1 only**: verify current Firecrawl SDK and HydraDB v2 docs (especially AGENTS.md, metadata, app sources, context graphs), scaffold the TypeScript ingestion project, and create the complete 60-source typed manifest with the four truncated PDF URLs marked `needs_resolution`. Do not crawl yet or incur paid API charges. Show the proposed file tree and exact commands, then wait for my approval before Phase 2.
