import type * as React from "react";
import type { NormalizedTestStatus } from "../../TestStatusFormatters";
import { AlertCircleIcon, CheckCircleIcon, TestTubeIcon, XCircleIcon } from "../icons";
import type { IconProps } from "../icons/types";
import { cn } from "../lib/utils";

const DEFAULT_SIZE = 14;
// Icons keep the raw status hues; text uses the contrast-safe
// `resolveMetricToneClass` tokens instead.
const STATUS_ICONS: Record<
  NormalizedTestStatus,
  { Icon: (props: IconProps) => React.JSX.Element; tone: string }
> = {
  passed: { Icon: CheckCircleIcon, tone: "text-success" },
  skipped: { Icon: AlertCircleIcon, tone: "text-warning" },
  failed: { Icon: XCircleIcon, tone: "text-failure" },
  other: { Icon: TestTubeIcon, tone: "text-muted-foreground" }
};
export function TestStatusIcon({
  status,
  className,
  size = DEFAULT_SIZE
}: {
  status: NormalizedTestStatus;
  className?: string;
  size?: number;
}) {
  const { Icon, tone } = STATUS_ICONS[status];
  return <Icon className={cn("shrink-0", tone, className)} style={{ width: size, height: size }} />;
}
