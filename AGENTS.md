# Jenkins Workbench Agent Notes

This file is intentionally non-generic. It records only details that are easy to forget and likely to cause regressions.

## 1) The Real Runtime Shape (Do Not Assume Typical VS Code Extension Layout)

- The extension backend is TypeScript (`src/**`) bundled by esbuild (`scripts/build-extension.mjs`) into `out/extension.js`, plus `out/BuildDiagnosticCustomMatcherWorker.js`, which `BuildDiagnosticCustomMatcherWorkerClient` loads by path. `tsc` only typechecks the host. The five panel UIs are entries in one Vite build under `src/panels/**`.
- `package.json` `dependencies` (for example `redos-detector`) stay external to the bundle and load from the VSIX `node_modules`; everything else is inlined.
- Webview assets are resolved from `out/webview/manifest.json` at runtime (`src/panels/shared/webview/WebviewAssets.ts`).
- If the manifest or entry names drift, panels fail with missing assets.
- `npm run compile` is the command that keeps everything in sync:
  - `build:webview`
  - `typecheck:webview`
  - `typecheck:extension` (`tsc --noEmit`)
  - `build:extension` (esbuild; clears stale non-webview output in `out/`)
  - See `package.json` scripts.

## 2) High-Risk Coupling Map

If you change one side, update the others in the same pass.

- Jenkins API/data behavior:
  - Hub: `src/jenkins/JenkinsDataService.ts`
  - Consumers: tree loader/provider, status poller, queue poller, build panel controller/actions, artifact flows.
  - Risk: changing signatures/endpoints can silently break watch updates or panel refresh behavior.

- Build Details backend/frontend contract:
  - Contract: `src/panels/buildDetails/shared/BuildDetailsContracts.ts`, `src/panels/buildDetails/shared/BuildDetailsPanelMessages.ts`, `src/panels/buildDetails/shared/BuildDetailsPanelWebviewState.ts`
  - Backend producers/router: `src/panels/buildDetails/BuildDetailsPanelController.ts`, `src/panels/buildDetails/BuildDetailsPanelRuntime.ts`, `src/panels/buildDetails/BuildDetailsPanelView.ts`, `src/panels/buildDetails/BuildDetailsMessageRouter.ts`
  - Frontend consumer: `src/panels/buildDetails/webview/state/buildDetailsState.ts` and hooks/components in `src/panels/buildDetails/webview/**`
  - Rule: add/remove message, view-model, or persisted-state fields in the shared contract modules and consume them from both backend and webview.

- Build Compare backend/frontend contract:
  - Contract: `src/panels/buildCompare/shared/BuildCompareContracts.ts`, `src/panels/buildCompare/shared/BuildComparePanelMessages.ts`, `src/panels/buildCompare/shared/BuildComparePanelWebviewState.ts`
  - Backend producer: `src/panels/buildCompare/BuildComparePanelController.ts`
  - Frontend consumer: `src/panels/buildCompare/webview/state/buildCompareState.ts` and hooks/components in `src/panels/buildCompare/webview/**`
  - Rule: add/remove view-model or message fields in the shared contract modules and consume them from both backend and webview.

- Node Details backend/frontend contract:
  - Contract: `src/panels/nodeDetails/shared/NodeDetailsContracts.ts`, `src/panels/nodeDetails/shared/NodeDetailsPanelMessages.ts`, `src/panels/nodeDetails/shared/NodeDetailsPanelWebviewState.ts`
  - Backend producer: `src/panels/NodeDetailsPanel.ts`
  - Frontend consumer: `src/panels/nodeDetails/webview/state/nodeDetailsState.ts` and hooks/components in `src/panels/nodeDetails/webview/**`
  - Rule: add/remove message, view-model, or persisted-state fields in the shared contract modules and consume them from both backend and webview.

- Node Capacity backend/frontend contract:
  - Contract: `src/shared/nodeCapacity/NodeCapacityContracts.ts`, `src/panels/nodeCapacity/shared/NodeCapacityPanelMessages.ts`
  - Backend producer: `src/panels/NodeCapacityPanel.ts`
  - Frontend consumer: `src/panels/nodeCapacity/webview/state/nodeCapacityState.ts` and hooks/components in `src/panels/nodeCapacity/webview/**`
  - Rule: add/remove view-model or message fields in the shared contract modules and consume them from both backend and webview.

- Tree cache + refresh orchestration:
  - Provider: `src/tree/TreeDataProvider.ts`
  - Loader caches/tokens: `src/tree/TreeChildren.ts`
  - Pending input coordinator: `src/services/PendingInputRefreshCoordinator.ts`
  - Pollers: `src/watch/JenkinsStatusPoller.ts`, `src/queue/JenkinsQueuePoller.ts`
  - Risk: stale tree state or excessive Jenkins calls if invalidation paths are incomplete.

## 3) Surprising Behaviors Worth Remembering

- Jenkins limits the exported `builds` list to 100 entries before applying tree ranges. History requests with an explicit offset use `allBuilds`; keep their cache keys separate from ordinary recent-build requests.
- Cross-build test identity is suite/class/name. Duplicate identities and omitted observations must remain ambiguous/unavailable; neither implies a pass. History budgets and cancellation are shared by Build Details and Job History (`src/history/**`, `src/panels/jobHistory/**`).

