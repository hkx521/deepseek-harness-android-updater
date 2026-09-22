import type { MemoryProviderConfigField, MemoryProviderDescriptor } from '../contracts.ts';
import type { MnemonTranslate } from 'dsh-mnemon/client';
export declare function providerDisplayLabel(_providerId: string, label: string): string;
export declare function providerSummary(t: MnemonTranslate, provider: MemoryProviderDescriptor): string;
export declare function providerFieldLabel(t: MnemonTranslate, field: MemoryProviderConfigField): string;
export declare function providerOptionLabel(t: MnemonTranslate, option: NonNullable<MemoryProviderConfigField['options']>[number]): string;
