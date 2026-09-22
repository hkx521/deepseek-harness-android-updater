import { defineMemoryStrategyExtension, memoryInputInteger, memoryInputRecord, memoryInputText } from "dsh-mnemon/extension-sdk";
import { COMPOSABLE_MEMORY_API_VERSION } from "dsh-mnemon/contracts";
//#region src/extension-sdk.ts
/** Pure default-product policy. The Host executes it through public Source protocols. */
function threeTierActionWorkflow(strategyTypeId, sourceTypeId, actionId) {
	return strategyTypeId === "default-three-tier" && sourceTypeId === "runtime" && actionId === "mutate" ? "runtime-capacity" : void 0;
}
function keys(value, label) {
	if (!Array.isArray(value) || value.length > 32 || value.some((key) => typeof key !== "string" || !/^source:[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,292}$/u.test(key))) throw new Error(`${label} must contain at most 32 exact Source instance keys`);
	if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicate Source keys`);
	return [...value];
}
function validateThreeTierExtension(slot, value) {
	const input = memoryInputRecord(value, `three-tier ${slot} contribution`);
	const allowed = slot === "selection" ? ["sourceKeys", "writableSourceKeys"] : slot === "projection" ? ["maxProjectionCharacters"] : slot === "capture" ? [
		"instruction",
		"actionIds",
		"sourceKeys"
	] : [];
	if (allowed.length === 0) throw new Error(`unsupported three-tier extension slot: ${String(slot)}`);
	for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new Error(`unsupported three-tier ${slot} field: ${key}`);
	let result;
	if (slot === "selection") {
		const sourceKeys = keys(input.sourceKeys, "sourceKeys");
		const writableSourceKeys = input.writableSourceKeys === void 0 ? void 0 : keys(input.writableSourceKeys, "writableSourceKeys");
		if (writableSourceKeys?.some((key) => !sourceKeys.includes(key))) throw new Error("writableSourceKeys must be within selected sourceKeys");
		result = {
			sourceKeys,
			...writableSourceKeys === void 0 ? {} : { writableSourceKeys }
		};
	} else if (slot === "projection") {
		if (input.maxProjectionCharacters === void 0) throw new Error("maxProjectionCharacters is required");
		result = { maxProjectionCharacters: memoryInputInteger(input.maxProjectionCharacters, 4096, 1, 1e7) };
	} else {
		if (!Array.isArray(input.actionIds) || input.actionIds.length === 0 || input.actionIds.length > 32 || input.actionIds.some((id) => typeof id !== "string" || !/^[a-z][a-z0-9-]{0,127}$/u.test(id)) || new Set(input.actionIds).size !== input.actionIds.length) throw new Error("capture actionIds must name 1..32 distinct Source-local recording actions");
		result = {
			instruction: memoryInputText(input.instruction, "capture instruction", 4e3),
			actionIds: [...input.actionIds],
			...input.sourceKeys === void 0 ? {} : { sourceKeys: keys(input.sourceKeys, "capture sourceKeys") }
		};
	}
	return result;
}
function defineThreeTierExtension(definition) {
	return defineMemoryStrategyExtension({
		manifest: {
			apiVersion: COMPOSABLE_MEMORY_API_VERSION,
			kind: "strategy-extension",
			typeId: definition.typeId,
			packageName: definition.packageName,
			strategyTypeId: "default-three-tier",
			slot: definition.slot,
			deterministic: true
		},
		contribute: (request, sources) => validateThreeTierExtension(definition.slot, definition.contribute(request, sources))
	});
}
function threeTierContributions(values) {
	const output = {};
	for (const contribution of values) {
		const slot = contribution.slot;
		if (Object.hasOwn(output, slot)) throw new Error(`duplicate three-tier extension slot: ${slot}`);
		const value = validateThreeTierExtension(slot, contribution.value);
		Object.assign(output, { [slot]: value });
	}
	return output;
}
//#endregion
export { defineThreeTierExtension, threeTierActionWorkflow, threeTierContributions, validateThreeTierExtension };
