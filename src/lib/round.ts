// "Týden v lize": facts about the latest week (Monday–Sunday) of our group, for the Tabulka page.
// Pure function over the data, so the site and scripts/narratives.mjs (AI text) share it.
// Facts are computed here; the AI text (or the template below) only phrases them.
import { createHash } from "node:crypto";

/** Bump when the round prompt (ROUND_SYSTEM in scripts/lib/narrate.mjs) changes. */
export const ROUND_PROMPT_VERSION = 1;
/** Cache key of a week's text: changes whenever the facts do (e.g. a new result). */
export const roundKey = (facts: unknown) =>
  createHash("sha256").update(JSON.stringify({ facts, prompt: ROUND_PROMPT_VERSION, kind: "round" })).digest("hex").slice(0, 16);

type G = { gameId: string; date: string; status: string; homeTeamId: string; awayTeamId: string; homeGoals: number | null; awayGoals: number | null };
type T = { teamId: string; name: string };
type Row = { teamId: string; rank: number; points: number; played: number };

const MONTHS = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => ymd(new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5));
/** Monday of the week containing date (yyyy-mm-dd). */
const monday = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
const dm = (date: string) => {
  const [, m, d] = date.split("-").map(Number);
  return { d, m };
};
const weekLabel = (from: string, to: string) => {
  const a = dm(from);
  const b = dm(to);
  return a.m === b.m ? `${a.d}.–${b.d}. ${MONTHS[b.m - 1]}` : `${a.d}. ${MONTHS[a.m - 1]} – ${b.d}. ${MONTHS[b.m - 1]}`;
};

/** Table from results (2 points a win, 1 a draw): points, then goal difference, then goals. */
function table(games: G[], teamIds: string[]) {
  const t = new Map(teamIds.map((id) => [id, { teamId: id, points: 0, gf: 0, ga: 0, played: 0 }]));
  for (const g of games) {
    const h = t.get(g.homeTeamId);
    const a = t.get(g.awayTeamId);
    if (!h || !a || g.homeGoals == null || g.awayGoals == null) continue;
    h.played++;
    a.played++;
    h.gf += g.homeGoals;
    h.ga += g.awayGoals;
    a.gf += g.awayGoals;
    a.ga += g.homeGoals;
    if (g.homeGoals > g.awayGoals) h.points += 2;
    else if (g.homeGoals < g.awayGoals) a.points += 2;
    else {
      h.points++;
      a.points++;
    }
  }
  const sorted = [...t.values()].sort((x, y) => y.points - x.points || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf);
  return new Map(sorted.map((r, i) => [r.teamId, { ...r, rank: i + 1 }]));
}

