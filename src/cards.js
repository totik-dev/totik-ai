// Card knowledge base: picks the guide cards that answer a question.
//
// The 189 cards live in the Discord forum channels (Class / Zindan / Meslek
// rehberleri). src/cards-data.js holds the full text of every card
// (kartlar/metin/*.md); this module only decides WHICH cards fit a question.
// It is pure (no network, no Discord), so tests import it directly.
import { CARDS, CLASS_FACTS, FOREVER_NOTES } from "./cards-data.js";

export { CARDS, CLASS_FACTS };

// ------------------------------------------------------------
// Text helpers
// ------------------------------------------------------------
const TURKISH_SUFFIX = "(?:lar|ler)?(?:imiz|iniz|inin|unun|daki|deki|taki|teki|dan|den|tan|ten|nin|nun|yla|yle|lik|luk|ci|cu|da|de|ta|te|ya|ye|yi|yu|im|um|in|un|la|le|a|e|i|u)?";
const APOSTROPHE_SUFFIX = /^(?:s|lar|ler|imiz|iniz|inin|unun|daki|deki|taki|teki|dan|den|tan|ten|nin|nun|yla|yle|lik|luk|da|de|ta|te|ya|ye|yi|yu|im|um|in|un|la|le|a|e|i|u|ya|ye|li|lu|siz|suz|mi|mu)+$/;

