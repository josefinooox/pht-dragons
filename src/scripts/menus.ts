// Close <details data-menu> dropdowns on outside click and on Escape.
const menus = () => document.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]");

document.addEventListener("click", (e) => {
  for (const m of menus()) if (!m.contains(e.target as Node)) m.open = false;
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  for (const m of menus()) {
    m.open = false;
    m.querySelector("summary")?.focus();
  }
});

// Replay the opening animation (CalendarMenu.astro) on every open, drop it on close: a closed <details> may only
// hide its content (content-visibility), so CSS animations would otherwise run just once.
for (const m of document.querySelectorAll<HTMLDetailsElement>("details[data-menu]")) {
  m.addEventListener("toggle", () => {
    for (const a of m.getAnimations({ subtree: true })) {
      a.cancel();
      if (m.open) a.play();
    }
  });
}
