import { Config, type Config as MnemonConfig } from './config.ts';
export declare const name = "dsh-mnemon";
export declare const provide: string[];
export declare const inject: string[];
export { Config };
export type { MnemonConfig };
/** DSH owns assembly; this Host only wires scope, phases and user preferences. */
export declare function apply(rawContext: unknown, config?: MnemonConfig): void;
