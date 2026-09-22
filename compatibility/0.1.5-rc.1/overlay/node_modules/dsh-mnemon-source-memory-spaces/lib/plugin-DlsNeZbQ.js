import { a as digest, i as defineMemorySpaceProviderDefinition, o as requiredId } from "./definitions-DfmOqJjR.js";
//#region src/providers/catalog.ts
function memoryProviderDescriptor(id, catalog = []) {
	const descriptor = catalog.find((candidate) => candidate.id === id);
	if (descriptor === void 0) throw new Error(`unsupported memory provider: ${String(id)}`);
	return descriptor;
}
function normalizeUrl(value, label) {
	const normalized = value.trim().replace(/\/+$/u, "");
	let url;
	try {
		url = new URL(normalized);
	} catch {
		throw new Error(`${label} must be a valid http(s) URL`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${label} must use http or https`);
	if (url.username !== "" || url.password !== "") throw new Error(`${label} must not contain credentials`);
	return normalized;
}
function normalizeString(value, field) {
	let normalized = typeof value === "string" ? value.trim() : value === void 0 || value === null ? "" : String(value).trim();
	if (field.normalize === "trim-trailing-slash") normalized = normalized.replace(/\/+$/u, "");
	const maximum = field.maxLength ?? (field.input === "secret" ? 8e3 : 2e3);
	if (normalized.length > maximum) throw new Error(`${field.label} is too long (max ${maximum} characters)`);
	if (field.required && normalized === "") throw new Error(`${field.label} is required`);
	if (field.input === "url" && normalized !== "") return normalizeUrl(normalized, field.label);
	if (field.options !== void 0 && normalized !== "" && !field.options.some((option) => option.value === normalized)) throw new Error(`${field.label} has an unsupported value`);
	if (field.pattern !== void 0 && normalized !== "" && !new RegExp(field.pattern, "u").test(normalized)) throw new Error(field.validationMessage ?? `${field.label.charAt(0).toLowerCase()}${field.label.slice(1)} has an invalid format`);
	return normalized;
}
function validateFieldBounds(field, value) {
	if (field.min !== void 0 && field.max !== void 0 && (value < field.min || value > field.max)) throw new Error(`${field.label.charAt(0).toLowerCase()}${field.label.slice(1)} must be within ${field.min}..${field.max}`);
	if (field.min !== void 0 && value < field.min) throw new Error(`${field.label} must be at least ${field.min}`);
	if (field.max !== void 0 && value > field.max) throw new Error(`${field.label} must be at most ${field.max}`);
}
function normalizeScopedProviderConnection(providerId, scope, input, previous = {}, clearSecrets = [], catalog = []) {
	const descriptor = memoryProviderDescriptor(providerId, catalog);
	if ((descriptor.typeId ?? descriptor.id) === "mnemon-native") return {};
	const fields = descriptor.fields.filter((item) => item.scope === scope);
	const allowed = new Set(fields.map((item) => item.key));
	for (const key of Object.keys(input ?? {})) if (!allowed.has(key)) throw new Error(`unsupported ${descriptor.label} ${scope} setting: ${key}`);
	for (const key of clearSecrets) if (fields.find((item) => item.key === key)?.input !== "secret") throw new Error(`cannot clear non-secret ${descriptor.label} ${scope} setting: ${key}`);
	const output = {};
	for (const configField of fields) {
		if (clearSecrets.includes(configField.key)) {
			output[configField.key] = "";
			continue;
		}
		const value = input?.[configField.key] ?? previous[configField.key] ?? configField.defaultValue;
		if (configField.input === "boolean") {
			if (value === void 0) continue;
			if (typeof value === "boolean") output[configField.key] = value;
			else if (value === "true" || value === "false") output[configField.key] = value === "true";
			else throw new Error(`${configField.label} must be true or false`);
			continue;
		}
		if (configField.input === "number") {
			if (value === void 0 || value === "") continue;
			const parsed = typeof value === "number" ? value : Number(value);
			if (!Number.isFinite(parsed)) throw new Error(`${configField.label} must be a finite number`);
			validateFieldBounds(configField, parsed);
			output[configField.key] = parsed;
			continue;
		}
		const normalized = normalizeString(value, configField);
		if (normalized !== "" || configField.required || configField.input === "secret") output[configField.key] = normalized;
	}
	return output;
}
function providerServiceFields(providerId, catalog = []) {
	return memoryProviderDescriptor(providerId, catalog).fields.filter((field) => field.scope === "service");
}
function providerMemoryFields(providerId, catalog = []) {
	return memoryProviderDescriptor(providerId, catalog).fields.filter((field) => field.scope === "memory");
}
function splitProviderConnection(providerId, connection, catalog = []) {
	const serviceKeys = new Set(providerServiceFields(providerId, catalog).map((field) => field.key));
	return {
		service: Object.fromEntries(Object.entries(connection ?? {}).filter(([key]) => serviceKeys.has(key))),
		memory: Object.fromEntries(Object.entries(connection ?? {}).filter(([key]) => !serviceKeys.has(key)))
	};
}
function normalizeProviderServiceConnection(providerId, input, previous = {}, clearSecrets = [], catalog = []) {
	return normalizeScopedProviderConnection(providerId, "service", input, previous, clearSecrets, catalog);
}
function normalizeProviderMemoryConnection(providerId, input, previous = {}, catalog = []) {
	return normalizeScopedProviderConnection(providerId, "memory", input, previous, [], catalog);
}
function normalizeProviderConnection(providerId, input, previous = {}, clearSecrets = [], catalog = []) {
	const descriptor = memoryProviderDescriptor(providerId, catalog);
	if ((descriptor.typeId ?? descriptor.id) === "mnemon-native") return {};
	const allowed = new Set(descriptor.fields.map((item) => item.key));
	for (const key of Object.keys(input ?? {})) if (!allowed.has(key)) throw new Error(`unsupported ${descriptor.label} setting: ${key}`);
	for (const key of clearSecrets) if (descriptor.fields.find((item) => item.key === key)?.input !== "secret") throw new Error(`cannot clear non-secret ${descriptor.label} setting: ${key}`);
	const output = {};
	for (const configField of descriptor.fields) {
		if (clearSecrets.includes(configField.key)) {
			output[configField.key] = "";
			continue;
		}
		const supplied = input?.[configField.key];
		const fallback = previous[configField.key] ?? configField.defaultValue;
		const value = supplied ?? fallback;
		if (configField.input === "boolean") {
			if (value === void 0) continue;
			if (typeof value === "boolean") output[configField.key] = value;
			else if (value === "true" || value === "false") output[configField.key] = value === "true";
			else throw new Error(`${configField.label} must be true or false`);
			continue;
		}
		if (configField.input === "number") {
			if (value === void 0 || value === "") continue;
			const parsed = typeof value === "number" ? value : Number(value);
			if (!Number.isFinite(parsed)) throw new Error(`${configField.label} must be a finite number`);
			validateFieldBounds(configField, parsed);
			output[configField.key] = parsed;
			continue;
		}
		const normalized = normalizeString(value, configField);
		if (normalized !== "" || configField.required || configField.input === "secret") output[configField.key] = normalized;
	}
	return output;
}
function publicScopedProviderConnection(providerId, scope, connection, catalog = []) {
	const fields = memoryProviderDescriptor(providerId, catalog).fields.filter((item) => item.scope === scope);
	const keys = new Set(fields.map((item) => item.key));
	const secrets = new Set(fields.filter((item) => item.input === "secret").map((item) => item.key));
	return {
		settings: Object.fromEntries(Object.entries(connection).filter(([key]) => keys.has(key) && !secrets.has(key))),
		configuredSecrets: [...secrets].filter((key) => String(connection[key] ?? "") !== "")
	};
}
function publicProviderConnection(providerId, connection, catalog = []) {
	const descriptor = memoryProviderDescriptor(providerId, catalog);
	const secrets = new Set(descriptor.fields.filter((item) => item.input === "secret").map((item) => item.key));
	return {
		settings: Object.fromEntries(Object.entries(connection).filter(([key]) => !secrets.has(key))),
		configuredSecrets: [...secrets].filter((key) => String(connection[key] ?? "") !== "")
	};
}
/** Immutable descriptor/config normalizer scoped to one Provider snapshot. */
var MemoryProviderCatalog = class {
	providers;
	constructor(providers) {
		const ids = /* @__PURE__ */ new Set();
		this.providers = Object.freeze(providers.map((provider) => {
			if (ids.has(provider.id)) throw new Error(`memory provider descriptor is already registered: ${provider.id}`);
			ids.add(provider.id);
			return Object.freeze(structuredClone(provider));
		}));
	}
	has(id) {
		return typeof id === "string" && this.providers.some((provider) => provider.id === id);
	}
	descriptor(id) {
		return memoryProviderDescriptor(id, this.providers);
	}
	serviceFields(id) {
		return providerServiceFields(id, this.providers);
	}
	memoryFields(id) {
		return providerMemoryFields(id, this.providers);
	}
	split(id, connection) {
		return splitProviderConnection(id, connection, this.providers);
	}
	normalizeService(id, input, previous = {}, clearSecrets = []) {
		return normalizeProviderServiceConnection(id, input, previous, clearSecrets, this.providers);
	}
	normalizeMemory(id, input, previous = {}) {
		return normalizeProviderMemoryConnection(id, input, previous, this.providers);
	}
	normalize(id, input, previous = {}, clearSecrets = []) {
		return normalizeProviderConnection(id, input, previous, clearSecrets, this.providers);
	}
	publicScoped(id, scope, connection) {
		return publicScopedProviderConnection(id, scope, connection, this.providers);
	}
	public(id, connection) {
		return publicProviderConnection(id, connection, this.providers);
	}
};
const EMPTY_MEMORY_PROVIDER_CATALOG = new MemoryProviderCatalog([]);
//#endregion
//#region src/providers/registry.ts
/** Lifecycle-owned factory directory used by Provider plugins and the Host. */
var MemoryAdapterFactoryRegistry = class {
	factories = /* @__PURE__ */ new Map();
	constructor(factories = []) {
		for (const factory of factories) this.register(factory);
	}
	register(factory) {
		if (this.factories.has(factory.id)) throw new Error(`memory adapter factory is already registered: ${factory.id}`);
		this.factories.set(factory.id, factory);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			if (this.factories.get(factory.id) === factory) this.factories.delete(factory.id);
		};
	}
	create(context) {
		const adapters = /* @__PURE__ */ new Map();
		for (const factory of this.factories.values()) {
			const adapter = factory.create(context);
			if (adapter.id !== factory.id) throw new Error(`memory adapter factory ${factory.id} returned ${adapter.id}`);
			if (adapters.has(adapter.id)) throw new Error(`memory adapter is already created: ${adapter.id}`);
			adapters.set(adapter.id, adapter);
		}
		return adapters;
	}
	ids() {
		return [...this.factories.keys()];
	}
};
var MemoryProviderAdapterRegistry = class extends MemoryAdapterFactoryRegistry {};
//#endregion
//#region src/providers/host.ts
const SOURCE_INSTANCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,299}$/u;
function requiredSourceInstanceId(value) {
	const normalized = value.trim();
	if (!SOURCE_INSTANCE_ID.test(normalized)) throw new Error("Memory Spaces Source instanceId must start with a letter or digit and contain only letters, digits, ., _, :, / or -");
	return normalized;
}
/** Presentation labels/icons do not change the semantic Generation digest. */
function semanticManifest(manifest) {
	return {
		apiVersion: manifest.apiVersion,
		kind: manifest.kind,
		typeId: manifest.typeId,
		packageName: manifest.packageName,
		version: manifest.version,
		origin: manifest.origin,
		locality: manifest.locality,
		workspaceBinding: manifest.workspaceBinding,
		capabilities: manifest.capabilities,
		fields: manifest.fields.map((field) => ({
			key: field.key,
			scope: field.scope,
			role: field.role,
			input: field.input,
			required: field.required,
			defaultValue: field.defaultValue,
			min: field.min,
			max: field.max,
			maxLength: field.maxLength,
			pattern: field.pattern,
			normalize: field.normalize,
			discoveryDefaultFrom: field.discoveryDefaultFrom,
			options: field.options?.map((option) => option.value)
		})),
		secrets: manifest.secrets,
		scoreSemantics: manifest.scoreSemantics
	};
}
function assertRuntime(definition, adapter) {
	const { manifest } = definition;
	if (adapter.id !== manifest.typeId) throw new Error(`Memory Space Provider ${manifest.typeId} factory returned ${String(adapter.id)}`);
	const requiredMethods = [
		[manifest.capabilities.search, "search"],
		[manifest.capabilities.browse, "list"],
		[manifest.capabilities.graph, "graph"],
		[manifest.capabilities.related, "related"],
		[manifest.capabilities.remember, "remember"],
		[manifest.capabilities.link, "link"],
		[manifest.capabilities.forget, "forget"]
	];
	for (const [required, method] of requiredMethods) if (required && typeof adapter[method] !== "function") throw new Error(`Memory Space Provider ${manifest.typeId} declares ${String(method)} but its runtime does not implement it`);
	if (manifest.scoreSemantics === "normalized-relevance" && adapter.scoreSemantics?.kind !== "normalized-relevance") throw new Error(`Memory Space Provider ${manifest.typeId} declares normalized scores but its runtime does not`);
}
/** Expose the configured child identity while preserving the driver methods. */
function instanceAdapter(adapter, instanceId) {
	return new Proxy(adapter, { get(target, property) {
		if (property === "id") return instanceId;
		const value = Reflect.get(target, property, target);
		return typeof value === "function" ? value.bind(target) : value;
	} });
}
var MemorySpaceProviderSnapshot = class {
	digest;
	entries;
	constructor(entries) {
		const sorted = [...entries].sort((left, right) => left.childKey.localeCompare(right.childKey));
		this.entries = Object.freeze(sorted.map((entry) => Object.freeze({ ...entry })));
		this.digest = digest(sorted.map((entry) => ({
			childKey: entry.childKey,
			instanceId: entry.instanceId,
			configDigest: entry.configDigest,
			manifest: semanticManifest(entry.definition.manifest)
		})), "Memory Space Provider snapshot");
		Object.freeze(this);
	}
	descriptors() {
		return this.entries.map(({ instanceId, definition }) => ({
			id: instanceId,
			...instanceId === definition.manifest.typeId ? {} : { typeId: definition.manifest.typeId },
			label: definition.manifest.label,
			...definition.manifest.icon === void 0 ? {} : { icon: structuredClone(definition.manifest.icon) },
			kind: definition.manifest.locality,
			workspaceBinding: definition.manifest.workspaceBinding,
			summary: definition.manifest.summary,
			...definition.manifest.summaryI18nKey === void 0 ? {} : { summaryI18nKey: definition.manifest.summaryI18nKey },
			origin: definition.manifest.origin,
			capabilities: structuredClone(definition.manifest.capabilities),
			fields: structuredClone(definition.manifest.fields)
		}));
	}
	adapterRegistry() {
		return new MemoryProviderAdapterRegistry(this.entries.map(({ instanceId, definition }) => ({
			id: instanceId,
			create: (context) => {
				const adapter = definition.create({
					...context,
					providerInstanceId: instanceId,
					manifest: definition.manifest
				});
				assertRuntime(definition, adapter);
				return instanceAdapter(adapter, instanceId);
			}
		})));
	}
};
/**
* Source-private definition host. It is a plain closure-owned object, never a
* Cordis Context service and never a Mnemon contribution registry.
*/
var PrivateMemorySpaceProviderHost = class {
	sourceInstanceId;
	registrations = /* @__PURE__ */ new Map();
	constructor(sourceInstanceId) {
		this.sourceInstanceId = sourceInstanceId;
		this.sourceInstanceId = requiredSourceInstanceId(sourceInstanceId);
	}
	bind(instanceIdValue, moduleTypeIdValue, config) {
		const instanceId = requiredId(instanceIdValue, "Memory Space Provider instanceId");
		const moduleTypeId = requiredId(moduleTypeIdValue, "Memory Space Provider module id");
		const childKey = `${this.sourceInstanceId}/provider:${instanceId}`;
		const configDigest = digest(config ?? null, `Memory Space Provider ${instanceId} config`);
		let installed = false;
		return Object.freeze({ install: (owner, definitionValue) => {
			if (installed) throw new Error(`Memory Space Provider child already installed a definition: ${childKey}`);
			const definition = defineMemorySpaceProviderDefinition(definitionValue);
			if (definition.manifest.typeId !== moduleTypeId) throw new Error(`Memory Space Provider module ${moduleTypeId} installed definition ${definition.manifest.typeId}`);
			installed = true;
			return owner.effect(() => {
				if (this.registrations.has(childKey)) throw new Error(`Memory Space Provider child is already installed: ${childKey}`);
				const registration = Object.freeze({
					childKey,
					instanceId,
					configDigest,
					definition
				});
				this.registrations.set(childKey, registration);
				let active = true;
				return () => {
					if (!active) return;
					active = false;
					if (this.registrations.get(childKey) === registration) this.registrations.delete(childKey);
				};
			}, `dsh-mnemon: install private Provider ${childKey}`);
		} });
	}
	has(instanceId) {
		return this.registrations.has(`${this.sourceInstanceId}/provider:${instanceId}`);
	}
	snapshot() {
		return new MemorySpaceProviderSnapshot([...this.registrations.values()]);
	}
};
//#endregion
//#region src/providers/plugin.ts
/**
* Build an ordinary child plugin whose only capability is a closure-held
* registration into its Memory Spaces parent. No ctx.mnemonProvider service
* exists, and core cannot resolve this host.
*/
function createMemorySpaceProviderPlugin(entry, host) {
	const plugin = {
		name: `dsh-mnemon-provider-${entry.module.id}`,
		apply(ctx, config = entry.config) {
			return entry.module.apply(ctx, host.bind(entry.instanceId, entry.module.id, config), config);
		}
	};
	if (entry.module.Config !== void 0) plugin.Config = entry.module.Config;
	return plugin;
}
//#endregion
export { MemoryProviderCatalog as a, EMPTY_MEMORY_PROVIDER_CATALOG as i, PrivateMemorySpaceProviderHost as n, MemoryProviderAdapterRegistry as r, createMemorySpaceProviderPlugin as t };
