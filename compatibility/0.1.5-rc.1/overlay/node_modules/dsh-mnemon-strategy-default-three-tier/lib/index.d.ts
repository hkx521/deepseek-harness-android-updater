import { MemoryAvailableSource, MemoryViewRequest, MemoryViewSpec } from "dsh-mnemon/contracts";
import { Context } from "@deepseek-ai/cordis";
//#region src/strategy.d.ts
/** Pure View composition; no dependency on any Source implementation. */
declare const DEFAULT_THREE_TIER_VIEW_STRATEGY: {
  createTurn: (view: import("dsh-mnemon/extension-sdk").ComposableMemoryView) => import("dsh-mnemon/extension-sdk").MemoryStrategyTurn;
  manifest: {
    apiVersion: "dsh-mnemon/v1";
    kind: "strategy";
    typeId: string;
    packageName: string;
    deterministic: true;
    supportedSourceRoles: ("working-context" | "narrative" | "durable-evidence")[];
    maxSources: number;
    maxRoutes: number;
    maxActions: number;
    extensionSlots: string[];
  };
  compose(request: MemoryViewRequest, sources: readonly MemoryAvailableSource[], contributions?: readonly import("dsh-mnemon/extension-sdk").MemoryStrategyContribution[] | undefined): MemoryViewSpec;
};
//#endregion
//#region src/index.d.ts
declare const name = "dsh-mnemon-strategy-default-three-tier";
declare const inject: string[];
declare const memoryPlugin: import("dsh-mnemon/extension-sdk").MemoryPluginDescriptor;
declare const memoryStrategyConfiguration: import("dsh-mnemon/extension-sdk").MemoryStrategyConfiguration;
declare function apply(ctx: Context): void;
//#endregion
export { DEFAULT_THREE_TIER_VIEW_STRATEGY, apply, inject, memoryPlugin, memoryStrategyConfiguration, name };