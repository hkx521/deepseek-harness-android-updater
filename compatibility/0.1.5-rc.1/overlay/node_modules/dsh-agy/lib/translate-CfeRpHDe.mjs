import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
import { v as generateAntigravityRequestId } from "./accounts-CjOuS29o.mjs";
import { i as isLevelThinkingModel } from "./catalog-DVHPJjfc.mjs";
import { createHash } from "node:crypto";
const DEFAULT_TTL_MS = 36e5;
const MAX_ENTRIES = 2e3;
const store = /* @__PURE__ */ new Map();
function pruneExpired(now = Date.now()) {
	if (store.size < MAX_ENTRIES / 2) return;
	for (const [key, entry] of store) if (entry.expiresAt <= now) store.delete(key);
}
/** Store the signature observed for one tool call id (response side). */
function setThoughtSignature(toolCallId, signature, ttlMs = DEFAULT_TTL_MS) {
	if (!toolCallId || !signature) return;
	pruneExpired();
	if (store.size >= MAX_ENTRIES) {
		let oldestKey = null;
		let oldestExpiry = Infinity;
		for (const [key, entry] of store) if (entry.expiresAt < oldestExpiry) {
			oldestExpiry = entry.expiresAt;
			oldestKey = key;
		}
		if (oldestKey) store.delete(oldestKey);
	}
	store.set(toolCallId, {
		signature,
		expiresAt: Date.now() + ttlMs
	});
}
/** Resolve the signature for one tool call id, or null when unknown/expired. */
function getThoughtSignature(toolCallId) {
	if (!toolCallId) return null;
	const entry = store.get(toolCallId);
	if (!entry) return null;
	if (entry.expiresAt <= Date.now()) {
		store.delete(toolCallId);
		return null;
	}
	return entry.signature;
}
//#endregion
//#region src/adapter/translate.ts
/**
* Translate a DSH GenerateOptions into the Antigravity wrapped request.
*
* Envelope shape follows the actively-maintained OmniRoute wire format
* (the archived opencode reference predates it): top-level `project`,
* `requestId`, `model`, `userAgent`, `requestType`, with the Gemini-style
* body under `request` (contents/systemInstruction/tools/generationConfig/
* sessionId). `toolConfig` VALIDATED is attached when tools are present, and
* Claude-path requests strip trailing model turns (Vertex rejects "assistant
* message prefill").
*
* Thinking blocks are carried as-is (Gemini `thought` parts); nothing is
* stripped or re-signed — that signature dance was an artifact of the
* reference plugin's interception architecture (see docs/ARCHITECTURE.md).
*/
var translate_exports = /* @__PURE__ */ __exportAll({
	AGY_SCHEMA_ALLOWLIST: () => AGY_SCHEMA_ALLOWLIST,
	isClaudeModel: () => isClaudeModel,
	stripTrailingModelTurn: () => stripTrailingModelTurn,
	toAgyRequestBody: () => toAgyRequestBody
});
/** Whether a model id belongs to a Claude-branded model (Vertex-hosted). */
function isClaudeModel(model) {
	return model.startsWith("claude-") || model.includes("/claude");
}
/**
* Vertex (the Antigravity Claude backend) rejects conversations ending on an
* assistant/model turn ("assistant message prefill"); never strip to empty.
*/
function stripTrailingModelTurn(contents) {
	while (contents.length > 1 && contents[contents.length - 1]?.role === "model") contents.pop();
	return contents;
}
/**
* The Antigravity backend parses tool `parameters` as a strict protobuf
* schema and rejects ANY unknown keyword with 400 (verified empirically:
* `$schema`, `propertyNames`, `pattern`, `minLength`, ... each fail in turn).
* Denylisting is whack-a-mole, so keep only the keywords the upstream
* accepts. Container shapes are handled distinctly: `properties` is a
* name->schema map (keys preserved), `items`/`additionalProperties` are
* nested schemas (additionalProperties also accepts a boolean — live-verified
* against the Antigravity upstream), `required`/`enum` are plain arrays.
*
* Keyword VALUES are also constrained by the protobuf shape (verified
* empirically): `type` must be a single enum string (union arrays like
* `["string","number"]` are rejected) and every `enum` item must be a
* string (booleans/numbers are rejected). Values are normalized to the
* nearest valid form instead of being dropped wholesale.
*/
const AGY_SCHEMA_ALLOWLIST = /* @__PURE__ */ new Set([
	"type",
	"format",
	"title",
	"description",
	"nullable",
	"items",
	"enum",
	"default",
	"properties",
	"required",
	"additionalProperties"
]);
const AGY_SCHEMA_MAP_KEYS = /* @__PURE__ */ new Set(["properties"]);
const AGY_SCHEMA_NESTED_KEYS = /* @__PURE__ */ new Set(["items", "additionalProperties"]);
const AGY_SCHEMA_LIST_KEYS = /* @__PURE__ */ new Set(["required", "enum"]);
function sanitizeToolSchema(schema) {
	if (!schema || typeof schema !== "object") return schema;
	if (Array.isArray(schema)) return schema.map((entry) => sanitizeToolSchema(entry));
	let normalized = schema;
	if (Array.isArray(normalized.type)) {
		const types = normalized.type.filter((t) => typeof t === "string" && t !== "null");
		normalized = {
			...normalized,
			type: types[0] ?? "string"
		};
	}
	const result = {};
	for (const [key, value] of Object.entries(normalized)) {
		if (!AGY_SCHEMA_ALLOWLIST.has(key)) continue;
		if (AGY_SCHEMA_MAP_KEYS.has(key)) {
			const map = {};
			for (const [name, child] of Object.entries(value)) map[name] = sanitizeToolSchema(child);
			result[key] = map;
			continue;
		}
		if (AGY_SCHEMA_NESTED_KEYS.has(key)) {
			result[key] = sanitizeToolSchema(value);
			continue;
		}
		if (AGY_SCHEMA_LIST_KEYS.has(key)) {
			if (key === "enum" && Array.isArray(value)) {
				const filtered = value.filter((v) => typeof v === "string");
				if (filtered.length > 0) result[key] = filtered;
			} else result[key] = value;
			continue;
		}
		result[key] = value;
	}
	return result;
}
/** Collect tool-call names by id so tool-result blocks can name their function. */
function buildToolNameIndex(messages) {
	const index = /* @__PURE__ */ new Map();
	for (const message of messages) for (const block of message.content) if (block.type === "tool-call") index.set(block.id, block.name);
	return index;
}
function blockToParts(block, toolNames, images) {
	switch (block.type) {
		case "text": return [{ text: block.text }];
		case "reasoning": return [{
			thought: true,
			text: block.text
		}];
		case "tool-call": {
			let args = {};
			if (typeof block.arguments === "object" && block.arguments !== null && !Array.isArray(block.arguments)) args = block.arguments;
			else if (typeof block.arguments === "string") try {
				const parsed = JSON.parse(block.arguments);
				if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) args = parsed;
			} catch {}
			return [{
				thoughtSignature: getThoughtSignature(block.id) ?? "skip_thought_signature_validator",
				functionCall: {
					id: block.id,
					name: block.name,
					args
				}
			}];
		}
		case "tool-result": return [{ functionResponse: {
			name: toolNames.get(block.toolCallId) ?? block.toolCallId,
			response: {
				result: block.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
				is_error: block.isError === true
			}
		} }];
		case "image": {
			const resolved = images.get(block.attachment.attachmentId);
			if (!resolved) throw new Error(`agy translate: unresolved image attachment "${block.attachment.attachmentId}"`);
			return [{ inlineData: {
				mimeType: resolved.mediaType,
				data: resolved.data
			} }];
		}
		default: return [];
	}
}
function messageToContent(message, toolNames, images) {
	const parts = message.content.flatMap((block) => block.type === "image" && message.role !== "user" ? [] : blockToParts(block, toolNames, images));
	if (parts.length === 0) return null;
	return {
		role: message.role === "assistant" ? "model" : "user",
		parts
	};
}
/**
* Builtin Gemini tools must not shadow functionDeclarations names (upstream
* treats them as native tools; verified by OmniRoute's GEMINI_BUILTIN_TOOL_NAMES).
*/
const AGY_BUILTIN_TOOL_NAMES = /* @__PURE__ */ new Set([
	"google_search",
	"web_search",
	"search_web",
	"googleSearch"
]);
/** Level-thinking: single id + selectable low/medium/high via thinkingLevel (catalog thinking:'level'). */
const LEVEL_THINKING_LEVELS = /* @__PURE__ */ new Set([
	"low",
	"medium",
	"high"
]);
/** Upstream functionDeclarations names are `[a-zA-Z0-9_]` and ≤64 chars (OmniRoute-verified). */
const AGY_TOOL_NAME_MAX_LENGTH = 64;
/** Sanitize a tool name to the upstream charset/length; dedupe via a short hash. */
function sanitizeToolName(name, seen) {
	let candidate = name.replace(/[^a-zA-Z0-9_]/g, "_") || "tool";
	if (candidate.length > AGY_TOOL_NAME_MAX_LENGTH || seen.has(candidate)) {
		const hash = createHash("sha256").update(candidate).digest("hex").slice(0, 8);
		const prefix = candidate.slice(0, AGY_TOOL_NAME_MAX_LENGTH - hash.length - 1);
		candidate = `${prefix}_${hash}`;
		let i = 2;
		while (seen.has(candidate)) candidate = `${prefix}_${i++}_${hash}`;
	}
	seen.add(candidate);
	return candidate;
}
function toolsToDeclarations(tools) {
	if (!tools || tools.length === 0) return void 0;
	const seenNames = /* @__PURE__ */ new Set();
	const declarations = [];
	for (const tool of tools) {
		if (AGY_BUILTIN_TOOL_NAMES.has(tool.name)) continue;
		declarations.push({
			name: sanitizeToolName(tool.name, seenNames),
			description: tool.description,
			parameters: sanitizeToolSchema(tool.parameters)
		});
	}
	if (declarations.length === 0) return void 0;
	return [{ functionDeclarations: declarations }];
}
/** Build the wrapped Antigravity request body for one call. */
function toAgyRequestBody(options, context) {
	const toolNames = buildToolNameIndex(options.messages);
	const images = context.images ?? /* @__PURE__ */ new Map();
	let contents = options.messages.map((message) => messageToContent(message, toolNames, images)).filter((c) => c !== null);
	if (isClaudeModel(options.model)) contents = stripTrailingModelTurn(contents);
	const tools = toolsToDeclarations(options.tools);
	const generationConfig = {};
	if (options.temperature !== void 0) generationConfig.temperature = options.temperature;
	if (options.maxTokens !== void 0) generationConfig.maxOutputTokens = options.maxTokens;
	if (options.stop !== void 0 && options.stop.length > 0) generationConfig.stopSequences = options.stop;
	const effort = options.reasoningEffort?.toLowerCase();
	if (effort && isLevelThinkingModel(options.model) && LEVEL_THINKING_LEVELS.has(effort)) generationConfig.thinkingConfig = {
		thinkingLevel: effort,
		includeThoughts: true
	};
	return {
		project: context.projectId || void 0,
		requestId: generateAntigravityRequestId(),
		model: options.model,
		userAgent: "antigravity",
		requestType: "agent",
		request: {
			contents,
			...options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {},
			...tools ? { tools } : {},
			...tools ? { toolConfig: { functionCallingConfig: { mode: "VALIDATED" } } } : {},
			...Object.keys(generationConfig).length > 0 ? { generationConfig } : {},
			...context.sessionId ? { sessionId: context.sessionId } : {}
		}
	};
}
//#endregion
export { translate_exports as n, setThoughtSignature as r, toAgyRequestBody as t };

//# sourceMappingURL=translate-CfeRpHDe.mjs.map