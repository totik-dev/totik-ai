import { DurableObject } from "cloudflare:workers";
import {
  GUIDE_IMAGE_CHANNEL_ID,
  GUIDE_BATCH_MESSAGE_IDS,
  CLASS_GUIDE_PAGES,
  resolveClassGuide,
  buildStructuredGuideContext,
  findAttachmentForPage,
  expectedBatchMessageIds,
  catalogDiagnostics,
  normalizeGuideText
} from "./class-guide-runtime.js";

const DISCORD_API = "https://discord.com/api/v10";
const QUESTION_CHANNEL_ID = "1548811398069489744";
const GUIDE_CHANNEL_ID = "1549395522689966190";
const GUILD_INFO_CHANNEL_ID = "1549847008406143157";
const QUESTION_COMMAND = /^!soru(?:\s|$)/i;
const DEBUG_COMMAND = /^!soru-debug(?:\s|$)/i;
const WOW_AI_URL = "https://totik-ai-test.totikch.workers.dev/";

const GEMINI_TEXT_MODEL = "gemini-3.5-flash-lite";
const GEMINI_INTERACTIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const GEMINI_VISION_MODEL = "gemini-3.6-flash";
const GEMINI_VISION_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;

const POLL_INTERVAL_MS = 10_000;
const NORMAL_COOLDOWN_MS = 15 * 60_000;
const PREMIUM_COOLDOWN_MS = 60_000;
const PREMIUM_ROLE_CACHE_MS = 10 * 60_000;
const GUIDE_ATTACHMENT_CACHE_MS = 5 * 60_000;
const BACKEND_TIMEOUT_MS = 75_000;
const GEMINI_TIMEOUT_MS = 35_000;
const VISION_TIMEOUT_MS = 45_000;
const MAX_DISCORD_MESSAGE = 1900;
const MAX_ANSWER_CHARS = 1550;
const MAX_GUIDE_FILES = 10;
const MAX_SINGLE_GUIDE_FILE_BYTES = 9 * 1024 * 1024;
const MAX_TOTAL_GUIDE_FILE_BYTES = 23 * 1024 * 1024;
const MAX_VISION_IMAGE_BYTES = 8 * 1024 * 1024;

const ADMIN_COOLDOWN_BYPASS_USER_IDS = new Set([
  "194062355460653056"
]);

const SPECIAL_GUIDE_IMAGE_MESSAGE_IDS = {
  profession: "1553090607482798253",
  camping: "1553095278234701906",
  legacy: "1553095337416335400"
};

const GUIDE_REMINDER_MESSAGE =
  `Bu konu hakkında Totik Channel'da rehber içerik var, <#${GUIDE_CHANNEL_ID}> kanalından detaylı bakabilirsin.`;

const GUILD_INFO_MESSAGE =
  `Totik Channel ekibi WoW Forever'da Normal ruleset'te Alliance tarafında oynuyor. Guild katılımı, şartlar ve güncel detaylar için <#${GUILD_INFO_CHANNEL_ID}> kanalına bakabilirsin.`;

const IDENTITY_MESSAGE =
  "Ben Totik Channel için geliştirilmiş WoW yardım botuyum.";

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}

function cleanText(
  value,
  max = 2200
) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function sanitizeGuideAnswer(value) {
  let text =
    String(value || "")
      .replace(/\r/g, "")

      .replace(
        /^\s*(selam|merhaba)[!,. :;-]*\s*/i,
        ""
      )

      .replace(
        /^\s*(ben\s+)?totik channel(?:'ın|'in|in)?\s+wow\s+(yardım|yardim)\s+botu(?:yum|dur|yım|yim)?[!,. :;-]*\s*/i,
        ""
      )

      .replace(
        /^\s*totik channel wow (yardım|yardim) botu(?:yum|dur)?[!,. :;-]*\s*/i,
        ""
      )

      .replace(
        /`?\b\d{1,2}-[a-z0-9._-]+\.(?:png|jpe?g|webp)\b`?/gi,
        ""
      )

      .replace(
        /^\s*(PAGE|FILE|DOSYA|SAYFA)\s*:\s*.*$/gim,
        ""
      )

      .replace(/\(\s*\)/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

  text =
    text
      .replace(
        /rehber görsellerinin tamamı ekte yer almaktadır\.?/gi,
        ""
      )

      .replace(
        /rehber gorsellerinin tamami ekte yer almaktadir\.?/gi,
        ""
      )

      .replace(
        /ekte yer alan görsellerde/gi,
        "rehberde"
      )

      .replace(
        /ekte yer alan gorsellerde/gi,
        "rehberde"
      )

      .trim();

  if (
    text.length <=
    MAX_ANSWER_CHARS
  ) {
    return text;
  }

  const sample =
    text.slice(
      0,
      MAX_ANSWER_CHARS
    );

  const cut =
    Math.max(
      sample.lastIndexOf(". "),
      sample.lastIndexOf("! "),
      sample.lastIndexOf("? "),
      sample.lastIndexOf("\n")
    );

  return (
    `${text
      .slice(
        0,
        cut > 800
          ? cut + 1
          : MAX_ANSWER_CHARS
      )
      .trim()}…`
  );
}

function splitDiscordMessage(value) {
  let text =
    String(value || "")
      .trim();

  if (!text) {
    return [];
  }

  const chunks = [];

  while (
    text.length >
    MAX_DISCORD_MESSAGE
  ) {
    let cut =
      text.lastIndexOf(
        "\n",
        MAX_DISCORD_MESSAGE
      );

    if (cut < 700) {
      cut =
        text.lastIndexOf(
          " ",
          MAX_DISCORD_MESSAGE
        );
    }

    if (cut < 700) {
      cut =
        MAX_DISCORD_MESSAGE;
    }

    chunks.push(
      text
        .slice(0, cut)
        .trim()
    );

    text =
      text
        .slice(cut)
        .trim();
  }

  if (text) {
    chunks.push(text);
  }

  return chunks;
}

function compareSnowflakes(a, b) {
  try {
    const aa =
      BigInt(
        String(
          a?.id || "0"
        )
      );

    const bb =
      BigInt(
        String(
          b?.id || "0"
        )
      );

    return (
      aa < bb
        ? -1
        : aa > bb
          ? 1
          : 0
    );

  } catch {
    return String(
      a?.id || ""
    ).localeCompare(
      String(
        b?.id || ""
      )
    );
  }
}

function isImageAttachment(
  attachment
) {
  const type =
    String(
      attachment
        ?.content_type ||
      ""
    )
      .toLowerCase();

  const filename =
    String(
      attachment
        ?.filename ||
      ""
    )
      .toLowerCase();

  return (
    type.startsWith(
      "image/"
    ) ||
    /\.(png|jpe?g|webp)$/i
      .test(filename)
  );
}

function getImageAttachment(
  message
) {
  return (
    (
      message
        ?.attachments ||
      []
    )
      .find(
        isImageAttachment
      ) ||
    null
  );
}

function parseCsvIds(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map(
        x =>
          x.trim()
      )
      .filter(Boolean)
  );
}

