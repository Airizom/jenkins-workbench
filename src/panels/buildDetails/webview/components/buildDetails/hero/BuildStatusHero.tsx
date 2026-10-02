import * as React from "react";
import { BuildResultStatusIcon } from "../../../../../shared/webview/components/BuildResultStatusIcon";
import { ResultBadge } from "../../../../../shared/webview/components/ResultBadge";
import { Badge } from "../../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../../shared/webview/components/ui/button";
import { Progress } from "../../../../../shared/webview/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../../shared/webview/components/ui/tooltip";
import { ExternalLinkIcon } from "../../../../../shared/webview/icons";
import {
  resolveBuildResultBorderColor,
  resolveBuildResultGraphBackground,
  resolveResultBadgeClass,
  resolveResultIconTextClass,
  resolveStatusAccentClass
} from "../../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../../shared/webview/lib/utils";
import type { BuildTestsSummaryViewModel } from "../../../../shared/BuildDetailsContracts";
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

function HeroStatusGlyph({
  resultClass,
  isRunning
}: {
  resultClass: string;
  isRunning: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-xs",
        resolveResultBadgeClass(resultClass),
        isRunning && "hero-status-glyph--running"
      )}
    >
      <BuildResultStatusIcon
        status={resultClass}
        className={cn("h-6 w-6", resolveResultIconTextClass(resultClass))}
      />
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
  meta
}: {
  displayName: string;
  badgeLabel: string;
  badgeStatus: string;
  resultClass: string;
  isRunning: boolean;
  meta: HeroMetaProps;
}): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center gap-3 min-w-0">
      <HeroStatusGlyph resultClass={resultClass} isRunning={isRunning} />
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
        </div>
        <BuildDetailsMetaFields
          {...meta}
          className="hidden sm:flex items-center gap-2 mt-1 text-xs text-muted-foreground"
        />
      </div>
    </div>
  );
}

function HeroActions({
  testsSummary,
  stageCount,
  buildUrl,
  onOpenBuild
}: {
  testsSummary: BuildTestsSummaryViewModel;
  stageCount: number;
  buildUrl?: string;
  onOpenBuild: () => void;
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

type BuildStatusHeroProps = {
  displayName: string;
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
      <div className="flex items-center justify-between gap-3">
        <HeroIdentity
          displayName={props.displayName}
          badgeLabel={badge.label}
          badgeStatus={badge.status}
          resultClass={resultClass}
          isRunning={isRunning}
          meta={meta}
        />
        <HeroActions
          testsSummary={props.testsSummary}
          stageCount={props.stageCount}
          buildUrl={props.buildUrl}
          onOpenBuild={props.onOpenBuild}
        />
      </div>
      <BuildDetailsMetaFields
        idSuffix="-sm"
        {...meta}
        className="sm:hidden flex items-center gap-2 mt-2 text-xs text-muted-foreground"
      />
      {awaitingInput ? (
        <AwaitingInputBanner summary={awaitingInput} onReview={props.onReviewInputs} />
      ) : null}
    </div>
  );
}

export function BuildStatusHero(props: BuildStatusHeroProps): React.JSX.Element {
  const { loading, children, ...contentProps } = props;
  const { resultClass, isRunning } = contentProps;
  const heroRef = useStickyHeroOffset();

  return (
    <header ref={heroRef} className="sticky-header build-details-hero">
      {isRunning || loading ? (
        <Progress
          indeterminate
          aria-label={isRunning ? "Build in progress" : "Loading build details"}
          className="h-px rounded-none"
        />
      ) : null}
      <div
        style={{
          background: resolveBuildResultGraphBackground(resultClass),
          borderBottom: `1px solid ${resolveBuildResultBorderColor(resultClass)}`
        }}
      >
        <HeroContent {...contentProps} />
        {children}
      </div>
      <div className={cn("h-0.5", resolveStatusAccentClass(resultClass))} />
    </header>
  );
}
