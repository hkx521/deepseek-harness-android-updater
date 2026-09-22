import { t as descriptor } from "./descriptor-BXhekbd6.js";
import { HttpMemoryProvider, MEMORY_SPACE_PROVIDER_API_VERSION, NORMALIZED_RELEVANCE_SCORE, defineMemorySpaceProvider, defineMemorySpaceProviderDefinition, firstArray, jsonArray, jsonNumber, jsonObject, jsonString } from "dsh-mnemon-source-memory-spaces/provider-sdk";
//#region src/driver.ts
function category(item) {
	const categories = jsonArray(item.categories).filter((value) => typeof value === "string");
	return jsonString(item.category) ?? categories[0] ?? "general";
}
function insight(value) {
	const item = jsonObject(value);
	const id = jsonString(item?.id);
	const content = jsonString(item?.memory) ?? jsonString(item?.text) ?? jsonString(item?.content);
	if (id === void 0 || content === void 0) return void 0;
	const score = jsonNumber(item?.score);
	const createdAt = jsonString(item?.created_at) ?? jsonString(item?.createdAt) ?? jsonString(item?.updated_at);
	const tags = jsonArray(item?.categories).filter((entry) => typeof entry === "string");
	return {
		id,
		content,
		category: category(item),
		source: "external",
		...score === void 0 ? {} : { score },
		...createdAt === void 0 ? {} : { createdAt },
		...tags.length === 0 ? {} : { tags }
	};
}
var Mem0Provider = class extends HttpMemoryProvider {
	id = "mem0";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	constructor(memorySpaces, options = {}) {
		super(memorySpaces, {
			label: descriptor.label,
			...options
		});
	}
	async discover(connection, signal) {
		const mode = String(connection.mode ?? "platform");
		const payload = await this.requestConnection(connection, mode === "self-hosted" ? "/entities" : "/v1/entities", {
			headers: this.headers(connection, mode),
			signal
		});
		return firstArray(payload, "entities", "results").flatMap((value) => {
			const item = jsonObject(value);
			const id = jsonString(item?.id);
			const type = jsonString(item?.type);
			if (id === void 0 || type !== "user" && type !== "agent") return [];
			const metadata = jsonObject(item?.metadata);
			const count = jsonNumber(item?.total_memories);
			return [{
				externalId: `${type}:${id}`,
				name: jsonString(item?.name) ?? jsonString(metadata?.name) ?? id,
				description: jsonString(metadata?.description) ?? `${type === "user" ? "User" : "Agent"} memory${count === void 0 ? "" : ` · ${count} memories`}`,
				connection: type === "user" ? {
					userId: id,
					agentId: "*",
					rerank: false
				} : {
					userId: "*",
					agentId: id,
					rerank: false
				}
			}];
		});
	}
	async status(body, signal) {
		try {
			await this.list(body, { limit: 1 }, signal);
			return { healthy: true };
		} catch (error) {
			return {
				healthy: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async search(body, request, signal) {
		const connection = this.connection(body);
		const mode = String(connection.mode ?? "platform");
		const filters = this.filters(connection);
		const payload = await this.request(body, mode === "self-hosted" ? "/search" : "/v3/memories/search/", {
			headers: this.headers(connection, mode),
			json: {
				query: request.query,
				filters,
				top_k: request.limit ?? 10,
				...mode === "platform" && connection.rerank === true ? { rerank: true } : {}
			},
			signal
		});
		return { results: firstArray(payload, "results", "memories").map(insight).filter((item) => item !== void 0) };
	}
	async list(body, request, signal) {
		const connection = this.connection(body);
		const mode = String(connection.mode ?? "platform");
		const limit = Math.min(Math.max(request.limit ?? 200, 1), 200);
		const payload = mode === "self-hosted" ? await this.request(body, `/memories?${new URLSearchParams({
			...this.filters(connection),
			limit: String(limit)
		})}`, {
			headers: this.headers(connection, mode),
			signal
		}) : await this.request(body, `/v3/memories/?page=1&page_size=${limit}`, {
			headers: this.headers(connection, mode),
			json: {
				filters: this.filters(connection),
				...request.category === void 0 ? {} : { categories: [request.category] }
			},
			signal
		});
		return firstArray(payload, "results", "memories").map(insight).filter((item) => item !== void 0);
	}
	async remember(body, request, signal) {
		const connection = this.connection(body);
		const mode = String(connection.mode ?? "platform");
		const payload = await this.request(body, mode === "self-hosted" ? "/memories" : "/v3/memories/add/", {
			headers: this.headers(connection, mode),
			json: {
				messages: [{
					role: "user",
					content: request.content
				}],
				user_id: String(connection.userId) === "*" ? "dsh-user" : String(connection.userId),
				agent_id: String(connection.agentId) === "*" ? "dsh" : String(connection.agentId),
				...mode === "self-hosted" ? { infer: false } : {},
				metadata: {
					source: "dsh-mnemon",
					...request.category === void 0 ? {} : { category: request.category },
					...request.importance === void 0 ? {} : { importance: request.importance },
					...request.tags === void 0 ? {} : { tags: request.tags },
					...request.entities === void 0 ? {} : { entities: request.entities }
				}
			},
			signal
		});
		const result = jsonObject(payload) ?? {};
		return {
			action: mode === "platform" ? "queued" : "stored",
			provider: this.id,
			summary: mode === "platform" ? "Mem0 queued the memory for extraction." : "Mem0 stored the explicit memory.",
			...jsonString(result.event_id) === void 0 ? {} : { eventId: jsonString(result.event_id) },
			...jsonString(result.status) === void 0 ? {} : { status: jsonString(result.status) }
		};
	}
	async forget(body, id, signal) {
		const connection = this.connection(body);
		const mode = String(connection.mode ?? "platform");
		const path = mode === "self-hosted" ? `/memories/${encodeURIComponent(id)}` : `/v1/memories/${encodeURIComponent(id)}`;
		await this.request(body, path, {
			method: "DELETE",
			headers: this.headers(connection, mode),
			signal
		});
		return {
			action: "deleted",
			provider: this.id,
			id
		};
	}
	filters(connection) {
		const userId = String(connection.userId);
		const agentId = String(connection.agentId ?? "");
		return {
			...userId === "*" ? {} : { user_id: userId },
			...agentId === "" || agentId === "*" ? {} : { agent_id: agentId }
		};
	}
	headers(connection, mode) {
		const apiKey = String(connection.apiKey ?? "").replace(/^(?:Token|Bearer)\s+/iu, "");
		if (apiKey === "") return {};
		return mode === "self-hosted" ? { "X-API-Key": apiKey } : { Authorization: `Token ${apiKey}` };
	}
};
//#endregion
//#region src/index.ts
const definition = defineMemorySpaceProviderDefinition({
	manifest: {
		apiVersion: MEMORY_SPACE_PROVIDER_API_VERSION,
		kind: "provider",
		typeId: descriptor.id,
		packageName: "dsh-mnemon-provider-mem0",
		version: "0.5.4",
		label: descriptor.label,
		icon: descriptor.icon,
		summary: descriptor.summary,
		...descriptor.summaryI18nKey === void 0 ? {} : { summaryI18nKey: descriptor.summaryI18nKey },
		origin: descriptor.origin,
		locality: descriptor.kind,
		workspaceBinding: descriptor.workspaceBinding,
		capabilities: descriptor.capabilities,
		fields: descriptor.fields,
		secrets: descriptor.fields.filter((field) => field.input === "secret").map((field) => field.key),
		scoreSemantics: "normalized-relevance"
	},
	create: (context) => new Mem0Provider(context.memorySpaces ?? context.memoryBodies, { requestTimeoutMs: context.config.timeoutMs })
});
var src_default = defineMemorySpaceProvider({
	id: descriptor.id,
	apply(ctx, host) {
		host.install(ctx, definition);
	}
});
//#endregion
export { Mem0Provider, src_default as default, definition, descriptor };
