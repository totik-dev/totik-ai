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
function fakeNetwork({ roles = [], backend = () => jsonResponse({ answer: "Hunter solo oyunda rahattır: pet hasarı üstlenir, sen uzaktan vurursun." }), gemini = () => jsonResponse({}, 500), missingFiles = [], fileSize = 2048, archived = [], longPost = false, scanFails = false, guildRoles = [] } = {}) {
  const posts = [], calls = [], prompts = [];
  const threadJson = topic => ({ id: topic.id, parent_id: FORUMS[topic.category], name: topic.name, thread_metadata: { archive_timestamp: "2026-11-10T00:00:00.000Z" } });
  w.setFetch(async (input, init = {}) => {
    const url = new URL(String(input)); calls.push(`${init.method || "GET"} ${url.hostname}${url.pathname}`);
    if (url.hostname === "cdn.discordapp.com") return new Response(new Uint8Array(64), { status: 200, headers: { "content-type": "image/png" } });
    if (url.hostname === "discord.com") {
      const path = url.pathname.replace(/^\/api\/v\d+/, "");
      if (path.endsWith("/typing")) return new Response(null, { status: 204 });
      if (/\/guilds\/\d+\/members\//.test(path)) return jsonResponse({ roles });
      if (/^\/guilds\/\d+\/roles$/.test(path)) return jsonResponse(guildRoles);
      if (init.method === "POST" && path.endsWith("/messages")) {
        const form = typeof init.body === "string" ? null : init.body, body = form ? JSON.parse(form.get("payload_json")) : JSON.parse(init.body);
        posts.push({ ...body, files: form ? [...form.keys()].filter(key => key.startsWith("files[")).map(key => form.get(key).name) : [] });
        return jsonResponse({ id: String(9000 + posts.length) });
      }
      if (scanFails && /^\/guilds\/\d+\/(?:channels|threads\/active)$/.test(path)) return jsonResponse({ message: "Internal error" }, 500);
      if (/^\/guilds\/\d+\/channels$/.test(path)) return jsonResponse([{ id: FORUMS.class, type: 15, name: "class-rehberleri" }, { id: FORUMS.dungeon, type: 15, name: "zindan-rehberleri" }, { id: FORUMS.profession, type: 15, name: "meslek-rehberleri" }, { id: "1", type: 0, name: "genel" }]);
      if (/^\/guilds\/\d+\/threads\/active$/.test(path)) return jsonResponse({ threads: TOPICS.filter(topic => !archived.includes(topic.name)).map(threadJson) });
      const forum = path.match(/^\/channels\/(\d+)\/threads\/archived\/public$/);
      if (forum) return jsonResponse({ threads: TOPICS.filter(topic => archived.includes(topic.name) && FORUMS[topic.category] === forum[1]).map(threadJson), has_more: false });
      const thread = path.match(/^\/channels\/(\d+)\/messages$/), topic = thread && TOPICS.find(t => t.id === thread[1]);
      // A long post: the first 100 messages hold the original cards, the newest message a replaced one.
      if (topic && longPost) {
        const card = (file, where) => ({ id: `${where}${file}`, filename: file, size: fileSize, content_type: "image/png", url: `https://cdn.discordapp.com/attachments/${where}/1/${file}?ex=1` });
        if (url.searchParams.get("after") === "0") return jsonResponse(Array.from({ length: 100 }, (_, i) => ({ id: String(100 - i), attachments: i === 99 ? topic.files.map(file => card(file, "old")) : [] })));
        return jsonResponse([{ id: "500", attachments: [card(topic.files[0], "new")] }, ...Array.from({ length: 99 }, (_, i) => ({ id: String(499 - i), attachments: [] }))]);
      }
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

test("a game question is answered, then a normal member waits 15 minutes", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("**Hunter** solo oyunda rahattır: pet hasarı üstlenir, sen uzaktan vurursun.") }); const { bot, storage } = newBot();
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
  const net = fakeNetwork({ gemini: () => geminiText("**Hunter** solo oyunda rahattır: pet hasarı üstlenir.") }); const { bot } = newBot(); const userId = "888888888888888888";
  await bot.handleCommand(message("!soru hangi sınıf solo için iyi", userId));
  await new Promise(r => setTimeout(r, 2600));
  await bot.handleCommand(message("!soru hunter mı iyi mage mı", userId));
  assert.match(net.posts.at(-1).content, /Twitch Sub, YouTube Katıl ve Kick aboneleri için bekleme süresi 1 dakika, normal üyeler için 15 dakikadır\./);
});

test("two questions in one message get two answers in a single reply, each with its own source", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("Skill 75–225 arasında kartta yazan göllerde tutabilirsin.") });
  const { bot, storage } = newBot();
  await bot.handleCommand(message("!soru fishing 150 skill nerede kasılır? ve whirlwind axe görevi nerede?"));
  assert.equal(net.posts.length, 1, "one Discord reply");
  const answer = net.posts[0].content;
  assert.match(answer, /\*\*1\) fishing 150 skill nerede kasılır\?\*\*\nSkill 75–225/);
  assert.match(answer, new RegExp(`<#${topicId("Fishing")}> konusuna bakabilirsin`), "card part links its topic");
  assert.match(answer, /\*\*2\) whirlwind axe görevi nerede\?\*\*\nHunter solo/, "second part answered by the research service");
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

