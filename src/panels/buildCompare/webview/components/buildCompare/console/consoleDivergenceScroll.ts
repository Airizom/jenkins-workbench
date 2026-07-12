/**
 * Scrolls every console snippet viewport so its divergence line is centered.
 * Uses instant scrolling when the user prefers reduced motion.
 */
export function scrollConsoleSnippetsToDivergence(): void {
  const behavior: ScrollBehavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  const containers = Array.from(document.querySelectorAll<HTMLElement>("[data-console-snippet]"));
  for (const container of containers) {
    const line = container.querySelector<HTMLElement>("[data-divergence-line]");
    if (!line) {
      continue;
    }
    const offsetWithinContainer =
      line.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    const top = Math.max(0, offsetWithinContainer - container.clientHeight / 2);
    container.scrollTo({ top, behavior });
  }
}
