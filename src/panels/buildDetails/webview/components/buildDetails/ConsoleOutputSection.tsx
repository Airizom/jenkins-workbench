import * as React from "react";
import { stripAnsi } from "../../lib/ansi";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { ConsoleLogViewer } from "./ConsoleLogViewer";
import { ConsoleOutputHeader } from "./consoleOutput";

const { useMemo } = React;
export function ConsoleOutputSection({
  consoleText,
  consoleHtmlModel,
  consoleTruncated,
  consoleMaxChars,
  consoleError,
  followLog,
  isActive,
  onToggleFollowLog,
  onExportLogs,
  onOpenExternal
}: {
  consoleText: string;
  consoleHtmlModel?: ConsoleHtmlModel;
  consoleTruncated: boolean;
  consoleMaxChars: number;
  consoleError?: string;
  followLog: boolean;
  isActive: boolean;
  onToggleFollowLog: (value: boolean) => void;
  onExportLogs: () => void;
  onOpenExternal: (url: string) => void;
}) {
  const displayConsoleText = useMemo(
    () => (consoleHtmlModel ? consoleText : stripAnsi(consoleText)),
    [consoleHtmlModel, consoleText]
  );

  return (
    <ConsoleLogViewer
      className="flex flex-col gap-2"
      text={displayConsoleText}
      htmlModel={consoleHtmlModel}
      truncated={consoleTruncated}
      maxChars={consoleMaxChars}
      error={consoleError}
      followLog={followLog}
      isActive={isActive}
      onOpenExternal={onOpenExternal}
      renderHeader={({ hasOutput, lineCount, openSearchToolbar }) => (
        <ConsoleOutputHeader
          hasConsoleOutput={hasOutput}
          lineCount={lineCount}
          followLog={followLog}
          onSearch={openSearchToolbar}
          onExport={onExportLogs}
          onFollowLogChange={onToggleFollowLog}
        />
      )}
    />
  );
}
