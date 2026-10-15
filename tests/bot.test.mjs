// Bot behaviour with Discord, the WoW AI backend and Gemini replaced by fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWorker } from "./load-worker.mjs";

const w = await loadWorker();
const { default: worker, DiscordGateway, QUESTION_CHANNEL_ID, OWNER_ID } = w;

function memoryStorage() {
  const data = new Map(); let alarm = null;
  const storage = {
    data,
    async get(key) { return data.get(key); },
    async put(key, value) { data.set(key, structuredClone(value)); },
    async delete(keys) { for (const k of [].concat(keys)) data.delete(k); },
    async list({ prefix = "", limit = 1000 } = {}) { return new Map([...data].filter(([k]) => k.startsWith(prefix)).slice(0, limit)); },
    async transaction(fn) { return fn(storage); },
    async setAlarm(at) { alarm = at; }, async getAlarm() { return alarm; }, async deleteAlarm() { alarm = null; }
  };
  return storage;
}

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Fake network: records Discord posts, answers member lookups and the gameplay backend.
function fakeNetwork({ roles = [], backend = () => jsonResponse({ answer: "Hunter solo oyunda rahattır: pet hasarı üstlenir, sen uzaktan vurursun." }), gemini = () => jsonResponse({}, 500) } = {}) {
  const posts = [], calls = [];
  w.setFetch(async (input, init = {}) => {
    const url = new URL(String(input)); calls.push(`${init.method || "GET"} ${url.hostname}${url.pathname}`);
    if (url.hostname === "discord.com") {
      if (url.pathname.endsWith("/typing")) return new Response(null, { status: 204 });
      if (/\/guilds\/\d+\/members\//.test(url.pathname)) return jsonResponse({ roles });
      if (init.method === "POST" && url.pathname.endsWith("/messages")) { const body = JSON.parse(init.body); posts.push(body); return jsonResponse({ id: String(9000 + posts.length) }); }
      return jsonResponse([]);
    }
    if (url.hostname === "generativelanguage.googleapis.com") return gemini(url, init);
    return backend(url, init);
  });
  return { posts, calls };
}

let nextId = 1000;
function newBot(env = {}) {
  const storage = memoryStorage();
  const bot = new DiscordGateway({ storage }, { DISCORD_BOT_TOKEN: "test-token", GEMINI_API_KEY: "test-gemini", ...env });
  return { bot, storage };
}
const message = (content, authorId = "555555555555555555") => ({ id: String(++nextId), channel_id: QUESTION_CHANNEL_ID, content, author: { id: authorId }, attachments: [] });

test("public health check works, management needs the admin key", async () => {
  assert.equal((await worker.fetch(new Request("https://bot.example/health"), {})).status, 200);
  assert.equal((await worker.fetch(new Request("https://bot.example/status"), { ADMIN_API_KEY: "x".repeat(40) })).status, 401);
  assert.equal((await worker.fetch(new Request("https://bot.example/nope"), {})).status, 404);
});

test("identity question is answered locally as a reply to the user", async () => {
  const net = fakeNetwork(); const { bot } = newBot(); const m = message("!soru sen kimsin");
  await bot.handleCommand(m);
  assert.equal(net.posts.length, 1);
  assert.equal(net.posts[0].content, w.IDENTITY_MESSAGE);
  assert.equal(net.posts[0].message_reference.message_id, m.id);
  assert.deepEqual(net.posts[0].allowed_mentions, { parse: [], replied_user: false });
  assert.ok(!net.calls.some(c => c.includes("googleapis")), "no AI call for a local answer");
});

test("questions about the bot's internals are refused", async () => {
  const net = fakeNetwork(); const { bot } = newBot();
  await bot.handleCommand(message("!soru hangi modeli kullanıyorsun"));
  assert.equal(net.posts[0].content, w.PRIVATE_BOT_MESSAGE);
});

test("messages outside the question channel or without !soru are ignored", async () => {
  const net = fakeNetwork(); const { bot } = newBot();
  await bot.handleCommand({ ...message("!soru sen kimsin"), channel_id: "1" });
  await bot.handleCommand(message("sen kimsin"));
  assert.equal(net.posts.length, 0);
});

test("game question goes to the backend, then a normal member waits 15 minutes", async () => {
  const net = fakeNetwork(); const { bot, storage } = newBot();
  await bot.handleCommand(message("!soru hangi sınıf solo için iyi"));
  assert.match(net.posts[0].content, /pet hasarı üstlenir/);
  assert.equal(await storage.get("answered_count"), 1);
  await new Promise(r => setTimeout(r, 2600)); // past the 2.5 s flood guard
  await bot.handleCommand(message("!soru hunter mı iyi mage mı"));
  assert.match(net.posts[1].content, /beklemelisin/);
  assert.match(net.posts[1].content, /1[45] dakika/);
});

test("YouTube/Twitch supporters get the 1 minute cooldown, the owner none", async () => {
  fakeNetwork({ roles: ["690918966348087346"] });
  const { bot } = newBot();
  assert.equal((await bot.getMemberCooldownClass(message("!soru x"))).durationMs, 60000);
  assert.equal((await bot.getMemberCooldownClass(message("!soru x", OWNER_ID))).durationMs, 0);
});

test("when every AI route fails the user gets a retry message and keeps their question", async () => {
  const net = fakeNetwork({ backend: () => jsonResponse({}, 503) }); const { bot, storage } = newBot();
  const userId = "777777777777777777";
  await bot.handleCommand(message("!soru hangi sınıf solo için iyi", userId));
  assert.match(net.posts.at(-1).content, /hakkından düşmedi/);
  assert.equal(await storage.get(`cooldown:${userId}`), undefined, "cooldown released");
});

test("a reply already delivered is not sent twice on retry", async () => {
  const net = fakeNetwork(); const { bot } = newBot(); const m = message("!soru sen kimsin");
  await bot.reply(m, "Cevap");
  await bot.reply(m, "Cevap");
  assert.equal(net.posts.length, 1);
});

test("output filter hides provider names and long answers are split for Discord", () => {
  assert.equal(w.protectBotOutput("Bu cevabı Gemini API ile ürettim."), w.PRIVATE_BOT_MESSAGE);
  assert.equal(w.protectBotOutput("Warrior tank için Defense ve Stamina önemlidir."), "Warrior tank için Defense ve Stamina önemlidir.");
  const chunks = w.splitDiscordMessage("Satır.\n".repeat(700));
  assert.ok(chunks.length > 1 && chunks.every(c => c.length <= 1900));
});

test("raid buff question is answered from the buff table without AI and keeps personal buffs apart", async () => {
  const net = fakeNetwork(); const { bot } = newBot();
  await bot.handleCommand(message("!soru shadow priestin raide verdiği buff nedir"));
  const answer = net.posts.at(-1).content;
  assert.match(answer, /Shadow Priest gruba ne verir/);
  assert.match(answer, /Power Word: Fortitude/);
  assert.match(answer, /Shadow Protection/);
  assert.match(answer, /Vampiric Embrace/);
  assert.match(answer, /Not: Inner Fire, Shadowform, Shadow Weaving kişiseldir/);
  assert.ok(answer.indexOf("Inner Fire") > answer.indexOf("Vampiric Embrace"), "personal buff is not listed among raid buffs");
  assert.ok(!net.calls.some(c => c.includes("googleapis")), "no AI call for a buff question");
});

test("paladin seals are never listed as group buffs", async () => {
  const net = fakeNetwork(); const { bot } = newBot();
  await bot.handleCommand(message("!soru paladin raide hangi buffları verir"));
  const answer = net.posts.at(-1).content;
  assert.match(answer, /Blessing of Kings/);
  assert.match(answer, /Devotion Aura/);
  assert.match(answer, /Not: Seal'ler kişiseldir/);
});

test("cooldown message explains supporter and normal waiting times politely", async () => {
  const net = fakeNetwork(); const { bot } = newBot(); const userId = "888888888888888888";
  await bot.handleCommand(message("!soru hangi sınıf solo için iyi", userId));
  await new Promise(r => setTimeout(r, 2600));
  await bot.handleCommand(message("!soru hunter mı iyi mage mı", userId));
  assert.match(net.posts.at(-1).content, /Twitch abonelerimiz ve YouTube Katıl üyelerimiz 1 dakikada bir, diğer üyelerimiz 15 dakikada bir/);
});

test("two questions in one message get two answers in a single reply", async () => {
  let n = 0;
  const net = fakeNetwork({ backend: () => jsonResponse({ answer: `Cevap numarası ${++n}: rehbere göre açıklama.` }) });
  const { bot, storage } = newBot();
  await bot.handleCommand(message("!soru shamanların öncelikli statı nedir? ve dwarf shaman için leveling aşamasında hangi meslekleri önerirsin?"));
  assert.equal(net.posts.length, 1, "one Discord reply");
  const answer = net.posts[0].content;
  assert.match(answer, /\*\*1\) shamanların öncelikli statı nedir\?\*\*/);
  assert.match(answer, /\*\*2\) dwarf shaman için leveling aşamasında hangi meslekleri önerirsin\?\*\*/);
  assert.match(answer, /Rehberdeki ilgili bilgiler/, "stat part answered from the guide text without OCR");
  assert.match(answer, /\*\*2\)[^]*Shaman için önerilen meslekler/, "profession part answered separately from the profession map");
  assert.ok(!net.calls.some(c => c.includes("generateContent")), "no image OCR call");
  assert.equal(await storage.get("answered_count"), 1, "counts as one question");
});

