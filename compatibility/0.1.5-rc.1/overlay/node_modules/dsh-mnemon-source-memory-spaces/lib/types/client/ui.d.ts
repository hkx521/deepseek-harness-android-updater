import { type ReactNode } from 'react';
import { installMemorySourceUI, type MemorySourcePageProps, type MnemonSourceManagementClient, type MnemonTranslate } from 'dsh-mnemon/client';
import type { MemorySpacesStatus } from '../contracts.ts';
import type { MemorySpacesPageClient } from './api.ts';
/** The adapter never gets a transport or chooses another Source instance. */
export declare function memorySpacesPageClient(management: MnemonSourceManagementClient): MemorySpacesPageClient & {
    status(): Promise<MemorySpacesStatus>;
    canAssist(operation: string): boolean;
};
type Page = 'spaces' | 'explore' | 'entities' | 'remember' | 'content';
export declare function MemorySpacesSourcePage(props: MemorySourcePageProps & {
    page: Page;
}): ReactNode;
export declare function installMemorySpacesUI(ctx: Parameters<typeof installMemorySourceUI>[0], t?: MnemonTranslate): () => void;
export declare const inject: string[];
export declare function apply(ctx: Parameters<typeof installMemorySourceUI>[0]): void;
export {};
