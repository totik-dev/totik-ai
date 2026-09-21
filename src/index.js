import { DurableObject } from "cloudflare:workers";

const DISCORD_API = "https://discord.com/api/v10";

const QUESTION_CHANNEL_ID = "1548811398069489744";
const QUESTION_COMMAND = /^!soru(?:\s|$)/i;

const WOW_AI_URL = "https://totik-ai-test.totikch.workers.dev/";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

// 30 saniyede bir Discord kanalını kontrol eder.
// Sürekli Gateway/WebSocket YOK.
const POLL_INTERVAL_MS = 30_000;

// Kullanıcı başına 10 dakika.
const USER_COOLDOWN_MS = 10 * 60_000;

// Backend geçici hata koruması.
const AI_TIMEOUT_MS = 60_000;
const AI_MAX_ATTEMPTS = 2;

// Discord cevabını biraz daha derli toplu tutuyoruz.
const MAX_ANSWER_CHARS = 1100;
const MAX_DISCORD_MESSAGE = 1900;

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

function compareSnowflakes(a, b) {
  try {
    const aa = BigInt(String(a?.id || "0"));
    const bb = BigInt(String(b?.id || "0"));

    if (aa < bb) return -1;
    if (aa > bb) return 1;
    return 0;
  } catch {
    return String(a?.id || "").localeCompare(
      String(b?.id || "")
    );
  }
}

function splitDiscordMessage(value) {
  let text = String(value || "").trim();

  if (!text) return [];

  if (text.length <= MAX_DISCORD_MESSAGE) {
    return [text];
  }

  const chunks = [];

  while (text.length > MAX_DISCORD_MESSAGE) {
    let cut = text.lastIndexOf(
      "\n",
      MAX_DISCORD_MESSAGE
    );

    if (cut < 800) {
      cut = text.lastIndexOf(
        " ",
        MAX_DISCORD_MESSAGE
      );
    }

    if (cut < 800) {
      cut = MAX_DISCORD_MESSAGE;
    }

    chunks.push(
      text.slice(0, cut).trim()
    );

    text =
      text.slice(cut).trim();
  }

  if (text) {
    chunks.push(text);
  }

  return chunks;
}

function tidyAnswer(value) {
  let text = String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  // Jenerik bot kimliğini Totik kimliğine çevir.
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

  const sample =
    text.slice(0, MAX_ANSWER_CHARS);

  const cuts = [
    sample.lastIndexOf(". "),
    sample.lastIndexOf("! "),
    sample.lastIndexOf("? "),
    sample.lastIndexOf("\n")
  ];

  let cut =
    Math.max(...cuts);

  if (cut < 700) {
    cut = MAX_ANSWER_CHARS;
  } else {
    cut += 1;
  }

  return `${text.slice(0, cut).trim()}…`;
}

function isIdentityQuestion(question) {
  const q =
    String(question || "")
      .toLocaleLowerCase("tr-TR");

  return (
    q.includes("sen kimsin") ||
    q.includes("sen nesin") ||
    q.includes("kimin botusun") ||
    q.includes("kim geliştirdi") ||
    q.includes("kim yaptı seni") ||
    q.includes("hangi kanal için geliştirildin")
  );
}

function isChannelRecommendationQuestion(question) {
  const q =
    String(question || "")
      .toLocaleLowerCase("tr-TR");

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
    q.includes("takip edeyim") ||
    q.includes("takip etmeliyim");

  return channel && recommendation;
}

function guessMimeType(filename) {
  const name =
    String(filename || "")
      .toLowerCase();

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

  return "image/png";
}

function getImageAttachment(message) {
  const attachments =
    Array.isArray(message?.attachments)
      ? message.attachments
      : [];

  for (const attachment of attachments) {
    const contentType =
      String(
        attachment?.content_type || ""
      ).toLowerCase();

    const filename =
      String(
        attachment?.filename || ""
      ).toLowerCase();

    const isImage =
      contentType.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif)$/i.test(
        filename
      );

    if (
      isImage &&
      attachment?.url
    ) {
      return {
        url: attachment.url,
        contentType:
          contentType ||
          guessMimeType(filename)
      };
    }
  }

  return null;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {
    binary +=
      String.fromCharCode(
        ...bytes.subarray(
          i,
          i + chunkSize
        )
      );
  }

  return btoa(binary);
}

