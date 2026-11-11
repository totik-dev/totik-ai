// Builds src/cards-data.js from kartlar/kartlar.json, kartlar/metin/<id>.md and kartlar/sinif-bilgi.json.
// Usage: npm run cards                      (update src/cards-data.js)
//        node scripts/build-cards.mjs --check   (fail if out of date)
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const indexUrl = new URL("kartlar/kartlar.json", root), textDir = new URL("kartlar/metin/", root), outUrl = new URL("src/cards-data.js", root), factsUrl = new URL("kartlar/sinif-bilgi.json", root);

const slug = value => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const PROFESSION_KEYS = { aid: "first-aid", alch: "alchemy", bs: "blacksmithing", cook: "cooking", ench: "enchanting", eng: "engineering", fish: "fishing", herb: "herbalism", lw: "leatherworking", mining: "mining", skin: "skinning", tail: "tailoring" };
const SPEC_KEYS = { "feral-kedi-dps": "feral-kedi", "feral-ayi-tank": "feral-ayi" };

function place(card) {
  // "Class rehberleri forumu → Druid konusu" / 'Zindan rehberleri forumu → "Lv 14 · Ragefire Chasm (RFC)" konusu'
  const match = String(card.nerede || "").match(/^(.*?) forumu → (.*) konusu$/);
  if (!match) throw new Error(`Kart yeri okunamadı: ${card.id}`);
  return { forum: match[1].trim(), thread: match[2].trim().replace(/^"|"$/g, "") };
}

function classFields(card) {
  const stem = slug(card.ek_adi.replace(/\.png$/i, "")).replace(/^\d+-/, "");
  if (stem === "irk-secimi") return { kind: "race" };
  if (/^yetenekler-\d+$/.test(stem)) return { kind: "abilities", part: Number(stem.split("-")[1]) };
  if (stem === "oynanis") return { kind: "gameplay" };
  const spec = stem.match(/^(.*)-(talentleri|leveling)$/);
  if (!spec) throw new Error(`Sınıf kartı türü bilinmiyor: ${card.id}`);
  return { kind: spec[2] === "leveling" ? "leveling" : "talents", spec: SPEC_KEYS[spec[1]] || spec[1] };
}

function professionFields(card) {
  const [prefix, ...rest] = card.id.split("-"), key = PROFESSION_KEYS[prefix];
  if (!key) throw new Error(`Meslek bilinmiyor: ${card.id}`);
  const range = rest.join("-").match(/^(\d+)-(\d+)(?:-(alliance|horde))?$/);
  if (range) return { profession: key, part: "range", range: [Number(range[1]), Number(range[2])], faction: range[3] || null };
  return { profession: key, part: rest.join("-") };
}

function dungeonFields(card) {
  const summary = String(card.ozet || ""), level = summary.match(/Önerilen seviye:\*\*\s*(\d+)/), zone = summary.match(/Bölge:\*\*\s*(.+)/), bosses = summary.match(/Bosslar \(\d+\):\*\*\s*(.+)/);
  if (!level || !zone) throw new Error(`Zindan özeti okunamadı: ${card.id}`);
  return {
    dungeon: card.anahtar[0], level: Number(level[1]), zone: zone[1].trim(), bosses: bosses ? bosses[1].split(",").map(b => b.trim()).filter(Boolean) : [],
    ...(Number.isInteger(card.gorev_horde) ? { hordeQuests: card.gorev_horde, allianceQuests: card.gorev_alliance } : {})
  };
}

export function buildCards() {
  const index = JSON.parse(fs.readFileSync(indexUrl, "utf8")), cards = [], missing = [];
  for (const card of index) {
    const file = new URL(`${card.id}.md`, textDir);
    if (!fs.existsSync(file)) { missing.push(card.id); continue; }
    const text = fs.readFileSync(file, "utf8").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 200) { missing.push(card.id); continue; }
    const base = { id: card.id, category: { sinif: "class", meslek: "profession", zindan: "dungeon" }[card.kategori], title: card.konu, file: card.ek_adi, ...place(card), keywords: card.anahtar };
    if (base.category === "class") Object.assign(base, { classKey: slug(card.sinif), ...classFields(card) });
    else if (base.category === "profession") Object.assign(base, { professionName: card.meslek, ...professionFields(card) });
    else Object.assign(base, dungeonFields(card));
    cards.push({ ...base, text });
  }
  return { cards, missing, total: index.length };
}

// Verified class data that is not printed on any card: spec roles, strengths and weaknesses, race picks.
export function classFacts() {
  const { taraflar, genel, siniflar } = JSON.parse(fs.readFileSync(factsUrl, "utf8"));
  if (!taraflar?.Alliance?.length || !taraflar?.Horde?.length) throw new Error("Sınıf bilgisi eksik: taraflar");
  for (const [key, entry] of Object.entries(siniflar)) if (!Array.isArray(entry.uzmanliklar) || entry.uzmanliklar.length !== 3) throw new Error(`Sınıf bilgisi eksik: ${key}`);
  return { taraflar, genel, siniflar };
}

export function render(cards, facts = classFacts()) {
  return `// AUTO-GENERATED — scripts/build-cards.mjs (npm run cards). Elle düzenleme: kartlar/metin/*.md ve kartlar/sinif-bilgi.json dosyalarını düzelt.\nexport const CARDS = ${JSON.stringify(cards, null, 1)};\nexport const CLASS_FACTS = ${JSON.stringify(facts, null, 1)};\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { cards, missing, total } = buildCards(), output = render(cards);
  if (missing.length) { console.error(`Metni eksik kartlar (${missing.length}/${total}): ${missing.join(", ")}`); if (!process.argv.includes("--allow-missing")) process.exit(1); }
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(outUrl) || fs.readFileSync(outUrl, "utf8") !== output) { console.error("src/cards-data.js güncel değil: npm run cards"); process.exit(1); }
  } else { fs.writeFileSync(outUrl, output); console.log(`${cards.length} kart yazıldı.`); }
}
