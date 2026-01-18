# Repository Guidelines

## Project Overview

- VS Code extension that surfaces Jenkins instances, jobs, and build activity in an Activity Bar view.
- Uses the Jenkins JSON API via `src/jenkins/` services; stores environment metadata in VS Code state.
- Target VS Code version: `^1.85.0`
- Includes pinned jobs/pipelines, artifact preview/download workflows, build log and job config previews, richer build tooltips, and a React-based build details panel with console search/export and failure insights cards.

## Project Structure & Module Organization

```
src/
├── extension.ts              # Entry point (re-exports activate/deactivate)
├── extension/                # Extension lifecycle and configuration
│   ├── ExtensionActivation.ts    # activate()/deactivate() implementation
│   ├── ExtensionCommands.ts      # Command registration orchestration
│   ├── ExtensionConfig.ts        # Configuration accessors
│   ├── ExtensionServices.ts      # Service factory (dependency wiring)
│   ├── ExtensionSubscriptions.ts # Subscription registration
│   ├── VscodeStatusNotifier.ts   # VS Code notification adapter
│   └── contextKeys.ts            # Context key helpers
├── commands/                 # Command handlers organized by domain
│   ├── build/                    # Build-related command internals
│   │   ├── BuildArtifactHandlers.ts
│   │   ├── BuildCommandHandlers.ts
│   │   └── BuildCommandTypes.ts
│   ├── environment/              # Environment management
│   │   ├── EnvironmentCommandHandlers.ts
│   │   ├── EnvironmentCommandTypes.ts
│   │   └── EnvironmentPrompts.ts
│   ├── job/                       # Job-specific commands
│   │   └── JobCommandHandlers.ts
│   ├── pin/                       # Pin/unpin commands
│   │   ├── PinCommandHandlers.ts
│   │   └── PinCommandTypes.ts
│   ├── queue/                    # Queue operations
│   │   ├── QueueCommandHandlers.ts
│   │   └── QueueCommandTypes.ts
│   ├── watch/                    # Watch/poll operations
│   │   ├── WatchCommandHandlers.ts
│   │   └── WatchCommandTypes.ts
│   ├── BuildCommands.ts          # Build command registration
│   ├── CommandUtils.ts           # Shared command utilities
│   ├── EnvironmentCommands.ts    # Environment command registration
│   ├── JobCommands.ts            # Job command registration
│   ├── PinCommands.ts            # Pin command registration
│   ├── QueueCommands.ts          # Queue command registration
│   ├── RefreshCommands.ts        # Refresh command registration
│   ├── SearchCommands.ts         # Go to Job command registration
│   └── WatchCommands.ts          # Watch command registration
├── jenkins/                  # Jenkins API layer
│   ├── auth.ts                   # Auth header helpers
│   ├── crumbs.ts                 # CSRF crumb support
│   ├── request.ts                # Request orchestration
│   ├── urls.ts                   # URL building helpers
│   ├── JenkinsClient.ts          # Client facade
│   ├── JenkinsClientProvider.ts  # Client factory per environment
│   ├── JenkinsDataService.ts     # Cached data access layer
│   ├── JenkinsEnvironmentRef.ts  # Environment reference interface
│   ├── JenkinsTestReportOptions.ts # Test report options
│   ├── errors.ts                 # Request error class
│   ├── types.ts                  # Jenkins API types
│   ├── client/                   # HTTP client and API modules
│   │   ├── JenkinsBuildsApi.ts       # Build endpoints
│   │   ├── JenkinsClientContext.ts   # Request context
│   │   ├── JenkinsHttpClient.ts      # HTTP abstraction
│   │   ├── JenkinsJobsApi.ts         # Job endpoints
│   │   ├── JenkinsNodesApi.ts        # Node endpoints
│   │   ├── JenkinsParameters.ts      # Build parameter helpers
│   │   └── JenkinsQueueApi.ts        # Queue endpoints
│   ├── data/                     # Data layer utilities
│   │   ├── AsyncQueue.ts             # Async work queue
│   │   ├── JobSearchBackoff.ts       # Job search backoff
│   │   ├── JobSearchCancellation.ts  # Job search cancellation
│   │   ├── JobSearchConfig.ts        # Job search config
│   │   ├── JenkinsDataCache.ts       # LRU cache with TTL
│   │   ├── JenkinsDataErrors.ts      # Error transformation
│   │   ├── JenkinsDataTypes.ts       # Data-layer types
│   │   └── JenkinsJobIndex.ts        # Job search index
│   └── pipeline/                 # Pipeline stage adapters and types
│       ├── JenkinsPipelineAdapter.ts
│       └── PipelineTypes.ts
├── tree/                     # Tree view components
│   ├── BuildTooltips.ts          # Build tooltip formatting
│   ├── TreeChildren.ts           # Child loading logic
│   ├── TreeDataProvider.ts       # TreeDataProvider implementation
│   ├── TreeFilter.ts             # Job filtering
│   ├── TreeFilterKeys.ts         # Filter key helpers
│   ├── TreeItems.ts              # TreeItem subclasses
│   ├── TreeNavigator.ts          # Tree reveal helpers
│   ├── TreeRevealResolver.ts     # Tree reveal resolution
│   ├── TreeTypes.ts              # Tree element types
│   └── formatters.ts             # Display formatting
├── storage/                  # Persistence layer
│   ├── JenkinsEnvironmentStore.ts    # Environment CRUD
│   ├── JenkinsWatchStore.ts          # Watch list persistence
│   └── JenkinsViewStateStore.ts      # UI state persistence
├── panels/                   # Webview panels
│   ├── BuildDetailsPanel.ts      # Build details webview
│   └── buildDetails/             # Panel internals + React webview
├── services/                 # Shared services (artifacts, storage)
│   ├── ArtifactActionService.ts
│   ├── ArtifactFilesystem.ts
│   ├── ArtifactPathUtils.ts
│   ├── ArtifactRetrievalService.ts
│   ├── ArtifactStorageService.ts
│   ├── BuildConsoleExporter.ts
│   ├── BuildLogService.ts
│   ├── ConsoleOutputConfig.ts
│   ├── PendingInputRefreshCoordinator.ts
│   └── QueuedBuildWaiter.ts
├── ui/                       # UI handlers (artifact preview/download)
│   ├── ArtifactActionHandler.ts
│   ├── ArtifactActions.ts
│   ├── ArtifactPreviewProvider.ts
│   ├── ArtifactPreviewer.ts
│   ├── BuildLogPreviewer.ts
│   ├── JobConfigPreviewer.ts
│   ├── ParameterPrompts.ts
│   ├── PendingInputActions.ts
│   └── PreviewLifecycle.ts
├── watch/                    # Polling infrastructure
│   ├── JenkinsJobStatusEvaluator.ts
│   ├── JenkinsStatusPoller.ts    # Job status polling
│   └── StatusNotifier.ts         # Notification abstraction
├── queue/                    # Queue polling
│   └── JenkinsQueuePoller.ts
└── formatters/               # Shared formatting utilities
    ├── CompletionFormatters.ts
    └── ScopeFormatters.ts
```

### Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| `extension/` | Lifecycle, configuration, service wiring |
| `commands/` | Command registration and handlers (one file per domain) |
| `jenkins/` | All Jenkins API interaction and data access |
| `jenkins/client/` | Low-level HTTP and endpoint-specific APIs |
| `jenkins/data/` | Caching, error handling, and indexing |
| `jenkins/pipeline/` | Pipeline stage adapters and types |
| `tree/` | TreeDataProvider, TreeItems, formatting |
| `storage/` | VS Code state persistence (environments, watches, view state) |
| `panels/` | Webview panels and their rendering logic |
| `services/` | Cross-cutting services (artifact storage/actions) |
| `ui/` | UI handlers for user-facing flows (artifact preview/download) |
| `watch/` | Background polling for job status changes |
| `formatters/` | Reusable display formatting functions |

## Architecture Patterns

### Dependency Injection via Constructor

Services receive dependencies through constructors rather than importing singletons:

```typescript
export class JenkinsDataService {
  constructor(
    private readonly clientProvider: JenkinsClientProvider,
    options?: JenkinsDataServiceOptions
  ) {}
}
```

### Service Factory Pattern

The `createExtensionServices` function wires all services together:

```typescript
export function createExtensionServices(
  context: vscode.ExtensionContext,
  options: ExtensionServicesOptions
): ExtensionServices {
  const environmentStore = new JenkinsEnvironmentStore(context);
  const clientProvider = new JenkinsClientProvider(environmentStore, { ... });
  // ... wire remaining services
  return { environmentStore, clientProvider, dataService, ... };
}
```

