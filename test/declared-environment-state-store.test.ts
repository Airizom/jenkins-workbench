import { describe, expect, it } from "vitest";
import type { DeclaredEnvironment } from "../src/environments/sharing/DeclaredEnvironmentSource";
import {
  DECLARED_ENVIRONMENT_STATE_KEY,
  DeclaredEnvironmentStateStore
} from "../src/environments/sharing/DeclaredEnvironmentStateStore";
import { createExtensionContext } from "./helpers/storageMocks";

function declared(
  slug: string,
  url: string,
  scope: DeclaredEnvironment["scope"] = "workspace"
): DeclaredEnvironment {
  return {
    scope,
    slug,
    id: `settings:${slug}`,
    url,
    origin: { level: scope === "global" ? "user" : "workspace" }
  };
}

function setup() {
  const context = createExtensionContext();
  return { context, state: new DeclaredEnvironmentStateStore(context) };
}

describe("DeclaredEnvironmentStateStore.reconcileUrls", () => {
  it("records the first URL without reporting a change", async () => {
    const { state } = setup();
    expect(await state.reconcileUrls([declared("ci", "https://a.example/")])).toEqual([]);
    expect(state.get("workspace", "settings:ci")).toEqual({ lastUrl: "https://a.example/" });
    expect(await state.reconcileUrls([declared("ci", "https://a.example/")])).toEqual([]);
  });

  it("keeps previous URLs newest first, deduped, without the current URL, max five", async () => {
    const { state } = setup();
    await state.reconcileUrls([declared("ci", "https://a.example/")]);

    expect(await state.reconcileUrls([declared("ci", "https://b.example/")])).toEqual([
      {
        scope: "workspace",
        id: "settings:ci",
        previousUrl: "https://a.example/",
        url: "https://b.example/"
      }
    ]);
    expect(state.get("workspace", "settings:ci")).toEqual({
      lastUrl: "https://b.example/",
      previousUrls: ["https://a.example/"]
    });

    // A -> B -> A drops the current URL and keeps B.
    await state.reconcileUrls([declared("ci", "https://a.example/")]);
    expect(state.get("workspace", "settings:ci").previousUrls).toEqual(["https://b.example/"]);

    for (let index = 0; index < 7; index += 1) {
      await state.reconcileUrls([declared("ci", `https://h${index}.example/`)]);
    }
    expect(state.get("workspace", "settings:ci")).toEqual({
      lastUrl: "https://h6.example/",
      previousUrls: [
        "https://h5.example/",
        "https://h4.example/",
        "https://h3.example/",
        "https://h2.example/",
        "https://h1.example/"
      ]
    });
  });

  it("normalizes trailing slashes and keeps scopes apart", async () => {
    const { context, state } = setup();
    await state.reconcileUrls([
      declared("ci", "https://a.example/jenkins/", "workspace"),
      declared("ci", "https://g.example/", "global")
    ]);
    await state.update("workspace", "settings:ci", { lastUrl: "https://a.example/jenkins" });

    expect(
      await state.reconcileUrls([
        declared("ci", "https://a.example/jenkins/", "workspace"),
        declared("ci", "https://g2.example/", "global")
      ])
    ).toEqual([
      {
        scope: "global",
        id: "settings:ci",
        previousUrl: "https://g.example/",
        url: "https://g2.example/"
      }
    ]);
    expect(context.globalState.get(DECLARED_ENVIRONMENT_STATE_KEY)).toEqual({
      entries: {
        "settings:ci": { lastUrl: "https://g2.example/", previousUrls: ["https://g.example/"] }
      }
    });
  });

  it("keeps local state of declarations that disappeared", async () => {
    const { state } = setup();
    await state.reconcileUrls([declared("ci", "https://a.example/")]);
    await state.setHidden("workspace", "settings:ci", true);
    await state.reconcileUrls([]);
    expect(state.get("workspace", "settings:ci").hidden).toBe(true);
  });
});

describe("DeclaredEnvironmentStateStore flags", () => {
  it("hides and shows declared environments per scope", async () => {
    const { state } = setup();
    await state.setHidden("workspace", "settings:a", true);
    await state.setHidden("global", "settings:b", true);
    expect(state.listHidden()).toEqual([
      { scope: "workspace", id: "settings:a" },
      { scope: "global", id: "settings:b" }
    ]);

    await state.setHidden("workspace", "settings:a", false);
    expect(state.get("workspace", "settings:a")).toEqual({});
    expect(state.listHidden()).toEqual([{ scope: "global", id: "settings:b" }]);
  });

  it("hides stored environments in this workspace only", async () => {
    const { context, state } = setup();
    await state.hideStored("global", "uuid-1");
    await state.hideStored("global", "uuid-1");

    expect(state.isStoredHidden("global", "uuid-1")).toBe(true);
    expect(state.isStoredHidden("workspace", "uuid-1")).toBe(false);
    expect(context.workspaceState.get(DECLARED_ENVIRONMENT_STATE_KEY)).toEqual({
      entries: {},
      hiddenStoredIds: [{ scope: "global", id: "uuid-1" }]
    });
    expect(context.globalState.get(DECLARED_ENVIRONMENT_STATE_KEY)).toBeUndefined();
  });

  it("records acknowledged origins and clears state", async () => {
    const { state } = setup();
    await state.acknowledgeOrigin("global", "settings:ci", "https://ci.example");
    await state.update("global", "settings:ci", { adoptDeclined: true });
    expect(state.get("global", "settings:ci")).toEqual({
      acknowledgedOrigin: "https://ci.example",
      adoptDeclined: true
    });

    await state.update("global", "settings:ci", { adoptDeclined: undefined });
    expect(state.get("global", "settings:ci")).toEqual({
      acknowledgedOrigin: "https://ci.example"
    });

    await state.update("global", "settings:ci", { acknowledgedOrigin: undefined });
    expect(state.get("global", "settings:ci")).toEqual({});
  });

  it("serializes concurrent mutations of one scope", async () => {
    const { state } = setup();
    await Promise.all([
      state.setHidden("workspace", "settings:a", true),
      state.acknowledgeOrigin("workspace", "settings:a", "https://a.example"),
      state.hideStored("workspace", "uuid-1"),
      state.reconcileUrls([declared("a", "https://a.example/")])
    ]);
    expect(state.get("workspace", "settings:a")).toEqual({
      hidden: true,
      acknowledgedOrigin: "https://a.example",
      lastUrl: "https://a.example/"
    });
    expect(state.isStoredHidden("workspace", "uuid-1")).toBe(true);
  });

  it("returns copies so callers cannot mutate stored state", async () => {
    const { state } = setup();
    await state.reconcileUrls([declared("ci", "https://a.example/")]);
    await state.reconcileUrls([declared("ci", "https://b.example/")]);
    state.get("workspace", "settings:ci").previousUrls?.push("https://mutated.example/");
    expect(state.get("workspace", "settings:ci").previousUrls).toEqual(["https://a.example/"]);
  });
});
