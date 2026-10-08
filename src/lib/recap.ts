// Match recap for a played game: facts computed from the report events, phrased by templates.
// Told from our perspective, so every score here is "ours:theirs".
// Self-contained (type-only imports) so it can be unit-tested with plain `node --test`.
import type { Game } from "./data";

export interface Person {
  playerId: string;
  name: string;
  number: number | null;
}
export interface GoalEvent {
  type: "goal";
  period: string;
  time: string;
  sec: number;
  teamId: string;
  scorer: Person | null;
  assists: Person[];
  strength: "even" | "pp" | "sh";
}
export interface PenaltyEvent {
  type: "penalty";
  period: string;
  time: string;
  sec: number;
  teamId: string;
  player: Person | null;
  duration: string | null;
  reason: string | null;
}
export interface Report {
  homeNick: string | null;
  awayNick: string | null;
  complete: boolean;
  shots: { home: number | null; away: number | null };
  faceoffs: { home: number | null; away: number | null };
  penaltyMinutes: { home: number | null; away: number | null };
  stars: (Person & { teamId: string; goals: number; assists: number })[];
  events: (GoalEvent | PenaltyEvent)[];
}

export interface Recap {
  summary: string;
  periods: { title: string; score: string; story: string; items: { minute: string; text: string; ours: boolean; goal: boolean }[] }[];
  stats: { label: string; ours: string; theirs: string; better: "ours" | "theirs" | null }[];
  points: { ours: PlayerPoints[]; theirs: PlayerPoints[] };
}
export interface PlayerPoints {
  name: string;
  number: number | null;
  goals: number;
  assists: number;
}

