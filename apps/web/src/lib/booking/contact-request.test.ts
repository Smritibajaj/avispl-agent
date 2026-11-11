import assert from "node:assert/strict";
import { test } from "node:test";
import { findContactRequest } from "./contact-request";
import { UNAVAILABLE_REPLY } from "../agent/tool-logic";

const m = (role: string, text: string) => ({ role, parts: [{ type: "text", text }] });

test("an email sent after the fallback reply is a contact request, with the unanswered question", () => {
  const r = findContactRequest([m("user", "Which designs for 40 Teams rooms?"), m("assistant", UNAVAILABLE_REPLY), m("user", "sure, it's pat@example.com thanks")]);
  assert.deepEqual(r, { email: "pat@example.com", question: "Which designs for 40 Teams rooms?" });
});

test("an email nobody asked for is not logged", () => {
  assert.equal(findContactRequest([m("user", "Hi"), m("assistant", "Which organisation are you with?"), m("user", "Contoso, pat@example.com")]), null);
  assert.equal(findContactRequest([m("user", "my address is pat@example.com")]), null);
});

test("no email in the reply means no contact request", () => {
  assert.equal(findContactRequest([m("user", "Q"), m("assistant", UNAVAILABLE_REPLY), m("user", "no thanks")]), null);
});
