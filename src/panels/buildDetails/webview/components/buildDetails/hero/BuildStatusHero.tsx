import * as React from "react";
import { BuildResultStatusIcon } from "../../../../../shared/webview/components/BuildResultStatusIcon";
import { ResultBadge } from "../../../../../shared/webview/components/ResultBadge";
import { Badge } from "../../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../../shared/webview/components/ui/button";
import { ClampedText } from "../../../../../shared/webview/components/ui/clamped-text";
import { Progress } from "../../../../../shared/webview/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../../shared/webview/components/ui/tooltip";
import {
  ExternalLinkIcon,
  LockIcon,
  PauseCircleIcon,
  PencilIcon,
  TrashIcon,
  UnlockIcon
} from "../../../../../shared/webview/icons";
import { resolveBuildResultStyle } from "../../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../../shared/webview/lib/utils";
import type {
  BuildNavigationViewModel,
  BuildTestsSummaryViewModel
} from "../../../../shared/BuildDetailsContracts";
import type { BuildManagementMessage } from "../../../../shared/BuildDetailsPanelMessages";
import { BuildDetailsMetaFields } from "../BuildDetailsMetaFields";
import { describeTestOutcome } from "../testResults/testResultsUtils";
import { AwaitingInputBanner, type AwaitingInputSummary } from "./AwaitingInputBanner";

const AWAITING_INPUT_LABEL = "Waiting for input";

const { useEffect, useRef } = React;

// Secondary sticky toolbars dock below the hero via this custom property.
function useStickyHeroOffset(): React.RefObject<HTMLElement | null> {
  const heroRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) {
      return;
    }
    const publishOffset = () => {
      document.documentElement.style.setProperty("--sticky-hero-offset", `${hero.offsetHeight}px`);
    };
    publishOffset();
    const observer = new ResizeObserver(publishOffset);
    observer.observe(hero);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--sticky-hero-offset");
    };
  }, []);

  return heroRef;
}

const TESTS_PILL_TONE_CLASSES = {
  failed: "border-failure-border bg-failure-soft text-failure",
  passed: "border-success-border bg-success-soft text-success",
  skipped: "border-warning-border bg-warning-soft text-warning"
} as const;

export function describeTestsPill(
  summary: BuildTestsSummaryViewModel
): { label: string; className: string } | undefined {
  if (!summary.hasAnyResults || summary.totalCount === 0) {
    return undefined;
  }
  const outcome = describeTestOutcome(summary);
  return { label: outcome.countsLabel, className: TESTS_PILL_TONE_CLASSES[outcome.tone] };
}

// A build paused on an input step is not making progress, so it drops the
// running pulse and takes the same warning tone as its "Waiting for input" badge.
const PAUSED_VISUAL_CLASS = "unstable";

function HeroStatusGlyph({
  resultClass,
  isRunning,
  paused
}: {
  resultClass: string;
  isRunning: boolean;
  paused: boolean;
}): React.JSX.Element {
  const resultStyle = resolveBuildResultStyle(paused ? PAUSED_VISUAL_CLASS : resultClass);
  const iconClassName = cn("h-6 w-6", resultStyle.iconText);
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-xs",
        resultStyle.badge,
        isRunning && !paused && "hero-status-glyph--running"
      )}
    >
      {paused ? (
        <PauseCircleIcon className={iconClassName} />
      ) : (
        <BuildResultStatusIcon status={resultClass} className={iconClassName} />
      )}
    </div>
  );
}

type HeroMetaProps = {
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
};

function HeroIdentity({
  displayName,
  badgeLabel,
  badgeStatus,
  resultClass,
  isRunning,
  paused,
  keptForever,
  meta
}: {
  displayName: string;
  badgeLabel: string;
  badgeStatus: string;
  resultClass: string;
  isRunning: boolean;
  paused: boolean;
  keptForever: boolean;
  meta: HeroMetaProps;
}): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center gap-3 min-w-0">
      <HeroStatusGlyph resultClass={resultClass} isRunning={isRunning} paused={paused} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-x-2.5 gap-y-1 min-w-0">
          <h1
            className="min-w-0 text-base sm:text-lg font-semibold leading-tight line-clamp-2 wrap-break-word"
            id="detail-title"
            title={displayName}
          >
            {displayName}
          </h1>
          <ResultBadge
            id="detail-result"
            label={badgeLabel}
            status={badgeStatus}
            className="shrink-0"
          />
          {keptForever ? (
            <Badge variant="muted" size="sm" id="detail-kept-forever" className="shrink-0">
              <LockIcon className="h-3 w-3" />
              Kept forever
            </Badge>
          ) : null}
        </div>
        {/* No dot separators: when the row wraps one would dangle at a line end,
         * and each item's icon already marks where it starts. */}
        <BuildDetailsMetaFields
          {...meta}
          showSeparators={false}
          className="hidden sm:flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground"
        />
      </div>
    </div>
  );
}

