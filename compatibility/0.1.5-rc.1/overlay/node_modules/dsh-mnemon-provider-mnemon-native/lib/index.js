import { descriptor } from "./descriptor.js";
import { MEMORY_SPACE_PROVIDER_API_VERSION, NORMALIZED_RELEVANCE_SCORE, defineMemorySpaceProvider, defineMemorySpaceProviderDefinition } from "dsh-mnemon-source-memory-spaces/provider-sdk";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
//#region src/driver.ts
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function text(value) {
	return typeof value === "string" ? value : void 0;
}
function number(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function stringArray(value) {
	if (!Array.isArray(value)) return void 0;
	return value.filter((entry) => typeof entry === "string");
}
function normalizeInsight(value) {
	const item = record(value);
	if (item === void 0) return void 0;
	const core = record(item.insight) ?? item;
	const id = text(core.id);
	const content = text(core.content);
	if (id === void 0 || content === void 0) return void 0;
	const insight = {
		id,
		content
	};
	const optionalText = {
		category: text(core.category),
		source: text(core.source),
		confidence: text(item.confidence),
		intent: text(item.intent),
		matchedVia: text(item.matched_via ?? item.via ?? item.via_edge_type),
		createdAt: text(core.created_at),
		edgeType: text(item.via_edge_type)
	};
	for (const [key, value] of Object.entries(optionalText)) if (value !== void 0) Object.assign(insight, { [key]: value });
	const optionalNumbers = {
		importance: number(core.importance),
		score: number(item.score),
		depth: number(item.depth)
	};
	for (const [key, value] of Object.entries(optionalNumbers)) if (value !== void 0) Object.assign(insight, { [key]: value });
	const tags = stringArray(core.tags);
	const entities = stringArray(core.entities);
	if (tags !== void 0) insight.tags = tags;
	if (entities !== void 0) insight.entities = entities;
	return insight;
}
const JS_STRING = "\"(?:\\\\.|[^\"\\\\])*\"";
const VIZ_NODE_PATTERN = new RegExp(`\\{id:(${JS_STRING}),label:(${JS_STRING}),title:(${JS_STRING}),color:(${JS_STRING}),font:\\{color:"white"\\}\\}`, "g");
const VIZ_EDGE_PATTERN = new RegExp(`\\{from:(${JS_STRING}),to:(${JS_STRING}),label:(${JS_STRING}),color:\\{color:(${JS_STRING})\\},arrows:"to"`, "g");
const EDGE_COLORS = {
	"#aaaaaa": "temporal",
	"#3498db": "semantic",
	"#e74c3c": "causal",
	"#2ecc71": "entity"
};
function decodeJsString(value) {
	const decoded = JSON.parse(value);
	if (typeof decoded !== "string") throw new Error("Mnemon viz contained an invalid string");
	return decoded;
}
/** Parse the official Mnemon vis.js export without executing its HTML or loading its CDN script. */
function parseMemoryGraph(html, now = /* @__PURE__ */ new Date()) {
	const nodes = [];
	const edges = [];
	for (const match of html.matchAll(VIZ_NODE_PATTERN)) {
		const id = decodeJsString(match[1]);
		const label = decodeJsString(match[2]);
		const content = decodeJsString(match[3]).replaceAll("\\n", "\n");
		const color = decodeJsString(match[4]);
		const category = /\[([a-z_]+)\]/i.exec(label)?.[1] ?? "general";
		nodes.push({
			id,
			content,
			category,
			color
		});
	}
	for (const match of html.matchAll(VIZ_EDGE_PATTERN)) {
		const color = decodeJsString(match[4]);
		const type = EDGE_COLORS[color.toLowerCase()];
		edges.push({
			sourceId: decodeJsString(match[1]),
			targetId: decodeJsString(match[2]),
			label: decodeJsString(match[3]),
			color,
			...type === void 0 ? {} : { type }
		});
	}
	if (!html.includes("var nodes = new vis.DataSet([")) throw new Error("Mnemon viz returned an unexpected HTML payload");
	return {
		nodes,
		edges,
		generatedAt: now.toISOString()
	};
}
function commaList(values, label, limit) {
	if (values === void 0) return void 0;
	const normalized = values.map((value) => value.trim()).filter((value) => value !== "");
	if (normalized.length > limit) throw new Error(`${label} accepts at most ${limit} values`);
	if (normalized.some((value) => value.includes(","))) throw new Error(`${label} values cannot contain commas`);
	return normalized.length === 0 ? void 0 : normalized.join(",");
}
/** Native CLI data plane owned and independently testable by this Provider. */
var MnemonNativeProvider = class {
	runner;
	config;
	id = "mnemon-native";
	scoreSemantics = NORMALIZED_RELEVANCE_SCORE;
	constructor(runner, config = { defaultRecallLimit: 10 }) {
		this.runner = runner;
		this.config = config;
	}
	list(body, _request, signal) {
		return this.allNativeInsights(body, signal, true);
	}
	async status(body, signal) {
		try {
			const status = record(await this.runner.runJson(["status"], {
				...signal === void 0 ? {} : { signal },
				store: body.id
			}));
			if (status === void 0) throw new Error("mnemon status returned an unexpected payload");
			return {
				healthy: true,
				stats: this.parseStats(status)
			};
		} catch (error) {
			return {
				healthy: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	parseStats(status) {
		const byCategoryRecord = record(status.by_category) ?? {};
		const byCategory = {};
		for (const [category, count] of Object.entries(byCategoryRecord)) if (typeof count === "number") byCategory[category] = count;
		const topEntities = Array.isArray(status.top_entities) ? status.top_entities.flatMap((entry) => {
			const entity = record(entry);
			const name = text(entity?.entity);
			const count = number(entity?.count);
			return name === void 0 || count === void 0 ? [] : [{
				entity: name,
				count
			}];
		}) : [];
		return {
			totalInsights: number(status.total_insights) ?? 0,
			deletedInsights: number(status.deleted_insights) ?? 0,
			edgeCount: number(status.edge_count) ?? 0,
			oplogCount: number(status.oplog_count) ?? 0,
			dbSizeBytes: number(status.db_size_bytes) ?? 0,
			byCategory,
			topEntities
		};
	}
	async graph(body, signal) {
		const [html, insights] = await Promise.all([this.runner.runText([
			"viz",
			"--format",
			"html",
			"--output",
			"-"
		], {
			...signal === void 0 ? {} : { signal },
			store: body.id
		}), this.allNativeInsights(body, signal, true)]);
		const snapshot = parseMemoryGraph(html);
		const metadata = new Map(insights.map((insight) => [insight.id, insight]));
		return {
			...snapshot,
			nodes: snapshot.nodes.map((node) => {
				const insight = metadata.get(node.id);
				return insight === void 0 ? node : {
					...node,
					...insight,
					id: node.id,
					content: node.content,
					color: node.color
				};
			})
		};
	}
	async allNativeInsights(body, signal, readonly = false) {
		const payload = await this.runner.runJson([
			...readonly ? ["--readonly"] : [],
			"recall",
			"",
			"--basic",
			"--limit",
			"100000"
		], {
			...signal === void 0 ? {} : { signal },
			store: body.id
		});
		return (Array.isArray(payload) ? payload : Array.isArray(record(payload)?.results) ? record(payload).results : []).map(normalizeInsight).filter((entry) => entry !== void 0);
	}
	async metadataSample(body, limit, signal) {
		const payload = await this.runner.runJson([
			"--readonly",
			"recall",
			"",
			"--basic",
			"--limit",
			String(limit)
		], {
			...signal === void 0 ? {} : { signal },
			store: body.id
		});
		const wrapper = record(payload);
		return (Array.isArray(payload) ? payload : Array.isArray(wrapper?.results) ? wrapper.results : []).map(normalizeInsight).filter((entry) => entry !== void 0);
	}
	async search(body, request, signal) {
		const mode = request.mode ?? "smart";
		const args = mode === "keyword" ? [
			"search",
			request.query,
			"--limit",
			String(request.limit ?? this.config.defaultRecallLimit)
		] : [
			"recall",
			request.query,
			"--limit",
			String(request.limit ?? this.config.defaultRecallLimit)
		];
		if (mode === "basic") args.push("--basic");
		if (mode !== "keyword") {
			if (request.category !== void 0) args.push("--cat", request.category);
			if (request.source !== void 0) args.push("--source", request.source);
			if (request.intent !== void 0) args.push("--intent", request.intent);
		}
		const payload = await this.runner.runJson(args, {
			...signal === void 0 ? {} : { signal },
			store: body.id
		});
		const wrapper = record(payload);
		const values = Array.isArray(payload) ? payload : Array.isArray(wrapper?.results) ? wrapper.results : [];
		const hint = text(wrapper?.hint);
		return {
			results: values.map(normalizeInsight).filter((entry) => entry !== void 0),
			...hint === void 0 ? {} : { hint }
		};
	}
	async remember(body, request, signal) {
		const args = [
			"remember",
			request.content,
			"--cat",
			request.category ?? "general",
			"--imp",
			String(request.importance ?? 3),
			"--source",
			request.source ?? "user"
		];
		const tags = commaList(request.tags, "tags", 20);
		const entities = commaList(request.entities, "entities", 50);
		if (tags !== void 0) args.push("--tags", tags);
		if (entities !== void 0) args.push("--entities", entities);
		return this.runner.runJson(args, {
			...signal === void 0 ? {} : { signal },
			store: body.id
		});
	}
	async rememberMany(body, requests, signal) {
		if (requests.length === 0) return [];
		const existing = new Map((await this.allNativeInsights(body, signal, true)).map((entry) => [entry.content, entry]));
		const ordered = new Array(requests.length);
		const pending = /* @__PURE__ */ new Map();
		for (const [index, request] of requests.entries()) {
			const exact = existing.get(request.content);
			if (exact !== void 0) ordered[index] = {
				action: "skipped",
				id: exact.id,
				content: exact.content
			};
			else {
				const group = pending.get(request.content);
				if (group === void 0) pending.set(request.content, {
					request,
					indexes: [index]
				});
				else group.indexes.push(index);
			}
		}
		const batch = [...pending.values()];
		if (batch.length === 0) return ordered;
		const temporary = mkdtempSync(join(tmpdir(), "dsh-mnemon-runtime-archive-"));
		const draftPath = join(temporary, "memory-draft.json");
		try {
			writeFileSync(draftPath, JSON.stringify({
				schema_version: "1",
				source: "dsh-mnemon-runtime-archive",
				insights: batch.map(({ request }) => ({
					content: request.content,
					category: request.category,
					importance: request.importance,
					source: request.source,
					...request.tags === void 0 ? {} : { tags: request.tags },
					...request.entities === void 0 ? {} : { entities: request.entities }
				}))
			}), {
				encoding: "utf8",
				mode: 384
			});
			const summary = record(await this.runner.runJson([
				"import",
				draftPath,
				"--no-diff"
			], {
				...signal === void 0 ? {} : { signal },
				store: body.id
			}));
			const rows = Array.isArray(summary?.results) ? summary.results : void 0;
			const errors = number(summary?.errors);
			const imported = number(summary?.imported);
			const updated = number(summary?.updated);
			const skipped = number(summary?.skipped);
			const invalid = () => /* @__PURE__ */ new Error(`Mnemon runtime archive import returned an invalid or partial result for Memory Space ${body.id}`);
			if (errors !== 0 || imported === void 0 || updated === void 0 || skipped === void 0 || rows === void 0 || ![
				imported,
				updated,
				skipped
			].every((value) => Number.isInteger(value) && value >= 0) || imported !== batch.length || updated !== 0 || skipped !== 0 || rows.length !== batch.length) throw invalid();
			const seen = /* @__PURE__ */ new Set();
			for (const candidate of rows) {
				const row = record(candidate);
				const index = number(row?.index);
				const action = text(row?.action)?.trim().toLocaleLowerCase();
				if (index === void 0 || !Number.isInteger(index) || index < 0 || index >= batch.length || seen.has(index)) throw invalid();
				if (row?.content !== batch[index].request.content || action !== "added") throw invalid();
				seen.add(index);
				for (const [offset, originalIndex] of batch[index].indexes.entries()) ordered[originalIndex] = offset === 0 ? row : {
					...row,
					action: "skipped"
				};
			}
			return ordered;
		} finally {
			rmSync(temporary, {
				recursive: true,
				force: true
			});
		}
	}
	async related(body, id, depth, edge, signal) {
		const args = [
			"related",
			id,
			"--depth",
			String(depth)
		];
		if (edge !== void 0) args.push("--edge", edge);
		const payload = await this.runner.runJson(args, {
			...signal === void 0 ? {} : { signal },
			store: body.id
		});
		return Array.isArray(payload) ? payload.map(normalizeInsight).filter((entry) => entry !== void 0) : [];
	}
	async link(body, sourceId, targetId, type, weight, reason, signal) {
		const args = [
			"link",
			sourceId,
			targetId,
			"--type",
			type,
			"--weight",
			String(weight)
		];
		if (reason !== void 0) args.push("--meta", JSON.stringify({ reason }));
		return this.runner.runJson(args, {
			...signal === void 0 ? {} : { signal },
			store: body.id
		});
	}
	forget(body, id, signal) {
		return this.runner.runJson(["forget", id], {
			...signal === void 0 ? {} : { signal },
			store: body.id
		});
	}
};
//#endregion
//#region src/index.ts
const definition = defineMemorySpaceProviderDefinition({
	manifest: {
		apiVersion: MEMORY_SPACE_PROVIDER_API_VERSION,
		kind: "provider",
		typeId: descriptor.id,
		packageName: "dsh-mnemon-provider-mnemon-native",
		version: "0.5.5",
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
	create(context) {
		if (context.nativeRunner === void 0) throw new Error("Mnemon Native requires the Memory Spaces nativeRunner capability");
		return new MnemonNativeProvider(context.nativeRunner, { defaultRecallLimit: context.config.defaultRecallLimit ?? 10 });
	}
});
var src_default = defineMemorySpaceProvider({
	id: descriptor.id,
	apply(ctx, host) {
		host.install(ctx, definition);
	}
});
//#endregion
export { MnemonNativeProvider, src_default as default, definition, descriptor, parseMemoryGraph };