export function roundFacts(games: G[], teams: T[], standings: Row[], ourId: string, groupName: string) {
  const finished = games.filter((g) => g.status === "finished" && g.homeGoals != null && g.awayGoals != null);
  if (!finished.length) return null;
  const last = finished.map((g) => g.date).sort().at(-1)!;
  const from = monday(last);
  const to = addDays(from, 6);
  const week = finished.filter((g) => g.date >= from && g.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const nameOf = (id: string) => teams.find((t) => t.teamId === id)?.name ?? "?";
  const ids = standings.map((r) => r.teamId);
  const before = table(finished.filter((g) => g.date < from), ids);
  const after = table(finished.filter((g) => g.date <= to), ids);

  const results = week.map((g) => {
    const hg = g.homeGoals!;
    const ag = g.awayGoals!;
    const winner = hg === ag ? null : hg > ag ? g.homeTeamId : g.awayTeamId;
    const loser = winner === g.homeTeamId ? g.awayTeamId : winner ? g.homeTeamId : null;
    return {
      date: g.date,
      home: nameOf(g.homeTeamId),
      away: nameOf(g.awayTeamId),
      score: `${hg}:${ag}`,
      winner: winner ? nameOf(winner) : null,
      margin: Math.abs(hg - ag),
      goals: hg + ag,
      // places in the table before this week (only meaningful once teams have played)
      winnerRankBefore: winner && before.get(winner)?.played ? before.get(winner)!.rank : null,
      loserRankBefore: loser && before.get(loser)?.played ? before.get(loser)!.rank : null,
      ours: g.homeTeamId === ourId || g.awayTeamId === ourId,
      _w: winner,
    };
  });
  const biggestWin = [...results].filter((r) => r.winner).sort((a, b) => b.margin - a.margin || b.goals - a.goals)[0];
  const upsets = results.filter((r) => r.winnerRankBefore && r.loserRankBefore && r.winnerRankBefore - r.loserRankBefore >= 4);
  const movers = ids
    .map((id) => ({ team: nameOf(id), from: before.get(id)!.rank, to: after.get(id)!.rank, played: before.get(id)!.played }))
    .filter((m) => m.played > 0 && Math.abs(m.from - m.to) >= 2)
    .sort((a, b) => b.from - b.to - (a.from - a.to));
  const leaderNow = standings.find((r) => r.rank === 1);
  const leaderBefore = [...before.values()].find((r) => r.rank === 1 && r.played > 0);
  const ourRow = standings.find((r) => r.teamId === ourId);
  const ourGames = results
    .filter((r) => r.ours)
    .map((r) => {
      const g = week.find((x) => x.date === r.date && (x.homeTeamId === ourId || x.awayTeamId === ourId))!;
      const home = g.homeTeamId === ourId;
      const f = home ? g.homeGoals! : g.awayGoals!;
      const a = home ? g.awayGoals! : g.homeGoals!;
      return { opponent: nameOf(home ? g.awayTeamId : g.homeTeamId), score: `${f}:${a}`, result: f > a ? "výhra" : f < a ? "prohra" : "remíza" };
    });

  return {
    key: from,
    week: { from, to, label: weekLabel(from, to) },
    group: groupName,
    games: results.map(({ _w, ...r }) => r),
    goalsTotal: results.reduce((n, r) => n + r.goals, 0),
    biggestWin: biggestWin ? { winner: biggestWin.winner, score: biggestWin.score, home: biggestWin.home, away: biggestWin.away } : null,
    upsets: upsets.map((u) => ({ winner: u.winner, winnerRankBefore: u.winnerRankBefore, loserRankBefore: u.loserRankBefore, home: u.home, away: u.away, score: u.score })),
    movers: movers.slice(0, 3),
    leader: leaderNow ? { team: nameOf(leaderNow.teamId), points: leaderNow.points, played: leaderNow.played, changed: !!leaderBefore && leaderBefore.teamId !== leaderNow.teamId } : null,
    us: { games: ourGames, rank: ourRow?.rank ?? null, points: ourRow?.points ?? null, teams: standings.length },
  };
}
export type RoundFacts = NonNullable<ReturnType<typeof roundFacts>>;

const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

/** Template text from the facts, shown until (or instead of) the AI text. */
export function roundTemplate(f: RoundFacts) {
  const s: string[] = [];
  s.push(`Za týden ${f.week.label} se ve skupině ${f.group} odehrálo ${f.games.length} ${plural(f.games.length, "zápas", "zápasy", "zápasů")} a padlo ${f.goalsTotal} ${plural(f.goalsTotal, "gól", "góly", "gólů")}.`);
  if (f.biggestWin) s.push(`Nejvýraznější výhru si připsal tým ${f.biggestWin.winner} (${f.biggestWin.home} – ${f.biggestWin.away} ${f.biggestWin.score}).`);
  if (f.upsets[0]) s.push(`Překvapení: ${f.upsets[0].winner} z ${f.upsets[0].winnerRankBefore}. místa porazil tým z ${f.upsets[0].loserRankBefore}. místa.`);
  if (f.leader) s.push(`${f.leader.changed ? "Nový lídr" : "Na čele zůstává"}: ${f.leader.team} s ${f.leader.points} ${plural(f.leader.points, "bodem", "body", "body")}.`);
  if (f.us.games.length) s.push(`My: ${f.us.games.map((g) => `${g.result} ${g.score} s týmem ${g.opponent}`).join(", ")}${f.us.rank ? `, teď jsme ${f.us.rank}.` : "."}`);
  else if (f.us.rank) s.push(`My jsme tento týden nehráli a držíme ${f.us.rank}. místo.`);
  return s.join(" ");
}
