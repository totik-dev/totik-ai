import { DurableObject } from "cloudflare:workers";

import {
  GUIDE_IMAGE_CHANNEL_ID,
  GUIDE_BATCH_MESSAGE_IDS,
  CLASS_GUIDE_PAGES,
  GUIDE_SEMANTIC_INDEX,
  resolveClassGuide,
  buildExternalResearchQuestion,
  buildStructuredGuideContext,
  findAttachmentForPage,
  expectedBatchMessageIds,
  catalogDiagnostics,
  semanticIndexDiagnostics,
  normalizeGuideText
} from "./class-guide-runtime.js";


// ============================================================
// CONFIG
// ============================================================

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


// ============================================================
// GEMINI
// ============================================================

const GEMINI_TEXT_MODEL =
  "gemini-3.5-flash-lite";

const GEMINI_INTERACTIONS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const GEMINI_VISION_MODEL =
  "gemini-3.6-flash";

const GEMINI_VISION_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;


// ============================================================
// LIMITS
// ============================================================

const POLL_INTERVAL_MS =
  10 * 1000;

const NORMAL_COOLDOWN_MS =
  15 * 60 * 1000;

const PREMIUM_COOLDOWN_MS =
  1 * 60 * 1000;

const PREMIUM_ROLE_CACHE_MS =
  10 * 60 * 1000;

const GUIDE_ATTACHMENT_CACHE_MS =
  5 * 60 * 1000;

const BACKEND_TIMEOUT_MS =
  75 * 1000;

const GEMINI_TIMEOUT_MS =
  35 * 1000;

const VISION_TIMEOUT_MS =
  45 * 1000;

const MAX_DISCORD_MESSAGE =
  1900;

const NORMAL_ANSWER_MAX_CHARS =
  1550;

const CLASS_GUIDE_TARGET_CHARS =
  760;

const CLASS_GUIDE_HARD_MAX_CHARS =
  900;

const CLASS_GUIDE_MIN_CUT_CHARS =
  450;

const MAX_GUIDE_FILES =
  10;

const MAX_SINGLE_GUIDE_FILE_BYTES =
  9 * 1024 * 1024;

const MAX_TOTAL_GUIDE_FILE_BYTES =
  23 * 1024 * 1024;

const MAX_VISION_IMAGE_BYTES =
  8 * 1024 * 1024;


// ============================================================
// ADMIN
// ============================================================

const ADMIN_COOLDOWN_BYPASS_USER_IDS =
  new Set([
    "194062355460653056"
  ]);


// ============================================================
// SPECIAL GUIDES
// ============================================================

const SPECIAL_GUIDE_IMAGE_MESSAGE_IDS = {

  profession:
    "1553090607482798253",

  camping:
    "1553095278234701906",

  legacy:
    "1553095337416335400"
};


// ============================================================
// TEXT CONSTANTS
// ============================================================

const GUIDE_REMINDER_MESSAGE =
  `Bu konu hakkında Totik Channel'da rehber içerik var, <#${GUIDE_CHANNEL_ID}> kanalından detaylı bakabilirsin.`;

const CLASS_GUIDE_CONTINUE_MESSAGE =
  "Devamı için rehber görsellerini inceleyebilirsin.";

const GUILD_INFO_MESSAGE =
  `Totik Channel ekibi WoW Forever'da Normal ruleset'te Alliance tarafında oynuyor. Guild katılımı, şartlar ve güncel detaylar için <#${GUILD_INFO_CHANNEL_ID}> kanalına bakabilirsin.`;

const IDENTITY_MESSAGE =
  "Ben Totik Channel için geliştirilmiş WoW yardım botuyum.";


// ============================================================
// BASIC HELPERS
// ============================================================

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


function sleep(
  ms
) {
  return new Promise(
    resolve =>
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
    value ||
    ""
  )
    .replace(
      /\r/g,
      ""
    )

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


// ============================================================
// ANSWER CLEANING
// ============================================================

function removeTechnicalGuideLanguage(
  value
) {
  return String(
    value ||
    ""
  )

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
      /^\s*(PAGE|FILE|DOSYA|SAYFA|KAYNAK)\s*:\s*.*$/gim,
      ""
    )

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

    .replace(
      /devamı için rehber görsellerini inceleyebilirsin\.?/gi,
      ""
    )

    .replace(
      /devami icin rehber gorsellerini inceleyebilirsin\.?/gi,
      ""
    )

    .replace(
      /\(\s*\)/g,
      ""
    )

    .replace(
      /[ \t]+\n/g,
      "\n"
    )

    .replace(
      /\n{3,}/g,
      "\n\n"
    )

    .replace(
      /[ \t]{2,}/g,
      " "
    )

    .trim();
}


