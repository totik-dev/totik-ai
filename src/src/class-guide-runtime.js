import {
  GUIDE_IMAGE_CHANNEL_ID,
  GUIDE_BATCH_MESSAGE_IDS,
  CLASS_GUIDE_PAGES
} from "./class-guide-catalog.js";

export {
  GUIDE_IMAGE_CHANNEL_ID,
  GUIDE_BATCH_MESSAGE_IDS,
  CLASS_GUIDE_PAGES
};

const CLASS_ALIASES = {
  druid: ["druid"],
  hunter: ["hunter", "avci", "avcı"],
  mage: ["mage", "buyucu", "büyücü"],
  paladin: ["paladin", "pala"],
  priest: ["priest", "rahip"],
  rogue: ["rogue", "haydut"],
  shaman: ["shaman", "saman", "şaman"],
  warlock: ["warlock"],
  warrior: ["warrior", "savasci", "savaşçı"]
};

const TREE_ALIASES = {
  druid: {
    balance: ["balance", "boomkin", "moonkin"],
    "feral-combat": ["feral combat", "feral", "cat", "kedi", "bear", "ayi", "ayı"],
    restoration: ["restoration", "resto", "heal", "healer"]
  },
  hunter: {
    beast: ["beast mastery", "beastmastery", "beast", "bm"],
    marksmanship: ["marksmanship", "marksman", "mm"],
    survival: ["survival", "surv"]
  },
  mage: {
    arcane: ["arcane"],
    fire: ["fire"],
    frost: ["frost"]
  },
  paladin: {
    holy: ["holy", "heal", "healer"],
    protection: ["protection", "prot", "tank"],
    retribution: ["retribution", "retri", "ret"]
  },
  priest: {
    discipline: ["discipline", "disc"],
    holy: ["holy"],
    shadow: ["shadow"]
  },
  rogue: {
    assassination: ["assassination", "assa"],
    combat: ["combat"],
    subtlety: ["subtlety", "sub"]
  },
  shaman: {
    elemental: ["elemental", "ele"],
    enhancement: ["enhancement", "enh"],
    restoration: ["restoration", "resto", "heal", "healer"]
  },
  warlock: {
    affliction: ["affliction", "affli"],
    demonology: ["demonology", "demo"],
    destruction: ["destruction", "destro"]
  },
  warrior: {
    arms: ["arms"],
    fury: ["fury"],
    protection: ["protection", "prot", "tank"]
  }
};

const INTENT_PATTERNS = {
  talent: /\b(talent[a-z]*|yetenek\s+agac[a-z]*|skill\s+tree|build)\b/i,
  race: /\b(irk[a-z]*|race|racial[a-z]*)\b/i,
  stat: /\b(stat[a-z]*|hit|crit|kritik[a-z]*|haste|expertise|spell\s+power|attack\s+power|armor|zirh[a-z]*|dodge|parry|block|intellect|strength|agility|stamina|spirit)\b/i,
  rotation: /\b(rotasyon[a-z]*|rotation|oncelik[a-z]*|priority|nasil\s+oyn[a-z]*|oynanis[a-z]*|healing|heal\s+rotasyon[a-z]*)\b/i,
  utility: /\b(utility|interrupt[a-z]*|dispel[a-z]*|cleanse|savunma[a-z]*|defensive|cooldown[a-z]*|taunt[a-z]*|kontrol[a-z]*|control)\b/i,
  leveling: /\b(level[a-z]*|kasma|yol\s+harita[a-z]*|checklist|trainer[a-z]*)\b/i,
  buff: /\b(buff[a-z]*|debuff[a-z]*|blessing[a-z]*|aura[a-z]*|seal[a-z]*|shout[a-z]*)\b/i,
  mechanics: /\b(mekanik[a-z]*|kaynak\s+sistemi|resource|mana|energy|rage|stance|combo\s+point|focus)\b/i,
  gear: /\b(gear|ekipman[a-z]*|weapon[a-z]*|silah[a-z]*|meslek[a-z]*|profession[a-z]*)\b/i
};

