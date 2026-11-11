// Bot behaviour with Discord, the WoW AI backend and Gemini replaced by fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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

const geminiText = text => jsonResponse({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text }] }] });
const FORUMS = { class: "700000000000000001", dungeon: "700000000000000002", profession: "700000000000000003" };
const TOPICS = Array.from(w.CARD_TOPICS, (topic, i) => ({ id: String(800000000000000000n + BigInt(i)), category: topic.category, name: topic.thread, files: Array.from(topic.cards, card => card.file) }));
const topicId = name => TOPICS.find(topic => topic.name === name).id;

// Fake network: records Discord posts, answers member lookups, the gameplay backend and the three
// guide forums (one post per topic, the cards as attachments of its first message).
function fakeNetwork({ roles = [], backend = () => jsonResponse({ answer: "Hunter solo oyunda rahattır: pet hasarı üstlenir, sen uzaktan vurursun." }), gemini = () => jsonResponse({}, 500), missingFiles = [], fileSize = 2048, archived = [] } = {}) {
  const posts = [], calls = [], prompts = [];
  const threadJson = topic => ({ id: topic.id, parent_id: FORUMS[topic.category], name: topic.name, thread_metadata: { archive_timestamp: "2026-11-10T00:00:00.000Z" } });
  w.setFetch(async (input, init = {}) => {
    const url = new URL(String(input)); calls.push(`${init.method || "GET"} ${url.hostname}${url.pathname}`);
    if (url.hostname === "cdn.discordapp.com") return new Response(new Uint8Array(64), { status: 200, headers: { "content-type": "image/png" } });
    if (url.hostname === "discord.com") {
      const path = url.pathname.replace(/^\/api\/v\d+/, "");
      if (path.endsWith("/typing")) return new Response(null, { status: 204 });
      if (/\/guilds\/\d+\/members\//.test(path)) return jsonResponse({ roles });
      if (init.method === "POST" && path.endsWith("/messages")) {
        const form = typeof init.body === "string" ? null : init.body, body = form ? JSON.parse(form.get("payload_json")) : JSON.parse(init.body);
        posts.push({ ...body, files: form ? [...form.keys()].filter(key => key.startsWith("files[")).map(key => form.get(key).name) : [] });
        return jsonResponse({ id: String(9000 + posts.length) });
      }
      if (/^\/guilds\/\d+\/channels$/.test(path)) return jsonResponse([{ id: FORUMS.class, type: 15, name: "class-rehberleri" }, { id: FORUMS.dungeon, type: 15, name: "zindan-rehberleri" }, { id: FORUMS.profession, type: 15, name: "meslek-rehberleri" }, { id: "1", type: 0, name: "genel" }]);
      if (/^\/guilds\/\d+\/threads\/active$/.test(path)) return jsonResponse({ threads: TOPICS.filter(topic => !archived.includes(topic.name)).map(threadJson) });
      const forum = path.match(/^\/channels\/(\d+)\/threads\/archived\/public$/);
      if (forum) return jsonResponse({ threads: TOPICS.filter(topic => archived.includes(topic.name) && FORUMS[topic.category] === forum[1]).map(threadJson), has_more: false });
      const thread = path.match(/^\/channels\/(\d+)\/messages$/), topic = thread && TOPICS.find(t => t.id === thread[1]);
      if (topic) return jsonResponse([{ id: `${topic.id}1`, attachments: topic.files.filter(file => !missingFiles.includes(file)).map((file, i) => ({ id: `${topic.id}${i}`, filename: file, size: fileSize, content_type: "image/png", url: `https://cdn.discordapp.com/attachments/${topic.id}/${i}/${file}?ex=1&is=2&hm=3` })) }]);
      return jsonResponse([]);
    }
    if (url.hostname === "generativelanguage.googleapis.com") { prompts.push(String(init.body)); return gemini(url, init); }
    return backend(url, init);
  });
  return { posts, calls, prompts };
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

test("cooldown message explains supporter and normal waiting times politely", async () => {
  const net = fakeNetwork(); const { bot } = newBot(); const userId = "888888888888888888";
  await bot.handleCommand(message("!soru hangi sınıf solo için iyi", userId));
  await new Promise(r => setTimeout(r, 2600));
  await bot.handleCommand(message("!soru hunter mı iyi mage mı", userId));
  assert.match(net.posts.at(-1).content, /Twitch Sub ve YouTube Katıl aboneleri için bekleme süresi 1 dakika, normal üyeler için 15 dakikadır\./);
});

test("two questions in one message get two answers in a single reply, each with its own source", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("Skill 75–225 arasında kartta yazan göllerde tutabilirsin.") });
  const { bot, storage } = newBot();
  await bot.handleCommand(message("!soru fishing 150 skill nerede kasılır? ve onyxia attunement nasıl yapılır?"));
  assert.equal(net.posts.length, 1, "one Discord reply");
  const answer = net.posts[0].content;
  assert.match(answer, /\*\*1\) fishing 150 skill nerede kasılır\?\*\*\nSkill 75–225/);
  assert.match(answer, new RegExp(`<#${topicId("Fishing")}> konusuna bakabilirsin`), "card part links its topic");
  assert.match(answer, /\*\*2\) onyxia attunement nasıl yapılır\?\*\*\nHunter solo/, "second part answered by the backend");
  assert.deepEqual(net.posts[0].files, ["fish-75-225.png"]);
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

