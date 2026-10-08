// Data model built from /data at build time. Logic ported from docs/prototype-reference.html.
import teamsJson from "../../data/teams.json";
import gamesJson from "../../data/games.json";
import standingsJson from "../../data/standings.json";
import metaJson from "../../data/meta.json";
import mediaJson from "../../data/media.json";
import reportsJson from "../../data/reports.json";
import type { Report } from "./recap";

export type Status = "scheduled" | "running" | "finished";
export type Result = "V" | "R" | "P";
/** final: has a result; live: in progress; pending: should be over, no result yet; upcoming: not started. */
export type State = "final" | "live" | "pending" | "upcoming";

export interface Team {
  teamId: string;
  name: string;
  shortName: string | null;
  logo: string | null;
}
export interface Star {
  teamId: string;
  number: number | null;
  firstName: string;
  lastName: string;
}
export interface Game {
  gameId: string;
  date: string; // YYYY-MM-DD, Prague
  time: string; // HH:MM, Prague
  start: string; // ISO with offset
  status: Status;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number | null;
  awayGoals: number | null;
  venue: string | null;
  stars: Star[];
}
export interface StandingRow {
  rank: number;
  teamId: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  penaltyMinutes: number;
}

export interface Media {
  photos: { thumb: string; large: string }[];
  video: string | null; // YouTube video ID
}

export const GAME_MIN = 90; // how long after the start a game counts as in progress
export const SRAZ_MIN = 30; // team meets 30 min before the start
export const FRESH_H = 20; // how long after a game its result stays on top of the schedule

export const meta = metaJson;
export const OUR = meta.ourTeamId;
export const teams = teamsJson as Team[];
export const games = gamesJson as Game[];
export const standings = standingsJson as StandingRow[];

/** Build time; NOW=2026-10-07T09:00 overrides it for testing states. */
export const NOW = process.env.NOW ? new Date(process.env.NOW) : new Date();

const mediaById = mediaJson as Record<string, Media>;
/** Photos + video of one of our finished games, if the league published any. */
export const mediaFor = (g: Game): Media | undefined => {
  const m = mediaById[g.gameId];
  return m && (m.photos.length || m.video) ? m : undefined;
};

const reportById = reportsJson as unknown as Record<string, Report>;
/** Goals, penalties and stats of one of our finished games, if fetched. */
export const reportFor = (g: Game): Report | undefined => reportById[g.gameId];

const teamById = new Map(teams.map((t) => [t.teamId, t]));
export const team = (id: string): Team =>
  teamById.get(id) ?? { teamId: id, name: "Neznámý tým", shortName: null, logo: null };
const rowById = new Map(standings.map((r) => [r.teamId, r]));
export const standingOf = (id: string) => rowById.get(id);
export const rankOf = (id: string) => rowById.get(id)?.rank ?? null;

export const isFinal = (g: Game) => g.status === "finished" && g.homeGoals !== null && g.awayGoals !== null;
export const involves = (g: Game, t: string) => g.homeTeamId === t || g.awayTeamId === t;
export const opp = (g: Game, t: string = OUR) => (g.homeTeamId === t ? g.awayTeamId : g.homeTeamId);
export function forT(g: Game, t: string) {
  const home = g.homeTeamId === t;
  const f = (home ? g.homeGoals : g.awayGoals) ?? 0;
  const a = (home ? g.awayGoals : g.homeGoals) ?? 0;
  const r: Result = f > a ? "V" : f < a ? "P" : "R";
  return { f, a, r };
}
export function state(g: Game, now: Date = NOW): State {
  if (isFinal(g)) return "final";
  const m = (now.getTime() - Date.parse(g.start)) / 60_000;
  if (g.status === "running" || (m >= 0 && m < GAME_MIN)) return "live";
  return m < 0 ? "upcoming" : "pending";
}

/** Finished games of a team, oldest first. */
export const played = (t: string) => games.filter((g) => isFinal(g) && involves(g, t));

export const mine = games.filter((g) => involves(g, OUR));
export const finals = mine.filter(isFinal);
export const pending = mine.filter((g) => state(g) === "pending");
export const ahead = mine.filter((g) => ["upcoming", "live"].includes(state(g)));
export const heroGame: Game | undefined = ahead[0];
export const lastFinal: Game | undefined = finals[finals.length - 1];

// ---- per-game team stats from the standings ----
export interface Stats {
  teamId: string;
  gp: number;
  pts: number;
  gf: number;
  ga: number;
  ppg: number;
  gfpg: number;
  gapg: number;
  pimpg: number;
}
const statsById = new Map<string, Stats>(
  standings.map((r) => {
    const gp = r.played;
    const per = (x: number) => (gp ? x / gp : 0);
    return [
      r.teamId,
      {
        teamId: r.teamId,
        gp,
        pts: r.points,
        gf: r.goalsFor,
        ga: r.goalsAgainst,
        ppg: per(r.points),
        gfpg: per(r.goalsFor),
        gapg: per(r.goalsAgainst),
        pimpg: per(r.penaltyMinutes),
      },
    ];
  }),
);
export const stats = (t: string): Stats =>
  statsById.get(t) ?? { teamId: t, gp: 0, pts: 0, gf: 0, ga: 0, ppg: 0, gfpg: 0, gapg: 0, pimpg: 0 };
export const active = [...statsById.values()].filter((s) => s.gp > 0);
const rankBy = (key: "gfpg" | "gapg" | "pimpg", desc = true) => {
  const sorted = [...active].sort((x, y) => (desc ? y[key] - x[key] : x[key] - y[key]));
  return (t: string) => sorted.findIndex((s) => s.teamId === t) + 1;
};
export const attackRank = rankBy("gfpg");
export const defenseRank = rankBy("gapg", false);
export const pimRank = rankBy("pimpg");

// ---- URLs ----
export const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// yyyy-mm-dd-opponent-slug; suffix only if two of our games would collide.
const slugByGameId = new Map<string, string>();
for (const g of mine) {
  const baseSlug = `${g.date}-${slugify(team(opp(g)).name)}`;
  let s = baseSlug;
  for (let n = 2; [...slugByGameId.values()].includes(s); n++) s = `${baseSlug}-${n}`;
  slugByGameId.set(g.gameId, s);
}
export const gameSlug = (g: Game) => slugByGameId.get(g.gameId)!;

/** Our nearest unfinished game against a team, else the last one played. */
export function teamTarget(t: string): Game | undefined {
  const vs = mine.filter((g) => opp(g) === t);
  return vs.find((g) => !isFinal(g)) ?? vs[vs.length - 1];
}

/** Opponents both teams have played (finished games), with those games. */
export function commonOpponents(o: string) {
  const theirs = played(o);
  const out: { x: string; us: Game[]; them: Game[] }[] = [];
  for (const row of standings) {
    const x = row.teamId;
    if (x === OUR || x === o) continue;
    const us = finals.filter((g) => opp(g) === x);
    const them = theirs.filter((g) => opp(g, o) === x);
    if (us.length && them.length) out.push({ x, us, them });
  }
  return out;
}
