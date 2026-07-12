import * as React from "react";
import { getResultBadgeClass } from "../../../../../shared/webview/components/ResultBadge";
import { Button } from "../../../../../shared/webview/components/ui/button";
import { MinusIcon, PlusIcon } from "../../../../../shared/webview/icons";
import {
  resolveBuildResultBorderColor,
  resolveBuildResultGraphBackground
} from "../../../../../shared/webview/lib/statusStyles";
import { getStageIcon } from "../pipelineStages/PipelineStageIcons";
import type { PipelineGraphLayoutNode, PipelineGraphLayoutResult } from "./pipelineGraphTypes";

const { useEffect, useRef, useState } = React;

const CANVAS_PADDING = 40;
const MIN_SCALE = 0.45;
const MAX_SCALE = 1.85;
const KEYBOARD_PAN_STEP = 40;

const IS_MAC_PLATFORM = /Mac|iPhone|iPad/i.test(
  typeof navigator === "undefined" ? "" : navigator.platform
);
const ZOOM_HINT = IS_MAC_PLATFORM ? "⌘ + scroll to zoom" : "Ctrl + scroll to zoom";

interface ViewportState {
  scale: number;
  x: number;
  y: number;
}
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
  const [hoveredStageKey, setHoveredStageKey] = useState<string | undefined>();
  const [viewport, setViewport] = useState<ViewportState>({ scale: 1, x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStateRef = useRef<{ pointerId: number; x: number; y: number } | undefined>();

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setViewport(createFittedViewport(layoutRef.current, container));
    });
    observer.observe(container);
    if (!hasAutoFittedRef.current) {
      setViewport(createFittedViewport(layoutRef.current, container));
      hasAutoFittedRef.current = true;
    }

    return () => observer.disconnect();
  }, []);

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
      setViewport((current) => {
        const nextScale = clamp(
          current.scale * (event.deltaY < 0 ? 1.1 : 0.92),
          MIN_SCALE,
          MAX_SCALE
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
  }, []);

  const zoomBy = (factor: number) => {
    setViewport((current) => ({
      ...current,
      scale: clamp(current.scale * factor, MIN_SCALE, MAX_SCALE)
    }));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    const pan = (deltaX: number, deltaY: number) => {
      setViewport((current) => ({
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
    setViewport((current) => ({
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

  return (
    <div className="rounded-lg border border-card-border bg-card shadow-widget">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Pipeline Graph
          </div>
          <div className="text-xs text-muted-foreground">
            Drag or use arrow keys to pan. Selection syncs the inspector.
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 hidden text-[11px] text-muted-foreground sm:inline">
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
              setViewport(createFittedViewport(layout, container));
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
        className="relative h-[360px] overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--accent)_12%,transparent),transparent_38%),linear-gradient(180deg,color-mix(in_srgb,var(--muted)_75%,transparent),transparent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring md:h-[440px]"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ cursor: isPanning ? "grabbing" : "grab" }}
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
            {layout.edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.path}
                fill="none"
                stroke={resolveEdgeColor(edge.kind)}
                strokeWidth={edge.kind === "parallel" ? 2.4 : 1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={edge.kind === "join" ? 0.68 : 0.84}
              />
            ))}
            {layout.nodes.map((node) => (
              <PipelineGraphStageNode
                key={node.id}
                node={node}
                selected={selectedStageKey === node.id}
                hovered={hoveredStageKey === node.id}
                onHoverChange={setHoveredStageKey}
                onSelect={onSelectStage}
              />
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}

function PipelineGraphStageNode({
  node,
  selected,
  hovered,
  onHoverChange,
  onSelect
}: {
  node: PipelineGraphLayoutNode;
  selected: boolean;
  hovered: boolean;
  onHoverChange: (stageKey?: string) => void;
  onSelect: (stageKey: string) => void;
}) {
  const statusClass = getResultBadgeClass(node.stage.statusClass);
  const statusIcon = getStageIcon(node.stage.statusClass);
  const branchCount = node.stage.parallelBranches.length;
  const stepCount = node.stage.stepsAll.length;
  const accentWidth = Math.round(28 + node.durationRatio * 72);
  const borderColor = resolveBuildResultBorderColor(node.stage.statusClass);
  const background = resolveBuildResultGraphBackground(node.stage.statusClass);
  const strokeWidth = selected ? 2.4 : hovered ? 1.8 : 1.4;

  return (
    <foreignObject
      x={node.x}
      y={node.y}
      width={node.width}
      height={node.height}
      requiredExtensions="http://www.w3.org/1999/xhtml"
    >
      <div
        className="h-full w-full"
        data-stage-node="true"
        onMouseEnter={() => onHoverChange(node.id)}
        onMouseLeave={() => onHoverChange(undefined)}
      >
        <button
          type="button"
          className="flex h-full w-full flex-col overflow-hidden rounded-[18px] border bg-card text-left shadow-widget transition-transform duration-150 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          style={{
            borderColor,
            background,
            borderWidth: `${strokeWidth}px`
          }}
          onClick={() => onSelect(node.id)}
        >
          <div
            className="h-[4px] rounded-full bg-[linear-gradient(90deg,var(--primary),color-mix(in_srgb,var(--primary)_40%,transparent))]"
            style={{ width: `${accentWidth}%` }}
          />
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-foreground">
                  {node.stage.name || "Stage"}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {node.stage.durationLabel || "Unknown"}
                </div>
              </div>
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] ${statusClass}`}
              >
                {statusIcon}
              </div>
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 text-[11px]">
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 font-semibold ${statusClass}`}
              >
                {node.stage.statusLabel || "Unknown"}
              </span>
              <span className="truncate text-muted-foreground">
                {branchCount > 0 ? `${branchCount} branches` : `${stepCount} steps`}
              </span>
            </div>
          </div>
        </button>
      </div>
    </foreignObject>
  );
}

function createFittedViewport(
  layout: PipelineGraphLayoutResult,
  container: HTMLDivElement
): ViewportState {
  if (layout.width <= 0 || layout.height <= 0) {
    return { scale: 1, x: CANVAS_PADDING, y: CANVAS_PADDING };
  }

  const width = Math.max(container.clientWidth - CANVAS_PADDING * 2, 1);
  const height = Math.max(container.clientHeight - CANVAS_PADDING * 2, 1);
  const scale = clamp(Math.min(width / layout.width, height / layout.height, 1), MIN_SCALE, 1.15);
  const x = (container.clientWidth - layout.width * scale) / 2;
  const y = (container.clientHeight - layout.height * scale) / 2;
  return { scale, x, y };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveEdgeColor(kind: "sequential" | "parallel" | "join"): string {
  switch (kind) {
    case "parallel":
      return "color-mix(in srgb, var(--primary) 55%, var(--border))";
    case "join":
      return "color-mix(in srgb, var(--foreground) 28%, var(--border))";
    default:
      return "color-mix(in srgb, var(--foreground) 18%, var(--border))";
  }
}
