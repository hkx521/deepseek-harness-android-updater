import { t as descriptor } from "./descriptor-OAMVgT8m.js";
import { MEMORY_SPACE_PROVIDER_API_VERSION, NORMALIZED_RELEVANCE_SCORE, defineMemorySpaceProvider, defineMemorySpaceProviderDefinition } from "dsh-mnemon-source-memory-spaces/provider-sdk";
import { randomUUID } from "node:crypto";
//#region src/driver.ts
function object(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function string(value) {
	return typeof value === "string" ? value : void 0;
}
function number(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function delay(ms, signal) {
	if (signal?.aborted === true) return Promise.reject(signal.reason ?? /* @__PURE__ */ new Error("OpenViking request aborted"));
	return new Promise((resolve, reject) => {
		const aborted = () => {
			clearTimeout(timer);
			reject(signal?.reason ?? /* @__PURE__ */ new Error("OpenViking request aborted"));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", aborted);
			resolve();
		}, ms);
		signal?.addEventListener("abort", aborted, { once: true });
	});
}
function categoryFromUri(uri) {
	const marker = "/memories/";
	return (uri.includes(marker) ? uri.slice(uri.indexOf(marker) + 10) : "").split("/")[0]?.replace(/\.md$/u, "") || "general";
}
var OpenVikingProvider = class {
	memorySpaces;
	id = "openviking";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	requestFetch;
	requestTimeoutMs;
	settlementTimeoutMs;
	pollIntervalMs;
	constructor(memorySpaces, options = {}) {
		this.memorySpaces = memorySpaces;
		this.requestFetch = options.fetch ?? globalThis.fetch;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 15e3;
		this.settlementTimeoutMs = options.settlementTimeoutMs ?? 12e4;
		this.pollIntervalMs = options.pollIntervalMs ?? 750;
	}
	async discover(connection, signal) {
		let account = String(connection.account ?? "").trim();
		if (account === "") {
			const accounts = await this.requestConnection(connection, "/api/v1/admin/accounts", {}, { signal });
			const ids = (Array.isArray(accounts) ? accounts : []).flatMap((value) => {
				const id = string(object(value)?.account_id) ?? string(object(value)?.id);
				return id === void 0 ? [] : [id];
			});
			if (ids.length > 1) throw new Error("OpenViking exposes multiple accounts; configure the account to select one discovery scope");
			account = ids[0] ?? "default";
		}
		const users = await this.requestConnection({
			...connection,
			account
		}, `/api/v1/admin/accounts/${encodeURIComponent(account)}/users?limit=100`, {}, { signal });
		return (Array.isArray(users) ? users : []).flatMap((value) => {
			const item = object(value);
			const user = string(item?.user_id) ?? string(item?.id) ?? string(item?.name);
			if (user === void 0) return [];
			return [{
				externalId: `${account}:${user}`,
				name: string(item?.display_name) ?? string(item?.name) ?? user,
				description: string(item?.description) ?? string(item?.role) ?? `OpenViking memory namespace for ${user}`,
				connection: {
					targetUri: "viking://user/memories",
					user,
					actorPeerId: "dsh"
				}
			}];
		});
	}
	async status(body, signal) {
		try {
			await this.request(body, "/health", {}, {
				signal,
				timeoutMs: 5e3
			});
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
		const root = object(await this.request(body, "/api/v1/search/find", {
			method: "POST",
			body: JSON.stringify({
				query: request.query,
				target_uri: connection.targetUri,
				context_type: ["memory"],
				limit: request.limit
			})
		}, { signal }));
		return { results: (Array.isArray(root?.memories) ? root.memories : []).flatMap((value) => {
			const item = object(value);
			const uri = string(item?.uri);
			if (uri === void 0) return [];
			const score = number(item?.score);
			return [{
				id: uri,
				externalUri: uri,
				content: string(item?.overview) ?? string(item?.abstract) ?? uri,
				category: string(item?.category) ?? categoryFromUri(uri),
				source: "external",
				...score === void 0 ? {} : { score }
			}];
		}) };
	}
	async graph(body, signal) {
		return {
			nodes: (await this.list(body, { limit: 200 }, signal)).map((item) => ({
				...item,
				color: "#5568d9"
			})),
			edges: [],
			generatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	}
	async list(body, request, signal) {
		const connection = this.connection(body);
		const query = new URLSearchParams({
			uri: connection.targetUri,
			recursive: "true",
			output: "original"
		});
		const result = await this.request(body, `/api/v1/fs/ls?${query}`, {}, { signal });
		const entries = Array.isArray(result) ? result : [];
		const limit = Math.min(Math.max(request.limit ?? 200, 1), 1e3);
		const files = entries.flatMap((value) => {
			const item = object(value);
			const uri = string(item?.uri);
			const filename = uri?.slice(uri.lastIndexOf("/") + 1);
			return item === void 0 || uri === void 0 || item.isDir === true || filename?.startsWith(".") === true || !uri.endsWith(".md") ? [] : [{
				item,
				uri
			}];
		}).slice(0, limit);
		return Promise.all(files.map(async ({ item, uri }) => {
			let content = string(item.abstract) ?? string(item.overview) ?? "";
			if (content === "") try {
				const read = await this.request(body, `/api/v1/content/abstract?uri=${encodeURIComponent(uri)}`, {}, { signal });
				content = string(read) ?? string(object(read)?.content) ?? string(object(read)?.abstract) ?? uri;
			} catch {
				content = uri;
			}
			const createdAt = string(item.modTime);
			return {
				id: uri,
				externalUri: uri,
				content,
				category: categoryFromUri(uri),
				source: "external",
				...createdAt === void 0 ? {} : { createdAt }
			};
		}));
	}
	async remember(body, request, signal) {
		const sessionId = `dsh-mnemon-${Date.now()}-${randomUUID()}`;
		await this.request(body, "/api/v1/sessions", {
			method: "POST",
			body: JSON.stringify({ session_id: sessionId })
		}, { signal });
		await this.request(body, `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
			method: "POST",
			body: JSON.stringify({
				role: "user",
				content: request.content
			})
		}, { signal });
		const committed = object(await this.request(body, `/api/v1/sessions/${encodeURIComponent(sessionId)}/commit`, {
			method: "POST",
			body: JSON.stringify({ keep_recent_count: 0 })
		}, {
			signal,
			timeoutMs: 3e4
		}));
		const taskId = string(committed?.task_id);
		const archiveUri = string(committed?.archive_uri);
		if (taskId === void 0) return {
			action: "skipped",
			provider: "openviking",
			summary: string(committed?.reason) ?? "OpenViking did not archive a memory candidate.",
			sessionId
		};
		const task = await this.settleTask(body, taskId, signal);
		if (task === void 0) return {
			action: "queued",
			provider: "openviking",
			summary: "OpenViking accepted the session and is extracting durable memories asynchronously.",
			status: "pending",
			taskId,
			sessionId,
			...archiveUri === void 0 ? {} : { archiveUri }
		};
		const extracted = object(object(task.result)?.memories_extracted) ?? {};
		const total = Object.values(extracted).reduce((sum, value) => sum + (number(value) ?? 0), 0);
		return {
			action: total > 0 ? "stored" : "skipped",
			provider: "openviking",
			summary: total > 0 ? `OpenViking extracted ${total} durable ${total === 1 ? "memory" : "memories"}.` : "OpenViking completed extraction without a durable memory change.",
			taskId,
			sessionId,
			...archiveUri === void 0 ? {} : { archiveUri },
			extracted
		};
	}
	async forget(body, id, signal) {
		const connection = this.connection(body);
		const uri = id.trim();
		const root = connection.targetUri.replace(/\/+$/u, "");
		const filename = uri.slice(uri.lastIndexOf("/") + 1);
		if (!uri.startsWith(`${root}/`) || !uri.endsWith(".md") || filename.startsWith(".")) throw new Error("OpenViking forget requires an exact non-generated .md memory URI inside this Memory Space");
		const query = new URLSearchParams({
			uri,
			recursive: "false"
		});
		const result = object(await this.request(body, `/api/v1/fs?${query}`, { method: "DELETE" }, { signal })) ?? {};
		return {
			action: "deleted",
			provider: this.id,
			uri: string(result.uri) ?? uri,
			...number(result.estimated_deleted_count) === void 0 ? {} : { estimatedDeletedCount: number(result.estimated_deleted_count) }
		};
	}
	connection(body) {
		if ((body.provider.typeId ?? body.provider.id) !== this.id) throw new Error(`OpenViking cannot serve provider ${body.provider.id}`);
		const connection = this.memorySpaces.providerConnection(body.id, body.provider.id);
		return {
			endpoint: String(connection.endpoint ?? ""),
			targetUri: String(connection.targetUri ?? ""),
			apiKey: String(connection.apiKey ?? ""),
			account: String(connection.account ?? ""),
			user: String(connection.user ?? ""),
			actorPeerId: String(connection.actorPeerId ?? "")
		};
	}
	async settleTask(body, taskId, signal) {
		const deadline = Date.now() + this.settlementTimeoutMs;
		while (Date.now() < deadline) {
			const task = object(await this.request(body, `/api/v1/tasks/${encodeURIComponent(taskId)}`, {}, {
				signal,
				timeoutMs: 1e4
			})) ?? {};
			const status = string(task.status);
			if (status === "completed") return task;
			if (status === "failed" || status === "cancelled") throw new Error(`OpenViking memory extraction ${status}: ${string(task.error) ?? taskId}`);
			await delay(this.pollIntervalMs, signal);
		}
	}
	async request(body, path, init = {}, options = {}) {
		const connection = this.connection(body);
		return this.requestConnection(connection, path, init, options);
	}
	async requestConnection(connection, path, init = {}, options = {}) {
		options.signal?.throwIfAborted();
		const controller = new AbortController();
		const relay = () => controller.abort(options.signal?.reason);
		options.signal?.addEventListener("abort", relay, { once: true });
		const timer = setTimeout(() => controller.abort(/* @__PURE__ */ new Error("OpenViking request timed out")), options.timeoutMs ?? this.requestTimeoutMs);
		try {
			const response = await this.requestFetch(`${connection.endpoint}${path}`, {
				...init,
				headers: {
					"Content-Type": "application/json",
					...connection.apiKey === void 0 || connection.apiKey === "" ? {} : { Authorization: `Bearer ${connection.apiKey}` },
					...connection.account === void 0 || connection.account === "" ? {} : { "X-OpenViking-Account": String(connection.account) },
					...connection.user === void 0 || connection.user === "" ? {} : { "X-OpenViking-User": String(connection.user) },
					...connection.actorPeerId === void 0 || connection.actorPeerId === "" ? {} : { "X-OpenViking-Actor-Peer": String(connection.actorPeerId) },
					...init.headers
				},
				signal: controller.signal
			});
			const envelope = await response.json().catch(() => ({}));
			if (!response.ok || envelope.status === "error") {
				const trace = envelope.error?.trace_id ?? envelope.trace_id;
				throw new Error(`${envelope.error?.message ?? `OpenViking HTTP ${response.status}`}${trace === void 0 ? "" : ` (trace ${trace})`}`);
			}
			return envelope.result ?? envelope;
		} catch (error) {
			if (controller.signal.aborted && options.signal?.aborted !== true) throw new Error(`OpenViking request timed out after ${options.timeoutMs ?? this.requestTimeoutMs}ms`);
			throw error;
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", relay);
		}
	}
};
//#endregion
//#region src/index.ts
const definition = defineMemorySpaceProviderDefinition({
	manifest: {
		apiVersion: MEMORY_SPACE_PROVIDER_API_VERSION,
		kind: "provider",
		typeId: descriptor.id,
		packageName: "dsh-mnemon-provider-openviking",
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
	create: (context) => new OpenVikingProvider(context.memorySpaces ?? context.memoryBodies, {
		requestTimeoutMs: context.config.timeoutMs,
		settlementTimeoutMs: context.config.timeoutMs
	})
});
var src_default = defineMemorySpaceProvider({
	id: descriptor.id,
	apply(ctx, host) {
		host.install(ctx, definition);
	}
});
//#endregion
export { OpenVikingProvider, src_default as default, definition, descriptor };