export function normalizeText(value) {
  const flat = String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
    .replace(/[’‘`´]/g, "'").replace(/[→➜►]/g, " ").replace(/[–—]/g, "-").replace(/[^a-z0-9'\s-]/g, " ");
  // "warrior'da" -> "warrior", "zul'farrak" -> "zulfarrak", "hunter's" -> "hunter"
  const joined = flat.includes("'") ? flat.replace(/[^\s']*'[^\s]*/g, word => {
    const at = word.indexOf("'"), head = word.slice(0, at), tail = word.slice(at + 1).replace(/'/g, "");
    return APOSTROPHE_SUFFIX.test(tail) ? head : head + tail;
  }) : flat;
  return joined.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}
const SUFFIX_ONLY = new RegExp(`^${TURKISH_SUFFIX}$`);
// Whole-word match that also accepts common Turkish endings ("warriorda", "fishingi").
// Returns where the term starts in q, or -1.
function termIndex(q, term) {
  const text = ` ${q} `, needle = ` ${term}`;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const start = at + needle.length, tail = text.slice(start, text.indexOf(" ", start));
    if (!tail || term.length >= 4 && SUFFIX_ONLY.test(tail)) return at;
  }
  return -1;
}
function hasTerm(q, term) { return termIndex(q, term) >= 0; }
const hasAny = (q, terms) => terms.some(term => hasTerm(q, term));

const STOP_WORDS = new Set(("ve ile icin bir bu su o de da mi mu mi ne nedir neler nasil hangi hangisi hangileri kac kadar gibi daha en cok az var yok ben sen biz ama veya ya ki olarak olan gore lazim "
  + "yapmaliyim yapmali yapilir yapayim yapsam ediyor eder fark wow forever oyun oyunda soru bana beni bilgi ver verir misin soyle soyler anlat anlatir peki acaba simdi sonra once "
  + "ise yarar yariyor yarayan yapar yapiyor olur oluyor demek the of and to in for is a an").split(" "));
export function tokenize(value) { return normalizeText(value).split(" ").filter(word => word.length >= 2 && !STOP_WORDS.has(word)); }

// ------------------------------------------------------------
// Questions: spelling mistakes and player shorthand
// ------------------------------------------------------------
// Names players misspell ("palladin", "deadmins", "gnomregan"). A word is corrected only when it is not a
// word of any card, starts with the same letter and is one edit away (two for names of nine letters or more).
const TYPO_TARGETS = ("druid hunter paladin priest rogue shaman warlock warrior "
  + "balance restoration marksmanship survival arcane retribution protection discipline shadow assassination combat subtlety elemental enhancement affliction demonology destruction "
  + "alchemy blacksmithing cooking enchanting engineering fishing herbalism leatherworking mining skinning tailoring "
  + "ragefire deadmines wailing shadowfang blackfathom stockade razorfen gnomeregan scarlet monastery uldaman zulfarrak maraudon blackrock sunken stratholme scholomance blackmaw").split(" ");
const TYPO_SKIP = new Set("waiting cooling spinning survive element elements combo combos shadows hunters booking priests".split(" "));
// Optimal string alignment distance (a swapped pair of letters counts as one edit), cut off above max.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i]; let low = i;
    for (let j = 1; j <= b.length; j++) {
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, before[j - 2] + 1);
      row.push(value); low = Math.min(low, value);
    }
    if (low > max) return max + 1;
    before = prev; prev = row;
  }
  return prev[b.length];
}
function fixWord(word) {
  if (word.length < 5 || /\d/.test(word) || TYPO_SKIP.has(word) || STOP_WORDS.has(word)) return word;
  let best = null, tie = false;
  for (const target of TYPO_TARGETS) {
    if (target[0] !== word[0]) continue;
    const max = target.length >= 9 ? 2 : 1;
    // The word may carry a Turkish ending: "palladinde".
    for (let cut = 0; cut <= Math.min(5, word.length - 5); cut++) {
      if (cut && !SUFFIX_ONLY.test(word.slice(word.length - cut))) continue;
      const distance = editDistance(word.slice(0, word.length - cut), target, max);
      if (distance === 0) return word;
      if (distance > max || distance === 2 && cut) continue;
      if (!best || distance < best.distance) { best = { target, distance }; tie = false; }
      else if (distance === best.distance && target !== best.target) tie = true;
    }
  }
  if (!best || tie || kb().frequency.has(word)) return word;
  return best.target;
}
// What players call things that the cards name differently.
const SYNONYMS = [[/(?:^| )(?:lockpicking|lockpick|lock pick|kilit acma)(?= |$)/g, " pick lock"], [/(?:^| )(?:respek|respecc)(?= |$)/g, " respec"], [/(?:^| )fishing pole(?= |$)/g, " olta"],
  [/(?:^| )su (?=(?:nasil |nerden |nereden )?(?:yap(?!ilan)|uret|cikar|olustur)\w*)/g, " conjure water "],
  // Turkish names players give to forms and well-known abilities; the cards carry the English name.
  [/(?:^| )(?:hayalet kurt\w*|kurt (?:hal|form|sekl|kilig)\w*|kurda donus\w*)(?= |$)/g, " ghost wolf"],
  [/(?:^| )ayi (?:hal|form|sekl)\w*(?= |$)/g, " bear form"], [/(?:^| )kedi (?:hal|form|sekl)\w*(?= |$)/g, " cat form"],
  [/(?:^| )(?:seyahat|yolculuk|cita|gezi) (?:hal|form|sekl)\w*(?= |$)/g, " travel form"], [/(?:^| )(?:su|fok|deniz) (?:hal|form|sekl)\w*(?= |$)/g, " aquatic form"],
  [/(?:^| )(?:baykus|moonkin) (?:hal|form|sekl)\w*(?= |$)/g, " moonkin form"],
  [/(?:^| )cita (?:aspect\w*|gorunum\w*)(?= |$)/g, " aspect of the cheetah"], [/(?:^| )suru (?:aspect\w*|gorunum\w*)(?= |$)/g, " aspect of the pack"],
  [/(?:^| )can tas\w*(?= |$)/g, " healthstone"], [/(?:^| )ruh tas\w*(?= |$)/g, " soulstone"],
  [/(?:^| )ol(?:u|um) taklid\w*(?= |$)/g, " feign death"], [/(?:^| )(?:pet|hayvan) evcillestir\w*(?= |$)/g, " tame beast"],
  [/(?:^| )koyun(?:a)? (?:yap|cevir|donustur)\w*(?= |$)/g, " polymorph"],
  // The class mounts: "paladin atı kaç levelde", "warlock bineği".
  [/(?:^| )paladin\w* (?:at|ati|atini|atim|atimi|bineg\w*|binek|mount\w*)(?= |$)/g, "$& summon warhorse"],
  [/(?:^| )(?:warlock\w*|lock) (?:at|ati|atini|atim|atimi|bineg\w*|binek|mount\w*)(?= |$)/g, "$& summon felsteed"]];
// A question as the selector reads it: normalized, with misspelled names corrected.
export function questionText(value) {
  let q = normalizeText(value);
  if (q.length > 4) q = q.split(" ").map(fixWord).join(" ");
  // "şu" (that) and "su" (water) are the same word once the Turkish letters are flattened.
  const thatWord = /(?:^|\s)şu\s/i.test(String(value || ""));
  for (const [pattern, text] of SYNONYMS) if (!(thatWord && text.includes("water"))) q = q.replace(pattern, text);
  return q.trim();
}

// ------------------------------------------------------------
// Index over card texts
// ------------------------------------------------------------
// Built on first use, not when the Worker starts: normalizing every card text takes a few dozen ms.
let knowledge = null;
function kb() {
  if (knowledge) return knowledge;
  const index = CARDS.map(card => {
    const norm = normalizeText(`${card.title}\n${card.text}`);
    return { card, norm: ` ${norm} `, tokens: new Set(norm.split(" ")) };
  });
  const frequency = new Map();
  for (const entry of index) for (const token of entry.tokens) frequency.set(token, (frequency.get(token) || 0) + 1);
  // Words the cards only ever write with a capital letter: names of items, abilities and places ("Dynamite", "Mooncloth").
  const upper = new Set(), lower = new Set();
  for (const card of CARDS) for (const word of card.text.match(/[A-Za-zÇĞİÖŞÜçğıöşü']{6,}/g) || []) (/^[A-ZÇĞİÖŞÜ]/.test(word) ? upper : lower).add(normalizeText(word));
  const proper = new Set([...upper].filter(word => !lower.has(word)));
  knowledge = { index, byId: new Map(index.map(entry => [entry.card.id, entry])), frequency, proper, names: nameOwners(index) };
  return knowledge;
}
const idf = token => Math.log(1 + CARDS.length / (kb().frequency.get(token) || CARDS.length));

// Shorter forms of a word, for Turkish endings written without an apostrophe ("rotasyonu" -> "rotasyon").
function stems(word) { const out = []; for (let cut = word.length - 1; cut >= Math.max(5, word.length - 5); cut--) out.push(word.slice(0, cut)); return out; }
function lexicalScore(entry, words) {
  let score = 0; const seen = new Set();
  for (let i = 0; i < words.length; i++) {
    const word = words[i]; if (seen.has(word)) continue; seen.add(word);
    if (entry.tokens.has(word)) score += idf(word);
    else if (word.length >= 6) {
      // Turkish endings without an apostrophe: "rotasyonu" still matches "rotasyon".
      for (let cut = word.length - 1; cut >= Math.max(5, word.length - 5); cut--) { const stem = word.slice(0, cut); if (entry.tokens.has(stem)) { score += 0.6 * idf(stem); break; } }
    }
    if (i + 1 < words.length && entry.norm.includes(` ${word} ${words[i + 1]} `)) score += 2;
  }
  return score;
}

// ------------------------------------------------------------
// Classes and specs
// ------------------------------------------------------------
export const CLASS_NAMES = { druid: "Druid", hunter: "Hunter", mage: "Mage", paladin: "Paladin", priest: "Priest", rogue: "Rogue", shaman: "Shaman", warlock: "Warlock", warrior: "Warrior" };
const CLASS_ALIASES = {
  druid: ["druid", "dudu"], hunter: ["hunter", "avci"], mage: ["mage", "buyucu"], paladin: ["paladin", "pala"], priest: ["priest", "rahip"],
  rogue: ["rogue", "haydut"], shaman: ["shaman", "sham", "saman"], warlock: ["warlock", "lock"], warrior: ["warrior", "savasci", "war"]
};
// Order matters: the first matching spec wins ("feral tank" before plain "feral").
const SPEC_ALIASES = {
  druid: [["feral-ayi", ["feral tank", "feral ayi", "ayi tank", "bear tank", "bear", "ayi", "tank"]], ["balance", ["balance", "boomkin", "moonkin", "boomie", "balans"]],
    ["restoration", ["restoration", "resto", "healer", "heal", "healing", "sifaci"]], ["feral-kedi", ["feral kedi", "feral dps", "feral combat", "feral", "cat", "kedi"]]],
  hunter: [["beast-mastery", ["beast mastery", "beastmastery", "beast master", "beast", "bm"]], ["marksmanship", ["marksmanship", "marksman", "marks", "mm"]], ["survival", ["survival", "surv", "sv"]]],
  mage: [["arcane", ["arcane"]], ["fire", ["fire", "ates"]], ["frost", ["frost", "buz"]]],
  paladin: [["holy", ["holy", "healer", "heal", "healing", "sifaci"]], ["protection", ["protection", "prot", "tank"]], ["retribution", ["retribution", "retri", "ret", "dps"]]],
  priest: [["discipline", ["discipline", "disc", "disiplin"]], ["holy", ["holy"]], ["shadow", ["shadow", "dps", "golge"]]],
  rogue: [["assassination", ["assassination", "assassin", "assa"]], ["combat", ["combat", "kombat"]], ["subtlety", ["subtlety", "sub"]]],
  shaman: [["elemental", ["elemental", "ele"]], ["enhancement", ["enhancement", "enhance", "enh"]], ["restoration", ["restoration", "resto", "healer", "heal", "healing", "sifaci"]]],
  warlock: [["affliction", ["affliction", "affli", "aff"]], ["demonology", ["demonology", "demo"]], ["destruction", ["destruction", "destro"]]],
  warrior: [["arms", ["arms", "ms"]], ["fury", ["fury"]], ["protection", ["protection", "prot", "tank"]]]
};
export const SPEC_NAMES = {
  "feral-kedi": "Feral (Kedi DPS)", "feral-ayi": "Feral (Ayı Tank)", balance: "Balance", restoration: "Restoration", "beast-mastery": "Beast Mastery", marksmanship: "Marksmanship", survival: "Survival",
  arcane: "Arcane", fire: "Fire", frost: "Frost", holy: "Holy", protection: "Protection", retribution: "Retribution", discipline: "Discipline", shadow: "Shadow",
  assassination: "Assassination", combat: "Combat", subtlety: "Subtlety", elemental: "Elemental", enhancement: "Enhancement", affliction: "Affliction", demonology: "Demonology", destruction: "Destruction", arms: "Arms", fury: "Fury"
};
export function classSpecs(classKey) { return (SPEC_ALIASES[classKey] || []).map(([spec]) => spec).sort((a, b) => specOrder(classKey, a) - specOrder(classKey, b)); }
function specOrder(classKey, spec) { const card = CARDS.find(c => c.classKey === classKey && c.kind === "leveling" && c.spec === spec); return card ? CARDS.indexOf(card) : 999; }

// Names of talents and abilities that occur in exactly one class, so "mortal
// strike ne işe yarar" finds Warrior without the class being named.
function nameOwners(index) {
  const owners = new Map();
  // Only text in a "name position" counts: a whole table cell, a "### Name" heading or a "Name — 2/5" tree line.
  const generic = new Set([...Object.keys(CLASS_NAMES), ...Object.values(SPEC_NAMES).map(normalizeText), "alliance", "horde", "forever", "seviye", "talent", "yetenek", "rozetler", "aciklama"]);
  const isName = value => /^[A-Z][A-Za-z']+(?:[ :-]+[A-Za-z'()]+){0,5}$/.test(value);
  for (const entry of index.filter(item => item.card.category === "class")) {
    const candidates = [];
    for (const line of entry.card.text.split("\n")) {
      if (line.startsWith("|")) candidates.push(...line.split("|").map(cell => cell.trim()));
      // A one-word heading is a section title ("Kontrol", "Formlar"), not an ability.
      else if (/^#{2,4} /.test(line)) { const heading = line.replace(/^#+ /, "").split(" — ")[0].trim(); if (heading.includes(" ")) candidates.push(heading); }
      else if (/ — \d+\/\d+/.test(line)) candidates.push(line.replace(/^[-*\d.\s]+/, "").split(" — ")[0].trim());
    }
    for (const raw of candidates) {
      if (!isName(raw)) continue;
      const name = normalizeText(raw); if (name.length < 6 || generic.has(name) || AMBIGUOUS_NAMES.has(name)) continue;
      if (!owners.has(name)) owners.set(name, { classes: new Set(), cards: new Set(), defs: new Set() });
      owners.get(name).classes.add(entry.card.classKey); owners.get(name).defs.add(entry.card.id);
    }
  }
  // "windfury ne yapar": one distinctive word of a longer name, when every name with that word belongs to one class.
  const words = new Map();
  for (const [name, owner] of owners) for (const word of name.split(" ")) { if (!SHORT_NAMES.has(word)) continue; if (!words.has(word)) words.set(word, new Set()); for (const classKey of owner.classes) words.get(word).add(classKey); }
  for (const [word, classes] of words) if (classes.size === 1 && !owners.has(word)) owners.set(word, { classes, cards: new Set(), defs: new Set() });
  for (const [name, owner] of owners) {
    if (owner.classes.size !== 1) { owners.delete(name); continue; }
    for (const entry of index) if (entry.card.classKey === [...owner.classes][0] && entry.norm.includes(` ${name} `)) owner.cards.add(entry.card.id);
  }
  return owners;
}
// One-word names that are also everyday words or belong to something else (Endurance is a Tauren racial).
const AMBIGUOUS_NAMES = new Set(("battle impact endurance defensive efficiency reflection opportunity preparation intensity kontrol blizzard cataclysm pandemic corruption darkness silence "
  + "aggression initiative inspiration meditation revenge frenzy genesis eclipse aftermath malice cruelty composure conviction redemption inferno "
  + "human dwarf gnome undead tauren troll skyborne night elf high order skyborne windshaper skyborne").split(" ").concat(["night elf", "high order skyborne", "windshaper skyborne"]));
// Short forms players use for longer names ("windfury" for Windfury Weapon / Windfury Totem). Each one is
// accepted only if every card name that contains it belongs to the same class.
const SHORT_NAMES = new Set(("windfury rockbiter flametongue frostbrand stoneskin earthbind stoneclaw maelstrom totemic voidwalker succubus incubus felhunter infernal healthstone soulstone "
  + "firestone spellstone felsteed dreadsteed kilrogg mongoose scorpid cheetah trueshot bestial frostfire conjure vampiric shackle devouring sinister adrenaline moonkin warhorse crusader "
  + "templar brimstone polymorph hamstring sweeping bloodthirst stormstrike riptide swiftmend penance mutilate hemorrhage").split(" "));
// Looks up every 1–6 word window of the question; the last word may carry a Turkish ending ("mortal strikei").
function namedInQuestion(q) {
  const names = kb().names, words = q.split(" "), hits = new Map();
  for (let i = 0; i < words.length; i++) {
    for (let n = Math.min(6, words.length - i); n >= 1; n--) {
      const head = n > 1 ? `${words.slice(i, i + n - 1).join(" ")} ` : "", last = words[i + n - 1];
      for (let cut = 0; cut <= Math.min(9, last.length - 1); cut++) {
        if (cut && !SUFFIX_ONLY.test(last.slice(last.length - cut))) continue;
        const name = head + last.slice(0, last.length - cut), owner = names.get(name);
        if (owner && !hits.has(name)) hits.set(name, { name, classKey: [...owner.classes][0], cards: owner.cards, defs: owner.defs });
      }
    }
  }
  return [...hits.values()].sort((a, b) => b.name.length - a.name.length);
}

export function detectClass(question) {
  const q = questionText(question); let best = null, bestAt = -1;
  for (const [classKey, aliases] of Object.entries(CLASS_ALIASES)) {
    for (const alias of aliases) {
      if (alias === "war" && !/(?:^| )war(?= |$)/.test(q) || alias === "lock" && /(?:^| )pick lock/.test(q)) continue;
      if (!hasTerm(q, alias)) continue;
      const at = q.lastIndexOf(alias); if (at > bestAt) { best = classKey; bestAt = at; }
    }
  }
  if (best) return best;
  const named = namedInQuestion(q), classes = new Set(named.map(hit => hit.classKey));
  return classes.size === 1 ? named[0].classKey : classFromSpecs(q);
}
// Every class the question names, in the order they appear: [{ classKey, at, end }].
export function detectClasses(question) {
  const q = questionText(question), hits = new Map();
  for (const [classKey, aliases] of Object.entries(CLASS_ALIASES)) {
    for (const alias of aliases) {
      if (alias === "war" && !/(?:^| )war(?= |$)/.test(q) || alias === "lock" && /(?:^| )pick lock/.test(q)) continue;
      const at = termIndex(q, alias); if (at >= 0 && (!hits.has(classKey) || at < hits.get(classKey).at)) hits.set(classKey, { classKey, at, end: at + alias.length });
    }
  }
  return [...hits.values()].sort((a, b) => a.at - b.at);
}
// Every spec the question names, in the order they appear: [{ spec, at, end }].
// A longer alias hides a shorter one inside it: "feral tank" is not also "feral".
export function detectSpecs(question, classKey) {
  const q = questionText(question), found = [];
  for (const [spec, aliases] of SPEC_ALIASES[classKey] || []) for (const alias of aliases) { const at = termIndex(q, alias); if (at >= 0) found.push({ spec, alias, at, end: at + alias.length }); }
  found.sort((a, b) => b.alias.length - a.alias.length || a.at - b.at);
  const kept = [];
  for (const hit of found) if (!kept.some(other => hit.at < other.end && hit.end > other.at)) kept.push(hit);
  const bySpec = new Map();
  for (const hit of kept.sort((a, b) => a.at - b.at)) if (!bySpec.has(hit.spec)) bySpec.set(hit.spec, hit);
  // "feral druid tank": the bare word "feral" belongs to the tank build that is named next to it.
  if (bySpec.has("feral-ayi") && bySpec.get("feral-kedi")?.alias === "feral") bySpec.delete("feral-kedi");
  return [...bySpec.values()];
}
// The spec the question is about when several are named: the one next to the class name
// ("frost mage ... fire büyüleri"), otherwise the first one.
function primarySpec(q, classKey, hits) {
  if (hits.length < 2) return hits[0]?.spec || null;
  for (const hit of hits) {
    const before = q.slice(0, hit.at).trim().split(" ").pop() || "", after = q.slice(hit.end).split(" ")[1] || "";
    if (CLASS_ALIASES[classKey].some(alias => hasTerm(before, alias) || hasTerm(after, alias))) return hit.spec;
  }
  return hits[0].spec;
}
// "fury mi arms mı", "destro leveling build": spec names that belong to a single class name the class.
function classFromSpecs(q) {
  const matches = [];
  for (const classKey of Object.keys(SPEC_ALIASES)) {
    // A short form alone is too weak ("bm", "ele"); two of the same class are not ("bm mi mm mi").
    const all = detectSpecs(q, classKey).filter(hit => !ROLE_ALIASES.has(hit.alias)), hits = all.length >= 2 ? all : all.filter(hit => hit.alias.length >= 4);
    if (hits.length) matches.push({ classKey, hits });
  }
  if (!matches.length) return null;
  const most = Math.max(...matches.map(match => match.hits.length)), best = matches.filter(match => match.hits.length === most);
  if (best.length !== 1) return null;
  // One spec name alone is too weak ("frost resistance", "fire damage"): it needs a talent or build word next to it.
  if (most < 2 && !(INTENT.leveling.test(q) || INTENT.talents.test(q) || INTENT.gameplay.test(q))) return null;
  return best[0].classKey;
}
const ROLE_ALIASES = new Set(["tank", "healer", "heal", "healing", "sifaci", "dps"]);

// Role, strengths and weaknesses of a spec (kartlar/sinif-bilgi.json). "Feral" covers both Druid Feral builds.
export function specFacts(classKey, spec) {
  const name = normalizeText(SPEC_NAMES[spec] || "");
  return (CLASS_FACTS.siniflar[classKey]?.uzmanliklar || []).find(item => { const ad = normalizeText(item.ad); return name === ad || name.startsWith(`${ad} `); }) || null;
}
function specFactText(classKey, spec) {
  const facts = specFacts(classKey, spec); if (!facts) return "";
  return `${CLASS_NAMES[classKey]} ${SPEC_NAMES[spec]} (rol: ${specRole(classKey, spec)})\n  Güçlü yanları: ${facts.arti.join(" · ")}\n  Zayıf yanları: ${facts.eksi.join(" · ")}`;
}
function classOverviewLine(classKey) {
  const entry = CLASS_FACTS.genel.find(item => item.sinif === classKey); if (!entry) return "";
  return `${entry.ad}: ${entry.not} Uzmanlıklar: ${entry.roller.map(([name, role]) => `${name} (${role})`).join(", ")}.`;
}
// What each class wears and wields: "Hunter: zırh 40. seviyeye kadar leather, 40. seviyeden sonra mail; silah …".
export function gearRule(classKey = null) {
  const keys = classKey ? [classKey] : Object.keys(CLASS_NAMES);
  return keys.map(key => `${CLASS_NAMES[key]}: zırh ${CLASS_FACTS.siniflar[key].zirh}; silah: ${CLASS_FACTS.siniflar[key].silah}`).join(".\n") + ".";
}
function raceAdviceText(classKey) {
  const facts = CLASS_FACTS.siniflar[classKey]; if (!facts) return "";
  const picks = Object.entries(facts.irkOneri || {}).map(([race, specs]) => `${race}: ${specs.join(", ")}`).join(" · ");
  return `${classRaceLine(classKey)}${picks ? `\nIrka göre öne çıkan uzmanlıklar: ${picks}.` : ""}`;
}
// "Shaman olabilen ırklar: Alliance'ta Dwarf; Horde'da Orc, Tauren, Troll, Windshaper Skyborne."
export function classRaceLine(classKey) {
  const races = CLASS_FACTS.siniflar[classKey].irklar;
  const sides = Object.entries(CLASS_FACTS.taraflar).map(([side, list]) => { const own = races.filter(race => list.includes(race)); return own.length ? `${side}'ta ${own.join(", ")}`.replace("Horde'ta", "Horde'da") : `${side} tarafında yok`; });
  return `${CLASS_NAMES[classKey]} olabilen ırklar: ${sides.join("; ")}.`;
}
// The WoW Forever rules that differ from WoW Classic, built from the verified class data. Sent with every AI call.
function factionRaces() { return Object.entries(CLASS_FACTS.taraflar).map(([side, list]) => `${side} ırkları: ${list.join(", ")}.`).join(" "); }
// Classes that Classic gave to one side only and Forever gives to both.
function openedClasses() {
  const sideOf = race => Object.entries(CLASS_FACTS.taraflar).find(([, list]) => list.includes(race))?.[0];
  return Object.entries({ shaman: "Horde", paladin: "Alliance" }).map(([key, classicSide]) => {
    const other = CLASS_FACTS.siniflar[key].irklar.filter(race => sideOf(race) !== classicSide);
    return other.length ? `${CLASS_NAMES[key]} Classic'te yalnız ${classicSide} sınıfıydı; Forever'da ${sideOf(other[0])} tarafında da vardır (${other.join(", ")})` : "";
  }).filter(Boolean);
}
// The research backend knows WoW Classic and receives only the question: the Forever rules the question
// touches travel with it ("Shaman olabilen ırklar: Alliance'ta Dwarf; …").
export function foreverHint(classKey = null, notes = []) {
  return ["WoW Forever notu (WoW Classic'ten farklıdır, cevap buna uymalı):",
    classKey && CLASS_FACTS.siniflar[classKey] ? classRaceLine(classKey) : `${openedClasses().join(". ")}.`,
    ...(notes || []).filter(note => note.ozet).map(note => note.ozet),
    "\"Classic'te yok\", \"Burning Crusade'de açıldı\" gibi başka sürüm bilgisi yazma."].join(" ");
}
export function foreverRules() {
  const opened = openedClasses();
  return [
    "WoW Forever kuralları (WoW Classic'ten farklıdır; çelişen Classic, Burning Crusade ya da Retail bilgisi yerine bunlar geçerlidir):",
    factionRaces(),
    ...Object.keys(CLASS_NAMES).map(classRaceLine),
    opened.length ? `${opened.join(". ")}. "Alliance'ta Shaman yok", "Horde'da Paladin yok", "bu sınıf Burning Crusade'de açıldı" gibi cümleler Forever için yanlıştır.` : "",
    "Skyborne Forever'la gelen yeni ırktır. En yüksek seviye 60'tır, uçan binek yoktur.",
    // One sentence per Forever note that the model must never contradict (the full note is sent when the question touches it).
    ...FOREVER_NOTES.filter(note => note.ozet).map(note => note.ozet)
  ].filter(Boolean).join("\n");
}
// Sentences that state a Classic rule which is wrong in Forever: another expansion as the reason,
// or a class denied to a side or race that can play it. Trainer and quest sentences are left alone.
const OTHER_VERSION = /burning crusade|(?:^| )tbc(?= |$)|lich king|(?:^| )wotlk(?= |$)|cataclysm|pandaria|draenor|shadowlands|dragonflight|(?:klasik|classic|vanilla) donem\w*/;
const DENIED = /(?:^| )(?:yok\w*|secemez\w*|secilemez\w*|olamaz\w*|oynayamaz\w*|oynanamaz\w*|bulunmaz\w*|bulunmamakta\w*|acilmis\w*|acilmadi\w*|mevcut degil\w*)(?= |$)/;
export function foreverContradictions(text) {
  const out = [];
  for (const sentence of String(text || "").split(/(?<=[.!?])\s+|\n+/)) {
    const norm = normalizeText(sentence); if (!norm) continue;
    // "Mind Sear Lich King'le geldi, Forever'da yok" names the other version to set Forever apart: left alone.
    let wrong = OTHER_VERSION.test(norm) && !/(?:^| )forever\w*(?= |$)/.test(norm);
    if (!wrong && !/(?:^| )(?:egitmen\w*|egitici\w*|trainer\w*|npc\w*|gorev\w*|quest\w*)(?= |$)/.test(norm)) {
      for (const key of Object.keys(CLASS_NAMES)) {
        if (!new RegExp(`(?:^| )${key}\\w*(?= |$)`).test(norm)) continue;
        const races = CLASS_FACTS.siniflar[key].irklar, sides = Object.entries(CLASS_FACTS.taraflar).filter(([, list]) => races.some(race => list.includes(race))).map(([side]) => side.toLowerCase());
        const only = norm.match(/(?:^| )(?:sadece|yalnizca|yalniz) (?:\w+ ){0,2}?(alliance|horde)/);
        if (only && sides.some(side => side !== only[1])) wrong = true;
        // "Alliance'ta Human Shaman olamaz" is true: the sentence denies a race that really cannot be the class.
        const others = Object.values(CLASS_FACTS.taraflar).flat().filter(race => !races.includes(race)).some(race => new RegExp(`(?:^| )${normalizeText(race)}\\w*(?= |$)`).test(norm));
        if (DENIED.test(norm) && !others && (sides.some(side => new RegExp(`(?:^| )${side}\\w*(?= |$)`).test(norm)) || races.some(race => norm.includes(normalizeText(race))))) wrong = true;
      }
    }
    if (wrong) out.push(sentence.trim());
  }
  return out;
}
export function stripForeverContradictions(text) {
  const bad = new Set(foreverContradictions(text)); if (!bad.size) return String(text || "");
  return String(text || "").split("\n").map(line => line.split(/(?<=[.!?])\s+/).filter(part => !bad.has(part.trim())).join(" ")).filter(line => line.trim()).join("\n").trim();
}
// The Forever notes a question touches: "stormwindden darnassusa nasıl giderim" → the travel note.
let noteIndex = null;
function noteHits(question) {
  const q = normalizeText(question); if (!q) return [];
  noteIndex ||= FOREVER_NOTES.map(note => ({ note, keys: note.anahtar.map(key => key.split("+").map(part => { const text = normalizeText(part); return new RegExp(`(?:^| )${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${text.length <= 3 ? "" : "\\w*"}(?= |$)`); })) }));
  return noteIndex.map(({ note, keys }) => { const hit = keys.filter(parts => parts.every(part => part.test(q))); return { note, score: hit.length, specific: hit.some(parts => parts.length > 1) }; }).filter(hit => hit.score > 0).sort((a, b) => b.specific - a.specific || b.score - a.score);
}
export function foreverNotes(question, limit = 2) { return noteHits(question).slice(0, limit).map(hit => hit.note); }
// A key that joins two words ("shaman+trainer", "enhancement+dual") names the note's own subject:
// such a question is answered from the note even when a card of the class was picked.
export function isForeverNoteSubject(question) { return noteHits(question).some(hit => hit.specific); }
export function foreverNoteText(notes) { return notes.map(note => `## ${note.baslik}\n${note.satirlar.map(line => `- ${line}`).join("\n")}`).join("\n\n"); }
// Does the note hold everything the question asks about? "binek ile kurt hali arasında hız farkı" names a thing
// (kurt hali) the mount note never mentions: the note alone cannot answer it.
const GENERIC_WORD = new Set(("karakter karakterler karakterim level lvl lv seviye seviyede seviyesi hiz hizi hizli fark farki farkli arasinda arasindaki ayni kadar tane sinif sinifi irk irki "
  + "oyuncu oyuncular nedir neler nerede nerde nereden nerden zaman simdi yeni eski tam olarak peki acaba lutfen hocam abi kanka arkadaslar merhaba selam "
  + "normal alliance horde ally hord tarafi tarafinda taraf bilgi hakkinda ilgili gerekli gerekiyor lazim mumkun sekilde iyi kotu guzel hangisi hangi kacta kacinci").split(" "));
const softened = stem => stem.replace(/p$/, "b").replace(/t$/, "d").replace(/k$/, "g");
function uncoveredWords(question, text) {
  const words = normalizeText(text).split(" "), classWords = new Set([...Object.keys(CLASS_NAMES), ...Object.values(CLASS_ALIASES).flat(), ...Object.values(CLASS_FACTS.taraflar).flat().flatMap(race => normalizeText(race).split(" "))]);
  return questionText(question).split(" ").filter(word => word.length >= 4 && !/\d/.test(word) && !STOP_WORDS.has(word) && !GENERIC_WORD.has(word) && !COMMON_VERB.test(word) && !classWords.has(word))
    .filter(word => { const stem = word.slice(0, Math.max(4, word.length - 3)); return !words.some(other => other.startsWith(stem) || other.startsWith(softened(stem))); });
}
const COMPARISON = /(?:^| )(?:fark\w*|arasinda\w*|karsilastir\w*|kiyasla\w*|hangisi|ayni mi|esit mi|daha (?:hizli|iyi|guclu|yavas|cok|az))(?= |$)|(?:^| )m[iu] .+ m[iu](?= |$)/;
export function isComparisonQuestion(question) { return COMPARISON.test(questionText(question)); }
// A comparison needs both of its sides in the notes; any other question is left to the model's reading of the note.
export function notesCoverQuestion(question, notes) {
  if (!isComparisonQuestion(question)) return true;
  return uncoveredWords(question, notes.map(note => `${note.baslik} ${note.anahtar.join(" ").replace(/\+/g, " ")} ${note.satirlar.join(" ")}`).join(" ")).length === 0;
}
// Numbers with a meaning (percent, level, gold, seconds, people …) that the answer states but no source holds.
// "ikisi de %70 hız verir" when the sources say %40 and %60.
const UNIT = "seviye\\w*|level\\w*|lvl|lv|gold|altin\\w*|silver|gumus\\w*|saniye\\w*|sn|dakika\\w*|dk|saat\\w*|metre\\w*|yard\\w*|kisi\\w*|puan\\w*|skill\\w*|rank\\w*|kitap\\w*|hedef\\w*|dusman\\w*|dolar\\w*|euro|tl";
const NUMBER_CLAIM = new RegExp(`%\\s?(\\d+(?:[.,]\\d+)?)|(\\d+(?:[.,]\\d+)?)\\s?%|(\\d+(?:[.,]\\d+)?)\\.? ?(?:${UNIT})(?= |$|[.,;:!?)])|(?:${UNIT}) (\\d+)|(\\d{2,}(?:[.,]\\d+)?)`, "g");
export function unsupportedNumbers(answer, ...sources) {
  const flat = value => String(value || "").toLowerCase().replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").replace(/İ/g, "i");
  // "1.000 gold" and "1000 gold" are one number; "29,99" and "29.99" are one number.
  const plain = n => /^\d{1,3}[.,]\d{3}$/.test(n) ? n.replace(/[.,]/, "") : n.replace(",", ".");
  const known = new Set((flat(sources.join("\n")).match(/\d+(?:[.,]\d+)?/g) || []).map(plain));
  const out = new Set();
  for (const match of flat(answer).matchAll(NUMBER_CLAIM)) { const n = plain(match[1] || match[2] || match[3] || match[4] || match[5]); if (!known.has(n)) out.add(n); }
  return [...out];
}
// Without the model: the lines of the notes that share the most words with the question.
export function localNoteAnswer(notes, question) {
  const stems = [...new Set(normalizeText(question).split(" ").filter(word => word.length >= 4 && !STOP_WORDS.has(word)).map(word => word.slice(0, Math.max(4, word.length - 2))))];
  const lines = notes.flatMap(note => note.satirlar).map((text, order) => { const words = normalizeText(text).split(" "); return { text, order, score: stems.filter(stem => words.some(word => word.startsWith(stem))).length }; });
  const top = Math.max(...lines.map(line => line.score));
  // No line shares a word with the question: the note is about something else, and nothing is better than a wrong line.
  return top > 0 ? lines.filter(line => line.score === top).slice(0, 2).map(line => line.text).join("\n") : "";
}

export function detectSpec(question, classKey) {
  const q = questionText(question);
  const hits = detectSpecs(q, classKey); if (hits.length) return primarySpec(q, classKey, hits);
  // A talent name that occurs in the cards of a single spec.
  for (const hit of namedInQuestion(q)) {
    if (hit.classKey !== classKey) continue;
    const specs = new Set([...hit.cards].map(id => kb().byId.get(id).card.spec).filter(Boolean));
    if (specs.size === 1) return [...specs][0];
  }
  return null;
}
export function detectFaction(question) {
  const q = questionText(question);
  const alliance = hasAny(q, ["alliance", "ally", "alli", "human", "dwarf", "night elf", "nelf", "gnome", "high order"]), horde = hasAny(q, ["horde", "hord", "orc", "undead", "tauren", "troll", "windshaper"]);
  return alliance === horde ? null : alliance ? "alliance" : "horde";
}

// ------------------------------------------------------------
// Professions
// ------------------------------------------------------------
// strong: names the profession on its own. weak: only counts when no class is named.
const PROFESSIONS = {
  "first-aid": { name: "First Aid", strong: ["first aid", "firstaid", "ilk yardim", "bandaj", "bandage"], weak: [] },
  alchemy: { name: "Alchemy", strong: ["alchemy", "alchemist", "alch", "simya", "simyaci"], weak: ["iksir", "potion", "flask", "elixir"] },
  blacksmithing: { name: "Blacksmithing", strong: ["blacksmithing", "blacksmith", "demircilik", "demirci"], weak: [] },
  cooking: { name: "Cooking", strong: ["cooking", "ascilik", "asci", "yemek yapma", "yemek pisirme"], weak: ["cook", "yemek", "well fed", "kamp", "camp", "camping", "kamp atesi", "cadir"] },
  enchanting: { name: "Enchanting", strong: ["enchanting", "enchanter", "disenchant", "buyuleme"], weak: ["enchant", "ench"] },
  engineering: { name: "Engineering", strong: ["engineering", "engineer", "muhendislik", "muhendis"], weak: ["eng"] },
  fishing: { name: "Fishing", strong: ["fishing", "balikcilik", "balik tutma", "balik tut", "balik avlama", "olta"], weak: ["balik", "fish"] },
  herbalism: { name: "Herbalism", strong: ["herbalism", "herbalist", "herb", "bitki toplama", "ot toplama", "bitkicilik"], weak: ["bitki", "cicek"] },
  leatherworking: { name: "Leatherworking", strong: ["leatherworking", "leatherworker", "deri isleme", "dericilik", "lw"], weak: [] },
  mining: { name: "Mining", strong: ["mining", "madencilik", "miner", "maden kazma"], weak: ["maden", "cevher", "ore"] },
  skinning: { name: "Skinning", strong: ["skinning", "skinner", "deri yuzme", "deri toplama", "yuzuculuk"], weak: ["skin", "deri"] },
  tailoring: { name: "Tailoring", strong: ["tailoring", "tailor", "terzilik", "terzi"], weak: ["kumas", "canta"] }
};
const RISKY_ALIASES = new Set(["eng", "skin", "fish", "ore", "cook", "ench"]);
export const PROFESSION_NAMES = Object.fromEntries(Object.entries(PROFESSIONS).map(([key, value]) => [key, value.name]));
const PROFESSION_WORD = /(?:^| )(?:meslek|meslekler|meslegi|meslekleri|profession|professions|prof)(?= |$)/;
// Every profession the question names, in the order they appear. Weak words count only when no strong one is found.
export function detectProfessions(question, { allowWeak = true } = {}) {
  const q = questionText(question);
  const scan = kind => {
    const hits = new Map();
    for (const [key, entry] of Object.entries(PROFESSIONS)) for (const alias of entry[kind]) { const at = termIndex(q, alias); if (at >= 0 && (!hits.has(key) || at < hits.get(key))) hits.set(key, at); }
    return [...hits].sort((a, b) => a[1] - b[1]).map(([key]) => key);
  };
  const strong = scan("strong");
  if (strong.length || !allowWeak) return strong;
  // "eng", "skin", "fish", "ore" are also everyday words: they need a skill number or a profession word next to them.
  const context = /\d/.test(q) || PROFESSION_WORD.test(q) || Object.values(PROFESSION_INTENT).some(regex => regex.test(q));
  return scan("weak").filter(key => context || PROFESSIONS[key].weak.some(alias => !RISKY_ALIASES.has(alias) && hasTerm(q, alias))).slice(-1);
}
export function detectProfession(question, options) { return detectProfessions(question, options).pop() || null; }

// ------------------------------------------------------------
// Dungeons
// ------------------------------------------------------------
// names: say the dungeon on their own. weak: need a dungeon word next to them ("st zindanı").
// wings: extra words that pick one card of a multi-card dungeon.
const DUNGEON_GROUPS = [
  { names: ["ragefire chasm", "ragefire", "rfc"], cards: { "ragefire-chasm": [] } },
  { names: ["hall of thanes", "thanes", "infurnus"], weak: ["hot"], cards: { "hall-of-thanes": [] } },
  { names: ["deadmines", "dead mines", "deadmine", "vancleef", "van cleef", "vc"], weak: ["dm"], cards: { deadmines: [] } },
  { names: ["wailing caverns", "wailing cavern", "wailing"], weak: ["wc"], cards: { "wailing-caverns": [] } },
  { names: ["ruins of lordaeron"], weak: ["lordaeron"], cards: { "ruins-of-lordaeron": [] } },
  { names: ["shadowfang keep", "shadowfang", "sfk"], cards: { "shadowfang-keep": [] } },
  { names: ["blackfathom deeps", "blackfathom", "bfd"], cards: { "blackfathom-deeps": [] } },
  { names: ["stormwind stockade", "stockade", "stockades", "stocks"], cards: { "stormwind-stockade": [] } },
  { names: ["razorfen kraul", "kraul", "rfk"], cards: { "razorfen-kraul": [] } },
  { names: ["razorfen downs", "rfd"], cards: { "razorfen-downs": [] } },
  { names: ["razorfen"], cards: { "razorfen-kraul": [], "razorfen-downs": [] } },
  { names: ["excavation site", "excavation"], cards: { "excavation-site-wetlands": [] } },
  { names: ["gnomeregan", "gnomer"], cards: { gnomeregan: [] } },
  { names: ["scarlet monastery", "scarlet", "monastery"], weak: ["sm"], cards: { "scarlet-monastery-graveyard": ["graveyard", "gy", "mezarlik"], "scarlet-monastery-library": ["library", "lib", "kutuphane"], "scarlet-monastery-armory": ["armory", "armoury", "arm", "cephanelik"], "scarlet-monastery-cathedral": ["cathedral", "cath", "katedral"] } },
  // Dalaran is also a city in Forever: "teleport dalaran", "dalaran portalı", "dalaran şehri" are not the dungeon.
  { names: ["city of dalaran"], weak: ["dalaran"], notWeak: /(?:^| )(?:teleport|portal|isinla|sehir|sehr)\w*/, cards: { "city-of-dalaran": [] } },
  { names: ["drowned city", "drowned"], cards: { "the-drowned-city": [] } },
  { names: ["kroldok stronghold", "krol dok", "kroldok"], cards: { "krol-dok-stronghold": [] } },
  { names: ["uldaman", "ulda"], cards: { uldaman: [] } },
  { names: ["zulfarrak", "zul farrak", "zf"], cards: { zulfarrak: [] } },
  { names: ["maraudon", "mara"], cards: { "maraudon-orange": ["orange", "turuncu"], "maraudon-purple": ["purple", "mor"], maraudon: ["tam", "full", "hepsi", "tamami"], "maraudon-inner": ["inner", "prenses", "princess", "ic bolum", "theradras"] } },
  { names: ["alcaz prison", "alcaz"], cards: { "alcaz-prison": [] } },
  { names: ["blackrock depths", "brd"], cards: { "blackrock-depths-lower": ["alt", "lower", "detention", "detention block", "prison", "arena"], "blackrock-depths": ["tam", "full", "hepsi", "tamami"], "blackrock-depths-upper": ["ust", "upper", "upper city", "emperor", "imparator"] } },
  { names: ["sunken temple", "temple of atal hakkar", "atalhakkar", "atal hakkar"], weak: ["st"], cards: { "sunken-temple": [] } },
  { names: ["dire maul", "diremaul", "dme", "dmw", "dmn", "tribute run", "tribute"], weak: ["dm"], cards: { "dire-maul-east": ["east", "dogu", "dme"], "dire-maul-west": ["west", "bati", "dmw"], "dire-maul-north": ["north", "kuzey", "dmn", "tribute"] } },
  { names: ["blackmaw hold", "blackmaw"], cards: { "blackmaw-hold": [] } },
  { names: ["lower blackrock spire", "lbrs"], cards: { "blackrock-spire-lower": [] } },
  { names: ["upper blackrock spire", "ubrs"], cards: { "blackrock-spire-upper": [] } },
  { names: ["blackrock spire"], cards: { "blackrock-spire-lower": [], "blackrock-spire-upper": [] } },
  { names: ["shapers terrace", "shaper terrace", "shaper"], cards: { "shapers-terrace": [] } },
  { names: ["stratholme", "strat"], cards: { "stratholme-living": ["living", "live", "canli", "scarlet"], "stratholme-undead": ["undead", "ud", "olu", "baron"] } },
  { names: ["scholomance", "scholo"], cards: { scholomance: [] } }
];
const DUNGEON_WORD = /(?:^| )(?:dungeon|dungon|dangeon|dungen|zindan|instance)\w*|(?:^| )(?:dung|ins)(?= |$)/;
const DUNGEON_CONTEXT = /(?:^| )(?:kac (?:level|lvl|seviye)|dungeon|dungon|dangeon|dungen|zindan|instance|rota|boss|gorev|quest|giril|girer|girebil|girelim|run)\w*/;
const DUNGEON_CARDS = new Map(CARDS.filter(card => card.category === "dungeon").map(card => [card.dungeon, card]));
export function isDungeonWord(question) { return DUNGEON_WORD.test(questionText(question)); }

function levelInQuestion(q) {
  const match = q.match(/(?:^| )(\d{1,2}) ?(?:level|lvl|lv|seviye)\w*|(?:level|lvl|lv|seviye)\w* (\d{1,2})(?= |$)/);
  const level = match ? Number(match[1] || match[2]) : null;
  return level >= 1 && level <= 60 ? level : null;
}
function findDungeonGroup(q) {
  const context = DUNGEON_CONTEXT.test(q), level = levelInQuestion(q), hits = [];
  for (const group of DUNGEON_GROUPS) {
    const strong = group.names.find(name => hasTerm(q, name)), weak = !strong && context && !group.notWeak?.test(q) && (group.weak || []).find(name => hasTerm(q, name));
    if (strong || weak) hits.push({ group, length: (strong || weak).length, weak: !strong });
  }
  if (!hits.length) return null;
  // "dm": Deadmines for low levels, Dire Maul when a wing or a high level is named.
  const dm = hits.filter(hit => hit.weak && (hit.group.weak || []).includes("dm"));
  if (dm.length === 2 && hits.length === 2) {
    const direMaul = dm.find(hit => "dire-maul-east" in hit.group.cards), wing = Object.values(direMaul.group.cards).flat().some(word => hasTerm(q, word));
    return wing || level >= 50 ? direMaul.group : dm.find(hit => hit !== direMaul).group;
  }
  return hits.sort((a, b) => Number(a.weak) - Number(b.weak) || b.length - a.length)[0].group;
}

// ------------------------------------------------------------
// Selection
// ------------------------------------------------------------
const INTENT = {
  race: /(?:^| )(?:irk\w*|race|racial\w*|human|dwarf|night elf|nelf|gnome|orc|undead|tauren|troll|skyborne|high order|windshaper)(?= |$)/,
  leveling: /(?:^| )(?:leveling|levelling|levling|lvling|levelin|level atla\w*|level kas\w*|kasarken|kasma\w*|build\w*|puan sira\w*|talent sira\w*|dagilim\w*|dagitim\w*|dizilim\w*)(?= |$)/,
  talents: /(?:^| )(?:talent|telent|talant|tallent|tlnt)\w*|yetenek (?:agac|puan)\w*/,
  gameplay: /(?:^| )(?:rotasyon\w*|rotation\w*|oynanis\w*|nasil oynan\w*|onceli[kg]\w*|priority|opener|burst|aoe|cok hedef\w*|tek hedef\w*|hangi sira\w*)(?= |$)|sirayla kullan|ne zaman (?:kullan|at|bas|vur)\w*/,
  abilities: /(?:^| )(?:yetene[kg]\w*|skill\w*|spell\w*|buyu\w*|ability|abilities|form\w*|totem\w*|pet\w*|aura\w*|seal\w*|blessing\w*|curse\w*|stance\w*|durus\w*|buff\w*|debuff\w*|shout\w*|trap\w*|tuza[kg]\w*|poison\w*|zehir\w*|ogren\w*|aciliyor|acilir)(?= |$)/
};
const PROFESSION_INTENT = {
  where: /(?:^| )(?:nerede|nerde|nereden|nerden|nereye|kasil\w*|kasma\w*|kasar\w*|kasayim|kasmak|kasmali\w*|rota\w*|bolge\w*|gelistir\w*|yukselt\w*|ilerlet\w*|level\w*|lvl|skill\w*|basla\w*|topla\w*|tutul\w*|tutma\w*|farm\w*)(?= |$)/,
  recipe: /(?:^| )(?:tarif\w*|recipe\w*|pattern\w*|plan\w*|formula\w*|schematic\w*|uret\w*|craft\w*|hangi item\w*|onemli)(?= |$)/,
  food: /(?:^| )(?:yemek\w*|food|buff\w*|well fed)(?= |$)/,
  camp: /(?:^| )(?:kamp\w*|camp\w*|cadir\w*|ates\w*|campfire)(?= |$)/,
  trainer: /(?:^| )(?:egitmen\w*|trainer\w*|hoca\w*|rutbe\w*|artisan|expert|journeyman|apprentice)(?= |$)/,
  general: /(?:^| )(?:egitmen\w*|trainer\w*|ogren\w*|nedir|ne ise yara\w*|genel|mantikli|deger\w*|rutbe\w*|artisan|expert|journeyman|apprentice|uzmanli[kg]\w*|nasil baslar\w*|nasil baslan\w*)(?= |$)/
};

// "alan vuran skill", "aoe büyüsü": the cards describe these as "yakındaki düşmanlar", "10 metre içindeki", "yayılır".
const AOE_QUESTION = /(?:^| )(?:aoe|area|alan (?:vuran|hasar\w*|etkili|etkisi|buyu\w*|skil\w*|yetene\w*|saldiri\w*)|alana (?:vuran|hasar\w*)|toplu (?:vuran|hasar\w*)|cok(?:lu)? hedef\w*)(?= |$)/;
const AOE_LINE = /(?:yakindaki|yakinindaki|cevre\w*|etraf\w*|alandaki|tum|butun) (?:\w+ ){0,3}(?:dusman|hedef)|metre icindeki (?:\w+ ){0,2}(?:dusman|hedef)|dusmanlara (?:\w+ ){0,3}hasar|(?:^| )alan\w* (?:\w+ ){0,4}hasar|(?:rozet\w*|etiket\w*) alan|yan\w*daki (?:\w+ )?dusman|cevre\w* (?:\w+ ){0,2}hasar|(?:^| )(?:yayilir|sicrar|ziplar|aoe)(?= |$)|(?:^| )[2-9] (?:hedef|dusman)\w*/;
function rank(entries, words, prior) {
  return entries.map(entry => ({ entry, score: lexicalScore(entry, words) + prior(entry.card) })).sort((a, b) => b.score - a.score || CARDS.indexOf(a.entry.card) - CARDS.indexOf(b.entry.card));
}
function result(category, cards, extra = {}) {
  const first = cards[0];
  return { category, cards, thread: first?.thread || null, forum: first?.forum || null, classKey: null, spec: null, need: null, facts: "", ...extra };
}

// Names of ores, herbs, fish and leathers ("dark iron", "peacebloom"): the question's words and word pairs that
// only some cards hold. A pair hides the single words inside it.
function itemTerms(q, entries, skip = () => false) {
  const words = q.split(" ").filter(word => !STOP_WORDS.has(word) && !COMMON_VERB.test(word) && !/^(?:alliance|horde|ally|hord)$/.test(word) && !Object.values(PROFESSION_INTENT).some(regex => regex.test(` ${word} `)) && !skip(word));
  const holds = term => entries.filter(entry => entry.norm.includes(` ${term} `)).length, limit = entries.length;
  const pairs = [];
  for (let i = 0; i + 1 < words.length; i++) { const pair = `${words[i]} ${words[i + 1]}`; if (words[i].length >= 3 && words[i + 1].length >= 3 && q.includes(pair)) { const count = holds(pair); if (count >= 1 && count < limit) pairs.push(pair); } }
  if (pairs.length) return pairs;
  return words.filter(word => (word.length >= 4 || word === "tin") && (() => { const count = holds(word); return count >= 1 && count < limit; })());
}
const GATHERING = ["herbalism", "mining", "skinning", "fishing"];
const FIND_WORD = /(?:^| )(?:nerede|nerde|nereden|nerden|farm\w*|dus\w*|cik\w*|bulun\w*|toplan\w*|tutul\w*|kazil\w*)(?= |$)/;
function itemSource(q) {
  // "kitap nerede teslim edilir": a Forever note covers the subject and no profession is named.
  if (!FIND_WORD.test(q) || /(?:^| )(?:cloth|kumas)\w*/.test(q) || noteHits(q).length) return null;
  const all = kb().index, classCards = all.filter(entry => entry.card.category === "class");
  let best = null, tie = false;
  for (const key of GATHERING) {
    const entries = all.filter(entry => entry.card.profession === key && entry.card.part === "range");
    // Everyday words are in the class cards too; an item of this profession is not.
    const terms = itemTerms(q, entries).filter(term => term.length >= 5 && !classCards.some(entry => entry.norm.includes(` ${term} `)) && all.filter(entry => entry.norm.includes(` ${term} `)).length <= 12);
    if (!terms.length) continue;
    const score = terms.reduce((sum, term) => sum + (term.includes(" ") ? 100 : 1) * entries.reduce((count, entry) => count + entry.norm.split(` ${term} `).length - 1, 0), 0);
    if (!best || score > best.score) { best = { key, score }; tie = false; } else if (score === best.score) tie = true;
  }
  return best && !tie ? best.key : null;
}
// What the profession cards say about choosing a profession: who it suits, what pairs with it, primary or secondary.
// [{ profession, card, tag, text, classes }] in the order: class advice, pairs, primary/secondary.
const ADVICE_TAGS = ["KİM", "SINIF", "KİMİN İŞİ", "EŞ", "İKİLİ", "İKİNCİL"];
let adviceLines = null;
function professionAdviceLines() {
  if (adviceLines) return adviceLines;
  const lines = [], seen = new Set();
  for (const card of CARDS.filter(item => item.category === "profession")) {
    for (const raw of card.text.split("\n")) {
      const match = raw.match(/^- `?([A-ZÇĞİÖŞÜ ]{2,12})`?\s*[—:]?\s+(.*)$/); if (!match || !ADVICE_TAGS.includes(match[1].trim())) continue;
      const text = match[2].trim(), classes = Object.keys(CLASS_NAMES).filter(key => new RegExp(`\\b${CLASS_NAMES[key]}\\b`).test(text)), key = `${card.profession}\n${text}`;
      // The same pairing note is printed on several range cards; one copy, the one that names classes first.
      if (seen.has(key)) continue; seen.add(key);
      lines.push({ profession: card.profession, card, tag: match[1].trim(), text, classes });
    }
  }
  const order = line => ADVICE_TAGS.indexOf(line.tag) * 2 + (line.classes.length ? 0 : 1);
  lines.sort((a, b) => order(a) - order(b));
  // Per profession and tag keep one line without classes ("Herbalism aynı rotada bitki toplar").
  adviceLines = lines.filter((line, i) => line.classes.length || !lines.slice(0, i).some(other => other.profession === line.profession && other.tag === line.tag));
  return adviceLines;
}
// "priest için hangi meslek", "hangi meslekleri seçmeliyim": answered from those lines, with the general cards
// of the (at most two) professions that the cards recommend for the class.
function professionAdvice(classKey) {
  const lines = professionAdviceLines(), secondary = [...new Set(lines.filter(line => line.tag === "İKİNCİL").map(line => line.profession))];
  const primary = Object.keys(PROFESSIONS).filter(key => !secondary.includes(key));
  const mine = classKey ? lines.filter(line => line.classes.includes(classKey)) : [];
  const cards = [...new Set(mine.filter(line => line.tag !== "İKİLİ" && primary.includes(line.profession)).map(line => line.profession))].slice(0, 2).map(key => CARDS.find(card => card.profession === key && card.part === "genel")).filter(Boolean);
  const name = key => PROFESSIONS[key].name, show = line => `${name(line.profession)}: ${line.text}`;
  const facts = [`MESLEK SEÇİMİ (meslek kartlarından)`,
    `Ana meslekler (aynı anda en fazla iki tanesi öğrenilir): ${primary.map(name).join(", ")}. İkincil meslekler (ana meslek yerini kullanmaz, üçü birlikte öğrenilebilir): ${secondary.map(name).join(", ")}.`,
    classKey ? (mine.length ? `${CLASS_NAMES[classKey]} için kartlarda yazanlar:\n${mine.map(show).join("\n")}` : `Kartlarda ${CLASS_NAMES[classKey]} adına özel bir meslek önerisi yazmıyor.`) : "",
    `Diğer satırlar:\n${lines.filter(line => !mine.includes(line)).map(show).join("\n")}`].filter(Boolean).join("\n");
  const forum = CARDS.find(card => card.category === "profession")?.forum || null;
  return result("profession", cards, { classKey, advice: true, adviceLines: mine.map(show), general: !cards.length, forum: cards[0]?.forum || forum, facts, siblings: [] });
}
// "alınır", "kurulur", "bulunuyor": verbs of the question, never the name of an item.
const COMMON_VERB = /^(?:al|bul|kur|kullan|gerek|ver|git|sat|dus|cik|bak|kazan|pisir|dik|bas|ol|gel|koy|tak|at)(?:in|il|un|ul|n|l)?(?:ir|ur|ar|er|iyor|uyor|mak|mek|mali|meli|acak|ecek|an|en|dim|dum|sam|sem|ayim|eyim|abil|ebil|iyorum|uyorum|inir|unur|ilir|ulur|malik|mis|mus)\w*$/;
function selectProfession(q, keys, faction) {
  // Two professions in one question ("engineering mi blacksmithing mi"): the general card of each.
  if (keys.length >= 2) {
    const generals = keys.slice(0, 2).map(name => CARDS.find(card => card.profession === name && card.part === "genel")).filter(Boolean);
    if (generals.length === 2) return result("profession", generals, { profession: keys[0], faction, siblings: [], facts: "" });
  }
  const key = keys[keys.length - 1];
  const entries = kb().index.filter(entry => entry.card.profession === key), cards = entries.map(entry => entry.card), words = tokenize(q);
  if (!cards.length) return null;
  const ranges = cards.filter(card => card.part === "range").sort((a, b) => a.range[0] - b.range[0] || String(a.faction).localeCompare(String(b.faction)));
  const byPart = part => cards.find(card => card.part === part), general = byPart("genel");
  const skill = (() => {
    const numbers = [...q.matchAll(/(?:^| )(\d{1,3})(?= |$)/g)].map(match => ({ value: Number(match[1]), at: match.index }));
    for (const number of numbers) {
      const around = q.slice(Math.max(0, number.at - 12), number.at + 16);
      if (/level|lvl|seviye/.test(around) && !/skill|puan/.test(around)) continue; // character level, not skill
      if (number.value >= 1 && number.value <= 300) return number.value;
    }
    return null;
  })();
  const factionFit = card => !card.faction || !faction || card.faction === faction;
  // "heavy runecloth bandage kaçta": a word that occurs in only one or two cards of the profession names its card.
  const aliasWords = new Set(PROFESSIONS[key].strong.concat(PROFESSIONS[key].weak).flatMap(alias => alias.split(" ")));
  const itemWords = words.filter(word => word.length >= 5 && !aliasWords.has(word) && !COMMON_VERB.test(word) && !Object.values(PROFESSION_INTENT).some(regex => regex.test(` ${word} `)));
  const rareWords = itemWords.filter(word => { const count = entries.filter(entry => entry.tokens.has(word)).length; return count >= 1 && count <= 2; });
  const namedItem = rareWords.length ? rank(entries.filter(entry => rareWords.some(word => entry.tokens.has(word))), rareWords, card => card.part === "range" ? 0.5 : 0)[0].entry.card : null;
  // "mining iron nerede": an ore, herb or item that only some skill ranges cover names those ranges.
  const itemRanges = (() => {
    const fit = ranges.filter(factionFit), useful = itemTerms(q, fit.map(card => kb().byId.get(card.id)), word => aliasWords.has(word));
    if (!useful.length) return [];
    const count = (card, term) => kb().byId.get(card.id).norm.split(` ${term} `).length - 1;
    const scored = fit.map(card => ({ card, score: useful.reduce((sum, term) => sum + count(card, term), 0) })).filter(item => item.score).sort((a, b) => b.score - a.score || a.card.range[0] - b.card.range[0]);
    return scored.filter(item => item.score === scored[0].score || item.card.range[0] === scored[0].card.range[0]).slice(0, 2).map(item => item.card);
  })();
  let picked = [];
  // "1-300 nasıl kasılır", "baştan sona": the first two range cards; the outline below lists the rest.
  // With more range cards than fit, the general card ("1 → 300 başlamadan önce") and the starting range.
  if (ranges.length && /(?:^| )(?:1|0) 300(?= |$)|bastan sona|sifirdan|en bastan/.test(q)) {
    const fit = ranges.filter(factionFit), start = fit.filter(card => card.range[0] === fit[0].range[0]);
    picked = fit.length <= 2 || !general ? fit.slice(0, 2) : [general, start.length === 1 ? start[0] : null].filter(Boolean);
  }
  // "skinning ile hangi meslek gider": a question about the profession itself, not about a skill range.
  else if (general && PROFESSION_WORD.test(q) && ASKS_ADVICE.test(q)) picked = [general];
  else if (skill !== null && ranges.length) {
    const containing = ranges.filter(card => skill >= card.range[0] && (skill < card.range[1] || card.range[1] === 300)).filter(factionFit);
    picked = containing.slice(0, 2);
    const upper = picked[0]?.range[1];
    if (picked.length === 1 && upper < 300 && upper - skill <= 10) { const next = ranges.find(card => card.range[0] === upper && factionFit(card)); if (next) picked.push(next); }
  } else if (key === "cooking" && PROFESSION_INTENT.camp.test(q) && !rareWords.length && byPart("kamp")) picked = [byPart("kamp")];
  else if (namedItem) picked = [namedItem];
  else if (itemRanges.length) picked = itemRanges;
  else if (key === "cooking" && PROFESSION_INTENT.camp.test(q) && byPart("kamp")) picked = [byPart("kamp")];
  else if (key === "cooking" && PROFESSION_INTENT.food.test(q) && !PROFESSION_INTENT.where.test(q) && byPart("yemek")) picked = [byPart("yemek")];
  else if (PROFESSION_INTENT.recipe.test(q) && byPart("tarifler")) picked = [byPart("tarifler")];
  else if (general && (PROFESSION_INTENT.trainer.test(q) || PROFESSION_INTENT.general.test(q) && !PROFESSION_INTENT.where.test(q))) picked = [general];
  else if (PROFESSION_INTENT.where.test(q) && ranges.length) {
    const start = ranges.filter(card => card.range[0] === ranges[0].range[0]).filter(factionFit);
    picked = start.length > 1 ? start.slice(0, 2) : [start[0], general].filter(Boolean);
  } else {
    // The card whose text fits best; the general card unless another one fits clearly better.
    const ranked = rank(entries, words.filter(word => !PROFESSIONS[key].strong.includes(word)), () => 0), generalScore = ranked.find(item => item.entry.card === general)?.score || 0;
    picked = ranked[0].score > 3 && (!general || ranked[0].score >= generalScore + 1.5) ? [ranked[0].entry.card] : [general || ranked[0].entry.card];
  }
  const outline = ranges.map(card => `${card.range[0]}–${card.range[1]}${card.faction ? ` (${card.faction === "alliance" ? "Alliance" : "Horde"})` : ""}`).join(", ");
  return result("profession", picked, { profession: key, skill, faction, siblings: cards.filter(card => !picked.includes(card)), facts: `${PROFESSIONS[key].name} kartları: ${cards.map(card => card.title.split(" · ")[1]).join(" | ")}.${outline ? ` Skill aralıkları: ${outline}.` : ""}` });
}

export function dungeonLine(card) {
  const quests = Number.isInteger(card.hordeQuests) ? ` Görev: Horde ${card.hordeQuests} · Alliance ${card.allianceQuests}.` : "";
  return `${card.title.replace(/^Lv \d+ · /, "")}: önerilen seviye ${card.level}, bölge ${card.zone}.${card.bosses.length ? ` Bosslar: ${card.bosses.join(", ")}.` : ""}${quests}`;
}
function selectDungeon(q, group) {
  const level = levelInQuestion(q); let cards = Object.keys(group.cards).map(slug => DUNGEON_CARDS.get(slug)).filter(Boolean).sort((a, b) => a.level - b.level);
  const all = cards, wings = cards.filter(card => group.cards[card.dungeon].some(word => hasTerm(q, word)));
  if (wings.length) cards = wings;
  else if (level && cards.length > 1) cards = [...cards].sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level));
  return result("dungeon", cards.slice(0, 2), { siblings: all.filter(card => !cards.slice(0, 2).includes(card)), level, facts: all.map(dungeonLine).join("\n") });
}
// "30 level hangi dungeon": the dungeons closest to that level, or the whole list.
export function dungeonOverview(level) {
  const sorted = [...DUNGEON_CARDS.values()].sort((a, b) => a.level - b.level);
  if (!level) return { cards: [], text: `Zindanlar önerilen seviyeye göre: ${sorted.map(card => `${card.level} ${card.title.replace(/^Lv \d+ · /, "")}`).join(" · ")}.` };
  const near = sorted.filter(card => Math.abs(card.level - level) <= 3).sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level) || a.level - b.level).slice(0, 4);
  const cards = near.length ? near : [sorted.reduce((best, card) => Math.abs(card.level - level) < Math.abs(best.level - level) ? card : best)];
  return { cards: cards.slice(0, 1), text: `${level}. seviyeye en yakın zindanlar: ${[...cards].sort((a, b) => a.level - b.level).map(card => `**${card.title.replace(/^Lv \d+ · /, "")}** (seviye ${card.level}, ${card.zone})`).join(", ")}.` };
}

