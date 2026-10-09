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
