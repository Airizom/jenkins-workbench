import type { NormalizedTestStatus } from "../../TestStatusFormatters";
import { AlertCircleIcon, CheckCircleIcon, TestTubeIcon, XCircleIcon } from "../icons";
import { cn } from "../lib/utils";

const DEFAULT_SIZE = 14;
// Icons keep the raw status hues; text uses the contrast-safe
// `resolveMetricToneClass` tokens instead.
const ICON_TONE_CLASS = {
  passed: "text-success",
  skipped: "text-warning",
  failed: "text-failure"
} as const;
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
  switch (status) {
    case "passed":
      return (
        <CheckCircleIcon
          className={cn("shrink-0", ICON_TONE_CLASS[status], className)}
          style={style}
        />
      );
    case "skipped":
      return (
        <AlertCircleIcon
          className={cn("shrink-0", ICON_TONE_CLASS[status], className)}
          style={style}
        />
      );
    case "failed":
      return (
        <XCircleIcon className={cn("shrink-0", ICON_TONE_CLASS[status], className)} style={style} />
      );
    default:
      return (
        <TestTubeIcon className={cn("shrink-0 text-muted-foreground", className)} style={style} />
      );
  }
}