const PURPOSE = /(?:^| )(?:pvp|pve|arena|bg|battleground\w*|duel\w*|duello\w*|dungeon\w*|zindan\w*|instance|raid\w*|baskin\w*|solo|tek basina|grind\w*|farm\w*|endgame|leveling|levelling|level (?:atla|kas)\w*|kasarken|kasma\w*|kasmak)(?= |$)/;
const WHICH_SPEC = /hangi (?:spec|spek|uzmanli[kg]|dal|agac|build|tree)\w*|(?:spec|spek|uzmanli[kg])\w* (?:oner|tavsiye|sec)\w*|en iyi (?:\w+ )?(?:spec|spek|uzmanli[kg]|build)\w*|(?:spec|spek|uzmanli[kg])\w* (?:ne|hangisi) (?:olmali|olsun|secmeli)\w*|(?:^| )(?:spec|spek|uzmanli[kg])\w* .*(?:hangi\w*|oner\w*|tavsiye\w*|olmali\w*|gitmeli\w*|gideyim|secmeli\w*)(?= |$)|(?:hangi\w*|oner\w*|tavsiye\w*) .*(?:spec|spek|uzmanli[kg])\w*(?= |$)/;
const COMPARE_WORD = /(?:^| )(?:vs|versus|fark\w*|karsilastir\w*|kiyasla\w*|hangisi\w*|arasinda\w*)(?= |$)/;
const ASKS_ADVICE = /(?:^| )(?:hangi\w*|oner\w*|tavsiye\w*)(?= |$)/;
// "frost mu fire mı": the question particle right after a name.
// "holy priest mi disc priest mi": the class name may stand between the spec and the particle.
const followedByParticle = (q, hit, between = []) => { const rest = q.slice(hit.end); if (/^\w* m[iu](?= |$)/.test(rest)) return true; const next = rest.match(/^\w* (\w+) m[iu](?= |$)/); return !!next && between.some(alias => hasTerm(next[1], alias)); };
// "hangi itemleri almalıyım", "hangi zırh", "silah seçimi": equipment, which no card covers.
const WEAPON_WORD = /(?:^| )(?:silah\w*|weapon\w*|staff|asa|wand|sword|kilic\w*|mace|topuz\w*|axe|balta\w*|dagger|hancer\w*|bow|crossbow|gun|tufek\w*|polearm|mizrak\w*|2h|1h|iki elli|tek elli|kalkan tak\w*)(?= |$)/;
const GEAR = /(?:^| )(?:item\w*|itemler\w*|esya\w*|ekipman\w*|gear\w*|zirh\w*|armor\w*|armour\w*|kiyafet\w*|giymeli\w*|giyeyim|giyer\w*|giyebil\w*|giyiyor\w*|giyilir|giyilmeli|kusan\w*|mail|plate|leather|cloth)(?= |$)/;
const WEAPON_TALENT = /(?:sword|mace|axe|dagger|fist|polearm|wand|two handed|weapon) speciali[sz]ation|dual wield|iki elli silah/;
// "itemleri nasıl satarım", "zırhım kırıldı": about an item, but not about what to wear.
const NOT_WEARING = /(?:^| )(?:sat\w*|tamir\w*|repair\w*|kiril\w*|durability|dayanikli\w*|banka\w*|bank|auction|muzayede|ah|canta\w*|bag\w*|soulbound|transmog\w*|enchant\w*|disenchant\w*|boz\w*|sildi\w*|silin\w*|kayboldu|kayip|bug\w*|hata\w*|addon\w*|link\w*|mail kutu\w*|mailbox|posta\w*|mail at\w*|mail gonder\w*|mail gel\w*)(?= |$)/;
export function isGearQuestion(question) {
  const q = questionText(question);
  return (GEAR.test(q) || WEAPON_WORD.test(q)) && !INTENT.talents.test(q) && !/(?:^| )(?:build\w*|puan sira\w*|dagilim\w*|dagitim\w*|dizilim\w*)(?= |$)/.test(q) && !INTENT.gameplay.test(q) && !INTENT.abilities.test(q) && !/(?:^| )(?:irk\w*|race|racial\w*)(?= |$)/.test(q) && !PROFESSION_WORD.test(q) && !NOT_WEARING.test(q) && !/(?:^| )(?:spec\w*|dual wield)(?= |$)/.test(q);
}
const CLASS_OVERVIEW = /nasil bir|iyi mi|guclu mu|zayif mi|(?:^| )(?:zor\w*|kolay\w*|rahat\w*|leveling|levelling|kasmak|kasilir|kasarken|rol\w*|tank\w*|heal\w*|sifaci\w*|dps|solo|pvp|pve|raid\w*|oynanir|oynamali\w*|oynasam|secmeli\w*|secsem|baslamali\w*|baslasam|deger\w*|oner\w*|tavsiye\w*|arti\w*|eksi\w*|avantaj\w*|dezavantaj\w*)(?= |$)/;

