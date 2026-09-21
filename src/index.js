import { DurableObject } from "cloudflare:workers";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";

// GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT
const INTENTS = 1 | 512 | 32768;

const WOW_AI_URL = "https://totik-ai-test.totikch.workers.dev/";

const GEMINI_VISION_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

const QUESTION_CHANNEL_ID = "1548811398069489744";
const QUESTION_COMMAND = /^!soru(?:\s|$)/i;

const MAX_DISCORD_MESSAGE = 1900;

// Cevapları hâlâ detaylı tutuyoruz,
// sadece gereksiz derecede uzamasını engelliyoruz.
const TARGET_ANSWER_LENGTH = 1400;

// Her kullanıcı 10 dakikada 1 başarılı soru.
const USER_COOLDOWN_MS = 10 * 60 * 1000;

const COOLDOWN_MESSAGE =
  "Totik WoW Yardım Botu olarak her kullanıcı için 10 dakikada 1 soru cevaplayacak şekilde ayarlandım. Biraz sonra tekrar sorabilirsin.";

const IDENTITY_MESSAGE =
  "Ben Totik Channel için geliştirilmiş Totik WoW Yardım Botuyum. World of Warcraft görevleri, class'lar, meslekler, item'lar, dungeon'lar ve genel oyun bilgileri konusunda yardımcı olmak için buradayım.";

const CHANNEL_RECOMMENDATION_MESSAGE =
  "Ben Totik Channel için geliştirilmiş Totik WoW Yardım Botuyum. Türkçe World of Warcraft içerikleri için Totik Channel'ı izleyebilirsin.";

// Discord bağlantısı watchdog
const WATCHDOG_INTERVAL_MS = 60 * 1000;
const CONNECT_TIMEOUT_MS = 30 * 1000;

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

function cleanQuestion(value, maxLength = 1800) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanReferencedText(value) {
  return String(value || "")
    .replace(QUESTION_COMMAND, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1400);
}

