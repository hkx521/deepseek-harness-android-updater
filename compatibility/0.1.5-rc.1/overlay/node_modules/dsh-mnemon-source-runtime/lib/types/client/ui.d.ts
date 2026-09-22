import { type ReactNode } from 'react';
import { installMemorySourceUI, type MemorySourcePageProps, type MnemonSourceManagementClient, type MnemonTranslate } from 'dsh-mnemon/client';
import type { RuntimePageClient } from './api.ts';
export declare function runtimePageClient(management: MnemonSourceManagementClient): RuntimePageClient;
export declare function RuntimeSourcePage(props: MemorySourcePageProps): ReactNode;
export declare function installRuntimeMemoryUI(ctx: Parameters<typeof installMemorySourceUI>[0], t?: MnemonTranslate): () => void;
export declare const inject: string[];
export declare function apply(ctx: Parameters<typeof installMemorySourceUI>[0]): void;
