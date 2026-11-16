# Jenkins Workbench Agent Notes

This file is intentionally non-generic. It records only details that are easy to forget and likely to cause regressions.

## 1) The Real Runtime Shape (Do Not Assume Typical VS Code Extension Layout)

- The extension backend is TypeScript (`src/**`) bundled by esbuild (`scripts/build-extension.mjs`) into `out/extension.js`, plus `out/BuildDiagnosticCustomMatcherWorker.js`, which `BuildDiagnosticCustomMatcherWorkerClient` loads by path. `tsc` only typechecks the host. The six panel UIs are entries in one Vite build under `src/panels/**`.
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

- Shared environments (`src/environments/sharing/**`, `src/environments/sync/**`):
  - Declarations from `jenkinsWorkbench.environments` get ids `settings:<slug>`. `getEnvironments` merges them into the stored list but they are never persisted; every mutation path must read `getStoredEnvironments`. They are read-only except credentials (Remove hides them through the registry; `store.removeEnvironment` returns false for them).
  - Import direction is one-way, sharing → storage: `JenkinsEnvironmentStore` reads declarations only through the read-only `DeclaredEnvironmentView` (`src/storage/DeclaredEnvironmentView.ts`, built by `createDeclaredEnvironmentView`), and the id/URL/auth-hint helpers live in `src/storage/DeclaredEnvironmentView.ts` and `src/storage/EnvironmentAuthHint.ts`. Nothing in `src/storage/**` may import `src/environments/**`.
  - `DeclaredEnvironmentRegistry` (`src/environments/sharing/`) is the only writer of declared local state (`acknowledgedOrigin`, `hidden`, `adoptDeclined`, hidden stored ids, previous URLs): acknowledge/restore, hide/unhide, keep-separate, and the declared change notifications. Each write invalidates the affected clients and fires through `store.fireChange`. The `declaredEnvironmentState` token is the read-only `DeclaredEnvironmentStateReader`; only the registry gets the writable store (`CoreProviders`). A same-URL visible manual environment suppresses a declaration (listing, adoption candidates, keep-separate) only through `findSuppressingStored`/`matchDeclaredWithStored` (`DeclaredEnvironmentView.ts`).
  - Workspace/folder declarations are ignored in untrusted workspaces. `allowInsecureTls` counts only from user settings, or from a user entry with the same id and origin as a workspace entry.
  - Secrets of workspace-scoped declared ids are keyed `<prefix>.workspace.<namespace>.settings:<slug>`, where the namespace is a random id kept in workspaceState (`jenkinsWorkbench.workspaceSecretNamespace`): SecretStorage is shared by all workspaces and slugs repeat across repositories. Build secret keys only through the store's `getTokenKey`/`getAuthConfigKey`. `hasStoredCredentials` is memoized; every secret write must go through the store so its credential generation advances.
  - `acknowledgedOrigin` holds `toOriginAcknowledgment(url, authHint)`: the server origin plus `|<sign-in page origin>` when an SSO hint's `loginUrl` is on another origin. A hinted `loginUrl` may be used only while the stored acknowledgment equals that value. Commands never build it: they gate on `registry.isOriginAcknowledged` (the store's `getSignInRequirement` test) and pass `registry.getExpectedAcknowledgment`, read with the environment they show, as `expected` to `acknowledgeOrigin`, so a settings edit made mid-flow is never confirmed unseen. Editing credentials does not acknowledge; adoption uses `loginPage: "from-credentials"`.
  - Sign-in gating: `JenkinsClientProvider` checks `getSignInRequirement` only when it builds a cache entry, so anything that changes a record, hint, or acknowledged origin must `invalidateClient`. Pollers skip sign-in-required environments and must never prune records that are merely hidden or suppressed, only ids missing from `getStoredEnvironments`.
  - A new environment-id-keyed store implements `copyEnvironmentRecords(from, to)` per the `EnvironmentRecordsCopy` contract (copy or re-point, skip what the target already has, undo only its own writes) and `removeEnvironmentRecords(ref)` (only the records this window can reach: `ref.scope`'s memento, or this workspace's), and is registered once in `createEnvironmentRecordParticipants` plus the `environmentRecordParticipants` provider (`CoreProviders`). Linking, Remove and Hide iterate that list; credentials stay a separate step. Its `rebase*Urls` still has to be added to `EnvironmentUrlRebaseService` by hand.
  - `authHint` on stored records is maintained centrally: `setAuthConfig`/`setAuthConfigIfRevision` write it (cookie/headers remove it, deleting credentials keeps it), and `backfillAuthHints` runs after `migrateLegacyAuthConfigs`, once per scope (marker `jenkinsWorkbench.authHintBackfillVersion` in that memento; never add it to `setKeysForSync`). `toEnvironmentAuthHint` (`src/storage/EnvironmentAuthHint.ts`) is the only auth-config-to-hint mapper. Commands should not write it. Auth writes inside a record mutation must not await the record queue (deadlock); the store defers the hint write in that case.
  - `EnvironmentSyncService` registers `setKeysForSync` for the globalState keys `jenkinsWorkbench.environments`, `jenkinsWorkbench.pinnedJobs` and `jenkinsWorkbench.watchedJobs` (rebase bookkeeping is workspaceState and cannot sync). Changing a synced key's stored shape reaches machines still running older versions. Mementos fire nothing on synced changes; the service compares the keys on window focus.

- Environment Diagnostics uses isolated, uncached clients without automatic SSO refresh. Keep raw probe responses in the host; only sanitized contracts from `src/environmentDiagnostics/**` may enter the panel or copied reports. Unlike data panels, its launcher keeps the panel open after connection edits, aborts old runs, and retests the saved environment. Recovery must keep the existing credential revision checks, URL rebasing, and TLS confirmation paths.

