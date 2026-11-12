"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import type { GraphTriplet } from "@avispl/shared";
import { buildGraph, GRAPH_H, GRAPH_W, type GEdge, type GNode } from "../lib/graph/graph-view";
import { BrandText } from "./BrandText";

interface Payload {
  query: string;
  backend: string;
  relaxed: boolean;
  latencyMs: number | null;
  triplets: GraphTriplet[];
  sources: { chunkId: string; title: string; url: string; section: string }[];
}

const EXAMPLES = ["Teams Rooms standardization", "Symphony monitoring and tickets", "Microsoft Places and Teams panels", "Sustainability-screened meeting rooms", "Managed services and support"];
const PALETTE = ["#065ba5", "#11847d", "#f89021", "#792481", "#37c2ce", "#b3361f", "#4f5a7d"];
const colorFor = (type: string) => {
  let h = 0;
  for (const c of type) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
};
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function HydraGraph() {
  const [q, setQ] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [sel, setSel] = useState<string | null>(null); // node id

  const g = useMemo(() => (data ? buildGraph(data.triplets) : { nodes: [] as GNode[], edges: [] as GEdge[] }), [data]);
  const byId = useMemo(() => new Map(g.nodes.map((n) => [n.id, n])), [g]);
  const bySource = useMemo(() => new Map((data?.sources ?? []).map((s) => [s.chunkId, s])), [data]);
  const shown = sel ? g.edges.filter((e) => e.from === sel || e.to === sel) : g.edges;

  const run = async (query: string) => {
    const t = query.trim();
    if (t.length < 2) return;
    setQ(t);
    setState("loading");
    setError("");
    setSel(null);
    try {
      const res = await fetch(`/api/graph?q=${encodeURIComponent(t)}`);
      const j = (await res.json().catch(() => ({}))) as Payload & { error?: string };
      if (!res.ok) throw new Error(j.error || "The graph could not be loaded.");
      setData(j);
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The graph could not be loaded.");
      setState("error");
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(q);
  };

  const sourcesFor = (e: GEdge) => e.chunkIds.map((c) => bySource.get(c)).filter((s): s is NonNullable<typeof s> => !!s);

  return (
    <main className="hg">
      <header className="hg-head">
        <div>
          <BrandText className="hg-brand" />
          <h1>HydraDB knowledge graph</h1>
          <p className="hg-sub">
            The relationships HydraDB found in AVI-SPL's content for your topic: entities as dots, relations as lines. Click a dot to see its links and where they come from.
          </p>
        </div>
        <nav className="hg-nav">
          <Link href="/">Chat</Link>
        </nav>
      </header>

      <form className="hg-form" onSubmit={onSubmit}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a topic, e.g. Teams Rooms standardization" maxLength={200} aria-label="Topic" />
        <button type="submit" disabled={state === "loading" || q.trim().length < 2}>
          {state === "loading" ? "Loading..." : "Show graph"}
        </button>
      </form>
      <div className="hg-examples">
        {EXAMPLES.map((x) => (
          <button key={x} type="button" className="choice" onClick={() => void run(x)} disabled={state === "loading"}>
            {x}
          </button>
        ))}
      </div>

      {state === "error" && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {state === "done" && g.nodes.length === 0 && (
        <p className="hg-empty">HydraDB returned no relationships for this topic. Try a broader one, such as one of the examples above.</p>
      )}

      {g.nodes.length > 0 && data && (
        <div className="hg-body">
          <div className="hg-canvas">
            <svg viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} role="img" aria-label={`Graph of ${g.nodes.length} entities and ${g.edges.length} relations for ${data.query}`}>
              {g.edges.map((e) => {
                const a = byId.get(e.from)!;
                const b = byId.get(e.to)!;
                const on = !sel || e.from === sel || e.to === sel;
                return (
                  <g key={e.id} opacity={on ? 1 : 0.12}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--muted)" strokeWidth={on && sel ? 2 : 1.2} />
                    {sel && on && (
                      <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" className="hg-edge-label">
                        {short(e.relation, 32)}
                      </text>
                    )}
                  </g>
                );
              })}
              {g.nodes.map((n) => {
                const linked = !sel || n.id === sel || g.edges.some((e) => (e.from === sel && e.to === n.id) || (e.to === sel && e.from === n.id));
                const r = 9 + Math.min(n.degree, 6) * 2;
                return (
                  <g
                    key={n.id}
                    className="hg-node"
                    opacity={linked ? 1 : 0.2}
                    tabIndex={0}
                    role="button"
                    aria-label={`${n.name}, ${n.type}, ${n.degree} links`}
                    aria-pressed={sel === n.id}
                    onClick={() => setSel(sel === n.id ? null : n.id)}
                    onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), setSel(sel === n.id ? null : n.id))}
                  >
                    <circle cx={n.x} cy={n.y} r={r} fill={colorFor(n.type)} stroke={sel === n.id ? "var(--text)" : "var(--card)"} strokeWidth={sel === n.id ? 3 : 2} />
                    <text x={n.x} y={n.y + r + 13} textAnchor="middle" className="hg-node-label">
                      {short(n.name, 26)}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="hg-legend">
              {[...new Set(g.nodes.map((n) => n.type))].map((t) => (
                <span key={t} className="hg-key">
                  <i style={{ background: colorFor(t) }} />
                  {t.toLowerCase()}
                </span>
              ))}
            </div>
          </div>

          <aside className="hg-panel" aria-live="polite">
            <h2>
              {sel ? byId.get(sel)?.name : `${g.nodes.length} entities, ${g.edges.length} relations`}
              {sel && (
                <button type="button" className="book-cancel" onClick={() => setSel(null)}>
                  show all
                </button>
              )}
            </h2>
            <ul className="hg-rels">
              {shown.map((e) => (
                <li key={e.id}>
                  <button type="button" className="hg-rel" onClick={() => setSel(e.from === sel ? e.to : e.from)}>
                    <strong>{byId.get(e.from)?.name}</strong> <em>{e.relation}</em> <strong>{byId.get(e.to)?.name}</strong>
                  </button>
                  {e.context && <p className="hg-ctx">{e.context}</p>}
                  {sourcesFor(e).slice(0, 2).map((s) => (
                    <a key={s.chunkId} className="autolink hg-src" href={s.url} target="_blank" rel="noopener noreferrer">
                      {short(s.title, 70)}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
            <p className="hg-note">
              {data.relaxed ? "Filters were broadened to find results. " : ""}
              {data.latencyMs ? `Loaded in ${(data.latencyMs / 1000).toFixed(1)} s. ` : ""}Relations come from HydraDB's graph for this search, so a different topic shows a different part of the graph.
            </p>
          </aside>
        </div>
      )}
    </main>
  );
}