test("a 'bilgi bulamadım' reply from the backend falls back to the general answer", async () => {
  const net = fakeNetwork({
    backend: () => jsonResponse({ answer: "Bu konuda güvenilir bilgi bulamadım." }),
    gemini: () => jsonResponse({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Onyxia için önce Blackrock Spire tarafındaki görev zincirini tamamlaman gerekir." }] }] })
  });
  const { bot } = newBot();
  await bot.handleCommand(message("!soru onyxia attunement nasıl yapılır"));
  assert.match(net.posts[0].content, /görev zincirini/);
  assert.ok(!/bulamadım/.test(net.posts[0].content));
});

test("no-info detection only catches short not-found replies", () => {
  assert.ok(w.isNoInfoAnswer("Bu konuda bilgi bulunamadı."));
  assert.ok(w.isNoInfoAnswer("Üzgünüm, bilgi yok."));
  assert.ok(!w.isNoInfoAnswer("Warrior için Strength en önemli stattır; hit cap sonrası crit gelir."));
  assert.ok(!w.isNoInfoAnswer(`Uzun cevap. ${"Detay ".repeat(80)} Bir kısmını bulamadım.`));
});

test("stray symbols the model sometimes emits are removed, Turkish letters stay", () => {
  assert.equal(w.usableGameAnswer("Rota şu şekildedʘ̂: Goldshire'ı geç, güneye İlerle."), "Rota şu şekilded: Goldshire'ı geç, güneye İlerle.");
});

test("'guild var mı' gets a direct yes with the channels, without robotic disclaimers", async () => {
  const net = fakeNetwork(); const { bot } = newBot();
  await bot.handleCommand(message("!soru wow forever guild var mı"));
  const answer = net.posts[0].content;
  assert.match(answer, /^Evet, Totik Channel'ın WoW Forever guild'i var\./);
  assert.match(answer, /Alliance/);
  assert.match(answer, /başvuru açıklamasını takip edebilirsin/);
  assert.ok(!/uydurmam/.test(answer));
});

test("racial questions skip the outdated backend and the model gets the verified racials", async () => {
  let sent = "";
  const net = fakeNetwork({
    backend: () => jsonResponse({ answer: "Human Spirit Spirit'i %5 artırır." }),
    gemini: (url, init) => { sent = init.body; return jsonResponse({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "Human Spirit artık Spirit'i %10 artırıyor." }] }] }); }
  });
  const { bot } = newBot();
  await bot.handleCommand(message("!soru human spirit ne işe yarar"));
  assert.match(net.posts[0].content, /%10/);
  assert.match(sent, /The Human Spirit Spirit \+%10/);
  assert.match(sent, /Berserking 15 sn Haste \+%10/);
  assert.match(sent, /Command Hunter ve Warlock pet hasarı \+%5/);
  assert.ok(!net.calls.some(c => c.includes("totik-ai-test")), "backend not asked");
  assert.ok(w.isForeverChangeTopic("orc ırkı hunter için iyi mi"));
  assert.ok(!w.isForeverChangeTopic("onyxia attunement nasıl yapılır"));
});

