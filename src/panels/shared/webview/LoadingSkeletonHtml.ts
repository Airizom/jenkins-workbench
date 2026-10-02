/**
 * Loading placeholders that mirror each panel's first real layout, so the swap
 * to the rendered panel does not jump. The host renders this markup before the
 * webview script loads, and `LoadingSkeleton` (loading-skeleton.tsx) renders
 * the same markup, so both stages always match.
 *
 * - `build`: Build Details (sticky status hero, stage strip, tabs, overview cards).
 * - `node`: Node Details (non-sticky hero, utilization row, tabs, two-column cards).
 * - `capacity`: Node Capacity (panel header, six summary cards, pool cards).
 * - `compare`: Build Compare (panel header, two build cards, chips, sections).
 */
export type LoadingSkeletonVariant = "build" | "node" | "capacity" | "compare";

function pulse(className: string): string {
  return `<div class="animate-pulse rounded bg-muted ${className}"></div>`;
}

function pulseBlocks(blocks: string[]): string {
  return blocks.map((className) => pulse(className)).join("\n");
}

function repeat(count: number, render: (index: number) => string): string {
  return Array.from({ length: count }, (_, index) => render(index)).join("\n");
}

const PROGRESS_BAR = `
      <div class="h-px w-full overflow-hidden bg-muted">
        <div class="h-full w-1/3 animate-progress-indeterminate bg-progress rounded-full"></div>
      </div>`;

function tabs(widths: string[]): string {
  return `
      <div class="border-b border-border">
        <div class="flex w-full flex-nowrap items-center gap-1 py-1">
          ${pulseBlocks(widths.map((width) => `h-6 ${width}`))}
        </div>
      </div>`;
}

/** Card with a title strip, matching `OverviewCard` and similar section cards. */
function card(body: string, titleWidth = "w-20"): string {
  return `
          <div class="overflow-hidden rounded-lg border border-card-border bg-card">
            <div class="flex items-center gap-2 border-b border-border bg-surface-raised px-3 py-2">
              ${pulse("h-4 w-4 rounded-sm")}
              ${pulse(`h-3 ${titleWidth}`)}
            </div>
            <div class="p-3 space-y-2">
              ${body}
            </div>
          </div>`;
}

/** Sticky title bar used by panels built on `PanelHeader`. */
function panelHeader(actions: string): string {
  return `
    <header class="panel-header">
      ${PROGRESS_BAR}
      <div class="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div class="min-w-0 flex-1 space-y-1.5">
          ${pulse("h-2.5 w-28")}
          ${pulse("h-5 w-44 max-w-[60vw]")}
        </div>
        <div class="flex shrink-0 items-center gap-2">
          ${actions}
        </div>
      </div>
    </header>`;
}

// Mirrors `PanelLoadingShell` semantics: a polite status region whose only
// readable content is the visually hidden label; the placeholder blocks are
// empty.
function pageShell(header: string, content: string, mainClassName = "py-3"): string {
  return `
  <div role="status" aria-live="polite" aria-label="Loading" class="min-h-screen flex flex-col bg-background text-foreground">
    <span class="sr-only">Loading…</span>
    ${header}

    <main class="flex-1 mx-auto w-full max-w-6xl px-4 ${mainClassName}">
      ${content}
    </main>
  </div>
`;
}

function metricTile(): string {
  return `
              <div class="rounded border border-mutedBorder bg-muted-soft px-3 py-2">
                ${pulse("h-2.5 w-16 mb-2")}
                ${pulse("h-3 w-20")}
              </div>`;
}

const BUILD_LOADING_SKELETON = pageShell(
  `
    <header class="sticky-header">
      ${PROGRESS_BAR}
      <div class="mx-auto max-w-6xl px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="flex flex-1 items-center gap-3 min-w-0">
            ${pulse("h-10 w-10 shrink-0 rounded-xl")}
            <div class="flex-1 min-w-0 space-y-1.5">
              <div class="flex items-center gap-2.5">
                ${pulse("h-5 w-56 max-w-[48vw]")}
                ${pulse("h-4 w-16 rounded-full")}
              </div>
              <div class="hidden sm:flex items-center gap-2">
                ${pulseBlocks(["h-3 w-20", "h-3 w-24", "h-3 w-20"])}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${pulse("hidden sm:block h-5 w-20 rounded-full")}
            ${pulse("h-7 w-28")}
          </div>
        </div>
      </div>
      <div class="mx-auto w-full max-w-6xl px-4 pb-2">
        <div class="flex items-stretch gap-1">
          ${repeat(5, () => pulse("h-6 flex-1 max-w-[150px]"))}
        </div>
      </div>
      <div class="h-px bg-border"></div>
    </header>`,
  `${tabs(["w-20", "w-18", "w-18", "w-16", "w-14"])}

      <div class="mt-4 space-y-3">
        ${card(
          `<div class="grid gap-2 sm:grid-cols-3">
                ${repeat(3, metricTile)}
              </div>`,
          "w-24"
        )}
        <div class="grid gap-3 md:grid-cols-2">
          ${card(pulseBlocks(["h-3 w-4/5", "h-3 w-3/5", "h-3 w-2/3"]), "w-28")}
          ${card(pulseBlocks(["h-3 w-3/4", "h-3 w-1/2", "h-3 w-2/3"]), "w-24")}
        </div>
      </div>`
);

