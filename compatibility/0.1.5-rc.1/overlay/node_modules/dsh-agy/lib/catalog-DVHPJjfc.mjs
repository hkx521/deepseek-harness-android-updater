//#region src/adapter/catalog.ts
const AGY_PUBLIC_MODELS = [
	{
		id: "gemini-3.8-flash-tiered",
		name: "Gemini 3.8 Flash",
		contextLength: 1048576,
		maxOutputTokens: 65536,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true,
		thinking: "level"
	},
	{
		id: "gemini-3.7-flash-tiered",
		name: "Gemini 3.7 Flash",
		contextLength: 1048576,
		maxOutputTokens: 65536,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true,
		thinking: "level"
	},
	{
		id: "gemini-3.6-flash-tiered",
		name: "Gemini 3.6 Flash (Tiered)",
		contextLength: 1048576,
		maxOutputTokens: 65536,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true,
		thinking: "level"
	},
	{
		id: "gemini-3.6-flash-high",
		name: "Gemini 3.6 Flash (High)",
		contextLength: 1048576,
		maxOutputTokens: 65536,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "gemini-3.6-flash-medium",
		name: "Gemini 3.6 Flash (Medium)",
		contextLength: 1048576,
		maxOutputTokens: 65536,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "gemini-3.6-flash-low",
		name: "Gemini 3.6 Flash (Low)",
		contextLength: 1048576,
		maxOutputTokens: 65536,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "claude-opus-4-6-thinking",
		name: "Claude Opus 4.6 (Thinking)",
		contextLength: 1048576,
		maxOutputTokens: 65536,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "claude-sonnet-4-6",
		name: "Claude Sonnet 4.6 (Thinking)",
		contextLength: 1048576,
		maxOutputTokens: 65536,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "gemini-pro-agent",
		name: "Gemini 3.1 Pro (High)",
		contextLength: 1048576,
		maxOutputTokens: 65535,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "gemini-3.1-pro-low",
		name: "Gemini 3.1 Pro (Low)",
		contextLength: 1048576,
		maxOutputTokens: 65535,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "gemini-3-flash-agent",
		name: "Gemini 3.5 Flash (High)",
		contextLength: 1048576,
		maxOutputTokens: 65536,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "gemini-3.5-flash-low",
		name: "Gemini 3.5 Flash (Medium)",
		contextLength: 1048576,
		maxOutputTokens: 65536,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "gemini-3.5-flash-extra-low",
		name: "Gemini 3.5 Flash (Low)",
		contextLength: 1048576,
		maxOutputTokens: 65536,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "gemini-3.1-flash-lite",
		name: "Gemini 3.1 Flash Lite",
		contextLength: 1048576,
		maxOutputTokens: 65535,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "gemini-2.5-flash-thinking",
		name: "Gemini 2.5 Flash Thinking",
		contextLength: 1048576,
		maxOutputTokens: 65535,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "gemini-2.5-flash",
		name: "Gemini 2.5 Flash",
		contextLength: 1048576,
		maxOutputTokens: 65535,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "gemini-2.5-flash-lite",
		name: "Gemini 2.5 Flash Lite",
		contextLength: 1048576,
		maxOutputTokens: 65535,
		supportsVision: true,
		toolCalling: true
	},
	{
		id: "gpt-oss-120b-medium",
		name: "GPT-OSS 120B (Medium)",
		contextLength: 131072,
		maxOutputTokens: 32768,
		supportsReasoning: true,
		toolCalling: true
	}
];
const CATALOG_BY_ID = new Map(AGY_PUBLIC_MODELS.map((m) => [m.id, m]));
/** Format dynamic tiered model id to display name (e.g. 'gemini-3.8-flash-tiered' -> 'Gemini 3.8 Flash'). */
function formatTieredModelName(modelId) {
	return modelId.replace(/-tiered$/, "").split("-").map((part) => {
		if (/^\d+(\.\d+)*$/.test(part)) return part;
		return part.charAt(0).toUpperCase() + part.slice(1);
	}).join(" ");
}
/** Tab-completion models are discoverable but not chat-callable. */
function isChatCallableModelId(modelId) {
	return !modelId.startsWith("tab_");
}
function catalogModel(modelId) {
	const existing = CATALOG_BY_ID.get(modelId);
	if (existing) return existing;
	if (typeof modelId === "string" && modelId.endsWith("-tiered")) return {
		id: modelId,
		name: formatTieredModelName(modelId),
		contextLength: 1048576,
		maxOutputTokens: 65536,
		supportsReasoning: true,
		supportsVision: true,
		toolCalling: true,
		thinking: "level"
	};
}
/** Level-thinking models: single id + selectable low/medium/high via thinkingLevel. */
function isLevelThinkingModel(modelId) {
	if (catalogModel(modelId)?.thinking === "level") return true;
	return typeof modelId === "string" && modelId.endsWith("-tiered");
}
//#endregion
export { isLevelThinkingModel as i, catalogModel as n, isChatCallableModelId as r, AGY_PUBLIC_MODELS as t };

//# sourceMappingURL=catalog-DVHPJjfc.mjs.map