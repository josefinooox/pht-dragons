// Build-time data fetch from the HMS public API (see CLAUDE.md).
// Writes data/{teams,games,standings,meta}.json and public/logos/{teamId}.webp.
// Any fetch or validation failure keeps the existing /data and exits 0,
// so the site still builds from the last good snapshot.
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { CompetitionInfoSchema, GameDetailSchema, GameMultimediaSchema, GamesSchema, StandingsSchema } from "./lib/schemas.mjs";
import { checkConsistency, discoverSeason, normalize, normalizeMedia, normalizeReport, pragueDate } from "./lib/normalize.mjs";
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
  const next = Object.fromEntries(Object.keys(cache).filter((id) => keep.has(id)).sort().map((id) => [id, cache[id]]));
  if (prevText !== toJson(next)) await writeFile(file, toJson(next));
  return { written, pending: todo.length - written, total: keep.size, have: Object.keys(next).length, usage, enabled: !!client };
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
    version: 1,
  });
  const narratives = await syncNarratives(result.games, teams, reports.entries, ctx);
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
          : ` (no ANTHROPIC_API_KEY, ${narratives.pending} waiting; site uses template recaps)`),
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
