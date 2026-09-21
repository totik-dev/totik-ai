import { DurableObject } from "cloudflare:workers";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";

const INTENTS = 1 | 512 | 32768;

const QUESTION_CHANNEL_ID = "1548811398069489744";
const QUESTION_COMMAND = /^!soru(?:\s|$)/i;

const WOW_AI_URL = "https://totik-ai-test.totikch.workers.dev/";

const GEMINI_VISION_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

const WATCHDOG_INTERVAL_MS = 60_000;
const CONNECT_TIMEOUT_MS = 30_000;

const USER_COOLDOWN_MS = 10 * 60_000;

const AI_TIMEOUT_MS = 70_000;
const AI_MAX_ATTEMPTS = 2;

const MAX_DISCORD_MESSAGE = 1900;
const MAX_ANSWER_CHARS = 1200;

const COOLDOWN_MESSAGE =
  "Totik WoW Yardım Botu olarak her kullanıcı için 10 dakikada 1 soru cevaplayacak şekilde ayarlandım. Biraz sonra tekrar sorabilirsin.";

const IDENTITY_MESSAGE =
  "Ben Totik Channel için geliştirilmiş Totik WoW Yardım Botuyum. World of Warcraft görevleri, class'lar, meslekler, item'lar, dungeon'lar ve genel oyun bilgileri konusunda yardımcı oluyorum.";

const CHANNEL_RECOMMENDATION_MESSAGE =
  "Ben Totik Channel için geliştirilmiş Totik WoW Yardım Botuyum. Türkçe World of Warcraft içerikleri için Totik Channel'ı izleyebilirsin.";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value, maxLength = 2200) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function splitDiscordMessage(value) {
  let text = String(value || "").trim();

  if (!text) return [];
  if (text.length <= MAX_DISCORD_MESSAGE) return [text];

  const result = [];

  while (text.length > MAX_DISCORD_MESSAGE) {
    let cut = text.lastIndexOf("\n", MAX_DISCORD_MESSAGE);

    if (cut < 900) {
      cut = text.lastIndexOf(" ", MAX_DISCORD_MESSAGE);
    }

    if (cut < 900) {
      cut = MAX_DISCORD_MESSAGE;
    }

    result.push(text.slice(0, cut).trim());
    text = text.slice(cut).trim();
  }

  if (text) result.push(text);

  return result;
}

function tidyAnswer(value) {
  let text = String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  text = text
    .replace(
      /Ben bir World of Warcraft yardım botuyum/gi,
      "Ben Totik Channel için geliştirilmiş Totik WoW Yardım Botuyum"
    )
    .replace(
      /Ben bir WoW yardım botuyum/gi,
      "Ben Totik Channel için geliştirilmiş Totik WoW Yardım Botuyum"
    );

  if (text.length <= MAX_ANSWER_CHARS) {
    return text;
  }

  const sample = text.slice(0, MAX_ANSWER_CHARS);

  const cuts = [
    sample.lastIndexOf(". "),
    sample.lastIndexOf("! "),
    sample.lastIndexOf("? "),
    sample.lastIndexOf("\n")
  ];

  let cut = Math.max(...cuts);

  if (cut < 800) {
    cut = MAX_ANSWER_CHARS;
  } else {
    cut += 1;
  }

  return `${text.slice(0, cut).trim()}…`;
}

function isIdentityQuestion(question) {
  const q = String(question || "").toLocaleLowerCase("tr-TR");

  return (
    q.includes("sen kimsin") ||
    q.includes("sen nesin") ||
    q.includes("kimin botusun") ||
    q.includes("kim geliştirdi") ||
    q.includes("kim yaptı seni")
  );
}

function isChannelRecommendationQuestion(question) {
  const q = String(question || "").toLocaleLowerCase("tr-TR");

  const channel =
    q.includes("kanal") ||
    q.includes("youtube") ||
    q.includes("youtuber") ||
    q.includes("yayıncı") ||
    q.includes("streamer") ||
    q.includes("içerik üretici");

  const recommendation =
    q.includes("öner") ||
    q.includes("tavsiye") ||
    q.includes("izleyeyim") ||
    q.includes("izlemeliyim") ||
    q.includes("takip edeyim");

  return channel && recommendation;
}