type HeroManagementProps = {
  keptForever: boolean;
  /** Keep/edit/delete need a loaded build. */
  canManage: boolean;
  /** Only completed builds can be deleted. */
  canDelete: boolean;
  /** Set while the extension handles a management request. */
  managementBusy: boolean;
  onBuildManagement: (message: BuildManagementMessage) => void;
};

/**
 * Icon-only action with a tooltip. The trigger is a wrapping span because a disabled
 * button receives no pointer or focus events, and the tooltip must still explain why
 * the action is unavailable; the span takes the tab stop only while the button is disabled.
 */
function HeroIconAction({
  label,
  tooltip,
  disabled,
  pressed,
  onClick,
  children
}: {
  label: string;
  tooltip: string;
  disabled: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex rounded-md" tabIndex={disabled ? 0 : undefined}>
          <Button
            variant="secondary"
            size="sm"
            className="px-2"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            aria-pressed={pressed}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function HeroManagementActions({
  keptForever,
  canManage,
  canDelete,
  managementBusy,
  onBuildManagement
}: HeroManagementProps): React.JSX.Element {
  const unavailable = !canManage || managementBusy;
  const keepLabel = keptForever ? "Stop keeping this build forever" : "Keep this build forever";
  const editLabel = "Edit display name or description";
  const deleteLabel = "Delete build";
  return (
    <>
      <HeroIconAction
        label={keepLabel}
        tooltip={keepLabel}
        disabled={unavailable}
        pressed={keptForever}
        onClick={() => onBuildManagement({ type: "setKeepForever", keep: !keptForever })}
      >
        {keptForever ? (
          <LockIcon className="h-3.5 w-3.5" />
        ) : (
          <UnlockIcon className="h-3.5 w-3.5" />
        )}
      </HeroIconAction>
      <HeroIconAction
        label={editLabel}
        tooltip={editLabel}
        disabled={unavailable}
        onClick={() => onBuildManagement({ type: "editBuild" })}
      >
        <PencilIcon className="h-3.5 w-3.5" />
      </HeroIconAction>
      <HeroIconAction
        label={deleteLabel}
        tooltip={canManage && !canDelete ? "Running builds can't be deleted" : deleteLabel}
        disabled={unavailable || !canDelete}
        onClick={() => onBuildManagement({ type: "deleteBuild" })}
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </HeroIconAction>
    </>
  );
}

function HeroActions({
  testsSummary,
  stageCount,
  buildUrl,
  onOpenBuild,
  management
}: {
  testsSummary: BuildTestsSummaryViewModel;
  stageCount: number;
  buildUrl?: string;
  onOpenBuild: () => void;
  management: HeroManagementProps;
}): React.JSX.Element {
  const testsPill = describeTestsPill(testsSummary);
  return (
    <div className="flex items-center gap-2 shrink-0">
      {testsPill ? (
        <Badge
          variant="outline"
          className={cn("hidden sm:inline-flex text-caption font-medium", testsPill.className)}
        >
          {testsPill.label}
        </Badge>
      ) : null}
      {stageCount > 0 ? (
        <Badge
          variant="outline"
          className="hidden sm:inline-flex text-caption font-medium border-border bg-muted-strong text-muted-foreground"
        >
          {stageCount === 1 ? "1 stage" : `${stageCount} stages`}
        </Badge>
      ) : null}
      <HeroManagementActions {...management} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            onClick={onOpenBuild}
            disabled={!buildUrl}
            aria-label="Open in Jenkins"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Open in Jenkins</span>
          </Button>
        </TooltipTrigger>
        {/* Only needed while the button is icon-only. */}
        <TooltipContent className="sm:hidden">Open in Jenkins</TooltipContent>
      </Tooltip>
    </div>
  );
}

type BuildStatusHeroProps = HeroManagementProps & {
  navigation?: BuildNavigationViewModel;
  onNavigateBuild?: (direction: "back" | "forward") => void;
  displayName: string;
  /** Plain text; rendered as text, never as HTML. */
  description?: string;
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  loading: boolean;
  isRunning: boolean;
  buildUrl?: string;
  testsSummary: BuildTestsSummaryViewModel;
  stageCount: number;
  /** Set while a running build is paused on one or more input steps. */
  awaitingInput?: AwaitingInputSummary;
  /** Omitted when the Inputs tab is already showing. */
  onReviewInputs?: () => void;
  onOpenBuild: () => void;
  children?: React.ReactNode;
};
function resolveHeroBadge(
  awaitingInput: AwaitingInputSummary | undefined,
  resultLabel: string,
  resultClass: string
): { label: string; status: string } {
  return awaitingInput
    ? { label: AWAITING_INPUT_LABEL, status: "unstable" }
    : { label: resultLabel, status: resultClass };
}

type HeroContentProps = Omit<BuildStatusHeroProps, "loading" | "children">;

function HeroContent(props: HeroContentProps): React.JSX.Element {
  const { resultClass, isRunning, awaitingInput } = props;
  const badge = resolveHeroBadge(awaitingInput, props.resultLabel, resultClass);
  const meta: HeroMetaProps = {
    durationLabel: props.durationLabel,
    timestampLabel: props.timestampLabel,
    culpritsLabel: props.culpritsLabel
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-3">
      {props.navigation && props.onNavigateBuild ? (
        <nav aria-label="Build history" className="mb-2 flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={!props.navigation.canGoBack || props.navigation.busy}
            onClick={() => props.onNavigateBuild?.("back")}
          >
            Back
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!props.navigation.canGoForward || props.navigation.busy}
            onClick={() => props.onNavigateBuild?.("forward")}
          >
            Forward
          </Button>
        </nav>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <HeroIdentity
          displayName={props.displayName}
          badgeLabel={badge.label}
          badgeStatus={badge.status}
          resultClass={resultClass}
          isRunning={isRunning}
          paused={awaitingInput !== undefined}
          keptForever={props.keptForever}
          meta={meta}
        />
        <HeroActions
          testsSummary={props.testsSummary}
          stageCount={props.stageCount}
          buildUrl={props.buildUrl}
          onOpenBuild={props.onOpenBuild}
          management={{
            keptForever: props.keptForever,
            canManage: props.canManage,
            canDelete: props.canDelete,
            managementBusy: props.managementBusy,
            onBuildManagement: props.onBuildManagement
          }}
        />
      </div>
      <BuildDetailsMetaFields
        idSuffix="-sm"
        {...meta}
        showSeparators={false}
        className="sm:hidden flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-2 text-xs text-muted-foreground"
      />
      {props.description ? (
        <ClampedText
          text={props.description}
          lines={2}
          className="mt-2"
          textClassName="whitespace-pre-line text-xs text-muted-foreground"
        />
      ) : null}
      {awaitingInput ? (
        <AwaitingInputBanner summary={awaitingInput} onReview={props.onReviewInputs} />
      ) : null}
    </div>
  );
}

export function BuildStatusHero(props: BuildStatusHeroProps): React.JSX.Element {
  const { loading, children, ...contentProps } = props;
  const { resultClass, isRunning, awaitingInput } = contentProps;
  const heroRef = useStickyHeroOffset();
  const paused = awaitingInput !== undefined;
  const resultStyle = resolveBuildResultStyle(paused ? PAUSED_VISUAL_CLASS : resultClass);
  const showActivity = (isRunning && !paused) || loading;

  return (
    <header ref={heroRef} className="sticky-header build-details-hero">
      {showActivity ? (
        <Progress
          indeterminate
          aria-label={isRunning && !paused ? "Build in progress" : "Loading build details"}
          className="h-px rounded-none"
        />
      ) : null}
      <div
        style={{
          background: resultStyle.graphBackground,
          borderBottom: `1px solid ${resultStyle.borderColor}`
        }}
      >
        <HeroContent {...contentProps} />
        {children}
      </div>
      <div className={cn("h-0.5", resultStyle.accent)} />
    </header>
  );
}
