import type * as React from "react";
import { Button } from "../../../shared/webview/components/ui/button";
import { Checkbox } from "../../../shared/webview/components/ui/checkbox";
import { Input } from "../../../shared/webview/components/ui/input";
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
    "flex-1 min-w-[160px] h-7 text-xs",
    error ? "border-inputErrorBorder" : "border-input"
  );

  return (
    <div className="flex flex-col gap-1" hidden={!visible}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          ref={inputRef}
          aria-label="Search console output"
          className={searchInputClassName}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="Search..."
          spellCheck={false}
          type="text"
          value={query}
        />
        <div className="flex items-center gap-1">
          <Checkbox
            id="console-search-regex"
            checked={useRegex}
            onCheckedChange={() => onToggleRegex()}
          />
          <label
            htmlFor="console-search-regex"
            className="text-[11px] text-muted-foreground select-none"
          >
            Regex
          </label>
        </div>
        <span className="text-[11px] text-muted-foreground">{matchCountLabel}</span>
        <Button
          disabled={!isSearchActive || matchCount === 0}
          onClick={onPrev}
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[11px]"
        >
          Prev
        </Button>
        <Button
          disabled={!isSearchActive || matchCount === 0}
          onClick={onNext}
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[11px]"
        >
          Next
        </Button>
        <Button
          disabled={query.length === 0 && !error}
          onClick={onClear}
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[11px]"
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