function findNaturalCut(
  text,
  maxChars,
  minChars
) {
  const sample =
    text.slice(
      0,
      maxChars
    );


  const boundaries = [

    sample.lastIndexOf(
      "\n• "
    ),

    sample.lastIndexOf(
      "\n- "
    ),

    sample.lastIndexOf(
      "\n"
    ),

    sample.lastIndexOf(
      ". "
    ),

    sample.lastIndexOf(
      "! "
    ),

    sample.lastIndexOf(
      "? "
    )
  ];


  let cut =
    Math.max(
      ...boundaries
    );


  if (
    cut <
    minChars
  ) {
    cut =
      maxChars;
  }


  if (
    cut <
      sample.length &&
    [
      ".",
      "!",
      "?"
    ]
      .includes(
        sample[
          cut
        ]
      )
  ) {
    cut +=
      1;
  }


  return cut;
}


function sanitizeNormalAnswer(
  value
) {
  let text =
    removeTechnicalGuideLanguage(
      value
    );


  if (
    text.length <=
    NORMAL_ANSWER_MAX_CHARS
  ) {
    return text;
  }


  const cut =
    findNaturalCut(
      text,
      NORMAL_ANSWER_MAX_CHARS,
      800
    );


  return (
    `${text
      .slice(
        0,
        cut
      )
      .trim()}…`
  );
}


// ============================================================
// CLASS GUIDE ANSWER LENGTH
// ============================================================

function finalizeClassGuideAnswer(
  value,
  resolution
) {
  let text =
    removeTechnicalGuideLanguage(
      value
    );


  if (
    !text
  ) {
    return "";
  }


  const pageCount =
    Array.isArray(
      resolution
        ?.pages
    )
      ? resolution.pages.length
      : 0;


  const broad =
    pageCount >
    1;


  let truncated =
    false;


  if (
    text.length >
    CLASS_GUIDE_HARD_MAX_CHARS
  ) {
    const cut =
      findNaturalCut(
        text,
        CLASS_GUIDE_TARGET_CHARS,
        CLASS_GUIDE_MIN_CUT_CHARS
      );


    text =
      text
        .slice(
          0,
          cut
        )
        .trim();


    truncated =
      true;
  }


  else if (
    broad &&
    text.length >
    CLASS_GUIDE_TARGET_CHARS
  ) {
    const cut =
      findNaturalCut(
        text,
        CLASS_GUIDE_TARGET_CHARS,
        CLASS_GUIDE_MIN_CUT_CHARS
      );


    text =
      text
        .slice(
          0,
          cut
        )
        .trim();


    truncated =
      true;
  }


  if (
    truncated &&
    !/[.!?]$/
      .test(
        text
      )
  ) {
    text +=
      "…";
  }


  if (
    broad ||
    truncated
  ) {
    text +=
      `\n\n${CLASS_GUIDE_CONTINUE_MESSAGE}`;
  }


  return text.trim();
}


// ============================================================
// DISCORD MESSAGE SPLIT
// ============================================================

