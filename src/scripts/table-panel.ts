// Standings panel: open/close and remember the choice (per browser, a convenience only).
const KEY = "pht-table";

for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-table-toggle]")) {
  btn.addEventListener("click", () => {
    const open = btn.dataset.tableToggle === "open";
    document.documentElement.dataset.table = open ? "open" : "closed";
    try {
      localStorage.setItem(KEY, open ? "open" : "closed");
    } catch {
      /* storage unavailable: state just isn't remembered */
    }
    // Keep keyboard focus on the control that replaced the clicked one.
    document.querySelector<HTMLButtonElement>(`[data-table-toggle="${open ? "close" : "open"}"]`)?.focus();
    for (const b of document.querySelectorAll("[data-table-toggle='open']")) b.setAttribute("aria-expanded", String(open));
  });
}
