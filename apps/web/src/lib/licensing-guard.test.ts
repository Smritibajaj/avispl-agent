import assert from "node:assert/strict";
import { test } from "node:test";
import { PENDING_SENTENCE, WITHHELD_MARK, withholdLicensingText } from "./licensing-guard";

test("licensing paragraphs are withheld, everything else is kept", () => {
  const text = [
    "## Smart workplace",
    "Available features must be enabled by the organization and may depend on Teams Premium and Copilot licenses, tenant configuration and region. Organizations should evaluate privacy.",
    "Teams Rooms bring people together.",
    "Teams Phone gives you richer engagement. With a Teams Premium license you get Microsoft Places included. Plus more.",
  ].join("\n");
  const out = withholdLicensingText(text);
  assert.ok(!/licen[cs]/i.test(out.replaceAll(WITHHELD_MARK, "")));
  assert.ok(!out.includes("tenant configuration"), "the whole paragraph goes, not just one sentence");
  assert.ok(out.includes("## Smart workplace") && out.includes("Teams Rooms bring people together."));
  assert.ok(out.includes("Teams Phone gives you richer engagement.") && !out.includes("Plus more."), "cut from the licensing sentence to the paragraph end");
  assert.equal(out.split(WITHHELD_MARK).length - 1, 2, "one marker per licensing paragraph");
  assert.equal(withholdLicensingText("No such wording here."), "No such wording here.");
});

test("the pending sentence states no licensing conditions", () => {
  assert.ok(!/tenant|region|depends|premium|copilot/i.test(PENDING_SENTENCE));
});