function splitDiscordMessage(
  value
) {
  let text =
    String(
      value ||
      ""
    )
      .trim();


  if (
    !text
  ) {
    return [];
  }


  if (
    text.length <=
    MAX_DISCORD_MESSAGE
  ) {
    return [
      text
    ];
  }


  const chunks =
    [];


  while (
    text.length >
    MAX_DISCORD_MESSAGE
  ) {
    let cut =
      text.lastIndexOf(
        "\n",
        MAX_DISCORD_MESSAGE
      );


    if (
      cut <
      700
    ) {
      cut =
        text.lastIndexOf(
          " ",
          MAX_DISCORD_MESSAGE
        );
    }


    if (
      cut <
      700
    ) {
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
        .slice(
          cut
        )
        .trim();
  }


  if (
    text
  ) {
    chunks.push(
      text
    );
  }


  return chunks;
}


// ============================================================
// SNOWFLAKE
// ============================================================

function compareSnowflakes(
  a,
  b
) {
  try {
    const aa =
      BigInt(
        String(
          a?.id ||
          "0"
        )
      );


    const bb =
      BigInt(
        String(
          b?.id ||
          "0"
        )
      );


    return (
      aa <
      bb
    )
      ? -1
      : (
          aa >
          bb
        )
        ? 1
        : 0;


  } catch {

    return String(
      a?.id ||
      ""
    )
      .localeCompare(
        String(
          b?.id ||
          ""
        )
      );
  }
}


// ============================================================
// IMAGE HELPERS
// ============================================================

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


function getImageAttachment(
  message
) {
  return (
    message
      ?.attachments ||
    []
  )
    .find(
      isImageAttachment
    ) ||
    null;
}


// ============================================================
// ROLE HELPERS
// ============================================================

function parseCsvIds(
  value
) {
  return new Set(
    String(
      value ||
      ""
    )
      .split(
        ","
      )

      .map(
        value =>
          value.trim()
      )

      .filter(
        Boolean
      )
  );
}


// ============================================================
// COOLDOWN TEXT
// ============================================================

function formatRemaining(
  ms
) {
  const totalSeconds =
    Math.max(
      1,
      Math.ceil(
        Number(
          ms ||
          0
        ) /
        1000
      )
    );


  const minutes =
    Math.floor(
      totalSeconds /
      60
    );


  const seconds =
    totalSeconds %
    60;


  if (
    minutes >
      0 &&
    seconds >
      0
  ) {
    return (
      `${minutes} dakika ${seconds} saniye`
    );
  }


  if (
    minutes >
    0
  ) {
    return (
      `${minutes} dakika`
    );
  }


  return (
    `${seconds} saniye`
  );
}


// ============================================================
// GUIDE REMINDER
// ============================================================

function appendGuideReminder(
  answer,
  force = false
) {
  const text =
    String(
      answer ||
      ""
    )
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


// ============================================================
// LOCAL QUESTIONS
// ============================================================

function isIdentityQuestion(
  question
) {
  const q =
    normalizeGuideText(
      question
    );


  return (
    /sen kimsin|sen nesin|kimin botusun|kim gelistirdi|kim yapti seni/
      .test(
        q
      )
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
      .test(
        q
      ) &&
    /katil|basvur|alim|hangi taraf|alliance|horde|ruleset|sunucu|server/
      .test(
        q
      )
  );
}


// ============================================================
// BASE64
// ============================================================

function bytesToBase64(
  bytes
) {
  let binary =
    "";


  for (
    let i =
      0;
    i <
      bytes.length;
    i +=
      0x8000
  ) {
    binary +=
      String.fromCharCode(
        ...bytes.subarray(
          i,
          i +
          0x8000
        )
      );
  }


  return btoa(
    binary
  );
}


// ============================================================
// INTERACTIONS PARSER
// ============================================================

function extractInteractionText(
  data
) {
  if (
    typeof data
      ?.output_text ===
      "string" &&
    data.output_text
      .trim()
  ) {
    return (
      data.output_text
        .trim()
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
      steps.length -
      1;

    i >=
      0;

    i--
  ) {
    const step =
      steps[
        i
      ];


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

        .join(
          "\n"
        )

        .trim();


    if (
      text
    ) {
      return text;
    }
  }


  return "";
}


// ============================================================
// WORKER ENTRY
// ============================================================

export default {

  async fetch(
    request,
    env
  ) {
    const url =
      new URL(
        request.url
      );


    // --------------------------------------------------------
    // HEALTH
    // --------------------------------------------------------

    if (
      url.pathname ===
      "/health"
    ) {
      return json({

        ok:
          true,

        service:
          "totik-ai",

        mode:
          "semantic-guide-router-v4",

        normalCooldownMinutes:
          15,

        premiumCooldownMinutes:
          1,

        guideCatalog:
          catalogDiagnostics(),

        semanticIndex:
          semanticIndexDiagnostics()
      });
    }


    // --------------------------------------------------------
    // SEMANTIC INDEX
    //
    // 177 sayfanın bot tarafından nasıl sınıflandırıldığını
    // tarayıcıdan görebilirsin.
    // --------------------------------------------------------

    if (
      url.pathname ===
      "/guide-index"
    ) {
      return json({

        ok:
          semanticIndexDiagnostics()
            .ok,

        diagnostics:
          semanticIndexDiagnostics(),

        pages:
          GUIDE_SEMANTIC_INDEX
            .map(
              entry => ({

                key:
                  entry.page.key,

                classKey:
                  entry.page.classKey,

                filename:
                  entry.page.filename,

                kind:
                  entry.kind,

                spec:
                  entry.spec ||
                  null,

                faction:
                  entry.faction ||
                  null,

                intents:
                  entry.intents,

                talentCount:
                  (
                    entry.page.talents ||
                    []
                  ).length
              })
            )
      });
    }


    if (
      !env.GATEWAY
    ) {
      return json(
        {

          ok:
            false,

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
      env.GATEWAY.get(
        id
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


    if (
      !target
    ) {
      return new Response(
        "Not found",
        {
          status:
            404
        }
      );
    }


    try {
      return await stub.fetch(
        new Request(
          `https://internal${target}`
        )
      );


    } catch (
      error
    ) {
      return json(
        {

          ok:
            false,

          error:
            "durable_object_unavailable",

          detail:
            error?.message ||
            String(
              error
            )
        },
        503
      );
    }
  }
};


// ============================================================
// DURABLE OBJECT
// ============================================================

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


// ============================================================
// ROUTES
// ============================================================

  async fetch(
    request
  ) {
    const url =
      new URL(
        request.url
      );


    // --------------------------------------------------------
    // START
    // --------------------------------------------------------

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

            ok:
              false,

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

        ok:
          true,

        state:
          "polling",

        pollIntervalSeconds:
          POLL_INTERVAL_MS /
          1000
      });
    }


    // --------------------------------------------------------
    // STOP
    // --------------------------------------------------------

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

        ok:
          true,

        state:
          "stopped"
      });
    }


    // --------------------------------------------------------
    // RUN
    // --------------------------------------------------------

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

        ok:
          true,

        state:
          "polling",

        manualRun:
          true
      });
    }


    // --------------------------------------------------------
    // GUIDE CHECK
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // STATUS
    // --------------------------------------------------------

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
          enabled ===
          false
            ? "stopped"
            : "polling",

        running:
          enabled !==
            false &&
          alarmAt !=
            null,

        initialized:
          initialized ===
          true,

        pollIntervalSeconds:
          POLL_INTERVAL_MS /
          1000,

        normalCooldownMinutes:
          15,

        premiumCooldownMinutes:
          1,

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
              )
                .toISOString()
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
          catalogDiagnostics(),

        semanticIndex:
          semanticIndexDiagnostics()
      });
    }


    return new Response(
      "Not found",
      {
        status:
          404
      }
    );
  }


