import { Button } from "../../../../../shared/webview/components/ui/button";
import { Switch } from "../../../../../shared/webview/components/ui/switch";
import { DownloadIcon, SearchIcon, TerminalIcon } from "./ConsoleOutputIcons";

type ConsoleOutputHeaderProps = {
  hasConsoleOutput: boolean;
  lineCount: number;
  followLog: boolean;
  onSearch: () => void;
  onExport: () => void;
  onFollowLogChange: (checked: boolean) => void;
};

export function ConsoleOutputHeader({
  hasConsoleOutput,
  lineCount,
  followLog,
  onSearch,
  onExport,
  onFollowLogChange
}: ConsoleOutputHeaderProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <TerminalIcon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Console
          {hasConsoleOutput ? ` · ${lineCount.toLocaleString()} lines` : ""}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          aria-label="Search console output"
          onClick={onSearch}
          size="sm"
          variant="outline"
          className="gap-1.5 h-7 px-2 text-xs"
        >
          <SearchIcon className="h-3.5 w-3.5" />
          Search
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onExport}
          className="gap-1.5 h-7 px-2 text-xs"
          aria-label="Export console output"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          Export
        </Button>
        <div className="flex items-center gap-1.5 ml-0.5 pl-1.5 border-l border-border">
          <Switch id="follow-log" checked={followLog} onCheckedChange={onFollowLogChange} />
          <label
            htmlFor="follow-log"
            className="text-xs text-muted-foreground select-none whitespace-nowrap"
          >
            Follow
          </label>
        </div>
      </div>
    </div>
  );
}