test("nothing verified answers the question: the bot says so, never guesses, and the player keeps the attempt", async () => {
  // Not a quest, NPC or place question: neither the research service nor the model's memory is asked.
  let net = fakeNetwork({ gemini: () => geminiText("Guild kurmak 10 silver tutar.") }); let { bot, storage } = newBot();
  await bot.handleCommand(message("!soru guild nasıl kurulur"));
  assert.equal(net.posts.length, 1);
  assert.equal(net.posts[0].content, "Bu konuda elimde doğrulanmış WoW Forever bilgisi yok; yanlış bilgi vermemek için cevap vermiyorum. Bu soru hakkından düşmedi.");
  assert.ok(!net.calls.some(c => c.includes("workers.dev")) && !net.prompts.length, "no research, no model");
  assert.equal(await storage.get("answered_count") || 0, 0);
  assert.equal(await storage.get("technical_failure_count") || 0, 0, "not a technical failure");
  assert.equal((await storage.get("uncovered_questions"))[0].q, "guild nasıl kurulur", "kept for the list of information to add");
  // The same player can ask again at once.
  await new Promise(r => setTimeout(r, 2600));
  net = fakeNetwork({ gemini: () => geminiText("**Hunter** solo oyunda rahattır: pet hasarı üstlenir.") });
  await bot.handleCommand(message("!soru hangi sınıf solo için iyi"));
  assert.match(net.posts[0].content, /pet hasarı üstlenir/);
  // A quest question whose research finds nothing: the model's memory is not asked either.
  net = fakeNetwork({ backend: () => jsonResponse({ answer: "Bu konuda güvenilir bilgi bulamadım." }), gemini: () => geminiText("Görevi Stormwind'deki Uydurma NPC verir.") }); ({ bot } = newBot());
  await bot.handleCommand(message("!soru whirlwind axe görevi nerede"));
  assert.match(net.posts[0].content, /^Bu konuda elimde doğrulanmış WoW Forever bilgisi yok/);
  assert.equal(net.prompts.length, 0, "model not asked");
  // UNVERIFIED_ANSWERS=all restores the old behaviour: research first, then the model's own knowledge.
  net = fakeNetwork({ backend: () => jsonResponse({ answer: "Bu konuda güvenilir bilgi bulamadım." }), gemini: () => geminiText("Guild bankası için şehirdeki guild master'a git.") }); ({ bot } = newBot({ UNVERIFIED_ANSWERS: "all" }));
  await bot.handleCommand(message("!soru guild nasıl kurulur"));
  assert.match(net.posts[0].content, /guild master'a git/);
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
  assert.match(net.posts[0].content, /^Warrior için hangi uzmanlığın talent sırasını istiyorsun\? \*\*Arms\*\* \(Yakın DPS\), \*\*Fury\*\* \(Yakın DPS\), \*\*Protection\*\* \(Tank\)\. Örneğin `!soru warrior arms talent sırası`/);
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

// ---------- Review fixes ----------

test("card wording is not mistaken for recommending an outside source", () => {
  for (const text of ["Excavation Site: Wetlands: önerilen seviye 31, bölge Wetlands.", "Dalaran'da 3. adım Kanalizasyon çıkışı. Önerilen seviye 33.", "Fishing için tavsiye edilen rota Stormwind kanalları.", "Mana kaynağın bitince su iç, bunu öneririm."]) assert.equal(w.usableGameAnswer(text), text);
  assert.equal(w.usableGameAnswer("Şu YouTube kanalını takip etmeni öneririm. Warrior için Strength önemli."), "Warrior için Strength önemli.");
  assert.equal(w.usableGameAnswer("1. Önce Rend at.\n2. Sonra Mortal Strike.\n\nAyrıca şu siteye bakabilirsin. Devam et."), "1. Önce Rend at.\n2. Sonra Mortal Strike.\n\nDevam et.");
  assert.equal(w.usableGameAnswer("Bu sitede rehber var, okuyabilirsin."), "");
});

test("the example the bot gives when it asks for a spec leads to that spec's leveling card", () => {
  for (const card of Array.from(w.CARDS).filter(c => c.kind === "leveling")) {
    const question = `${card.classKey} ${card.spec.replace(/-/g, " ")} talent sırası`;
    const picked = w.pickCards(question, { talentAdvice: w.isTalentAdviceQuestion(question) });
    assert.deepEqual(Array.from(picked.cards, c => c.id), [card.id], question);
  }
});

test("a card replaced later in a long forum post wins over the original", async () => {
  const net = fakeNetwork({ longPost: true, gemini: () => geminiText("Skill 1–75 arasında başlangıç bölgelerinde tut.") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru fishing 20 skill nerede"));
  assert.deepEqual(net.posts[0].files, ["fish-1-75.png"]);
  assert.ok(net.calls.some(c => c.includes("/attachments/new/")), "the newest copy is downloaded");
  assert.ok(!net.calls.some(c => c.includes("/attachments/old/")));
});

test("a failed forum scan does not block the answer and is not repeated for every question", async () => {
  const net = fakeNetwork({ scanFails: true, gemini: () => geminiText("Skill 75–225 arasında kartta yazan yerlerde tut.") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru fishing 150 skill nerede kasılır", "600000000000000011"));
  await bot.handleCommand(message("!soru mining 200 nerede kasarım", "600000000000000012"));
  assert.equal(net.posts.length, 2);
  assert.match(net.posts[0].content, /^Skill 75–225/);
  assert.match(net.posts[0].content, /Meslek rehberleri forumundaki \*\*Fishing\*\* konusuna bakabilirsin/);
  assert.ok(net.calls.filter(c => /\/guilds\/\d+\/channels$/.test(c)).length <= 3, "the scan is retried once (with its own retries), not per question");
});

test("health shows how many guide topics the bot found", async () => {
  const net = fakeNetwork(); const { bot, storage } = newBot();
  await storage.put("last_poll_at", Date.now());
  await bot.buildCardCheck();
  let health = await bot.healthSummary();
  assert.equal(health.ok, true); assert.equal(health.kart_konulari, "61/61");
  fakeNetwork({ archived: [], missingFiles: [] });
  const value = await storage.get("cards:topics"); value.topics = {}; await storage.put("cards:topics", value);
  health = await bot.healthSummary();
  assert.equal(health.kart_konulari, "0/61");
  assert.match(health.aciklama, /Rehber forumları görünmüyor/);
  assert.ok(net);
});

test("leftovers of the old guide system are removed from storage", async () => {
  fakeNetwork(); const { bot, storage } = newBot();
  await storage.put("guidevision:v7:warrior.01:1", { version: 7, text: "eski" });
  await bot.cleanupRecords();
  assert.equal(await storage.get("guidevision:v7:warrior.01:1"), undefined);
});

// ---------- Understanding the question ----------

const file = id => w.CARDS.find(card => card.id === id).file;

test("which spec, three specs named: compared from the verified spec facts, the cards the answer points at are attached", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("Leveling için **Frost** en rahatı: en iyi kontrol ve kaçış, Ice Barrier ile en sağlam Mage.\n**Fire** 1. fazda en yüksek DPS'li Mage ama 34'e kadar mana yetmez.\n**Arcane** yürürken zayıf.\nKART: Frost, Fire") });
  const { bot } = newBot();
  await bot.handleCommand(message("!soru mage için levelling,dungeon ve pvp için hangi talentleri önerirsin arcane mi frost mu fire mi"));
  assert.equal(net.posts.length, 1, "one answer, the question is not split");
  const post = net.posts[0];
  assert.match(post.content, /^Leveling için \*\*Frost\*\* en rahatı/);
  assert.ok(!/KART:/.test(post.content), "the card line is not shown");
  assert.deepEqual(post.files, [file("mage-10-frost-leveling"), file("mage-09-fire-leveling")]);
  assert.match(post.content, /`!soru mage arcane talent sırası`/, "the spec without a card can be asked for");
  assert.match(post.content, new RegExp(`<#${topicId("Mage")}> konusuna bakabilirsin\\.$`));
  assert.equal(net.prompts.length, 1);
  const sent = JSON.parse(JSON.parse(net.prompts[0]).input);
  assert.deepEqual(sent.about.karsilastirilan_uzmanliklar, ["Arcane", "Frost", "Fire"]);
  assert.match(sent.trustedCardText, /Mage Frost \(rol: Menzilli DPS\)/);
  assert.match(sent.trustedCardText, /Leveling'de 34'e kadar mana yetmez/);
  assert.match(sent.trustedCardText, /Arcane 9, Fire 0, Frost 42/, "the point split of each build is given");
  assert.ok(!/Satır 1, sütun 1/.test(sent.trustedCardText), "the full talent trees are not sent for a comparison");
  assert.ok(!/Icy Veins/i.test(sent.trustedCardText), "no source names in the facts");
});

test("which spec: without a card line the first spec the answer names gets its card", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("**Protection** önerilen Warrior leveling uzmanlığı. **Fury** leveling'de geç oturur, **Arms** iki düşmana karşı güçlü.") });
  const { bot } = newBot();
  await bot.handleCommand(message("!soru warrior hangi spec leveling için iyi"));
  assert.deepEqual(net.posts[0].files, [file("warrior-10-protection-leveling")]);
  assert.match(net.posts[0].content, /`!soru warrior arms talent sırası`/);
});

test("which spec while the model is down: each spec with its strengths, two named specs still get both cards", async () => {
  let net = fakeNetwork(); let { bot } = newBot();
  await bot.handleCommand(message("!soru priest kasarken hangi spec"));
  assert.match(net.posts[0].content, /\*\*Discipline\*\* \(Heal\)/);
  assert.match(net.posts[0].content, /\*\*Shadow\*\* \(Menzilli DPS\)/);
  assert.deepEqual(net.posts[0].files, []);
  assert.match(net.posts[0].content, /`!soru priest discipline talent sırası`/);
  net = fakeNetwork(); ({ bot } = newBot());
  await bot.handleCommand(message("!soru mage frost mu fire mı"));
  assert.deepEqual(net.posts[0].files, [file("mage-10-frost-leveling"), file("mage-09-fire-leveling")]);
  assert.match(net.posts[0].content, /\*\*Frost\*\* \(Menzilli DPS\)/);
  assert.ok(!/arcane talent sırası/.test(net.posts[0].content), "no hint when every compared spec has its card");
});

test("a question about one spec is answered from that spec's section only", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("Hayır, yalnız Frost yetmez: Frost önceliğinde Arcane Missiles (Missile Barrage açılınca) ve Evocation da var.") });
  const { bot } = newBot();
  await bot.handleCommand(message("!soru frost mage oynarken skill trainerda fire veya arcane skillerini almak gerekir mi? yoksa sadece frost skillerini almak mı gerekir?"));
  assert.equal(net.posts.length, 1);
  assert.ok(!/^\*\*1\)/.test(net.posts[0].content), "answered as one question");
  assert.equal(net.posts[0].files[0], file("mage-07-oynanis"));
  assert.equal(net.prompts.length, 1);
  const sent = JSON.parse(JSON.parse(net.prompts[0]).input);
  assert.equal(sent.about.uzmanlik, "Frost");
  const gameplay = sent.trustedCardText.split("KART: ").find(part => part.startsWith("Mage · Oynanış") || /Oynanış Önceliği/.test(part.slice(0, 80)));
  assert.match(gameplay, /## Frost/);
  assert.match(gameplay, /Ice Barrier/);
  assert.ok(!/## Arcane\n/.test(gameplay) && !/## Fire\n/.test(gameplay), "the Arcane and Fire priority lists are left out");
  assert.match(gameplay, /KURAL/, "the rule that holds for every spec stays");
});

