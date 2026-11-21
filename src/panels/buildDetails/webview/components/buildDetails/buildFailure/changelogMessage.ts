// Messages longer than roughly two card lines (or with several lines) clamp
// with a toggle; shorter ones never need it.
const LONG_MESSAGE_CHARS = 120;

export function isLongChangelogMessage(message: string): boolean {
  return message.length > LONG_MESSAGE_CHARS || message.trim().includes("\n");
}
