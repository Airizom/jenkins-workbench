import { JenkinsConsoleNoteFilter } from "../jenkins/JenkinsConsoleNotes";

const ESCAPE_CHARACTER = "\u001b";
const CONSOLE_CSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, "g");
const CONSOLE_OSC_PATTERN = new RegExp(
  `${ESCAPE_CHARACTER}\\][^${ESCAPE_CHARACTER}\\u0007]*(?:\\u0007|${ESCAPE_CHARACTER}\\\\)`,
  "g"
);
const CONSOLE_HYPERLINK_PATTERN = /\b(?:ha|h):\/\/\/[A-Za-z0-9+/=._-]+/g;
const CONSOLE_NOTE_START = `${ESCAPE_CHARACTER}[8mha:`;

function removeConsoleNotes(value: string): string {
  if (!value.includes(CONSOLE_NOTE_START)) {
    return value;
  }
  const notes = new JenkinsConsoleNoteFilter();
  return notes.append(value) + notes.finish();
}

export function stripConsoleControlSequences(value: string): string {
  // Remove whole notes before their escape codes: once those are gone, the note payload abuts the
  // annotated text (`Running on Jenkins`), and the payload pattern would consume that text too.
  return removeConsoleNotes(value)
    .replace(CONSOLE_CSI_PATTERN, "")
    .replace(CONSOLE_OSC_PATTERN, "")
    .replace(CONSOLE_HYPERLINK_PATTERN, "");
}

/**
 * Console text as Build Details renders it. HTML parsing turns CRLF and lone CR into LF, so
 * console reference offsets must be computed against the same line breaks.
 */
export function toDisplayedConsoleText(value: string): string {
  return stripConsoleControlSequences(value).replace(/\r\n?/g, "\n");
}
