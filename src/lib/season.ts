// One season of Dragons Intelligence, computed the same way for the current season (data/games.json,
// reports.json, standings.json) and for past ones (data/history.json, history-reports.json).
// Everything is build time; pages pick a season and render its numbers.
import historyJson from "../../data/history.json";
import historyReportsJson from "../../data/history-reports.json";
import { OUR, finals, gameSlug, meta, reportFor, standings, team, type Result } from "./data";
import { plural } from "./format";
import type { GoalEvent, PenaltyEvent, Report } from "./recap";

// ---------- input ----------
type SGame = {
  gameId: string;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  homeGoals: number;
  awayGoals: number;
  oppName: string;
  oppShort: string;
  /** match page, current season only */
  slug: string | null;
};
type SRow = { rank: number; teamId: string; name: string; played: number; points: number; goalsFor: number; goalsAgainst: number; penaltyMinutes: number };
type SeasonInput = { key: string; name: string; current: boolean; group: string; games: SGame[]; report: (id: string) => Report | undefined; rows: SRow[] };

// ---------- helpers ----------
const POINTS: Record<Result, number> = { V: 2, R: 1, P: 0 };
const toMin = (clock: string | null) => {
  if (!clock) return 0;
  const [m, s] = clock.split(":").map(Number);
  return m + s / 60;
};
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
// Czech "z" / "ze" before a number as it is read aloud (ze dvou, ze tří, ze sedmi, z pěti).
export const z = (n: number) => `${(n >= 10 && n < 20 ? [12, 13, 14, 17].includes(n) : "2347".includes(String(n)[0])) ? "ze" : "z"} ${n}`;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Record in words, zeros left out: "3 výhry a 1 prohra", "2 výhry, 1 remíza a 1 prohra".
 *  Never "3–0–1": with three periods that format reads like a score. */
