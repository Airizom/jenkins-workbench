import * as React from "react";
import type { BuildCompareSectionId } from "../../shared/BuildComparePanelWebviewState";
import { readBuildCompareUiState, writeBuildCompareUiState } from "../lib/buildComparePanelState";

const { useCallback, useEffect, useRef, useState } = React;

interface SectionOverrides {
  collapsed: ReadonlySet<BuildCompareSectionId>;
  expanded: ReadonlySet<BuildCompareSectionId>;
}

/**
 * Tracks which comparison sections are expanded. Each section has a default
 * (sections without differences start collapsed); only the user's explicit
 * toggles are persisted in the webview state.
 */
export function useCollapsedSections(): {
  isOpen: (id: BuildCompareSectionId, defaultOpen?: boolean) => boolean;
  setOpen: (id: BuildCompareSectionId, open: boolean) => void;
} {
  const [overrides, setOverrides] = useState<SectionOverrides>(() => {
    const saved = readBuildCompareUiState();
    return {
      collapsed: new Set(saved.collapsedSections ?? []),
      expanded: new Set(saved.expandedSections ?? [])
    };
  });

  const isOpen = useCallback(
    (id: BuildCompareSectionId, defaultOpen = true) =>
      overrides.collapsed.has(id) ? false : overrides.expanded.has(id) ? true : defaultOpen,
    [overrides]
  );

  const setOpen = useCallback((id: BuildCompareSectionId, open: boolean) => {
    setOverrides((current) => {
      const collapsed = new Set(current.collapsed);
      const expanded = new Set(current.expanded);
      if (open) {
        collapsed.delete(id);
        expanded.add(id);
      } else {
        expanded.delete(id);
        collapsed.add(id);
      }
      return { collapsed, expanded };
    });
  }, []);

  // Persist outside the updater so React can replay it without side effects;
  // the ref skips the state that was just read from storage.
  const persistedRef = useRef(overrides);
  useEffect(() => {
    if (persistedRef.current === overrides) {
      return;
    }
    persistedRef.current = overrides;
    writeBuildCompareUiState({
      collapsedSections: [...overrides.collapsed],
      expandedSections: [...overrides.expanded]
    });
  }, [overrides]);

  return { isOpen, setOpen };
}
