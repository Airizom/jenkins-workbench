import { PanelErrorList } from "../../../../shared/webview/components/PanelErrorList";

type NodeDetailsAlertsProps = {
  errors: string[];
};
export function NodeDetailsAlerts({ errors }: NodeDetailsAlertsProps): JSX.Element | null {
  if (errors.length === 0) {
    return null;
  }

  return (
    <PanelErrorList
      errors={errors}
      title="Unable to load full node details"
      className="mb-3 py-2"
    />
  );
}
