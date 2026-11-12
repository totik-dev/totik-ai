// Question battery: several hundred real-style questions and the cards (or the kind of answer) each must get.
// Nothing here calls Discord or the AI service; it only checks how the bot understands a question.
//
// Expectations:
//   "=a,b"      exactly these cards, in this order
//   "^a"        the first card is a
//   "~prefix"   at least one card, and every card id starts with prefix
//   "need:spec" / "need:class"   the bot asks back
//   "compare:a+b" / "compare:*"  spec comparison (talent order cards of those specs; * = every spec of the class)
//   "facts"     answered from the class facts, no card
//   "overview"  answered from the class overview (all classes)
//   "dungeons"  the dungeon list by level
//   "none"      the cards are not used by rule (a loose text match may still be tried)
//   "note=a,b"  answered from these WoW Forever notes (kartlar/forever-bilgi.json) before any card
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWorker } from "./load-worker.mjs";
import { REVIEWED } from "./questions-reviewed.mjs";

const w = await loadWorker();
const pick = question => w.pickCards(question, { talentAdvice: w.isTalentAdviceQuestion(question) });
const ids = selection => Array.from(selection?.cards || [], card => card.id);

function check(question, expected) {
  const s = pick(question), got = ids(s), label = `${question} → ${s ? `${s.category} [${got.join(", ")}]${s.need ? ` need:${s.need}` : ""}${s.compare ? ` compare:${Array.from(s.compare).join("+")}` : ""}${s.factsOnly ? " facts" : ""}${s.search ? " search" : ""}` : "null"}`;
  const notes = Array.from(w.foreverNotes(question), note => note.id), noteFirst = notes.length > 0 && (w.isForeverNoteSubject(question) || (!s || s.need || s.search) && w.notesCoverQuestion(question, w.foreverNotes(question)));
  if (process.env.DUMP_NOTES && notes.length) console.log(`NOTE\t${noteFirst ? "first" : "after"}\t${notes.join(",")}\t${expected}\t${label}`);
  if (expected.startsWith("note=")) { assert.ok(noteFirst, label); return assert.deepEqual(notes.slice(0, expected.slice(5).split(",").length), expected.slice(5).split(","), `${label} notes: ${notes.join(", ")}`); }
  // A question that a card answers is never taken over by a Forever note.
  if (expected !== "none") assert.ok(!noteFirst, `${label} — Forever notu kartın önüne geçti: ${notes.join(", ")}`);
  if (expected === "none") return assert.ok(!s || s.search, label);
  assert.ok(s && !s.search, label);
  if (expected.startsWith("need:")) return assert.equal(s.need, expected.slice(5), label);
  assert.equal(s.need, null, label);
  if (expected.startsWith("compare:")) {
    assert.ok(s.compare, label);
    if (expected !== "compare:*") assert.deepEqual(Array.from(s.compare).sort(), expected.slice(8).split("+").sort(), label);
    else assert.ok(s.compare.length >= 3, label);
    return;
  }
  assert.ok(!s.compare, label);
  // "advice" = profession advice from the card lines, without a card; "advice=a,b" = with those cards.
  if (expected.startsWith("advice")) { assert.ok(s.advice, label); return assert.deepEqual(got, expected.length > 7 ? expected.slice(7).split(",") : [], label); }
  assert.ok(!s.advice, label);
  if (expected === "facts") return assert.ok(s.factsOnly && !s.general && !got.length, label);
  if (expected === "overview") return assert.ok(s.factsOnly && s.general && s.category === "class", label);
  if (expected === "dungeons") return assert.ok(s.general && s.category === "dungeon", label);
  assert.ok(!s.factsOnly, label);
  if (expected.startsWith("=")) return assert.deepEqual(got, expected.slice(1).split(","), label);
  if (expected.startsWith("^")) return assert.equal(got[0], expected.slice(1), label);
  if (expected.startsWith("~")) return assert.ok(got.length && got.every(id => id.startsWith(expected.slice(1))), label);
  throw new Error(`Unknown expectation: ${expected}`);
}

