"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import graphJson from "../lib/kb-graph.json";

/** Journey stages in customer order. Colour follows the stage, never its position in a filtered list. */
const STAGES = [
  { id: "plan_design", label: "Plan and design" },
  { id: "choose_platform", label: "Choose platform and devices" },
  { id: "deploy", label: "Deploy" },
  { id: "run_support", label: "Run and support" },
  { id: "proof", label: "Proof" },
] as const;

const TYPE_LABEL: Record<string, string> = {
  page: "Page",
  pdf: "PDF",
  blog: "Blog",
  interactive_ebook: "Interactive eBook",
  webcast: "Webcast",
  case_study: "Case study",
  industry_page: "Industry page",
  support_info: "Support info",
};
const NAME: Record<string, string> = { hp_poly: "HP Poly", qsys: "Q-SYS", lg: "LG", ai_features: "AI features", accessibility_ada: "Accessibility (ADA)", roi: "ROI" };
const pretty = (id: string) => NAME[id] ?? id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

interface Source {
  id: string;
  title: string;
  type: string;
  url: string;
  records: number;
  /** Records per journey stage. */
  stages: Record<string, number>;
  primaryStage: string;
  platforms: string[];
  vendors: string[];
  topics: string[];
  sections: string[];
}
const graph = graphJson as unknown as { records: number; sources: Source[] };
type RightMode = "tech" | "topics";
type Active = { kind: "stage" | "source" | "right"; id: string } | null;

