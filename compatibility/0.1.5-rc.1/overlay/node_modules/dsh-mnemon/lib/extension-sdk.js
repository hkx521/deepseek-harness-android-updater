import { a as memoryConfigurationDigest, c as record, d as truncate, f as withMemoryStorageLock, i as integer, l as stringArray, o as migrationLineage, s as receipt, t as defineMemoryStrategyConfiguration, u as text } from "./strategy-configuration-BTXIWooc.js";
import { a as defineMemoryStrategy, i as defineMemorySource, o as defineMemoryStrategyExtension, r as defineMemoryPlugin } from "./definitions-j0FLgE0-.js";
//#region src/sdk/install.ts
function stableEntryId(ctx, explicit) {
	const configured = explicit?.trim();
	if (configured !== void 0 && configured !== "") return configured;
	const located = ctx.get("loader", false)?.locate(ctx.fiber)?.trim();
	if (located !== void 0 && located !== "") return located;
	const entryId = ctx.fiber.entry?.options?.id;
	if (typeof entryId === "string" && entryId.trim() !== "") return entryId.trim();
	throw new Error("installMemory requires a stable Loader Entry id; pass options.instanceId for direct ctx.plugin() mounts");
}
/**
* Register a plugin's Source and/or Strategy definitions as one Fiber-owned batch.
* Contribution roles do not dictate package or repository boundaries.
*/
function installMemory(ctx, contribution, options = {}) {
	const entryId = stableEntryId(ctx, options.instanceId);
	ctx.effect(() => ctx.mnemonMemory.installContributions(contribution, {
		...options,
		instanceId: entryId
	}), `dsh-mnemon: install ${entryId}`);
}
//#endregion
export { receipt as createMemoryMutationReceipt, defineMemoryPlugin, defineMemorySource, defineMemoryStrategy, defineMemoryStrategyConfiguration, defineMemoryStrategyExtension, installMemory, memoryConfigurationDigest, integer as memoryInputInteger, migrationLineage as memoryInputMigrationLineage, record as memoryInputRecord, stringArray as memoryInputStringArray, text as memoryInputText, truncate as truncateMemoryText, withMemoryStorageLock };
