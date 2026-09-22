import type { JSX } from 'react';
import { type Insight, type MemorySpaceMetadataUpdate, type MemorySpaceProvider, type MemorySpaceView } from '../contracts.ts';
import type { MemorySpacesPageClient } from './api.ts';
import type { MemoryPersistenceStrategy } from '../contracts.ts';
export interface MemoryPlacementSettings {
    setPath(path: string[], value: unknown): Promise<void>;
}
export interface MemoryPlacementPageConfig {
    persistenceStrategy?: MemoryPersistenceStrategy;
}
export interface MemorySpacesPageStatus {
    defaultRecallLimit?: number;
}
export declare function nativeSpaceProvider(provider: MemorySpaceProvider): boolean;
export declare function OverviewPage(props: {
    client: MemorySpacesPageClient;
    metadataClient: MemorySpacesPageClient;
    revision: number;
    activationEnabled: boolean;
    writeEnabled: boolean;
    agentAvailable: boolean;
    fallbackBodies: MemorySpaceView[];
    fallbackDirectory: string | undefined;
    catalogKnown: boolean;
    onMutate: () => void;
    onAgentRefresh: () => void;
    onBodyReconnect: (body: MemorySpaceView) => void;
    onBodyMetadata: (updates: readonly MemorySpaceMetadataUpdate[]) => void;
    onExplore: (query: string) => void;
}): JSX.Element;
export declare function ExplorePage(props: {
    client: MemorySpacesPageClient;
    agentClient: MemorySpacesPageClient;
    agentAvailable: boolean;
    status: MemorySpacesPageStatus | null;
    seed: string;
    writeEnabled: boolean;
    onForget: (insight: Insight) => Promise<void>;
}): JSX.Element;
export declare function EntitiesPage(props: {
    client: MemorySpacesPageClient;
    revision: number;
    writeEnabled: boolean;
    onForget: (insight: Insight) => Promise<void>;
    onExplore: (query: string) => void;
}): JSX.Element;
export declare function PersistenceStrategyDialog(props: {
    client: MemorySpacesPageClient;
    settingsScope: MemoryPlacementSettings;
    config: MemoryPlacementPageConfig | undefined;
    writable: boolean;
    agentAvailable: boolean;
    onClose: () => void;
}): JSX.Element;
export declare function RememberPage(props: {
    client: MemorySpacesPageClient;
    agentAvailable: boolean;
    memoryBodies: MemorySpaceView[];
    writeEnabled: boolean;
    seed: string;
    onMutate: () => void;
    onClose: () => void;
    onComplete?: () => void;
}): JSX.Element;
export declare function ListPage(props: {
    client: MemorySpacesPageClient;
    revision: number;
    writeEnabled: boolean;
    onForget: (insight: Insight) => Promise<void>;
    onClone: (insight: Insight) => void;
    onExplore: (query: string) => void;
}): JSX.Element;
/** @deprecated Use nativeSpaceProvider. */
export declare const nativeBodyProvider: typeof nativeSpaceProvider;