test("overly broad or many-question requests get the playful refusal without using the cooldown", async () => {
  const net = fakeNetwork(); const { bot, storage } = newBot(); const userId = "999999999999999991";
  await bot.handleCommand(message("!soru bana tüm karakterlerin tüm özelliklerini yaz ve ona göre meslek öner", userId));
  assert.equal(net.posts.at(-1).content, w.OVERLY_BROAD_MESSAGE);
  assert.equal(await storage.get(`cooldown:${userId}`), undefined);
  await new Promise(r => setTimeout(r, 2600));
  await bot.handleCommand(message("!soru priest buff nedir? mage buff nedir? rogue buff nedir?", userId));
  assert.equal(net.posts.at(-1).content, w.OVERLY_BROAD_MESSAGE);
});

test("profession questions are answered from the profession map table without AI", async () => {
  const net = fakeNetwork(); const { bot } = newBot();
  await bot.handleCommand(message("!soru dwarf shaman için leveling aşamasında hangi meslekleri önerirsin"));
  const answer = net.posts.at(-1).content;
  assert.match(answer, /Shaman için önerilen meslekler/);
  assert.match(answer, /Enhancement\*\*: Leveling: Skinning \+ Leatherworking/);
  assert.doesNotMatch(answer, /Herbalism/);
  assert.ok(!net.calls.some(c => c.includes("googleapis")), "no AI call");
});