test("a level in a build question puts that level's row in front of the model", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("30. seviyede Ice Shards'a puan veriyorsun (28–31).") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru frost mage 30 level hangi talent"));
  const sent = JSON.parse(JSON.parse(net.prompts[0]).input);
  assert.equal(sent.about.seviye, 30);
  assert.match(sent.trustedCardText, /SORUYLA EN İLGİLİ SATIRLAR:\nSeviye 30: 28–31 · Ice Shards · Frost/);
  assert.deepEqual(net.posts[0].files, [file("mage-10-frost-leveling")]);
});

test("which class: answered from the class overview, linked to the class forum, no card", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("Tank olabilenler: **Warrior** (Protection), **Paladin** (Protection) ve **Druid** (Feral).") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru hangi sınıf tank olabilir"));
  assert.match(net.posts[0].content, /^Tank olabilenler/);
  assert.deepEqual(net.posts[0].files, []);
  assert.match(net.posts[0].content, new RegExp(`<#${FORUMS.class}> kanalına bakabilirsin\\.$`));
  const sent = JSON.parse(JSON.parse(net.prompts[0]).input);
  assert.match(sent.trustedCardText, /Paladin: .*Protection \(Tank\)/);
  assert.ok(!net.calls.some(c => c.includes("workers.dev")));
});

test("two classes compared: both class topics are linked", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("**Hunter** en rahat solo ve leveling sınıflarından. **Mage** büyük büyü hasarı ve kalabalık kontrolü verir.") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru hunter mı iyi mage mı"));
  assert.match(net.posts[0].content, new RegExp(`<#${topicId("Hunter")}> ve <#${topicId("Mage")}> konularına bakabilirsin\\.$`));
  assert.deepEqual(net.posts[0].files, []);
});

test("a loose text match is used only when the model confirms it", async () => {
  // The model says the card does not answer it: the normal answer takes over, no card is sent.
  let net = fakeNetwork({ gemini: () => geminiText("KARTTA_YOK") }); let { bot } = newBot();
  await bot.handleCommand(message("!soru thermaplugg bombaları nasıl durdurulur"));
  assert.equal(net.posts.length, 1);
  assert.deepEqual(net.posts[0].files, []);
  assert.match(net.posts[0].content, /^Bu konuda elimde doğrulanmış WoW Forever bilgisi yok/, "no guess");
  // The model is down: no guess from a loosely matched card.
  net = fakeNetwork(); ({ bot } = newBot());
  await bot.handleCommand(message("!soru thermaplugg bombaları nasıl durdurulur"));
  assert.deepEqual(net.posts[0].files, []);
  // The model answers from the card: the card is attached.
  net = fakeNetwork({ gemini: () => geminiText("Sütun düğmeleri bombaları keser.") }); ({ bot } = newBot());
  await bot.handleCommand(message("!soru thermaplugg bombaları nasıl durdurulur"));
  assert.match(net.posts[0].content, /^Sütun düğmeleri bombaları keser\./);
  assert.deepEqual(net.posts[0].files, [file("zindan-11-gnomeregan")]);
});

