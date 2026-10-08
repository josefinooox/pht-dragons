// "Řekni víc" for <section data-expand>: the extra content sits above the button, so the button
// always stays under the text. First open shows a short skeleton (the text is already in the
// page, written at build time). The button then reads "Sbalit"; collapsing scrolls back to the
// section if its top went out of view. Without JS the content is simply shown.
const DELAY_MS = 1200;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

for (const root of document.querySelectorAll<HTMLElement>("[data-expand]")) {
  const content = root.querySelector<HTMLElement>("[data-expand-content]");
  const skeleton = root.querySelector<HTMLElement>("[data-skeleton]");
  const button = root.querySelector<HTMLButtonElement>("[data-expand-toggle]");
  const label = button?.querySelector<HTMLElement>("[data-expand-label]");
  if (!content || !button || !label) continue;

  content.hidden = true;
  button.hidden = false;
  let shown = false;

  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    label.textContent = open ? "Sbalit" : "Řekni víc";

    if (!open) {
      content.hidden = true;
      if (skeleton) skeleton.hidden = true;
      if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      return;
    }
    if (shown || !skeleton) {
      content.hidden = false;
      return;
    }
    shown = true;
    skeleton.hidden = false;
    root.setAttribute("aria-busy", "true");
    setTimeout(() => {
      skeleton.hidden = true;
      content.hidden = button.getAttribute("aria-expanded") !== "true";
      root.removeAttribute("aria-busy");
    }, DELAY_MS);
  });
}
