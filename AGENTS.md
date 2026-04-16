# Jenkins Workbench Agent Notes

This file is intentionally non-generic. It records only details that are easy to forget and likely to cause regressions.

## 1) The Real Runtime Shape (Do Not Assume Typical VS Code Extension Layout)

- The extension backend is TypeScript (`src/**`) and the panel UI is a separate Vite bundle under `src/panels/**`.
- Webview assets are resolved from `out/webview/manifest.json` at runtime (`src/panels/shared/webview/WebviewAssets.ts`).
- If the manifest or entry names drift, panels fail with missing assets.
- `npm run compile` is the command that keeps everything in sync:
  - `build:webview`
  - `typecheck:webview`
  - extension `tsc`
  - See `package.json` scripts.

## 2) High-Risk Coupling Map

If you change one side, update the others in the same pass.

- Jenkins API/data behavior:
  - Hub: `src/jenkins/JenkinsDataService.ts`
  - Consumers: tree loader/provider, status poller, queue poller, build panel controller/actions, artifact flows.
  - Risk: changing signatures/endpoints can silently break watch updates or panel refresh behavior.

- Build Details backend/frontend contract:
  - Contract: `src/panels/buildDetails/shared/BuildDetailsPanelMessages.ts`
  - Backend producer: `src/panels/buildDetails/BuildDetailsPanelController.ts`
  - Frontend consumer: `src/panels/buildDetails/webview/state/buildDetailsState.ts` and hooks/components in `src/panels/buildDetails/webview/**`
  - Rule: add/remove message fields in the shared contract module and consume from both backend and webview.

- Build Compare backend/frontend contract:
  - Contract: `src/panels/buildCompare/shared/BuildCompareContracts.ts`, `src/panels/buildCompare/shared/BuildComparePanelMessages.ts`, `src/panels/buildCompare/shared/BuildComparePanelWebviewState.ts`
  - Backend producer: `src/panels/buildCompare/BuildComparePanelController.ts`
  - Frontend consumer: `src/panels/buildCompare/webview/state/buildCompareState.ts` and hooks/components in `src/panels/buildCompare/webview/**`
  - Rule: add/remove view-model or message fields in the shared contract modules and consume them from both backend and webview.

- Node Details backend/frontend contract:
  - Contract: `src/panels/nodeDetails/shared/NodeDetailsPanelMessages.ts`
  - Backend producer: `src/panels/NodeDetailsPanel.ts`
  - Frontend consumer: hooks/components in `src/panels/nodeDetails/webview/**`
  - Rule: add/remove message fields in the shared contract module and consume from both backend and webview.

- Tree cache + refresh orchestration:
  - Provider: `src/tree/TreeDataProvider.ts`
  - Loader caches/tokens: `src/tree/TreeChildren.ts`
  - Pending input coordinator: `src/services/PendingInputRefreshCoordinator.ts`
  - Pollers: `src/watch/JenkinsStatusPoller.ts`, `src/queue/JenkinsQueuePoller.ts`
  - Risk: stale tree state or excessive Jenkins calls if invalidation paths are incomplete.

## 3) Surprising Behaviors Worth Remembering

- Manual refresh is rate-limited (2s cooldown) in `TreeDataProvider.refresh()`. Repeated refresh requests may be ignored by design.
- Pending input refreshes are queued/throttled with concurrency limits in `PendingInputRefreshCoordinator`; this protects Jenkins from burst traffic.
- Build Details uses load tokens and panel-visibility-aware polling. If you alter refresh timing, preserve token checks to avoid stale postMessage updates.
- Task cancellation in task terminals does not cancel Jenkins builds (`src/tasks/JenkinsTaskTerminal.ts`).
- Artifact downloads require a workspace folder, but previews do not (`README.md` settings/troubleshooting sections).
- Environment auth migration exists (`migrateLegacyAuthConfigs`) and moves old token/username style auth into secret-backed auth config (`src/storage/JenkinsEnvironmentStore.ts`).

## 4) DI Container Constraints (Easy Failure Mode)

- Provider registration is locked after container creation (`seal()`); late registration throws.
- Duplicate tokens in composed catalogs throw during startup.
- Missing tokens fail at first `container.get(...)`.
- Source:
  - `src/extension/container/ExtensionContainer.ts`
  - `src/extension/ExtensionServices.ts`

When adding a service, wire it through the appropriate provider catalog (`CoreProviders`, `TreeProviders`, `ValidationProviders`, `RuntimeProviders`) before activation.

## 5) Webview Asset Rule (Most Common Breakage)

If you touch panel entrypoints, bundle naming, or Vite output:

1. Confirm `vite.config.ts` still emits manifest entries for build compare, build details, and node details.
2. Run `npm run compile`.
3. Verify `out/webview/manifest.json` includes expected entries.
4. Launch Extension Development Host and open the Build Compare, Build Details, and Node Details panels.

If this is skipped, `resolveWebviewAssets(...)` throws and panel load fails.

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

## 7) Fast Verification Path (No Full Automated Suite Here)

There is no meaningful automated test suite in this repo currently. Use this minimum gate:

1. `npm run compile`
2. `npm run check`
3. Press F5 (Extension Development Host)
4. Manually validate:
   - tree load/refresh
   - watch updates
   - queue visibility
   - build details panel updates
   - artifact preview/download behavior

Reference checklist is in `README.md` (manual testing section + troubleshooting).

## 8) Release Notes for Future Agent Runs

Release procedure is documented and strict in `docs/release-process.md`:

- Node 24+
- version/tag alignment (`package.json.version` == `vX.Y.Z` tag without `v`)
- local prepublish compile before tagging
- push with tags and confirm clean/ahead-free status

If a release fails in CI, first suspect tag/version mismatch or missing publish secrets (`VSCE_PAT`, `OVSX_PAT`).
