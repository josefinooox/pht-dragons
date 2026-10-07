// Client-side labels that would go stale between builds:
// Dnes / Zítra / Včera / Za N dny, Právě se hraje, Čeká se na výsledek.
// Test with ?now=2026-10-11T20:30 in the URL.
const GAME_MIN = 90;
const RUNNING_MAX_MIN = 180; // API says "running" but it is long over: treat as waiting for result

const q = new URLSearchParams(location.search).get("now");
const now = q ? new Date(q) : new Date();
const pragueDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(d);
const dayNumber = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 864e5;
};
const today = dayNumber(pragueDay(now));
const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n >= 2 && n <= 4 ? few : many;

function relDay(date: string) {
  const n = dayNumber(date) - today;
  if (n === 0) return "Dnes";
  if (n === 1) return "Zítra";
  if (n === -1) return "Včera";
  if (n > 1 && n < 7) return `Za ${n} ${plural(n, "den", "dny", "dní")}`;
  return "";
}

function stateLabel(start: string, status: string): [string, string] | null {
  if (status === "finished") return null;
  const m = (now.getTime() - Date.parse(start)) / 6e4;
  if ((status === "running" && m < RUNNING_MAX_MIN) || (m >= 0 && m < GAME_MIN)) return ["live", "Právě se hraje"];
  if (m >= GAME_MIN) return ["pending", "Čeká se na výsledek"];
  return null;
}

// <span data-when data-date data-start data-status hidden>; data-kind is set for styling.
for (const el of document.querySelectorAll<HTMLElement>("[data-when]")) {
  const { date = "", start = "", status = "" } = el.dataset;
  const [kind, label] = stateLabel(start, status) ?? ["day", relDay(date)];
  el.textContent = label;
  el.dataset.kind = kind;
  el.hidden = !label;
}

// Elements that should disappear after a moment (e.g. fresh result banner).
for (const el of document.querySelectorAll<HTMLElement>("[data-expires]")) {
  if (now.getTime() > Date.parse(el.dataset.expires!)) el.hidden = true;
}

// Share: native share sheet, else copy to clipboard.
for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-share]")) {
  btn.hidden = false;
  btn.addEventListener("click", async () => {
    const url = new URL(btn.dataset.url!, location.href).href;
    const text = btn.dataset.text ?? "";
    const status = btn.nextElementSibling as HTMLElement | null;
    if (navigator.share) {
      try {
        await navigator.share({ title: "PHT Dragons", text, url });
      } catch {
        /* cancelled */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      if (status) status.textContent = "Odkaz zkopírován.";
    } catch {
      if (status) status.textContent = "Kopírování se nepovedlo.";
    }
  });
}
