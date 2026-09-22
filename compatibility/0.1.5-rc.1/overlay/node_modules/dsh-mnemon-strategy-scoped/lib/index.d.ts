import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
interface Config {
  sourceKeys?: string[];
  writableSourceKeys?: string[];
}
declare const name = "dsh-mnemon-strategy-scoped";
declare const inject: string[];
declare const memoryPlugin: import("dsh-mnemon/extension-sdk").MemoryPluginDescriptor;
declare function createScopedExtension(config?: Config): import("dsh-mnemon/extension-sdk").MemoryStrategyExtensionDefinition;
declare function apply(ctx: Context, config?: Config): void;
declare const memoryStrategyConfiguration: import("dsh-mnemon/extension-sdk").MemoryStrategyConfiguration;
//#endregion
export { Config, apply, createScopedExtension, inject, memoryPlugin, memoryStrategyConfiguration, name };