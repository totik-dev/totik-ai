// Card knowledge base: picks the guide cards that answer a question.
//
// The 189 cards live in the Discord forum channels (Class / Zindan / Meslek
// rehberleri). src/cards-data.js holds the full text of every card
// (kartlar/metin/*.md); this module only decides WHICH cards fit a question.
// It is pure (no network, no Discord), so tests import it directly.
import { CARDS } from "./cards-data.js";

export { CARDS };

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
function hasTerm(q, term) {
  const text = ` ${q} `, needle = ` ${term}`;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const start = at + needle.length, tail = text.slice(start, text.indexOf(" ", start));
    if (!tail || term.length >= 4 && SUFFIX_ONLY.test(tail)) return true;
  }
  return false;
}
const hasAny = (q, terms) => terms.some(term => hasTerm(q, term));

const STOP_WORDS = new Set(("ve ile icin bir bu su o de da mi mu mi ne nedir neler nasil hangi hangisi hangileri kac kadar gibi daha en cok az var yok ben sen biz ama veya ya ki olarak olan gore lazim "
  + "yapmaliyim yapmali yapilir yapayim yapsam ediyor eder fark wow forever oyun oyunda soru bana beni bilgi ver verir misin soyle soyler anlat anlatir peki acaba simdi sonra once "
  + "ise yarar yariyor yarayan yapar yapiyor olur oluyor demek the of and to in for is a an").split(" "));
export function tokenize(value) { return normalizeText(value).split(" ").filter(word => word.length >= 2 && !STOP_WORDS.has(word)); }

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
  knowledge = { index, byId: new Map(index.map(entry => [entry.card.id, entry])), frequency, names: nameOwners(index) };
  return knowledge;
}
const idf = token => Math.log(1 + CARDS.length / (kb().frequency.get(token) || CARDS.length));

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
  druid: [["feral-ayi", ["feral tank", "feral ayi", "ayi tank", "bear tank", "bear", "ayi", "tank"]], ["balance", ["balance", "boomkin", "moonkin"]],
    ["restoration", ["restoration", "resto", "healer", "heal", "healing", "sifaci"]], ["feral-kedi", ["feral kedi", "feral dps", "feral combat", "feral", "cat", "kedi"]]],
  hunter: [["beast-mastery", ["beast mastery", "beastmastery", "beast master", "beast", "bm"]], ["marksmanship", ["marksmanship", "marksman", "marks", "mm"]], ["survival", ["survival", "surv", "sv"]]],
  mage: [["arcane", ["arcane"]], ["fire", ["fire", "ates"]], ["frost", ["frost", "buz"]]],
  paladin: [["holy", ["holy", "healer", "heal", "healing", "sifaci"]], ["protection", ["protection", "prot", "tank"]], ["retribution", ["retribution", "retri", "ret", "dps"]]],
  priest: [["discipline", ["discipline", "disc", "disiplin"]], ["holy", ["holy"]], ["shadow", ["shadow", "dps", "golge"]]],
  rogue: [["assassination", ["assassination", "assassin", "assa"]], ["combat", ["combat"]], ["subtlety", ["subtlety", "sub"]]],
  shaman: [["elemental", ["elemental", "ele"]], ["enhancement", ["enhancement", "enhance", "enh"]], ["restoration", ["restoration", "resto", "healer", "heal", "healing", "sifaci"]]],
  warlock: [["affliction", ["affliction", "affli", "aff"]], ["demonology", ["demonology", "demo"]], ["destruction", ["destruction", "destro"]]],
  warrior: [["arms", ["arms"]], ["fury", ["fury"]], ["protection", ["protection", "prot", "tank"]]]
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
      else if (/^#{2,4} /.test(line)) candidates.push(line.replace(/^#+ /, "").split(" — ")[0].trim());
      else if (/ — \d+\/\d+/.test(line)) candidates.push(line.replace(/^[-*\d.\s]+/, "").split(" — ")[0].trim());
    }
    for (const raw of candidates) {
      if (!isName(raw)) continue;
      const name = normalizeText(raw); if (name.length < 6 || generic.has(name)) continue;
      if (!owners.has(name)) owners.set(name, { classes: new Set(), cards: new Set() });
      owners.get(name).classes.add(entry.card.classKey);
    }
  }
  for (const [name, owner] of owners) {
    if (owner.classes.size !== 1) { owners.delete(name); continue; }
    for (const entry of index) if (entry.card.classKey === [...owner.classes][0] && entry.norm.includes(` ${name} `)) owner.cards.add(entry.card.id);
  }
  return owners;
}
// Looks up every 1–6 word window of the question; the last word may carry a Turkish ending ("mortal strikei").
function namedInQuestion(q) {
  const names = kb().names, words = q.split(" "), hits = new Map();
  for (let i = 0; i < words.length; i++) {
    for (let n = Math.min(6, words.length - i); n >= 1; n--) {
      const head = n > 1 ? `${words.slice(i, i + n - 1).join(" ")} ` : "", last = words[i + n - 1];
      for (let cut = 0; cut <= Math.min(9, last.length - 1); cut++) {
        if (cut && !SUFFIX_ONLY.test(last.slice(last.length - cut))) continue;
        const name = head + last.slice(0, last.length - cut), owner = names.get(name);
        if (owner && !hits.has(name)) hits.set(name, { name, classKey: [...owner.classes][0], cards: owner.cards });
      }
    }
  }
  return [...hits.values()].sort((a, b) => b.name.length - a.name.length);
}

