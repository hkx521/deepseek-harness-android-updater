import { t as descriptor } from "./descriptor-PFXbOWpo.js";
import { HttpMemoryProvider, MEMORY_SPACE_PROVIDER_API_VERSION, NORMALIZED_RELEVANCE_SCORE, defineMemorySpaceProvider, defineMemorySpaceProviderDefinition, firstArray, jsonNumber, jsonObject, jsonString } from "dsh-mnemon-source-memory-spaces/provider-sdk";
//#region src/driver.ts
function insight(value) {
	const item = jsonObject(value);
	const id = jsonString(item?.id) ?? jsonString(item?.memory_id);
	const content = jsonString(item?.content) ?? jsonString(item?.memory) ?? jsonString(item?.text);
	if (id === void 0 || content === void 0) return void 0;
	const score = jsonNumber(item?.score) ?? jsonNumber(item?.similarity);
	const createdAt = jsonString(item?.created_at) ?? jsonString(item?.createdAt) ?? jsonString(item?.updated_at);
	return {
		id,
		content,
		category: jsonString(item?.memory_type) ?? jsonString(item?.category) ?? "general",
		source: "external",
		...score === void 0 ? {} : { score },
		...createdAt === void 0 ? {} : { createdAt }
	};
}
var RetainDbProvider = class extends HttpMemoryProvider {
	id = "retaindb";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	constructor(memorySpaces, options = {}) {
		super(memorySpaces, {
			label: descriptor.label,
			...options
		});
	}
	async discover(connection, signal) {
		const payload = await this.requestConnection(connection, "/v1/projects", {
			headers: this.headers(connection, "/v1/projects"),
			signal
		});
		return firstArray(payload, "projects", "items").flatMap((value) => {
			const item = jsonObject(value);
			const project = jsonString(item?.slug) ?? jsonString(item?.name) ?? jsonString(item?.id);
			if (project === void 0) return [];
			return [{
				externalId: jsonString(item?.id) ?? project,
				name: jsonString(item?.name) ?? project,
				description: jsonString(item?.description) ?? `RetainDB project ${project}`,
				connection: {
					project,
					userId: "*"
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
		const payload = await this.request(body, "/v1/memory/search", {
			headers: this.headers(connection, "/v1/memory/search"),
			json: {
				project: String(connection.project),
				query: request.query,
				...String(connection.userId) === "*" ? {} : { user_id: String(connection.userId) },
				session_id: `dsh-${body.id}`,
				top_k: request.limit ?? 10,
				include_pending: true
			},
			signal
		});
		return { results: firstArray(payload, "results", "memories").map(insight).filter((item) => item !== void 0) };
	}
	async list(body, request, signal) {
		const connection = this.connection(body);
		const params = new URLSearchParams({
			project: String(connection.project),
			include_pending: "true"
		});
		let payload;
		try {
			if (String(connection.userId) === "*") throw new Error("project-wide scope uses the collection endpoint");
			payload = await this.request(body, `/v1/memory/profile/${encodeURIComponent(String(connection.userId))}?${params}`, {
				headers: this.headers(connection, "/v1/memory/profile"),
				signal
			});
		} catch {
			if (String(connection.userId) !== "*") params.set("user_id", String(connection.userId));
			params.set("limit", String(Math.min(Math.max(request.limit ?? 200, 1), 200)));
			payload = await this.request(body, `/v1/memories?${params}`, {
				headers: this.headers(connection, "/v1/memories"),
				signal
			});
		}
		return firstArray(payload, "memories", "results").map(insight).filter((item) => item !== void 0).filter((item) => request.category === void 0 || item.category === request.category).slice(0, Math.min(Math.max(request.limit ?? 200, 1), 200));
	}
	async remember(body, request, signal) {
		const connection = this.connection(body);
		const json = {
			project: String(connection.project),
			content: request.content,
			memory_type: request.category ?? "factual",
			user_id: String(connection.userId) === "*" ? "dsh-user" : String(connection.userId),
			session_id: `dsh-${body.id}`,
			importance: request.importance ?? .7,
			write_mode: "sync"
		};
		let payload;
		try {
			payload = await this.request(body, "/v1/memory", {
				headers: this.headers(connection, "/v1/memory"),
				json,
				signal
			});
		} catch {
			const { write_mode: _writeMode, ...legacy } = json;
			payload = await this.request(body, "/v1/memories", {
				headers: this.headers(connection, "/v1/memories"),
				json: legacy,
				signal
			});
		}
		const result = jsonObject(payload) ?? {};
		return {
			action: "stored",
			provider: this.id,
			summary: "RetainDB stored the memory synchronously.",
			...jsonString(result.id) === void 0 ? {} : { id: jsonString(result.id) }
		};
	}
	async forget(body, id, signal) {
		const connection = this.connection(body);
		try {
			await this.request(body, `/v1/memory/${encodeURIComponent(id)}`, {
				method: "DELETE",
				headers: this.headers(connection, "/v1/memory"),
				signal
			});
		} catch {
			await this.request(body, `/v1/memories/${encodeURIComponent(id)}`, {
				method: "DELETE",
				headers: this.headers(connection, "/v1/memories"),
				signal
			});
		}
		return {
			action: "deleted",
			provider: this.id,
			id
		};
	}
	headers(connection, path) {
		const token = String(connection.apiKey ?? "").replace(/^Bearer\s+/iu, "");
		return {
			Authorization: `Bearer ${token}`,
			"x-sdk-runtime": "dsh-mnemon",
			...path.startsWith("/v1/memory") || path.startsWith("/v1/context") ? { "X-API-Key": token } : {}
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
		packageName: "dsh-mnemon-provider-retaindb",
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
	create: (context) => new RetainDbProvider(context.memorySpaces ?? context.memoryBodies, { requestTimeoutMs: context.config.timeoutMs })
});
var src_default = defineMemorySpaceProvider({
	id: descriptor.id,
	apply(ctx, host) {
		host.install(ctx, definition);
	}
});
//#endregion
export { RetainDbProvider, src_default as default, definition, descriptor };
