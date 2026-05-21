import { PanelErrorList } from "../../../../shared/webview/components/PanelErrorList";

type BuildDetailsErrorListProps = {
  errors: string[];
};

export function BuildDetailsErrorList({ errors }: BuildDetailsErrorListProps): JSX.Element | null {
  return <PanelErrorList errors={errors} id="errors" />;
}
