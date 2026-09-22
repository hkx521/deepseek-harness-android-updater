import { t as descriptor } from "./descriptor-zBlkrGd-.js";
import { HttpMemoryProvider, MEMORY_SPACE_PROVIDER_API_VERSION, defineMemorySpaceProvider, defineMemorySpaceProviderDefinition, firstArray, jsonObject, jsonString } from "dsh-mnemon-source-memory-spaces/provider-sdk";
//#region src/driver.ts
function insight(value) {
	const item = jsonObject(value);
	const id = jsonString(item?.id);
	const content = jsonString(item?.content);
	if (id === void 0 || content === void 0) return void 0;
	const observer = jsonString(item?.observer_id) ?? jsonString(item?.observer);
	const observed = jsonString(item?.observed_id) ?? jsonString(item?.observed);
	const createdAt = jsonString(item?.created_at) ?? jsonString(item?.createdAt);
	const entities = [observer, observed].filter((entry) => entry !== void 0);
	return {
		id,
		content,
		category: jsonString(item?.level) ?? "insight",
		source: "external",
		...createdAt === void 0 ? {} : { createdAt },
		...entities.length === 0 ? {} : { entities }
	};
}
var HonchoProvider = class extends HttpMemoryProvider {
	id = "honcho";
	constructor(memorySpaces, options = {}) {
		super(memorySpaces, {
			label: descriptor.label,
			...options
		});
	}
	async discover(connection, signal) {
		const payload = await this.requestConnection(connection, "/v3/workspaces/list?page=1&size=100", {
			headers: this.headers(connection),
			json: {},
			signal
		});
		return firstArray(payload, "items", "results").flatMap((value) => {
			const item = jsonObject(value);
			const id = jsonString(item?.id);
			if (id === void 0) return [];
			const metadata = jsonObject(item?.metadata);
			return [{
				externalId: id,
				name: jsonString(metadata?.name) ?? jsonString(metadata?.title) ?? id,
				description: jsonString(metadata?.description) ?? `Honcho workspace ${id}`,
				connection: {
					workspace: id,
					userId: "*",
					agentId: "*"
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
		const payload = await this.request(body, `${this.basePath(connection)}/conclusions/query`, {
			headers: this.headers(connection),
			json: {
				query: request.query,
				top_k: Math.min(request.limit ?? 10, 100),
				filters: this.scope(connection, true)
			},
			signal
		});
		return { results: firstArray(payload, "items", "results").map(insight).filter((item) => item !== void 0) };
	}
	async list(body, request, signal) {
		const connection = this.connection(body);
		const limit = Math.min(Math.max(request.limit ?? 200, 1), 100);
		const payload = await this.request(body, `${this.basePath(connection)}/conclusions/list?page=1&size=${limit}`, {
			headers: this.headers(connection),
			json: { filters: {
				...this.scope(connection),
				...request.category === void 0 ? {} : { level: request.category }
			} },
			signal
		});
		return firstArray(payload, "items", "results").map(insight).filter((item) => item !== void 0);
	}
	async remember(body, request, signal) {
		const connection = this.connection(body);
		const payload = await this.request(body, `${this.basePath(connection)}/conclusions`, {
			headers: this.headers(connection),
			json: { conclusions: [{
				content: request.content,
				observer_id: String(connection.agentId) === "*" ? "dsh" : String(connection.agentId),
				observed_id: String(connection.userId) === "*" ? "dsh-user" : String(connection.userId),
				session_id: null
			}] },
			signal
		});
		const created = firstArray(payload, "items", "results").map(jsonObject).find((item) => item !== void 0);
		return {
			action: "stored",
			provider: this.id,
			summary: "Honcho stored an explicit peer conclusion.",
			...jsonString(created?.id) === void 0 ? {} : { id: jsonString(created?.id) }
		};
	}
	async forget(body, id, signal) {
		const connection = this.connection(body);
		await this.request(body, `${this.basePath(connection)}/conclusions/${encodeURIComponent(id)}`, {
			method: "DELETE",
			headers: this.headers(connection),
			signal
		});
		return {
			action: "deleted",
			provider: this.id,
			id
		};
	}
	basePath(connection) {
		return `/v3/workspaces/${encodeURIComponent(String(connection.workspace))}`;
	}
	scope(connection, requirePeers = false) {
		const agentId = String(connection.agentId);
		const userId = String(connection.userId);
		return {
			...agentId === "*" ? requirePeers ? { observer_id: "dsh" } : {} : { observer_id: agentId },
			...userId === "*" ? requirePeers ? { observed_id: "dsh-user" } : {} : { observed_id: userId }
		};
	}
	headers(connection) {
		const token = String(connection.apiKey ?? "").replace(/^Bearer\s+/iu, "");
		return token === "" ? {} : { Authorization: `Bearer ${token}` };
	}
};
//#endregion
//#region src/index.ts
const definition = defineMemorySpaceProviderDefinition({
	manifest: {
		apiVersion: MEMORY_SPACE_PROVIDER_API_VERSION,
		kind: "provider",
		typeId: descriptor.id,
		packageName: "dsh-mnemon-provider-honcho",
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
		scoreSemantics: "provider-native"
	},
	create: (context) => new HonchoProvider(context.memorySpaces ?? context.memoryBodies, { requestTimeoutMs: context.config.timeoutMs })
});
var src_default = defineMemorySpaceProvider({
	id: descriptor.id,
	apply(ctx, host) {
		host.install(ctx, definition);
	}
});
//#endregion
export { HonchoProvider, src_default as default, definition, descriptor };
