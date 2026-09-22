import { descriptor } from "./descriptor.js";
import { EdgeType, Insight, JsonValue, MemoryBody, MemoryGraphSnapshot, MemoryListRequest, MemoryProviderAdapter, MemorySpaceNativeRunner, ProviderBodyStatus, ProviderSearchResult, RememberRequest, SearchRequest } from "dsh-mnemon-source-memory-spaces/provider-sdk";
//#region src/driver.d.ts
/** Parse the official Mnemon vis.js export without executing its HTML or loading its CDN script. */
declare function parseMemoryGraph(html: string, now?: Date): MemoryGraphSnapshot;
/** Native CLI data plane owned and independently testable by this Provider. */
declare class MnemonNativeProvider implements MemoryProviderAdapter {
  private readonly runner;
  private readonly config;
  readonly id = "mnemon-native";
  readonly scoreSemantics: import("dsh-mnemon-source-memory-spaces/provider-sdk").ProviderScoreSemantics;
  constructor(runner: MemorySpaceNativeRunner, config?: {
    defaultRecallLimit: number;
  });
  list(body: MemoryBody, _request: MemoryListRequest, signal?: AbortSignal): Promise<Insight[]>;
  status(body: MemoryBody, signal?: AbortSignal): Promise<ProviderBodyStatus>;
  private parseStats;
  graph(body: MemoryBody, signal?: AbortSignal): Promise<MemoryGraphSnapshot>;
  private allNativeInsights;
  metadataSample(body: MemoryBody, limit: number, signal?: AbortSignal): Promise<Insight[]>;
  search(body: MemoryBody, request: SearchRequest, signal?: AbortSignal): Promise<ProviderSearchResult>;
  remember(body: MemoryBody, request: RememberRequest, signal?: AbortSignal): Promise<JsonValue>;
  rememberMany(body: MemoryBody, requests: readonly RememberRequest[], signal?: AbortSignal): Promise<JsonValue[]>;
  related(body: MemoryBody, id: string, depth: number, edge?: EdgeType, signal?: AbortSignal): Promise<Insight[]>;
  link(body: MemoryBody, sourceId: string, targetId: string, type: EdgeType, weight: number, reason?: string, signal?: AbortSignal): Promise<JsonValue>;
  forget(body: MemoryBody, id: string, signal?: AbortSignal): Promise<JsonValue>;
}
//#endregion
//#region src/index.d.ts
declare const definition: import("dsh-mnemon-source-memory-spaces/provider-sdk").MemorySpaceProviderDefinition;
declare const _default: import("dsh-mnemon-source-memory-spaces/provider-sdk").MemorySpaceProviderModule<undefined>;
//#endregion
export { MnemonNativeProvider, _default as default, definition, descriptor, parseMemoryGraph };