import type { JSX } from 'react';
import type { MemoryProviderIcon, MemoryProviderId } from '../contracts.ts';
export interface ProviderIconProps {
    providerId: MemoryProviderId;
    icon?: MemoryProviderIcon | undefined;
    className?: string | undefined;
    title?: string | undefined;
}
/** Only the owning plugin supplies image data; unknown brands get a neutral mark. */
export declare function ProviderIcon({ providerId, icon, className, title }: ProviderIconProps): JSX.Element;
