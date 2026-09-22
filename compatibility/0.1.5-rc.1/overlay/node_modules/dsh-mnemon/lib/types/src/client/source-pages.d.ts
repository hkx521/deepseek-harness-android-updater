import { type ReactNode } from 'react';
import type { MemorySourcePageProps } from './source-contracts.ts';
export type { MemorySourcePageProps } from './source-contracts.ts';
export declare const MNEMON_SOURCE_PAGE_SLOT: "mnemon.source.page";
/** Conventional operations used by Mnemon's descriptor-driven Source page. */
export declare const MNEMON_SOURCE_CONFIGURATION_READ: "configuration";
export declare const MNEMON_SOURCE_CONFIGURATION_MUTATE: "configuration";
export type MemorySourcePageComponent = (props: MemorySourcePageProps) => ReactNode;
/** The existing DSH Slot capability narrowed to this one child Slot. */
export interface MemorySourceUIContext {
    locale?: {
        bind(namespace: 'mnemon'): import('./locales.ts').MnemonTranslate;
    };
    slots: {
        inject(name: typeof MNEMON_SOURCE_PAGE_SLOT, setup: () => () => void): () => void;
        register(options: {
            name: typeof MNEMON_SOURCE_PAGE_SLOT;
            id: string;
            order: number;
            label: string | (() => string);
            priority?: number;
        }, component: MemorySourcePageComponent): () => void;
    };
}
interface MemorySourcePageDirectoryContext {
    locale?: {
        getSnapshot(): unknown;
        subscribe(listener: () => void): () => void;
    };
    slots: {
        getVersion(name: typeof MNEMON_SOURCE_PAGE_SLOT): number;
        entriesOfSlot(name: typeof MNEMON_SOURCE_PAGE_SLOT): readonly {
            options: {
                id?: string;
                label?: string | (() => string);
                order?: number;
            };
            component?: unknown;
        }[];
        subscribe(name: typeof MNEMON_SOURCE_PAGE_SLOT, listener: () => void): () => void;
    };
}
export interface MemorySourcePageNavigation {
    /** Let the Host retain a compact page header while scrolling in a sidebar. */
    stickyHeader?: boolean;
    group?: 'storage' | 'tools' | 'sources';
    primary?: boolean;
    glyph?: string;
    detail?: string | (() => string);
}
export interface MemorySourcePageDefinition {
    id: string;
    label: string | (() => string);
    order?: number;
    component: MemorySourcePageComponent;
    navigation?: MemorySourcePageNavigation;
}
export interface MemorySourceUIContribution {
    sourceTypeId: string;
    pages: readonly MemorySourcePageDefinition[];
}
export interface MemorySourcePageEntry {
    id: string;
    sourceTypeId: string;
    pageId: string;
    label: string;
    order: number;
    navigation?: Omit<MemorySourcePageNavigation, 'detail'> & {
        detail?: string;
    };
}
export interface MemorySourcePageDirectory {
    getSnapshot(): readonly MemorySourcePageEntry[];
    subscribe(listener: () => void): () => void;
}
export declare function memorySourcePageEntryId(sourceTypeId: string, pageId: string): string;
/**
 * Thin Client-Fiber adapter over the DSH child Slot. It creates no service or
 * registry: `slots.inject/register` own declaration waiting and disposal.
 */
export declare function installMemorySourceUI(ctx: MemorySourceUIContext, contribution: MemorySourceUIContribution): () => void;
/** Stable uSES directory over the Slot ledger; no parallel page registry. */
export declare function createMemorySourcePageDirectory(ctx: MemorySourcePageDirectoryContext): MemorySourcePageDirectory;