const CATEGORY_FILENAME_PATTERNS = {
  race: /(irk-secimi|race|racial)/,
  stat: /(stat|ana-stat|yan-stat|ofansif|defansif|savunma)/,
  rotation: /(oynanis|oncelik|rotation|holy-healing|dps-tank-oncelik)/,
  utility: /(utility|kontrol|savunma)/,
  leveling: /(leveling|yol-haritasi|checklist)/,
  buff: /(buff|debuff|blessing|aura|seal|shout)/,
  mechanics: /(temel-mekanik|stance|rage-sistemi)/,
  gear: /(weapon|gear|meslek)/
};

function stripDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeGuideText(value) {
  return stripDiacritics(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/[’‘`´]/g, "'")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9'\-\s:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseIn(normalizedQuestion, phrase) {
  const p = normalizeGuideText(phrase);
  if (!p) return false;

  return (
    (` ${normalizedQuestion} `).includes(` ${p} `) ||
    normalizedQuestion.includes(p)
  );
}

function classAliasSet(classKey) {
  return new Set(
    (CLASS_ALIASES[classKey] || []).map(normalizeGuideText)
  );
}

function pageOrdinal(page) {
  const match = String(page?.filename || "").match(/^(\d+)/);
  return match ? Number(match[1]) : 999;
}

function detectClass(question) {
  const q = normalizeGuideText(question);

  for (const [classKey, aliases] of Object.entries(CLASS_ALIASES)) {
    if (aliases.some((alias) => phraseIn(q, alias))) {
      return classKey;
    }
  }

  const candidateClasses = new Set();

  for (const page of CLASS_GUIDE_PAGES) {
    for (const talent of page.talents || []) {
      const talentName = normalizeGuideText(talent.name);

      if (
        talentName.length >= 4 &&
        q.includes(talentName)
      ) {
        candidateClasses.add(page.classKey);
      }
    }
  }

  return candidateClasses.size === 1
    ? [...candidateClasses][0]
    : null;
}

function detectTree(question, classKey) {
  if (!classKey) return null;

  const q = normalizeGuideText(question);
  const trees = TREE_ALIASES[classKey] || {};

  for (const [treeKey, aliases] of Object.entries(trees)) {
    if (aliases.some((alias) => phraseIn(q, alias))) {
      return treeKey;
    }
  }

  for (const page of CLASS_GUIDE_PAGES) {
    if (page.classKey !== classKey) continue;

    for (const talent of page.talents || []) {
      const name = normalizeGuideText(talent.name);

      if (
        name.length >= 4 &&
        q.includes(name)
      ) {
        return talent.tree || null;
      }
    }
  }

  return null;
}

function detectIntents(question) {
  const q = normalizeGuideText(question);
  const intents = [];

  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern.test(q)) {
      intents.push(intent);
    }
  }

  return intents;
}

function exactTalentMatches(question, classKey = null) {
  const q = normalizeGuideText(question);
  const matches = [];

  for (const page of CLASS_GUIDE_PAGES) {
    if (
      classKey &&
      page.classKey !== classKey
    ) {
      continue;
    }

    for (const talent of page.talents || []) {
      const name = normalizeGuideText(talent.name);

      if (
        name.length >= 4 &&
        q.includes(name)
      ) {
        matches.push({
          page,
          talent
        });
      }
    }
  }

  return matches;
}

function scorePage(
  page,
  normalizedQuestion,
  classKey,
  treeKey,
  intents
) {
  if (page.classKey !== classKey) {
    return -Infinity;
  }

  let score = 0;

  const filename =
    normalizeGuideText(page.filename);

  const classAliases =
    classAliasSet(classKey);

  for (const intent of intents) {
    if (
      intent === "talent" &&
      (page.talents || []).length > 0
    ) {
      score += 110;
      continue;
    }

    const pattern =
      CATEGORY_FILENAME_PATTERNS[intent];

    if (
      pattern &&
      pattern.test(filename)
    ) {
      score += 95;
    }
  }

  if (treeKey) {
    const talentTreeMatch =
      (page.talents || []).some(
        (talent) =>
          normalizeGuideText(talent.tree) ===
          normalizeGuideText(treeKey)
      );

    const talentIntent =
      intents.includes("talent");

    const noSpecificIntent =
      intents.length === 0;

    if (talentTreeMatch) {
      score +=
        talentIntent || noSpecificIntent
          ? 150
          : 25;
    }

    if (
      filename.includes(
        normalizeGuideText(treeKey)
      )
    ) {
      score +=
        talentIntent || noSpecificIntent
          ? 80
          : 20;
    }
  }

  for (const talent of page.talents || []) {
    const talentName =
      normalizeGuideText(talent.name);

    if (
      talentName.length >= 4 &&
      normalizedQuestion.includes(talentName)
    ) {
      score += 350;
    }
  }

  for (const rawKeyword of page.keywords || []) {
    const keyword =
      normalizeGuideText(rawKeyword);

    if (
      !keyword ||
      keyword.length < 4
    ) {
      continue;
    }

    if (classAliases.has(keyword)) {
      continue;
    }

    if (
      normalizedQuestion.includes(keyword)
    ) {
      const wordCount =
        keyword.split(/\s+/).length;

      score += Math.min(
        100,
        18 +
        wordCount * 12 +
        Math.floor(keyword.length / 4)
      );
    }
  }

  return score;
}

function selectSpecialIntentPages(
  classKey,
  treeKey,
  intents
) {
  if (!intents.includes("rotation")) {
    return [];
  }

  const pages =
    CLASS_GUIDE_PAGES.filter(
      (page) =>
        page.classKey === classKey
    );

  if (classKey === "paladin") {
    if (treeKey === "holy") {
      return pages.filter(
        (page) =>
          /16-holy-healing/.test(
            page.filename
          )
      );
    }

    if (
      treeKey === "protection" ||
      treeKey === "retribution"
    ) {
      return pages.filter(
        (page) =>
          /15-dps-tank-oncelik/.test(
            page.filename
          )
      );
    }
  }

  if (classKey === "warrior") {
    if (treeKey === "protection") {
      return pages.filter(
        (page) =>
          /17-protection-oncelik/.test(
            page.filename
          )
      );
    }

    if (
      treeKey === "arms" ||
      treeKey === "fury"
    ) {
      return pages.filter(
        (page) =>
          /16-arms-fury-oncelik/.test(
            page.filename
          )
      );
    }
  }

  return [];
}

function selectIntentPages(
  classKey,
  treeKey,
  intents
) {
  const pages =
    CLASS_GUIDE_PAGES.filter(
      (page) =>
        page.classKey === classKey
    );

  if (intents.includes("talent")) {
    let talentPages =
      pages.filter(
        (page) =>
          (page.talents || []).length > 0
      );

    if (treeKey) {
      talentPages =
        talentPages.filter(
          (page) =>
            (page.talents || []).some(
              (talent) =>
                normalizeGuideText(
                  talent.tree
                ) ===
                normalizeGuideText(
                  treeKey
                )
            )
        );
    }

    return talentPages.sort(
      (a, b) =>
        pageOrdinal(a) -
        pageOrdinal(b)
    );
  }

  return [];
}

export function resolveClassGuide(
  question,
  options = {}
) {
  const q =
    normalizeGuideText(question);

  const classKey =
    detectClass(q);

  if (!classKey) {
    return {
      matched: false,
      reason: "no_class",
      classKey: null,
      treeKey: null,
      intents: [],
      pages: [],
      exactTalents: []
    };
  }

  const treeKey =
    detectTree(
      q,
      classKey
    );

  const intents =
    detectIntents(q);

  const exactTalents =
    exactTalentMatches(
      q,
      classKey
    );

  if (exactTalents.length > 0) {
    const unique =
      new Map();

    for (const match of exactTalents) {
      unique.set(
        match.page.key,
        match.page
      );
    }

    const pages =
      [...unique.values()].sort(
        (a, b) =>
          pageOrdinal(a) -
          pageOrdinal(b)
      );

    return {
      matched: true,
      reason: "exact_talent",
      confidence: 1,
      classKey,
      treeKey:
        treeKey ||
        exactTalents[0]
          ?.talent
          ?.tree ||
        null,
      intents:
        intents.length
          ? intents
          : ["talent"],
      pages,
      exactTalents:
        exactTalents.map(
          (x) =>
            x.talent.name
        ),
      structured: true
    };
  }

  const specialIntentPages =
    selectSpecialIntentPages(
      classKey,
      treeKey,
      intents
    );

  if (
    specialIntentPages.length > 0
  ) {
    return {
      matched: true,
      reason: "special_intent",
      confidence: 0.99,
      classKey,
      treeKey,
      intents,
      pages: specialIntentPages,
      exactTalents: [],
      structured: false
    };
  }

  const directPages =
    selectIntentPages(
      classKey,
      treeKey,
      intents
    );

  if (
    intents.includes("leveling") &&
    treeKey
  ) {
    const classPages =
      CLASS_GUIDE_PAGES.filter(
        (page) =>
          page.classKey === classKey
      );

    const levelingPages =
      classPages.filter(
        (page) =>
          CATEGORY_FILENAME_PATTERNS
            .leveling
            .test(
              normalizeGuideText(
                page.filename
              )
            )
      );

    const treeTalentPages =
      classPages.filter(
        (page) =>
          (page.talents || []).some(
            (talent) =>
              normalizeGuideText(
                talent.tree
              ) ===
              normalizeGuideText(
                treeKey
              )
          )
      );

    const combined = [
      ...levelingPages,
      ...treeTalentPages
    ];

    const unique =
      new Map(
        combined.map(
          (page) => [
            page.key,
            page
          ]
        )
      );

    const pages =
      [...unique.values()]
        .sort(
          (a, b) =>
            pageOrdinal(a) -
            pageOrdinal(b)
        );

    return {
      matched:
        pages.length > 0,
      reason:
        "leveling_tree",
      confidence:
        pages.length
          ? 0.96
          : 0,
      classKey,
      treeKey,
      intents,
      pages:
        pages.slice(
          0,
          6
        ),
      exactTalents: [],
      structured:
        pages.every(
          (page) =>
            (page.talents || [])
              .length > 0
        )
    };
  }

  if (directPages.length > 0) {
    return {
      matched: true,
      reason: "intent_tree",
      confidence:
        treeKey
          ? 0.98
          : 0.94,
      classKey,
      treeKey,
      intents,
      pages:
        directPages.slice(
          0,
          10
        ),
      exactTalents: [],
      structured: true
    };
  }

  const scored =
    CLASS_GUIDE_PAGES
      .filter(
        (page) =>
          page.classKey ===
          classKey
      )
      .map(
        (page) => ({
          page,
          score:
            scorePage(
              page,
              q,
              classKey,
              treeKey,
              intents
            )
        })
      )
      .filter(
        (entry) =>
          entry.score > 0
      )
      .sort(
        (a, b) =>
          b.score -
          a.score ||
          pageOrdinal(
            a.page
          ) -
          pageOrdinal(
            b.page
          )
      );

  if (scored.length > 0) {
    const top =
      scored[0].score;

    const threshold =
      Math.max(
        70,
        top - 35
      );

    const pages =
      scored
        .filter(
          (entry) =>
            entry.score >=
            threshold
        )
        .slice(
          0,
          options.maxPages || 4
        )
        .map(
          (entry) =>
            entry.page
        )
        .sort(
          (a, b) =>
            pageOrdinal(a) -
            pageOrdinal(b)
        );

    return {
      matched: true,
      reason:
        "keyword_score",
      confidence:
        Math.min(
          0.95,
          0.55 +
          top / 500
        ),
      classKey,
      treeKey,
      intents,
      pages,
      exactTalents: [],
      structured:
        pages.every(
          (page) =>
            (page.talents || [])
              .length > 0
        ),
      topScore: top
    };
  }

  const summary =
    CLASS_GUIDE_PAGES.find(
      (page) =>
        page.classKey ===
          classKey &&
        /01-sinif-ozeti/.test(
          page.filename
        )
    );

  return {
    matched:
      Boolean(summary),
    reason:
      summary
        ? "class_summary"
        : "no_page",
    confidence:
      summary
        ? 0.7
        : 0,
    classKey,
    treeKey,
    intents,
    pages:
      summary
        ? [summary]
        : [],
    exactTalents: [],
    structured: false
  };
}

export function buildStructuredGuideContext(
  resolution
) {
  const blocks = [];

  for (
    const page
    of resolution.pages || []
  ) {
    const talents =
      page.talents || [];

    if (!talents.length) {
      continue;
    }

    const lines = [
      `PAGE: ${page.key}`,
      `FILE: ${page.filename}`
    ];

    for (const talent of talents) {
      lines.push(
        `- ${talent.name} | tree=${talent.tree || "unknown"} | ${talent.meta || ""}`,
        `  ${
          String(
            talent.tr || ""
          ).trim() ||
          String(
            talent.effect || ""
          ).trim()
        }`
      );
    }

    blocks.push(
      lines.join("\n")
    );
  }

  return blocks.join(
    "\n\n"
  );
}

export function buildKeywordFallbackContext(
  page
) {
  return [
    `PAGE: ${page.key}`,
    `FILE: ${page.filename}`,
    `KEYWORDS: ${(page.keywords || []).join(" | ")}`
  ].join("\n");
}

export function canonicalFilename(
  value
) {
  let name =
    String(value || "")
      .split(/[\\/]/)
      .pop()
      .toLocaleLowerCase(
        "tr-TR"
      );

  try {
    name =
      decodeURIComponent(
        name
      );
  } catch {
  }

  const dot =
    name.lastIndexOf(".");

  const ext =
    dot >= 0
      ? name.slice(dot)
      : "";

  const stem =
    dot >= 0
      ? name.slice(0, dot)
      : name;

  const cleanStem =
    normalizeGuideText(stem)
      .replace(
        /[\s_]+/g,
        "-"
      )
      .replace(
        /-+/g,
        "-"
      )
      .replace(
        /^-|-$/g,
        ""
      );

  return `${cleanStem}${ext}`;
}

function ordinalFromFilename(
  value
) {
  const match =
    canonicalFilename(value)
      .match(/^(\d+)/);

  return match
    ? Number(match[1])
    : null;
}

export function findAttachmentForPage(
  page,
  attachments
) {
  const expected =
    canonicalFilename(
      page.filename
    );

  const list =
    Array.isArray(attachments)
      ? attachments
      : [];

  let attachment =
    list.find(
      (item) =>
        canonicalFilename(
          item?.filename
        ) === expected
    );

  if (attachment) {
    return {
      attachment,
      matchMode:
        "filename"
    };
  }

  const expectedOrdinal =
    ordinalFromFilename(
      page.filename
    );

  const expectedStem =
    expected.replace(
      /\.\w+$/,
      ""
    );

  const expectedMeaning =
    expectedStem.replace(
      /^\d+-/,
      ""
    );

  const candidates =
    list.filter(
      (item) => {
        const actual =
          canonicalFilename(
            item?.filename
          );

        if (
          expectedOrdinal != null &&
          ordinalFromFilename(
            actual
          ) !==
          expectedOrdinal
        ) {
          return false;
        }

        return (
          actual.includes(
            expectedMeaning
          ) ||
          expectedMeaning.includes(
            actual
              .replace(
                /^\d+-/,
                ""
              )
              .replace(
                /\.\w+$/,
                ""
              )
          )
        );
      }
    );

  if (
    candidates.length === 1
  ) {
    return {
      attachment:
        candidates[0],
      matchMode:
        "ordinal_stem"
    };
  }

  return {
    attachment: null,
    matchMode: "none"
  };
}

export function expectedBatchMessageIds(
  classKey
) {
  return [
    ...(
      GUIDE_BATCH_MESSAGE_IDS[
        classKey
      ] || []
    )
  ];
}

export function catalogDiagnostics() {
  const pageCounts = {};
  const talentCounts = {};
  const emptyTranslations = {};

  for (
    const page
    of CLASS_GUIDE_PAGES
  ) {
    pageCounts[
      page.classKey
    ] =
      (
        pageCounts[
          page.classKey
        ] || 0
      ) + 1;

    if (
      (page.talents || [])
        .length
    ) {
      talentCounts[
        page.classKey
      ] =
        (
          talentCounts[
            page.classKey
          ] || 0
        ) +
        page.talents.length;

      for (
        const talent
        of page.talents
      ) {
        if (
          !String(
            talent.tr || ""
          ).trim()
        ) {
          emptyTranslations[
            page.classKey
          ] =
            (
              emptyTranslations[
                page.classKey
              ] || 0
            ) + 1;
        }
      }
    }
  }

  return {
    guideImageChannelId:
      GUIDE_IMAGE_CHANNEL_ID,
    classes:
      Object.keys(
        GUIDE_BATCH_MESSAGE_IDS
      ),
    pageCounts,
    totalPages:
      CLASS_GUIDE_PAGES.length,
    talentCounts,
    emptyTranslations
  };
}
