import * as React from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { Skeleton } from "./skeleton";

export interface LoadingSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "build" | "node";
}

export function LoadingSkeleton({ className, variant = "build", ...props }: LoadingSkeletonProps) {
  if (variant === "node") {
    return <NodeLoadingSkeleton className={className} {...props} />;
  }
  return <BuildLoadingSkeleton className={className} {...props} />;
}

function BuildLoadingSkeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-screen flex flex-col bg-background text-foreground", className)}
      {...props}
    >
      <header className="sticky-header">
        <LoadingProgressBar />
        <div className="mx-auto max-w-6xl px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Skeleton className="h-4 w-4 rounded-sm" />
              <Skeleton className="h-4 w-44 max-w-[48vw]" />
              <Skeleton className="h-4 w-16 rounded-full" />
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="hidden sm:flex items-center gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-7 w-18 rounded" />
            </div>
          </div>
          <div className="sm:hidden flex items-center gap-2 mt-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="h-px bg-border" />
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-3">
        <div className="border-b border-border">
          <div className="flex w-full flex-nowrap items-center gap-1 py-1">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-6 w-18" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <BuildSkeletonConsoleCard />
          <BuildSkeletonSummaryCard />
        </div>
      </main>
    </div>
  );
}

function BuildSkeletonConsoleCard() {
  return (
    <div className="rounded border border-border bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded-sm" />
          <Skeleton className="h-3 w-36" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-7 w-18 rounded" />
          <Skeleton className="h-7 w-18 rounded" />
          <Skeleton className="h-5 w-14 rounded" />
        </div>
      </div>

      <div className="rounded border border-border bg-terminal px-3 py-2 space-y-2">
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-3 w-[72%]" />
        <Skeleton className="h-3 w-[58%]" />
        <Skeleton className="h-3 w-[66%]" />
        <Skeleton className="h-3 w-[46%]" />
        <Skeleton className="h-3 w-[80%]" />
      </div>
    </div>
  );
}

function BuildSkeletonSummaryCard() {
  return (
    <div className="rounded border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <Skeleton className="h-4 w-4 rounded-sm" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <BuildSummaryMetric />
        <BuildSummaryMetric />
        <BuildSummaryMetric />
      </div>
    </div>
  );
}

function BuildSummaryMetric() {
  return (
    <div className="rounded border border-mutedBorder bg-muted-soft px-3 py-2">
      <Skeleton className="h-2.5 w-16 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

function NodeLoadingSkeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-screen flex flex-col bg-background text-foreground", className)}
      {...props}
    >
      <header className="sticky-header">
        <LoadingProgressBar />
        <div className="mx-auto max-w-6xl px-4 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Skeleton className="h-7 w-7 rounded" />
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-40 max-w-[44vw]" />
                  <Skeleton className="h-4 w-14 rounded-full" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Skeleton className="h-7 w-7 rounded" />
              <Skeleton className="h-7 w-24 rounded" />
              <Skeleton className="h-7 w-18 rounded" />
            </div>
          </div>
        </div>
        <div className="h-px bg-border" />
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-3">
        <div className="border-b border-border">
          <div className="flex w-full flex-nowrap items-center gap-1 py-1">
            <Skeleton className="h-6 w-18" />
            <Skeleton className="h-6 w-18" />
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-6 w-18" />
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <NodeOverviewMetric />
            <NodeOverviewMetric />
            <NodeOverviewMetric />
            <NodeOverviewMetric />
            <NodeOverviewMetric />
            <NodeOverviewMetric />
          </div>

          <div className="rounded border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted-soft">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded-sm" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="h-6 w-16 rounded" />
            </div>
            <div className="p-3 space-y-2">
              <NodeExecutorRow />
              <NodeExecutorRow />
              <NodeExecutorRow />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function NodeOverviewMetric() {
  return (
    <div className="flex items-center gap-2.5 rounded border border-mutedBorder bg-muted-soft px-3 py-2">
      <Skeleton className="h-7 w-7 rounded" />
      <div className="space-y-1">
        <Skeleton className="h-2.5 w-14" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

function NodeExecutorRow() {
  return (
    <div className="rounded border border-border bg-muted-soft px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="h-1.5 w-full mt-2" />
    </div>
  );
}

function LoadingProgressBar() {
  return (
    <div className="h-px w-full overflow-hidden bg-muted">
      <div className="h-full w-1/3 animate-progress-indeterminate bg-progress rounded-full" />
    </div>
  );
}

export function LoadingSpinner({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className={cn("h-5 w-5 animate-spin text-primary", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
        fill="none"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function LoadingIndicator({ className, message }: { className?: string; message?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12", className)}>
      <LoadingSpinner className="h-8 w-8" />
      {message ? <p className="text-sm text-muted-foreground animate-pulse">{message}</p> : null}
    </div>
  );
}