### Facade Pattern for APIs

`JenkinsClient` composes specialized API classes:

```typescript
export class JenkinsClient {
  private readonly buildsApi: JenkinsBuildsApi;
  private readonly jobsApi: JenkinsJobsApi;
  // ... delegates to specialized APIs
}
```

### Provider Pattern

`JenkinsClientProvider` creates clients per environment on demand:

```typescript
async getClient(environment: JenkinsEnvironmentRef): Promise<JenkinsClient>
```

### Interface-Based Contracts

Use interfaces for cross-module contracts:

```typescript
export interface JenkinsEnvironmentRef {
  environmentId: string;
  scope: EnvironmentScope;
  url: string;
  username?: string;
}
```

### Disposable Pattern

Long-running resources implement `vscode.Disposable`:

```typescript
export class JenkinsStatusPoller implements vscode.Disposable {
  dispose(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }
}
```

## TypeScript Best Practices

### Type Imports

Always use `import type` for types to ensure they're stripped at compile time:

```typescript
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuild, JenkinsJob } from "../jenkins/types";
```

### Re-exporting Types

Re-export types from module entry points for cleaner imports:

```typescript
export type {
  JenkinsBuild,
  JenkinsJob,
  JenkinsNode
} from "./types";
```

### Readonly Properties

Mark properties that shouldn't change as `readonly`:

```typescript
export class JenkinsClient {
  private readonly buildsApi: JenkinsBuildsApi;
  private readonly jobsApi: JenkinsJobsApi;
}
```

### Type Guards

Use type guards for runtime type checking:

```typescript
export function isOpenExternalMessage(msg: unknown): msg is OpenExternalMessage {
  return typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).type === "openExternal";
}
```

### Union Types for Exhaustive Handling

Define union types and handle all cases:

```typescript
export type JenkinsJobKind = "folder" | "multibranch" | "pipeline" | "job" | "unknown";

export type WorkbenchTreeElement =
  | InstanceTreeItem
  | JobTreeItem
  | PipelineTreeItem
  | BuildTreeItem
  // ... exhaustive list
```

### Strict Configuration

The project uses strict TypeScript settings in `tsconfig.json`:

- `strict: true`
- `noImplicitAny: true`
- `noImplicitReturns: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`

## Error Handling Patterns

### Custom Error Classes

Create domain-specific error classes with error codes:

```typescript
export class JenkinsRequestError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class BuildActionError extends Error {
  readonly code: BuildActionErrorCode;
  readonly statusCode?: number;

  constructor(message: string, code: BuildActionErrorCode, statusCode?: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}
```

### Error Transformation

Transform low-level errors into user-friendly domain errors:

```typescript
export const toBuildActionError = (error: unknown): BuildActionError => {
  if (error instanceof JenkinsRequestError) {
    if (error.statusCode === 403) {
      return new BuildActionError(
        "Jenkins rejected the request (403). Check permissions or credentials.",
        "forbidden",
        error.statusCode
      );
    }
    // ... handle other cases
  }
  return new BuildActionError(
    error instanceof Error ? error.message : "Unexpected error.",
    "unknown"
  );
};
```

