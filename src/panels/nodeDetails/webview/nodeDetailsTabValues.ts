import { NODE_DETAILS_TABS, type NodeDetailsTab } from "../shared/NodeDetailsTabs";

export {
  isNodeDetailsTab,
  NODE_DETAILS_TABS,
  type NodeDetailsTab
} from "../shared/NodeDetailsTabs";

/** `loadedOrRequested`: diagnostics are already loaded or a request is still pending. */
export function loadAdvancedNodeDetailsForTab(
  tab: NodeDetailsTab,
  loadedOrRequested: boolean,
  load: () => void
): void {
  if (tab === NODE_DETAILS_TABS.DIAGNOSTICS && !loadedOrRequested) {
    load();
  }
}
