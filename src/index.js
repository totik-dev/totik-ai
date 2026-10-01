import { DurableObject } from "cloudflare:workers";

import {
  GUIDE_IMAGE_CHANNEL_ID,
  GUIDE_BATCH_MESSAGE_IDS,
  CLASS_GUIDE_PAGES,
  resolveClassGuide,
  buildStructuredGuideContext,
  buildKeywordFallbackContext,
  findAttachmentForPage,
  expectedBatchMessageIds,
  catalogDiagnostics,
  normalizeGuideText
} from "./class-guide-runtime.js";

const DISCORD_API =
  "https://discord.com/api/v10";

const QUESTION_CHANNEL_ID =
  "1548811398069489744";

const GUIDE_CHANNEL_ID =
  "1549395522689966190";

const GUILD_INFO_CHANNEL_ID =
  "1549847008406143157";

const QUESTION_COMMAND =
  /^!soru(?:\s|$)/i;

const DEBUG_COMMAND =
  /^!soru-debug(?:\s|$)/i;

const WOW_AI_URL =
  "https://totik-ai-test.totikch.workers.dev/";

const GEMINI_TEXT_MODEL =
  "gemini-3.5-flash-lite";

const GEMINI_INTERACTIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const GEMINI_VISION_MODEL =
  "gemini-3.6-flash";

const GEMINI_VISION_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;

const POLL_INTERVAL_MS =
  10 * 1000;

const NORMAL_COOLDOWN_MS =
  15 * 60 * 1000;

const PREMIUM_COOLDOWN_MS =
  1 * 60 * 1000;

const ADMIN_COOLDOWN_BYPASS_USER_IDS =
  new Set([
    "194062355460653056"
  ]);

const PREMIUM_ROLE_CACHE_MS =
  10 * 60 * 1000;

const MAX_DISCORD_MESSAGE =
  1900;

const MAX_ANSWER_CHARS =
  1450;

const BACKEND_TIMEOUT_MS =
  75 * 1000;

const BACKEND_ATTEMPTS =
  2;

const GEMINI_TIMEOUT_MS =
  35 * 1000;

const VISION_TIMEOUT_MS =
  40 * 1000;

const MAX_GUIDE_FILES =
  10;

const MAX_SINGLE_GUIDE_FILE_BYTES =
  9 * 1024 * 1024;

const MAX_TOTAL_GUIDE_FILE_BYTES =
  23 * 1024 * 1024;

const MAX_VISION_IMAGE_BYTES =
  7 * 1024 * 1024;

const GUIDE_ATTACHMENT_CACHE_MS =
  5 * 60 * 1000;

const IDENTITY_MESSAGE =
  "Ben Totik Channel için geliştirilmiş Totik WoW Yardım Botuyum. World of Warcraft ve özellikle WoW Forever konusunda yardımcı oluyorum.";

const CHANNEL_RECOMMENDATION_MESSAGE =
  "Türkçe World of Warcraft rehberleri için Totik Channel içeriklerine bakabilirsin.";

const GUIDE_REMINDER_MESSAGE =
  `Bu konu hakkında Totik Channel'da rehber içerik var, <#${GUIDE_CHANNEL_ID}> kanalından detaylı bakabilirsin.`;

const GUILD_INFO_MESSAGE =
  `Totik Channel ekibi WoW Forever'da Normal ruleset'te Alliance tarafında oynuyor. Guild katılımı, şartlar ve güncel detaylar için <#${GUILD_INFO_CHANNEL_ID}> kanalına bakabilirsin.`;

const SPECIAL_GUIDE_IMAGE_MESSAGE_IDS = {
  profession:
    "1553090607482798253",

  camping:
    "1553095278234701906",

  legacy:
    "1553095337416335400"
};

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,

      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store"
      }
    }
  );
}

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function cleanText(
  value,
  maxLength = 2200
) {
  return String(
    value || ""
  )
    .replace(/\r/g, "")
    .replace(
      /[ \t]+/g,
      " "
    )
    .replace(
      /\n{3,}/g,
      "\n\n"
    )
    .trim()
    .slice(
      0,
      maxLength
    );
}

