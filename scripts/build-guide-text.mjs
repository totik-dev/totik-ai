// Copies the guide texts in rehber-metinleri/*.md into src/index.js.
// Usage: npm run guide-text            (update src/index.js)
//        node scripts/build-guide-text.mjs --check   (fail if out of date)
import fs from "node:fs";

const dir = new URL("../rehber-metinleri/", import.meta.url), indexUrl = new URL("../src/index.js", import.meta.url);
const START = "// GUIDE_PAGE_TEXT:START (npm run guide-text ile üretilir, elle düzenleme)", END = "// GUIDE_PAGE_TEXT:END";

export function parseGuideTexts() {
  const pages = {};
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith(".md")).sort()) {
    for (const section of fs.readFileSync(new URL(file, dir), "utf8").split(/^## /m).slice(1)) {
      const [key, ...body] = section.split("\n");
      const text = body.join("\n").replace(/^#{3,}\s*/gm, "").replace(/\n{3,}/g, "\n\n").trim();
      if (/^[a-z]+\.[0-9a-z-]+$/.test(key.trim()) && text) pages[key.trim()] = text;
    }
  }
  return pages;
}
export function renderBlock(pages) {
  return `${START}\nconst GUIDE_PAGE_TEXT = ${JSON.stringify(pages, null, 1)};\n${END}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const source = fs.readFileSync(indexUrl, "utf8"), block = renderBlock(parseGuideTexts());
  const start = source.indexOf(START), end = source.indexOf(END);
  const updated = start >= 0 ? source.slice(0, start) + block + source.slice(end + END.length) : source.replace("// AUTO-GENERATED — build_catalog.py", `${block}\n// AUTO-GENERATED — build_catalog.py`);
  if (process.argv.includes("--check")) { if (updated !== source) { console.error("src/index.js rehber metinleri güncel değil: npm run guide-text"); process.exit(1); } }
  else { fs.writeFileSync(indexUrl, updated); console.log(`${Object.keys(parseGuideTexts()).length} rehber sayfası yazıldı.`); }
}
