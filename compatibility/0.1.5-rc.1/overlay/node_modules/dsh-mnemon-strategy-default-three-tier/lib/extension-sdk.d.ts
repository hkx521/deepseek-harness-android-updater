import { MemoryAvailableSource, MemoryJsonValue, MemoryStrategyContribution, MemoryStrategyExtensionDefinition, MemoryViewRequest } from "dsh-mnemon/contracts";
//#region src/extension-sdk.d.ts
/** These slots belong to the three-tier product. Core does not interpret them. */
type ThreeTierExtensionValues = {
  selection: {
    sourceKeys: string[];
    writableSourceKeys?: string[];
  };
  projection: {
    maxProjectionCharacters: number;
  };
  capture: {
    instruction: string;
    actionIds: string[];
    sourceKeys?: string[];
  };
};
type ThreeTierExtensionSlot = keyof ThreeTierExtensionValues;
/** Pure default-product policy. The Host executes it through public Source protocols. */
declare function threeTierActionWorkflow(strategyTypeId: string, sourceTypeId: string, actionId: string): 'runtime-capacity' | undefined;
declare function validateThreeTierExtension<K extends ThreeTierExtensionSlot>(slot: K, value: MemoryJsonValue): ThreeTierExtensionValues[K];
declare function defineThreeTierExtension<K extends ThreeTierExtensionSlot>(definition: {
  typeId: string;
  packageName: string;
  slot: K;
  contribute(request: MemoryViewRequest, sources: readonly MemoryAvailableSource[]): ThreeTierExtensionValues[K];
}): MemoryStrategyExtensionDefinition;
declare function threeTierContributions(values: readonly MemoryStrategyContribution[]): Partial<ThreeTierExtensionValues>;
//#endregion
export { ThreeTierExtensionSlot, ThreeTierExtensionValues, defineThreeTierExtension, threeTierActionWorkflow, threeTierContributions, validateThreeTierExtension };