const NODE_LOADING_SKELETON = pageShell(
  `
    <header class="border-b border-border">
      ${PROGRESS_BAR}
      <div class="mx-auto max-w-6xl px-4 pt-4 pb-3 space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            ${pulse("h-10 w-10 shrink-0")}
            <div class="min-w-0 space-y-1.5">
              ${pulse("h-2.5 w-28")}
              <div class="flex items-center gap-2">
                ${pulse("h-5 w-44 max-w-[44vw]")}
                ${pulse("h-4 w-14 rounded-full")}
              </div>
              ${pulse("h-3 w-32")}
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            ${pulseBlocks(["h-7 w-20", "h-7 w-28", "h-7 w-24"])}
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          ${pulseBlocks(["h-4 w-14", "h-4 w-14"])}
          ${pulse("h-2 w-full max-w-[280px] min-w-[140px] flex-1 rounded-full")}
        </div>
      </div>
    </header>`,
  `${tabs(["w-20", "w-24", "w-16", "w-24"])}

      <div class="mt-4 grid gap-3 md:grid-cols-2 md:items-start">
        <div class="space-y-3">
          ${card(
            `<div class="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-4 gap-y-2.5">
                ${repeat(
                  2,
                  () => `<div class="flex items-center gap-2.5">
                  ${pulse("h-7 w-7")}
                  <div class="space-y-1">${pulseBlocks(["h-2.5 w-14", "h-3 w-20"])}</div>
                </div>`
                )}
              </div>`,
            "w-14"
          )}
          ${card(
            `<div class="flex flex-wrap gap-1.5">
                ${pulseBlocks(["h-5 w-14 rounded-full", "h-5 w-16 rounded-full", "h-5 w-12 rounded-full"])}
              </div>`,
            "w-14"
          )}
        </div>
        <div class="space-y-3">
          ${card(
            `<div class="flex flex-wrap gap-1">
                ${repeat(4, () => pulse("h-[18px] w-[18px]"))}
              </div>`,
            "w-18"
          )}
          ${card(pulseBlocks(["h-3 w-3/4", "h-3 w-1/2"]), "w-16")}
        </div>
      </div>`
);

const CAPACITY_LOADING_SKELETON = pageShell(
  panelHeader(`${pulse("hidden sm:block h-3 w-28")}
          ${pulse("h-7 w-20")}`),
  `
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        ${repeat(
          6,
          () => `
        <div class="rounded-lg border border-border bg-card px-3 py-2.5 space-y-1.5">
          ${pulseBlocks(["h-7 w-10", "h-2.5 w-20", "h-2.5 w-28 max-w-full"])}
        </div>`
        )}
      </div>

      <div class="space-y-3">
        ${repeat(
          3,
          () => `
        <div class="rounded-lg border border-border bg-card px-4 py-3">
          <div class="grid gap-3 lg:grid-cols-6 lg:items-center">
            <div class="flex min-w-0 items-start gap-2 lg:col-span-2">
              ${pulse("mt-0.5 h-4 w-4 shrink-0")}
              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex items-center gap-2">
                  ${pulseBlocks(["h-4 w-24", "h-4 w-16 rounded-full"])}
                </div>
                ${pulseBlocks(["h-3 w-48 max-w-full", "h-1.5 w-full max-w-64 rounded-full"])}
              </div>
            </div>
            ${repeat(4, () => pulse("hidden lg:block h-12 rounded-md"))}
          </div>
        </div>`
        )}
      </div>`,
  "space-y-4 py-4"
);

const COMPARE_LOADING_SKELETON = pageShell(
  panelHeader(pulse("h-7 w-20")),
  `
      <div class="grid gap-3 sm:grid-cols-2">
        ${repeat(
          2,
          () => `
        <div class="rounded-lg border border-card-border bg-card p-3 space-y-2">
          <div class="flex items-center gap-2">
            ${pulseBlocks(["h-5 w-5 rounded-full", "h-4 w-32", "h-4 w-14 rounded-full"])}
          </div>
          ${pulseBlocks(["h-3 w-40", "h-3 w-28"])}
        </div>`
        )}
      </div>

      <div class="flex flex-wrap items-center gap-2">
        ${pulseBlocks(["h-6 w-24 rounded-full", "h-6 w-20 rounded-full", "h-6 w-28 rounded-full", "h-6 w-20 rounded-full"])}
      </div>

      <div class="space-y-3">
        ${repeat(
          3,
          () => `
        <div class="rounded-lg border border-card-border bg-card p-3 space-y-2">
          <div class="flex items-center gap-2">
            ${pulseBlocks(["h-4 w-4 rounded-sm", "h-4 w-36"])}
          </div>
          ${pulseBlocks(["h-3 w-3/4 ml-6", "h-3 w-1/2 ml-6"])}
        </div>`
        )}
      </div>`,
  "space-y-4 py-4"
);

const LOADING_SKELETONS: Record<LoadingSkeletonVariant, string> = {
  build: BUILD_LOADING_SKELETON,
  node: NODE_LOADING_SKELETON,
  capacity: CAPACITY_LOADING_SKELETON,
  compare: COMPARE_LOADING_SKELETON
};

export function renderLoadingSkeletonHtml(variant: LoadingSkeletonVariant): string {
  return LOADING_SKELETONS[variant] ?? BUILD_LOADING_SKELETON;
}
