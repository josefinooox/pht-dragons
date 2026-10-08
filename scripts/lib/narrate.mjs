// Commentator-style match narratives, written by Claude at build time from computed facts.
// The facts come from src/lib/recap.ts (matchFacts); the model only phrases them.
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const MODEL = "claude-opus-5-5";
// Bump when the prompt changes so cached narratives are rewritten once.
export const PROMPT_VERSION = 1;

export const NarrativeSchema = z.object({
  summary: z.string().min(40),
  narrative: z.array(z.string().min(20)).min(2).max(6),
});

export const SYSTEM = `Jsi komentátor amatérského hokejového týmu PHT Dragons. Píšeš na týmový web, který čtou hráči, trenéři a jejich rodiny a kamarádi. Po zápase jim česky, běžným mluveným jazykem vyprávíš, jak se hrálo: jako by to někdo vyprávěl u piva, ne jako statistický report.

Dostaneš fakta o jednom zápase ve formátu JSON. Napiš z nich dva texty:
- "summary": krátké shrnutí na 2–3 věty, které se zobrazí hned. Výsledek, hlavní příběh zápasu a jedno jméno nebo moment, který stojí za zmínku.
- "narrative": delší vyprávění o průběhu zápasu ve 3–5 odstavcích (každý odstavec jako jedna položka pole), zhruba 150–280 slov celkem. Veď čtenáře zápasem chronologicky, třetinu po třetině, s důrazem na zlomové momenty. Na konci můžeš krátce zmínit čísla (střely, hvězdy zápasu), pokud k příběhu něco dodají.

Pravidla:
- Piš z pohledu týmu: "my", "naši", "kluci". Skóre uváděj z našeho pohledu (naše góly první), stejně jako v poli score a scoreAfter.
- Používej jen fakta z JSONu. Nevymýšlej nic, co v datech není: žádné popisy střel, zákroků brankářů, atmosféry, počasí, emocí konkrétních hráčů ani citace. Když něco nevíš, nepiš to. Je lepší kratší text než vymyšlený detail.
- Jména hráčů a týmů skloňuj správně česky (např. "po přihrávce Petra Pudila"). Názvy týmů jako HC Raptors nebo Gaston Seals neskloňuj, ale můžeš použít jen přezdívku ("Raptors").
- Když je eventsComplete false, máš jen výsledek a statistiky; nepopisuj průběh, který neznáš.
- K soupeři buď férový, k vlastnímu týmu povzbudivý i po prohře, ale bez přikrášlování výsledku.
- Žádné nadpisy, odrážky, emoji ani markdown. Jen souvislý text.`;

/** Stable hash of everything that shapes the text, so it is regenerated only when it would differ. */
export const narrativeKey = (facts) =>
  createHash("sha256").update(JSON.stringify({ facts, model: MODEL, prompt: PROMPT_VERSION })).digest("hex").slice(0, 16);

export function createClient() {
  // Only an explicit key counts here: in CI it comes from the ANTHROPIC_API_KEY secret.
  return process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
}

/** One API call: facts in, { summary, narrative[] } out (validated). */
export async function writeNarrative(client, facts) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // Fall back to another model server-side if a safety classifier declines the request.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: zodOutputFormat(NarrativeSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: `Fakta o zápase:\n${JSON.stringify(facts, null, 2)}` }],
  });
  if (response.stop_reason === "refusal") throw new Error(`refused (${response.stop_details?.category ?? "no category"})`);
  if (response.stop_reason === "max_tokens") throw new Error("hit max_tokens");
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("no text in response");
  const parsed = NarrativeSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`invalid output: ${parsed.error.issues[0]?.message}`);
  return { ...parsed.data, usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } };
}
