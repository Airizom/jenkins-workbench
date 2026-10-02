import type * as React from "react";
import { EmptyState } from "../../../../../shared/webview/components/EmptyState";
import { AlertCircleIcon, SearchIcon, TestTubeIcon } from "../../../../../shared/webview/icons";
import type { EmptyStateIcon } from "./testResultsTypes";

export function TestResultsEmptyState({
  icon,
  title,
  message,
  action
}: {
  icon?: EmptyStateIcon;
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <EmptyState
      title={title}
      description={message}
      tone={icon === "info" ? "warning" : "neutral"}
      icon={icon ? <EmptyStateGlyph icon={icon} /> : undefined}
      action={action}
    />
  );
}

function EmptyStateGlyph({ icon }: { icon: EmptyStateIcon }) {
  switch (icon) {
    case "loading":
      return <TestTubeIcon className="h-4 w-4 animate-pulse" />;
    case "info":
      return <AlertCircleIcon className="h-4 w-4" />;
    case "empty":
      return <TestTubeIcon className="h-4 w-4" />;
    case "search":
      return <SearchIcon className="h-4 w-4" />;
  }
}
