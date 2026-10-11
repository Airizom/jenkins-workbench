import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuickPickItem } from "vscode";
import { EventEmitter } from "./helpers/vscodeStub";

function createQuickPick() {
  const accept = new EventEmitter<void>();
  const hide = new EventEmitter<void>();
  const picker = {
    items: [] as QuickPickItem[],
    activeItems: [] as QuickPickItem[],
    selectedItems: [] as QuickPickItem[],
    placeholder: "",
    ignoreFocusOut: false,
    canSelectMany: false,
    onDidAccept: accept.event,
    onDidHide: hide.event,
    show: vi.fn(() => {
      // Single-select pickers ignore `picked` and focus the first item by default.
      if (!picker.activeItems.length) picker.activeItems = picker.items.slice(0, 1);
    }),
    hide: () => hide.fire(),
    dispose: vi.fn(() => {
      accept.dispose();
      hide.dispose();
    }),
    accept: () => {
      picker.selectedItems = picker.activeItems;
      accept.fire();
    }
  };
  return picker;
}

let quickPick = createQuickPick();
vi.doMock("vscode", () => ({ window: { createQuickPick: () => quickPick } }));
const { promptBooleanParameterValue, promptChoiceParameterValue } = await import(
  "../src/ui/ParameterPrompts"
);

beforeEach(() => {
  quickPick = createQuickPick();
});

describe("single-select parameter defaults", () => {
  it.each([false, "false", 0, ["false"]])("activates a false default (%j)", async (value) => {
    const pending = promptBooleanParameterValue("Boolean parameter", value);
    expect(quickPick.activeItems).toEqual([quickPick.items[1]]);
    quickPick.accept();
    expect(await pending).toBe("false");
    expect(quickPick.dispose).toHaveBeenCalledOnce();
  });

  it("activates a non-first choice default", async () => {
    const pending = promptChoiceParameterValue("Choice parameter", ["first", "second"], "second");
    expect(quickPick.activeItems).toEqual([quickPick.items[1]]);
    expect(quickPick.canSelectMany).toBe(false);
    expect(quickPick.placeholder).toBe("Choice parameter");
    expect(quickPick.ignoreFocusOut).toBe(true);
    quickPick.accept();
    expect(await pending).toBe("second");
    expect(quickPick.dispose).toHaveBeenCalledOnce();
  });

  it.each([undefined, "missing"])(
    "keeps the first choice without a matching default (%s)",
    async (value) => {
      const pending = promptChoiceParameterValue("Choice parameter", ["first", "second"], value);
      quickPick.accept();
      expect(await pending).toBe("first");
    }
  );

  it("returns the user's selection after navigating away from the default", async () => {
    const pending = promptBooleanParameterValue("Boolean parameter", false);
    quickPick.activeItems = [quickPick.items[0]];
    quickPick.accept();
    expect(await pending).toBe("true");
  });

  it("returns undefined and disposes the picker when dismissed", async () => {
    const pending = promptChoiceParameterValue("Choice parameter", ["first", "second"], "second");
    quickPick.hide();
    expect(await pending).toBeUndefined();
    expect(quickPick.dispose).toHaveBeenCalledOnce();
  });
});