const W = 1170;
const ROW = 22;
const TOP = 34;
const STAGE_X = 260;
const PILL_X = 380;
const PILL_W = 330;
const RIGHT_X = 910;
const short = (s: string, n = 46) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const curve = (x1: number, y1: number, x2: number, y2: number) => `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;

export function KnowledgeGraph() {
  const [mode, setMode] = useState<RightMode>("tech");
  const [hover, setHover] = useState<Active>(null);
  const [pinned, setPinned] = useState<Active>(null);
  const active = hover ?? pinned;

  const layout = useMemo(() => {
    const order = new Map<string, number>(STAGES.map((s, i) => [s.id, i]));
    const sources = [...graph.sources].sort((a, b) => order.get(a.primaryStage)! - order.get(b.primaryStage)! || a.title.localeCompare(b.title));
    const sy = new Map(sources.map((s, i) => [s.id, TOP + i * ROW + ROW / 2]));
    const height = TOP + sources.length * ROW + 24;
    const stages = STAGES.map((st) => {
      const mine = sources.filter((s) => s.primaryStage === st.id);
      const records = graph.sources.reduce((n, s) => n + (s.stages[st.id] ?? 0), 0);
      const y = mine.length ? mine.reduce((n, s) => n + sy.get(s.id)!, 0) / mine.length : height / 2;
      return { ...st, records, y, r: 7 + Math.sqrt(records) * 1.5 };
    });
    const rightOf = (s: Source) => (mode === "tech" ? [...s.platforms.map((p) => `p:${p}`), ...s.vendors.map((v) => `v:${v}`)] : s.topics.map((t) => `t:${t}`));
    const count = new Map<string, number>();
    for (const s of sources) for (const id of rightOf(s)) count.set(id, (count.get(id) ?? 0) + 1);
    const ids = [...count.keys()].sort((a, b) => (a[0] === b[0] ? count.get(b)! - count.get(a)! : a < b ? -1 : 1));
    const gap = Math.min(64, (height - TOP - 40) / Math.max(1, ids.length - 1));
    const y0 = TOP + (height - TOP - gap * (ids.length - 1)) / 2 - 10;
    const right = ids.map((id, i) => ({ id, label: pretty(id.slice(2)), group: id[0] === "p" ? "Platform" : id[0] === "v" ? "Vendor" : "Topic", n: count.get(id)!, y: y0 + i * gap, r: 5 + Math.sqrt(count.get(id)!) * 1.6 }));
    return { sources, sy, height, stages, right, rightOf };
  }, [mode]);

  const { sources, sy, height, stages, right, rightOf } = layout;
  const stageY = new Map(stages.map((s) => [s.id as string, s.y]));
  const rightY = new Map(right.map((r) => [r.id, r.y]));

  /** Which sources are lit for the active node; null means nothing is active and everything shows. */
  const lit = useMemo(() => {
    if (!active) return null;
    if (active.kind === "source") return new Set([active.id]);
    if (active.kind === "stage") return new Set(sources.filter((s) => s.stages[active.id]).map((s) => s.id));
    return new Set(sources.filter((s) => rightOf(s).includes(active.id)).map((s) => s.id));
  }, [active, sources, rightOf]);
  const sourceOn = (id: string) => !lit || lit.has(id);
  const stageOn = (id: string) => !active || (active.kind === "stage" ? active.id === id : sources.some((s) => lit!.has(s.id) && s.stages[id]));
  const rightOn = (id: string) => !active || (active.kind === "right" ? active.id === id : sources.some((s) => lit!.has(s.id) && rightOf(s).includes(id)));
  const stageEdgeOn = (s: Source, st: string) => !active || (lit!.has(s.id) && (active.kind !== "stage" || active.id === st));
  const rightEdgeOn = (s: Source, id: string) => !active || (lit!.has(s.id) && (active.kind !== "right" || active.id === id));

  const handlers = (a: NonNullable<Active>) => ({
    onMouseEnter: () => setHover(a),
    onMouseLeave: () => setHover(null),
    onFocus: () => setHover(a),
    onBlur: () => setHover(null),
    onClick: () => setPinned((p) => (p && p.kind === a.kind && p.id === a.id ? null : a)),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setPinned((p) => (p && p.kind === a.kind && p.id === a.id ? null : a));
      }
    },
    tabIndex: 0,
    role: "button" as const,
  });

  const detailSources = active ? sources.filter((s) => lit!.has(s.id)) : [];
  const detailTitle = !active
    ? null
    : active.kind === "source"
      ? detailSources[0]?.title
      : active.kind === "stage"
        ? STAGES.find((s) => s.id === active.id)?.label
        : right.find((r) => r.id === active.id)?.label;

  return (
    <div className="kg">
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">Knowledge graph</span>
        </div>
        <Link className="kg-back" href="/">
          Back to the advisor
        </Link>
      </header>

      <main className="kg-main">
        <div className="kg-head">
          <div>
            <h1>What the advisor knows</h1>
            <p className="muted">
              {graph.records} records from {graph.sources.length} AVI-SPL sources, as loaded into HydraDB. Each source is linked to the journey stages its records
              belong to and to the {mode === "tech" ? "platforms and vendors" : "topics"} it covers. Hover or click anything to follow its links.
            </p>
          </div>
          <div className="kg-toggle" role="group" aria-label="Right-hand column">
            <button type="button" className={mode === "tech" ? "is-on" : ""} aria-pressed={mode === "tech"} onClick={() => (setMode("tech"), setPinned(null))}>
              Platforms and vendors
            </button>
            <button type="button" className={mode === "topics" ? "is-on" : ""} aria-pressed={mode === "topics"} onClick={() => (setMode("topics"), setPinned(null))}>
              Topics
            </button>
          </div>
        </div>

        <div className="kg-body">
          <div className="kg-scroll">
            <svg className="kg-svg" viewBox={`0 0 ${W} ${height}`} width={W} height={height} role="img" aria-label="Sources linked to journey stages and to platforms, vendors or topics">
              <text className="kg-col" x={STAGE_X} y={16} textAnchor="end">
                Journey stage
              </text>
              <text className="kg-col" x={PILL_X} y={16}>
                Source
              </text>
              <text className="kg-col" x={RIGHT_X} y={16}>
                {mode === "tech" ? "Platform or vendor" : "Topic"}
              </text>

              <g fill="none">
                {sources.flatMap((s) =>
                  Object.entries(s.stages).map(([st, n]) => (
                    <path
                      key={`${s.id}-${st}`}
                      d={curve(STAGE_X + 4, stageY.get(st)!, PILL_X, sy.get(s.id)!)}
                      className={`kg-edge kg-stage-${st}`}
                      strokeWidth={Math.min(4, 1 + n * 0.35)}
                      opacity={stageEdgeOn(s, st) ? (active ? 0.9 : 0.45) : 0.05}
                    />
                  )),
                )}
                {sources.flatMap((s) =>
                  rightOf(s).map((id) => (
                    <path key={`${s.id}-${id}`} d={curve(PILL_X + PILL_W, sy.get(s.id)!, RIGHT_X - 6, rightY.get(id)!)} className="kg-edge kg-edge-right" strokeWidth={1.2} opacity={rightEdgeOn(s, id) ? (active ? 0.85 : 0.22) : 0.04} />
                  )),
                )}
              </g>

              {stages.map((st) => (
                <g key={st.id} className="kg-node" opacity={stageOn(st.id) ? 1 : 0.25} {...handlers({ kind: "stage", id: st.id })} aria-label={`${st.label}: ${st.records} records`}>
                  <circle cx={STAGE_X - st.r} cy={st.y} r={st.r} className={`kg-fill-${st.id}`} />
                  <text x={STAGE_X - st.r * 2 - 8} y={st.y - 2} textAnchor="end" className="kg-label kg-label-strong">
                    {st.label}
                  </text>
                  <text x={STAGE_X - st.r * 2 - 8} y={st.y + 13} textAnchor="end" className="kg-sub">
                    {st.records} records
                  </text>
                </g>
              ))}

              {sources.map((s) => {
                const y = sy.get(s.id)!;
                return (
                  <g key={s.id} className="kg-node" opacity={sourceOn(s.id) ? 1 : 0.22} {...handlers({ kind: "source", id: s.id })} aria-label={`${s.title}: ${TYPE_LABEL[s.type] ?? s.type}, ${s.records} records`}>
                    <rect x={PILL_X} y={y - 9} width={PILL_W} height={18} rx={4} className="kg-pill" />
                    <rect x={PILL_X} y={y - 9} width={4} height={18} rx={2} className={`kg-fill-${s.primaryStage}`} />
                    <text x={PILL_X + 12} y={y + 4} className="kg-label">
                      {short(s.title)}
                    </text>
                    <text x={PILL_X + PILL_W - 8} y={y + 4} textAnchor="end" className="kg-sub">
                      {s.records}
                    </text>
                  </g>
                );
              })}

              {right.map((r) => (
                <g key={r.id} className="kg-node" opacity={rightOn(r.id) ? 1 : 0.25} {...handlers({ kind: "right", id: r.id })} aria-label={`${r.label}: ${r.n} sources`}>
                  <circle cx={RIGHT_X + r.r} cy={r.y} r={r.r} className="kg-right" />
                  <text x={RIGHT_X + r.r * 2 + 8} y={r.y + 4} className="kg-label kg-label-strong">
                    {r.label}
                  </text>
                  <text x={RIGHT_X + r.r * 2 + 8} y={r.y + 18} className="kg-sub">
                    {r.group} · {r.n} sources
                  </text>
                </g>
              ))}
            </svg>
          </div>

          <aside className="kg-detail" aria-live="polite">
            {!active && (
              <>
                <h2>Stages</h2>
                <ul className="kg-legend">
                  {stages.map((st) => (
                    <li key={st.id}>
                      <span className={`kg-swatch kg-bg-${st.id}`} />
                      {st.label}
                      <span className="muted"> · {st.records}</span>
                    </li>
                  ))}
                </ul>
                <p className="muted">The number on each source is how many records it has. The coloured edge on a source is the stage most of its records belong to.</p>
              </>
            )}
            {active && (
              <>
                <h2>{detailTitle}</h2>
                {active.kind === "source" && detailSources[0] ? (
                  <SourceDetail s={detailSources[0]} />
                ) : (
                  <>
                    <p className="muted">
                      {detailSources.length} sources, {detailSources.reduce((n, s) => n + (active.kind === "stage" ? (s.stages[active.id] ?? 0) : s.records), 0)} records
                    </p>
                    <ul className="kg-list">
                      {detailSources.map((s) => (
                        <li key={s.id}>
                          <button type="button" onClick={() => setPinned({ kind: "source", id: s.id })}>
                            {s.title}
                          </button>
                          <span className="muted"> · {TYPE_LABEL[s.type] ?? s.type}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {pinned && (
                  <button type="button" className="kg-clear" onClick={() => setPinned(null)}>
                    Clear selection
                  </button>
                )}
              </>
            )}
          </aside>
        </div>

        <details className="kg-table">
          <summary>View as a table</summary>
          <div className="kg-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Type</th>
                  <th>Records</th>
                  <th>Stages</th>
                  <th>Platforms</th>
                  <th>Vendors</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.title}
                      </a>
                    </td>
                    <td>{TYPE_LABEL[s.type] ?? s.type}</td>
                    <td>{s.records}</td>
                    <td>
                      {STAGES.filter((st) => s.stages[st.id])
                        .map((st) => `${st.label} (${s.stages[st.id]})`)
                        .join(", ")}
                    </td>
                    <td>{s.platforms.map(pretty).join(", ")}</td>
                    <td>{s.vendors.map(pretty).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </main>
    </div>
  );
}

function SourceDetail({ s }: { s: Source }) {
  const stages = s.stages;
  return (
    <>
      <p className="muted">
        {TYPE_LABEL[s.type] ?? s.type} · {s.records} records
      </p>
      <p>
        <a href={s.url} target="_blank" rel="noreferrer">
          Open on avispl.com
        </a>
      </p>
      <h3>Stages</h3>
      <ul className="kg-legend">
        {STAGES.filter((st) => stages[st.id]).map((st) => (
          <li key={st.id}>
            <span className={`kg-swatch kg-bg-${st.id}`} />
            {st.label}
            <span className="muted"> · {stages[st.id]}</span>
          </li>
        ))}
      </ul>
      {s.platforms.length > 0 && (
        <>
          <h3>Platforms</h3>
          <p>{s.platforms.map(pretty).join(", ")}</p>
        </>
      )}
      {s.vendors.length > 0 && (
        <>
          <h3>Vendors</h3>
          <p>{s.vendors.map(pretty).join(", ")}</p>
        </>
      )}
      {s.topics.length > 0 && (
        <>
          <h3>Topics</h3>
          <p>{s.topics.map(pretty).join(", ")}</p>
        </>
      )}
      <h3>Sections</h3>
      <ul className="kg-list">
        {s.sections.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </>
  );
}
