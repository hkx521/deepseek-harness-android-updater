import { type JSX, type ReactNode } from 'react';
export interface MnemonDialogProps {
    title: string;
    closeLabel: string;
    description?: string;
    busy?: boolean;
    contentReady?: boolean;
    wide?: boolean;
    footer?: ReactNode;
    onClose: () => void;
    children: ReactNode;
}
/** Shared top-layer dialog behavior for every Mnemon workspace action surface. */
export declare function MnemonDialog(props: MnemonDialogProps): JSX.Element | null;
