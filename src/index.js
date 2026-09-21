import { DurableObject } from "cloudflare:workers";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";

// GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT
const INTENTS = 1 | 512 | 32768;

// Çalışan WoW AI Worker'ımız.
const WOW_AI_URL = "https://totik-ai-test.totikch.workers.dev/";

const QUESTION_COMMAND = /^!soru(?:\s|$)/i;
const MAX_DISCORD_MESSAGE = 1900;

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

  if (remaining) chunks.push(remaining);

  return chunks;
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

    if (
      url.pathname === "/" ||
      url.pathname === "/start"
    ) {
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
        backend: WOW_AI_URL
      });
    }

    return new Response("Not found", {
      status: 404
    });
  },

  async scheduled(controller, env, ctx) {
    if (!env.GATEWAY) return;

    const stub = env.GATEWAY.get(
      env.GATEWAY.idFromName("totik-ai-main")
    );

    ctx.waitUntil(
      stub.fetch(
        new Request("https://internal/start")
      )
    );
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

    this.lastGatewayEventAt = null;
    this.lastQuestionAt = null;
    this.lastError = null;

    this.heartbeatTimer = null;
    this.heartbeatStartTimer = null;
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
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/status") {
      return json({
        state: this.connectionState,
        connected: this.ws?.readyState === WebSocket.OPEN,
        botUserId: this.botUserId,
        lastGatewayEventAt: this.lastGatewayEventAt,
        lastQuestionAt: this.lastQuestionAt,
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

      await this.ensureAlarm();
      await this.ensureConnected();

      return json({
        ok: true,
        state: this.connectionState
      });
    }

    return new Response("Not found", {
      status: 404
    });
  }

  async alarm() {
    try {
      await this.ensureConnected();
    } catch (error) {
      await this.recordError(
        `Alarm reconnect failed: ${error?.message || String(error)}`
      );
    } finally {
      await this.ctx.storage.setAlarm(
        Date.now() + 5 * 60 * 1000
      );
    }
  }

  async ensureAlarm() {
    const current = await this.ctx.storage.getAlarm();

    if (current == null) {
      await this.ctx.storage.setAlarm(
        Date.now() + 5 * 60 * 1000
      );
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

    this.connectionState = "connecting";

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
      return;
    }

    // HEARTBEAT REQUEST
    if (packet.op === 1) {
      this.sendHeartbeat();
      return;
    }

    // RECONNECT
    if (packet.op === 7) {
      this.reconnectNow();
      return;
    }

    // INVALID SESSION
    if (packet.op === 9) {
      if (!packet.d) {
        await this.clearSession();
      }

      await sleep(1000);

      this.reconnectNow();
      return;
    }

    // DISPATCH
    if (packet.op !== 0) {
      return;
    }

    await this.handleDispatch(
      packet.t,
      packet.d
    );
  }

  async handleDispatch(eventName, data) {
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

    // Sadece yeni mesaj.
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

    // Botların mesajlarını tamamen yok say.
    if (
      message.author.bot ||
      message.webhook_id
    ) {
      return;
    }

    const content =
      String(message.content || "").trim();

    // ========================================================
    // !soru YOKSA BURADA BİTER.
    //
    // Gemini çağrısı YOK.
    // Tavily çağrısı YOK.
    // totik-ai-test çağrısı YOK.
    // ========================================================

    if (!QUESTION_COMMAND.test(content)) {
      return;
    }

    const question = cleanQuestion(
      content.replace(
        QUESTION_COMMAND,
        ""
      )
    );

    if (!question) {
      await this.replyToMessage(
        message,
        "Sorunu `!soru` komutundan sonra yaz.\nÖrnek: `!soru Stormwind'den Ironforge'a nasıl giderim?`"
      );

      return;
    }

    this.lastQuestionAt =
      new Date().toISOString();

    await this.ctx.storage.put(
      "last_question_at",
      this.lastQuestionAt
    );

    await this.safeTyping(
      message.channel_id
    );

    try {
      const result =
        await this.askWowAi(question);

      const answer =
        String(result?.answer || "").trim();

      if (!answer) {
        throw new Error(
          "totik-ai-test boş cevap döndürdü."
        );
      }

      await this.replyToMessage(
        message,
        answer
      );
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

  async askWowAi(question) {
    const url =
      new URL(WOW_AI_URL);

    url.searchParams.set(
      "q",
      question
    );

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () => controller.abort(),
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
          `totik-ai-test geçersiz JSON döndürdü: ${raw.slice(0, 300)}`
        );
      }

      if (!response.ok) {
        throw new Error(
          `totik-ai-test HTTP ${response.status}: ${
            data?.error ||
            raw.slice(0, 300)
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
      splitDiscordMessage(answer);

    if (!chunks.length) return;

    for (
      let i = 0;
      i < chunks.length;
      i++
    ) {
      const body = {
        content: chunks[i],

        allowed_mentions: {
          parse: [],
          replied_user: false
        }
      };

      if (i === 0) {
        body.message_reference = {
          message_id:
            String(originalMessage.id),

          channel_id:
            String(originalMessage.channel_id),

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
            this.env.DISCORD_BOT_TOKEN,

          intents:
            INTENTS,

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
            this.env.DISCORD_BOT_TOKEN,

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

    const initialDelay =
      Math.floor(
        Math.random() * interval
      );

    this.heartbeatStartTimer =
      setTimeout(
        () => {
          this.heartbeatStartTimer = null;

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
              () => this.sendHeartbeat(),
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

    this.ws.send(
      JSON.stringify({
        op: 1,
        d: this.sequence
      })
    );
  }

  clearHeartbeat() {
    if (this.heartbeatStartTimer) {
      clearTimeout(
        this.heartbeatStartTimer
      );
    }

    if (this.heartbeatTimer) {
      clearInterval(
        this.heartbeatTimer
      );
    }

    this.heartbeatStartTimer = null;
    this.heartbeatTimer = null;
  }

  handleSocketClose(event) {
    this.clearHeartbeat();

    this.ws = null;
    this.connectionState = "offline";

    const code =
      Number(event?.code || 0);

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
      [4007, 4009].includes(code)
    ) {
      this.ctx.waitUntil(
        this.clearSession()
      );
    }

    this.scheduleReconnect();
  }

  reconnectNow() {
    try {
      this.ws?.close(
        4000,
        "Reconnect requested"
      );
    } catch {}

    this.ws = null;
    this.connectionState = "offline";

    this.scheduleReconnect(500);
  }

  scheduleReconnect(delay = 2000) {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer =
      setTimeout(
        () => {
          this.reconnectTimer = null;

          this.ctx.waitUntil(
            this.ensureConnected()
          );
        },

        delay
      );
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(
        this.reconnectTimer
      );
    }

    this.reconnectTimer = null;
  }

  async clearSession() {
    this.sessionId = null;
    this.resumeGatewayUrl = null;
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
      String(message || "Unknown error");

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
      options.method || "GET";

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
        options.body !== undefined
      ) {
        headers["Content-Type"] =
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

      if (response.status === 204) {
        return null;
      }

      const text =
        await response.text();

      let data = null;

      if (text) {
        try {
          data =
            JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (response.status === 429) {
        let retryAfter =
          Number(data?.retry_after);

        if (
          !Number.isFinite(retryAfter)
        ) {
          retryAfter = 1;
        }

        if (retryAfter < 100) {
          retryAfter *= 1000;
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
        response.status >= 500 &&
        attempt < 3
      ) {
        await sleep(
          1000 * (attempt + 1)
        );

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
