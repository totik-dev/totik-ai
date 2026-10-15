// Guide routing: which Totik guide pages a question is sent to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWorker } from "./load-worker.mjs";

const w = await loadWorker();
// Values come from another VM realm; copy them so deepEqual compares plain data.
const plain = value => JSON.parse(JSON.stringify(value));
const route = question => {
  const r = plain(w.resolveClassGuide(question));
  return { classKey: r.classKey || null, specKey: r.specKey || null, matched: !!r.matched, externalOnly: !!r.externalOnly, pages: (r.pages || []).map(p => p.key) };
};

test("catalog is complete: 9 classes, 177 pages, every page has a guide message", () => {
  const d = plain(w.catalogDiagnostics());
  assert.equal(d.totalPages, 177);
  assert.deepEqual(d.classes, ["druid", "hunter", "mage", "paladin", "priest", "rogue", "shaman", "warlock", "warrior"]);
  for (const page of w.CLASS_GUIDE_PAGES) {
    assert.ok(w.GUIDE_BATCH_MESSAGE_IDS[page.classKey]?.length, `${page.key} has no guide message`);
    assert.match(page.filename, /\.png$/);
  }
  assert.equal(new Set(w.CLASS_GUIDE_PAGES.map(p => p.key)).size, w.CLASS_GUIDE_PAGES.length, "duplicate page keys");
});

const GUIDE_CASES = [
  ["warrior tank hangi statı basmalı", "warrior", "protection", ["warrior.19-stat-priolari"]],
  ["prot pala rotasyon nasıl", "paladin", "protection", ["paladin.15-dps-tank-oncelik"]],
  ["mage frost talent", "mage", "frost", ["mage.14-frost-talent-1", "mage.15-frost-talent-2", "mage.16-frost-talent-3", "mage.17-frost-talent-4"]],
  ["warlock affli talent", "warlock", "affliction", ["warlock.08-affliction-talent-1", "warlock.09-affliction-talent-2", "warlock.10-affliction-talent-3"]],
  ["druid feral buff", "druid", "feral-combat", ["druid.02-buff-debuff"]],
  ["shadow priestin raide verdiği buff nedir", "priest", "shadow", ["priest.02-buff-debuff"]],
  ["warlock gruba ne katar", "warlock", null, ["warlock.02-buff-debuff"]],
  ["priest shadow seviye kasma", "priest", "shadow", ["priest.19-leveling"]],
  ["fury warrior silah seçimi", "warrior", "fury", ["warrior.21-weapon-gear-meslek"]],
  ["rogue combat rotasyon", "rogue", "combat", ["rogue.18-oynanis-oncelikleri"]],
  ["warrior", "warrior", null, ["warrior.01-sinif-ozeti"]],
  // Turkish case suffixes and short class names players use.
  ["warriorda hangi stat", "warrior", null, ["warrior.08-ofansif-statlar", "warrior.19-stat-priolari"]],
  ["mage'de frost talent", "mage", "frost", ["mage.14-frost-talent-1", "mage.15-frost-talent-2", "mage.16-frost-talent-3", "mage.17-frost-talent-4"]],
  ["druide hangi ırk", "druid", null, ["druid.04-irk-secimi"]],
  ["lock affli talent ağacı", "warlock", "affliction", ["warlock.08-affliction-talent-1", "warlock.09-affliction-talent-2", "warlock.10-affliction-talent-3"]],
  ["palada hangi stat", "paladin", null, ["paladin.06-ofansif-statlar"]],
  ["shamana hangi stat", "shaman", null, ["shaman.06-ofansif-yan-statlar"]]
];

for (const [question, classKey, specKey, pages] of GUIDE_CASES) {
  test(`guide: ${question}`, () => {
    const r = route(question);
    assert.equal(r.classKey, classKey);
    assert.equal(r.specKey, specKey);
    assert.equal(r.matched, true);
    assert.deepEqual(r.pages, pages);
  });
}

test("class is recognised even when no guide page fits", () => {
  assert.equal(route("shamanda totemler ne işe yarıyor").classKey, "shaman");
  assert.equal(route("sham totem").classKey, "shaman");
});

test("where-to-get questions go to research, not to a guide image", () => {
  for (const q of ["hunter pet nasıl alınır", "mage portal nerden öğrenilir", "rogue poison nereden alınır"]) {
    const r = route(q);
    assert.equal(r.matched, false, q);
    assert.equal(r.externalOnly, true, q);
  }
});

test("ordinary English words are not mistaken for classes", () => {
  for (const q of ["shame on you", "state machine", "hangi sınıf solo için iyi"]) assert.equal(route(q).classKey, null, q);
});

test("normalizer folds Turkish letters and known suffixes only", () => {
  assert.equal(w.normalizeGuideText("Şamanın Büyüleri"), "samanin buyuleri");
  assert.equal(w.normalizeGuideText("Warrior'ların talentleri"), "warrior talent");
  assert.equal(w.normalizeGuideText("warriorda locka palaya"), "warrior lock pala");
  assert.equal(w.normalizeGuideText("Ahmetde"), "ahmetde");
});

test("src/class-guide-catalog.js matches the catalog embedded in src/index.js", async () => {
  const fs = await import("node:fs");
  const read = path => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const catalog = read("../src/class-guide-catalog.js").replace(/^export /gm, "").replace(/^\/\/.*\n/, "").trim();
  assert.ok(read("../src/index.js").includes(catalog), "Catalog was regenerated but not copied into src/index.js (or the other way round).");
});

test("every non-talent guide page has verified text and src/index.js is up to date", async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [new URL("../scripts/build-guide-text.mjs", import.meta.url).pathname, "--check"]);
  const { parseGuideTexts } = await import("../scripts/build-guide-text.mjs");
  const texts = parseGuideTexts();
  for (const page of w.CLASS_GUIDE_PAGES) if (!page.talents?.length) assert.ok(texts[page.key], `${page.key} has no text in rehber-metinleri/`);
});