function guessMimeType(filename) {
  const name = String(filename || "").toLowerCase();

  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";

  return "image/png";
}

function getImageAttachment(message) {
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments
    : [];

  for (const attachment of attachments) {
    const type = String(attachment?.content_type || "").toLowerCase();
    const name = String(attachment?.filename || "").toLowerCase();

    const image =
      type.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif)$/i.test(name);

    if (image && attachment?.url) {
      return {
        url: attachment.url,
        contentType: type || guessMimeType(name)
      };
    }
  }

  return null;
}

function bytesToBase64(bytes) {
  let binary = "";
  const size = 0x8000;

  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + size)
    );
  }

  return btoa(binary);
}

function backendRetryable(status) {
  return status === 502 || status === 503 || status === 504;
}

async function forwardToGateway(env, path) {
  if (!env.GATEWAY) {
    return json(
      {
        ok: false,
        error: "GATEWAY binding bulunamadı."
      },
      500
    );
  }

  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const id = env.GATEWAY.idFromName("totik-ai-main");
      const stub = env.GATEWAY.get(id);

      return await stub.fetch(
        new Request(`https://internal${path}`)
      );
    } catch (error) {
      lastError = error;

      if (attempt < 2) {
        await sleep(300);
      }
    }
  }

  // Durable Object patlasa bile artık kullanıcı 1101 HTML sayfası görmesin.
  return json(
    {
      ok: false,
      error: "gateway_exception",
      detail:
        lastError?.message ||
        String(lastError || "Unknown Durable Object error")
    },
    503
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Bu endpoint Durable Object'a hiç dokunmaz.
    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "totik-ai",
        channelId: QUESTION_CHANNEL_ID,
        cooldownMinutes: 10,
        replySupport: true,
        imageSupport: true,
        backendAttempts: AI_MAX_ATTEMPTS
      });
    }

    if (url.pathname === "/" || url.pathname === "/start") {
      return forwardToGateway(env, "/start");
    }

    if (url.pathname === "/status") {
      return forwardToGateway(env, "/status");
    }

    return new Response("Not found", {
      status: 404
    });
  }
};

