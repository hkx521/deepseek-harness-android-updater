import { CATEGORIES, EDGE_TYPES, INTENTS, SOURCES } from "./contracts.js";
import { n as NORMALIZED_RELEVANCE_SCORE, t as runProcess } from "./process-BvrgxPNP.js";
import { i as defineMemorySpaceProviderDefinition, r as defineMemorySpaceProvider, t as MEMORY_SPACE_PROVIDER_API_VERSION } from "./definitions-DfmOqJjR.js";
//#region src/providers/http.ts
function jsonObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function jsonString(value) {
	return typeof value === "string" ? value : void 0;
}
function jsonNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function jsonArray(value) {
	return Array.isArray(value) ? value : [];
}
function firstArray(value, ...keys) {
	if (Array.isArray(value)) return value;
	const root = jsonObject(value);
	for (const key of keys) if (Array.isArray(root?.[key])) return root[key];
	const nested = jsonObject(root?.data);
	for (const key of keys) if (Array.isArray(nested?.[key])) return nested[key];
	return [];
}
function errorDetail(payload) {
	if (typeof payload === "string") return payload.trim() || void 0;
	const root = jsonObject(payload);
	const direct = jsonString(root?.message) ?? jsonString(root?.error) ?? jsonString(root?.detail);
	if (direct !== void 0) return direct;
	const error = jsonObject(root?.error);
	return jsonString(error?.message) ?? jsonString(error?.detail);
}
/** Shared timeout, cancellation, error, and projection behavior for HTTP providers. */
var HttpMemoryProvider = class {
	memorySpaces;
	label;
	requestFetch;
	requestTimeoutMs;
	/** @deprecated Use memorySpaces. */
	memoryBodies;
	constructor(memorySpaces, options = {}) {
		this.memorySpaces = memorySpaces;
		this.memoryBodies = memorySpaces;
		this.label = options.label;
		this.requestFetch = options.fetch ?? globalThis.fetch;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 15e3;
	}
	async graph(body, signal) {
		return {
			nodes: (await this.list(body, { limit: 200 }, signal)).map((item) => ({
				...item,
				color: "#6574d9"
			})),
			edges: [],
			generatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	}
	connection(body) {
		if ((body.provider.typeId ?? body.provider.id) !== this.id) throw new Error(`${this.id} cannot serve provider ${body.provider.id}`);
		return this.memorySpaces.providerConnection(body.id, body.provider.id);
	}
	async request(body, path, options = {}) {
		const connection = this.connection(body);
		return this.requestConnection(connection, path, options);
	}
	async requestConnection(connection, path, options = {}) {
		const endpoint = String(connection.endpoint ?? "").replace(/\/+$/u, "");
		const label = this.label ?? this.id;
		if (endpoint === "") throw new Error(`${label} endpoint is not configured`);
		if (!path.startsWith("/")) throw new Error(`${label} request path must be absolute`);
		options.signal?.throwIfAborted();
		const controller = new AbortController();
		const relay = () => controller.abort(options.signal?.reason);
		options.signal?.addEventListener("abort", relay, { once: true });
		const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
		const timer = setTimeout(() => controller.abort(/* @__PURE__ */ new Error(`${label} request timed out`)), timeoutMs);
		const headers = new Headers(options.headers);
		if (options.json !== void 0 && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
		try {
			const response = await this.requestFetch(`${endpoint}${path}`, {
				method: options.method ?? (options.json === void 0 ? "GET" : "POST"),
				headers,
				...options.json === void 0 ? {} : { body: JSON.stringify(options.json) },
				signal: controller.signal
			});
			const raw = await response.text();
			let payload = {};
			if (raw !== "") try {
				payload = JSON.parse(raw);
			} catch {
				payload = raw;
			}
			if (!response.ok) {
				const detail = errorDetail(payload);
				throw new Error(`${label} HTTP ${response.status}${detail === void 0 ? "" : `: ${detail}`}`);
			}
			return payload;
		} catch (error) {
			if (controller.signal.aborted && options.signal?.aborted !== true) throw new Error(`${label} request timed out after ${timeoutMs}ms`);
			throw error;
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", relay);
		}
	}
};
//#endregion
export { CATEGORIES, EDGE_TYPES, HttpMemoryProvider, INTENTS, MEMORY_SPACE_PROVIDER_API_VERSION, NORMALIZED_RELEVANCE_SCORE, SOURCES, defineMemorySpaceProvider, defineMemorySpaceProviderDefinition, firstArray, jsonArray, jsonNumber, jsonObject, jsonString, runProcess };