function classTopic(classKey, entries) { return { classKey, forum: entries[0]?.card.forum || null, thread: entries[0]?.card.thread || null }; }
// "arcane mi frost mu fire mi", "warrior hangi spec": answered from the role, strengths and weaknesses of each spec.
// The cards are the talent order (Leveling) cards of the specs; with three or more the answer decides which to show.
function compareSpecs(classKey, specs, entries) {
  const candidates = specs.map(spec => entries.find(entry => entry.card.kind === "leveling" && entry.card.spec === spec)?.card).filter(Boolean);
  const facts = [classOverviewLine(classKey), ...specs.map(spec => specFactText(classKey, spec))].filter(Boolean).join("\n");
  return result("class", candidates.length <= 2 ? candidates : [], { ...classTopic(classKey, entries), compare: specs, candidates, facts, siblings: [] });
}

function selectClass(q, classKey, options) {
  const entries = kb().index.filter(entry => entry.card.classKey === classKey), words = tokenize(q).filter(word => !CLASS_ALIASES[classKey].includes(word));
  const hits = detectSpecs(q, classKey);
  const intents = Object.fromEntries(Object.entries(INTENT).map(([name, regex]) => [name, regex.test(q)]));
  intents.leveling = intents.leveling || !!options.talentAdvice;
  // "alliance shaman olabilir mi", "horde paladin var mı": which sides and races can be this class.
  if (!intents.race && !intents.talents && !intents.leveling && !intents.gameplay && !intents.abilities && /(?:^| )(?:alliance\w*|ally|alli|horde\w*|hord)(?= |$)/.test(q) && /(?:^| )(?:olabil\w*|olur|olunur|olunuyor|oluyor|olunabil\w*|var|yok|oynan\w*|oynayabil\w*|secebil\w*|secil\w*|acabil\w*|acilir)(?= |$)/.test(q) && !/(?:^| )(?:trainer\w*|egitmen\w*|egitici\w*|gorev\w*|quest\w*|zindan\w*|dungeon\w*)(?= |$)/.test(q)) intents.race = true;
  // "druid ırk" is a race question; "tauren druid rotasyon" is not.
  if (intents.race && (intents.leveling || intents.gameplay || intents.talents) && !/(?:^| )(?:irk\w*|race|racial\w*)(?= |$)/.test(q)) intents.race = false;
  // Which spec: two or more specs set against each other, or no spec named and the question asks which one to play.
  if (hits.length >= 2 && (hits.some(hit => followedByParticle(q, hit, CLASS_ALIASES[classKey])) || COMPARE_WORD.test(q) || WHICH_SPEC.test(q))) return compareSpecs(classKey, hits.map(hit => hit.spec), entries);
  if (!hits.length && !options.specHint && !intents.race && (WHICH_SPEC.test(q) || PURPOSE.test(q) && (options.talentAdvice || ASKS_ADVICE.test(q) && (intents.talents || /(?:^| )(?:build|spec|spek|uzmanli[kg])\w*/.test(q))))) return compareSpecs(classKey, classSpecs(classKey), entries);
  const spec = detectSpec(q, classKey) || options.specHint || null;
  // "frost mage 45 level talentlerim ne olmalı": a level next to a talent question means the talent order card.
  if (spec && intents.talents && levelInQuestion(q)) intents.leveling = true;
  // "shadow'a kaçta geçmeliyim", "ne zaman respec": the talent order card shows when the build changes.
  if (spec && /(?:^| )(?:gec(?:meli|mek|ilir|eyim|sem|is|me)\w*|respec\w*)(?= |$)/.test(q)) intents.leveling = true;
  // "kaç levelde açılıyor": the ability cards list the level each ability is learned at.
  const when = /(?:^| )(?:kacta|kacinci|kac (?:level|lvl|lv|seviye)\w*|hangi (?:level|lvl|seviye)\w*|ne zaman (?:al|ac|ogren|gel)\w*|aciliyor|acilir|aliniyor|alinir|ogreniliyor|ogrenilir|geliyor)(?= |$)/.test(q) && !intents.leveling;
  if (intents.leveling && !spec) {
    // Leveling cards are per spec. Ask for the spec only when the question is about the build itself
    // ("warrior leveling", "rogue build"); "leveling sırasında hangi silah" is a different question.
    const rest = words.filter(word => !INTENT.leveling.test(` ${word} `));
    const other = intents.gameplay || intents.abilities || intents.race;
    if (options.talentAdvice || intents.talents || /(?:^| )(?:build|puan|dagilim|dagitim|dizilim)\w*/.test(q) || !rest.length || rest.length === 1 && !other) return result("class", [], { ...classTopic(classKey, entries), need: "spec" });
    intents.leveling = false;
  }
  // "frost oynarken hangi büyüleri öğrenmeliyim": the spec's priority list says which abilities it uses.
  const learn = !!spec && !intents.talents && !intents.leveling && /(?:^| )(?:trainer\w*|egitmen\w*|ogren\w*)(?= |$)|(?:^| )(?:al|ogren)(?:mak|mam|mali|maliyim|malimiyim) gerek|(?:^| )(?:almali|alinmali|ogrenmeli)\w*/.test(q);
  const named = namedInQuestion(q).filter(hit => hit.classKey === classKey);
  const prior = card => {
    // A card that lists the named ability or talent as its own row counts more than one that only mentions it.
    let value = named.some(hit => hit.defs.has(card.id)) ? 7 : named.some(hit => hit.cards.has(card.id)) ? 4 : 0;
    if (card.spec && spec) value += card.spec === spec ? 3 : -4;
    if (card.kind === "race") value += intents.race ? 8 : -2;
    if (card.kind === "leveling") value += intents.leveling ? 8 : -3;
    if (card.kind === "talents") value += intents.talents && !intents.leveling ? 5 : 0;
    if (card.kind === "gameplay") value += intents.gameplay ? (intents.talents || intents.leveling ? 6 : 10) : learn ? 7 : -1;
    if (card.kind === "abilities") value += (intents.abilities && !intents.talents && !intents.leveling ? 3 : 0) + (when && (!named.length || named.some(hit => hit.cards.has(card.id))) ? 5 : 0);
    return value;
  };
  // "alan vuran skili var mı": the cards that describe area-effect abilities, and the list of all of them.
  const area = AOE_QUESTION.test(q) && !intents.talents && !intents.leveling ? areaLines(entries) : [];
  const multi = area.length ? multiTargetNotes(entries, spec) : [];
  const areaPrior = card => Math.min(3, area.filter(item => item.card === card).length) * 3 + (multi.some(note => note.card === card) ? 8 : 0);
  const ranked = rank(entries, words, card => prior(card) + areaPrior(card)), top = ranked[0];
  const anyIntent = Object.values(intents).some(Boolean) || learn || area.length > 0;
  const areaFacts = area.length ? `${multi.length ? `Oynanış kartındaki çok hedef notları:\n${multi.map(note => `- ${note.section}: ${note.text}`).join("\n")}\n` : ""}${CLASS_NAMES[classKey]} kartlarındaki alan etkili (birden çok hedefe etki eden) yetenekler (\"Seviye\" ya da yetenek satırındaki sayı öğrenildiği seviyedir; talent satırındaki sayı ağaçtaki sıra numarasıdır, seviye değildir):\n${area.slice(0, 10).map(item => `- [${item.card.title.split(" · ").pop()}] ${item.text.slice(0, 220)}`).join("\n")}` : "";
  const facts = [spec ? specFactText(classKey, spec) : classOverviewLine(classKey), intents.race ? raceAdviceText(classKey) : "", areaFacts].filter(Boolean).join("\n");
  const extra = { ...classTopic(classKey, entries), spec, intents, facts, siblings: [] };
  // Without an intent word a card needs a clear text match, or a rare word of the question ("hunter aspectleri").
  const rareHit = top && words.length <= 2 && words.some(word => word.length >= 5 && [word, ...stems(word).filter(stem => SUFFIX_ONLY.test(word.slice(stem.length)))].some(form => top.entry.tokens.has(form) && (kb().frequency.get(form) || 0) <= 8));
  const overview = !anyIntent && !spec && CLASS_OVERVIEW.test(q) && (!top || top.score < 8);
  if (overview || !top || top.score <= 0 || !anyIntent && top.score < 4 && !rareHit) {
    // No card stands out. "paladin tank olur mu": the spec is known, so its talent card and its strengths answer it.
    const talents = spec && entries.find(entry => entry.card.kind === "talents" && entry.card.spec === spec)?.card;
    if (talents) return result("class", [talents], extra);
    // "warrior nasıl bir sınıf", "mage solo iyi mi": the class overview and the three specs.
    if (CLASS_OVERVIEW.test(q)) return result("class", [], { ...extra, factsOnly: true, facts: [classOverviewLine(classKey), ...classSpecs(classKey).map(key => specFactText(classKey, key))].filter(Boolean).join("\n") });
    return null;
  }
  if (learn) {
    const gameplay = entries.find(entry => entry.card.kind === "gameplay")?.card, abilities = ranked.find(item => item.entry.card.kind === "abilities")?.entry.card;
    if (gameplay) return result("class", [gameplay, abilities].filter(Boolean), extra);
  }
  const cards = [top.entry.card], second = ranked[1];
  // A second card only when the question itself points at it: its kind was asked for, or it holds a name from the question.
  const wanted = card => card.kind !== "leveling" && named.some(hit => hit.cards.has(card.id)) || areaPrior(card) > 0 || { talents: intents.talents, abilities: intents.abilities, gameplay: intents.gameplay }[card.kind];
  if (second && second.score >= 5 && second.score >= top.score * 0.8 && !(intents.leveling || intents.race) && wanted(second.entry.card)) cards.push(second.entry.card);
  return result("class", cards, extra);
}

