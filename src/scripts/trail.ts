// Visited-path breadcrumb. Every page records itself in a per-tab trail (sessionStorage); a page
// with a breadcrumb (<ol data-breadcrumb>) then shows the way the visitor actually came, e.g.
// "Týmy / Gaston Seals / PHT Dragons vs Gaston Seals". Coming back to a page already in the trail
// cuts it there (so it never grows in loops). Arriving from outside (WhatsApp, a bookmark) starts
// a new trail, and the page keeps its built-in breadcrumb (its place in the site).
type Crumb = { href: string; label: string };
const KEY = "pht-trail";
const MAX = 8; // remembered pages
const SHOWN = 3; // previous pages shown before the current one

const read = (): Crumb[] => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
};
const write = (trail: Crumb[]) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(trail));
  } catch {
    /* storage unavailable: the built-in breadcrumb stays */
  }
};

function update(fresh: boolean) {
  const here: Crumb = {
    href: location.pathname + location.search,
    label: document.querySelector<HTMLMetaElement>('meta[name="pht-crumb"]')?.content ?? document.title,
  };
  let trail = read();
  let internal = false;
  try {
    internal = !!document.referrer && new URL(document.referrer).origin === location.origin;
  } catch {}
  // a fresh visit from outside starts over; a page shown again (back button) keeps the trail
  if (fresh && !internal) trail = [];
  const at = trail.findIndex((c) => c.href === here.href);
  if (at >= 0) trail = trail.slice(0, at);
  trail = [...trail, here].slice(-MAX);
  write(trail);
  render(trail);
}

function render(trail: Crumb[]) {
  const list = document.querySelector<HTMLOListElement>("[data-breadcrumb]");
  if (!list) return;
  const before = trail.slice(0, -1);
  if (!before.length) return; // nothing to show: keep the built-in breadcrumb
  const current = trail.at(-1)!;
  const chevronSource = list.querySelector("svg");
  const shown = before.slice(-SHOWN);
  const sep = () => {
    const li = document.createElement("li");
    li.setAttribute("aria-hidden", "true");
    li.className = "text-grey-400";
    li.textContent = "/";
    return li;
  };
  const items: HTMLLIElement[] = [];
  if (before.length > shown.length) {
    const li = document.createElement("li");
    li.className = "text-grey-400";
    li.textContent = "…";
    items.push(li, sep());
  }
  shown.forEach((c, k) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = c.href;
    a.textContent = c.label;
    a.className = "flex items-center gap-1 text-grey-500 transition-colors hover:text-grey-950";
    // the first link gets the chevron of the built-in breadcrumb
    if (k === 0 && before.length === shown.length) {
      const chevron = chevronSource?.cloneNode(true);
      if (chevron) a.prepend(chevron);
    }
    li.append(a);
    items.push(li, sep());
  });
  const last = document.createElement("li");
  last.setAttribute("aria-current", "page");
  last.className = "font-semibold text-grey-950";
  last.textContent = current.label;
  items.push(last);
  list.replaceChildren(...items);
}

// pageshow also fires when the page comes back from the back/forward cache
addEventListener("pageshow", (e) => update(!e.persisted));

export {}; // module scope (keeps the constants local to this file)