function retryableBackendStatus(status) {
  return (
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

export default {
  async fetch(request, env) {
    const url =
      new URL(request.url);

    // DO kotası bitmiş olsa bile health çalışır.
    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "totik-ai",
        mode: "polling",
        pollIntervalSeconds:
          POLL_INTERVAL_MS / 1000,
        cooldownMinutes:
          USER_COOLDOWN_MS / 60000,
        gatewayWebSocket: false,
        replySupport: true,
        imageSupport: true
      });
    }

    if (!env.GATEWAY) {
      return json(
        {
          ok: false,
          error:
            "GATEWAY Durable Object binding bulunamadı."
        },
        500
      );
    }

    const stub =
      env.GATEWAY.get(
        env.GATEWAY.idFromName(
          "totik-ai-main"
        )
      );

    try {
      if (
        url.pathname === "/" ||
        url.pathname === "/start"
      ) {
        return await stub.fetch(
          new Request(
            "https://internal/start"
          )
        );
      }

      if (
        url.pathname === "/status"
      ) {
        return await stub.fetch(
          new Request(
            "https://internal/status"
          )
        );
      }

      if (
        url.pathname === "/stop"
      ) {
        return await stub.fetch(
          new Request(
            "https://internal/stop"
          )
        );
      }

      if (
        url.pathname === "/run"
      ) {
        return await stub.fetch(
          new Request(
            "https://internal/run"
          )
        );
      }
    } catch (error) {
      return json(
        {
          ok: false,
          error:
            "durable_object_unavailable",
          detail:
            error?.message ||
            String(error)
        },
        503
      );
    }

    return new Response(
      "Not found",
      {
        status: 404
      }
    );
  }
};