// "hunter mı mage mı", "warrior paladin tank farkı": two or three classes set against each other.
function compareClasses(q, classes) {
  const keys = classes.slice(0, 3).map(hit => hit.classKey), topics = keys.map(classKey => { const card = CARDS.find(item => item.classKey === classKey); return { forum: card.forum, thread: card.thread }; });
  const facts = keys.map(classKey => [classOverviewLine(classKey), ...classSpecs(classKey).map(spec => specFactText(classKey, spec))].join("\n")).join("\n\n");
  return result("class", [], { classKey: keys[0], factsOnly: true, topics, forum: topics[0].forum, thread: topics[0].thread, facts, siblings: [] });
}
// "hangi sınıf tank olur", "yeni başlayana hangi sınıf": one line per class with its roles.
const CLASS_CHOICE = /(?:^| )(?:sinif\w*|class\w*|karakter\w*)(?= |$)/;
const ROLE_WORD = /(?:^| )(?:tank\w*|healer\w*|heal\w*|sifaci\w*|dps|hasar\w*)(?= |$)/;
function classOverview(withRaces) {
  const forum = CARDS.find(card => card.category === "class")?.forum || null, keys = Object.keys(CLASS_NAMES);
  const races = withRaces ? `\n\n${Object.entries(CLASS_FACTS.taraflar).map(([side, list]) => `${side} ırkları: ${list.join(", ")}.`).join(" ")}\n\nSınıfların ırkları:\n${keys.map(classKey => `${CLASS_NAMES[classKey]}: ${CLASS_FACTS.siniflar[classKey].irklar.join(", ")}`).join("\n")}` : "";
  return result("class", [], { general: true, factsOnly: true, forum, facts: `Sınıflar ve uzmanlıkların rolleri:\n${keys.map(classOverviewLine).join("\n")}${races}`, siblings: [] });
}

