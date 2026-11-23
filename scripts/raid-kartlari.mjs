// Writes the card texts (kartlar/metin/<id>.md) and the index entries (kartlar/kartlar.json) of the
// level 60 class cards: Raid Talentleri, Pre-BiS, Raid Hazırlığı and T0.5 Seti, one of each per spec.
// The source is the data the cards were drawn from (Totik Edit Studio, 23.11.2026):
//   <kaynak>/wow-forever-rehber/veri/<sınıf>.js       talent trees (VERI.<sınıf>.agaclar)
//   <kaynak>/wow-forever-rehber/veri-raid/<sınıf>.js  raid builds (RAID.<sınıf>)
//   <kaynak>/wow-forever-hazirlik/kart/<sınıf>.js     pre-BiS, raid preparation and D1/T0.5 sets (SINIF.<sınıf>)
//   <kaynak>/wow-forever-hazirlik/kart/t05.js         the T0.5 quest chain (T05)
//   <kaynak>/gonderim-yeni/<Sınıf>/*.png               file names of the cards as posted in the forum
// Usage: node scripts/raid-kartlari.mjs <kaynak klasörü> [--png-list <dosya>]   then: npm run cards
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const source = process.argv[2];
if (!source) { console.error("Kullanım: node scripts/raid-kartlari.mjs <kaynak klasörü> [--png-list dosya]"); process.exit(1); }
const pngListAt = process.argv.indexOf("--png-list"), pngList = pngListAt > 0 ? JSON.parse(fs.readFileSync(process.argv[pngListAt + 1], "utf8")) : null;
const root = new URL("../", import.meta.url), indexUrl = new URL("kartlar/kartlar.json", root), textDir = new URL("kartlar/metin/", root);
const CLASSES = ["druid", "hunter", "mage", "paladin", "priest", "rogue", "shaman", "warlock", "warrior"];
const NAME = { druid: "Druid", hunter: "Hunter", mage: "Mage", paladin: "Paladin", priest: "Priest", rogue: "Rogue", shaman: "Shaman", warlock: "Warlock", warrior: "Warrior" };
const KINDS = { "Raid-Talentleri": "Raid Talentleri", "Pre-BiS": "Pre-BiS", "Raid-Hazirligi": "Raid Hazirligi", "T0.5-Seti": "T0.5 Seti" };
const KEYWORDS = {
  "Raid Talentleri": ["raid talent", "60 talent", "endgame build", "raid build"],
  "Pre-BiS": ["pre bis", "bis", "raid oncesi esya", "60 gear"],
  "Raid Hazirligi": ["raid hazirligi", "stat onceligi", "consumable", "flask", "iksir"],
  "T0.5 Seti": ["t0.5", "dungeon set 2", "d1 seti", "set bonusu"],
};
const slug = value => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const norm = value => slug(value).replace(/-/g, " ");
const clean = value => String(value ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const cell = value => clean(value).replace(/\|/g, "/") || "—";

function load(file, globals) {
  const ctx = { ...globals }; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx); return ctx;
}
const SINIF = new Proxy({}, { get: (t, k) => t[k] ?? (t[k] = {}) });
const ctx = { SINIF, VERI: {}, RAID: {} };
for (const s of CLASSES) {
  Object.assign(ctx, load(path.join(source, "wow-forever-rehber/veri", `${s}.js`), ctx));
  Object.assign(ctx, load(path.join(source, "wow-forever-rehber/veri-raid", `${s}.js`), ctx));
  Object.assign(ctx, load(path.join(source, "wow-forever-hazirlik/kart", `${s}.js`), ctx));
}
const T05 = load(path.join(source, "wow-forever-hazirlik/kart/t05.js"), {}).T05;

// The card files of a class in posting order: "13-Balance-Raid-Talentleri.png" → { number, spec, kind }.
function files(s) {
  const list = pngList ? pngList[NAME[s]] : fs.readdirSync(path.join(source, "gonderim-yeni", NAME[s]));
  return list.map(file => { const m = file.match(/^(\d+)-(.+)-(Raid-Talentleri|Pre-BiS|Raid-Hazirligi|T0\.5-Seti)\.png$/); return m && { file, number: m[1], spec: m[2].replace(/-/g, " "), kind: KINDS[m[3]] }; }).filter(Boolean);
}
// "Feral Kedi" ↔ RAID key "feral", prebis "Feral Kedi", T0.5 "Feral (Kedi)".
const SPEC_MATCH = { "feral kedi": ["feral", "feral kedi", "feral kedi dps"], "feral ayi": ["feral tank", "feral ayi", "feral ayi tank"] };
const sameSpec = (a, b) => { const x = norm(a), y = norm(b); return x === y || (SPEC_MATCH[x] || []).includes(y) || (SPEC_MATCH[y] || []).includes(x); };
const header = (s, spec, what) => `Üst bilgi: ${NAME[s].toUpperCase()} — ${spec.toUpperCase()}. ${what}. WOW FOREVER · TOTİK CHANNEL · SINIF REHBERİ.`;

