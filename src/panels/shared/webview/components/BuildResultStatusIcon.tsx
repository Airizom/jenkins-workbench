import type * as React from "react";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  PlayCircleIcon,
  StopCircleIcon,
  XCircleIcon
} from "../icons";

type BuildResultStatusIconProps = {
  status?: string;
  className?: string;
};
export function BuildResultStatusIcon({
  status,
  className = "h-4 w-4"
}: BuildResultStatusIconProps): React.JSX.Element | null {
  switch (status) {
    case "success":
      return <CheckCircleIcon className={className} />;
    case "failure":
      return <XCircleIcon className={className} />;
    case "unstable":
      return <AlertTriangleIcon className={className} />;
    case "aborted":
      return <StopCircleIcon className={className} />;
    case "running":
      return <PlayCircleIcon className={className} />;
    default:
      return null;
  }
}