// Last resort: the cards whose text shares the most distinctive words with the question.
// The answer step still decides whether those cards really answer it.
export function searchCards(question, { classKey = null } = {}) {
  const q = questionText(question), words = [...new Set(tokenize(q))]; if (!words.length) return null;
  const pool = classKey ? kb().index.filter(entry => entry.card.classKey === classKey) : kb().index;
  const ranked = rank(pool, words, () => 0), top = ranked[0]; if (!top) return null;
  const matched = words.filter(word => top.entry.tokens.has(word));
  // One shared word is not enough unless it is rare and long (a name).
  const rare = matched.filter(word => word.length >= 5 && (kb().frequency.get(word) || 0) <= 4);
  // Two words of the question standing together in the card ("light leather") count as a name.
  const phrase = words.some((word, i) => word.length >= 4 && (words[i + 1] || "").length >= 4 && q.includes(`${word} ${words[i + 1]}`) && top.entry.norm.includes(` ${word} ${words[i + 1]} `));
  // One word is enough when it is a name: "dynamite kaç skill", "mooncloth nasıl yapılır".
  const name = rare.some(word => word.length >= 6 && kb().proper.has(word));
  if (top.score < (classKey || phrase ? 5 : name ? 4 : 7) || matched.length < 2 && !rare.length) return null;
  const cards = [top.entry.card], second = ranked[1];
  if (second && second.score >= top.score * 0.85 && second.entry.card.thread === top.entry.card.thread) cards.push(second.entry.card);
  const card = cards[0];
  const facts = card.category === "class" ? classOverviewLine(card.classKey) : card.category === "dungeon" ? cards.map(dungeonLine).join("\n") : "";
  return result(card.category, cards, { classKey: card.classKey || null, search: true, facts, siblings: [] });
}

