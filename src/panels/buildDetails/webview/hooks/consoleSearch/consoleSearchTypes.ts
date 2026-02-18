export type ConsoleMatch = {
  start: number;
  end: number;
};

export type ConsoleMatchState = {
  matches: ConsoleMatch[];
  tooManyMatches: boolean;
  error?: string;
};
