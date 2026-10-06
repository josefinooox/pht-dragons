# PHT Dragons – team website

Static site for amateur hockey team PHT Dragons (PHM Cup, group KLASIK).
UI language: Czech. Audience: players, coaches, manager; secondarily family and friends.
Mobile-first.

## Hard constraints
- Zero monthly cost. Static Astro site, deployed to GitHub Pages by
  `.github/workflows/deploy.yml` (already working; runs every 30 min + on push).
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

Validate every response with a schema (zod). The API can change without notice.
Keep request volume low: one call per endpoint per build.

## Logos
`logoUrl` contains "[size]". Try "cropped_md", then "md". Do not add query strings
(S3 returns 403). Download during fetch, convert to webp (sharp), store as
/public/logos/{teamId}.webp, and render a fallback (team short name) when missing.
Only re-download logos that are not already present.

## Pages
- `/` – schedule. Tabs Nadcházející | Odehrané (`/odehrane`).
  Next match emphasized: date, time, venue with map link, add to calendar, share.
  Button to subscribe to the whole season (webcal link to /dragons.ics).
  Desktop: table excerpt in a side column. Mobile: position chip in header linking to /tabulka.
- `/zapas/[yyyy-mm-dd-opponent-slug]` – match + opponent analysis: summary text,
  form (last 5), per-game comparison (points, goals for/against, penalty minutes),
  their recent results with each opponent's rank, common opponents, the other
  meeting this season, table excerpt with both teams highlighted.
- `/tabulka` – full standings; each team links to our nearest match against it.
- `/dragons.ics` – season calendar feed, TZID Europe/Prague, stable UIDs per game
  so subscribed calendars update instead of duplicating.
- Open Graph tags on every page for link previews (WhatsApp).
- A 404 page.

## Opponent summary
For now: template-based, generated from computed facts (see prototype).
Later possibly AI-generated at build time – the facts must still be computed in code
and passed to the model; the model only phrases them.

## Reference
`docs/prototype-reference.html` is a working single-file prototype with snapshot data.
Use it ONLY for behavior and calculations (summary rules, common opponents,
per-game stats, match states). Ignore its visual design entirely.
