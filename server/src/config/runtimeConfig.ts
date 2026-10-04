export type RuntimeEnvironment = "development" | "production";
export type EnvironmentValues = Record<string, string | undefined>;

const DEVELOPMENT_VALUES = new Set(["dev", "development"]);
const PRODUCTION_VALUES = new Set(["prod", "production"]);

export function resolveRuntimeEnvironment(env: EnvironmentValues = process.env): RuntimeEnvironment {
  const raw = (env.NODE_ENV ?? "development").trim().toLocaleLowerCase();
  if (DEVELOPMENT_VALUES.has(raw)) return "development";
  if (PRODUCTION_VALUES.has(raw)) return "production";
  throw new Error(`NODE_ENV must be development/dev or production/prod; received ${JSON.stringify(raw)}.`);
}

function value(env: EnvironmentValues, name: string): string {
  return (env[name] ?? "").trim();
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase().replace(/^\[|\]$/gu, "");
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "127.0.0.1"
    || normalized === "0.0.0.0"
    || normalized === "::1";
}

function validateHttpsEndpoint(env: EnvironmentValues, name: string, errors: string[]): void {
  const raw = value(env, name);
  if (!raw) {
    errors.push(`${name} is required in production.`);
    return;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") errors.push(`${name} must use https:// in production.`);
    if (isLocalHostname(url.hostname)) errors.push(`${name} must point to a hosted endpoint, not a local host.`);
  } catch {
    errors.push(`${name} must be a valid HTTPS URL.`);
  }
}

function orderedVoiceProviders(env: EnvironmentValues, variable: string): string[] {
  const configured = value(env, variable);
  return (configured || "elevenlabs,deepgram")
    .split(",")
    .map((provider) => provider.trim().toLocaleLowerCase())
    .filter((provider, index, all) => Boolean(provider) && all.indexOf(provider) === index);
}

function hostedSpeechProviderConfigured(env: EnvironmentValues, provider: string, capability: "stt" | "tts", errors: string[]): boolean {
  if (provider === "elevenlabs") {
    // A missing key means this provider is intentionally unconfigured; another ordered provider may satisfy the hosted requirement.
    if (!value(env, "ELEVENLABS_API_KEY")) return false;
    validateHttpsEndpoint(env, "ELEVENLABS_BASE_URL", errors);
    const modelName = capability === "stt" ? "ELEVENLABS_STT_MODEL_ID" : "ELEVENLABS_TTS_MODEL_ID";
    let complete = Boolean(value(env, modelName));
    if (!complete) errors.push(`${modelName} is required for hosted ${capability.toUpperCase()}.`);
    if (capability === "tts" && !value(env, "ELEVENLABS_TTS_VOICE_ID")) {
      complete = false;
      errors.push("ELEVENLABS_TTS_VOICE_ID is required for ElevenLabs TTS.");
    }
    return complete;
  }
  if (provider === "deepgram") {
    if (!value(env, "DEEPGRAM_API_KEY")) return false;
    validateHttpsEndpoint(env, "DEEPGRAM_BASE_URL", errors);
    const modelName = capability === "stt" ? "DEEPGRAM_STT_MODEL" : "DEEPGRAM_TTS_MODEL";
    if (!value(env, modelName)) {
      errors.push(`${modelName} is required for hosted ${capability.toUpperCase()}.`);
      return false;
    }
    return true;
  }
  return false;
}

function productionMongoErrors(env: EnvironmentValues): string[] {
  const errors: string[] = [];
  if ((value(env, "STORAGE_DRIVER") || "mongo").toLocaleLowerCase() !== "mongo") {
    errors.push("STORAGE_DRIVER must be mongo in production; in-memory storage is development-only.");
  }

  const mongoUri = value(env, "MONGODB_URI");
  if (!mongoUri) errors.push("MONGODB_URI is required in production.");
  else {
    try {
      const uri = new URL(mongoUri);
      if (!new Set(["mongodb:", "mongodb+srv:"]).has(uri.protocol)) errors.push("MONGODB_URI must use mongodb:// or mongodb+srv://.");
      if (isLocalHostname(uri.hostname)) errors.push("MONGODB_URI must point to hosted MongoDB in production, not localhost.");
    } catch {
      errors.push("MONGODB_URI must be a valid MongoDB connection URI.");
    }
  }
  const controlDatabase = value(env, "MONGODB_DB");
  if (!controlDatabase) errors.push("MONGODB_DB is required in production.");
  else if (!/^[A-Za-z0-9_-]{1,63}$/u.test(controlDatabase)) errors.push("MONGODB_DB must be a valid database name using letters, numbers, underscores, or hyphens.");
  const shopPrefix = value(env, "MONGODB_SHOP_DB_PREFIX");
  if (!shopPrefix) errors.push("MONGODB_SHOP_DB_PREFIX is required in production.");
  else if (!/^[A-Za-z0-9_-]+$/u.test(shopPrefix) || shopPrefix.length > 22) errors.push("MONGODB_SHOP_DB_PREFIX must contain only letters, numbers, underscores, or hyphens and leave room for generated shop IDs in MongoDB's 63-character database-name limit.");
  return errors;
}

