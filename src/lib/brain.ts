// "Dračí mozek": every number on the stats dashboard, computed at build time from /data
// (current season games + match reports, standings, and past seasons in data/history.json).
import historyJson from "../../data/history.json";
import { OUR, finals, forT, meta, opp, rankOf, reportFor, standingOf, team, type Game, type Result } from "./data";
import type { GoalEvent, PenaltyEvent, Report } from "./recap";

const POINTS: Record<Result, number> = { V: 2, R: 1, P: 0 };
const toMin = (clock: string | null) => {
  if (!clock) return 0;
  const [m, s] = clock.split(":").map(Number);
  return m + s / 60;
};

// ---------- current season ----------
const played = finals; // our finished games, oldest first
const reports = played.map((g) => ({ g, r: reportFor(g) })).filter((x): x is { g: Game; r: Report } => !!x.r);
const ours = (e: { teamId: string }) => e.teamId === OUR;

export const season = (() => {
  const res = played.map((g) => forT(g, OUR));
  const count = (k: Result) => res.filter((r) => r.r === k).length;
  const gf = res.reduce((n, r) => n + r.f, 0);
  const ga = res.reduce((n, r) => n + r.a, 0);
  return {
    name: meta.season.name.replace("-", "/"),
    games: played.length,
    wins: count("V"),
    draws: count("R"),
    losses: count("P"),
    gf,
    ga,
    points: standingOf(OUR)?.points ?? res.reduce((n, r) => n + POINTS[r.r], 0),
    rank: rankOf(OUR),
    teams: (meta as { counts?: { standings?: number } }).counts?.standings ?? null,
    gfPerGame: played.length ? gf / played.length : 0,
    gaPerGame: played.length ? ga / played.length : 0,
  };
})();

/** Cumulative points after each game, with the game for labels/tooltips. */
export const pointsTimeline = (() => {
  let total = 0;
  return played.map((g, i) => {
    const r = forT(g, OUR);
    total += POINTS[r.r];
    return { i: i + 1, g, result: r.r, score: `${r.f}:${r.a}`, opponent: team(opp(g)).name, total };
  });
})();

type Tally = { playerId: string; name: string; number: number | null; value: number };
function leaderboard(add: (bump: (p: { playerId: string; name: string; number: number | null } | null, v?: number) => void) => void) {
  const map = new Map<string, Tally>();
  add((p, v = 1) => {
    if (!p) return;
    const t = map.get(p.playerId) ?? { playerId: p.playerId, name: p.name, number: p.number, value: 0 };
    t.value += v;
    map.set(p.playerId, t);
  });
  return [...map.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "cs"));
}
const ourGoals = reports.flatMap(({ r }) => r.events.filter((e): e is GoalEvent => e.type === "goal" && ours(e)));
const ourPenalties = reports.flatMap(({ r }) => r.events.filter((e): e is PenaltyEvent => e.type === "penalty" && ours(e)));

export const leaders = {
  points: leaderboard((bump) => {
    for (const g of ourGoals) {
      bump(g.scorer);
      for (const a of g.assists) bump(a);
    }
  }),
  goals: leaderboard((bump) => ourGoals.forEach((g) => bump(g.scorer))),
  assists: leaderboard((bump) => ourGoals.forEach((g) => g.assists.forEach((a) => bump(a)))),
  penaltyMinutes: leaderboard((bump) => ourPenalties.forEach((p) => bump(p.player, toMin(p.duration)))),
  stars: leaderboard((bump) =>
    played.forEach((g) =>
      g.stars.filter(ours).forEach((s) => bump({ playerId: `${s.firstName} ${s.lastName}`, name: `${s.firstName} ${s.lastName}`, number: s.number })),
    ),
  ),
  gamesPlayed: leaderboard((bump) =>
    reports.forEach(({ r }) => (r.lineup ?? []).filter(ours).forEach((l) => bump(l))),
  ),
};

