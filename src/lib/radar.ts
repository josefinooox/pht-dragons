// Dračí radar v2 (/radar-novy): extra numbers on top of src/lib/brain.ts, all at build time.
// Game by game, the league around us, when goals fall, and one row per player.
import { leaders } from "./brain";
import { OUR, active, finals, forT, gameSlug, opp, reportFor, standings, team, type Result } from "./data";

/** Where v2 lives while it is tried out next to v1 (/radar). */
export const RADAR_ROOT = "radar-novy";

/** Our finished games in order, with shots when the match report has them. */
export const perGame = finals.map((g, k) => {
  const t = forT(g, OUR);
  const r = reportFor(g);
  const home = g.homeTeamId === OUR;
  const o = team(opp(g));
  return {
    n: k + 1,
    date: g.date,
    opponent: o.name,
    short: o.shortName ?? o.name.slice(0, 3).toUpperCase(),
    gf: t.f,
    ga: t.a,
    result: t.r as Result,
    slug: gameSlug(g),
    shotsFor: r ? (home ? r.shots.home : r.shots.away) : null,
    shotsAgainst: r ? (home ? r.shots.away : r.shots.home) : null,
  };
});

export const tally = {
  V: perGame.filter((g) => g.result === "V").length,
  R: perGame.filter((g) => g.result === "R").length,
  P: perGame.filter((g) => g.result === "P").length,
};

/** One metric across every team that has played: our value, rank, league average. */
export type LeagueMetric = {
  key: string;
  label: string;
  /** true when a higher value is better */
  higher: boolean;
  teams: { teamId: string; name: string; value: number }[];
  ours: number;
  rank: number;
  avg: number;
  count: number;
};
const metric = (key: "ppg" | "gfpg" | "gapg" | "pimpg", label: string, higher: boolean): LeagueMetric => {
  const teams = active.map((s) => ({ teamId: s.teamId, name: team(s.teamId).name, value: s[key] }));
  const sorted = [...teams].sort((a, b) => (higher ? b.value - a.value : a.value - b.value));
  const ours = teams.find((t) => t.teamId === OUR)?.value ?? 0;
  return {
    key,
    label,
    higher,
    teams,
    ours,
    rank: sorted.findIndex((t) => t.teamId === OUR) + 1,
    avg: teams.reduce((n, t) => n + t.value, 0) / Math.max(1, teams.length),
    count: teams.length,
  };
};
export const league = [
  metric("ppg", "Body na zápas", true),
  metric("gfpg", "Vstřelené góly na zápas", true),
  metric("gapg", "Obdržené góly na zápas", false),
  metric("pimpg", "Trestné minuty na zápas", false),
];
export const teamCount = standings.length;

/** Goals for / against in 5-minute slices of the 3 × 15 minutes. */
export const SLICE_MIN = 5;
export const GAME_MIN = 45;
export const goalTimeline = (() => {
  const bins = Array.from({ length: GAME_MIN / SLICE_MIN }, (_, i) => ({ from: i * SLICE_MIN, to: (i + 1) * SLICE_MIN, for: 0, against: 0 }));
  for (const g of finals) {
    const r = reportFor(g);
    if (!r) continue;
    for (const e of r.events) {
      if (e.type !== "goal") continue;
      const b = bins[Math.min(bins.length - 1, Math.floor(e.sec / 60 / SLICE_MIN))];
      e.teamId === OUR ? b.for++ : b.against++;
    }
  }
  return bins;
})();

/** One row per player who appeared in our lineups or stats this season. */
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
export const players = (() => {
  const rows = new Map<string, { name: string; number: number | null; games: number; goals: number; assists: number; points: number; stars: number; pim: number }>();
  const row = (p: { name: string; number: number | null }) => {
    const k = clean(p.name);
    const r = rows.get(k) ?? { name: k, number: p.number, games: 0, goals: 0, assists: 0, points: 0, stars: 0, pim: 0 };
    if (r.number == null) r.number = p.number;
    rows.set(k, r);
    return r;
  };
  for (const p of leaders.gamesPlayed) row(p).games = p.value;
  for (const p of leaders.goals) row(p).goals = p.value;
  for (const p of leaders.assists) row(p).assists = p.value;
  for (const p of leaders.points) row(p).points = p.value;
  for (const p of leaders.stars) row(p).stars = p.value;
  for (const p of leaders.penaltyMinutes) row(p).pim = p.value;
  return [...rows.values()];
})();

// Czech "z" / "ze" before a number as read aloud (ze sedmnácti, z pěti).
const z = (n: number) => `${(n >= 10 && n < 20 ? [12, 13, 14, 17].includes(n) : "2347".includes(String(n)[0])) ? "ze" : "z"} ${n}`;

/** League insight: our strongest and weakest side, in words (only when they differ clearly). */
export const leagueInsight = (() => {
  const [, attack, defense, discipline] = league;
  const sides = [
    { m: attack, good: "útok", text: (r: number) => `${r}. nejlepší útok` },
    { m: defense, good: "obrana", text: (r: number) => `${r}. nejlepší obrana` },
    { m: discipline, good: "disciplína", text: (r: number) => `${r}. nejukázněnější tým` },
  ].sort((a, b) => a.m.rank - b.m.rank);
  const best = sides[0];
  const worst = sides.at(-1)!;
  if (worst.m.rank - best.m.rank < 4) return null;
  return {
    text: `Silná stránka: ${best.text(best.m.rank)} ${z(best.m.count)}. Slabina: ${worst.good}, ${worst.m.rank}. místo.`,
  };
})();

/** Games split by who scored first, with each result (for result-chip runs). */
export const firstGoalGames = (() => {
  const us: { r: Result; score: string; date: string; opponent: string }[] = [];
  const them: typeof us = [];
  for (const g of finals) {
    const r = reportFor(g);
    const first = r?.events.filter((e) => e.type === "goal").sort((a, b) => a.sec - b.sec)[0];
    if (!first) continue;
    const t = forT(g, OUR);
    (first.teamId === OUR ? us : them).push({ r: t.r, score: `${t.f}:${t.a}`, date: g.date, opponent: team(opp(g)).name });
  }
  return { us, them };
})();
