import { DurableObject } from "cloudflare:workers";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";

// GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT
const INTENTS = 1 | 512 | 32768;

const WOW_AI_URL = "https://totik-ai-test.totikch.workers.dev/";
const GEMINI_VISION_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const QUESTION_CHANNEL_ID = "1548811398069489744";
const QUESTION_COMMAND = /^!soru(?:\s|$)/i;

const MAX_DISCORD_MESSAGE = 1900;

// Offline kalmaması için watchdog
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

function cleanQuestion(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
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

function getFirstImageAttachment(message) {
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments
    : [];

  for (const attachment of attachments) {
    const contentType = String(attachment?.content_type || "").toLowerCase();
    const name = String(attachment?.filename || "").toLowerCase();
    const url = attachment?.url;

    const isImage =
      contentType.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(name);

    if (isImage && url) {
      return {
        url,
        contentType: contentType || guessMimeTypeFromFilename(name),
        filename: attachment.filename || "image"
      };
    }
  }

  return null;
}

function guessMimeTypeFromFilename(name) {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".bmp")) return "image/bmp";
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
  const questionText = cleanQuestion(userQuestion);

  if (imageContext) {
    const effectiveQuestion =
      questionText || "Bu görev/quest nasıl yapılır?";

    return [
      effectiveQuestion,
      "",
      "Ekran görüntüsünden çıkarılan bağlam:",
      imageContext,
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
        watchdogSeconds: WATCHDOG_INTERVAL_MS / 1000
      });
    }

    return new Response("Not found", { status: 404 });
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
        connected: this.ws?.readyState === WebSocket.OPEN,
        botUserId: this.botUserId,
        channelId: QUESTION_CHANNEL_ID,
        lastGatewayEventAt: this.lastGatewayEventAt,
        lastQuestionAt: this.lastQuestionAt,
        lastHeartbeatSentAt: this.lastHeartbeatSentAt
          ? new Date(this.lastHeartbeatSentAt).toISOString()
          : null,
        lastHeartbeatAckAt: this.lastHeartbeatAckAt
          ? new Date(this.lastHeartbeatAckAt).toISOString()
          : null,
        heartbeatAwaitingAck: this.heartbeatAwaitingAck,
        watchdogSeconds: WATCHDOG_INTERVAL_MS / 1000,
        lastError: this.lastError
      });
    }

    if (url.pathname === "/start") {
      if (!this.env.DISCORD_BOT_TOKEN) {
        return json(
          {
            ok: false,
            error: "DISCORD_BOT_TOKEN secret bulunamadı."
          },
          500
        );
      }

      await this.ensureAlarmScheduled(true);
      await this.watchdog();

      return json({
        ok: true,
        state: this.connectionState,
        connected: this.ws?.readyState === WebSocket.OPEN,
        channelId: QUESTION_CHANNEL_ID,
        watchdogSeconds: WATCHDOG_INTERVAL_MS / 1000
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    try {
      await this.watchdog();
    } catch (error) {
      await this.recordError(
        `Watchdog failed: ${error?.message || String(error)}`
      );
    } finally {
      await this.ctx.storage.setAlarm(
        Date.now() + WATCHDOG_INTERVAL_MS
      );
    }
  }

  async ensureAlarmScheduled(force = false) {
    const current = await this.ctx.storage.getAlarm();
    const now = Date.now();

    if (
      force ||
      current == null ||
      current > now + WATCHDOG_INTERVAL_MS + 10000
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

    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      if (
        this.connectStartedAt &&
        now - this.connectStartedAt > CONNECT_TIMEOUT_MS
      ) {
        await this.recordError(
          "Discord Gateway bağlantısı CONNECTING durumunda takıldı. Yeniden bağlanılıyor."
        );
        this.reconnectNow("Gateway connect timeout");
      }
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const ackTooOld =
        this.heartbeatAwaitingAck &&
        this.lastHeartbeatSentAt &&
        now - this.lastHeartbeatSentAt >
          Math.max(
            45000,
            (this.heartbeatIntervalMs || 45000) * 2
          );

      if (ackTooOld) {
        await this.recordError(
          "Heartbeat ACK çok gecikti. Yeniden bağlanılıyor."
        );
        this.reconnectNow("Missed heartbeat ACK");
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

    const gatewayUrl = this.resumeGatewayUrl
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
        `Gateway connection failed: ${error?.message || String(error)}`
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

    // HELLO
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

    // HEARTBEAT ACK
    if (packet.op === 11) {
      this.heartbeatAwaitingAck = false;
      this.lastHeartbeatAckAt = Date.now();
      return;
    }

    // HEARTBEAT REQUEST
    if (packet.op === 1) {
      this.sendHeartbeat();
      return;
    }

    // RECONNECT
    if (packet.op === 7) {
      this.reconnectNow("Discord op 7 reconnect");
      return;
    }

    // INVALID SESSION
    if (packet.op === 9) {
      if (!packet.d) {
        await this.clearSession();
      }

      await sleep(1000);
      this.reconnectNow("Invalid session");
      return;
    }

    if (packet.op !== 0) {
      return;
    }

    await this.handleDispatch(packet.t, packet.d);
  }

  async handleDispatch(eventName, data) {
    this.lastGatewayEventAt = new Date().toISOString();

    await this.ctx.storage.put(
      "last_gateway_event_at",
      this.lastGatewayEventAt
    );

    if (eventName === "READY") {
      this.sessionId = data?.session_id ?? null;
      this.resumeGatewayUrl = data?.resume_gateway_url ?? null;
      this.botUserId = data?.user?.id ?? null;

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
        this.ctx.storage.delete("last_error")
      ]);

      return;
    }

    if (eventName === "RESUMED") {
      this.connectionState = "ready";
      this.lastError = null;

      await this.ctx.storage.delete("last_error");
      return;
    }

    if (eventName !== "MESSAGE_CREATE") {
      return;
    }

    await this.handleDiscordMessage(data);
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

    if (message.author.bot || message.webhook_id) {
      return;
    }

    // Sadece soru odasında çalışır
    if (String(message.channel_id) !== QUESTION_CHANNEL_ID) {
      return;
    }

    const content = String(message.content || "").trim();

    // !soru yoksa burada biter
    if (!QUESTION_COMMAND.test(content)) {
      return;
    }

    const imageAttachment = getFirstImageAttachment(message);

    let question = cleanQuestion(
      content.replace(QUESTION_COMMAND, "")
    );

    if (!question && !imageAttachment) {
      await this.replyToMessage(
        message,
        "Sorunu `!soru` komutundan sonra yaz. İstersen quest ekran görüntüsü de ekleyebilirsin."
      );
      return;
    }

    this.lastQuestionAt = new Date().toISOString();

    await this.ctx.storage.put(
      "last_question_at",
      this.lastQuestionAt
    );

    await this.safeTyping(message.channel_id);

    try {
      let imageContext = "";

      if (imageAttachment) {
        imageContext = await this.extractImageContext(
          imageAttachment,
          question
        );
      }

      const finalQuestion = buildAiQuestion(
        question,
        imageContext
      );

      if (!finalQuestion) {
        await this.replyToMessage(
          message,
          "Görseli veya soruyu anlayamadım. Biraz daha açık yazabilir ya da daha net bir ekran görüntüsü gönderebilirsin."
        );
        return;
      }

      const result = await this.askWowAi(finalQuestion);

      const answer = String(result?.answer || "").trim();

      if (!answer) {
        throw new Error(
          "totik-ai-test boş cevap döndürdü."
        );
      }

      await this.replyToMessage(message, answer);
    } catch (error) {
      await this.recordError(
        `Question failed: ${error?.message || String(error)}`
      );

      await this.replyToMessage(
        message,
        "Soruyu cevaplandırırken teknik bir sorun oluştu. Biraz sonra tekrar deneyebilirsin."
      );
    }
  }

  async extractImageContext(imageAttachment, userQuestion) {
    if (!this.env.GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY secret bulunamadı."
      );
    }

    const imageResponse = await fetch(imageAttachment.url);

    if (!imageResponse.ok) {
      throw new Error(
        `Görsel indirilemedi: HTTP ${imageResponse.status}`
      );
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.byteLength === 0) {
      throw new Error("Görsel boş geldi.");
    }

    // Çok büyük görselleri istemeden patlatmamak için üst sınır
    if (bytes.byteLength > 7 * 1024 * 1024) {
      throw new Error(
        "Görsel çok büyük, lütfen biraz daha küçük bir ekran görüntüsü gönder."
      );
    }

    const base64Image = bytesToBase64(bytes);

    const prompt = `
Sen bir WoW destek botuna yardımcı olan görsel analiz asistanısın.

Kullanıcı mesajı:
${userQuestion || "(kullanıcı ek yazı yazmadı)"}

Görevin:
- World of Warcraft ekran görüntüsünü incele.
- Görselde görünen quest/görev adı varsa tespit et.
- Quest metnindeki objective/amaç kısmını çıkar.
- Harita veya bölge görünüyorsa bunu belirt.
- Kullanıcının muhtemelen ne sorduğunu kısaca bağlamlaştır.

Kurallar:
- Sadece görselde gerçekten görülen bilgileri kullan.
- Cevabı Türkçe ver.
- Kısa ve bilgi odaklı ol.
- Düz metin dön.
- Eğer quest adı görünüyorsa ilk satırda belirt.
- Eğer görev görünmüyorsa bunu açıkça söyle.

İstenen çıktı örneği:
Görev: ...
Amaç: ...
Bölge: ...
Bağlam: ...
    `.trim();

    const visionResponse = await fetch(
      `${GEMINI_VISION_URL}?key=${encodeURIComponent(this.env.GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType:
                      imageAttachment.contentType || "image/png",
                    data: base64Image
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 300
          }
        })
      }
    );

    const raw = await visionResponse.text();

    let data = {};

    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(
        `Gemini vision geçersiz JSON döndürdü: ${raw.slice(0, 300)}`
      );
    }

    if (!visionResponse.ok) {
      throw new Error(
        `Gemini vision HTTP ${visionResponse.status}: ${raw.slice(0, 300)}`
      );
    }

    const parts =
      data?.candidates?.[0]?.content?.parts || [];

    const text = parts
      .map((part) => part?.text || "")
      .join("\n")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return text;
  }

  async askWowAi(question) {
    const url = new URL(WOW_AI_URL);
    url.searchParams.set("q", question);

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      45000
    );

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        signal: controller.signal,
        headers: {
          accept: "application/json"
        }
      });

      const raw = await response.text();

      let data;

      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(
          `totik-ai-test geçersiz JSON döndürdü: ${raw.slice(0, 300)}`
        );
      }

      if (!response.ok) {
        throw new Error(
          `totik-ai-test HTTP ${response.status}: ${
            data?.error || raw.slice(0, 300)
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

  async replyToMessage(originalMessage, answer) {
    const chunks = splitDiscordMessage(answer);

    if (!chunks.length) return;

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
      // typing başarısız olsa da devam
    }
  }

  sendIdentify() {
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
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

  sendResume() {
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
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
          token: this.env.DISCORD_BOT_TOKEN,
          session_id: this.sessionId,
          seq: this.sequence
        }
      })
    );
  }

  startHeartbeat(interval) {
    this.clearHeartbeat();

    this.heartbeatIntervalMs = interval;
    this.heartbeatAwaitingAck = false;

    const initialDelay = Math.floor(
      Math.random() * interval
    );

    this.heartbeatStartTimer = setTimeout(() => {
      this.heartbeatStartTimer = null;

      if (
        !this.ws ||
        this.ws.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      this.sendHeartbeat();

      this.heartbeatTimer = setInterval(() => {
        this.sendHeartbeat();
      }, interval);
    }, initialDelay);
  }

  sendHeartbeat() {
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    if (this.heartbeatAwaitingAck) {
      this.ctx.waitUntil(
        this.recordError(
          "Heartbeat ACK gelmedi. Yeniden bağlanılıyor."
        )
      );
      this.reconnectNow("Missed heartbeat ACK");
      return;
    }

    this.heartbeatAwaitingAck = true;
    this.lastHeartbeatSentAt = Date.now();

    this.ws.send(
      JSON.stringify({
        op: 1,
        d: this.sequence
      })
    );
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
    this.heartbeatIntervalMs = null;
    this.heartbeatAwaitingAck = false;
  }

  handleSocketClose(event) {
    this.clearHeartbeat();

    this.ws = null;
    this.connectionState = "offline";
    this.connectStartedAt = null;

    const code = Number(event?.code || 0);

    if (
      [4004, 4010, 4011, 4013, 4014].includes(code)
    ) {
      this.ctx.waitUntil(
        this.recordError(
          `Discord Gateway fatal close code ${code}`
        )
      );
      return;
    }

    if ([4007, 4009].includes(code)) {
      this.ctx.waitUntil(this.clearSession());
    }

    this.scheduleReconnect();
  }

  reconnectNow(reason = "Reconnect requested") {
    try {
      this.ws?.close(4000, reason);
    } catch {
      // ignore
    }

    this.ws = null;
    this.connectionState = "offline";
    this.connectStartedAt = null;
    this.clearHeartbeat();

    this.scheduleReconnect(500);
  }

  scheduleReconnect(delay = 2000) {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ctx.waitUntil(this.ensureConnected());
    }, delay);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = null;
  }

  async clearSession() {
    this.sessionId = null;
    this.resumeGatewayUrl = null;
    this.sequence = null;

    await Promise.all([
      this.ctx.storage.delete("discord_session_id"),
      this.ctx.storage.delete("discord_resume_gateway_url"),
      this.ctx.storage.delete("discord_sequence")
    ]);
  }

  async recordError(message) {
    this.lastError = String(message || "Unknown error");

    await this.ctx.storage.put(
      "last_error",
      this.lastError
    );
  }

  async discordRequest(path, options = {}) {
    const method = options.method || "GET";

    for (let attempt = 0; attempt < 4; attempt++) {
      const headers = {
        Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`
      };

      const init = {
        method,
        headers
      };

      if (options.body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(options.body);
      }

      const response = await fetch(
        `${DISCORD_API}${path}`,
        init
      );

      if (response.status === 204) {
        return null;
      }

      const text = await response.text();

      let data = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (response.status === 429) {
        let retryAfter = Number(data?.retry_after);

        if (!Number.isFinite(retryAfter)) {
          retryAfter = 1;
        }

        if (retryAfter < 100) {
          retryAfter *= 1000;
        }

        await sleep(
          Math.max(500, retryAfter)
        );

        continue;
      }

      if (response.status >= 500 && attempt < 3) {
        await sleep(1000 * (attempt + 1));
        continue;
      }

      if (!response.ok) {
        const detail =
          typeof data === "string"
            ? data
            : JSON.stringify(data);

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
