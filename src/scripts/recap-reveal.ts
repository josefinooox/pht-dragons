// "Řekni víc": the first time the details open, show a short skeleton before the text.
// The text is already in the page (written at build time); this is only a visual beat.
const DELAY_MS = 1200;

for (const details of document.querySelectorAll<HTMLDetailsElement>("details[data-reveal]")) {
  const skeleton = details.querySelector<HTMLElement>("[data-skeleton]");
  const content = details.querySelector<HTMLElement>("[data-content]");
  if (!skeleton || !content) continue;
  const summary = details.querySelector("summary");
  let shown = false;
  // Click (also fired by Enter/Space on <summary>) runs before the details opens,
  // so the text never flashes before the skeleton.
  summary?.addEventListener("click", () => {
    if (details.open || shown) return;
    shown = true;
    skeleton.hidden = false;
    content.hidden = true;
    details.setAttribute("aria-busy", "true");
    setTimeout(() => {
      skeleton.hidden = true;
      content.hidden = false;
      details.removeAttribute("aria-busy");
    }, DELAY_MS);
  });
}