function tidyAnswer(value) {
  let text =
    String(
      value || ""
    )
      .replace(
        /\r/g,
        ""
      )
      .replace(
        /[ \t]+\n/g,
        "\n"
      )
      .replace(
        /\n[ \t]*\n+/g,
        "\n"
      )
      .replace(
        /[ \t]{2,}/g,
        " "
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

  const cuts = [
    sample.lastIndexOf(
      ". "
    ),

    sample.lastIndexOf(
      "! "
    ),

    sample.lastIndexOf(
      "? "
    ),

    sample.lastIndexOf(
      "\n"
    )
  ];

  let cut =
    Math.max(
      ...cuts
    );

  if (cut < 800) {
    cut =
      MAX_ANSWER_CHARS;
  } else {
    cut += 1;
  }

  return (
    `${text
      .slice(
        0,
        cut
      )
      .trim()}…`
  );
}

function splitDiscordMessage(
  value
) {
  let text =
    String(
      value || ""
    ).trim();

  if (!text) {
    return [];
  }

  if (
    text.length <=
    MAX_DISCORD_MESSAGE
  ) {
    return [text];
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
        .slice(
          0,
          cut
        )
        .trim()
    );

    text =
      text
        .slice(cut)
        .trim();
  }

  if (text) {
    chunks.push(
      text
    );
  }

  return chunks;
}

function compareSnowflakes(
  a,
  b
) {
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

    if (aa < bb) {
      return -1;
    }

    if (aa > bb) {
      return 1;
    }

    return 0;

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

function getImageAttachment(
  message
) {
  const attachments =
    Array.isArray(
      message?.attachments
    )
      ? message.attachments
      : [];

  return (
    attachments.find(
      (attachment) => {
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
            .test(
              filename
            )
        );
      }
    ) ||
    null
  );
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
      .test(
        filename
      )
  );
}

function parseCsvIds(value) {
  return new Set(
    String(
      value || ""
    )
      .split(",")
      .map(
        (x) =>
          x.trim()
      )
      .filter(Boolean)
  );
}

function formatRemaining(ms) {
  const totalSeconds =
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
      totalSeconds / 60
    );

  const seconds =
    totalSeconds % 60;

  if (
    minutes > 0 &&
    seconds > 0
  ) {
    return `${minutes} dakika ${seconds} saniye`;
  }

  if (minutes > 0) {
    return `${minutes} dakika`;
  }

  return `${seconds} saniye`;
}

