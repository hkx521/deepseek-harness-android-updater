import type { JSX } from 'react';
import type { DocumentsPageClient } from './api.ts';
export declare function DocumentsPage(props: {
    client: DocumentsPageClient;
    revision: number;
    writeEnabled: boolean;
    sessionId?: string;
    canCreate?: boolean;
    onMutate: () => void;
}): JSX.Element;
