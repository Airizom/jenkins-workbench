import type * as React from "react";
import { useId } from "react";
import { Button } from "../../../shared/webview/components/ui/button";
import { Checkbox } from "../../../shared/webview/components/ui/checkbox";
import { Input } from "../../../shared/webview/components/ui/input";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "../../../shared/webview/icons";
import { cn } from "../../../shared/webview/lib/utils";

export interface ConsoleSearchToolbarProps {
  visible: boolean;
  query: string;
  useRegex: boolean;
  matchCountLabel: string;
  matchCount: number;
  isSearchActive: boolean;
  error?: string;
  tooManyMatchesLabel?: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  containerRef?: React.Ref<HTMLDivElement>;
  /** Id of the output the search navigates. */
  controlsId?: string;
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
  containerRef,
  controlsId,
  onChange,
  onKeyDown,
  onToggleRegex,
  onPrev,
  onNext,
  onClear
}: ConsoleSearchToolbarProps) {
  const searchInputClassName = cn(
    "flex-1 min-w-[160px] h-7 text-xs",
    error ? "border-inputErrorBorder" : "border-input"
  );
  const regexId = useId();
  const errorId = useId();

  return (
    <div ref={containerRef} className="flex flex-col gap-1" hidden={!visible}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          ref={inputRef}
          aria-label="Search console output"
          aria-controls={controlsId}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          className={searchInputClassName}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="Search…"
          spellCheck={false}
          type="text"
          value={query}
        />
        <div className="flex items-center gap-1">
          <Checkbox id={regexId} checked={useRegex} onCheckedChange={() => onToggleRegex()} />
          <label htmlFor={regexId} className="text-caption text-muted-foreground select-none">
            Regex
          </label>
        </div>
        <span aria-hidden="true" className="text-caption text-muted-foreground">
          {matchCountLabel}
        </span>
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {describeMatchCount(isSearchActive, matchCount, matchCountLabel)}
        </span>
        <Button
          disabled={!isSearchActive || matchCount === 0}
          onClick={onPrev}
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-1.5 text-caption"
          title="Previous match (Shift+Enter)"
        >
          <ChevronUpIcon className="h-3.5 w-3.5" />
          Prev
        </Button>
        <Button
          disabled={!isSearchActive || matchCount === 0}
          onClick={onNext}
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-1.5 text-caption"
          title="Next match (Enter)"
        >
          <ChevronDownIcon className="h-3.5 w-3.5" />
          Next
        </Button>
        <Button
          disabled={query.length === 0 && !error}
          onClick={onClear}
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-1.5 text-caption"
          title="Clear search"
        >
          <XIcon className="h-3.5 w-3.5" />
          Clear
        </Button>
      </div>
      {error ? (
        <div id={errorId} className="text-caption text-inputErrorFg">
          {error}
        </div>
      ) : null}
      {tooManyMatchesLabel ? (
        <div className="text-caption text-muted-foreground">{tooManyMatchesLabel}</div>
      ) : null}
    </div>
  );
}

function describeMatchCount(
  isSearchActive: boolean,
  matchCount: number,
  matchCountLabel: string
): string {
  if (!isSearchActive) {
    return "";
  }
  if (matchCount === 0) {
    return "No matches";
  }
  return `Match ${matchCountLabel.replace(" / ", " of ")}`;
}
