import { t as descriptor } from "./descriptor-C8c57i4i.js";
import { HttpMemoryProvider, MEMORY_SPACE_PROVIDER_API_VERSION, NORMALIZED_RELEVANCE_SCORE, defineMemorySpaceProvider, defineMemorySpaceProviderDefinition, firstArray, jsonNumber, jsonObject, jsonString } from "dsh-mnemon-source-memory-spaces/provider-sdk";
//#region src/driver.ts
function insight(value) {
	const item = jsonObject(value);
	const id = jsonString(item?.id);
	const content = jsonString(item?.memory) ?? jsonString(item?.chunk) ?? jsonString(item?.content);
	if (id === void 0 || content === void 0) return void 0;
	const metadata = jsonObject(item?.metadata);
	const score = jsonNumber(item?.similarity) ?? jsonNumber(item?.score);
	const createdAt = jsonString(item?.updatedAt) ?? jsonString(item?.createdAt);
	return {
		id,
		content,
		category: jsonString(metadata?.category) ?? "general",
		source: "external",
		...score === void 0 ? {} : { score },
		...createdAt === void 0 ? {} : { createdAt }
	};
}
var SupermemoryProvider = class extends HttpMemoryProvider {
	id = "supermemory";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	constructor(memorySpaces, options = {}) {
		super(memorySpaces, {
			label: descriptor.label,
			...options
		});
	}
	async discover(connection, signal) {
		const payload = await this.requestConnection(connection, "/v3/container-tags/list", {
			headers: this.headers(connection),
			signal
		});
		return firstArray(payload, "containerTags", "items").flatMap((value) => {
			const item = jsonObject(value);
			const tag = jsonString(item?.containerTag) ?? jsonString(item?.container_tag);
			if (tag === void 0) return [];
			return [{
				externalId: jsonString(item?.id) ?? tag,
				name: jsonString(item?.name) ?? tag,
				description: jsonString(item?.description) ?? `Supermemory space ${tag}`,
				connection: {
					containerTag: tag,
					searchMode: "hybrid"
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
		const payload = await this.request(body, "/v4/search", {
			headers: this.headers(connection),
			json: {
				q: request.query,
				containerTag: String(connection.containerTag),
				searchMode: String(connection.searchMode ?? "hybrid"),
				limit: request.limit ?? 10
			},
			signal
		});
		return { results: firstArray(payload, "results").map(insight).filter((item) => item !== void 0) };
	}
	async list(body, request, signal) {
		const connection = this.connection(body);
		const limit = Math.min(Math.max(request.limit ?? 200, 1), 200);
		const payload = await this.request(body, "/v4/memories/list", {
			headers: this.headers(connection),
			json: {
				containerTags: [String(connection.containerTag)],
				limit,
				page: 1,
				sort: "createdAt",
				order: "desc"
			},
			signal
		});
		const memories = firstArray(payload, "memoryEntries", "results").map(insight).filter((item) => item !== void 0);
		const documents = await this.request(body, "/v3/documents/documents", {
			headers: this.headers(connection),
			json: {
				containerTags: [String(connection.containerTag)],
				limit,
				page: 1,
				sort: "createdAt",
				order: "desc"
			},
			signal
		});
		const projectedDocuments = firstArray(documents, "documents", "memories", "results").map(insight).filter((item) => item !== void 0);
		return [...new Map([...memories, ...projectedDocuments].map((item) => [item.id, item])).values()].filter((item) => request.category === void 0 || item.category === request.category).slice(0, limit);
	}
	async remember(body, request, signal) {
		const connection = this.connection(body);
		const payload = await this.request(body, "/v3/documents", {
			headers: this.headers(connection),
			json: {
				content: request.content,
				containerTag: String(connection.containerTag),
				taskType: "memory",
				metadata: {
					sm_source: "dsh-mnemon",
					...request.category === void 0 ? {} : { category: request.category },
					...request.importance === void 0 ? {} : { importance: request.importance }
				}
			},
			signal
		});
		const result = jsonObject(payload) ?? {};
		return {
			action: "queued",
			provider: this.id,
			summary: "Supermemory accepted the memory document for extraction.",
			...jsonString(result.id) === void 0 ? {} : { id: jsonString(result.id) },
			...jsonString(result.status) === void 0 ? {} : { status: jsonString(result.status) }
		};
	}
	async forget(body, id, signal) {
		const connection = this.connection(body);
		try {
			const payload = await this.request(body, "/v4/memories", {
				method: "DELETE",
				headers: this.headers(connection),
				json: {
					id,
					containerTag: String(connection.containerTag),
					reason: "Deleted from dsh-mnemon"
				},
				signal
			});
			return {
				action: "deleted",
				provider: this.id,
				id,
				...jsonObject(payload)?.forgotten === void 0 ? {} : { forgotten: jsonObject(payload).forgotten }
			};
		} catch (error) {
			if (!(error instanceof Error) || !/HTTP 404\b/u.test(error.message)) throw error;
			await this.request(body, `/v3/documents/${encodeURIComponent(id)}`, {
				method: "DELETE",
				headers: this.headers(connection),
				signal
			});
			return {
				action: "deleted",
				provider: this.id,
				id,
				document: true
			};
		}
	}
	headers(connection) {
		return {
			Authorization: `Bearer ${String(connection.apiKey ?? "").replace(/^Bearer\s+/iu, "")}`,
			"x-sm-source": "dsh-mnemon"
		};
	}
};
//#endregion
//#region src/index.ts
const definition = defineMemorySpaceProviderDefinition({
	manifest: {
		apiVersion: MEMORY_SPACE_PROVIDER_API_VERSION,
		kind: "provider",
		typeId: descriptor.id,
		packageName: "dsh-mnemon-provider-supermemory",
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
	create: (context) => new SupermemoryProvider(context.memorySpaces ?? context.memoryBodies, { requestTimeoutMs: context.config.timeoutMs })
});
var src_default = defineMemorySpaceProvider({
	id: descriptor.id,
	apply(ctx, host) {
		host.install(ctx, definition);
	}
});
//#endregion
export { SupermemoryProvider, src_default as default, definition, descriptor };
