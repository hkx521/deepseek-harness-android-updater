import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
import { D as getAgyBootstrapUserAgent, b as AGY_ENDPOINT_FALLBACKS } from "./accounts-CjOuS29o.mjs";
import { i as proxiedFetch } from "./proxy-DQPIwUov.mjs";
import { i as isLevelThinkingModel, n as catalogModel, r as isChatCallableModelId, t as AGY_PUBLIC_MODELS } from "./catalog-DVHPJjfc.mjs";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";
//#region src/adapter/models.ts
/**
* Model discovery: dynamic `v1internal:fetchAvailableModels` as the primary
* source (fresh ids + per-model quotaInfo), the pinned catalog merged in for
* capability metadata, and catalog fallback when the endpoint is unreachable.
*/
var models_exports = /* @__PURE__ */ __exportAll({
	AGY_PROVIDER: () => "agy",
	catalogModelList: () => catalogModelList,
	fetchAvailableModels: () => fetchAvailableModels,
	listAgyModels: () => listAgyModels,
	mergeModelCatalog: () => mergeModelCatalog,
	resolveAgyModel: () => resolveAgyModel
});
/** Level-thinking: single id + selectable low/medium/high via thinkingLevel. Default is UI hint, not wire default. */
const LEVEL_REASONING = Object.freeze({
	efforts: Object.freeze([
		{
			id: ReasoningEffortId("low"),
			name: "Low"
		},
		{
			id: ReasoningEffortId("medium"),
			name: "Medium"
		},
		{
			id: ReasoningEffortId("high"),
			name: "High"
		}
	]),
	defaultEffort: ReasoningEffortId("medium")
});
/**
* Input modalities per model. Image support follows the catalog's own
* `supportsVision` metadata for known models (gpt-oss-120b-medium is text-only
* there); unknown dynamic ids default to vision-capable — the upstream schema
* accepts inlineData across the board, and a wrong guess surfaces as a clear
* upstream 400 instead of a silent drop.
*/
const AGY_INPUT_MODALITIES = ["text", "image"];
const AGY_TEXT_ONLY_MODALITIES = ["text"];
function inputModalitiesFor(meta) {
	return [...(meta ? meta.supportsVision === true : true) ? AGY_INPUT_MODALITIES : AGY_TEXT_ONLY_MODALITIES];
}
/** Fetch the account's available models from the first reachable endpoint. */
async function fetchAvailableModels(accessToken, projectId, fetchImpl = proxiedFetch) {
	let lastError = null;
	const body = projectId ? { project: projectId } : {};
	for (const baseEndpoint of AGY_ENDPOINT_FALLBACKS) try {
		const response = await fetchImpl(`${baseEndpoint}/v1internal:fetchAvailableModels`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
				"User-Agent": getAgyBootstrapUserAgent()
			},
			body: JSON.stringify(body)
		});
		if (response.ok) return await response.json();
		lastError = /* @__PURE__ */ new Error(`fetchAvailableModels ${response.status} at ${baseEndpoint}`);
	} catch (error) {
		lastError = error;
	}
	throw lastError instanceof Error ? lastError : /* @__PURE__ */ new Error("fetchAvailableModels: all endpoints failed");
}
/** Merge dynamic ids with catalog metadata; non-chat models and unknowns keep minimal info. */
function mergeModelCatalog(dynamic) {
	const entries = [];
	for (const [id, entry] of Object.entries(dynamic.models ?? {})) {
		if (!isChatCallableModelId(id)) continue;
		const meta = catalogModel(id);
		const displayName = (entry.displayName && entry.displayName !== id ? entry.displayName : void 0) ?? meta?.name ?? entry.displayName ?? entry.modelName ?? id;
		entries.push({
			provider: "agy",
			id,
			name: displayName,
			inputModalities: inputModalitiesFor(meta),
			...meta ? { context: { contextWindow: meta.contextLength } } : {}
		});
	}
	return entries;
}
/** Catalog-only model list used when the endpoint is unreachable. */
function catalogModelList() {
	return AGY_PUBLIC_MODELS.map((model) => ({
		provider: "agy",
		id: model.id,
		name: model.name,
		inputModalities: inputModalitiesFor(model),
		context: { contextWindow: model.contextLength }
	}));
}
/** Adapter-facing listing: dynamic first, catalog fallback. */
async function listAgyModels(accessToken, projectId, fetchImpl = proxiedFetch) {
	if (!accessToken) return catalogModelList();
	try {
		const merged = mergeModelCatalog(await fetchAvailableModels(accessToken, projectId, fetchImpl));
		return merged.length > 0 ? merged : catalogModelList();
	} catch {
		return catalogModelList();
	}
}
/** Resolve one exact model's metadata (catalog-backed; dynamic ids pass through). */
function resolveAgyModel(provider, model) {
	const meta = catalogModel(model);
	if (isLevelThinkingModel(model)) return {
		provider,
		id: model,
		name: meta?.name ?? model,
		inputModalities: inputModalitiesFor(meta),
		context: { contextWindow: meta?.contextLength ?? 1048576 },
		defaultMaxTokens: meta?.maxOutputTokens ?? 65536,
		reasoning: {
			...LEVEL_REASONING,
			efforts: [...LEVEL_REASONING.efforts]
		}
	};
	return {
		provider,
		id: model,
		name: meta?.name ?? model,
		inputModalities: inputModalitiesFor(meta),
		...meta ? {
			context: { contextWindow: meta.contextLength },
			defaultMaxTokens: meta.maxOutputTokens
		} : {}
	};
}
//#endregion
export { resolveAgyModel as i, listAgyModels as n, models_exports as r, catalogModelList as t };

//# sourceMappingURL=models-BTMqI4Md.mjs.map