import type * as React from "react";
import { RefreshIcon } from "../icons";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "./ui/card";

type PanelErrorListProps = {
  errors: string[];
  variant?: "alert" | "card";
  title?: string;
  id?: string;
  className?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Keeps the Retry button in place but disabled, e.g. while a retry is already running. */
  retryDisabled?: boolean;
};

function RetryButton({
  onRetry,
  retryLabel,
  disabled
}: {
  onRetry: () => void;
  retryLabel: string;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="mt-2 self-start"
      onClick={onRetry}
      disabled={disabled}
    >
      <RefreshIcon className="h-3.5 w-3.5" />
      {retryLabel}
    </Button>
  );
}

export function PanelErrorList({
  errors,
  variant = "alert",
  title = "Errors",
  id,
  className,
  onRetry,
  retryLabel = "Retry",
  retryDisabled
}: PanelErrorListProps): React.JSX.Element | null {
  if (errors.length === 0) {
    return null;
  }

  if (variant === "card") {
    return (
      <Card id={id} role="alert" className={className ?? "border-destructive-border"}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{errors.join(" ")}</CardDescription>
          {onRetry ? (
            <RetryButton onRetry={onRetry} retryLabel={retryLabel} disabled={retryDisabled} />
          ) : null}
        </CardHeader>
      </Card>
    );
  }

  const seenErrors = new Map<string, number>();
  const keyedErrors = errors.map((error) => {
    const count = (seenErrors.get(error) ?? 0) + 1;
    seenErrors.set(error, count);
    return {
      error,
      key: `${count}:${error}`
    };
  });

  return (
    <Alert id={id} variant="destructive" className={className ?? "mb-3 flex flex-col gap-1"}>
      {title ? <AlertTitle className="text-xs">{title}</AlertTitle> : null}
      {keyedErrors.map(({ error, key }) => (
        <AlertDescription className="text-xs" key={key}>
          {error}
        </AlertDescription>
      ))}
      {onRetry ? (
        <RetryButton onRetry={onRetry} retryLabel={retryLabel} disabled={retryDisabled} />
      ) : null}
    </Alert>
  );
}
