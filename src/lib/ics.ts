// iCalendar output for single games and the season feed.
// UIDs are derived from the API gameId, so subscribed calendars update instead of duplicating.
import { GAME_MIN, SRAZ_MIN, isFinal, meta, team, type Game } from "./data";
import { minusMinutes } from "./format";

const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Prague",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/** Fold lines longer than 75 octets (RFC 5545 3.1). */
function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** Local Prague wall clock "YYYYMMDDTHHMMSS", shifted by minutes. */
function local(date: string, time: string, plusMin = 0) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi + plusMin));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}T${p(t.getUTCHours())}${p(t.getUTCMinutes())}00`;
}

const stamp = meta.fetchedAt.replace(/[-:]/g, "").replace(/\.\d+/, "");

function event(g: Game, pageUrl: string) {
  const title = `${team(g.homeTeamId).name} vs ${team(g.awayTeamId).name}`;
  const score = isFinal(g) ? ` (${g.homeGoals}:${g.awayGoals})` : "";
  const desc = isFinal(g)
    ? `PHM Cup, skupina KLASIK. Výsledek ${g.homeGoals}:${g.awayGoals}.\n${pageUrl}`
    : `Sraz ${minusMinutes(g.time, SRAZ_MIN)}. PHM Cup, skupina KLASIK.\n${pageUrl}`;
  return [
    "BEGIN:VEVENT",
    `UID:${g.gameId}@pht-dragons`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Europe/Prague:${local(g.date, g.time)}`,
    `DTEND;TZID=Europe/Prague:${local(g.date, g.time, GAME_MIN)}`,
    `SUMMARY:${esc(title + score)}`,
    ...(g.venue ? [`LOCATION:${esc(g.venue)}`] : []),
    `DESCRIPTION:${esc(desc)}`,
    `URL:${pageUrl}`,
    "END:VEVENT",
  ];
}

export function calendar(list: Game[], pageUrl: (g: Game) => string, name: string) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PHT Dragons//CS",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    "X-WR-TIMEZONE:Europe/Prague",
    ...VTIMEZONE,
    ...list.flatMap((g) => event(g, pageUrl(g))),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export const icsResponse = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/calendar; charset=utf-8" } });
