import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import {
  composeProviderCatalog,
  createExtensionContainer,
  ExtensionContainer
} from "../src/extension/container/ExtensionContainer";
import type {
  ExtensionToken,
  ExtensionTokenMap
} from "../src/extension/container/ExtensionTokenMap";

describe("ExtensionContainer", () => {
  it("creates each service once and seals registration after setup", () => {
    const service = tokenValue("environmentStore", {});
    const factory = vi.fn(() => service);
    const container = createExtensionContainer((registry) => {
      registry.register("environmentStore", factory);
    });

    assert.equal(container.get("environmentStore"), service);
    assert.equal(container.get("environmentStore"), service);
    assert.equal(factory.mock.calls.length, 1);
    assert.throws(
      () => container.register("clientProvider", () => tokenValue("clientProvider", {})),
      /Container is immutable.*clientProvider/
    );
  });

  it("rejects duplicate registration and missing providers", () => {
    const container = new ExtensionContainer();
    container.register("environmentStore", () => tokenValue("environmentStore", {}));

    assert.throws(
      () => container.register("environmentStore", () => tokenValue("environmentStore", {})),
      /Provider already registered.*environmentStore/
    );
    assert.throws(() => container.get("clientProvider"), /Missing provider.*clientProvider/);
  });

  it("reports complete direct and indirect dependency cycles", () => {
    const direct = new ExtensionContainer();
    direct.register("environmentStore", (container) => container.get("environmentStore"));
    assert.throws(
      () => direct.get("environmentStore"),
      /Circular dependency detected: environmentStore -> environmentStore/
    );

    const indirect = new ExtensionContainer();
    indirect.register("environmentStore", (container) =>
      tokenValue("environmentStore", container.get("clientProvider"))
    );
    indirect.register("clientProvider", (container) =>
      tokenValue("clientProvider", container.get("dataService"))
    );
    indirect.register("dataService", (container) =>
      tokenValue("dataService", container.get("environmentStore"))
    );

    assert.throws(
      () => indirect.get("environmentStore"),
      /Circular dependency detected: environmentStore -> clientProvider -> dataService -> environmentStore/
    );
  });

  it("cleans up resolution state after a factory throws", () => {
    const container = new ExtensionContainer();
    const factory = vi
      .fn<() => ExtensionTokenMap["environmentStore"]>()
      .mockImplementationOnce(() => {
        throw new Error("setup failed");
      })
      .mockImplementationOnce(() => tokenValue("environmentStore", {}));
    container.register("environmentStore", factory);

    assert.throws(() => container.get("environmentStore"), /setup failed/);
    assert.doesNotThrow(() => container.get("environmentStore"));
    assert.equal(factory.mock.calls.length, 2);
  });
});

describe("composeProviderCatalog", () => {
  it("rejects duplicate tokens deterministically regardless of group order", () => {
    const first = {
      environmentStore: () => tokenValue("environmentStore", {}),
      clientProvider: () => tokenValue("clientProvider", {})
    };
    const second = {
      clientProvider: () => tokenValue("clientProvider", {}),
      environmentStore: () => tokenValue("environmentStore", {})
    };
    const expected = /Duplicate provider token registrations.*clientProvider, environmentStore/;

    assert.throws(() => composeProviderCatalog([first, second]), expected);
    assert.throws(() => composeProviderCatalog([second, first]), expected);
  });
});

function tokenValue<K extends ExtensionToken>(_token: K, value: object): ExtensionTokenMap[K] {
  return value as ExtensionTokenMap[K];
}
