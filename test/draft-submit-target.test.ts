import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";
import type { DraftDocumentManager } from "../src/services/DraftDocumentManager";
import * as vscodeStub from "./helpers/vscodeStub";

type UriLike = { toString(): string };

const informationMessages: string[] = [];
let quickPickIndex: number | undefined;
const showQuickPick = vi.fn(async (items: unknown[], _options?: unknown) =>
  quickPickIndex === undefined ? undefined : items[quickPickIndex]
);

vi.doMock("vscode", () => ({
  ...vscodeStub,
  window: {
    showInformationMessage: async (message: string) => {
      informationMessages.push(message);
      return undefined;
    },
    showQuickPick
  }
}));

const { resolveDraftForSubmit } = await import("../src/services/DraftSubmitTarget");
type Manager = DraftDocumentManager<{ label: string }>;

const messages = {
  noDraft: "Open a draft to submit.",
  notDraft: "This document is not a draft.",
  pickDescription: "Draft",
  placeHolder: "Select which draft to submit"
};

function uri(value: string): UriLike {
  return { toString: () => value };
}

function createManager(drafts: Record<string, { label: string }>, visible: UriLike[]): Manager {
  return {
    getDraft: (target: UriLike) => drafts[target.toString()],
    getVisibleDrafts: () =>
      visible.map((entry) => ({ uri: entry, label: drafts[entry.toString()]?.label ?? "Unknown" }))
  } as unknown as Manager;
}

describe("resolveDraftForSubmit", () => {
  beforeEach(() => {
    informationMessages.length = 0;
    quickPickIndex = undefined;
    showQuickPick.mockClear();
  });

  it("returns the draft for an explicit draft URI", async () => {
    const draftUri = uri("draft:/a");
    const manager = createManager({ "draft:/a": { label: "A" } }, []);

    const resolved = await resolveDraftForSubmit(manager, draftUri as never, messages);

    assert.deepEqual(resolved, { draft: { label: "A" }, targetUri: draftUri });
    assert.deepEqual(informationMessages, []);
  });

  it("falls back to the single visible draft when no URI is given", async () => {
    const visible = uri("draft:/a");
    const manager = createManager({ "draft:/a": { label: "A" } }, [visible]);

    const resolved = await resolveDraftForSubmit(manager, undefined, messages);

    assert.deepEqual(resolved, { draft: { label: "A" }, targetUri: visible });
  });

  it("stops with the no-draft message when a URI is required", async () => {
    const manager = createManager({ "draft:/a": { label: "A" } }, [uri("draft:/a")]);

    const resolved = await resolveDraftForSubmit(manager, undefined, messages, {
      requireUri: true
    });

    assert.equal(resolved, null);
    assert.deepEqual(informationMessages, [messages.noDraft]);
  });

  it("asks which visible draft to submit when several are open", async () => {
    const second = uri("draft:/b");
    const manager = createManager({ "draft:/a": { label: "A" }, "draft:/b": { label: "B" } }, [
      uri("draft:/a"),
      second
    ]);
    quickPickIndex = 1;

    const resolved = await resolveDraftForSubmit(manager, uri("file:/other") as never, messages);

    assert.deepEqual(resolved, { draft: { label: "B" }, targetUri: second });
    const [items, options] = showQuickPick.mock.calls[0];
    assert.deepEqual(
      (items as Array<{ label: string; description: string }>).map(({ label, description }) => ({
        label,
        description
      })),
      [
        { label: "A", description: "Draft" },
        { label: "B", description: "Draft" }
      ]
    );
    assert.deepEqual(options, { placeHolder: messages.placeHolder });
  });

  it("returns null without a message when the quick pick is dismissed", async () => {
    const manager = createManager({ "draft:/a": { label: "A" }, "draft:/b": { label: "B" } }, [
      uri("draft:/a"),
      uri("draft:/b")
    ]);

    assert.equal(await resolveDraftForSubmit(manager, undefined, messages), null);
    assert.deepEqual(informationMessages, []);
  });

  it("reports a non-draft URI and a missing draft with distinct messages", async () => {
    const manager = createManager({}, []);

    assert.equal(await resolveDraftForSubmit(manager, uri("file:/x") as never, messages), null);
    assert.equal(await resolveDraftForSubmit(manager, undefined, messages), null);
    assert.deepEqual(informationMessages, [messages.notDraft, messages.noDraft]);
  });
});
