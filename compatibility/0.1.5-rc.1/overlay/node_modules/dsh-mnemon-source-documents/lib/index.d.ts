import { DOCUMENTS_ACTIVE_LIMIT_BYTES, DOCUMENTS_VERSION, DocumentCapacityPlan, DocumentMutation, DocumentMutationResult, DocumentRecord, DocumentSearchResult, DocumentSnapshot, DocumentStatus, DocumentView } from "./contracts.js";
import z from "schemastery";
import { MemorySourceDefinition } from "dsh-mnemon/contracts";
import { Context } from "@deepseek-ai/cordis";
//#region src/config.d.ts
interface Config {
  dataDir?: string;
  limitBytes?: number;
}
declare const Config: z<Config>;
//#endregion
//#region src/source.d.ts
declare function createDocumentsMemorySource(config?: Config): MemorySourceDefinition;
declare const DOCUMENTS_MEMORY_SOURCE: MemorySourceDefinition;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-mnemon-source-documents";
declare const inject: string[];
declare const memoryPlugin: import("dsh-mnemon/extension-sdk").MemoryPluginDescriptor;
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { Config, type DOCUMENTS_ACTIVE_LIMIT_BYTES, DOCUMENTS_MEMORY_SOURCE, type DOCUMENTS_VERSION, type DocumentCapacityPlan, type DocumentMutation, type DocumentMutationResult, type DocumentRecord, type DocumentSearchResult, type DocumentSnapshot, type DocumentStatus, type DocumentView, apply, createDocumentsMemorySource, inject, memoryPlugin, name };