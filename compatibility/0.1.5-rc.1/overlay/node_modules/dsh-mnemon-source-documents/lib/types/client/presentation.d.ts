import { type MnemonKey } from 'dsh-mnemon/client';
import type labels from 'dsh-mnemon-source-documents/presentation/locales.json';
export type SourceKey = keyof typeof labels.zh;
export declare const css: Readonly<Record<string, string>>;
export declare const sidebarCss: Readonly<Record<string, string>>;
export declare function useT(): (key: SourceKey | MnemonKey, params?: Record<string, unknown>) => string;