// ============================================================
// ALARM
// ============================================================

  async alarm() {
    if (
      (
        await this.ctx.storage.get(
          "polling_enabled"
        )
      ) ===
      false
    ) {
      return;
    }


    try {
      await this.ensureInitialized();


      await this.pollOnce();


    } catch (
      error
    ) {
      await this.setLastError(
        `Polling: ${
          error?.message ||
          String(
            error
          )
        }`
      );


    } finally {

      if (
        (
          await this.ctx.storage.get(
            "polling_enabled"
          )
        ) !==
        false
      ) {
        await this.ctx.storage.setAlarm(
          Date.now() +
          POLL_INTERVAL_MS
        );
      }
    }
  }


// ============================================================
// INITIALIZE
// ============================================================

  async ensureInitialized() {
    if (
      (
        await this.ctx.storage.get(
          "initialized"
        )
      ) ===
      true
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


// ============================================================
// POLL
// ============================================================

  async pollOnce() {
    let cursor =
      await this.ctx.storage.get(
        "last_message_id"
      );


    for (
      let page =
        0;

      page <
        3;

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
        messages.length ===
        0
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
          )
            .trim();


        if (
          !QUESTION_COMMAND
            .test(
              content
            ) &&
          !DEBUG_COMMAND
            .test(
              content
            )
        ) {
          continue;
        }


        try {
          await this.handleCommand(
            message
          );


        } catch (
          error
        ) {
          await this.markTechnicalFailure();


          await this.setLastError(
            `Handle command: ${
              error?.message ||
              String(
                error
              )
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


// ============================================================
// GUIDE CHECK
// ============================================================

  async buildGuideCheck() {
    const diag =
      catalogDiagnostics();


    const semantic =
      semanticIndexDiagnostics();


    const report = {

      ok:
        semantic.ok,

      imageChannelId:
        GUIDE_IMAGE_CHANNEL_ID,

      totalExpectedPages:
        CLASS_GUIDE_PAGES.length,

      totalMatchedPages:
        0,

      totalImageAttachments:
        0,

      semanticIndex:
        semantic,

      classes:
        {}
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


        const missing =
          [];


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
                ?.pageCounts
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


      } catch (
        error
      ) {
        report.ok =
          false;


        report.classes[
          classKey
        ] = {

          ok:
            false,

          messageIds:
            expectedBatchMessageIds(
              classKey
            ),

          expectedPages:
            Number(
              diag
                ?.pageCounts
                ?.[classKey] ||
              0
            ),

          error:
            error?.message ||
            String(
              error
            )
        };
      }
    }


    return report;
  }


// ============================================================
// COMMAND HANDLER
// ============================================================

  async handleCommand(
    message
  ) {
    const content =
      String(
        message
          ?.content ||
        ""
      )
        .trim();


    // --------------------------------------------------------
    // DEBUG
    // --------------------------------------------------------

    if (
      DEBUG_COMMAND
        .test(
          content
        )
    ) {
      await this.handleDebugCommand(
        message
      );


      return;
    }


    // --------------------------------------------------------
    // QUESTION
    // --------------------------------------------------------

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
      "";


    if (
      referencedText &&
      currentQuestion
    ) {
      question =
        `Önceki mesaj: ${referencedText}\nEk soru: ${currentQuestion}`;


    } else if (
      currentQuestion
    ) {
      question =
        currentQuestion;


    } else if (
      referencedText
    ) {
      question =
        referencedText;


    } else if (
      userImage
    ) {
      question =
        "Bu World of Warcraft görselindeki konu hakkında yardımcı ol.";
    }


    if (
      !question &&
      !userImage
    ) {
      await this.reply(
        message,

        "Sorunu `!soru` komutundan sonra yazabilir veya bir mesaja reply atıp `!soru` yazabilirsin."
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


    const cooldownClass =
      await this.getMemberCooldownClass(
        message
      );


    const cooldown =
      await this.acquireCooldown(
        userId,
        cooldownClass.durationMs
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
          cooldownClass.reason,

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

      // ------------------------------------------------------
      // IDENTITY
      // ------------------------------------------------------

      if (
        isIdentityQuestion(
          question
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


      // ------------------------------------------------------
      // GUILD
      // ------------------------------------------------------

      if (
        isGuildInfoQuestion(
          question
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


      await this.safeTyping(
        QUESTION_CHANNEL_ID
      );


      // ------------------------------------------------------
      // RESOLVE CLASS GUIDE
      // ------------------------------------------------------

      const resolution =
        resolveClassGuide(
          question
        );


      // ------------------------------------------------------
      // EXTERNAL-ONLY
      //
      // Quest / görev / lokasyon gibi sorularda
      // class görseli GÖNDERİLMEZ.
      // ------------------------------------------------------

      if (
        resolution.externalOnly
      ) {
        const researchQuestion =
          buildExternalResearchQuestion(
            question,
            resolution
          );


        const result =
          await this.askWowAi(
            researchQuestion
          );


        const hasSources =
          Array.isArray(
            result?.sources
          ) &&
          result.sources.length >
          0;


        let answer;


        /*
          Class quest gibi hassas bir soruda
          source yoksa model bilgisinden görev uydurtmuyoruz.
        */

        if (
          !hasSources &&
          resolution.externalKind ===
          "class_quest_or_quest"
        ) {
          answer =
            "Bu class görevi sorusu için güvenilir bir kaynak bulamadım. Yanlış görev adı veya ödül uydurmak yerine burada net bilgi vermiyorum.";


        } else {

          answer =
            sanitizeNormalAnswer(
              result?.answer ||
              ""
            );
        }


        if (
          !answer
        ) {
          throw new Error(
            "Araştırma backend'i boş cevap döndürdü."
          );
        }


        /*
          ÖNEMLİ:
          Quest route'ta files yok.
        */

        await this.reply(
          message,
          answer
        );


        await this.finishSuccessfulAnswer({

          route:
            "external_research",

          externalKind:
            resolution.externalKind,

          classKey:
            resolution.classKey ||
            null,

          specKey:
            resolution.specKey ||
            null,

          faction:
            resolution.faction ||
            null,

          source:
            hasSources
              ? `backend_tavily_grounded:${result?.mode || "unknown"}`
              : `backend_no_source:${result?.mode || "unknown"}`,

          sourceCount:
            hasSources
              ? result.sources.length
              : 0,

          tavilyUsed:
            hasSources,

          imageSent:
            false,

          imagesSent:
            0
        });


        return;
      }


      // ------------------------------------------------------
      // CLASS GUIDE
      // ------------------------------------------------------

      if (
        resolution.matched &&
        Array.isArray(
          resolution.pages
        ) &&
        resolution.pages.length >
        0
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
          await this.finishSuccessfulAnswer(
            guideResult.trace
          );


          return;
        }


        /*
          Grounding başarısızsa random guide görseli yok.
          Backend'e görselsiz düşer.
        */
      }


      // ------------------------------------------------------
      // NORMAL BACKEND
      // ------------------------------------------------------

      let finalQuestion =
        question;


      if (
        userImage
      ) {
        const imageContext =
          await this.analyzeUserImage(
            userImage,
            question
          );


        if (
          imageContext
        ) {
          finalQuestion +=
            `\n\nKullanıcının görselinden okunan bilgiler:\n${imageContext}`;
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
        sanitizeNormalAnswer(
          result?.answer ||
          ""
        );


      if (
        !answer
      ) {
        throw new Error(
          "AI boş cevap döndürdü."
        );
      }


      // ------------------------------------------------------
      // SPECIAL GUIDE
      // ------------------------------------------------------

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


        if (
          item
        ) {
          specialMedia.push(
            item
          );
        }
      }


      const files =
        await this.prepareOutgoingFiles(
          specialMedia
        );


      const shouldRemind =
        Boolean(
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


      await this.finishSuccessfulAnswer({

        route:
          "normal_backend",

        classResolutionReason:
          resolution.reason ||
          null,

        classKey:
          resolution.classKey ||
          null,

        specKey:
          resolution.specKey ||
          null,

        source:
          listenerFallback

            ? "listener_gemini_fallback"

            : result?.curated

              ? `backend_curated:${result.curatedTopic || "unknown"}`

              : Array.isArray(
                  result?.sources
                ) &&
                result.sources.length >
                0

                ? `backend_tavily_grounded:${result.mode || "unknown"}`

                : `backend_model:${result?.mode || "unknown"}`,

        tavilyUsed:
          !listenerFallback &&
          Array.isArray(
            result?.sources
          ) &&
          result.sources.length >
          0,

        imageSent:
          files.length >
          0,

        imagesSent:
          files.length
      });


    } catch (
      error
    ) {
      await this.releaseCooldown(
        userId
      );


      await this.markTechnicalFailure();


      await this.setLastError(
        `Question: ${
          error?.message ||
          String(
            error
          )
        }`
      );


      await this.reply(
        message,

        "Şu an bilgi kaynaklarından birine ulaşamadım. Bu deneme cooldown hakkından düşmedi; biraz sonra tekrar deneyebilirsin."
      );
    }
  }


// ============================================================
// DEBUG
// ============================================================

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
        .has(
          userId
        )
    ) {
      return;
    }


    const lastTrace =
      await this.ctx.storage.get(
        "last_trace"
      );


    const lastError =
      await this.ctx.storage.get(
        "last_error"
      );


    const payload = {

      lastTrace:
        lastTrace ||
        null,

      lastError:
        lastError ||
        null,

      semanticIndex:
        semanticIndexDiagnostics()
    };


    await this.reply(
      message,

      `\`\`\`json\n${JSON.stringify(
        payload,
        null,
        2
      ).slice(
        0,
        1700
      )}\n\`\`\``
    );
  }


// ============================================================
// CLASS GUIDE ANSWER
// ============================================================

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


    // --------------------------------------------------------
    // BUILD SOURCE CONTEXT
    // --------------------------------------------------------

    for (
      const page
      of resolution.pages
    ) {

      /*
        Talent data catalog'da structured ise
        Vision çağırmaya gerek yok.
      */

      if (
        (
          page.talents ||
          []
        ).length >
        0
      ) {
        const structured =
          buildStructuredGuideContext({
            pages: [
              page
            ]
          });


        if (
          structured
        ) {
          contexts.push(
            structured
          );


          sourceKinds.add(
            "catalog_structured"
          );


          continue;
        }
      }


      /*
        Diğer görseller gerçek PNG'den okunur.
      */

      const mediaItem =
        media.find(
          item =>
            item.page.key ===
            page.key
        );


      if (
        !mediaItem
      ) {
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


        if (
          !vision
        ) {
          allPagesGrounded =
            false;


          continue;
        }


        contexts.push(
          vision
        );


        sourceKinds.add(
          "guide_image_vision"
        );


      } catch (
        error
      ) {
        allPagesGrounded =
          false;


        await this.setLastError(
          `Guide vision ${page.key}: ${
            error?.message ||
            String(
              error
            )
          }`
        );
      }
    }


    // --------------------------------------------------------
    // NO GROUNDING = NO IMAGE
    // --------------------------------------------------------

    if (
      contexts.length ===
        0 ||
      !allPagesGrounded
    ) {
      return {

        handled:
          false,

        trace: {

          route:
            "class_guide",

          source:
            "guide_grounding_incomplete",

          classKey:
            resolution.classKey,

          specKey:
            resolution.specKey ||
            null,

          pages:
            resolution.pages
              .map(
                page =>
                  page.key
              ),

          tavilyUsed:
            false,

          imageSent:
            false
        }
      };
    }


    // --------------------------------------------------------
    // GENERATE GROUNDED ANSWER
    // --------------------------------------------------------

    const rawAnswer =
      await this.askGuideGrounded(
        question,
        resolution,
        contexts.join(
          "\n\n---\n\n"
        )
      );


    const cleanAnswer =
      finalizeClassGuideAnswer(
        rawAnswer,
        resolution
      );


    if (
      !cleanAnswer
    ) {
      return {

        handled:
          false,

        trace: {

          route:
            "class_guide",

          source:
            "empty_guide_answer"
        }
      };
    }


    // --------------------------------------------------------
    // ATTACH RELEVANT IMAGES ONLY
    // --------------------------------------------------------

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
          ]
            .join(
              "+"
            ),

        classKey:
          resolution.classKey,

        specKey:
          resolution.specKey ||
          null,

        faction:
          resolution.faction ||
          null,

        intents:
          resolution.intents ||
          [],

        reason:
          resolution.reason,

        pages:
          resolution.pages
            .map(
              page =>
                page.key
            ),

        batchMessageIds:
          expectedBatchMessageIds(
            resolution.classKey
          ),

        imagesMatched:
          media.length,

        imagesSent:
          files.length,

        imageSent:
          files.length >
          0,

        tavilyUsed:
          false,

        answerChars:
          cleanAnswer.length,

        elapsedMs:
          Date.now() -
          startedAt
      }
    };
  }


