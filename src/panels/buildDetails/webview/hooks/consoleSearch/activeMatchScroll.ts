export function scrollActiveConsoleMatchIntoView(
  output: HTMLPreElement | null,
  activeMatchIndex: number
): void {
  if (!output || activeMatchIndex < 0) {
    return;
  }

  const match = output.querySelector(
    `[data-match-index="${activeMatchIndex}"]`
  ) as HTMLElement | null;
  if (match) {
    match.scrollIntoView({ block: "center", inline: "nearest" });
  }
}
