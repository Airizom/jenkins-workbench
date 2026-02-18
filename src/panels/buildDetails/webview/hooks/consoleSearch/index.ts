export { scrollActiveConsoleMatchIntoView } from "./activeMatchScroll";
export { buildConsoleMatches } from "./buildConsoleMatches";
export { buildConsoleSegments } from "./buildConsoleSegments";
export { MAX_CONSOLE_MATCHES } from "./constants";
export type { ConsoleMatch, ConsoleMatchState } from "./consoleSearchTypes";
export { createConsoleSearchKeyDownHandler } from "./keyboardShortcuts";
export { getNextActiveMatchIndex, type SearchDirection } from "./matchNavigation";
