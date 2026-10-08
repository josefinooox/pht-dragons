// Czech formatting. Dates/times in /data are already Europe/Prague wall clock,
// so formatting works on the strings and does not depend on the build machine's TZ.
const WD = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
const WDS = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
const MG = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
const MN = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];

const parts = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
};

export const longDate = (date: string) => {
  const p = parts(date);
  return `${WD[p.wd]} ${p.d}. ${MG[p.m - 1]}`;
};
export const shortDate = (date: string) => {
  const p = parts(date);
  return `${WDS[p.wd]} ${p.d}. ${p.m}.`;
};
export const monthLabel = (date: string) => {
  const p = parts(date);
  return `${MN[p.m - 1]} ${p.y}`;
};

/** "HH:MM" minus minutes, wrapping around midnight. */
export const minusMinutes = (time: string, min: number) => {
  const [h, m] = time.split(":").map(Number);
  const t = (((h * 60 + m - min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export const num = (x: number, dp = 1) => x.toFixed(dp).replace(".", ",");
export const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n >= 2 && n <= 4 ? few : many;

export const resultName = { V: "Výhra", R: "Remíza", P: "Prohra" } as const;

export const mapUrl = (venue: string) =>
  "https://www.google.com/maps/search/?api=1&query=" +
  encodeURIComponent(venue.replace(/\s*\(.*?\)/, "") + ", Praha");

/** "Ne" */
export const weekdayShort = (date: string) => WDS[parts(date).wd];
/** "11/10" (Sparta-style day/month) */
export const dayMonth = (date: string) => {
  const p = parts(date);
  return `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}`;
};
/** "13.10." (design date format) */
export const dayMonthDot = (date: string) => {
  const p = parts(date);
  return `${p.d}.${p.m}.`;
};
/** "Neděle" (capitalized weekday) */
export const weekdayName = (date: string) => {
  const w = WD[parts(date).wd];
  return w.charAt(0).toUpperCase() + w.slice(1);
};
