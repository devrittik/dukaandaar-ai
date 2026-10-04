import assert from "node:assert/strict";
import { test } from "node:test";
import { systemPrompt } from "../src/services/intentSchemas.js";

test("intent prompt spells out routing examples and selected response language", () => {
  const prompt = systemPrompt([{ id: "p1", name: "Tea", aliases: ["chai"] }], "4 Oct 2026", "bn");

  assert.match(prompt, /Set responseLanguage to "bn"/);
  assert.match(prompt, /confidence: 0\.5/);
  assert.ok(prompt.includes("“What should I restock?” -> {\"intent\":\"QUERY_INVENTORY\""));
  assert.ok(prompt.includes("“Show purchase history” ->"));
  assert.ok(prompt.includes('CATALOG (JSON data; each row is [canonical name, aliases...]): [["Tea","chai"]]'));
});