/** Goals for / against per period (1, 2, 3, OT). */
export const periods = (() => {
  const keys = ["1", "2", "3", "OT"];
  const rows = keys.map((k) => ({ key: k, label: k === "OT" ? "Prodl." : `${k}. třetina`, for: 0, against: 0 }));
  for (const { r } of reports)
    for (const e of r.events) {
      if (e.type !== "goal") continue;
      const row = rows.find((x) => x.key === e.period);
      if (row) ours(e) ? row.for++ : row.against++;
    }
  return rows.filter((x) => x.key !== "OT" || x.for + x.against > 0);
})();

/** Special teams, shooting and face-offs over games with a report. */
export const specialTeams = (() => {
  let ppGoals = 0, ppAgainst = 0, theirPen = 0, ourPen = 0, shots = 0, goals = 0, foWon = 0, foAll = 0;
  for (const { g, r } of reports) {
    const home = g.homeTeamId === OUR;
    for (const e of r.events) {
      if (e.type === "goal" && e.strength === "pp") ours(e) ? ppGoals++ : ppAgainst++;
      if (e.type === "penalty") ours(e) ? ourPen++ : theirPen++;
    }
    const s = home ? r.shots.home : r.shots.away;
    if (s != null) {
      shots += s;
      goals += forT(g, OUR).f;
    }
    const fo = home ? r.faceoffs.home : r.faceoffs.away;
    const foT = home ? r.faceoffs.away : r.faceoffs.home;
    if (fo != null && foT != null) {
      foWon += fo;
      foAll += fo + foT;
    }
  }
  const pct = (a: number, b: number) => (b ? (100 * a) / b : null);
  return {
    powerPlay: { pct: pct(ppGoals, theirPen), goals: ppGoals, chances: theirPen },
    penaltyKill: { pct: ourPen ? 100 - (100 * ppAgainst) / ourPen : null, against: ppAgainst, times: ourPen },
    shooting: { pct: pct(goals, shots), goals, shots },
    faceoffs: { pct: pct(foWon, foAll), won: foWon, all: foAll },
    pimPerGame: reports.length ? ourPenalties.reduce((n, p) => n + toMin(p.duration), 0) / reports.length : 0,
  };
})();

/** Results depending on who scored first. */
export const firstGoal = (() => {
  const tally = () => ({ V: 0, R: 0, P: 0, games: 0 });
  const us = tally();
  const them = tally();
  for (const { g, r } of reports) {
    const first = r.events.find((e) => e.type === "goal");
    if (!first) continue;
    const t = ours(first) ? us : them;
    t[forT(g, OUR).r]++;
    t.games++;
  }
  return { us, them };
})();

/** Assist → goal combinations among our players. */
export const assistPairs = (() => {
  const map = new Map<string, { from: string; to: string; count: number }>();
  for (const g of ourGoals)
    for (const a of g.assists) {
      if (!g.scorer) continue;
      const key = `${a.playerId}>${g.scorer.playerId}`;
      const p = map.get(key) ?? { from: a.name, to: g.scorer.name, count: 0 };
      p.count++;
      map.set(key, p);
    }
  return [...map.values()].sort((a, b) => b.count - a.count || a.to.localeCompare(b.to, "cs"));
})();

/** Our goalies: games where exactly one of our goalies was listed. */
export const goalies = (() => {
  const map = new Map<string, { name: string; number: number | null; games: number; against: number; saves: number; shutouts: number }>();
  for (const { g, r } of reports) {
    const gk = (r.lineup ?? []).filter((l) => ours(l) && l.position === "G");
    if (gk.length !== 1 || !r.saves) continue;
    const home = g.homeTeamId === OUR;
    const saves = home ? r.saves.home : r.saves.away;
    if (saves == null) continue;
    const against = forT(g, OUR).a;
    const t = map.get(gk[0].playerId) ?? { name: gk[0].name, number: gk[0].number, games: 0, against: 0, saves: 0, shutouts: 0 };
    t.games++;
    t.against += against;
    t.saves += saves;
    if (against === 0) t.shutouts++;
    map.set(gk[0].playerId, t);
  }
  return [...map.values()]
    .map((t) => ({ ...t, svPct: t.saves + t.against ? (100 * t.saves) / (t.saves + t.against) : null, gaa: t.against / t.games }))
    .sort((a, b) => b.games - a.games);
})();

