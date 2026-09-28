export function countConsoleLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      count += 1;
    }
  }
  return count;
}
export function buildConsoleTruncationNote(
  consoleTruncated: boolean,
  consoleMaxChars: number | undefined
): string {
  if (!consoleTruncated) {
    return "";
  }
  if (
    typeof consoleMaxChars !== "number" ||
    !Number.isFinite(consoleMaxChars) ||
    consoleMaxChars <= 0
  ) {
    return "Earlier output omitted.";
  }
  return `Earlier output omitted. Showing the last ${consoleMaxChars.toLocaleString()} characters.`;
}