// ============================================================
// LOAD MATCHED GUIDE MEDIA
// ============================================================

  async loadClassGuideMedia(
    resolution
  ) {
    const attachments =
      await this.getClassAttachmentIndex(
        resolution.classKey
      );


    const results =
      [];


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

        matchMode:
          match.matchMode,

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


// ============================================================
// CLASS ATTACHMENTS
// ============================================================

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
      now -
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
          now,

        attachments
      }
    );


    return attachments;
  }


// ============================================================
// MEDIA BYTES
// ============================================================

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


    if (
      !response.ok
    ) {
      if (
        mediaItem
          ?.page
          ?.classKey
      ) {
        this.classAttachmentCache.delete(
          mediaItem
            .page
            .classKey
        );
      }


      throw new Error(
        `Guide image download HTTP ${response.status}`
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


// ============================================================
// GUIDE VISION CACHE
// ============================================================

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


    /*
      v6 yeni prompt/cache.
    */

    const cacheKey =
      `guidevision:v6:${page.key}:${attachmentId}`;


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


    const prompt =
`
Bu görsel Totik Channel'ın WoW Forever rehberine ait gerçek bir rehber sayfasıdır.

Görevin bu sayfayı daha sonra soru-cevap sisteminin güvenilir kaynak verisine dönüştürmek.

KURALLAR:

- Yalnızca görselde gerçekten yazan bilgiyi çıkar.
- World of Warcraft genel bilginle boşluk doldurma.
- Görselde olmayan mekanik, sayı, görev, NPC, item, lokasyon veya öneri ekleme.
- Dosya adı, PNG/JPG adı, sayfa anahtarı veya teknik katalog bilgisi yazma.
- Spell / ability / talent / buff / aura / seal isimlerini koru.
- Yüzde, süre, cooldown, menzil, seviye, hedef sayısı, party/raid kapsamı ve istisnaları koru.
- Rotation / priority sayfasıysa adım sırasını koru.
- Leveling sayfasıysa yalnızca görseldeki leveling yol haritasını koru.
- Bu görsel class quest sayfası değilse görev bilgisi uydurma.
- Son kullanıcıya cevap yazmıyorsun; temiz kaynak özeti çıkarıyorsun.
`
      .trim();


    const vision =
      await this.callGeminiVision(

        prompt,

        bytes,

        mediaItem
          .attachment
          .content_type ||
        "image/png",

        1400
      );


    const cleaned =
      cleanText(
        vision,
        7500
      );


    if (
      !cleaned
    ) {
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


// ============================================================
// GUIDE GROUNDED ANSWER
// ============================================================

  async askGuideGrounded(
    question,
    resolution,
    context
  ) {
    const prompt =
`
KULLANICI SORUSU:
${question}

REHBER EŞLEŞMESİ:

Class:
${resolution.classKey}

Spec / Tree:
${resolution.specKey || "belirtilmedi"}

Konu:
${(resolution.intents || []).join(", ") || "genel"}


TOTIK CHANNEL REHBER VERİSİ:

---
${context}
---


CEVAP KURALLARI:

1. Direkt cevaba gir.

2. Selam verme.

3. Kendini tanıtma.

4. Yalnızca yukarıdaki Totik Channel rehber verisini kullan.

5. Dosya adı, PNG/JPG, sayfa anahtarı, katalog veya teknik kaynak adı yazma.

6. Rehberde olmayan görev, NPC, item, mekanik, sayı veya tavsiye uydurma.

7. Kullanıcı görev/class quest soruyorsa bu route'a zaten gelmemeli; görev bilgisi üretme.

8. Talent sorusunda yalnızca eşleşen spec/tree talentlarını anlat.

9. Buff sorusunda yalnızca eşleşen buff sayfasındaki ana buffları ve temel etkilerini özetle.

10. Aura sorusunda yalnızca Aura anlat.

11. Seal sorusunda yalnızca Seal anlat.

12. Blessing sorusunda yalnızca Blessing anlat.

13. Rotation/taktik sorusunda eşleşen priority/utility rehberine göre 4-6 kısa madde yaz.

14. Stat sorusunda yalnızca eşleşen stat sayfalarını kullan; gereksiz talent veya skill listesi verme.

15. Leveling sorusunda leveling sayfasını özetle; görev bilgisi görselde yoksa görev uydurma.

16. Class özeti yalnızca kullanıcı gerçekten class'ın ne olduğunu/rollerini sorarsa kullanılır.

17. Cevap yaklaşık 500-750 karakter olsun.

18. En fazla 4-6 kısa madde kullan.

19. Detayın tamamını yazma; görseller zaten kullanıcıya gönderilecek.

20. Cooldown, üyelik veya bot mimarisinden bahsetme.
`
      .trim();


    return this.callGeminiText(

      prompt,

      600,

      0.05
    );
  }


// ============================================================
// SPECIAL GUIDE IMAGE
// ============================================================

  async getSpecialGuideMedia(
    topic
  ) {
    const messageId =
      SPECIAL_GUIDE_IMAGE_MESSAGE_IDS[
        String(
          topic ||
          ""
        )
      ];


    if (
      !messageId
    ) {
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


      if (
        !attachment
      ) {
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


    } catch (
      error
    ) {
      await this.setLastError(
        `Special guide image ${topic}: ${
          error?.message ||
          String(
            error
          )
        }`
      );


      return null;
    }
  }


// ============================================================
// PREPARE DISCORD FILES
// ============================================================

  async prepareOutgoingFiles(
    mediaItems
  ) {
    const files =
      [];


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
              ?.page
              ?.filename ||
            mediaItem
              ?.attachment
              ?.filename ||
            "guide.png",

          contentType:
            mediaItem
              ?.attachment
              ?.content_type ||
            "image/png",

          bytes,

          description:
            "Totik Channel WoW Forever rehberi"
        });


        totalBytes +=
          bytes.byteLength;


      } catch (
        error
      ) {
        await this.setLastError(
          `Guide file ${
            mediaItem
              ?.page
              ?.key ||
            "unknown"
          }: ${
            error?.message ||
            String(
              error
            )
          }`
        );
      }
    }


    return files;
  }


