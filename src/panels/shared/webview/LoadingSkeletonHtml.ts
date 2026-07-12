export type LoadingSkeletonVariant = "build" | "node";

function pulse(className: string): string {
  return `<div class="animate-pulse ${className}"></div>`;
}

function pulseBlocks(blocks: string[]): string {
  return blocks.map((className) => pulse(className)).join("\n");
}

function tabs(widths: string[]): string {
  return `
      <div class="border-b border-border">
        <div class="flex w-full flex-nowrap items-center gap-1 py-1">
          ${pulseBlocks(widths.map((width) => `rounded bg-muted h-6 ${width}`))}
        </div>
      </div>`;
}

function headerShell(content: string): string {
  return `
    <header class="sticky-header">
      <div class="h-px w-full overflow-hidden bg-muted">
        <div class="h-full w-1/3 animate-progress-indeterminate bg-progress rounded-full"></div>
      </div>
      <div class="mx-auto max-w-6xl px-4 py-2.5">
        ${content}
      </div>
      <div class="h-px bg-border"></div>
    </header>`;
}

function pageShell(header: string, content: string): string {
  return `
  <div class="min-h-screen flex flex-col bg-background text-foreground">
    ${header}

    <main class="flex-1 mx-auto w-full max-w-6xl px-4 py-3">
      ${content}
    </main>
  </div>
`;
}

function buildMetricCard(): string {
  return `
            <div class="rounded border border-mutedBorder bg-muted-soft px-3 py-2">
              ${pulse("rounded bg-muted h-2.5 w-16 mb-2")}
              ${pulse("rounded bg-muted h-3 w-20")}
            </div>`;
}

function nodeMetricCard(): string {
  return `
          <div class="flex items-center gap-2.5 rounded border border-mutedBorder bg-muted-soft px-3 py-2">
            ${pulse("rounded bg-muted h-7 w-7")}
            <div class="space-y-1">
              ${pulse("rounded bg-muted h-2.5 w-14")}
              ${pulse("rounded bg-muted h-3 w-20")}
            </div>
          </div>`;
}

function nodeUsageRow(): string {
  return `
            <div class="rounded border border-border bg-muted-soft px-3 py-2">
              <div class="flex items-center justify-between gap-3">
                ${pulse("rounded bg-muted h-3 w-16")}
                ${pulse("rounded bg-muted h-3 w-20")}
              </div>
              ${pulse("rounded bg-muted h-1.5 w-full mt-2")}
            </div>`;
}

const BUILD_LOADING_SKELETON = pageShell(
  headerShell(`
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            ${pulse("rounded-sm bg-muted h-4 w-4")}
            ${pulse("rounded bg-muted h-4 w-44 max-w-[48vw]")}
            ${pulse("rounded-full bg-muted h-4 w-16")}
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="hidden sm:flex items-center gap-2">
              ${pulseBlocks([
                "rounded bg-muted h-3 w-20",
                "rounded bg-muted h-3 w-24",
                "rounded bg-muted h-3 w-20"
              ])}
            </div>
            ${pulse("rounded bg-muted h-7 w-18")}
          </div>
        </div>
        <div class="sm:hidden flex items-center gap-2 mt-1.5">
          ${pulseBlocks(["rounded bg-muted h-3 w-20", "rounded bg-muted h-3 w-20"])}
        </div>`),
  `${tabs(["w-16", "w-18", "w-16", "w-20"])}

      <div class="mt-5 space-y-3">
        <div class="rounded border border-border bg-card p-3 space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              ${pulse("rounded-sm bg-muted h-4 w-4")}
              ${pulse("rounded bg-muted h-3 w-36")}
            </div>
            <div class="flex items-center gap-1.5">
              ${pulseBlocks([
                "rounded bg-muted h-7 w-18",
                "rounded bg-muted h-7 w-18",
                "rounded bg-muted h-5 w-14"
              ])}
            </div>
          </div>
          <div class="rounded border border-border bg-terminal px-3 py-2 space-y-2">
            ${pulseBlocks([
              "rounded bg-muted h-3 w-4/5",
              "rounded bg-muted h-3 w-3/5",
              "rounded bg-muted h-3 w-[72%]",
              "rounded bg-muted h-3 w-[58%]",
              "rounded bg-muted h-3 w-[66%]",
              "rounded bg-muted h-3 w-[46%]",
              "rounded bg-muted h-3 w-[80%]"
            ])}
          </div>
        </div>

        <div class="rounded border border-border bg-card p-3">
          <div class="flex items-center gap-2 mb-2">
            ${pulse("rounded-sm bg-muted h-4 w-4")}
            ${pulse("rounded bg-muted h-3 w-24")}
          </div>
          <div class="grid gap-2 sm:grid-cols-3">
            ${Array.from({ length: 3 }, buildMetricCard).join("\n")}
          </div>
        </div>
      </div>`
);

const NODE_LOADING_SKELETON = pageShell(
  headerShell(`
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5 min-w-0">
            ${pulse("rounded bg-muted h-7 w-7")}
            <div class="min-w-0 space-y-1.5">
              <div class="flex items-center gap-2">
                ${pulse("rounded bg-muted h-4 w-40 max-w-[44vw]")}
                ${pulse("rounded-full bg-muted h-4 w-14")}
              </div>
              <div class="flex items-center gap-2">
                ${pulseBlocks([
                  "rounded bg-muted h-3 w-20",
                  "rounded bg-muted h-3 w-24",
                  "rounded bg-muted h-3 w-20"
                ])}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            ${pulseBlocks([
              "rounded bg-muted h-7 w-7",
              "rounded bg-muted h-7 w-24",
              "rounded bg-muted h-7 w-18"
            ])}
          </div>
        </div>`),
  `${tabs(["w-18", "w-18", "w-14", "w-18"])}

      <div class="mt-5 space-y-3">
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          ${Array.from({ length: 6 }, nodeMetricCard).join("\n")}
        </div>

        <div class="rounded border border-border bg-card overflow-hidden">
          <div class="flex items-center justify-between px-3 py-2 border-b border-border bg-muted-soft">
            <div class="flex items-center gap-2">
              ${pulse("rounded-sm bg-muted h-4 w-4")}
              ${pulse("rounded bg-muted h-3 w-20")}
            </div>
            ${pulse("rounded bg-muted h-6 w-16")}
          </div>
          <div class="p-3 space-y-2">
            ${Array.from({ length: 3 }, nodeUsageRow).join("\n")}
          </div>
        </div>
      </div>`
);

export function renderLoadingSkeletonHtml(variant: LoadingSkeletonVariant): string {
  return variant === "node" ? NODE_LOADING_SKELETON : BUILD_LOADING_SKELETON;
}
