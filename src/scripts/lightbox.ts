// Full-screen photo viewer for <div data-gallery>: click, arrow keys, swipe, Esc to close.
for (const gallery of document.querySelectorAll<HTMLElement>("[data-gallery]")) {
  const dialog = gallery.querySelector<HTMLDialogElement>("[data-lightbox]")!;
  const image = dialog.querySelector<HTMLImageElement>("[data-image]")!;
  const counter = dialog.querySelector<HTMLElement>("[data-counter]")!;
  const links = [...gallery.querySelectorAll<HTMLAnchorElement>("[data-photo]")];
  let index = 0;

  const show = (i: number) => {
    index = (i + links.length) % links.length;
    image.src = links[index].href;
    counter.textContent = `${index + 1} / ${links.length}`;
    // Preload neighbours so swiping feels instant.
    for (const d of [1, -1]) new Image().src = links[(index + d + links.length) % links.length].href;
  };

  links.forEach((a, i) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      show(i);
      dialog.showModal();
    }),
  );
  dialog.querySelector("[data-prev]")!.addEventListener("click", () => show(index - 1));
  dialog.querySelector("[data-next]")!.addEventListener("click", () => show(index + 1));
  dialog.querySelector("[data-close]")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => image.removeAttribute("src"));
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") show(index - 1);
    if (e.key === "ArrowRight") show(index + 1);
  });
  // Click on the dark backdrop (not the photo or buttons) closes.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog || (e.target as HTMLElement).matches("[data-stage]")) dialog.close();
  });

  let startX = 0;
  let startY = 0;
  dialog.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  dialog.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
    else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) dialog.close(); // swipe down to close
  });
}
