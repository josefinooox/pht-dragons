// Accessible tabs for <div data-tabs>: the tablist is revealed and inactive panels hidden only
// when JS runs (without JS every panel is shown with its own heading). Arrow keys / Home / End
// move between tabs; the selected tab is mirrored in the URL hash so it can be shared.
for (const root of document.querySelectorAll<HTMLElement>("[data-tabs]")) {
  const list = root.querySelector<HTMLElement>("[role=tablist]");
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[role=tab]")];
  const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls")!)!);
  if (!list || !tabs.length) continue;

  list.hidden = false;
  for (const title of root.querySelectorAll<HTMLElement>("[data-tab-title]")) title.hidden = true;

  const select = (i: number, focus = false, updateHash = true) => {
    tabs.forEach((t, k) => {
      const on = k === i;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      panels[k].hidden = !on;
    });
    if (focus) tabs[i].focus();
    // data-tabs="local": in-card switchers (e.g. the radar player board) leave the URL alone.
    if (updateHash && root.dataset.tabs !== "local") history.replaceState(null, "", `#${panels[i].id}`);
  };

  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(i));
    t.addEventListener("keydown", (e) => {
      const last = tabs.length - 1;
      const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      select(next, true);
    });
  });

  const fromHash = panels.findIndex((p) => `#${p.id}` === location.hash);
  select(fromHash >= 0 ? fromHash : 0, false, false);
}
