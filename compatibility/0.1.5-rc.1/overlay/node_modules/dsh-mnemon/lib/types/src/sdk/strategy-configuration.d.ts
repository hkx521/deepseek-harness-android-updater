import type { MemoryInstallContribution } from './service.ts';
import type { MemoryJsonValue, MemoryPluginLocalizedText } from '../core/contracts/index.ts';
/** Human-facing metadata only. It is never added to a model View. */
export type MemoryLocalizedText = MemoryPluginLocalizedText;
export interface MemoryStrategyConfigurationField {
    key: string;
    label: MemoryLocalizedText;
    description?: MemoryLocalizedText;
    /** Numbers are finite integers; lists have at most 32 unique, nonempty strings. */
    input: 'number' | 'text' | 'textarea' | 'string-list' | 'source-list';
    defaultValue?: MemoryJsonValue;
    minimum?: number;
    maximum?: number;
    sourceRoles?: string[];
}
/**
 * Optional module export named `memoryStrategyConfiguration`.
 * An installed, trusted Cordis Entry owns its fields and its pure factory.
 * The Host may preview that factory, but mounting/disposal still belongs to
 * Cordis. Configuration here must be public; credentials belong to Sources.
 */
export interface MemoryStrategyConfiguration {
    apiVersion: 'dsh-mnemon/strategy-configuration/v1';
    kind: 'strategy' | 'strategy-extension';
    typeId: string;
    label: MemoryLocalizedText;
    description: MemoryLocalizedText;
    fields: readonly MemoryStrategyConfigurationField[];
    /** Same factory used by apply(); must not perform I/O or register a Fiber. */
    create(config: Record<string, MemoryJsonValue>): MemoryInstallContribution;
}
export declare function defineMemoryStrategyConfiguration(value: Omit<MemoryStrategyConfiguration, 'apiVersion'>): MemoryStrategyConfiguration;
/** Host discovery also validates modules that do not use the author helper. */
export declare function readMemoryStrategyConfiguration(value: MemoryStrategyConfiguration): MemoryStrategyConfiguration;
/** Validate and copy supplied values without applying defaults or executing code. */
export declare function memoryStrategyConfigurationValues(definition: MemoryStrategyConfiguration, input: unknown): Record<string, MemoryJsonValue>;