// İsim aynı bırakıldı.
// Böylece wrangler.jsonc ve mevcut DO namespace değişmiyor.
// Artık Discord Gateway DEĞİL; polling motoru.
export class DiscordGateway extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url =
      new URL(request.url);

    if (
      url.pathname === "/start"
    ) {
      if (
        !this.env.DISCORD_BOT_TOKEN
      ) {
        return json(
          {
            ok: false,
            error:
              "DISCORD_BOT_TOKEN bulunamadı."
          },
          500
        );
      }

      // İlk kullanımda mevcut son Discord mesajını
      // cursor olarak kaydet. Eski mesajlara cevap verme.
      await this.ensureInitialized();

      await this.ctx.storage.setAlarm(
        Date.now() + 1000
      );

      return json({
        ok: true,
        state: "polling",
        running: true,
        pollIntervalSeconds:
          POLL_INTERVAL_MS / 1000,
        channelId:
          QUESTION_CHANNEL_ID
      });
    }

    if (
      url.pathname === "/stop"
    ) {
      await this.ctx.storage.deleteAlarm();

      return json({
        ok: true,
        state: "stopped"
      });
    }

    if (
      url.pathname === "/run"
    ) {
      await this.ensureInitialized();
      await this.pollOnce();

      await this.ctx.storage.setAlarm(
        Date.now() +
          POLL_INTERVAL_MS
      );

      return json({
        ok: true,
        state: "polling",
        manualRun: true
      });
    }

    if (
      url.pathname === "/status"
    ) {
      const [
        initialized,
        lastMessageId,
        lastPollAt,
        lastQuestionAt,
        lastError,
        lastBackendStatus,
        lastBackendAttempts,
        lastBackendDurationMs,
        answeredCount,
        technicalFailureCount
      ] =
        await Promise.all([
          this.ctx.storage.get(
            "initialized"
          ),
          this.ctx.storage.get(
            "last_message_id"
          ),
          this.ctx.storage.get(
            "last_poll_at"
          ),
          this.ctx.storage.get(
            "last_question_at"
          ),
          this.ctx.storage.get(
            "last_error"
          ),
          this.ctx.storage.get(
            "last_backend_status"
          ),
          this.ctx.storage.get(
            "last_backend_attempts"
          ),
          this.ctx.storage.get(
            "last_backend_duration_ms"
          ),
          this.ctx.storage.get(
            "answered_count"
          ),
          this.ctx.storage.get(
            "technical_failure_count"
          )
        ]);

      const alarmAt =
        await this.ctx.storage.getAlarm();

      return json({
        state:
          alarmAt
            ? "polling"
            : "stopped",

        running:
          alarmAt != null,

        mode: "polling",

        initialized:
          initialized === true,

        pollIntervalSeconds:
          POLL_INTERVAL_MS / 1000,

        channelId:
          QUESTION_CHANNEL_ID,

        lastMessageId:
          lastMessageId || null,

        lastPollAt:
          lastPollAt || null,

        lastQuestionAt:
          lastQuestionAt || null,

        nextPollAt:
          alarmAt
            ? new Date(
                alarmAt
              ).toISOString()
            : null,

        lastBackendStatus:
          lastBackendStatus ?? null,

        lastBackendAttempts:
          lastBackendAttempts ?? null,

        lastBackendDurationMs:
          lastBackendDurationMs ?? null,

        answeredCount:
          answeredCount ?? 0,

        technicalFailureCount:
          technicalFailureCount ?? 0,

        lastError:
          lastError || null
      });
    }

    return new Response(
      "Not found",
      {
        status: 404
      }
    );
  }

  async alarm() {
    const startedAt =
      Date.now();

    try {
      await this.ensureInitialized();
      await this.pollOnce();
    } catch (error) {
      await this.setLastError(
        `Polling: ${
          error?.message ||
          String(error)
        }`
      );
    } finally {
      // Sorunun cevabı uzun sürdüyse fazladan
      // 30 saniye beklemeyelim.
      const target =
        startedAt +
        POLL_INTERVAL_MS;

      const nextAlarm =
        Math.max(
          Date.now() + 1000,
          target
        );

      await this.ctx.storage.setAlarm(
        nextAlarm
      );
    }
  }

  async ensureInitialized() {
    const initialized =
      await this.ctx.storage.get(
        "initialized"
      );

    if (initialized === true) {
      return;
    }

    // İlk başlangıçta kanalın en son mesajını al.
    // Böylece geçmişteki !soru mesajlarını topluca cevaplamaz.
    const messages =
      await this.discordRequest(
        `/channels/${QUESTION_CHANNEL_ID}/messages?limit=1`
      );

    if (
      Array.isArray(messages) &&
      messages.length
    ) {
      await this.ctx.storage.put(
        "last_message_id",
        String(messages[0].id)
      );
    }

    await this.ctx.storage.put(
      "initialized",
      true
    );

    await this.ctx.storage.put(
      "last_poll_at",
      new Date().toISOString()
    );
  }

  async pollOnce() {
    let cursor =
      await this.ctx.storage.get(
        "last_message_id"
      );

    // En fazla 5 sayfa.
    // 30 saniyede 500+ mesaj gelmedikçe hiçbir şey kaçmaz.
    for (
      let page = 0;
      page < 5;
      page++
    ) {
      const query =
        cursor
          ? `?after=${encodeURIComponent(
              cursor
            )}&limit=100`
          : "?limit=1";

      const messages =
        await this.discordRequest(
          `/channels/${QUESTION_CHANNEL_ID}/messages${query}`
        );

      if (
        !Array.isArray(messages) ||
        messages.length === 0
      ) {
        break;
      }

      messages.sort(
        compareSnowflakes
      );

      for (
        const message of messages
      ) {
        const messageId =
          String(message.id);

        try {
          await this.processMessage(
            message
          );
        } catch (error) {
          await this.setLastError(
            `Message ${messageId}: ${
              error?.message ||
              String(error)
            }`
          );
        }

        // Bu mesaj işlendi/atlandı.
        // Sonraki poll'da tekrar dönmeyelim.
        cursor = messageId;

        await this.ctx.storage.put(
          "last_message_id",
          cursor
        );
      }

      if (
        messages.length < 100
      ) {
        break;
      }
    }

    await this.ctx.storage.put(
      "last_poll_at",
      new Date().toISOString()
    );
  }

  async processMessage(message) {
    if (
      !message?.id ||
      !message?.author
    ) {
      return;
    }

    // Kendi cevaplarımızı ve diğer botları tekrar işleme.
    if (
      message.author.bot ||
      message.webhook_id
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
      cleanText(
        content.replace(
          QUESTION_COMMAND,
          ""
        ),
        1800
      );

    let referencedMessage =
      message.referenced_message ||
      null;

    const referencedId =
      message.message_reference
        ?.message_id;

    if (
      !referencedMessage &&
      referencedId
    ) {
      try {
        referencedMessage =
          await this.discordRequest(
            `/channels/${QUESTION_CHANNEL_ID}/messages/${referencedId}`
          );
      } catch {
        referencedMessage =
          null;
      }
    }

    const referencedText =
      cleanText(
        referencedMessage?.content ||
        "",
        1600
      );

    const image =
      getImageAttachment(
        message
      ) ||
      getImageAttachment(
        referencedMessage
      );

    let effectiveQuestion = "";

    if (
      referencedText &&
      currentQuestion
    ) {
      effectiveQuestion =
        `Önceki mesaj: ${referencedText}\n` +
        `Ek soru: ${currentQuestion}`;
    } else if (
      currentQuestion
    ) {
      effectiveQuestion =
        currentQuestion;
    } else if (
      referencedText
    ) {
      effectiveQuestion =
        referencedText;
    } else if (image) {
      effectiveQuestion =
        "Bu görseldeki World of Warcraft konusu veya görevi hakkında yardımcı ol.";
    }

    if (
      !effectiveQuestion &&
      !image
    ) {
      await this.reply(
        message,
        "Sorunu `!soru` komutundan sonra yazabilir veya cevaplamak istediğin mesaja reply atıp sadece `!soru` yazabilirsin."
      );

      return;
    }

    const userId =
      String(
        message.author.id
      );

    const cooldownAllowed =
      await this.acquireCooldown(
        userId
      );

    if (!cooldownAllowed) {
      await this.reply(
        message,
        COOLDOWN_MESSAGE
      );

      return;
    }

    await this.ctx.storage.put(
      "last_question_at",
      new Date().toISOString()
    );

    // Bunlar AI/Tavily çağrısı yapmaz.
    if (
      isChannelRecommendationQuestion(
        effectiveQuestion
      )
    ) {
      await this.reply(
        message,
        CHANNEL_RECOMMENDATION_MESSAGE
      );

      await this.markAnswered();
      await this.clearLastError();

      return;
    }

    if (
      isIdentityQuestion(
        effectiveQuestion
      )
    ) {
      await this.reply(
        message,
        IDENTITY_MESSAGE
      );

      await this.markAnswered();
      await this.clearLastError();

      return;
    }

    try {
      await this.safeTyping(
        QUESTION_CHANNEL_ID
      );

      let imageContext = "";

      if (image) {
        imageContext =
          await this.analyzeImage(
            image,
            effectiveQuestion
          );
      }

      let finalQuestion =
        effectiveQuestion;

      if (imageContext) {
        finalQuestion +=
          `\n\nEkran görüntüsünden okunan bilgiler:\n${imageContext}`;
      }

      let result;

      try {
        result =
          await this.askWowAi(
            finalQuestion
          );
      } catch (backendError) {
        // Backend iki denemede de başarısız olduysa,
        // kullanıcıya direkt "teknik hata" demeden
        // Gemini ile son bir genel bilgi fallback'i dene.
        result =
          await this.askGeminiFallback(
            finalQuestion,
            backendError
          );
      }

      const answer =
        tidyAnswer(
          result?.answer || ""
        );

      if (!answer) {
        throw new Error(
          "AI boş cevap döndürdü."
        );
      }

      await this.reply(
        message,
        answer
      );

      await this.markAnswered();
      await this.clearLastError();

    } catch (error) {
      // Teknik hata kullanıcının 10 dakika hakkını YEMEZ.
      await this.releaseCooldown(
        userId
      );

      await this.markTechnicalFailure();

      await this.setLastError(
        `Question: ${
          error?.message ||
          String(error)
        }`
      );

      await this.reply(
        message,
        "Şu an bilgi kaynaklarından biri yanıt vermedi. Bu soru 10 dakikalık hakkından düşmedi; biraz sonra tekrar deneyebilirsin."
      );
    }
  }

  async acquireCooldown(userId) {
    const key =
      `cooldown:${userId}`;

    const previous =
      await this.ctx.storage.get(
        key
      );

    const now =
      Date.now();

    if (
      typeof previous === "number" &&
      now - previous <
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

  async analyzeImage(
    image,
    question
  ) {
    if (
      !this.env.GEMINI_API_KEY
    ) {
      throw new Error(
        "GEMINI_API_KEY bulunamadı."
      );
    }

    const imageResponse =
      await fetch(image.url);

    if (
      !imageResponse.ok
    ) {
      throw new Error(
        `Discord görseli indirilemedi: ${imageResponse.status}`
      );
    }

    const buffer =
      await imageResponse.arrayBuffer();

    if (
      buffer.byteLength >
      7 * 1024 * 1024
    ) {
      throw new Error(
        "Görsel 7 MB sınırını aşıyor."
      );
    }

    const base64 =
      bytesToBase64(
        new Uint8Array(
          buffer
        )
      );

    const prompt = `
World of Warcraft ekran görüntüsünü dikkatlice incele.

Kullanıcının sorusu:
${question}

Araştırma için gerekli bilgileri çıkar:
- Quest/görev adı
- Objective
- NPC, item veya hedef
- Bölge / zone
- Haritada görünen konum
- Görev açıklamasındaki önemli ipuçları

Görselde olmayan bir bilgiyi uydurma.
Emin değilsen belirt.
Türkçe, kısa ve bilgi odaklı yaz.
`.trim();

    const response =
      await fetch(
        GEMINI_URL,
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json",

            "x-goog-api-key":
              this.env
                .GEMINI_API_KEY
          },

          body:
            JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text:
                        prompt
                    },

                    {
                      inlineData: {
                        mimeType:
                          image.contentType ||
                          "image/png",

                        data:
                          base64
                      }
                    }
                  ]
                }
              ],

              generationConfig: {
                temperature:
                  0.1,

                maxOutputTokens:
                  350
              }
            })
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
        "Gemini görsel cevabı okunamadı."
      );
    }

    if (
      !response.ok
    ) {
      throw new Error(
        `Gemini Vision ${response.status}: ${raw.slice(
          0,
          300
        )}`
      );
    }

    const text =
      (
        data?.candidates?.[0]
          ?.content?.parts ||
        []
      )
        .map(
          (part) =>
            part?.text || ""
        )
        .join("\n")
        .trim();

    if (!text) {
      throw new Error(
        "Görselden yeterli bilgi çıkarılamadı."
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

    let lastError = null;

    for (
      let attempt = 1;
      attempt <= AI_MAX_ATTEMPTS;
      attempt++
    ) {
      const startedAt =
        Date.now();

      const controller =
        new AbortController();

      const timer =
        setTimeout(
          () =>
            controller.abort(),
          AI_TIMEOUT_MS
        );

      try {
        const response =
          await fetch(
            url.toString(),
            {
              method: "GET",

              headers: {
                accept:
                  "application/json"
              },

              signal:
                controller.signal
            }
          );

        const raw =
          await response.text();

        let data = null;

        try {
          data =
            raw
              ? JSON.parse(raw)
              : {};
        } catch {
          data = null;
        }

        await this.ctx.storage.put(
          "last_backend_status",
          response.status
        );

        await this.ctx.storage.put(
          "last_backend_attempts",
          attempt
        );

        await this.ctx.storage.put(
          "last_backend_duration_ms",
          Date.now() -
            startedAt
        );

        if (
          response.ok &&
          data?.answer
        ) {
          return data;
        }

        const detail =
          data?.error ||
          raw.slice(0, 400) ||
          `HTTP ${response.status}`;

        lastError =
          new Error(
            `totik-ai-test HTTP ${response.status}: ${detail}`
          );

        if (
          retryableBackendStatus(
            response.status
          ) &&
          attempt <
            AI_MAX_ATTEMPTS
        ) {
          await sleep(1200);
          continue;
        }

        throw lastError;

      } catch (error) {
        await this.ctx.storage.put(
          "last_backend_attempts",
          attempt
        );

        await this.ctx.storage.put(
          "last_backend_duration_ms",
          Date.now() -
            startedAt
        );

        const aborted =
          error?.name ===
          "AbortError";

        lastError =
          aborted
            ? new Error(
                `totik-ai-test ${AI_TIMEOUT_MS / 1000} saniyede cevap vermedi.`
              )
            : error;

        const retry =
          attempt <
            AI_MAX_ATTEMPTS &&
          (
            aborted ||
            /HTTP 502|HTTP 503|HTTP 504/i.test(
              String(
                error?.message || ""
              )
            )
          );

        if (retry) {
          await sleep(1200);
          continue;
        }

        throw lastError;

      } finally {
        clearTimeout(
          timer
        );
      }
    }

    throw (
      lastError ||
      new Error(
        "AI backend bilinmeyen hata verdi."
      )
    );
  }

  async askGeminiFallback(
    question,
    backendError
  ) {
    if (
      !this.env.GEMINI_API_KEY
    ) {
      throw backendError;
    }

    const prompt = `
Sen Totik Channel için geliştirilmiş bir World of Warcraft yardım botunun yedek cevap sistemisin.

Soru:
${question}

Ana araştırma sistemi şu anda geçici olarak yanıt veremedi.

Kurallar:
- Yalnızca bildiğin bilgilerle cevap ver.
- Bilmediğin veya güncel doğrulama gerektiren şeyi uydurma.
- Özellikle WoW Forever, yeni patch, beta veya güncel değişikliklerde emin değilsen bunu açıkça belirt.
- Genel ve stabil World of Warcraft bilgisinde doğrudan yardımcı ol.
- Türkçe cevap ver.
- Gereksiz giriş yapma.
- Derli toplu, mümkünse 2-5 kısa paragraf veya kısa maddeler kullan.
`.trim();

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        35_000
      );

    try {
      const response =
        await fetch(
          GEMINI_URL,
          {
            method: "POST",

            signal:
              controller.signal,

            headers: {
              "content-type":
                "application/json",

              "x-goog-api-key":
                this.env
                  .GEMINI_API_KEY
            },

            body:
              JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        text:
                          prompt
                      }
                    ]
                  }
                ],

                generationConfig: {
                  temperature:
                    0.2,

                  maxOutputTokens:
                    700
                }
              })
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
        throw backendError;
      }

      if (
        !response.ok
      ) {
        throw backendError;
      }

      const answer =
        (
          data?.candidates?.[0]
            ?.content?.parts ||
          []
        )
          .map(
            (part) =>
              part?.text || ""
          )
          .join("\n")
          .trim();

      if (!answer) {
        throw backendError;
      }

      return {
        answer,
        fallback: "gemini"
      };

    } finally {
      clearTimeout(
        timer
      );
    }
  }

  async markAnswered() {
    const current =
      Number(
        await this.ctx.storage.get(
          "answered_count"
        )
      ) || 0;

    await this.ctx.storage.put(
      "answered_count",
      current + 1
    );
  }

  async markTechnicalFailure() {
    const current =
      Number(
        await this.ctx.storage.get(
          "technical_failure_count"
        )
      ) || 0;

    await this.ctx.storage.put(
      "technical_failure_count",
      current + 1
    );
  }

  async clearLastError() {
    await this.ctx.storage.delete(
      "last_error"
    );
  }

  async setLastError(message) {
    await this.ctx.storage.put(
      "last_error",
      String(
        message ||
        "Unknown error"
      )
    );
  }

  async reply(
    originalMessage,
    answer
  ) {
    const chunks =
      splitDiscordMessage(
        answer
      );

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
          replied_user:
            false
        }
      };

      if (i === 0) {
        body.message_reference = {
          message_id:
            String(
              originalMessage.id
            ),

          channel_id:
            QUESTION_CHANNEL_ID,

          fail_if_not_exists:
            false
        };
      }

      await this.discordRequest(
        `/channels/${QUESTION_CHANNEL_ID}/messages`,
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
      // Typing kritik değil.
    }
  }

  async discordRequest(
    path,
    options = {}
  ) {
    const method =
      options.method ||
      "GET";

    for (
      let attempt = 1;
      attempt <= 4;
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
          "content-type"
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
        response.status === 204
      ) {
        return null;
      }

      const raw =
        await response.text();

      let data = null;

      try {
        data =
          raw
            ? JSON.parse(raw)
            : null;
      } catch {
        data = raw;
      }

      if (
        response.status === 429
      ) {
        let retryAfter =
          Number(
            data?.retry_after ||
            1
          );

        // Discord retry_after genelde saniye.
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
        response.status >= 500 &&
        attempt < 4
      ) {
        await sleep(
          attempt * 750
        );

        continue;
      }

      if (
        !response.ok
      ) {
        throw new Error(
          `Discord API ${response.status}: ${
            typeof data ===
            "string"
              ? data
              : JSON.stringify(
                  data
                )
          }`
        );
      }

      return data;
    }

    throw new Error(
      "Discord API maksimum retry sayısına ulaştı."
    );
  }
}
