// Loads src/index.js outside Cloudflare so tests can call its internal functions.
import fs from "node:fs";
import vm from "node:vm";

const EXPORTED_FOR_TESTS = [
  "normalizeGuideText", "detectClass", "detectSpec", "resolveClassGuide", "catalogDiagnostics", "findAttachmentForPage",
  "communityIntent", "isBotInternalQuestion", "isIdentityQuestion", "isExternalSourceRecommendationQuestion",
  "isPersonalOrCreatorAdviceQuestion", "isClearlyOutOfScope", "specialTopic", "protectBotOutput", "splitDiscordMessage",
  "usableGameAnswer", "isNoInfoAnswer", "isForeverChangeTopic", "safeError", "splitQuestionParts", "isOverlyBroadQuestion", "OVERLY_BROAD_MESSAGE", "CLASS_GUIDE_PAGES", "GUIDE_BATCH_MESSAGE_IDS",
  "QUESTION_CHANNEL_ID", "OWNER_ID", "PRIVATE_BOT_MESSAGE", "IDENTITY_MESSAGE", "SOURCE_POLICY_MESSAGE", "ANSWER_RETRY_MESSAGE"
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
  const module = new vm.SourceTextModule(source, { context });
  await module.link(specifier => {
    if (specifier === "cloudflare:workers") return workerModule;
    throw new Error(`Unexpected module: ${specifier}`);
  });
  await module.evaluate();
  return { ...module.namespace, setFetch: fn => { context.__fetch = fn; } };
}