- Manual refresh is rate-limited (2s cooldown) in `TreeDataProvider.refresh()`. Repeated refresh requests may be ignored by design.
- Pending input refreshes are queued/throttled with concurrency limits in `PendingInputRefreshCoordinator`; this protects Jenkins from burst traffic.
- Build Details uses load tokens and panel-visibility-aware polling. If you alter refresh timing, preserve token checks to avoid stale postMessage updates.
- Task cancellation closes the local task immediately, never cancels the Jenkins queue item, and only stops a running build when `JenkinsTaskRunner` verifies that it has a single trigger. Shared or unverifiable work is left active (`src/tasks/JenkinsTaskTerminal.ts`, `src/tasks/JenkinsTaskRunner.ts`).
- Activation is kept cheap on purpose: command handlers, task providers, and panel-launcher dependencies hold `container.lazy(...)` references, so Build Details/Compare launchers (and the Git-backed coverage/test-source services behind them) are built on first use. The watch and commit-watch pollers start after a short delay (`ExtensionRuntime.ts`). Jenkinsfile language providers register with `JenkinsfileMatcher.documentSelector` and re-register when the file patterns change; do not widen them back to whole schemes.
- Artifact downloads require a workspace folder, but previews do not (`README.md` settings/troubleshooting sections).
- Environment auth migration exists (`migrateLegacyAuthConfigs`) and moves old token/username style auth into secret-backed auth config (`src/storage/JenkinsEnvironmentStore.ts`).

## 4) DI Container Constraints (Easy Failure Mode)

- Provider registration is locked when `createExtensionContainer(...)` seals the container; registration after `seal()` throws.
- Duplicate tokens in composed catalogs throw during startup.
- Missing tokens fail at first `container.get(...)`.
- Source:
  - `src/extension/container/ExtensionContainer.ts`
  - `src/extension/ExtensionServices.ts`

When adding a service, wire it through the appropriate provider catalog (`CoreProviders`, `TreeProviders`, `ValidationProviders`, `RuntimeProviders`) before activation.

## 5) Webview Asset Rule (Most Common Breakage)

If you touch panel entrypoints, bundle naming, or Vite output:

1. Confirm `vite.config.ts` still emits manifest entries for build compare, build details, job history, node capacity, and node details.
2. Run `npm run compile`.
3. Verify `out/webview/manifest.json` includes expected entries.
4. Launch Extension Development Host and open the Build Compare, Build Details, Job History, Node Capacity, and Node Details panels.

If this is skipped, `resolveWebviewAssets(...)` throws; panel helpers catch the error and render a load-error view instead of the interactive panel.

## 6) Practical Edit Playbooks

- Adding Jenkins API capability:
  - Extend `JenkinsDataService`.
  - Update affected tree/panel/task consumers.
  - Re-check pending-input/watch behavior if build/job status semantics changed.

- Changing tree behavior:
  - Update `TreeChildren.invalidateForElement` and related cache-clearing helpers.
  - Ensure `TreeDataProvider.onEnvironmentChanged` and `refresh()` still clear the same categories (data cache, watch/pin, children cache).
  - Verify watch count + queue/running summary badges still update.

- Changing build details UI state:
  - Update message types + reducer + UI.
  - Test panel in both visible and hidden states (completion polling path differs).

## 7) Verification Path

Automated coverage exists at two levels:

- Unit tests: Vitest (`test/**/*.test.ts`, config in `vitest.config.ts`).
  - `npm run test:unit` (fast), `npm run test:watch` (watch mode), `npm run test:coverage` (v8 coverage with thresholds).
  - The `vscode` module is aliased to `test/helpers/vscodeStub.ts`; tests needing custom behavior use `vi.doMock("vscode", () => shim)` followed by a top-level `await import(...)` of the module under test. Never `require(...)` in tests.
  - `npm run typecheck:test` type-checks test files (`tsconfig.test.json`, noEmit).
  - `npm test` runs manifest/workflow validation + test typecheck + coverage; CI enforces coverage thresholds — if a legitimate change dips below one, adjust the threshold in `vitest.config.ts` in the same PR and say why.
- Integration smoke tests: `npm run test:integration` (`@vscode/test-cli`, `.vscode-test.mjs`, `test/integration/`). Compiles the extension, downloads VS Code, and verifies activation + command registration in a real extension host.

Unit tests do not exercise the webview UI or live Jenkins traffic. For changes to panels, tree interaction, or HTTP flows, still do the manual gate:

1. `npm run compile`
2. `npm run check`
3. Press F5 (Extension Development Host)
4. Manually validate:
   - tree load/refresh
   - watch updates
   - queue visibility
   - build compare panel updates
   - build details panel updates
   - job history, baseline selection, and hidden-panel cancellation
   - node capacity panel updates
   - node details panel updates
   - artifact preview/download behavior

Reference checklist is in `README.md` (manual testing section + troubleshooting).

## 8) Release Notes for Future Agent Runs

Release procedure is documented and strict in `docs/release-process.md`:

- Node 24+
- version/tag alignment (`package.json.version` == `vX.Y.Z` tag without `v`)
- local prepublish compile before tagging
- push with tags and confirm clean/ahead-free status
- package with `node scripts/release.mjs package`, never `vsce package --no-dependencies`: the esbuild bundle keeps `dependencies` such as `redos-detector` external and loads them from the VSIX `node_modules`. 1.54.0 shipped without them and failed to activate.

If a release fails in CI, first suspect tag/version mismatch or missing publish secrets (`VSCE_PAT`, `OVSX_PAT`).
