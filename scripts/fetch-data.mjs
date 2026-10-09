// Build-time data fetch from the HMS public API (see CLAUDE.md).
// Writes data/{teams,games,standings,meta}.json and public/logos/{teamId}.webp.
// Any fetch or validation failure keeps the existing /data and exits 0,
// so the site still builds from the last good snapshot.
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { CompetitionInfoSchema, GameDetailSchema, GameMultimediaSchema, GameSchema, GamesSchema, StandingsSchema } from "./lib/schemas.mjs";
import { checkConsistency, discoverSeason, normalize, normalizeMedia, normalizeReport, normalizeStandings, pragueDate } from "./lib/normalize.mjs";
import { MODEL, createClient, narrativeKey, writeNarrative } from "./lib/narrate.mjs";
import { matchFacts } from "../src/lib/recap.ts";
import { longDate } from "../src/lib/format.ts";

const API = process.env.HMS_API ?? "https://api.prod.hms.wootera.net/public"; // override for testing
const COMPETITION_ID = "C7C0BB15-5D29-415D-851E-5D777C6CC621"; // PHM Cup
const OUR_TEAM_ID = "E70C43E0-264E-11EF-BE38-052B0AF887CA"; // PHT Dragons
const LOGO_SIZES = ["cropped_md", "md"];
const TIMEOUT_MS = 30_000;
// Photos and corrections arrive days after a game: keep re-checking per-game data this long.
const MEDIA_RECHECK_DAYS = 14;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(root, "data");
const LOGO_DIR = path.join(root, "public", "logos");

// "::warning::" shows up as an annotation in GitHub Actions.
const warn = (msg) => console.log(`${process.env.GITHUB_ACTIONS ? "::warning::" : "WARN "}${msg}`);

