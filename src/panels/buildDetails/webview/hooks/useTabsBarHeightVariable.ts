import * as React from "react";

const { useEffect } = React;

const TABS_BAR_SELECTOR = ".build-details-tabs-bar";
const TABS_BAR_HEIGHT_VARIABLE = "--build-details-tabs-bar-height";

/**
 * Publishes the docked tab bar height so sticky content below it (the test
 * results toolbar, revealed log panes) can dock underneath instead of
 * painting over the tabs. Several sections may call this; the value is left
 * in place on unmount because any remaining caller keeps it current.
 */
export function useTabsBarHeightVariable(): void {
  useEffect(() => {
    const tabsBar = document.querySelector<HTMLElement>(TABS_BAR_SELECTOR);
    if (!tabsBar) {
      return;
    }
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty(TABS_BAR_HEIGHT_VARIABLE, `${tabsBar.offsetHeight}px`);
    };
    publish();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(publish);
    observer.observe(tabsBar);
    return () => observer.disconnect();
  }, []);
}