export class DiscordGateway extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
    this.env = env;

    // Constructor'da async storage işi YOK.
    this.ws = null;

    this.state = "offline";
    this.botUserId = null;

    this.sequence = null;

    this.connectStartedAt = null;

    this.heartbeatInterval = null;
    this.heartbeatStartTimer = null;
    this.heartbeatTimer = null;
    this.awaitingHeartbeatAck = false;

    this.lastGatewayEventAt = null;
    this.lastQuestionAt = null;
    this.lastHeartbeatSentAt = null;
    this.lastHeartbeatAckAt = null;
    this.lastError = null;

    this.lastBackendAttemptCount = 0;
    this.lastBackendStatus = null;
    this.lastBackendDurationMs = null;

    this.reconnectTimer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/start") {
      if (!this.env.DISCORD_BOT_TOKEN) {
        return json(
          {
            ok: false,
            error: "DISCORD_BOT_TOKEN bulunamadı."
          },
          500
        );
      }

      await this.safeScheduleAlarm();

      try {
        await this.ensureConnected();
      } catch (error) {
        await this.setError(
          `Gateway start: ${error?.message || String(error)}`
        );
      }

      return json({
        ok: true,
        state: this.state,
        connected: this.isConnected(),
        channelId: QUESTION_CHANNEL_ID
      });
    }

    if (url.pathname === "/status") {
      await this.safeScheduleAlarm();

      // Status ekranına bakmak bile offline ise yeniden bağlanmayı tetikler.
      if (!this.isConnected()) {
        this.ensureConnected().catch((error) => {
          this.setError(
            `Status reconnect: ${error?.message || String(error)}`
          );
        });
      }

      return json({
        state: this.state,
        connected: this.isConnected(),

        botUserId: this.botUserId,
        channelId: QUESTION_CHANNEL_ID,

        lastGatewayEventAt: this.lastGatewayEventAt,
        lastQuestionAt: this.lastQuestionAt,

        lastHeartbeatSentAt: this.lastHeartbeatSentAt,
        lastHeartbeatAckAt: this.lastHeartbeatAckAt,
        heartbeatAwaitingAck: this.awaitingHeartbeatAck,

        watchdogSeconds: WATCHDOG_INTERVAL_MS / 1000,
        cooldownMinutes: USER_COOLDOWN_MS / 60000,
        replySupport: true,
        imageSupport: true,

        backendAttempts: AI_MAX_ATTEMPTS,
        lastBackendAttemptCount: this.lastBackendAttemptCount,
        lastBackendStatus: this.lastBackendStatus,
        lastBackendDurationMs: this.lastBackendDurationMs,

        lastError: this.lastError
      });
    }

    return new Response("Not found", {
      status: 404
    });
  }

  isConnected() {
    return (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  async alarm() {
    try {
      if (
        this.ws &&
        this.ws.readyState === WebSocket.CONNECTING &&
        this.connectStartedAt &&
        Date.now() - this.connectStartedAt > CONNECT_TIMEOUT_MS
      ) {
        this.forceReconnect("Connect timeout");
      } else if (!this.isConnected()) {
        await this.ensureConnected();
      }
    } catch (error) {
      await this.setError(
        `Watchdog: ${error?.message || String(error)}`
      );
    }

    await this.safeScheduleAlarm();
  }

  async safeScheduleAlarm() {
    try {
      await this.ctx.storage.setAlarm(
        Date.now() + WATCHDOG_INTERVAL_MS
      );
    } catch (error) {
      // Alarm storage hatası botun tamamını çökertmesin.
      this.lastError =
        `Alarm: ${error?.message || String(error)}`;
    }
  }

  async ensureConnected() {
    if (
      this.ws &&
      (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      )
    ) {
      return;
    }

    this.clearReconnectTimer();
    this.clearHeartbeat();

    this.state = "connecting";
    this.connectStartedAt = Date.now();

    const ws = new WebSocket(DISCORD_GATEWAY);

    this.ws = ws;

    ws.addEventListener("open", () => {
      this.state = "connecting";
    });

    ws.addEventListener("message", (event) => {
      // Timer/event callback'lerinden ctx.waitUntil kullanmıyoruz.
      this.handleGatewayPacket(event.data).catch((error) => {
        this.setError(
          `Gateway packet: ${error?.message || String(error)}`
        );
      });
    });

    ws.addEventListener("close", (event) => {
      this.handleSocketClose(event);
    });

    ws.addEventListener("error", () => {
      this.setError("Discord Gateway WebSocket error");
    });
  }

  async handleGatewayPacket(raw) {
    let packet;

    try {
      packet = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (typeof packet.s === "number") {
      this.sequence = packet.s;
    }

    // Discord HELLO
    if (packet.op === 10) {
      const interval = Number(
        packet.d?.heartbeat_interval
      );

      if (Number.isFinite(interval) && interval > 0) {
        this.startHeartbeat(interval);
      }

      this.sendIdentify();
      return;
    }

    // Heartbeat ACK
    if (packet.op === 11) {
      this.awaitingHeartbeatAck = false;
      this.lastHeartbeatAckAt = new Date().toISOString();
      return;
    }

    // Discord heartbeat talebi
    if (packet.op === 1) {
      this.sendHeartbeat();
      return;
    }

    // Discord reconnect talebi
    if (packet.op === 7) {
      this.forceReconnect("Discord requested reconnect");
      return;
    }

    // Invalid session
    if (packet.op === 9) {
      await sleep(1000);
      this.forceReconnect("Invalid Discord session");
      return;
    }

    if (packet.op !== 0) {
      return;
    }

    await this.handleDispatch(packet.t, packet.d);
  }

  async handleDispatch(eventName, data) {
    this.lastGatewayEventAt = new Date().toISOString();

    if (eventName === "READY") {
      this.botUserId = data?.user?.id || null;
      this.state = "ready";
      this.connectStartedAt = null;
      this.lastError = null;
      return;
    }

    if (eventName !== "MESSAGE_CREATE") {
      return;
    }

    await this.handleDiscordMessage(data);
  }

  async handleDiscordMessage(message) {
    if (
      !message?.id ||
      !message?.channel_id ||
      !message?.author
    ) {
      return;
    }

    if (message.author.bot || message.webhook_id) {
      return;
    }

    if (
      String(message.channel_id) !==
      QUESTION_CHANNEL_ID
    ) {
      return;
    }

    const content = String(
      message.content || ""
    ).trim();

    if (!QUESTION_COMMAND.test(content)) {
      return;
    }

    let currentQuestion = cleanText(
      content.replace(QUESTION_COMMAND, ""),
      1800
    );

    let referencedMessage =
      message.referenced_message || null;

    const referencedId =
      message.message_reference?.message_id;

    if (!referencedMessage && referencedId) {
      try {
        referencedMessage =
          await this.discordRequest(
            `/channels/${message.channel_id}/messages/${referencedId}`
          );
      } catch {
        referencedMessage = null;
      }
    }

    const referencedText = cleanText(
      referencedMessage?.content || "",
      1600
    );

    const image =
      getImageAttachment(message) ||
      getImageAttachment(referencedMessage);

    let effectiveQuestion = "";

    if (referencedText && currentQuestion) {
      effectiveQuestion =
        `Önceki mesaj: ${referencedText}\n` +
        `Ek soru: ${currentQuestion}`;
    } else if (currentQuestion) {
      effectiveQuestion = currentQuestion;
    } else if (referencedText) {
      effectiveQuestion = referencedText;
    } else if (image) {
      effectiveQuestion =
        "Bu görseldeki World of Warcraft konusu veya görevi hakkında yardımcı ol.";
    }

    if (!effectiveQuestion && !image) {
      await this.reply(
        message,
        "Sorunu `!soru` komutundan sonra yazabilir veya bir mesaja cevap verip sadece `!soru` yazabilirsin."
      );
      return;
    }

    const userId = String(message.author.id);

    if (!(await this.acquireCooldown(userId))) {
      await this.reply(
        message,
        COOLDOWN_MESSAGE
      );
      return;
    }

    this.lastQuestionAt = new Date().toISOString();

    try {
      if (isChannelRecommendationQuestion(effectiveQuestion)) {
        await this.reply(
          message,
          CHANNEL_RECOMMENDATION_MESSAGE
        );

        this.lastError = null;
        return;
      }

      if (isIdentityQuestion(effectiveQuestion)) {
        await this.reply(
          message,
          IDENTITY_MESSAGE
        );

        this.lastError = null;
        return;
      }

      await this.safeTyping(message.channel_id);

      let imageContext = "";

      if (image) {
        imageContext = await this.analyzeImage(
          image,
          effectiveQuestion
        );
      }

      let finalQuestion = effectiveQuestion;

      if (imageContext) {
        finalQuestion +=
          `\n\nEkran görüntüsünden okunan bilgiler:\n${imageContext}`;
      }

      const result = await this.askWowAi(finalQuestion);

      const answer = tidyAnswer(
        result?.answer || ""
      );

      if (!answer) {
        throw new Error("AI boş cevap döndürdü.");
      }

      await this.reply(message, answer);

      this.lastError = null;
    } catch (error) {
      // Teknik hata kullanıcının 10 dakikalık hakkını YEMEZ.
      await this.releaseCooldown(userId);

      await this.setError(
        `Question failed: ${error?.message || String(error)}`
      );

      await this.reply(
        message,
        "Şu an araştırma servislerinden biri kısa süreli cevap veremedi. Bu soru 10 dakikalık hakkından düşmedi; biraz sonra tekrar deneyebilirsin."
      );
    }
  }

  async acquireCooldown(userId) {
    const key = `cooldown:${userId}`;
    const now = Date.now();

    try {
      const previous =
        await this.ctx.storage.get(key);

      if (
        typeof previous === "number" &&
        now - previous < USER_COOLDOWN_MS
      ) {
        return false;
      }

      await this.ctx.storage.put(key, now);
      return true;
    } catch (error) {
      // Storage sorunu yüzünden kullanıcıyı engelleme.
      this.lastError =
        `Cooldown storage: ${error?.message || String(error)}`;

      return true;
    }
  }

  async releaseCooldown(userId) {
    try {
      await this.ctx.storage.delete(
        `cooldown:${userId}`
      );
    } catch {
      // ignore
    }
  }

  async analyzeImage(image, question) {
    if (!this.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY bulunamadı.");
    }

    const response = await fetch(image.url);

    if (!response.ok) {
      throw new Error(
        `Discord görseli indirilemedi: ${response.status}`
      );
    }

    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > 7 * 1024 * 1024) {
      throw new Error("Görsel 7 MB sınırını aşıyor.");
    }

    const base64 = bytesToBase64(
      new Uint8Array(buffer)
    );

    const prompt = `
World of Warcraft ekran görüntüsünü incele.

Kullanıcının sorusu:
${question}

Sadece araştırma için gerekli bilgileri çıkar:
- Quest/görev adı
- Objective
- NPC / item / hedef
- Bölge
- Haritada görünen konum
- Görevi çözmeye yardımcı önemli quest metni

Emin olmadığın bilgiyi kesinmiş gibi yazma.
Türkçe ve kısa cevap ver.
`.trim();

    const gemini = await fetch(
      GEMINI_VISION_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt
                },
                {
                  inlineData: {
                    mimeType:
                      image.contentType || "image/png",
                    data: base64
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 350
          }
        })
      }
    );

    const raw = await gemini.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        "Gemini görsel cevabı okunamadı."
      );
    }

    if (!gemini.ok) {
      throw new Error(
        `Gemini Vision ${gemini.status}: ${raw.slice(0, 300)}`
      );
    }

    const text = (
      data?.candidates?.[0]?.content?.parts || []
    )
      .map((part) => part?.text || "")
      .join("\n")
      .trim();

    if (!text) {
      throw new Error(
        "Gemini görselden bilgi çıkaramadı."
      );
    }

    return text;
  }

  async askWowAi(question) {
    const url = new URL(WOW_AI_URL);
    url.searchParams.set("q", question);

    let lastError = null;

    for (
      let attempt = 1;
      attempt <= AI_MAX_ATTEMPTS;
      attempt++
    ) {
      this.lastBackendAttemptCount = attempt;

      const startedAt = Date.now();

      const controller =
        new AbortController();

      const timer = setTimeout(
        () => controller.abort(),
        AI_TIMEOUT_MS
      );

      try {
        const response = await fetch(
          url.toString(),
          {
            method: "GET",
            headers: {
              accept: "application/json"
            },
            signal: controller.signal
          }
        );

        this.lastBackendStatus = response.status;
        this.lastBackendDurationMs =
          Date.now() - startedAt;

        const raw = await response.text();

        let data = null;

        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          // handled below
        }

        if (response.ok && data?.answer) {
          return data;
        }

        const detail =
          data?.error ||
          raw.slice(0, 400) ||
          `HTTP ${response.status}`;

        lastError = new Error(
          `totik-ai-test HTTP ${response.status}: ${detail}`
        );

        if (
          backendRetryable(response.status) &&
          attempt < AI_MAX_ATTEMPTS
        ) {
          await sleep(1500);
          continue;
        }

        throw lastError;
      } catch (error) {
        this.lastBackendDurationMs =
          Date.now() - startedAt;

        const aborted =
          error?.name === "AbortError";

        lastError = aborted
          ? new Error(
              `totik-ai-test ${AI_TIMEOUT_MS / 1000} saniyede cevap vermedi.`
            )
          : error;

        const retry =
          attempt < AI_MAX_ATTEMPTS &&
          (
            aborted ||
            /HTTP 502|HTTP 503|HTTP 504/i.test(
              String(error?.message || "")
            )
          );

        if (retry) {
          await sleep(1500);
          continue;
        }

        throw lastError;
      } finally {
        clearTimeout(timer);
      }
    }

    throw (
      lastError ||
      new Error("AI backend bilinmeyen hata verdi.")
    );
  }

  async reply(originalMessage, answer) {
    const chunks = splitDiscordMessage(answer);

    for (let i = 0; i < chunks.length; i++) {
      const body = {
        content: chunks[i],

        allowed_mentions: {
          parse: [],
          replied_user: false
        }
      };

      if (i === 0) {
        body.message_reference = {
          message_id: String(originalMessage.id),
          channel_id: String(originalMessage.channel_id),
          fail_if_not_exists: false
        };
      }

      await this.discordRequest(
        `/channels/${originalMessage.channel_id}/messages`,
        {
          method: "POST",
          body
        }
      );
    }
  }

  async safeTyping(channelId) {
    try {
      await this.discordRequest(
        `/channels/${channelId}/typing`,
        {
          method: "POST"
        }
      );
    } catch {
      // typing kritik değil
    }
  }

  async discordRequest(path, options = {}) {
    const method = options.method || "GET";

    for (let attempt = 1; attempt <= 4; attempt++) {
      const headers = {
        Authorization:
          `Bot ${this.env.DISCORD_BOT_TOKEN}`
      };

      const init = {
        method,
        headers
      };

      if (options.body !== undefined) {
        headers["content-type"] =
          "application/json";

        init.body =
          JSON.stringify(options.body);
      }

      const response = await fetch(
        `${DISCORD_API}${path}`,
        init
      );

      if (response.status === 204) {
        return null;
      }

      const raw = await response.text();

      let data = null;

      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = raw;
      }

      if (response.status === 429) {
        let delay = Number(
          data?.retry_after || 1
        );

        if (delay < 100) {
          delay *= 1000;
        }

        await sleep(Math.max(500, delay));
        continue;
      }

      if (
        response.status >= 500 &&
        attempt < 4
      ) {
        await sleep(attempt * 750);
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `Discord API ${response.status}: ${
            typeof data === "string"
              ? data
              : JSON.stringify(data)
          }`
        );
      }

      return data;
    }

    throw new Error(
      "Discord API maksimum retry sayısına ulaştı."
    );
  }

  sendIdentify() {
    if (!this.isConnected()) {
      return;
    }

    this.ws.send(
      JSON.stringify({
        op: 2,
        d: {
          token: this.env.DISCORD_BOT_TOKEN,
          intents: INTENTS,
          properties: {
            os: "cloudflare",
            browser: "totik-ai",
            device: "totik-ai"
          }
        }
      })
    );
  }

  startHeartbeat(interval) {
    this.clearHeartbeat();

    this.heartbeatInterval = interval;
    this.awaitingHeartbeatAck = false;

    const delay = Math.floor(
      Math.random() * interval
    );

    this.heartbeatStartTimer =
      setTimeout(() => {
        this.heartbeatStartTimer = null;

        if (!this.isConnected()) {
          return;
        }

        this.sendHeartbeat();

        this.heartbeatTimer =
          setInterval(() => {
            this.sendHeartbeat();
          }, interval);
      }, delay);
  }

  sendHeartbeat() {
    if (!this.isConnected()) {
      return;
    }

    if (this.awaitingHeartbeatAck) {
      this.setError(
        "Discord heartbeat ACK gelmedi."
      );

      this.forceReconnect(
        "Missed heartbeat ACK"
      );

      return;
    }

    this.awaitingHeartbeatAck = true;
    this.lastHeartbeatSentAt =
      new Date().toISOString();

    try {
      this.ws.send(
        JSON.stringify({
          op: 1,
          d: this.sequence
        })
      );
    } catch (error) {
      this.setError(
        `Heartbeat send: ${
          error?.message || String(error)
        }`
      );

      this.forceReconnect(
        "Heartbeat send failed"
      );
    }
  }

  clearHeartbeat() {
    if (this.heartbeatStartTimer) {
      clearTimeout(this.heartbeatStartTimer);
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatStartTimer = null;
    this.heartbeatTimer = null;
    this.heartbeatInterval = null;
    this.awaitingHeartbeatAck = false;
  }

  handleSocketClose(event) {
    this.clearHeartbeat();

    this.ws = null;
    this.state = "offline";
    this.connectStartedAt = null;

    const code = Number(event?.code || 0);

    if (
      [4004, 4010, 4011, 4013, 4014].includes(code)
    ) {
      this.setError(
        `Discord Gateway fatal close code ${code}`
      );
      return;
    }

    this.scheduleReconnect();
  }

  forceReconnect(reason) {
    this.clearHeartbeat();

    const socket = this.ws;

    this.ws = null;
    this.state = "offline";
    this.connectStartedAt = null;

    try {
      socket?.close(4000, reason);
    } catch {
      // ignore
    }

    this.scheduleReconnect(1000);
  }

  scheduleReconnect(delay = 2000) {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer =
      setTimeout(() => {
        this.reconnectTimer = null;

        // ctx.waitUntil YOK.
        this.ensureConnected().catch((error) => {
          this.setError(
            `Reconnect: ${error?.message || String(error)}`
          );

          this.scheduleReconnect(3000);
        });
      }, delay);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = null;
  }

  async setError(value) {
    this.lastError =
      String(value || "Unknown error");
  }
}
