import * as React from "react";
import type { ConsoleMatch, SearchDirection } from "./consoleSearch";
import {
  buildConsoleMatches,
  createConsoleSearchKeyDownHandler,
  getNextActiveMatchIndex,
  MAX_CONSOLE_MATCHES,
  scrollActiveConsoleMatchIntoView
} from "./consoleSearch";

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
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchToolbarRef: React.RefObject<HTMLDivElement | null>;
  /** The header button that opens search; focus returns here when search closes. */
  searchToggleRef: React.RefObject<HTMLButtonElement | null>;
  consoleOutputRef: React.RefObject<HTMLPreElement | null>;
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
  const searchToolbarRef = useRef<HTMLDivElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const consoleOutputRef = useRef<HTMLPreElement>(null);

  const openSearchToolbar = useCallback(() => {
    setSearchVisible(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  // Hiding the toolbar drops focus to the body; hand it back to the button
  // that opened search, or to the output when that button is gone.
  const focusSearchToggle = useCallback(() => {
    requestAnimationFrame(() => {
      const toggle = searchToggleRef.current;
      if (toggle?.isConnected) {
        toggle.focus();
        return;
      }
      consoleOutputRef.current?.focus({ preventScroll: true });
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
        const toolbar = searchToolbarRef.current;
        const hadFocus = Boolean(toolbar?.contains(document.activeElement));
        setSearchQuery("");
        setSearchVisible(false);
        if (hadFocus) {
          focusSearchToggle();
        }
      }
    });
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusSearchToggle, openSearchToolbar, searchQuery, searchVisible, shortcutsEnabled]);

  // Streamed text deliberately does not re-scroll: only a new active match,
  // query, or mode moves the viewport.
  useEffect(() => {
    if (!isSearchActive || activeMatchIndex < 0) {
      return;
    }
    scrollActiveConsoleMatchIntoView(consoleOutputRef.current, activeMatchIndex);
  }, [activeMatchIndex, isSearchActive, searchQuery, useRegex]);

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
    // An opened toolbar stays visible after Clear, so keep typing in it;
    // otherwise the toolbar hides with the query.
    if (!searchVisible) {
      focusSearchToggle();
      return;
    }
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
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
    searchInputRef,
    searchToolbarRef,
    searchToggleRef,
    consoleOutputRef,
    handleSearchChange,
    handleSearchKeyDown,
    handleSearchStep,
    handleClearSearch,
    setUseRegex,
    openSearchToolbar
  };
}
