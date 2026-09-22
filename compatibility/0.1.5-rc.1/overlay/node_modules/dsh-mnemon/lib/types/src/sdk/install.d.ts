import type { Context } from '@deepseek-ai/cordis';
import type { InstallMemoryOptions, MemoryInstallContribution } from './service.ts';
/**
 * Register a plugin's Source and/or Strategy definitions as one Fiber-owned batch.
 * Contribution roles do not dictate package or repository boundaries.
 */
export declare function installMemory(ctx: Context, contribution: MemoryInstallContribution, options?: InstallMemoryOptions): void;