## 3) Surprising Behaviors Worth Remembering

- Jenkins limits the exported `builds` list to 100 entries before applying tree ranges. History requests with an explicit offset use `allBuilds`; keep their cache keys separate from ordinary recent-build requests.
- Cross-build test identity is suite/class/name. Duplicate identities and omitted observations must remain ambiguous/unavailable; neither implies a pass. History budgets and cancellation are shared by Build Details and Job History (`src/history/**`, `src/panels/jobHistory/**`).

- Every flow that starts a build (Trigger Build, current-branch trigger, Rebuild, Quick Replay, replay drafts, local-Jenkinsfile replay, Restart from Stage) calls `BuildFollowUpService.prepare` before submitting and `announceAndFollow` after (`src/services/buildFollow/**`). Rebuild, replay and restart return no queue item, so the new build is found from the job's `nextBuildNumber` read before the submission plus its cause; a new trigger flow must keep that order. `jenkinsWorkbench.followTriggeredBuilds: false` restores the plain message and refresh.
- Manual refresh is rate-limited (2s cooldown) in `TreeDataProvider.refresh()`. Repeated refresh requests may be ignored by design.
- Pending input refreshes are queued/throttled with concurrency limits in `PendingInputRefreshCoordinator`; this protects Jenkins from burst traffic.
- Build Details uses load tokens and panel-visibility-aware polling. If you alter refresh timing, preserve token checks to avoid stale postMessage updates.
- Task cancellation closes the local task immediately, never cancels the Jenkins queue item, and only stops a running build when `JenkinsTaskRunner` verifies that it has a single trigger. Shared or unverifiable work is left active (`src/tasks/JenkinsTaskTerminal.ts`, `src/tasks/JenkinsTaskRunner.ts`).
- Activation is kept cheap on purpose: command handlers, task providers, and panel-launcher dependencies hold `container.lazy(...)` references, so Build Details/Compare launchers (and the Git-backed coverage/test-source services behind them) are built on first use. The watch and commit-watch pollers start after a short delay (`ExtensionRuntime.ts`). Jenkinsfile language providers register with `JenkinsfileMatcher.documentSelector` and re-register when the file patterns change; do not widen them back to whole schemes.
- Jenkinsfile intelligence (completion, hover, signature help, outline, definition) reads one per-version document model (`src/jenkinsfile/model/JenkinsfileDocumentModelCache.ts`); add new structural facts there rather than re-scanning in a provider. `analyzeJenkinsfileContext` is a cursor query over that model (block path, enclosing call span, string/comment and interpolation checks); it must not grow its own brace or paren scan from the start of the text, or re-mask it. Providers gate on `JenkinsfileIntelligenceDocumentScope` (Jenkinsfile patterns or a known library `vars/*.groovy`), and the extra `**/vars/*.groovy` selector registers only intelligence providers: never route vars files to validation, CodeLens, or quick fixes, which keep using `JenkinsfileMatcher`.
- `JenkinsSharedLibraryIndex` (`src/jenkinsfile/sharedLibraries/`) is lazy: no file-system reads or watcher until a Jenkinsfile feature asks for libraries. Before the first load, `isVarsFile` stays synchronous and I/O-free, counts every candidate root (a missing configured path must not hide a same-named workspace folder), and starts one background load. It must be invalidated by its `vars/` watcher, workspace-folder changes, and `jenkinsfile.sharedLibraries` changes. Library vars reach providers as catalog steps with `source` set, through `JenkinsfileDocumentCatalogResolver`; providers should take the resolver, not `JenkinsfileStepCatalogService`.
- Artifact downloads require a workspace folder, but previews do not (`README.md` settings/troubleshooting sections).
- Editing an environment's URL keeps its id and rebases every stored absolute URL (pins, watches, presets, bindings, repository links, baselines, view state, commit watches) via `EnvironmentUrlRebaseService`; the record keeps `previousUrls` so activation can rebase stores in other workspaces. A new store that holds job URLs must add a rebase method and be wired into that service.
- Environment auth migration exists (`migrateLegacyAuthConfigs`) and moves old token/username style auth into secret-backed auth config (`src/storage/JenkinsEnvironmentStore.ts`).
- README screenshots in `docs/images/` come from `dev/showcase/` (seeded Jenkins plus an isolated VS Code; see its README). `launch-vscode.mjs` writes the `jenkinsWorkbench.environments` (including `authHint`) and `jenkinsWorkbench.repositoryLinks` globalState shapes directly, so update it when `JenkinsEnvironmentStore` or `JenkinsRepositoryLinkStore` change their stored format.

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

1. Confirm `vite.config.mts` still emits manifest entries for build compare, build details, job history, node capacity, node details, and environment diagnostics.
2. Run `npm run compile`.
3. Verify `out/webview/manifest.json` includes expected entries.
4. Launch Extension Development Host and open the Build Compare, Build Details, Job History, Node Capacity, Node Details, and Environment Diagnostics panels.

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

- Unit tests: Vitest (`test/**/*.test.ts`, config in `vitest.config.mts`).
  - `npm run test:unit` (fast), `npm run test:watch` (watch mode), `npm run test:coverage` (v8 coverage with thresholds).
  - The `vscode` module is aliased to `test/helpers/vscodeStub.ts`; tests needing custom behavior use `vi.doMock("vscode", () => shim)` followed by a top-level `await import(...)` of the module under test. Never `require(...)` in tests.
  - `npm run typecheck:test` type-checks test files (`tsconfig.test.json`, noEmit).
  - `npm test` runs manifest/workflow validation + test typecheck + coverage; CI enforces coverage thresholds — if a legitimate change dips below one, adjust the threshold in `vitest.config.mts` in the same PR and say why.
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
