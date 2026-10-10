// Standings panel: open/close and remember the choice (per browser, a convenience only).
const KEY = "pht-table";

for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-table-toggle]")) {
  btn.addEventListener("click", (e) => {
    const open = btn.dataset.tableToggle === "open";
    document.documentElement.dataset.table = open ? "open" : "closed";
    try {
      localStorage.setItem(KEY, open ? "open" : "closed");
    } catch {
      /* storage unavailable: state just isn't remembered */
    }
    // Keyboard only (a click from Enter/Space has detail 0): keep focus on the control that
    // replaced the clicked one, without scrolling to it (the rail starts right under the header,
    // so a plain focus() would jump the page up). After a mouse or touch click, moving focus
    // made browsers show the focus ring and the filled state on the close button.
    if (e.detail === 0) {
      document.querySelector<HTMLButtonElement>(`[data-table-toggle="${open ? "close" : "open"}"]`)?.focus({ preventScroll: true });
    } else {
      btn.blur();
    }
    for (const b of document.querySelectorAll("[data-table-toggle='open']")) b.setAttribute("aria-expanded", String(open));
  });
}

// The panel lists every team: keep our row in view (roughly centred) inside the scrolling list.
const list = document.querySelector<HTMLElement>("[data-table-list]");
const centreOurs = () => {
  const ours = list?.querySelector<HTMLElement>("[aria-current]");
  if (!list || !ours) return;
  list.scrollTop = ours.offsetTop - list.offsetTop - (list.clientHeight - ours.offsetHeight) / 2;
};
centreOurs();
for (const btn of document.querySelectorAll("[data-table-toggle='open']")) btn.addEventListener("click", () => requestAnimationFrame(centreOurs));

export {}; // module scope (keeps the constants local to this file)
