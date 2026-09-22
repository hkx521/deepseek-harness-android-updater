import { DEFAULT_MEMORY_VIEW_BUDGET } from "./contracts.js";
import { a as defineMemoryStrategy, c as jsonClone, d as uniqueIds, f as validateCapabilities, i as defineMemorySource, l as positiveInteger, n as deepFreeze, o as defineMemoryStrategyExtension, p as validateProvenance, r as defineMemoryPlugin, s as id, t as canonicalMemoryJson, u as requiredText } from "./definitions-j0FLgE0-.js";
import { createHash } from "node:crypto";
import { setMaxListeners } from "node:events";
//#region src/core/contributions.ts
/** Normalize public definitions before the registry validates and captures them. */
function prepareMemoryContributions(contribution, options) {
	const sources = [...contribution.sources ?? []];
	const strategies = [...contribution.strategies ?? []];
	const extensions = [...contribution.strategyExtensions ?? []];
	const entryId = options.instanceId.trim();
	if (entryId === "") throw new Error("installMemory requires a stable Loader Entry id");
	const provenance = (packageName) => ({
		packageName,
		entryId,
		...options.artifactDigest === void 0 ? {} : { artifactDigest: options.artifactDigest }
	});
	const plugins = contribution.plugin === void 0 ? [] : [{
		kind: "plugin",
		instanceKey: `plugin:${entryId}`,
		provenance: provenance(contribution.plugin.packageName),
		descriptor: contribution.plugin
	}];
	return {
		sources: sources.map((definition) => ({
			kind: "source",
			instanceKey: `source:${entryId}${sources.length > 1 ? `/${definition.manifest.typeId}` : ""}`,
			provenance: provenance(definition.manifest.packageName),
			definition,
			...options.effectiveDigest === void 0 ? {} : { effectiveDigest: options.effectiveDigest }
		})),
		strategies: strategies.map((definition) => ({
			kind: "strategy",
			instanceKey: `strategy:${entryId}${strategies.length > 1 ? `/${definition.manifest.typeId}` : ""}`,
			provenance: provenance(definition.manifest.packageName),
			definition
		})),
		strategyExtensions: extensions.map((definition) => ({
			kind: "strategy-extension",
			instanceKey: `strategy-extension:${entryId}${extensions.length > 1 ? `/${definition.manifest.typeId}` : ""}`,
			provenance: provenance(definition.manifest.packageName),
			definition
		})),
		plugins
	};
}
//#endregion
//#region src/core/source-calls.ts
/** Sanitized public failure: never forward remote errors, paths or credentials. */
var SourceReadFailure = class extends Error {
	diagnostic;
	constructor(sourceInstanceKey, phase, timeout) {
		super(`Memory Source ${sourceInstanceKey} ${phase}() ${timeout ? "timed out" : "failed"}`);
		this.diagnostic = {
			code: `source-${phase}-${timeout ? "timeout" : "failed"}`,
			message: this.message,
			contributionInstanceKey: sourceInstanceKey
		};
	}
};
/**
* Bounds read-only composition work. Signals stay outside the JSON Strategy
* input. This is cooperative cancellation, not a sandbox; writes must not be
* raced against a timeout and then falsely reported as uncommitted.
*/
async function readSource(sourceInstanceKey, phase, timeoutMs, execute, signal) {
	signal?.throwIfAborted();
	const controller = new AbortController();
	let interrupt;
	const interrupted = new Promise((_resolve, reject) => {
		interrupt = reject;
	});
	const cancel = (reason) => {
		interrupt(reason);
		controller.abort(reason);
	};
	const abort = () => cancel(signal.reason);
	signal?.addEventListener("abort", abort, { once: true });
	const timer = setTimeout(() => cancel(new SourceReadFailure(sourceInstanceKey, phase, true)), timeoutMs);
	try {
		const operation = Promise.resolve().then(() => {
			controller.signal.throwIfAborted();
			return execute(controller.signal);
		}).catch(() => {
			if (controller.signal.aborted) throw controller.signal.reason;
			throw new SourceReadFailure(sourceInstanceKey, phase, false);
		});
		return await Promise.race([operation, interrupted]);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", abort);
	}
}
//#endregion
//#region src/core/composition.ts
const INSTANCE_KEY = /^(?:source|strategy|strategy-extension):[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,299}$/u;
const PLUGIN_INSTANCE_KEY = /^plugin:[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,299}$/u;
function instanceKey(value, kind) {
	const normalized = requiredText(value, `${kind} instanceKey`, 300);
	if (!INSTANCE_KEY.test(normalized) || !normalized.startsWith(`${kind}:`)) throw new Error(`${kind} instanceKey must start with ${kind}: and contain only stable identifier characters`);
	return normalized;
}
function digest(value) {
	return createHash("sha256").update(canonicalMemoryJson(value)).digest("hex");
}
function captureSource(source) {
	const definition = defineMemorySource(source.definition);
	const key = instanceKey(source.instanceKey, "source");
	const effectiveDigest = source.effectiveDigest === void 0 ? void 0 : requiredText(source.effectiveDigest, "memory Source effective digest", 500);
	return Object.freeze({
		kind: "source",
		instanceKey: key,
		provenance: validateProvenance(source.provenance, definition.manifest.packageName),
		definition,
		...effectiveDigest === void 0 ? {} : { effectiveDigest }
	});
}
function captureStrategy(strategy) {
	const definition = defineMemoryStrategy(strategy.definition);
	return Object.freeze({
		kind: "strategy",
		instanceKey: instanceKey(strategy.instanceKey, "strategy"),
		provenance: validateProvenance(strategy.provenance, definition.manifest.packageName),
		definition
	});
}
function captureExtension(extension) {
	const definition = defineMemoryStrategyExtension(extension.definition);
	return Object.freeze({
		kind: "strategy-extension",
		instanceKey: instanceKey(extension.instanceKey, "strategy-extension"),
		provenance: validateProvenance(extension.provenance, definition.manifest.packageName),
		definition
	});
}
function capturePlugin(plugin) {
	const descriptor = defineMemoryPlugin(plugin.descriptor);
	const key = requiredText(plugin.instanceKey, "memory plugin instanceKey", 307);
	if (!PLUGIN_INSTANCE_KEY.test(key)) throw new Error("memory plugin instanceKey must start with plugin: and contain only stable identifier characters");
	return Object.freeze({
		kind: "plugin",
		instanceKey: key,
		provenance: validateProvenance(plugin.provenance, descriptor.packageName),
		descriptor
	});
}
/** Validate active dependency and exclusivity edges before any Source factory runs. */
function validateMemoryPluginGraph(plugins, implicitCapabilities = []) {
	const providers = /* @__PURE__ */ new Map();
	for (const capability of implicitCapabilities) providers.set(capability, []);
	for (const plugin of plugins) for (const capability of plugin.descriptor.provides) {
		const values = providers.get(capability.id) ?? [];
		values.push({
			plugin,
			exclusive: capability.exclusive === true
		});
		providers.set(capability.id, values);
	}
	for (const [capability, values] of providers) if (values.length > 1 && values.some((value) => value.exclusive)) throw new Error(`memory plugin capability conflict: ${capability} (${values.map((value) => value.plugin.descriptor.packageName).join(", ")})`);
	for (const plugin of plugins) for (const requirement of plugin.descriptor.requires ?? []) if (!providers.has(requirement)) throw new Error(`memory plugin dependency unavailable: ${plugin.descriptor.packageName} requires ${requirement}`);
}
function captureMemoryContributionSnapshot(snapshot) {
	if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) throw new Error("memory contribution revision must be a non-negative integer");
	const sources = snapshot.sources.map(captureSource);
	const strategies = snapshot.strategies.map(captureStrategy);
	const extensions = (snapshot.strategyExtensions ?? []).map(captureExtension).sort((a, b) => a.instanceKey.localeCompare(b.instanceKey));
	const plugins = (snapshot.plugins ?? []).map(capturePlugin).sort((a, b) => a.instanceKey.localeCompare(b.instanceKey));
	const slots = /* @__PURE__ */ new Map();
	for (const extension of extensions) {
		const manifest = extension.definition.manifest;
		const slot = `${manifest.strategyTypeId}/${manifest.slot}`;
		const occupied = slots.get(slot);
		if (occupied !== void 0) throw new Error(`memory Strategy extension slot conflict: ${slot} (${occupied}, ${extension.instanceKey})`);
		slots.set(slot, extension.instanceKey);
	}
	const keys = /* @__PURE__ */ new Set();
	for (const contribution of [
		...sources,
		...strategies,
		...extensions
	]) {
		if (keys.has(contribution.instanceKey)) throw new Error(`memory contribution instanceKey is duplicated: ${contribution.instanceKey}`);
		keys.add(contribution.instanceKey);
	}
	const pluginKeys = /* @__PURE__ */ new Set();
	for (const plugin of plugins) {
		if (pluginKeys.has(plugin.instanceKey)) throw new Error(`memory plugin instanceKey is duplicated: ${plugin.instanceKey}`);
		pluginKeys.add(plugin.instanceKey);
		const owned = [
			...sources,
			...strategies,
			...extensions
		].filter((contribution) => contribution.provenance.entryId === plugin.provenance.entryId);
		if (owned.length === 0) throw new Error(`memory plugin descriptor has no contribution: ${plugin.instanceKey}`);
		if (owned.some((contribution) => contribution.provenance.packageName !== plugin.descriptor.packageName)) throw new Error(`memory plugin descriptor package does not match an owned contribution: ${plugin.instanceKey}`);
		const roles = new Set(owned.map((contribution) => contribution.kind));
		for (const role of roles) if (!plugin.descriptor.roles.includes(role)) throw new Error(`memory plugin descriptor does not declare active role: ${role} (${plugin.instanceKey})`);
	}
	return Object.freeze({
		revision: snapshot.revision,
		sources: Object.freeze(sources),
		strategies: Object.freeze(strategies),
		...extensions.length === 0 ? {} : { strategyExtensions: Object.freeze(extensions) },
		...plugins.length === 0 ? {} : { plugins: Object.freeze(plugins) }
	});
}
function selectStrategy(strategies, options) {
	if (options.strategyInstanceKey !== void 0) {
		const key = instanceKey(options.strategyInstanceKey, "strategy");
		const selected = strategies.find((strategy) => strategy.instanceKey === key);
		if (selected === void 0) throw new Error(`selected memory Strategy instance is unavailable: ${key}`);
		return selected;
	}
	if (options.strategyTypeId !== void 0) {
		const type = id(options.strategyTypeId, "selected memory Strategy typeId");
		const matches = strategies.filter((strategy) => strategy.definition.manifest.typeId === type);
		if (matches.length === 0) throw new Error(`selected memory Strategy type is unavailable: ${type}`);
		if (matches.length > 1) throw new Error(`selected memory Strategy type is ambiguous: ${type}`);
		return matches[0];
	}
	if (strategies.length !== 1) throw new Error(`exactly one memory Strategy must be selected; found ${strategies.length}`);
	return strategies[0];
}
function normalizeBudget(value) {
	return deepFreeze({
		maxProjectionCharacters: positiveInteger(value.maxProjectionCharacters, "memory View maxProjectionCharacters", 1e7),
		maxRoutes: positiveInteger(value.maxRoutes, "memory View maxRoutes", 1e4),
		maxActions: positiveInteger(value.maxActions, "memory View maxActions", 1e4),
		maxEvidenceResults: positiveInteger(value.maxEvidenceResults, "memory View maxEvidenceResults", 1e4),
		maxEvidenceCharacters: positiveInteger(value.maxEvidenceCharacters, "memory View maxEvidenceCharacters", 1e7)
	});
}
function normalizeFacts(source, facts) {
	const manifest = source.definition.manifest;
	if (facts.sourceInstanceKey !== source.instanceKey) throw new Error(`memory Source facts instance mismatch: ${facts.sourceInstanceKey} != ${source.instanceKey}`);
	if (facts.sourceTypeId !== manifest.typeId) throw new Error(`memory Source facts type mismatch: ${facts.sourceTypeId} != ${manifest.typeId}`);
	if (facts.role !== manifest.role) throw new Error(`memory Source facts role mismatch: ${facts.role} != ${manifest.role}`);
	if (![
		"ready",
		"degraded",
		"unavailable"
	].includes(facts.availability)) throw new Error(`unsupported memory Source availability: ${String(facts.availability)}`);
	const capabilities = validateCapabilities(facts.capabilities, `memory Source facts capability for ${source.instanceKey}`);
	const allowedCapabilities = new Set(manifest.capabilities);
	for (const capability of capabilities) if (!allowedCapabilities.has(capability)) throw new Error(`memory Source facts expand manifest capability: ${source.instanceKey}/${capability}`);
	const routeIds = uniqueIds(facts.routeIds, `memory Source facts route id for ${source.instanceKey}`);
	const allowedRoutes = new Set((manifest.routes ?? []).map((route) => route.id));
	for (const routeId of routeIds) if (!allowedRoutes.has(routeId)) throw new Error(`memory Source facts expose undeclared route: ${source.instanceKey}/${routeId}`);
	const actionIds = uniqueIds(facts.actionIds, `memory Source facts action id for ${source.instanceKey}`);
	const allowedActions = new Set((manifest.actions ?? []).map((action) => action.id));
	for (const actionId of actionIds) if (!allowedActions.has(actionId)) throw new Error(`memory Source facts expose undeclared action: ${source.instanceKey}/${actionId}`);
	return jsonClone({
		sourceInstanceKey: source.instanceKey,
		sourceTypeId: manifest.typeId,
		role: manifest.role,
		availability: facts.availability,
		revision: requiredText(facts.revision, `memory Source facts revision for ${source.instanceKey}`, 500),
		capabilities,
		routeIds,
		actionIds,
		...facts.hints === void 0 ? {} : { hints: facts.hints }
	}, `memory Source facts for ${source.instanceKey}`);
}
function normalizeViewSpec(value, strategy, facts, budget) {
	if (value.strategyTypeId !== strategy.definition.manifest.typeId) throw new Error("memory ViewSpec strategyTypeId does not match the selected Strategy");
	const maxSources = Math.min(strategy.definition.manifest.maxSources, facts.size);
	if (!Array.isArray(value.sources) || value.sources.length > maxSources) throw new Error(`memory Strategy selected too many Sources (max ${maxSources})`);
	const seen = /* @__PURE__ */ new Set();
	let routes = 0;
	let actions = 0;
	const normalizedSources = value.sources.flatMap((source) => {
		const key = instanceKey(source.sourceInstanceKey, "source");
		if (seen.has(key)) throw new Error(`memory Strategy selected Source twice: ${key}`);
		seen.add(key);
		const sourceFacts = facts.get(key);
		if (sourceFacts === void 0) throw new Error(`memory Strategy selected unavailable Source: ${key}`);
		if (!strategy.definition.manifest.supportedSourceRoles.includes(sourceFacts.role)) throw new Error(`memory Strategy selected an unsupported Source role: ${sourceFacts.role}`);
		if (source.required !== void 0 && typeof source.required !== "boolean") throw new Error(`memory Source requirement must be boolean: ${key}`);
		if (sourceFacts.availability === "unavailable") {
			if (source.required === false) return [];
			throw new Error(`memory Strategy selected unavailable required Source runtime: ${key}`);
		}
		const routeIds = uniqueIds(source.routeIds ?? [], `memory ViewSpec route id for ${key}`);
		const availableRoutes = new Set(sourceFacts.routeIds);
		for (const routeId of routeIds) if (!availableRoutes.has(routeId)) throw new Error(`memory Strategy selected unavailable route: ${key}/${routeId}`);
		const actionIds = uniqueIds(source.actionIds ?? [], `memory ViewSpec action id for ${key}`);
		const availableActions = new Set(sourceFacts.actionIds);
		for (const actionId of actionIds) if (!availableActions.has(actionId)) throw new Error(`memory Strategy selected unavailable action: ${key}/${actionId}`);
		routes += routeIds.length;
		actions += actionIds.length;
		if (source.projection !== void 0 && !sourceFacts.capabilities.includes("project")) throw new Error(`memory Strategy selected unavailable projection: ${key}`);
		const projection = source.projection === void 0 ? void 0 : {
			mode: source.projection.mode,
			maxCharacters: Math.min(positiveInteger(source.projection.maxCharacters, `memory projection budget for ${key}`, 1e7), budget.maxProjectionCharacters)
		};
		if (projection !== void 0 && projection.mode !== "eager" && projection.mode !== "routed") throw new Error(`unsupported memory projection mode: ${String(projection.mode)}`);
		return [deepFreeze({
			sourceInstanceKey: key,
			required: source.required !== false,
			...projection === void 0 ? {} : { projection },
			routeIds,
			actionIds
		})];
	});
	if (routes > Math.min(strategy.definition.manifest.maxRoutes, budget.maxRoutes)) throw new Error("memory Strategy selected too many Routes");
	if (actions > Math.min(strategy.definition.manifest.maxActions, budget.maxActions)) throw new Error("memory Strategy selected too many ActionOffers");
	let guidance;
	if (value.guidance !== void 0) {
		const input = jsonClone(value.guidance, "Strategy guidance");
		if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("Strategy guidance must be an object");
		guidance = {};
		for (const key of ["system", "routing"]) if (input[key] !== void 0) guidance[key] = requiredText(input[key], "Strategy guidance " + key, 16384);
		if (input.reminders !== void 0) {
			if (input.reminders === null || typeof input.reminders !== "object" || Array.isArray(input.reminders)) throw new Error("Strategy guidance reminders must be an object");
			guidance.reminders = {};
			for (const key of [
				"read",
				"write",
				"both"
			]) if (input.reminders[key] !== void 0) guidance.reminders[key] = requiredText(input.reminders[key], "Strategy reminder " + key, 16384);
		}
	}
	return deepFreeze({
		strategyTypeId: value.strategyTypeId,
		sources: normalizedSources,
		explanation: requiredText(value.explanation, "memory ViewSpec explanation", 4e3),
		...guidance === void 0 ? {} : { guidance }
	});
}
function normalizeContribution(source, spec, facts, value) {
	const fragments = value.fragments.map((fragment, index) => {
		if (fragment.sourceInstanceKey !== source.installed.instanceKey) throw new Error(`memory View fragment Source mismatch: ${fragment.sourceInstanceKey}`);
		if (spec.projection === void 0) throw new Error(`memory Source returned projection without a Strategy request: ${source.installed.instanceKey}`);
		if (fragment.mode !== spec.projection.mode) throw new Error(`memory View fragment mode mismatch: ${source.installed.instanceKey}`);
		const text = typeof fragment.text === "string" ? fragment.text : "";
		if (text.length > spec.projection.maxCharacters) throw new Error(`memory View fragment exceeds Source projection budget: ${source.installed.instanceKey}`);
		return jsonClone({
			...fragment,
			id: requiredText(fragment.id, `memory View fragment id ${index}`, 300),
			text,
			revision: requiredText(fragment.revision, "memory View fragment revision", 500)
		}, `memory View fragment for ${source.installed.instanceKey}`);
	});
	let readGrant;
	if (value.readGrant !== void 0) {
		const grant = value.readGrant;
		if (grant.sourceInstanceKey !== source.installed.instanceKey) throw new Error(`memory ReadGrant Source mismatch: ${grant.sourceInstanceKey}`);
		if (grant.consistency !== source.installed.definition.manifest.consistency) throw new Error(`memory ReadGrant consistency expands Source manifest: ${source.installed.instanceKey}`);
		readGrant = jsonClone({
			...grant,
			id: requiredText(grant.id, "memory ReadGrant id", 300),
			schema: requiredText(grant.schema, "memory ReadGrant schema", 300),
			revision: requiredText(grant.revision, "memory ReadGrant revision", 500)
		}, `memory ReadGrant for ${source.installed.instanceKey}`);
	}
	if ((spec.routeIds?.length ?? 0) > 0 && readGrant === void 0) throw new Error(`memory Source did not return a ReadGrant for selected Routes: ${source.installed.instanceKey}`);
	let presentation;
	if (value.presentation !== void 0) {
		const label = `memory Source presentation for ${source.installed.instanceKey}`;
		const visibleItems = value.presentation.visibleItems;
		const totalItems = value.presentation.totalItems;
		if (!Number.isSafeInteger(visibleItems) || visibleItems < 0 || visibleItems > 1e9) throw new Error(`${label} visibleItems must be a non-negative safe integer`);
		if (totalItems !== void 0 && (!Number.isSafeInteger(totalItems) || totalItems < visibleItems || totalItems > 1e9)) throw new Error(`${label} totalItems must be a safe integer no smaller than visibleItems`);
		const sourceItems = value.presentation.items ?? [];
		if (!Array.isArray(sourceItems) || sourceItems.length > 24 || sourceItems.length > visibleItems) throw new Error(`${label} items must be a preview of at most 24 visible items`);
		const seen = /* @__PURE__ */ new Set();
		const items = sourceItems.map((item, index) => {
			const itemId = requiredText(item.id, `${label} item id ${index}`, 300);
			if (seen.has(itemId)) throw new Error(`${label} item id is duplicated: ${itemId}`);
			seen.add(itemId);
			return {
				id: itemId,
				title: requiredText(item.title, `${label} item title ${index}`, 160),
				...item.excerpt === void 0 ? {} : { excerpt: requiredText(item.excerpt, `${label} item excerpt ${index}`, 600) }
			};
		});
		presentation = jsonClone({
			visibleItems,
			...totalItems === void 0 ? {} : { totalItems },
			...items.length === 0 ? {} : { items }
		}, label);
	}
	if (facts.availability === "unavailable" && (fragments.length > 0 || readGrant !== void 0 || presentation !== void 0)) throw new Error(`unavailable memory Source returned a View contribution: ${source.installed.instanceKey}`);
	return deepFreeze({
		fragments,
		...readGrant === void 0 ? {} : { readGrant },
		...presentation === void 0 ? {} : { presentation }
	});
}
function routeFor(source, routeId, grant, budget) {
	const manifest = source.installed.definition.manifest.routes?.find((route) => route.id === routeId);
	if (manifest === void 0) throw new Error(`memory Source Route manifest disappeared: ${source.installed.instanceKey}/${routeId}`);
	return deepFreeze({
		id: `${source.installed.instanceKey}/${routeId}`,
		sourceInstanceKey: source.installed.instanceKey,
		sourceRouteId: routeId,
		description: manifest.description,
		capability: manifest.capability,
		inputSchema: manifest.inputSchema,
		readGrantId: grant.id,
		maxCalls: manifest.maxCalls,
		maxResults: Math.min(manifest.maxResults ?? budget.maxEvidenceResults, budget.maxEvidenceResults),
		maxCharacters: Math.min(manifest.maxCharacters ?? budget.maxEvidenceCharacters, budget.maxEvidenceCharacters)
	});
}
function actionFor(source, actionId) {
	const manifest = source.installed.definition.manifest.actions?.find((action) => action.id === actionId);
	if (manifest === void 0) throw new Error(`memory Source Action manifest disappeared: ${source.installed.instanceKey}/${actionId}`);
	return deepFreeze({
		id: `${source.installed.instanceKey}/${actionId}`,
		sourceInstanceKey: source.installed.instanceKey,
		sourceActionId: actionId,
		description: manifest.description,
		capability: manifest.capability,
		inputSchema: manifest.inputSchema,
		...manifest.authority === void 0 ? {} : { authority: manifest.authority }
	});
}
function assertInputSchema(schemaValue, value, label) {
	if (typeof schemaValue !== "object" || schemaValue === null || Array.isArray(schemaValue)) return;
	const schema = schemaValue;
	const expected = schema.type;
	if (expected === "object") {
		if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
		const record = value;
		const required = Array.isArray(schema.required) ? schema.required.filter((item) => typeof item === "string") : [];
		for (const key of required) if (!(key in record)) throw new Error(`${label} is missing required property: ${key}`);
		const properties = typeof schema.properties === "object" && schema.properties !== null && !Array.isArray(schema.properties) ? schema.properties : {};
		if (schema.additionalProperties === false) {
			for (const key of Object.keys(record)) if (!(key in properties)) throw new Error(`${label} contains unsupported property: ${key}`);
		}
		for (const [key, propertySchema] of Object.entries(properties)) if (key in record) assertInputSchema(propertySchema, record[key], `${label}.${key}`);
	} else if (expected === "string" && typeof value !== "string") throw new Error(`${label} must be a string`);
	else if ((expected === "number" || expected === "integer") && (typeof value !== "number" || !Number.isFinite(value) || expected === "integer" && !Number.isInteger(value))) throw new Error(`${label} must be ${expected}`);
	else if (expected === "boolean" && typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
	else if (expected === "array" && !Array.isArray(value)) throw new Error(`${label} must be an array`);
	if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => canonicalMemoryJson(candidate) === canonicalMemoryJson(value))) throw new Error(`${label} is not an allowed value`);
}
function normalizeEvidence(value, view, route, budget, now) {
	if (value.viewId !== view.id || value.routeId !== route.id || value.sourceInstanceKey !== route.sourceInstanceKey) throw new Error("memory Evidence is not bound to the requested View Route");
	const resultLimit = Math.min(route.maxResults ?? budget.maxEvidenceResults, budget.maxEvidenceResults);
	const characterLimit = Math.min(route.maxCharacters ?? budget.maxEvidenceCharacters, budget.maxEvidenceCharacters);
	const items = [];
	let characters = 0;
	let truncated = value.truncated || value.items.length > resultLimit;
	for (const item of value.items) {
		if (items.length >= resultLimit) break;
		if (typeof item.text !== "string") throw new Error("memory Evidence item text must be a string");
		if (item.score !== void 0 && !Number.isFinite(item.score)) throw new Error("memory Evidence score must be finite");
		const text = item.text;
		if (characters + text.length > characterLimit) {
			truncated = true;
			continue;
		}
		items.push(jsonClone({
			...item,
			id: requiredText(item.id, "memory Evidence item id", 500),
			text
		}, "memory Evidence item"));
		characters += text.length;
	}
	return jsonClone({
		...value,
		id: requiredText(value.id, "memory Evidence id", 500),
		observedAt: typeof value.observedAt === "string" && value.observedAt.trim() !== "" ? value.observedAt : now().toISOString(),
		items,
		truncated,
		...value.unavailable === void 0 ? {} : { unavailable: requiredText(value.unavailable, "memory Evidence unavailable reason", 2e3) }
	}, "memory Evidence");
}
var MemoryCompositionGeneration = class {
	id;
	report;
	strategy;
	extensions;
	sources;
	permissions = /* @__PURE__ */ new Map();
	now;
	routeCalls = /* @__PURE__ */ new WeakMap();
	strategyTurns = /* @__PURE__ */ new WeakMap();
	sourceTimeoutMs;
	disposed = false;
	constructor(snapshotValue, options = {}) {
		const snapshot = captureMemoryContributionSnapshot(snapshotValue);
		if (snapshot.sources.length === 0) throw new Error("memory composition requires at least one Source");
		if (snapshot.strategies.length === 0) throw new Error("memory composition requires a Strategy");
		validateMemoryPluginGraph(snapshot.plugins ?? [], [
			...snapshot.sources.length === 0 ? [] : ["source"],
			...snapshot.sources.map((source) => `source.${source.definition.manifest.role}`),
			...snapshot.strategies.length === 0 ? [] : ["strategy"]
		]);
		this.strategy = selectStrategy(snapshot.strategies, options);
		this.extensions = (snapshot.strategyExtensions ?? []).filter((extension) => extension.definition.manifest.strategyTypeId === this.strategy.definition.manifest.typeId);
		for (const extension of this.extensions) if (!this.strategy.definition.manifest.extensionSlots?.includes(extension.definition.manifest.slot)) throw new Error(`memory Strategy does not support extension slot: ${extension.definition.manifest.slot} (${extension.instanceKey})`);
		this.now = options.now ?? (() => /* @__PURE__ */ new Date());
		this.sourceTimeoutMs = positiveInteger(options.sourceTimeoutMs ?? 1e4, "memory Source timeoutMs", 3e5);
		const configurations = /* @__PURE__ */ new Map();
		const created = /* @__PURE__ */ new Map();
		try {
			for (const installed of snapshot.sources) {
				const configuration = jsonClone(options.sourceConfiguration?.(installed) ?? {}, "Source configuration");
				configurations.set(installed.instanceKey, configuration);
				const capabilities = options.sourceCapabilities?.(installed);
				if (capabilities !== void 0) this.permissions.set(installed.instanceKey, Object.freeze([...capabilities]));
				const runtime = installed.definition.create({
					sourceInstanceKey: installed.instanceKey,
					provenance: installed.provenance,
					configuration
				});
				if (typeof runtime !== "object" || runtime === null || typeof runtime.facts !== "function" || typeof runtime.project !== "function") throw new Error(`memory Source factory returned an invalid runtime: ${installed.instanceKey}`);
				created.set(installed.instanceKey, {
					installed,
					runtime
				});
			}
		} catch (error) {
			for (const source of [...created.values()].reverse()) source.runtime.dispose?.();
			throw error;
		}
		this.sources = created;
		const generationInput = {
			contributionRevision: snapshot.revision,
			sourceTimeoutMs: this.sourceTimeoutMs,
			strategy: {
				instanceKey: this.strategy.instanceKey,
				manifest: this.strategy.definition.manifest,
				provenance: this.strategy.provenance
			},
			...this.extensions.length === 0 ? {} : { strategyExtensions: this.extensions.map((extension) => ({
				instanceKey: extension.instanceKey,
				manifest: extension.definition.manifest,
				provenance: extension.provenance
			})) },
			sources: snapshot.sources.map((source) => ({
				instanceKey: source.instanceKey,
				manifest: source.definition.manifest,
				provenance: source.provenance,
				effectiveDigest: source.effectiveDigest ?? null,
				configuration: configurations.get(source.instanceKey),
				permissions: this.permissions.get(source.instanceKey) ?? null
			}))
		};
		this.id = `generation:${digest(generationInput)}`;
		this.report = deepFreeze({
			state: "ready",
			contributionRevision: snapshot.revision,
			generationId: this.id,
			strategyInstanceKey: this.strategy.instanceKey,
			...this.extensions.length === 0 ? {} : { strategyExtensionInstanceKeys: this.extensions.map((extension) => extension.instanceKey) },
			sourceInstanceKeys: [...this.sources.keys()],
			diagnostics: (snapshot.strategyExtensions ?? []).filter((extension) => !this.extensions.includes(extension)).map((extension) => ({
				code: "strategy-extension-inactive",
				contributionInstanceKey: extension.instanceKey,
				message: `Strategy extension targets ${extension.definition.manifest.strategyTypeId}; selected Strategy is ${this.strategy.definition.manifest.typeId}.`
			}))
		});
	}
	async compose(requestValue, signal) {
		signal?.throwIfAborted();
		const controller = new AbortController();
		setMaxListeners(0, controller.signal);
		const abort = () => controller.abort(signal.reason);
		signal?.addEventListener("abort", abort, { once: true });
		try {
			return await this.composeView(requestValue, controller.signal);
		} finally {
			controller.abort();
			signal?.removeEventListener("abort", abort);
		}
	}
	async sourceFacts(source, request, diagnostics, signal) {
		let value;
		try {
			value = await readSource(source.installed.instanceKey, "facts", this.sourceTimeoutMs, (abort) => source.runtime.facts(request, abort), signal);
		} catch (error) {
			if (!(error instanceof SourceReadFailure)) throw error;
			diagnostics.push(error.diagnostic);
			return {
				sourceInstanceKey: source.installed.instanceKey,
				sourceTypeId: source.installed.definition.manifest.typeId,
				role: source.installed.definition.manifest.role,
				availability: "unavailable",
				revision: "unavailable",
				capabilities: [],
				routeIds: [],
				actionIds: []
			};
		}
		return normalizeFacts(source.installed, value);
	}
	async composeView(requestValue, signal) {
		this.assertOpen();
		const request = jsonClone({
			...requestValue,
			scenario: requiredText(requestValue.scenario, "memory View scenario", 300),
			budget: normalizeBudget(requestValue.budget)
		}, "memory View request");
		const diagnostics = [];
		const entries = await Promise.all([...this.sources.values()].map(async (source) => {
			const value = structuredClone(await this.sourceFacts(source, request, diagnostics, signal));
			const permissions = this.permissions.get(source.installed.instanceKey);
			if (permissions !== void 0) {
				value.capabilities = value.capabilities.filter((capability) => permissions.includes(capability));
				value.routeIds = value.routeIds.filter((id) => source.installed.definition.manifest.routes?.some((route) => route.id === id && permissions.includes(route.capability)));
				value.actionIds = value.actionIds.filter((id) => source.installed.definition.manifest.actions?.some((action) => action.id === id && permissions.includes(action.capability)));
				if (value.capabilities.length === 0) value.availability = "unavailable";
			}
			const manifest = source.installed.definition.manifest;
			const routes = (manifest.routes ?? []).filter((route) => value.availability !== "unavailable" && value.routeIds.includes(route.id) && value.capabilities.includes(route.capability));
			const actions = (manifest.actions ?? []).filter((action) => value.availability !== "unavailable" && value.actionIds.includes(action.id) && value.capabilities.includes(action.capability));
			const descriptor = {
				...value,
				routes,
				actions,
				routeIds: routes.map((route) => route.id),
				actionIds: actions.map((action) => action.id)
			};
			return [source.installed.instanceKey, descriptor];
		}));
		signal.throwIfAborted();
		const facts = new Map(entries);
		const factsList = deepFreeze([...facts.values()].map((value) => jsonClone(value, "memory Source facts")));
		const contributions = this.strategyContributions(request, factsList);
		const replayedContributions = this.strategyContributions(request, factsList);
		if (canonicalMemoryJson(contributions) !== canonicalMemoryJson(replayedContributions)) throw new Error(`memory Strategy extensions are not deterministic: ${this.extensions.map((extension) => extension.instanceKey).join(", ")}`);
		const proposed = this.strategy.definition.compose(request, factsList, contributions);
		const replayed = this.strategy.definition.compose(request, factsList, replayedContributions);
		if (canonicalMemoryJson(proposed, "memory ViewSpec") !== canonicalMemoryJson(replayed, "replayed memory ViewSpec")) throw new Error(`memory Strategy is not deterministic: ${this.strategy.instanceKey}`);
		let spec;
		try {
			spec = normalizeViewSpec(proposed, this.strategy, facts, request.budget);
		} catch (error) {
			if (diagnostics.length === 0) throw error;
			throw new Error(`${error instanceof Error ? error.message : "Memory View rejected"}; ${diagnostics.map((item) => item.message).sort().join("; ")}`);
		}
		const projection = [];
		const grants = [];
		const routes = [];
		const actions = [];
		const sourcePresentations = [];
		let projectionCharacters = 0;
		const projected = await Promise.all(spec.sources.map(async (sourceSpec) => {
			const source = this.sources.get(sourceSpec.sourceInstanceKey);
			const sourceFacts = facts.get(sourceSpec.sourceInstanceKey);
			let value;
			try {
				value = await readSource(source.installed.instanceKey, "project", this.sourceTimeoutMs, (abort) => source.runtime.project({
					scope: request.scope,
					sourceInstanceKey: source.installed.instanceKey,
					expectedRevision: sourceFacts.revision,
					includeProjection: sourceSpec.projection !== void 0,
					mode: sourceSpec.projection?.mode ?? "routed",
					maxCharacters: sourceSpec.projection?.maxCharacters ?? 1
				}, abort), signal);
			} catch (error) {
				if (!(error instanceof SourceReadFailure) || sourceSpec.required !== false) throw error;
				diagnostics.push(error.diagnostic);
				return null;
			}
			return {
				source,
				sourceSpec,
				contribution: normalizeContribution(source, sourceSpec, sourceFacts, value)
			};
		}));
		signal.throwIfAborted();
		const successful = projected.filter((value) => value !== null);
		for (const { source, sourceSpec, contribution } of successful) {
			for (const fragment of contribution.fragments) {
				projectionCharacters += fragment.text.length;
				if (projectionCharacters > request.budget.maxProjectionCharacters) throw new Error("memory View projection exceeds the root-turn budget");
				projection.push(fragment);
			}
			if (contribution.readGrant !== void 0) {
				if (grants.some((grant) => grant.id === contribution.readGrant.id)) throw new Error(`memory ReadGrant id is duplicated: ${contribution.readGrant.id}`);
				grants.push(contribution.readGrant);
				for (const routeId of sourceSpec.routeIds ?? []) routes.push(routeFor(source, routeId, contribution.readGrant, request.budget));
			}
			if (contribution.presentation !== void 0) sourcePresentations.push(deepFreeze({
				sourceInstanceKey: source.installed.instanceKey,
				mode: sourceSpec.projection?.mode ?? "routed",
				...contribution.presentation
			}));
			for (const actionId of sourceSpec.actionIds ?? []) actions.push(actionFor(source, actionId));
		}
		const sourceRevisions = Object.fromEntries([...facts].map(([key, value]) => [key, value.revision]));
		const modes = new Set(successful.map(({ source }) => source.installed.definition.manifest.consistency));
		const consistency = {
			mode: modes.size === 1 ? [...modes][0] : "mixed",
			sourceRevisions
		};
		const body = {
			runtimeGeneration: this.id,
			strategyInstanceKey: this.strategy.instanceKey,
			strategyTypeId: this.strategy.definition.manifest.typeId,
			...contributions.length === 0 ? {} : { strategyExtensions: contributions.map(({ value, ...identity }) => ({
				...identity,
				digest: digest(value)
			})) },
			scope: request.scope,
			projection,
			...sourcePresentations.length === 0 ? {} : { sourcePresentations },
			routes,
			readGrants: grants,
			actionOffers: actions,
			consistency,
			explanation: spec.explanation,
			...spec.guidance === void 0 ? {} : { guidance: spec.guidance },
			...diagnostics.length === 0 ? {} : { diagnostics: diagnostics.sort((a, b) => (a.contributionInstanceKey ?? "").localeCompare(b.contributionInstanceKey ?? "") || a.code.localeCompare(b.code)) }
		};
		const viewDigest = digest(body);
		return deepFreeze({
			id: `view:${viewDigest}`,
			digest: viewDigest,
			createdAt: this.now().toISOString(),
			...body
		});
	}
	strategyContributions(request, sources) {
		return deepFreeze(this.extensions.map((extension) => {
			const label = `memory Strategy extension ${extension.instanceKey}`;
			const value = jsonClone(extension.definition.contribute(request, sources), label);
			if (canonicalMemoryJson(value, label).length > 64e3) throw new Error(`${label} exceeds 64000 characters`);
			return {
				instanceKey: extension.instanceKey,
				typeId: extension.definition.manifest.typeId,
				slot: extension.definition.manifest.slot,
				value
			};
		}));
	}
	/**
	* Project the current scope's visible Source instances for the human
	* management plane. The returned catalog contains only JSON-safe manifest
	* metadata and SourceFacts; runtime objects and grants remain Host-only.
	*/
	sourceInstances() {
		this.assertOpen();
		return [...this.sources.values()].map((source) => ({
			sourceInstanceKey: source.installed.instanceKey,
			sourceTypeId: source.installed.definition.manifest.typeId
		}));
	}
	/** A caller without a cached human revision may fence just its selected Source. */
	async managementRevision(sourceInstanceKey, scope, signal) {
		this.assertOpen();
		const source = this.sources.get(instanceKey(sourceInstanceKey, "source"));
		if (source?.runtime.manage === void 0) throw new Error("Source does not expose management: " + sourceInstanceKey);
		const facts = await this.sourceFacts(source, jsonClone({
			scope,
			scenario: "management.revision",
			budget: DEFAULT_MEMORY_VIEW_BUDGET
		}, "management revision request"), [], signal);
		if (facts.availability === "unavailable") throw new Error("Source is unavailable in the requested management scope: " + sourceInstanceKey);
		return facts.revision;
	}
	async managementCatalog(scope) {
		this.assertOpen();
		const request = jsonClone({
			scope,
			scenario: "management.catalog",
			budget: DEFAULT_MEMORY_VIEW_BUDGET
		}, "memory management catalog request");
		const diagnostics = [];
		const sources = await Promise.all([...this.sources.values()].map(async (source) => {
			const descriptor = source.installed.definition.manifest.management;
			if (descriptor === void 0) return null;
			const facts = await this.sourceFacts(source, request, diagnostics);
			return {
				sourceInstanceKey: source.installed.instanceKey,
				sourceTypeId: source.installed.definition.manifest.typeId,
				packageName: source.installed.definition.manifest.packageName,
				role: source.installed.definition.manifest.role,
				availability: facts.availability,
				revision: facts.revision,
				capabilities: facts.capabilities,
				management: descriptor,
				...facts.hints === void 0 ? {} : { hints: facts.hints }
			};
		}));
		return jsonClone({
			generationId: this.id,
			sources: sources.filter((source) => source !== null),
			...diagnostics.length === 0 ? {} : { diagnostics: diagnostics.sort((a, b) => (a.contributionInstanceKey ?? "").localeCompare(b.contributionInstanceKey ?? "")) }
		}, "memory Source management catalog");
	}
	/** Execute one short-lived, explicitly scoped management operation. */
	async executeManagement(requestValue) {
		this.assertOpen();
		const sourceInstanceKey = instanceKey(requestValue.sourceInstanceKey, "source");
		const operation = id(requestValue.operation, "memory Source management operation");
		if (requestValue.mode !== "read" && requestValue.mode !== "mutate") throw new Error(`unsupported memory Source management mode: ${String(requestValue.mode)}`);
		if (requestValue.mode === "mutate") {
			if (requestValue.confirmed !== true) throw new Error("memory Source management mutation requires explicit confirmation");
			requiredText(requestValue.expectedRevision, "memory Source management expectedRevision", 500);
		}
		const source = this.sources.get(sourceInstanceKey);
		if (source?.runtime.manage === void 0 || source.installed.definition.manifest.management === void 0) throw new Error(`memory Source does not expose management operations: ${sourceInstanceKey}`);
		const diagnostics = [];
		const facts = await this.sourceFacts(source, jsonClone({
			scope: requestValue.scope,
			scenario: `management.${requestValue.mode}`,
			budget: DEFAULT_MEMORY_VIEW_BUDGET
		}, "memory Source management facts request"), diagnostics, requestValue.signal);
		if (facts.availability === "unavailable") throw new Error(`memory Source is unavailable in the requested management scope: ${sourceInstanceKey}${diagnostics.length === 0 ? "" : "; " + diagnostics[0].message}`);
		if (requestValue.mode === "mutate" && requestValue.expectedRevision !== facts.revision) throw new Error(`memory Source management revision conflict: expected ${requestValue.expectedRevision}, current ${facts.revision}`);
		const request = {
			scope: jsonClone(requestValue.scope, "memory Source management scope"),
			sourceInstanceKey,
			mode: requestValue.mode,
			operation,
			input: jsonClone(requestValue.input, "memory Source management input"),
			...requestValue.expectedRevision === void 0 ? {} : { expectedRevision: requiredText(requestValue.expectedRevision, "memory Source management expectedRevision", 500) },
			confirmed: requestValue.confirmed === true,
			...requestValue.signal === void 0 ? {} : { signal: requestValue.signal }
		};
		const result = await source.runtime.manage(request);
		return jsonClone({
			revision: requiredText(result.revision, "memory Source management result revision", 500),
			value: result.value
		}, "memory Source management result");
	}
	async executeRoute(view, routeId, input, signal, budget = DEFAULT_MEMORY_VIEW_BUDGET, execution = view) {
		this.assertOpen();
		if (view.runtimeGeneration !== this.id) throw new Error("memory View belongs to a different runtime generation");
		const route = view.routes.find((candidate) => candidate.id === routeId);
		if (route === void 0) throw new Error(`memory View Route is unavailable: ${routeId}`);
		const grant = view.readGrants.find((candidate) => candidate.id === route.readGrantId && candidate.sourceInstanceKey === route.sourceInstanceKey);
		if (grant === void 0) throw new Error(`memory View Route has no valid ReadGrant: ${routeId}`);
		assertInputSchema(route.inputSchema, input, "memory Route input");
		const executionBudget = normalizeBudget(budget);
		const maxCharacters = Math.min(route.maxCharacters ?? executionBudget.maxEvidenceCharacters, executionBudget.maxEvidenceCharacters);
		const maxResults = Math.min(route.maxResults ?? executionBudget.maxEvidenceResults, executionBudget.maxEvidenceResults);
		const boundedRoute = deepFreeze({
			...route,
			maxCharacters,
			maxResults
		});
		signal?.throwIfAborted();
		const source = this.sources.get(route.sourceInstanceKey);
		if (source?.runtime.query === void 0) throw new Error(`memory Source cannot execute Route: ${route.sourceInstanceKey}`);
		let active = true;
		const read = async (selectedInput, limits = {}) => {
			if (!active) throw new Error("memory Strategy read continuation is no longer active");
			this.assertOpen();
			signal?.throwIfAborted();
			assertInputSchema(route.inputSchema, selectedInput, "memory Route input");
			const selectedRoute = deepFreeze({
				...boundedRoute,
				maxResults: Math.min(maxResults, limits.maxResults === void 0 ? maxResults : positiveInteger(limits.maxResults, "Strategy maxResults", 1e4)),
				maxCharacters: Math.min(maxCharacters, limits.maxCharacters === void 0 ? maxCharacters : positiveInteger(limits.maxCharacters, "Strategy maxCharacters", 1e7))
			});
			let ledger = this.routeCalls.get(execution);
			if (ledger === void 0) {
				ledger = /* @__PURE__ */ new Map();
				this.routeCalls.set(execution, ledger);
			}
			const counter = `${view.id}\u0000${route.id}`;
			const calls = ledger.get(counter) ?? 0;
			if (calls >= route.maxCalls) throw new Error(`memory View Route call budget is exhausted: ${route.id}`);
			ledger.set(counter, calls + 1);
			return normalizeEvidence(await source.runtime.query({
				view: deepFreeze({
					id: view.id,
					scope: view.scope
				}),
				route: selectedRoute,
				grant,
				input: jsonClone(selectedInput, "memory Route input"),
				...signal === void 0 ? {} : { signal }
			}), view, selectedRoute, executionBudget, this.now);
		};
		try {
			let policy = this.strategyTurns.get(execution);
			if (policy === void 0 && this.strategy.definition.createTurn !== void 0) {
				policy = this.strategy.definition.createTurn(view);
				if (typeof policy?.query !== "function") throw new Error("memory Strategy returned an invalid turn policy");
				this.strategyTurns.set(execution, policy);
			}
			const value = policy === void 0 ? await read(input) : await policy.query({
				route: boundedRoute,
				input: jsonClone(input, "memory Strategy input"),
				...signal === void 0 ? {} : { signal }
			}, read);
			signal?.throwIfAborted();
			return normalizeEvidence(value, view, boundedRoute, executionBudget, this.now);
		} finally {
			active = false;
		}
	}
	async executeAction(view, offerId, input, authorize, signal) {
		this.assertOpen();
		if (view.runtimeGeneration !== this.id) throw new Error("memory View belongs to a different runtime generation");
		const offer = view.actionOffers.find((candidate) => candidate.id === offerId);
		if (offer === void 0) throw new Error(`memory ActionOffer is unavailable: ${offerId}`);
		assertInputSchema(offer.inputSchema, input, "memory Action input");
		if (!await authorize(offer)) throw new Error(`memory ActionOffer is not currently authorized: ${offer.id}`);
		const source = this.sources.get(offer.sourceInstanceKey);
		if (source?.runtime.mutate === void 0) throw new Error(`memory Source cannot execute ActionOffer: ${offer.sourceInstanceKey}`);
		signal?.throwIfAborted();
		const grant = view.readGrants.find((candidate) => candidate.sourceInstanceKey === offer.sourceInstanceKey);
		const receipt = await source.runtime.mutate({
			view: deepFreeze({
				id: view.id,
				scope: view.scope
			}),
			offer,
			...grant === void 0 ? {} : { grant },
			input: jsonClone(input, "memory Action input"),
			...signal === void 0 ? {} : { signal }
		});
		if (receipt.viewId !== view.id || receipt.offerId !== offer.id || receipt.sourceInstanceKey !== offer.sourceInstanceKey) throw new Error("memory mutation Receipt is not bound to the requested ActionOffer");
		if (![
			"succeeded",
			"partial",
			"failed",
			"cancelled"
		].includes(receipt.status)) throw new Error("memory mutation Receipt has an invalid status");
		if (![
			"accepted",
			"candidate",
			"committed",
			"partial",
			"failed",
			"unknown"
		].includes(receipt.completion)) throw new Error("memory mutation Receipt has an invalid completion");
		if (receipt.completion === "committed") {
			if (receipt.status !== "succeeded" || typeof receipt.committedAt !== "string" || !Number.isFinite(Date.parse(receipt.committedAt))) throw new Error("committed memory Receipt requires successful status and an explicit commit timestamp");
		} else if (receipt.committedAt !== void 0) throw new Error("uncommitted memory Receipt cannot claim a commit timestamp");
		if (receipt.completion === "failed" && receipt.status === "succeeded") throw new Error("failed memory completion cannot have successful status");
		return jsonClone({
			...receipt,
			id: requiredText(receipt.id, "memory mutation Receipt id", 500)
		}, "memory mutation Receipt");
	}
	async dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.routeCalls = /* @__PURE__ */ new WeakMap();
		this.strategyTurns = /* @__PURE__ */ new WeakMap();
		const failures = [];
		for (const source of [...this.sources.values()].reverse()) try {
			await source.runtime.dispose?.();
		} catch (error) {
			failures.push(error);
		}
		if (failures.length > 0) throw new AggregateError(failures, `memory generation disposal failed: ${this.id}`);
	}
	sourceRuntime(sourceInstanceKey) {
		return this.sources.get(sourceInstanceKey)?.runtime;
	}
	assertOpen() {
		if (this.disposed) throw new Error(`memory runtime generation is disposed: ${this.id}`);
	}
};
//#endregion
//#region src/core/generation.ts
function report(state, snapshot, diagnostics) {
	return Object.freeze({
		state,
		contributionRevision: snapshot.revision,
		sourceInstanceKeys: snapshot.sources.map((source) => source.instanceKey),
		diagnostics: Object.freeze(diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })))
	});
}
/**
* Owns candidate → serving → draining generation transitions.
* Cordis owns definition registrations; this host owns factory-created runtime
* objects and keeps a retired generation alive only while turn leases exist.
*/
var MemoryGenerationHost = class {
	options;
	records = /* @__PURE__ */ new Map();
	serving;
	evaluation = Object.freeze({
		state: "incomplete",
		contributionRevision: 0,
		sourceInstanceKeys: [],
		diagnostics: [{
			code: "not-composed",
			message: "Memory contributions have not been composed."
		}]
	});
	closed = false;
	closing;
	onDrained;
	pendingDisposals = /* @__PURE__ */ new Set();
	disposalFailures = [];
	constructor(options = {}) {
		this.options = options;
	}
	reconcile(snapshot) {
		this.assertOpen();
		if (snapshot.sources.length === 0 || snapshot.strategies.length === 0) {
			const diagnostics = [];
			if (snapshot.sources.length === 0) diagnostics.push({
				code: "missing-source",
				message: "No Memory Source contribution is installed."
			});
			if (snapshot.strategies.length === 0) diagnostics.push({
				code: "missing-strategy",
				message: "No Memory Strategy contribution is installed."
			});
			this.evaluation = report("incomplete", snapshot, diagnostics);
			if (this.removesServingContribution(snapshot) || this.removesServingExtension(snapshot)) this.retireServing();
			return this.evaluation;
		}
		let candidate;
		try {
			candidate = new MemoryCompositionGeneration(snapshot, this.options);
		} catch (error) {
			this.evaluation = report("rejected", snapshot, [{
				code: "composition-rejected",
				message: error instanceof Error ? error.message : String(error)
			}]);
			if (this.removesServingContribution(snapshot) || this.removesServingExtension(snapshot)) this.retireServing();
			return this.evaluation;
		}
		const previous = this.serving;
		const existing = this.records.get(candidate.id);
		if (existing !== void 0) {
			this.disposeGeneration(candidate);
			existing.state = "serving";
			this.serving = existing;
			this.evaluation = existing.generation.report;
			if (previous !== void 0 && previous !== existing) this.retire(previous);
			return this.evaluation;
		}
		const record = {
			generation: candidate,
			leases: 0,
			state: "serving"
		};
		this.records.set(candidate.id, record);
		this.serving = record;
		this.evaluation = candidate.report;
		if (previous !== void 0) this.retire(previous);
		return this.evaluation;
	}
	acquire(generationId) {
		this.assertOpen();
		const record = generationId === void 0 ? this.serving : this.records.get(generationId);
		if (record === void 0 || generationId === void 0 && record.state !== "serving") {
			const reason = this.evaluation.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
			throw new Error(`no Serving memory generation is available${reason === "" ? "" : `: ${reason}`}`);
		}
		record.leases += 1;
		let active = true;
		return Object.freeze({
			id: record.generation.id,
			generation: record.generation,
			release: () => {
				if (!active) return;
				active = false;
				record.leases -= 1;
				this.collect(record);
			}
		});
	}
	current() {
		return this.serving?.state === "serving" ? this.serving.generation : void 0;
	}
	generation(id) {
		return this.records.get(id)?.generation;
	}
	inspect() {
		return Object.freeze({
			...this.serving?.state === "serving" ? { servingGenerationId: this.serving.generation.id } : {},
			drainingGenerationIds: Object.freeze([...this.records.values()].filter((record) => record.state === "draining").map((record) => record.generation.id)),
			evaluation: this.evaluation
		});
	}
	dispose() {
		if (this.closing !== void 0) return this.closing;
		this.closed = true;
		this.serving = void 0;
		const drained = new Promise((resolve) => {
			this.onDrained = resolve;
		});
		for (const record of [...this.records.values()]) this.retire(record);
		if (this.records.size === 0) this.onDrained?.();
		this.closing = (async () => {
			await drained;
			await Promise.all([...this.pendingDisposals]);
			if (this.disposalFailures.length > 0) throw new AggregateError(this.disposalFailures, "memory generation host disposal failed");
		})();
		return this.closing;
	}
	disposeGeneration(generation) {
		const task = generation.dispose().catch((error) => {
			this.disposalFailures.push(error);
		});
		this.pendingDisposals.add(task);
		task.finally(() => this.pendingDisposals.delete(task));
	}
	removesServingContribution(snapshot) {
		if (this.serving === void 0) return false;
		const available = /* @__PURE__ */ new Set([...snapshot.sources.map((source) => source.instanceKey), ...snapshot.strategies.map((strategy) => strategy.instanceKey)]);
		return [...this.serving.generation.report.sourceInstanceKeys, ...this.serving.generation.report.strategyInstanceKey === void 0 ? [] : [this.serving.generation.report.strategyInstanceKey]].some((key) => !available.has(key));
	}
	/** A failed replacement must not keep applying an explicitly disabled policy. */
	removesServingExtension(snapshot) {
		const available = new Set((snapshot.strategyExtensions ?? []).map((extension) => extension.instanceKey));
		return this.serving?.generation.report.strategyExtensionInstanceKeys?.some((key) => !available.has(key)) ?? false;
	}
	retireServing() {
		if (this.serving === void 0) return;
		const previous = this.serving;
		this.serving = void 0;
		this.retire(previous);
	}
	retire(record) {
		record.state = "draining";
		this.collect(record);
	}
	collect(record) {
		if (record.state !== "draining" || record.leases !== 0) return;
		if (this.records.get(record.generation.id) !== record) return;
		this.records.delete(record.generation.id);
		this.disposeGeneration(record.generation);
		if (this.closed && this.records.size === 0) this.onDrained?.();
	}
	assertOpen() {
		if (this.closed) throw new Error("memory generation host is disposed");
	}
};
//#endregion
//#region src/core/registry.ts
/**
* Scope-local definition registry behind ctx.mnemonMemory.
*
* It owns definitions only. Runtime objects are created and drained by a
* generation host attached by dsh-mnemon core.
*/
var MemoryContributionRegistry = class {
	sources = /* @__PURE__ */ new Map();
	strategies = /* @__PURE__ */ new Map();
	extensions = /* @__PURE__ */ new Map();
	plugins = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	revision = 0;
	install(value) {
		const incomingSources = [...value.sources ?? []];
		const incomingStrategies = [...value.strategies ?? []];
		const incomingExtensions = [...value.strategyExtensions ?? []];
		const incomingPlugins = [...value.plugins ?? []];
		if (incomingSources.length + incomingStrategies.length + incomingExtensions.length === 0) throw new Error("installMemory requires one Source, Strategy or Strategy extension contribution");
		for (const source of incomingSources) if (this.sources.has(source.instanceKey)) throw new Error(`memory Source instance is already installed: ${source.instanceKey}`);
		for (const strategy of incomingStrategies) if (this.strategies.has(strategy.instanceKey)) throw new Error(`memory Strategy instance is already installed: ${strategy.instanceKey}`);
		for (const extension of incomingExtensions) if (this.extensions.has(extension.instanceKey)) throw new Error(`memory Strategy extension instance is already installed: ${extension.instanceKey}`);
		for (const plugin of incomingPlugins) if (this.plugins.has(plugin.instanceKey)) throw new Error(`memory plugin instance is already installed: ${plugin.instanceKey}`);
		const candidate = captureMemoryContributionSnapshot({
			revision: this.revision + 1,
			sources: [...this.sources.values(), ...incomingSources],
			strategies: [...this.strategies.values(), ...incomingStrategies],
			strategyExtensions: [...this.extensions.values(), ...incomingExtensions],
			plugins: [...this.plugins.values(), ...incomingPlugins]
		});
		const capturedSources = candidate.sources.filter((source) => incomingSources.some((incoming) => incoming.instanceKey === source.instanceKey));
		const capturedStrategies = candidate.strategies.filter((strategy) => incomingStrategies.some((incoming) => incoming.instanceKey === strategy.instanceKey));
		const capturedExtensions = (candidate.strategyExtensions ?? []).filter((extension) => incomingExtensions.some((incoming) => incoming.instanceKey === extension.instanceKey));
		const capturedPlugins = (candidate.plugins ?? []).filter((plugin) => incomingPlugins.some((incoming) => incoming.instanceKey === plugin.instanceKey));
		for (const source of capturedSources) this.sources.set(source.instanceKey, source);
		for (const strategy of capturedStrategies) this.strategies.set(strategy.instanceKey, strategy);
		for (const extension of capturedExtensions) this.extensions.set(extension.instanceKey, extension);
		for (const plugin of capturedPlugins) this.plugins.set(plugin.instanceKey, plugin);
		this.revision = candidate.revision;
		this.notify(candidate);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			let changed = false;
			for (const source of capturedSources) {
				if (this.sources.get(source.instanceKey) !== source) continue;
				this.sources.delete(source.instanceKey);
				changed = true;
			}
			for (const strategy of capturedStrategies) {
				if (this.strategies.get(strategy.instanceKey) !== strategy) continue;
				this.strategies.delete(strategy.instanceKey);
				changed = true;
			}
			for (const extension of capturedExtensions) {
				if (this.extensions.get(extension.instanceKey) !== extension) continue;
				this.extensions.delete(extension.instanceKey);
				changed = true;
			}
			for (const plugin of capturedPlugins) {
				if (this.plugins.get(plugin.instanceKey) !== plugin) continue;
				this.plugins.delete(plugin.instanceKey);
				changed = true;
			}
			if (!changed) return;
			this.revision += 1;
			this.notify(this.snapshot());
		};
	}
	snapshot() {
		return captureMemoryContributionSnapshot({
			revision: this.revision,
			sources: [...this.sources.values()],
			strategies: [...this.strategies.values()],
			strategyExtensions: [...this.extensions.values()],
			plugins: [...this.plugins.values()]
		});
	}
	subscribe(listener) {
		this.listeners.add(listener);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			this.listeners.delete(listener);
		};
	}
	notify(snapshot) {
		for (const listener of [...this.listeners]) listener(snapshot);
	}
};
//#endregion
//#region src/core/runtime.ts
/** Only the owning Core/Host receives the engine; plugins receive its service. */
function provideMemoryRuntime(context) {
	const runtime = new MemoryRuntime();
	context.provide("mnemonMemory", runtime.service);
	context.effect(() => () => runtime.dispose(), "dsh-mnemon.core()");
	return runtime;
}
/** The single Cordis-owned registry of Source and Strategy definitions. */
var MemoryRuntime = class {
	service = Object.freeze({ installContributions: (contribution, options) => {
		if (this.closed) throw new Error("Memory Runtime is disposed");
		return this.installContributions(prepareMemoryContributions(contribution, options));
	} });
	contributions = new MemoryContributionRegistry();
	generationAttachments = /* @__PURE__ */ new Set();
	closed = false;
	disposal;
	disposalFailures = [];
	batchDepth = 0;
	batchSnapshot;
	reconciliations = /* @__PURE__ */ new Map();
	/** Host assembly transaction: existing leases stay served until all Fibers settle. */
	async batch(operation) {
		if (this.closed) throw new Error("Memory Runtime is disposed");
		if (this.batchDepth++ === 0) this.batchSnapshot = this.contributions.snapshot();
		try {
			return await operation();
		} finally {
			if (--this.batchDepth === 0) {
				this.batchSnapshot = void 0;
				const pending = [...this.reconciliations];
				this.reconciliations.clear();
				for (const [host, snapshot] of pending) host.reconcile(snapshot);
			}
		}
	}
	installContributions(value) {
		if (this.closed) throw new Error("Memory Runtime is disposed");
		return this.contributions.install(value);
	}
	contributionSnapshot() {
		return this.contributions.snapshot();
	}
	onContributionsChanged(listener) {
		return this.contributions.subscribe(listener);
	}
	/** Attach one Host runtime graph to the current definition set. */
	attachGeneration(options = {}) {
		if (this.closed) throw new Error("Memory Runtime is disposed");
		const host = new MemoryGenerationHost(options);
		host.reconcile(this.batchSnapshot ?? this.contributions.snapshot());
		if (this.batchSnapshot !== void 0) this.reconciliations.set(host, this.contributions.snapshot());
		const unsubscribe = this.contributions.subscribe((snapshot) => {
			if (this.batchDepth) this.reconciliations.set(host, snapshot);
			else host.reconcile(snapshot);
		});
		let attached = true;
		const release = () => {
			if (!attached) return;
			attached = false;
			unsubscribe();
			this.reconciliations.delete(host);
		};
		let disposal;
		const attachment = {
			host,
			release,
			dispose: () => {
				if (disposal !== void 0) return disposal;
				release();
				disposal = host.dispose().finally(() => {
					this.generationAttachments.delete(attachment);
				});
				disposal.catch((error) => {
					this.disposalFailures.push(error);
				});
				return disposal;
			}
		};
		this.generationAttachments.add(attachment);
		return attachment;
	}
	/** Core-Fiber shutdown also closes attachments left by a host adapter. */
	dispose() {
		if (this.disposal !== void 0) return this.disposal;
		this.closed = true;
		this.disposal = Promise.allSettled([...this.generationAttachments].map((attachment) => attachment.dispose())).then(() => {
			if (this.disposalFailures.length > 0) throw new AggregateError(this.disposalFailures, "Memory Runtime cleanup failed");
		});
		return this.disposal;
	}
};
//#endregion
export { prepareMemoryContributions as a, validateMemoryPluginGraph as i, MemoryCompositionGeneration as n, captureMemoryContributionSnapshot as r, provideMemoryRuntime as t };
