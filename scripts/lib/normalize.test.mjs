import { test } from "node:test";
import assert from "node:assert/strict";
import { GameMultimediaSchema, GamesSchema, StandingsSchema } from "./schemas.mjs";
import { checkConsistency, normalize, normalizeMedia, pragueToIso, youtubeId } from "./normalize.mjs";

const DRAGONS = "E70C43E0-264E-11EF-BE38-052B0AF887CA";
const RAPTORS = "BD6D1D09-9BE7-4D43-AA42-DA729E10FF8F";
const logo = (slug) => `https://prod-hms-wootera.s3.eu-central-1.amazonaws.com/Team_${slug}_[size]`;

const game = (overrides) => ({
  gameId: "G1",
  name: "PDG vs RAP",
  status: "NOT PLAYED",
  startDate: "2026-10-06",
  startTime: "22:00:00",
  HomeTeamGoals: 0,
  AwayTeamGoals: 0,
  Phase: { phaseId: "P1", name: "Základní část", Group: { groupId: "GR1", name: "KLASIK" } },
  HomeTeam: { teamId: DRAGONS, name: "PHT Dragons", logoUrl: logo("PHT_DRAGONS") },
  AwayTeam: { teamId: RAPTORS, name: "HC Raptors", logoUrl: logo("HC_RAPTORS") },
  Venue: { name: "Sportovní hala Fortuna", short: "SPA" },
  GameStars: [],
  ...overrides,
});

const rawGames = GamesSchema.parse([
  game({}),
  game({
    gameId: "G0",
    name: "RAP vs PDG",
    status: "FINISHED",
    startDate: "2026-09-15",
    HomeTeam: game({}).AwayTeam,
    AwayTeam: game({}).HomeTeam,
    HomeTeamGoals: 2,
    AwayTeamGoals: 3,
    GameStars: [{ teamId: DRAGONS, LineupNumber: 9, Player: { firstName: "Jan", lastName: "Novák" } }],
  }),
  game({ gameId: "G2", AwayTeam: null }), // undecided playoff slot
  game({ gameId: "G3", Phase: { phaseId: "X", name: "Základní část", Group: { groupId: "X", name: "HOBBY" } } }),
]);

const rawStandings = StandingsSchema.parse([
  {
    TeamId: RAPTORS, "Team Name": "HC Raptors", "Team Name Short": "RAP", TeamLogo: null,
    "Total Games": 1, Wins: 0, Draws: 0, Losses: 1, "Total Points": 0, Score: "2:3",
    "Total Penalty Minutes": "4:30",
  },
  {
    TeamId: DRAGONS, "Team Name": "PHT Dragons", "Team Name Short": "PDG",
    "Total Games": 1, Wins: 1, Draws: 0, Losses: 0, "Total Points": 2, Score: "3:2",
    "Total Penalty Minutes": "0:00",
  },
]);

test("normalize keeps only KLASIK games with both teams, sorted by start", () => {
  const { games, skippedGames } = normalize({ rawGames, rawStandings });
  assert.deepEqual(games.map((g) => g.gameId), ["G0", "G1"]);
  assert.equal(skippedGames, 1);
});

test("normalize maps statuses, scores and stars", () => {
  const { games } = normalize({ rawGames, rawStandings });
  const [finished, scheduled] = games;
  assert.equal(finished.status, "finished");
  assert.deepEqual([finished.homeGoals, finished.awayGoals], [2, 3]);
  assert.deepEqual(finished.stars, [{ teamId: DRAGONS, number: 9, firstName: "Jan", lastName: "Novák" }]);
  // API reports 0:0 for unplayed games; that must not look like a result.
  assert.equal(scheduled.status, "scheduled");
  assert.deepEqual([scheduled.homeGoals, scheduled.awayGoals], [null, null]);
  assert.equal(scheduled.time, "22:00");
  assert.equal(scheduled.start, "2026-10-06T22:00:00+02:00");
});

test("normalize builds teams by teamId with short names and logo templates", () => {
  const { teams } = normalize({ rawGames, rawStandings });
  assert.deepEqual(teams.map((t) => [t.teamId, t.shortName]), [[RAPTORS, "RAP"], [DRAGONS, "PDG"]]);
  // Standings had no logo for Raptors; the game's logoUrl fills it in.
  assert.equal(teams[0].logoSource, logo("HC_RAPTORS"));
});

test("normalize parses standings score and penalty minutes", () => {
  const { standings } = normalize({ rawGames, rawStandings });
  assert.deepEqual(standings[0], {
    rank: 1, teamId: RAPTORS, played: 1, wins: 0, draws: 0, losses: 1, points: 0,
    goalsFor: 2, goalsAgainst: 3, penaltyMinutes: 4.5,
  });
});

