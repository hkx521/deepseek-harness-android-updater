import type { JSX, ReactNode } from 'react';
import type { MemoryJsonValue } from "../core/contracts/index.js";
import type { MnemonSourceManagementClient } from './source-contracts.ts';
/** Optional default presentation kit; custom pages may use their own UI. */
export declare function MemorySourcePageFrame(props: {
    locale: string;
    children: ReactNode;
}): JSX.Element;
/** Track revisions returned by reads as well as writes; never retry a conflict. */
export declare function createMemorySourcePageClient(management: MnemonSourceManagementClient): {
    canAssist: (operation: string) => boolean;
    assist: <T>(operation: string, input: MemoryJsonValue, confirmed: boolean) => Promise<T>;
    read: <T>(operation: string, input?: MemoryJsonValue) => Promise<T>;
    mutate: <T>(operation: string, input: MemoryJsonValue, confirmed: true) => Promise<T>;
};
