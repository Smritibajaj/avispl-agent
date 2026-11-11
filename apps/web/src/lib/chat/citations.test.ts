import { test } from "node:test";
import assert from "node:assert/strict";
import { citedRefs, parseCitations, unknownRefs } from "./citations";

test("parses single, grouped and adjacent citations", () => {
  const segs = parseCitations("Rooms are monitored [S1]. Escalation applies [S2, S3][S4]; see [s5].");
  const cites = segs.filter((s) => s.type === "cite").map((s) => (s.type === "cite" ? s.refs : []));
  assert.deepEqual(cites, [["S1"], ["S2", "S3"], ["S4"], ["S5"]]);
  const text = segs.filter((s) => s.type === "text").map((s) => (s.type === "text" ? s.value : "")).join("");
  assert.equal(text, "Rooms are monitored . Escalation applies ; see .");
});

test("leaves non-citation brackets alone", () => {
  const segs = parseCitations("Use [Teams] and [S] and [1] and [SX1].");
  assert.equal(segs.length, 1);
  assert.equal(segs[0]?.type, "text");
});

test("round-trips the original text", () => {
  const src = "A [S1] B [S2; S10] C";
  const back = parseCitations(src).map((s) => (s.type === "text" ? s.value : s.raw)).join("");
  assert.equal(back, src);
});

test("citedRefs dedupes in first-seen order; unknownRefs flags invented refs", () => {
  const t = "x [S3] y [S1] z [S3, S9]";
  assert.deepEqual(citedRefs(t), ["S3", "S1", "S9"]);
  assert.deepEqual(unknownRefs(t, new Set(["S1", "S3"])), ["S9"]);
});
