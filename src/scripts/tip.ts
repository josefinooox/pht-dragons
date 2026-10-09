// Chart tooltips for any element with data-tip="text" (lines split by "\n"): shown on mouse hover,
// keyboard focus and tap, above the element, kept inside the viewport. One shared bubble.
const bubble = document.createElement("div");
bubble.className = "chart-tip";
bubble.setAttribute("role", "tooltip");
bubble.hidden = true;
document.body.append(bubble);

let current: Element | null = null;
const show = (el: Element) => {
  current = el;
  bubble.textContent = (el as HTMLElement).dataset.tip ?? el.getAttribute("data-tip") ?? "";
  bubble.hidden = false;
  const r = el.getBoundingClientRect();
  const w = bubble.offsetWidth;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  bubble.style.left = `${x + scrollX}px`;
  bubble.style.top = `${r.top + scrollY - bubble.offsetHeight - 8}px`;
};
const hide = () => {
  current = null;
  bubble.hidden = true;
};
const target = (e: Event) => (e.target instanceof Element ? e.target.closest("[data-tip]") : null);

document.addEventListener("pointerover", (e) => {
  if (e.pointerType !== "mouse") return;
  const el = target(e);
  if (el) show(el);
  else if (current) hide();
});
document.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") return;
  const el = target(e);
  if (el && el !== current) show(el);
  else if (!el) hide();
});
document.addEventListener("focusin", (e) => {
  const el = target(e);
  if (el) show(el);
});
document.addEventListener("focusout", hide);
addEventListener("scroll", () => current && show(current), { passive: true });
document.addEventListener("keydown", (e) => e.key === "Escape" && hide());