test("answers that do not come from a card are asked for in the same short shape", async () => {
  let asked = "";
  const net = fakeNetwork({ backend: url => { asked = url.searchParams.get("q"); return jsonResponse({ answer: "Hearthstone 60 dakikada bir kullanılır." }); } }); const { bot } = newBot();
  await bot.handleCommand(message("!soru hearthstone nereden alınır"));
  assert.match(asked, /^hearthstone nereden alınır/);
  assert.match(asked, /en fazla 5 kısa satır/);
  // The research backend knows Classic: the Forever rules travel with the question.
  assert.match(asked, /WoW Forever notu.*Forever'da Alliance tarafında da vardır \(Dwarf\)/);
  assert.equal(net.posts[0].content, "Hearthstone 60 dakikada bir kullanılır.");
});

// ---------- Live reports of 2026-11-11 ----------

test("Kick subscribers get the 1 minute cooldown: the server's Kick role, or KICK_SUB_ROLE_IDS", async () => {
  let net = fakeNetwork({ roles: ["1566519827965812966"] }); let { bot } = newBot();
  assert.equal((await bot.getMemberCooldownClass(message("!soru x"))).durationMs, 60000);
  assert.match((await bot.getMemberCooldownClass(message("!soru x"))).reason, /^kick_role_id/);
  assert.ok(!net.calls.some(c => c.endsWith("/roles")), "the role list is not read");
  // Another role does not count.
  fakeNetwork({ roles: ["900000000000000003"] }); ({ bot } = newBot());
  assert.equal((await bot.getMemberCooldownClass(message("!soru x"))).durationMs, 900000);
  // An extra role id from the settings counts too.
  fakeNetwork({ roles: ["900000000000000009"] }); ({ bot } = newBot({ KICK_SUB_ROLE_IDS: "900000000000000009" }));
  assert.equal((await bot.getMemberCooldownClass(message("!soru x"))).durationMs, 60000);
});

test("equipment question: answered from the armor and weapon rule of the class, no card, no research backend", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("20. seviyede **Hunter** leather giyer; mail 40. seviyede açılır. Agility ve Stamina veren parçalara bak.") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru 20 lvl night elf hunterım hangi itemleri almam gerekli silah kıyafet vs."));
  assert.equal(net.posts.length, 1);
  assert.match(net.posts[0].content, /^20\. seviyede \*\*Hunter\*\* leather giyer/);
  assert.deepEqual(net.posts[0].files, [], "no race or talent card");
  assert.ok(!/bakabilirsin/.test(net.posts[0].content));
  assert.equal(net.prompts.length, 1, "one AI call");
  const prompt = JSON.parse(JSON.parse(net.prompts[0]).input);
  assert.equal(prompt.playerClass, "Hunter");
  assert.match(prompt.rules, /^Hunter: zırh 40\. seviyeye kadar leather, 40\. seviyeden sonra mail; silah: ana silahı bow, crossbow ya da gun/);
  assert.ok(!/Warrior/.test(prompt.rules), "only the rule of the player's class");
  assert.ok(!net.calls.some(c => c.includes("workers.dev")), "the research backend is not asked");
});

test("weapon and profession in one message: weapon rule for the first part, profession cards and both topics for the second", async () => {
  const net = fakeNetwork({ gemini: (url, init) => /Oyuncu ekipman soruyor/.test(String(init.body))
    ? geminiText("**Priest** tek elli mace, dagger, staff ve wand kullanır.")
    : geminiText("**Enchanting** ve **Tailoring** al: Priest Tailoring'den en çok faydayı görür, Enchanting wand yapar.") });
  const { bot } = newBot();
  await bot.handleCommand(message("!soru 10 lvl shadow priestim, elimde topuzla takılıyorum. Hangi silahları kullanmalıyım? hangi meslekleri seçmeliyim hiçbir bilgim yok yeni başladım"));
  assert.equal(net.posts.length, 1);
  const answer = net.posts[0].content;
  assert.match(answer, /\*\*1\) [^\n]*Hangi silahları kullanmalıyım\?\*\*\n\*\*Priest\*\* tek elli mace/);
  assert.match(answer, /\*\*2\) hangi meslekleri seçmeliyim[^\n]*\*\*\n\*\*Enchanting\*\* ve \*\*Tailoring\*\* al/);
  assert.match(answer, new RegExp(`<#${topicId("Enchanting")}> ve <#${topicId("Tailoring")}> konularına bakabilirsin`), "both profession topics are linked");
  assert.deepEqual(net.posts[0].files, ["ench-genel.png", "tail-genel.png"], "the profession cards, not a talent card");
  const advice = JSON.parse(JSON.parse(net.prompts.find(p => /hangi mesleği seçeceğini soruyor/.test(p))).input);
  assert.equal(advice.playerClass, "Priest", "the class of the first part carries over");
  assert.match(advice.trustedCardText, /Priest için kartlarda yazanlar:\nEnchanting: Mage, Priest, Warlock \(wand yapar\)/);
});

test("profession advice: without a class the forum is linked; while the model is down the card lines answer", async () => {
  let net = fakeNetwork({ gemini: () => geminiText("En fazla iki ana meslek alabilirsin; **Cooking**, **Fishing** ve **First Aid** bunlara ek alınır.") }); let { bot } = newBot();
  await bot.handleCommand(message("!soru kaç meslek alabilirim"));
  assert.match(net.posts[0].content, /^En fazla iki ana meslek alabilirsin/);
  assert.match(net.posts[0].content, new RegExp(`<#${FORUMS.profession}> kanalına bakabilirsin\\.$`));
  assert.deepEqual(net.posts[0].files, []);
  net = fakeNetwork(); ({ bot } = newBot());
  await bot.handleCommand(message("!soru hunter için hangi meslek"));
  assert.match(net.posts[0].content, /Leatherworking: Druid ve Rogue oyun boyu deri giyer\. Hunter ve Shaman önce deri, sonra mail/);
  assert.deepEqual(net.posts[0].files, ["lw-genel.png"]);
  // "Which profession earns money" is not on the cards: the bot does not guess.
  net = fakeNetwork({ gemini: () => geminiText("KARTTA_YOK") }); ({ bot } = newBot());
  await bot.handleCommand(message("!soru hangi meslek para kazandırır"));
  assert.deepEqual(net.posts[0].files, []);
  assert.match(net.posts[0].content, /^Bu konuda elimde doğrulanmış WoW Forever bilgisi yok/);
});

