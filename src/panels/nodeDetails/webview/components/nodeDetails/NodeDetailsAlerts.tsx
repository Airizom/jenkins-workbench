import { Alert, AlertDescription, AlertTitle } from "../../../../shared/webview/components/ui/alert";

type NodeDetailsAlertsProps = {
  showOfflineBanner: boolean;
  statusLabel: string;
  offlineReason?: string;
  errors: string[];
};

export function NodeDetailsAlerts({
  showOfflineBanner,
  statusLabel,
  offlineReason,
  errors
}: NodeDetailsAlertsProps): JSX.Element | null {
  if (!showOfflineBanner && errors.length === 0) {
    return null;
  }

  return (
    <>
      {showOfflineBanner ? (
        <Alert variant="warning" className="mb-3 py-2">
          <AlertTitle className="text-xs">{statusLabel}</AlertTitle>
          <AlertDescription className="text-xs">
            {offlineReason ?? "Jenkins reported this node as offline."}
          </AlertDescription>
        </Alert>
      ) : null}
      {errors.length > 0 ? (
        <Alert variant="destructive" className="mb-3 py-2">
          <AlertTitle className="text-xs">Unable to load full node details</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

