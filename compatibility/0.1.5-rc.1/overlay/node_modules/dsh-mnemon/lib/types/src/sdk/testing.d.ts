import { Context, type Plugin } from '@deepseek-ai/cordis';
import { DEFAULT_MEMORY_VIEW_BUDGET } from '../core/contracts/index.ts';
import type { ComposableMemoryView, MemoryActionOffer, MemoryCapability, MemoryCompositionEvaluationReport, MemoryEvidence, MemoryJsonValue, MemoryMutationReceipt, MemoryOperationScope, MemoryPackageProvenance, MemorySourceManagementCatalog, MemorySourceManagementRequest, MemorySourceManagementResult, MemorySourceManifest, MemoryViewRequest } from '../core/contracts/index.ts';
export interface MemoryTestEntry<C> {
    instanceId: string;
    config?: C;
}
export interface MemoryTestTurn {
    readonly view: ComposableMemoryView;
    executeRoute(routeId: string, input: MemoryJsonValue, signal?: AbortSignal): Promise<MemoryEvidence>;
    executeAction(offerId: string, input: MemoryJsonValue, authorize: (offer: MemoryActionOffer) => boolean | Promise<boolean>, signal?: AbortSignal): Promise<MemoryMutationReceipt>;
    release(): void;
}
/** Read-only identity/manifest, never an installed definition or Source handle. */
export interface MemoryTestSource {
    readonly sourceInstanceKey: string;
    readonly manifest: MemorySourceManifest;
    readonly provenance: MemoryPackageProvenance;
}
export interface MemoryTestOptions {
    strategyInstanceKey?: string;
    strategyTypeId?: string;
    sourceConfiguration?: (source: MemoryTestSource) => Readonly<Record<string, MemoryJsonValue>>;
    sourceCapabilities?: (source: MemoryTestSource) => readonly MemoryCapability[];
    now?: () => Date;
    sourceTimeoutMs?: number;
}
/** JSON-only observations for composition/replacement tests, not engine access. */
export interface MemoryTestDiagnostics {
    servingGenerationId?: string;
    drainingGenerationIds: string[];
    evaluation: MemoryCompositionEvaluationReport;
}
export interface MemoryTestManagementClient {
    readonly sourceInstanceKey: string;
    readonly revision: string;
    read(operation: string, input?: MemoryJsonValue): Promise<MemorySourceManagementResult>;
    mutate(operation: string, input: MemoryJsonValue, options: {
        confirmed: true;
        expectedRevision?: string;
    }): Promise<MemorySourceManagementResult>;
}
/**
 * A test fixture, not a production service or a second Loader. It mounts real
 * Cordis Fibers against the same Runtime/compiler used by the Host. The small
 * Loader identity adapter supplies only stable Entry ids for installMemory.
 * No built-in Source, Provider, database, browser, or private binding is needed.
 */
export declare class MemoryCompositionRunner {
    #private;
    readonly context: Context;
    constructor(options?: MemoryTestOptions);
    mount<C>(plugin: Plugin.Object<C>, entry: MemoryTestEntry<C>): Promise<() => Promise<void>>;
    beginTurn(request?: Partial<MemoryViewRequest>, signal?: AbortSignal): Promise<MemoryTestTurn>;
    inspect(): MemoryTestDiagnostics;
    managementCatalog(scope?: MemoryOperationScope): Promise<MemorySourceManagementCatalog>;
    /** Exercise the public protocol, including rejected confirmation/revision cases. */
    executeManagement(request: MemorySourceManagementRequest): Promise<MemorySourceManagementResult>;
    /** Same scoped management contract a Source page receives, backed by real generations. */
    managementClient(sourceInstanceKey: string, scopeValue?: MemoryViewRequest['scope']): Promise<MemoryTestManagementClient>;
    dispose(): Promise<void>;
}
export { DEFAULT_MEMORY_VIEW_BUDGET };
/**
 * Evaluate a trusted, already-built DSH Client artifact in a test. Dependencies
 * are explicit (normally the test's React and UI primitives), so no production
 * Loader, global registry, source alias, or second copy of React is required.
 * This is a test fixture, not another Client Loader implementation.
 */
export declare function loadMemoryClientArtifact<T extends object = Record<string, unknown>>(path: string | URL, dependencies: Readonly<Record<string, unknown>>): T;