test("a short follow-up stays with its question: area abilities come from the class cards", async () => {
  assert.deepEqual(Array.from(w.splitQuestionParts("shadow priestin alan vuran skili var mı ? hangisi kaç levelde")), ["shadow priestin alan vuran skili var mı hangisi kaç levelde"]);
  assert.equal(w.splitQuestionParts("deadmines kaç level? fishing nerede kasılır?").length, 2);
  const net = fakeNetwork({ gemini: () => geminiText("Shadow'da tek tuşla alan hasarı yok; **Shadow Word: Pain**'i her düşmana at, **Devouring Plague** ölünce yayılır.") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru shadow priestin alan vuran skili var mı ? hangisi kaç levelde"));
  assert.equal(net.posts.length, 1);
  assert.ok(!/\*\*1\)/.test(net.posts[0].content), "one question, one answer");
  assert.deepEqual(net.posts[0].files, [file("priest-07-oynanis"), file("priest-03-yetenekler-2")]);
  const prompt = JSON.parse(JSON.parse(net.prompts[0]).input);
  assert.match(prompt.trustedCardText, /Oynanış kartındaki çok hedef notları:\n- Shadow: Shadow Word: Pain'i her düşmana at/);
  assert.match(prompt.trustedCardText, /Psychic Scream[^\n]*Yakındaki en fazla 5 düşman/);
  assert.match(prompt.trustedCardText, /Holy Nova[^\n]*10 metre içindeki düşmanlara/);
  assert.match(prompt.trustedCardText, /Devouring Contagion[^\n]*yakındaki 2 düşmana yayılır/);
  assert.ok(!/Prayer of Mending|Mana Burn/.test(prompt.trustedCardText.split("alan etkili")[1].split("\n\n")[0]), "heals and single-target spells are not listed as area abilities");
});

test("quest question: answered by the research service; the filler sentence is never sent, the model's memory is never asked", async () => {
  let asked = "";
  const backend = url => { asked = url.searchParams.get("q"); return jsonResponse({ answer: "Fire Hardened Hauberk, Warrior sınıf görevinin ödülüdür. Görevi veren NPC ve detaylı konum bilgisi elimizdeki güncel verilerde yer almamaktadır." }); };
  let net = fakeNetwork({ backend, gemini: () => geminiText("Görevi Stormwind Dwarven District'teki Furen Longbeard verir.") }); let { bot } = newBot();
  await bot.handleCommand(message("!soru fire hardened hauberk görevini hangi npc veriyor nerede"));
  assert.match(asked, /Bu soru görev araştırmasıdır\./);
  assert.match(asked, /görevi veren NPC'yi, NPC'nin bulunduğu şehir ya da bölgeyi/);
  // The useful part of the research answer is sent, without the filler sentence; the model does not fill the gap from memory.
  assert.equal(net.posts[0].content, "Fire Hardened Hauberk, Warrior sınıf görevinin ödülüdür.");
  assert.equal(net.prompts.length, 0);
  // UNVERIFIED_ANSWERS=all: the model is asked once for the missing part, as before.
  net = fakeNetwork({ backend, gemini: () => geminiText("Görevi Stormwind Dwarven District'teki Furen Longbeard verir.") }); ({ bot } = newBot({ UNVERIFIED_ANSWERS: "all" }));
  await bot.handleCommand(message("!soru fire hardened hauberk görevini hangi npc veriyor nerede"));
  assert.equal(net.posts[0].content, "Görevi Stormwind Dwarven District'teki Furen Longbeard verir.");
  assert.match(net.prompts.at(-1), /görev \/ NPC \/ edinim sorusu/);
  assert.ok(w.hasNoInfoSentence("Ödülü budur. Konum bilgisi kaynaklarda bulunmamaktadır."));
  assert.ok(!w.hasNoInfoSentence("Bu zindanda görev yok, doğrudan girebilirsin. Detaylı rota kartta yazıyor."));
  assert.equal(w.stripNoInfoSentences("Bu konuda net bir bilgi yok."), "Bu konuda net bir bilgi yok.", "an answer that is only filler is left to the no-info check");
});

// ---------- Live reports of 2026-11-11, second round: WoW Forever is not WoW Classic ----------

const CLASSIC_SHAMAN_ANSWER = "Hayır, Loch Modan'da Shaman eğitmeni bulunmaz. Alliance tarafında Shaman TBC'de açılmıştır. Klasik dönemde Alliance oyuncuları Shaman sınıfını seçemez.";

test("every AI call carries the Forever rules: which races can be which class, on which side", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("Hayır, Loch Modan'da Shaman eğitmeni yok. En yakını Kharanos'taki **Ingrid Dunwald** ve Ironforge'da Forlorn Cavern'deki **Eldrun Stormbreaker**.") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru loch modanda shaman trainer var mı"));
  const body = JSON.parse(net.prompts[0]);
  assert.match(body.system_instruction, /Shaman olabilen ırklar: Alliance'ta Dwarf; Horde'da Orc, Tauren, Troll, Windshaper Skyborne\./);
  assert.match(body.system_instruction, /Paladin olabilen ırklar: Alliance'ta Human, Dwarf; Horde'da Undead\./);
  assert.match(body.system_instruction, /"Alliance'ta Shaman yok", "Horde'da Paladin yok", "bu sınıf Burning Crusade'de açıldı" gibi cümleler Forever için yanlıştır\./);
  assert.match(body.system_instruction, /Stormwind'in limanı vardır \(Stormwind Harbor\)/);
  for (const name of ["Druid", "Hunter", "Mage", "Paladin", "Priest", "Rogue", "Shaman", "Warlock", "Warrior"]) assert.match(w.foreverRules(), new RegExp(`${name} olabilen ırklar: Alliance'ta `));
});

test("the reported question: the Shaman trainer answer comes from the Forever note, not from Classic knowledge", async () => {
  // The research backend would answer with Classic rules; it is not asked.
  let net = fakeNetwork({ backend: () => jsonResponse({ answer: CLASSIC_SHAMAN_ANSWER }), gemini: () => geminiText("Hayır, Loch Modan'da Shaman eğitmeni yok. En yakını Kharanos'taki **Ingrid Dunwald** ve Ironforge'da Forlorn Cavern'deki **Eldrun Stormbreaker**.") }); let { bot } = newBot();
  await bot.handleCommand(message("!soru loch modanda shaman trainer var mı"));
  assert.match(net.posts[0].content, /^Hayır, Loch Modan'da Shaman eğitmeni yok\. En yakını Kharanos'taki \*\*Ingrid Dunwald\*\*/);
  assert.ok(!/TBC|Klasik dönem|seçemez/.test(net.posts[0].content));
  assert.ok(!net.calls.some(c => c.includes("workers.dev")), "research backend not asked");
  assert.deepEqual(net.posts[0].files, []);
  const prompt = JSON.parse(JSON.parse(net.prompts[0]).input);
  assert.match(prompt.foreverNotes, /Anvilmar'da Teo Hammerstorm \(6\. seviyeye kadar öğretir\), Kharanos'ta Ingrid Dunwald, Ironforge'da Forlorn Cavern'deki Eldrun Stormbreaker/);
  assert.match(prompt.foreverNotes, /Stormwind'de, Loch Modan'da ve diğer Alliance bölgelerinde Shaman eğitmeni yoktur/);
  assert.match(prompt.task, /Yalnızca 'foreverNotes' alanındaki WoW Forever notlarına dayanarak/);
  // The model is down: the note line itself is the answer.
  net = fakeNetwork({ backend: () => jsonResponse({ answer: CLASSIC_SHAMAN_ANSWER }) }); ({ bot } = newBot());
  await bot.handleCommand(message("!soru loch modanda shaman trainer var mı"));
  assert.equal(net.posts[0].content, "Stormwind'de, Loch Modan'da ve diğer Alliance bölgelerinde Shaman eğitmeni yoktur; Dwarf Shaman yeni yetenekleri için Kharanos'a ya da Ironforge'a döner.");
});

test("a research answer that states a Classic rule Forever changed is never sent", async () => {
  // A quest question no note covers: the research service answers with the Classic rule. The answer is dropped and nothing is guessed.
  let asked = "";
  const backend = url => { asked = url.searchParams.get("q"); return jsonResponse({ answer: CLASSIC_SHAMAN_ANSWER }); };
  let net = fakeNetwork({ backend, gemini: () => geminiText("Dwarf Shaman ilk totem görevini Kharanos'taki eğitmeninden alır.") }); let { bot, storage } = newBot();
  await bot.handleCommand(message("!soru alliance shaman totem görevi nerede"));
  assert.match(asked, /WoW Forever notu \(WoW Classic'ten farklıdır, cevap buna uymalı\): Shaman olabilen ırklar: Alliance'ta Dwarf;/);
  assert.match(asked, /Forever kurallarıyla çelişmeyen WoW Classic bilgisini ver/);
  assert.ok(!net.posts.some(post => /TBC|Klasik dönem|seçemez/.test(post.content)));
  assert.match(net.posts[0].content, /^Bu konuda elimde doğrulanmış WoW Forever bilgisi yok.*hakkından düşmedi\.$/);
  assert.equal(net.prompts.length, 0, "the model's memory is not asked");
  assert.equal(await storage.get("answered_count") || 0, 0);
  // UNVERIFIED_ANSWERS=all: the model answers instead, with the class rule; a Classic sentence of its own is cut.
  net = fakeNetwork({ backend, gemini: () => geminiText("Totem görevini sınıf eğitmenin verir. Shaman sadece Horde tarafında oynanır.") }); ({ bot } = newBot({ UNVERIFIED_ANSWERS: "all" }));
  await bot.handleCommand(message("!soru alliance shaman totem görevi nerede"));
  assert.equal(net.posts[0].content, "Totem görevini sınıf eğitmenin verir.");
  assert.match(JSON.parse(JSON.parse(net.prompts.at(-1)).input).classRule, /^Shaman olabilen ırklar: Alliance'ta Dwarf/);
  // What counts as a contradiction, for every class the two sides share differently.
  for (const wrong of ["Alliance tarafında Shaman TBC'de açılmıştır.", "Klasik dönemde Alliance oyuncuları Shaman sınıfını seçemez.", "Alliance tarafında Shaman yok.", "Horde tarafında Paladin sınıfı yok.", "Undead Paladin olamaz.", "Paladin sadece Alliance tarafında oynanır.", "Dwarf Shaman olamaz."])
    assert.equal(w.foreverContradictions(wrong).length, 1, wrong);
  for (const right of ["Alliance'ta yalnız Dwarf Shaman olabilir, Human Shaman olamaz.", "Night Elf Shaman olamaz.", "Gnome Paladin olamaz.", "Horde'da Druid yalnız Tauren ve Windshaper Skyborne olabilir.", "Mind Sear Lich King'le geldi, Forever'da yok.", "Loch Modan'da Shaman eğitmeni yok.", "Tauren Paladin yok; Horde'da yalnız Undead Paladin olur."])
    assert.equal(w.foreverContradictions(right).length, 0, right);
  assert.equal(w.cleanForeverAnswer("Alliance tarafında Shaman yok."), "", "nothing useful is left");
});

test("travel: Stormwind to Darnassus goes through Stormwind Harbor, not through Menethil", async () => {
  let net = fakeNetwork({ gemini: () => geminiText("Stormwind Limanı'ndan Auberdine gemisine bin, oradan Rut'theran Village gemisine geç ve portaldan Darnassus'a çık.") }); let { bot } = newBot();
  await bot.handleCommand(message("!soru stormwindden darnassusa nasıl giderim"));
  assert.match(net.posts[0].content, /^Stormwind Limanı'ndan Auberdine gemisine bin/);
  assert.ok(!net.calls.some(c => c.includes("workers.dev")));
  const prompt = JSON.parse(JSON.parse(net.prompts[0]).input);
  assert.match(prompt.foreverNotes, /YENİ: Stormwind'in artık limanı var \(Stormwind Harbor\)\. Buradan Darkshore'daki Auberdine'e doğrudan gemi kalkar/);
  assert.match(prompt.foreverNotes, /Menethil Harbor ve Wetlands'ten geçmek gerekmez/);
  net = fakeNetwork(); ({ bot } = newBot());
  await bot.handleCommand(message("!soru stormwindden darnassusa nasıl giderim"));
  assert.match(net.posts[0].content, /^Stormwind'den Darnassus'a: Stormwind Limanı'ndan Auberdine gemisine bin, Auberdine'den Rut'theran Village gemisine geç/);
  // A dungeon question that only sounds like travel keeps its card.
  net = fakeNetwork({ gemini: () => geminiText("Deadmines Westfall'da, Moonbrook'taki evin içinden girilir.") }); ({ bot } = newBot());
  await bot.handleCommand(message("!soru deadmines nasıl gidilir"));
  assert.deepEqual(net.posts[0].files, [file("zindan-03-deadmines")]);
  assert.ok(JSON.parse(JSON.parse(net.prompts[0]).input).trustedCardText, "answered from the card text");
});

test("library books: what they are, where they are handed in, what they give", async () => {
  let net = fakeNetwork({ gemini: () => geminiText("Dünyada bulduğun kitapları Stormwind'de Mage Quarter'daki **Garion Wendell**'e (Horde: Undercity'de **Owen Thadd**) teslim edersin; XP, para ve 10/20/25 kitapta ödül verir.") }); let { bot } = newBot();
  await bot.handleCommand(message("!soru oyundaki kitaplar ne işe yarar"));
  assert.match(net.posts[0].content, /Garion Wendell/);
  assert.deepEqual(net.posts[0].files, []);
  const prompt = JSON.parse(JSON.parse(net.prompts[0]).input);
  assert.match(prompt.foreverNotes, /Library Book \(kütüphane kitabı\) Forever'la gelen bir toplama içeriğidir/);
  assert.match(prompt.foreverNotes, /10 kitapta kolye .* 20 kitapta yüzük .* 25 kitapta Truthseeker's Bow/);
  assert.match(prompt.foreverNotes, /Westfall'da Bewitchments and Glamours \(Moonbrook\)/);
  // No fishing card for a book question that names no profession.
  net = fakeNetwork(); ({ bot } = newBot());
  await bot.handleCommand(message("!soru kitap nerede teslim edilir"));
  assert.match(net.posts[0].content, /^Kitaplar kütüphaneciye teslim edilir: Alliance için Stormwind'de Mage Quarter'daki Garion Wendell, Horde için Undercity'deki Owen Thadd\./);
  assert.deepEqual(net.posts[0].files, []);
  // A profession book stays with the profession card.
  net = fakeNetwork({ gemini: () => geminiText("Expert Fishing kitabını Booty Bay'deki satıcıdan alırsın.") }); ({ bot } = newBot());
  await bot.handleCommand(message("!soru expert fishing kitabı nereden alınır"));
  assert.deepEqual(net.posts[0].files, [file("fish-75-225")]);
});

test("Enhancement Shaman in Forever: no dual wield, two-handed axe or mace", async () => {
  let net = fakeNetwork(); let { bot } = newBot();
  await bot.handleCommand(message("!soru enhancement shaman dual wield var mı"));
  assert.equal(net.posts[0].content, "Forever'da Shaman için dual wield (çift silah) yoktur.");
  assert.deepEqual(net.posts[0].files, [], "the note answers; no talent card is attached");
  // The weapon rule of the class says the same.
  net = fakeNetwork(); ({ bot } = newBot());
  await bot.handleCommand(message("!soru shaman ne silah kullanır"));
  assert.match(net.posts[0].content, /Forever'da iki elli axe ve iki elli mace talent gerekmeden kullanılır; dual wield \(çift silah\) yoktur/);
  // Mind Sear is not a Forever spell: the note says so and lists what Priest has instead.
  net = fakeNetwork(); ({ bot } = newBot());
  await bot.handleCommand(message("!soru priest mind sear kaç levelde"));
  assert.match(net.posts[0].content, /^Forever'da Priest'in Mind Sear büyüsü yoktur/);
});

test("a note that does not cover the question hands it on, with its one-line summary", async () => {
  let asked = "";
  const net = fakeNetwork({ backend: url => { asked = url.searchParams.get("q"); return jsonResponse({ answer: "Paladin 40. seviyede Summon Warhorse görevini sınıf eğitmeninden alır." }); }, gemini: () => geminiText("KARTTA_YOK") }); const { bot } = newBot();
  await bot.handleCommand(message("!soru paladin mount görevi"));
  assert.equal(net.posts[0].content, "Paladin 40. seviyede Summon Warhorse görevini sınıf eğitmeninden alır.");
  assert.match(asked, /Paladin olabilen ırklar: Alliance'ta Human, Dwarf; Horde'da Undead\./);
  assert.match(asked, /Riding 40\. seviyede \(%60 hız\), hızlı binek 60\. seviyede \(%100 hız\) açılır\./);
});

test("area abilities of all nine classes: the real ones are listed, single-target spells and heals are not", () => {
  const expected = {
    druid: [["Swipe", "Hurricane", "Demoralizing Roar"], ["Ferocious Bite", "Thorns", "Nature's Grasp", "Regrowth", "Moonfire"]],
    hunter: [["Multi-Shot", "Volley", "Explosive Trap"], ["Aimed Shot", "Mend Pet", "Serpent Sting"]],
    mage: [["Arcane Explosion", "Flamestrike", "Blizzard", "Cone of Cold", "Frost Nova"], ["Fireball", "Polymorph", "Frostbolt"]],
    paladin: [["Consecration", "Holy Wrath"], ["Flash of Light", "Holy Light", "Judgement"]],
    priest: [["Psychic Scream", "Holy Nova", "Devouring Contagion"], ["Prayer of Mending", "Mana Burn", "Mind Sear", "Mind Blast"]],
    rogue: [["Blade Flurry"], ["Sinister Strike", "Eviscerate", "Backstab"]],
    shaman: [["Fire Nova", "Chain Lightning", "Magma Totem"], ["Chain Heal", "Healing Stream", "Lightning Bolt"]],
    warlock: [["Rain of Fire", "Hellfire", "Howl of Terror"], ["Corruption", "Drain Life", "Shadow Bolt"]],
    warrior: [["Cleave", "Whirlwind", "Thunder Clap", "Sweeping Strikes"], ["Heroic Strike", "Execute", "Mortal Strike"]]
  };
  for (const [key, [present, absent]] of Object.entries(expected)) {
    for (const question of [`${key} alan vuran skill var mı`, `${key} aoe skilleri neler`]) {
      const selection = w.selectCards(question), lines = String(selection?.facts || "").split("\n").filter(line => line.startsWith("- ["));
      assert.ok(lines.length, `${question}: no area lines`);
      const names = lines.map(line => (line.match(/(?:Yetenek|Talent): ([^·]+?) ·/) || [])[1]);
      for (const name of present) assert.ok(names.includes(name), `${question}: ${name} missing (${names.join(", ")})`);
      for (const name of absent) assert.ok(!names.includes(name), `${question}: ${name} is not an area ability`);
    }
  }
});

// ------------------------------------------------------------
// 2026-11-12: "binek ile kurt hali arasında hız farkı var mı" was answered "ikisi de %60 hız verir"
// ------------------------------------------------------------
const WOLF_QUESTION = "!soru Shaman karakterler icin lvl40 taki binek ile kurt hali arasinda hiz farki var mi";

test("the reported question: Ghost Wolf's value comes from the Shaman card and the mount's from the note, in one prompt", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("Evet, fark var. **Ghost Wolf** koşu hızını %40 artırır, 40. seviye bineği ise %60 hız verir; binek daha hızlıdır.") }); const { bot } = newBot();
  await bot.handleCommand(message(WOLF_QUESTION));
  assert.match(net.posts[0].content, /^Evet, fark var\. \*\*Ghost Wolf\*\* koşu hızını %40 artırır, 40\. seviye bineği ise %60 hız verir/);
  const prompt = JSON.parse(JSON.parse(net.prompts[0]).input);
  assert.match(prompt.trustedCardText, /Ghost Wolf[^\n]*koşu hızın %40 artar/, "the card holds the wolf form's speed");
  assert.match(prompt.foreverNotes, /İlk Riding becerisi 40\. seviyede açılır ve %60 hız verir/, "the note holds the mount's speed");
  assert.match(prompt.foreverNotes, /Ghost Wolf'u \(20\. seviye\) ve Druid'in Travel Form'u \(30\. seviye\) %40/);
  assert.match(JSON.stringify(prompt), /başka bir şeyin değerini ona yakıştırma, 'ikisi de aynı' ya da 'fark yok' deme/);
  assert.ok(!net.calls.some(c => c.includes("workers.dev")), "the Classic research service is not asked");
});

test("an answer that states a number no source holds is never sent", async () => {
  // The answer of the live report again: the model gives the mount's %60 to both, and adds a %70 of its own.
  let net = fakeNetwork({ gemini: () => geminiText("Hayır, hız farkı yoktur; ikisi de %70 hız verir.") }); let { bot } = newBot();
  await bot.handleCommand(message(WOLF_QUESTION));
  assert.ok(!/%70/.test(net.posts.map(post => post.content).join("\n")), "the invented percent does not reach the player");
  // A note-only question: the invented price is dropped and the note line itself is sent.
  net = fakeNetwork({ gemini: () => geminiText("Riding eğitimi 40. seviyede 90 gold tutar.") }); ({ bot } = newBot());
  await bot.handleCommand(message("!soru binek kaç gold"));
  assert.ok(!/90 gold/.test(net.posts[0].content));
  assert.match(net.posts[0].content, /Riding eğitimi 40\. seviyede 100 gold, 60\. seviyede 1000 gold tutar/);
});

test("number check: percentages, levels and prices must stand in a source; plain small counts are left alone", () => {
  const source = "Ghost Wolf koşu hızını %40 artırır. Riding 40. seviyede açılır ve %60 hız verir. Riding eğitimi 100 gold tutar.";
  assert.deepEqual(Array.from(w.unsupportedNumbers("Ghost Wolf %40, binek %60 hız verir.", source)), []);
  assert.deepEqual(Array.from(w.unsupportedNumbers("İkisi de %70 hız verir.", source)), ["70"]);
  assert.deepEqual(Array.from(w.unsupportedNumbers("Riding 30. seviyede açılır.", source)), ["30"]);
  assert.deepEqual(Array.from(w.unsupportedNumbers("Riding eğitimi 90 gold tutar.", source)), ["90"]);
  assert.deepEqual(Array.from(w.unsupportedNumbers("Riding eğitimi 100 gold tutar, hız %60.", source)), []);
  assert.deepEqual(Array.from(w.unsupportedNumbers("Heroic Pack 29.99 dolar.", "Skyborne Heroic Pack 29,99 dolar")), [], "comma and dot decimals are the same number");
  assert.deepEqual(Array.from(w.unsupportedNumbers("Bunun için 3 yol var.", source)), [], "a small count without a unit is not a claim");
  assert.deepEqual(Array.from(w.unsupportedNumbers("60. seviyede 1.000 gold tutar.", "60. seviyede 1000 gold tutar")), [], "a thousands separator is not a new number");
  assert.deepEqual(Array.from(w.unsupportedNumbers("Heroic Pack 39,99 dolar.", "Skyborne Heroic Pack 29,99 dolar")), ["39.99"]);
  // The number the player wrote in the question is not an invention.
  assert.deepEqual(Array.from(w.unsupportedNumbers("45. seviyede hâlâ %60 hızla gidersin.", source, "45 levelim binek hızı kaç")), []);
});

test("a comparison is answered from a note only when the note holds both sides", () => {
  const notes = question => w.foreverNotes(question);
  assert.ok(w.isComparisonQuestion("binek ile kurt hali arasinda hiz farki var mi"));
  assert.ok(w.isComparisonQuestion("binek mi ışınlanma mı daha hızlı"));
  assert.ok(!w.isComparisonQuestion("binek kaç gold"));
  assert.equal(w.notesCoverQuestion("binek mi ışınlanma mı daha hızlı", notes("binek mi ışınlanma mı daha hızlı")), false, "the mount note says nothing about teleporting");
  assert.equal(w.notesCoverQuestion("epic mount ile normal mount farkı", notes("epic mount ile normal mount farkı")), true);
  assert.equal(w.notesCoverQuestion("binek kaç gold", notes("binek kaç gold")), true, "not a comparison: left to the reading of the note");
});

test("a comparison with a side that no source holds gets no guess", async () => {
  const net = fakeNetwork({ gemini: () => geminiText("Işınlanma daha hızlıdır, binek %60 hız verir.") }); const { bot, storage } = newBot();
  await bot.handleCommand(message("!soru binek mi ışınlanma mı daha hızlı"));
  assert.equal(net.posts[0].content, "Bu konuda elimde doğrulanmış WoW Forever bilgisi yok; yanlış bilgi vermemek için cevap vermiyorum. Bu soru hakkından düşmedi.");
  assert.equal(await storage.get("answered_count") || 0, 0, "the attempt is not used up");
});

test("the widened Forever notes answer without the research service or the model's memory", async () => {
  const cases = [
    ["dungeon finder var mı", "grup-bulma", /Forever'da otomatik zindan bulucu \(Dungeon Finder\) ve Raid Finder yoktur/],
    ["talent sıfırlama kaç gold", "dual-spec", /İlk sıfırlama 1 gold tutar, her sıfırlamada ücret artar ve en çok 50 gold olur/],
    ["wow forever ücretli mi", "paketler", /ayrı bir satın alma ücreti yoktur; WoW aboneliği ya da Game Time ile oynanır/],
    ["horde dalaran'a girebilir mi", "dalaran", /Şehir Alliance'a açıktır; Horde oyuncularına şehirde saldırılır/],
    ["onyxia attunement gerekiyor mu", "raid-takvimi", /Onyxia's Lair için attunement gerekir: 40 kişinin her birinin çantasında Drakefire Amulet olmalıdır/],
    ["quiver reagent slotuna takılır mı", "canta", /Hunter'ın quiver'ı ve ammo pouch'u bu yere takılmaz/],
    ["questie çalışıyor mu", "eklentiler", /Questie, Deadly Boss Mods, BigWigs ve Auctionator'ın Forever sürümleri vardır/],
    ["hit ve crit birleşti mi", "istatistik", /tek bir Hit stat'ında; üç kritik şansı da tek bir Crit stat'ında birleşti/],
    ["kaç pet ailesi var", "hunter-pet", /Forever'da 18 pet ailesi vardır/],
    ["hearthstone bekleme süresi kaç", "olum", /Hearthstone'un bekleme süresi 1 saattir/],
    ["forever'da yeni zindanlar hangileri", "yeni-zindanlar", /Forever dokuz yeni zindan ekler/],
    ["kaç yeni itibar var", "itibar", /Forever 14 yeni itibar ekler/]
  ];
  for (const [question, id, line] of cases) {
    const net = fakeNetwork({ gemini: () => geminiText("Cevap nottadır.") }); const { bot } = newBot();
    await bot.handleCommand(message(`!soru ${question}`));
    assert.match(net.posts[0].content, /^Cevap nottadır\./, question);
    const prompt = JSON.parse(JSON.parse(net.prompts[0]).input);
    assert.match(prompt.foreverNotes, line, `${question}: note ${id}`);
    assert.ok(!net.calls.some(c => c.includes("workers.dev")), `${question}: research service not asked`);
  }
});

test("Rogue weapons in Forever include one-handed axes", async () => {
  assert.match(w.gearRule("rogue"), /Forever'da tek elli axe da kullanır/);
  assert.match(w.gearRule("rogue"), /iki elli silah ve kalkan kullanamaz/);
});

test("Dalaran the city is not Dalaran the dungeon", () => {
  assert.deepEqual(Array.from(w.selectCards("mage teleport dalaran kaç levelde", {}).cards, card => card.id), ["mage-03-yetenekler-2"]);
  assert.deepEqual(Array.from(w.selectCards("city of dalaran bossları", {}).cards, card => card.id), ["zindan-13-city-of-dalaran"]);
  assert.deepEqual(Array.from(w.selectCards("dalaran zindanı kaç level", {}).cards, card => card.id), ["zindan-13-city-of-dalaran"]);
});

test("the model is down and the matched note is about something else: no unrelated note line is sent", async () => {
  // "fiyat" touches the price note, which says nothing about a name change.
  const net = fakeNetwork(); const { bot, storage } = newBot();
  await bot.handleCommand(message("!soru isim değiştirme fiyatı ne kadar"));
  assert.ok(!/satın alma ücreti|Heroic Pack/.test(net.posts[0].content), net.posts[0].content);
  assert.match(net.posts[0].content, /^Bu soruya şu an cevap veremedim/, "the retry message, not a guess");
  assert.equal(await storage.get("answered_count") || 0, 0);
});
