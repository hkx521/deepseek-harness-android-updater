import { descriptor } from "./descriptor.js";
import { HttpMemoryProvider, HttpProviderOptions, Insight, JsonValue, MemoryBody, MemoryListRequest, MemoryProviderAdapter, MemorySpaceAuthority, ProviderBodyStatus, ProviderMemorySpace, ProviderSearchResult, RememberRequest, SearchRequest } from "dsh-mnemon-source-memory-spaces/provider-sdk";
//#region src/driver.d.ts
declare class SupermemoryProvider extends HttpMemoryProvider implements MemoryProviderAdapter {
  readonly id: "supermemory";
  readonly scoreSemantics: import("dsh-mnemon-source-memory-spaces/provider-sdk").ProviderScoreSemantics;
  constructor(memorySpaces: MemorySpaceAuthority, options?: HttpProviderOptions);
  discover(connection: Record<string, string | number | boolean>, signal?: AbortSignal): Promise<ProviderMemorySpace[]>;
  status(body: MemoryBody, signal?: AbortSignal): Promise<ProviderBodyStatus>;
  search(body: MemoryBody, request: SearchRequest, signal?: AbortSignal): Promise<ProviderSearchResult>;
  list(body: MemoryBody, request: MemoryListRequest, signal?: AbortSignal): Promise<Insight[]>;
  remember(body: MemoryBody, request: RememberRequest, signal?: AbortSignal): Promise<JsonValue>;
  forget(body: MemoryBody, id: string, signal?: AbortSignal): Promise<JsonValue>;
  private headers;
}
//#endregion
//#region src/index.d.ts
declare const definition: import("dsh-mnemon-source-memory-spaces/provider-sdk").MemorySpaceProviderDefinition;
declare const _default: import("dsh-mnemon-source-memory-spaces/provider-sdk").MemorySpaceProviderModule<undefined>;
//#endregion
export { SupermemoryProvider, _default as default, definition, descriptor };