// Dračí radar, all seasons together: totals, season by season, head-to-head with every opponent
// and the insights about them. One season in depth lives in src/lib/season.ts.
import historyJson from "../../data/history.json";
import { OUR, finals, meta, team, type Result } from "./data";
import { cap, recordText, type InsightText } from "./season";

export { recordText };
const played = finals;

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

/** Head-to-head against every opponent over all seasons, best share of points first. */
export const headToHead = (() => {
  const map = new Map<string, { teamId: string; name: string; games: number; V: number; R: number; P: number; gf: number; ga: number; results: { r: Result; score: string; date: string }[] }>();
  for (const g of [...allGames].sort((a, b) => a.date.localeCompare(b.date))) {
    const p = perspective(g);
    const t = map.get(p.oppId) ?? { teamId: p.oppId, name: p.oppName, games: 0, V: 0, R: 0, P: 0, gf: 0, ga: 0, results: [] };
    t.results.push({ r: p.r, score: `${p.f}:${p.a}`, date: g.date });
    t.name = p.oppName; // latest name wins (games are oldest first)
    t.games++;
    t[p.r]++;
    t.gf += p.f;
    t.ga += p.a;
    map.set(p.oppId, t);
  }
  return [...map.values()]
    .map((t) => ({ ...t, diff: t.gf - t.ga, share: (2 * t.V + t.R) / (2 * t.games) }))
    .sort((a, b) => b.share - a.share || b.games - a.games || b.diff - a.diff || a.name.localeCompare(b.name, "cs"));
})();

// ---------- insights ----------
const pick = (x: InsightText | null | false | undefined) => (x ? x : null);

export const insights = (() => {
  const seasons = allTime.bySeason;
  const rising = seasons.length > 1 && seasons.every((s, i) => i === 0 || s.winPct > seasons[i - 1].winPct);
  const topSeason = [...seasons].sort((a, b) => b.winPct - a.winPct)[0];
  const current = seasons.at(-1);
  // Rivals need a few games before "favourite" / "nemesis" means anything.
  const rivals = headToHead.filter((h) => h.games >= 3);
  const fav = rivals[0];
  const nemesis = [...rivals].sort((a, b) => a.share - b.share || b.games - a.games || a.diff - b.diff)[0];
  return {
    trend: pick(
      rising
        ? {
            text: `Podíl výher roste každou sezónu: ${seasons.map((s) => `${Math.round(s.winPct)}\u00a0%`).join("\u00a0→ ")}${current && current.games < 20 ? ` (letos po ${current.games} zápasech)` : ""}.`,
          }
        : topSeason && { text: `Nejlepší sezóna: ${topSeason.name} s ${Math.round(topSeason.winPct)}\u00a0% výher.` },
    ),
    fav: pick(fav && fav.share > 0.5 && { text: `Oblíbený soupeř: ${fav.name}. ${cap(recordText(fav))}, skóre ${fav.gf}:${fav.ga}.` }),
    nemesis: pick(
      nemesis && nemesis !== fav && nemesis.share < 0.5 && { text: `Nejtěžší soupeř: ${nemesis.name}. ${cap(recordText(nemesis))}, skóre ${nemesis.gf}:${nemesis.ga}.` },
    ),
  };
})();
