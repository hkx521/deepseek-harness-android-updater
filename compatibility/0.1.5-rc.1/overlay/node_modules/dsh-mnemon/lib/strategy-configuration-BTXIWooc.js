import { n as deepFreeze, t as canonicalMemoryJson } from "./definitions-j0FLgE0-.js";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
//#region src/sdk/storage-lock.ts
const queues = /* @__PURE__ */ new Map();
/**
* Serialize in-process work on one local storage root, including work from
* independently loaded plugins. File locks still own cross-process safety.
* Callers must not acquire the same root recursively.
*/
function withMemoryStorageLock(directory, operation) {
	const key = resolve(directory);
	const result = (queues.get(key) ?? Promise.resolve()).then(operation);
	const settled = result.then(() => {}, () => {});
	queues.set(key, settled);
	settled.then(() => {
		if (queues.get(key) === settled) queues.delete(key);
	});
	return result;
}
//#endregion
//#region src/sdk/input.ts
/** Stable digest of validated configuration; raw values never enter diagnostics. */
function memoryConfigurationDigest(value) {
	return `config:${createHash("sha256").update(canonicalMemoryJson(value, "memory configuration")).digest("hex")}`;
}
function record(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
function text(value, label, maximum, required = true) {
	if (value === void 0 && !required) return void 0;
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	const normalized = value.trim();
	if (required && normalized === "") throw new Error(`${label} is required`);
	if (normalized.length > maximum) throw new Error(`${label} is too long (max ${maximum} characters)`);
	return normalized === "" ? void 0 : normalized;
}
function integer(value, fallback, minimum, maximum) {
	if (value === void 0) return fallback;
	if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`value must be an integer within ${minimum}..${maximum}`);
	return value;
}
function stringArray(value, label, maximum = 50) {
	if (value === void 0) return void 0;
	if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string")) throw new Error(`${label} must be a string array`);
	return value.map((item) => item.trim()).filter(Boolean);
}
function truncate(value, maximum) {
	if (maximum <= 0) return "";
	if (value.length <= maximum) return value;
	let end = maximum - 1;
	if (end > 0 && /[\uD800-\uDBFF]/u.test(value[end - 1])) end--;
	return `${value.slice(0, end)}…`;
}
function receipt(viewId, offerId, sourceInstanceKey, revision, details, completion = "unknown") {
	return {
		id: `receipt:${randomUUID()}`,
		viewId,
		offerId,
		sourceInstanceKey,
		status: completion === "failed" ? "failed" : completion === "partial" || completion === "unknown" ? "partial" : "succeeded",
		completion,
		...completion === "committed" ? { committedAt: (/* @__PURE__ */ new Date()).toISOString() } : {},
		...revision === void 0 ? {} : { revision },
		details
	};
}
/** Validate migration proof supplied by an authorized Source management caller. */
function migrationLineage(value) {
	if (value === void 0) return [];
	if (!Array.isArray(value) || value.length > 1e3) throw new Error("lineage must be an array of at most 1000 entries");
	return value.map((item) => {
		const entry = record(item, "lineage");
		const endpoint = (value) => {
			const fields = record(value, "lineage endpoint");
			return {
				layerId: text(fields.layerId, "lineage layerId", 300),
				reference: text(fields.reference, "lineage reference", 2e3),
				digest: text(fields.digest, "lineage digest", 300)
			};
		};
		return {
			source: endpoint(entry.source),
			destination: endpoint(entry.destination)
		};
	});
}
//#endregion
//#region src/sdk/strategy-configuration.ts
function defineMemoryStrategyConfiguration(value) {
	return readMemoryStrategyConfiguration({
		...value,
		apiVersion: "dsh-mnemon/strategy-configuration/v1"
	});
}
/** Host discovery also validates modules that do not use the author helper. */
function readMemoryStrategyConfiguration(value) {
	const text = (input) => typeof input === "object" && input !== null && ["en", "zh-CN"].every((key) => {
		const item = input[key];
		return typeof item === "string" && item.trim() !== "" && item.length <= 4e3;
	});
	if (!value || value.apiVersion !== "dsh-mnemon/strategy-configuration/v1" || typeof value.create !== "function" || !["strategy", "strategy-extension"].includes(value.kind) || !/^[a-z][a-z0-9-]{0,127}$/u.test(value.typeId) || !Array.isArray(value.fields) || value.fields.length > 16 || value.fields.some((field) => !field || !/^[a-zA-Z][a-zA-Z0-9]{0,99}$/u.test(field.key) || ![
		"number",
		"text",
		"textarea",
		"string-list",
		"source-list"
	].includes(field.input) || !text(field.label) || field.description !== void 0 && !text(field.description) || [field.minimum, field.maximum].some((bound) => bound !== void 0 && (typeof bound !== "number" || !Number.isFinite(bound))) || field.sourceRoles !== void 0 && (!Array.isArray(field.sourceRoles) || field.sourceRoles.length > 32 || field.sourceRoles.some((role) => typeof role !== "string" || !role || role.length > 128))) || new Set(value.fields.map((field) => field.key)).size !== value.fields.length || !text(value.label) || !text(value.description)) throw new Error("Invalid plugin configuration descriptor");
	const json = canonicalMemoryJson({
		label: value.label,
		description: value.description,
		fields: value.fields
	}, "Plugin editor metadata");
	if (json.length > 65536) throw new Error("Plugin editor metadata exceeds 64 KiB");
	const metadata = deepFreeze(JSON.parse(json));
	const factory = value.create;
	const definition = Object.freeze({
		apiVersion: value.apiVersion,
		kind: value.kind,
		typeId: value.typeId,
		...metadata,
		create(input) {
			const contribution = factory(memoryStrategyConfigurationValues(definition, input));
			if (!contribution || !Array.isArray(contribution.strategies ?? []) || !Array.isArray(contribution.strategyExtensions ?? [])) throw new Error("Plugin factory must return a Strategy contribution");
			const values = [...contribution.strategies ?? [], ...contribution.strategyExtensions ?? []];
			if ((contribution.sources?.length ?? 0) !== 0 || values.length !== 1 || values[0]?.manifest?.typeId !== definition.typeId || values[0]?.manifest?.kind !== definition.kind || contribution.plugin !== void 0 && contribution.plugin.packageName !== values[0].manifest.packageName) throw new Error("Plugin factory does not match its declared contribution");
			return contribution;
		}
	});
	for (const field of definition.fields) if (field.defaultValue !== void 0) memoryStrategyConfigurationValues(definition, { [field.key]: field.defaultValue });
	return definition;
}
/** Validate and copy supplied values without applying defaults or executing code. */
function memoryStrategyConfigurationValues(definition, input) {
	const value = input ?? {};
	if (typeof value !== "object" || Array.isArray(value)) throw new Error("Plugin configuration must be an object");
	const json = JSON.stringify(value);
	if (json.length > 65536) throw new Error("Plugin configuration exceeds 64 KiB");
	const config = JSON.parse(json);
	const fields = new Map(definition.fields.map((field) => [field.key, field]));
	for (const [key, value] of Object.entries(config)) {
		if ([
			"__proto__",
			"prototype",
			"constructor"
		].includes(key)) throw new Error("Unsafe plugin configuration key");
		const field = fields.get(key);
		if (!field) throw new Error(`Plugin field is not declared for management: ${key}`);
		if (field.input === "number") {
			if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || field.minimum !== void 0 && value < field.minimum || field.maximum !== void 0 && value > field.maximum) throw new Error(`Invalid numeric plugin field: ${key}`);
		} else if (field.input === "source-list" || field.input === "string-list") {
			if (!Array.isArray(value) || value.length > 32 || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 500) || new Set(value).size !== value.length) throw new Error(`Invalid plugin list: ${key}`);
		} else if (typeof value !== "string" || value.length > (field.maximum ?? 4e3)) throw new Error(`Invalid plugin text: ${key}`);
	}
	return config;
}
//#endregion
export { memoryConfigurationDigest as a, record as c, truncate as d, withMemoryStorageLock as f, integer as i, stringArray as l, memoryStrategyConfigurationValues as n, migrationLineage as o, readMemoryStrategyConfiguration as r, receipt as s, defineMemoryStrategyConfiguration as t, text as u };
