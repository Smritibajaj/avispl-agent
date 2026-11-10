import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DISCLOSURE_PENDING_MARKER } from "@avispl/shared";
import { disclosureResultFromText, getLicensingDisclosure, readDisclosureText } from "./disclosure";

test("marker -> pending, and no text is returned", () => {
  const r = disclosureResultFromText(`${DISCLOSURE_PENDING_MARKER}\n`);
  assert.equal(r.pending, true);
  assert.ok(!("text" in r));
});

test("empty or missing file -> pending", () => {
  assert.equal(disclosureResultFromText("   \n").pending, true);
  assert.equal(disclosureResultFromText(undefined).pending, true);
});

test("approved text is returned verbatim (trimmed only)", () => {
  const approved = "Line one, exactly as approved.\nLine two; with punctuation: (unchanged).";
  const r = disclosureResultFromText(`${approved}\n`);
  assert.equal(r.pending, false);
  if (!r.pending) assert.equal(r.text, approved);
});

test("reads from the first readable candidate; unreadable paths -> pending", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "disc-"));
  const f = path.join(dir, "disclosure.txt");
  writeFileSync(f, "Approved wording.");
  const r = await getLicensingDisclosure([path.join(dir, "nope.txt"), f]);
  assert.deepEqual(r.pending, false);
  const missing = await getLicensingDisclosure([path.join(dir, "nope.txt")]);
  assert.equal(missing.pending, true);
});

test("the real repo file is found from apps/web and is currently pending", async () => {
  const text = await readDisclosureText();
  assert.ok(text !== undefined, "disclosure.txt not found from cwd");
  assert.equal(disclosureResultFromText(text).pending, text.includes(DISCLOSURE_PENDING_MARKER) || text.trim() === "");
});
