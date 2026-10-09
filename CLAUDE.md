# PHT Dragons – team website

Static site for amateur hockey team PHT Dragons (PHM Cup, group KLASIK).
UI language: Czech. Audience: players, coaches, manager; secondarily family and friends.
Mobile-first.

## Hard constraints
- Zero monthly cost. Static Astro site, deployed to GitHub Pages by
  `.github/workflows/deploy.yml` (already working; runs every 30 min + on push).
  The one approved exception: match narratives written by Claude (Anthropic API, paid per
  call, ~30 games per season). Only when the ANTHROPIC_API_KEY secret exists, cached in
  data/narratives.json, at most 8 calls per run; without the key the site uses templates.
- Data is fetched at BUILD TIME only, by `npm run fetch` (scripts/fetch-data.mjs).
  The API blocks browser CORS, so the site must never call it from the client.
- The workflow commits /data after each fetch. If the API fails or returns data that
  fails validation, keep the existing /data and exit 0, so the site still builds.
- All dates/times formatted in Europe/Prague.
- Relative labels (Dnes, Zítra, právě se hraje, čeká se na výsledek) are computed
  client-side, because they go stale between builds.
- Site is served under a base path on GitHub Pages: always build internal links and
  asset URLs with `import.meta.env.BASE_URL`, never hardcode "/".
- Visual design: do NOT invent a style. Keep markup semantic and minimally styled
  until the owner gives design direction.
- Identify teams by teamId, never by name.

## Data source (undocumented public API, no auth)
Base: https://api.prod.hms.wootera.net/public

- GET /games?seasonId=E6134160-47CF-11F1-A223-BFDFBDD3A64B
  All games of the season (~800, every group). Keep Phase.Group.name === "KLASIK".
  Fields: startDate, startTime, status ("NOT PLAYED" | "FINISHED"),
  HomeTeam / AwayTeam {teamId, name, logoUrl}, HomeTeamGoals, AwayTeamGoals,
  Venue.name, Phase {phaseId, name, Group.name},
  GameStars [{teamId, LineupNumber, Player {firstName, lastName}}].
  HomeTeam / AwayTeam can be null (undecided playoff slots) – skip those games.
- GET /standings?phaseId=FE03DED0-869D-11F1-BDD5-8958B510B6A2   (KLASIK, Základní část)
  Only ONE of phaseId | groupId | seasonId may be given.
  Fields: TeamId, "Team Name", "Team Name Short", "Total Games", Wins, Draws, Losses,
  "Total Points", Score ("gf:ga"), "Total Penalty Minutes" ("mm:ss").
- GET /competitionInfo?competitionIds=C7C0BB15-5D29-415D-851E-5D777C6CC621
  Seasons, groups and phases with IDs. Use it to discover the current season and
  KLASIK phase instead of relying on the hardcoded IDs above forever.

- GET /gameMultimedia?gameId=...
  Photos and video of one game: images [{full, thumbnail}] (Flickr URLs), youtubeVideoUrl.
  "full" is the multi-MB original: derive Flickr sizes from the "_q" thumbnail instead
  (_n = 320 px, _b = 1024 px; larger sizes need a different secret). A PNG image is the
  league's "coming up shortly" placeholder: skip it. Photos are hotlinked, not downloaded.

- GET /game?gameId=...
  One game in detail: GameEvents (GameEventGoal with scorer/assists, GameEventPenalty with
  player, duration "1:45" and reason), period name per event, gameTime ("8:28", cumulative),
  Home/AwayTeamSaves (shots = opponent saves + own goals), FaceOffs, PenaltyMinutes (decimal),
  GameStars with Goals/Assists, Lineups (jersey numbers), team nick. headline/perex/body exist
  but the league leaves them empty. Events are unsorted; player names may contain extra spaces.
  Used for the match recap (src/lib/recap.ts): facts in code, sentences from templates.

Validate every response with a schema (zod). The API can change without notice.
Keep request volume low: one call per endpoint per build. Exception: gameMultimedia and game
are per game, so they are cached in data/media.json and data/reports.json, fetched only for
our finished games, and re-checked only while a game is less than 14 days old. Bump the
`version` passed to syncPerGame when a normalizer changes, so cached games are refetched once.

## Logos
`logoUrl` contains "[size]". Try "cropped_md", then "md". Do not add query strings
(S3 returns 403). Download during fetch, convert to webp (sharp), store as
/public/logos/{teamId}.webp, and render a fallback (team short name) when missing.
Only re-download logos that are not already present.

## Pages
- `/` – schedule. Tabs Nadcházející | Odehrané (`/odehrane`).
  Next match emphasized: date, time, venue with map link, add to calendar, share.
  Button to subscribe to the whole season (webcal link to /dragons.ics).
  Desktop: table excerpt in a side column. Mobile: hamburger menu in the header.
- `/zapas/[yyyy-mm-dd-opponent-slug]` – match + opponent analysis: summary text,
  form (last 5), per-game comparison (points, goals for/against, penalty minutes),
  their recent results with each opponent's rank, common opponents, the other
  meeting this season, table excerpt with both teams highlighted.
- `/tabulka` – full standings; each team links to our nearest match against it.
- `/dragons.ics` – season calendar feed, TZID Europe/Prague, stable UIDs per game
  so subscribed calendars update instead of duplicating.
- Open Graph tags on every page for link previews (WhatsApp).
- A 404 page.

## Opponent summary and match recap
- Upcoming games: opponent summary, template-based from computed facts (src/lib/summary.ts).
- Played games: commentator-style narrative written by Claude. Default path (no cost
  beyond the Claude subscription): a scheduled Claude Code cloud routine runs every morning
  at 7:00 Prague (it cannot reach the league API, so it relies on the data GitHub Actions
  commits; it never runs `npm run fetch`),
  `npm run narratives:pending` lists games without a current text plus the writing rules,
  Claude writes them, `npm run narratives:save -- file.json` validates and stores them.
  Optional paid path: the build writes them via the API (scripts/lib/narrate.mjs,
  claude-opus-5-5) when the ANTHROPIC_API_KEY secret exists. Facts are computed in code
  (matchFacts in src/lib/recap.ts) and passed to the model; it only phrases them and must
  not invent details. Regenerated only when the facts, model or PROMPT_VERSION change.
  Fallback without a narrative: template recap from the same facts.
- "Řekni víc" shows a ~1.2 s skeleton before the text. The text is pre-generated, never
  generated in the browser (no API key in the client).

## Reference
`docs/prototype-reference.html` is a working single-file prototype with snapshot data.
Use it ONLY for behavior and calculations (summary rules, common opponents,
per-game stats, match states). Ignore its visual design entirely.

## Dračí radar (/radar)
Stats dashboard computed in `src/lib/brain.ts` from games, standings, reports and
`data/history.json`. History holds our games from past seasons; each finished season is
fetched once (at most `HISTORY_PER_RUN` per build) and never refetched.
