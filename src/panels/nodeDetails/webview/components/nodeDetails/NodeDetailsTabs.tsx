import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "../../../../shared/webview/components/ui/tabs";
import type { NodeDetailsState } from "../../state/nodeDetailsState";
import { NodeDetailsAdvancedSection } from "./NodeDetailsAdvancedSection";
import { NodeDetailsExecutorsSection } from "./NodeDetailsExecutorsSection";
import { NodeDetailsLabelsSection } from "./NodeDetailsLabelsSection";
import { NodeDetailsOverviewSection } from "./NodeDetailsOverviewSection";
import type { OverviewRow } from "./nodeDetailsUtils";

type NodeDetailsTabsProps = {
  state: NodeDetailsState;
  overviewRows: OverviewRow[];
  onDiagnosticsToggle: (value: string) => void;
  onCopyJson: () => void;
  onOpenExternal: (url: string) => void;
};

export function NodeDetailsTabs({
  state,
  overviewRows,
  onDiagnosticsToggle,
  onCopyJson,
  onOpenExternal
}: NodeDetailsTabsProps): JSX.Element {
  return (
    <Tabs defaultValue="overview" className="space-y-3">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="overview" className="text-xs">
          Overview
        </TabsTrigger>
        <TabsTrigger value="executors" className="text-xs">
          Executors
          <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full border border-border bg-muted-soft px-1 text-[10px] text-muted-foreground">
            {state.executors.length + state.oneOffExecutors.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="labels" className="text-xs">
          Labels
        </TabsTrigger>
        <TabsTrigger value="advanced" className="text-xs">
          Advanced
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-3">
        <NodeDetailsOverviewSection rows={overviewRows} offlineReason={state.offlineReason} />
      </TabsContent>

      <TabsContent value="executors" className="space-y-3">
        <NodeDetailsExecutorsSection
          executors={state.executors}
          oneOffExecutors={state.oneOffExecutors}
          onOpenExternal={onOpenExternal}
        />
      </TabsContent>

      <TabsContent value="labels" className="space-y-3">
        <NodeDetailsLabelsSection labels={state.labels} />
      </TabsContent>

      <TabsContent value="advanced" className="space-y-3">
        <NodeDetailsAdvancedSection
          advancedLoaded={state.advancedLoaded}
          loading={state.loading}
          monitorData={state.monitorData}
          loadStatistics={state.loadStatistics}
          rawJson={state.rawJson}
          onDiagnosticsToggle={onDiagnosticsToggle}
          onCopyJson={onCopyJson}
        />
      </TabsContent>
    </Tabs>
  );
}