async function getJson(endpoint, params, schema) {
  const url = `${API}/${endpoint}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`${endpoint}: validation failed\n  ${issues.join("\n  ")}`);
  }
  return parsed.data;
}

async function exists(file) {
  return access(file).then(() => true, () => false);
}

async function readJsonOrNull(file) {
  return readFile(file, "utf8").then(JSON.parse, () => null);
}

const toJson = (value) => JSON.stringify(value, null, 2) + "\n";

/** Download missing logos. Failures are warnings only; the site renders a fallback. */
async function syncLogos(teams) {
  await mkdir(LOGO_DIR, { recursive: true });
  let downloaded = 0;
  const missing = [];
  for (const team of teams) {
    const file = path.join(LOGO_DIR, `${team.teamId}.webp`);
    if (await exists(file)) continue;
    if (!team.logoSource) {
      missing.push(team.name);
      continue;
    }
    let ok = false;
    for (const size of LOGO_SIZES) {
      try {
        // No query strings: S3 answers 403.
        const res = await fetch(team.logoSource.replace("[size]", size), {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) continue;
        const input = Buffer.from(await res.arrayBuffer());
        await sharp(input)
          .resize(256, 256, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 85 })
          .toFile(file);
        ok = true;
        downloaded++;
        break;
      } catch (err) {
        warn(`logo ${team.name} (${size}): ${err.message}`);
      }
    }
    if (!ok) missing.push(team.name);
  }
  if (missing.length) warn(`no logo for: ${missing.join(", ")}`);
  return downloaded;
}

/**
 * Per-game data of our finished games (photos, match report), cached in data/{file}.
 * The API needs one call per game, so to keep request volume low a game is fetched once and
 * then only re-checked while it is recent (photos and corrections arrive days later).
 * Each entry stores the normalizer `version`; bump it when the normalizer changes so cached
 * games are fetched once more. Failures are warnings only and keep the cached entry.
 */
async function syncPerGame(games, { file, endpoint, schema, normalize: norm, version }) {
  const target = path.join(DATA_DIR, file);
  const prevText = await readFile(target, "utf8").catch(() => null);
  const cache = prevText ? JSON.parse(prevText) : {};
  const recentSince = Date.now() - MEDIA_RECHECK_DAYS * 864e5;
  const ours = games.filter(
    (g) => g.status === "finished" && (g.homeTeamId === OUR_TEAM_ID || g.awayTeamId === OUR_TEAM_ID),
  );
  let fetched = 0;
  for (const g of ours) {
    const cached = cache[g.gameId];
    if (cached?.version === version && Date.parse(g.start) < recentSince) continue;
    try {
      cache[g.gameId] = { version, ...norm(await getJson(endpoint, { gameId: g.gameId }, schema)) };
      fetched++;
    } catch (err) {
      warn(`${endpoint} ${g.date} ${g.gameId}: ${err.message}`);
    }
  }
  // Drop entries for games that are no longer ours/finished (e.g. a corrected result).
  const keep = new Set(ours.map((g) => g.gameId));
  const next = Object.fromEntries(Object.keys(cache).filter((id) => keep.has(id)).sort().map((id) => [id, cache[id]]));
  const changed = prevText !== toJson(next);
  if (changed) await writeFile(target, toJson(next));
  return { entries: next, fetched, total: ours.length, changed };
}

// Past seasons (team-level history for the stats page). Finished seasons never change, so each
// is fetched once and kept in data/history.json; at most HISTORY_PER_RUN seasons per run.
const HISTORY_PER_RUN = 3;

async function syncHistory(info, ctx) {
  const file = path.join(DATA_DIR, "history.json");
  const prevText = await readFile(file, "utf8").catch(() => null);
  const history = prevText ? JSON.parse(prevText) : { seasons: {} };
  const comp = info.Competitions.find((c) => c.competitionId === COMPETITION_ID);
  const past = comp.Seasons.filter((s) => s.seasonId !== ctx.season.id && s.startDate && s.startDate < ctx.season.startDate)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  let fetched = 0;
  for (const season of past) {
    if (history.seasons[season.seasonId] || fetched >= HISTORY_PER_RUN) continue;
    try {
      // Lenient: keep every game that matches the schema, skip odd old records.
      const raw = await getJson("games", { seasonId: season.seasonId }, z.array(z.unknown()));
      const games = raw
        .map((g) => GameSchema.safeParse(g))
        .filter((r) => r.success)
        .map((r) => r.data)
        .filter((g) => g.status === "FINISHED" && g.HomeTeam && g.AwayTeam && [g.HomeTeam.teamId, g.AwayTeam.teamId].includes(OUR_TEAM_ID))
        .map((g) => ({
          gameId: g.gameId,
          date: g.startDate,
          group: g.Phase.Group.name,
          phase: g.Phase.name,
          homeTeamId: g.HomeTeam.teamId,
          awayTeamId: g.AwayTeam.teamId,
          homeName: g.HomeTeam.name,
          awayName: g.AwayTeam.name,
          homeGoals: g.HomeTeamGoals,
          awayGoals: g.AwayTeamGoals,
          venue: g.Venue?.name ?? null,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      history.seasons[season.seasonId] = { name: season.name, startDate: season.startDate, games };
      fetched++;
    } catch (err) {
      warn(`history ${season.name}: ${err.message}`);
    }
  }
  const sorted = { seasons: Object.fromEntries(Object.entries(history.seasons).sort((a, b) => a[1].startDate.localeCompare(b[1].startDate))) };
  if (prevText !== toJson(sorted)) await writeFile(file, toJson(sorted));
  const withUs = Object.values(sorted.seasons).filter((s) => s.games.length);
  return { fetched, seasons: withUs.length, games: withUs.reduce((n, s) => n + s.games.length, 0), pending: past.length - Object.keys(sorted.seasons).length };
}

// Past seasons in depth, for the season switch on the radar: the regular-season standings of the
// group we played in (one call per season, stored with the season in history.json) and the match
// reports of our games (data/history-reports.json). Finished seasons don't change, so everything
// is fetched once; reports at most HISTORY_REPORTS_PER_RUN per run to keep the API load low.
const HISTORY_REPORTS_PER_RUN = 10;
const REPORT_VERSION = 3;
const REGULAR_PHASE = "Základní část";

async function syncHistoryDetail(info) {
  const file = path.join(DATA_DIR, "history.json");
  const prevText = await readFile(file, "utf8").catch(() => null);
  if (!prevText) return { standings: 0, reports: 0, fetched: 0, pending: 0 };
  const history = JSON.parse(prevText);
  const comp = info.Competitions.find((c) => c.competitionId === COMPETITION_ID);

  // standings, one per season we played in
  for (const [seasonId, season] of Object.entries(history.seasons)) {
    if (!season.games.length || season.standings) continue;
    const groupName = season.games.find((g) => g.phase === REGULAR_PHASE)?.group ?? season.games[0].group;
    const phase = comp.Seasons.find((x) => x.seasonId === seasonId)
      ?.Groups.find((g) => g.name === groupName)
      ?.Phases.find((p) => p.name === REGULAR_PHASE);
    if (!phase) {
      warn(`history standings ${season.name}: no "${REGULAR_PHASE}" phase in ${groupName}`);
      continue;
    }
    try {
      const raw = await getJson("standings", { phaseId: phase.phaseId }, StandingsSchema);
      season.standings = { group: groupName, phase: REGULAR_PHASE, rows: normalizeStandings(raw, { names: true }) };
    } catch (err) {
      warn(`history standings ${season.name}: ${err.message}`);
    }
  }
  if (prevText !== toJson(history)) await writeFile(file, toJson(history));

  // match reports of our past games
  const rFile = path.join(DATA_DIR, "history-reports.json");
  const rPrev = await readFile(rFile, "utf8").catch(() => null);
  const cache = rPrev ? JSON.parse(rPrev) : {};
  const games = Object.values(history.seasons).flatMap((x) => x.games);
  let fetched = 0;
  for (const g of games) {
    if (cache[g.gameId]?.version === REPORT_VERSION) continue;
    if (fetched >= HISTORY_REPORTS_PER_RUN) break;
    fetched++;
    try {
      cache[g.gameId] = { version: REPORT_VERSION, ...normalizeReport(await getJson("game", { gameId: g.gameId }, GameDetailSchema)) };
    } catch (err) {
      warn(`history report ${g.date} ${g.gameId}: ${err.message}`);
    }
  }
  const next = Object.fromEntries(Object.keys(cache).sort().map((id) => [id, cache[id]]));
  if (rPrev !== toJson(next)) await writeFile(rFile, toJson(next));
  const have = games.filter((g) => next[g.gameId]).length;
  return {
    standings: Object.values(history.seasons).filter((x) => x.standings).length,
    reports: have,
    fetched,
    pending: games.length - have,
  };
}

// Other teams' games of our group, for the opponent analysis (their top scorers): only goals with
// assists and who played, from each game's report. A finished game is fetched once (re-checked
// while under MEDIA_RECHECK_DAYS old, like our own), at most LEAGUE_REPORTS_PER_RUN per run.
const LEAGUE_REPORTS_PER_RUN = 10;
const LEAGUE_REPORT_VERSION = 1;

async function syncLeagueReports(games) {
  const file = path.join(DATA_DIR, "league-reports.json");
  const prevText = await readFile(file, "utf8").catch(() => null);
  const cache = prevText ? JSON.parse(prevText) : {};
  const recentSince = Date.now() - MEDIA_RECHECK_DAYS * 864e5;
  const theirs = games.filter((g) => g.status === "finished" && g.homeTeamId !== OUR_TEAM_ID && g.awayTeamId !== OUR_TEAM_ID);
  let fetched = 0;
  for (const g of theirs) {
    const cached = cache[g.gameId];
    if (cached?.version === LEAGUE_REPORT_VERSION && (Date.parse(g.start) < recentSince || cached.checkedAt > Date.parse(g.start) + 864e5)) continue;
    if (fetched >= LEAGUE_REPORTS_PER_RUN) break;
    fetched++;
    try {
      const r = normalizeReport(await getJson("game", { gameId: g.gameId }, GameDetailSchema));
      const slim = (p) => (p ? { playerId: p.playerId, name: p.name, number: p.number } : null);
      cache[g.gameId] = {
        version: LEAGUE_REPORT_VERSION,
        checkedAt: Date.now(),
        complete: r.complete,
        goals: r.events.filter((e) => e.type === "goal").map((e) => ({ teamId: e.teamId, scorer: slim(e.scorer), assists: e.assists.map(slim) })),
        lineup: (r.lineup ?? []).map((l) => ({ teamId: l.teamId, playerId: l.playerId, name: l.name, number: l.number, position: l.position })),
      };
    } catch (err) {
      warn(`league report ${g.date} ${g.gameId}: ${err.message}`);
    }
  }
  const keep = new Set(theirs.map((g) => g.gameId));
  const next = Object.fromEntries(Object.keys(cache).filter((id) => keep.has(id)).sort().map((id) => [id, cache[id]]));
  if (prevText !== toJson(next)) await writeFile(file, toJson(next));
  return { have: Object.keys(next).length, total: theirs.length, fetched };
}

// Upper bound on model calls per run, so a bug can't run up a bill.
const MAX_NARRATIVES_PER_RUN = 8;

/**
 * AI-written match narratives (data/narratives.json). A game's text is (re)written only when its
 * facts, the model or the prompt change. Without ANTHROPIC_API_KEY nothing is generated and the
 * site falls back to the template recap.
 */
async function syncNarratives(games, teams, reports, ctx) {
  const file = path.join(DATA_DIR, "narratives.json");
  const prevText = await readFile(file, "utf8").catch(() => null);
  const cache = prevText ? JSON.parse(prevText) : {};
  const client = createClient();
  const nameOf = (id) => teams.find((t) => t.teamId === id)?.name ?? "soupeř";
  const todo = [];
  const keep = new Set();
  for (const g of games) {
    const report = reports[g.gameId];
    if (g.status !== "finished" || !report) continue;
    keep.add(g.gameId);
    const facts = matchFacts(g, report, OUR_TEAM_ID, {
      ourName: nameOf(OUR_TEAM_ID),
      opponentName: nameOf(g.homeTeamId === OUR_TEAM_ID ? g.awayTeamId : g.homeTeamId),
      dateText: longDate(g.date),
      competition: `${ctx.competition.name}, skupina ${ctx.group.name}, ${ctx.phase.name.toLowerCase()}`,
    });
    const key = narrativeKey(facts);
    if (cache[g.gameId]?.key !== key) todo.push({ g, facts, key });
  }
  let written = 0;
  const usage = { input: 0, output: 0 };
  if (client) {
    for (const { g, facts, key } of todo.slice(0, MAX_NARRATIVES_PER_RUN)) {
      try {
        const { usage: u, ...text } = await writeNarrative(client, facts);
        cache[g.gameId] = { key, model: MODEL, generatedAt: new Date().toISOString(), ...text };
        usage.input += u.input;
        usage.output += u.output;
        written++;
      } catch (err) {
        warn(`narrative ${g.date} ${g.gameId}: ${err.message}`);
      }
    }
  }
  // Keep texts of our current games and the weekly summaries ("round:<monday>", written by the
  // morning routine via scripts/narratives.mjs); drop texts of games that are no longer ours.
  const next = Object.fromEntries(Object.keys(cache).filter((id) => keep.has(id) || id.startsWith("round:")).sort().map((id) => [id, cache[id]]));
  if (prevText !== toJson(next)) await writeFile(file, toJson(next));
  return { written, pending: todo.length - written, total: keep.size, have: Object.keys(next).filter((id) => keep.has(id)).length, usage, enabled: !!client };
}

async function main() {
  const today = pragueDate();

  // 1. Discover current season + KLASIK regular-season phase (no hardcoded IDs).
  const info = await getJson("competitionInfo", { competitionIds: COMPETITION_ID }, CompetitionInfoSchema);
  const ctx = discoverSeason(info, COMPETITION_ID, today);

  // 2. One call per endpoint.
  const rawGames = await getJson("games", { seasonId: ctx.season.id }, GamesSchema);
  const rawStandings = await getJson("standings", { phaseId: ctx.phase.id }, StandingsSchema);

  // 3. Normalize + sanity-check before touching /data.
  const result = normalize({ rawGames, rawStandings });
  const problems = checkConsistency(result, OUR_TEAM_ID);
  if (problems.length) throw new Error(`consistency check failed: ${problems.join("; ")}`);

  // 4. Logos (best effort), then record which teams have one.
  const downloaded = await syncLogos(result.teams);
  const teams = [];
  for (const { logoSource, ...t } of result.teams) {
    const hasLogo = await exists(path.join(LOGO_DIR, `${t.teamId}.webp`));
    teams.push({ ...t, logo: hasLogo ? `logos/${t.teamId}.webp` : null });
  }

  // 5. Write only when the content changed, so the workflow does not commit
  //    a new snapshot every 30 minutes just because fetchedAt moved.
  const files = { teams, games: result.games, standings: result.standings };
  await mkdir(DATA_DIR, { recursive: true });
  let changed = false;
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(DATA_DIR, `${name}.json`);
    const prev = await readFile(file, "utf8").catch(() => null);
    if (prev !== toJson(value)) changed = true;
  }
  const prevMeta = await readJsonOrNull(path.join(DATA_DIR, "meta.json"));
  const meta = {
    fetchedAt: new Date().toISOString(),
    ourTeamId: OUR_TEAM_ID,
    ...ctx,
    counts: { teams: teams.length, games: result.games.length, standings: result.standings.length },
  };
  if (changed || !prevMeta) {
    for (const [name, value] of Object.entries(files)) {
      await writeFile(path.join(DATA_DIR, `${name}.json`), toJson(value));
    }
    await writeFile(path.join(DATA_DIR, "meta.json"), toJson(meta));
  }

  // 6. Photos/videos and match reports of our played games (best effort, cached).
  const media = await syncPerGame(result.games, {
    file: "media.json",
    endpoint: "gameMultimedia",
    schema: GameMultimediaSchema,
    normalize: normalizeMedia,
    version: 1,
  });
  const reports = await syncPerGame(result.games, {
    file: "reports.json",
    endpoint: "game",
    schema: GameDetailSchema,
    normalize: normalizeReport,
    version: 3,
  });
  const narratives = await syncNarratives(result.games, teams, reports.entries, ctx);
  const hist = await syncHistory(info, ctx);
  const histDetail = await syncHistoryDetail(info);
  const league = await syncLeagueReports(result.games);
  const withPhotos = Object.values(media.entries).filter((m) => m.photos.length).length;
  const complete = Object.values(reports.entries).filter((r) => r.complete).length;

  // 7. Summary.
  const byStatus = Object.groupBy(result.games, (g) => g.status);
  const ours = result.games.filter((g) => g.homeTeamId === OUR_TEAM_ID || g.awayTeamId === OUR_TEAM_ID);
  const nextOurs = ours.find((g) => g.status !== "finished");
  const ourRow = result.standings.find((s) => s.teamId === OUR_TEAM_ID);
  const nameOf = (id) => teams.find((t) => t.teamId === id)?.name ?? id;
  console.log(
    [
      `fetch-data: ${ctx.competition.name} ${ctx.season.name}, ${ctx.group.name} / ${ctx.phase.name}`,
      `  games:     ${result.games.length} (finished ${byStatus.finished?.length ?? 0}, running ${byStatus.running?.length ?? 0}, scheduled ${byStatus.scheduled?.length ?? 0}; skipped ${result.skippedGames} with undecided teams)`,
      `  teams:     ${teams.length} (${teams.filter((t) => t.logo).length} with logo, ${downloaded} downloaded now)`,
      `  standings: ${result.standings.length} rows; PHT Dragons #${ourRow.rank}, ${ourRow.points} pts from ${ourRow.played} games`,
      `  ours:      ${ours.length} games` +
        (nextOurs ? `; next ${nextOurs.date} ${nextOurs.time} ${nameOf(nextOurs.homeTeamId)} vs ${nameOf(nextOurs.awayTeamId)} @ ${nextOurs.venue}` : ""),
      `  media:     ${withPhotos}/${media.total} played games with photos (${media.fetched} checked now${media.changed ? ", updated" : ""})`,
      `  reports:   ${complete}/${reports.total} played games with full events (${reports.fetched} checked now${reports.changed ? ", updated" : ""})`,
      `  texts:     ${narratives.have}/${narratives.total} AI narratives` +
        (narratives.enabled
          ? ` (${narratives.written} written now, ${narratives.usage.input}+${narratives.usage.output} tokens${narratives.pending ? `, ${narratives.pending} pending` : ""})`
          : narratives.pending
            ? ` (${narratives.pending} waiting: write them with npm run narratives:pending / narratives:save)`
            : " (all written)"),
      `  history:   ${hist.games} games in ${hist.seasons} earlier seasons (${hist.fetched} fetched now${hist.pending ? `, ${hist.pending} pending` : ""})`,
      `  league:    ${league.have}/${league.total} other games of the group with a report (${league.fetched} fetched now)`,
      `  history+:  ${histDetail.standings} past standings, ${histDetail.reports} past match reports (${histDetail.fetched} fetched now${histDetail.pending ? `, ${histDetail.pending} pending` : ""})`,
      `  /data:     ${changed || !prevMeta ? "updated" : "unchanged, files not rewritten"}`,
    ].join("\n"),
  );
}

try {
  await main();
} catch (err) {
  warn(`fetch-data failed, keeping existing /data: ${err.message}`);
}
process.exit(0);