### User-Facing Error Messages

Format errors for display in notifications:

```typescript
function formatActionError(error: unknown): string {
  if (error instanceof BuildActionError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "Unknown error";
}

void vscode.window.showErrorMessage(
  `Failed to trigger build for ${label}: ${formatActionError(error)}`
);
```

## Command Handler Patterns

### Command Registration

Register commands in domain-specific files:

```typescript
export function registerBuildCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.triggerBuild",
      (item?: JobTreeItem | PipelineTreeItem) => triggerBuild(dataService, refreshHost, item)
    ),
    // ... more commands
  );
}
```

### Handler Structure

Command handlers follow this pattern:

1. Validate input
2. Show user prompts if needed
3. Execute the action
4. Show result notification
5. Trigger refresh if needed

```typescript
export async function triggerBuild(
  dataService: JenkinsDataService,
  refreshHost: BuildCommandRefreshHost,
  item?: JobTreeItem | PipelineTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select a job or pipeline to trigger.");
    return;
  }

  const label = getTreeItemLabel(item);

  try {
    const result = await dataService.triggerBuild(item.environment, item.jobUrl);
    void vscode.window.showInformationMessage(`Triggered build for ${label}.`);
    refreshHost.refreshEnvironment(item.environment.environmentId);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to trigger build for ${label}: ${formatActionError(error)}`
    );
  }
}
```

### Host/Callback Interfaces

Use host interfaces to decouple commands from UI refresh:

```typescript
export interface BuildCommandRefreshHost {
  refreshEnvironment(environmentId: string): void;
}
```

## Tree View Patterns

### TreeItem Subclasses

Create specific TreeItem subclasses with proper context values:

```typescript
export class JobTreeItem extends vscode.TreeItem {
  public readonly isWatched: boolean;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    label: string,
    public readonly jobUrl: string,
    color?: string,
    isWatched = false
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.isWatched = isWatched;
    this.contextValue = isWatched ? "jobWatched" : "jobUnwatched";
    this.description = formatJobColor(color);
    this.iconPath = new vscode.ThemeIcon("tools");
  }
}
```

### Context Values for Menus

Use descriptive `contextValue` strings for menu contributions:

- `environment` - Environment items (supports remove, refresh)
- `jobs` / `nodes` / `queueFolder` - Section headers for job, node, and queue groups
- `folder` / `multibranchFolder` - Folder items (supports branch filtering)
- `jobItem` / `pipelineItem` - Job items (supports trigger, watch/unwatch, pin)
- `watched` / `pinned` - Context flags appended to job/pipeline items
- `buildRunning` / `build` / `awaitingInput` - Build items (supports abort, view details, input)
- `artifactFolder` / `artifactItem` - Artifact folders and artifact entries
- `node` / `nodeOpenable` - Node items (openable nodes include a Jenkins URL)
- `queueItem` - Queue items (supports cancel)
- `placeholder` - Placeholder rows during loading/empty states

### Parent Tracking

Track parent relationships with a WeakMap:

```typescript
private readonly parentMap = new WeakMap<WorkbenchTreeElement, WorkbenchTreeElement | undefined>();

getParent(element: WorkbenchTreeElement): vscode.ProviderResult<WorkbenchTreeElement> {
  return this.parentMap.get(element);
}

