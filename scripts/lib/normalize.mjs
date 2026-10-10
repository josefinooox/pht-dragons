// Pure functions turning validated API responses into the /data JSON shape.
// No I/O here, so it can be unit-tested with small fixtures.

export const TIME_ZONE = "Europe/Prague";
export const GROUP_NAME = "KLASIK";
export const REGULAR_PHASE_NAME = "Základní část";

const STATUS = { "NOT PLAYED": "scheduled", RUNNING: "running", FINISHED: "finished" };

/** "YYYY-MM-DD" for the given instant in Europe/Prague. */
export function pragueDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

function pragueOffsetMinutes(utcMs) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "longOffset" })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === "timeZoneName").value; // "GMT+02:00" or "GMT"
  const m = name.match(/([+-])(\d{2}):(\d{2})/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** Prague wall-clock date + time -> ISO 8601 with the correct offset, e.g. "2026-10-06T20:30:00+02:00". */
export function pragueToIso(date, time) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let offset = pragueOffsetMinutes(wall);
  offset = pragueOffsetMinutes(wall - offset * 60_000); // settle across DST boundaries
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date}T${pad(h)}:${pad(mi)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Pick the current season (today within its dates, else the latest one that has started)
 * and its KLASIK group + regular-season phase.
 */
export function discoverSeason(info, competitionId, today) {
  const comp = info.Competitions.find((c) => c.competitionId === competitionId);
  if (!comp) throw new Error(`competition ${competitionId} not in competitionInfo`);
  const started = comp.Seasons.filter((s) => s.startDate && s.startDate <= today).sort((a, b) =>
    b.startDate.localeCompare(a.startDate),
  );
  const season =
    started.find((s) => !s.endDate || today <= s.endDate) ?? started[0];
  if (!season) throw new Error("no started season found");
  const group = season.Groups.find((g) => g.name === GROUP_NAME);
  if (!group) throw new Error(`group ${GROUP_NAME} not in season ${season.name}`);
  const phase = group.Phases.find((p) => p.name === REGULAR_PHASE_NAME);
  if (!phase) throw new Error(`phase "${REGULAR_PHASE_NAME}" not in ${GROUP_NAME}`);
  return {
    competition: { id: comp.competitionId, name: comp.name },
    season: { id: season.seasonId, name: season.name, startDate: season.startDate, endDate: season.endDate },
    group: { id: group.groupId, name: group.name },
    phase: { id: phase.phaseId, name: phase.name },
  };
}

/** Logo URL template ("...[size]") from the API, or null. */
const logoTemplate = (url) => (url && url.includes("[size]") ? url : null);

function parsePenaltyMinutes(mmss) {
  const [m, s] = mmss.split(":").map(Number);
  return m + s / 60;
}

/** Standings rows in API order with rank (also used for past seasons). */
export function normalizeStandings(rawStandings, { names = false } = {}) {
  return rawStandings.map((r, i) => {
    const [goalsFor, goalsAgainst] = r.Score.split(":").map(Number);
    return {
      rank: i + 1,
      teamId: r.TeamId,
      ...(names ? { name: r["Team Name"].replace(/\s+/g, " ").trim(), shortName: r["Team Name Short"] ?? null } : {}),
      played: r["Total Games"],
      wins: r.Wins,
      draws: r.Draws,
      losses: r.Losses,
      points: r["Total Points"],
      goalsFor,
      goalsAgainst,
      penaltyMinutes: Math.round(parsePenaltyMinutes(r["Total Penalty Minutes"]) * 100) / 100,
    };
  });
}

/**
 * @returns {{ teams, games, standings, skippedGames }}
 *   teams:     [{ teamId, name, shortName, logoSource }] sorted by name
 *   games:     KLASIK games with both teams known, sorted by start
 *   standings: rows in API order with rank
 */
export function normalize({ rawGames, rawStandings }) {
  const klasik = rawGames.filter((g) => g.Phase.Group.name === GROUP_NAME);
  const playable = klasik.filter((g) => g.HomeTeam && g.AwayTeam);

  const teams = new Map();
  const addTeam = (teamId, name, shortName, logo) => {
    const t = teams.get(teamId) ?? { teamId, name, shortName: null, logoSource: null };
    t.shortName ??= shortName || null;
    t.logoSource ??= logoTemplate(logo);
    teams.set(teamId, t);
  };

  for (const r of rawStandings) addTeam(r.TeamId, r["Team Name"], r["Team Name Short"], r.TeamLogo);

  const games = playable
    .map((g) => {
      // Game name is "HOME vs AWAY" in short names; use it as a short-name fallback.
      const [homeShort, awayShort] = g.name.split(" vs ").map((s) => s?.trim());
      addTeam(g.HomeTeam.teamId, g.HomeTeam.name, homeShort, g.HomeTeam.logoUrl);
      addTeam(g.AwayTeam.teamId, g.AwayTeam.name, awayShort, g.AwayTeam.logoUrl);
      const status = STATUS[g.status];
      const hasScore = status !== "scheduled";
      return {
        gameId: g.gameId,
        phaseId: g.Phase.phaseId,
        phaseName: g.Phase.name,
        date: g.startDate,
        time: g.startTime.slice(0, 5),
        start: pragueToIso(g.startDate, g.startTime),
        status,
        homeTeamId: g.HomeTeam.teamId,
        awayTeamId: g.AwayTeam.teamId,
        homeGoals: hasScore ? g.HomeTeamGoals : null,
        awayGoals: hasScore ? g.AwayTeamGoals : null,
        venue: g.Venue?.name ?? null,
        stars: (g.GameStars ?? []).map((s) => ({
          teamId: s.teamId,
          number: s.LineupNumber,
          firstName: s.Player.firstName,
          lastName: s.Player.lastName,
        })),
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.gameId.localeCompare(b.gameId));

  const standings = normalizeStandings(rawStandings);

  return {
    teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name, "cs")),
    games,
    standings,
    skippedGames: klasik.length - playable.length,
  };
}

// Flickr URLs: .../{server}/{id}_{secret}_{size}.jpg. Sizes up to "b" (1024 px) share the secret,
// so the 320 px thumbnail and 1024 px view are derived from the 150 px "q" thumbnail.
const FLICKR = /^(https:\/\/live\.staticflickr\.com\/\d+\/\d+_[0-9a-f]+)_q\.jpg$/;

/** YouTube video ID from watch?v=, youtu.be/ or /live/ URLs. */
export function youtubeId(url) {
  if (!url) return null;
  const m = url.match(/(?:[?&]v=|youtu\.be\/|\/live\/|\/embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}

/**
 * Game photos + video. PNG "full" images are the league's "coming up shortly" placeholder, skipped.
 * @returns {{ photos: {thumb: string, large: string}[], video: string|null }}
 */
export function normalizeMedia(raw) {
  const photos = [];
  for (const img of raw.images ?? []) {
    if (/\.png$/i.test(img.full)) continue;
    const m = img.thumbnail.match(FLICKR);
    photos.push(m ? { thumb: `${m[1]}_n.jpg`, large: `${m[1]}_b.jpg` } : { thumb: img.thumbnail, large: img.full });
  }
  return { photos, video: youtubeId(raw.youtubeVideoUrl) };
}

const toSec = (clock) => {
  const [m, s] = clock.split(":").map(Number);
  return m * 60 + s;
};

/** "1. Třetina" -> "1", "Prodloužení" -> "OT", "Samostatné nájezdy" -> "SN". */
function periodKey(name) {
  const m = name.match(/^(\d)\./);
  if (m) return m[1];
  if (/prodlou/i.test(name)) return "OT";
  if (/nájezd|najezd/i.test(name)) return "SN";
  return name;
}

/**
 * Match report facts from /public/game: goals and penalties in time order, team stats, stars.
 * `complete` is false when the goal events do not add up to the final score
 * (e.g. a result entered without events); the site then skips the event-based story.
 */
export function normalizeReport(raw) {
  const home = raw.HomeTeam.teamId;
  const away = raw.AwayTeam.teamId;
  const numbers = new Map((raw.Lineups ?? []).map((l) => [l.Player.playerId, l.number]));
  const person = (p) =>
    p
      ? { playerId: p.playerId, name: `${p.firstName} ${p.lastName}`.replace(/\s+/g, " ").trim(), number: numbers.get(p.playerId) ?? null }
      : null;

  const events = [];
  for (const e of raw.GameEvents ?? []) {
    if (!e.gameTime) continue; // no time (old reports): the report then counts as incomplete
    const base = { period: periodKey(e.period), time: e.gameTime, sec: toSec(e.gameTime) };
    if (e.entity === "GameEventGoal" && e.scoredByTeamId) {
      events.push({
        type: "goal",
        ...base,
        teamId: e.scoredByTeamId,
        scorer: person(e.ScoredByPlayer),
        assists: [e.AssistedBy1Player, e.AssistedBy2Player].filter(Boolean).map(person),
      });
    } else if (e.entity === "GameEventPenalty" && e.penalizedTeamId) {
      events.push({
        type: "penalty",
        ...base,
        teamId: e.penalizedTeamId,
        player: person(e.PenalizedPlayer),
        duration: e.duration || null,
        reason: e.ListPenaltySubtype?.name ?? e.ListPenaltyType?.name ?? null,
      });
    }
  }
  events.sort((a, b) => a.sec - b.sec || (a.type === b.type ? 0 : a.type === "penalty" ? -1 : 1));

  // Power play / short-handed: count penalties running at the moment of the goal. A minor
  // penalty (up to 2 min; 1:45 in this league) ends early when the other team scores on it.
  const MINOR_MAX_SEC = 120;
  const penaltyEnd = new Map(
    events.filter((e) => e.type === "penalty" && e.duration).map((p) => [p, p.sec + toSec(p.duration)]),
  );
  const running = (teamId, sec) =>
    [...penaltyEnd].filter(([p, end]) => p.teamId === teamId && p.sec < sec && sec <= end).map(([p]) => p);
  for (const g of events) {
    if (g.type !== "goal") continue;
    const other = g.teamId === home ? away : home;
    const theirs = running(other, g.sec);
    const diff = theirs.length - running(g.teamId, g.sec).length;
    g.strength = diff > 0 ? "pp" : diff < 0 ? "sh" : "even";
    if (g.strength === "pp") {
      // The power-play goal releases the minor penalty that started first.
      const minor = theirs.filter((p) => toSec(p.duration) <= MINOR_MAX_SEC).sort((a, b) => a.sec - b.sec)[0];
      if (minor) penaltyEnd.set(minor, g.sec);
    }
  }

  const goals = (t) => events.filter((e) => e.type === "goal" && e.teamId === t).length;
  const shots = (saves, goalsFor) => (saves == null || goalsFor == null ? null : saves + goalsFor);
  // Who played: both teams' lineups with jersey number and position (G = goalie).
  const lineup = (raw.Lineups ?? []).map((l) => ({
    teamId: l.teamId,
    ...person(l.Player),
    position: l.ListPosition?.isGoalie ? "G" : (l.ListPosition?.short ?? null),
  }));

  return {
    homeNick: raw.HomeTeam.nick ?? null,
    awayNick: raw.AwayTeam.nick ?? null,
    complete: goals(home) === raw.HomeTeamGoals && goals(away) === raw.AwayTeamGoals,
    // Shots on goal = opponent's saves + own goals.
    shots: { home: shots(raw.AwayTeamSaves, raw.HomeTeamGoals), away: shots(raw.HomeTeamSaves, raw.AwayTeamGoals) },
    faceoffs: { home: raw.HomeTeamFaceOffs ?? null, away: raw.AwayTeamFaceOffs ?? null },
    penaltyMinutes: { home: raw.HomeTeamPenaltyMinutes ?? null, away: raw.AwayTeamPenaltyMinutes ?? null },
    stars: (raw.GameStars ?? []).map((s) => ({
      teamId: s.teamId,
      ...person(s.Player),
      number: s.LineupNumber ?? numbers.get(s.Player.playerId) ?? null,
      goals: s.Goals ?? 0,
      assists: s.Assists ?? 0,
    })),
    // Saves per team, to compute our goalies' save percentage.
    saves: { home: raw.HomeTeamSaves ?? null, away: raw.AwayTeamSaves ?? null },
    lineup,
    events,
  };
}

/** Sanity checks beyond the schema: catches "valid but empty/wrong" responses. */
export function checkConsistency({ teams, games, standings }, ourTeamId) {
  const problems = [];
  if (games.length === 0) problems.push(`no ${GROUP_NAME} games`);
  // Empty standings are fine at the start of a season (the league publishes the table later);
  // the site then shows "the table will appear once it's known".
  if (!teams.some((t) => t.teamId === ourTeamId)) problems.push(`our team ${ourTeamId} missing`);
  if (standings.length && !standings.some((s) => s.teamId === ourTeamId)) problems.push("our team missing from standings");
  return problems;
}
