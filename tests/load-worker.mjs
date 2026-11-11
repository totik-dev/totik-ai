// Loads src/index.js outside Cloudflare so tests can call its internal functions.
import fs from "node:fs";
import vm from "node:vm";

const EXPORTED_FOR_TESTS = [
  "normalizeGuideText", "pickCards", "detectExternalOnlyIntent", "CARDS", "CARD_TOPICS", "selectCards", "detectClass", "findCardAttachment",
  "communityIntent", "isBotInternalQuestion", "isIdentityQuestion", "isExternalSourceRecommendationQuestion",
  "isPersonalOrCreatorAdviceQuestion", "isClearlyOutOfScope", "protectBotOutput", "splitDiscordMessage",
  "usableGameAnswer", "isNoInfoAnswer", "hasNoInfoSentence", "stripNoInfoSentences", "isKickRoleName", "isForeverChangeTopic", "safeError", "splitQuestionParts", "isOverlyBroadQuestion", "OVERLY_BROAD_MESSAGE",
  "QUESTION_CHANNEL_ID", "OWNER_ID", "TALENT_CHANNEL_ID", "DUNGEON_CHANNEL_ID", "isTalentAdviceQuestion", "isTalentQuestion", "TALENT_ADVICE_MESSAGE", "isDungeonQuestion", "isDungeonInfoQuestion", "PRIVATE_BOT_MESSAGE", "IDENTITY_MESSAGE", "SOURCE_POLICY_MESSAGE", "ANSWER_RETRY_MESSAGE"
];

export async function loadWorker() {
  const source = `${fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8")}\nexport { ${EXPORTED_FOR_TESTS.join(", ")} };`;
  const context = vm.createContext({
    AbortController, Blob, FormData, Headers, Request, Response, URL, URLSearchParams, TextEncoder, TextDecoder,
    console, crypto, fetch: (...args) => context.__fetch(...args), setTimeout, clearTimeout, btoa, atob,
    __fetch: () => { throw new Error("Network disabled in tests"); }
  });
  const workerModule = new vm.SyntheticModule(["DurableObject"], function () {
    this.setExport("DurableObject", class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } });
  }, { context });
  // The worker's own modules (./cards.js, ./cards-data.js) are loaded into the same context.
  const local = new Map();
  const link = specifier => {
    if (specifier === "cloudflare:workers") return workerModule;
    if (!/^\.\/[\w-]+\.js$/.test(specifier)) throw new Error(`Unexpected module: ${specifier}`);
    if (!local.has(specifier)) local.set(specifier, new vm.SourceTextModule(fs.readFileSync(new URL(`../src/${specifier.slice(2)}`, import.meta.url), "utf8"), { context, identifier: specifier }));
    return local.get(specifier);
  };
  const module = new vm.SourceTextModule(source, { context });
  await module.link(link);
  await module.evaluate();
  return { ...module.namespace, setFetch: fn => { context.__fetch = fn; } };
}
