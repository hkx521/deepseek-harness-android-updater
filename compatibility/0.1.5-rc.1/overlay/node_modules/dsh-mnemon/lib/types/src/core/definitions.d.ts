import type { MemoryPackageProvenance, MemoryPluginDescriptor, MemorySourceDefinition, MemorySourceManifest, MemoryStrategyDefinition, MemoryStrategyExtensionDefinition } from './contracts/index.ts';
export declare function requiredText(value: unknown, label: string, maximum?: number): string;
export declare function id(value: unknown, label: string): string;
export declare function positiveInteger(value: unknown, label: string, maximum?: number): number;
/** Canonical JSON representation shared by validation, digest, and replay. */
export declare function canonicalMemoryJson(value: unknown, label?: string, ancestors?: Set<object>, depth?: number): string;
export declare function deepFreeze<T>(value: T): T;
export declare function jsonClone<T>(value: T, label: string): T;
export declare function uniqueIds(values: readonly string[], label: string): string[];
export declare function validateProvenance(value: MemoryPackageProvenance, expectedPackage: string): MemoryPackageProvenance;
export declare function validateCapabilities(values: readonly string[], label: string): MemorySourceManifest['capabilities'];
/** Validate a plugin node independently of whether its Fiber is active. */
export declare function defineMemoryPlugin(value: Omit<MemoryPluginDescriptor, 'apiVersion'> | MemoryPluginDescriptor): MemoryPluginDescriptor;
export declare function defineMemorySource<T extends MemorySourceDefinition>(definition: T): T;
export declare function defineMemoryStrategy<T extends MemoryStrategyDefinition>(definition: T): T;
export declare function defineMemoryStrategyExtension<T extends MemoryStrategyExtensionDefinition>(definition: T): T;