// options: { classHint, specHint, talentAdvice }
export function selectCards(question, options = {}) {
  const q = questionText(question); if (!q) return null;
  const named = detectClass(q), classKey = named || options.classHint || null, faction = detectFaction(q);
  // A class found only through an ability name ("elixir of the mongoose") does not outrank a profession word.
  const classes = detectClasses(q), professions = detectProfessions(q, { allowWeak: !classes.length });
  if (professions.length) return selectProfession(q, professions, faction);
  const group = findDungeonGroup(q);
  // "peacebloom nerede", "stonescale eel nerede tutulur": the gathering profession whose cards say where it is found.
  if (!named && !group) { const source = itemSource(q); if (source) return selectProfession(q, [source], faction); }
  const classTopicWord = !!named && /(?:^| )(?:stat|talent|rotasyon|rotation|spell|skill|buff|ability|gear|ekipman|silah|irk|build|pet|aggro|threat|heal|tank|dps)\w*/.test(q);
  if (group && !classTopicWord) return selectDungeon(q, group);
  const professionWord = PROFESSION_WORD.test(q);
  if (classes.length >= 2 && !professionWord && (classes.some(hit => followedByParticle(q, hit)) || COMPARE_WORD.test(q) || /(?:^| )hangi\w*(?= |$)/.test(q) && CLASS_CHOICE.test(q))) return compareClasses(q, classes);
  if (!classKey && !professionWord && !group && CLASS_CHOICE.test(q) && (ASKS_ADVICE.test(q) || /(?:^| )en (?:iyi|hizli|kolay|guclu|zor|rahat|cok|az)(?= |$)|secmeli\w*|secsem|baslamali\w*|baslasam|baslayayim|yeni basla\w*|kolay|rahat|olabil\w*|olur/.test(q))) return classOverview(INTENT.race.test(q) || !!faction);
  // "ırk seçimi önemli mi", "hangi ırk": no class named, so the races of every class.
  if (!classKey && !professionWord && !group && /(?:^| )(?:irk\w*|race|races|racial\w*)(?= |$)/.test(q)) return classOverview(true);
  if (!classKey && !professionWord && !group && ROLE_WORD.test(q) && /(?:^| )(?:hangi\w*|oner\w*|tavsiye\w*|istiyorum|baslamak|baslayacagim|oynamak|oynayacagim|olmak)(?= |$)/.test(q) && !DUNGEON_WORD.test(q) && !options.talentAdvice) return classOverview(false);
  if (!named && !group && DUNGEON_WORD.test(q)) {
    const level = levelInQuestion(q), overview = dungeonOverview(level), first = [...DUNGEON_CARDS.values()][0];
    return result("dungeon", overview.cards, { general: true, level, facts: overview.text, localAnswer: overview.text, forum: first?.forum || null, thread: overview.cards.length === 1 ? overview.cards[0].thread : null });
  }
  // "shaman için hangi meslek", "hangi meslekleri seçmeliyim": what the profession cards say about choosing one.
  if (professionWord) return /(?:^| )(?:hangi\w*|oner\w*|tavsiye\w*|sec\w*|almali\w*|alayim|alsam|alabil\w*|ogrenebil\w*|baslamali\w*|iyi|uygun|gider|yakisir|lazim|kac meslek|iki meslek|2 meslek|birden|ayni anda)(?= |$)/.test(q) || named && q.split(" ").length <= 5 ? professionAdvice(classKey) : null;
  // Equipment questions: no card covers them, and a race or talent card would only mislead.
  // Only a talent card that really has weapon talents ("rogue hangi silah combat") still answers one.
  if (classKey && isGearQuestion(q)) {
    const selection = WEAPON_WORD.test(q) ? selectClass(q, classKey, options) : null;
    return selection && !selection.need && selection.cards.length && selection.cards.every(card => card.kind === "talents" && WEAPON_TALENT.test(normalizeText(card.text))) ? selection : null;
  }
  if (classKey) {
    const selection = selectClass(q, classKey, options);
    if (selection) return selection;
  }
  if (options.talentAdvice && !classKey) return result("class", [], { need: "class", forum: CARDS.find(card => card.category === "class")?.forum || null });
  return options.search === false ? null : searchCards(q, { classKey: named });
}

