import { PanelErrorList } from "../../../../shared/webview/components/PanelErrorList";

export function BuildCompareErrorList({ errors }: { errors: string[] }) {
  return <PanelErrorList errors={errors} variant="card" />;
}