export function detectClass(question) {
  const q = normalizeText(question); let best = null, bestAt = -1;
  for (const [classKey, aliases] of Object.entries(CLASS_ALIASES)) {
    for (const alias of aliases) {
      if (alias === "war" && !/(?:^| )war(?= |$)/.test(q)) continue;
      if (!hasTerm(q, alias)) continue;
      const at = q.lastIndexOf(alias); if (at > bestAt) { best = classKey; bestAt = at; }
    }
  }
  if (best) return best;
  const named = namedInQuestion(q), classes = new Set(named.map(hit => hit.classKey));
  return classes.size === 1 ? named[0].classKey : null;
}
export function detectSpec(question, classKey) {
  const q = normalizeText(question);
  for (const [spec, aliases] of SPEC_ALIASES[classKey] || []) if (hasAny(q, aliases)) return spec;
  // A talent name that occurs in the cards of a single spec.
  for (const hit of namedInQuestion(q)) {
    if (hit.classKey !== classKey) continue;
    const specs = new Set([...hit.cards].map(id => kb().byId.get(id).card.spec).filter(Boolean));
    if (specs.size === 1) return [...specs][0];
  }
  return null;
}
export function detectFaction(question) {
  const q = normalizeText(question);
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
  cooking: { name: "Cooking", strong: ["cooking", "ascilik", "asci", "yemek yapma", "yemek pisirme"], weak: ["cook", "yemek", "kamp", "camp", "camping", "kamp atesi", "cadir"] },
  enchanting: { name: "Enchanting", strong: ["enchanting", "enchanter", "disenchant", "buyuleme"], weak: ["enchant", "ench"] },
  engineering: { name: "Engineering", strong: ["engineering", "engineer", "muhendislik", "muhendis"], weak: ["eng"] },
  fishing: { name: "Fishing", strong: ["fishing", "balikcilik", "balik tutma", "balik tut", "balik avlama", "olta"], weak: ["balik", "fish"] },
  herbalism: { name: "Herbalism", strong: ["herbalism", "herbalist", "herb", "bitki toplama", "ot toplama", "bitkicilik"], weak: ["bitki", "cicek"] },
  leatherworking: { name: "Leatherworking", strong: ["leatherworking", "leatherworker", "deri isleme", "dericilik", "lw"], weak: [] },
  mining: { name: "Mining", strong: ["mining", "madencilik", "miner", "maden kazma"], weak: ["maden", "cevher", "ore"] },
  skinning: { name: "Skinning", strong: ["skinning", "skinner", "deri yuzme", "deri toplama", "yuzuculuk"], weak: ["skin", "deri"] },
  tailoring: { name: "Tailoring", strong: ["tailoring", "tailor", "terzilik", "terzi"], weak: ["kumas", "canta"] }
};
export const PROFESSION_NAMES = Object.fromEntries(Object.entries(PROFESSIONS).map(([key, value]) => [key, value.name]));
const PROFESSION_WORD = /(?:^| )(?:meslek|meslekler|meslegi|meslekleri|profession|professions|prof)(?= |$)/;
export function detectProfession(question, { allowWeak = true } = {}) {
  const q = normalizeText(question); let best = null, bestAt = -1;
  for (const [key, entry] of Object.entries(PROFESSIONS)) for (const alias of entry.strong) if (hasTerm(q, alias)) { const at = q.lastIndexOf(alias); if (at > bestAt) { best = key; bestAt = at; } }
  if (best || !allowWeak) return best;
  for (const [key, entry] of Object.entries(PROFESSIONS)) for (const alias of entry.weak) if (hasTerm(q, alias)) { const at = q.lastIndexOf(alias); if (at > bestAt) { best = key; bestAt = at; } }
  return best;
}

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
  { names: ["city of dalaran"], weak: ["dalaran"], cards: { "city-of-dalaran": [] } },
  { names: ["drowned city", "drowned"], cards: { "the-drowned-city": [] } },
  { names: ["kroldok stronghold", "krol dok", "kroldok"], cards: { "krol-dok-stronghold": [] } },
  { names: ["uldaman", "ulda"], cards: { uldaman: [] } },
  { names: ["zulfarrak", "zul farrak", "zf"], cards: { zulfarrak: [] } },
  { names: ["maraudon", "mara"], cards: { "maraudon-orange": ["orange", "turuncu"], "maraudon-purple": ["purple", "mor"], maraudon: ["tam", "full", "hepsi", "tamami"], "maraudon-inner": ["inner", "prenses", "princess", "ic bolum", "theradras"] } },
  { names: ["alcaz prison", "alcaz"], cards: { "alcaz-prison": [] } },
  { names: ["blackrock depths", "brd"], cards: { "blackrock-depths-lower": ["alt", "lower", "detention", "detention block", "prison", "arena"], "blackrock-depths": ["tam", "full", "hepsi", "tamami"], "blackrock-depths-upper": ["ust", "upper", "upper city", "emperor", "imparator"] } },
  { names: ["sunken temple", "temple of atal hakkar", "atalhakkar", "atal hakkar"], weak: ["st"], cards: { "sunken-temple": [] } },
  { names: ["dire maul", "diremaul", "dme", "dmw", "dmn"], weak: ["dm"], cards: { "dire-maul-east": ["east", "dogu", "dme"], "dire-maul-west": ["west", "bati", "dmw"], "dire-maul-north": ["north", "kuzey", "dmn", "tribute"] } },
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
export function isDungeonWord(question) { return DUNGEON_WORD.test(normalizeText(question)); }

