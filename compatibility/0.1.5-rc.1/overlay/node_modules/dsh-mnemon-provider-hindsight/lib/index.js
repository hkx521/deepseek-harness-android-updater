import { t as descriptor } from "./descriptor-BxGaZkfv.js";
import { HttpMemoryProvider, MEMORY_SPACE_PROVIDER_API_VERSION, NORMALIZED_RELEVANCE_SCORE, defineMemorySpaceProvider, defineMemorySpaceProviderDefinition, firstArray, jsonArray, jsonNumber, jsonObject, jsonString } from "dsh-mnemon-source-memory-spaces/provider-sdk";
import { randomUUID } from "node:crypto";
//#region src/driver.ts
function insight(value) {
	const item = jsonObject(value);
	const id = jsonString(item?.id);
	const content = jsonString(item?.text) ?? jsonString(item?.content) ?? jsonString(item?.label);
	if (id === void 0 || content === void 0) return void 0;
	const scores = jsonObject(item?.scores);
	const score = jsonNumber(scores?.final) ?? jsonNumber(item?.score);
	const createdAt = jsonString(item?.mentioned_at) ?? jsonString(item?.date) ?? jsonString(item?.occurred_start);
	const rawEntities = item?.entities;
	const entities = Array.isArray(rawEntities) ? rawEntities.filter((entry) => typeof entry === "string") : typeof rawEntities === "string" ? rawEntities.split(",").map((entry) => entry.replace(/\s*\([^)]*\)\s*$/u, "").trim()).filter(Boolean) : [];
	const tags = jsonArray(item?.tags).filter((entry) => typeof entry === "string");
	return {
		id,
		content,
		category: jsonString(item?.type) ?? jsonString(item?.fact_type) ?? "general",
		source: "external",
		...score === void 0 ? {} : { score },
		...createdAt === void 0 ? {} : { createdAt },
		...entities.length === 0 ? {} : { entities },
		...tags.length === 0 ? {} : { tags }
	};
}
function edgeType(value) {
	return value === "temporal" || value === "semantic" || value === "causal" || value === "entity" ? value : void 0;
}
var HindsightProvider = class extends HttpMemoryProvider {
	id = "hindsight";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	constructor(memorySpaces, options = {}) {
		super(memorySpaces, {
			label: descriptor.label,
			...options
		});
	}
	async discover(connection, signal) {
		const payload = await this.requestConnection(connection, "/v1/default/banks", {
			headers: this.headers(connection),
			signal
		});
		return firstArray(payload, "banks", "items").flatMap((value) => {
			const item = jsonObject(value);
			const id = jsonString(item?.bank_id) ?? jsonString(item?.id);
			if (id === void 0) return [];
			const description = jsonString(item?.mission)?.trim() || jsonString(item?.description)?.trim() || `Hindsight memory bank ${id}`;
			return [{
				externalId: id,
				name: jsonString(item?.name) ?? id,
				description,
				connection: {
					bankId: id,
					budget: "mid"
				}
			}];
		});
	}
	async status(body, signal) {
		try {
			const connection = this.connection(body);
			await this.request(body, "/health/live", {
				headers: this.headers(connection),
				signal
			});
			try {
				const [statsPayload, entitiesPayload] = await Promise.all([this.request(body, `${this.bankPath(connection)}/stats`, {
					headers: this.headers(connection),
					signal
				}), this.request(body, `${this.bankPath(connection)}/entities?limit=100&offset=0`, {
					headers: this.headers(connection),
					signal
				})]);
				const stats = jsonObject(statsPayload) ?? {};
				const byFactType = jsonObject(stats.nodes_by_fact_type) ?? {};
				const byCategory = Object.fromEntries(Object.entries(byFactType).flatMap(([category, count]) => {
					const value = jsonNumber(count);
					return value === void 0 ? [] : [[category, value]];
				}));
				const operations = jsonObject(stats.operations_by_status) ?? {};
				const topEntities = firstArray(entitiesPayload, "items").flatMap((value) => {
					const item = jsonObject(value);
					const entity = jsonString(item?.canonical_name);
					const count = jsonNumber(item?.mention_count);
					return entity === void 0 || count === void 0 ? [] : [{
						entity,
						count
					}];
				});
				return {
					healthy: true,
					stats: {
						totalInsights: jsonNumber(stats.total_nodes) ?? 0,
						deletedInsights: 0,
						edgeCount: jsonNumber(stats.total_links) ?? 0,
						oplogCount: Object.values(operations).reduce((total, value) => total + (jsonNumber(value) ?? 0), 0),
						dbSizeBytes: 0,
						byCategory,
						topEntities
					}
				};
			} catch {
				return { healthy: true };
			}
		} catch (error) {
			return {
				healthy: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async search(body, request, signal) {
		const connection = this.connection(body);
		const payload = await this.request(body, `${this.bankPath(connection)}/memories/recall`, {
			headers: this.headers(connection),
			json: {
				query: request.query,
				budget: String(connection.budget ?? "mid"),
				max_tokens: Math.min(Math.max((request.limit ?? 10) * 400, 400), 8e3),
				types: [
					"world",
					"experience",
					"observation"
				],
				prefer_observations: true
			},
			signal
		});
		return { results: firstArray(payload, "results", "items").map(insight).filter((item) => item !== void 0).slice(0, request.limit ?? 10) };
	}
	async list(body, request, signal) {
		const connection = this.connection(body);
		const params = new URLSearchParams({
			limit: String(Math.min(Math.max(request.limit ?? 200, 1), 1e3)),
			offset: "0",
			state: "valid"
		});
		if (request.query !== void 0 && request.query.trim() !== "") params.set("q", request.query.trim());
		const payload = await this.request(body, `${this.bankPath(connection)}/memories/list?${params}`, {
			headers: this.headers(connection),
			signal
		});
		return firstArray(payload, "items", "results").map(insight).filter((item) => item !== void 0).filter((item) => request.category === void 0 || item.category === request.category);
	}
	async graph(body, signal) {
		const connection = this.connection(body);
		const payload = jsonObject(await this.request(body, `${this.bankPath(connection)}/graph?limit=1000`, {
			headers: this.headers(connection),
			signal
		})) ?? {};
		return {
			nodes: jsonArray(payload.nodes).flatMap((value) => {
				const item = jsonObject(value);
				const data = jsonObject(item?.data) ?? item;
				const projected = insight(data);
				return projected === void 0 ? [] : [{
					...projected,
					color: jsonString(data?.color) ?? "#6574d9"
				}];
			}),
			edges: jsonArray(payload.edges).flatMap((value) => {
				const item = jsonObject(value);
				const data = jsonObject(item?.data) ?? item;
				const sourceId = jsonString(data?.from) ?? jsonString(data?.source);
				const targetId = jsonString(data?.to) ?? jsonString(data?.target);
				if (sourceId === void 0 || targetId === void 0) return [];
				const rawType = jsonString(data?.type) ?? jsonString(data?.linkType);
				const type = edgeType(rawType);
				return [{
					sourceId,
					targetId,
					label: rawType ?? "related",
					color: type === "causal" ? "#e74c3c" : type === "entity" ? "#2ecc71" : type === "temporal" ? "#aaaaaa" : "#3498db",
					...type === void 0 ? {} : { type }
				}];
			}),
			generatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	}
	async related(body, id, depth, _edge, signal) {
		const graph = await this.graph(body, signal);
		let frontier = /* @__PURE__ */ new Set([id]);
		const visited = /* @__PURE__ */ new Set([id]);
		for (let level = 0; level < depth; level += 1) {
			const next = /* @__PURE__ */ new Set();
			for (const edge of graph.edges) {
				if (frontier.has(edge.sourceId) && !visited.has(edge.targetId)) next.add(edge.targetId);
				if (frontier.has(edge.targetId) && !visited.has(edge.sourceId)) next.add(edge.sourceId);
			}
			for (const value of next) visited.add(value);
			frontier = next;
		}
		return graph.nodes.filter((node) => node.id !== id && visited.has(node.id)).map(({ color: _color, ...node }) => node);
	}
	async remember(body, request, signal) {
		const connection = this.connection(body);
		const operationId = randomUUID();
		const payload = jsonObject(await this.request(body, `${this.bankPath(connection)}/memories`, {
			headers: this.headers(connection),
			json: {
				items: [{
					content: request.content,
					context: request.category ?? "dsh-mnemon",
					metadata: { source: "dsh-mnemon" },
					...request.tags === void 0 ? {} : { tags: request.tags },
					...request.entities === void 0 ? {} : { entities: request.entities.map((text) => ({ text })) }
				}],
				async: true,
				operation_id: operationId
			},
			signal
		})) ?? {};
		return {
			action: "queued",
			provider: this.id,
			summary: "Hindsight queued the content for structured memory extraction.",
			operationId: jsonString(payload.operation_id) ?? operationId,
			...jsonNumber(payload.items_count) === void 0 ? {} : { itemsCount: jsonNumber(payload.items_count) }
		};
	}
	async forget(body, id, signal) {
		const connection = this.connection(body);
		await this.request(body, `${this.bankPath(connection)}/memories/${encodeURIComponent(id)}`, {
			method: "PATCH",
			headers: this.headers(connection),
			json: {
				state: "invalidated",
				reason: "Forgotten from dsh-mnemon"
			},
			signal
		});
		return {
			action: "invalidated",
			provider: this.id,
			id
		};
	}
	bankPath(connection) {
		return `/v1/default/banks/${encodeURIComponent(String(connection.bankId))}`;
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
		packageName: "dsh-mnemon-provider-hindsight",
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
	create: (context) => new HindsightProvider(context.memorySpaces ?? context.memoryBodies, { requestTimeoutMs: context.config.timeoutMs })
});
var src_default = defineMemorySpaceProvider({
	id: descriptor.id,
	apply(ctx, host) {
		host.install(ctx, definition);
	}
});
//#endregion
export { HindsightProvider, src_default as default, definition, descriptor };
