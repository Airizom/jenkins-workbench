const HORIZONTAL_MARGIN_PX = 16;

type ScrollMetrics = {
  scrollTop: number;
  scrollLeft: number;
  clientTop: number;
  clientLeft: number;
  clientWidth: number;
  clientHeight: number;
};

type Box = { top: number; left: number; width: number; height: number };

/**
 * Scroll offsets that center the match vertically in the output and bring it
 * horizontally into view only when it is clipped.
 */
export function computeActiveMatchScrollPosition(
  output: ScrollMetrics,
  outputRect: Pick<Box, "top" | "left">,
  matchRect: Box
): { top: number; left: number } {
  const offsetTop = matchRect.top - outputRect.top - output.clientTop;
  const offsetLeft = matchRect.left - outputRect.left - output.clientLeft;
  const top = output.scrollTop + offsetTop - (output.clientHeight - matchRect.height) / 2;

  let left = output.scrollLeft;
  if (offsetLeft < 0) {
    left += offsetLeft - HORIZONTAL_MARGIN_PX;
  } else if (offsetLeft + matchRect.width > output.clientWidth) {
    left += offsetLeft + matchRect.width - output.clientWidth + HORIZONTAL_MARGIN_PX;
  }
  return { top: Math.max(0, top), left: Math.max(0, left) };
}

// Scrolls only the output itself; scrollIntoView would also scroll the page.
export function scrollActiveConsoleMatchIntoView(
  output: HTMLPreElement | null,
  activeMatchIndex: number
): void {
  if (!output || activeMatchIndex < 0) {
    return;
  }

  const match = output.querySelector<HTMLElement>(`[data-match-index="${activeMatchIndex}"]`);
  if (!match) {
    return;
  }
  output.scrollTo(
    computeActiveMatchScrollPosition(
      output,
      output.getBoundingClientRect(),
      match.getBoundingClientRect()
    )
  );
}