// ============================================================
// PREMIUM ROLE
// ============================================================

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
        .has(
          userId
        )
    ) {
      return {

        premium:
          true,

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
          .map(
            String
          )
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

          premium:
            true,

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

          premium:
            true,

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
      memberRoleIds.size >
      0
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


          const roleName =
            normalizeGuideText(
              role.name
            );


          const youtubeMember =
            roleName.includes(
              "youtube"
            ) &&
            /katil|abone|member|uyelik/
              .test(
                roleName
              );


          const twitchSub =
            roleName.includes(
              "twitch"
            ) &&
            /sub|subscriber|abone/
              .test(
                roleName
              );


          if (
            youtubeMember
          ) {
            return {

              premium:
                true,

              reason:
                `role_name:${role.name}`,

              durationMs:
                PREMIUM_COOLDOWN_MS
            };
          }


          if (
            twitchSub
          ) {
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


      } catch (
        error
      ) {
        console.log(
          JSON.stringify({

            event:
              "premium_role_lookup_failed",

            error:
              error?.message ||
              String(
                error
              )
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


// ============================================================
// ROLE CACHE
// ============================================================

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


// ============================================================
// COOLDOWN
// ============================================================

  async acquireCooldown(
    userId,
    durationMs
  ) {
    if (
      durationMs <=
        0 ||
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


// ============================================================
// USER IMAGE ANALYSIS
// ============================================================

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


    if (
      !response.ok
    ) {
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


    const prompt =
`
World of Warcraft ekran görüntüsünü incele.

Kullanıcının sorusu:

${question}

Yalnızca bu soruyu cevaplamak için görselde gerçekten görülen bilgileri çıkar.

Görselde olmayan bilgi ekleme.

Türkçe ve kısa yaz.
`
      .trim();


    return this.callGeminiVision(

      prompt,

      bytes,

      image.content_type ||
      "image/png",

      500
    );
  }


// ============================================================
// MAIN BACKEND
// ============================================================

  async askWowAi(
    question
  ) {
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
      let attempt =
        1;

      attempt <=
        2;

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
          {};


        try {
          data =
            raw
              ? JSON.parse(
                  raw
                )
              : {};


        } catch {

          data =
            {};
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
          ]
            .includes(
              response.status
            ) &&
          attempt <
          2
        ) {
          await sleep(
            1200
          );


          continue;
        }


        throw lastError;


      } catch (
        error
      ) {
        lastError =
          error?.name ===
          "AbortError"
            ? new Error(
                "totik-ai-test timeout"
              )
            : error;


        if (
          attempt <
          2
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


// ============================================================
// GEMINI TEXT
// ============================================================

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


      let data =
        {};


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


      if (
        !response.ok
      ) {
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


      if (
        !text
      ) {
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


// ============================================================
// GEMINI VISION
// ============================================================

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


      let data =
        {};


      try {
        data =
          raw
            ? JSON.parse(
                raw
              )
            : {};


      } catch {
        throw new Error(
          "Gemini Vision geçersiz JSON döndürdü."
        );
      }


      if (
        !response.ok
      ) {
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

        .join(
          "\n"
        )

        .trim();


    } finally {

      clearTimeout(
        timer
      );
    }
  }


// ============================================================
// GEMINI GENERAL FALLBACK
// ============================================================

  async askGeminiGeneralFallback(
    question,
    backendError
  ) {
    const prompt =
`
Kullanıcının World of Warcraft sorusu:

${question}

Ana araştırma sistemi geçici olarak yanıt veremedi.

Kurallar:

- Türkçe, kısa ve doğal cevap ver.

- Kendini tanıtma.

- WoW Forever'a özgü güncel bilgiden emin değilsen uydurma.

- Cooldown, üyelik veya reklam yazma.
`
      .trim();


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


// ============================================================
// DISCORD REPLY
// ============================================================

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
      let i =
        0;

      i <
        chunks.length;

      i++
    ) {
      const payload = {

        content:
          chunks[
            i
          ],

        allowed_mentions: {

          parse:
            [],

          replied_user:
            false
        }
      };


      if (
        i ===
        0
      ) {
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
        i ===
          0 &&
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


// ============================================================
// TYPING
// ============================================================

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


// ============================================================
// MULTIPART
// ============================================================

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
      let attempt =
        1;

      attempt <=
        4;

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
          retryAfter <
          100
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
        attempt <
        4
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
      "Discord multipart retry limiti aşıldı."
    );
  }


// ============================================================
// DISCORD JSON
// ============================================================

  async discordRequest(
    path,
    options = {}
  ) {
    const method =
      options.method ||
      "GET";


    for (
      let attempt =
        1;

      attempt <=
        4;

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
          retryAfter <
          100
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
        attempt <
        4
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
      "Discord API retry limiti aşıldı."
    );
  }


// ============================================================
// TRACE
// ============================================================

  async finishSuccessfulAnswer(
    trace
  ) {
    await this.markAnswered();


    await this.clearLastError();


    await this.recordTrace(
      trace
    );
  }


  async recordTrace(
    trace
  ) {
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


// ============================================================
// COUNTERS
// ============================================================

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
      current +
      1
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
      current +
      1
    );
  }


// ============================================================
// ERROR
// ============================================================

  async clearLastError() {
    await this.ctx.storage.delete(
      "last_error"
    );
  }


  async setLastError(
    message
  ) {
    await this.ctx.storage.put(
      "last_error",
      String(
        message ||
        "Unknown error"
      )
    );
  }
}
