import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRuntimeEnvironment, validateRuntimeConfiguration, validateStorageConfiguration } from "../src/config/runtimeConfig.js";

const completeProductionEnvironment = {
  NODE_ENV: "prod",
  STORAGE_DRIVER: "mongo",
  MONGODB_URI: "mongodb+srv://user:password@cluster.example.com/?retryWrites=true&w=majority",
  MONGODB_DB: "dukaandaar_control",
  MONGODB_SHOP_DB_PREFIX: "dukaandaar_",
  CLIENT_ORIGIN: "https://dukaandaar.example.com",
  LLM_PROVIDER: "hosted",
  HOSTED_LLM_API_KEY: "hosted-llm-secret",
  HOSTED_LLM_BASE_URL: "https://api.example.com/v1/chat/completions",
  HOSTED_LLM_MODEL: "fast-model",
  VOICE_MODE: "hosted",
  VOICE_STT_PROVIDER_ORDER: "elevenlabs",
  VOICE_TTS_PROVIDER_ORDER: "elevenlabs",
  ELEVENLABS_API_KEY: "voice-secret",
  ELEVENLABS_BASE_URL: "https://api.elevenlabs.io/v1",
  ELEVENLABS_STT_MODEL_ID: "scribe_v2",
  ELEVENLABS_TTS_MODEL_ID: "eleven_multilingual_v2",
  ELEVENLABS_TTS_VOICE_ID: "voice-id",
};

test("development accepts local Mongo, rules, and local speech configuration", () => {
  assert.equal(resolveRuntimeEnvironment({ NODE_ENV: "dev" }), "development");
  assert.equal(validateRuntimeConfiguration({
    NODE_ENV: "development",
    STORAGE_DRIVER: "memory",
    MONGODB_URI: "mongodb://127.0.0.1:27017/",
    LLM_PROVIDER: "rules",
    VOICE_MODE: "local",
  }), "development");
});

test("production accepts only complete remote Mongo, hosted LLM, and hosted STT/TTS configuration", () => {
  assert.equal(validateRuntimeConfiguration(completeProductionEnvironment), "production");
  assert.equal(validateStorageConfiguration({
    NODE_ENV: "production",
    STORAGE_DRIVER: "mongo",
    MONGODB_URI: "mongodb+srv://user:password@cluster.example.com/",
    MONGODB_DB: "control",
    MONGODB_SHOP_DB_PREFIX: "tenant_",
  }), "production");
});

test("production aggregates missing, local, and non-hosted provider configuration errors", () => {
  assert.throws(() => validateRuntimeConfiguration({
    ...completeProductionEnvironment,
    STORAGE_DRIVER: "memory",
    MONGODB_URI: "mongodb://localhost:27017/",
    LLM_PROVIDER: "ollama",
    HOSTED_LLM_API_KEY: "",
    HOSTED_LLM_BASE_URL: "http://127.0.0.1:1234/v1/chat/completions",
    VOICE_MODE: "local",
    ELEVENLABS_API_KEY: "",
    ELEVENLABS_TTS_VOICE_ID: "",
  }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /STORAGE_DRIVER must be mongo/);
    assert.match(error.message, /hosted MongoDB/);
    assert.match(error.message, /LLM_PROVIDER must be hosted/);
    assert.match(error.message, /HOSTED_LLM_API_KEY is required/);
    assert.match(error.message, /VOICE_MODE must be hosted/);
    assert.match(error.message, /at least one hosted STT provider/);
    assert.match(error.message, /at least one hosted TTS provider/);
    return true;
  });
});

test("production rejects invalid frontend origins and missing hosted provider endpoints", () => {
  assert.throws(() => validateRuntimeConfiguration({
    ...completeProductionEnvironment,
    CLIENT_ORIGIN: "https://dukaandaar.example.com/dashboard",
    ELEVENLABS_BASE_URL: "http://api.elevenlabs.io/v1",
  }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /CLIENT_ORIGIN entry.*must be an HTTPS origin with no path/u);
    assert.match(error.message, /ELEVENLABS_BASE_URL must use https:\/\//u);
    return true;
  });
});

test("invalid NODE_ENV values fail instead of silently selecting a mode", () => {
  assert.throws(() => resolveRuntimeEnvironment({ NODE_ENV: "staging" }), /NODE_ENV must be development\/dev or production\/prod/u);
});