test("watchdog restarts a broken polling chain but respects /stop", async () => {
  const { bot, storage } = newBot();
  assert.equal(await storage.getAlarm(), null);
  assert.equal((await bot.watchdog()).restarted, true);
  assert.ok(await storage.getAlarm() > Date.now());
  assert.equal((await bot.watchdog()).restarted, false, "healthy future alarm is left alone");
  await storage.put("polling_enabled", false); await storage.deleteAlarm();
  assert.equal((await bot.watchdog()).restarted, false);
  assert.equal(await storage.getAlarm(), null);
});

test("cron trigger calls the watchdog", async () => {
  let called = null; const waits = [];
  const env = { GATEWAY: { idFromName: n => n, get: () => ({ fetch: async req => { called = new URL(req.url).pathname; return new Response("{}"); } }) } };
  await worker.scheduled({}, env, { waitUntil: p => waits.push(p) }); await Promise.all(waits);
  assert.equal(called, "/watchdog");
});

test("health explains why the bot is silent", async () => {
  const { bot, storage } = newBot();
  w.setFetch(async () => jsonResponse({ message: "401: Unauthorized", code: 0 }, 401));
  await bot.alarm();
  assert.equal((await bot.healthSummary()).durum, "discord_token_gecersiz");
  assert.ok(await storage.getAlarm(), "alarm chain keeps going after an error");

  const { bot: bot2, storage: s2 } = newBot();
  await s2.put("initialized", true); await s2.put("last_message_id", "1");
  w.setFetch(async () => jsonResponse([{ id: "2", type: 0, content: "", author: { id: "5" }, attachments: [], embeds: [] }]));
  await bot2.alarm();
  assert.equal((await bot2.healthSummary()).durum, "mesaj_icerigi_okunamiyor");

  w.setFetch(async () => jsonResponse([{ id: "3", type: 0, content: "selam", author: { id: "5" }, attachments: [] }]));
  await bot2.alarm();
  const h = await bot2.healthSummary(); assert.equal(h.durum, "calisiyor"); assert.equal(h.ok, true);

  await s2.put("polling_enabled", false);
  assert.equal((await bot2.healthSummary()).durum, "durduruldu");
});

// ---------- Cards ----------

test("a profession question gets a short answer from the card text, the card images and the topic link", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("Seviye değil Fishing skill'i belirleyici. 1–75 arası başlangıç bölgelerinde tutabilirsin.") });
  const { bot } = newBot();
  await bot.handleCommand(message("!soru fishing hangi levelde nerde yapmalıyım fark ediyor mu"));
  assert.equal(net.posts.length, 1);
  const post = net.posts[0];
  assert.match(post.content, /^Seviye değil Fishing skill'i belirleyici\./);
  assert.equal(post.content.split("\n\n").at(-1), `📌 Bu konuda detaylı bilgi için <#${topicId("Fishing")}> konusuna bakabilirsin.`);
  assert.deepEqual(post.files, ["fish-1-75.png", "fish-genel.png"], "the cards are attached to the answer");
  assert.equal(net.prompts.length, 1, "one AI call");
  assert.match(net.prompts[0], /Brightwater Lake/, "the model answers from the full card text");
  assert.ok(!net.calls.some(c => c.includes("workers.dev")), "the old backend is not asked");
});

test("the forum is read once: the topic list is kept and only the needed card is downloaded", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("Kartta yazan rotayı izle.") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru mining 200 nerede kasarım", "600000000000000001"));
  await bot.handleCommand(message("!soru mining 100 nerede kasarım", "600000000000000002"));
  const count = pattern => net.calls.filter(c => pattern.test(c)).length;
  assert.equal(count(/\/guilds\/\d+\/channels$/), 1, "forum list scanned once");
  assert.equal(count(/\/threads\/active$/), 1);
  assert.equal(count(new RegExp(`/channels/${topicId("Mining")}/messages$`)), 1, "the Mining topic is read once");
  assert.equal(net.posts.length, 2);
  assert.deepEqual(net.posts[0].files, ["mining-175-245.png"]);
  assert.equal(count(/cdn\.discordapp\.com/), net.posts[0].files.length + net.posts[1].files.length, "one download per card that is sent");
});

