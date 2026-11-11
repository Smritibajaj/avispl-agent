import type { GraphTriplet } from "@avispl/shared";

/** Client-safe: turns HydraDB triplets (entity - relation - entity) into nodes, edges and a fixed layout. */
export const GRAPH_W = 1000;
export const GRAPH_H = 620;
const MARGIN = 46;
const MAX_TRIPLETS = 60;

export interface GNode {
  id: string;
  name: string;
  type: string;
  degree: number;
  x: number;
  y: number;
}
export interface GEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
  context?: string;
  chunkIds: string[];
}

/** One node per entity name: HydraDB can give the same entity different types in different triplets. */
const nodeId = (e: { name: string }) => e.name.trim().toLowerCase();

export function buildGraph(triplets: readonly GraphTriplet[], max = MAX_TRIPLETS): { nodes: GNode[]; edges: GEdge[] } {
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  for (const t of triplets.slice(0, max)) {
    if (!t.source?.name?.trim() || !t.target?.name?.trim()) continue;
    const from = nodeId(t.source);
    const to = nodeId(t.target);
    if (from === to) continue;
    for (const [id, e] of [[from, t.source], [to, t.target]] as const)
      if (!nodes.has(id)) nodes.set(id, { id, name: e.name.trim(), type: e.type || "ENTITY", degree: 0, x: 0, y: 0 });
    const key = `${from}|${t.relation}|${to}`;
    const prev = edges.get(key);
    if (prev) {
      prev.chunkIds = [...new Set([...prev.chunkIds, ...t.chunkIds])];
      prev.context ??= t.context;
    } else edges.set(key, { id: key, from, to, relation: t.relation, context: t.context, chunkIds: [...t.chunkIds] });
  }
  for (const e of edges.values()) {
    nodes.get(e.from)!.degree++;
    nodes.get(e.to)!.degree++;
  }
  const list = [...nodes.values()];
  layout(list, [...edges.values()]);
  return { nodes: list, edges: [...edges.values()] };
}

/** Fruchterman-Reingold on a fixed start, so the same triplets always give the same picture. */
export function layout(nodes: GNode[], edges: readonly GEdge[], iterations = 260): void {
  const n = nodes.length;
  if (n === 0) return;
  const cx = GRAPH_W / 2;
  const cy = GRAPH_H / 2;
  if (n === 1) {
    nodes[0]!.x = cx;
    nodes[0]!.y = cy;
    return;
  }
  nodes.forEach((nd, i) => {
    const a = (i / n) * Math.PI * 2;
    nd.x = cx + Math.cos(a) * GRAPH_W * 0.3;
    nd.y = cy + Math.sin(a) * GRAPH_H * 0.3;
  });
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const k = Math.sqrt((GRAPH_W * GRAPH_H) / n) * 0.7;
  let temp = GRAPH_W / 8;
  for (let it = 0; it < iterations; it++) {
    const dx = new Array<number>(n).fill(0);
    const dy = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        let vx = nodes[i]!.x - nodes[j]!.x;
        let vy = nodes[i]!.y - nodes[j]!.y;
        let d = Math.hypot(vx, vy);
        if (d < 0.01) {
          vx = 0.01 * (i + 1);
          vy = 0.01 * (j + 1);
          d = Math.hypot(vx, vy);
        }
        const f = (k * k) / d;
        dx[i]! += (vx / d) * f;
        dy[i]! += (vy / d) * f;
        dx[j]! -= (vx / d) * f;
        dy[j]! -= (vy / d) * f;
      }
    for (const e of edges) {
      const a = idx.get(e.from);
      const b = idx.get(e.to);
      if (a === undefined || b === undefined) continue;
      const vx = nodes[a]!.x - nodes[b]!.x;
      const vy = nodes[a]!.y - nodes[b]!.y;
      const d = Math.max(Math.hypot(vx, vy), 0.01);
      const f = (d * d) / k;
      dx[a]! -= (vx / d) * f;
      dy[a]! -= (vy / d) * f;
      dx[b]! += (vx / d) * f;
      dy[b]! += (vy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      dx[i]! += (cx - nodes[i]!.x) * 0.05;
      dy[i]! += (cy - nodes[i]!.y) * 0.05;
      const d = Math.max(Math.hypot(dx[i]!, dy[i]!), 0.01);
      const step = Math.min(d, temp);
      nodes[i]!.x += (dx[i]! / d) * step;
      nodes[i]!.y += (dy[i]! / d) * step;
    }
    temp *= 0.985;
  }
  for (const nd of nodes) {
    nd.x = Math.min(GRAPH_W - MARGIN, Math.max(MARGIN, nd.x));
    nd.y = Math.min(GRAPH_H - MARGIN, Math.max(MARGIN, nd.y));
  }
}