test("pragueToIso handles winter time", () => {
  assert.equal(pragueToIso("2027-01-15", "19:30:00"), "2027-01-15T19:30:00+01:00");
});

test("checkConsistency flags missing data", () => {
  assert.deepEqual(checkConsistency(normalize({ rawGames, rawStandings }), DRAGONS), []);
  const empty = normalize({ rawGames: [], rawStandings: [] });
  assert.equal(checkConsistency(empty, DRAGONS).length, 4);
});

test("schema rejects an unknown game status", () => {
  assert.equal(GamesSchema.safeParse([game({ status: "POSTPONED" })]).success, false);
});

test("normalizeMedia derives Flickr sizes and skips the PNG placeholder", () => {
  const flickr = "https://live.staticflickr.com/65535";
  const raw = GameMultimediaSchema.parse({
    images: [
      { full: `${flickr}/1_aaa_o.png`, thumbnail: `${flickr}/1_bbb_q.jpg` },
      { full: `${flickr}/2_ccc_o.jpg`, thumbnail: `${flickr}/2_ddd_q.jpg` },
      { full: "https://example.com/full.jpg", thumbnail: "https://example.com/thumb.jpg" },
    ],
    youtubeVideoUrl: "https://youtube.com/live/oRmhHDlaoFI?feature=share",
  });
  assert.deepEqual(normalizeMedia(raw), {
    photos: [
      { thumb: `${flickr}/2_ddd_n.jpg`, large: `${flickr}/2_ddd_b.jpg` },
      { thumb: "https://example.com/thumb.jpg", large: "https://example.com/full.jpg" },
    ],
    video: "oRmhHDlaoFI",
  });
  assert.deepEqual(normalizeMedia(GameMultimediaSchema.parse({})), { photos: [], video: null });
});

test("youtubeId handles watch, live and short URLs", () => {
  assert.equal(youtubeId("https://www.youtube.com/watch?v=GIEp4KuLx2Y"), "GIEp4KuLx2Y");
  assert.equal(youtubeId("https://youtu.be/kBr_VByBJgo"), "kBr_VByBJgo");
  assert.equal(youtubeId("https://example.com/video"), null);
});

test("normalizeReport orders events, detects power play and checks completeness", async () => {
  const { GameDetailSchema } = await import("./schemas.mjs");
  const { normalizeReport } = await import("./normalize.mjs");
  const player = (id, first, last) => ({ playerId: id, firstName: first, lastName: last });
  const raw = GameDetailSchema.parse({
    status: "FINISHED",
    HomeTeamGoals: 1,
    AwayTeamGoals: 1,
    HomeTeamSaves: 10,
    AwayTeamSaves: 12,
    HomeTeam: { teamId: DRAGONS, nick: "Dragons" },
    AwayTeam: { teamId: RAPTORS, nick: "Raptors" },
    Lineups: [{ number: 9, teamId: DRAGONS, Player: player("p1", "Jan", "Novák ") }],
    GameStars: [],
    GameEvents: [
      { entity: "GameEventGoal", period: "2. Třetina", gameTime: "20:30", scoredByTeamId: DRAGONS, ScoredByPlayer: player("p1", "Jan", "Novák ") },
      { entity: "GameEventPenalty", period: "2. Třetina", gameTime: "19:52", duration: "1:45", penalizedTeamId: RAPTORS, PenalizedPlayer: player("p2", "Petr", "Pudil"), ListPenaltySubtype: { name: "Hákování" } },
      { entity: "GameEventGoal", period: "Prodloužení", gameTime: "46:10", scoredByTeamId: RAPTORS, ScoredByPlayer: player("p2", "Petr", "Pudil") },
      { entity: "GameEventSomethingNew", period: "1. Třetina", gameTime: "1:00" },
    ],
  });
  const r = normalizeReport(raw);
  assert.equal(r.complete, true);
  assert.deepEqual(r.shots, { home: 13, away: 11 }); // opponent saves + own goals
  assert.deepEqual(r.events.map((e) => `${e.type}@${e.time}/${e.period}`), ["penalty@19:52/2", "goal@20:30/2", "goal@46:10/OT"]);
  assert.equal(r.events[1].strength, "pp");
  assert.deepEqual(r.events[1].scorer, { playerId: "p1", name: "Jan Novák", number: 9 });
  assert.equal(r.events[2].strength, "even");
  assert.equal(normalizeReport({ ...raw, HomeTeamGoals: 2 }).complete, false);
});
