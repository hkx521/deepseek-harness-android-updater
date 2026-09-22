import { descriptor } from "./descriptor.js";
import { Insight, JsonValue, MemoryBody, MemoryGraphSnapshot, MemoryListRequest, MemoryProviderAdapter, MemoryProviderConnection, MemorySpaceAuthority, ProviderBodyStatus, ProviderMemorySpace, ProviderSearchResult, RememberRequest, SearchRequest } from "dsh-mnemon-source-memory-spaces/provider-sdk";
//#region src/driver.d.ts
interface OpenVikingProviderOptions {
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  settlementTimeoutMs?: number;
  pollIntervalMs?: number;
}
declare class OpenVikingProvider implements MemoryProviderAdapter {
  private readonly memorySpaces;
  readonly id: "openviking";
  readonly scoreSemantics: import("dsh-mnemon-source-memory-spaces/provider-sdk").ProviderScoreSemantics;
  private readonly requestFetch;
  private readonly requestTimeoutMs;
  private readonly settlementTimeoutMs;
  private readonly pollIntervalMs;
  constructor(memorySpaces: MemorySpaceAuthority, options?: OpenVikingProviderOptions);
  discover(connection: MemoryProviderConnection, signal?: AbortSignal): Promise<ProviderMemorySpace[]>;
  status(body: MemoryBody, signal?: AbortSignal): Promise<ProviderBodyStatus>;
  search(body: MemoryBody, request: SearchRequest, signal?: AbortSignal): Promise<ProviderSearchResult>;
  graph(body: MemoryBody, signal?: AbortSignal): Promise<MemoryGraphSnapshot>;
  list(body: MemoryBody, request: MemoryListRequest, signal?: AbortSignal): Promise<Insight[]>;
  remember(body: MemoryBody, request: RememberRequest, signal?: AbortSignal): Promise<JsonValue>;
  forget(body: MemoryBody, id: string, signal?: AbortSignal): Promise<JsonValue>;
  private connection;
  private settleTask;
  private request;
  private requestConnection;
}
//#endregion
//#region src/index.d.ts
declare const definition: import("dsh-mnemon-source-memory-spaces/provider-sdk").MemorySpaceProviderDefinition;
declare const _default: import("dsh-mnemon-source-memory-spaces/provider-sdk").MemorySpaceProviderModule<undefined>;
//#endregion
export { OpenVikingProvider, _default as default, definition, descriptor };