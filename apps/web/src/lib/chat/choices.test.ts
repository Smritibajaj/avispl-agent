import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChoices } from "./choices";

test("choices: single and multi markers become groups and leave the text clean", () => {
  const r = parseChoices(
    'Which platform do you use?\n[[choices single "Platform": Microsoft Teams | Zoom | Cisco Webex | Google Meet]]\n\nWhat matters most?\n[[choices multi: Security | Accessibility]]',
  );
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.groups[0], { mode: "single", label: "Platform", options: ["Microsoft Teams", "Zoom", "Cisco Webex", "Google Meet"] });
  assert.equal(r.groups[1]!.mode, "multi");
  assert.doesNotMatch(r.text, /\[\[|choices/);
  assert.match(r.text, /Which platform do you use\?/);
});

test("choices: a half-streamed marker is hidden, a one-option marker is ignored", () => {
  assert.equal(parseChoices('Pick one.\n[[choices single "Plat').text, "Pick one.");
  assert.equal(parseChoices("Pick one.\n[[choi").text, "Pick one.");
  assert.equal(parseChoices("Pick one.\n[[choices single: Only one]]").groups.length, 0);
  assert.equal(parseChoices("No markers here.").groups.length, 0);
});

test("choices: [[book]] turns on the booking button and is hidden, also while streaming", () => {
  const r = parseChoices("Next step: a scoping call.\n[[book]]");
  assert.equal(r.book, true);
  assert.equal(r.text, "Next step: a scoping call.");
  assert.equal(parseChoices("Next step.\n[[bo").text, "Next step.");
  assert.equal(parseChoices("Next step.\n[[bo").book, false);
  assert.equal(parseChoices("No marker.").book, false);
});