private withParent(parent: WorkbenchTreeElement | undefined, children: WorkbenchTreeElement[]): WorkbenchTreeElement[] {
  for (const child of children) {
    this.parentMap.set(child, parent);
  }
  return children;
}
```

## Caching Patterns

### Cache with TTL and LRU Eviction

The `JenkinsDataCache` implements:

- Time-based expiration (TTL)
- LRU eviction when max entries exceeded
- Environment-scoped cache invalidation

```typescript
async getOrLoad<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
  const entry = this.getEntry<T>(key);
  if (entry) {
    return entry.value;
  }

  try {
    const result = await loader();
    this.set(key, result, ttlMs);
    return result;
  } catch (error) {
    this.cache.delete(key);
    throw error;
  }
}
```

### Cache Key Building

Use structured cache keys that include environment context:

```typescript
buildKey(environment: JenkinsEnvironmentRef, kind: string, path?: string): string {
  const envSignature = `${environment.environmentId}:${environment.url}:${environment.username ?? ""}`;
  return `${envSignature}:${kind}:${path ?? ""}`;
}
```

## Polling Patterns

### Disposable Pollers

Pollers implement Disposable and support start/stop:

```typescript
export class JenkinsStatusPoller implements vscode.Disposable {
  private intervalId: NodeJS.Timeout | undefined;
  private isPolling = false;

  start(): void {
    if (this.intervalId) {
      return;
    }
    this.intervalId = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
    void this.poll();
  }

  dispose(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
}
```

### Polling Guard

Prevent concurrent polls:

```typescript
private async poll(): Promise<void> {
  if (this.isPolling) {
    return;
  }
  this.isPolling = true;
  try {
    // ... polling logic
  } finally {
    this.isPolling = false;
  }
}
```

## Storage Patterns

### Environment Store

Uses VS Code's Memento API for persistence:

- `workspaceState` for workspace-scoped data
- `globalState` for global data
- `secrets` for sensitive tokens

```typescript
async addEnvironment(
  scope: EnvironmentScope,
  environment: JenkinsEnvironment,
  token?: string
): Promise<void> {
  const environments = await this.getEnvironments(scope);
  environments.push(environment);
  await this.saveEnvironments(scope, environments);
  if (token && token.length > 0) {
    await this.setToken(scope, environment.id, token);
  }
}
```

## Webview Patterns

### Singleton Panel

Reuse a single panel instance:

```typescript
export class BuildDetailsPanel {
  private static currentPanel: BuildDetailsPanel | undefined;

