export const NODE_DETAILS_TABS = {
  OVERVIEW: "overview",
  EXECUTORS: "executors",
  QUEUE: "queue",
  DIAGNOSTICS: "diagnostics"
} as const;

export type NodeDetailsTab = (typeof NODE_DETAILS_TABS)[keyof typeof NODE_DETAILS_TABS];

const NODE_DETAILS_TAB_VALUES: readonly string[] = Object.values(NODE_DETAILS_TABS);

export function isNodeDetailsTab(value: string): value is NodeDetailsTab {
  return NODE_DETAILS_TAB_VALUES.includes(value);
}

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
