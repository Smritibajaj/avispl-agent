import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphTriplet } from "@avispl/shared";
import { buildGraph, GRAPH_H, GRAPH_W } from "./graph-view";

const t = (s: string, r: string, o: string, chunk = "c1"): GraphTriplet => ({
  source: { name: s, type: "ORGANIZATION" },
  relation: r,
  target: { name: o, type: "CONCEPT" },
  chunkIds: [chunk],
});

test("graph view: merges duplicate entities and relations, counts degree, keeps nodes inside the canvas", () => {
  const g = buildGraph([t("AVI-SPL", "offers", "Symphony"), t("avi-spl", "offers", "Symphony", "c2"), t("AVI-SPL", "offers", "Real-Time Design"), t("X", "is", "X")]);
  assert.equal(g.nodes.length, 3);
  assert.equal(g.edges.length, 2);
  assert.deepEqual(g.edges[0]!.chunkIds, ["c1", "c2"]);
  assert.equal(g.nodes.find((n) => n.name === "AVI-SPL")!.degree, 2);
  for (const n of g.nodes) {
    assert.ok(n.x >= 0 && n.x <= GRAPH_W && n.y >= 0 && n.y <= GRAPH_H, "inside canvas");
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
  }
});

test("graph view: empty and single-edge inputs, and the same input gives the same layout", () => {
  assert.deepEqual(buildGraph([]), { nodes: [], edges: [] });
  const a = buildGraph([t("A", "r", "B"), t("B", "r", "C")]);
  const b = buildGraph([t("A", "r", "B"), t("B", "r", "C")]);
  assert.deepEqual(a.nodes.map((n) => [n.x, n.y]), b.nodes.map((n) => [n.x, n.y]));
});