export const recordText = (t: { V: number; R: number; P: number }) => {
  const parts = [
    t.V && `${t.V} ${plural(t.V, "výhra", "výhry", "výher")}`,
    t.R && `${t.R} ${plural(t.R, "remíza", "remízy", "remíz")}`,
    t.P && `${t.P} ${plural(t.P, "prohra", "prohry", "proher")}`,
  ].filter(Boolean) as string[];
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} a ${parts.at(-1)}` : (parts[0] ?? "bez zápasu");
};
export type InsightText = { big?: string; text: string };
export type Tally = { playerId: string; name: string; number: number | null; value: number };
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
export const SLICE_MIN = 5;
export const GAME_MIN = 45;

// ---------- one season ----------
function buildSeason(s: SeasonInput) {
  const ours = (e: { teamId: string }) => e.teamId === OUR;
  const past = !s.current;
  const games = [...s.games].sort((a, b) => a.date.localeCompare(b.date));
  const res = (g: SGame) => {
    const home = g.homeTeamId === OUR;
    const f = home ? g.homeGoals : g.awayGoals;
    const a = home ? g.awayGoals : g.homeGoals;
    return { f, a, r: (f > a ? "V" : f < a ? "P" : "R") as Result, home };
  };
  const reports = games.map((g) => ({ g, r: s.report(g.gameId) })).filter((x): x is { g: SGame; r: Report } => !!x.r);
  const ourGoals = reports.flatMap(({ r }) => r.events.filter((e): e is GoalEvent => e.type === "goal" && ours(e)));
  const ourPenalties = reports.flatMap(({ r }) => r.events.filter((e): e is PenaltyEvent => e.type === "penalty" && ours(e)));

  // game by game
  const perGame = games.map((g, k) => {
    const t = res(g);
    const r = s.report(g.gameId);
    return {
      n: k + 1,
      date: g.date,
      opponent: g.oppName,
      short: g.oppShort,
      gf: t.f,
      ga: t.a,
      result: t.r,
      slug: g.slug,
      shotsFor: r ? (t.home ? r.shots.home : r.shots.away) : null,
      shotsAgainst: r ? (t.home ? r.shots.away : r.shots.home) : null,
    };
  });
  const tally = { V: perGame.filter((g) => g.result === "V").length, R: perGame.filter((g) => g.result === "R").length, P: perGame.filter((g) => g.result === "P").length };
  const gf = perGame.reduce((n, g) => n + g.gf, 0);
  const ga = perGame.reduce((n, g) => n + g.ga, 0);
  const row = s.rows.find((r) => r.teamId === OUR);
  const summary = {
    games: perGame.length,
    wins: tally.V,
    draws: tally.R,
    losses: tally.P,
    gf,
    ga,
    points: row?.points ?? perGame.reduce((n, g) => n + POINTS[g.result], 0),
    /** games behind the table points (regular season only; playoff games aren't in the table) */
    tableGames: row?.played ?? perGame.length,
    rank: row?.rank ?? null,
    teams: s.rows.length,
    gfPerGame: perGame.length ? gf / perGame.length : 0,
    gaPerGame: perGame.length ? ga / perGame.length : 0,
  };
  let total = 0;
  const pointsTimeline = perGame.map((g) => {
    total += POINTS[g.result];
    return { i: g.n, result: g.result, score: `${g.gf}:${g.ga}`, opponent: g.opponent, total };
  });

  // players
  const board = (add: (bump: (p: { playerId: string; name: string; number: number | null } | null, v?: number) => void) => void) => {
    const map = new Map<string, Tally>();
    add((p, v = 1) => {
      if (!p) return;
      const t = map.get(p.playerId) ?? { playerId: p.playerId, name: clean(p.name), number: p.number, value: 0 };
      t.value += v;
      map.set(p.playerId, t);
    });
    return [...map.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "cs"));
  };
  const leaders = {
    points: board((bump) => ourGoals.forEach((g) => [g.scorer, ...g.assists].forEach((p) => bump(p)))),
    goals: board((bump) => ourGoals.forEach((g) => bump(g.scorer))),
    assists: board((bump) => ourGoals.forEach((g) => g.assists.forEach((a) => bump(a)))),
    penaltyMinutes: board((bump) => ourPenalties.forEach((p) => bump(p.player, toMin(p.duration)))),
    stars: board((bump) => reports.forEach(({ r }) => r.stars.filter(ours).forEach((x) => bump(x)))),
    gamesPlayed: board((bump) => reports.forEach(({ r }) => (r.lineup ?? []).filter(ours).forEach((l) => bump(l)))),
  };
  const players = (() => {
    const rows = new Map<string, { name: string; number: number | null; games: number; goals: number; assists: number; points: number; stars: number; pim: number }>();
    const get = (p: Tally) => {
      const r = rows.get(p.playerId) ?? { name: p.name, number: p.number, games: 0, goals: 0, assists: 0, points: 0, stars: 0, pim: 0 };
      if (r.number == null) r.number = p.number;
      rows.set(p.playerId, r);
      return r;
    };
    for (const p of leaders.gamesPlayed) get(p).games = p.value;
    for (const p of leaders.goals) get(p).goals = p.value;
    for (const p of leaders.assists) get(p).assists = p.value;
    for (const p of leaders.points) get(p).points = p.value;
    for (const p of leaders.stars) get(p).stars = p.value;
    for (const p of leaders.penaltyMinutes) get(p).pim = p.value;
    return [...rows.values()];
  })();
  const assistPairs = (() => {
    const map = new Map<string, { from: string; to: string; count: number }>();
    for (const g of ourGoals)
      for (const a of g.assists) {
        if (!g.scorer) continue;
        const key = `${a.playerId}>${g.scorer.playerId}`;
        const p = map.get(key) ?? { from: clean(a.name), to: clean(g.scorer.name), count: 0 };
        p.count++;
        map.set(key, p);
      }
    return [...map.values()].sort((a, b) => b.count - a.count || a.to.localeCompare(b.to, "cs"));
  })();
  const goalies = (() => {
    const map = new Map<string, { name: string; number: number | null; games: number; against: number; saves: number; shutouts: number }>();
    for (const { g, r } of reports) {
      const gk = (r.lineup ?? []).filter((l) => ours(l) && l.position === "G");
      if (gk.length !== 1 || !r.saves) continue;
      const t = res(g);
      const saves = t.home ? r.saves.home : r.saves.away;
      if (saves == null) continue;
      const x = map.get(gk[0].playerId) ?? { name: clean(gk[0].name), number: gk[0].number, games: 0, against: 0, saves: 0, shutouts: 0 };
      x.games++;
      x.against += t.a;
      x.saves += saves;
      if (t.a === 0) x.shutouts++;
      map.set(gk[0].playerId, x);
    }
    return [...map.values()]
      .map((x) => ({ ...x, svPct: x.saves + x.against ? (100 * x.saves) / (x.saves + x.against) : null, gaa: x.against / x.games }))
      .sort((a, b) => b.games - a.games);
  })();
  const rosterSize = new Set(reports.flatMap(({ r }) => (r.lineup ?? []).filter(ours).map((l) => l.playerId))).size;

  // the game
  const periods = (() => {
    const rows = ["1", "2", "3", "OT"].map((k) => ({ key: k, label: k === "OT" ? "Prodl." : `${k}. třetina`, for: 0, against: 0 }));
    for (const { r } of reports)
      for (const e of r.events) {
        if (e.type !== "goal") continue;
        const x = rows.find((y) => y.key === e.period);
        if (x) ours(e) ? x.for++ : x.against++;
      }
    return rows.filter((x) => x.key !== "OT" || x.for + x.against > 0);
  })();
  const goalTimeline = (() => {
    const bins = Array.from({ length: GAME_MIN / SLICE_MIN }, (_, i) => ({ from: i * SLICE_MIN, to: (i + 1) * SLICE_MIN, for: 0, against: 0 }));
    for (const { r } of reports)
      for (const e of r.events) {
        if (e.type !== "goal") continue;
        const b = bins[Math.min(bins.length - 1, Math.floor(e.sec / 60 / SLICE_MIN))];
        ours(e) ? b.for++ : b.against++;
      }
    return bins;
  })();
  const specialTeams = (() => {
    let ppGoals = 0, ppAgainst = 0, theirPen = 0, ourPen = 0, shots = 0, goals = 0, foWon = 0, foAll = 0;
    for (const { g, r } of reports) {
      const t = res(g);
      for (const e of r.events) {
        if (e.type === "goal" && e.strength === "pp") ours(e) ? ppGoals++ : ppAgainst++;
        if (e.type === "penalty") ours(e) ? ourPen++ : theirPen++;
      }
      const sh = t.home ? r.shots.home : r.shots.away;
      if (sh != null) {
        shots += sh;
        goals += t.f;
      }
      const fo = t.home ? r.faceoffs.home : r.faceoffs.away;
      const foT = t.home ? r.faceoffs.away : r.faceoffs.home;
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
      shotsPerGame: reports.length ? shots / reports.length : 0,
      pimPerGame: reports.length ? ourPenalties.reduce((n, p) => n + toMin(p.duration), 0) / reports.length : 0,
    };
  })();
  const firstGoalGames = (() => {
    const us: { r: Result; score: string; date: string; opponent: string }[] = [];
    const them: typeof us = [];
    for (const { g, r } of reports) {
      const first = r.events.filter((e) => e.type === "goal").sort((a, b) => a.sec - b.sec)[0];
      if (!first) continue;
      const t = res(g);
      (ours(first) ? us : them).push({ r: t.r, score: `${t.f}:${t.a}`, date: g.date, opponent: g.oppName });
    }
    return { us, them };
  })();
  const firstGoal = {
    us: { V: 0, R: 0, P: 0, games: firstGoalGames.us.length },
    them: { V: 0, R: 0, P: 0, games: firstGoalGames.them.length },
  };
  for (const x of firstGoalGames.us) firstGoal.us[x.r]++;
  for (const x of firstGoalGames.them) firstGoal.them[x.r]++;

  // the league (the group we played in that season)
  const active = s.rows.filter((r) => r.played > 0);
  const metric = (key: string, label: string, higher: boolean, val: (r: SRow) => number): LeagueMetric => {
    const teams = active.map((r) => ({ teamId: r.teamId, name: r.name, value: val(r) / r.played }));
    const sorted = [...teams].sort((a, b) => (higher ? b.value - a.value : a.value - b.value));
    return {
      key,
      label,
      higher,
      teams,
      ours: teams.find((t) => t.teamId === OUR)?.value ?? 0,
      rank: sorted.findIndex((t) => t.teamId === OUR) + 1,
      avg: teams.reduce((n, t) => n + t.value, 0) / Math.max(1, teams.length),
      count: teams.length,
    };
  };
  const league = active.length
    ? [
        metric("ppg", "Body na zápas", true, (r) => r.points),
        metric("gfpg", "Vstřelené góly na zápas", true, (r) => r.goalsFor),
        metric("gapg", "Obdržené góly na zápas", false, (r) => r.goalsAgainst),
        metric("pimpg", "Trestné minuty na zápas", false, (r) => r.penaltyMinutes),
      ]
    : [];

  // insights (present tense for the running season, past tense for finished ones)
  const pick = (x: InsightText | null | false | undefined | 0) => (x ? x : null);
  const inPeriod = (key: string) => ({ "1": "v první třetině", "2": "ve druhé třetině", "3": "ve třetí třetině", OT: "v prodloužení" })[key] ?? "";
  const gamesWord = (n: number) => `${n} ${plural(n, "zápas", "zápasy", "zápasů")}`;
  const ofGames = (n: number) => `${z(n)} ${n === 1 ? "zápasu" : "zápasů"}`;
  const { us, them } = firstGoal;
  const pga = periods.reduce((n, p) => n + p.against, 0);
  const pgf = periods.reduce((n, p) => n + p.for, 0);
  const worst = [...periods].sort((a, b) => b.against - a.against)[0];
  const best = [...periods].sort((a, b) => b.for - a.for)[0];
  const assisted = ourGoals.filter((g) => g.assists.length > 0).length;
  const { powerPlay: pp, shooting } = specialTeams;
  const shotsPerGoal = shooting.goals ? Math.round(shooting.shots / shooting.goals) : 0;
  const scorers = leaders.goals.length;
  const stars = leaders.stars.length;
  const sides = league.length
    ? [
        { m: league[1], name: "útok", text: (r: number) => `${r}. nejlepší útok` },
        { m: league[2], name: "obrana", text: (r: number) => `${r}. nejlepší obrana` },
        { m: league[3], name: "disciplína", text: (r: number) => `${r}. nejukázněnější tým` },
      ].sort((a, b) => a.m.rank - b.m.rank)
    : [];
  const insights = {
    firstUs: pick(
      us.games > 0 && {
        text: past
          ? us.P === 0
            ? `Když jsme dali první gól, neprohráli jsme: ${recordText(us)} ${ofGames(us.games)}.`
            : `Když jsme dali první gól, vyhráli jsme ${us.V} ${ofGames(us.games)}.`
          : us.P === 0
            ? `Když dáme první gól, zatím jsme neprohráli: ${recordText(us)} ${ofGames(us.games)}.`
            : `Když dáme první gól, vyhráváme ${us.V} ${z(us.games)}.`,
      },
    ),
    firstThem: pick(
      them.games > 0 && {
        text: past
          ? them.V === 0
            ? `Když první skóroval soupeř, nikdy jsme to neotočili (${gamesWord(them.games)}).`
            : `Když první skóroval soupeř, otočili jsme to ${them.V}× ${z(them.games)}.`
          : them.V === 0
            ? `Když první skóruje soupeř, zatím jsme to neotočili (${gamesWord(them.games)}).`
            : `Když první skóruje soupeř, otočili jsme to ${them.V}× ${z(them.games)}.`,
      },
    ),
    period: pick(
      worst && worst.against > 0 && worst.against / pga >= 0.4
        ? { text: `Nejvíc gólů ${past ? "jsme dostávali" : "dostáváme"} ${inPeriod(worst.key)}: ${worst.against} ${z(pga)}.` }
        : best && best.for > 0 && { text: `Nejvíc gólů ${past ? "jsme dávali" : "dáváme"} ${inPeriod(best.key)}: ${best.for} ${z(pgf)}.` },
    ),
    scorers: pick(
      scorers > 1 && {
        big: String(scorers),
        text: past ? (scorers <= 4 ? "různí hráči dali gól" : "různých hráčů dalo gól") : scorers <= 4 ? "různí hráči už dali gól" : "různých hráčů už dalo gól",
      },
    ),
    assisted: pick(ourGoals.length > 0 && { big: `${assisted} ${z(ourGoals.length)}`, text: "našich gólů padlo po přihrávce" }),
    stars: pick(
      stars > 1 && {
        text: `Hvězdou zápasu ${past ? "" : "už "}${stars >= 2 && stars <= 4 ? `byli ${stars} různí hráči` : `bylo ${stars} různých hráčů`}.`,
      },
    ),
    powerPlay: pick(
      pp.chances > 0 && {
        text:
          pp.goals > 0
            ? `${cap(z(pp.chances))} vyloučení soupeře jsme vytěžili ${pp.goals} ${plural(pp.goals, "gól", "góly", "gólů")}.`
            : past
              ? "Z vyloučení soupeře jsme nevytěžili ani gól."
              : "Z vyloučení soupeře jsme zatím nevytěžili ani gól.",
      },
    ),
    shooting: pick(
      shotsPerGoal > 0 && {
        big: String(shotsPerGoal),
        text: `${plural(shotsPerGoal, "střelu", "střely", "střel")} v průměru ${past ? "jsme potřebovali" : "potřebujeme"} na jeden gól`,
      },
    ),
    league: pick(
      sides.length > 0 &&
        sides.at(-1)!.m.rank - sides[0].m.rank >= 4 && {
          text: `Silná stránka: ${sides[0].text(sides[0].m.rank)} ${z(sides[0].m.count)}. Slabina: ${sides.at(-1)!.name}, ${sides.at(-1)!.m.rank}. místo.`,
        },
    ),
  };

  return {
    key: s.key,
    name: s.name,
    current: s.current,
    group: s.group,
    summary,
    tally,
    perGame,
    pointsTimeline,
    leaders,
    players,
    assistPairs,
    goalies,
    rosterSize,
    reportCount: reports.length,
    periods,
    goalTimeline,
    specialTeams,
    firstGoal,
    firstGoalGames,
    league,
    insights,
  };
}
export type Season = ReturnType<typeof buildSeason>;

// ---------- all seasons ----------
type HistGame = { gameId: string; date: string; group: string; homeTeamId: string; awayTeamId: string; homeName: string; awayName: string; homeGoals: number | null; awayGoals: number | null };
type HistRow = SRow & { shortName: string | null };
const history = historyJson as unknown as {
  seasons: Record<string, { name: string; startDate: string; games: HistGame[]; standings?: { group: string; rows: HistRow[] } }>;
};
const historyReports = historyReportsJson as unknown as Record<string, Report>;
const shortOf = (name: string, short?: string | null) => short ?? name.replace(/^HC\s+/, "").slice(0, 3).toUpperCase();

const current = buildSeason({
  key: meta.season.name,
  name: meta.season.name.replace("-", "/"),
  current: true,
  group: meta.group.name,
  games: finals.map((g) => {
    const o = team(g.homeTeamId === OUR ? g.awayTeamId : g.homeTeamId);
    return {
      gameId: g.gameId,
      date: g.date,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homeGoals: g.homeGoals!,
      awayGoals: g.awayGoals!,
      oppName: o.name,
      oppShort: shortOf(o.name, o.shortName),
      slug: gameSlug(g),
    };
  }),
  report: (id) => {
    const g = finals.find((x) => x.gameId === id);
    return g ? reportFor(g) : undefined;
  },
  rows: standings.map((r) => ({ ...r, name: team(r.teamId).name })),
});

const pastSeasons = Object.values(history.seasons)
  .filter((x) => x.games.length)
  .sort((a, b) => b.startDate.localeCompare(a.startDate))
  .map((x) => {
    const rows = x.standings?.rows ?? [];
    const shortById = new Map(rows.map((r) => [r.teamId, r.shortName]));
    return buildSeason({
      key: x.name,
      name: x.name.replace("-", "/"),
      current: false,
      group: x.standings?.group ?? x.games[0].group,
      games: x.games
        .filter((g) => g.homeGoals != null && g.awayGoals != null)
        .map((g) => {
          const home = g.homeTeamId === OUR;
          const oppId = home ? g.awayTeamId : g.homeTeamId;
          const oppName = clean(home ? g.awayName : g.homeName);
          return { ...g, homeGoals: g.homeGoals!, awayGoals: g.awayGoals!, oppName, oppShort: shortOf(oppName, shortById.get(oppId)), slug: null };
        }),
      report: (id) => historyReports[id],
      rows,
    });
  });

/** Newest first: the running season, then finished ones. */
export const seasons: Season[] = [current, ...pastSeasons];
export const currentSeason = current;
