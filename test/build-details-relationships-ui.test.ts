import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, vi } from "vitest";
import {
  type BuildDetailsUpdateMessage,
  type BuildDetailsViewModel,
  type BuildRelationshipsViewModel,
  EMPTY_BUILD_NAVIGATION,
  EMPTY_BUILD_RELATIONSHIPS
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import {
  isBuildDetailsReadyMessage,
  isNavigateBuildMessage,
  isOpenRelatedBuildMessage,
  isRefreshRelatedBuildsMessage,
  isSetRelatedBuildsExpandedMessage,
  parseBuildDetailsOutgoingMessage
} from "../src/panels/buildDetails/shared/BuildDetailsPanelMessages";
import {
  RelatedBuildsResults,
  RelatedBuildsSection
} from "../src/panels/buildDetails/webview/components/buildDetails/overview/RelatedBuildsSection";
import {
  buildDetailsReducer,
  buildInitialState
} from "../src/panels/buildDetails/webview/state/buildDetailsState";

const relationships: BuildRelationshipsViewModel = {
  ...EMPTY_BUILD_RELATIONSHIPS,
  upstream: [{ targetId: "parent", jobName: "folder/parent", number: 3 }],
  downstream: [
    {
      targetId: "child",
      jobName: "other-folder/child",
      number: 7,
      resultLabel: "Running",
      resultClass: "running"
    }
  ],
  searched: true,
  lastCheckedAt: 1_700_000_000_000,
  jobsSearched: 10,
  buildsSearched: 300,
  partialReasons: ["The candidate job limit was reached."]
};

describe("related build messages", () => {
  it("accepts the webview hydration handshake only with the expected message type", () => {
    assert.equal(isBuildDetailsReadyMessage({ type: "buildDetailsReady" }), true);
    assert.equal(isBuildDetailsReadyMessage({ type: "ready" }), false);
    assert.equal(isBuildDetailsReadyMessage(null), false);
  });
  it("accepts only valid navigation directions, target IDs, and expansion states", () => {
    assert.equal(isNavigateBuildMessage({ type: "navigateBuild", direction: "back" }), true);
    assert.equal(isNavigateBuildMessage({ type: "navigateBuild", direction: "forward" }), true);
    assert.equal(
      isNavigateBuildMessage({ type: "navigateBuild", direction: "https://example.com" }),
      false
    );
    assert.equal(isOpenRelatedBuildMessage({ type: "openRelatedBuild", targetId: "parent" }), true);
    for (const targetId of ["", " ", 42, null]) {
      assert.equal(isOpenRelatedBuildMessage({ type: "openRelatedBuild", targetId }), false);
    }
    assert.equal(
      isSetRelatedBuildsExpandedMessage({ type: "setRelatedBuildsExpanded", expanded: false }),
      true
    );
    assert.equal(
      isSetRelatedBuildsExpandedMessage({ type: "setRelatedBuildsExpanded", expanded: "true" }),
      false
    );
    assert.equal(isRefreshRelatedBuildsMessage({ type: "refreshRelatedBuilds" }), true);
  });

  it("validates relationship targets, counts, and dates before dispatch", () => {
    const message = { type: "setBuildRelationships", relationships };
    assert.deepEqual(parseBuildDetailsOutgoingMessage(message), message);
    for (const invalid of [
      { upstream: [{ ...relationships.upstream[0], number: 1.5 }] },
      { downstream: [{ ...relationships.downstream[0], targetId: "" }] },
      { jobsSearched: -1 },
      { buildsSearched: Number.NaN },
      { partialReasons: [null] },
      { lastCheckedAt: Number.POSITIVE_INFINITY },
      { lastCheckedAt: 9_000_000_000_000_000 }
    ]) {
      assert.equal(
        parseBuildDetailsOutgoingMessage({
          ...message,
          relationships: { ...relationships, ...invalid }
        }),
        undefined
      );
    }
    assert.deepEqual(
      parseBuildDetailsOutgoingMessage({
        type: "setBuildNavigation",
        navigation: EMPTY_BUILD_NAVIGATION
      }),
      { type: "setBuildNavigation", navigation: EMPTY_BUILD_NAVIGATION }
    );
    assert.equal(
      parseBuildDetailsOutgoingMessage({
        type: "setBuildNavigation",
        navigation: { ...EMPTY_BUILD_NAVIGATION, busy: "yes" }
      }),
      undefined
    );
  });

  it("keeps relationships and navigation when ordinary details refresh", () => {
    const initial = buildInitialState({} as BuildDetailsViewModel);
    assert.deepEqual(initial.relationships, EMPTY_BUILD_RELATIONSHIPS);
    assert.deepEqual(initial.navigation, EMPTY_BUILD_NAVIGATION);
    const withRelationships = buildDetailsReducer(initial, {
      type: "setBuildRelationships",
      relationships
    });
    const navigation = { canGoBack: true, canGoForward: false, busy: false };
    const before = buildDetailsReducer(withRelationships, {
      type: "setBuildNavigation",
      navigation
    });
    const after = buildDetailsReducer(before, {
      type: "updateDetails",
      payload: {
        ...before,
        type: "updateDetails",
        resultLabel: "Success"
      } as BuildDetailsUpdateMessage
    });
    assert.equal(after.relationships, relationships);
    assert.equal(after.navigation, navigation);
    assert.equal(after.resultLabel, "Success");
  });
});

describe("Related Builds UI", () => {
  it("shows upstream links immediately while downstream discovery starts collapsed", () => {
    const onExpandedChange = vi.fn();
    const html = renderToStaticMarkup(
      createElement(RelatedBuildsSection, {
        relationships,
        onExpandedChange,
        onRefresh: vi.fn(),
        onOpenBuild: vi.fn()
      })
    );
    assert.match(html, /Related Builds/);
    assert.match(html, /folder\/parent #3/);
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /other-folder\/child/);
    assert.equal(onExpandedChange.mock.calls.length, 0);
  });

  it("renders matched builds, checked time, inspected counts, and incomplete coverage", () => {
    const html = renderToStaticMarkup(
      createElement(RelatedBuildsResults, { relationships, onOpenBuild: vi.fn() })
    );
    assert.match(html, /other-folder\/child #7/);
    assert.match(html, /Running/);
    assert.match(html, /Last checked/);
    assert.match(html, /10 jobs and 300 builds inspected/);
    assert.match(html, /Results may be incomplete/);
    assert.match(html, /candidate job limit/);
  });

  it("does not claim global absence when a bounded search has no matches", () => {
    const html = renderToStaticMarkup(
      createElement(RelatedBuildsResults, {
        relationships: { ...relationships, downstream: [] },
        onOpenBuild: vi.fn()
      })
    );
    assert.match(html, /No downstream builds found within the search limits/);
    assert.match(html, /Results may be incomplete/);
  });

  it("keeps confirmed matches visible while a refresh is in progress", () => {
    const html = renderToStaticMarkup(
      createElement(RelatedBuildsResults, {
        relationships: { ...relationships, loading: true },
        navigationBusy: true,
        onOpenBuild: vi.fn()
      })
    );
    assert.match(html, /Searching downstream builds/);
    assert.match(html, /other-folder\/child #7/);
    assert.match(html, /disabled=""/);
    assert.doesNotMatch(html, /No downstream builds found/);
  });

  it("surfaces navigation and search errors even while collapsed", () => {
    const html = renderToStaticMarkup(
      createElement(RelatedBuildsSection, {
        relationships: { ...relationships, error: "The related build is unavailable." },
        onExpandedChange: vi.fn(),
        onRefresh: vi.fn(),
        onOpenBuild: vi.fn()
      })
    );
    assert.match(html, /role="alert"/);
    assert.match(html, /The related build is unavailable/);
  });
});
