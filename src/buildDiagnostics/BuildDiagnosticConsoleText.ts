export function stripConsoleControlSequences(value: string): string {
  const escapeCharacter = "\u001b";
  return value
    .replace(new RegExp(`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`, "g"), "")
    .replace(
      new RegExp(
        `${escapeCharacter}\\][^${escapeCharacter}\\u0007]*(?:\\u0007|${escapeCharacter}\\\\)`,
        "g"
      ),
      ""
    )
    .replace(/\b(?:ha|h):\/\/\/[A-Za-z0-9+/=._-]+/g, "");
}
