// Card selection: which forum cards a question is answered with.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { loadWorker } from "./load-worker.mjs";

const w = await loadWorker();
const pick = question => {
  const s = w.pickCards(question, { talentAdvice: w.isTalentAdviceQuestion(question) });
  return s ? { category: s.category, cards: Array.from(s.cards, card => card.id), need: s.need || null, local: !!s.localAnswer } : null;
};

test("knowledge base is complete: 189 cards, every card has its full text and a forum topic", () => {
  const index = JSON.parse(fs.readFileSync(new URL("../kartlar/kartlar.json", import.meta.url), "utf8"));
  assert.equal(index.length, 189);
  assert.equal(w.CARDS.length, 189);
  assert.deepEqual(Array.from(w.CARDS, card => card.id).sort(), index.map(card => card.id).sort());
  const count = category => w.CARDS.filter(card => card.category === category).length;
  assert.deepEqual([count("class"), count("dungeon"), count("profession")], [93, 40, 56]);
  for (const card of w.CARDS) {
    assert.ok(card.text.length >= 200, `${card.id} has no text`);
    assert.ok(card.forum && card.thread && /\.png$/.test(card.file), `${card.id} has no place`);
  }
  assert.equal(new Set(w.CARDS.map(card => `${card.thread}\n${card.file}`)).size, 189, "two cards share a file in one topic");
  assert.equal(w.CARD_TOPICS.length, 9 + 40 + 12);
});

test("src/cards-data.js is up to date with kartlar/metin", () => {
  execFileSync(process.execPath, [new URL("../scripts/build-cards.mjs", import.meta.url).pathname, "--check"]);
});

const CASES = [
  // Professions: the skill number picks the range card, otherwise where to start + the general card.
  ["fishing hangi levelde nerde yapmalıyım fark ediyor mu", "profession", ["fish-1-75", "fish-genel"]],
  ["fishing 150 skill nerede kasılır", "profession", ["fish-75-225"]],
  ["balık tutma 250 nerede", "profession", ["fish-225-300"]],
  ["mining 200 nerede kasarım", "profession", ["mining-175-245"]],
  ["herbalism 1-70 horde nerede", "profession", ["herb-1-70-horde"]],
  ["herbalism nerede kasılır", "profession", ["herb-1-70-alliance", "herb-1-70-horde"]],
  ["first aid eğitmeni nerede", "profession", ["aid-genel"]],
  ["blacksmithing önemli tarifler", "profession", ["bs-tarifler"]],
  ["cooking kamp ateşi buffları", "profession", ["cook-kamp"]],
  ["hangi yemek stamina veriyor cooking", "profession", ["cook-yemek"]],
  ["leatherworking 230", "profession", ["lw-225-300"]],
  ["engineering eğitmeni nerede", "profession", ["eng-genel"]],
  // Dungeons: names, abbreviations and wings.
  ["deadmines kaç levelde girilir", "dungeon", ["zindan-03-deadmines"]],
  ["dm kaç level", "dungeon", ["zindan-03-deadmines"]],
  ["dm west boss", "dungeon", ["zindan-34-dire-maul-west"]],
  ["SFK görevleri nerede", "dungeon", ["zindan-06-shadowfang-keep"]],
  ["rfc rota", "dungeon", ["zindan-01-ragefire-chasm"]],
  ["sm cathedral rota", "dungeon", ["zindan-18-scarlet-monastery-cathedral"]],
  ["strat ud kaç level", "dungeon", ["zindan-39-stratholme-undead"]],
  ["gnomeregan görev sayısı horde", "dungeon", ["zindan-11-gnomeregan"]],
  ["scholomance kaç boss", "dungeon", ["zindan-40-scholomance"]],
  // Classes.
  ["mage ırk seçimi", "class", ["mage-01-irk-secimi"]],
  ["druide hangi ırk", "class", ["druid-01-irk-secimi"]],
  ["warrior arms talent sırası", "class", ["warrior-08-arms-leveling"]],
  ["fury warrior build önerisi", "class", ["warrior-09-fury-leveling"]],
  ["druid feral tank leveling", "class", ["druid-11-feral-ayi-tank-leveling"]],
  ["lock affli leveling build", "class", ["warlock-08-affliction-leveling"]],
  ["rogue combat oynanış rotasyon", "class", ["rogue-07-oynanis"]],
  ["shaman totemleri neler", "class", ["shaman-03-yetenekler-2"]],
  ["deep wounds nedir", "class", ["warrior-04-arms-talentleri"]]
];
for (const [question, category, cards] of CASES) {
  test(`cards: ${question}`, () => {
    const r = pick(question);
    assert.ok(r, "no card selected");
    assert.equal(r.category, category);
    assert.deepEqual(r.cards, cards);
    assert.equal(r.need, null);
  });
}

test("a talent question without a spec asks for the spec, without a class asks for both", () => {
  for (const q of ["warrior talent nasıl dağıtılır", "rogue hangi talentleri almalı", "shaman leveling"]) assert.equal(pick(q)?.need, "spec", q);
  for (const q of ["hangi talenti seçmeliyim", "talent ne yapmalıyım", "talentlerimi nereye basayım", "1-60 talent sırası"]) assert.equal(pick(q)?.need, "class", q);
  // A spec named after the bot asked: the class comes from the conversation.
  const followUp = w.pickCards("arms", { talentAdvice: true, classHint: "warrior" });
  assert.deepEqual(Array.from(followUp.cards, card => card.id), ["warrior-08-arms-leveling"]);
});

test("general dungeon questions are answered from the dungeon list", () => {
  for (const q of ["hangi dungeona gideyim", "zindan önerisi", "dungeon rotası nasıl"]) { const r = pick(q); assert.equal(r.category, "dungeon", q); assert.equal(r.local, true, q); }
  const r = w.pickCards("30 level hangi dungeon");
  assert.ok(r.cards.length >= 1 && r.cards.every(card => Math.abs(card.level - 30) <= 3));
  assert.match(r.localAnswer, /30/);
});

test("questions the cards do not cover are left to the normal answer", () => {
  for (const q of ["hangi sınıf solo için iyi", "hunter mı iyi mage mı", "onyxia attunement nasıl yapılır", "wow forever guild var mı", "dwarf shaman için leveling aşamasında hangi meslekleri önerirsin", "priest kasarken hangi spec", "shame on you", "state machine"]) assert.equal(pick(q), null, q);
});

test("a class question that mentions a dungeon stays a class question", () => {
  assert.equal(pick("hunter dungeonda pet aggro nasıl yönetilir").category, "class");
});

test("card attachments are matched by file name, as Discord stores them", () => {
  const card = w.CARDS.find(c => c.id === "druid-10-feral-kedi-leveling");
  const files = [{ id: "1", filename: "09-Balance-Leveling.png" }, { id: "2", filename: "10-Feral-Kedi-Leveling.png" }, { id: "3", filename: "notlar.txt" }];
  assert.equal(w.findCardAttachment(card, files).id, "2");
  assert.equal(w.findCardAttachment(card, [{ id: "4", filename: "10_Feral_Kedi_Leveling.png" }]).id, "4");
  assert.equal(w.findCardAttachment(card, [files[0]]), null);
});

test("normalizer folds Turkish letters and known suffixes only", () => {
  assert.equal(w.normalizeGuideText("Şamanın Büyüleri"), "samanin buyuleri");
  assert.equal(w.normalizeGuideText("Warrior'ların talentleri"), "warrior talent");
  assert.equal(w.normalizeGuideText("warriorda locka palaya"), "warrior lock pala");
  assert.equal(w.normalizeGuideText("Ahmetde"), "ahmetde");
});
