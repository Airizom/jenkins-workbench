import { buildCompareScenarios } from "./fixtures/buildCompare";
import { buildDetailsScenarios } from "./fixtures/buildDetails";
import { nodeCapacityScenarios } from "./fixtures/nodeCapacity";
import { nodeDetailsScenarios } from "./fixtures/nodeDetails";
import { type PreviewThemeName, previewThemes } from "./themes";

type PanelName = "buildDetails" | "buildCompare" | "nodeCapacity" | "nodeDetails";

const panels: Record<
  PanelName,
  { scenarios: Record<string, unknown>; load: () => Promise<unknown> }
> = {
  buildDetails: {
    scenarios: buildDetailsScenarios,
    load: () => import("../../src/panels/buildDetails/webview/index")
  },
  buildCompare: {
    scenarios: buildCompareScenarios,
    load: () => import("../../src/panels/buildCompare/webview/index")
  },
  nodeCapacity: {
    scenarios: nodeCapacityScenarios,
    load: () => import("../../src/panels/nodeCapacity/webview/index")
  },
  nodeDetails: {
    scenarios: nodeDetailsScenarios,
    load: () => import("../../src/panels/nodeDetails/webview/index")
  }
};

const params = new URLSearchParams(window.location.search);
const panelName = (params.get("panel") ?? "buildDetails") as PanelName;
const themeName = (params.get("theme") ?? "dark") as PreviewThemeName;
const panel = panels[panelName] ?? panels.buildDetails;
const scenarioName = params.get("scenario") ?? Object.keys(panel.scenarios)[0];
const theme = previewThemes[themeName] ?? previewThemes.dark;

for (const [name, value] of Object.entries(theme.vars)) {
  document.documentElement.style.setProperty(name, value);
}
document.body.classList.add(theme.bodyClass);
document.title = `${panelName} / ${scenarioName} / ${themeName}`;

let panelState: unknown;
const globals = window as unknown as Record<string, unknown>;
globals.__INITIAL_STATE__ = panel.scenarios[scenarioName];
globals.acquireVsCodeApi = () => ({
  postMessage: (message: unknown) => console.info("[webview → extension]", message),
  getState: () => panelState,
  setState: (state: unknown) => {
    panelState = state;
    return state;
  }
});

void panel.load();
