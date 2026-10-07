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

  const standings = rawStandings.map((r, i) => {
    const [goalsFor, goalsAgainst] = r.Score.split(":").map(Number);
    return {
      rank: i + 1,
      teamId: r.TeamId,
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

  return {
    teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name, "cs")),
    games,
    standings,
    skippedGames: klasik.length - playable.length,
  };
}

/** Sanity checks beyond the schema: catches "valid but empty/wrong" responses. */
export function checkConsistency({ teams, games, standings }, ourTeamId) {
  const problems = [];
  if (games.length === 0) problems.push(`no ${GROUP_NAME} games`);
  if (standings.length === 0) problems.push("empty standings");
  if (!teams.some((t) => t.teamId === ourTeamId)) problems.push(`our team ${ourTeamId} missing`);
  if (!standings.some((s) => s.teamId === ourTeamId)) problems.push("our team missing from standings");
  return problems;
}
