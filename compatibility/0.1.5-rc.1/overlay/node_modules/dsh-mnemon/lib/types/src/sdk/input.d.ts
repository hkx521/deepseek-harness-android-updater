import type { MemoryJsonValue, MemoryMutationReceipt, MemoryMigrationLineage, MemoryMutationCompletion } from "../core/contracts/index.ts";
/** Stable digest of validated configuration; raw values never enter diagnostics. */
export declare function memoryConfigurationDigest(value: unknown): string;
export declare function record(value: MemoryJsonValue, label: string): Record<string, MemoryJsonValue>;
export declare function text(value: MemoryJsonValue | undefined, label: string, maximum: number, required?: boolean): string | undefined;
export declare function integer(value: MemoryJsonValue | undefined, fallback: number, minimum: number, maximum: number): number;
export declare function stringArray(value: MemoryJsonValue | undefined, label: string, maximum?: number): string[] | undefined;
export declare function truncate(value: string, maximum: number): string;
export declare function receipt(viewId: string, offerId: string, sourceInstanceKey: string, revision: string | undefined, details: MemoryJsonValue, completion?: MemoryMutationCompletion): MemoryMutationReceipt;
/** Validate migration proof supplied by an authorized Source management caller. */
export declare function migrationLineage(value: MemoryJsonValue | undefined): MemoryMigrationLineage[];
