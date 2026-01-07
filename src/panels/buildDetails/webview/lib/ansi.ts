const ESC = "\u001b";

const CSI_PATTERN = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
const OSC_PATTERN = new RegExp(`${ESC}\\][^${ESC}\\u0007]*(?:\\u0007|${ESC}\\\\)`, "g");
const JENKINS_NOTE_PATTERN = /\b(?:ha|h):\/\/\/[A-Za-z0-9+/=._-]+/g;

export function stripAnsi(value: string): string {
  if (!value) {
    return value;
  }
  return value
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(JENKINS_NOTE_PATTERN, "");
}
