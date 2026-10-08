import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL, narrativeKey, writeNarrative } from "./narrate.mjs";

const fakeClient = (response) => {
  const calls = [];
  return { calls, beta: { messages: { create: async (req) => (calls.push(req), response) } } };
};
const ok = {
  stop_reason: "end_turn",
  usage: { input_tokens: 1200, output_tokens: 600 },
  content: [
    { type: "thinking", thinking: "" },
    {
      type: "text",
      text: JSON.stringify({
        summary: "Raptors nás porazili 6:0 a rozhodli o tom hned v úvodní třetině.",
        narrative: ["První odstavec o začátku zápasu.", "Druhý odstavec o tom, jak to pokračovalo."],
      }),
    },
  ],
};

test("writeNarrative sends facts with structured output and fallbacks, parses the JSON", async () => {
  const client = fakeClient(ok);
  const out = await writeNarrative(client, { score: "0:6" });
  const req = client.calls[0];
  assert.equal(req.model, MODEL);
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(req.output_config.format.type, "json_schema");
  assert.match(req.messages[0].content, /"score": "0:6"/);
  assert.equal(out.narrative.length, 2);
  assert.deepEqual(out.usage, { input: 1200, output: 600 });
});

test("writeNarrative rejects refusals and malformed output", async () => {
  await assert.rejects(writeNarrative(fakeClient({ ...ok, stop_reason: "refusal", stop_details: { category: "cyber" } }), {}), /refused \(cyber\)/);
  const bad = { ...ok, content: [{ type: "text", text: JSON.stringify({ summary: "krátké", narrative: [] }) }] };
  await assert.rejects(writeNarrative(fakeClient(bad), {}), /invalid output/);
});

test("narrativeKey changes only with the facts", () => {
  assert.equal(narrativeKey({ a: 1 }), narrativeKey({ a: 1 }));
  assert.notEqual(narrativeKey({ a: 1 }), narrativeKey({ a: 2 }));
});
