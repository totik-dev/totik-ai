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
// Her 10 saniyede sadece yeni mesaj var mı diye Discord REST'e bakar.
const POLL_INTERVAL_MS = 10 * 1000;

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
// TOTIK GUIDE / GUILD ROUTING
// ============================================================

const GUIDE_CHANNEL_ID =
  "1549395522689966190";

const GUILD_INFO_CHANNEL_ID =
  "1549847008406143157";

const ADMIN_COOLDOWN_BYPASS_USER_IDS =
  new Set([
    "194062355460653056"
  ]);

const TOTIK_GUIDE_BUILD =
  "2026-09-25-guides-v2";

// Görsellerin bulunduğu sabit kaynak mesajları.
// Bot eski mesajı forward etmez; yalnızca o mesajdaki attachment'ı alır.
const GUIDE_IMAGE_MESSAGE_IDS = {
  profession:
    "1553090607482798253",

  camping:
    "1553095278234701906",

  legacy:
    "1553095337416335400"
};

const GUIDE_REMINDER_MESSAGE =
  `Bu konu hakkında Totik Channel'da rehber video var, <#${GUIDE_CHANNEL_ID}> kanalından detaylı bakabilirsin.`;

const GUILD_INFO_MESSAGE =
  `Totik Channel ekibi WoW Forever'da Normal ruleset'te Alliance tarafında oynuyor. Guild katılımı, şartlar ve güncel detaylar için <#${GUILD_INFO_CHANNEL_ID}> kanalına bakabilirsin.`;

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

function compareSnowflakes(a, b) {
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

    if (aa < bb) {
      return -1;
    }

    if (aa > bb) {
      return 1;
    }

    return 0;

  } catch {
    return String(
      a?.id ||
      ""
    ).localeCompare(
      String(
        b?.id ||
        ""
      )
    );
  }
}

