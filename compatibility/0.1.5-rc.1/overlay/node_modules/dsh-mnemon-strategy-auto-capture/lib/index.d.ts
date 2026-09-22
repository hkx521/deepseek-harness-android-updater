import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
interface Config {
  sourceKeys?: string[];
  actionIds?: string[];
  instruction?: string;
}
declare const name = "dsh-mnemon-strategy-auto-capture";
declare const inject: string[];
declare const memoryPlugin: import("dsh-mnemon/extension-sdk").MemoryPluginDescriptor;
declare function createAutoCaptureExtension(config?: Config): import("dsh-mnemon/extension-sdk").MemoryStrategyExtensionDefinition;
declare function apply(ctx: Context, config?: Config): void;
declare const memoryStrategyConfiguration: import("dsh-mnemon/extension-sdk").MemoryStrategyConfiguration;
//#endregion
export { Config, apply, createAutoCaptureExtension, inject, memoryPlugin, memoryStrategyConfiguration, name };