  static async show(dataService: BuildDetailsDataService, ...): Promise<void> {
    if (!BuildDetailsPanel.currentPanel) {
      const panel = vscode.window.createWebviewPanel(...);
      BuildDetailsPanel.currentPanel = new BuildDetailsPanel(panel);
    }
    const activePanel = BuildDetailsPanel.currentPanel;
    activePanel.panel.reveal(undefined, true);
    await activePanel.load(dataService, ...);
  }
}
```

### Load Token Pattern

Track which load is current to handle race conditions:

```typescript
private loadToken = 0;

private async load(...): Promise<void> {
  const token = ++this.loadToken;
  // ... load data
  if (token !== this.loadToken) {
    return; // Another load started, discard results
  }
  // ... use results
}
```

### Message Passing

Type-safe message passing between webview and extension:

```typescript
interface OpenExternalMessage {
  type: "openExternal";
  url: string;
}

function isOpenExternalMessage(msg: unknown): msg is OpenExternalMessage {
  return typeof msg === "object" && msg !== null && 
         (msg as Record<string, unknown>).type === "openExternal";
}
```

## Build, Lint, and Development Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install dev dependencies |
| `npm run compile` | Build webview bundle then TypeScript into `out/` |
| `npm run watch` | Watch webview bundle + `tsc -watch` |
| `npm run build:webview` | Bundle the React build details webview via `scripts/build-webview.mjs` |
| `npm run watch:webview` | Watch mode for webview assets |
| `npm run lint` | Run Biome linter for `src/` |
| `npm run lint:fix` | Apply Biome lint autofixes |
| `npm run format` | Format all files with Biome |
| `npm run format:check` | Check formatting without changes |
| `npm run check` | Run Biome lint + format check together |
| `npm run check:fix` | Apply all Biome autofixes (lint + format) |
| `npm run vscode:prepublish` | Compile for packaging/prepublish checks |
| Press `F5` | Launch Extension Development Host |

## Coding Style & Naming Conventions

### Biome Configuration

The project uses Biome with these settings:

- 2-space indentation
- Double quotes
- Semicolons required
- No trailing commas
- Arrow function parentheses always
- 100 character line width
- Organized imports

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Classes | PascalCase | `JenkinsDataService` |
| Interfaces | PascalCase | `JenkinsEnvironmentRef` |
| Type aliases | PascalCase | `WorkbenchTreeElement` |
| Functions | camelCase | `triggerBuild` |
| Variables | camelCase | `environmentStore` |
| Constants | SCREAMING_SNAKE_CASE | `DEFAULT_CACHE_TTL_SECONDS` |
| Files | PascalCase for classes | `JenkinsClient.ts` |
| Files | camelCase for utilities | `formatters.ts` |

### File Organization

- One primary export per file
- File name matches primary export
- Types can be in separate `*Types.ts` files or colocated
- Handlers, types, and utilities separated in command subdirectories

### Code Style Rules

- Always use braces for control statements
- Avoid comments unless necessary for business rules or complex logic
- Use `void` for fire-and-forget promises: `void vscode.window.showMessage(...)`
- Prefer `async/await` over Promise chains
- Use optional chaining and nullish coalescing

## Testing Guidelines

- No automated test framework is currently configured
- If adding tests, place them under `test/` or colocated with source as `*.test.ts`
- Name tests with clear intent: `TreeDataProvider.test.ts`
- Document how to run tests in this file

## Manual Smoke Test Checklist

1. Run `npm run compile`, then `F5` to start the Extension Development Host
2. Open the Jenkins Workbench view and add an environment (workspace + global)
3. Confirm jobs/nodes load and that removing an environment clears it from the tree
4. If auth is needed, verify token storage and reloading works after reload
5. Trigger a build and verify the notification and tree refresh
6. Watch a job and confirm polling notifications work
7. Open build details and verify log streaming for running builds
8. Preview or download a build artifact from the tree
9. Pin and unpin a job or pipeline and confirm ordering

## Commit & Pull Request Guidelines

- Follow Conventional Commits: `type(scope): message`
  - `feat(extension): add job status icons`
  - `fix(tree): handle missing job color`
  - `refactor(jenkins): extract HTTP client`
  - `chore(build): bump typescript`
- PRs should include:
  - A concise summary of behavior changes
  - Linked issue or task if available
  - Screenshots or short clips for UI updates
  - Notes on commands run (e.g., `npm run compile`, `npm run lint`)

## Configuration & Security Notes

- The extension target is VS Code `^1.85.0`; confirm API usage matches this range
- Never hard-code credentials
- Environment metadata is stored in `workspaceState`/`globalState`
- API tokens are stored in VS Code SecretStorage (encrypted by VS Code)
- All network requests go through `JenkinsHttpClient` with proper auth headers
- CSRF crumbs are handled automatically with retry logic

## Adding New Features

### Adding a New Command

1. Add command definition to `package.json` under `contributes.commands`
2. Add menu contribution if needed under `contributes.menus`
3. Create handler in appropriate `src/commands/*` directory
4. Register command in the corresponding `*Commands.ts` file
5. Add handler to `ExtensionCommands.ts` if it needs cross-cutting dependencies

### Adding a New Tree Item Type

1. Create TreeItem subclass in `src/tree/TreeItems.ts`
2. Add to `WorkbenchTreeElement` union type
3. Add rendering logic in `TreeChildren.ts`
4. Define `contextValue` for menu contributions

### Adding a New Jenkins API Endpoint

1. Add response types to `src/jenkins/types.ts`
2. Add method to appropriate API class in `src/jenkins/client/`
3. Expose through `JenkinsClient` facade
4. Add cached accessor in `JenkinsDataService` if caching is needed

### Adding a New Configuration Setting

1. Add property to `package.json` under `contributes.configuration.properties`
2. Add accessor function in `src/extension/ExtensionConfig.ts`
3. Wire into services during activation if needed
