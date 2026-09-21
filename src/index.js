import { DurableObject } from "cloudflare:workers";

const DISCORD_API = "https://discord.com/api/v10";

const QUESTION_CHANNEL_ID = "1548811398069489744";
const QUESTION_COMMAND = /^!soru(?:\s|$)/i;

const WOW_AI_URL = "https://totik-ai-test.totikch.workers.dev/";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

// ============================================================
// POLLING
// ============================================================

// Gateway/WebSocket YOK.
// Her 60 saniyede sadece yeni mesaj var mı diye Discord REST'e bakar.
const POLL_INTERVAL_MS = 60 * 1000;

// ============================================================
// COOLDOWN
// ============================================================

const USER_COOLDOWN_MS = 10 * 60 * 1000;

const COOLDOWN_MESSAGE =
  "Totik WoW Yardım Botu olarak her kullanıcı için 10 dakikada 1 soru cevaplayacak şekilde ayarlandım. Biraz sonra tekrar sorabilirsin.";

// ============================================================
// AI
// ============================================================

const AI_TIMEOUT_MS = 75 * 1000;
const AI_MAX_ATTEMPTS = 2;

// ============================================================
// DISCORD OUTPUT
// ============================================================

const MAX_DISCORD_MESSAGE = 1900;

// Eskisi kadar roman değil ama gerekli bilgiyi de kesmeyelim.
const MAX_ANSWER_CHARS = 1250;

// ============================================================
// TOTIK KİMLİĞİ
// ============================================================

const IDENTITY_MESSAGE =
  "Ben Totik Channel için geliştirilmiş Totik WoW Yardım Botuyum. World of Warcraft görevleri, class'lar, meslekler, item'lar, dungeon'lar ve genel oyun bilgileri konusunda yardımcı oluyorum.";

const CHANNEL_RECOMMENDATION_MESSAGE =
  "Ben Totik Channel için geliştirilmiş Totik WoW Yardım Botuyum. Türkçe World of Warcraft içerikleri için Totik Channel'ı izleyebilirsin.";

// ============================================================
// HELPERS
// ============================================================

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

  if (!text) {
    return [];
  }

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
    .replace(/\n[ \t]*\n+/g, "\n")
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
    )
    .replace(
      /World of Warcraft yardım botu olarak/gi,
      "Totik Channel için geliştirilmiş Totik WoW Yardım Botu olarak"
    );

  if (text.length <= MAX_ANSWER_CHARS) {
    return text;
  }

  const sample =
    text.slice(
      0,
      MAX_ANSWER_CHARS
    );

  const possibleCuts = [
    sample.lastIndexOf(". "),
    sample.lastIndexOf("! "),
    sample.lastIndexOf("? "),
    sample.lastIndexOf("\n")
  ];

  let cut =
    Math.max(
      ...possibleCuts
    );

  if (cut < 800) {
    cut =
      MAX_ANSWER_CHARS;
  } else {
    cut += 1;
  }

  return (
    text
      .slice(0, cut)
      .trim() +
    "…"
  );
}

function isIdentityQuestion(question) {
  const q =
    String(question || "")
      .toLocaleLowerCase(
        "tr-TR"
      );

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
      .toLocaleLowerCase(
        "tr-TR"
      );

  const asksChannel =
    q.includes("kanal") ||
    q.includes("youtube") ||
    q.includes("youtuber") ||
    q.includes("yayıncı") ||
    q.includes("streamer") ||
    q.includes("içerik üretici");

  const asksRecommendation =
    q.includes("öner") ||
    q.includes("öneri") ||
    q.includes("tavsiye") ||
    q.includes("izleyeyim") ||
    q.includes("izlemeliyim") ||
    q.includes("takip edeyim") ||
    q.includes("takip etmeliyim");

  return (
    asksChannel &&
    asksRecommendation
  );
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
    Array.isArray(
      message?.attachments
    )
      ? message.attachments
      : [];

  for (
    const attachment
    of attachments
  ) {
    const contentType =
      String(
        attachment?.content_type ||
        ""
      ).toLowerCase();

    const filename =
      String(
        attachment?.filename ||
        ""
      ).toLowerCase();

    const isImage =
      contentType.startsWith(
        "image/"
      ) ||
      /\.(png|jpe?g|webp|gif)$/i.test(
        filename
      );

    if (
      isImage &&
      attachment?.url
    ) {
      return {
        url:
          attachment.url,

        contentType:
          contentType ||
          guessMimeType(
            filename
          )
      };
    }
  }

  return null;
}

