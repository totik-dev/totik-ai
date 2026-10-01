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


// ============================================================
// NORMALIZATION
// ============================================================

export function normalizeGuideText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[’‘`´]/g, "'")
    .replace(/[^a-z0-9'\-+%:\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function phraseIn(question, phrase) {
  const q =
    ` ${normalizeGuideText(question)} `;

  const p =
    ` ${normalizeGuideText(phrase)} `;

  return (
    p.trim().length > 0 &&
    q.includes(p)
  );
}


function anyPhrase(
  question,
  phrases
) {
  return phrases.some(
    phrase =>
      phraseIn(
        question,
        phrase
      )
  );
}


function uniquePages(
  pages
) {
  const seen =
    new Set();

  const result =
    [];

  for (
    const page
    of pages || []
  ) {
    if (
      !page?.key ||
      seen.has(
        page.key
      )
    ) {
      continue;
    }

    seen.add(
      page.key
    );

    result.push(
      page
    );
  }

  return result;
}


function ordinal(
  page
) {
  const match =
    String(
      page?.filename ||
      ""
    )
      .match(
        /^(\d+)/
      );

  return match
    ? Number(
        match[1]
      )
    : 999;
}


function sortPages(
  pages
) {
  return [
    ...pages
  ]
    .sort(
      (a, b) =>
        ordinal(a) -
        ordinal(b)
    );
}


// ============================================================
// CLASS / SPEC ALIASES
// ============================================================

export const CLASS_ALIASES = {

  druid: [
    "druid"
  ],

  hunter: [
    "hunter",
    "avci",
    "avcı"
  ],

  mage: [
    "mage",
    "buyucu",
    "büyücü"
  ],

  paladin: [
    "paladin",
    "pala"
  ],

  priest: [
    "priest",
    "rahip"
  ],

  rogue: [
    "rogue",
    "haydut"
  ],

  shaman: [
    "shaman",
    "saman",
    "şaman"
  ],

  warlock: [
    "warlock"
  ],

  warrior: [
    "warrior",
    "savasci",
    "savaşçı"
  ]
};


export const SPEC_ALIASES = {

  druid: {

    balance: [
      "balance",
      "boomkin",
      "moonkin"
    ],

    "feral-combat": [
      "feral combat",
      "feral",
      "cat",
      "kedi",
      "bear",
      "ayi",
      "ayı"
    ],

    restoration: [
      "restoration",
      "resto",
      "healer",
      "heal"
    ]
  },


  hunter: {

    beast: [
      "beast mastery",
      "beastmastery",
      "beast",
      "bm"
    ],

    marksmanship: [
      "marksmanship",
      "marksman",
      "mm"
    ],

    survival: [
      "survival",
      "surv"
    ]
  },


  mage: {

    arcane: [
      "arcane"
    ],

    fire: [
      "fire"
    ],

    frost: [
      "frost"
    ]
  },


  paladin: {

    holy: [
      "holy",
      "healer",
      "heal"
    ],

    protection: [
      "protection",
      "prot",
      "tank"
    ],

    retribution: [
      "retribution",
      "retri",
      "ret",
      "dps"
    ]
  },


  priest: {

    discipline: [
      "discipline",
      "disc"
    ],

    holy: [
      "holy"
    ],

    shadow: [
      "shadow",
      "dps"
    ]
  },


  rogue: {

    assassination: [
      "assassination",
      "assa"
    ],

    combat: [
      "combat"
    ],

    subtlety: [
      "subtlety",
      "sub"
    ]
  },


  shaman: {

    elemental: [
      "elemental",
      "ele"
    ],

    enhancement: [
      "enhancement",
      "enh"
    ],

    restoration: [
      "restoration",
      "resto",
      "heal",
      "healer"
    ]
  },


  warlock: {

    affliction: [
      "affliction",
      "affli"
    ],

    demonology: [
      "demonology",
      "demo"
    ],

    destruction: [
      "destruction",
      "destro"
    ]
  },


  warrior: {

    arms: [
      "arms"
    ],

    fury: [
      "fury"
    ],

    protection: [
      "protection",
      "prot",
      "tank"
    ]
  }
};


// ============================================================
// CLASS DETECTION
// ============================================================

export function detectClass(
  question
) {
  const q =
    normalizeGuideText(
      question
    );


  for (
    const [
      classKey,
      aliases
    ]
    of Object.entries(
      CLASS_ALIASES
    )
  ) {
    if (
      aliases.some(
        alias =>
          phraseIn(
            q,
            alias
          )
      )
    ) {
      return classKey;
    }
  }


  /*
    Kullanıcı class adını yazmadan doğrudan
    talent adı sorarsa class'ı talenttan bul.
  */

  const possible =
    new Set();


  for (
    const page
    of CLASS_GUIDE_PAGES
  ) {
    for (
      const talent
      of page.talents ||
      []
    ) {
      const talentName =
        normalizeGuideText(
          talent.name
        );


      if (
        talentName.length >=
          4 &&
        q.includes(
          talentName
        )
      ) {
        possible.add(
          page.classKey
        );
      }
    }
  }


  return (
    possible.size ===
    1
  )
    ? [
        ...possible
      ][0]
    : null;
}


// ============================================================
// SPEC DETECTION
// ============================================================

export function detectSpec(
  question,
  classKey
) {
  if (
    !classKey
  ) {
    return null;
  }


  const q =
    normalizeGuideText(
      question
    );


  for (
    const [
      specKey,
      aliases
    ]
    of Object.entries(
      SPEC_ALIASES[
        classKey
      ] ||
      {}
    )
  ) {
    if (
      aliases.some(
        alias =>
          phraseIn(
            q,
            alias
          )
      )
    ) {
      return specKey;
    }
  }


  /*
    Talent adı spec'i belirleyebilir.
  */

  for (
    const page
    of CLASS_GUIDE_PAGES
  ) {
    if (
      page.classKey !==
      classKey
    ) {
      continue;
    }


    for (
      const talent
      of page.talents ||
      []
    ) {
      const talentName =
        normalizeGuideText(
          talent.name
        );


      if (
        talentName.length >=
          4 &&
        q.includes(
          talentName
        )
      ) {
        return (
          talent.tree ||
          null
        );
      }
    }
  }


  return null;
}


// ============================================================
// EXTERNAL-ONLY INTENTS
//
// Bunların hiçbirinde class rehberinden rastgele görsel
// gönderilmez.
//
// Sorular Tavily / backend araştırmasına gider.
// ============================================================

const QUEST_TERMS = [

  "quest",
  "quests",

  "gorev",
  "gorevler",
  "gorevi",
  "gorevleri",

  "class quest",
  "class gorevi",

  "sinif gorevi",
  "sinif gorevleri",

  "quest chain",

  "gorev zinciri",

  "zincir gorev"
];


const ACQUISITION_LOCATION_TERMS = [

  "nerede",

  "nerden",

  "nereden",

  "hangi npc",

  "npc nerede",

  "vendor",

  "satici",

  "satıcı",

  "drop",

  "dusuyor",

  "düşüyor",

  "kimden alinir",

  "kimden alınır",

  "nasil alinir",

  "nasıl alınır",

  "nasil elde",

  "nasıl elde"
];


const CURRENT_LIVE_TERMS = [

  "bugun",

  "bugün",

  "su an",

  "şu an",

  "guncel",

  "güncel",

  "son patch",

  "hotfix",

  "server durumu",

  "sunucu durumu",

  "event ne zaman"
];


const TRAINER_LOCATION_TERMS = [

  "trainer nerede",

  "egitmen nerede",

  "eğitmen nerede",

  "hangi trainer",

  "hangi egitmen"
];


export function detectExternalOnlyIntent(
  question
) {
  const q =
    normalizeGuideText(
      question
    );


  if (
    anyPhrase(
      q,
      QUEST_TERMS
    )
  ) {
    return {
      externalOnly:
        true,

      kind:
        "class_quest_or_quest"
    };
  }


  if (
    anyPhrase(
      q,
      TRAINER_LOCATION_TERMS
    )
  ) {
    return {
      externalOnly:
        true,

      kind:
        "trainer_location"
    };
  }


  if (
    anyPhrase(
      q,
      ACQUISITION_LOCATION_TERMS
    )
  ) {
    return {
      externalOnly:
        true,

      kind:
        "acquisition_or_location"
    };
  }


  if (
    anyPhrase(
      q,
      CURRENT_LIVE_TERMS
    )
  ) {
    return {
      externalOnly:
        true,

      kind:
        "current_live_info"
    };
  }


  return {
    externalOnly:
      false,

    kind:
      null
  };
}


// ============================================================
// SEMANTIC PAGE CLASSIFICATION
//
// 177 görselin tamamı burada anlam sınıfına ayrılır.
// ============================================================

function inferTalentSpecFromKey(
  key
) {
  const known = [

    "balance",

    "feral-combat",

    "restoration",

    "beast",

    "marksmanship",

    "survival",

    "arcane",

    "fire",

    "frost",

    "holy",

    "protection",

    "retribution",

    "discipline",

    "shadow",

    "assassination",

    "combat",

    "subtlety",

    "elemental",

    "enhancement",

    "affliction",

    "demonology",

    "destruction",

    "arms",

    "fury"
  ];


  for (
    const spec
    of known
  ) {
    if (
      key.includes(
        `-${spec}-talent-`
      )
    ) {
      return spec;
    }
  }


  return null;
}


function classifyPage(
  page
) {
  const key =
    normalizeGuideText(
      page.key
    );


  const filename =
    normalizeGuideText(
      page.filename
    );


  const combined =
    `${key} ${filename}`;


  // ----------------------------------------------------------
  // TALENTS
  // ----------------------------------------------------------

  if (
    /talent-\d/
      .test(
        combined
      ) ||
    (
      page.talents ||
      []
    ).length >
    0
  ) {
    const trees = [
      ...new Set(
        (
          page.talents ||
          []
        )

          .map(
            talent =>
              normalizeGuideText(
                talent.tree
              )
          )

          .filter(
            Boolean
          )
      )
    ];


    return {
      kind:
        "talent",

      spec:
        trees.length ===
        1
          ? trees[0]
          : inferTalentSpecFromKey(
              key
            ),

      intents: [
        "talent",
        "build",
        "spec"
      ]
    };
  }


  // ----------------------------------------------------------
  // CLASS OVERVIEW
  // ----------------------------------------------------------

  if (
    combined.includes(
      "sinif-ozeti"
    )
  ) {
    return {
      kind:
        "class_overview",

      spec:
        null,

      intents: [
        "overview",
        "roles",
        "what_is_class"
      ]
    };
  }


  // ----------------------------------------------------------
  // PALADIN SPECIAL PAGES
  // ----------------------------------------------------------

  if (
    combined.includes(
      "blessings"
    )
  ) {
    return {
      kind:
        "blessings",

      spec:
        null,

      intents: [
        "buff",
        "blessing"
      ]
    };
  }


  if (
    combined.includes(
      "auras"
    )
  ) {
    return {
      kind:
        "auras",

      spec:
        null,

      intents: [
        "buff",
        "aura"
      ]
    };
  }


  if (
    combined.includes(
      "seals"
    )
  ) {
    return {
      kind:
        "seals",

      spec:
        null,

      intents: [
        "seal",
        "judgement",
        "mechanics"
      ]
    };
  }


  // ----------------------------------------------------------
  // BUFF / DEBUFF
  // ----------------------------------------------------------

  if (
    combined.includes(
      "buff-shout-debuff"
    )
  ) {
    return {
      kind:
        "buff_debuff",

      spec:
        null,

      intents: [
        "buff",
        "debuff",
        "shout"
      ]
    };
  }


  if (
    combined.includes(
      "buff-debuff"
    )
  ) {
    return {
      kind:
        "buff_debuff",

      spec:
        null,

      intents: [
        "buff",
        "debuff"
      ]
    };
  }


  // ----------------------------------------------------------
  // MECHANICS
  // ----------------------------------------------------------

  if (
    combined.includes(
      "stance-sistemi"
    )
  ) {
    return {
      kind:
        "mechanics",

      spec:
        null,

      intents: [
        "stance",
        "mechanics",
        "resource"
      ]
    };
  }


  if (
    combined.includes(
      "rage-sistemi"
    )
  ) {
    return {
      kind:
        "mechanics",

      spec:
        null,

      intents: [
        "rage",
        "mechanics",
        "resource"
      ]
    };
  }


  if (
    combined.includes(
      "temel-mekanikler"
    )
  ) {
    return {
      kind:
        "mechanics",

      spec:
        null,

      intents: [
        "mechanics",
        "resource"
      ]
    };
  }


  // ----------------------------------------------------------
  // RACE
  // ----------------------------------------------------------

  if (
    combined.includes(
      "irk-secimi-horde"
    )
  ) {
    return {
      kind:
        "race",

      faction:
        "horde",

      spec:
        null,

      intents: [
        "race",
        "racial"
      ]
    };
  }


  if (
    combined.includes(
      "irk-secimi-alliance"
    )
  ) {
    return {
      kind:
        "race",

      faction:
        "alliance",

      spec:
        null,

      intents: [
        "race",
        "racial"
      ]
    };
  }


  if (
    combined.includes(
      "irk-secimi"
    )
  ) {
    return {
      kind:
        "race",

      faction:
        null,

      spec:
        null,

      intents: [
        "race",
        "racial"
      ]
    };
  }


  // ----------------------------------------------------------
  // STATS
  // ----------------------------------------------------------

  if (
    combined.includes(
      "ana-statlar"
    )
  ) {
    return {
      kind:
        "primary_stats",

      spec:
        null,

      intents: [
        "stats",
        "primary_stats"
      ]
    };
  }


  if (
    combined.includes(
      "ofansif"
    )
  ) {
    return {
      kind:
        "offensive_stats",

      spec:
        null,

      intents: [
        "stats",
        "offensive_stats",
        "dps_stats"
      ]
    };
  }


  if (
    combined.includes(
      "savunma-statlari"
    ) ||
    combined.includes(
      "defansif-statlar"
    )
  ) {
    return {
      kind:
        "defensive_stats",

      spec:
        null,

      intents: [
        "stats",
        "defensive_stats",
        "tank_stats"
      ]
    };
  }


  if (
    combined.includes(
      "stat-priolari"
    )
  ) {
    return {
      kind:
        "stat_priority",

      spec:
        null,

      intents: [
        "stats",
        "stat_priority"
      ]
    };
  }


  // ----------------------------------------------------------
  // ROTATION / PRIORITY
  // ----------------------------------------------------------

  if (
    combined.includes(
      "holy-healing"
    )
  ) {
    return {
      kind:
        "rotation",

      spec:
        "holy",

      intents: [
        "rotation",
        "healing",
        "priority"
      ]
    };
  }


  if (
    combined.includes(
      "dps-tank-oncelik"
    )
  ) {
    return {
      kind:
        "rotation",

      spec:
        null,

      intents: [
        "rotation",
        "priority",
        "tank",
        "dps"
      ]
    };
  }


  if (
    combined.includes(
      "arms-fury-oncelik"
    )
  ) {
    return {
      kind:
        "rotation",

      spec:
        "arms_fury",

      intents: [
        "rotation",
        "priority",
        "arms",
        "fury"
      ]
    };
  }


  if (
    combined.includes(
      "protection-oncelik"
    )
  ) {
    return {
      kind:
        "rotation",

      spec:
        "protection",

      intents: [
        "rotation",
        "priority",
        "tank"
      ]
    };
  }


  if (
    combined.includes(
      "oynanis-oncelikleri"
    )
  ) {
    return {
      kind:
        "rotation",

      spec:
        null,

      intents: [
        "rotation",
        "priority",
        "gameplay"
      ]
    };
  }


  // ----------------------------------------------------------
  // UTILITY
  // ----------------------------------------------------------

  if (
    combined.includes(
      "utility-savunma"
    )
  ) {
    return {
      kind:
        "utility",

      spec:
        null,

      intents: [
        "utility",
        "defensive",
        "control"
      ]
    };
  }


  if (
    combined.includes(
      "utility-kontrol"
    ) ||
    combined.includes(
      "-utility"
    )
  ) {
    return {
      kind:
        "utility",

      spec:
        null,

      intents: [
        "utility",
        "control",
        "defensive"
      ]
    };
  }


  // ----------------------------------------------------------
  // LEVELING
  // ----------------------------------------------------------

  if (
    combined.includes(
      "leveling-checklist"
    )
  ) {
    return {
      kind:
        "leveling_checklist",

      spec:
        null,

      intents: [
        "leveling",
        "checklist",
        "trainer_level"
      ]
    };
  }


  if (
    combined.includes(
      "leveling-yol-haritasi"
    ) ||
    combined.includes(
      "leveling"
    )
  ) {
    return {
      kind:
        "leveling",

      spec:
        null,

      intents: [
        "leveling",
        "leveling_route"
      ]
    };
  }


  // ----------------------------------------------------------
  // GEAR / PROFESSION
  // ----------------------------------------------------------

  if (
    combined.includes(
      "weapon-gear-meslek"
    )
  ) {
    return {
      kind:
        "gear_profession",

      spec:
        null,

      intents: [
        "gear",
        "weapon",
        "profession"
      ]
    };
  }


  // ----------------------------------------------------------
  // UNKNOWN = ERROR
  // ----------------------------------------------------------

  return {
    kind:
      "unknown",

    spec:
      null,

    intents:
      []
  };
}


// ============================================================
// BUILD SEMANTIC INDEX
// ============================================================

export const GUIDE_SEMANTIC_INDEX =
  CLASS_GUIDE_PAGES
    .map(
      page => ({

        page,

        ...classifyPage(
          page
        ),

        searchText:
          normalizeGuideText(
            [

              page.key,

              page.filename,

              ...(
                page.keywords ||
                []
              ),

              ...(
                page.talents ||
                []
              )
                .map(
                  talent =>
                    `${talent.name} ${talent.tree} ${talent.meta} ${talent.effect} ${talent.tr}`
                )

            ]
              .join(
                " "
              )
          )
      })
    );


// ============================================================
// INDEX DIAGNOSTICS
// ============================================================

export function semanticIndexDiagnostics() {
  const unknown =
    GUIDE_SEMANTIC_INDEX
      .filter(
        entry =>
          entry.kind ===
          "unknown"
      );


  const byKind =
    {};


  const byClass =
    {};


  for (
    const entry
    of GUIDE_SEMANTIC_INDEX
  ) {
    byKind[
      entry.kind
    ] =
      (
        byKind[
          entry.kind
        ] ||
        0
      ) +
      1;


    byClass[
      entry.page.classKey
    ] =
      (
        byClass[
          entry.page.classKey
        ] ||
        0
      ) +
      1;
  }


  return {

    totalPages:
      GUIDE_SEMANTIC_INDEX.length,

    unknownCount:
      unknown.length,

    unknownKeys:
      unknown.map(
        entry =>
          entry.page.key
      ),

    byKind,

    byClass,

    ok:
      unknown.length ===
        0 &&
      GUIDE_SEMANTIC_INDEX.length ===
        CLASS_GUIDE_PAGES.length
  };
}


// ============================================================
// QUERY INTENT DETECTION
// ============================================================

const INTENT_PHRASES = {

  overview: [

    "sinif ozeti",

    "class ozeti",

    "ne yapar",

    "nasil bir class",

    "hangi roller",

    "rolleri",

    "rolu ne"
  ],


  blessing: [

    "blessing",

    "bless",

    "kutsama"
  ],


  aura: [

    "aura",

    "auralari",

    "auralar"
  ],


  seal: [

    "seal",

    "seals",

    "judgement",

    "muhur",

    "mühür"
  ],


  buff: [

    "buff",

    "bufflari",

    "bufflar",

    "grup katkisi",

    "party buff"
  ],


  debuff: [

    "debuff",

    "debufflari",

    "debufflar"
  ],


  mechanics: [

    "mekanik",

    "mekanikler",

    "kaynak sistemi",

    "resource",

    "mana sistemi",

    "rage sistemi",

    "energy sistemi",

    "focus sistemi",

    "stance",

    "combo point"
  ],


  race: [

    "irk",

    "hangi irk",

    "race",

    "racial"
  ],


  primary_stats: [

    "ana stat",

    "primary stat",

    "strength",

    "agility",

    "intellect",

    "stamina",

    "spirit"
  ],


  offensive_stats: [

    "ofansif stat",

    "dps stat",

    "hit",

    "crit",

    "kritik",

    "haste",

    "expertise",

    "attack power",

    "spell power"
  ],


  defensive_stats: [

    "defansif stat",

    "savunma stat",

    "tank stat",

    "armor",

    "dodge",

    "parry",

    "block",

    "resistance"
  ],


  stats: [

    "stat",

    "statlar",

    "stat onceligi",

    "stat priority",

    "hangi stat"
  ],


  talent: [

    "talent",

    "talentleri",

    "talent agaci",

    "talent tree",

    "build",

    "yetenek agaci"
  ],


  rotation: [

    "rotasyon",

    "rotation",

    "oncelik",

    "priority",

    "nasil oynanir",

    "nasıl oynanır",

    "oynanis",

    "taktik",

    "taktikler",

    "dps dongusu",

    "heal dongusu"
  ],


  utility: [

    "utility",

    "interrupt",

    "dispel",

    "cleanse",

    "kontrol",

    "cc",

    "defensive",

    "savunma cooldown",

    "taunt"
  ],


  leveling: [

    "leveling",

    "level kasma",

    "level kasarken",

    "kasma",

    "yol haritasi",

    "1-60",

    "10-20",

    "20-30"
  ],


  checklist: [

    "checklist",

    "hangi seviyede",

    "her level",

    "trainer kontrol"
  ],


  gear: [

    "gear",

    "ekipman",

    "weapon",

    "silah"
  ],


  profession: [

    "meslek",

    "profession"
  ]
};


// ============================================================
// DETECT GUIDE INTENTS
// ============================================================

export function detectGuideIntents(
  question
) {
  const q =
    normalizeGuideText(
      question
    );


  const intents =
    new Set();


  for (
    const [
      intent,
      phrases
    ]
    of Object.entries(
      INTENT_PHRASES
    )
  ) {
    if (
      anyPhrase(
        q,
        phrases
      )
    ) {
      intents.add(
        intent
      );
    }
  }


  /*
    Türkçe ekli kelimeler için ek regex.
  */

  if (
    /\bstat[a-z]*\b|hangi .*stat|stat .*oncel/
      .test(
        q
      )
  ) {
    intents.add(
      "stats"
    );
  }


  if (
    /hangi .*irk|irk .*sec/
      .test(
        q
      )
  ) {
    intents.add(
      "race"
    );
  }


  if (
    /nasil .*oyna|nasıl .*oyna/
      .test(
        q
      )
  ) {
    intents.add(
      "rotation"
    );
  }


  if (
    /hangi .*talent|talent .*ne/
      .test(
        q
      )
  ) {
    intents.add(
      "talent"
    );
  }


  if (
    /buff.*neler|hangi buff/
      .test(
        q
      )
  ) {
    intents.add(
      "buff"
    );
  }


  if (
    /aura.*neler|hangi aura/
      .test(
        q
      )
  ) {
    intents.add(
      "aura"
    );
  }


  if (
    /blessing.*neler|hangi blessing/
      .test(
        q
      )
  ) {
    intents.add(
      "blessing"
    );
  }


  if (
    /seal.*neler|hangi seal/
      .test(
        q
      )
  ) {
    intents.add(
      "seal"
    );
  }


  return [
    ...intents
  ];
}


// ============================================================
// FACTION
// ============================================================

function detectFaction(
  question
) {
  const q =
    normalizeGuideText(
      question
    );


  if (
    phraseIn(
      q,
      "alliance"
    )
  ) {
    return "alliance";
  }


  if (
    phraseIn(
      q,
      "horde"
    )
  ) {
    return "horde";
  }


  return null;
}


// ============================================================
// EXACT TALENT MATCHES
// ============================================================

function exactTalentMatches(
  question,
  classKey
) {
  const q =
    normalizeGuideText(
      question
    );


  const result =
    [];


  for (
    const entry
    of GUIDE_SEMANTIC_INDEX
  ) {
    if (
      entry.kind !==
      "talent"
    ) {
      continue;
    }


    if (
      classKey &&
      entry.page.classKey !==
      classKey
    ) {
      continue;
    }


    for (
      const talent
      of entry.page.talents ||
      []
    ) {
      const name =
        normalizeGuideText(
          talent.name
        );


      if (
        name.length >=
          4 &&
        q.includes(
          name
        )
      ) {
        result.push({

          entry,

          talent
        });
      }
    }
  }


  return result;
}


// ============================================================
// DETERMINISTIC PAGE ROUTING
// ============================================================

function classEntries(
  classKey
) {
  return GUIDE_SEMANTIC_INDEX
    .filter(
      entry =>
        entry.page.classKey ===
        classKey
    );
}


function entriesByKind(
  classKey,
  ...kinds
) {
  return classEntries(
    classKey
  )
    .filter(
      entry =>
        kinds.includes(
          entry.kind
        )
    );
}


function pagesFromEntries(
  entries
) {
  return sortPages(
    uniquePages(
      entries.map(
        entry =>
          entry.page
      )
    )
  );
}


function talentEntriesForSpec(
  classKey,
  specKey
) {
  return classEntries(
    classKey
  )
    .filter(
      entry => {

        if (
          entry.kind !==
          "talent"
        ) {
          return false;
        }


        if (
          !specKey
        ) {
          return true;
        }


        if (
          entry.spec ===
          specKey
        ) {
          return true;
        }


        return (
          entry.page.talents ||
          []
        )
          .some(
            talent =>
              normalizeGuideText(
                talent.tree
              ) ===
              normalizeGuideText(
                specKey
              )
          );
      }
    );
}


// ============================================================
// ROTATION PAGE SELECTION
// ============================================================

function chooseRotationEntries(
  classKey,
  specKey
) {
  const rotations =
    entriesByKind(
      classKey,
      "rotation"
    );


  if (
    !rotations.length
  ) {
    return [];
  }


  // Paladin özel
  if (
    classKey ===
    "paladin"
  ) {

    if (
      specKey ===
      "holy"
    ) {
      return rotations
        .filter(
          entry =>
            entry.spec ===
            "holy"
        );
    }


    if (
      specKey ===
        "protection" ||
      specKey ===
        "retribution"
    ) {
      return rotations
        .filter(
          entry =>
            entry.page.key.includes(
              "dps-tank-oncelik"
            )
        );
    }
  }


  // Warrior özel
  if (
    classKey ===
    "warrior"
  ) {

    if (
      specKey ===
      "protection"
    ) {
      return rotations
        .filter(
          entry =>
            entry.spec ===
            "protection"
        );
    }


    if (
      specKey ===
        "arms" ||
      specKey ===
        "fury"
    ) {
      return rotations
        .filter(
          entry =>
            entry.spec ===
            "arms_fury"
        );
    }
  }


  return rotations;
}


// ============================================================
// STAT PAGE SELECTION
// ============================================================

function chooseStatEntries(
  classKey,
  specKey,
  intents
) {
  const entries =
    [];


  const hasPrimary =
    intents.includes(
      "primary_stats"
    );


  const hasOffensive =
    intents.includes(
      "offensive_stats"
    );


  const hasDefensive =
    intents.includes(
      "defensive_stats"
    );


  const genericStats =
    intents.includes(
      "stats"
    );


  if (
    hasPrimary
  ) {
    entries.push(
      ...entriesByKind(
        classKey,
        "primary_stats"
      )
    );
  }


  if (
    hasOffensive
  ) {
    entries.push(
      ...entriesByKind(
        classKey,
        "offensive_stats"
      )
    );
  }


  if (
    hasDefensive
  ) {
    entries.push(
      ...entriesByKind(
        classKey,
        "defensive_stats"
      )
    );
  }


  if (
    genericStats &&
    !hasPrimary &&
    !hasOffensive &&
    !hasDefensive
  ) {

    entries.push(
      ...entriesByKind(
        classKey,
        "primary_stats"
      )
    );


    if (
      specKey ===
      "protection"
    ) {
      entries.push(
        ...entriesByKind(
          classKey,
          "defensive_stats",
          "stat_priority"
        )
      );

    } else {
      entries.push(
        ...entriesByKind(
          classKey,
          "offensive_stats",
          "stat_priority"
        )
      );
    }
  }


  return entries;
}


// ============================================================
// RESOLVE CLASS GUIDE
// ============================================================

export function resolveClassGuide(
  question
) {
  const normalizedQuestion =
    normalizeGuideText(
      question
    );


  const external =
    detectExternalOnlyIntent(
      normalizedQuestion
    );


  const classKey =
    detectClass(
      normalizedQuestion
    );


  const specKey =
    detectSpec(
      normalizedQuestion,
      classKey
    );


  const faction =
    detectFaction(
      normalizedQuestion
    );


  const intents =
    detectGuideIntents(
      normalizedQuestion
    );


  // ----------------------------------------------------------
  // HARD EXTERNAL ROUTE
  // ----------------------------------------------------------

  if (
    external.externalOnly
  ) {
    return {

      matched:
        false,

      externalOnly:
        true,

      externalKind:
        external.kind,

      reason:
        `external_only:${external.kind}`,

      classKey,

      specKey,

      faction,

      intents,

      pages:
        [],

      confidence:
        1
    };
  }


  if (
    !classKey
  ) {
    return {

      matched:
        false,

      externalOnly:
        false,

      reason:
        "no_class",

      classKey:
        null,

      specKey:
        null,

      faction,

      intents,

      pages:
        [],

      confidence:
        0
    };
  }


  // ----------------------------------------------------------
  // EXACT TALENT NAME
  // ----------------------------------------------------------

  const exactTalents =
    exactTalentMatches(
      normalizedQuestion,
      classKey
    );


  if (
    exactTalents.length
  ) {
    const pages =
      pagesFromEntries(
        exactTalents.map(
          item =>
            item.entry
        )
      );


    return {

      matched:
        true,

      externalOnly:
        false,

      reason:
        "exact_talent",

      classKey,

      specKey:
        specKey ||
        exactTalents[0]
          ?.talent
          ?.tree ||
        null,

      faction,

      intents:
        intents.length
          ? intents
          : [
              "talent"
            ],

      pages,

      confidence:
        1,

      exactTalents:
        exactTalents
          .map(
            item =>
              item.talent.name
          )
    };
  }


  // ----------------------------------------------------------
  // SELECT PAGES
  // ----------------------------------------------------------

  const selected =
    [];


  // ----------------------------------------------------------
  // PALADIN BUFFS
  //
  // Buff ≠ Seal.
  // ----------------------------------------------------------

  if (
    classKey ===
    "paladin"
  ) {

    if (
      intents.includes(
        "blessing"
      )
    ) {
      selected.push(
        ...entriesByKind(
          classKey,
          "blessings"
        )
      );
    }


    if (
      intents.includes(
        "aura"
      )
    ) {
      selected.push(
        ...entriesByKind(
          classKey,
          "auras"
        )
      );
    }


    if (
      intents.includes(
        "seal"
      )
    ) {
      selected.push(
        ...entriesByKind(
          classKey,
          "seals"
        )
      );
    }


    if (
      intents.includes(
        "buff"
      ) &&
      !intents.includes(
        "blessing"
      ) &&
      !intents.includes(
        "aura"
      ) &&
      !intents.includes(
        "seal"
      )
    ) {
      selected.push(
        ...entriesByKind(
          classKey,
          "blessings",
          "auras"
        )
      );
    }

  } else {

    if (
      intents.includes(
        "buff"
      ) ||
      intents.includes(
        "debuff"
      )
    ) {
      selected.push(
        ...entriesByKind(
          classKey,
          "buff_debuff"
        )
      );
    }
  }


  // ----------------------------------------------------------
  // MECHANICS
  // ----------------------------------------------------------

  if (
    intents.includes(
      "mechanics"
    )
  ) {
    selected.push(
      ...entriesByKind(
        classKey,
        "mechanics"
      )
    );
  }


  // ----------------------------------------------------------
  // RACE
  // ----------------------------------------------------------

  if (
    intents.includes(
      "race"
    )
  ) {
    let raceEntries =
      entriesByKind(
        classKey,
        "race"
      );


    if (
      faction
    ) {
      raceEntries =
        raceEntries.filter(
          entry =>
            !entry.faction ||
            entry.faction ===
            faction
        );
    }


    selected.push(
      ...raceEntries
    );
  }


  // ----------------------------------------------------------
  // STATS
  // ----------------------------------------------------------

  if (
    intents.some(
      intent =>
        [
          "stats",
          "primary_stats",
          "offensive_stats",
          "defensive_stats"
        ]
          .includes(
            intent
          )
    )
  ) {
    selected.push(
      ...chooseStatEntries(
        classKey,
        specKey,
        intents
      )
    );
  }


  // ----------------------------------------------------------
  // TALENTS
  // ----------------------------------------------------------

  if (
    intents.includes(
      "talent"
    )
  ) {
    selected.push(
      ...talentEntriesForSpec(
        classKey,
        specKey
      )
    );
  }


  // ----------------------------------------------------------
  // ROTATION / TACTICS
  // ----------------------------------------------------------

  if (
    intents.includes(
      "rotation"
    )
  ) {
    selected.push(
      ...chooseRotationEntries(
        classKey,
        specKey
      )
    );


    /*
      Tank / taktik / savunma sorusunda
      utility sayfası da anlamlıdır.
    */

    if (
      /tank|taktik|savunma|defensive|utility|interrupt|kontrol/
        .test(
          normalizedQuestion
        )
    ) {
      selected.push(
        ...entriesByKind(
          classKey,
          "utility"
        )
      );
    }
  }


  // ----------------------------------------------------------
  // UTILITY
  // ----------------------------------------------------------

  if (
    intents.includes(
      "utility"
    )
  ) {
    selected.push(
      ...entriesByKind(
        classKey,
        "utility"
      )
    );
  }


  // ----------------------------------------------------------
  // LEVELING
  // ----------------------------------------------------------

  if (
    intents.includes(
      "leveling"
    ) ||
    intents.includes(
      "checklist"
    )
  ) {
    selected.push(
      ...entriesByKind(
        classKey,
        "leveling"
      )
    );


    /*
      Paladin katalogunda ayrı checklist var.
    */

    if (
      intents.includes(
        "checklist"
      ) ||
      classKey ===
      "paladin"
    ) {
      selected.push(
        ...entriesByKind(
          classKey,
          "leveling_checklist"
        )
      );
    }


    if (
      specKey &&
      intents.includes(
        "talent"
      )
    ) {
      selected.push(
        ...talentEntriesForSpec(
          classKey,
          specKey
        )
      );
    }
  }


  // ----------------------------------------------------------
  // GEAR
  // ----------------------------------------------------------

  if (
    intents.includes(
      "gear"
    )
  ) {
    selected.push(
      ...entriesByKind(
        classKey,
        "gear_profession"
      )
    );
  }


  // ----------------------------------------------------------
  // PROFESSION
  //
  // Meslek sistemi global özel rehberdir.
  // Class guide bunu çalmaz.
  // ----------------------------------------------------------

  if (
    intents.includes(
      "profession"
    ) &&
    !intents.includes(
      "gear"
    )
  ) {
    return {

      matched:
        false,

      externalOnly:
        false,

      reason:
        "global_profession_topic",

      classKey,

      specKey,

      faction,

      intents,

      pages:
        [],

      confidence:
        1
    };
  }


  const pages =
    pagesFromEntries(
      selected
    );


  if (
    pages.length
  ) {
    return {

      matched:
        true,

      externalOnly:
        false,

      reason:
        "deterministic_intent_map",

      classKey,

      specKey,

      faction,

      intents,

      pages,

      confidence:
        0.99
    };
  }


  // ----------------------------------------------------------
  // OVERVIEW
  //
  // SADECE gerçekten class özeti sorulursa.
  //
  // Görev sorusunda buraya düşüp random 01-sınıf özeti
  // gönderme davranışı artık yok.
  // ----------------------------------------------------------

  if (
    intents.includes(
      "overview"
    ) ||
    /^(druid|hunter|mage|paladin|priest|rogue|shaman|warlock|warrior)$/
      .test(
        normalizedQuestion
      )
  ) {
    const overview =
      pagesFromEntries(
        entriesByKind(
          classKey,
          "class_overview"
        )
      );


    return {

      matched:
        overview.length >
        0,

      externalOnly:
        false,

      reason:
        "explicit_overview",

      classKey,

      specKey,

      faction,

      intents,

      pages:
        overview,

      confidence:
        0.95
    };
  }


  // ----------------------------------------------------------
  // UNKNOWN CLASS QUESTION
  //
  // Burada görsel YOK.
  // Backend araştırır.
  // ----------------------------------------------------------

  return {

    matched:
      false,

    externalOnly:
      false,

    reason:
      "class_present_but_no_supported_guide_intent",

    classKey,

    specKey,

    faction,

    intents,

    pages:
      [],

    confidence:
      0
  };
}


// ============================================================
// EXTERNAL RESEARCH QUESTION
//
// Görev sorusunu Tavily/backend'e daha açık anlatır.
// ============================================================

export function buildExternalResearchQuestion(
  question,
  resolution
) {
  const className =
    resolution?.classKey ||
    detectClass(
      question
    ) ||
    "belirtilmemiş sınıf";


  const faction =
    resolution?.faction ||
    detectFaction(
      question
    );


  const kind =
    resolution
      ?.externalKind ||
    detectExternalOnlyIntent(
      question
    ).kind;


  // ----------------------------------------------------------
  // CLASS QUEST
  // ----------------------------------------------------------

  if (
    kind ===
    "class_quest_or_quest"
  ) {
    return [

      question,

      "",

      "Bu soru özellikle class quest / sınıf görevi araştırmasıdır.",

      `Sınıf: ${className}.`,

      faction
        ? `Taraf: ${faction}.`
        : "",

      "WoW Forever'a özgü güvenilir kaynak varsa onu önceliklendir; yoksa uygun Classic kaynaklarıyla açıkça fallback yap.",

      "Kaçırılmaması gereken sınıf görevlerini görev adı + yaklaşık seviye + başlangıç yeri/NPC + önemli ödül veya açılan yetenek açısından araştır.",

      "Sınıf görevi ile ilgisiz skill/buff listesini doldurma.",

      "Kullanıcının sorusu görev ise class overview, buff, talent veya skill listesiyle cevap verme.",

      "Eğer bu sürümde zorunlu/özel class quest olmadığını gösteren güvenilir kaynak varsa bunu net söyle; uydurma görev üretme."

    ]
      .filter(
        Boolean
      )
      .join(
        "\n"
      );
  }


  // ----------------------------------------------------------
  // LOCATION / ACQUISITION
  // ----------------------------------------------------------

  if (
    kind ===
      "trainer_location" ||
    kind ===
      "acquisition_or_location"
  ) {
    return [

      question,

      "",

      "Bu soru edinim/lokasyon araştırmasıdır.",

      "Tam olarak nereden, hangi NPC'den, hangi bölgede veya hangi yöntemle elde edildiğini araştır.",

      "WoW Forever kaynağı varsa önce onu kullan; yoksa sürüm farkını açıkça belirt."

    ]
      .join(
        "\n"
      );
  }


  return question;
}


// ============================================================
// STRUCTURED TALENT CONTEXT
// ============================================================

export function buildStructuredGuideContext(
  resolution
) {
  const blocks =
    [];


  for (
    const page
    of resolution?.pages ||
    []
  ) {
    const talents =
      page.talents ||
      [];


    if (
      !talents.length
    ) {
      continue;
    }


    const lines = [

      `KONU: ${page.key.replace(/^.*?\./, "")}`
    ];


    for (
      const talent
      of talents
    ) {
      lines.push(

        `- ${talent.name} | tree=${talent.tree || "unknown"} | ${talent.meta || ""}`,

        `  ${
          String(
            talent.tr ||
            ""
          ).trim() ||
          String(
            talent.effect ||
            ""
          ).trim()
        }`
      );
    }


    blocks.push(
      lines.join(
        "\n"
      )
    );
  }


  return blocks.join(
    "\n\n"
  );
}


// ============================================================
// ATTACHMENT MATCHING
// ============================================================

export function canonicalFilename(
  value
) {
  let name =
    String(
      value ||
      ""
    )
      .split(
        /[\\/]/
      )
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
    name.lastIndexOf(
      "."
    );


  const ext =
    dot >=
      0
      ? name.slice(
          dot
        )
      : "";


  const stem =
    dot >=
      0
      ? name.slice(
          0,
          dot
        )
      : name;


  const cleanStem =
    normalizeGuideText(
      stem
    )

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


  return (
    `${cleanStem}${ext}`
  );
}


function ordinalFromFilename(
  value
) {
  const match =
    canonicalFilename(
      value
    )
      .match(
        /^(\d+)/
      );


  return match
    ? Number(
        match[1]
      )
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
    Array.isArray(
      attachments
    )
      ? attachments
      : [];


  const exact =
    list.find(
      item =>
        canonicalFilename(
          item?.filename
        ) ===
        expected
    );


  if (
    exact
  ) {
    return {
      attachment:
        exact,

      matchMode:
        "filename"
    };
  }


  const expectedOrdinal =
    ordinalFromFilename(
      page.filename
    );


  const expectedMeaning =
    expected
      .replace(
        /^\d+-/,
        ""
      )
      .replace(
        /\.\w+$/,
        ""
      );


  const candidates =
    list
      .filter(
        item => {

          const actual =
            canonicalFilename(
              item?.filename
            );


          if (
            expectedOrdinal !=
              null &&
            ordinalFromFilename(
              actual
            ) !==
            expectedOrdinal
          ) {
            return false;
          }


          const actualMeaning =
            actual
              .replace(
                /^\d+-/,
                ""
              )
              .replace(
                /\.\w+$/,
                ""
              );


          return (
            actualMeaning.includes(
              expectedMeaning
            ) ||
            expectedMeaning.includes(
              actualMeaning
            )
          );
        }
      );


  return (
    candidates.length ===
    1
  )
    ? {
        attachment:
          candidates[0],

        matchMode:
          "ordinal_stem"
      }
    : {
        attachment:
          null,

        matchMode:
          "none"
      };
}


// ============================================================
// MESSAGE IDS
// ============================================================

export function expectedBatchMessageIds(
  classKey
) {
  return [
    ...(
      GUIDE_BATCH_MESSAGE_IDS[
        classKey
      ] ||
      []
    )
  ];
}


// ============================================================
// CATALOG DIAGNOSTICS
// ============================================================

export function catalogDiagnostics() {
  const pageCounts =
    {};


  const talentCounts =
    {};


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
        ] ||
        0
      ) +
      1;


    talentCounts[
      page.classKey
    ] =
      (
        talentCounts[
          page.classKey
        ] ||
        0
      ) +
      (
        page.talents ||
        []
      ).length;
  }


  return {

    guideImageChannelId:
      GUIDE_IMAGE_CHANNEL_ID,

    totalPages:
      CLASS_GUIDE_PAGES.length,

    classes:
      Object.keys(
        GUIDE_BATCH_MESSAGE_IDS
      ),

    pageCounts,

    talentCounts,

    semantic:
      semanticIndexDiagnostics()
  };
}
