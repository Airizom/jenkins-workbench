import * as React from "react";
import { getResultBadgeClass } from "../../../../../shared/webview/components/ResultBadge";
import { Button } from "../../../../../shared/webview/components/ui/button";
import { MinusIcon, PlusIcon } from "../../../../../shared/webview/icons";
import { resolveBuildResultStyle } from "../../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../../shared/webview/lib/utils";
import { getStageIcon } from "../pipelineStages/PipelineStageIcons";
import { formatCount } from "../pipelineStages/pipelineStagesUtils";
import type { PipelineGraphLayoutNode, PipelineGraphLayoutResult } from "./pipelineGraphTypes";
import {
  clampZoomScale,
  createFittedViewport,
  recenterViewportOnResize,
  resolveCanvasHeight,
  revealRectInViewport,
  type ViewportContainerSize,
  type ViewportRect,
  type ViewportState
} from "./pipelineGraphViewport";

const { memo, useCallback, useEffect, useMemo, useRef, useState } = React;

const KEYBOARD_PAN_STEP = 40;

// The foreignObject clips anything drawn outside the node, so the focus
// outline sits inside the border; the selection ring (styles.css) hugs it.
const STAGE_NODE_BUTTON_BASE_CLASS =
  "flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card text-left " +
  "transition duration-150 motion-reduce:transition-none " +
  "hover:-translate-y-0.5 hover:shadow-lg motion-reduce:hover:translate-y-0 " +
  "focus-visible:outline-2 focus-visible:-outline-offset-5 focus-visible:outline-ring";

const IS_MAC_PLATFORM = /Mac|iPhone|iPad/i.test(
  typeof navigator === "undefined" ? "" : navigator.platform
);
const ZOOM_HINT = IS_MAC_PLATFORM ? "⌘ + scroll to zoom" : "Ctrl + scroll to zoom";

