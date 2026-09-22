import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
interface Config {
  maxProjectionCharacters?: number;
}
declare const name = "dsh-mnemon-strategy-light-context";
declare const inject: string[];
declare const memoryPlugin: import("dsh-mnemon/extension-sdk").MemoryPluginDescriptor;
declare function createLightContextExtension(config?: Config): import("dsh-mnemon/extension-sdk").MemoryStrategyExtensionDefinition;
declare function apply(ctx: Context, config?: Config): void;
declare const memoryStrategyConfiguration: import("dsh-mnemon/extension-sdk").MemoryStrategyConfiguration;
//#endregion
export { Config, apply, createLightContextExtension, inject, memoryPlugin, memoryStrategyConfiguration, name };