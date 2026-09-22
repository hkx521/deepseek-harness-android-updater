import { AutomaticMemoryPlacementRequest, CATEGORIES, Category, CreateMemoryBodyRequest, CreateMemorySpaceRequest, DEFAULT_EMBEDDING_ENDPOINT, DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_PROTOCOL, EDGE_TYPES, EMBEDDING_PROTOCOL_AUTO, EMBEDDING_PROTOCOL_OLLAMA, EMBEDDING_PROTOCOL_OPENAI, EdgeType, EntityView, INTENTS, Insight, Intent, JsonValue, LlmMemoryPlacementSelection, MNEMON_EMBEDDING_PROTOCOLS, MemoryBody, MemoryBodyCatalog, MemoryBodyMetadataMaintenanceResult, MemoryBodyMetadataSample, MemoryBodyMetadataUpdate, MemoryBodyProvider, MemoryBodyStats, MemoryBodyView, MemoryGraphEdge, MemoryGraphNode, MemoryGraphSnapshot, MemoryListRequest, MemoryListView, MemoryPersistenceStrategy, MemoryPlacementCandidate, MemoryPlacementCapability, MemoryPlacementDecision, MemoryPlacementPreference, MemoryPlacementRules, MemoryProviderCapabilities, MemoryProviderConfigField, MemoryProviderConfigOption, MemoryProviderConnection, MemoryProviderConnectionValue, MemoryProviderDescriptor, MemoryProviderIcon, MemoryProviderId, MemoryProviderRuntimeStatus, MemoryProviderServiceCatalog, MemoryProviderServiceView, MemoryReadMode, MemoryReadSource, MemoryReadStatus, MemorySpace, MemorySpaceCatalog, MemorySpaceMetadataMaintenanceResult, MemorySpaceMetadataSample, MemorySpaceMetadataUpdate, MemorySpaceProvider, MemorySpaceStats, MemorySpaceView, MemorySpacesStatus, MnemonEmbeddingConfig, MnemonEmbeddingProtocol, MnemonEmbeddingStatus, OpenVikingBodyConnection, OpenVikingSpaceConnection, PreparedMemoryPlacement, RecallQualityConfig, RecallQualityStats, RecallRelevanceTier, RememberRequest, ResolvedMemoryPersistenceStrategy, ResolvedMnemonEmbeddingConfig, ResolvedRecallQualityConfig, SOURCES, SearchRequest, Source, UpdateMemoryBodyRequest, UpdateMemoryProviderServiceRequest, UpdateMemorySpaceRequest } from "./contracts.js";
import { i as MemorySpaceProviderEntry } from "./definitions-C5y84OE6.js";
import z from "schemastery";
import { Context } from "@deepseek-ai/cordis";
//#region src/config.d.ts
interface MemorySpacesConfig {
  dataDir?: string;
  cliPath?: string;
  store?: string;
  timeoutMs?: number;
  defaultRecallLimit?: number;
  writeEnabled?: boolean;
  embedding?: MnemonEmbeddingConfig;
  recallQuality?: RecallQualityConfig;
  persistenceStrategy?: MemoryPersistenceStrategy;
}
interface ResolvedMemorySpacesConfig {
  storageScope: 'global' | 'workspace' | 'custom';
  dataDir?: string;
  cliPath?: string;
  store?: string;
  timeoutMs: number;
  defaultRecallLimit: number;
  writeEnabled: boolean;
  embedding: ResolvedMnemonEmbeddingConfig;
  recallQuality: ResolvedRecallQualityConfig;
  persistenceStrategy: ResolvedMemoryPersistenceStrategy;
}
declare const MemorySpacesConfig: z<MemorySpacesConfig>;
declare function resolvePersistenceStrategy(value: MemoryPersistenceStrategy | undefined): ResolvedMemorySpacesConfig['persistenceStrategy'];
declare function resolveEmbedding(value: MemorySpacesConfig['embedding']): ResolvedMemorySpacesConfig['embedding'];
declare function resolveRecallQuality(value: RecallQualityConfig | undefined): ResolvedMemorySpacesConfig['recallQuality'];
//#endregion
//#region src/index.d.ts
declare const name = "dsh-mnemon-source-memory-spaces";
declare const inject: string[];
declare const memoryPlugin: import("dsh-mnemon/extension-sdk").MemoryPluginDescriptor;
interface Config extends MemorySpacesConfig {
  /** Explicit Source-private children; resolved by DSH's module Loader. */
  providers: Array<string | MemorySpaceProviderDeclaration>;
}
declare const MemorySpaceProviderDeclarationSchema: z<MemorySpaceProviderDeclaration>;
declare const Config: z<Config>;
interface InstallMemorySpacesOptions {
  config?: MemorySpacesConfig;
  instanceId?: string;
}
interface MemorySpaceProviderDeclaration {
  /** Installed package specifier; no built-in implementation registry. */
  use: string;
  /** Stable child identity; defaults to the module type id when omitted. */
  instanceId?: string;
  /** Validated by the child module's Cordis Config schema, when supplied. */
  config?: unknown;
}
/** Resolve only the explicitly listed children; no dependency scanning occurs. */
declare function resolveMemorySpaceProviderEntries(ctx: Context, declarations: readonly (string | MemorySpaceProviderDeclaration)[]): Promise<MemorySpaceProviderEntry[]>;
/** Compose an explicit Provider child list into one effective Source. */
declare function installMemorySpaces(ctx: Context, entries: readonly MemorySpaceProviderEntry[], options?: InstallMemorySpacesOptions): Promise<void>;
declare function apply(ctx: Context, config?: Config): Promise<void>;
//#endregion
export { type AutomaticMemoryPlacementRequest, type CATEGORIES, type Category, Config, type CreateMemoryBodyRequest, type CreateMemorySpaceRequest, type DEFAULT_EMBEDDING_ENDPOINT, type DEFAULT_EMBEDDING_MODEL, type DEFAULT_EMBEDDING_PROTOCOL, type EDGE_TYPES, type EMBEDDING_PROTOCOL_AUTO, type EMBEDDING_PROTOCOL_OLLAMA, type EMBEDDING_PROTOCOL_OPENAI, type EdgeType, type EntityView, type INTENTS, type Insight, InstallMemorySpacesOptions, type Intent, type JsonValue, type LlmMemoryPlacementSelection, type MNEMON_EMBEDDING_PROTOCOLS, type MemoryBody, type MemoryBodyCatalog, type MemoryBodyMetadataMaintenanceResult, type MemoryBodyMetadataSample, type MemoryBodyMetadataUpdate, type MemoryBodyProvider, type MemoryBodyStats, type MemoryBodyView, type MemoryGraphEdge, type MemoryGraphNode, type MemoryGraphSnapshot, type MemoryListRequest, type MemoryListView, type MemoryPersistenceStrategy, type MemoryPlacementCandidate, type MemoryPlacementCapability, type MemoryPlacementDecision, type MemoryPlacementPreference, type MemoryPlacementRules, type MemoryProviderCapabilities, type MemoryProviderConfigField, type MemoryProviderConfigOption, type MemoryProviderConnection, type MemoryProviderConnectionValue, type MemoryProviderDescriptor, type MemoryProviderIcon, type MemoryProviderId, type MemoryProviderRuntimeStatus, type MemoryProviderServiceCatalog, type MemoryProviderServiceView, type MemoryReadMode, type MemoryReadSource, type MemoryReadStatus, type MemorySpace, type MemorySpaceCatalog, type MemorySpaceMetadataMaintenanceResult, type MemorySpaceMetadataSample, type MemorySpaceMetadataUpdate, type MemorySpaceProvider, MemorySpaceProviderDeclaration, MemorySpaceProviderDeclarationSchema, type MemorySpaceStats, type MemorySpaceView, type MemorySpacesStatus, type MnemonEmbeddingConfig, type MnemonEmbeddingProtocol, type MnemonEmbeddingStatus, type OpenVikingBodyConnection, type OpenVikingSpaceConnection, type PreparedMemoryPlacement, type RecallQualityConfig, type RecallQualityStats, type RecallRelevanceTier, type RememberRequest, type ResolvedMemoryPersistenceStrategy, type ResolvedMnemonEmbeddingConfig, type ResolvedRecallQualityConfig, type SOURCES, type SearchRequest, type Source, type UpdateMemoryBodyRequest, type UpdateMemoryProviderServiceRequest, type UpdateMemorySpaceRequest, apply, inject, installMemorySpaces, memoryPlugin, name, resolveEmbedding, resolveMemorySpaceProviderEntries, resolvePersistenceStrategy, resolveRecallQuality };