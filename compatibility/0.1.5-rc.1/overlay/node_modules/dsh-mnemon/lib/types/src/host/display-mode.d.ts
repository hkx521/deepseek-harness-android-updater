import type { MnemonDisplayMode } from './protocol.ts';
/** Keep the historical misspelling at input boundaries, never in UI or runtime state. */
export declare function normalizeDisplayMode(value: unknown): MnemonDisplayMode;
