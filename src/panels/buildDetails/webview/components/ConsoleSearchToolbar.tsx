import type * as React from "react";
import { Button } from "../../../shared/webview/components/ui/button";
import { Checkbox } from "../../../shared/webview/components/ui/checkbox";
import { Input } from "../../../shared/webview/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "../../../shared/webview/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../shared/webview/components/ui/tooltip";
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
    "flex-1 min-w-[220px]",
    error ? "border-inputErrorBorder" : "border-input"
  );

  return (
    <div className="flex flex-col gap-1.5" hidden={!visible}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
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
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline">
                  Options
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Search options</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-56 p-3" align="start">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="console-search-regex"
                  checked={useRegex}
                  onCheckedChange={() => onToggleRegex()}
                />
                <label
                  htmlFor="console-search-regex"
                  className={cn("text-xs select-none", "text-muted-foreground")}
                >
                  Regex
                </label>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <span className="text-xs text-muted-foreground">{matchCountLabel}</span>
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
        <Button disabled={query.length === 0 && !error} onClick={onClear} size="sm" variant="ghost">
          Clear
        </Button>
      </div>
      {error ? <div className="text-xs text-inputErrorFg">{error}</div> : null}
      {tooManyMatchesLabel ? (
        <div className="text-xs text-muted-foreground">{tooManyMatchesLabel}</div>
      ) : null}
    </div>
  );
}
