const ESCAPE_CHARACTER = "\u001b";
const CONSOLE_CSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, "g");
const CONSOLE_OSC_PATTERN = new RegExp(
  `${ESCAPE_CHARACTER}\\][^${ESCAPE_CHARACTER}\\u0007]*(?:\\u0007|${ESCAPE_CHARACTER}\\\\)`,
  "g"
);
const CONSOLE_HYPERLINK_PATTERN = /\b(?:ha|h):\/\/\/[A-Za-z0-9+/=._-]+/g;

export function stripConsoleControlSequences(value: string): string {
  return value
    .replace(CONSOLE_CSI_PATTERN, "")
    .replace(CONSOLE_OSC_PATTERN, "")
    .replace(CONSOLE_HYPERLINK_PATTERN, "");
}
