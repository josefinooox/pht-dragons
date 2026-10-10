// Is one of our games on right now? Used by .github/workflows/live.yml to rebuild the site every
// 5 minutes during our games (otherwise the normal 30-minute schedule is enough).
// Window: from 5 minutes before the start until the result is in (status "finished"), capped at
// 3 hours after the start. Writes live=true|false to $GITHUB_OUTPUT (or prints it).
import { readFile, appendFile } from "node:fs/promises";

const games = JSON.parse(await readFile(new URL("../data/games.json", import.meta.url), "utf8"));
const { ourTeamId } = JSON.parse(await readFile(new URL("../data/meta.json", import.meta.url), "utf8"));
const now = Date.now();
const game = games.find((g) => {
  if (g.homeTeamId !== ourTeamId && g.awayTeamId !== ourTeamId) return false;
  if (g.status === "finished") return false;
  const start = Date.parse(g.start);
  return now >= start - 5 * 60e3 && now <= start + 180 * 60e3;
});
const line = `live=${game ? "true" : "false"}\n`;
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, line);
console.log(game ? `live: ${game.date} ${game.time} (${game.status})` : "no game of ours on right now");
