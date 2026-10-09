// Match narratives written in Claude Code (covered by the subscription) instead of the paid API.
//
//   npm run narratives:pending            -> JSON: writing rules + facts of played games without a current
//                                            text, and of the latest week of the group ("round:<monday>")
//   npm run narratives:save -- FILE.json  -> validate texts ({ id: { summary, narrative[] } }) and store them
//
// Uses the same facts, rules and cache key as the API path (scripts/lib/narrate.mjs), so the
// build never rewrites a text saved here. Run `npm run fetch` first so data/ is current.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NarrativeSchema, ROUND_SYSTEM, SYSTEM, narrativeKey } from "./lib/narrate.mjs";
import { roundFacts, roundKey } from "../src/lib/round.ts";
import { matchFacts } from "../src/lib/recap.ts";
import { longDate } from "../src/lib/format.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = async (f) => JSON.parse(await readFile(path.join(root, "data", f), "utf8"));
const [games, teams, reports, meta, standings] = await Promise.all(["games.json", "teams.json", "reports.json", "meta.json", "standings.json"].map(read));
const narrativesFile = path.join(root, "data", "narratives.json");
const narratives = JSON.parse(await readFile(narrativesFile, "utf8").catch(() => "{}"));
const OUR = meta.ourTeamId;
const nameOf = (id) => teams.find((t) => t.teamId === id)?.name ?? "soupeř";

/** Played games of ours that have a report, with their facts and cache key. */
function played() {
  return games
    .filter((g) => g.status === "finished" && reports[g.gameId] && (g.homeTeamId === OUR || g.awayTeamId === OUR))
    .map((g) => {
      const facts = matchFacts(g, reports[g.gameId], OUR, {
        ourName: nameOf(OUR),
        opponentName: nameOf(g.homeTeamId === OUR ? g.awayTeamId : g.homeTeamId),
        dateText: longDate(g.date),
        competition: `${meta.competition.name}, skupina ${meta.group.name}, ${meta.phase.name.toLowerCase()}`,
      });
      return { gameId: g.gameId, facts, key: narrativeKey(facts) };
    });
}

/** The latest week of the group ("Týden v lize" on the Tabulka page). */
function round() {
  const facts = roundFacts(games, teams, standings, OUR, meta.group.name);
  return facts ? { id: `round:${facts.key}`, facts, key: roundKey(facts) } : null;
}

const [cmd, file] = process.argv.slice(2);
if (cmd === "pending") {
  const pending = played().filter((p) => narratives[p.gameId]?.key !== p.key);
  console.log(
    JSON.stringify(
      {
        instructions: SYSTEM,
        output: 'Save as { "<gameId>": { "summary": "...", "narrative": ["odstavec", ...] } } and run npm run narratives:save -- <file>',
        pending: pending.map(({ gameId, facts }) => ({ gameId, facts })),
        // the weekly summary has its own rules; save it in the same file under its id
        rounds: (() => {
          const r = round();
          const todo = r && narratives[r.id]?.key !== r.key ? [{ id: r.id, facts: r.facts }] : [];
          return {
            instructions: ROUND_SYSTEM,
            output: 'Add to the same file as { "<id>": { "summary": "...", "narrative": ["odstavec", ...] } }',
            pending: todo,
          };
        })(),
      },
      null,
      2,
    ),
  );
} else if (cmd === "save" && file) {
  const input = JSON.parse(await readFile(path.resolve(file), "utf8"));
  const byId = new Map(played().map((p) => [p.gameId, p]));
  const r = round();
  if (r) byId.set(r.id, { gameId: r.id, key: r.key });
  let saved = 0;
  for (const [gameId, text] of Object.entries(input)) {
    const game = byId.get(gameId);
    if (!game) throw new Error(`${gameId}: not one of our played games with a report, nor the current round`);
    const parsed = NarrativeSchema.safeParse(text);
    if (!parsed.success) throw new Error(`${gameId}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    narratives[gameId] = { key: game.key, model: "claude-code", generatedAt: new Date().toISOString(), ...parsed.data };
    saved++;
  }
  const sorted = Object.fromEntries(Object.keys(narratives).sort().map((id) => [id, narratives[id]]));
  await writeFile(narrativesFile, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`saved ${saved} narrative(s) to data/narratives.json`);
} else {
  console.error("usage: node scripts/narratives.mjs pending | save <file.json>");
  process.exit(1);
}
