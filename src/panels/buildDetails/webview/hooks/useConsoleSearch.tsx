import * as React from "react";
import {
  MAX_CONSOLE_MATCHES,
  buildConsoleMatches,
  buildConsoleSegments,
  createConsoleSearchKeyDownHandler,
  getNextActiveMatchIndex,
  scrollActiveConsoleMatchIntoView
} from "./consoleSearch";
import type { ConsoleMatch, SearchDirection } from "./consoleSearch";

const { useCallback, useEffect, useMemo, useRef, useState } = React;

export type { ConsoleMatch };

export type ConsoleSearchState = {
  searchQuery: string;
  useRegex: boolean;
  isSearchActive: boolean;
  showSearchToolbar: boolean;
  matchCount: number;
  matchCountLabel: string;
  matches: ConsoleMatch[];
  activeMatchIndex: number;
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
  openSearchToolbar: () => void;
};

export function useConsoleSearch(consoleText: string, shortcutsEnabled = true): ConsoleSearchState {
  const [searchQuery, setSearchQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const consoleOutputRef = useRef<HTMLPreElement>(null);

  const openSearchToolbar = useCallback(() => {
    setSearchVisible(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

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
    if (!shortcutsEnabled) {
      return;
    }
    const handleKeyDown = createConsoleSearchKeyDownHandler({
      openSearchToolbar,
      canCloseSearch: searchVisible || searchQuery.length > 0,
      onCloseSearch: () => {
        setSearchQuery("");
        setSearchVisible(false);
      }
    });
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openSearchToolbar, searchQuery, searchVisible, shortcutsEnabled]);

  const consoleSegments = useMemo(() => {
    return buildConsoleSegments(
      consoleText,
      consoleSearchState.matches,
      activeMatchIndex,
      isSearchActive
    );
  }, [consoleText, consoleSearchState.matches, isSearchActive, matchCount, activeMatchIndex]);

  useEffect(() => {
    if (!isSearchActive || activeMatchIndex < 0) {
      return;
    }
    scrollActiveConsoleMatchIntoView(consoleOutputRef.current, activeMatchIndex);
  }, [activeMatchIndex, isSearchActive, searchQuery, useRegex, consoleText]);

  const stepActiveMatch = (direction: SearchDirection) => {
    setActiveMatchIndex((previousIndex) =>
      getNextActiveMatchIndex({
        previousIndex,
        direction,
        isSearchActive,
        matchCount
      })
    );
  };

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
    stepActiveMatch(event.shiftKey ? "prev" : "next");
  };

  const handleSearchStep = (direction: "next" | "prev") => {
    stepActiveMatch(direction);
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
    matches: consoleSearchState.matches,
    activeMatchIndex,
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
    setUseRegex,
    openSearchToolbar
  };
}