function formatRemaining(ms) {
  const total =
    Math.max(
      1,
      Math.ceil(
        Number(
          ms || 0
        ) / 1000
      )
    );

  const minutes =
    Math.floor(
      total / 60
    );

  const seconds =
    total % 60;

  if (
    minutes &&
    seconds
  ) {
    return (
      `${minutes} dakika ${seconds} saniye`
    );
  }

  if (minutes) {
    return (
      `${minutes} dakika`
    );
  }

  return (
    `${seconds} saniye`
  );
}

function appendGuideReminder(
  answer,
  force = false
) {
  const text =
    String(answer || "")
      .trim();

  if (
    !text ||
    !force ||
    text.includes(
      `<#${GUIDE_CHANNEL_ID}>`
    )
  ) {
    return text;
  }

  return (
    `${text}\n\n${GUIDE_REMINDER_MESSAGE}`
  );
}

function isIdentityQuestion(
  question
) {
  const q =
    normalizeGuideText(
      question
    );

  return (
    /sen kimsin|sen nesin|kimin botusun|kim gelistirdi|kim yapti seni/
      .test(q)
  );
}

function isGuildInfoQuestion(
  question
) {
  const q =
    normalizeGuideText(
      question
    );

  return (
    /guild|lonca/
      .test(q) &&
    /katil|basvur|alim|alliance|horde|ruleset|sunucu|server/
      .test(q)
  );
}

function bytesToBase64(bytes) {
  let binary = "";

  for (
    let i = 0;
    i < bytes.length;
    i += 0x8000
  ) {
    binary +=
      String.fromCharCode(
        ...bytes.subarray(
          i,
          i + 0x8000
        )
      );
  }

  return btoa(binary);
}

function extractInteractionText(
  data
) {
  if (
    typeof data?.output_text ===
      "string" &&
    data.output_text.trim()
  ) {
    return (
      data.output_text.trim()
    );
  }

  const steps =
    Array.isArray(
      data?.steps
    )
      ? data.steps
      : [];

  for (
    let i =
      steps.length - 1;

    i >= 0;

    i--
  ) {
    const step =
      steps[i];

    if (
      step?.type !==
      "model_output"
    ) {
      continue;
    }

    const content =
      Array.isArray(
        step?.content
      )
        ? step.content
        : [];

    const text =
      content
        .filter(
          part =>
            part?.type ===
              "text" &&
            typeof part?.text ===
              "string"
        )

        .map(
          part =>
            part.text
        )

        .join("\n")
        .trim();

    if (text) {
      return text;
    }
  }

  return "";
}

