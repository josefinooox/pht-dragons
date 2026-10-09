// Opponent's productive players (goals + assists) this season, from the reports of every game
// of the group: data/league-reports.json (other teams' games, slim) and data/reports.json (ours).
import leagueReportsJson from "../../data/league-reports.json";
import { games, isFinal, involves, reportFor } from "./data";

type P = { playerId: string; name: string; number: number | null };
type Slim = { complete: boolean; goals: { teamId: string; scorer: P | null; assists: (P | null)[] }[]; lineup: (P & { teamId: string; position: string | null })[] };
const league = leagueReportsJson as unknown as Record<string, Slim>;

const slimOf = (gameId: string): Slim | undefined => {
  if (league[gameId]) return league[gameId];
  const g = games.find((x) => x.gameId === gameId);
  const r = g && reportFor(g);
  if (!r) return undefined;
  return {
    complete: r.complete,
    goals: r.events.flatMap((e) => (e.type === "goal" ? [{ teamId: e.teamId, scorer: e.scorer, assists: e.assists }] : [])),
    lineup: r.lineup ?? [],
  };
};

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Top players of a team by points (goals + assists), plus how many of its games are covered. */
export function topScorers(teamId: string, limit = 5) {
  const played = games.filter((g) => isFinal(g) && involves(g, teamId));
  const rows = new Map<string, { name: string; number: number | null; games: number; goals: number; assists: number }>();
  const get = (p: P) => {
    const r = rows.get(p.playerId) ?? { name: clean(p.name), number: p.number, games: 0, goals: 0, assists: 0 };
    if (r.number == null) r.number = p.number;
    rows.set(p.playerId, r);
    return r;
  };
  let covered = 0;
  for (const g of played) {
    const r = slimOf(g.gameId);
    if (!r) continue;
    covered++;
    for (const l of r.lineup) if (l.teamId === teamId && l.position !== "G") get(l).games++;
    for (const goal of r.goals) {
      if (goal.teamId !== teamId) continue;
      if (goal.scorer) get(goal.scorer).goals++;
      for (const a of goal.assists) if (a) get(a).assists++;
    }
  }
  const list = [...rows.values()]
    .map((r) => ({ ...r, points: r.goals + r.assists }))
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points || b.goals - a.goals || a.name.localeCompare(b.name, "cs"));
  const teamGoals = list.reduce((n, r) => n + r.goals, 0);
  return { players: list.slice(0, limit), covered, games: played.length, teamGoals };
}