function bytesToBase64(bytes) {
  let binary = "";

  const chunkSize =
    0x8000;

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

// ============================================================
// WORKER
// ============================================================

export default {
  async fetch(request, env) {
    const url =
      new URL(
        request.url
      );

    // DO kotası dolsa bile bu endpoint DO'ya dokunmaz.
    if (
      url.pathname ===
      "/health"
    ) {
      return json({
        ok: true,

        service:
          "totik-ai",

        mode:
          "low-usage-polling",

        gatewayWebSocket:
          false,

        pollIntervalSeconds:
          POLL_INTERVAL_MS /
          1000,

        channelId:
          QUESTION_CHANNEL_ID,

        cooldownMinutes:
          USER_COOLDOWN_MS /
          60000,

        replySupport:
          true,

        imageSupport:
          true,

        backendAttempts:
          AI_MAX_ATTEMPTS
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

    const id =
      env.GATEWAY.idFromName(
        "totik-ai-main"
      );

    const stub =
      env.GATEWAY.get(id);

    try {
      if (
        url.pathname === "/" ||
        url.pathname ===
          "/start"
      ) {
        return await stub.fetch(
          new Request(
            "https://internal/start"
          )
        );
      }

      if (
        url.pathname ===
        "/status"
      ) {
        return await stub.fetch(
          new Request(
            "https://internal/status"
          )
        );
      }

      if (
        url.pathname ===
        "/run"
      ) {
        return await stub.fetch(
          new Request(
            "https://internal/run"
          )
        );
      }

      if (
        url.pathname ===
        "/stop"
      ) {
        return await stub.fetch(
          new Request(
            "https://internal/stop"
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

// ============================================================
// DURABLE OBJECT
//
// İsmi bilerek DiscordGateway bırakıldı.
// wrangler.jsonc'yi değiştirmiyoruz.
//
// Artık Gateway değil.
// Sadece kısa süre uyanan polling motoru.
// ============================================================

export class DiscordGateway extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    this.ctx = ctx;
    this.env = env;
  }

  // ----------------------------------------------------------
  // ROUTES
  // ----------------------------------------------------------

  async fetch(request) {
    const url =
      new URL(
        request.url
      );

    if (
      url.pathname ===
      "/start"
    ) {
      if (
        !this.env
          .DISCORD_BOT_TOKEN
      ) {
        return json(
          {
            ok: false,

            error:
              "DISCORD_BOT_TOKEN secret bulunamadı."
          },
          500
        );
      }

      await this.ctx.storage.put(
        "polling_enabled",
        true
      );

      await this.ensureInitialized();

      // İlk kontrolü hemen yap.
      await this.ctx.storage.setAlarm(
        Date.now() + 1000
      );

      return json({
        ok: true,

        state:
          "polling",

        running:
          true,

        gatewayWebSocket:
          false,

        pollIntervalSeconds:
          POLL_INTERVAL_MS /
          1000,

        channelId:
          QUESTION_CHANNEL_ID
      });
    }

    if (
      url.pathname ===
      "/stop"
    ) {
      await this.ctx.storage.put(
        "polling_enabled",
        false
      );

      await this.ctx.storage.deleteAlarm();

      return json({
        ok: true,

        state:
          "stopped"
      });
    }

    if (
      url.pathname ===
      "/run"
    ) {
      await this.ctx.storage.put(
        "polling_enabled",
        true
      );

      await this.ensureInitialized();

      await this.pollOnce();

      await this.ctx.storage.setAlarm(
        Date.now() +
          POLL_INTERVAL_MS
      );

      return json({
        ok: true,

        manualRun:
          true,

        state:
          "polling"
      });
    }

    if (
      url.pathname ===
      "/status"
    ) {
      const [
        enabled,
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
            "polling_enabled"
          ),

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
          enabled === false
            ? "stopped"
            : "polling",

        running:
          enabled !== false &&
          alarmAt != null,

        mode:
          "low-usage-polling",

        gatewayWebSocket:
          false,

        initialized:
          initialized === true,

        pollIntervalSeconds:
          POLL_INTERVAL_MS /
          1000,

        cooldownMinutes:
          USER_COOLDOWN_MS /
          60000,

        channelId:
          QUESTION_CHANNEL_ID,

        lastMessageId:
          lastMessageId ||
          null,

        lastPollAt:
          lastPollAt ||
          null,

        lastQuestionAt:
          lastQuestionAt ||
          null,

        nextPollAt:
          alarmAt
            ? new Date(
                alarmAt
              ).toISOString()
            : null,

        lastBackendStatus:
          lastBackendStatus ??
          null,

        lastBackendAttempts:
          lastBackendAttempts ??
          null,

        lastBackendDurationMs:
          lastBackendDurationMs ??
          null,

        answeredCount:
          answeredCount ??
          0,

        technicalFailureCount:
          technicalFailureCount ??
          0,

        lastError:
          lastError ||
          null
      });
    }

    return new Response(
      "Not found",
      {
        status: 404
      }
    );
  }

  // ----------------------------------------------------------
  // ALARM
  // ----------------------------------------------------------

  async alarm() {
    const enabled =
      await this.ctx.storage.get(
        "polling_enabled"
      );

    // Varsayılan true.
    // Eski alarm deploy sonrası çalışırsa polling'e geçebilsin.
    if (enabled === false) {
      return;
    }

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
      const stillEnabled =
        await this.ctx.storage.get(
          "polling_enabled"
        );

      if (
        stillEnabled !== false
      ) {
        // İş uzun sürdüyse boşuna bir 60 saniye daha ekleme.
        const scheduled =
          startedAt +
          POLL_INTERVAL_MS;

        const nextAlarm =
          Math.max(
            Date.now() + 1000,
            scheduled
          );

        await this.ctx.storage.setAlarm(
          nextAlarm
        );
      }
    }
  }

  // ----------------------------------------------------------
  // INITIALIZATION
  // ----------------------------------------------------------

  async ensureInitialized() {
    const initialized =
      await this.ctx.storage.get(
        "initialized"
      );

    if (
      initialized === true
    ) {
      return;
    }

    // İlk çalıştırmada sadece en son mesajı cursor yap.
    // Bot eski !soru mesajlarını topluca cevaplamasın.
    const messages =
      await this.discordRequest(
        `/channels/${QUESTION_CHANNEL_ID}/messages?limit=1`
      );

    if (
      Array.isArray(messages) &&
      messages.length > 0
    ) {
      await this.ctx.storage.put(
        "last_message_id",
        String(
          messages[0].id
        )
      );
    }

    await Promise.all([
      this.ctx.storage.put(
        "initialized",
        true
      ),

      this.ctx.storage.put(
        "polling_enabled",
        true
      ),

      this.ctx.storage.put(
        "last_poll_at",
        new Date().toISOString()
      )
    ]);
  }

  // ----------------------------------------------------------
  // POLLING
  // ----------------------------------------------------------

  async pollOnce() {
    let cursor =
      await this.ctx.storage.get(
        "last_message_id"
      );

    // 60 saniyede 300+ yeni mesaj gelmeyeceğini varsayıyoruz.
    // Yine de üç sayfa güvenlik payı.
    for (
      let page = 0;
      page < 3;
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
        !Array.isArray(
          messages
        ) ||
        messages.length === 0
      ) {
        break;
      }

      // Discord'un döndürdüğü sıraya güvenmeyelim.
      messages.sort(
        compareSnowflakes
      );

      for (
        const message
        of messages
      ) {
        const messageId =
          String(
            message.id
          );

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

        // Mesaj normal mesaj olsa da cursor ilerler.
        // Aynı mesajı tekrar kontrol etmeyiz.
        cursor =
          messageId;

        await this.ctx.storage.put(
          "last_message_id",
          cursor
        );
      }

      if (
        messages.length <
        100
      ) {
        break;
      }
    }

    await this.ctx.storage.put(
      "last_poll_at",
      new Date().toISOString()
    );
  }

  // ----------------------------------------------------------
  // MESSAGE HANDLER
  // ----------------------------------------------------------

  async processMessage(message) {
    if (
      !message?.id ||
      !message?.author
    ) {
      return;
    }

    // Botların cevaplarını tekrar işleme.
    if (
      message.author.bot ||
      message.webhook_id
    ) {
      return;
    }

    const content =
      String(
        message.content ||
        ""
      ).trim();

    // EN ÖNEMLİ SATIR:
    // !soru yoksa hiçbir AI/Gemini/Tavily işlemi yok.
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

    // --------------------------------------------------------
    // REPLY DESTEĞİ
    // --------------------------------------------------------

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
        referencedMessage
          ?.content ||
        "",
        1600
      );

    // --------------------------------------------------------
    // IMAGE
    // --------------------------------------------------------

    const image =
      getImageAttachment(
        message
      ) ||
      getImageAttachment(
        referencedMessage
      );

    // --------------------------------------------------------
    // QUESTION BUILD
    // --------------------------------------------------------

    let effectiveQuestion =
      "";

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

    // --------------------------------------------------------
    // COOLDOWN
    // --------------------------------------------------------

    const userId =
      String(
        message.author.id
      );

    const allowed =
      await this.acquireCooldown(
        userId
      );

    if (!allowed) {
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

    // --------------------------------------------------------
    // TOTIK CHANNEL LOCAL RESPONSES
    // AI KULLANMAZ
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // REAL QUESTION
    // --------------------------------------------------------

    try {
      await this.safeTyping(
        QUESTION_CHANNEL_ID
      );

      let imageContext =
        "";

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

      // Önce mevcut güvenilir WoW backend.
      try {
        result =
          await this.askWowAi(
            finalQuestion
          );
      } catch (backendError) {
        // Backend iki kez de geçici hata verirse,
        // kullanıcıya direkt teknik hata basmak yerine
        // kontrollü Gemini fallback.
        result =
          await this.askGeminiFallback(
            finalQuestion,
            backendError
          );
      }

      const answer =
        tidyAnswer(
          result?.answer ||
          ""
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
      // Teknik hata kullanıcı hakkını tüketmez.
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
        "Şu an bilgi kaynaklarından birine ulaşamadım. Bu soru 10 dakikalık hakkından düşmedi; biraz sonra tekrar deneyebilirsin."
      );
    }
  }

  // ----------------------------------------------------------
  // COOLDOWN
  // ----------------------------------------------------------

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
      typeof previous ===
        "number" &&
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
    try {
      await this.ctx.storage.delete(
        `cooldown:${userId}`
      );
    } catch {
      // ignore
    }
  }

  // ----------------------------------------------------------
  // IMAGE ANALYSIS
  // ----------------------------------------------------------

  async analyzeImage(
    image,
    question
  ) {
    if (
      !this.env
        .GEMINI_API_KEY
    ) {
      throw new Error(
        "GEMINI_API_KEY bulunamadı."
      );
    }

    const imageResponse =
      await fetch(
        image.url
      );

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

Sadece soruyu doğru araştırmak için gerekli bilgileri çıkar:
- Quest/görev adı
- Objective
- NPC, item veya hedef
- Bölge / zone
- Haritada görünen önemli konum
- Quest açıklamasındaki önemli ipuçları

Görselde olmayan bilgiyi uydurma.
Emin olmadığın şeyi kesinmiş gibi yazma.
Türkçe, kısa ve bilgi odaklı cevap ver.
    `.trim();

    const response =
      await fetch(
        GEMINI_URL,
        {
          method:
            "POST",

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
          ? JSON.parse(
              raw
            )
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
        data
          ?.candidates?.[0]
          ?.content?.parts ||
        []
      )
        .map(
          (part) =>
            part?.text ||
            ""
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

  // ----------------------------------------------------------
  // MAIN WOW AI
  // ----------------------------------------------------------

  async askWowAi(question) {
    const url =
      new URL(
        WOW_AI_URL
      );

    url.searchParams.set(
      "q",
      question
    );

    let lastError =
      null;

    for (
      let attempt = 1;
      attempt <=
        AI_MAX_ATTEMPTS;
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
              method:
                "GET",

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

        let data =
          null;

        try {
          data =
            raw
              ? JSON.parse(
                  raw
                )
              : {};
        } catch {
          data =
            null;
        }

        await Promise.all([
          this.ctx.storage.put(
            "last_backend_status",
            response.status
          ),

          this.ctx.storage.put(
            "last_backend_attempts",
            attempt
          ),

          this.ctx.storage.put(
            "last_backend_duration_ms",
            Date.now() -
              startedAt
          )
        ]);

        if (
          response.ok &&
          data?.answer
        ) {
          return data;
        }

        const detail =
          data?.error ||
          raw.slice(
            0,
            400
          ) ||
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
          await sleep(
            1500
          );

          continue;
        }

        throw lastError;

      } catch (error) {
        await Promise.all([
          this.ctx.storage.put(
            "last_backend_attempts",
            attempt
          ),

          this.ctx.storage.put(
            "last_backend_duration_ms",
            Date.now() -
              startedAt
          )
        ]);

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
                error?.message ||
                ""
              )
            )
          );

        if (retry) {
          await sleep(
            1500
          );

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

  // ----------------------------------------------------------
  // GEMINI FALLBACK
  // ----------------------------------------------------------

  async askGeminiFallback(
    question,
    backendError
  ) {
    if (
      !this.env
        .GEMINI_API_KEY
    ) {
      throw backendError;
    }

    const prompt = `
Sen Totik Channel için geliştirilmiş Totik WoW Yardım Botunun yedek cevap sistemisin.

Kullanıcının sorusu:
${question}

Ana araştırma sistemi geçici olarak yanıt veremedi.

Kurallar:
- World of Warcraft konusunda yardımcı ol.
- Yalnızca gerçekten bildiğin bilgiyi söyle.
- Güncel WoW Forever, yeni patch, beta veya değişebilecek bilgilerde emin değilsen uydurma.
- Emin olmadığın güncel bilgiyi açıkça belirt.
- Genel ve stabil WoW bilgisinde doğrudan yardımcı ol.
- Türkçe cevap ver.
- Gereksiz giriş ve tekrar kullanma.
- Derli toplu ve mümkün olduğunca kısa cevap ver.
- Genellikle 3-6 cümle veya kısa maddeler yeterli.
    `.trim();

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        40 * 1000
      );

    try {
      const response =
        await fetch(
          GEMINI_URL,
          {
            method:
              "POST",

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
                    650
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
            ? JSON.parse(
                raw
              )
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
          data
            ?.candidates?.[0]
            ?.content?.parts ||
          []
        )
          .map(
            (part) =>
              part?.text ||
              ""
          )
          .join("\n")
          .trim();

      if (!answer) {
        throw backendError;
      }

      return {
        answer,
        fallback:
          "gemini"
      };

    } finally {
      clearTimeout(
        timer
      );
    }
  }

  // ----------------------------------------------------------
  // STATS
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // DISCORD REPLY
  // ----------------------------------------------------------

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
          method:
            "POST",

          body
        }
      );
    }
  }

  async safeTyping(
    channelId
  ) {
    try {
      await this.discordRequest(
        `/channels/${channelId}/typing`,
        {
          method:
            "POST"
        }
      );
    } catch {
      // Typing başarısız olsa bile soruyu cevapla.
    }
  }

  // ----------------------------------------------------------
  // DISCORD REST
  // ----------------------------------------------------------

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
        response.status ===
        204
      ) {
        return null;
      }

      const raw =
        await response.text();

      let data =
        null;

      try {
        data =
          raw
            ? JSON.parse(
                raw
              )
            : null;
      } catch {
        data =
          raw;
      }

      if (
        response.status ===
        429
      ) {
        let retryAfter =
          Number(
            data?.retry_after ||
            1
          );

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
        attempt < 4
      ) {
        await sleep(
          attempt *
            750
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