export default {
  async fetch(
    request,
    env
  ) {
    const url =
      new URL(
        request.url
      );

    if (
      url.pathname ===
      "/health"
    ) {
      return json({
        ok: true,
        service:
          "totik-ai",
        mode:
          "class-guide-grounded-v2",
        guideCatalog:
          catalogDiagnostics(),
        normalCooldownMinutes:
          15,
        premiumCooldownMinutes:
          1
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

    const routeMap = {
      "/":
        "/start",

      "/start":
        "/start",

      "/stop":
        "/stop",

      "/run":
        "/run",

      "/status":
        "/status",

      "/guide-check":
        "/guide-check"
    };

    const target =
      routeMap[
        url.pathname
      ];

    if (!target) {
      return new Response(
        "Not found",
        {
          status: 404
        }
      );
    }

    return stub.fetch(
      new Request(
        `https://internal${target}`
      )
    );
  }
};

export class DiscordGateway
  extends DurableObject {

  constructor(
    ctx,
    env
  ) {
    super(
      ctx,
      env
    );

    this.ctx =
      ctx;

    this.env =
      env;

    this.guildRoleCache =
      new Map();

    this.classAttachmentCache =
      new Map();
  }

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

      await this.ctx.storage.setAlarm(
        Date.now() +
        1000
      );

      return json({
        ok: true,
        state: "polling"
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
        state: "stopped"
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
        state: "polling",
        manualRun: true
      });
    }

    if (
      url.pathname ===
      "/guide-check"
    ) {
      const report =
        await this.buildGuideCheck();

      return json(
        report,
        report.ok
          ? 200
          : 502
      );
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
        lastTrace
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
            "last_trace"
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

        initialized:
          initialized === true,

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

        lastTrace:
          lastTrace ||
          null,

        lastError:
          lastError ||
          null,

        guideCatalog:
          catalogDiagnostics()
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
    if (
      (
        await this.ctx.storage.get(
          "polling_enabled"
        )
      ) === false
    ) {
      return;
    }

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
      if (
        (
          await this.ctx.storage.get(
            "polling_enabled"
          )
        ) !== false
      ) {
        await this.ctx.storage.setAlarm(
          Date.now() +
          POLL_INTERVAL_MS
        );
      }
    }
  }

  async ensureInitialized() {
    if (
      (
        await this.ctx.storage.get(
          "initialized"
        )
      ) === true
    ) {
      return;
    }

    const messages =
      await this.discordRequest(
        `/channels/${QUESTION_CHANNEL_ID}/messages?limit=1`
      );

    if (
      Array.isArray(
        messages
      ) &&
      messages.length
    ) {
      await this.ctx.storage.put(
        "last_message_id",
        String(
          messages[0].id
        )
      );
    }

    await this.ctx.storage.put(
      "initialized",
      true
    );

    await this.ctx.storage.put(
      "polling_enabled",
      true
    );
  }

  async pollOnce() {
    let cursor =
      await this.ctx.storage.get(
        "last_message_id"
      );

    for (
      let page = 0;
      page < 3;
      page++
    ) {
      const query =
        cursor
          ? `?after=${encodeURIComponent(cursor)}&limit=100`
          : "?limit=1";

      const messages =
        await this.discordRequest(
          `/channels/${QUESTION_CHANNEL_ID}/messages${query}`
        );

      if (
        !Array.isArray(
          messages
        ) ||
        !messages.length
      ) {
        break;
      }

      messages.sort(
        compareSnowflakes
      );

      for (
        const message
        of messages
      ) {
        cursor =
          String(
            message.id
          );

        await this.ctx.storage.put(
          "last_message_id",
          cursor
        );

        if (
          message?.author?.bot
        ) {
          continue;
        }

        const content =
          String(
            message?.content ||
            ""
          )
            .trim();

        if (
          !QUESTION_COMMAND
            .test(content) &&
          !DEBUG_COMMAND
            .test(content)
        ) {
          continue;
        }

        try {
          await this.handleCommand(
            message
          );

        } catch (error) {
          await this.setLastError(
            `Handle command: ${
              error?.message ||
              String(error)
            }`
          );
        }
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
      new Date()
        .toISOString()
    );
  }

  async buildGuideCheck() {
    const diag =
      catalogDiagnostics();

    const report = {
      ok: true,

      imageChannelId:
        GUIDE_IMAGE_CHANNEL_ID,

      totalExpectedPages:
        CLASS_GUIDE_PAGES.length,

      totalMatchedPages:
        0,

      totalImageAttachments:
        0,

      classes: {}
    };

    for (
      const classKey
      of Object.keys(
        GUIDE_BATCH_MESSAGE_IDS
      )
    ) {
      try {
        const attachments =
          await this.getClassAttachmentIndex(
            classKey,
            true
          );

        const pages =
          CLASS_GUIDE_PAGES
            .filter(
              page =>
                page.classKey ===
                classKey
            );

        const missing = [];

        let matchedPages =
          0;

        for (
          const page
          of pages
        ) {
          const found =
            findAttachmentForPage(
              page,
              attachments
            );

          if (
            found.attachment
          ) {
            matchedPages++;

          } else {
            missing.push({
              key:
                page.key,

              filename:
                page.filename
            });
          }
        }

        report.totalMatchedPages +=
          matchedPages;

        report.totalImageAttachments +=
          attachments.length;

        report.classes[
          classKey
        ] = {
          ok:
            missing.length ===
            0,

          messageIds:
            expectedBatchMessageIds(
              classKey
            ),

          expectedPages:
            Number(
              diag
                .pageCounts
                ?.[classKey] ||
              pages.length
            ),

          attachmentCount:
            attachments.length,

          matchedPages,

          missing
        };

        if (
          missing.length
        ) {
          report.ok =
            false;
        }

      } catch (error) {
        report.ok =
          false;

        report.classes[
          classKey
        ] = {
          ok: false,

          messageIds:
            expectedBatchMessageIds(
              classKey
            ),

          expectedPages:
            Number(
              diag
                .pageCounts
                ?.[classKey] ||
              0
            ),

          error:
            error?.message ||
            String(error)
        };
      }
    }

    return report;
  }

  async handleCommand(message) {
    const content =
      String(
        message?.content ||
        ""
      )
        .trim();

    if (
      DEBUG_COMMAND
        .test(content)
    ) {
      await this.handleDebugCommand(
        message
      );

      return;
    }

    const userId =
      String(
        message.author.id
      );

    const premiumInfo =
      await this.getMemberCooldownClass(
        message
      );

    const cooldown =
      await this.acquireCooldown(
        userId,
        premiumInfo.durationMs
      );

    if (
      !cooldown.allowed
    ) {
      await this.reply(
        message,

        `⏱️ Tekrar soru sorabilmek için **${formatRemaining(cooldown.remainingMs)}** beklemelisin. YouTube Katıl ve Twitch Sub üyelerinde bekleme süresi 1 dakika, normal üyelerde 15 dakikadır.`
      );

      await this.recordTrace({
        route:
          "cooldown_reject",

        tier:
          premiumInfo.reason,

        remainingMs:
          cooldown.remainingMs,

        tavilyUsed:
          false
      });

      return;
    }

    let currentQuestion =
      cleanText(
        content.replace(
          QUESTION_COMMAND,
          ""
        ),
        1800
      );

    let referencedMessage =
      message
        .referenced_message ||
      null;

    const referencedId =
      message
        .message_reference
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

    const userImage =
      getImageAttachment(
        message
      ) ||
      getImageAttachment(
        referencedMessage
      );

    let question =
      currentQuestion;

    if (
      referencedText &&
      currentQuestion
    ) {
      question =
        `Önceki mesaj: ${referencedText}\nEk soru: ${currentQuestion}`;

    } else if (
      !currentQuestion &&
      referencedText
    ) {
      question =
        referencedText;

    } else if (
      !currentQuestion &&
      userImage
    ) {
      question =
        "Bu World of Warcraft görselindeki konu hakkında yardımcı ol.";
    }

    if (
      !question &&
      !userImage
    ) {
      await this.releaseCooldown(
        userId
      );

      await this.reply(
        message,
        "Sorunu `!soru` komutundan sonra yazabilirsin."
      );

      return;
    }

    await this.ctx.storage.put(
      "last_question_at",
      new Date()
        .toISOString()
    );

    try {
      if (
        isIdentityQuestion(
          question
        )
      ) {
        await this.reply(
          message,
          IDENTITY_MESSAGE
        );

        await this.recordTrace({
          route:
            "local_identity",

          source:
            "local_constant",

          tavilyUsed:
            false
        });

        return;
      }

      if (
        isGuildInfoQuestion(
          question
        )
      ) {
        await this.reply(
          message,
          GUILD_INFO_MESSAGE
        );

        await this.recordTrace({
          route:
            "local_guild",

          source:
            "local_constant",

          tavilyUsed:
            false
        });

        return;
      }

      await this.safeTyping(
        QUESTION_CHANNEL_ID
      );

      let classFallbackMedia =
        [];

      const resolution =
        resolveClassGuide(
          question
        );

      if (
        resolution.matched &&
        resolution.pages?.length
      ) {
        const guideResult =
          await this.answerFromClassGuide(
            message,
            question,
            resolution
          );

        if (
          guideResult.handled
        ) {
          await this.recordTrace(
            guideResult.trace
          );

          await this.clearLastError();

          return;
        }

        classFallbackMedia =
          guideResult.media ||
          [];
      }

      let finalQuestion =
        question;

      if (userImage) {
        const imageContext =
          await this.analyzeUserImage(
            userImage,
            question
          );

        if (imageContext) {
          finalQuestion +=
            `\n\nKullanıcı görselinden okunan bilgi:\n${imageContext}`;
        }
      }

      let result;

      let listenerFallback =
        false;

      try {
        result =
          await this.askWowAi(
            finalQuestion
          );

      } catch (
        backendError
      ) {
        listenerFallback =
          true;

        result =
          await this.askGeminiGeneralFallback(
            finalQuestion,
            backendError
          );
      }

      let answer =
        sanitizeGuideAnswer(
          result?.answer ||
          ""
        );

      if (!answer) {
        throw new Error(
          "AI boş cevap döndürdü."
        );
      }

      const specialMedia =
        [];

      if (
        result?.curatedTopic &&
        SPECIAL_GUIDE_IMAGE_MESSAGE_IDS[
          result.curatedTopic
        ]
      ) {
        const item =
          await this.getSpecialGuideMedia(
            result.curatedTopic
          );

        if (item) {
          specialMedia.push(
            item
          );
        }
      }

      const allMedia = [
        ...classFallbackMedia,
        ...specialMedia
      ];

      const files =
        await this.prepareOutgoingFiles(
          allMedia
        );

      const shouldRemind =
        Boolean(
          resolution.matched ||
          result?.curatedTopic
        );

      answer =
        appendGuideReminder(
          answer,
          shouldRemind
        );

      await this.reply(
        message,
        answer,
        {
          files
        }
      );

      await this.recordTrace({
        route:
          resolution.matched
            ? "class_guide_backend_fallback"
            : "normal_backend",

        source:
          listenerFallback
            ? "listener_gemini_fallback"
            : result?.curated
              ? `backend_curated:${result.curatedTopic || "unknown"}`
              : Array.isArray(
                  result?.sources
                ) &&
                result.sources.length
                ? `backend_tavily_grounded:${result.mode || "unknown"}`
                : `backend_model:${result?.mode || "unknown"}`,

        classKey:
          resolution.classKey ||
          null,

        treeKey:
          resolution.treeKey ||
          null,

        pages:
          (
            resolution.pages ||
            []
          )
            .map(
              p =>
                p.key
            ),

        imagesSent:
          files.length,

        tavilyUsed:
          !listenerFallback &&
          Array.isArray(
            result?.sources
          ) &&
          result.sources.length >
          0
      });

      await this.clearLastError();

    } catch (error) {
      await this.releaseCooldown(
        userId
      );

      await this.setLastError(
        `Question: ${
          error?.message ||
          String(error)
        }`
      );

      await this.reply(
        message,

        "Şu an bilgi kaynaklarından birine ulaşamadım. Bu deneme cooldown hakkından düşmedi; biraz sonra tekrar deneyebilirsin."
      );
    }
  }

  async handleDebugCommand(
    message
  ) {
    const userId =
      String(
        message
          ?.author
          ?.id ||
        ""
      );

    if (
      !ADMIN_COOLDOWN_BYPASS_USER_IDS
        .has(userId)
    ) {
      return;
    }

    const trace =
      await this.ctx.storage.get(
        "last_trace"
      );

    const error =
      await this.ctx.storage.get(
        "last_error"
      );

    await this.reply(
      message,

      `\`\`\`json\n${JSON.stringify(
        {
          lastTrace:
            trace ||
            null,

          lastError:
            error ||
            null
        },
        null,
        2
      ).slice(
        0,
        1700
      )}\n\`\`\``
    );
  }

  async answerFromClassGuide(
    message,
    question,
    resolution
  ) {
    const startedAt =
      Date.now();

    const media =
      await this.loadClassGuideMedia(
        resolution
      );

    const contexts =
      [];

    const sourceKinds =
      new Set();

    let allPagesGrounded =
      true;

    for (
      const page
      of resolution.pages
    ) {
      if (
        (
          page.talents ||
          []
        ).length
      ) {
        contexts.push(
          buildStructuredGuideContext({
            pages: [
              page
            ]
          })
        );

        sourceKinds.add(
          "catalog_structured"
        );

        continue;
      }

      const mediaItem =
        media.find(
          item =>
            item.page.key ===
            page.key
        );

      if (!mediaItem) {
        allPagesGrounded =
          false;

        continue;
      }

      try {
        const vision =
          await this.getCachedGuideVisionText(
            page,
            mediaItem
          );

        if (!vision) {
          allPagesGrounded =
            false;

          continue;
        }

        contexts.push(
          `KAYNAK ${contexts.length + 1}:\n${vision}`
        );

        sourceKinds.add(
          "guide_image_vision"
        );

      } catch (error) {
        allPagesGrounded =
          false;

        await this.setLastError(
          `Guide vision ${page.key}: ${
            error?.message ||
            String(error)
          }`
        );
      }
    }

    if (
      !contexts.length ||
      !allPagesGrounded
    ) {
      return {
        handled:
          false,

        media,

        trace: {
          route:
            "class_guide",

          source:
            "guide_grounding_incomplete",

          classKey:
            resolution.classKey,

          treeKey:
            resolution.treeKey ||
            null,

          pages:
            resolution.pages
              .map(
                p =>
                  p.key
              ),

          tavilyUsed:
            false
        }
      };
    }

    const answer =
      await this.askGuideGrounded(
        question,
        resolution,
        contexts.join(
          "\n\n---\n\n"
        )
      );

    const cleanAnswer =
      sanitizeGuideAnswer(
        answer
      );

    if (!cleanAnswer) {
      return {
        handled:
          false,

        media,

        trace: {
          route:
            "class_guide",

          source:
            "empty_guide_answer"
        }
      };
    }

    const files =
      await this.prepareOutgoingFiles(
        media
      );

    const finalAnswer =
      appendGuideReminder(
        cleanAnswer,
        true
      );

    await this.reply(
      message,
      finalAnswer,
      {
        files
      }
    );

    return {
      handled:
        true,

      trace: {
        route:
          "class_guide",

        source:
          [
            ...sourceKinds
          ].join("+"),

        classKey:
          resolution.classKey,

        treeKey:
          resolution.treeKey ||
          null,

        intents:
          resolution.intents ||
          [],

        reason:
          resolution.reason,

        pages:
          resolution.pages
            .map(
              p =>
                p.key
            ),

        batchMessageIds:
          expectedBatchMessageIds(
            resolution.classKey
          ),

        imagesMatched:
          media.length,

        imagesSent:
          files.length,

        tavilyUsed:
          false,

        elapsedMs:
          Date.now() -
          startedAt
      }
    };
  }

  async loadClassGuideMedia(
    resolution
  ) {
    const attachments =
      await this.getClassAttachmentIndex(
        resolution.classKey
      );

    const results = [];

    for (
      const page
      of resolution.pages
    ) {
      const match =
        findAttachmentForPage(
          page,
          attachments
        );

      if (
        !match.attachment
      ) {
        continue;
      }

      results.push({
        page,

        attachment:
          match.attachment,

        sourceMessageId:
          match
            .attachment
            .__sourceMessageId ||
          null,

        bytes:
          null
      });
    }

    return results;
  }

  async getClassAttachmentIndex(
    classKey,
    forceRefresh = false
  ) {
    const cached =
      this.classAttachmentCache.get(
        classKey
      );

    if (
      !forceRefresh &&
      cached &&
      Date.now() -
      cached.at <
      GUIDE_ATTACHMENT_CACHE_MS
    ) {
      return (
        cached.attachments
      );
    }

    const attachments =
      [];

    for (
      const messageId
      of GUIDE_BATCH_MESSAGE_IDS[
        classKey
      ] ||
      []
    ) {
      const sourceMessage =
        await this.discordRequest(
          `/channels/${GUIDE_IMAGE_CHANNEL_ID}/messages/${messageId}`
        );

      for (
        const attachment
        of sourceMessage
          ?.attachments ||
        []
      ) {
        if (
          !isImageAttachment(
            attachment
          )
        ) {
          continue;
        }

        attachments.push({
          ...attachment,

          __sourceMessageId:
            messageId
        });
      }
    }

    this.classAttachmentCache.set(
      classKey,
      {
        at:
          Date.now(),

        attachments
      }
    );

    return attachments;
  }

  async ensureMediaBytes(
    mediaItem
  ) {
    if (
      mediaItem?.bytes
      instanceof
      Uint8Array
    ) {
      return (
        mediaItem.bytes
      );
    }

    const response =
      await fetch(
        mediaItem
          .attachment
          .url
      );

    if (!response.ok) {
      throw new Error(
        `Guide image download ${response.status}`
      );
    }

    const bytes =
      new Uint8Array(
        await response
          .arrayBuffer()
      );

    mediaItem.bytes =
      bytes;

    return bytes;
  }

  async getCachedGuideVisionText(
    page,
    mediaItem
  ) {
    const attachmentId =
      String(
        mediaItem
          ?.attachment
          ?.id ||
        "unknown"
      );

    const cacheKey =
      `guidevision:v4:${page.key}:${attachmentId}`;

    const cached =
      await this.ctx.storage.get(
        cacheKey
      );

    if (
      typeof cached ===
        "string" &&
      cached.trim()
    ) {
      return cached;
    }

    const bytes =
      await this.ensureMediaBytes(
        mediaItem
      );

    if (
      bytes.byteLength >
      MAX_VISION_IMAGE_BYTES
    ) {
      throw new Error(
        `Vision görsel boyutu fazla: ${bytes.byteLength}`
      );
    }

    const prompt = `
Bu görsel Totik Channel'ın WoW Forever rehber sayfasıdır.

GÖREV:
Görseldeki içerikleri eksiksiz biçimde kaynak verisine dönüştür.

Kurallar:
- Görselde yazmayan hiçbir WoW bilgisi ekleme.
- Dosya adı, PNG/JPG adı, sayfa anahtarı, katalog veya teknik bilgi yazma.
- Başlıkları, spell/talent/buff/aura/seal isimlerini ve açıklamalarını koru.
- Sayı, yüzde, süre, cooldown, menzil, seviye ve istisnaları atlama.
- Görselde bir liste varsa listedeki maddeleri tek tek çıkar.
- Görselde öneri veya öncelik varsa aynen anlamını koru.
- Türkçe metni olduğu gibi anlamlandır; bozuk OCR üretme.
- Yalnızca cevap üretmekte kullanılacak temiz kaynak özeti döndür.
`.trim();

    const result =
      await this.callGeminiVision(
        prompt,
        bytes,
        mediaItem
          .attachment
          .content_type ||
        "image/png",
        1200
      );

    const cleaned =
      cleanText(
        result,
        7000
      );

    if (!cleaned) {
      throw new Error(
        "Guide Vision boş döndü."
      );
    }

    await this.ctx.storage.put(
      cacheKey,
      cleaned
    );

    return cleaned;
  }

  async askGuideGrounded(
    question,
    resolution,
    context
  ) {
    const prompt = `
KULLANICI SORUSU:
${question}

EŞLEŞEN REHBER BAĞLAMI:
class=${resolution.classKey}
spec/tree=${resolution.treeKey || "belirtilmedi"}
konu=${(resolution.intents || []).join(", ") || "genel"}

TOTIK CHANNEL REHBER KAYNAĞI:
---
${context}
---

CEVAP KURALLARI:
1. Direkt cevaba gir. Selam verme ve kendini tanıtma.
2. Yalnızca yukarıdaki rehber içeriğine dayan. Tavily, web, başka WoW sürümü veya genel model bilgisi ekleme.
3. Kullanıcının sorduğu şeyi gerçekten açıkla; sadece "Blessings / Auras / Seals var" diye başlık saymakla yetinme.
4. Buff soruluyorsa rehberde geçen buffların adlarını ve ne yaptıklarını anlat.
5. Talent soruluyorsa yalnızca istenen tree/spec talentlarını anlat; başka tree karıştırma.
6. Rotation/stat/race/leveling sorusunda ilgili rehber maddelerini doğal bir cevap halinde aktar.
7. Dosya adı, .png, .jpg, sayfa adı, katalog anahtarı, kaynak numarası, "ekteki dosya" veya teknik sistem bilgisi ASLA yazma.
8. "Totik Channel WoW Yardım Botuyum" gibi bir tanıtım ASLA yapma.
9. Rehberde olmayan build, sayı veya tavsiye uydurma.
10. Türkçe, doğal ve Discord'da rahat okunur cevap ver. Gereksiz giriş ve sonuç cümlesi kullanma.
`.trim();

    return this.callGeminiText(
      prompt,
      1000,
      0.08
    );
  }

  async getSpecialGuideMedia(
    topic
  ) {
    const messageId =
      SPECIAL_GUIDE_IMAGE_MESSAGE_IDS[
        String(
          topic || ""
        )
      ];

    if (!messageId) {
      return null;
    }

    const sourceMessage =
      await this.discordRequest(
        `/channels/${QUESTION_CHANNEL_ID}/messages/${messageId}`
      );

    const attachment =
      getImageAttachment(
        sourceMessage
      );

    if (!attachment) {
      return null;
    }

    return {
      page: {
        key:
          `special.${topic}`,

        classKey:
          "special",

        filename:
          attachment.filename ||
          `${topic}.png`
      },

      attachment,

      sourceMessageId:
        messageId,

      bytes:
        null
    };
  }

  async prepareOutgoingFiles(
    mediaItems
  ) {
    const files = [];

    let totalBytes =
      0;

    for (
      const mediaItem
      of mediaItems ||
      []
    ) {
      if (
        files.length >=
        MAX_GUIDE_FILES
      ) {
        break;
      }

      try {
        const bytes =
          await this.ensureMediaBytes(
            mediaItem
          );

        if (
          bytes.byteLength >
          MAX_SINGLE_GUIDE_FILE_BYTES
        ) {
          continue;
        }

        if (
          totalBytes +
          bytes.byteLength >
          MAX_TOTAL_GUIDE_FILE_BYTES
        ) {
          break;
        }

        files.push({
          filename:
            mediaItem
              .page
              ?.filename ||
            mediaItem
              .attachment
              ?.filename ||
            "guide.png",

          contentType:
            mediaItem
              .attachment
              ?.content_type ||
            "image/png",

          bytes,

          description:
            "Totik Channel WoW Forever rehberi"
        });

        totalBytes +=
          bytes.byteLength;

      } catch (error) {
        await this.setLastError(
          `Guide file: ${
            error?.message ||
            String(error)
          }`
        );
      }
    }

    return files;
  }

  async getMemberCooldownClass(
    message
  ) {
    const userId =
      String(
        message
          ?.author
          ?.id ||
        ""
      );

    if (
      ADMIN_COOLDOWN_BYPASS_USER_IDS
        .has(userId)
    ) {
      return {
        durationMs:
          0,

        reason:
          "admin_bypass"
      };
    }

    const memberRoleIds =
      new Set(
        (
          message
            ?.member
            ?.roles ||
          []
        )
          .map(String)
      );

    const youtubeIds =
      parseCsvIds(
        this.env
          .YOUTUBE_MEMBER_ROLE_IDS
      );

    const twitchIds =
      parseCsvIds(
        this.env
          .TWITCH_SUB_ROLE_IDS
      );

    for (
      const id
      of memberRoleIds
    ) {
      if (
        youtubeIds.has(id)
      ) {
        return {
          durationMs:
            PREMIUM_COOLDOWN_MS,

          reason:
            "youtube_role_id"
        };
      }

      if (
        twitchIds.has(id)
      ) {
        return {
          durationMs:
            PREMIUM_COOLDOWN_MS,

          reason:
            "twitch_role_id"
        };
      }
    }

    const guildId =
      String(
        message
          ?.guild_id ||
        ""
      );

    if (
      guildId &&
      memberRoleIds.size
    ) {
      try {
        const roles =
          await this.getGuildRoles(
            guildId
          );

        for (
          const role
          of roles
        ) {
          if (
            !memberRoleIds.has(
              String(
                role.id
              )
            )
          ) {
            continue;
          }

          const name =
            normalizeGuideText(
              role.name
            );

          const youtube =
            name.includes(
              "youtube"
            ) &&
            /katil|abone|member|uyelik/
              .test(name);

          const twitch =
            name.includes(
              "twitch"
            ) &&
            /sub|subscriber|abone/
              .test(name);

          if (youtube) {
            return {
              durationMs:
                PREMIUM_COOLDOWN_MS,

              reason:
                `role_name:${role.name}`
            };
          }

          if (twitch) {
            return {
              durationMs:
                PREMIUM_COOLDOWN_MS,

              reason:
                `role_name:${role.name}`
            };
          }
        }

      } catch {
      }
    }

    return {
      durationMs:
        NORMAL_COOLDOWN_MS,

      reason:
        "normal_member"
    };
  }

  async getGuildRoles(
    guildId
  ) {
    const cached =
      this.guildRoleCache.get(
        guildId
      );

    if (
      cached &&
      Date.now() -
      cached.at <
      PREMIUM_ROLE_CACHE_MS
    ) {
      return (
        cached.roles
      );
    }

    const roles =
      await this.discordRequest(
        `/guilds/${guildId}/roles`
      );

    const safe =
      Array.isArray(
        roles
      )
        ? roles
        : [];

    this.guildRoleCache.set(
      guildId,
      {
        at:
          Date.now(),

        roles:
          safe
      }
    );

    return safe;
  }

  async acquireCooldown(
    userId,
    durationMs
  ) {
    if (
      durationMs <= 0 ||
      ADMIN_COOLDOWN_BYPASS_USER_IDS
        .has(
          String(
            userId
          )
        )
    ) {
      return {
        allowed:
          true,

        remainingMs:
          0
      };
    }

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
      now -
      previous <
      durationMs
    ) {
      return {
        allowed:
          false,

        remainingMs:
          durationMs -
          (
            now -
            previous
          )
      };
    }

    await this.ctx.storage.put(
      key,
      now
    );

    return {
      allowed:
        true,

      remainingMs:
        0
    };
  }

  async releaseCooldown(
    userId
  ) {
    if (
      ADMIN_COOLDOWN_BYPASS_USER_IDS
        .has(
          String(
            userId
          )
        )
    ) {
      return;
    }

    await this.ctx.storage.delete(
      `cooldown:${userId}`
    );
  }

  async analyzeUserImage(
    image,
    question
  ) {
    if (
      !this.env
        .GEMINI_API_KEY
    ) {
      return "";
    }

    const response =
      await fetch(
        image.url
      );

    if (!response.ok) {
      return "";
    }

    const bytes =
      new Uint8Array(
        await response
          .arrayBuffer()
      );

    if (
      bytes.byteLength >
      MAX_VISION_IMAGE_BYTES
    ) {
      return "";
    }

    return this.callGeminiVision(
      `World of Warcraft ekran görüntüsünü incele. Kullanıcı sorusu: ${question}\nYalnızca görselde gerçekten görülen bilgileri kısa ve Türkçe çıkar.`,

      bytes,

      image.content_type ||
      "image/png",

      500
    );
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

    let lastError;

    for (
      let attempt = 1;
      attempt <= 2;
      attempt++
    ) {
      const controller =
        new AbortController();

      const timer =
        setTimeout(
          () =>
            controller.abort(),
          BACKEND_TIMEOUT_MS
        );

      try {
        const response =
          await fetch(
            url.toString(),
            {
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

        let data = {};

        try {
          data =
            raw
              ? JSON.parse(raw)
              : {};

        } catch {
        }

        if (
          response.ok &&
          data?.answer
        ) {
          return data;
        }

        lastError =
          new Error(
            `totik-ai-test HTTP ${response.status}: ${
              data?.error ||
              raw.slice(
                0,
                400
              )
            }`
          );

        if (
          [
            502,
            503,
            504
          ].includes(
            response.status
          ) &&
          attempt < 2
        ) {
          await sleep(
            1200
          );

          continue;
        }

        throw lastError;

      } catch (error) {
        lastError =
          error?.name ===
          "AbortError"
            ? new Error(
                "totik-ai-test timeout"
              )
            : error;

        if (
          attempt < 2
        ) {
          await sleep(
            1200
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
        "AI backend hatası"
      )
    );
  }

  async callGeminiText(
    prompt,
    maxOutputTokens = 900,
    temperature = 0.1
  ) {
    if (
      !this.env
        .GEMINI_API_KEY
    ) {
      throw new Error(
        "GEMINI_API_KEY bulunamadı."
      );
    }

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        GEMINI_TIMEOUT_MS
      );

    try {
      const response =
        await fetch(
          GEMINI_INTERACTIONS_ENDPOINT,
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
                model:
                  GEMINI_TEXT_MODEL,

                input:
                  prompt,

                store:
                  false,

                generation_config: {
                  temperature,

                  max_output_tokens:
                    maxOutputTokens
                }
              })
          }
        );

      const raw =
        await response.text();

      const data =
        raw
          ? JSON.parse(
              raw
            )
          : {};

      if (!response.ok) {
        throw new Error(
          `Gemini Interactions HTTP ${response.status}: ${
            data
              ?.error
              ?.message ||
            raw.slice(
              0,
              400
            )
          }`
        );
      }

      const text =
        extractInteractionText(
          data
        );

      if (!text) {
        throw new Error(
          "Gemini boş metin döndürdü."
        );
      }

      return text;

    } finally {
      clearTimeout(
        timer
      );
    }
  }

  async callGeminiVision(
    prompt,
    bytes,
    mimeType,
    maxOutputTokens = 1000
  ) {
    if (
      !this.env
        .GEMINI_API_KEY
    ) {
      throw new Error(
        "GEMINI_API_KEY bulunamadı."
      );
    }

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        VISION_TIMEOUT_MS
      );

    try {
      const response =
        await fetch(
          GEMINI_VISION_ENDPOINT,
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
                      },

                      {
                        inlineData: {
                          mimeType,

                          data:
                            bytesToBase64(
                              bytes
                            )
                        }
                      }
                    ]
                  }
                ],

                generationConfig: {
                  temperature:
                    0.02,

                  maxOutputTokens
                }
              })
          }
        );

      const raw =
        await response.text();

      const data =
        raw
          ? JSON.parse(
              raw
            )
          : {};

      if (!response.ok) {
        throw new Error(
          `Gemini Vision HTTP ${response.status}: ${
            data
              ?.error
              ?.message ||
            raw.slice(
              0,
              400
            )
          }`
        );
      }

      return (
        data
          ?.candidates
          ?.[0]
          ?.content
          ?.parts ||
        []
      )
        .map(
          part =>
            part?.text ||
            ""
        )

        .join("\n")
        .trim();

    } finally {
      clearTimeout(
        timer
      );
    }
  }

  async askGeminiGeneralFallback(
    question,
    backendError
  ) {
    const prompt = `
Kullanıcının World of Warcraft sorusu:
${question}

Ana araştırma sistemi geçici olarak yanıt veremedi.

Türkçe, kısa ve doğal cevap ver.
WoW Forever'a özgü güncel bilgiden emin değilsen uydurma.
Kendini tanıtma.
Cooldown/üyelik/reklam yazma.
`.trim();

    try {
      return {
        answer:
          await this.callGeminiText(
            prompt,
            700,
            0.15
          ),

        fallback:
          "gemini_interactions"
      };

    } catch {
      throw backendError;
    }
  }

  async reply(
    originalMessage,
    answer,
    options = {}
  ) {
    const chunks =
      splitDiscordMessage(
        answer
      );

    const files =
      Array.isArray(
        options.files
      )
        ? options.files
        : [];

    if (
      !chunks.length
    ) {
      return;
    }

    for (
      let i = 0;
      i < chunks.length;
      i++
    ) {
      const payload = {
        content:
          chunks[i],

        allowed_mentions: {
          parse: [],

          replied_user:
            false
        }
      };

      if (i === 0) {
        payload.message_reference = {
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

      if (
        i === 0 &&
        files.length
      ) {
        await this.discordMultipartRequest(
          `/channels/${QUESTION_CHANNEL_ID}/messages`,
          payload,
          files
        );

      } else {
        await this.discordRequest(
          `/channels/${QUESTION_CHANNEL_ID}/messages`,
          {
            method:
              "POST",

            body:
              payload
          }
        );
      }
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
    }
  }

  async discordMultipartRequest(
    path,
    payload,
    files
  ) {
    const safeFiles =
      files.slice(
        0,
        10
      );

    const payloadWithAttachments = {
      ...payload,

      attachments:
        safeFiles.map(
          (
            file,
            index
          ) => ({
            id:
              index,

            filename:
              file.filename,

            description:
              file.description ||
              undefined
          })
        )
    };

    for (
      let attempt = 1;
      attempt <= 4;
      attempt++
    ) {
      const form =
        new FormData();

      form.append(
        "payload_json",
        JSON.stringify(
          payloadWithAttachments
        )
      );

      safeFiles.forEach(
        (
          file,
          index
        ) => {
          form.append(
            `files[${index}]`,

            new Blob(
              [
                file.bytes
              ],
              {
                type:
                  file.contentType ||
                  "application/octet-stream"
              }
            ),

            file.filename
          );
        }
      );

      const response =
        await fetch(
          `${DISCORD_API}${path}`,
          {
            method:
              "POST",

            headers: {
              Authorization:
                `Bot ${this.env.DISCORD_BOT_TOKEN}`
            },

            body:
              form
          }
        );

      const raw =
        await response.text();

      let data =
        null;

      try {
        data =
          raw
            ? JSON.parse(raw)
            : null;

      } catch {
        data =
          raw;
      }

      if (
        response.status ===
        429
      ) {
        const wait =
          Number(
            data
              ?.retry_after ||
            1
          );

        await sleep(
          wait < 100
            ? wait * 1000
            : wait
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

      if (!response.ok) {
        throw new Error(
          `Discord multipart ${response.status}: ${raw.slice(0, 500)}`
        );
      }

      return data;
    }

    throw new Error(
      "Discord multipart retry limiti aşıldı."
    );
  }

  async discordRequest(
    path,
    options = {}
  ) {
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
        method:
          options.method ||
          "GET",

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
            ? JSON.parse(raw)
            : null;

      } catch {
        data =
          raw;
      }

      if (
        response.status ===
        429
      ) {
        const wait =
          Number(
            data
              ?.retry_after ||
            1
          );

        await sleep(
          wait < 100
            ? wait * 1000
            : wait
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

      if (!response.ok) {
        throw new Error(
          `Discord API ${response.status}: ${raw.slice(0, 500)}`
        );
      }

      return data;
    }

    throw new Error(
      "Discord API retry limiti aşıldı."
    );
  }

  async recordTrace(trace) {
    const value = {
      at:
        new Date()
          .toISOString(),

      ...trace
    };

    await this.ctx.storage.put(
      "last_trace",
      value
    );

    console.log(
      JSON.stringify({
        event:
          "totik_question_trace",

        ...value
      })
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
}
