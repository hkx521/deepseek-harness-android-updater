import { RUNTIME_ENTRY_DELIMITER, RUNTIME_MEMORY_LIMITS, RUNTIME_MEMORY_VERSION, RuntimeMemoryAction, RuntimeMemoryCompactedEntry, RuntimeMemoryEntry, RuntimeMemoryImportance, RuntimeMemoryLimits, RuntimeMemoryMaintenancePlan, RuntimeMemoryMutation, RuntimeMemoryMutationResult, RuntimeMemorySnapshot, RuntimeMemoryTarget, RuntimeMemoryTargetView, RuntimeMemoryUsage } from "./contracts.js";
import z from "schemastery";
import { MemorySourceDefinition } from "dsh-mnemon/contracts";
import { Context } from "@deepseek-ai/cordis";
//#region src/config.d.ts
interface Config {
  dataDir?: string;
  userDataDir?: string;
  memoryLimitBytes?: number;
  userLimitBytes?: number;
}
declare const Config: z<Config>;
//#endregion
//#region src/source.d.ts
declare function createRuntimeMemorySource(config?: Config): MemorySourceDefinition;
declare const RUNTIME_MEMORY_SOURCE: MemorySourceDefinition;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-mnemon-source-runtime";
declare const inject: string[];
declare const memoryPlugin: import("dsh-mnemon/extension-sdk").MemoryPluginDescriptor;
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { Config, type RUNTIME_ENTRY_DELIMITER, type RUNTIME_MEMORY_LIMITS, RUNTIME_MEMORY_SOURCE, type RUNTIME_MEMORY_VERSION, type RuntimeMemoryAction, type RuntimeMemoryCompactedEntry, type RuntimeMemoryEntry, type RuntimeMemoryImportance, type RuntimeMemoryLimits, type RuntimeMemoryMaintenancePlan, type RuntimeMemoryMutation, type RuntimeMemoryMutationResult, type RuntimeMemorySnapshot, type RuntimeMemoryTarget, type RuntimeMemoryTargetView, type RuntimeMemoryUsage, apply, createRuntimeMemorySource, inject, memoryPlugin, name };