// ---------- all seasons ----------
type HistGame = { gameId: string; date: string; homeTeamId: string; awayTeamId: string; homeName: string; awayName: string; homeGoals: number | null; awayGoals: number | null };
const history = historyJson as unknown as { seasons: Record<string, { name: string; startDate: string; games: HistGame[] }> };

const allGames = [
  ...Object.values(history.seasons).flatMap((s) => s.games.map((g) => ({ ...g, season: s.name }))),
  ...played.map((g) => ({
    gameId: g.gameId,
    date: g.date,
    homeTeamId: g.homeTeamId,
    awayTeamId: g.awayTeamId,
    homeName: team(g.homeTeamId).name,
    awayName: team(g.awayTeamId).name,
    homeGoals: g.homeGoals,
    awayGoals: g.awayGoals,
    season: meta.season.name,
  })),
].filter((g) => g.homeGoals != null && g.awayGoals != null);

const perspective = (g: (typeof allGames)[number]) => {
  const home = g.homeTeamId === OUR;
  const f = (home ? g.homeGoals : g.awayGoals)!;
  const a = (home ? g.awayGoals : g.homeGoals)!;
  return { f, a, r: (f > a ? "V" : f < a ? "P" : "R") as Result, oppId: home ? g.awayTeamId : g.homeTeamId, oppName: home ? g.awayName : g.homeName };
};

export const allTime = (() => {
  const res = allGames.map((g) => ({ g, ...perspective(g) }));
  const seasons = [...new Set(allGames.map((g) => g.season))];
  const bySeason = seasons.map((name) => {
    const rs = res.filter((x) => x.g.season === name);
    const w = rs.filter((x) => x.r === "V").length;
    return { name: name.replace("-", "/"), games: rs.length, wins: w, draws: rs.filter((x) => x.r === "R").length, losses: rs.filter((x) => x.r === "P").length, gf: rs.reduce((n, x) => n + x.f, 0), ga: rs.reduce((n, x) => n + x.a, 0), winPct: rs.length ? (100 * w) / rs.length : 0 };
  });
  const byDiff = [...res].sort((a, b) => b.f - b.a - (a.f - a.a) || b.f - a.f);
  return {
    seasons: seasons.length,
    games: res.length,
    wins: res.filter((x) => x.r === "V").length,
    draws: res.filter((x) => x.r === "R").length,
    losses: res.filter((x) => x.r === "P").length,
    gf: res.reduce((n, x) => n + x.f, 0),
    ga: res.reduce((n, x) => n + x.a, 0),
    bySeason,
    biggestWin: byDiff[0] && byDiff[0].f > byDiff[0].a ? { score: `${byDiff[0].f}:${byDiff[0].a}`, opponent: byDiff[0].oppName, date: byDiff[0].g.date } : null,
    biggestLoss: byDiff.at(-1) && byDiff.at(-1)!.f < byDiff.at(-1)!.a ? { score: `${byDiff.at(-1)!.f}:${byDiff.at(-1)!.a}`, opponent: byDiff.at(-1)!.oppName, date: byDiff.at(-1)!.g.date } : null,
  };
})();

/** Head-to-head against every opponent over all seasons, best goal difference first. */
export const headToHead = (() => {
  const map = new Map<string, { teamId: string; name: string; games: number; V: number; R: number; P: number; gf: number; ga: number }>();
  for (const g of allGames) {
    const p = perspective(g);
    const t = map.get(p.oppId) ?? { teamId: p.oppId, name: p.oppName, games: 0, V: 0, R: 0, P: 0, gf: 0, ga: 0 };
    t.name = p.oppName; // latest name wins (games are oldest first)
    t.games++;
    t[p.r]++;
    t.gf += p.f;
    t.ga += p.a;
    map.set(p.oppId, t);
  }
  return [...map.values()].map((t) => ({ ...t, diff: t.gf - t.ga })).sort((a, b) => b.diff - a.diff || b.V - a.V || a.name.localeCompare(b.name, "cs"));
})();

/** Players who appeared in our lineups this season (from match reports). */
export const rosterSize = new Set(reports.flatMap(({ r }) => (r.lineup ?? []).filter(ours).map((l) => l.playerId))).size;
export const reportCount = reports.length;
