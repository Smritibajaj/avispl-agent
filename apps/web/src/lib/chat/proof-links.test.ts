import assert from "node:assert/strict";
import { test } from "node:test";
import { proofLinks } from "./proof-links";

const hit = (sourceUrl: string, pageTitle: string, contentType: "case_study" | "page", csOrganization?: string) => ({
  sourceUrl, pageTitle, title: `${pageTitle} › Section`, contentType, csOrganization,
});

test("proof links: cited pages only, one per URL, case studies first, no bad URLs", () => {
  const hits = new Map([
    ["S1", hit("https://avispl.com/microsoft/", "Microsoft", "page")],
    ["S2", hit("https://avispl.com/case/idrc/", "IDRC Case Study", "case_study", "IDRC")],
    ["S3", hit("https://avispl.com/microsoft/", "Microsoft", "page")],
    ["S4", hit("javascript:alert(1)", "Bad", "page")],
    ["S5", hit("https://avispl.com/not-cited/", "Not cited", "page")],
  ]);
  assert.deepEqual(proofLinks(["S1", "S2", "S3", "S4", "S9"], hits), [
    { url: "https://avispl.com/case/idrc/", label: "Case study: IDRC", proof: true },
    { url: "https://avispl.com/microsoft/", label: "Microsoft", proof: false },
  ]);
  assert.deepEqual(proofLinks([], hits), []);
});
