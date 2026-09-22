import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
import * as DshLlm from "@deepseek-ai/dsh-llm";
//#region src/adapter/parse.ts
var parse_exports = /* @__PURE__ */ __exportAll({
	parseAgySse: () => parseAgySse,
	parseSseDataLine: () => parseSseDataLine
});
const CallId = DshLlm.ToolCallId ?? DshLlm.CallId;
if (!CallId) throw new Error("dsh-llm: neither ToolCallId nor CallId found");
/**
* Parse one SSE `data:` line; returns null for `[DONE]` or empty lines.
* Accepts the `{"response": {...}}` envelope (daily endpoint wire shape) and
* the bare array/object shapes older clients emitted.
*/
function parseSseDataLine(line) {
	const trimmed = line.trim();
	if (!trimmed.startsWith("data:")) return null;
	const data = trimmed.slice(5).trim();
	if (data === "" || data === "[DONE]") return null;
	const parsed = JSON.parse(data);
	const root = parsed?.response ?? parsed;
	return (Array.isArray(root) ? root[0] : root) ?? null;
}
function mapFinishReason(reason) {
	switch (reason) {
		case "MAX_TOKENS": return { kind: "max-tokens" };
		case "STOP": return { kind: "stop" };
		case "TOOL_CALLS":
		case "FUNCTION_CALL": return { kind: "tool-calls" };
		default: return { kind: "stop" };
	}
}
async function* parseAgySse(body, options = {}) {
	const { signal } = options;
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let blockIndex = 0;
	let finishReason = { kind: "stop" };
	let sawUsage = false;
	let lastUsage = null;
	let open = null;
	const closeBlock = () => {
		if (!open) return null;
		const block = open.kind === "tool-call" ? {
			type: "block-end",
			index: blockIndex,
			block: {
				type: "tool-call",
				id: CallId(open.id ?? `call-${blockIndex}`),
				name: open.name ?? "",
				arguments: open.arguments
			}
		} : {
			type: "block-end",
			index: blockIndex,
			block: {
				type: open.kind,
				text: open.text
			}
		};
		open = null;
		blockIndex += 1;
		return block;
	};
	/**
	* Ensure a block of the given kind is open, switching when needed.
	* Returns chunks to yield (a closed block's end, then the new block's start).
	* Callers MUST yield everything returned — dropping the end silently corrupts
	* the block stream for DSH (verified: multi-tool turns and text→tool
	* transitions lost their block-end).
	*/
	const ensureBlock = (kind, meta = {}) => {
		const out = [];
		if (open && open.kind !== kind) {
			const end = closeBlock();
			if (end) out.push(end);
		}
		if (!open) {
			open = {
				kind,
				arguments: "",
				text: "",
				id: meta.id,
				name: meta.name
			};
			const blockType = kind === "tool-call" ? "tool-call" : kind;
			out.push({
				type: "block-start",
				index: blockIndex,
				blockType
			});
		}
		return out;
	};
	try {
		while (true) {
			if (signal?.aborted) throw new DOMException("aborted", "AbortError");
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let newlineIndex;
			while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, newlineIndex);
				buffer = buffer.slice(newlineIndex + 1);
				if (!line.startsWith("data:")) continue;
				const payload = parseSseDataLine(line);
				if (!payload) continue;
				if (payload.error) {
					const message = payload.error.message ?? payload.error.status ?? "upstream error";
					throw new Error(`agy stream error (${payload.error.code ?? "unknown"}): ${message}`);
				}
				for (const candidate of payload.candidates ?? []) {
					if (candidate.finishReason) finishReason = mapFinishReason(candidate.finishReason);
					for (const part of candidate.content?.parts ?? []) if (part.text !== void 0 && part.thought !== true) {
						for (const chunk of ensureBlock("text")) yield chunk;
						open.text += part.text;
						yield {
							type: "text-delta",
							index: blockIndex,
							text: part.text
						};
					} else if (part.text !== void 0 && part.thought === true) {
						for (const chunk of ensureBlock("reasoning")) yield chunk;
						open.text += part.text;
						yield {
							type: "reasoning-delta",
							index: blockIndex,
							text: part.text
						};
					} else if (part.functionCall) {
						const upstreamId = part.functionCall.id || String(blockIndex);
						if (open) {
							const end = closeBlock();
							if (end) yield end;
						}
						const start = ensureBlock("tool-call", {
							id: upstreamId,
							name: part.functionCall.name
						});
						if (start.length > 0) yield start[0];
						if (part.thoughtSignature) options.onToolSignature?.(upstreamId, part.thoughtSignature);
						const argsJson = typeof part.functionCall.args === "string" ? part.functionCall.args : JSON.stringify(part.functionCall.args ?? {});
						open.arguments += argsJson;
						yield {
							type: "tool-call-delta",
							index: blockIndex,
							id: CallId(open.id ?? ""),
							name: open.name,
							argumentsDelta: argsJson
						};
					}
				}
				if (payload.usageMetadata) {
					sawUsage = true;
					const promptTokens = payload.usageMetadata.promptTokenCount ?? 0;
					const cachedTokens = payload.usageMetadata.cachedContentTokenCount ?? 0;
					lastUsage = {
						inputTokens: Math.max(0, promptTokens - cachedTokens),
						outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0,
						cacheReadTokens: cachedTokens
					};
				}
			}
		}
		const closed = closeBlock();
		if (closed) yield closed;
		if (lastUsage) yield {
			type: "usage",
			usage: lastUsage
		};
		else if (sawUsage) yield {
			type: "usage",
			usage: {
				inputTokens: 0,
				outputTokens: 0
			}
		};
		yield {
			type: "finish",
			reason: finishReason
		};
	} finally {
		reader.releaseLock();
	}
}
//#endregion
export { parse_exports as n, parseAgySse as t };

//# sourceMappingURL=parse-Bs4rPkHA.mjs.map