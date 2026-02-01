export type LoadingSkeletonVariant = "build" | "node";

const BUILD_LOADING_SKELETON = `
  <div class="min-h-screen flex flex-col">
    <header class="border-b border-border bg-header">
      <div class="h-0.5 w-full overflow-hidden bg-muted">
        <div class="h-full w-1/3 animate-progress-indeterminate bg-progress rounded-full"></div>
      </div>
      <div class="mx-auto max-w-5xl px-6 py-4">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex items-start gap-4">
            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-3">
                <div class="animate-pulse rounded bg-muted h-5 w-48"></div>
                <div class="animate-pulse rounded bg-muted h-5 w-20"></div>
              </div>
              <div class="flex items-center gap-4">
                <div class="animate-pulse rounded bg-muted h-3.5 w-24"></div>
                <div class="animate-pulse rounded bg-muted h-3.5 w-32"></div>
                <div class="animate-pulse rounded bg-muted h-3.5 w-20"></div>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <div class="animate-pulse rounded bg-muted h-8 w-32"></div>
          </div>
        </div>
      </div>
    </header>
    <main class="flex-1 mx-auto w-full max-w-5xl px-6 py-6">
      <div class="flex items-center gap-1 rounded-lg bg-muted-strong p-1 w-fit">
        <div class="px-3 py-1.5 rounded-md text-sm bg-background shadow-sm">
          <div class="animate-pulse rounded bg-muted h-4 w-16"></div>
        </div>
        <div class="px-3 py-1.5 rounded-md text-sm">
          <div class="animate-pulse rounded bg-muted h-4 w-20"></div>
        </div>
      </div>
      <div class="mt-6 space-y-4">
        <div class="rounded border border-card-border bg-card p-4 space-y-4">
          <div class="flex items-center gap-2">
            <div class="animate-pulse bg-muted h-4 w-4 rounded"></div>
            <div class="animate-pulse rounded bg-muted h-4 w-32"></div>
          </div>
          <div class="animate-pulse rounded bg-muted h-3 w-64"></div>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div class="flex items-center gap-3 rounded-lg border border-border bg-muted-soft px-4 py-3">
              <div class="animate-pulse bg-muted h-10 w-10 shrink-0 rounded-lg"></div>
              <div class="space-y-1.5 flex-1">
                <div class="animate-pulse rounded bg-muted h-2.5 w-16"></div>
                <div class="animate-pulse rounded bg-muted h-4 w-24"></div>
              </div>
            </div>
            <div class="flex items-center gap-3 rounded-lg border border-border bg-muted-soft px-4 py-3">
              <div class="animate-pulse bg-muted h-10 w-10 shrink-0 rounded-lg"></div>
              <div class="space-y-1.5 flex-1">
                <div class="animate-pulse rounded bg-muted h-2.5 w-16"></div>
                <div class="animate-pulse rounded bg-muted h-4 w-24"></div>
              </div>
            </div>
            <div class="flex items-center gap-3 rounded-lg border border-border bg-muted-soft px-4 py-3">
              <div class="animate-pulse bg-muted h-10 w-10 shrink-0 rounded-lg"></div>
              <div class="space-y-1.5 flex-1">
                <div class="animate-pulse rounded bg-muted h-2.5 w-16"></div>
                <div class="animate-pulse rounded bg-muted h-4 w-24"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="rounded border border-card-border bg-card overflow-hidden">
          <div class="flex items-center justify-between gap-4 px-4 py-3 border-b border-border bg-muted-soft">
            <div class="flex items-center gap-3">
              <div class="animate-pulse bg-muted h-4 w-4 rounded"></div>
              <div class="animate-pulse rounded bg-muted h-4 w-28"></div>
            </div>
            <div class="flex items-center gap-2">
              <div class="animate-pulse bg-muted h-7 w-7 rounded"></div>
              <div class="animate-pulse bg-muted h-7 w-7 rounded"></div>
              <div class="animate-pulse bg-muted h-7 w-24 rounded"></div>
            </div>
          </div>
          <div class="p-4 space-y-2 font-mono text-sm">
            <div class="animate-pulse rounded bg-muted h-4 w-3/4"></div>
            <div class="animate-pulse rounded bg-muted h-4 w-3/5"></div>
            <div class="animate-pulse rounded bg-muted h-4 w-4/5"></div>
            <div class="animate-pulse rounded bg-muted h-4 w-2/5"></div>
            <div class="animate-pulse rounded bg-muted h-4 w-7/12"></div>
            <div class="animate-pulse rounded bg-muted h-4 w-1/2"></div>
            <div class="animate-pulse rounded bg-muted h-4 w-4/5"></div>
            <div class="animate-pulse rounded bg-muted h-4 w-2/5"></div>
          </div>
        </div>
      </div>
    </main>
  </div>
`;

