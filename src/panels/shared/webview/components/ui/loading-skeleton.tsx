import type { HTMLAttributes } from "react";
import * as React from "react";
import { type LoadingSkeletonVariant, renderLoadingSkeletonHtml } from "../../LoadingSkeletonHtml";

export interface LoadingSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: LoadingSkeletonVariant;
}

/**
 * Renders the same static markup the host shows before the webview script
 * loads, so the initial-load gate never differs from the server skeleton. The
 * markup is a constant built from literal class names (no user data).
 */
export const LoadingSkeleton = React.memo(function LoadingSkeleton({
  variant = "build",
  ...props
}: LoadingSkeletonProps) {
  const markup = React.useMemo(() => ({ __html: renderLoadingSkeletonHtml(variant) }), [variant]);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: constant skeleton markup, no user input
  return <div {...props} dangerouslySetInnerHTML={markup} />;
});
