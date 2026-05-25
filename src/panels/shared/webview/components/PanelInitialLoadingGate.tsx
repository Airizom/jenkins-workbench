import { LoadingSkeleton, type LoadingSkeletonProps } from "./ui/loading-skeleton";

export function PanelInitialLoadingGate({
  loading = false,
  hasLoaded,
  variant = "build"
}: {
  loading?: boolean;
  hasLoaded: boolean;
  variant?: LoadingSkeletonProps["variant"];
}): JSX.Element | null {
  if (loading && !hasLoaded) {
    return <LoadingSkeleton variant={variant} />;
  }
  return null;
}
