import type * as React from "react";
import { PanelErrorList } from "../../../../shared/webview/components/PanelErrorList";
import { Alert, AlertTitle } from "../../../../shared/webview/components/ui/alert";
import { Button } from "../../../../shared/webview/components/ui/button";
import { RefreshIcon } from "../../../../shared/webview/icons";
import { resolveBuildDetailsErrorMode } from "./buildDetailsErrorMode";

const BLOCKING_ERRORS_TITLE = "Unable to load build details";
const PARTIAL_ERRORS_TITLE = "Some information couldn't be loaded";

export function BuildDetailsErrors({
  errors,
  buildLoaded,
  onRetry
}: {
  errors: string[];
  buildLoaded: boolean;
  onRetry: () => void;
}): React.JSX.Element | null {
  const mode = resolveBuildDetailsErrorMode(errors, buildLoaded);
  if (mode === "none") {
    return null;
  }
  if (mode === "blocking") {
    return (
      <PanelErrorList errors={errors} id="errors" title={BLOCKING_ERRORS_TITLE} onRetry={onRetry} />
    );
  }
  return (
    <Alert id="errors" variant="warning" role="status" className="mb-3 flex flex-col gap-1">
      <AlertTitle className="text-xs">{PARTIAL_ERRORS_TITLE}</AlertTitle>
      <ul className="m-0 list-disc space-y-0.5 pl-4 text-xs">
        {errors.map((error, index) => (
          // Errors can repeat verbatim; position disambiguates them.
          // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered list of messages
          <li key={`${index}:${error}`}>{error}</li>
        ))}
      </ul>
      <Button variant="outline" size="sm" className="mt-2 self-start" onClick={onRetry}>
        <RefreshIcon className="h-3.5 w-3.5" />
        Retry
      </Button>
    </Alert>
  );
}