const NODE_LOADING_SKELETON = `
  <div class="min-h-screen flex flex-col">
    <header class="border-b border-border bg-header">
      <div class="h-0.5 w-full overflow-hidden bg-muted">
        <div class="h-full w-1/3 animate-progress-indeterminate bg-progress rounded-full"></div>
      </div>
      <div class="mx-auto max-w-5xl px-6 py-4">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex items-start gap-4">
            <div class="animate-pulse bg-muted h-12 w-12 shrink-0 rounded-lg"></div>
            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-3">
                <div class="animate-pulse rounded bg-muted h-5 w-48"></div>
                <div class="animate-pulse bg-muted h-5 w-20 rounded-full"></div>
              </div>
              <div class="flex items-center gap-4">
                <div class="animate-pulse rounded bg-muted h-3.5 w-24"></div>
                <div class="animate-pulse rounded bg-muted h-3.5 w-32"></div>
              </div>
              <div class="animate-pulse rounded bg-muted h-3 w-40 mt-0.5"></div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <div class="animate-pulse bg-muted h-8 w-24 rounded"></div>
            <div class="animate-pulse bg-muted h-8 w-32 rounded"></div>
          </div>
        </div>
      </div>
    </header>
    <main class="flex-1 mx-auto w-full max-w-5xl px-6 py-6">
      <div class="flex items-center gap-1 rounded-lg bg-muted-strong p-1 w-fit">
        <div class="px-3 py-1.5 rounded-md text-sm bg-background shadow-sm">
          <div class="animate-pulse rounded bg-muted h-4 w-16"></div>
        </div>
        <div class="px-3 py-1.5 rounded-md text-sm">
          <div class="animate-pulse rounded bg-muted h-4 w-20"></div>
        </div>
        <div class="px-3 py-1.5 rounded-md text-sm">
          <div class="animate-pulse rounded bg-muted h-4 w-20"></div>
        </div>
        <div class="px-3 py-1.5 rounded-md text-sm">
          <div class="animate-pulse rounded bg-muted h-4 w-20"></div>
        </div>
      </div>
      <div class="mt-6 space-y-4">
        <div class="rounded border border-card-border bg-card p-4 space-y-4">
          <div class="flex items-center gap-2">
            <div class="animate-pulse bg-muted h-4 w-4 rounded"></div>
            <div class="animate-pulse rounded bg-muted h-4 w-32"></div>
          </div>
          <div class="animate-pulse rounded bg-muted h-3 w-64"></div>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div class="flex items-center gap-3 rounded-lg border border-border bg-muted-soft px-4 py-3">
              <div class="animate-pulse bg-muted h-10 w-10 shrink-0 rounded-lg"></div>
              <div class="space-y-1.5 flex-1">
                <div class="animate-pulse rounded bg-muted h-2.5 w-16"></div>
                <div class="animate-pulse rounded bg-muted h-4 w-24"></div>
              </div>
            </div>
            <div class="flex items-center gap-3 rounded-lg border border-border bg-muted-soft px-4 py-3">
              <div class="animate-pulse bg-muted h-10 w-10 shrink-0 rounded-lg"></div>
              <div class="space-y-1.5 flex-1">
                <div class="animate-pulse rounded bg-muted h-2.5 w-16"></div>
                <div class="animate-pulse rounded bg-muted h-4 w-24"></div>
              </div>
            </div>
            <div class="flex items-center gap-3 rounded-lg border border-border bg-muted-soft px-4 py-3">
              <div class="animate-pulse bg-muted h-10 w-10 shrink-0 rounded-lg"></div>
              <div class="space-y-1.5 flex-1">
                <div class="animate-pulse rounded bg-muted h-2.5 w-16"></div>
                <div class="animate-pulse rounded bg-muted h-4 w-24"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="rounded border border-card-border bg-card p-4">
          <div class="flex items-center gap-2 mb-4">
            <div class="animate-pulse bg-muted h-4 w-4 rounded"></div>
            <div class="animate-pulse rounded bg-muted h-4 w-24"></div>
          </div>
          <div class="space-y-3">
            <div class="rounded-lg border border-border bg-muted-soft p-4">
              <div class="flex items-start justify-between gap-4 mb-3">
                <div class="flex items-center gap-3">
                  <div class="animate-pulse bg-muted h-8 w-8 shrink-0 rounded-lg"></div>
                  <div class="space-y-1.5">
                    <div class="animate-pulse rounded bg-muted h-4 w-20"></div>
                    <div class="animate-pulse rounded bg-muted h-3 w-32"></div>
                  </div>
                </div>
                <div class="animate-pulse bg-muted h-5 w-12 rounded-full"></div>
              </div>
              <div class="animate-pulse bg-muted h-1.5 w-full rounded-full"></div>
            </div>
            <div class="rounded-lg border border-border bg-muted-soft p-4">
              <div class="flex items-start justify-between gap-4 mb-3">
                <div class="flex items-center gap-3">
                  <div class="animate-pulse bg-muted h-8 w-8 shrink-0 rounded-lg"></div>
                  <div class="space-y-1.5">
                    <div class="animate-pulse rounded bg-muted h-4 w-20"></div>
                    <div class="animate-pulse rounded bg-muted h-3 w-32"></div>
                  </div>
                </div>
                <div class="animate-pulse bg-muted h-5 w-12 rounded-full"></div>
              </div>
              <div class="animate-pulse bg-muted h-1.5 w-full rounded-full"></div>
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
