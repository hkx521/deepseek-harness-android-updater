import { t as descriptor } from "./descriptor-BCPFZAYz.js";
import { MEMORY_SPACE_PROVIDER_API_VERSION, NORMALIZED_RELEVANCE_SCORE, defineMemorySpaceProvider, defineMemorySpaceProviderDefinition, runProcess } from "dsh-mnemon-source-memory-spaces/provider-sdk";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
//#region src/driver.ts
var ByteRoverProvider = class {
	memorySpaces;
	id = "byterover";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	process;
	queryTimeoutMs;
	curateTimeoutMs;
	statusCache = /* @__PURE__ */ new Map();
	statusInFlight = /* @__PURE__ */ new Map();
	constructor(memorySpaces, options = {}) {
		this.memorySpaces = memorySpaces;
		this.process = options.process ?? runProcess;
		this.queryTimeoutMs = options.queryTimeoutMs ?? 1e4;
		this.curateTimeoutMs = options.curateTimeoutMs ?? 12e4;
	}
	async discover(connection) {
		const configured = String(connection.defaultDirectory ?? "").trim();
		const existingDirectory = this.memorySpaces.list().find((body) => (body.provider.typeId ?? body.provider.id) === this.id)?.provider.settings.workingDirectory;
		const directory = configured === "" ? String(existingDirectory ?? "").trim() || join(this.memorySpaces.runner.effectiveDataDir(), "state", "byterover", "default") : isAbsolute(configured) ? configured : resolve(this.memorySpaces.runner.effectiveDataDir(), configured);
		return [{
			externalId: directory,
			name: basename(directory) || "ByteRover",
			description: `ByteRover knowledge directory at ${directory}`,
			connection: { workingDirectory: directory }
		}];
	}
	async status(body, signal) {
		if (signal !== void 0) return this.checkStatus(body, signal);
		const cached = this.statusCache.get(body.id);
		if (cached !== void 0 && Date.now() - cached.checkedAt < 6e4) return cached.value;
		const running = this.statusInFlight.get(body.id);
		if (running !== void 0) return running;
		const pending = this.checkStatus(body);
		this.statusInFlight.set(body.id, pending);
		try {
			const value = await pending;
			this.statusCache.set(body.id, {
				checkedAt: Date.now(),
				value
			});
			return value;
		} finally {
			if (this.statusInFlight.get(body.id) === pending) this.statusInFlight.delete(body.id);
		}
	}
	invalidateStatus(memoryBodyId) {
		if (memoryBodyId === void 0) this.statusCache.clear();
		else this.statusCache.delete(memoryBodyId);
	}
	async checkStatus(body, signal) {
		try {
			await this.run(body, ["status"], 15e3, signal);
			return { healthy: true };
		} catch (error) {
			return {
				healthy: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async search(body, request, signal) {
		const output = await this.run(body, [
			"query",
			"--",
			request.query.slice(0, 5e3)
		], this.queryTimeoutMs, signal);
		if (output.length < 20) return {
			results: [],
			hint: "ByteRover found no relevant memories."
		};
		const content = output.length > 8e3 ? `${output.slice(0, 8e3)}\n\n[... truncated]` : output;
		return { results: [{
			id: `byterover:${createHash("sha256").update(content).digest("hex").slice(0, 24)}`,
			content,
			category: "context",
			source: "external",
			score: 1
		}] };
	}
	async graph(body) {
		this.connection(body);
		return {
			nodes: [],
			edges: [],
			generatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	}
	async list(body, request, signal) {
		if (request.query === void 0 || request.query.trim() === "") {
			this.connection(body);
			return [];
		}
		return (await this.search(body, {
			query: request.query,
			...request.limit === void 0 ? {} : { limit: request.limit }
		}, signal)).results;
	}
	async remember(body, request, signal) {
		await this.run(body, [
			"curate",
			"--",
			request.content
		], this.curateTimeoutMs, signal);
		return {
			action: "stored",
			provider: this.id,
			summary: "ByteRover curated the memory into its knowledge tree."
		};
	}
	connection(body) {
		if ((body.provider.typeId ?? body.provider.id) !== this.id) throw new Error(`ByteRover cannot serve provider ${body.provider.id}`);
		return this.memorySpaces.providerConnection(body.id, body.provider.id);
	}
	async run(body, args, timeoutMs, signal) {
		const connection = this.connection(body);
		const command = String(connection.cliPath ?? "brv");
		const configuredDirectory = String(connection.workingDirectory ?? connection.defaultDirectory ?? "").trim();
		const defaultDirectory = join(this.memorySpaces.runner.effectiveDataDir(), "state", "byterover", "default");
		const cwd = configuredDirectory === "" ? defaultDirectory : isAbsolute(configuredDirectory) ? configuredDirectory : resolve(this.memorySpaces.runner.effectiveDataDir(), configuredDirectory);
		mkdirSync(cwd, {
			recursive: true,
			mode: 448
		});
		const apiKey = String(connection.apiKey ?? "").trim();
		const result = await this.process(command, args, {
			timeoutMs,
			maxOutputBytes: 262144,
			...signal === void 0 ? {} : { signal },
			cwd,
			label: "ByteRover",
			env: {
				...process.env,
				...apiKey === "" ? {} : { BRV_API_KEY: apiKey }
			}
		});
		const stdout = result.stdout.trim();
		const stderr = result.stderr.trim();
		if (result.exitCode !== 0) throw new Error(stderr || stdout || `ByteRover exited with code ${String(result.exitCode)}`);
		return stdout;
	}
};
//#endregion
//#region src/index.ts
const definition = defineMemorySpaceProviderDefinition({
	manifest: {
		apiVersion: MEMORY_SPACE_PROVIDER_API_VERSION,
		kind: "provider",
		typeId: descriptor.id,
		packageName: "dsh-mnemon-provider-byterover",
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
	create: (context) => new ByteRoverProvider(context.memorySpaces ?? context.memoryBodies, { queryTimeoutMs: context.config.timeoutMs })
});
var src_default = defineMemorySpaceProvider({
	id: descriptor.id,
	apply(ctx, host) {
		host.install(ctx, definition);
	}
});
//#endregion
export { ByteRoverProvider, src_default as default, definition, descriptor };
