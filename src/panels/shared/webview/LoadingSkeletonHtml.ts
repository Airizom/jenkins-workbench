export type LoadingSkeletonVariant = "build" | "node";

const BUILD_LOADING_SKELETON = `
  <div class="min-h-screen flex flex-col bg-background text-foreground">
    <header class="sticky-header">
      <div class="h-px w-full overflow-hidden bg-muted">
        <div class="h-full w-1/3 animate-progress-indeterminate bg-progress rounded-full"></div>
      </div>
      <div class="mx-auto max-w-6xl px-4 py-2.5">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="animate-pulse rounded-sm bg-muted h-4 w-4"></div>
            <div class="animate-pulse rounded bg-muted h-4 w-44 max-w-[48vw]"></div>
            <div class="animate-pulse rounded-full bg-muted h-4 w-16"></div>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="hidden sm:flex items-center gap-2">
              <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
              <div class="animate-pulse rounded bg-muted h-3 w-24"></div>
              <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
            </div>
            <div class="animate-pulse rounded bg-muted h-7 w-18"></div>
          </div>
        </div>
        <div class="sm:hidden flex items-center gap-2 mt-1.5">
          <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
          <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
        </div>
      </div>
      <div class="h-px bg-border"></div>
    </header>

    <main class="flex-1 mx-auto w-full max-w-6xl px-4 py-3">
      <div class="border-b border-border">
        <div class="flex w-full flex-nowrap items-center gap-1 py-1">
          <div class="animate-pulse rounded bg-muted h-6 w-16"></div>
          <div class="animate-pulse rounded bg-muted h-6 w-18"></div>
          <div class="animate-pulse rounded bg-muted h-6 w-16"></div>
          <div class="animate-pulse rounded bg-muted h-6 w-20"></div>
        </div>
      </div>

      <div class="mt-5 space-y-3">
        <div class="rounded border border-border bg-card p-3 space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <div class="animate-pulse rounded-sm bg-muted h-4 w-4"></div>
              <div class="animate-pulse rounded bg-muted h-3 w-36"></div>
            </div>
            <div class="flex items-center gap-1.5">
              <div class="animate-pulse rounded bg-muted h-7 w-18"></div>
              <div class="animate-pulse rounded bg-muted h-7 w-18"></div>
              <div class="animate-pulse rounded bg-muted h-5 w-14"></div>
            </div>
          </div>
          <div class="rounded border border-border bg-terminal px-3 py-2 space-y-2">
            <div class="animate-pulse rounded bg-muted h-3 w-4/5"></div>
            <div class="animate-pulse rounded bg-muted h-3 w-3/5"></div>
            <div class="animate-pulse rounded bg-muted h-3 w-[72%]"></div>
            <div class="animate-pulse rounded bg-muted h-3 w-[58%]"></div>
            <div class="animate-pulse rounded bg-muted h-3 w-[66%]"></div>
            <div class="animate-pulse rounded bg-muted h-3 w-[46%]"></div>
            <div class="animate-pulse rounded bg-muted h-3 w-[80%]"></div>
          </div>
        </div>

        <div class="rounded border border-border bg-card p-3">
          <div class="flex items-center gap-2 mb-2">
            <div class="animate-pulse rounded-sm bg-muted h-4 w-4"></div>
            <div class="animate-pulse rounded bg-muted h-3 w-24"></div>
          </div>
          <div class="grid gap-2 sm:grid-cols-3">
            <div class="rounded border border-mutedBorder bg-muted-soft px-3 py-2">
              <div class="animate-pulse rounded bg-muted h-2.5 w-16 mb-2"></div>
              <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
            </div>
            <div class="rounded border border-mutedBorder bg-muted-soft px-3 py-2">
              <div class="animate-pulse rounded bg-muted h-2.5 w-16 mb-2"></div>
              <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
            </div>
            <div class="rounded border border-mutedBorder bg-muted-soft px-3 py-2">
              <div class="animate-pulse rounded bg-muted h-2.5 w-16 mb-2"></div>
              <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
`;

