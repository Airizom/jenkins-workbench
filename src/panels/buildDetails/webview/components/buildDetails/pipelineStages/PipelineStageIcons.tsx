import {
  AlertTriangleIcon,
  CheckIcon,
  PlayIcon,
  StopSquareIcon,
  XIcon
} from "../../../../../shared/webview/icons";
import {
  resolveBuildResultConnectorColor,
  resolveBuildResultStageNodeClass
} from "../../../../../shared/webview/lib/statusStyles";

export function getStageIcon(statusClass?: string) {
  switch (statusClass) {
    case "success":
      return <CheckIcon className="h-3 w-3" />;
    case "failure":
      return <XIcon className="h-3 w-3" />;
    case "unstable":
      return <AlertTriangleIcon className="h-3 w-3 text-current" />;
    case "running":
      return <PlayIcon className="h-3 w-3 ml-0.5 text-current" />;
    case "aborted":
      return <StopSquareIcon className="h-3 w-3 text-current" />;
    default:
      return null;
  }
}

export function getStageNodeStyle(statusClass?: string): string {
  return resolveBuildResultStageNodeClass(statusClass);
}

export function getConnectorColor(statusClass?: string): string {
  return resolveBuildResultConnectorColor(statusClass);
}
