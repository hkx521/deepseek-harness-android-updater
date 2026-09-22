import { type ReactNode } from 'react';
import { installMemorySourceUI, type MemorySourcePageProps, type MnemonSourceManagementClient, type MnemonTranslate } from 'dsh-mnemon/client';
import type { DocumentsPageClient } from './api.ts';
export declare function documentsPageClient(management: MnemonSourceManagementClient): DocumentsPageClient;
export declare function DocumentsSourcePage(props: MemorySourcePageProps): ReactNode;
export declare function installDocumentsMemoryUI(ctx: Parameters<typeof installMemorySourceUI>[0], t?: MnemonTranslate): () => void;
export declare const inject: string[];
export declare function apply(ctx: Parameters<typeof installMemorySourceUI>[0]): void;
