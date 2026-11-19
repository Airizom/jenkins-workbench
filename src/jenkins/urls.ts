import { collectAssignedLabelNames } from "./labels";
import { isJenkinsBuildPermalink, type JenkinsNode } from "./types";

export interface ParsedJobUrl {
  parentUrl: string;
  jobName: string;
  fullPath: string[];
}

/** A reported URL may use Jenkins' internal root. A configured URL already identifies its public endpoint. */
export type JenkinsBuildUrlSource = "reported" | "configured";

export interface ParsedBuildUrl {
  jobUrl: string;
  buildNumber: number;
}

const BUILD_NUMBER_PATTERN = /^\d+$/;
const QUEUE_ITEM_ID_PATTERN = /^\d+$/;
const RELATIVE_URL_BASE = "https://jenkins.invalid/";
const AUTH_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "login",
  "loginentry",
  "loginerror",
  "securityrealm",
  "j_acegi_security_check",
  "j_security_check"
]);

export function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

/**
 * Moves a stored URL from one of an environment's previous base URLs onto its new base.
 * The longest matching old base wins, so moving `https://h/jenkins/` up to `https://h/` still
 * rewrites `https://h/jenkins/job/a/`. Returns undefined when the URL needs no change: it belongs
 * to none of the old bases, or it already sits under the new base more specifically than under
 * any old base (which keeps `https://h/` -> `https://h/jenkins/` from double-prefixing).
 */
export function rebaseEnvironmentUrl(
  url: string,
  oldBases: readonly string[],
  newBase: string
): string | undefined {
  const target = ensureTrailingSlash(newBase);
  let source: string | undefined;
  for (const oldBase of oldBases) {
    const candidate = ensureTrailingSlash(oldBase);
    if (
      candidate !== target &&
      url.startsWith(candidate) &&
      candidate.length > (source?.length ?? -1)
    ) {
      source = candidate;
    }
  }
  if (!source || (url.startsWith(target) && target.length >= source.length)) {
    return undefined;
  }
  return target + url.slice(source.length);
}

/** The URL's origin (`scheme://host[:port]`), or undefined when it does not parse. */
export function getUrlOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Removes embedded `user:password@` credentials from a URL; other parts are kept as-is. */
export function stripUrlCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) {
      return url;
    }
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Like `stripUrlCredentials`, but only for http(s) URLs; an SSH `git@host:` user is kept. */
export function stripHttpUrlCredentials(url: string): string {
  return /^https?:\/\//i.test(url) ? stripUrlCredentials(url) : url;
}