test("archived forum topics are found too", async () => {
  const net = fakeNetwork({ archived: ["Fishing"], gemini: () => geminiText("Skill 75–225 arasında kartta yazan yerlerde tut.") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru fishing 150 skill nerede kasılır"));
  assert.deepEqual(net.posts[0].files, ["fish-75-225.png"]);
  assert.match(net.posts[0].content, new RegExp(`<#${topicId("Fishing")}>`));
});

test("when the model is down the answer is still built from the card", async () => {
  const net = fakeNetwork(); const { bot } = newBot();
  await bot.handleCommand(message("!soru deadmines kaç levelde girilir"));
  const post = net.posts.at(-1);
  assert.match(post.content, /Deadmines.*önerilen seviye 19, bölge Westfall/);
  assert.match(post.content, /Görev: Horde 0 · Alliance 6/);
  assert.deepEqual(post.files, ["03-deadmines.png".replace(/^.*$/, w.CARDS.find(c => c.id === "zindan-03-deadmines").file)]);
  assert.match(post.content, new RegExp(`<#${topicId("Lv 19 · Deadmines (DM)")}> konusuna bakabilirsin`));
  assert.ok(!post.content.includes("1569329251981860984"), "no second dungeon note");
});

test("a question the card does not cover falls back to the normal answer, without a card", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("KARTTA_YOK") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru rogue poison nereden alınır"));
  assert.match(net.posts[0].content, /pet hasarı üstlenir/);
  assert.deepEqual(net.posts[0].files, []);
  assert.ok(!net.posts[0].content.includes("konusuna bakabilirsin"));
});

test("a card missing from the forum or too large to send does not block the answer", async () => {
  const file = w.CARDS.find(c => c.id === "mage-01-irk-secimi").file;
  let net = fakeNetwork({ missingFiles: [file], gemini: () => geminiText("Gnome ve Human, Mage için karttaki iki Alliance seçeneği.") }); let { bot } = newBot();
  await bot.handleCommand(message("!soru mage ırk seçimi"));
  assert.match(net.posts[0].content, /^Gnome ve Human/);
  assert.deepEqual(net.posts[0].files, []);
  assert.match(net.posts[0].content, new RegExp(`<#${topicId("Mage")}> konusuna bakabilirsin`));

  net = fakeNetwork({ fileSize: 11 * 1024 * 1024, gemini: () => geminiText("Gnome ve Human, Mage için karttaki iki Alliance seçeneği.") }); ({ bot } = newBot());
  await bot.handleCommand(message("!soru mage ırk seçimi"));
  assert.deepEqual(net.posts[0].files, []);
  assert.ok(!net.calls.some(c => c.includes("cdn.discordapp.com")), "an oversized card is not downloaded");
  assert.match(net.posts[0].content, new RegExp(`<#${topicId("Mage")}> konusuna bakabilirsin`));
});

test("talent advice: the bot asks for class and spec, then sends that spec's leveling card", async () => {
  for (const q of ["hangi talenti seçmeliyim", "talent ne yapmalıyım", "talentlerimi nereye basayım", "1-60 talent sırası"]) {
    const net = fakeNetwork(); const { bot } = newBot();
    await bot.handleCommand(message(`!soru ${q}`));
    assert.equal(net.posts.length, 1, q);
    assert.equal(net.posts[0].content, w.TALENT_ADVICE_MESSAGE, q);
    assert.match(net.posts[0].content, /<#1569040165048160378>/);
    assert.ok(!net.calls.some(c => c.includes("googleapis") || c.includes("workers.dev")), `no AI call for: ${q}`);
  }
  const net = fakeNetwork({ gemini: () => geminiText("Arms'ta ilk puanlar karttaki sırayla Deflection ve Improved Rend'e gider.") });
  const { bot, storage } = newBot(); const userId = "666666666666666661";
  await bot.handleCommand(message("!soru warrior talent nasıl dağıtılır", userId));
  assert.match(net.posts[0].content, /^Warrior için hangi uzmanlığı soruyorsun\? Arms, Fury, Protection/);
  assert.equal(await storage.get(`cooldown:${userId}`), undefined, "asking back does not use the cooldown");
  await new Promise(r => setTimeout(r, 2600));
  await bot.handleCommand(message("!soru arms", userId));
  assert.deepEqual(net.posts[1].files, [w.CARDS.find(c => c.id === "warrior-08-arms-leveling").file]);
  assert.match(net.posts[1].content, new RegExp(`<#${topicId("Warrior")}> konusuna bakabilirsin`));
  assert.ok(!net.posts[1].content.includes("1569040165048160378"), "the card link replaces the talent channel note");
});

test("a named spec gets its leveling card straight away", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("Fury'de puanlar karttaki sırayla Cruelty ile başlar.") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru fury warrior build önerisi"));
  assert.deepEqual(net.posts[0].files, [w.CARDS.find(c => c.id === "warrior-09-fury-leveling").file]);
});

test("talent questions without a card keep their answer and point to the leveling-talent channel once", async () => {
  for (const q of ["Improved Heroic Strike talenti ne işe yarar", "deep wounds nedir", "talent ne zaman açılıyor"]) assert.equal(w.isTalentAdviceQuestion(q), false, q);
  const net = fakeNetwork({ backend: () => jsonResponse({ answer: "Talent puanları 10. seviyede açılır ve her seviyede bir puan gelir." }) });
  const { bot } = newBot();
  await bot.handleCommand(message("!soru talent ne zaman açılıyor"));
  const text = net.posts.map(p => p.content).join("\n");
  assert.match(text, /Talentlerini nasıl dağıtacağını bilmiyorsan <#1569040165048160378> kanalına bak/);
  assert.equal(text.match(/1569040165048160378/g).length, 1);
});

test("non-talent questions get no talent channel note", async () => {
  const net = fakeNetwork(); const { bot } = newBot();
  await bot.handleCommand(message("!soru hunter solo oyunda iyi mi"));
  assert.ok(net.posts.length >= 1);
  assert.ok(!net.posts.some(p => p.content.includes("1569040165048160378")));
});

test("general dungeon questions get the dungeon list and the dungeon forum, without an AI call", async () => {
  for (const q of ["hangi dungeona gideyim", "zindan önerisi", "30 level hangi dungeon"]) {
    const net = fakeNetwork(); const { bot } = newBot();
    await bot.handleCommand(message(`!soru ${q}`));
    assert.equal(net.posts.length, 1, q);
    assert.match(net.posts[0].content, /Razorfen Kraul/, q);
    assert.ok(net.posts[0].content.endsWith(`📌 Bu konuda detaylı bilgi için <#${FORUMS.dungeon}> kanalına bakabilirsin.`), q);
    assert.ok(net.posts[0].files.length <= 1, q);
    assert.ok(!net.calls.some(c => c.includes("googleapis") || c.includes("workers.dev")), `no AI call for: ${q}`);
  }
  assert.equal(w.isDungeonQuestion("instagram hesabın ne"), false);
  assert.equal(w.isDungeonQuestion("dm at bana"), false);
});

test("class questions that mention a dungeon keep their answer and get the dungeon note once", async () => {
  assert.equal(w.isDungeonInfoQuestion("dungeonda warrior tank hangi stat"), false);
  const net = fakeNetwork({ gemini: () => geminiText("KARTTA_YOK") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru hunter dungeonda pet aggro nasıl yönetilir"));
  const text = net.posts.map(p => p.content).join("\n");
  assert.match(text, /Dungeon rotaları, levelleri ve görevleri için <#1569329251981860984> kanalına bak/);
  assert.equal(text.match(/1569329251981860984/g).length, 1);
});

test("card check reports which topics and cards the bot can see in the forums", async () => {
  fakeNetwork(); let { bot } = newBot();
  let report = await bot.buildCardCheck();
  assert.equal(report.ok, true); assert.equal(report.found, 189);
  assert.deepEqual(JSON.parse(JSON.stringify(report.forums)), FORUMS);

  const file = w.CARDS.find(c => c.id === "fish-genel").file;
  fakeNetwork({ missingFiles: [file] }); ({ bot } = newBot());
  report = await bot.buildCardCheck();
  assert.equal(report.ok, false);
  assert.deepEqual(Array.from(report.missingCards), ["fish-genel"]);
});
