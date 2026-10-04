import assert from "node:assert/strict";
import { test } from "node:test";
import { ConversationMemory } from "../src/services/conversationMemory.js";

test("conversation memory retains only a bounded recent window and isolates sessions", () => {
  const memory = new ConversationMemory({ maxTurns: 3 });
  for (let turn = 1; turn <= 4; turn += 1) memory.remember("session-one", `turn ${turn}`);
  memory.remember("session-two", "separate conversation");

  assert.deepEqual(memory.getContext("session-one").map((turn) => turn.text), ["turn 2", "turn 3", "turn 4"]);
  assert.deepEqual(memory.getContext("session-two").map((turn) => turn.text), ["separate conversation"]);
});

test("reset clears only the selected conversation context", () => {
  const memory = new ConversationMemory();
  memory.remember("session-one", "remember this temporarily");
  memory.remember("session-two", "keep this separate");

  memory.clear("session-one");

  assert.deepEqual(memory.getContext("session-one"), []);
  assert.deepEqual(memory.getContext("session-two").map((turn) => turn.text), ["keep this separate"]);
});

test("in-memory context expires after inactivity and is empty in a new server instance", () => {
  let now = 1_000;
  const firstProcessMemory = new ConversationMemory({ ttlMs: 100, now: () => now });
  firstProcessMemory.remember("session-one", "temporary context");
  assert.equal(firstProcessMemory.getContext("session-one").length, 1);

  now += 101;
  assert.deepEqual(firstProcessMemory.getContext("session-one"), []);
  assert.deepEqual(new ConversationMemory({ now: () => now }).getContext("session-one"), []);
});
