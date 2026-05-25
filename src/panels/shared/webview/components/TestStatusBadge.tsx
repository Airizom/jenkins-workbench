import { type NormalizedTestStatus, testStatusToVisualTone } from "../../TestStatusFormatters";
import { ToneBadge } from "./ToneBadge";

export function TestStatusBadge({
  status,
  label,
  className
}: {
  status: NormalizedTestStatus;
  label: string;
  className?: string;
}) {
  return <ToneBadge label={label} tone={testStatusToVisualTone(status)} className={className} />;
}
