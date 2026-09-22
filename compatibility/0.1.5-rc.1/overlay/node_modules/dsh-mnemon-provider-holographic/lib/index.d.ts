import { descriptor } from "./descriptor.js";
import { Insight, JsonValue, MemoryBody, MemoryGraphSnapshot, MemoryListRequest, MemoryProviderAdapter, MemoryProviderConnection, MemorySpaceAuthority, ProviderBodyStatus, ProviderMemorySpace, ProviderSearchResult, RememberRequest, SearchRequest } from "dsh-mnemon-source-memory-spaces/provider-sdk";
//#region src/driver.d.ts
declare class HolographicProvider implements MemoryProviderAdapter {
  private readonly memorySpaces;
  readonly id: "holographic";
  readonly scoreSemantics: import("dsh-mnemon-source-memory-spaces/provider-sdk").ProviderScoreSemantics;
  constructor(memorySpaces: MemorySpaceAuthority);
  discover(connection: MemoryProviderConnection): Promise<ProviderMemorySpace[]>;
  status(body: MemoryBody): Promise<ProviderBodyStatus>;
  search(body: MemoryBody, request: SearchRequest): Promise<ProviderSearchResult>;
  list(body: MemoryBody, request: MemoryListRequest): Promise<Insight[]>;
  graph(body: MemoryBody): Promise<MemoryGraphSnapshot>;
  related(body: MemoryBody, id: string, _depth: number): Promise<Insight[]>;
  remember(body: MemoryBody, request: RememberRequest): Promise<JsonValue>;
  forget(body: MemoryBody, id: string): Promise<JsonValue>;
  private connection;
  private path;
  private load;
  private save;
  private stats;
}
//#endregion
//#region src/index.d.ts
declare const definition: import("dsh-mnemon-source-memory-spaces/provider-sdk").MemorySpaceProviderDefinition;
declare const _default: import("dsh-mnemon-source-memory-spaces/provider-sdk").MemorySpaceProviderModule<undefined>;
//#endregion
export { HolographicProvider, _default as default, definition, descriptor };