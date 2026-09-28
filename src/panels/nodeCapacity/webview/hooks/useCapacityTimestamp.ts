import * as React from "react";
import { formatRelativeIsoTimestamp } from "../../../../formatters/RelativeTimeFormatters";
import {
  isStaleCapacityTimestamp,
  NODE_CAPACITY_REFRESH_INTERVAL_MS
} from "../state/nodeCapacityState";

const { useEffect, useMemo, useState } = React;

interface CapacityTimestampLabels {
  updatedAtLabel: string;
  updatedAtAbsolute: string;
  isStale: boolean;
}

function formatAbsoluteTimestamp(updatedAt: string): string {
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

/** Relative/absolute snapshot labels that re-evaluate on the refresh interval. */
export function useCapacityTimestamp(
  updatedAt: string,
  hasLoaded: boolean
): CapacityTimestampLabels {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, NODE_CAPACITY_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  const updatedAtLabel = useMemo(() => formatRelativeIsoTimestamp(updatedAt), [updatedAt, now]);
  const updatedAtAbsolute = useMemo(() => formatAbsoluteTimestamp(updatedAt), [updatedAt]);
  const isStale = useMemo(
    () => hasLoaded && isStaleCapacityTimestamp(updatedAt, now),
    [hasLoaded, updatedAt, now]
  );
  return { updatedAtLabel, updatedAtAbsolute, isStale };
}