function splitDiscordMessage(text) {
  const value = String(text || "").trim();

  if (!value) return [];
  if (value.length <= MAX_DISCORD_MESSAGE) return [value];

  const chunks = [];
  let remaining = value;

  while (remaining.length > MAX_DISCORD_MESSAGE) {
    let cut = remaining.lastIndexOf("\n", MAX_DISCORD_MESSAGE);

    if (cut < 1000) {
      cut = remaining.lastIndexOf(" ", MAX_DISCORD_MESSAGE);
    }

    if (cut < 1000) {
      cut = MAX_DISCORD_MESSAGE;
    }

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function compactDiscordAnswer(value) {
  let text = String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]*\n+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (text.length <= TARGET_ANSWER_LENGTH) {
    return text;
  }

  const sample = text.slice(0, TARGET_ANSWER_LENGTH);

  const sentenceCuts = [
    sample.lastIndexOf(". "),
    sample.lastIndexOf("! "),
    sample.lastIndexOf("? "),
    sample.lastIndexOf("\n")
  ];

  let cut = Math.max(...sentenceCuts);

  if (cut < 950) {
    cut = TARGET_ANSWER_LENGTH;
  } else {
    cut += 1;
  }

  return `${text.slice(0, cut).trim()}…`;
}

function applyTotikIdentity(value) {
  let text = String(value || "").trim();

  if (!text) {
    return text;
  }

  if (!/Totik Channel/i.test(text)) {
    text = text
      .replace(
        /Ben bir World of Warcraft yardım botuyum/gi,
        "Ben Totik Channel için geliştirilmiş Totik WoW Yardım Botuyum"
      )
      .replace(
        /Ben bir WoW yardım botuyum/gi,
        "Ben Totik Channel için geliştirilmiş Totik WoW Yardım Botuyum"
      )
      .replace(
        /World of Warcraft yardım botu olarak/gi,
        "Totik Channel için geliştirilmiş Totik WoW Yardım Botu olarak"
      );
  }

  return text;
}

function isIdentityQuestion(question) {
  const text = String(question || "").toLocaleLowerCase("tr-TR");

  return (
    /sen kimsin/.test(text) ||
    /sen nesin/.test(text) ||
    /kimin botusun/.test(text) ||
    /kim geliştirdi/.test(text) ||
    /kim yaptı seni/.test(text) ||
    /hangi kanal için geliştirildin/.test(text)
  );
}

function isChannelRecommendationQuestion(question) {
  const text = String(question || "").toLocaleLowerCase("tr-TR");

  const asksRecommendation =
    /(öner|öneri|tavsiye|izleyeyim|izlemeliyim|takip edeyim|takip etmeliyim)/i.test(
      text
    );

  const asksChannel =
    /(kanal|youtube|youtuber|içerik üretici|yayıncı|streamer)/i.test(
      text
    );

  return asksRecommendation && asksChannel;
}

function getFirstImageAttachment(message) {
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments
    : [];

  for (const attachment of attachments) {
    const contentType = String(
      attachment?.content_type || ""
    ).toLowerCase();

    const name = String(
      attachment?.filename || ""
    ).toLowerCase();

    const url = attachment?.url;

    const isImage =
      contentType.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(name);

    if (isImage && url) {
      return {
        url,
        contentType:
          contentType ||
          guessMimeTypeFromFilename(name),
        filename: attachment.filename || "image"
      };
    }
  }

  return null;
}

function guessMimeTypeFromFilename(name) {
  if (name.endsWith(".png")) return "image/png";

  if (
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg")
  ) {
    return "image/jpeg";
  }

  if (name.endsWith(".webp")) {
    return "image/webp";
  }

  if (name.endsWith(".gif")) {
    return "image/gif";
  }

  if (name.endsWith(".bmp")) {
    return "image/bmp";
  }

  return "image/png";
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function buildAiQuestion(userQuestion, imageContext) {
  const questionText = cleanQuestion(userQuestion, 2200);

  if (imageContext) {
    const effectiveQuestion =
      questionText || "Bu görev/quest nasıl yapılır?";

    return [
      effectiveQuestion,
      "",
      "Ekran görüntüsünden çıkarılan bağlam:",
      String(imageContext).slice(0, 1200),
      "",
      "Yukarıdaki görsel bağlamı dikkate alarak kullanıcının sorusunu cevapla."
    ].join("\n");
  }

  return questionText;
}

export default {
  async fetch(request, env) {
    if (!env.GATEWAY) {
      return json(
        {
          ok: false,
          error: "GATEWAY Durable Object binding bulunamadı."
        },
        500
      );
    }

    const url = new URL(request.url);

    const stub = env.GATEWAY.get(
      env.GATEWAY.idFromName("totik-ai-main")
    );

    if (url.pathname === "/" || url.pathname === "/start") {
      return stub.fetch(
        new Request("https://internal/start")
      );
    }

    if (url.pathname === "/status") {
      return stub.fetch(
        new Request("https://internal/status")
      );
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "totik-ai-discord",
        command: "!soru",
        channelId: QUESTION_CHANNEL_ID,
        backend: WOW_AI_URL,
        watchdogSeconds: WATCHDOG_INTERVAL_MS / 1000,
        cooldownMinutes: USER_COOLDOWN_MS / 60000,
        replySupport: true
      });
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

    this.ws = null;

    this.sequence = null;
    this.sessionId = null;
    this.resumeGatewayUrl = null;
    this.botUserId = null;

    this.connectionState = "offline";
    this.connectStartedAt = null;

    this.lastGatewayEventAt = null;
    this.lastQuestionAt = null;
    this.lastError = null;

    this.heartbeatTimer = null;
    this.heartbeatStartTimer = null;
    this.heartbeatIntervalMs = null;
    this.heartbeatAwaitingAck = false;
    this.lastHeartbeatSentAt = null;
    this.lastHeartbeatAckAt = null;

    this.reconnectTimer = null;

    this.ctx.blockConcurrencyWhile(async () => {
      this.sequence =
        (await this.ctx.storage.get("discord_sequence")) ?? null;

      this.sessionId =
        (await this.ctx.storage.get("discord_session_id")) ?? null;

      this.resumeGatewayUrl =
        (await this.ctx.storage.get("discord_resume_gateway_url")) ?? null;

      this.botUserId =
        (await this.ctx.storage.get("discord_bot_user_id")) ?? null;

      this.lastGatewayEventAt =
        (await this.ctx.storage.get("last_gateway_event_at")) ?? null;

      this.lastQuestionAt =
        (await this.ctx.storage.get("last_question_at")) ?? null;

      this.lastError =
        (await this.ctx.storage.get("last_error")) ?? null;

      await this.ensureAlarmScheduled();
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/status") {
      return json({
        state: this.connectionState,

        connected:
          this.ws?.readyState === WebSocket.OPEN,

        botUserId: this.botUserId,

        channelId: QUESTION_CHANNEL_ID,

        lastGatewayEventAt:
          this.lastGatewayEventAt,

        lastQuestionAt:
          this.lastQuestionAt,

        lastHeartbeatSentAt:
          this.lastHeartbeatSentAt
            ? new Date(this.lastHeartbeatSentAt).toISOString()
            : null,

        lastHeartbeatAckAt:
          this.lastHeartbeatAckAt
            ? new Date(this.lastHeartbeatAckAt).toISOString()
            : null,

        heartbeatAwaitingAck:
          this.heartbeatAwaitingAck,

        watchdogSeconds:
          WATCHDOG_INTERVAL_MS / 1000,

        cooldownMinutes:
          USER_COOLDOWN_MS / 60000,

        replySupport: true,

        lastError:
          this.lastError
      });
    }

    if (url.pathname === "/start") {
      if (!this.env.DISCORD_BOT_TOKEN) {
        return json(
          {
            ok: false,
            error:
              "DISCORD_BOT_TOKEN secret bulunamadı."
          },
          500
        );
      }

      await this.ensureAlarmScheduled(true);
      await this.watchdog();

      return json({
        ok: true,
        state: this.connectionState,
        connected:
          this.ws?.readyState === WebSocket.OPEN,
        channelId: QUESTION_CHANNEL_ID,
        watchdogSeconds:
          WATCHDOG_INTERVAL_MS / 1000,
        cooldownMinutes:
          USER_COOLDOWN_MS / 60000
      });
    }

    return new Response("Not found", {
      status: 404
    });
  }

  async alarm() {
    try {
      await this.watchdog();
    } catch (error) {
      await this.recordError(
        `Watchdog failed: ${
          error?.message ||
          String(error)
        }`
      );
    } finally {
      await this.ctx.storage.setAlarm(
        Date.now() + WATCHDOG_INTERVAL_MS
      );
    }
  }

  async ensureAlarmScheduled(force = false) {
    const current =
      await this.ctx.storage.getAlarm();

    const now = Date.now();

    if (
      force ||
      current == null ||
      current >
        now +
          WATCHDOG_INTERVAL_MS +
          10000
    ) {
      await this.ctx.storage.setAlarm(
        now + WATCHDOG_INTERVAL_MS
      );
    }
  }

  async watchdog() {
    if (!this.env.DISCORD_BOT_TOKEN) {
      await this.recordError(
        "DISCORD_BOT_TOKEN secret bulunamadı."
      );

      return;
    }

    const now = Date.now();

    if (
      this.ws &&
      this.ws.readyState ===
        WebSocket.CONNECTING
    ) {
      if (
        this.connectStartedAt &&
        now - this.connectStartedAt >
          CONNECT_TIMEOUT_MS
      ) {
        await this.recordError(
          "Discord Gateway bağlantısı CONNECTING durumunda takıldı. Yeniden bağlanılıyor."
        );

        this.reconnectNow(
          "Gateway connect timeout"
        );
      }

      return;
    }

    if (
      this.ws &&
      this.ws.readyState ===
        WebSocket.OPEN
    ) {
      const ackTooOld =
        this.heartbeatAwaitingAck &&
        this.lastHeartbeatSentAt &&
        now -
          this.lastHeartbeatSentAt >
          Math.max(
            45000,
            (this.heartbeatIntervalMs || 45000) * 2
          );

      if (ackTooOld) {
        await this.recordError(
          "Heartbeat ACK çok gecikti. Yeniden bağlanılıyor."
        );

        this.reconnectNow(
          "Missed heartbeat ACK"
        );

        return;
      }

      return;
    }

    await this.ensureConnected();
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

    this.connectionState = "connecting";
    this.connectStartedAt = Date.now();

    const gatewayUrl =
      this.resumeGatewayUrl
        ? `${this.resumeGatewayUrl}?v=10&encoding=json`
        : DISCORD_GATEWAY;

    try {
      const ws = new WebSocket(gatewayUrl);

      this.ws = ws;

      ws.addEventListener("open", () => {
        this.connectionState = "connecting";
      });

      ws.addEventListener("message", (event) => {
        this.ctx.waitUntil(
          this.handleGatewayMessage(event.data)
        );
      });

      ws.addEventListener("close", (event) => {
        this.handleSocketClose(event);
      });

      ws.addEventListener("error", () => {
        this.ctx.waitUntil(
          this.recordError(
            "Discord Gateway WebSocket error"
          )
        );
      });
    } catch (error) {
      this.ws = null;
      this.connectionState = "offline";

      await this.recordError(
        `Gateway connection failed: ${
          error?.message ||
          String(error)
        }`
      );

      this.scheduleReconnect();
    }
  }

  async handleGatewayMessage(raw) {
    let packet;

    try {
      packet = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (typeof packet.s === "number") {
      this.sequence = packet.s;

      await this.ctx.storage.put(
        "discord_sequence",
        this.sequence
      );
    }

    if (packet.op === 10) {
      const interval = Number(
        packet.d?.heartbeat_interval
      );

      if (
        Number.isFinite(interval) &&
        interval > 0
      ) {
        this.startHeartbeat(interval);
      }

      if (
        this.sessionId &&
        this.sequence != null
      ) {
        this.sendResume();
      } else {
        this.sendIdentify();
      }

      return;
    }

    if (packet.op === 11) {
      this.heartbeatAwaitingAck = false;
      this.lastHeartbeatAckAt = Date.now();
      return;
    }

    if (packet.op === 1) {
      this.sendHeartbeat();
      return;
    }

    if (packet.op === 7) {
      this.reconnectNow(
        "Discord op 7 reconnect"
      );
      return;
    }

    if (packet.op === 9) {
      if (!packet.d) {
        await this.clearSession();
      }

      await sleep(1000);

      this.reconnectNow(
        "Invalid session"
      );

      return;
    }

    if (packet.op !== 0) {
      return;
    }

    await this.handleDispatch(
      packet.t,
      packet.d
    );
  }

  async handleDispatch(
    eventName,
    data
  ) {
    this.lastGatewayEventAt =
      new Date().toISOString();

    await this.ctx.storage.put(
      "last_gateway_event_at",
      this.lastGatewayEventAt
    );

    if (eventName === "READY") {
      this.sessionId =
        data?.session_id ?? null;

      this.resumeGatewayUrl =
        data?.resume_gateway_url ?? null;

      this.botUserId =
        data?.user?.id ?? null;

      this.connectionState = "ready";
      this.lastError = null;

      await Promise.all([
        this.ctx.storage.put(
          "discord_session_id",
          this.sessionId
        ),

        this.ctx.storage.put(
          "discord_resume_gateway_url",
          this.resumeGatewayUrl
        ),

        this.ctx.storage.put(
          "discord_bot_user_id",
          this.botUserId
        ),

        this.ctx.storage.delete(
          "last_error"
        )
      ]);

      return;
    }

    if (eventName === "RESUMED") {
      this.connectionState = "ready";
      this.lastError = null;

      await this.ctx.storage.delete(
        "last_error"
      );

      return;
    }

    if (eventName !== "MESSAGE_CREATE") {
      return;
    }

    await this.handleDiscordMessage(
      data
    );
  }

  async handleDiscordMessage(message) {
    if (
      !message ||
      !message.id ||
      !message.channel_id ||
      !message.author
    ) {
      return;
    }

    if (
      message.author.bot ||
      message.webhook_id
    ) {
      return;
    }

    if (
      String(message.channel_id) !==
      QUESTION_CHANNEL_ID
    ) {
      return;
    }

    const content =
      String(
        message.content || ""
      ).trim();

    if (
      !QUESTION_COMMAND.test(
        content
      )
    ) {
      return;
    }

    const currentQuestion =
      cleanQuestion(
        content.replace(
          QUESTION_COMMAND,
          ""
        )
      );

    let referencedMessage =
      message.referenced_message ||
      null;

    const referencedMessageId =
      message.message_reference
        ?.message_id;

    if (
      !referencedMessage &&
      referencedMessageId
    ) {
      try {
        referencedMessage =
          await this.discordRequest(
            `/channels/${message.channel_id}/messages/${referencedMessageId}`,
            {
              method: "GET"
            }
          );
      } catch {
        referencedMessage = null;
      }
    }

    const referencedText =
      cleanReferencedText(
        referencedMessage?.content
      );

    const currentImage =
      getFirstImageAttachment(
        message
      );

    const referencedImage =
      getFirstImageAttachment(
        referencedMessage
      );

    const imageAttachment =
      currentImage ||
      referencedImage;

    let effectiveQuestion = "";

    if (
      referencedText &&
      currentQuestion
    ) {
      effectiveQuestion = [
        `Önceki mesaj: ${referencedText}`,
        `Kullanıcının ek sorusu: ${currentQuestion}`
      ].join("\n");
    } else if (currentQuestion) {
      effectiveQuestion =
        currentQuestion;
    } else if (referencedText) {
      effectiveQuestion =
        referencedText;
    } else if (imageAttachment) {
      effectiveQuestion =
        "Bu görseldeki konu veya quest hakkında yardımcı ol.";
    }

    if (
      !effectiveQuestion &&
      !imageAttachment
    ) {
      await this.replyToMessage(
        message,
        "Sorunu `!soru` komutundan sonra yazabilir veya cevaplamak istediğin mesaja reply atıp sadece `!soru` yazabilirsin."
      );

      return;
    }

    const userId =
      String(message.author.id);

    const cooldownAcquired =
      await this.acquireCooldown(
        userId
      );

    if (!cooldownAcquired) {
      await this.replyToMessage(
        message,
        COOLDOWN_MESSAGE
      );

      return;
    }

    this.lastQuestionAt =
      new Date().toISOString();

    await this.ctx.storage.put(
      "last_question_at",
      this.lastQuestionAt
    );

    try {
      if (
        isChannelRecommendationQuestion(
          effectiveQuestion
        )
      ) {
        await this.replyToMessage(
          message,
          CHANNEL_RECOMMENDATION_MESSAGE
        );

        await this.clearLastError();

        return;
      }

      if (
        isIdentityQuestion(
          effectiveQuestion
        )
      ) {
        await this.replyToMessage(
          message,
          IDENTITY_MESSAGE
        );

        await this.clearLastError();

        return;
      }

      await this.safeTyping(
        message.channel_id
      );

      let imageContext = "";

      if (imageAttachment) {
        imageContext =
          await this.extractImageContext(
            imageAttachment,
            effectiveQuestion
          );
      }

      const finalQuestion =
        buildAiQuestion(
          effectiveQuestion,
          imageContext
        );

      if (!finalQuestion) {
        await this.releaseCooldown(
          userId
        );

        await this.replyToMessage(
          message,
          "Görseli veya soruyu anlayamadım. Biraz daha açık yazabilir ya da daha net bir ekran görüntüsü gönderebilirsin."
        );

        return;
      }

      const result =
        await this.askWowAi(
          finalQuestion
        );

      let answer =
        String(
          result?.answer || ""
        ).trim();

      if (!answer) {
        throw new Error(
          "totik-ai-test boş cevap döndürdü."
        );
      }

      answer =
        applyTotikIdentity(
          answer
        );

      answer =
        compactDiscordAnswer(
          answer
        );

      await this.replyToMessage(
        message,
        answer
      );

      await this.clearLastError();

    } catch (error) {
      // Teknik hata cooldown sayılmaz.
      await this.releaseCooldown(
        userId
      );

      await this.recordError(
        `Question failed: ${
          error?.message ||
          String(error)
        }`
      );

      await this.replyToMessage(
        message,
        "Soruyu cevaplandırırken teknik bir sorun oluştu. Biraz sonra tekrar deneyebilirsin."
      );
    }
  }

  async acquireCooldown(userId) {
    const key =
      `cooldown:${userId}`;

    const existing =
      await this.ctx.storage.get(
        key
      );

    const now = Date.now();

    if (
      typeof existing ===
        "number" &&
      now - existing <
        USER_COOLDOWN_MS
    ) {
      return false;
    }

    await this.ctx.storage.put(
      key,
      now
    );

    return true;
  }

  async releaseCooldown(userId) {
    await this.ctx.storage.delete(
      `cooldown:${userId}`
    );
  }

  async clearLastError() {
    this.lastError = null;

    await this.ctx.storage.delete(
      "last_error"
    );
  }

  async extractImageContext(
    imageAttachment,
    userQuestion
  ) {
    if (!this.env.GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY secret bulunamadı."
      );
    }

    const imageResponse =
      await fetch(
        imageAttachment.url
      );

    if (!imageResponse.ok) {
      throw new Error(
        `Görsel indirilemedi: HTTP ${imageResponse.status}`
      );
    }

    const arrayBuffer =
      await imageResponse.arrayBuffer();

    const bytes =
      new Uint8Array(
        arrayBuffer
      );

    if (
      bytes.byteLength === 0
    ) {
      throw new Error(
        "Görsel boş geldi."
      );
    }

    if (
      bytes.byteLength >
      7 * 1024 * 1024
    ) {
      throw new Error(
        "Görsel çok büyük, lütfen biraz daha küçük bir ekran görüntüsü gönder."
      );
    }

    const base64Image =
      bytesToBase64(
        bytes
      );

    const prompt = `
Sen bir World of Warcraft destek botuna yardımcı olan görsel analiz asistanısın.

Kullanıcının sorusu:
${userQuestion || "Bu quest nasıl yapılır?"}

Ekran görüntüsünü dikkatlice incele.

Şunları tespit et:
- Quest/görev adı
- Objective / görev amacı
- NPC, item veya hedef isimleri
- Bölge / zone
- Haritada görünen önemli konum
- Quest açıklamasında görevi çözmeye yarayan bilgi

Kurallar:
- Görseldeki metni mümkün olduğunca doğru oku.
- Emin olmadığın şeyi kesinmiş gibi yazma.
- Gereksiz açıklama yapma.
- Sadece daha sonra WoW bilgi sisteminin doğru görevi araştırabilmesi için gerekli bağlamı çıkar.
- Türkçe ve kısa yaz.

Çıktı biçimi:
Görev: ...
Amaç: ...
Bölge: ...
NPC/Item/Hedef: ...
Ek bağlam: ...
    `.trim();

    const visionResponse =
      await fetch(
        `${GEMINI_VISION_URL}?key=${encodeURIComponent(
          this.env.GEMINI_API_KEY
        )}`,
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: prompt
                    },

                    {
                      inlineData: {
                        mimeType:
                          imageAttachment.contentType ||
                          "image/png",

                        data:
                          base64Image
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

    const raw =
      await visionResponse.text();

    let data = {};

    try {
      data =
        raw
          ? JSON.parse(raw)
          : {};
    } catch {
      throw new Error(
        `Gemini vision geçersiz JSON döndürdü: ${raw.slice(
          0,
          300
        )}`
      );
    }

    if (!visionResponse.ok) {
      throw new Error(
        `Gemini vision HTTP ${
          visionResponse.status
        }: ${raw.slice(
          0,
          500
        )}`
      );
    }

    const parts =
      data?.candidates?.[0]
        ?.content?.parts ||
      [];

    const text =
      parts
        .map(
          (part) =>
            part?.text || ""
        )
        .join("\n")
        .replace(/\r/g, "")
        .replace(
          /\n{3,}/g,
          "\n\n"
        )
        .trim();

    if (!text) {
      throw new Error(
        "Gemini görselden okunabilir bağlam döndürmedi."
      );
    }

    return text;
  }

  async askWowAi(question) {
    const url =
      new URL(
        WOW_AI_URL
      );

    url.searchParams.set(
      "q",
      question
    );

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        45000
      );

    try {
      const response =
        await fetch(
          url.toString(),
          {
            method: "GET",

            signal:
              controller.signal,

            headers: {
              accept:
                "application/json"
            }
          }
        );

      const raw =
        await response.text();

      let data;

      try {
        data =
          raw
            ? JSON.parse(raw)
            : {};
      } catch {
        throw new Error(
          `totik-ai-test geçersiz JSON döndürdü: ${raw.slice(
            0,
            300
          )}`
        );
      }

      if (!response.ok) {
        throw new Error(
          `totik-ai-test HTTP ${
            response.status
          }: ${
            data?.error ||
            raw.slice(
              0,
              300
            )
          }`
        );
      }

      if (!data?.answer) {
        throw new Error(
          "totik-ai-test answer alanı döndürmedi."
        );
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async replyToMessage(
    originalMessage,
    answer
  ) {
    const chunks =
      splitDiscordMessage(
        answer
      );

    if (!chunks.length) {
      return;
    }

    for (
      let i = 0;
      i < chunks.length;
      i++
    ) {
      const body = {
        content:
          chunks[i],

        allowed_mentions: {
          parse: [],
          replied_user: false
        }
      };

      if (i === 0) {
        body.message_reference = {
          message_id:
            String(
              originalMessage.id
            ),

          channel_id:
            String(
              originalMessage.channel_id
            ),

          fail_if_not_exists:
            false
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
    } catch {}
  }

  sendIdentify() {
    if (
      !this.ws ||
      this.ws.readyState !==
        WebSocket.OPEN
    ) {
      return;
    }

    this.ws.send(
      JSON.stringify({
        op: 2,

        d: {
          token:
            this.env
              .DISCORD_BOT_TOKEN,

          intents:
            INTENTS,

          properties: {
            os: "cloudflare",
            browser:
              "totik-ai",
            device:
              "totik-ai"
          }
        }
      })
    );
  }

  sendResume() {
    if (
      !this.ws ||
      this.ws.readyState !==
        WebSocket.OPEN ||
      !this.sessionId ||
      this.sequence == null
    ) {
      this.sendIdentify();
      return;
    }

    this.ws.send(
      JSON.stringify({
        op: 6,

        d: {
          token:
            this.env
              .DISCORD_BOT_TOKEN,

          session_id:
            this.sessionId,

          seq:
            this.sequence
        }
      })
    );
  }

  startHeartbeat(interval) {
    this.clearHeartbeat();

    this.heartbeatIntervalMs =
      interval;

    this.heartbeatAwaitingAck =
      false;

    const initialDelay =
      Math.floor(
        Math.random() *
          interval
      );

    this.heartbeatStartTimer =
      setTimeout(
        () => {
          this.heartbeatStartTimer =
            null;

          if (
            !this.ws ||
            this.ws.readyState !==
              WebSocket.OPEN
          ) {
            return;
          }

          this.sendHeartbeat();

          this.heartbeatTimer =
            setInterval(
              () => {
                this.sendHeartbeat();
              },
              interval
            );
        },
        initialDelay
      );
  }

  sendHeartbeat() {
    if (
      !this.ws ||
      this.ws.readyState !==
        WebSocket.OPEN
    ) {
      return;
    }

    if (
      this.heartbeatAwaitingAck
    ) {
      this.ctx.waitUntil(
        this.recordError(
          "Heartbeat ACK gelmedi. Yeniden bağlanılıyor."
        )
      );

      this.reconnectNow(
        "Missed heartbeat ACK"
      );

      return;
    }

    this.heartbeatAwaitingAck =
      true;

    this.lastHeartbeatSentAt =
      Date.now();

    this.ws.send(
      JSON.stringify({
        op: 1,
        d: this.sequence
      })
    );
  }

  clearHeartbeat() {
    if (
      this.heartbeatStartTimer
    ) {
      clearTimeout(
        this.heartbeatStartTimer
      );
    }

    if (
      this.heartbeatTimer
    ) {
      clearInterval(
        this.heartbeatTimer
      );
    }

    this.heartbeatStartTimer =
      null;

    this.heartbeatTimer =
      null;

    this.heartbeatIntervalMs =
      null;

    this.heartbeatAwaitingAck =
      false;
  }

  handleSocketClose(event) {
    this.clearHeartbeat();

    this.ws = null;
    this.connectionState =
      "offline";

    this.connectStartedAt =
      null;

    const code =
      Number(
        event?.code || 0
      );

    if (
      [
        4004,
        4010,
        4011,
        4013,
        4014
      ].includes(code)
    ) {
      this.ctx.waitUntil(
        this.recordError(
          `Discord Gateway fatal close code ${code}`
        )
      );

      return;
    }

    if (
      [4007, 4009].includes(
        code
      )
    ) {
      this.ctx.waitUntil(
        this.clearSession()
      );
    }

    this.scheduleReconnect();
  }

  reconnectNow(
    reason = "Reconnect requested"
  ) {
    try {
      this.ws?.close(
        4000,
        reason
      );
    } catch {}

    this.ws = null;

    this.connectionState =
      "offline";

    this.connectStartedAt =
      null;

    this.clearHeartbeat();

    this.scheduleReconnect(
      500
    );
  }

  scheduleReconnect(
    delay = 2000
  ) {
    if (
      this.reconnectTimer
    ) {
      return;
    }

    this.reconnectTimer =
      setTimeout(
        () => {
          this.reconnectTimer =
            null;

          this.ctx.waitUntil(
            this.ensureConnected()
          );
        },
        delay
      );
  }

  clearReconnectTimer() {
    if (
      this.reconnectTimer
    ) {
      clearTimeout(
        this.reconnectTimer
      );
    }

    this.reconnectTimer =
      null;
  }

  async clearSession() {
    this.sessionId = null;
    this.resumeGatewayUrl =
      null;
    this.sequence = null;

    await Promise.all([
      this.ctx.storage.delete(
        "discord_session_id"
      ),

      this.ctx.storage.delete(
        "discord_resume_gateway_url"
      ),

      this.ctx.storage.delete(
        "discord_sequence"
      )
    ]);
  }

  async recordError(message) {
    this.lastError =
      String(
        message ||
        "Unknown error"
      );

    await this.ctx.storage.put(
      "last_error",
      this.lastError
    );
  }

  async discordRequest(
    path,
    options = {}
  ) {
    const method =
      options.method ||
      "GET";

    for (
      let attempt = 0;
      attempt < 4;
      attempt++
    ) {
      const headers = {
        Authorization:
          `Bot ${this.env.DISCORD_BOT_TOKEN}`
      };

      const init = {
        method,
        headers
      };

      if (
        options.body !==
        undefined
      ) {
        headers[
          "Content-Type"
        ] =
          "application/json";

        init.body =
          JSON.stringify(
            options.body
          );
      }

      const response =
        await fetch(
          `${DISCORD_API}${path}`,
          init
        );

      if (
        response.status ===
        204
      ) {
        return null;
      }

      const text =
        await response.text();

      let data = null;

      if (text) {
        try {
          data =
            JSON.parse(
              text
            );
        } catch {
          data = text;
        }
      }

      if (
        response.status ===
        429
      ) {
        let retryAfter =
          Number(
            data?.retry_after
          );

        if (
          !Number.isFinite(
            retryAfter
          )
        ) {
          retryAfter = 1;
        }

        if (
          retryAfter < 100
        ) {
          retryAfter *=
            1000;
        }

        await sleep(
          Math.max(
            500,
            retryAfter
          )
        );

        continue;
      }

      if (
        response.status >=
          500 &&
        attempt < 3
      ) {
        await sleep(
          1000 *
            (attempt + 1)
        );

        continue;
      }

      if (!response.ok) {
        const detail =
          typeof data ===
          "string"
            ? data
            : JSON.stringify(
                data
              );

        throw new Error(
          `Discord API ${method} ${path} -> ${response.status}: ${detail}`
        );
      }

      return data;
    }

    throw new Error(
      `Discord API ${method} ${path} maksimum retry sayısına ulaştı.`
    );
  }
}
