import assert from "node:assert/strict";
import test from "node:test";
import containerModule from "../out/extension/container/ExtensionContainer.js";

const {
  ExtensionContainer,
  composeProviderCatalog,
  createExtensionContainer,
  registerProviderCatalog
} = containerModule;

test("caches provider instances after first resolution", () => {
  const container = new ExtensionContainer();
  let calls = 0;

  container.register("environmentStore", () => ({ calls: ++calls }));

  const first = container.get("environmentStore");

  assert.deepEqual(first, { calls: 1 });
  assert.strictEqual(container.get("environmentStore"), first);
  assert.equal(calls, 1);
});

test("rejects duplicate provider registrations", () => {
  const container = new ExtensionContainer();

  container.register("environmentStore", () => ({}));

  assert.throws(
    () => container.register("environmentStore", () => ({})),
    /Provider already registered for token 'environmentStore'\./
  );
});

test("rejects registrations after the container is sealed", () => {
  const container = createExtensionContainer((registry) => {
    registry.register("environmentStore", () => ({}));
  });

  assert.throws(
    () => container.register("clientProvider", () => ({})),
    /Container is immutable\. Cannot register provider for 'clientProvider'\./
  );
});

test("throws for missing providers", () => {
  const container = new ExtensionContainer();

  assert.throws(
    () => container.get("environmentStore"),
    /Missing provider for token 'environmentStore'\./
  );
});

test("reports circular dependency paths", () => {
  const container = new ExtensionContainer();

  container.register("environmentStore", (registry) => registry.get("clientProvider"));
  container.register("clientProvider", (registry) => registry.get("environmentStore"));

  assert.throws(
    () => container.get("environmentStore"),
    /Circular dependency detected: environmentStore -> clientProvider -> environmentStore/
  );
});

test("registerProviderCatalog registers all provided factories", () => {
  const container = new ExtensionContainer();

  registerProviderCatalog(container, {
    environmentStore: () => ({ name: "environment" }),
    clientProvider: () => ({ name: "client" })
  });

  assert.deepEqual(container.get("environmentStore"), { name: "environment" });
  assert.deepEqual(container.get("clientProvider"), { name: "client" });
});

test("composeProviderCatalog reports sorted duplicate tokens", () => {
  assert.throws(
    () =>
      composeProviderCatalog([
        {
          dataService: () => ({}),
          clientProvider: () => ({})
        },
        {
          clientProvider: () => ({}),
          dataService: () => ({})
        }
      ]),
    /Duplicate provider token registrations found while composing provider catalogs: clientProvider, dataService/
  );
});
