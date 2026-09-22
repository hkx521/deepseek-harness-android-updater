import { MEMORY_CAPABILITIES, MEMORY_PLUGIN_API_VERSION } from "./contracts.js";
//#region src/core/definitions.ts
const ID = /^[a-z][a-z0-9-]{0,127}$/u;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const CAPABILITIES = new Set(MEMORY_CAPABILITIES);
const PLUGIN_CAPABILITY = /^[a-z][a-z0-9.-]{0,127}$/u;
function requiredText(value, label, maximum = 500) {
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	const normalized = value.trim();
	if (normalized === "") throw new Error(`${label} is required`);
	if (normalized.length > maximum) throw new Error(`${label} is too long (max ${maximum} characters)`);
	return normalized;
}
function id(value, label) {
	const normalized = requiredText(value, label, 128);
	if (!ID.test(normalized)) throw new Error(`${label} must match [a-z][a-z0-9-]{0,127}`);
	return normalized;
}
function positiveInteger(value, label, maximum = 1e6) {
	if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${label} must be an integer within 1..${maximum}`);
	return value;
}
/** Canonical JSON representation shared by validation, digest, and replay. */
function canonicalMemoryJson(value, label = "memory value", ancestors = /* @__PURE__ */ new Set(), depth = 0) {
	if (depth > 48) throw new Error(`${label} is nested too deeply`);
	if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number`);
		return JSON.stringify(value);
	}
	if (typeof value !== "object") throw new Error(`${label} contains a non-JSON value`);
	if (ancestors.has(value)) throw new Error(`${label} contains a cycle`);
	ancestors.add(value);
	try {
		if (Array.isArray(value)) return `[${value.map((item) => canonicalMemoryJson(item, label, ancestors, depth + 1)).join(",")}]`;
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} contains a non-JSON object`);
		return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalMemoryJson(item, label, ancestors, depth + 1)}`).join(",")}}`;
	} finally {
		ancestors.delete(value);
	}
}
function deepFreeze(value) {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
/** Validate the JSON boundary without allocating a discarded canonical string. */
function assertMemoryJson(value, label, ancestors = /* @__PURE__ */ new Set(), depth = 0) {
	if (depth > 48) throw new Error(`${label} is nested too deeply`);
	if (value === null || typeof value === "boolean" || typeof value === "string") return;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number`);
		return;
	}
	if (typeof value !== "object") throw new Error(`${label} contains a non-JSON value`);
	if (ancestors.has(value)) throw new Error(`${label} contains a cycle`);
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			const length = value.length;
			for (let index = 0; index < length; index++) if (index in value) assertMemoryJson(value[index], label, ancestors, depth + 1);
			return;
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} contains a non-JSON object`);
		const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
		for (const [, item] of entries) assertMemoryJson(item, label, ancestors, depth + 1);
	} finally {
		ancestors.delete(value);
	}
}
function jsonClone(value, label) {
	assertMemoryJson(value, label);
	return deepFreeze(structuredClone(value));
}
function uniqueIds(values, label) {
	const output = [];
	const seen = /* @__PURE__ */ new Set();
	for (const value of values) {
		const normalized = id(value, label);
		if (seen.has(normalized)) throw new Error(`${label} is duplicated: ${normalized}`);
		seen.add(normalized);
		output.push(normalized);
	}
	return output;
}
function validateProvenance(value, expectedPackage) {
	const packageName = requiredText(value.packageName, "memory package name", 214);
	if (!PACKAGE.test(packageName)) throw new Error(`invalid memory package name: ${packageName}`);
	if (packageName !== expectedPackage) throw new Error(`memory package provenance does not match manifest: ${packageName} != ${expectedPackage}`);
	const entryId = requiredText(value.entryId, "memory Entry id", 300);
	const artifactDigest = value.artifactDigest === void 0 ? void 0 : requiredText(value.artifactDigest, "memory artifact digest", 500);
	return deepFreeze({
		packageName,
		entryId,
		...artifactDigest === void 0 ? {} : { artifactDigest }
	});
}
function validateCapabilities(values, label) {
	const normalized = uniqueIds(values, label);
	for (const capability of normalized) if (!CAPABILITIES.has(capability)) throw new Error(`${label} contains unsupported capability: ${capability}`);
	return normalized;
}
function localizedText(value, label) {
	return deepFreeze({
		en: requiredText(value.en, `${label} (English)`, 4e3),
		"zh-CN": requiredText(value["zh-CN"], `${label} (Simplified Chinese)`, 4e3)
	});
}
function pluginCapabilities(values, label) {
	const output = [];
	const seen = /* @__PURE__ */ new Set();
	for (const value of values) {
		const normalized = requiredText(value, label, 128);
		if (!PLUGIN_CAPABILITY.test(normalized)) throw new Error(`${label} must match [a-z][a-z0-9.-]{0,127}`);
		if (seen.has(normalized)) throw new Error(`${label} is duplicated: ${normalized}`);
		seen.add(normalized);
		output.push(normalized);
	}
	return output;
}
/** Validate a plugin node independently of whether its Fiber is active. */
function defineMemoryPlugin(value) {
	if ("apiVersion" in value && value.apiVersion !== "dsh-mnemon/plugin/v1") throw new Error(`unsupported memory plugin API: ${String(value.apiVersion)}`);
	const packageName = requiredText(value.packageName, "memory plugin packageName", 214);
	if (!PACKAGE.test(packageName)) throw new Error(`invalid memory plugin packageName: ${packageName}`);
	const roles = uniqueIds(value.roles, "memory plugin role");
	if (roles.length === 0 || roles.some((role) => ![
		"source",
		"strategy",
		"strategy-extension"
	].includes(role))) throw new Error("memory plugin must declare at least one supported contribution role");
	const providedIds = pluginCapabilities(value.provides.map((capability) => capability.id), "memory plugin provided capability");
	const provides = value.provides.map((capability, index) => deepFreeze({
		id: providedIds[index],
		...capability.exclusive === true ? { exclusive: true } : {}
	}));
	if (provides.length === 0) throw new Error("memory plugin must provide at least one capability");
	const requires = pluginCapabilities(value.requires ?? [], "memory plugin required capability");
	const selfProvided = new Set(providedIds);
	for (const requirement of requires) if (selfProvided.has(requirement)) throw new Error(`memory plugin cannot require its own capability: ${requirement}`);
	return deepFreeze({
		apiVersion: MEMORY_PLUGIN_API_VERSION,
		packageName,
		label: localizedText(value.label, "memory plugin label"),
		description: localizedText(value.description, "memory plugin description"),
		roles,
		provides,
		...requires.length === 0 ? {} : { requires }
	});
}
function validateRoute(route) {
	const normalized = {
		id: id(route.id, "memory Source route id"),
		description: requiredText(route.description, "memory Source route description", 2e3),
		capability: id(route.capability, "memory Source route capability"),
		inputSchema: jsonClone(route.inputSchema, "memory Source route input schema"),
		maxCalls: positiveInteger(route.maxCalls, "memory Source route maxCalls", 100),
		...route.maxResults === void 0 ? {} : { maxResults: positiveInteger(route.maxResults, "memory Source route maxResults", 1e4) },
		...route.maxCharacters === void 0 ? {} : { maxCharacters: positiveInteger(route.maxCharacters, "memory Source route maxCharacters", 1e7) }
	};
	if (!CAPABILITIES.has(normalized.capability)) throw new Error(`unsupported memory Source route capability: ${normalized.capability}`);
	return deepFreeze(normalized);
}
function validateAction(action) {
	const normalized = {
		id: id(action.id, "memory Source action id"),
		description: requiredText(action.description, "memory Source action description", 2e3),
		capability: id(action.capability, "memory Source action capability"),
		inputSchema: jsonClone(action.inputSchema, "memory Source action input schema"),
		...action.authority === void 0 ? {} : { authority: requiredText(action.authority, "memory Source action authority", 300) }
	};
	if (!CAPABILITIES.has(normalized.capability)) throw new Error(`unsupported memory Source action capability: ${normalized.capability}`);
	return deepFreeze(normalized);
}
function defineMemorySource(definition) {
	const manifest = definition.manifest;
	if (manifest.apiVersion !== "dsh-mnemon/v1") throw new Error(`unsupported memory Source API: ${String(manifest.apiVersion)}`);
	if (manifest.kind !== "source") throw new Error("memory Source manifest kind must be source");
	const typeId = id(manifest.typeId, "memory Source typeId");
	const packageName = requiredText(manifest.packageName, "memory Source packageName", 214);
	if (!PACKAGE.test(packageName)) throw new Error(`invalid memory Source packageName: ${packageName}`);
	const role = id(manifest.role, "memory Source role");
	if (manifest.consistency !== "exact-snapshot" && manifest.consistency !== "namespace-pinned-live-read") throw new Error(`unsupported memory Source consistency: ${String(manifest.consistency)}`);
	if (typeof definition.create !== "function") throw new Error(`memory Source create() is required: ${typeId}`);
	const routes = (manifest.routes ?? []).map(validateRoute);
	uniqueIds(routes.map((route) => route.id), "memory Source route id");
	const actions = (manifest.actions ?? []).map(validateAction);
	uniqueIds(actions.map((action) => action.id), "memory Source action id");
	const normalizedManifest = jsonClone({
		...manifest,
		typeId,
		packageName,
		role,
		capabilities: validateCapabilities(manifest.capabilities, "memory Source capability"),
		routes,
		actions
	}, "memory Source manifest");
	return Object.freeze({
		manifest: normalizedManifest,
		create: definition.create
	});
}
function defineMemoryStrategy(definition) {
	const manifest = definition.manifest;
	if (manifest.apiVersion !== "dsh-mnemon/v1") throw new Error(`unsupported memory Strategy API: ${String(manifest.apiVersion)}`);
	if (manifest.kind !== "strategy") throw new Error("memory Strategy manifest kind must be strategy");
	const typeId = id(manifest.typeId, "memory Strategy typeId");
	const packageName = requiredText(manifest.packageName, "memory Strategy packageName", 214);
	if (!PACKAGE.test(packageName)) throw new Error(`invalid memory Strategy packageName: ${packageName}`);
	if (manifest.deterministic !== true) throw new Error("memory Strategy must declare deterministic: true");
	if (typeof definition.compose !== "function") throw new Error(`memory Strategy compose() is required: ${typeId}`);
	if (definition.createTurn !== void 0 && typeof definition.createTurn !== "function") throw new Error("memory Strategy createTurn must be a function");
	const normalizedManifest = jsonClone({
		...manifest,
		typeId,
		packageName,
		supportedSourceRoles: uniqueIds(manifest.supportedSourceRoles, "memory Strategy supported Source role"),
		maxSources: positiveInteger(manifest.maxSources, "memory Strategy maxSources", 1e3),
		maxRoutes: positiveInteger(manifest.maxRoutes, "memory Strategy maxRoutes", 1e3),
		maxActions: positiveInteger(manifest.maxActions, "memory Strategy maxActions", 1e3),
		...manifest.extensionSlots === void 0 ? {} : { extensionSlots: uniqueIds(manifest.extensionSlots, "memory Strategy extension slot") }
	}, "memory Strategy manifest");
	return Object.freeze({
		manifest: normalizedManifest,
		compose: definition.compose,
		...definition.createTurn === void 0 ? {} : { createTurn: definition.createTurn }
	});
}
function defineMemoryStrategyExtension(definition) {
	const manifest = definition.manifest;
	if (manifest.apiVersion !== "dsh-mnemon/v1") throw new Error(`unsupported memory Strategy extension API: ${String(manifest.apiVersion)}`);
	if (manifest.kind !== "strategy-extension") throw new Error("memory Strategy extension kind must be strategy-extension");
	const packageName = requiredText(manifest.packageName, "memory Strategy extension packageName", 214);
	if (!PACKAGE.test(packageName)) throw new Error(`invalid memory Strategy extension packageName: ${packageName}`);
	if (manifest.deterministic !== true) throw new Error("memory Strategy extension must declare deterministic: true");
	if (typeof definition.contribute !== "function") throw new Error("memory Strategy extension contribute() is required");
	return Object.freeze({
		manifest: jsonClone({
			...manifest,
			packageName,
			typeId: id(manifest.typeId, "memory Strategy extension typeId"),
			strategyTypeId: id(manifest.strategyTypeId, "memory Strategy extension target"),
			slot: id(manifest.slot, "memory Strategy extension slot")
		}, "memory Strategy extension manifest"),
		contribute: definition.contribute
	});
}
//#endregion
export { defineMemoryStrategy as a, jsonClone as c, uniqueIds as d, validateCapabilities as f, defineMemorySource as i, positiveInteger as l, deepFreeze as n, defineMemoryStrategyExtension as o, validateProvenance as p, defineMemoryPlugin as r, id as s, canonicalMemoryJson as t, requiredText as u };