/** Storage-only validation for administrative CLI tasks such as a targeted seed. */
export function validateStorageConfiguration(env: EnvironmentValues = process.env): RuntimeEnvironment {
  const runtime = resolveRuntimeEnvironment(env);
  if (runtime === "production") {
    const errors = productionMongoErrors(env);
    if (errors.length) throw new Error(`Invalid production storage configuration:\n- ${errors.join("\n- ")}`);
  }
  return runtime;
}

/** Enforces hosted-only dependencies when the API runs in production. */
export function validateRuntimeConfiguration(env: EnvironmentValues = process.env): RuntimeEnvironment {
  const runtime = resolveRuntimeEnvironment(env);
  if (runtime === "development") return runtime;

  const errors: string[] = productionMongoErrors(env);

  if (value(env, "LLM_PROVIDER").toLocaleLowerCase() !== "hosted") errors.push("LLM_PROVIDER must be hosted in production.");
  if (!value(env, "HOSTED_LLM_API_KEY")) errors.push("HOSTED_LLM_API_KEY is required in production.");
  if (!value(env, "HOSTED_LLM_MODEL")) errors.push("HOSTED_LLM_MODEL is required in production.");
  validateHttpsEndpoint(env, "HOSTED_LLM_BASE_URL", errors);

  if (value(env, "VOICE_MODE").toLocaleLowerCase() !== "hosted") errors.push("VOICE_MODE must be hosted in production.");
  const providerNames = new Set(["elevenlabs", "deepgram"]);
  for (const variable of ["VOICE_STT_PROVIDER_ORDER", "VOICE_TTS_PROVIDER_ORDER"]) {
    const unknown = orderedVoiceProviders(env, variable).filter((provider) => !providerNames.has(provider));
    if (unknown.length) errors.push(`${variable} contains unsupported provider(s): ${unknown.join(", ")}.`);
  }
  const sttProviders = orderedVoiceProviders(env, "VOICE_STT_PROVIDER_ORDER");
  const ttsProviders = orderedVoiceProviders(env, "VOICE_TTS_PROVIDER_ORDER");
  const sttConfigured = sttProviders.map((provider) => hostedSpeechProviderConfigured(env, provider, "stt", errors)).some(Boolean);
  const ttsConfigured = ttsProviders.map((provider) => hostedSpeechProviderConfigured(env, provider, "tts", errors)).some(Boolean);
  if (!sttConfigured) errors.push("Configure at least one hosted STT provider in VOICE_STT_PROVIDER_ORDER with its API key, HTTPS endpoint, and model.");
  if (!ttsConfigured) errors.push("Configure at least one hosted TTS provider in VOICE_TTS_PROVIDER_ORDER with its API key, HTTPS endpoint, and model; ElevenLabs also requires ELEVENLABS_TTS_VOICE_ID.");

  const origins = value(env, "CLIENT_ORIGIN").split(",").map((origin) => origin.trim()).filter(Boolean);
  if (!origins.length) errors.push("CLIENT_ORIGIN must list the hosted frontend origin(s) in production.");
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.origin !== origin) errors.push(`CLIENT_ORIGIN entry ${JSON.stringify(origin)} must be an HTTPS origin with no path.`);
    } catch {
      errors.push(`CLIENT_ORIGIN entry ${JSON.stringify(origin)} must be a valid HTTPS origin.`);
    }
  }

  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length) throw new Error(`Invalid production configuration:\n- ${uniqueErrors.join("\n- ")}`);
  return runtime;
}
