import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecap, type GoalEvent, type PenaltyEvent, type Report } from "./recap.ts";
import type { Game } from "./data";

const US = "us";
const THEM = "them";
const p = (name: string) => ({ playerId: name, name, number: null });
const goal = (sec: number, teamId: string, scorer: string, period = String(Math.min(3, Math.floor(sec / 900) + 1)), assists: string[] = []): GoalEvent => ({
  type: "goal", period, time: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`, sec, teamId, scorer: p(scorer), assists: assists.map(p), strength: "even",
});
const game = (home: number, away: number): Game => ({
  gameId: "g", date: "2026-10-06", time: "22:00", start: "2026-10-06T22:00:00+02:00", status: "finished",
  homeTeamId: US, awayTeamId: THEM, homeGoals: home, awayGoals: away, venue: null, stars: [],
});
const report = (events: (GoalEvent | PenaltyEvent)[], extra: Partial<Report> = {}): Report => ({
  homeNick: "Dragons", awayNick: "Raptors", complete: true,
  shots: { home: 20, away: 20 }, faceoffs: { home: 10, away: 10 }, penaltyMinutes: { home: 0, away: 0 },
  stars: [], events, ...extra,
});

test("comeback win with late scorers and a star", () => {
  const r = buildRecap(
    game(2, 1),
    report([goal(300, THEM, "Petr Pudil"), goal(1500, US, "Jan Novák"), goal(2500, US, "Jan Novák")], {
      stars: [{ teamId: US, playerId: "x", name: "Karel Dvořák", number: 1, goals: 0, assists: 0 }],
    }),
    US,
    "HC Raptors",
  );
  assert.equal(
    r.summary,
    "Vyhráli jsme s HC Raptors 2:1. Dokázali jsme otočit ze stavu 0:1. Za nás skóroval Jan Novák (2). Nejlepším hráčem za nás byl vyhlášen Karel Dvořák.",
  );
  assert.deepEqual(r.periods.map((x) => x.score), ["0:1", "1:0", "1:0"]);
  assert.equal(r.periods[0].items[0].text, "Petr Pudil (Raptors) otevřel skóre na 0:1.");
  assert.equal(r.periods[2].items[0].text, "Jan Novák (Dragons) poslal svůj tým do vedení na 2:1.");
  assert.equal(r.periods[2].items[0].minute, "42.");
});

test("loss decided early, quick double, shutout, outshooting", () => {
  const r = buildRecap(
    game(0, 3),
    report([goal(479, THEM, "A", "1"), goal(508, THEM, "B", "1", ["A"]), goal(2000, THEM, "A", "3")], { shots: { home: 30, away: 15 } }),
    US,
    "HC Raptors",
  );
  assert.equal(
    r.summary,
    "Prohráli jsme s HC Raptors 0:3. Soupeř rozhodl už v 1. třetině, kdy dal dva góly během 29 sekund. Nejvíc nás potrápil A (2 góly, 1 asistence). Nedali jsme ani jeden gól. Na střely jsme přitom vyhráli 30:15.",
  );
  assert.equal(r.periods[1].story, "Třetina bez gólů.");
  assert.deepEqual(r.points.theirs[0], { name: "A", number: null, goals: 2, assists: 1 });
});

test("away perspective and incomplete events", () => {
  const g = { ...game(1, 4), homeTeamId: THEM, awayTeamId: US };
  const r = buildRecap(g, report([], { complete: false, shots: { home: 10, away: 30 } }), US, "Gaston Seals");
  assert.equal(r.summary, "Vyhráli jsme s Gaston Seals 4:1. Na střely jsme vyhráli 30:10.");
  assert.deepEqual(r.periods, []);
  assert.equal(r.stats[0].ours, "30");
});
