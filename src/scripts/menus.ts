// Dropdowns: <div data-menu> with a [data-menu-button] (aria-expanded) and a [data-menu-panel]
// (hidden). Toggle on click, close on outside click and on Escape. See CalendarMenu.astro.
const set = (menu: HTMLElement, open: boolean) => {
  const button = menu.querySelector<HTMLElement>("[data-menu-button]");
  const panel = menu.querySelector<HTMLElement>("[data-menu-panel]");
  if (!button || !panel) return;
  button.setAttribute("aria-expanded", String(open));
  panel.hidden = !open;
};
const openMenus = () => [...document.querySelectorAll<HTMLElement>("[data-menu]")].filter((m) => m.querySelector("[aria-expanded=true]"));

for (const menu of document.querySelectorAll<HTMLElement>("[data-menu]")) {
  menu.querySelector("[data-menu-button]")?.addEventListener("click", () => {
    const open = menu.querySelector("[data-menu-button]")?.getAttribute("aria-expanded") !== "true";
    for (const m of openMenus()) if (m !== menu) set(m, false);
    set(menu, open);
  });
}
document.addEventListener("click", (e) => {
  for (const m of openMenus()) if (!m.contains(e.target as Node)) set(m, false);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  for (const m of openMenus()) {
    set(m, false);
    m.querySelector<HTMLElement>("[data-menu-button]")?.focus();
  }
});