function retryableBackendStatus(
  status
) {
  return (
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function appendGuideReminder(
  answer,
  question,
  force = false
) {
  const text =
    String(
      answer || ""
    ).trim();

  if (!text) {
    return text;
  }

  if (
    !force &&
    !isGuideTopicQuestion(
      question
    )
  ) {
    return text;
  }

  if (
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
    q.includes(
      "sen kimsin"
    ) ||
    q.includes(
      "sen nesin"
    ) ||
    q.includes(
      "kimin botusun"
    ) ||
    q.includes(
      "kim gelistirdi"
    ) ||
    q.includes(
      "kim yapti seni"
    )
  );
}

function isChannelRecommendationQuestion(
  question
) {
  const q =
    normalizeGuideText(
      question
    );

  const asksChannel =
    /kanal|youtube|youtuber|yayinci|streamer|icerik uretici/
      .test(q);

  const asksRecommendation =
    /oner|tavsiye|izley|takip et/
      .test(q);

  return (
    asksChannel &&
    asksRecommendation
  );
}

function isGuildInfoQuestion(
  question
) {
  const q =
    normalizeGuideText(
      question
    );

  const guild =
    /guild|lonca/
      .test(q);

  const intent =
    /katil|basvur|alim|hangi taraf|alliance|horde|ruleset|sunucu|server/
      .test(q);

  return (
    guild &&
    intent
  );
}

function isGuideTopicQuestion(
  question
) {
  const q =
    normalizeGuideText(
      question
    );

  return (
    /ruleset|horde|alliance/
      .test(q) ||

    /level[a-z]*|kasma/
      .test(q) ||

    /race|racial|irk[a-z]*/
      .test(q) ||

    /class|sinif|warrior|hunter|mage|rogue|priest|warlock|paladin|druid|shaman/
      .test(q) ||

    /mana|energy|focus|rage|zirh|armor|healer|tank/
      .test(q) ||

    /addon|action bar|cooldown manager|swing timer|dps metre|nameplate|keybind|fps|gamepad/
      .test(q) ||

    /meslek|profession|crafting|gathering|tracking|kamp|camping|legacy/
      .test(q)
  );
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

  return btoa(
    binary
  );
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
          (part) =>
            part?.type ===
              "text" &&
            typeof part?.text ===
              "string"
        )
        .map(
          (part) =>
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
          "source-aware-class-guides",

        questionChannelId:
          QUESTION_CHANNEL_ID,

        classGuideImageChannelId:
          GUIDE_IMAGE_CHANNEL_ID,

        normalCooldownMinutes:
          NORMAL_COOLDOWN_MS /
          60000,

        premiumCooldownMinutes:
          PREMIUM_COOLDOWN_MS /
          60000,

        guideCatalog:
          catalogDiagnostics()
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

    const internalPath =
      routeMap[
        url.pathname
      ];

    if (!internalPath) {
      return new Response(
        "Not found",
        {
          status: 404
        }
      );
    }

    try {
      return await stub.fetch(
        new Request(
          `https://internal${internalPath}`
        )
      );

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

        state:
          "polling",

        running:
          true,

        pollIntervalSeconds:
          POLL_INTERVAL_MS /
          1000,

        classGuideImageChannelId:
          GUIDE_IMAGE_CHANNEL_ID
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

        manualRun:
          true,

        state:
          "polling"
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
        lastTrace,
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
            "last_trace"
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

        initialized:
          initialized === true,

        pollIntervalSeconds:
          POLL_INTERVAL_MS /
          1000,

        normalCooldownMinutes:
          NORMAL_COOLDOWN_MS /
          60000,

        premiumCooldownMinutes:
          PREMIUM_COOLDOWN_MS /
          60000,

        questionChannelId:
          QUESTION_CHANNEL_ID,

        guideImageChannelId:
          GUIDE_IMAGE_CHANNEL_ID,

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

        answeredCount:
          answeredCount ??
          0,

        technicalFailureCount:
          technicalFailureCount ??
          0,

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
    const enabled =
      await this.ctx.storage.get(
        "polling_enabled"
      );

    if (
      enabled === false
    ) {
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
        const scheduled =
          startedAt +
          POLL_INTERVAL_MS;

        await this.ctx.storage.setAlarm(
          Math.max(
            Date.now() +
            1000,

            scheduled
          )
        );
      }
    }
  }

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

    const messages =
      await this.discordRequest(
        `/channels/${QUESTION_CHANNEL_ID}/messages?limit=1`
      );

    if (
      Array.isArray(
        messages
      ) &&
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
        new Date()
          .toISOString()
      )
    ]);
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
        messages.length === 0
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
          message
            ?.author
            ?.bot
        ) {
          continue;
        }

        const content =
          String(
            message
              ?.content ||
            ""
          ).trim();

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
          await this.markTechnicalFailure();

          await this.setLastError(
            `Handle command: ${
              error?.message ||
              String(error)
            }`
          );
        }
      }

      if (
        messages.length < 100
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
    const report = {
      ok: true,

      imageChannelId:
        GUIDE_IMAGE_CHANNEL_ID,

      totalExpectedPages:
        0,

      totalMatchedPages:
        0,

      totalImageAttachments:
        0,

      classes: {}
    };

    const diag =
      catalogDiagnostics();

    for (
      const classKey
      of Object.keys(
        GUIDE_BATCH_MESSAGE_IDS
      )
    ) {
      const expectedPages =
        Number(
          diag.pageCounts
            ?.[classKey] ||
          0
        );

      report.totalExpectedPages +=
        expectedPages;

      try {
        const attachments =
          await this.getClassAttachmentIndex(
            classKey,
            true
          );

        const classPages =
          CLASS_GUIDE_PAGES
            .filter(
              (page) =>
                page.classKey ===
                classKey
            );

        const matched = [];
        const missing = [];

        for (
          const page
          of classPages
        ) {
          const found =
            findAttachmentForPage(
              page,
              attachments
            );

          if (
            found.attachment
          ) {
            matched.push({
              key:
                page.key,

              filename:
                page.filename,

              attachmentFilename:
                found
                  .attachment
                  .filename,

              messageId:
                found
                  .attachment
                  .__sourceMessageId ||
                null,

              matchMode:
                found.matchMode
            });

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
          matched.length;

        report.totalImageAttachments +=
          attachments.length;

        report.classes[
          classKey
        ] = {
          ok:
            missing.length === 0,

          messageIds:
            GUIDE_BATCH_MESSAGE_IDS[
              classKey
            ],

          expectedPages,

          attachmentCount:
            attachments.length,

          matchedPages:
            matched.length,

          missing
        };

        if (
          missing.length > 0
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
            GUIDE_BATCH_MESSAGE_IDS[
              classKey
            ],

          expectedPages,

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
        message
          ?.content ||
        ""
      ).trim();

    if (
      DEBUG_COMMAND
        .test(content)
    ) {
      await this.handleDebugCommand(
        message
      );

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

    let effectiveQuestion =
      "";

    if (
      referencedText &&
      currentQuestion
    ) {
      effectiveQuestion =
        `Önceki mesaj: ${referencedText}\nEk soru: ${currentQuestion}`;

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

    } else if (
      userImage
    ) {
      effectiveQuestion =
        "Bu World of Warcraft görselindeki konu hakkında yardımcı ol.";
    }

    if (
      !effectiveQuestion &&
      !userImage
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

    const premiumInfo =
      await this.getMemberCooldownClass(
        message
      );

    const cooldown =
      await this.acquireCooldown(
        userId,
        premiumInfo.durationMs
      );

    if (!cooldown.allowed) {
      const cooldownMessage =
        `⏱️ Tekrar soru sorabilmek için **${formatRemaining(cooldown.remainingMs)}** beklemelisin. ` +
        "YouTube Katıl ve Twitch Sub üyelerinde bekleme süresi 1 dakika, normal üyelerde 15 dakikadır.";

      await this.reply(
        message,
        cooldownMessage
      );

      await this.recordTrace({
        route:
          "cooldown_reject",

        userId,

        premium:
          premiumInfo.premium,

        premiumReason:
          premiumInfo.reason,

        remainingMs:
          cooldown.remainingMs,

        tavilyUsed:
          false,

        imageSent:
          false
      });

      return;
    }

    await this.ctx.storage.put(
      "last_question_at",
      new Date()
        .toISOString()
    );

    try {
      if (
        isGuildInfoQuestion(
          effectiveQuestion
        )
      ) {
        await this.reply(
          message,
          GUILD_INFO_MESSAGE
        );

        await this.finishSuccessfulAnswer({
          route:
            "local_guild",

          source:
            "local_constant",

          tavilyUsed:
            false,

          imageSent:
            false
        });

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

        await this.finishSuccessfulAnswer({
          route:
            "local_identity",

          source:
            "local_constant",

          tavilyUsed:
            false,

          imageSent:
            false
        });

        return;
      }

      if (
        isChannelRecommendationQuestion(
          effectiveQuestion
        )
      ) {
        await this.reply(
          message,
          CHANNEL_RECOMMENDATION_MESSAGE
        );

        await this.finishSuccessfulAnswer({
          route:
            "local_channel_recommendation",

          source:
            "local_constant",

          tavilyUsed:
            false,

          imageSent:
            false
        });

        return;
      }

      await this.safeTyping(
        QUESTION_CHANNEL_ID
      );

      const classResolution =
        resolveClassGuide(
          effectiveQuestion
        );

      if (
        classResolution.matched &&
        classResolution.pages.length > 0
      ) {
        const classResult =
          await this.answerFromClassGuide(
            message,
            effectiveQuestion,
            classResolution
          );

        if (
          classResult.handled
        ) {
          await this.finishSuccessfulAnswer(
            classResult.trace
          );

          return;
        }
      }

      let finalQuestion =
        effectiveQuestion;

      if (userImage) {
        const imageContext =
          await this.analyzeUserImage(
            userImage,
            effectiveQuestion
          );

        if (imageContext) {
          finalQuestion +=
            `\n\nEkran görüntüsünden okunan bilgiler:\n${imageContext}`;
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

      } catch (backendError) {
        listenerFallback =
          true;

        result =
          await this.askGeminiGeneralFallback(
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

      const finalAnswer =
        appendGuideReminder(
          answer,
          effectiveQuestion,
          Boolean(
            result?.curatedTopic
          )
        );

      const specialFiles = [];

      if (
        result?.curatedTopic &&
        SPECIAL_GUIDE_IMAGE_MESSAGE_IDS[
          result.curatedTopic
        ]
      ) {
        const specialMedia =
          await this.getSpecialGuideMedia(
            result.curatedTopic
          );

        if (specialMedia) {
          specialFiles.push(
            specialMedia
          );
        }
      }

      const preparedFiles =
        await this.prepareOutgoingFiles(
          specialFiles
        );

      await this.reply(
        message,
        finalAnswer,
        {
          files:
            preparedFiles
        }
      );

      const source =
        listenerFallback
          ? "listener_gemini_fallback"
          : result?.curated
            ? `backend_curated:${result.curatedTopic || "unknown"}`
            : Array.isArray(
                result?.sources
              ) &&
              result.sources.length > 0
                ? `backend_tavily_grounded:${result.mode || "unknown"}`
                : `backend_model_or_fallback:${result?.mode || result?.fallback || "unknown"}`;

      await this.finishSuccessfulAnswer({
        route:
          "normal_backend",

        source,

        backendMode:
          result?.mode ||
          null,

        curatedTopic:
          result?.curatedTopic ||
          null,

        tavilyUsed:
          !listenerFallback &&
          Array.isArray(
            result?.sources
          ) &&
          result.sources.length > 0,

        imageSent:
          preparedFiles.length > 0,

        imageCount:
          preparedFiles.length
      });

    } catch (error) {
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

        "Şu an bilgi kaynaklarından birine ulaşamadım. Bu deneme cooldown hakkından düşmedi; biraz sonra tekrar deneyebilirsin."
      );
    }
  }

  async handleDebugCommand(message) {
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

    const lastError =
      await this.ctx.storage.get(
        "last_error"
      );

    const payload = {
      lastTrace:
        trace ||
        null,

      lastError:
        lastError ||
        null
    };

    await this.reply(
      message,

      `\`\`\`json\n${JSON.stringify(payload, null, 2).slice(0, 1700)}\n\`\`\``
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

    const pageContexts = [];

    const contextSources =
      new Set();

    for (
      const page
      of resolution.pages
    ) {
      if (
        (page.talents || [])
          .length > 0
      ) {
        pageContexts.push(
          buildStructuredGuideContext({
            pages: [
              page
            ]
          })
        );

        contextSources.add(
          "catalog_structured"
        );

        continue;
      }

      const mediaItem =
        media.find(
          (item) =>
            item.page.key ===
            page.key
        ) ||
        null;

      if (mediaItem) {
        try {
          const visionText =
            await this.getCachedGuideVisionText(
              page,
              mediaItem
            );

          if (visionText) {
            pageContexts.push(
              `PAGE: ${page.key}\nFILE: ${page.filename}\nVISION_TRANSCRIPT:\n${visionText}`
            );

            contextSources.add(
              "guide_image_vision_cache"
            );

            continue;
          }

        } catch (error) {
          await this.setLastError(
            `Guide vision ${page.key}: ${
              error?.message ||
              String(error)
            }`
          );
        }
      }

      pageContexts.push(
        buildKeywordFallbackContext(
          page
        )
      );

      contextSources.add(
        "catalog_keywords_fallback"
      );
    }

    const context =
      pageContexts
        .filter(Boolean)
        .join(
          "\n\n---\n\n"
        )
        .slice(
          0,
          30000
        );

    if (
      !context.trim()
    ) {
      return {
        handled:
          false,

        trace: {
          route:
            "class_guide",

          source:
            "no_context",

          classKey:
            resolution.classKey,

          pages:
            resolution.pages
              .map(
                (p) =>
                  p.key
              ),

          tavilyUsed:
            false,

          imageSent:
            false
        }
      };
    }

    const answer =
      await this.askGuideGrounded(
        question,
        resolution,
        context
      );

    if (!answer) {
      return {
        handled:
          false,

        trace: {
          route:
            "class_guide",

          source:
            "guide_model_empty",

          classKey:
            resolution.classKey,

          pages:
            resolution.pages
              .map(
                (p) =>
                  p.key
              ),

          tavilyUsed:
            false,

          imageSent:
            false
        }
      };
    }

    const finalAnswer =
      appendGuideReminder(
        tidyAnswer(
          answer
        ),
        question,
        true
      );

    const preparedFiles =
      await this.prepareOutgoingFiles(
        media
      );

    await this.reply(
      message,
      finalAnswer,
      {
        files:
          preparedFiles
      }
    );

    const trace = {
      route:
        "class_guide",

      source:
        [...contextSources]
          .join("+"),

      classKey:
        resolution.classKey,

      treeKey:
        resolution.treeKey ||
        null,

      intents:
        resolution.intents,

      reason:
        resolution.reason,

      confidence:
        resolution.confidence,

      pages:
        resolution.pages
          .map(
            (page) =>
              page.key
          ),

      filenames:
        resolution.pages
          .map(
            (page) =>
              page.filename
          ),

      batchMessageIds:
        expectedBatchMessageIds(
          resolution.classKey
        ),

      imageChannelId:
        GUIDE_IMAGE_CHANNEL_ID,

      imagesMatched:
        media.length,

      imagesSent:
        preparedFiles.length,

      imageSent:
        preparedFiles.length > 0,

      tavilyUsed:
        false,

      elapsedMs:
        Date.now() -
        startedAt
    };

    return {
      handled:
        true,

      trace
    };
  }

  async loadClassGuideMedia(
    resolution
  ) {
    const classKey =
      resolution.classKey;

    const attachments =
      await this.getClassAttachmentIndex(
        classKey
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
        console.log(
          JSON.stringify({
            event:
              "guide_attachment_missing",

            classKey,

            pageKey:
              page.key,

            filename:
              page.filename,

            batchMessageIds:
              GUIDE_BATCH_MESSAGE_IDS[
                classKey
              ] ||
              []
          })
        );

        continue;
      }

      results.push({
        page,

        attachment:
          match.attachment,

        matchMode:
          match.matchMode,

        sourceChannelId:
          GUIDE_IMAGE_CHANNEL_ID,

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
    const now =
      Date.now();

    const cached =
      this.classAttachmentCache.get(
        classKey
      );

    if (
      !forceRefresh &&
      cached &&
      now - cached.at <
      GUIDE_ATTACHMENT_CACHE_MS
    ) {
      return (
        cached.attachments
      );
    }

    const messageIds =
      GUIDE_BATCH_MESSAGE_IDS[
        classKey
      ] ||
      [];

    const attachments = [];

    for (
      const messageId
      of messageIds
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
          now,

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
      this.classAttachmentCache.delete(
        mediaItem.page.classKey
      );

      throw new Error(
        `Guide image download ${response.status}: ${mediaItem.page.key}`
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

    const key =
      `guidevision:v3:${page.key}:${attachmentId}`;

    const cached =
      await this.ctx.storage.get(
        key
      );

    if (
      typeof cached ===
        "string" &&
      cached.trim()
    ) {
      return cached;
    }

    if (
      !this.env
        .GEMINI_API_KEY
    ) {
      throw new Error(
        "GEMINI_API_KEY bulunamadı."
      );
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
        `Guide image Vision sınırını aşıyor: ${bytes.byteLength}`
      );
    }

    const base64 =
      bytesToBase64(
        bytes
      );

    const mimeType =
      mediaItem
        .attachment
        .content_type ||
      "image/png";

    const prompt = `
Bu görsel Totik Channel'ın WoW Forever class rehberi sayfasıdır.

Sayfa anahtarı: ${page.key}
Dosya adı: ${page.filename}
Catalog anahtar kelimeleri: ${(page.keywords || []).join(" | ")}

GÖREV:
Görselde yazan bilgiyi dış bilgi eklemeden Türkçe ve yapılandırılmış şekilde çıkar.

Mutlaka yakala:
- başlık / konu
- ana maddeler
- sayı, yüzde, süre, cooldown, seviye gibi değerler
- öneri / öncelik / sıra varsa aynen anlamını koruyarak
- uyarı / istisna / not varsa
- spell, talent, stat, rotation, race veya leveling isimleri

KURALLAR:
- Görselde olmayan bilgiyi ekleme.
- WoW genel bilgisiyle boşluk doldurma.
- Emin olmadığın metni kesinleştirme.
- Reklam veya kanal çağrısı üretme.
- Sonuç yalnızca rehber sayfasının içeriği olsun.
- Kısa ama eksiksiz bir kaynak özeti üret.
    `.trim();

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
                            base64
                        }
                      }
                    ]
                  }
                ],

                generationConfig: {
                  temperature:
                    0.05,

                  maxOutputTokens:
                    900
                }
              })
          }
        );

      const raw =
        await response.text();

      let data = {};

      try {
        data =
          raw
            ? JSON.parse(
                raw
              )
            : {};

      } catch {
        throw new Error(
          "Guide Vision geçersiz JSON döndürdü."
        );
      }

      if (!response.ok) {
        throw new Error(
          `Guide Vision HTTP ${response.status}: ${
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
        (
          data
            ?.candidates
            ?.[0]
            ?.content
            ?.parts ||
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
          "Guide Vision boş sonuç döndürdü."
        );
      }

      const cleaned =
        cleanText(
          text,
          6000
        );

      await this.ctx.storage.put(
        key,
        cleaned
      );

      return cleaned;

    } finally {
      clearTimeout(
        timer
      );
    }
  }

  async askGuideGrounded(
    question,
    resolution,
    context
  ) {
    const prompt = `
Sen Totik Channel WoW Yardım Botusun.

KULLANICI SORUSU:
${question}

EŞLEŞEN TOTIK CLASS REHBERİ:
- class: ${resolution.classKey}
- spec/tree: ${resolution.treeKey || "belirtilmedi"}
- konu: ${(resolution.intents || []).join(", ") || "genel"}
- sayfalar: ${(resolution.pages || []).map((p) => p.filename).join(", ")}

AŞAĞIDAKİ VERİ TOTIK CHANNEL REHBER GÖRSELLERİNDEN GELİR:

---
${context}
---

CEVAP KURALLARI:
1. Bu soruda birincil ve bağlayıcı kaynak yalnızca yukarıdaki rehber verisidir.
2. Tavily, web, başka WoW sürümleri veya genel model bilgisi EKLEME.
3. Rehberde olmayan bir build sırası / öneri / sayı uydurma.
4. Kullanıcı belirli bir talent soruyorsa doğrudan o talentı açıkla.
5. Kullanıcı "Holy Priest talentleri neler" gibi bir tree soruyorsa o tree'nin rehberde bulunan talentlarını derli toplu anlat; diğer tree'leri karıştırma.
6. Eğer soru leveling + spec ise hem leveling sayfasındaki bilgi hem de eşleşen talent sayfaları kullanılabilir.
7. Rehber verisinde Türkçe açıklama yok ama İngilizce effect varsa anlamını doğal Türkçeyle aktarabilirsin; yeni mekanik ekleme.
8. Cevap Türkçe, net, Discord'da rahat okunur olsun. Gereksiz giriş yapma.
9. Normalde 5-10 kısa madde yeterli. Çok uzun talent listesinde en önemli ayrımı özetle ve rehber görsellerinin tamamının ekte olduğunu belirt.
10. Cooldown, üyelik, reklam veya kaynak motorundan bahsetme.
    `.trim();

    const text =
      await this.callGeminiText(
        prompt,
        900,
        0.1
      );

    return text;
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

    try {
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

        sourceChannelId:
          QUESTION_CHANNEL_ID,

        sourceMessageId:
          messageId,

        bytes:
          null
      };

    } catch (error) {
      await this.setLastError(
        `Special guide image ${topic}: ${
          error?.message ||
          String(error)
        }`
      );

      return null;
    }
  }

  async prepareOutgoingFiles(
    mediaItems
  ) {
    const files = [];

    let totalBytes = 0;

    for (
      const mediaItem
      of mediaItems || []
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
          console.log(
            JSON.stringify({
              event:
                "guide_file_too_large",

              pageKey:
                mediaItem
                  .page
                  ?.key,

              bytes:
                bytes.byteLength
            })
          );

          continue;
        }

        if (
          totalBytes +
          bytes.byteLength >
          MAX_TOTAL_GUIDE_FILE_BYTES
        ) {
          break;
        }

        const filename =
          mediaItem
            .page
            ?.filename ||
          mediaItem
            .attachment
            ?.filename ||
          "guide.png";

        files.push({
          filename,

          contentType:
            mediaItem
              .attachment
              ?.content_type ||
            "image/png",

          bytes,

          description:
            `Totik guide: ${
              mediaItem
                .page
                ?.key ||
              filename
            }`
        });

        totalBytes +=
          bytes.byteLength;

      } catch (error) {
        await this.setLastError(
          `Guide file ${
            mediaItem
              .page
              ?.key ||
            "unknown"
          }: ${
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
        premium: true,

        reason:
          "admin_bypass",

        durationMs:
          0
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
      const roleId
      of memberRoleIds
    ) {
      if (
        youtubeIds.has(
          roleId
        )
      ) {
        return {
          premium: true,

          reason:
            "youtube_role_id",

          durationMs:
            PREMIUM_COOLDOWN_MS
        };
      }

      if (
        twitchIds.has(
          roleId
        )
      ) {
        return {
          premium: true,

          reason:
            "twitch_role_id",

          durationMs:
            PREMIUM_COOLDOWN_MS
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
      memberRoleIds.size > 0
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

          const youtubeMember =
            name.includes(
              "youtube"
            ) &&
            /katil|abone|member|uyelik/
              .test(name);

          const twitchSub =
            name.includes(
              "twitch"
            ) &&
            /sub|subscriber|abone/
              .test(name);

          if (youtubeMember) {
            return {
              premium:
                true,

              reason:
                `role_name:${role.name}`,

              durationMs:
                PREMIUM_COOLDOWN_MS
            };
          }

          if (twitchSub) {
            return {
              premium:
                true,

              reason:
                `role_name:${role.name}`,

              durationMs:
                PREMIUM_COOLDOWN_MS
            };
          }
        }

      } catch (error) {
        console.log(
          JSON.stringify({
            event:
              "premium_role_lookup_failed",

            guildId,

            error:
              error?.message ||
              String(error)
          })
        );
      }
    }

    return {
      premium:
        false,

      reason:
        "normal_member",

      durationMs:
        NORMAL_COOLDOWN_MS
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
      return cached.roles;
    }

    const roles =
      await this.discordRequest(
        `/guilds/${guildId}/roles`
      );

    const safeRoles =
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
          safeRoles
      }
    );

    return safeRoles;
  }

  async acquireCooldown(
    userId,
    durationMs
  ) {
    if (
      ADMIN_COOLDOWN_BYPASS_USER_IDS
        .has(
          String(
            userId
          )
        ) ||
      durationMs <= 0
    ) {
      return {
        allowed:
          true,

        remainingMs:
          0,

        durationMs
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
      "number"
    ) {
      const elapsed =
        now -
        previous;

      if (
        elapsed <
        durationMs
      ) {
        return {
          allowed:
            false,

          remainingMs:
            durationMs -
            elapsed,

          durationMs
        };
      }
    }

    await this.ctx.storage.put(
      key,
      now
    );

    return {
      allowed:
        true,

      remainingMs:
        0,

      durationMs
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

    try {
      await this.ctx.storage.delete(
        `cooldown:${userId}`
      );

    } catch {
    }
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
      throw new Error(
        `Discord görseli indirilemedi: ${response.status}`
      );
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
      throw new Error(
        "Görsel Vision sınırını aşıyor."
      );
    }

    const base64 =
      bytesToBase64(
        bytes
      );

    const prompt = `
World of Warcraft ekran görüntüsünü incele.

Kullanıcının sorusu:
${question}

Sadece soruyu araştırmak/yanıtlamak için görselde gerçekten görülen bilgileri çıkar.

Görselde olmayan bilgiyi uydurma.
Türkçe ve kısa yaz.
    `.trim();

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        VISION_TIMEOUT_MS
      );

    try {
      const result =
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
                          mimeType:
                            image
                              .content_type ||
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
                    0.05,

                  maxOutputTokens:
                    450
                }
              })
          }
        );

      const raw =
        await result.text();

      const data =
        raw
          ? JSON.parse(
              raw
            )
          : {};

      if (!result.ok) {
        throw new Error(
          `Gemini Vision ${result.status}`
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
          (part) =>
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
      BACKEND_ATTEMPTS;
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
          BACKEND_ATTEMPTS
        ) {
          await sleep(
            1200
          );

          continue;
        }

        throw lastError;

      } catch (error) {
        const aborted =
          error?.name ===
          "AbortError";

        lastError =
          aborted
            ? new Error(
                `totik-ai-test ${BACKEND_TIMEOUT_MS / 1000} saniyede cevap vermedi.`
              )
            : error;

        const retry =
          attempt <
          BACKEND_ATTEMPTS &&
          (
            aborted ||
            /HTTP 502|HTTP 503|HTTP 504/i
              .test(
                String(
                  error?.message ||
                  ""
                )
              )
          );

        if (retry) {
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
        "AI backend bilinmeyen hata verdi."
      )
    );
  }

  async callGeminiText(
    prompt,
    maxOutputTokens = 800,
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

      let data = {};

      try {
        data =
          raw
            ? JSON.parse(
                raw
              )
            : {};

      } catch {
        throw new Error(
          `Gemini geçersiz JSON döndürdü: ${raw.slice(0, 400)}`
        );
      }

      if (!response.ok) {
        throw new Error(
          `Gemini Interactions HTTP ${response.status}: ${
            data
              ?.error
              ?.message ||
            raw.slice(
              0,
              500
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
          "Gemini Interactions boş metin döndürdü."
        );
      }

      return text;

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
Sen Totik Channel için geliştirilmiş WoW Yardım Botunun yedek cevap sistemisin.

Kullanıcının sorusu:
${question}

Ana araştırma sistemi geçici olarak yanıt veremedi.

Kurallar:
- World of Warcraft konusunda yardımcı ol.
- Yalnızca gerçekten bildiğin stabil bilgiyi söyle.
- WoW Forever beta / güncel / değişebilecek bilgi konusunda emin değilsen bunu açıkça belirt ve uydurma.
- Türkçe, kısa, derli toplu cevap ver.
- Cooldown veya üyelik reklamı yazma.
    `.trim();

    try {
      const answer =
        await this.callGeminiText(
          prompt,
          700,
          0.15
        );

      return {
        answer,

        fallback:
          "gemini_interactions",

        backendError:
          String(
            backendError
              ?.message ||
            ""
          )
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
        files.length > 0
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
          (file, index) => ({
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
        (file, index) => {
          const blob =
            new Blob(
              [
                file.bytes
              ],
              {
                type:
                  file.contentType ||
                  "application/octet-stream"
              }
            );

          form.append(
            `files[${index}]`,
            blob,
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
            data
              ?.retry_after ||
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

      if (!response.ok) {
        throw new Error(
          `Discord multipart ${response.status}: ${
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
      "Discord multipart maksimum retry sayısına ulaştı."
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
            data
              ?.retry_after ||
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

      if (!response.ok) {
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

  async finishSuccessfulAnswer(
    trace
  ) {
    await this.markAnswered();
    await this.clearLastError();
    await this.recordTrace(
      trace
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

  async markAnswered() {
    const current =
      Number(
        await this.ctx.storage.get(
          "answered_count"
        )
      ) ||
      0;

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
      ) ||
      0;

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
}