function levelInQuestion(q) {
  const match = q.match(/(?:^| )(\d{1,2}) ?(?:level|lvl|lv|seviye)\w*|(?:level|lvl|lv|seviye)\w* (\d{1,2})(?= |$)/);
  const level = match ? Number(match[1] || match[2]) : null;
  return level >= 1 && level <= 60 ? level : null;
}
function findDungeonGroup(q) {
  const context = DUNGEON_CONTEXT.test(q), level = levelInQuestion(q), hits = [];
  for (const group of DUNGEON_GROUPS) {
    const strong = group.names.find(name => hasTerm(q, name)), weak = !strong && context && (group.weak || []).find(name => hasTerm(q, name));
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
  leveling: /(?:^| )(?:leveling|levelling|level atla\w*|level kas\w*|kasarken|kasma\w*|build\w*|puan sira\w*|talent sira\w*|dagilim\w*|dagitim\w*|dizilim\w*)(?= |$)/,
  talents: /(?:^| )(?:talent|telent|talant|tallent|tlnt)\w*|yetenek (?:agac|puan)\w*/,
  gameplay: /(?:^| )(?:rotasyon\w*|rotation\w*|oynanis\w*|nasil oynan\w*|oncelik\w*|priority|opener|burst|aoe|cok hedef\w*|tek hedef\w*|hangi sira\w*)(?= |$)|sirayla kullan|ne zaman kullan/,
  abilities: /(?:^| )(?:yetenek\w*|skill\w*|spell\w*|buyu\w*|ability|abilities|form\w*|totem\w*|pet\w*|aura\w*|seal\w*|blessing\w*|curse\w*|stance\w*|durus\w*|buff\w*|debuff\w*|shout\w*|trap\w*|tuzak\w*|poison\w*|zehir\w*|ogren\w*|aciliyor|acilir)(?= |$)/
};
const PROFESSION_INTENT = {
  where: /(?:^| )(?:nerede|nerde|nereden|nerden|nereye|kasil\w*|kasma\w*|kasar\w*|kasayim|kasmak|kasmali\w*|rota\w*|bolge\w*|gelistir\w*|yukselt\w*|ilerlet\w*|level\w*|lvl|skill\w*|basla\w*|topla\w*|tutul\w*|tutma\w*|farm\w*)(?= |$)/,
  recipe: /(?:^| )(?:tarif\w*|recipe\w*|pattern\w*|plan\w*|formula\w*|schematic\w*|uret\w*|craft\w*|hangi item\w*|onemli)(?= |$)/,
  food: /(?:^| )(?:yemek\w*|food|buff\w*|well fed)(?= |$)/,
  camp: /(?:^| )(?:kamp\w*|camp\w*|cadir\w*|ates\w*|campfire)(?= |$)/,
  trainer: /(?:^| )(?:egitmen\w*|trainer\w*|hoca\w*|rutbe\w*|artisan|expert|journeyman|apprentice)(?= |$)/,
  general: /(?:^| )(?:egitmen\w*|trainer\w*|ogren\w*|nedir|ne ise yara\w*|genel|mantikli|deger\w*|rutbe\w*|artisan|expert|journeyman|apprentice|uzmanlik\w*|nasil baslar\w*|nasil baslan\w*)(?= |$)/
};

function rank(entries, words, prior) {
  return entries.map(entry => ({ entry, score: lexicalScore(entry, words) + prior(entry.card) })).sort((a, b) => b.score - a.score || CARDS.indexOf(a.entry.card) - CARDS.indexOf(b.entry.card));
}
function result(category, cards, extra = {}) {
  const first = cards[0];
  return { category, cards, thread: first?.thread || null, forum: first?.forum || null, classKey: null, spec: null, need: null, facts: "", ...extra };
}

function selectProfession(q, key, faction) {
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
  let picked = [];
  if (skill !== null && ranges.length) {
    const containing = ranges.filter(card => skill >= card.range[0] && (skill < card.range[1] || card.range[1] === 300)).filter(factionFit);
    picked = containing.slice(0, 2);
    const upper = picked[0]?.range[1];
    if (picked.length === 1 && upper < 300 && upper - skill <= 10) { const next = ranges.find(card => card.range[0] === upper && factionFit(card)); if (next) picked.push(next); }
  } else if (key === "cooking" && PROFESSION_INTENT.camp.test(q) && byPart("kamp")) picked = [byPart("kamp")];
  else if (key === "cooking" && PROFESSION_INTENT.food.test(q) && !PROFESSION_INTENT.where.test(q) && byPart("yemek")) picked = [byPart("yemek")];
  else if (PROFESSION_INTENT.recipe.test(q) && byPart("tarifler")) picked = [byPart("tarifler")];
  else if (general && (PROFESSION_INTENT.trainer.test(q) || PROFESSION_INTENT.general.test(q) && !PROFESSION_INTENT.where.test(q))) picked = [general];
  else if (PROFESSION_INTENT.where.test(q) && ranges.length) {
    const start = ranges.filter(card => card.range[0] === ranges[0].range[0]).filter(factionFit);
    picked = start.length > 1 ? start.slice(0, 2) : [start[0], general].filter(Boolean);
  } else {
    const ranked = rank(entries, words.filter(word => !PROFESSIONS[key].strong.includes(word)), card => card.part === "genel" ? 1.5 : 0);
    picked = ranked[0].score > 3 ? [ranked[0].entry.card] : [general || ranked[0].entry.card];
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

function selectClass(q, classKey, options) {
  const entries = kb().index.filter(entry => entry.card.classKey === classKey), words = tokenize(q).filter(word => !CLASS_ALIASES[classKey].includes(word));
  const spec = detectSpec(q, classKey) || options.specHint || null;
  const intents = Object.fromEntries(Object.entries(INTENT).map(([name, regex]) => [name, regex.test(q)]));
  intents.leveling = intents.leveling || !!options.talentAdvice;
  // "druid ırk" is a race question; "tauren druid rotasyon" is not.
  if (intents.race && (intents.leveling || intents.gameplay || intents.talents) && !/(?:^| )(?:irk\w*|race|racial\w*)(?= |$)/.test(q)) intents.race = false;
  if (intents.leveling && !spec) {
    // Leveling cards are per spec. Ask for the spec only when the question is about the build itself
    // ("warrior leveling", "rogue build"); "leveling sırasında hangi silah" is a different question.
    const rest = words.filter(word => !INTENT.leveling.test(` ${word} `));
    const whichSpec = /hangi (?:spec|spek|uzmanlik|dal|agac)\w*/.test(q), other = intents.gameplay || intents.abilities || intents.race;
    if (!whichSpec && (options.talentAdvice || intents.talents || /(?:^| )(?:build|puan|dagilim|dagitim|dizilim)\w*/.test(q) || !rest.length || rest.length === 1 && !other)) return result("class", [], { classKey, need: "spec", forum: entries[0]?.card.forum, thread: entries[0]?.card.thread });
    intents.leveling = false;
  }
  const named = namedInQuestion(q).filter(hit => hit.classKey === classKey);
  const prior = card => {
    let value = named.some(hit => hit.cards.has(card.id)) ? 4 : 0;
    if (card.spec && spec) value += card.spec === spec ? 3 : -4;
    if (card.kind === "race") value += intents.race ? 8 : -2;
    if (card.kind === "leveling") value += intents.leveling ? 8 : -3;
    if (card.kind === "talents") value += intents.talents && !intents.leveling ? 5 : 0;
    if (card.kind === "gameplay") value += intents.gameplay ? 6 : -1;
    if (card.kind === "abilities") value += intents.abilities && !intents.talents && !intents.leveling ? 3 : 0;
    return value;
  };
  const ranked = rank(entries, words, prior), top = ranked[0];
  const anyIntent = Object.values(intents).some(Boolean);
  if (!top || !anyIntent && top.score < 4) return null;
  if (top.score <= 0) return null;
  const cards = [top.entry.card], second = ranked[1];
  if (second && second.score >= 5 && second.score >= top.score * 0.8 && !(intents.leveling || intents.race)) cards.push(second.entry.card);
  return result("class", cards, { classKey, spec, intents, siblings: [] });
}

// options: { classHint, specHint, talentAdvice }
export function selectCards(question, options = {}) {
  const q = normalizeText(question); if (!q) return null;
  const named = detectClass(q), classKey = named || options.classHint || null, faction = detectFaction(q);
  const profession = detectProfession(q, { allowWeak: !named });
  if (profession) return selectProfession(q, profession, faction);
  const group = findDungeonGroup(q);
  const classTopic = !!named && /(?:^| )(?:stat|talent|rotasyon|rotation|spell|skill|buff|ability|gear|ekipman|silah|irk|build|pet|aggro|threat|heal|tank|dps)\w*/.test(q);
  if (group && !classTopic) return selectDungeon(q, group);
  if (!named && !group && DUNGEON_WORD.test(q)) {
    const level = levelInQuestion(q), overview = dungeonOverview(level), first = [...DUNGEON_CARDS.values()][0];
    return result("dungeon", overview.cards, { general: true, level, facts: overview.text, localAnswer: overview.text, forum: first?.forum || null, thread: overview.cards.length === 1 ? overview.cards[0].thread : null });
  }
  // "shaman için hangi meslek": the cards hold no profession advice per class.
  if (classKey && !/(?:^| )(?:meslek|meslegi|meslekler|profession|professions|prof)\w*/.test(q)) {
    const selection = selectClass(q, classKey, options);
    if (selection) return selection;
  }
  if (options.talentAdvice && !classKey) return result("class", [], { need: "class", forum: CARDS.find(card => card.category === "class")?.forum || null });
  return null;
}

// ------------------------------------------------------------
// Context for the answer, and a model-free fallback answer
// ------------------------------------------------------------
export function buildCardContext(selection, limit = 16000) {
  const parts = []; let used = 0;
  if (selection.facts) { parts.push(`ÖZET BİLGİ:\n${selection.facts}`); used += selection.facts.length; }
  for (const card of selection.cards) {
    const text = card.text.slice(0, Math.max(1500, limit - used - 1500 * (selection.cards.length - 1)));
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

function readableLine(line, header) {
  if (!line.startsWith("|")) return line.replace(/^[-•*]\s*/, "").replace(/^#+\s*/, "");
  const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
  if (cells.every(cell => /^[-:\s]*$/.test(cell))) return "";
  const rest = cells.slice(1).map((cell, i) => cell && cell !== "—" ? `${header?.[i + 1] ? `${header[i + 1]}: ` : ""}${cell}` : "").filter(Boolean);
  return cells[0] ? `**${cells[0]}**${rest.length ? `: ${rest.join(" · ")}` : ""}` : "";
}
// Used only when the AI step fails: the lines of the chosen cards that share most words with the question.
export function localCardAnswer(selection, question) {
  if (selection.localAnswer) return selection.localAnswer;
  if (selection.category === "dungeon" && selection.cards.length) return selection.cards.map(dungeonLine).join("\n");
  const words = tokenize(question), lines = [];
  for (const card of selection.cards) {
    let header = null;
    for (const raw of card.text.split("\n")) {
      const line = raw.trim();
      if (!line.startsWith("|")) header = null;
      if (!line || /^#/.test(line) || /^(?:Üst bilgi|Sol üst|Sağ üst|Kart başlığı|Marka|Rozet|Kartta )/.test(line)) continue;
      if (line.startsWith("|") && !header) { header = line.split("|").slice(1, -1).map(cell => cell.trim()); continue; }
      const text = readableLine(line, header).replace(/^\(ikon\)\s*(?:—\s*)?/, ""); if (text.length < 12 || lines.some(known => known.text === text)) continue;
      const tokens = new Set(normalizeText(text).split(" "));
      lines.push({ text, order: lines.length, score: words.reduce((sum, word) => sum + (tokens.has(word) ? idf(word) : 0), 0) });
    }
  }
  const best = lines.filter(line => line.score > 0).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 3).sort((a, b) => a.order - b.order);
  return best.map(line => `• ${line.text.slice(0, 420)}`).join("\n");
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