export function PipelineGraphCanvas({
  layout,
  selectedStageKey,
  onSelectStage
}: {
  layout: PipelineGraphLayoutResult;
  selectedStageKey?: string;
  onSelectStage: (stageKey: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef(layout);
  const hasAutoFittedRef = useRef(false);
  // Once the user zooms, pans, or fits explicitly, resizes keep their viewport.
  const userAdjustedViewportRef = useRef(false);
  const [viewport, setViewport] = useState<ViewportState>({ scale: 1, x: 0, y: 0 });
  const adjustViewport = useCallback(
    (next: ViewportState | ((current: ViewportState) => ViewportState)) => {
      userAdjustedViewportRef.current = true;
      setViewport(next);
    },
    []
  );
  const [isPanning, setIsPanning] = useState(false);
  const panStateRef = useRef<{ pointerId: number; x: number; y: number } | undefined>(undefined);

  // Keep a stable node-selection callback so memoized stage nodes skip
  // re-renders even when the caller passes a fresh handler each render.
  const onSelectStageRef = useRef(onSelectStage);
  const handleNodeSelect = useCallback((stageKey: string) => {
    onSelectStageRef.current(stageKey);
  }, []);

  // Keyboard focus on a node outside the visible canvas pans it into view.
  const handleNodeFocus = useCallback((node: PipelineGraphLayoutNode) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    setViewport((current) => revealRectInViewport(current, node, container));
  }, []);

  const { x, y, width, height } =
    (selectedStageKey
      ? layout.nodes.find((candidate) => candidate.id === selectedStageKey)
      : undefined) ?? {};
  // Automatic fits pan the selected stage into view; a graph wider than the
  // canvas at the readable zoom would otherwise open away from it.
  const selectedRectRef = useRef<ViewportRect | undefined>(undefined);
  useEffect(() => {
    selectedRectRef.current =
      x === undefined || y === undefined || width === undefined || height === undefined
        ? undefined
        : { x, y, width, height };
  }, [x, y, width, height]);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    onSelectStageRef.current = onSelectStage;
  }, [onSelectStage]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const readSize = (): ViewportContainerSize => ({
      clientWidth: container.clientWidth,
      clientHeight: container.clientHeight
    });
    const fitToContainer = (size: ViewportContainerSize): ViewportState => {
      const fitted = createFittedViewport(layoutRef.current, size);
      const selectedRect = selectedRectRef.current;
      return selectedRect ? revealRectInViewport(fitted, selectedRect, size) : fitted;
    };
    let containerSize = readSize();
    const observer = new ResizeObserver(() => {
      const previousSize = containerSize;
      const nextSize = readSize();
      containerSize = nextSize;
      if (!userAdjustedViewportRef.current) {
        setViewport(fitToContainer(nextSize));
        return;
      }
      setViewport((current) => recenterViewportOnResize(current, previousSize, nextSize));
    });
    observer.observe(container);
    if (!hasAutoFittedRef.current) {
      setViewport(fitToContainer(containerSize));
      hasAutoFittedRef.current = true;
    }

    return () => observer.disconnect();
  }, []);

  // Reveal selection when it changes or its geometry arrives from a relayout.
  // Status-only updates should preserve the user's pan.
  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined
    ) {
      return;
    }
    setViewport((current) => revealRectInViewport(current, { x, y, width, height }, container));
  }, [selectedStageKey, x, y, width, height]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // Native listener: React wheel handlers are passive, so preventDefault
    // would be ignored. Plain wheel scrolls the page; Ctrl/Cmd (including
    // trackpad pinch, which browsers report with ctrlKey) zooms.
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      adjustViewport((current) => {
        const nextScale = clampZoomScale(
          current.scale,
          current.scale * (event.deltaY < 0 ? 1.1 : 0.92)
        );
        const ratio = nextScale / current.scale;
        return {
          scale: nextScale,
          x: pointerX - (pointerX - current.x) * ratio,
          y: pointerY - (pointerY - current.y) * ratio
        };
      });
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [adjustViewport]);

  const zoomBy = (factor: number) => {
    adjustViewport((current) => ({
      ...current,
      scale: clampZoomScale(current.scale, current.scale * factor)
    }));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    const pan = (deltaX: number, deltaY: number) => {
      adjustViewport((current) => ({
        ...current,
        x: current.x + deltaX,
        y: current.y + deltaY
      }));
    };
    switch (event.key) {
      case "ArrowLeft":
        pan(KEYBOARD_PAN_STEP, 0);
        break;
      case "ArrowRight":
        pan(-KEYBOARD_PAN_STEP, 0);
        break;
      case "ArrowUp":
        pan(0, KEYBOARD_PAN_STEP);
        break;
      case "ArrowDown":
        pan(0, -KEYBOARD_PAN_STEP);
        break;
      case "+":
      case "=":
        zoomBy(1.1);
        break;
      case "-":
      case "_":
        zoomBy(0.9);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("[data-stage-node='true']")) {
      return;
    }

    panStateRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const panState = panStateRef.current;
    if (!panState || panState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - panState.x;
    const deltaY = event.clientY - panState.y;
    panStateRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    adjustViewport((current) => ({
      ...current,
      x: current.x + deltaX,
      y: current.y + deltaY
    }));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panStateRef.current?.pointerId === event.pointerId) {
      panStateRef.current = undefined;
      setIsPanning(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // Edge geometry only changes with the layout, so keep the elements stable
  // across pan/zoom/selection re-renders and let React skip reconciling them.
  const edgePaths = useMemo(
    () =>
      layout.edges.map((edge) => (
        <path
          key={edge.id}
          d={edge.path}
          fill="none"
          stroke={EDGE_STROKE_COLORS[edge.kind]}
          strokeWidth={edge.kind === "parallel" ? 2.4 : 1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={edge.kind === "join" ? 0.68 : 0.84}
        />
      )),
    [layout.edges]
  );

  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-raised px-3 py-2">
        <div>
          <div className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            Pipeline graph
          </div>
          <div className="text-xs text-muted-foreground">
            Drag or use arrow keys to pan. Selection syncs the inspector.
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 hidden text-caption text-muted-foreground sm:inline">
            {ZOOM_HINT}
          </span>
          <Button variant="outline" size="sm" aria-label="Zoom out" onClick={() => zoomBy(0.9)}>
            <MinusIcon className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" aria-label="Zoom in" onClick={() => zoomBy(1.1)}>
            <PlusIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const container = containerRef.current;
              if (!container) {
                return;
              }
              adjustViewport(createFittedViewport(layout, container, { allowBelowMinimum: true }));
            }}
          >
            Fit
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        role="application"
        aria-label="Pipeline graph. Arrow keys pan, plus and minus zoom."
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the canvas must be keyboard-focusable so arrow keys can pan and +/- can zoom without a pointer
        tabIndex={0}
        className="pipeline-graph-canvas relative max-h-90 overflow-hidden bg-surface-sunken focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:max-h-110"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ cursor: isPanning ? "grabbing" : "grab", height: resolveCanvasHeight(layout) }}
      >
        <svg className="h-full w-full">
          <title>Pipeline stage graph</title>
          <defs>
            <pattern id="pipeline-grid" width="36" height="36" patternUnits="userSpaceOnUse">
              <path
                d="M 36 0 L 0 0 0 36"
                fill="none"
                stroke="color-mix(in srgb, var(--border) 60%, transparent)"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect x="0" y="0" width="100%" height="100%" fill="url(#pipeline-grid)" opacity="0.35" />
          <g
            transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.scale})`}
            style={{ transformOrigin: "0 0" }}
          >
            {edgePaths}
            {layout.nodes.map((node) => (
              <PipelineGraphStageNode
                key={node.id}
                node={node}
                selected={selectedStageKey === node.id}
                onSelect={handleNodeSelect}
                onKeyboardFocus={handleNodeFocus}
              />
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}

const PipelineGraphStageNode = memo(function PipelineGraphStageNode({
  node,
  selected,
  onSelect,
  onKeyboardFocus
}: {
  node: PipelineGraphLayoutNode;
  selected: boolean;
  onSelect: (stageKey: string) => void;
  onKeyboardFocus: (node: PipelineGraphLayoutNode) => void;
}) {
  const statusClass = getResultBadgeClass(node.stage.statusClass);
  const statusIcon = getStageIcon(node.stage.statusClass);
  const branchCount = node.stage.parallelBranches.length;
  const stepCount = node.stage.stepsAll.length;
  const accentWidth = Math.round(28 + node.durationRatio * 72);
  const { borderColor, graphBackground: background } = resolveBuildResultStyle(
    node.stage.statusClass
  );

  return (
    <foreignObject
      x={node.x}
      y={node.y}
      width={node.width}
      height={node.height}
      requiredExtensions="http://www.w3.org/1999/xhtml"
    >
      <div className="h-full w-full" data-stage-node="true">
        <button
          type="button"
          aria-pressed={selected}
          className={cn(
            STAGE_NODE_BUTTON_BASE_CLASS,
            selected ? "pipeline-graph-node--selected" : "shadow-sm"
          )}
          style={{
            borderColor,
            background
          }}
          onClick={() => onSelect(node.id)}
          onFocus={(event) => {
            if (event.currentTarget.matches(":focus-visible")) {
              onKeyboardFocus(node);
            }
          }}
        >
          {/* Neutral so it never reads as progress or as the running (blue) state. */}
          <div
            aria-hidden="true"
            className="h-1 rounded-full bg-muted-foreground/35"
            style={{ width: `${accentWidth}%` }}
            title={`Duration relative to the longest stage${
              node.stage.durationLabel ? ` (${node.stage.durationLabel})` : ""
            }`}
          />
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div
                  className="truncate text-xs font-semibold text-foreground"
                  title={node.stage.name || undefined}
                >
                  {node.stage.name || "Stage"}
                </div>
                <div className="truncate text-caption text-muted-foreground">
                  {node.stage.durationLabel || "Unknown"}
                </div>
              </div>
              <div
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${statusClass}`}
              >
                {statusIcon}
              </div>
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 text-caption">
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${statusClass}`}
              >
                {node.stage.statusLabel || "Unknown"}
              </span>
              <span className="truncate text-muted-foreground">
                {branchCount > 0
                  ? formatCount(branchCount, "branch", "branches")
                  : formatCount(stepCount, "step")}
              </span>
            </div>
          </div>
        </button>
      </div>
    </foreignObject>
  );
});

const EDGE_STROKE_COLORS: Record<"sequential" | "parallel" | "join", string> = {
  sequential: "color-mix(in srgb, var(--foreground) 18%, var(--border))",
  parallel: "color-mix(in srgb, var(--primary) 55%, var(--border))",
  join: "color-mix(in srgb, var(--foreground) 28%, var(--border))"
};
