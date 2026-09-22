import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

/** Required browser services. */
export declare const inject: string[]

/** Registers the Antigravity Settings tab while this client plugin is active. */
export declare function apply(ctx: ClientContext): void