// ------------------------------------------------------------
// Classes: every spec, asked the ways players write them
// ------------------------------------------------------------
const SPECS = {
  warrior: { "08-arms": ["arms"], "09-fury": ["fury"], "10-protection": ["protection", "prot", "tank"] },
  paladin: { "08-holy": ["holy", "healer"], "09-protection": ["protection", "prot", "tank"], "10-retribution": ["retribution", "ret", "retri"] },
  hunter: { "08-beast-mastery": ["beast mastery", "bm"], "09-marksmanship": ["marksmanship", "marksman", "mm"], "10-survival": ["survival", "surv"] },
  rogue: { "08-assassination": ["assassination", "assa"], "09-combat": ["combat"], "10-subtlety": ["subtlety", "sub"] },
  priest: { "08-discipline": ["discipline", "disc"], "09-holy": ["holy"], "10-shadow": ["shadow"] },
  shaman: { "09-elemental": ["elemental", "ele"], "10-enhancement": ["enhancement", "enh"], "11-restoration": ["restoration", "resto"] },
  mage: { "08-arcane": ["arcane"], "09-fire": ["fire"], "10-frost": ["frost"] },
  warlock: { "08-affliction": ["affliction", "affli"], "09-demonology": ["demonology", "demo"], "10-destruction": ["destruction", "destro"] },
  druid: { "09-balance": ["balance", "boomkin"], "10-feral-kedi": ["feral kedi", "feral cat", "feral dps"], "11-feral-ayi-tank": ["feral tank", "bear tank", "ayı tank"], "12-restoration": ["restoration", "resto"] }
};
const TALENT_CARD = { "feral-kedi": "feral-kedi-dps", "feral-ayi-tank": "feral-ayi-tank" };
const GAMEPLAY = { shaman: "shaman-08-oynanis", druid: "druid-08-oynanis" };
const CASES = [];
for (const [cls, specs] of Object.entries(SPECS)) {
  const numbers = Object.keys(specs).map(key => Number(key.slice(0, 2))), firstTalent = Math.min(...numbers) - Object.keys(specs).length - 1;
  Object.entries(specs).forEach(([key, aliases], index) => {
    const leveling = `${cls}-${key}-leveling`, stem = key.slice(3), talents = `${cls}-${String(firstTalent + index).padStart(2, "0")}-${TALENT_CARD[stem] || stem}-talentleri`;
    for (const alias of aliases) {
      CASES.push([`${cls} ${alias} talent sırası`, `=${leveling}`], [`${alias} ${cls} leveling build`, `=${leveling}`], [`${alias} ${cls} hangi talentleri almalıyım`, `=${leveling}`],
        [`${cls} ${alias} rotasyon nasıl`, `=${GAMEPLAY[cls] || `${cls}-07-oynanis`}`]);
    }
    CASES.push([`${cls} ${aliases[0]} talentleri ne işe yarar`, `^${talents}`]);
  });
  CASES.push([`${cls} ırk seçimi`, `=${cls}-01-irk-secimi`], [`${cls} için hangi ırk iyi`, `=${cls}-01-irk-secimi`], [`${cls} talent nasıl dağıtılır`, "need:spec"], [`${cls} build`, "need:spec"],
    [`${cls} hangi spec`, "compare:*"], [`${cls} leveling için hangi spec daha iyi`, "compare:*"], [`${cls} pvp için hangi talent`, "compare:*"], [`${cls} raid için hangi build önerirsin`, "compare:*"],
    [`${cls} en iyi uzmanlık hangisi`, "compare:*"], [`${cls} nasıl bir sınıf`, "facts"], [`${cls} solo iyi mi`, "facts"]);
}

