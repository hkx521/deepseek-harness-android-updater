import { descriptor } from "./descriptor.js";
import { Insight, JsonValue, MemoryBody, MemoryGraphSnapshot, MemoryListRequest, MemoryProviderAdapter, MemoryProviderConnection, MemorySpaceAuthority, ProcessRunner, ProviderBodyStatus, ProviderMemorySpace, ProviderSearchResult, RememberRequest, SearchRequest } from "dsh-mnemon-source-memory-spaces/provider-sdk";
//#region src/driver.d.ts
interface ByteRoverProviderOptions {
  process?: ProcessRunner;
  queryTimeoutMs?: number;
  curateTimeoutMs?: number;
}
declare class ByteRoverProvider implements MemoryProviderAdapter {
  private readonly memorySpaces;
  readonly id: "byterover";
  readonly scoreSemantics: any;
  private readonly process;
  private readonly queryTimeoutMs;
  private readonly curateTimeoutMs;
  private readonly statusCache;
  private readonly statusInFlight;
  constructor(memorySpaces: MemorySpaceAuthority, options?: ByteRoverProviderOptions);
  discover(connection: MemoryProviderConnection): Promise<ProviderMemorySpace[]>;
  status(body: MemoryBody, signal?: AbortSignal): Promise<ProviderBodyStatus>;
  invalidateStatus(memoryBodyId?: string): void;
  private checkStatus;
  search(body: MemoryBody, request: SearchRequest, signal?: AbortSignal): Promise<ProviderSearchResult>;
  graph(body: MemoryBody): Promise<MemoryGraphSnapshot>;
  list(body: MemoryBody, request: MemoryListRequest, signal?: AbortSignal): Promise<Insight[]>;
  remember(body: MemoryBody, request: RememberRequest, signal?: AbortSignal): Promise<JsonValue>;
  private connection;
  private run;
}
//#endregion
//#region src/index.d.ts
declare const definition: any;
declare const _default: any;
//#endregion
export { ByteRoverProvider, _default as default, definition, descriptor };