function raidTalents(s, spec) {
  const key = Object.keys(ctx.RAID[s]).find(k => sameSpec(k, spec)), build = ctx.RAID[s][key], trees = ctx.VERI[s].agaclar;
  if (!build) throw new Error(`Raid build'i yok: ${s} ${spec}`);
  const where = name => { for (const tree of trees) { const t = tree.t.find(row => row[0] === name); if (t) return { tree: tree.ad, row: t[1], col: t[2], max: t[3], pre: t[5] || "" }; } throw new Error(`Talent ağaçta yok: ${s} ${name}`); };
  const total = build.talentler.reduce((sum, t) => sum + t[1], 0);
  const lines = [`# ${NAME[s]} · ${build.ad} Raid Talentleri`, "", header(s, build.ad, "60. SEVİYE RAID BUILD'İ"), "",
    `Bu kart 60. seviyedeki raid (endgame) build'idir. 10–60 arası leveling puan sırası ayrı kartta: ${build.ad} Leveling.`, "",
    "## 60. Seviye Puan Dağılımı", "", `${build.dagilim.join(" / ")} — ${trees.map((tree, i) => `${tree.ad} ${build.dagilim[i]}`).join(", ")}. TOPLAM ${total} PUAN.`, ""];
  for (const [i, tree] of trees.entries()) {
    const rows = build.talentler.map(t => ({ t, at: where(t[0]) })).filter(item => item.at.tree === tree.ad).sort((a, b) => a.at.row - b.at.row || a.at.col - b.at.col);
    if (!rows.length) continue;
    lines.push(`## ${tree.ad} — ${build.dagilim[i]} puan`, "", "| Talent | Rank | Satır | Etkisi |", "|---|---|---|---|");
    for (const { t, at } of rows) lines.push(`| ${t[0]} | ${t[1]}/${at.max} | ${at.row} | ${cell(t[2])}${at.pre ? ` (ön koşul: ${at.pre})` : ""} |`);
    lines.push("");
  }
  if (build.not) lines.push(`Not: ${clean(build.not)}`, "");
  lines.push("Kaynak: Icy Veins WoW Forever uzmanlık rehberi, ikinci bir rehberle karşılaştırıldı (23.11.2026).");
  return { title: build.ad, text: lines.join("\n") };
}

function preBis(s, spec) {
  const entry = (ctx.SINIF[s].prebis || []).find(u => sameSpec(u.uzm, spec)); if (!entry) throw new Error(`Pre-BiS yok: ${s} ${spec}`);
  const lines = [`# ${NAME[s]} · ${entry.uzm} Pre-BiS`, "", header(s, entry.uzm, "PRE-BIS: RAID ÖNCESİ EŞYALAR VE ENCHANTLAR"), "",
    "60. seviyede raide girmeden önce toplanacak en iyi eşyalar (pre-raid best in slot). Her slotta ana eşya, nereden alındığı, enchantı ve yedeği.", "",
    "| Slot | Eşya | Nereden | Enchant | Yedek |", "|---|---|---|---|---|"];
  for (const slot of entry.slotlar) lines.push(`| ${cell(slot.slot)} | ${cell(slot.ad)} | ${cell(slot.kaynak)} | ${cell(slot.ench)} | ${cell(slot.yedek)} |`);
  lines.push("", "\"T0.5 seti\" yazan parçaların nasıl alındığı aynı uzmanlığın T0.5 Seti kartında.");
  return { title: entry.uzm, text: lines.join("\n") };
}