const NODE_LOADING_SKELETON = `
  <div class="min-h-screen flex flex-col bg-background text-foreground">
    <header class="sticky-header">
      <div class="h-px w-full overflow-hidden bg-muted">
        <div class="h-full w-1/3 animate-progress-indeterminate bg-progress rounded-full"></div>
      </div>
      <div class="mx-auto max-w-6xl px-4 py-2.5">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="animate-pulse rounded bg-muted h-7 w-7"></div>
            <div class="min-w-0 space-y-1.5">
              <div class="flex items-center gap-2">
                <div class="animate-pulse rounded bg-muted h-4 w-40 max-w-[44vw]"></div>
                <div class="animate-pulse rounded-full bg-muted h-4 w-14"></div>
              </div>
              <div class="flex items-center gap-2">
                <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
                <div class="animate-pulse rounded bg-muted h-3 w-24"></div>
                <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <div class="animate-pulse rounded bg-muted h-7 w-7"></div>
            <div class="animate-pulse rounded bg-muted h-7 w-24"></div>
            <div class="animate-pulse rounded bg-muted h-7 w-18"></div>
          </div>
        </div>
      </div>
      <div class="h-px bg-border"></div>
    </header>

    <main class="flex-1 mx-auto w-full max-w-6xl px-4 py-3">
      <div class="border-b border-border">
        <div class="flex w-full flex-nowrap items-center gap-1 py-1">
          <div class="animate-pulse rounded bg-muted h-6 w-18"></div>
          <div class="animate-pulse rounded bg-muted h-6 w-18"></div>
          <div class="animate-pulse rounded bg-muted h-6 w-14"></div>
          <div class="animate-pulse rounded bg-muted h-6 w-18"></div>
        </div>
      </div>

      <div class="mt-5 space-y-3">
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div class="flex items-center gap-2.5 rounded border border-mutedBorder bg-muted-soft px-3 py-2">
            <div class="animate-pulse rounded bg-muted h-7 w-7"></div>
            <div class="space-y-1">
              <div class="animate-pulse rounded bg-muted h-2.5 w-14"></div>
              <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
            </div>
          </div>
          <div class="flex items-center gap-2.5 rounded border border-mutedBorder bg-muted-soft px-3 py-2">
            <div class="animate-pulse rounded bg-muted h-7 w-7"></div>
            <div class="space-y-1">
              <div class="animate-pulse rounded bg-muted h-2.5 w-14"></div>
              <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
            </div>
          </div>
          <div class="flex items-center gap-2.5 rounded border border-mutedBorder bg-muted-soft px-3 py-2">
            <div class="animate-pulse rounded bg-muted h-7 w-7"></div>
            <div class="space-y-1">
              <div class="animate-pulse rounded bg-muted h-2.5 w-14"></div>
              <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
            </div>
          </div>
          <div class="flex items-center gap-2.5 rounded border border-mutedBorder bg-muted-soft px-3 py-2">
            <div class="animate-pulse rounded bg-muted h-7 w-7"></div>
            <div class="space-y-1">
              <div class="animate-pulse rounded bg-muted h-2.5 w-14"></div>
              <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
            </div>
          </div>
          <div class="flex items-center gap-2.5 rounded border border-mutedBorder bg-muted-soft px-3 py-2">
            <div class="animate-pulse rounded bg-muted h-7 w-7"></div>
            <div class="space-y-1">
              <div class="animate-pulse rounded bg-muted h-2.5 w-14"></div>
              <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
            </div>
          </div>
          <div class="flex items-center gap-2.5 rounded border border-mutedBorder bg-muted-soft px-3 py-2">
            <div class="animate-pulse rounded bg-muted h-7 w-7"></div>
            <div class="space-y-1">
              <div class="animate-pulse rounded bg-muted h-2.5 w-14"></div>
              <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
            </div>
          </div>
        </div>

        <div class="rounded border border-border bg-card overflow-hidden">
          <div class="flex items-center justify-between px-3 py-2 border-b border-border bg-muted-soft">
            <div class="flex items-center gap-2">
              <div class="animate-pulse rounded-sm bg-muted h-4 w-4"></div>
              <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
            </div>
            <div class="animate-pulse rounded bg-muted h-6 w-16"></div>
          </div>
          <div class="p-3 space-y-2">
            <div class="rounded border border-border bg-muted-soft px-3 py-2">
              <div class="flex items-center justify-between gap-3">
                <div class="animate-pulse rounded bg-muted h-3 w-16"></div>
                <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
              </div>
              <div class="animate-pulse rounded bg-muted h-1.5 w-full mt-2"></div>
            </div>
            <div class="rounded border border-border bg-muted-soft px-3 py-2">
              <div class="flex items-center justify-between gap-3">
                <div class="animate-pulse rounded bg-muted h-3 w-16"></div>
                <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
              </div>
              <div class="animate-pulse rounded bg-muted h-1.5 w-full mt-2"></div>
            </div>
            <div class="rounded border border-border bg-muted-soft px-3 py-2">
              <div class="flex items-center justify-between gap-3">
                <div class="animate-pulse rounded bg-muted h-3 w-16"></div>
                <div class="animate-pulse rounded bg-muted h-3 w-20"></div>
              </div>
              <div class="animate-pulse rounded bg-muted h-1.5 w-full mt-2"></div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
`;

export function renderLoadingSkeletonHtml(variant: LoadingSkeletonVariant): string {
  return variant === "node" ? NODE_LOADING_SKELETON : BUILD_LOADING_SKELETON;
}
