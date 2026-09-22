import type { JSX } from 'react';
import { type MnemonTranslate } from './locales.ts';
import { type MnemonDialogProps } from './MnemonDialog.tsx';
export declare const I18nContext: import("react").Context<MnemonTranslate>;
export declare const LocaleContext: import("react").Context<string>;
export declare function useT(): MnemonTranslate;
export declare function useLocale(): string;
export declare function humanBytes(bytes: number): string;
export declare function message(error: unknown): string;
export declare function parseBranchesInput(raw: string): string[] | undefined;
export declare function short(value: string, max: number): string;
export declare function PageHeader(props: {
    title: string;
    description: string;
    meta?: string;
    loadingLabel?: string;
    action?: JSX.Element;
}): JSX.Element;
export declare function PageSpinner({ label }: {
    label: string;
}): JSX.Element;
export declare function SectionSpinner({ label }: {
    label: string;
}): JSX.Element;
export declare function ProgressiveFooter(props: {
    visible: number;
    total: number;
    pageSize: number;
    compact?: boolean;
    onMore: () => void;
}): JSX.Element | null;
/** DSH-style action dialog shared by Sidebar add/write flows. */
export declare function SidebarModal(props: Omit<MnemonDialogProps, 'closeLabel'>): JSX.Element;
export declare function EmptyState(props: {
    glyph: string;
    title: string;
    children: string;
}): JSX.Element;
export declare const memoryPageStyles: Readonly<Record<string, string>>;
export declare const memorySidebarStyles: Readonly<Record<string, string>>;
