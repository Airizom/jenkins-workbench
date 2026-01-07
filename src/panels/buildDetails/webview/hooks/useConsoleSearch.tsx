import * as React from "react";

const { useEffect, useMemo, useRef, useState } = React;

const MAX_CONSOLE_MATCHES = 2000;

type ConsoleMatch = {
  start: number;
  end: number;
};

type ConsoleMatchState = {
  matches: ConsoleMatch[];
  tooManyMatches: boolean;
  error?: string;
};

function buildConsoleMatches(
  text: string,
  query: string,
  useRegex: boolean
): ConsoleMatchState {
  if (!query) {
    return { matches: [], tooManyMatches: false };
  }

  if (useRegex) {
    let regex: RegExp;
    try {
      regex = new RegExp(query, "g");
    } catch (error) {
      return {
        matches: [],
        tooManyMatches: false,
        error: error instanceof Error ? error.message : "Invalid regular expression."
      };
    }

    const matches: ConsoleMatch[] = [];
    let tooManyMatches = false;
    let match = regex.exec(text);
    while (match) {
      const matchText = match[0] ?? "";
      if (matchText.length === 0) {
        const safeIndex = match.index + 1;
        regex.lastIndex = safeIndex;
        match = regex.exec(text);
        continue;
      }
      matches.push({ start: match.index, end: match.index + matchText.length });
      if (matches.length >= MAX_CONSOLE_MATCHES) {
        tooManyMatches = true;
        break;
      }
      match = regex.exec(text);
    }
    return { matches, tooManyMatches };
  }

  const matches: ConsoleMatch[] = [];
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  let startIndex = 0;
  let tooManyMatches = false;
  while (startIndex < normalizedText.length) {
    const nextIndex = normalizedText.indexOf(normalizedQuery, startIndex);
    if (nextIndex === -1) {
      break;
    }
    matches.push({ start: nextIndex, end: nextIndex + normalizedQuery.length });
    if (matches.length >= MAX_CONSOLE_MATCHES) {
      tooManyMatches = true;
      break;
    }
    startIndex = nextIndex + Math.max(1, normalizedQuery.length);
  }
  return { matches, tooManyMatches };
}

export type ConsoleSearchState = {
  searchQuery: string;
  useRegex: boolean;
  isSearchActive: boolean;
  showSearchToolbar: boolean;
  matchCount: number;
  matchCountLabel: string;
  searchError?: string;
  tooManyMatchesLabel?: string;
  consoleSegments: React.ReactNode[];
  searchInputRef: React.RefObject<HTMLInputElement>;
  consoleOutputRef: React.RefObject<HTMLPreElement>;
  handleSearchChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  handleSearchStep: (direction: "next" | "prev") => void;
  handleClearSearch: () => void;
  setUseRegex: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useConsoleSearch(consoleText: string): ConsoleSearchState {
  const [searchQuery, setSearchQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [searchVisible, setSearchVisible] = useState(true);
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const consoleOutputRef = useRef<HTMLPreElement>(null);

  const consoleSearchState = useMemo(
    () => buildConsoleMatches(consoleText, searchQuery, useRegex),
    [consoleText, searchQuery, useRegex]
  );
  const isSearchActive = searchQuery.length > 0 && !consoleSearchState.error;
  const matchCount = consoleSearchState.matches.length;
  const showSearchToolbar =
    searchVisible || searchQuery.length > 0 || Boolean(consoleSearchState.error);

  useEffect(() => {
    setActiveMatchIndex((prev) => {
      if (!isSearchActive || matchCount === 0) {
        return -1;
      }
      if (prev < 0 || prev >= matchCount) {
        return 0;
      }
      return prev;
    });
  }, [isSearchActive, matchCount]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "f") {
        event.preventDefault();
        setSearchVisible(true);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return;
      }
      if (event.key === "Escape" && (searchVisible || searchQuery.length > 0)) {
        event.preventDefault();
        setSearchQuery("");
        setSearchVisible(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchQuery, searchVisible]);

  const consoleSegments = useMemo(() => {
    if (!isSearchActive || matchCount === 0) {
      return [consoleText];
    }
    const segments: React.ReactNode[] = [];
    let lastIndex = 0;
    for (let index = 0; index < consoleSearchState.matches.length; index += 1) {
      const match = consoleSearchState.matches[index];
      if (match.start > lastIndex) {
        segments.push(consoleText.slice(lastIndex, match.start));
      }
      const matchText = consoleText.slice(match.start, match.end);
      segments.push(
        <mark
          className={`console-match${index === activeMatchIndex ? " console-match--active" : ""}`}
          data-match-index={index}
          key={`console-match-${match.start}-${match.end}`}
        >
          {matchText}
        </mark>
      );
      lastIndex = match.end;
    }
    if (lastIndex < consoleText.length) {
      segments.push(consoleText.slice(lastIndex));
    }
    return segments;
  }, [consoleText, consoleSearchState.matches, isSearchActive, matchCount, activeMatchIndex]);

  useEffect(() => {
    if (!isSearchActive || activeMatchIndex < 0) {
      return;
    }
    const output = consoleOutputRef.current;
    if (!output) {
      return;
    }
    const match = output.querySelector(
      `[data-match-index="${activeMatchIndex}"]`
    ) as HTMLElement | null;
    if (match) {
      match.scrollIntoView({ block: "center", inline: "nearest" });
    }
  }, [activeMatchIndex, isSearchActive, searchQuery, useRegex, consoleText]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setSearchQuery(nextValue);
    if (nextValue.length > 0 && !searchVisible) {
      setSearchVisible(true);
    }
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const direction = event.shiftKey ? "prev" : "next";
    setActiveMatchIndex((prev) => {
      if (!isSearchActive || matchCount === 0) {
        return -1;
      }
      if (prev < 0) {
        return direction === "next" ? 0 : matchCount - 1;
      }
      const delta = direction === "next" ? 1 : -1;
      return (prev + delta + matchCount) % matchCount;
    });
  };

  const handleSearchStep = (direction: "next" | "prev") => {
    setActiveMatchIndex((prev) => {
      if (!isSearchActive || matchCount === 0) {
        return -1;
      }
      if (prev < 0) {
        return direction === "next" ? 0 : matchCount - 1;
      }
      const delta = direction === "next" ? 1 : -1;
      return (prev + delta + matchCount) % matchCount;
    });
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setActiveMatchIndex(-1);
    if (!searchVisible) {
      return;
    }
    requestAnimationFrame(() => {
      searchInputRef.current?.blur();
    });
  };

  const activeMatchDisplay = activeMatchIndex >= 0 ? activeMatchIndex + 1 : 0;
  const matchCountLabel = `${activeMatchDisplay.toLocaleString()} / ${matchCount.toLocaleString()}${
    consoleSearchState.tooManyMatches ? "+" : ""
  }`;

  return {
    searchQuery,
    useRegex,
    isSearchActive,
    showSearchToolbar,
    matchCount,
    matchCountLabel,
    searchError: consoleSearchState.error,
    tooManyMatchesLabel: consoleSearchState.tooManyMatches
      ? `Showing first ${MAX_CONSOLE_MATCHES.toLocaleString()} matches.`
      : undefined,
    consoleSegments,
    searchInputRef,
    consoleOutputRef,
    handleSearchChange,
    handleSearchKeyDown,
    handleSearchStep,
    handleClearSearch,
    setUseRegex
  };
}
