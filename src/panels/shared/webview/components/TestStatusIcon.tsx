import type { NormalizedTestStatus } from "../../TestStatusFormatters";
import { testStatusToVisualTone } from "../../TestStatusFormatters";
import { resolveMetricToneClass } from "../../TestStatusStyles";
import { AlertCircleIcon, CheckCircleIcon, TestTubeIcon, XCircleIcon } from "../icons";
import { cn } from "../lib/utils";

const DEFAULT_SIZE = 14;

export function TestStatusIcon({
  status,
  className,
  size = DEFAULT_SIZE
}: {
  status: NormalizedTestStatus;
  className?: string;
  size?: number;
}) {
  const style = { width: size, height: size };
  const toneClass = resolveMetricToneClass(testStatusToVisualTone(status));

  switch (status) {
    case "passed":
      return <CheckCircleIcon className={cn("shrink-0", toneClass, className)} style={style} />;
    case "skipped":
      return <AlertCircleIcon className={cn("shrink-0", toneClass, className)} style={style} />;
    case "failed":
      return <XCircleIcon className={cn("shrink-0", toneClass, className)} style={style} />;
    default:
      return (
        <TestTubeIcon className={cn("shrink-0 text-muted-foreground", className)} style={style} />
      );
  }
}
