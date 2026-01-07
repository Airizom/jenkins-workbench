import type * as React from "react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

export interface ConsoleSearchToolbarProps {
  visible: boolean;
  query: string;
  useRegex: boolean;
  matchCountLabel: string;
  matchCount: number;
  isSearchActive: boolean;
  error?: string;
  tooManyMatchesLabel?: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onToggleRegex: () => void;
  onPrev: () => void;
  onNext: () => void;
  onClear: () => void;
}

export function ConsoleSearchToolbar({
  visible,
  query,
  useRegex,
  matchCountLabel,
  matchCount,
  isSearchActive,
  error,
  tooManyMatchesLabel,
  inputRef,
  onChange,
  onKeyDown,
  onToggleRegex,
  onPrev,
  onNext,
  onClear
}: ConsoleSearchToolbarProps) {
  const searchInputClassName = cn(
    "flex-1 min-w-[220px] h-8 rounded-md border bg-background px-2.5 text-xs",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "placeholder:text-muted-foreground",
    error ? "border-inputErrorBorder focus-visible:ring-inputErrorBorder" : "border-input"
  );

  return (
    <div className="flex flex-col gap-1" hidden={!visible}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          aria-label="Search console output"
          className={searchInputClassName}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="Search console output"
          spellCheck={false}
          type="text"
          value={query}
        />
        <Button
          aria-pressed={useRegex}
          className={cn(useRegex ? "bg-accent text-accent-foreground" : "")}
          onClick={onToggleRegex}
          size="sm"
          title="Toggle regex search"
          variant="outline"
        >
          Regex
        </Button>
        <span className="text-[11px] text-muted-foreground">{matchCountLabel}</span>
        <Button
          disabled={!isSearchActive || matchCount === 0}
          onClick={onPrev}
          size="sm"
          variant="outline"
        >
          Prev
        </Button>
        <Button
          disabled={!isSearchActive || matchCount === 0}
          onClick={onNext}
          size="sm"
          variant="outline"
        >
          Next
        </Button>
        <Button
          disabled={query.length === 0 && !error}
          onClick={onClear}
          size="sm"
          variant="ghost"
        >
          Clear
        </Button>
      </div>
      {error ? <div className="text-[11px] text-inputErrorFg">{error}</div> : null}
      {tooManyMatchesLabel ? (
        <div className="text-[11px] text-muted-foreground">{tooManyMatchesLabel}</div>
      ) : null}
    </div>
  );
}
