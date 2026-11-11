import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMeetingRequest, recordMeetingRequest } from "./meeting-request";

test("meeting request: needs a name and a valid email, trims and strips control characters", () => {
  assert.equal(parseMeetingRequest({ name: "A", email: "a@b.co" }).ok, false);
  assert.equal(parseMeetingRequest({ name: "Asha Rao", email: "not-an-email" }).ok, false);
  const r = parseMeetingRequest({ name: "  Asha\nRao ", email: "asha@example.com", notes: "line1\r\nline2" });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.name, "Asha Rao");
    assert.equal(r.value.notes, "line1 line2");
    assert.equal(r.value.company, "");
  }
});

test("meeting request: logged as one JSON line", () => {
  const lines: string[] = [];
  const r = parseMeetingRequest({ name: "Asha Rao", email: "asha@example.com", notes: 'x"\n[meeting-request] fake' });
  assert.ok(r.ok);
  if (r.ok) recordMeetingRequest(r.value, (l) => lines.push(l));
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]!.includes("\n"));
  assert.match(lines[0]!, /^\[meeting-request\] \{/);
});
