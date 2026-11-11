// SYNTHETIC TEST FIXTURE, NOT AVI-SPL CONTENT (all strings below are invented for the tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardsToList, fixAnimatedCounters, pairTabs, stripChrome, unlinkListItems } from "../new-prep";

test("fixAnimatedCounters replaces mid-animation numbers with data-target", () => {
  const html = `<span class="c" data-target="97.25" data-decimals="1">12.3</span><span>%</span> <span class="c" data-target="40">-7</span>`;
  const md = "Intro\n\n12.3%\n\nUptime in Fjordlantern rooms\n\n-7\n%\n\nof widgets";
  const r = fixAnimatedCounters(md, html);
  assert.match(r.markdown, /\n97\.3%\n/);
  assert.match(r.markdown, /\n40%\n/);
  assert.doesNotMatch(r.markdown, /12\.3|-7/);
  assert.deepEqual(r.fixed, ["12.3 -> 97.3", "-7 -> 40"]);
});

test("pairTabs pairs labels with panels in DOM order, tolerant of odd whitespace", () => {
  const html = `<section><button role="tab">Alpha <br> One</button><button role="tab">Beta</button>
    <div id="panel-0" role="tabpanel"><p>First panel text.</p><a>Go</a></div>
    <div id="panel-1" role="tabpanel"><p>Second panel text.</p></div></section>`;
  const md = "### Tabs\n\nAlpha\n\nOne\nBeta\n\nFirst panel text.\n\n[Go](https://example.com/)\n\nSecond panel text.\n";
  const r = pairTabs(md, html);
  assert.equal(r.paired, 2);
  assert.match(r.markdown, /\*\*Alpha One:\*\* First panel text\./);
  assert.match(r.markdown, /\*\*Beta:\*\* Second panel text\./);
  assert.doesNotMatch(r.markdown, /^Beta$/m);
});

test("pairTabs leaves markdown untouched when a panel has several paragraphs", () => {
  const html = `<button role="tab">A</button><div id="panel-0" role="tabpanel"><p>x</p><p>y</p></div></section>`;
  assert.equal(pairTabs("A\n\nx\n\ny", html).markdown, "A\n\nx\n\ny");
});

test("cardsToList converts one-line cards and stops at the first non-card heading", () => {
  const md = "## Formats\n\n![i](https://example.com/a.png)\n\n### Guide\n\nShort line one\n\n### Video\n\nShort line two\n\n### Other block\n\n[link](https://example.com/)\n\n### Later\n\nNot a card here";
  const r = cardsToList(md, /Formats/);
  assert.equal(r.cards, 2);
  assert.match(r.markdown, /- \*\*Guide\*\*: Short line one\n- \*\*Video\*\*: Short line two/);
  assert.match(r.markdown, /### Other block/);
  assert.match(r.markdown, /### Later\n\nNot a card here/);
});

test("stripChrome cuts the blog footer and the geo popup, keeps the article", () => {
  const md = "Jan 1 - 2030\n\n# Title\n\nAVI-SPL\n\n[Share by Email](mailto:?subject=x)\n\nBody text.\n\n[Back to Blog](https://avispl.com/blog/) [Next Article](https://avispl.com/blog/x/)\n\n#### You may also like\n\nOther post";
  const r = stripChrome(md);
  assert.match(r.markdown, /Body text\./);
  assert.doesNotMatch(r.markdown, /You may also like|Share by Email|^AVI-SPL$/m);
  assert.doesNotMatch(stripChrome("Body.\n\nWe noticed you're in Atlantis.\n\nVisit elsewhere?").markdown, /noticed/);
});

test("unlinkListItems turns bare bold-link bullets into plain bullets", () => {
  assert.equal(unlinkListItems("- [**Rooms**](https://example.com/r/)\n- plain"), "- Rooms\n- plain");
});