// ------------------------------------------------------------
// Context for the answer, and a model-free fallback answer
// ------------------------------------------------------------
// "9 / 0 / 42 — Arcane 9, Fire 0, Frost 42." from a Leveling card.
function pointSummary(card) {
  const lines = card.text.split("\n"), at = lines.findIndex(line => normalizeText(line).startsWith("60 seviye puan dagilimi"));
  return at < 0 ? "" : (lines.slice(at + 1).find(line => line.trim()) || "").trim();
}
// The text of a card that concerns the question. The Oynanış card has one section per spec:
// when the spec is known the other specs are left out, so their priorities cannot leak into the answer.
function focusedText(card, selection) {
  if (card.kind !== "gameplay" || !selection.spec || selection.compare) return card.text;
  const nameOf = spec => normalizeText(specFacts(card.classKey, spec)?.ad || SPEC_NAMES[spec] || "");
  const own = nameOf(selection.spec), others = new Set(classSpecs(card.classKey).map(nameOf).filter(name => name && name !== own));
  return card.text.split(/\n(?=## )/).filter(section => !others.has(normalizeText(section.split("\n")[0].replace(/^#+ /, "")))).join("\n");
}
// The row of a Leveling card that covers a character level: "| 28–31 | Ice Shards | Frost | +4 | 4/5 | ... |".
function levelRow(card, level) {
  if (card.kind !== "leveling" || !level) return "";
  for (const line of card.text.split("\n")) {
    const match = line.match(/^\|\s*(\d{1,2})(?:\s*[–-]\s*(\d{1,2}))?\s*\|/); if (!match) continue;
    const from = Number(match[1]), to = Number(match[2] || match[1]);
    if (level >= from && level <= to) return `Seviye ${level}: ${line.split("|").slice(1, -1).map(cell => cell.trim()).join(" · ")}`;
  }
  return "";
}

function readableLine(line, header) {
  if (!line.startsWith("|")) return line.replace(/^[-•*]\s*/, "").replace(/^#+\s*/, "");
  const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
  if (cells.every(cell => /^[-:\s]*$/.test(cell))) return "";
  const rest = cells.slice(1).map((cell, i) => cell && cell !== "—" ? `${header?.[i + 1] ? `${header[i + 1]}: ` : ""}${cell}` : "").filter(Boolean);
  return cells[0] ? `**${cells[0]}**${rest.length ? `: ${rest.join(" · ")}` : ""}` : "";
}
// The readable lines of a card text: bullets as they are, table rows as "**first cell**: header: cell · ...".
function readableLines(text) {
  const out = []; let header = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) header = null;
    if (!line || /^#/.test(line) || /^(?:Üst bilgi|Sol üst|Sağ üst|Kart başlığı|Marka|Rozet|Kartta )/.test(line)) continue;
    if (line.startsWith("|") && !header) { header = line.split("|").slice(1, -1).map(cell => cell.trim()); continue; }
    const text = readableLine(line, header).replace(/^\(ikon\)\s*(?:—\s*)?/, ""); if (text.length >= 12) out.push(text);
  }
  return out;
}
// The lines of the chosen cards, scored by the distinctive words they share with the question.
function scoredLines(selection, question) {
  const words = tokenize(question), lines = [], area = AOE_QUESTION.test(questionText(question));
  for (const card of selection.cards) {
    for (const text of readableLines(focusedText(card, selection))) {
      if (lines.some(known => known.text === text)) continue;
      const norm = normalizeText(text), tokens = new Set(norm.split(" "));
      lines.push({ text, order: lines.length, score: words.reduce((sum, word) => sum + (tokens.has(word) ? idf(word) : 0), 0) + (area && AOE_LINE.test(norm) ? 6 : 0) });
    }
  }
  return lines;
}
// Every area-effect ability the class's cards describe: "Holy Nova (Holy Talentleri): 10 metre içindeki düşmanlara …".
function areaLines(entries) {
  const out = [];
  for (const entry of entries) {
    if (!["abilities", "talents"].includes(entry.card.kind)) continue;
    for (const text of readableLines(entry.card.text)) {
      const norm = normalizeText(text);
      // Only ability and talent rows count, and a heal that jumps between allies is not an area attack.
      if (!/(?:^| )(?:yetenek|talent) /.test(norm) || !AOE_LINE.test(norm) || (/iyilestir/.test(norm) && !/hasar\w* (?:ver|vur)/.test(norm))) continue;
      if (!out.some(item => item.text === text)) out.push({ card: entry.card, text });
    }
  }
  return out;
}

// The "ÇOK HEDEF: …" notes of the gameplay card, one per spec section ("Shadow: Shadow Word: Pain'i her düşmana at …").
function multiTargetNotes(entries, spec = null) {
  const out = [];
  for (const entry of entries) {
    if (entry.card.kind !== "gameplay") continue;
    const own = spec ? normalizeText(specFacts(entry.card.classKey, spec)?.ad || SPEC_NAMES[spec] || "") : "";
    for (const section of entry.card.text.split(/\n(?=## )/)) {
      const name = section.split("\n")[0].replace(/^#+ /, "").trim(), line = section.split("\n").find(row => /^ÇOK HEDEF\s*:/.test(row.trim()));
      if (line && (!own || normalizeText(name) === own)) out.push({ card: entry.card, section: name, text: line.trim().replace(/^ÇOK HEDEF\s*:\s*/, "") });
    }
  }
  return out;
}

export function buildCardContext(selection, limit = 16000, question = "") {
  const parts = []; let used = 0;
  if (selection.facts) { parts.push(`ÖZET BİLGİ:\n${selection.facts}`); used += selection.facts.length; }
  // Profession advice is answered from the advice lines alone; the general cards are only attached.
  if (selection.advice) return parts.join("\n\n---\n\n");
  // A comparison is answered from the facts; of the cards only the point split is needed.
  if (selection.compare) {
    const builds = (selection.candidates || []).map(card => `${card.title}: ${pointSummary(card)}`).filter(line => !line.endsWith(": "));
    if (builds.length) parts.push(`TALENT SIRASI KARTLARI (60. seviye puan dağılımı):\n${builds.join("\n")}`);
    return parts.join("\n\n---\n\n");
  }
  const level = levelInQuestion(normalizeText(question));
  const focus = [...selection.cards.map(card => levelRow(card, level)).filter(Boolean),
    ...scoredLines(selection, question).filter(line => line.score >= 3).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 5).sort((a, b) => a.order - b.order).map(line => line.text.slice(0, 500))];
  if (focus.length) { const text = focus.join("\n"); parts.push(`SORUYLA EN İLGİLİ SATIRLAR:\n${text}`); used += text.length; }
  for (const card of selection.cards) {
    const text = focusedText(card, selection).slice(0, Math.max(1500, limit - used - 1500 * (selection.cards.length - 1)));
    parts.push(`KART: ${card.title}\n${text}`); used += text.length;
  }
  // Outline of the other cards in the same topic, so "which skill range where" can be answered.
  for (const card of selection.siblings || []) {
    if (used > limit) break;
    const outline = card.text.split("\n").filter(line => /^#{1,3} /.test(line)).map(line => line.replace(/^#+ /, "")).join(" | ").slice(0, 900);
    parts.push(`DİĞER KART (yalnız başlıklar): ${card.title}\n${outline}`); used += outline.length;
  }
  return parts.join("\n\n---\n\n");
}

export function specRole(classKey, spec) { return spec === "feral-ayi" ? "Tank" : spec === "feral-kedi" ? "Yakın DPS" : specFacts(classKey, spec)?.rol || ""; }
// Used only when the AI step fails: the lines of the chosen cards that share most words with the question.
export function localCardAnswer(selection, question) {
  if (selection.localAnswer) return selection.localAnswer;
  if (selection.advice) return (selection.adviceLines.length ? selection.adviceLines.slice(0, 3) : selection.facts.split("\n").slice(1, 2)).map(text => `• ${text}`).join("\n");
  if (selection.compare) {
    return selection.compare.map(spec => { const facts = specFacts(selection.classKey, spec); return facts ? `• **${SPEC_NAMES[spec]}** (${specRole(selection.classKey, spec)}): ${facts.arti.slice(0, 2).join(" · ")}. Zayıf yanı: ${facts.eksi[0]}.` : ""; }).filter(Boolean).join("\n");
  }
  if (selection.category === "dungeon" && selection.cards.length) return selection.cards.map(dungeonLine).join("\n");
  const level = levelInQuestion(normalizeText(question)), rows = selection.cards.map(card => levelRow(card, level)).filter(Boolean);
  const best = scoredLines(selection, question).filter(line => line.score > 0).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 3 - Math.min(rows.length, 2)).sort((a, b) => a.order - b.order);
  return [...rows.slice(0, 2), ...best.map(line => line.text.slice(0, 420))].map(text => `• ${text}`).join("\n");
}

// ------------------------------------------------------------
// Matching a card to the attachment in its forum topic
// ------------------------------------------------------------
// Discord rewrites file names ("01 - Ragefire Chasm (Lv 14).png" -> "01_-_Ragefire_Chasm_Lv_14.png").
export function fileKey(name) { return normalizeText(String(name || "").replace(/\.(?:png|jpe?g|webp|gif)$/i, "")).replace(/[^a-z0-9]/g, ""); }
export function threadKey(name) { return normalizeText(name).replace(/[^a-z0-9]/g, ""); }
export function findCardAttachment(card, attachments) {
  const images = (attachments || []).filter(a => /\.(?:png|jpe?g|webp|gif)$/i.test(a?.filename || "") || /^image\//i.test(a?.content_type || ""));
  const key = fileKey(card.file), exact = images.find(a => fileKey(a.filename) === key);
  if (exact) return exact;
  // Same leading number and the same first word ("09-balance..." in the Druid topic).
  const number = card.file.match(/^(\d+)/)?.[1], loose = number ? images.filter(a => String(a.filename || "").startsWith(number) && fileKey(a.filename).slice(0, number.length + 5) === key.slice(0, number.length + 5)) : [];
  return loose.length === 1 ? loose[0] : null;
}

// Every forum topic the bot needs: { forum, thread, cards }.
export const CARD_TOPICS = (() => {
  const topics = new Map();
  for (const card of CARDS) { const key = `${card.forum}\n${card.thread}`; if (!topics.has(key)) topics.set(key, { forum: card.forum, thread: card.thread, category: card.category, cards: [] }); topics.get(key).cards.push(card); }
  return [...topics.values()];
})();
