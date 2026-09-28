import * as React from "react";
import type { BuildCompareSectionId } from "../../shared/BuildComparePanelWebviewState";
import { readBuildCompareUiState, writeBuildCompareUiState } from "../lib/buildComparePanelState";

const { useCallback, useState } = React;

/** Tracks collapsed comparison sections and persists them in the webview state. */
export function useCollapsedSections(): {
  isOpen: (id: BuildCompareSectionId) => boolean;
  setOpen: (id: BuildCompareSectionId, open: boolean) => void;
} {
  const [collapsed, setCollapsed] = useState<ReadonlySet<BuildCompareSectionId>>(
    () => new Set(readBuildCompareUiState().collapsedSections ?? [])
  );

  const isOpen = useCallback((id: BuildCompareSectionId) => !collapsed.has(id), [collapsed]);

  const setOpen = useCallback((id: BuildCompareSectionId, open: boolean) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (open) {
        next.delete(id);
      } else {
        next.add(id);
      }
      writeBuildCompareUiState({ collapsedSections: [...next] });
      return next;
    });
  }, []);

  return { isOpen, setOpen };
}