const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const goalsWord = (n: number) => `${n} ${plural(n, "gól", "góly", "gólů")}`;
const assistsWord = (n: number) => `${n} ${plural(n, "asistence", "asistence", "asistencí")}`;
/** Hockey convention: 8:28 of game time is the 9th minute. */
const minuteOf = (sec: number) => Math.floor(sec / 60) + 1;
const periodTitle = (key: string) => (/^\d$/.test(key) ? `${key}. třetina` : key === "OT" ? "Prodloužení" : key === "SN" ? "Samostatné nájezdy" : key);
const REGULATION_SEC = 45 * 60; // 3 × 15 min in this league
const listNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} a ${names[names.length - 1]}`;
/** Penalty minutes are decimal in the API (5.25) but shown as game clock (5:15). */
const pim = (x: number | null) => (x == null ? "–" : `${Math.floor(x)}:${String(Math.round((x % 1) * 60)).padStart(2, "0")}`);

export function buildRecap(game: Game, report: Report, ourId: string, opponentName: string): Recap {
  const home = game.homeTeamId === ourId;
  const f = (home ? game.homeGoals : game.awayGoals) ?? 0;
  const a = (home ? game.awayGoals : game.homeGoals) ?? 0;
  const result = f > a ? "V" : f < a ? "P" : "R";
  const theirNick = (home ? report.awayNick : report.homeNick) ?? opponentName;
  const ourNick = (home ? report.homeNick : report.awayNick) ?? "Dragons";
  const ours = (e: { teamId: string }) => e.teamId === ourId;
  const goals = report.events.filter((e): e is GoalEvent => e.type === "goal");
  const penalties = report.events.filter((e): e is PenaltyEvent => e.type === "penalty");

  // Running score after each goal, from our perspective.
  let us = 0;
  let them = 0;
  const timeline: Step[] = goals.map((g) => {
    const before = { us, them };
    if (ours(g)) us++;
    else them++;
    return { g, before, after: { us, them } };
  });
  const lastPeriod = goals.at(-1)?.period;
  const extra = lastPeriod === "OT" ? " po prodloužení" : lastPeriod === "SN" ? " po nájezdech" : "";

  // ---- summary ----
  const out: string[] = [];
  out.push(
    result === "V"
      ? `Vyhráli jsme s ${opponentName} ${f}:${a}${extra}.`
      : result === "P"
        ? `Prohráli jsme s ${opponentName} ${f}:${a}${extra}.`
        : `S ${opponentName} jsme remizovali ${f}:${a}.`,
  );

  if (report.complete && goals.length) {
    const weWon = result === "V";
    const winnerIsUs = (t: (typeof timeline)[number]) => ours(t.g) === weWon;
    // Game-winning goal: the winner's goal number (loser's final + 1).
    const loserFinal = Math.min(f, a);
    const gwg = result === "R" ? undefined : timeline.filter(winnerIsUs)[loserFinal]?.g;
    // Did the winner ever trail?
    const worst = timeline.reduce(
      (acc, t) => {
        const diff = weWon ? t.after.us - t.after.them : t.after.them - t.after.us;
        return diff < acc.diff ? { diff, us: t.after.us, them: t.after.them } : acc;
      },
      { diff: 0, us: 0, them: 0 },
    );
    const afterFirst = timeline.filter((t) => t.g.period === "1").at(-1)?.after ?? { us: 0, them: 0 };
    const leadAfterFirst = weWon ? afterFirst.us - afterFirst.them : afterFirst.them - afterFirst.us;
    const quick = quickDouble(
      goals.filter((g) => g.period === "1"),
      ours,
      (g) => ours(g) === weWon,
    );

    if (result !== "R" && worst.diff < 0) {
      out.push(weWon ? `Dokázali jsme otočit ze stavu ${worst.us}:${worst.them}.` : `Soupeř dokázal otočit ze stavu ${worst.us}:${worst.them}.`);
    } else if (gwg && (gwg.period === "OT" || gwg.period === "SN" || REGULATION_SEC - gwg.sec <= 5 * 60)) {
      const who = `${gwg.scorer?.name ?? "neznámý hráč"}`;
      out.push(
        weWon
          ? `Vítězný gól dal ${who} v ${minuteOf(gwg.sec)}. minutě.`
          : `Rozhodující gól dal v ${minuteOf(gwg.sec)}. minutě ${who} (${theirNick}).`,
      );
    } else if (result !== "R" && leadAfterFirst >= 2) {
      const tail = quick ? `, kdy ${weWon ? "jsme dali" : "dal"} dva góly během ${quick.gap} sekund` : "";
      out.push(weWon ? `O zápase jsme rozhodli už v 1. třetině${tail}.` : `Soupeř rozhodl už v 1. třetině${tail}.`);
    } else if (gwg?.scorer) {
      out.push(weWon ? `Vítězný gól dal ${gwg.scorer.name}.` : `Rozhodující gól dal ${gwg.scorer.name} (${theirNick}).`);
    }

    // Same score in every regulation period, e.g. "each period 0:2".
    const per = ["1", "2", "3"].map((p) => periodScore(timeline, p));
    if (result !== "R" && per.every((s) => s.us === per[0].us && s.them === per[0].them && s.us !== s.them)) {
      out.push(`Všechny tři třetiny skončily ${per[0].us}:${per[0].them}.`);
    }
  }

  // Players.
  const pts = points(goals);
  const ourScorers = scorerList(goals.filter(ours));
  if (result === "P") {
    const top = pts.filter((p) => p.teamId !== ourId).sort(byPoints)[0];
    if (top && top.goals + top.assists >= 2)
      out.push(`Nejvíc nás potrápil ${top.name} (${[top.goals && goalsWord(top.goals), top.assists && assistsWord(top.assists)].filter(Boolean).join(", ")}).`);
  }
  if (f === 0) out.push("Nedali jsme ani jeden gól.");
  else if (report.complete && ourScorers.length)
    out.push(`Za nás ${ourScorers.length === 1 ? "skóroval" : "skórovali"} ${listNames(ourScorers)}.`);
  if (a === 0 && f > 0) out.push("Neinkasovali jsme ani jednou.");

  // Shots, when they tell something.
  const so = home ? report.shots.home : report.shots.away;
  const st = home ? report.shots.away : report.shots.home;
  if (so != null && st != null) {
    if (result === "V" && so < st) out.push(`Vyhráli jsme, přestože soupeř vystřelil víc (${so}:${st}).`);
    else if (result === "P" && so > st) out.push(`Na střely jsme přitom vyhráli ${so}:${st}.`);
    else if (Math.abs(so - st) >= 8) out.push(`Na střely jsme ${so > st ? "vyhráli" : "prohráli"} ${so}:${st}.`);
  }

  const star = report.stars.find((s) => s.teamId === ourId);
  if (star) out.push(`Nejlepším hráčem za nás byl vyhlášen ${star.name}.`);

  // ---- detail: periods ----
  const periodKeys = [...new Set(["1", "2", "3", ...report.events.map((e) => e.period)])];
  const periods = report.complete
    ? periodKeys
        .filter((k) => /^\d$/.test(k) || report.events.some((e) => e.period === k))
        .map((key) => {
          const s = periodScore(timeline, key);
          const items = report.events
            .filter((e) => e.period === key)
            .map((e) => {
              const team = ours(e) ? ourNick : theirNick;
              if (e.type === "goal") {
                const t = timeline.find((x) => x.g === e)!;
                const verb = goalVerb(t.before, ours(e));
                const assists = e.assists.length ? `, asistence ${listNames(e.assists.map((p) => p.name))}` : "";
                const strength = e.strength === "pp" ? " v přesilovce" : e.strength === "sh" ? " v oslabení" : "";
                return {
                  minute: `${minuteOf(e.sec)}.`,
                  text: `${e.scorer?.name ?? "Neznámý hráč"} (${team}) ${verb}${strength} na ${t.after.us}:${t.after.them}${assists}.`,
                  ours: ours(e),
                  goal: true,
                };
              }
              return {
                minute: `${minuteOf(e.sec)}.`,
                text: `Vyloučen ${e.player?.name ?? "hráč"} (${team})${e.reason ? `, ${e.reason.toLowerCase()}` : ""}.`,
                ours: ours(e),
                goal: false,
              };
            });
          const quick = quickDouble(goals.filter((g) => g.period === key), ours);
          const story =
            s.us === 0 && s.them === 0
              ? "Třetina bez gólů."
              : `${s.us > s.them ? "Třetinu jsme vyhráli" : s.us < s.them ? "Třetinu jsme prohráli" : "Třetina skončila nerozhodně"} ${s.us}:${s.them}${
                  quick ? `, ${quick.ours ? "dva naše góly" : "dva góly soupeře"} padly během ${quick.gap} sekund` : ""
                }.`;
          return { title: periodTitle(key), score: `${s.us}:${s.them}`, story: /^\d$/.test(key) ? story : "", items };
        })
    : [];

  // ---- detail: stats ----
  const pick = (x: { home: number | null; away: number | null }) => (home ? [x.home, x.away] : [x.away, x.home]);
  const better = (o: number | null, t: number | null, higher = true) =>
    o == null || t == null || o === t ? null : (higher ? o > t : o < t) ? ("ours" as const) : ("theirs" as const);
  const [sO, sT] = pick(report.shots);
  const [fO, fT] = pick(report.faceoffs);
  const [mO, mT] = pick(report.penaltyMinutes);
  const ppO = goals.filter((g) => ours(g) && g.strength === "pp").length;
  const ppT = goals.filter((g) => !ours(g) && g.strength === "pp").length;
  const penO = penalties.filter(ours).length;
  const penT = penalties.length - penO;
  const stats = [
    { label: "Střely na branku", ours: `${sO ?? "–"}`, theirs: `${sT ?? "–"}`, better: better(sO, sT) },
    { label: "Vyhraná vhazování", ours: `${fO ?? "–"}`, theirs: `${fT ?? "–"}`, better: better(fO, fT) },
    { label: "Vyloučení", ours: `${penO}`, theirs: `${penT}`, better: better(penO, penT, false) },
    { label: "Trestné minuty", ours: pim(mO), theirs: pim(mT), better: better(mO, mT, false) },
    ...(report.complete ? [{ label: "Góly v přesilovce", ours: `${ppO}`, theirs: `${ppT}`, better: better(ppO, ppT) }] : []),
  ];

  const strip = ({ teamId: _t, ...p }: PlayerPoints & { teamId: string }) => p;
  return {
    summary: out.join(" "),
    periods,
    stats,
    points: {
      ours: pts.filter((p) => p.teamId === ourId).sort(byPoints).map(strip),
      theirs: pts.filter((p) => p.teamId !== ourId).sort(byPoints).map(strip),
    },
  };
}

type Step = { g: GoalEvent; before: { us: number; them: number }; after: { us: number; them: number } };

function periodScore(timeline: Step[], period: string) {
  let us = 0;
  let them = 0;
  for (const t of timeline) {
    if (t.g.period !== period) continue;
    if (t.after.us > t.before.us) us++;
    else them++;
  }
  return { us, them };
}

/** How a goal changed the game, from the scorer's point of view. */
function goalVerb(before: { us: number; them: number }, byUs: boolean) {
  const own = byUs ? before.us : before.them;
  const opp = byUs ? before.them : before.us;
  if (own === 0 && opp === 0) return "otevřel skóre";
  if (own === opp - 1) return "vyrovnal";
  if (own === opp) return "poslal svůj tým do vedení";
  if (own > opp) return "zvýšil";
  return "snížil";
}

/** Two goals by the same team within 60 s (the quickest pair). */
function quickDouble(goals: GoalEvent[], isOurs: (g: GoalEvent) => boolean, filter?: (g: GoalEvent) => boolean) {
  let best: { gap: number; period: string; ours: boolean } | null = null;
  for (let i = 1; i < goals.length; i++) {
    const [x, y] = [goals[i - 1], goals[i]];
    if (x.teamId !== y.teamId || (filter && !filter(y))) continue;
    const gap = y.sec - x.sec;
    if (gap <= 60 && (!best || gap < best.gap)) best = { gap, period: y.period, ours: isOurs(y) };
  }
  return best;
}

function points(goals: GoalEvent[]) {
  const map = new Map<string, PlayerPoints & { teamId: string }>();
  const add = (p: Person | null, teamId: string, key: "goals" | "assists") => {
    if (!p) return;
    const e = map.get(p.playerId) ?? { name: p.name, number: p.number, teamId, goals: 0, assists: 0 };
    e[key]++;
    map.set(p.playerId, e);
  };
  for (const g of goals) {
    add(g.scorer, g.teamId, "goals");
    for (const a of g.assists) add(a, g.teamId, "assists");
  }
  return [...map.values()];
}

const byPoints = (x: PlayerPoints, y: PlayerPoints) =>
  y.goals + y.assists - (x.goals + x.assists) || y.goals - x.goals || x.name.localeCompare(y.name, "cs");

/** "Jan Novák (2)", "Petr Svoboda" — our scorers in order of goals. */
function scorerList(goals: GoalEvent[]) {
  const count = new Map<string, number>();
  for (const g of goals) if (g.scorer) count.set(g.scorer.name, (count.get(g.scorer.name) ?? 0) + 1);
  return [...count].sort((x, y) => y[1] - x[1]).map(([n, c]) => (c > 1 ? `${n} (${c})` : n));
}

/**
 * Facts handed to the language model for the commentator-style narrative.
 * Everything the model may mention must be here; it only phrases them.
 * Deliberately excludes things that change after the game (current standings),
 * so the cached text is only regenerated when the game data itself changes.
 */
export function matchFacts(
  game: Game,
  report: Report,
  ourId: string,
  ctx: { ourName: string; opponentName: string; dateText: string; competition: string },
) {
  const home = game.homeTeamId === ourId;
  const f = (home ? game.homeGoals : game.awayGoals) ?? 0;
  const a = (home ? game.awayGoals : game.homeGoals) ?? 0;
  const ours = (e: { teamId: string }) => e.teamId === ourId;
  const side = (e: { teamId: string }) => (ours(e) ? "my" : "soupeř");
  const recap = buildRecap(game, report, ourId, ctx.opponentName);
  const goals = report.events.filter((e): e is GoalEvent => e.type === "goal");

  let us = 0;
  let them = 0;
  const goalFacts = goals.map((g) => {
    const before = { us, them };
    if (ours(g)) us++;
    else them++;
    return {
      minute: minuteOf(g.sec),
      gameClock: g.time,
      period: periodTitle(g.period),
      team: side(g),
      scorer: g.scorer?.name ?? null,
      assists: g.assists.map((p) => p.name),
      scoreAfter: `${us}:${them}`,
      meaning: goalVerb(before, ours(g)),
      situation: g.strength === "pp" ? "přesilovka" : g.strength === "sh" ? "oslabení" : null,
    };
  });
  const lastPeriod = goals.at(-1)?.period;

  return {
    competition: ctx.competition,
    date: ctx.dateText,
    venue: game.venue,
    ourTeam: ctx.ourName,
    opponent: ctx.opponentName,
    weWereHomeTeam: home,
    result: f > a ? "výhra" : f < a ? "prohra" : "remíza",
    score: `${f}:${a}`,
    gameFormat: "3 třetiny po 15 minutách hrubého času; minuty a gameClock se počítají od začátku zápasu",
    decidedIn: lastPeriod === "OT" ? "prodloužení" : lastPeriod === "SN" ? "samostatné nájezdy" : "základní hrací doba",
    eventsComplete: report.complete,
    periods: recap.periods.map((p) => ({ period: p.title, score: p.score })),
    goals: report.complete ? goalFacts : [],
    penalties: report.events
      .filter((e): e is PenaltyEvent => e.type === "penalty")
      .map((p) => ({ minute: minuteOf(p.sec), team: side(p), player: p.player?.name ?? null, reason: p.reason?.toLowerCase() ?? null })),
    stats: Object.fromEntries(recap.stats.map((s) => [s.label, { my: s.ours, soupeř: s.theirs }])),
    starsOfTheMatch: report.stars.map((s) => ({ team: side(s), player: s.name, goals: s.goals, assists: s.assists })),
    pointsUs: recap.points.ours,
    pointsOpponent: recap.points.theirs,
    // The template summary already picks the storyline (comeback, late winner, early decision...).
    keyFacts: recap.summary,
  };
}