export function normalizeJenkinsUrlForComparison(value: string, baseUrl?: string): string {
  try {
    const url = new URL(value, baseUrl && ensureTrailingSlash(baseUrl));
    url.search = "";
    url.hash = "";
    url.pathname = ensureTrailingSlash(url.pathname);
    return url.toString();
  } catch {
    return ensureTrailingSlash(value.split(/[?#]/, 1)[0] ?? value);
  }
}

export function parseQueueItemId(queueLocation?: string): number | undefined {
  if (!queueLocation || queueLocation.trim() !== queueLocation) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(queueLocation, RELATIVE_URL_BASE);
  } catch {
    return undefined;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }

  const pathParts = url.pathname.split("/").filter((part) => part.length > 0);
  if (
    pathParts.length < 3 ||
    pathParts[pathParts.length - 3] !== "queue" ||
    pathParts[pathParts.length - 2] !== "item"
  ) {
    return undefined;
  }

  const idPart = pathParts[pathParts.length - 1];
  if (!QUEUE_ITEM_ID_PATTERN.test(idPart)) {
    return undefined;
  }

  const queueItemId = Number(idPart);
  return Number.isSafeInteger(queueItemId) && queueItemId > 0 ? queueItemId : undefined;
}

/** Number of leading path parts that belong to the environment's context path (e.g. "/jenkins"). */
export function getContextPathLength(
  pathParts: readonly string[],
  environmentUrl?: string
): number {
  if (!environmentUrl) {
    return 0;
  }
  try {
    const contextParts = new URL(environmentUrl).pathname
      .split("/")
      .filter((part) => part.length > 0);
    return contextParts.every((part, index) => pathParts[index] === part) ? contextParts.length : 0;
  } catch {
    return 0;
  }
}

/** Read classic Jenkins job/view pairs, stopping before a run number or subpage. */
export function parseClassicJobPath(pathParts: readonly string[], startIndex: number) {
  let index = startIndex;
  let firstJobIndex: number | undefined;
  let jobEnd = index;
  const segments: string[] = [];
  while (index + 1 < pathParts.length) {
    const kind = pathParts[index];
    if (kind !== "job" && kind !== "view") break;
    if (kind === "job") {
      try {
        segments.push(decodeURIComponent(pathParts[index + 1]));
      } catch {
        return undefined;
      }
      firstJobIndex ??= index;
      jobEnd = index + 2;
    }
    index += 2;
  }
  return firstJobIndex === undefined ? undefined : { firstJobIndex, jobEnd, segments };
}

function findJobRoute(parts: readonly string[], start: number): number {
  for (let i = start; i < parts.length; i++) {
    if (parts[i] === "plugin") {
      // Jenkins delegates this namespace to plugins. A later "job" belongs to the plugin.
      return -1;
    }
    if (parts[i] === "user" && parts[i + 2] === "my-views") {
      i += 2;
    } else if (parts[i] === "job" || parts[i] === "view") {
      return i;
    }
  }
  return -1;
}

export function publicJobRouteStart(parts: readonly string[], start: number): number {
  let route = start;
  if (parts[start] === "me" && parts[start + 1] === "my-views") route += 2;
  else if (parts[start] === "user" && parts[start + 2] === "my-views") route += 3;
  return parts[route] === "job" || parts[route] === "view" ? route : -1;
}

type ItemPathKind = "task" | "run" | "subpage";

function matchesItemPath(parts: readonly string[], end: number, kind: ItemPathKind): boolean {
  if (kind === "subpage") return true;
  const remaining = parts.length - end;
  if (kind === "task")
    return remaining === 0 || (remaining === 1 && isProjectChildSegment(parts[end]));
  return (
    (remaining === 1 || (remaining === 2 && isProjectChildSegment(parts[end]))) &&
    BUILD_NUMBER_PATTERN.test(parts[parts.length - 1])
  );
}

const UNRESOLVABLE_ITEM = Symbol("ambiguous route or build subpage");

type JobPath = ReturnType<typeof parseClassicJobPath>;
type JobPathMatch = JobPath | typeof UNRESOLVABLE_ITEM;

function combineJobPaths(first: JobPathMatch, second: JobPathMatch): JobPathMatch {
  if (first === UNRESOLVABLE_ITEM || second === UNRESOLVABLE_ITEM) return UNRESOLVABLE_ITEM;
  if (!first || !second) return first ?? second;
  return first.jobEnd === second.jobEnd &&
    first.segments.length === second.segments.length &&
    first.segments.every((segment, i) => segment === second.segments[i])
    ? first
    : UNRESOLVABLE_ITEM;
}

function buildSubpageSelector(parts: readonly string[], jobEnd: number): number | undefined {
  const child = parts[jobEnd];
  const selector = jobEnd + (child && isProjectChildSegment(child) ? 1 : 0);
  return selector < parts.length - 1 &&
    (BUILD_NUMBER_PATTERN.test(parts[selector]) || isJenkinsBuildPermalink(parts[selector]))
    ? selector
    : undefined;
}

function findMatchingJobPath(
  parts: readonly string[],
  start: number,
  kind: ItemPathKind,
  context: "configured" | "public-root" | "internal",
  routeStartLimit = parts.length
) {
  let result: JobPathMatch;
  let end = routeStartLimit;
  // Once a run is identified, route discovery can still compare possible job
  // boundaries before it, but artifact paths and other run subpages are opaque.
  const consider = (job: JobPath): boolean => {
    // A view pair in the configured prefix cannot turn a later job token inside
    // an opaque public route into a classic job. The job itself must be in scope.
    if (!job || job.firstJobIndex >= routeStartLimit) return false;
    const selector = buildSubpageSelector(parts, job.jobEnd);
    if (selector !== undefined) {
      end = Math.min(end, selector);
      if (kind !== "subpage") {
        result = UNRESOLVABLE_ITEM;
        return false;
      }
    }
    if (!matchesItemPath(parts, job.jobEnd, kind)) return false;
    result = combineJobPaths(result, job);
    return true;
  };
  let route = findJobRoute(parts, start);
  while (route >= 0 && route < end) {
    const job = parseClassicJobPath(parts, route);
    const matched = consider(job);
    if (
      (context === "internal" || !job || (context === "public-root" && !matched)) &&
      (kind !== "subpage" || !matched) &&
      publicJobRouteStart(parts, route + 1) >= 0
    ) {
      const nextRoute = findJobRoute(parts, route + 1);
      if (nextRoute >= 0 && nextRoute < end) consider(parseClassicJobPath(parts, nextRoute));
    }
    if (job || parts[route] !== "view") break;
    // A prefix such as /view/team/jenkins/ contained no job. Keep looking after
    // that view, but never descend into an identified job's artifact or subpage.
    route = findJobRoute(parts, route + 2);
  }
  return result;
}

function matchClassicJobPath(
  sourceOrigin: string | undefined,
  parts: readonly string[],
  environmentUrl?: string,
  kind: ItemPathKind = "subpage"
) {
  const context = classifyJobPath(sourceOrigin, parts, environmentUrl);
  if (!context) return undefined;
  const {
    offset,
    sameOrigin,
    withinPublicContext,
    atPublicBase,
    publicRoute,
    startsClassic,
    opaquePublicPath,
    publicContext
  } = context;
  const afterContext =
    !atPublicBase || startsClassic
      ? findMatchingJobPath(parts, offset, kind, publicContext)
      : undefined;
  if (afterContext === UNRESOLVABLE_ITEM) return UNRESOLVABLE_ITEM;
  if (atPublicBase && kind !== "subpage" && startsWithViewAction(parts, publicRoute))
    return undefined;
  // General references include user-entered settings and bare run-parameter names.
  // Interpret them only within the configured controller when its public origin is known.
  if (withinPublicContext && kind === "subpage") return afterContext;

  const sharedContext = offset && startsClassic ? afterContext : undefined;
  if (sameOrigin && sharedContext) return sharedContext;

  const fromInternal = findMatchingJobPath(
    parts,
    0,
    kind,
    withinPublicContext ? publicContext : "internal",
    opaquePublicPath ? offset : parts.length
  );
  return selectJobPath(sharedContext, fromInternal, kind);
}

function classifyJobPath(
  sourceOrigin: string | undefined,
  parts: readonly string[],
  environmentUrl?: string
) {
  const offset = getContextPathLength(parts, environmentUrl);
  const sameOrigin = environmentUrl && sourceOrigin === getUrlOrigin(environmentUrl);
  const publicPath = environmentUrl && (offset > 0 || new URL(environmentUrl).pathname === "/");
  const withinPublicContext = sameOrigin && publicPath;
  const atPublicBase = publicPath && (sameOrigin || sourceOrigin === undefined);
  const publicRoute = publicJobRouteStart(parts, offset);
  const startsClassic = publicRoute >= 0;
  // Public URLs below an opaque route retain their full path. Only a job/view marker
  // in the context itself can justify trying the controller's alternate root.
  const opaquePublicPath = atPublicBase && !startsClassic;
  if (opaquePublicPath && (parts[offset] === "plugin" || offset === 0)) {
    return undefined;
  }
  const publicContext: "public-root" | "configured" =
    withinPublicContext && offset === 0 ? "public-root" : "configured";
  return {
    offset,
    sameOrigin,
    withinPublicContext,
    atPublicBase,
    publicRoute,
    startsClassic,
    opaquePublicPath,
    publicContext
  };
}

function startsWithViewAction(parts: readonly string[], route: number): boolean {
  // A public view action owns its subtree, including any later job markers.
  if (route < 0) return false;
  let action = route;
  while (parts[action] === "view" && action + 1 < parts.length) action += 2;
  return action > route && action < parts.length && parts[action] !== "job";
}

function selectJobPath(
  sharedContext: JobPath | undefined,
  fromInternal: JobPathMatch,
  kind: ItemPathKind
) {
  if (fromInternal === UNRESOLVABLE_ITEM) return UNRESOLVABLE_ITEM;
  if (!fromInternal) return sharedContext;
  if (!sharedContext) return fromInternal;

  if (kind === "subpage" && sharedContext.jobEnd !== fromInternal.jobEnd) {
    return sharedContext.jobEnd > fromInternal.jobEnd ? sharedContext : fromInternal;
  }
  return combineJobPaths(sharedContext, fromInternal);
}

export function resolveClassicJobPath(
  sourceOrigin: string,
  parts: readonly string[],
  environmentUrl: string,
  source: JenkinsBuildUrlSource = "reported"
) {
  if (source === "configured") {
    const start = publicJobRouteStart(parts, getContextPathLength(parts, environmentUrl));
    return start >= 0 ? parseClassicJobPath(parts, start) : undefined;
  }
  const job = matchClassicJobPath(sourceOrigin, parts, environmentUrl);
  return job === UNRESOLVABLE_ITEM ? undefined : job;
}

function isPathRelativeItemUrl(itemUrl: string): boolean {
  return !/^([a-z][a-z\d+.-]*:|[\\/])/i.test(itemUrl.trimStart());
}

function parseItemLocation(
  itemUrl: string,
  environmentUrl?: string,
  kind: ItemPathKind = "subpage",
  source: JenkinsBuildUrlSource = "reported"
) {
  try {
    const url = new URL(itemUrl, environmentUrl && ensureTrailingSlash(environmentUrl));
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const parts = url.pathname.split("/").filter(Boolean);
    // A path-relative reference starts at the configured base. Likewise a confirmed
    // public URL must never be reinterpreted as a Jenkins-reported internal route.
    const pathRelative = isPathRelativeItemUrl(itemUrl);
    if (environmentUrl && (pathRelative || source === "configured")) {
      return parseConfiguredItemLocation(url, parts, environmentUrl, kind);
    }
    // A root-relative Location can come from either side of a reverse proxy. Its
    // inherited URL origin gives us no evidence about the controller's context path.
    const sourceOrigin = /^\/(?!\/)/.test(itemUrl.trimStart()) ? undefined : url.origin;
    const job = matchClassicJobPath(sourceOrigin, parts, environmentUrl, kind);
    if (job === UNRESOLVABLE_ITEM) return UNRESOLVABLE_ITEM;
    return job ? { url, parts, job } : undefined;
  } catch {
    return undefined;
  }
}

function parseConfiguredItemLocation(
  url: URL,
  parts: readonly string[],
  environmentUrl: string,
  kind: ItemPathKind
) {
  if (
    !normalizeJenkinsUrlForComparison(url.href).startsWith(
      normalizeJenkinsUrlForComparison(environmentUrl)
    )
  )
    return undefined;
  const start = publicJobRouteStart(parts, getContextPathLength(parts, environmentUrl));
  if (start < 0) return undefined;
  const job = parseClassicJobPath(parts, start);
  if (!job) return undefined;
  if (kind !== "subpage" && buildSubpageSelector(parts, job.jobEnd) !== undefined)
    return UNRESOLVABLE_ITEM;
  return matchesItemPath(parts, job.jobEnd, kind) ? { url, parts, job } : undefined;
}

function appendJobPathSegments(baseUrl: string, segments: readonly string[]): string {
  let url = ensureTrailingSlash(baseUrl);
  for (let index = 0; index < segments.length; index++) {
    url += `job/${encodeURIComponent(segments[index])}/`;
  }
  return url;
}

/** Job path for messages, for example "folder/my-job"; falls back to the URL. */
export function formatJobUrlLabel(jobUrl: string, environmentUrl?: string): string {
  return parseJobUrl(jobUrl, environmentUrl)?.fullPath.join("/") ?? jobUrl;
}

/** Existing Jenkins commands extract literal job/name pairs from the advertised path.
 * Servlet prefixes can contain words such as "view" without denoting a Jenkins view. */
function parseCommandJobPath(parts: readonly string[], url: URL, environmentUrl?: string) {
  const start = getContextPathLength(parts, environmentUrl);
  const publicJob = parsePublicCommandJob(parts, url, start, environmentUrl);
  if (publicJob) return publicJob;
  const segments: string[] = [];
  let firstJobIndex = -1;
  let jobEnd = start;
  for (let i = start; i + 1 < parts.length; i++) {
    if (parts[i] !== "job") continue;
    if (firstJobIndex < 0) firstJobIndex = i;
    segments.push(decodeURIComponent(parts[++i]));
    jobEnd = i + 1;
  }
  if (segments.length && !matchesItemPath(parts, jobEnd, "task")) {
    // A literal "job" may itself be a view name. Prefer a complete classic route
    // over a truncated name only when the reported path identifies one.
    const classic = findMatchingJobPath(parts, start, "task", "internal");
    if (classic && classic !== UNRESOLVABLE_ITEM) return classic;
  }
  return segments.length ? { firstJobIndex, jobEnd, segments } : undefined;
}

function parsePublicCommandJob(
  parts: readonly string[],
  url: URL,
  start: number,
  environmentUrl?: string
) {
  // A "job" view name belongs to the route when the controller context is known.
  const configured = environmentUrl && new URL(environmentUrl);
  if (!configured || url.origin !== configured.origin) return undefined;
  if (start === 0 && configured.pathname !== "/") return undefined;
  const route = publicJobRouteStart(parts, start);
  const job = route >= 0 ? parseClassicJobPath(parts, route) : undefined;
  return job && matchesItemPath(parts, job.jobEnd, "task") ? job : undefined;
}

export function parseJobUrl(
  jobUrl: string,
  environmentUrl?: string,
  source: JenkinsBuildUrlSource = "reported"
): ParsedJobUrl | undefined {
  try {
    const url = new URL(jobUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    let job: ReturnType<typeof parseCommandJobPath>;
    if (source === "configured") {
      const location = parseItemLocation(jobUrl, environmentUrl, "subpage", source);
      if (!location || location === UNRESOLVABLE_ITEM) return undefined;
      job = location.job;
    } else {
      job = parseCommandJobPath(parts, url, environmentUrl);
    }
    if (!job) return undefined;
    const prefix = parts.slice(0, job.firstJobIndex).join("/");
    const base = prefix ? `${url.origin}/${prefix}/` : `${url.origin}/`;
    return {
      parentUrl: appendJobPathSegments(base, job.segments.slice(0, -1)),
      jobName: job.segments[job.segments.length - 1],
      fullPath: job.segments
    };
  } catch {
    return undefined;
  }
}

export function buildJobUrl(parentUrl: string, jobName: string): string {
  return appendJobPathSegments(parentUrl, [jobName]);
}

export function buildViewScopedJobUrl(
  viewUrl: string,
  jobUrl: string,
  environmentUrl?: string
): string {
  const parsed = parseJobUrl(jobUrl, environmentUrl);
  if (!parsed) {
    return jobUrl;
  }

  return appendJobPathSegments(viewUrl, parsed.fullPath);
}

export function canonicalizeJobUrlForEnvironment(
  environmentUrl: string,
  jobUrl: string
): string | undefined {
  const parsed = parseJobUrl(jobUrl, environmentUrl);
  if (!parsed) {
    return undefined;
  }

  return appendJobPathSegments(environmentUrl, parsed.fullPath);
}

/** The number-only queue fallback requires a job URL with no run, view or subpage suffix. */
export function resolveExactJobUrlForEnvironment(
  environmentUrl: string,
  jobUrl: string,
  purpose: "request" | "comparison" = "request"
) {
  // A proxy-internal path may denote either a plain job or a project child. Resolve the
  // task before testing whether it can supply the missing executable URL.
  const location = parseItemLocation(jobUrl, environmentUrl, "task");
  if (!location || location === UNRESOLVABLE_ITEM || location.job.jobEnd !== location.parts.length)
    return undefined;
  return purpose === "request" && isPathRelativeItemUrl(jobUrl)
    ? normalizeJenkinsUrlForComparison(location.url.href)
    : appendJobPathSegments(environmentUrl, location.job.segments);
}

/** Matrix configurations and Maven modules are jobs addressed directly below their project. */
export function isProjectChildSegment(segment: string): boolean {
  try {
    const decoded = decodeURIComponent(segment);
    return (
      /^[A-Za-z0-9_.-]+\$[A-Za-z0-9_.-]+$/.test(decoded) ||
      segment.split(",").every((axis) => decodeURIComponent(axis).indexOf("=") > 0)
    );
  } catch {
    return false;
  }
}

/** A queue label may identify a project child even when a number alone cannot establish the run. */
export function formatQueueTaskUrlLabel(
  environmentUrl: string,
  taskUrl: string
): string | undefined {
  const location = parseItemLocation(taskUrl, environmentUrl, "task");
  if (!location || location === UNRESOLVABLE_ITEM) return undefined;
  const child = location.parts[location.job.jobEnd];
  const project = location.job.segments.join("/");
  return child ? `${project}/${decodeURIComponent(child)}` : project;
}

function parseRunLocation(
  buildUrl: string,
  environmentUrl?: string,
  source?: JenkinsBuildUrlSource
) {
  const location = parseItemLocation(buildUrl, environmentUrl, "run", source);
  if (!location || location === UNRESOLVABLE_ITEM) return location;
  const buildNumber = Number(location.parts.at(-1));
  if (!Number.isSafeInteger(buildNumber) || buildNumber <= 0) return undefined;
  const projectChild =
    location.parts.length === location.job.jobEnd + 2
      ? location.parts[location.job.jobEnd]
      : undefined;
  return { ...location, projectChild, buildNumber };
}

/**
 * Existing build commands use the numbered URL Jenkins advertised. Preserve its literal
 * parent for job requests and collect job names for actions rooted at the configured server.
 * An advertised servlet/plugin prefix may itself be unreachable from the client.
 */
function parseCommandBuildPath(buildUrl: string, environmentUrl?: string) {
  try {
    const url = new URL(buildUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const number = parts.pop();
    if (!number || !BUILD_NUMBER_PATTERN.test(number) || url.origin === "null") return undefined;
    const buildNumber = Number(number);
    if (!Number.isFinite(buildNumber)) return undefined;
    const job = parseCommandJobPath(parts, url, environmentUrl);
    if (!job) return undefined;
    // Legacy command URLs end in a literal job/name pair. Project children use
    // their own advertised endpoints and can add a matrix or Maven segment.
    const classic = parts.at(-2) === "job";
    const child = classic ? undefined : parts.at(-1);
    if (!classic && (!child || !isProjectChildSegment(child))) return undefined;
    if (child && parts.at(-3) !== "job") return undefined;
    return { jobUrl: `${url.origin}/${parts.join("/")}/`, buildNumber, names: job.segments, child };
  } catch {
    return undefined;
  }
}

export function parseBuildUrl(
  buildUrl: string,
  environmentUrl?: string
): ParsedBuildUrl | undefined {
  const build = parseCommandBuildPath(buildUrl, environmentUrl);
  return build && { jobUrl: build.jobUrl, buildNumber: build.buildNumber };
}

/** Resolve an exact numbered run on the configured controller, preserving its project child path. */
export function resolveBuildIdentityForEnvironment(
  environmentUrl: string,
  buildUrl: string,
  purpose: "request" | "comparison" | "share" = "request",
  knownRun?: { buildNumber: number; label?: string },
  source: JenkinsBuildUrlSource = "reported"
) {
  const run = parseRunLocation(buildUrl, environmentUrl, source);
  if (run === UNRESOLVABLE_ITEM) return undefined;
  if (!run) return resolveCustomRunIdentity(environmentUrl, buildUrl, knownRun);
  const projectUrl = appendJobPathSegments(environmentUrl, run.job.segments);
  const childLabel = run.projectChild && decodeURIComponent(run.projectChild);
  const childSegment =
    childLabel && purpose === "comparison" ? encodeURIComponent(childLabel) : run.projectChild;
  const jobUrl = childSegment ? `${projectUrl}${childSegment}/` : projectUrl;
  const jobLabel = run.job.segments.join("/");
  const label = childLabel ? `${jobLabel}/${childLabel}` : jobLabel;
  return {
    buildUrl:
      purpose === "request" && (source === "configured" || isPathRelativeItemUrl(buildUrl))
        ? normalizeJenkinsUrlForComparison(run.url.href)
        : buildActionUrl(jobUrl, `${run.buildNumber}/`),
    buildNumber: run.buildNumber,
    label: `${label} #${run.buildNumber}`
  };
}

function resolveCustomRunIdentity(
  environmentUrl: string,
  buildUrl: string,
  knownRun?: { buildNumber: number; label?: string }
) {
  // Plugins can supply other numbered run routes. The reported number and the
  // full public controller base must corroborate such a URL before it is followed.
  if (!knownRun || !Number.isSafeInteger(knownRun.buildNumber) || knownRun.buildNumber <= 0)
    return undefined;
  const url = normalizeJenkinsUrlForComparison(buildUrl, environmentUrl);
  if (
    !url.startsWith(normalizeJenkinsUrlForComparison(environmentUrl)) ||
    !url.endsWith(`/${knownRun.buildNumber}/`)
  )
    return undefined;
  return {
    buildUrl: url,
    buildNumber: knownRun.buildNumber,
    label: knownRun.label ?? `#${knownRun.buildNumber}`
  };
}

export function canonicalizeBuildUrlForEnvironment(
  environmentUrl: string,
  buildUrl: string
): string | undefined {
  const build = parseCommandBuildPath(buildUrl, environmentUrl);
  // Command callers use the advertised URL for project children, whose endpoints
  // are specific to the plugin that supplied the build.
  if (!build || build.child) return undefined;
  return buildActionUrl(
    appendJobPathSegments(environmentUrl, build.names),
    `${build.buildNumber}/`
  );
}

/** Legacy build zero is usable only at a literal numbered endpoint on this controller. */
export function resolveLiteralBuildZeroUrl(
  environmentUrl: string,
  buildUrl: string,
  source: JenkinsBuildUrlSource
): string | undefined {
  const literal = normalizeJenkinsUrlForComparison(buildUrl, environmentUrl);
  if (
    !literal.startsWith(normalizeJenkinsUrlForComparison(environmentUrl)) ||
    !literal.endsWith("/0/")
  )
    return undefined;
  const configured = parseItemLocation(literal, environmentUrl, "run", "configured");
  if (configured === UNRESOLVABLE_ITEM) return undefined;
  if (source === "reported") {
    const reported = parseItemLocation(buildUrl, environmentUrl, "run");
    if (
      reported === UNRESOLVABLE_ITEM ||
      Boolean(reported) !== Boolean(configured) ||
      combineJobPaths(reported?.job, configured?.job) === UNRESOLVABLE_ITEM
    )
      return undefined;
  }
  return literal;
}

/** A mutation sends to the selected endpoint. Proven aliases share a comparison URL
 * for bulk selection and stop escalation. Ambiguous controller mounts identify neither target. */
export function resolveBuildMutationTarget(
  environmentUrl: string,
  buildUrl: string,
  buildNumber: number
): { url: string; identity: string } | undefined {
  if (buildNumber === 0) {
    const url = resolveLiteralBuildZeroUrl(environmentUrl, buildUrl, "reported");
    return url ? { url, identity: url } : undefined;
  }
  const literal = normalizeJenkinsUrlForComparison(buildUrl, environmentUrl);
  const onController = literal.startsWith(normalizeJenkinsUrlForComparison(environmentUrl));
  const known = { buildNumber };
  const run = resolveBuildIdentityForEnvironment(environmentUrl, buildUrl, "request", known);
  if (!run || run.buildNumber !== buildNumber) return undefined;
  const comparison = (url: string) =>
    resolveBuildIdentityForEnvironment(environmentUrl, url, "comparison", known, "configured")
      ?.buildUrl;
  const identity = comparison(run.buildUrl);
  if (!identity || (onController && literal !== run.buildUrl && comparison(literal) !== identity)) {
    return undefined;
  }
  return { url: run.buildUrl, identity };
}

export function buildApiUrlFromBase(baseUrl: string, path: string, tree?: string): string {
  const base = ensureTrailingSlash(baseUrl);
  const url = new URL(path, base);
  if (tree) {
    url.searchParams.set("tree", tree);
  }
  return url.toString();
}

export function buildApiUrlFromItem(itemUrl: string, tree?: string): string {
  return buildApiUrlFromBase(itemUrl, "api/json", tree);
}

export function buildActionUrl(itemUrl: string, action: string): string {
  const base = ensureTrailingSlash(itemUrl);
  const url = new URL(action, base);
  return url.toString();
}

/** The build's input page, which lists every pending input with Jenkins' own controls. */
export function buildPendingInputBrowserUrl(buildUrl: string): string {
  return buildActionUrl(buildUrl, "input/");
}

function encodePathSegments(path: string): string {
  const segments = path.split("/");
  let encodedSegmentCount = 0;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.length === 0) {
      continue;
    }
    if (segment === "." || segment === "..") {
      throw new Error("Relative paths cannot contain dot path segments.");
    }

    segments[encodedSegmentCount] = encodeURIComponent(segment);
    encodedSegmentCount++;
  }

  segments.length = encodedSegmentCount;
  return segments.join("/");
}

export function buildArtifactDownloadUrl(buildUrl: string, relativePath: string): string {
  const base = ensureTrailingSlash(buildUrl);
  const encodedPath = encodePathSegments(relativePath);
  return new URL(`artifact/${encodedPath}`, base).toString();
}

export function buildArtifactArchiveDownloadUrl(buildUrl: string): string {
  return new URL("artifact/*zip*/archive.zip", ensureTrailingSlash(buildUrl)).toString();
}

export function buildWorkspaceDirectoryListingUrl(jobUrl: string, relativePath?: string): string {
  const base = ensureTrailingSlash(jobUrl);
  const encodedPath = relativePath ? encodePathSegments(relativePath) : "";
  const workspacePath = encodedPath ? `ws/${encodedPath}/*plain*/` : "ws/*plain*/";
  return new URL(workspacePath, base).toString();
}

export function buildWorkspaceFileUrl(jobUrl: string, relativePath: string): string {
  const base = ensureTrailingSlash(jobUrl);
  const encodedPath = encodePathSegments(relativePath);
  return new URL(`ws/${encodedPath}`, base).toString();
}

export function resolveNodeUrl(baseUrl: string, node: JenkinsNode): string | undefined {
  const base = ensureTrailingSlash(baseUrl);
  let resolvedUrl: string | undefined;
  if (node.url) {
    try {
      resolvedUrl = new URL(node.url, base).toString();
    } catch {
      resolvedUrl = undefined;
    }
  }
  if (resolvedUrl) {
    return resolvedUrl;
  }

  if (node.name) {
    const nodePath = `computer/${encodeURIComponent(node.name)}/`;
    return new URL(nodePath, base).toString();
  }

  const labels = collectAssignedLabelNames(node.assignedLabels);

  if (labels.includes("built-in")) {
    return new URL("computer/(built-in)/", base).toString();
  }

  const displayName = node.displayName.trim();
  if (displayName.length > 0) {
    const match = labels.find((label) => label === displayName);
    if (match) {
      return new URL(`computer/${encodeURIComponent(match)}/`, base).toString();
    }
  }

  if (labels.length === 1) {
    return new URL(`computer/${encodeURIComponent(labels[0])}/`, base).toString();
  }

  return undefined;
}

export function isAuthRedirect(location: string, baseUrl: string): boolean {
  let target: URL;
  try {
    target = new URL(location, baseUrl);
  } catch {
    return false;
  }
  const pathParts = target.pathname.split("/").filter((part) => part.length > 0);

  for (const part of pathParts.slice(getContextPathLength(pathParts, baseUrl))) {
    if (part === "job") {
      // Everything after the first job marker belongs to item names and item actions.
      return false;
    }
    if (AUTH_PATH_SEGMENTS.has(part.toLowerCase())) {
      return true;
    }
  }
  return false;
}
