import * as React from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { Skeleton } from "./skeleton";

export interface LoadingSkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "build" | "node";
}

export function LoadingSkeleton({ className, variant = "build", ...props }: LoadingSkeletonProps) {
  return (
    <div className={cn("min-h-screen flex flex-col", className)} {...props}>
      <LoadingSkeletonHeader variant={variant} />
      <LoadingSkeletonContent variant={variant} />
    </div>
  );
}

function LoadingSkeletonHeader({ variant }: { variant: "build" | "node" }) {
  return (
    <header className="border-b border-border bg-header">
      <div className="h-0.5 w-full overflow-hidden bg-muted">
        <div className="h-full w-1/3 animate-progress-indeterminate bg-progress rounded-full" />
      </div>
      <div className="mx-auto max-w-5xl px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {variant === "node" ? <Skeleton className="h-12 w-12 shrink-0 rounded-lg" /> : null}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <div className="flex items-center gap-4">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-32" />
                {variant === "build" ? <Skeleton className="h-3.5 w-20" /> : null}
              </div>
              {variant === "node" ? <Skeleton className="h-3 w-40 mt-0.5" /> : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {variant === "node" ? <Skeleton className="h-8 w-24 rounded" /> : null}
            <Skeleton className="h-8 w-32 rounded" />
          </div>
        </div>
      </div>
    </header>
  );
}

function LoadingSkeletonContent({ variant }: { variant: "build" | "node" }) {
  return (
    <main className="flex-1 mx-auto w-full max-w-5xl px-6 py-6">
      <LoadingSkeletonTabs variant={variant} />
      <div className="mt-6 space-y-4">
        <LoadingSkeletonCard />
        {variant === "build" ? <LoadingSkeletonConsole /> : <LoadingSkeletonGrid />}
      </div>
    </main>
  );
}

function LoadingSkeletonTabs({ variant }: { variant: "build" | "node" }) {
  const tabs =
    variant === "build"
      ? ["Console", "Build Summary"]
      : ["Overview", "Executors", "Labels", "Advanced"];

  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted-strong p-1 w-fit">
      {tabs.map((tab, index) => (
        <div
          key={tab}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm",
            index === 0 ? "bg-background shadow-sm" : ""
          )}
        >
          <Skeleton className={cn("h-4", index === 0 ? "w-16" : "w-20")} />
        </div>
      ))}
    </div>
  );
}

function LoadingSkeletonCard() {
  return (
    <div className="rounded border border-card-border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="h-3 w-64" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted-soft px-4 py-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted-soft px-4 py-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted-soft px-4 py-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingSkeletonConsole() {
  return (
    <div className="rounded border border-card-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border bg-muted-soft">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 w-7 rounded" />
          <Skeleton className="h-7 w-24 rounded" />
        </div>
      </div>
      <div className="p-4 space-y-2 font-mono text-sm">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-4 w-7/12" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/5" />
      </div>
    </div>
  );
}

function LoadingSkeletonGrid() {
  return (
    <div className="rounded border border-card-border bg-card p-4">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-muted-soft p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
        <div className="rounded-lg border border-border bg-muted-soft p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      </div>
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