function raidPrep(s, spec) {
  const entry = (ctx.SINIF[s].hazirlik || []).find(u => sameSpec(u.uzm, spec)); if (!entry) throw new Error(`Raid hazırlığı yok: ${s} ${spec}`);
  const name = clean(entry.uzm).replace(/\s*\(.*$/, "");
  const lines = [`# ${NAME[s]} · ${name} Raid Hazırlığı`, "", header(s, name, "RAID HAZIRLIĞI: STAT SIRASI VE STOKLANACAKLAR"), "", "## Stat önceliği", ""];
  entry.stat.sira.forEach((item, i) => lines.push(`${i + 1}. ${clean(item.ad)}${item.not ? ` — ${clean(item.not)}` : ""}`));
  if (entry.stat.capler?.length) { lines.push("", "## Sınırlar (cap)", ""); for (const cap of entry.stat.capler) lines.push(`- ${clean(cap.ad)}: ${clean(cap.hedef)}${cap.not ? ` — ${clean(cap.not)}` : ""}`); }
  for (const group of Object.values(entry.gruplar || {})) {
    lines.push("", `## ${clean(group.ad)}${group.alt ? ` (${clean(group.alt)})` : ""}`, "", "| Eşya | Etkisi | Nereden | Not |", "|---|---|---|---|");
    for (const item of group.yetenekler || []) lines.push(`| ${cell(item.ad)} | ${cell(item.etki)} | ${cell(item.kaynak)} | ${cell(item.not)} |`);
  }
  return { title: name, text: lines.join("\n") };
}

function t05(s, spec) {
  const sets = ctx.SINIF[s].setler; if (!sets) throw new Error(`Set verisi yok: ${s}`);
  const own = sets.t05.surumler.filter(v => (v.uzm || []).some(u => sameSpec(u, spec) || norm(u).startsWith(norm(spec)) || norm(spec).startsWith(norm(u).replace(/ .*$/, "")) && norm(u).split(" ").length === 1));
  const versions = own.length ? own : sets.t05.surumler;
  const lines = [`# ${NAME[s]} · ${spec} T0.5 Seti`, "", header(s, spec, "T0.5 SETİ (DUNGEON SET 2)"), "",
    `T0.5 seti (Dungeon Set 2, ${clean(sets.t05.ad)}) 60. seviyede, eski dungeon setinin (D1, ${clean(sets.d1.ad)}) parçaları takas edilerek alınır. Her takasta uzmanlığına göre bir kutu seçersin.`, "",
    `## D1 seti: ${clean(sets.d1.ad)} — parçalar nereden düşer`, "", "| Slot | Parça | Boss | Zindan | Düşme şansı |", "|---|---|---|---|---|"];
  for (const p of sets.d1.parcalar) lines.push(`| ${cell(p.slot)} | ${cell(p.ad)} | ${cell(p.boss)} | ${cell(p.zindan)} | ${cell(p.sans)}${p.not ? ` (${clean(p.not)})` : ""} |`);
  lines.push("", `D1 set bonusları: ${sets.d1.bonus.map(([n, text]) => `${n} parça: ${clean(text)}`).join(" · ")}.`);
  if (sets.d1.forever_farki) lines.push(`Forever farkı: ${clean(sets.d1.forever_farki)}`);
  for (const v of versions) {
    lines.push("", `## T0.5: ${clean(v.ad)} (${clean(v.rol)}; ${(v.uzm || []).map(clean).join(", ")})`, "", "| Slot | Parça | Stat |", "|---|---|---|");
    for (const p of v.parcalar) lines.push(`| ${cell(p.slot)} | ${cell(p.ad)} | ${cell(p.stat)} |`);
    lines.push("", `Set bonusları: ${v.bonus.map(([n, text]) => `${n} parça: ${clean(text)}`).join(" · ")}.`);
  }
  const listed = Object.entries(sets.t05.listede || {}).find(([u]) => sameSpec(u, spec) || norm(u).startsWith(norm(spec)));
  if (listed?.[1]?.length) lines.push("", `Pre-BiS listesindeki T0.5 parçaları: ${listed[1].join(", ")}.`);
  lines.push("", "## T0.5 nasıl alınır (takas zinciri)", "", `Özet: ${T05.ozet.map(([a, b]) => `${a} ${b.toLowerCase()}`).join(" · ")}.`);
  for (const [i, step] of T05.takaslar.entries()) {
    lines.push("", `### ${i + 1}. takas: ${clean(step.ad).toLowerCase()} (${clean(step.zor)})`, "");
    step.adim.forEach(([text, group, reward], j) => lines.push(`${j + 1}. ${clean(text)}${group ? " (grup gerekir)" : ""}${reward ? ` Ödül: ${clean(reward)}.` : ""}`));
  }
  return { title: spec, text: lines.join("\n") };
}

const BUILD = { "Raid Talentleri": raidTalents, "Pre-BiS": preBis, "Raid Hazirligi": raidPrep, "T0.5 Seti": t05 };
const index = JSON.parse(fs.readFileSync(indexUrl, "utf8")).filter(card => !(card.kategori === "sinif" && /-(raid-talentleri|pre-bis|raid-hazirligi|t0-5-seti)$/.test(card.id)));
const added = [];
for (const s of CLASSES) {
  for (const f of files(s)) {
    const { text } = BUILD[f.kind](s, f.spec);
    const id = `${s}-${f.number}-${slug(f.spec)}-${slug(f.kind)}`;
    fs.writeFileSync(new URL(`${id}.md`, textDir), `${text}\n`);
    added.push({ id, kategori: "sinif", konu: `${NAME[s]} · ${f.spec} ${f.kind}`, ek_adi: f.file, nerede: `Class rehberleri forumu → ${NAME[s]} konusu`, anahtar: [s, norm(`${f.spec} ${f.kind}`), ...KEYWORDS[f.kind]], sinif: NAME[s] });
  }
}
// Keep the class cards of a class together, in posting order.
const out = [];
for (const card of index) { out.push(card); const next = index[index.indexOf(card) + 1]; if (card.kategori === "sinif" && (!next || next.sinif !== card.sinif)) out.push(...added.filter(a => a.sinif === card.sinif)); }
fs.writeFileSync(indexUrl, `${JSON.stringify(out, null, 1)}\n`);
console.log(`${added.length} kart yazıldı.`);
