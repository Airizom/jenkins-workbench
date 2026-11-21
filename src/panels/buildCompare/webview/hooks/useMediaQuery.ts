import * as React from "react";

const { useCallback, useSyncExternalStore } = React;

/** Live `matchMedia` result; false where media queries are unavailable (tests, SSR). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) {
        return () => undefined;
      }
      const list = window.matchMedia(query);
      // eslint-disable-next-line react-doctor/effect-needs-cleanup -- useSyncExternalStore calls the unsubscribe function returned below.
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== "undefined" && window.matchMedia?.(query).matches) ?? false,
    () => false
  );
}