CASES.push(
  // The three questions the owner sent as examples of bad answers.
  ["mage için levelling,dungeon ve pvp için hangi talentleri önerirsin arcane mi frost mu fire mi", "compare:arcane+fire+frost"],
  ["frost mage oynarken skill trainerda fire veya arcane skillerini almak gerekir mi? yoksa sadece frost skillerini almak mı gerekir?", "^mage-07-oynanis"],
  ["fishing hangi levelde nerde yapmalıyım fark ediyor mu", "=fish-1-75,fish-genel"],
  // Spec against spec.
  ["mage frost mu fire mı", "compare:frost+fire"], ["fury mi arms mı", "compare:fury+arms"], ["arms mı fury mi leveling için", "compare:arms+fury"], ["druid heal mi feral mi", "compare:restoration+feral-kedi"],
  ["lock destro mu affli mi", "compare:destruction+affliction"], ["shaman enhancement mı elemental mi leveling", "compare:enhancement+elemental"], ["paladin holy mi ret mi", "compare:holy+retribution"],
  ["warrior arms fury farkı ne", "compare:arms+fury"], ["rogue combat vs subtlety", "compare:combat+subtlety"], ["hunter bm mi mm mi survival mı", "compare:beast-mastery+marksmanship+survival"],
  ["priest disc mi holy mi heal için", "compare:discipline+holy"], ["warlock demo mu destro mu raid", "compare:demonology+destruction"], ["druid balance mı resto mu", "compare:balance+restoration"],
  ["frost mu arcane mı", "compare:frost+arcane"], ["affliction mı destruction mı", "compare:affliction+destruction"], ["priest kasarken hangi spec", "compare:*"], ["warrior hangi spec leveling için iyi", "compare:*"],
  ["hunter pvp için hangi talent", "compare:*"], ["rogue dungeon için hangi build", "compare:*"], ["paladin pvp spec önerisi", "compare:*"], ["warlock hangi uzmanlık raid için iyi", "compare:*"],
  ["mage leveling için hangi talent ağacı", "compare:*"], ["shaman hangi dal daha iyi", "compare:*"], ["warrior leveling için hangi talent", "compare:*"],
  // Several specs named, but the question is about one of them.
  ["frost mage fire büyülerini de kullanır mı rotasyonda", "^mage-07-oynanis"], ["arms warrior fury talentlerine puan verir mi leveling build", "=warrior-08-arms-leveling"],
  // A spec or role on its own.
  ["paladin tank olur mu", "=paladin-05-protection-talentleri"], ["druid tank olabilir mi", "=druid-06-feral-ayi-tank-talentleri"], ["priest dps atabilir mi", "=priest-06-shadow-talentleri"],
  ["shaman healer iyi mi", "=shaman-07-restoration-talentleri"], ["warrior prot iyi mi", "=warrior-06-protection-talentleri"],
  // Ask back.
  ["rogue hangi talentleri almalı", "need:spec"], ["shaman leveling", "need:spec"], ["mage talent sırası", "need:spec"], ["priest talentlerini nasıl dizeyim", "need:spec"],
  ["hangi talenti seçmeliyim", "need:class"], ["talent ne yapmalıyım", "need:class"], ["talentlerimi nereye basayım", "need:class"], ["1-60 talent sırası", "need:class"], ["talentlerimi nasıl dağıtayım", "need:class"],
  // Level inside a build question.
  ["frost mage 30 level hangi talent", "=mage-10-frost-leveling"], ["arms warrior 40 levelde hangi talenti almalıyım", "=warrior-08-arms-leveling"], ["shadow priest leveling 20 level", "=priest-10-shadow-leveling"],
  // Races.
  ["mage ırk seçimi", "=mage-01-irk-secimi"], ["druide hangi ırk", "=druid-01-irk-secimi"], ["orc warrior mı tauren warrior mı", "=warrior-01-irk-secimi"], ["gnome mage iyi mi", "=mage-01-irk-secimi"],
  ["troll hunter iyi mi", "=hunter-01-irk-secimi"], ["undead rogue olur mu", "=rogue-01-irk-secimi"], ["human paladin mi dwarf paladin mi", "=paladin-01-irk-secimi"], ["night elf druid mi tauren druid mi", "=druid-01-irk-secimi"],
  ["shaman için en iyi ırk", "=shaman-01-irk-secimi"], ["priest ırkları", "=priest-01-irk-secimi"], ["warlock hangi ırkla açılır", "=warlock-01-irk-secimi"], ["rogue racial hangisi iyi", "=rogue-01-irk-secimi"],
  // Abilities and talents by name; the class is not always written.
  ["deep wounds nedir", "=warrior-04-arms-talentleri"], ["mortal strike ne işe yarar", "^warrior-04-arms-talentleri"], ["windfury ne yapar", "~shaman-"], ["stormstrike ne işe yarar", "~shaman-"],
  ["shaman totemleri neler", "=shaman-03-yetenekler-2"], ["frostbolt kaç levelde öğrenilir", "^mage-02-yetenekler-1"], ["polymorph kaçta açılıyor", "~mage-"], ["druid kedi formu kaçta açılıyor", "~druid-0"],
  ["succubus kaç levelde alınır", "~warlock-0"], ["voidwalker nasıl alınır", "~warlock-0"], ["rogue zehirleri nelerdir", "~rogue-0"], ["hunter pet yetenekleri", "~hunter-0"], ["bloodthirst kaç puan", "~warrior-"],
  ["ice barrier ne zaman alınır", "~mage-"], ["shadowform kaçta", "~priest-"], ["sweeping strikes ne yapar", "~warrior-"], ["hunter aspectleri", "~hunter-0"], ["paladin auraları neler", "~paladin-0"],
  ["warlock lanetleri ne işe yarar", "~warlock-0"], ["priest hangi büyüleri öğrenir", "~priest-0"], ["warrior stance ne zaman değiştirilir", "~warrior-0"], ["mage portal kaç level", "~mage-0"],
  // Gameplay.
  ["arms warrior rotasyon", "=warrior-07-oynanis"], ["shadow priest rotasyon", "=priest-07-oynanis"], ["enhancement shaman aoe nasıl atılır", "^shaman-08-oynanis"], ["rogue combat oynanış rotasyon", "=rogue-07-oynanis"],
  ["fury warrior hangi skilleri öğrenmeli", "^warrior-07-oynanis"], ["bm hunter öncelik sırası", "=hunter-07-oynanis"], ["affliction warlock nasıl oynanır", "=warlock-07-oynanis"], ["feral kedi rotasyon", "=druid-08-oynanis"],
  ["hunter dungeonda pet aggro nasıl yönetilir", "~hunter-"], ["holy paladin grup heal nasıl", "~paladin-"],
  // Whole classes.
  ["hunter mı iyi mage mı", "facts"], ["warlock mı mage mi", "facts"], ["warrior ve paladin tank farkı", "facts"], ["rogue mu hunter mı solo", "facts"], ["priest mi druid mi heal için hangisi", "facts"],
  ["hangi sınıf tank olabilir", "overview"], ["healer oynamak istiyorum hangi sınıf", "overview"], ["yeni başlayan için hangi sınıf önerirsin", "overview"], ["en kolay sınıf hangisi", "overview"],
  ["hangi sınıf solo için iyi", "overview"], ["undead hangi sınıf olabilir", "overview"], ["tank olmak istiyorum hangisini seçmeliyim", "overview"], ["hangi classı seçmeliyim", "overview"],
  // ------------------------------------------------------------
  // Professions
  // ------------------------------------------------------------
  ["fishing 150 skill nerede kasılır", "=fish-75-225"], ["balık tutma 250 nerede", "=fish-225-300"], ["fishing 75 nerede", "=fish-75-225"], ["fishing 70 skilldeyim", "=fish-1-75,fish-75-225"],
  ["fishing 300 nerede", "=fish-225-300"], ["fishing eğitmeni nerede", "=fish-genel"], ["balıkçılık nasıl kasılır", "=fish-1-75,fish-genel"], ["olta nereden alınır fishing", "~fish-"],
  ["mining 200 nerede kasarım", "=mining-175-245"], ["mining 50 horde", "=mining-1-65-horde"], ["mining 100 alliance nerede", "=mining-65-125-alliance"], ["mining 260", "=mining-245-300"], ["mining 150 nerede", "=mining-125-175"],
  ["mining nerede kasılır alliance", "=mining-1-65-alliance,mining-genel"], ["madencilik eğitmeni", "=mining-genel"], ["mining nerede kasılır", "=mining-1-65-alliance,mining-1-65-horde"],
  ["herbalism 1-70 horde nerede", "=herb-1-70-horde"], ["herbalism nerede kasılır", "=herb-1-70-alliance,herb-1-70-horde"], ["herbalism 150 nerede", "=herb-115-170"], ["herbalism 90", "=herb-70-115"],
  ["herbalism 190 nerede toplarım", "=herb-170-205"], ["herb 220", "^herb-205-230"], ["herbalism 280", "=herb-230-300"], ["bitki toplama 30 alliance", "=herb-1-70-alliance"],
  ["skinning 100 nerede", "=skin-75-150"], ["skinning 200", "=skin-150-225"], ["skinning 290", "=skin-225-300"], ["skinning nerede kasılır horde", "^skin-1-75-horde"], ["deri yüzme 40 alliance", "=skin-1-75-alliance"],
  ["skinning ile hangi meslek gider", "=skin-genel"], ["skinning eğitmeni nerede", "=skin-genel"],
  ["alchemy 100 ne basayım", "=alch-1-150"], ["alchemy 200", "=alch-150-300"], ["alchemy 1-300 nasıl kasılır", "=alch-1-150,alch-150-300"], ["simya eğitmeni nerede", "=alch-genel"], ["alchemy nasıl kasılır", "^alch-1-150"],
  ["blacksmithing 120", "=bs-1-150"], ["blacksmithing 250 ne yapayım", "=bs-150-300"], ["blacksmithing önemli tarifler", "=bs-tarifler"], ["demircilik eğitmeni nerede", "=bs-genel"], ["blacksmithing nerede kasılır", "^bs-1-150"],
  ["cooking kamp ateşi buffları", "=cook-kamp"], ["hangi yemek stamina veriyor cooking", "=cook-yemek"], ["cooking 100 nerede kasılır", "=cook-1-150"], ["cooking 225 nerede", "=cook-150-300"], ["cooking eğitmeni", "=cook-genel"],
  ["kamp buffları nelerdir", "=cook-kamp"], ["aşçılık 50", "=cook-1-150"],
  ["enchanting 200", "=ench-150-300"], ["enchanting tarifleri", "=ench-tarifler"], ["enchanting nasıl kasılır", "^ench-1-150"], ["enchanting 80 ne basayım", "=ench-1-150"], ["enchanting eğitmeni nerede", "=ench-genel"],
  ["engineering eğitmeni nerede", "=eng-genel"], ["engineering 180", "=eng-150-300"], ["mühendislik nerede kasılır", "^eng-1-150"], ["engineering 60", "=eng-1-150"],
  ["first aid eğitmeni nerede", "=aid-genel"], ["first aid 200", "=aid-150-300"], ["first aid tarifleri", "=aid-tarifler"], ["ilk yardım 100", "=aid-1-150"], ["bandaj hangi kumaştan yapılır", "~aid-"],
  ["leatherworking 230", "=lw-225-300"], ["lw 100", "=lw-1-150"], ["leatherworking 160", "=lw-150-225"], ["leatherworking eğitmeni", "=lw-genel"], ["dericilik nasıl kasılır", "^lw-1-150"],
  ["tailoring 150 den sonra ne dikeyim", "=tail-150-300"], ["terzilik 50", "=tail-1-150"], ["tailoring eğitmeni", "=tail-genel"], ["tailoring 280", "=tail-150-300"], ["tailoring nerede kasılır", "^tail-1-150"],
  ["engineering mi blacksmithing mi", "=eng-genel,bs-genel"], ["herbalism alchemy beraber iyi mi", "=herb-genel,alch-genel"], ["mining ve blacksmithing", "=mining-genel,bs-genel"], ["skinning leatherworking", "=skin-genel,lw-genel"],
  ["para kazanmak için hangi meslek", "advice"], ["warrior için hangi meslek", "advice"], ["dwarf shaman için leveling aşamasında hangi meslekleri önerirsin", "advice=lw-genel"], ["hangi meslekleri seçmeliyim", "advice"],
  // ------------------------------------------------------------
  // Dungeons
  // ------------------------------------------------------------
  ["rfc kaç level", "=zindan-01-ragefire-chasm"], ["ragefire chasm bossları", "=zindan-01-ragefire-chasm"], ["hall of thanes nerede", "=zindan-02-hall-of-thanes"], ["deadmines kaç levelde girilir", "=zindan-03-deadmines"],
  ["dm kaç level", "=zindan-03-deadmines"], ["vancleef nerede", "=zindan-03-deadmines"], ["wailing caverns kaç level", "=zindan-04-wailing-caverns"], ["wc rota", "=zindan-04-wailing-caverns"],
  ["ruins of lordaeron bossları", "=zindan-05-ruins-of-lordaeron"], ["SFK görevleri nerede", "=zindan-06-shadowfang-keep"], ["shadowfang keep kaç boss", "=zindan-06-shadowfang-keep"], ["bfd kaç level", "=zindan-07-blackfathom-deeps"],
  ["stockade görev sayısı", "=zindan-08-stormwind-stockade"], ["stocks kaç level", "=zindan-08-stormwind-stockade"], ["rfk rota", "=zindan-09-razorfen-kraul"], ["razorfen kraul bossları", "=zindan-09-razorfen-kraul"],
  ["excavation site kaç level", "=zindan-10-excavation-site-wetlands"], ["gnomeregan görev sayısı horde", "=zindan-11-gnomeregan"], ["gnomer rota", "=zindan-11-gnomeregan"], ["gnomeregan son boss kim", "=zindan-11-gnomeregan"],
  ["sm graveyard kaç level", "=zindan-12-scarlet-monastery-graveyard"], ["city of dalaran zindanı kaç level", "=zindan-13-city-of-dalaran"], ["sm library bossları", "=zindan-14-scarlet-monastery-library"],
  ["scarlet monastery armory", "=zindan-15-scarlet-monastery-armory"], ["drowned city rota", "=zindan-16-the-drowned-city"], ["rfd kaç level", "=zindan-17-razorfen-downs"], ["sm cathedral rota", "=zindan-18-scarlet-monastery-cathedral"],
  ["krol'dok stronghold bossları", "=zindan-19-krol-dok-stronghold"], ["uldaman kaç boss var", "=zindan-20-uldaman"], ["ulda görevleri", "=zindan-20-uldaman"], ["zf merdiven eventi", "=zindan-21-zulfarrak"],
  ["zul'farrak kaç level", "=zindan-21-zulfarrak"], ["maraudon turuncu kanat", "=zindan-22-maraudon-orange"], ["maraudon mor", "=zindan-23-maraudon-purple"], ["maraudon prenses rotası", "=zindan-25-maraudon-inner"],
  ["alcaz prison kaç level", "=zindan-26-alcaz-prison"], ["brd arena", "^zindan-27-blackrock-depths-lower"], ["sunken temple heykel sırası", "=zindan-28-sunken-temple"], ["st kaç level", "=zindan-28-sunken-temple"],
  ["dire maul east rota", "=zindan-29-dire-maul-east"], ["dme kaç level", "=zindan-29-dire-maul-east"], ["blackmaw hold bossları", "=zindan-30-blackmaw-hold"], ["brd emperor", "^zindan-32-blackrock-depths-upper"],
  ["lbrs kaç boss", "=zindan-33-blackrock-spire-lower"], ["dm west boss", "=zindan-34-dire-maul-west"], ["shaper's terrace kaç boss", "=zindan-35-shapers-terrace"], ["ubrs rota", "=zindan-36-blackrock-spire-upper"],
  ["dire maul north tribute", "=zindan-37-dire-maul-north"], ["stratholme living rota", "=zindan-38-stratholme-living"], ["strat ud kaç level", "=zindan-39-stratholme-undead"], ["baron run stratholme", "=zindan-39-stratholme-undead"],
  ["scholomance kaç boss", "=zindan-40-scholomance"], ["scholo görevleri alliance", "=zindan-40-scholomance"], ["stratholme living mi undead mi önce", "=zindan-38-stratholme-living,zindan-39-stratholme-undead"],
  ["brd kaç level girilir", "~zindan-"], ["maraudon kaç level", "~zindan-2"], ["dire maul hangi kanat önce", "~zindan-"], ["blackrock spire kaç level", "=zindan-33-blackrock-spire-lower,zindan-36-blackrock-spire-upper"],
  ["hangi dungeona gideyim", "dungeons"], ["zindan önerisi", "dungeons"], ["30 level hangi dungeon", "dungeons"], ["45 levelim hangi zindana girebilirim", "dungeons"], ["ilk dungeon hangisi", "dungeons"],
  ["dungeon sırası nedir", "dungeons"],
  // ------------------------------------------------------------
  // Not for the cards
  // ------------------------------------------------------------
  ["onyxia attunement nasıl yapılır", "none"], ["wow forever guild var mı", "none"], ["shame on you", "none"], ["state machine", "none"], ["merhaba nasılsın", "none"], ["sunucu ne zaman açılıyor", "none"],
  ["mount kaç levelde alınır", "none"], ["gold nasıl kasılır", "none"], ["auction house nerede", "none"], ["hearthstone nasıl kullanılır", "none"], ["yardımcı olur musun", "none"], ["kontrol tuşları nasıl ayarlanır", "none"],
  ["blizzard ne zaman açıklama yapacak", "none"], ["battleground ne zaman açılır", "none"], ["warrior class quest nerede", "none"], ["priest eğitmeni nerede", "none"]
);

// The hand-reviewed questions: chatty wording, misspellings, short forms, item names, look-alike words.
{ const known = new Set(CASES.map(([question]) => question)); for (const entry of REVIEWED) if (!known.has(entry[0])) { known.add(entry[0]); CASES.push(entry); } }

test(`question battery: ${CASES.length} questions get the right cards`, () => {
  const failures = [];
  for (const [question, expected] of CASES) { try { check(question, expected); } catch (error) { failures.push(`${expected}  ←  ${error.message.split("\n")[0]}`); } }
  assert.equal(failures.length, 0, `${failures.length}/${CASES.length} wrong:\n${failures.join("\n")}`);
});

test("a question and its alternative are one question", () => {
  assert.equal(w.splitQuestionParts("frost mage oynarken skill trainerda fire veya arcane skillerini almak gerekir mi? yoksa sadece frost skillerini almak mı gerekir?").length, 1);
  assert.equal(w.splitQuestionParts("mage için levelling,dungeon ve pvp için hangi talentleri önerirsin arcane mi frost mu fire mi").length, 1);
  assert.equal(w.splitQuestionParts("deadmines kaç level? fishing nerede kasılır?").length, 2);
});
