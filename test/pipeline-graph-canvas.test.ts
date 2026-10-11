import assert from "node:assert/strict";
import * as React from "react";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { PipelineStageViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { buildPipelineGraphModel } from "../src/panels/buildDetails/webview/components/buildDetails/pipelineGraph/pipelineGraphModel";
import type {
  PipelineGraphLayoutNode,
  PipelineGraphLayoutResult
} from "../src/panels/buildDetails/webview/components/buildDetails/pipelineGraph/pipelineGraphTypes";

const container = {
  clientWidth: 400,
  clientHeight: 300,
  addEventListener: () => undefined,
  removeEventListener: () => undefined
};
const slots: unknown[] = [];
const effects: Array<{ deps: readonly unknown[]; cleanup?: () => void }> = [];
let pendingEffects: Array<() => void> = [];
let slotCursor = 0;
let effectCursor = 0;
let dirty = false;

// Drive the canvas with persistent state/refs and dependency-gated effects,
// attaching its container ref before effects run, without adding a DOM dependency.
vi.doMock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useCallback: <T>(callback: T): T => callback,
  useMemo: <T>(factory: () => T): T => factory(),
  useRef<T>(current: T) {
    const index = slotCursor++;
    if (!(index in slots)) {
      slots[index] = { current };
    }
    return slots[index] as { current: T };
  },
  useState<T>(initial: T) {
    const index = slotCursor++;
    if (!(index in slots)) {
      slots[index] = initial;
    }
    return [
      slots[index] as T,
      (next: T | ((previous: T) => T)) => {
        const previous = slots[index] as T;
        slots[index] = typeof next === "function" ? (next as (value: T) => T)(previous) : next;
        dirty ||= !Object.is(previous, slots[index]);
      }
    ];
  },
  useEffect(effect: () => undefined | (() => void), deps: readonly unknown[]) {
    const index = effectCursor++;
    const previous = effects[index];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) {
      return;
    }
    pendingEffects.push(() => {
      previous?.cleanup?.();
      effects[index] = { deps, cleanup: effect() ?? undefined };
    });
  }
}));

const { PipelineGraphCanvas } = await import(
  "../src/panels/buildDetails/webview/components/buildDetails/pipelineGraph/PipelineGraphCanvas"
);

type ElementProps = {
  children?: React.ReactNode;
  role?: string;
  ref?: { current: unknown };
  transform?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
};

function findElement(tree: React.ReactNode, type: string): React.ReactElement<ElementProps> {
  for (const child of React.Children.toArray(tree)) {
    if (!React.isValidElement<ElementProps>(child)) {
      continue;
    }
    if (child.type === type || child.props.role === type) {
      return child;
    }
    if (child.props.children) {
      const found = findElementOrUndefined(child.props.children, type);
      if (found) {
        return found;
      }
    }
  }
  throw new Error(`Missing element: ${type}`);
}

function findElementOrUndefined(tree: React.ReactNode, type: string) {
  try {
    return findElement(tree, type);
  } catch {
    return undefined;
  }
}

function render(layout: PipelineGraphLayoutResult, selectedStageKey: string) {
  let tree: React.ReactElement;
  do {
    dirty = false;
    slotCursor = 0;
    effectCursor = 0;
    tree = PipelineGraphCanvas({ layout, selectedStageKey, onSelectStage: () => undefined });
    const ref = findElement(tree, "application").props.ref;
    assert.ok(ref);
    ref.current = container;
    const pending = pendingEffects;
    pendingEffects = [];
    for (const effect of pending) {
      effect();
    }
  } while (dirty);
  return tree;
}

function makeLayout(positions: Array<{ id: string; x: number; y: number }>) {
  const stages: PipelineStageViewModel[] = positions.map(({ id }) => ({
    key: id,
    name: id,
    statusLabel: "Success",
    statusClass: "success",
    durationLabel: "1s",
    canRestartFromStage: false,
    hasSteps: false,
    stepsFailedOnly: [],
    stepsAll: [],
    parallelBranches: [],
    canOpenLog: false
  }));
  const model = buildPipelineGraphModel(stages);
  return {
    width: 600,
    height: 200,
    model,
    nodes: model.nodes.map((node, index) => ({ ...node, ...positions[index] })),
    edges: []
  } satisfies PipelineGraphLayoutResult;
}

function assertVisible(tree: React.ReactElement, node: PipelineGraphLayoutNode) {
  const transform = findElement(tree, "g").props.transform;
  const values = transform?.match(/-?[\d.]+/g)?.map(Number);
  assert.ok(values);
  const [x, y, scale] = values;
  assert.ok(x + node.x * scale >= 24 - 1e-9);
  assert.ok(y + node.y * scale >= 24 - 1e-9);
  assert.ok(x + (node.x + node.width) * scale <= container.clientWidth - 24 + 1e-9);
  assert.ok(y + (node.y + node.height) * scale <= container.clientHeight - 24 + 1e-9);
  return scale;
}

beforeEach(() => {
  slots.length = 0;
  effects.length = 0;
  pendingEffects = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  for (const effect of effects) {
    effect.cleanup?.();
  }
  vi.unstubAllGlobals();
});

describe("PipelineGraphCanvas selection visibility", () => {
  it("reveals a selected stage when its replacement layout arrives", () => {
    const oldLayout = makeLayout([{ id: "old", x: 28, y: 28 }]);
    render(oldLayout, "old");
    const waiting = render(oldLayout, "new");
    const replacement = makeLayout([
      { id: "old", x: 28, y: 28 },
      { id: "new", x: 2000, y: 1000 }
    ]);

    const ready = render(replacement, "new");

    assertVisible(ready, replacement.nodes[1]);
    assert.notEqual(
      findElement(ready, "g").props.transform,
      findElement(waiting, "g").props.transform
    );
  });

  it("reveals an existing selected stage moved by a relayout without changing zoom", () => {
    const initial = makeLayout([{ id: "selected", x: 28, y: 28 }]);
    const scale = assertVisible(render(initial, "selected"), initial.nodes[0]);
    const moved = makeLayout([{ id: "selected", x: 2000, y: 1000 }]);

    assert.equal(assertVisible(render(moved, "selected"), moved.nodes[0]), scale);
  });

  it("preserves manual panning when a refresh only updates stage data", () => {
    const layout = makeLayout([{ id: "selected", x: 28, y: 28 }]);
    const canvas = findElement(render(layout, "selected"), "application");
    canvas.props.onKeyDown?.({
      key: "ArrowRight",
      target: container,
      currentTarget: container,
      preventDefault: () => undefined
    } as unknown as React.KeyboardEvent<HTMLDivElement>);
    const panned = render(layout, "selected");
    const refreshed = makeLayout([{ id: "selected", x: 28, y: 28 }]);
    refreshed.nodes[0].stage.statusLabel = "Running";

    assert.equal(
      findElement(render(refreshed, "selected"), "g").props.transform,
      findElement(panned, "g").props.transform
    );
  });
});
