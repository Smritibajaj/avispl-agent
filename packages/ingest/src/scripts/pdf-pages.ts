/** Read-only helper for choosing page ranges: writes per-page text of a local PDF to <file>.pages.txt and prints word counts. */
import { readFile, writeFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

const file = process.argv[2];
if (!file) throw new Error("usage: tsx src/scripts/pdf-pages.ts <file.pdf>");
const pdf = await getDocumentProxy(new Uint8Array(await readFile(file)));
const { totalPages, text } = await extractText(pdf, { mergePages: false });
const wc = (s: string) => s.split(/\s+/).filter(Boolean).length;
await writeFile(`${file}.pages.txt`, text.map((t, i) => `\n===== PAGE ${i + 1} (${wc(t)} words) =====\n${t.trim()}`).join("\n"));
console.log(`${file}: ${totalPages} pages, ${text.reduce((n, t) => n + wc(t), 0)} words`);
console.log(text.map((t, i) => `${i + 1}:${wc(t)}`).join(" "));