function splitDiscordMessage(value) {
  let text =
    String(
      value ||
      ""
    ).trim();

  if (!text) {
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

    if (
      cut <
      800
    ) {
      cut =
        text.lastIndexOf(
          " ",
          MAX_DISCORD_MESSAGE
        );
    }

    if (
      cut <
      800
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

  if (text) {
    chunks.push(
      text
    );
  }

  return chunks;
}

function tidyAnswer(value) {
  let text =
    String(
      value ||
      ""
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

  text =
    text
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

  const possibleCuts = [
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
      ...possibleCuts
    );

  if (
    cut <
    800
  ) {
    cut =
      MAX_ANSWER_CHARS;

  } else {
    cut +=
      1;
  }

  return (
    text
      .slice(
        0,
        cut
      )
      .trim() +
    "…"
  );
}

function isIdentityQuestion(question) {
  const q =
    String(
      question ||
      ""
    )
      .toLocaleLowerCase(
        "tr-TR"
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
      "kim geliştirdi"
    ) ||

    q.includes(
      "kim yaptı seni"
    ) ||

    q.includes(
      "hangi kanal için geliştirildin"
    )
  );
}

function isChannelRecommendationQuestion(
  question
) {
  const q =
    String(
      question ||
      ""
    )
      .toLocaleLowerCase(
        "tr-TR"
      );

  const asksChannel =
    q.includes(
      "kanal"
    ) ||

    q.includes(
      "youtube"
    ) ||

    q.includes(
      "youtuber"
    ) ||

    q.includes(
      "yayıncı"
    ) ||

    q.includes(
      "streamer"
    ) ||

    q.includes(
      "içerik üretici"
    );

  const asksRecommendation =
    q.includes(
      "öner"
    ) ||

    q.includes(
      "öneri"
    ) ||

    q.includes(
      "tavsiye"
    ) ||

    q.includes(
      "izleyeyim"
    ) ||

    q.includes(
      "izlemeliyim"
    ) ||

    q.includes(
      "takip edeyim"
    ) ||

    q.includes(
      "takip etmeliyim"
    );

  return (
    asksChannel &&
    asksRecommendation
  );
}

function normalizeLocal(value) {
  return String(
    value ||
    ""
  )
    .toLocaleLowerCase(
      "tr-TR"
    )
    .replace(
      /[’‘`´]/g,
      "'"
    )
    .replace(
      /ı/g,
      "i"
    )
    .replace(
      /ğ/g,
      "g"
    )
    .replace(
      /ü/g,
      "u"
    )
    .replace(
      /ş/g,
      "s"
    )
    .replace(
      /ö/g,
      "o"
    )
    .replace(
      /ç/g,
      "c"
    )
    .replace(
      /[^a-z0-9'\-\s]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

// ============================================================
// TOTIK CHANNEL CURATED FOREVER GUIDE DATA
//
// Bu üç rehber verisi runtime'da lokal ve ücretsiz.
// Cevap burada varsa Tavily/Gemini ÇALIŞMAZ.
// Burada yoksa mevcut normal araştırma sistemi devam eder.
// ============================================================

const CURATED_PROFESSION_ROADMAP = {
  warrior: {
    label:
      "Warrior",

    specs: {
      arms: [
        "Arms",
        "Mining + Blacksmithing",
        "Blacksmithing + Engineering"
      ],

      fury: [
        "Fury",
        "Mining + Blacksmithing",
        "Blacksmithing + Engineering"
      ],

      protection: [
        "Protection",
        "Mining + Engineering",
        "Blacksmithing + Engineering"
      ]
    }
  },

  hunter: {
    label:
      "Hunter",

    specs: {
      beast_mastery: [
        "Beast Mastery",
        "Skinning + Leatherworking",
        "Leatherworking + Engineering"
      ],

      marksmanship: [
        "Marksmanship",
        "Skinning + Leatherworking",
        "Leatherworking + Engineering"
      ],

      survival: [
        "Survival",
        "Skinning + Leatherworking",
        "Leatherworking + Engineering"
      ]
    }
  },

  mage: {
    label:
      "Mage",

    specs: {
      arcane: [
        "Arcane",
        "Tailoring + Enchanting",
        "Tailoring + Engineering"
      ],

      fire: [
        "Fire",
        "Tailoring + Enchanting",
        "Tailoring + Engineering"
      ],

      frost: [
        "Frost",
        "Tailoring + Enchanting",
        "Tailoring + Engineering"
      ]
    }
  },

  rogue: {
    label:
      "Rogue",

    specs: {
      assassination: [
        "Assassination",
        "Skinning + Leatherworking",
        "Leatherworking + Engineering"
      ],

      combat: [
        "Combat",
        "Skinning + Leatherworking",
        "Leatherworking + Engineering"
      ],

      subtlety: [
        "Subtlety",
        "Skinning + Leatherworking",
        "Leatherworking + Engineering"
      ]
    }
  },

  priest: {
    label:
      "Priest",

    specs: {
      discipline: [
        "Discipline",
        "Herbalism + Alchemy",
        "Alchemy + Enchanting"
      ],

      holy: [
        "Holy",
        "Herbalism + Alchemy",
        "Alchemy + Enchanting"
      ],

      shadow: [
        "Shadow",
        "Herbalism + Alchemy",
        "Alchemy + Engineering"
      ]
    }
  },

  warlock: {
    label:
      "Warlock",

    specs: {
      affliction: [
        "Affliction",
        "Tailoring + Enchanting",
        "Tailoring + Engineering"
      ],

      demonology: [
        "Demonology",
        "Tailoring + Enchanting",
        "Tailoring + Engineering"
      ],

      destruction: [
        "Destruction",
        "Tailoring + Enchanting",
        "Tailoring + Engineering"
      ]
    }
  },

  paladin: {
    label:
      "Paladin",

    specs: {
      holy: [
        "Holy",
        "Herbalism + Alchemy",
        "Alchemy + Engineering"
      ],

      protection: [
        "Protection",
        "Mining + Engineering",
        "Blacksmithing + Engineering"
      ],

      retribution: [
        "Retribution",
        "Mining + Blacksmithing",
        "Blacksmithing + Engineering"
      ]
    }
  },

  druid: {
    label:
      "Druid",

    specs: {
      balance: [
        "Balance",
        "Herbalism + Alchemy",
        "Alchemy + Leatherworking"
      ],

      feral_dps: [
        "Feral DPS",
        "Mining + Engineering",
        "Engineering + Alchemy"
      ],

      feral_tank: [
        "Feral Tank",
        "Mining + Engineering",
        "Engineering + Leatherworking"
      ],

      restoration: [
        "Restoration",
        "Herbalism + Alchemy",
        "Alchemy + Engineering"
      ]
    }
  },

  shaman: {
    label:
      "Shaman",

    specs: {
      elemental: [
        "Elemental",
        "Skinning + Leatherworking",
        "Leatherworking + Enchanting"
      ],

      enhancement: [
        "Enhancement",
        "Skinning + Leatherworking",
        "Leatherworking + Alchemy"
      ],

      restoration: [
        "Restoration",
        "Skinning + Leatherworking",
        "Leatherworking + Enchanting"
      ]
    }
  }
};

const CURATED_CAMPING = [
  {
    profession:
      "Alchemy",

    aliases: [
      "alchemy",
      "simya",
      "mana well"
    ],

    object:
      "Mana Well",

    benefit:
      "+29 Mana / 5 sn",

    conflict:
      "Blessing of Wisdom",

    advanced:
      "Fermenter → özel reagent üretimi; Alchemy Laboratory → özel tarifler."
  },

  {
    profession:
      "Blacksmithing",

    aliases: [
      "blacksmithing",
      "demircilik",
      "sharpening wheel"
    ],

    object:
      "Sharpening Wheel",

    benefit:
      "+34 Strength",

    conflict:
      "Strength of Earth Totem",

    advanced:
      "Anvil → kullanılabilir örs; Master Forge → özel forge tarifleri."
  },

  {
    profession:
      "Enchanting",

    aliases: [
      "enchanting",
      "enchant",
      "enchanted lute"
    ],

    object:
      "Enchanted Lute",

    benefit:
      "+308 Armor, +13 tüm statlar, +22 tüm resistance",

    conflict:
      "Mark of the Wild",

    advanced:
      "Arcane Salvager → verimli disenchant; Arcane Forge → özel tarifler."
  },

  {
    profession:
      "Engineering",

    aliases: [
      "engineering",
      "muhendislik",
      "reagent bot"
    ],

    object:
      "Reagent Bot",

    benefit:
      "Reagent vendor açar; stat buff vermez",

    conflict:
      "Yok",

    advanced:
      "Repair Bot → vendor + repair; Anarchist's Workbench → özel tarifler."
  },

  {
    profession:
      "Herbalism",

    aliases: [
      "herbalism",
      "herb",
      "bitkicilik",
      "incense candle"
    ],

    object:
      "Incense Candle",

    benefit:
      "+25 Intellect",

    conflict:
      "Arcane Intellect",

    advanced:
      "Greenhouse → seed ek, zamanla herb yetiştirir; Seed Hybridizer → seed çoğaltır / birleştirir."
  },

  {
    profession:
      "Leatherworking",

    aliases: [
      "leatherworking",
      "lw",
      "dericilik",
      "camp tent",
      "tent"
    ],

    object:
      "Camp Tent",

    benefit:
      "Rested XP bonusu vermez; mevcut rested XP'yi level'in %5'ine kadar doldurur",

    conflict:
      "Yok",

    advanced:
      "Tanning Rack → özel reagent; Sewing Machine → özel Leatherworking tarifleri."
  },

  {
    profession:
      "Mining",

    aliases: [
      "mining",
      "madencilik",
      "lodestone"
    ],

    object:
      "Lodestone",

    benefit:
      "+90 melee Attack Power",

    conflict:
      "Blessing of Might",

    advanced:
      "Rock Garden → zamanla common mining node; Molten Foundry → özel tarifler."
  },

  {
    profession:
      "Skinning",

    aliases: [
      "skinning",
      "deri yuzme",
      "camp chair",
      "chair"
    ],

    object:
      "Camp Chair",

    benefit:
      "+2% kritik vuruş (melee + spell crit)",

    conflict:
      "Moonkin Aura",

    advanced:
      "Field Guide → Track Beasts; Trapper's Workbench → 1 trap."
  },

  {
    profession:
      "Tailoring",

    aliases: [
      "tailoring",
      "terzilik",
      "faction banner",
      "banner"
    ],

    object:
      "Faction Banner",

    benefit:
      "+32 Spirit",

    conflict:
      "Divine Spirit",

    advanced:
      "Spinning Wheel → özel reagent; Loom → özel Tailoring tarifleri."
  },

  {
    profession:
      "First Aid",

    aliases: [
      "first aid",
      "ilkyardim",
      "ilk yardim",
      "first aid kit"
    ],

    object:
      "First Aid Kit",

    benefit:
      "+56 Stamina",

    conflict:
      "Power Word: Fortitude",

    advanced:
      "Toxin Study → healing potion + antivenom; Plague Doctor's Lab → healing potion + poultice."
  },

  {
    profession:
      "Fishing",

    aliases: [
      "fishing",
      "balikcilik",
      "fish bowl"
    ],

    object:
      "Fish Bowl",

    benefit:
      "+8% tüm statlar",

    conflict:
      "Blessing of Kings",

    advanced:
      "Fishing Rack → 1 saat uncommon fish + lure; Fishing Hut → 1 saat rare fish + lure."
  },

  {
    profession:
      "Cooking",

    aliases: [
      "cooking",
      "ascilik",
      "basic campfire",
      "campfire"
    ],

    object:
      "Basic Campfire",

    benefit:
      "Kampı kurar; 3 özellik slotu açar",

    conflict:
      "Yok",

    advanced:
      "Journeyman Campfire → 5 özellik; Expert Campfire → 10 özellik; Iron Oven → ileri tarifler."
  }
];

const CURATED_LEGACY = {
  totals: {
    obtainable:
      65,

    perCharacterSpend:
      16,

    trees:
      3,

    knownPerks:
      21
  },

  sources: [
    [
      "Class Leveling",
      27,
      "9 class için Lv25 / Lv45 / Lv60 ilk kez"
    ],

    [
      "Crafting Meslekleri",
      18,
      "6 crafting mesleği için 150 / 225 / 300: Alchemy, Blacksmithing, Enchanting, Engineering, Leatherworking, Tailoring"
    ],

    [
      "PvP / BG",
      12,
      "Rank 3 / 7 / 10 / 13 / 14 + 4 BG Exalted + Fields of Glory 4 / 7 / 10"
    ],

    [
      "Adventure",
      2,
      "Explore Azeroth + Lord Valthalak görev zinciri"
    ],

    [
      "Dungeonlar",
      3,
      "15–25 / 26–45 / 46–60 dungeon setlerini tamamlama"
    ],

    [
      "Raidler",
      3,
      "Onyxia + Hyjal Summit + Barrow Deeps"
    ]
  ],

  milestones: [
    [
      15,
      "Replica Ironforge Air Rifle"
    ],

    [
      25,
      "Spectral Bear Cub"
    ],

    [
      40,
      "Spectral Bear Tabard"
    ],

    [
      55,
      "Reins of the Spectral Bear"
    ]
  ],

  trees: {
    professions:
      "Meslek ilerlemesi, gathering verimi, crafting ekonomisi ve fishing/cooking desteği.",

    adventure:
      "Leveling, kamp, keşif, seyahat ve açık dünya utility perkleri.",

    resourcefulness:
      "Honor, reputation, bakım, buff süresi ve reagent/ölüm ekonomisi avantajları."
  },

  perks: [
    [
      "Working Overtime",
      5,
      "Professions",
      "Primary, secondary ve class tradeskill'lerde skill-up şansını artırır."
    ],

    [
      "Bountiful Harvest",
      5,
      "Professions",
      "Mining / Herbalism / Skinning'den gelen scarce material miktarını artırır."
    ],

    [
      "Master Chef",
      5,
      "Professions",
      "Cooking tariflerinde ekstra ürün çıkarma şansı verir."
    ],

    [
      "Bartering",
      2,
      "Professions",
      "Vendor fiyatlarını düşürür."
    ],

    [
      "Performance Bonus",
      3,
      "Professions",
      "Supply crate turn-in'lerinde ekstra Merchant's Favor şansı verir."
    ],

    [
      "Luremaster",
      2,
      "Professions",
      "Fishing lure kullanırken ekstra balık yakalama şansını artırır."
    ],

    [
      "Dedicated Study",
      1,
      "Professions",
      "En düşük primary/secondary tradeskill'i yükselten günlük etki."
    ],

    [
      "Well Rested",
      5,
      "Adventure",
      "Rested XP birikimini ve rested cap'i artırır."
    ],

    [
      "Thrill of Adventure",
      5,
      "Adventure",
      "Killing blow sonrası kısa süre HP/Mana yeniler."
    ],

    [
      "High Alert",
      2,
      "Adventure",
      "Stealth tespitini karakter seviyesi +1 / +2 yükselmiş gibi artırır; battleground'da çalışmaz."
    ],

    [
      "Talented",
      1,
      "Adventure",
      "Talent point kazanımını daha erken başlatır."
    ],

    [
      "Field Guide",
      3,
      "Adventure",
      "Camp feature ekleme cooldown'unu azaltır."
    ],

    [
      "Field Medicine",
      2,
      "Adventure",
      "Recently Bandaged süresini azaltır."
    ],

    [
      "Frequent Flier",
      1,
      "Adventure",
      "Flight path'leri daha ucuz ve daha hızlı yapar."
    ],

    [
      "The Quick and the Dead",
      2,
      "Resourcefulness",
      "Ölüyken hareket hızını artırır; dirilince kısa süre kaynak harcamazsın."
    ],

    [
      "Reinforce",
      5,
      "Resourcefulness",
      "Ölümde durability kaybını azaltır."
    ],

    [
      "Gourmand",
      3,
      "Resourcefulness",
      "Food bufflarının süresini artırır."
    ],

    [
      "For Great Honor",
      5,
      "Resourcefulness",
      "Honor kazanımını artırır."
    ],

    [
      "Permanence",
      2,
      "Resourcefulness",
      "Uzun süreli stat bufflarını ve camp faydalarını daha uzun sürdürür."
    ],

    [
      "Diplomat",
      5,
      "Resourcefulness",
      "Rep süreli kazanımını artırır."
    ],

    [
      "Reagent Economy",
      1,
      "Resourcefulness",
      "Vendor reagent gerektiren class yetenekleri ve Tier 1 camp reagent maliyetlerini kaldırır."
    ]
  ]
};

const CLASS_ALIASES = {
  warrior: [
    "warrior",
    "savasci"
  ],

  hunter: [
    "hunter",
    "avci"
  ],

  mage: [
    "mage",
    "buyucu"
  ],

  rogue: [
    "rogue",
    "haydut"
  ],

  priest: [
    "priest",
    "rahip"
  ],

  warlock: [
    "warlock"
  ],

  paladin: [
    "paladin",
    "pala"
  ],

  druid: [
    "druid"
  ],

  shaman: [
    "shaman",
    "saman"
  ]
};

const SPEC_ALIASES = {
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
  },

  hunter: {
    beast_mastery: [
      "beast mastery",
      "beastmastery",
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

  priest: {
    discipline: [
      "discipline",
      "disc"
    ],

    holy: [
      "holy"
    ],

    shadow: [
      "shadow"
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

  paladin: {
    holy: [
      "holy"
    ],

    protection: [
      "protection",
      "prot",
      "tank"
    ],

    retribution: [
      "retribution",
      "retri",
      "ret"
    ]
  },

  druid: {
    balance: [
      "balance",
      "boomkin",
      "moonkin"
    ],

    feral_dps: [
      "feral dps",
      "cat",
      "kedi"
    ],

    feral_tank: [
      "feral tank",
      "bear",
      "ayi"
    ],

    restoration: [
      "restoration",
      "resto"
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
      "resto"
    ]
  }
};

// ============================================================
// CURATED ANSWER ROUTER
// ============================================================

function tryCuratedForeverAnswer(question) {
  const q =
    normalizeLocal(
      question
    );

  const legacy =
    buildCuratedLegacyAnswer(
      q
    );

  if (legacy) {
    return {
      topic:
        "legacy",

      answer:
        legacy
    };
  }

  const camping =
    buildCuratedCampingAnswer(
      q
    );

  if (camping) {
    return {
      topic:
        "camping",

      answer:
        camping
    };
  }

  const profession =
    buildCuratedProfessionAnswer(
      q
    );

  if (profession) {
    return {
      topic:
        "profession",

      answer:
        profession
    };
  }

  return null;
}

// ============================================================
// PROFESSION ANSWER
// ============================================================

function buildCuratedProfessionAnswer(q) {
  const hasProfessionWord =
    /(\bmesle(?:k|g)[a-z]*\b|\bprofession[a-z]*\b)/.test(
      q
    );

  if (
    !hasProfessionWord
  ) {
    return null;
  }

  // Yol haritasında trainer / tarif / konum / materyal yok.
  if (
    /trainer|egitmen|recipe|tarif|material|materyal|nerede|nerden|nereden|nasil alinir|nasil alirim|nasil ogren/.test(
      q
    )
  ) {
    return null;
  }

  const choiceIntent =
    /hangi meslek|meslek sec|meslek oner|meslek tavsiye|meslek kombin|profession choice|best profession|leveling|fresh|lategame|late game/.test(
      q
    );

  const classKey =
    findClassKey(
      q
    );

  if (
    !choiceIntent &&
    !classKey
  ) {
    return null;
  }

  if (
    !classKey
  ) {
    return [
      "Totik Channel meslek yol haritasında seçim class/spec'e göre yapılıyor.",
      "Class ve spec'ini yazarsan tablodaki net Leveling/Fresh → Lategame kombinasyonunu söyleyebilirim.",
      "Lategame geçişi 60 olur olmaz değil, 60 sonrası yeterli ekonomiye sahip olduktan sonra öneriliyor."
    ].join(
      "\n"
    );
  }

  const classData =
    CURATED_PROFESSION_ROADMAP[
      classKey
    ];

  const specKey =
    findSpecKey(
      q,
      classKey
    );

  if (
    specKey &&
    classData
      .specs[
        specKey
      ]
  ) {
    const [
      label,
      fresh,
      late
    ] =
      classData
        .specs[
          specKey
        ];

    return (
      `**${classData.label} – ${label}** için öneri:\n` +
      `• Leveling / Fresh: **${fresh}**\n` +
      `• Lategame: **${late}**\n\n` +
      "Lategame geçişini 60 olur olmaz değil, 60 sonrası yeterli ekonomiye sahip olduktan sonra yapmak öneriliyor."
    );
  }

  const rows =
    Object.values(
      classData.specs
    );

  const uniquePaths =
    new Set(
      rows.map(
        row =>
          `${row[1]}|||${row[2]}`
      )
    );

  if (
    uniquePaths.size ===
    1
  ) {
    const [
      ,
      fresh,
      late
    ] =
      rows[0];

    return (
      `**${classData.label}** için tüm spec'lerde öneri aynı:\n` +
      `• Leveling / Fresh: **${fresh}**\n` +
      `• Lategame: **${late}**\n\n` +
      "Lategame geçişini 60 olur olmaz değil, 60 sonrası yeterli ekonomiye sahip olduktan sonra yapmak öneriliyor."
    );
  }

  const lines =
    rows.map(
      (
        [
          label,
          fresh,
          late
        ]
      ) =>
        `• ${label}: **${fresh}** → **${late}**`
    );

  return (
    `**${classData.label}** için spec'e göre meslek yol haritası:\n` +
    lines.join(
      "\n"
    ) +
    "\n\nOk işaretinin solu Leveling/Fresh, sağı Lategame. Lategame geçişi 60 olur olmaz değil, ekonomi oturduktan sonra öneriliyor."
  );
}

// ============================================================
// CAMP ANSWER
// ============================================================

function buildCuratedCampingAnswer(q) {
  const row =
    findCampingRow(
      q
    );

  const hasCampSignal =
    /\b(kamp|camp|camping)\b/.test(
      q
    ) ||
    Boolean(
      row
    );

  if (
    !hasCampSignal
  ) {
    return null;
  }

  // Exact acquisition/location/trainer bilgisi tabloda yok.
  if (
    /nerede|nerden|nereden|trainer|egitmen|kimden|hangi npc|nasil alinir|nasil ogren|recipe nerede|tarif nerede/.test(
      q
    )
  ) {
    return null;
  }

  if (row) {
    return (
      `**${row.profession} – ${row.object}**\n` +
      `• Buff / avantaj: **${row.benefit}**\n` +
      `• Birlikte çalışmadığı buff: **${row.conflict}**\n` +
      `• İleri kamp objeleri: ${row.advanced}\n\n` +
      "Kamp buffları ilgili class bufflarıyla stack olmaz; onların yerine geçer. Değerler Lv60 beta tooltip değerleridir ve karakter seviyesiyle ölçeklenir."
    );
  }

  if (
    /buff|avantaj|stack|stat|ne ver|ne saglar|ne ise yarar|tablo|liste/.test(
      q
    )
  ) {
    const compact =
      CURATED_CAMPING
        .map(
          item =>
            `${item.profession}: ${item.benefit}`
        )
        .join(
          " • "
        );

    return (
      "WoW Forever kamp tablosundaki Lv60 beta değerleri:\n" +
      compact +
      "\n\nKamp buffları ilgili class bufflarıyla stack olmaz; onların yerine geçer. Leatherworking Camp Tent XP bonusu vermez, mevcut rested XP'yi level'in %5'ine kadar doldurur."
    );
  }

  return null;
}

// ============================================================
// LEGACY ANSWER
// ============================================================

function buildCuratedLegacyAnswer(q) {
  const perk =
    findLegacyPerk(
      q
    );

  const looksLegacy =
    /\blegacy\b/.test(
      q
    ) ||

    Boolean(
      perk
    ) ||

    /spectral bear|ironforge air rifle/.test(
      q
    ) ||

    (
      /agac|tree/.test(
        q
      ) &&
      /professions|adventure|resourcefulness/.test(
        q
      )
    );

  if (
    !looksLegacy
  ) {
    return null;
  }

  // Exact quest walkthrough / konum tabloda yok.
  if (
    /koordinat|konum|location|\bnerede\b|\bnerde\b|npc|walkthrough|adim adim|quest step/.test(
      q
    ) ||

    (
      /gorev|quest/.test(
        q
      ) &&
      /nasil yap|nasil tamam|basliyor|baslar/.test(
        q
      )
    )
  ) {
    return null;
  }

  if (perk) {
    return (
      `**${perk[0]}** – ${perk[2]} ağacı, Rank **${perk[1]}**\n` +
      `${perk[3]}`
    );
  }

  if (
    /kozmetik|milestone|mil tasi|odul|reward|spectral bear|air rifle/.test(
      q
    )
  ) {
    return (
      "Legacy kozmetik mil taşları:\n" +
      CURATED_LEGACY
        .milestones
        .map(
          (
            [
              points,
              reward
            ]
          ) =>
            `• ${points} puan: ${reward}`
        )
        .join(
          "\n"
        )
    );
  }

  if (
    /agac|tree|perk/.test(
      q
    )
  ) {
    return (
      "Legacy sisteminde **3 ağaç** ve görselde **21 bilinen aktif perk** var:\n" +
      `• Professions: ${CURATED_LEGACY.trees.professions}\n` +
      `• Adventure: ${CURATED_LEGACY.trees.adventure}\n` +
      `• Resourcefulness: ${CURATED_LEGACY.trees.resourcefulness}`
    );
  }

  const source =
    findLegacySource(
      q
    );

  if (source) {
    return (
      `**${source[0]}** kategorisinden toplam **${source[1]} Legacy Point** kazanılabilir.\n` +
      `${source[2]}`
    );
  }

  if (
    /nasil kazan|nereden kazan|kaynak|point|puan|toplam|kac puan/.test(
      q
    )
  ) {
    return (
      `Toplam kazanılabilir Legacy Point: **${CURATED_LEGACY.totals.obtainable}**. ` +
      `Her karakter bu account-wide havuzdan en fazla **${CURATED_LEGACY.totals.perCharacterSpend}** puan harcayabilir.\n` +

      CURATED_LEGACY
        .sources
        .map(
          (
            [
              name,
              points,
              how
            ]
          ) =>
            `• ${name}: **${points}** — ${how}`
        )
        .join(
          "\n"
        )
    );
  }

  return (
    `WoW Forever Legacy sistemi account-wide çalışıyor: toplam **${CURATED_LEGACY.totals.obtainable}** puan kazanılabiliyor; ` +
    `her karakter bu havuzdan ayrı dağıtım yapıyor ve karakter başına **${CURATED_LEGACY.totals.perCharacterSpend} puan** harcama sınırı var. ` +
    `Sistemde **${CURATED_LEGACY.totals.trees} Legacy ağacı** ve görselde **${CURATED_LEGACY.totals.knownPerks} bilinen aktif perk** bulunuyor.`
  );
}

// ============================================================
// FIND HELPERS
// ============================================================

function containsNormalizedPhrase(
  normalizedText,
  phrase
) {
  const p =
    normalizeLocal(
      phrase
    );

  if (!p) {
    return false;
  }

  const haystack =
    ` ${normalizedText.replace(
      /'/g,
      " "
    )} `;

  const needle =
    ` ${p.replace(
      /'/g,
      " "
    )} `;

  return haystack.includes(
    needle
  );
}

function findClassKey(q) {
  for (
    const [
      key,
      aliases
    ]
    of Object.entries(
      CLASS_ALIASES
    )
  ) {
    if (
      aliases.some(
        alias =>
          containsNormalizedPhrase(
            q,
            alias
          )
      )
    ) {
      return key;
    }
  }

  return null;
}

function findSpecKey(
  q,
  classKey
) {
  const specs =
    SPEC_ALIASES[
      classKey
    ] ||
    {};

  for (
    const [
      key,
      aliases
    ]
    of Object.entries(
      specs
    )
  ) {
    if (
      aliases.some(
        alias =>
          containsNormalizedPhrase(
            q,
            alias
          )
      )
    ) {
      return key;
    }
  }

  return null;
}

function findCampingRow(q) {
  return (
    CURATED_CAMPING
      .find(
        row =>
          row
            .aliases
            .some(
              alias =>
                containsNormalizedPhrase(
                  q,
                  alias
                )
            ) ||

          containsNormalizedPhrase(
            q,
            row.object
          )
      ) ||
    null
  );
}

function findLegacyPerk(q) {
  return (
    CURATED_LEGACY
      .perks
      .find(
        perk =>
          containsNormalizedPhrase(
            q,
            perk[0]
          )
      ) ||
    null
  );
}

function findLegacySource(q) {
  const rules = [
    [
      0,
      [
        "class leveling",
        "class level",
        "sinif level"
      ]
    ],

    [
      1,
      [
        "crafting meslek",
        "crafting profession",
        "meslek 150",
        "meslek 225",
        "meslek 300"
      ]
    ],

    [
      2,
      [
        "pvp",
        "bg",
        "battleground",
        "fields of glory",
        "honor rank"
      ]
    ],

    [
      3,
      [
        "adventure",
        "explore azeroth",
        "valthalak"
      ]
    ],

    [
      4,
      [
        "dungeon",
        "dungeonlar"
      ]
    ],

    [
      5,
      [
        "raid",
        "onyxia",
        "hyjal summit",
        "barrow deeps"
      ]
    ]
  ];

  for (
    const [
      index,
      aliases
    ]
    of rules
  ) {
    if (
      aliases.some(
        alias =>
          containsNormalizedPhrase(
            q,
            alias
          )
      )
    ) {
      return (
        CURATED_LEGACY
          .sources[
            index
          ]
      );
    }
  }

  return null;
}

// ============================================================
// GUILD / GUIDE DETECTION
// ============================================================

function isGuildInfoQuestion(
  question
) {
  const q =
    normalizeLocal(
      question
    );

  const guildSignal =
    /\b(guild[a-z]*|lonca[a-z]*)\b/.test(
      q
    );

  const totikTeamSignal =
    /totik channel|totik ekibi|totik team|siz hangi|siz nerede|hangi ruleset|hangi faction|hangi tarafta/.test(
      q
    ) &&

    /alliance|horde|ruleset|faction|taraf|oynuyor|oynuyorsunuz/.test(
      q
    );

  if (
    !guildSignal &&
    !totikTeamSignal
  ) {
    return false;
  }

  return (
    totikTeamSignal ||

    /nasil gir|nasil katil|katilmak|basvuru|alim|sart|requirements|hangi taraf|alliance|horde|ruleset|isim oner|guild isim|nereden bilgi|detay/.test(
      q
    )
  );
}

function isGuideTopicQuestion(
  question
) {
  const q =
    normalizeLocal(
      question
    );

  return (
    /ruleset/.test(
      q
    ) ||

    /horde|alliance/.test(
      q
    ) ||

    /level kas|leveling|levelleme/.test(
      q
    ) ||

    /\b(race|racial|irk)\b/.test(
      q
    ) ||

    /hit rating|zar mant/.test(
      q
    ) ||

    /\b(class|sinif)\b/.test(
      q
    ) ||

    /\b(mana|energy|focus|rage)\b/.test(
      q
    ) ||

    /zirh|armor|melee|ranged|healer|tank|ilk karakter/.test(
      q
    ) ||

    /\b(addon|add on)\b|turkce yap|action bar|auto loot|otomatik.*topla|cooldown manager|swing timer|dps metre|dps meter|nameplate|tus ata|keybind|fps|sesli betimleme|gamepad/.test(
      q
    ) ||

    /\bmesle(?:k|g)[a-z]*\b|\bprofession[a-z]*\b|\b(crafting|gathering|tracking)\b/.test(
      q
    ) ||

    /\b(kamp|camp|camping|legacy)\b/.test(
      q
    ) ||

    /oyun.*(nereden|nerden|nasil al|satin al)|wow forever.*(nereden|nerden|nasil al)|ne almam lazim|hangi paket/.test(
      q
    )
  );
}

function likelyCuratedTopic(
  question
) {
  const q =
    normalizeLocal(
      question
    );

  if (
    /\blegacy\b|working overtime|bountiful harvest|master chef|bartering|performance bonus|luremaster|dedicated study|well rested|thrill of adventure|high alert|talented|field guide|field medicine|frequent flier|quick and the dead|reinforce|gourmand|great honor|permanence|diplomat|reagent economy/.test(
      q
    )
  ) {
    return "legacy";
  }

  if (
    /\b(kamp|camp|camping)\b|mana well|sharpening wheel|enchanted lute|reagent bot|incense candle|camp tent|lodestone|camp chair|faction banner|first aid kit|fish bowl|basic campfire/.test(
      q
    )
  ) {
    return "camping";
  }

  if (
    /(\bmesle(?:k|g)[a-z]*\b|\bprofession[a-z]*\b)/.test(
      q
    ) &&

    /hangi|sec|oner|tavsiye|kombin|leveling|fresh|lategame|late game|warrior|hunter|mage|rogue|priest|warlock|paladin|druid|shaman/.test(
      q
    )
  ) {
    return "profession";
  }

  return null;
}

function appendGuideReminder(
  answer,
  question,
  result
) {
  const text =
    String(
      answer ||
      ""
    )
      .trim();

  const shouldAdd =
    Boolean(
      result
        ?.curatedTopic
    ) ||

    isGuideTopicQuestion(
      question
    );

  if (
    !shouldAdd ||

    text.includes(
      `<#${GUIDE_CHANNEL_ID}>`
    )
  ) {
    return text;
  }

  return (
    `${text}\n\n` +
    GUIDE_REMINDER_MESSAGE
  );
}

// ============================================================
// IMAGE HELPERS
// ============================================================

function guessMimeType(filename) {
  const name =
    String(
      filename ||
      ""
    )
      .toLowerCase();

  if (
    name.endsWith(
      ".jpg"
    ) ||

    name.endsWith(
      ".jpeg"
    )
  ) {
    return "image/jpeg";
  }

  if (
    name.endsWith(
      ".webp"
    )
  ) {
    return "image/webp";
  }

  if (
    name.endsWith(
      ".gif"
    )
  ) {
    return "image/gif";
  }

  return "image/png";
}

function getImageAttachment(message) {
  const attachments =
    Array.isArray(
      message
        ?.attachments
    )

      ? message.attachments

      : [];

  for (
    const attachment
    of attachments
  ) {
    const contentType =
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
  let binary =
    "";

  const chunkSize =
    0x8000;

  for (
    let i = 0;

    i <
    bytes.length;

    i +=
    chunkSize
  ) {
    binary +=
      String.fromCharCode(
        ...bytes.subarray(
          i,
          i +
          chunkSize
        )
      );
  }

  return btoa(
    binary
  );
}

function retryableBackendStatus(status) {
  return (
    status ===
      502 ||

    status ===
      503 ||

    status ===
      504
  );
}

// ============================================================
// WORKER
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

        curatedGuideSupport:
          true,

        guildRoutingSupport:
          true,

        localCuratedGuideFastPath:
          true,

        guideBuild:
          TOTIK_GUIDE_BUILD,

        adminCooldownBypass:
          true,

        backendAttempts:
          AI_MAX_ATTEMPTS
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
      env.GATEWAY
        .idFromName(
          "totik-ai-main"
        );

    const stub =
      env.GATEWAY
        .get(
          id
        );

    try {
      if (
        url.pathname ===
          "/" ||

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

    return new Response(
      "Not found",
      {
        status:
          404
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
        !this
          .env
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

      await this
        .ctx
        .storage
        .put(
          "polling_enabled",
          true
        );

      await this
        .ensureInitialized();

      await this
        .ctx
        .storage
        .setAlarm(
          Date.now() +
          1000
        );

      return json({
        ok:
          true,

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
      await this
        .ctx
        .storage
        .put(
          "polling_enabled",
          false
        );

      await this
        .ctx
        .storage
        .deleteAlarm();

      return json({
        ok:
          true,

        state:
          "stopped"
      });
    }

    if (
      url.pathname ===
      "/run"
    ) {
      await this
        .ctx
        .storage
        .put(
          "polling_enabled",
          true
        );

      await this
        .ensureInitialized();

      await this
        .pollOnce();

      await this
        .ctx
        .storage
        .setAlarm(
          Date.now() +
          POLL_INTERVAL_MS
        );

      return json({
        ok:
          true,

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
        await this
          .ctx
          .storage
          .getAlarm();

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

        mode:
          "low-usage-polling",

        gatewayWebSocket:
          false,

        initialized:
          initialized ===
          true,

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
              )
                .toISOString()

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
        status:
          404
      }
    );
  }

  // ----------------------------------------------------------
  // ALARM
  // ----------------------------------------------------------

  async alarm() {
    const enabled =
      await this
        .ctx
        .storage
        .get(
          "polling_enabled"
        );

    if (
      enabled ===
      false
    ) {
      return;
    }

    const startedAt =
      Date.now();

    try {
      await this
        .ensureInitialized();

      await this
        .pollOnce();

    } catch (error) {
      await this
        .setLastError(
          `Polling: ${
            error?.message ||
            String(
              error
            )
          }`
        );

    } finally {
      const stillEnabled =
        await this
          .ctx
          .storage
          .get(
            "polling_enabled"
          );

      if (
        stillEnabled !==
        false
      ) {
        const scheduled =
          startedAt +
          POLL_INTERVAL_MS;

        const nextAlarm =
          Math.max(
            Date.now() +
            1000,
            scheduled
          );

        await this
          .ctx
          .storage
          .setAlarm(
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
      await this
        .ctx
        .storage
        .get(
          "initialized"
        );

    if (
      initialized ===
      true
    ) {
      return;
    }

    const messages =
      await this
        .discordRequest(
          `/channels/${QUESTION_CHANNEL_ID}/messages?limit=1`
        );

    if (
      Array.isArray(
        messages
      ) &&
      messages.length >
      0
    ) {
      await this
        .ctx
        .storage
        .put(
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

  // ----------------------------------------------------------
  // POLLING
  // ----------------------------------------------------------

  async pollOnce() {
    let cursor =
      await this
        .ctx
        .storage
        .get(
          "last_message_id"
        );

    for (
      let page = 0;

      page <
      3;

      page++
    ) {
      const query =
        cursor

          ? `?after=${encodeURIComponent(
              cursor
            )}&limit=100`

          : "?limit=1";

      const messages =
        await this
          .discordRequest(
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
        const messageId =
          String(
            message.id
          );

        try {
          await this
            .processMessage(
              message
            );

        } catch (error) {
          await this
            .setLastError(
              `Message ${messageId}: ${
                error?.message ||
                String(
                  error
                )
              }`
            );
        }

        cursor =
          messageId;

        await this
          .ctx
          .storage
          .put(
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

    await this
      .ctx
      .storage
      .put(
        "last_poll_at",
        new Date()
          .toISOString()
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
      )
        .trim();

    if (
      !QUESTION_COMMAND
        .test(
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
          await this
            .discordRequest(
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

    const image =
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

    } else if (
      image
    ) {
      effectiveQuestion =
        "Bu görseldeki World of Warcraft konusu veya görevi hakkında yardımcı ol.";
    }

    if (
      !effectiveQuestion &&
      !image
    ) {
      await this
        .reply(
          message,
          "Sorunu `!soru` komutundan sonra yazabilir veya cevaplamak istediğin mesaja reply atıp sadece `!soru` yazabilirsin."
        );

      return;
    }

    const userId =
      String(
        message.author.id
      );

    const allowed =
      await this
        .acquireCooldown(
          userId
        );

    if (
      !allowed
    ) {
      await this
        .reply(
          message,
          COOLDOWN_MESSAGE
        );

      return;
    }

    await this
      .ctx
      .storage
      .put(
        "last_question_at",
        new Date()
          .toISOString()
      );

    // ========================================================
    // GUILD — LOCAL, FREE
    // ========================================================

    if (
      isGuildInfoQuestion(
        effectiveQuestion
      )
    ) {
      await this
        .reply(
          message,
          GUILD_INFO_MESSAGE
        );

      await this
        .markAnswered();

      await this
        .clearLastError();

      return;
    }

    // ========================================================
    // MESLEK / CAMP / LEGACY — LOCAL, FREE
    // ========================================================

    const localCurated =
      tryCuratedForeverAnswer(
        effectiveQuestion
      );

    if (
      localCurated
    ) {
      await this
        .safeTyping(
          QUESTION_CHANNEL_ID
        );

      const guideImageFile =
        await this
          .getGuideImageFile(
            localCurated.topic
          );

      const localAnswer =
        appendGuideReminder(
          localCurated.answer,
          effectiveQuestion,
          {
            curatedTopic:
              localCurated.topic
          }
        );

      await this
        .reply(
          message,
          localAnswer,
          {
            imageFile:
              guideImageFile
          }
        );

      await this
        .markAnswered();

      await this
        .clearLastError();

      return;
    }

    // ========================================================
    // LOCAL BASIC RESPONSES
    // ========================================================

    if (
      isChannelRecommendationQuestion(
        effectiveQuestion
      )
    ) {
      await this
        .reply(
          message,
          CHANNEL_RECOMMENDATION_MESSAGE
        );

      await this
        .markAnswered();

      await this
        .clearLastError();

      return;
    }

    if (
      isIdentityQuestion(
        effectiveQuestion
      )
    ) {
      await this
        .reply(
          message,
          IDENTITY_MESSAGE
        );

      await this
        .markAnswered();

      await this
        .clearLastError();

      return;
    }

    // ========================================================
    // NORMAL AI FLOW — MEVCUT MANTIK
    // ========================================================

    try {
      await this
        .safeTyping(
          QUESTION_CHANNEL_ID
        );

      let imageContext =
        "";

      if (
        image &&
        !likelyCuratedTopic(
          effectiveQuestion
        )
      ) {
        imageContext =
          await this
            .analyzeImage(
              image,
              effectiveQuestion
            );
      }

      let finalQuestion =
        effectiveQuestion;

      if (
        imageContext
      ) {
        finalQuestion +=
          `\n\nEkran görüntüsünden okunan bilgiler:\n${imageContext}`;
      }

      let result;

      try {
        result =
          await this
            .askWowAi(
              finalQuestion
            );

      } catch (
        backendError
      ) {
        result =
          await this
            .askGeminiFallback(
              finalQuestion,
              backendError
            );
      }

      const answer =
        tidyAnswer(
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

      const finalAnswer =
        appendGuideReminder(
          answer,
          effectiveQuestion,
          result
        );

      const detectedGuideTopic =
        result?.curatedTopic ||
        likelyCuratedTopic(
          effectiveQuestion
        );

      const guideImageFile =
        detectedGuideTopic

          ? await this
              .getGuideImageFile(
                detectedGuideTopic
              )

          : null;

      await this
        .reply(
          message,
          finalAnswer,
          {
            imageFile:
              guideImageFile
          }
        );

      await this
        .markAnswered();

      await this
        .clearLastError();

    } catch (error) {
      await this
        .releaseCooldown(
          userId
        );

      await this
        .markTechnicalFailure();

      await this
        .setLastError(
          `Question: ${
            error?.message ||
            String(
              error
            )
          }`
        );

      await this
        .reply(
          message,
          "Şu an bilgi kaynaklarından birine ulaşamadım. Bu soru 10 dakikalık hakkından düşmedi; biraz sonra tekrar deneyebilirsin."
        );
    }
  }

  // ----------------------------------------------------------
  // COOLDOWN
  // ----------------------------------------------------------

  async acquireCooldown(userId) {
    if (
      ADMIN_COOLDOWN_BYPASS_USER_IDS
        .has(
          String(
            userId
          )
        )
    ) {
      return true;
    }

    const key =
      `cooldown:${userId}`;

    const previous =
      await this
        .ctx
        .storage
        .get(
          key
        );

    const now =
      Date.now();

    if (
      typeof previous ===
        "number" &&

      now -
        previous <
        USER_COOLDOWN_MS
    ) {
      return false;
    }

    await this
      .ctx
      .storage
      .put(
        key,
        now
      );

    return true;
  }

  async releaseCooldown(userId) {
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
      await this
        .ctx
        .storage
        .delete(
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
      !this
        .env
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
      await imageResponse
        .arrayBuffer();

    if (
      buffer.byteLength >
      7 *
      1024 *
      1024
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
              this
                .env
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
      await response
        .text();

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

    if (
      !text
    ) {
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

    url.searchParams
      .set(
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
          await response
            .text();

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

        if (
          retry
        ) {
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
      !this
        .env
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

        40 *
        1000
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
                this
                  .env
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
        await response
          .text();

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

      if (
        !answer
      ) {
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
        await this
          .ctx
          .storage
          .get(
            "answered_count"
          )
      ) ||
      0;

    await this
      .ctx
      .storage
      .put(
        "answered_count",
        current +
        1
      );
  }

  async markTechnicalFailure() {
    const current =
      Number(
        await this
          .ctx
          .storage
          .get(
            "technical_failure_count"
          )
      ) ||
      0;

    await this
      .ctx
      .storage
      .put(
        "technical_failure_count",
        current +
        1
      );
  }

  async clearLastError() {
    await this
      .ctx
      .storage
      .delete(
        "last_error"
      );
  }

  async setLastError(message) {
    await this
      .ctx
      .storage
      .put(
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
    answer,
    options = {}
  ) {
    const chunks =
      splitDiscordMessage(
        answer
      );

    for (
      let i = 0;

      i <
      chunks.length;

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

      if (
        i ===
        0
      ) {
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

      if (
        i ===
          0 &&

        options.imageFile
      ) {
        try {
          await this
            .discordMultipartRequest(
              `/channels/${QUESTION_CHANNEL_ID}/messages`,
              body,
              options.imageFile
            );

          continue;

        } catch (error) {
          // Görsel yüklenemezse cevap yine metin olarak gönder.
          await this
            .setLastError(
              `Guide image upload: ${
                error?.message ||
                String(
                  error
                )
              }`
            );
        }
      }

      await this
        .discordRequest(
          `/channels/${QUESTION_CHANNEL_ID}/messages`,
          {
            method:
              "POST",

            body
          }
        );
    }
  }

  async getGuideImageFile(topic) {
    const messageId =
      GUIDE_IMAGE_MESSAGE_IDS[
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
        await this
          .discordRequest(
            `/channels/${QUESTION_CHANNEL_ID}/messages/${messageId}`
          );

      const attachment =
        getImageAttachment(
          sourceMessage
        );

      if (
        !attachment?.url
      ) {
        throw new Error(
          "Kaynak mesajda görsel attachment bulunamadı."
        );
      }

      const imageResponse =
        await fetch(
          attachment.url
        );

      if (
        !imageResponse.ok
      ) {
        throw new Error(
          `Kaynak görsel indirilemedi: ${imageResponse.status}`
        );
      }

      const buffer =
        await imageResponse
          .arrayBuffer();

      if (
        buffer.byteLength >
        8 *
        1024 *
        1024
      ) {
        throw new Error(
          "Rehber görseli 8 MB sınırını aşıyor."
        );
      }

      const sourceAttachment =
        Array.isArray(
          sourceMessage?.attachments
        )

          ? sourceMessage
              .attachments
              .find(
                item =>
                  item?.url ===
                  attachment.url
              )

          : null;

      return {
        bytes:
          buffer,

        contentType:
          attachment.contentType ||
          "image/png",

        filename:
          String(
            sourceAttachment
              ?.filename ||
            `${topic}.png`
          )
      };

    } catch (error) {
      // Görsel alınamazsa cevap yine gönderilsin.
      await this
        .setLastError(
          `Guide image ${topic}: ${
            error?.message ||
            String(
              error
            )
          }`
        );

      return null;
    }
  }

  async discordMultipartRequest(
    path,
    body,
    imageFile
  ) {
    for (
      let attempt = 1;

      attempt <=
      4;

      attempt++
    ) {
      const form =
        new FormData();

      form.append(
        "payload_json",
        JSON.stringify(
          body
        )
      );

      form.append(
        "files[0]",
        new Blob(
          [
            imageFile.bytes
          ],
          {
            type:
              imageFile.contentType ||
              "image/png"
          }
        ),
        imageFile.filename ||
        "guide.png"
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
        await response
          .text();

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
      "Discord multipart maksimum retry sayısına ulaştı."
    );
  }

  async safeTyping(channelId) {
    try {
      await this
        .discordRequest(
          `/channels/${channelId}/typing`,
          {
            method:
              "POST"
          }
        );

    } catch {
      // Typing başarısız olsa bile devam.
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
        await response
          .text();

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
      "Discord API maksimum retry sayısına ulaştı."
    );
  }
}
