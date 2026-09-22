import { findMnemonCommand, isMnemonExecutable, mnemonNpmLauncher, nodeLauncherEnvironment } from "./native-cli.js";
import { CATEGORIES as CATEGORIES$1, EDGE_TYPES, INTENTS as INTENTS$1, MNEMON_EMBEDDING_PROTOCOLS, SOURCES as SOURCES$1 } from "./contracts.js";
import { a as MemoryProviderCatalog, i as EMPTY_MEMORY_PROVIDER_CATALOG, n as PrivateMemorySpaceProviderHost, r as MemoryProviderAdapterRegistry, t as createMemorySpaceProviderPlugin } from "./plugin-DlsNeZbQ.js";
import { t as runProcess } from "./process-BvrgxPNP.js";
import { r as defineMemorySpaceProvider } from "./definitions-DfmOqJjR.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import z from "schemastery";
import { createMemoryMutationReceipt, defineMemoryPlugin, defineMemorySource, installMemory, memoryConfigurationDigest, memoryInputInteger, memoryInputRecord, memoryInputStringArray, memoryInputText, truncateMemoryText, withMemoryStorageLock } from "dsh-mnemon/extension-sdk";
import { createHash, randomUUID } from "node:crypto";
import { COMPOSABLE_MEMORY_API_VERSION } from "dsh-mnemon/contracts";
//#region src/view-model.ts
const MODEL_MEMORY_BODY_LIMIT = 16;
function boundedToolText(value, maximum) {
	return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}
/** Strip control-plane paths, provider settings, and statistics from model output. */
function modelSpaceCatalog(catalog) {
	const items = catalog.items.slice(0, MODEL_MEMORY_BODY_LIMIT);
	return {
		items: items.map((body) => ({
			id: body.id,
			name: boundedToolText(body.name, 120),
			description: boundedToolText(body.description, 500),
			active: body.active,
			providerEnabled: body.providerEnabled !== false,
			status: body.providerEnabled === false ? "provider-disabled" : body.statusLoading === true ? "not-probed" : body.healthy ? "healthy" : "unhealthy",
			...body.error === void 0 ? {} : { error: boundedToolText(body.error, 500) },
			provider: {
				id: body.provider.id,
				label: boundedToolText(body.provider.label, 120),
				capabilities: structuredClone(body.provider.capabilities)
			}
		})),
		persistenceStrategy: catalog.persistenceStrategy,
		total: catalog.total,
		activeCount: catalog.activeCount,
		omittedCount: Math.max(0, catalog.items.length - items.length)
	};
}
/** Keep health diagnostics useful without exposing complete control-plane state. */
function modelStatus(status) {
	const active = status.memoryBodies.filter((body) => body.active && body.providerEnabled !== false);
	const unhealthy = active.filter((body) => !body.healthy);
	const relevantProviders = status.providerServices?.filter((provider) => provider.enabled || provider.configured || provider.memoryBodyCount > 0 || provider.status === "unhealthy") ?? [];
	const providers = relevantProviders.slice(0, 16);
	return {
		healthy: status.healthy && unhealthy.length === 0,
		...status.error === void 0 ? {} : { error: boundedToolText(status.error, 1e3) },
		...status.version === void 0 ? {} : { version: boundedToolText(status.version, 120) },
		commandFound: status.commandFound,
		writeEnabled: status.writeEnabled,
		memorySpaces: {
			total: status.memoryBodies.length,
			active: active.length,
			healthy: active.length - unhealthy.length,
			unhealthy: unhealthy.length,
			providerDisabled: status.memoryBodies.filter((body) => body.providerEnabled === false).length
		},
		providers: providers.map((provider) => ({
			providerId: provider.providerId,
			label: boundedToolText(provider.label, 120),
			enabled: provider.enabled,
			configured: provider.configured,
			status: provider.status,
			memoryBodyCount: provider.memoryBodyCount,
			activeMemoryBodyCount: provider.activeMemoryBodyCount,
			...provider.error === void 0 ? {} : { error: boundedToolText(provider.error, 500) }
		})),
		omittedProviderCount: Math.max(0, relevantProviders.length - providers.length),
		...status.stats === void 0 ? {} : { aggregate: {
			totalInsights: status.stats.totalInsights,
			deletedInsights: status.stats.deletedInsights,
			edgeCount: status.stats.edgeCount,
			oplogCount: status.stats.oplogCount,
			dbSizeBytes: status.stats.dbSizeBytes
		} }
	};
}
/** Preserve valid JSON when the Route's evidence budget is smaller than a directory. */
function modelJson(value, maximum) {
	const bounded = structuredClone(value);
	let result = JSON.stringify(bounded);
	while (result.length > maximum) {
		if (bounded.items !== void 0 && bounded.items.length > 0) {
			bounded.items.pop();
			bounded.omittedCount = (bounded.omittedCount ?? 0) + 1;
		} else if (bounded.providers !== void 0 && bounded.providers.length > 0) {
			bounded.providers.pop();
			bounded.omittedProviderCount = (bounded.omittedProviderCount ?? 0) + 1;
		} else return JSON.stringify({ unavailable: "Inspection summary exceeds the Route budget; narrow the query." });
		result = JSON.stringify(bounded);
	}
	return result;
}
//#endregion
//#region src/memory-spaces.ts
const NATIVE_REGISTRY_VERSION = 1;
const PROVIDER_REGISTRY_VERSION = 4;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{0,127}$/u;
function storedProviderId(value) {
	return typeof value === "string" && PROVIDER_ID_PATTERN.test(value);
}
function storedProviderConnection(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
	return Object.fromEntries(Object.entries(value).filter((entry) => {
		const [key, item] = entry;
		return /^[a-z][a-zA-Z0-9_-]{0,127}$/u.test(key) && (typeof item === "boolean" || typeof item === "number" && Number.isFinite(item) || typeof item === "string" && item.length <= 8e3);
	}));
}
function requiredText(value, label, max) {
	const normalized = value.trim();
	if (normalized === "") throw new Error(`${label} is required`);
	if (normalized.length > max) throw new Error(`${label} is too long (max ${max} characters)`);
	return normalized;
}
function optionalText$1(value, label, max) {
	const normalized = value?.trim() ?? "";
	if (normalized.length > max) throw new Error(`${label} is too long (max ${max} characters)`);
	return normalized;
}
const PROVIDER_METADATA_KEYS = [
	"name",
	"title",
	"displayName",
	"workspace",
	"bankId",
	"project",
	"containerTag",
	"userId",
	"user",
	"workingDirectory",
	"targetUri"
];
function compactProviderMetadataValue(value) {
	if (typeof value !== "string") return void 0;
	const normalized = value.trim();
	if (normalized === "" || normalized === "*") return void 0;
	return (normalized.split(/[/:\\]+/u).filter(Boolean).at(-1) ?? normalized).trim() || void 0;
}
/**
* Normalize uneven provider discovery metadata at the projection boundary.
* Adapters map the richest native fields they know; the registry then tries
* the nearest namespace setting before falling back to a stable provider
* identity. This keeps every discovered namespace usable without teaching the
* Web UI each provider's response shape.
*/
function providerProjectionMetadata(providerCatalog, providerId, candidate) {
	const descriptor = providerCatalog.descriptor(providerId);
	const externalId = requiredText(candidate.externalId, "provider externalId", 2e3);
	const mappedName = String(candidate.name ?? "").trim();
	const nearestName = PROVIDER_METADATA_KEYS.map((key) => compactProviderMetadataValue(candidate.connection[key])).find((value) => value !== void 0);
	const fallbackId = compactProviderMetadataValue(externalId) ?? externalId;
	const name = (mappedName || nearestName || `${descriptor.label} ${fallbackId}`).slice(0, 100);
	const description = (String(candidate.description ?? "").trim() || `${descriptor.label} memory namespace mapped from ${externalId}.`).slice(0, 1e3);
	return {
		name: requiredText(name, "name", 100),
		description: optionalText$1(description, "description", 1e3)
	};
}
function providerDisplayLocation(descriptor, connection) {
	const populated = (field) => field.input !== "secret" && String(connection[field.key] ?? "").trim() !== "";
	const field = descriptor.fields.find((candidate) => candidate.role === "global-location" && populated(candidate)) ?? descriptor.fields.find((candidate) => (candidate.input === "url" || candidate.input === "path") && populated(candidate)) ?? descriptor.fields.find(populated);
	return field === void 0 ? "" : String(connection[field.key]);
}
function legacyOpenVikingConnection(connection) {
	return Object.fromEntries(Object.entries(connection).filter((entry) => typeof entry[1] === "string"));
}
function normalizePlacementDecision(value, providerId, providerCatalog = EMPTY_MEMORY_PROVIDER_CATALOG) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
	const placement = value;
	if (placement.mode !== "automatic" || placement.providerId !== providerId) return void 0;
	if (placement.decidedBy !== "rules" && placement.decidedBy !== "llm") return void 0;
	if (placement.confidence !== "high" && placement.confidence !== "medium" && placement.confidence !== "low") return void 0;
	if (typeof placement.reason !== "string" || placement.reason.trim() === "" || placement.reason.length > 1e3) return void 0;
	if (!Array.isArray(placement.candidateProviderIds) || !placement.candidateProviderIds.every((id) => providerCatalog.has(id)) || !placement.candidateProviderIds.includes(providerId)) return void 0;
	if (!Array.isArray(placement.appliedRules) || !placement.appliedRules.every((rule) => typeof rule === "string" && rule.length <= 500)) return void 0;
	if (typeof placement.decidedAt !== "string" || placement.decidedAt.trim() === "") return void 0;
	if (placement.runId !== void 0 && typeof placement.runId !== "string") return void 0;
	if (placement.subagentProvider !== void 0 && typeof placement.subagentProvider !== "string") return void 0;
	return {
		mode: "automatic",
		providerId,
		decidedBy: placement.decidedBy,
		reason: placement.reason.trim(),
		confidence: placement.confidence,
		candidateProviderIds: [...new Set(placement.candidateProviderIds)],
		appliedRules: [...placement.appliedRules],
		decidedAt: placement.decidedAt,
		...placement.runId === void 0 ? {} : { runId: placement.runId },
		...placement.subagentProvider === void 0 ? {} : { subagentProvider: placement.subagentProvider }
	};
}
function validateMemorySpaceId(value) {
	const normalized = value.trim();
	if (!ID_PATTERN.test(normalized)) throw new Error("memoryBodyId must match [a-zA-Z0-9][a-zA-Z0-9_-]*");
	return normalized;
}
/**
* Persistent metadata layered over Mnemon's native named stores.
*
* Native metadata lives beside Store directories so existing Mnemon Packs stay
* compatible. External connection metadata lives under state and is never
* included in Memory Space Packs.
*/
var MemorySpaceRegistry = class MemorySpaceRegistry {
	runner;
	persistent;
	now;
	providerCatalog;
	directory;
	registryPath;
	providerRegistryPath;
	refreshing = false;
	state;
	constructor(runner, persistent = true, now = () => /* @__PURE__ */ new Date(), providerCatalog = EMPTY_MEMORY_PROVIDER_CATALOG, sharedState) {
		this.runner = runner;
		this.persistent = persistent;
		this.now = now;
		this.providerCatalog = providerCatalog;
		this.state = sharedState ?? {
			spaces: [],
			services: {},
			serviceEnabled: {}
		};
		this.directory = join(runner.effectiveDataDir(), "data");
		this.registryPath = join(this.directory, ".dsh-memory-bodies.json");
		this.providerRegistryPath = join(runner.effectiveDataDir(), "state", "memory-providers.json");
		if (sharedState === void 0) this.reload();
	}
	get spaces() {
		return this.state.spaces;
	}
	set spaces(value) {
		this.state.spaces = value;
	}
	get services() {
		return this.state.services;
	}
	set services(value) {
		this.state.services = value;
	}
	get serviceEnabled() {
		return this.state.serviceEnabled;
	}
	set serviceEnabled(value) {
		this.state.serviceEnabled = value;
	}
	/** One generation-local descriptor view over the same persistent authority. */
	withProviderCatalog(providerCatalog) {
		return new MemorySpaceRegistry(this.runner, this.persistent, this.now, providerCatalog, this.state);
	}
	isNative(providerId) {
		return this.providerTypeId(providerId) === "mnemon-native";
	}
	providerTypeId(providerId) {
		const descriptor = this.providerCatalog.descriptor(providerId);
		return descriptor.typeId ?? descriptor.id;
	}
	list() {
		this.refreshIfChanged();
		this.reconcileDiscoveredStores();
		return this.spaces.filter((body) => this.providerCatalog.has(body.providerId)).map((body) => this.view(body));
	}
	active() {
		return this.list().filter((body) => body.active && (this.isNative(body.provider.id) || Object.hasOwn(this.services, body.provider.id) && this.serviceEnabled[body.provider.id] === true));
	}
	get(id) {
		const normalized = validateMemorySpaceId(id);
		const body = this.list().find((entry) => entry.id === normalized);
		if (body === void 0) throw new Error(`unknown memory space: ${normalized}`);
		return body;
	}
	openVikingConnection(id) {
		const connection = this.providerConnection(id, "openviking");
		return {
			endpoint: String(connection.endpoint ?? ""),
			targetUri: String(connection.targetUri ?? ""),
			apiKey: String(connection.apiKey ?? ""),
			account: String(connection.account ?? ""),
			user: String(connection.user ?? ""),
			actorPeerId: String(connection.actorPeerId ?? "")
		};
	}
	providerConnection(id, expectedProviderId) {
		this.refreshIfChanged();
		const normalized = validateMemorySpaceId(id);
		const body = this.spaces.find((entry) => entry.id === normalized);
		if (body === void 0 || this.isNative(body.providerId)) throw new Error(`memory space has no external provider connection: ${normalized}`);
		if (expectedProviderId !== void 0 && body.providerId !== expectedProviderId) throw new Error(`memory space ${normalized} uses ${body.providerId}, not ${expectedProviderId}`);
		return this.connectionFor(body);
	}
	/** Used only after a public operation has refreshed the registry authority. */
	connectionFor(body) {
		const legacy = this.providerTypeId(body.providerId) === "openviking" && body.openViking !== void 0 ? legacyOpenVikingConnection(body.openViking) : void 0;
		return this.providerCatalog.normalize(body.providerId, {
			...this.services[body.providerId] ?? {},
			...legacy ?? {},
			...body.connection ?? {}
		});
	}
	providerServiceConfigured(providerId) {
		this.refreshIfChanged();
		return this.isNative(providerId) ? this.runner.commandFound : Object.hasOwn(this.services, providerId);
	}
	providerServiceEnabled(providerId) {
		return this.isNative(providerId) ? this.runner.commandFound : this.providerServiceConfigured(providerId) && this.serviceEnabled[providerId] === true;
	}
	providerServices(options = {}) {
		this.refreshIfChanged();
		const providers = this.providerCatalog.providers.filter((provider) => (provider.typeId ?? provider.id) !== "mnemon-native");
		const items = providers.map((provider) => {
			const connection = this.services[provider.id];
			const publicConnection = this.providerCatalog.publicScoped(provider.id, "service", connection ?? {});
			return {
				providerId: provider.id,
				enabled: Object.hasOwn(this.services, provider.id) && this.serviceEnabled[provider.id] === true,
				configured: connection !== void 0,
				...publicConnection,
				...options.includeSecrets === true && connection !== void 0 ? { secretValues: Object.fromEntries(publicConnection.configuredSecrets.map((key) => [key, connection[key]])) } : {}
			};
		});
		return {
			providers: [...providers],
			items,
			generatedAt: this.now().toISOString()
		};
	}
	updateProviderService(providerId, settings, clearSecrets = [], enabled = true) {
		this.refreshIfChanged();
		if (this.isNative(providerId)) throw new Error("Mnemon Native service settings are managed by the native configuration");
		const previous = this.services[providerId] ?? {};
		this.services[providerId] = this.providerCatalog.normalizeService(providerId, settings, previous, clearSecrets);
		this.serviceEnabled[providerId] = enabled;
		if (!enabled) this.spaces = this.spaces.filter((body) => body.providerId !== providerId);
		this.save();
		return this.providerServices().items.find((item) => item.providerId === providerId);
	}
	resolveProviderService(providerId, settings, clearSecrets = []) {
		this.refreshIfChanged();
		if (this.isNative(providerId)) throw new Error("Mnemon Native service settings are managed by the native configuration");
		return this.providerCatalog.normalizeService(providerId, settings, this.services[providerId] ?? {}, clearSecrets);
	}
	/** Atomically replace one provider's local projections after authoritative discovery. */
	syncProviderService(providerId, service, discovered) {
		this.refreshIfChanged();
		if (this.isNative(providerId)) throw new Error("Mnemon Native Stores are discovered from disk");
		let normalizedService = this.providerCatalog.normalizeService(providerId, service);
		const seen = /* @__PURE__ */ new Set();
		const existing = this.spaces.filter((body) => body.providerId === providerId);
		const reservedIds = new Set(this.spaces.filter((body) => body.providerId !== providerId).map((body) => body.id));
		const timestamp = this.now().toISOString();
		const projections = discovered.map((candidate) => {
			const externalId = requiredText(candidate.externalId, "provider externalId", 2e3);
			if (seen.has(externalId)) throw new Error(`${this.providerCatalog.descriptor(providerId).label} returned a duplicate memory namespace: ${externalId}`);
			seen.add(externalId);
			const connection = this.providerCatalog.normalizeMemory(providerId, candidate.connection);
			this.providerCatalog.normalize(providerId, {
				...normalizedService,
				...connection
			});
			const previous = existing.find((body) => body.externalId === externalId);
			let id = previous?.id ?? validateMemorySpaceId(`${providerId}-${createHash("sha256").update(externalId).digest("hex").slice(0, 24)}`);
			let suffix = 1;
			while (reservedIds.has(id)) {
				id = validateMemorySpaceId(`${providerId}-${createHash("sha256").update(`${externalId}:${suffix}`).digest("hex").slice(0, 24)}`);
				suffix += 1;
			}
			reservedIds.add(id);
			const metadata = providerProjectionMetadata(this.providerCatalog, providerId, candidate);
			const metadataSource = previous?.metadataSource ?? (previous === void 0 ? "provider" : "manual");
			const preserveLocalMetadata = previous !== void 0 && metadataSource !== "provider";
			return {
				id,
				externalId,
				name: preserveLocalMetadata ? previous.name : metadata.name,
				description: preserveLocalMetadata ? previous.description : metadata.description,
				metadataSource,
				active: previous?.active ?? true,
				providerId,
				connection,
				createdAt: previous?.createdAt ?? timestamp,
				updatedAt: this.nextTimestamp(previous?.updatedAt, timestamp)
			};
		});
		for (const field of this.providerCatalog.serviceFields(providerId)) {
			if (field.discoveryDefaultFrom === void 0 || String(normalizedService[field.key] ?? "").trim() !== "") continue;
			const discoveredValue = projections[0]?.connection?.[field.discoveryDefaultFrom];
			if (discoveredValue !== void 0 && String(discoveredValue).trim() !== "") normalizedService = this.providerCatalog.normalizeService(providerId, {
				...normalizedService,
				[field.key]: discoveredValue
			});
		}
		this.services[providerId] = normalizedService;
		this.serviceEnabled[providerId] = true;
		this.spaces = [...this.spaces.filter((body) => body.providerId !== providerId), ...projections];
		this.save();
		return this.providerServices().items.find((item) => item.providerId === providerId);
	}
	placementCandidates(request) {
		return this.providerCatalog.providers.map((descriptor) => {
			const providerTypeId = descriptor.typeId ?? descriptor.id;
			const requestConnection = request.providerConnections?.[descriptor.id] ?? (providerTypeId === "openviking" && request.connection === void 0 && request.openViking !== void 0 ? request.openViking : request.connection);
			let configured = providerTypeId === "mnemon-native" ? this.runner.commandFound : false;
			if (providerTypeId !== "mnemon-native" && (requestConnection !== void 0 || this.providerServiceConfigured(descriptor.id))) try {
				const split = this.providerCatalog.split(descriptor.id, requestConnection);
				this.providerCatalog.normalize(descriptor.id, {
					...this.services[descriptor.id] ?? {},
					...split.service,
					...split.memory
				});
				configured = Object.keys(split.service).length > 0 || this.providerServiceEnabled(descriptor.id);
			} catch {
				configured = false;
			}
			return {
				id: descriptor.id,
				label: descriptor.label,
				kind: descriptor.kind,
				configured,
				summary: descriptor.summary,
				capabilities: descriptor.capabilities
			};
		});
	}
	async create(request, signal, placement) {
		const name = requiredText(request.name, "name", 100);
		const description = requiredText(request.description, "description", 1e3);
		if (request.placement !== void 0 && placement === void 0) throw new Error("automatic provider placement must be resolved before creating a Memory Space");
		if (placement !== void 0 && request.providerId !== void 0 && request.providerId !== placement.providerId) throw new Error("resolved provider placement conflicts with providerId");
		const providerId = placement?.providerId ?? request.providerId ?? "mnemon-native";
		if (!this.providerCatalog.has(providerId)) throw new Error(`unsupported memory provider: ${String(providerId)}`);
		const normalizedPlacement = placement === void 0 ? void 0 : normalizePlacementDecision(placement, providerId, this.providerCatalog);
		if (placement !== void 0 && normalizedPlacement === void 0) throw new Error("resolved provider placement is invalid");
		const reservedIds = new Set(this.list().map((body) => body.id));
		const nativeStoreIds = this.nativeStoreIds();
		const nativeProvider = this.isNative(providerId);
		let id = nativeProvider && nativeStoreIds.length === 0 && !reservedIds.has("default") ? "default" : validateMemorySpaceId(nativeProvider ? randomUUID() : `${providerId}-${randomUUID()}`);
		while (reservedIds.has(id) || nativeStoreIds.includes(id)) id = validateMemorySpaceId(randomUUID());
		const connectionInput = request.providerConnections?.[providerId] ?? (this.providerTypeId(providerId) === "openviking" && request.connection === void 0 && request.openViking !== void 0 ? request.openViking : request.connection);
		let connection;
		if (!nativeProvider) {
			const split = this.providerCatalog.split(providerId, connectionInput);
			if (Object.keys(split.service).length > 0) {
				this.services[providerId] = this.providerCatalog.normalizeService(providerId, split.service, this.services[providerId] ?? {});
				this.serviceEnabled[providerId] = true;
			}
			if (!this.providerServiceEnabled(providerId)) throw new Error(`${this.providerCatalog.descriptor(providerId).label} service is not enabled; enable it in Settings first`);
			connection = this.providerCatalog.normalizeMemory(providerId, split.memory);
			this.providerCatalog.normalize(providerId, {
				...this.services[providerId],
				...connection
			});
		}
		if (nativeProvider) await this.runner.runText([
			"store",
			"create",
			id
		], {
			...signal === void 0 ? {} : { signal },
			store: id
		});
		const timestamp = this.now().toISOString();
		const body = {
			id,
			name,
			description,
			active: request.active ?? false,
			providerId,
			...nativeProvider ? {} : { metadataSource: "manual" },
			...normalizedPlacement === void 0 ? {} : { placement: normalizedPlacement },
			...connection === void 0 ? {} : { connection },
			createdAt: timestamp,
			updatedAt: timestamp
		};
		this.spaces.push(body);
		this.save();
		return this.view(body);
	}
	update(id, request) {
		this.refreshIfChanged();
		const normalized = validateMemorySpaceId(id);
		const index = this.spaces.findIndex((body) => body.id === normalized);
		if (index < 0) throw new Error(`unknown memory space: ${normalized}`);
		const current = this.spaces[index];
		if (request.openViking !== void 0 && this.providerTypeId(current.providerId) !== "openviking") throw new Error("OpenViking connection settings only apply to OpenViking memory spaces");
		const nativeProvider = this.isNative(current.providerId);
		if ((request.connection !== void 0 || request.clearSecrets !== void 0) && nativeProvider) throw new Error("Mnemon Native memory spaces do not have provider connection settings");
		const legacyPatch = request.openViking === void 0 ? void 0 : {
			...request.openViking,
			...request.openViking.clearApiKey === true ? { apiKey: "" } : {}
		};
		const previousConnection = nativeProvider ? {} : current.connection ?? {};
		const connectionPatch = request.connection ?? legacyPatch;
		let connection;
		if (!nativeProvider) {
			const split = this.providerCatalog.split(current.providerId, connectionPatch);
			const clearSecrets = [...request.clearSecrets ?? [], ...request.openViking?.clearApiKey === true ? ["apiKey"] : []];
			if (Object.keys(split.service).length > 0 || clearSecrets.length > 0) {
				this.services[current.providerId] = this.providerCatalog.normalizeService(current.providerId, split.service, this.services[current.providerId] ?? {}, clearSecrets);
				this.serviceEnabled[current.providerId] = true;
			}
			if (!this.providerServiceEnabled(current.providerId)) throw new Error(`${this.providerCatalog.descriptor(current.providerId).label} service is not enabled; enable it in Settings first`);
			connection = this.providerCatalog.normalizeMemory(current.providerId, split.memory, previousConnection);
			this.providerCatalog.normalize(current.providerId, {
				...this.services[current.providerId],
				...connection
			});
		}
		const { openViking: _legacyOpenViking, ...currentBody } = current;
		const body = {
			...currentBody,
			...request.name === void 0 ? {} : { name: requiredText(request.name, "name", 100) },
			...request.description === void 0 ? {} : { description: optionalText$1(request.description, "description", 1e3) },
			...request.active === void 0 ? {} : { active: request.active },
			...nativeProvider || request.name === void 0 && request.description === void 0 ? {} : { metadataSource: "manual" },
			...connection === void 0 ? {} : { connection },
			updatedAt: this.nextTimestamp(current.updatedAt)
		};
		this.spaces[index] = body;
		this.save();
		return this.view(body);
	}
	/** Validate every model-authored update before committing the batch. */
	updateMetadata(updates) {
		this.refreshIfChanged();
		if (updates.length === 0 || updates.length > 20) throw new Error("metadata maintenance requires 1 through 20 Memory Spaces");
		const seen = /* @__PURE__ */ new Set();
		const replacements = updates.map((update) => {
			const id = validateMemorySpaceId(update.memoryBodyId);
			if (seen.has(id)) throw new Error(`duplicate metadata update: ${id}`);
			seen.add(id);
			const index = this.spaces.findIndex((body) => body.id === id);
			if (index < 0) throw new Error(`unknown memory space: ${id}`);
			return {
				index,
				body: {
					...this.spaces[index],
					name: requiredText(update.title, "title", 48),
					description: requiredText(update.description, "description", 200),
					metadataSource: "ai",
					updatedAt: this.nextTimestamp(this.spaces[index].updatedAt)
				}
			};
		});
		for (const replacement of replacements) this.spaces[replacement.index] = replacement.body;
		this.save();
		return replacements.map((replacement) => this.view(replacement.body));
	}
	async remove(id, signal) {
		const body = this.get(id);
		if (!this.isNative(body.provider.id)) {
			this.spaces = this.spaces.filter((entry) => entry.id !== body.id);
			this.save();
			return body;
		}
		const nativeStoreIds = this.nativeStoreIds();
		if (nativeStoreIds.includes(body.id) && nativeStoreIds.length === 1) throw new Error(`cannot delete the last Mnemon Store "${body.id}"; disable it for DSH or create another Memory Space first`);
		const persistedStore = this.runner.persistedStore();
		const commands = [];
		let commandStore = persistedStore;
		if (persistedStore === body.id) {
			const nativeIds = new Set(nativeStoreIds);
			const replacement = this.list().filter((candidate) => candidate.id !== body.id && nativeIds.has(candidate.id)).sort((left, right) => Number(right.active) - Number(left.active) || left.id.localeCompare(right.id))[0]?.id ?? nativeStoreIds.filter((candidate) => candidate !== body.id).sort()[0];
			if (replacement === void 0) throw new Error(`cannot switch away from Mnemon Store "${body.id}" before deleting it`);
			commandStore = replacement;
			commands.push({
				args: [
					"store",
					"set",
					replacement
				],
				options: {
					...signal === void 0 ? {} : { signal },
					store: replacement
				}
			});
		}
		commands.push({
			args: [
				"store",
				"remove",
				body.id
			],
			options: {
				...signal === void 0 ? {} : { signal },
				store: commandStore
			}
		});
		await this.runner.runTextBatch(commands);
		this.spaces = this.spaces.filter((entry) => entry.id !== body.id);
		this.save();
		return body;
	}
	setActive(id, active) {
		return this.update(id, { active });
	}
	/** Advance the safe catalog checkpoint after provider-backed content changes. */
	touch(id) {
		const normalized = validateMemorySpaceId(id);
		const index = this.spaces.findIndex((body) => body.id === normalized);
		if (index < 0) throw new Error(`unknown memory space: ${normalized}`);
		const body = {
			...this.spaces[index],
			updatedAt: this.nextTimestamp(this.spaces[index].updatedAt)
		};
		this.spaces[index] = body;
		this.save();
		return this.view(body);
	}
	/** Refresh metadata after an atomic Pack import replaced the data component. */
	reload() {
		this.refreshing = true;
		try {
			this.spaces = [];
			this.services = {};
			this.serviceEnabled = {};
			this.loadAndReconcile();
			this.state.diskRevision = this.diskRevision();
		} finally {
			this.refreshing = false;
		}
	}
	diskRevision() {
		if (!this.persistent) return "ephemeral";
		return [this.registryPath, this.providerRegistryPath].map((path) => {
			try {
				const stat = statSync(path, { bigint: true });
				return `${stat.ino}:${stat.mtimeNs}:${stat.size}`;
			} catch (error) {
				if (error.code === "ENOENT") return "missing";
				throw error;
			}
		}).join("/");
	}
	/** Separate generations and legacy facades observe the same durable authority. */
	refreshIfChanged() {
		if (!this.refreshing && this.persistent && this.state.diskRevision !== this.diskRevision()) this.reload();
	}
	loadAndReconcile() {
		let migratedSyntheticDefault = false;
		let migratedProviderRegistry = false;
		if (this.persistent && existsSync(this.registryPath)) try {
			const parsed = JSON.parse(readFileSync(this.registryPath, "utf8"));
			if ((parsed.version === NATIVE_REGISTRY_VERSION || parsed.version === 2) && Array.isArray(parsed.bodies)) {
				migratedProviderRegistry = parsed.version === 2;
				this.spaces = parsed.bodies.filter((body) => ID_PATTERN.test(body.id)).map((body) => {
					const syntheticDefault = body.id === "default" && body.name === "默认记忆体" && body.description === "从现有 Mnemon Store 自动接入。";
					migratedSyntheticDefault ||= syntheticDefault;
					const providerId = "providerId" in body && storedProviderId(body.providerId) ? body.providerId : "mnemon-native";
					if (!this.providerCatalog.has(providerId)) return {
						id: body.id,
						name: requiredText(body.name || body.id, "name", 100),
						description: optionalText$1(body.description, "description", 1e3),
						active: body.active === true,
						providerId,
						connection: storedProviderConnection("connection" in body ? body.connection : void 0),
						createdAt: body.createdAt,
						updatedAt: body.updatedAt
					};
					const placement = "placement" in body ? normalizePlacementDecision(body.placement, providerId, this.providerCatalog) : void 0;
					const rawConnection = "connection" in body && body.connection != null ? body.connection : this.providerTypeId(providerId) === "openviking" && "openViking" in body && body.openViking != null ? body.openViking : void 0;
					const split = this.isNative(providerId) ? void 0 : this.providerCatalog.split(providerId, rawConnection);
					if (split !== void 0 && this.services[providerId] === void 0) {
						this.services[providerId] = this.providerCatalog.normalizeService(providerId, split.service);
						this.serviceEnabled[providerId] = true;
					}
					const connection = split === void 0 ? void 0 : this.providerCatalog.normalizeMemory(providerId, split.memory);
					if (connection !== void 0) this.providerCatalog.normalize(providerId, {
						...this.services[providerId],
						...connection
					});
					return {
						id: body.id,
						name: requiredText(syntheticDefault ? body.id : body.name || body.id, "name", 100),
						description: optionalText$1(syntheticDefault ? "Existing Mnemon Store discovered on disk." : body.description, "description", 1e3),
						active: body.active === true,
						providerId,
						...placement === void 0 ? {} : { placement },
						...connection === void 0 ? {} : { connection },
						createdAt: body.createdAt,
						updatedAt: body.updatedAt
					};
				});
			}
		} catch {
			this.spaces = [];
		}
		if (this.persistent && existsSync(this.providerRegistryPath)) try {
			const parsed = JSON.parse(readFileSync(this.providerRegistryPath, "utf8"));
			if ((parsed.version === 3 || parsed.version === PROVIDER_REGISTRY_VERSION) && typeof parsed.services === "object" && parsed.services !== null) for (const [providerId, settings] of Object.entries(parsed.services)) {
				if (!storedProviderId(providerId) || typeof settings !== "object" || settings === null) continue;
				if (this.providerCatalog.has(providerId) && this.isNative(providerId)) continue;
				this.services[providerId] = this.providerCatalog.has(providerId) ? this.providerCatalog.normalizeService(providerId, settings) : storedProviderConnection(settings);
				this.serviceEnabled[providerId] = parsed.enabled === void 0 ? true : parsed.enabled[providerId] === true;
			}
			if ((parsed.version === 1 || parsed.version === 2 || parsed.version === 3 || parsed.version === PROVIDER_REGISTRY_VERSION) && Array.isArray(parsed.bodies)) {
				migratedProviderRegistry ||= parsed.version !== PROVIDER_REGISTRY_VERSION;
				const existingIds = new Set(this.spaces.map((body) => body.id));
				this.spaces.push(...parsed.bodies.filter((body) => storedProviderId(body.providerId) && (!this.providerCatalog.has(body.providerId) || !this.isNative(body.providerId)) && ID_PATTERN.test(body.id) && !existingIds.has(body.id)).map((body) => {
					const providerId = body.providerId;
					if (!this.providerCatalog.has(providerId)) return {
						id: body.id,
						name: requiredText(body.name || body.id, "name", 100),
						description: optionalText$1(body.description, "description", 1e3),
						active: body.active === true,
						providerId,
						...typeof body.externalId !== "string" || body.externalId.trim() === "" ? {} : { externalId: body.externalId.trim() },
						...body.metadataSource === "provider" || body.metadataSource === "manual" || body.metadataSource === "ai" ? { metadataSource: body.metadataSource } : {},
						connection: storedProviderConnection(body.connection ?? body.openViking),
						createdAt: body.createdAt,
						updatedAt: body.updatedAt
					};
					const placement = normalizePlacementDecision(body.placement, providerId, this.providerCatalog);
					const rawConnection = body.connection ?? (this.providerTypeId(providerId) === "openviking" && body.openViking !== void 0 ? body.openViking : void 0);
					const split = parsed.version === 3 || parsed.version === PROVIDER_REGISTRY_VERSION ? {
						service: {},
						memory: rawConnection ?? {}
					} : this.providerCatalog.split(providerId, rawConnection);
					if (parsed.version !== 3 && parsed.version !== PROVIDER_REGISTRY_VERSION && this.services[providerId] === void 0) {
						this.services[providerId] = this.providerCatalog.normalizeService(providerId, split.service);
						this.serviceEnabled[providerId] = true;
					}
					const connection = this.providerCatalog.normalizeMemory(providerId, split.memory);
					this.providerCatalog.normalize(providerId, {
						...this.services[providerId],
						...connection
					});
					return {
						id: body.id,
						name: requiredText(body.name || body.id, "name", 100),
						description: optionalText$1(body.description, "description", 1e3),
						active: body.active === true,
						providerId,
						...typeof body.externalId !== "string" || body.externalId.trim() === "" ? {} : { externalId: body.externalId.trim() },
						...body.metadataSource === "provider" || body.metadataSource === "manual" || body.metadataSource === "ai" ? { metadataSource: body.metadataSource } : {},
						...placement === void 0 ? {} : { placement },
						connection,
						createdAt: body.createdAt,
						updatedAt: body.updatedAt
					};
				}));
			}
		} catch {}
		const retainedBodies = this.spaces.filter((body) => !this.providerCatalog.has(body.providerId) || this.isNative(body.providerId) || this.providerServiceEnabled(body.providerId));
		if (retainedBodies.length !== this.spaces.length) {
			this.spaces = retainedBodies;
			migratedProviderRegistry = true;
		}
		this.reconcileDiscoveredStores();
		if (migratedSyntheticDefault || migratedProviderRegistry) this.save();
	}
	reconcileDiscoveredStores() {
		if (!this.persistent || !existsSync(this.directory)) return;
		const timestamp = this.now().toISOString();
		const legacyActive = this.runner.effectiveStore();
		let changed = false;
		for (const entry of readdirSync(this.directory, { withFileTypes: true })) {
			if (!entry.isDirectory() || !ID_PATTERN.test(entry.name) || !existsSync(join(this.directory, entry.name, "mnemon.db"))) continue;
			if (this.spaces.some((body) => body.id === entry.name)) continue;
			this.spaces.push({
				id: entry.name,
				name: entry.name,
				description: "Existing Mnemon Store discovered on disk.",
				active: this.spaces.length === 0 || entry.name === legacyActive,
				providerId: "mnemon-native",
				createdAt: timestamp,
				updatedAt: timestamp
			});
			changed = true;
		}
		if (changed) this.save();
	}
	nativeStoreIds() {
		if (!existsSync(this.directory)) return [];
		return readdirSync(this.directory, { withFileTypes: true }).filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name)).map((entry) => entry.name).sort();
	}
	nextTimestamp(previous, candidate = this.now().toISOString()) {
		if (previous === void 0) return candidate;
		const previousTime = Date.parse(previous);
		const candidateTime = Date.parse(candidate);
		if (!Number.isFinite(previousTime) || !Number.isFinite(candidateTime) || candidateTime > previousTime) return candidate;
		return new Date(previousTime + 1).toISOString();
	}
	view(body) {
		const descriptor = this.providerCatalog.descriptor(body.providerId);
		const nativeProvider = this.isNative(body.providerId);
		const connection = nativeProvider ? {} : this.connectionFor(body);
		const effectivePublicConnection = this.providerCatalog.public(body.providerId, connection);
		const publicConnection = nativeProvider ? effectivePublicConnection : this.providerCatalog.publicScoped(body.providerId, "memory", body.connection ?? {});
		const location = nativeProvider ? join(this.directory, body.id, "mnemon.db") : providerDisplayLocation(descriptor, connection);
		const provider = {
			id: descriptor.id,
			...descriptor.typeId === void 0 || descriptor.typeId === descriptor.id ? {} : { typeId: descriptor.typeId },
			label: descriptor.label,
			...descriptor.icon === void 0 ? {} : { icon: descriptor.icon },
			origin: descriptor.origin,
			kind: descriptor.kind,
			location,
			...typeof connection.targetUri === "string" && connection.targetUri !== "" ? { targetUri: connection.targetUri } : {},
			...typeof connection.account === "string" && connection.account !== "" ? { account: connection.account } : {},
			...typeof connection.user === "string" && connection.user !== "" ? { user: connection.user } : {},
			...typeof connection.actorPeerId === "string" && connection.actorPeerId !== "" ? { actorPeerId: connection.actorPeerId } : {},
			apiKeyConfigured: effectivePublicConnection.configuredSecrets.includes("apiKey"),
			...publicConnection,
			capabilities: descriptor.capabilities
		};
		const { providerId: _providerId, externalId: _externalId, metadataSource: _metadataSource, connection: _connection, openViking: _openViking, ...metadata } = body;
		return {
			...metadata,
			dbPath: nativeProvider ? provider.location : "",
			provider
		};
	}
	save() {
		if (!this.persistent) return;
		mkdirSync(this.directory, {
			recursive: true,
			mode: 448
		});
		const nativeBodies = this.spaces.filter((body) => body.providerId === "mnemon-native" || this.providerCatalog.has(body.providerId) && this.isNative(body.providerId)).map(({ providerId: _providerId, connection: _connection, openViking: _openViking, ...body }) => body);
		this.writeRegistry(this.registryPath, {
			version: NATIVE_REGISTRY_VERSION,
			bodies: nativeBodies
		});
		const providerBodies = this.spaces.filter((body) => body.providerId !== "mnemon-native" && (!this.providerCatalog.has(body.providerId) || !this.isNative(body.providerId)));
		if (providerBodies.length === 0 && Object.keys(this.services).length === 0) {
			rmSync(this.providerRegistryPath, { force: true });
			this.state.diskRevision = this.diskRevision();
			return;
		}
		mkdirSync(join(this.runner.effectiveDataDir(), "state"), {
			recursive: true,
			mode: 448
		});
		this.writeRegistry(this.providerRegistryPath, {
			version: PROVIDER_REGISTRY_VERSION,
			services: this.services,
			enabled: this.serviceEnabled,
			bodies: providerBodies
		});
		this.state.diskRevision = this.diskRevision();
	}
	writeRegistry(path, file) {
		const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
		writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, {
			encoding: "utf8",
			mode: 384
		});
		renameSync(temporary, path);
	}
};
//#endregion
//#region src/provider-placement.ts
const CAPABILITY_LABELS = {
	graph: "typed graph",
	entities: "entity index",
	related: "related-memory traversal",
	"exact-write": "exact writes",
	link: "explicit links",
	forget: "safe forget"
};
const CAPABILITIES = new Set(Object.keys(CAPABILITY_LABELS));
const PREFERENCES = /* @__PURE__ */ new Set([
	"balanced",
	"local-first",
	"shared-first"
]);
function supports(candidate, capability) {
	if (capability === "exact-write") return candidate.capabilities.writeMode === "exact";
	return candidate.capabilities[capability];
}
function boundedPrompt(value) {
	const normalized = value?.trim() ?? "";
	if (normalized.length > 4e3) throw new Error("provider placement prompt is too long (max 4000 characters)");
	return normalized;
}
function uniqueProviderIds(ids) {
	if (ids === void 0) return void 0;
	return [...new Set(ids)];
}
function prepareMemoryPlacement(request, candidates) {
	if (request.mode !== "automatic") throw new Error(`unsupported provider placement mode: ${String(request.mode)}`);
	const prompt = boundedPrompt(request.prompt);
	const rules = request.rules ?? {};
	const allowed = uniqueProviderIds(rules.allowedProviderIds);
	const required = [...new Set(rules.requiredCapabilities ?? [])];
	const candidateIds = new Set(candidates.map((candidate) => candidate.id));
	for (const providerId of allowed ?? []) if (!candidateIds.has(providerId)) throw new Error(`unsupported memory provider in placement rules: ${String(providerId)}`);
	if (rules.dataBoundary !== void 0 && rules.dataBoundary !== "allow-remote" && rules.dataBoundary !== "local-only") throw new Error(`unsupported data boundary: ${String(rules.dataBoundary)}`);
	for (const capability of required) if (!CAPABILITIES.has(capability)) throw new Error(`unsupported required memory capability: ${String(capability)}`);
	if (rules.preference !== void 0 && !PREFERENCES.has(rules.preference)) throw new Error(`unsupported provider placement preference: ${String(rules.preference)}`);
	const appliedRules = [];
	let eligible = candidates.filter((candidate) => candidate.configured);
	if (allowed !== void 0) {
		if (allowed.length === 0) throw new Error("automatic provider placement requires at least one allowed provider");
		eligible = eligible.filter((candidate) => allowed.includes(candidate.id));
		appliedRules.push(`allowed:${allowed.join(",")}`);
	}
	if (rules.dataBoundary === "local-only") {
		eligible = eligible.filter((candidate) => candidate.kind === "local");
		appliedRules.push("data-boundary:local-only");
	}
	for (const capability of required) {
		eligible = eligible.filter((candidate) => supports(candidate, capability));
		appliedRules.push(`requires:${capability}`);
	}
	const preference = rules.preference ?? "balanced";
	appliedRules.push(`preference:${preference}`);
	if (eligible.length === 0) {
		const requirements = required.map((value) => CAPABILITY_LABELS[value]).join(", ");
		throw new Error(`no configured memory provider satisfies the placement rules${requirements === "" ? "" : ` (${requirements})`}`);
	}
	const selectorBrief = [
		`Soft preference: ${preference}.`,
		"Eligible providers after host-enforced rules:",
		...eligible.map((candidate) => {
			const capabilities = [
				...Object.entries(candidate.capabilities).filter(([key, value]) => typeof value === "boolean" && value).map(([key]) => key),
				`writeMode=${candidate.capabilities.writeMode}`,
				`deletionMode=${candidate.capabilities.deletionMode}`
			];
			return `- ${candidate.id} (${candidate.label}, ${candidate.kind}): ${candidate.summary} Capabilities: ${capabilities.join(", ")}.`;
		})
	].join("\n");
	return {
		prompt,
		candidates: eligible,
		appliedRules,
		selectorBrief
	};
}
function rulesOnlyPlacement(prepared, now = () => /* @__PURE__ */ new Date()) {
	const candidate = prepared.candidates.length === 1 ? prepared.candidates[0] : void 0;
	if (candidate === void 0) return void 0;
	return {
		mode: "automatic",
		providerId: candidate.id,
		decidedBy: "rules",
		reason: `Only ${candidate.label} satisfies the configured placement rules.`,
		confidence: "high",
		candidateProviderIds: [candidate.id],
		appliedRules: prepared.appliedRules,
		decidedAt: now().toISOString()
	};
}
function finalizeLlmPlacement(prepared, selection, delegation, now = () => /* @__PURE__ */ new Date()) {
	const providerId = selection.providerId.trim();
	if (!prepared.candidates.some((candidate) => candidate.id === providerId)) throw new Error(`memory placement model selected an ineligible provider: ${selection.providerId}`);
	const reason = selection.reason.trim();
	if (reason === "") throw new Error("memory placement model returned no reason");
	if (reason.length > 1e3) throw new Error("memory placement reason is too long (max 1000 characters)");
	const confidence = selection.confidence.trim();
	if (confidence !== "high" && confidence !== "medium" && confidence !== "low") throw new Error(`memory placement model returned invalid confidence: ${selection.confidence}`);
	return {
		mode: "automatic",
		providerId,
		decidedBy: "llm",
		reason,
		confidence,
		candidateProviderIds: prepared.candidates.map((candidate) => candidate.id),
		appliedRules: prepared.appliedRules,
		decidedAt: now().toISOString(),
		runId: delegation.runId,
		subagentProvider: delegation.provider
	};
}
//#endregion
//#region src/search-tokens.ts
/** Memory Spaces lexical fallback; no Core dependency. */
/** Small deterministic tokenizer shared by local Document and Native recovery. */
function lexicalSearchTokens(value, maximum = 64) {
	const normalized = value.normalize("NFKC").toLocaleLowerCase();
	const tokens = [];
	for (const segment of normalized.split(/(\p{Script=Han}+)/gu)) {
		if (/^\p{Script=Han}+$/u.test(segment)) {
			const characters = [...segment];
			if (characters.length <= 2) tokens.push(segment);
			else for (let index = 0; index < characters.length - 1; index += 1) tokens.push(`${characters[index]}${characters[index + 1]}`);
			continue;
		}
		tokens.push(...(segment.match(/[\p{L}\p{N}_-]+/gu) ?? []).filter((token) => token.length >= 2));
	}
	return [...new Set(tokens)].slice(0, maximum);
}
function lexicalTokenMatchCount(value, tokens) {
	const available = new Set(lexicalSearchTokens(value, 512));
	return tokens.filter((token) => available.has(token)).length;
}
/** Require broader coverage only after a query is focused enough to support it. */
function lexicalRequiredMatchCount(tokens) {
	if (tokens.length === 0) return 0;
	if (tokens.length < 4) return 1;
	return Math.max(2, Math.ceil(tokens.length / 4));
}
//#endregion
//#region src/recall-quality/policies.ts
function expandedLimit(context) {
	return Math.min(50, Math.max(context.requestedLimit, Math.ceil(context.requestedLimit * context.config.candidateMultiplier)));
}
function scoreDecision(candidate, context, lowScoreAction, nonPositiveAction) {
	const score = candidate.insight.score;
	if (score === void 0) return {
		action: "keep",
		tier: "unknown",
		reason: "unscored"
	};
	if (!Number.isFinite(score)) return {
		action: "drop",
		tier: "unknown",
		reason: "invalid-score"
	};
	if (candidate.scoreSemantics?.kind !== "normalized-relevance") return {
		action: "keep",
		tier: "unknown",
		reason: "unscaled-score"
	};
	if (score <= 0) return {
		action: nonPositiveAction,
		tier: "low",
		reason: "non-positive-score",
		normalizedScore: 0
	};
	if (score > 1) return {
		action: "keep",
		tier: "unknown",
		reason: "unscaled-score"
	};
	if (score < context.config.lowScoreThreshold) return {
		action: lowScoreAction,
		tier: "low",
		reason: "low-score",
		normalizedScore: score
	};
	if (score < context.config.highScoreThreshold) return {
		action: "keep",
		tier: "medium",
		reason: "medium-score",
		normalizedScore: score
	};
	return {
		action: "keep",
		tier: "high",
		reason: "high-score",
		normalizedScore: score
	};
}
function primarySelection(candidates, context) {
	return candidates.filter((candidate) => candidate.decision.action === "keep").slice(0, context.requestedLimit);
}
const STRICT_RECALL_QUALITY_POLICY = {
	id: "strict-v1",
	candidateLimit: expandedLimit,
	evaluate: (candidate, context) => scoreDecision(candidate, context, "drop", "drop"),
	select(candidates, context) {
		const kept = candidates.filter((candidate) => candidate.decision.action === "keep");
		return [
			...kept.filter((candidate) => candidate.decision.tier === "high"),
			...kept.filter((candidate) => candidate.decision.tier === "medium").slice(0, context.config.maxMediumResults),
			...kept.filter((candidate) => candidate.decision.tier === "unknown").slice(0, context.config.maxUnknownResults)
		].slice(0, context.requestedLimit);
	}
};
const BUILTIN_RECALL_QUALITY_POLICIES = [
	STRICT_RECALL_QUALITY_POLICY,
	{
		id: "balanced-v1",
		candidateLimit: expandedLimit,
		evaluate: (candidate, context) => scoreDecision(candidate, context, "keep", "drop"),
		select(candidates, context) {
			const kept = candidates.filter((candidate) => candidate.decision.action === "keep");
			return [...kept.filter((candidate) => candidate.decision.tier !== "low"), ...kept.filter((candidate) => candidate.decision.tier === "low")].slice(0, context.requestedLimit);
		}
	},
	{
		id: "exhaustive-v1",
		candidateLimit: expandedLimit,
		evaluate: (candidate, context) => scoreDecision(candidate, context, "keep", "keep"),
		select: primarySelection
	}
];
//#endregion
//#region src/recall-quality/engine.ts
const ACTIONS = /* @__PURE__ */ new Set(["keep", "drop"]);
const TIERS = /* @__PURE__ */ new Set([
	"high",
	"medium",
	"low",
	"unknown"
]);
const REASONS = /* @__PURE__ */ new Set([
	"high-score",
	"medium-score",
	"low-score",
	"non-positive-score",
	"invalid-score",
	"unscaled-score",
	"unscored"
]);
function assertDecision(decision) {
	if (typeof decision !== "object" || decision === null || !ACTIONS.has(decision.action) || !TIERS.has(decision.tier) || !REASONS.has(decision.reason)) throw new Error("recall quality policy returned an invalid decision");
	if (decision.normalizedScore !== void 0 && (!Number.isFinite(decision.normalizedScore) || decision.normalizedScore < 0 || decision.normalizedScore > 1)) throw new Error("recall quality policy returned an invalid normalized score");
}
function runPolicy(policy, candidates, context) {
	const evaluated = candidates.map((candidate) => {
		const decision = policy.evaluate(candidate, context);
		assertDecision(decision);
		return {
			candidate,
			decision
		};
	});
	const eligible = new Set(evaluated.filter((candidate) => candidate.decision.action === "keep"));
	const selected = policy.select(evaluated, context);
	if (!Array.isArray(selected) || selected.length > context.requestedLimit) throw new Error("recall quality policy returned too many results");
	const seen = /* @__PURE__ */ new Set();
	for (const candidate of selected) {
		if (!eligible.has(candidate) || seen.has(candidate)) throw new Error("recall quality policy selected an ineligible or duplicate result");
		seen.add(candidate);
	}
	return {
		evaluated,
		selected
	};
}
function prepareRecallQualityPolicy(policy, context, fallback = STRICT_RECALL_QUALITY_POLICY) {
	try {
		const candidateLimit = policy.candidateLimit(context);
		if (!Number.isInteger(candidateLimit) || candidateLimit < context.requestedLimit || candidateLimit > 50) throw new Error("invalid candidate limit");
		return {
			policy,
			candidateLimit
		};
	} catch {
		if (policy === fallback) throw new Error(`recall quality policy ${policy.id} returned an invalid candidate limit`);
		return {
			policy: fallback,
			candidateLimit: fallback.candidateLimit(context),
			fallbackFrom: policy.id
		};
	}
}
function applyRecallQualityPolicy(prepared, candidates, context, fallback = STRICT_RECALL_QUALITY_POLICY) {
	try {
		return {
			policyId: prepared.policy.id,
			...runPolicy(prepared.policy, candidates, context),
			...prepared.fallbackFrom === void 0 ? {} : { fallbackFrom: prepared.fallbackFrom }
		};
	} catch {
		if (prepared.policy === fallback) throw new Error(`recall quality policy ${prepared.policy.id} failed`);
		return {
			policyId: fallback.id,
			fallbackFrom: prepared.policy.id,
			...runPolicy(fallback, candidates, context)
		};
	}
}
//#endregion
//#region src/recall-quality/registry.ts
var RecallQualityPolicyRegistry = class {
	policies = /* @__PURE__ */ new Map();
	constructor(policies = BUILTIN_RECALL_QUALITY_POLICIES) {
		for (const policy of policies) this.register(policy);
	}
	register(policy) {
		const id = policy.id.trim();
		if (!/^[a-z][a-z0-9-]{0,63}$/u.test(id)) throw new Error("recall quality policy id must match [a-z][a-z0-9-]{0,63}");
		if (this.policies.has(id)) throw new Error(`recall quality policy is already registered: ${id}`);
		this.policies.set(id, policy);
		return () => {
			if (this.policies.get(id) === policy) this.policies.delete(id);
		};
	}
	resolve(id) {
		const policy = this.policies.get(id);
		if (policy === void 0) throw new Error(`unknown recall quality policy: ${id}`);
		return policy;
	}
	ids() {
		return [...this.policies.keys()];
	}
};
const recallQualityPolicies = new RecallQualityPolicyRegistry();
//#endregion
//#region src/service.ts
/**
* Providers whose native search is a single bounded request while their browse
* projection fans out to multiple resources or collections. Prefer search for
* metadata sampling so AI maintenance never pays for a detailed projection.
*/
const METADATA_SEARCH_FIRST_PROVIDERS = /* @__PURE__ */ new Set([
	"openviking",
	"supermemory",
	"byterover"
]);
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function text(value) {
	return typeof value === "string" ? value : void 0;
}
function number(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function readSource(body, mode, status, itemCount, options = {}) {
	return {
		memoryBodyId: body.id,
		memoryBodyName: body.name,
		providerId: body.provider.id,
		providerLabel: body.provider.label,
		mode,
		status,
		itemCount,
		...options
	};
}
const MAX_EXACT_SEARCH_ANCHORS = 8;
const EXACT_SEARCH_ANCHOR = /(?<!\d)\d{4}-\d{1,2}-\d{1,2}(?!\d)|(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+(?![A-Za-z0-9])|(?<!\d)\d+(?:[.,]\d+)?\s*(?:[%％]|percent(?:age)?)(?![A-Za-z])|百分之\s*\d+(?:[.,]\d+)?|(?<!\d)\d{1,2}:\d{2}(?!\d)|(?<![A-Za-z0-9])v?\d+\.\d+(?:\.\d+)*(?![A-Za-z0-9])|(?<![\d.])\d+(?![\d.%％:-])/giu;
function normalizedExactText(value) {
	return value.normalize("NFKC").toLocaleLowerCase().replace(/百分之\s*(\d+(?:[.,]\d+)?)/gu, "$1%").replace(/(\d+(?:[.,]\d+)?)\s*percent(?:age)?/giu, "$1%").replace(/\s+/gu, "");
}
/**
* Extract only high-information lexical values that a semantic paraphrase
* should not be allowed to erase. This is a deterministic fallback inside an
* already-authorized search, not another Recall trigger or model decision.
*/
function exactSearchAnchorPlan(query) {
	const anchors = [...new Set([...query.matchAll(EXACT_SEARCH_ANCHOR)].map((match) => normalizedExactText(match[0])))].slice(0, MAX_EXACT_SEARCH_ANCHORS);
	if (anchors.length < 2) return void 0;
	return {
		kind: "exact",
		terms: anchors,
		query: anchors.join(" "),
		requiredMatches: Math.min(4, anchors.length)
	};
}
function lexicalSearchRecoveryPlan(query) {
	const tokens = lexicalSearchTokens(query, 32);
	if (tokens.length < 4) return void 0;
	return {
		kind: "lexical",
		terms: tokens,
		query,
		requiredMatches: lexicalRequiredMatchCount(tokens)
	};
}
function recoveryMatchCount(content, plan) {
	if (plan.kind === "lexical") return lexicalTokenMatchCount(content, plan.terms);
	const normalized = normalizedExactText(content);
	return plan.terms.filter((anchor) => normalized.includes(anchor)).length;
}
function mergeRecoveryResults(original, recovered, plan, limit) {
	const admitted = recovered.map((insight) => ({
		insight,
		matches: recoveryMatchCount(insight.content, plan)
	})).filter((candidate) => candidate.matches >= plan.requiredMatches).sort((left, right) => right.matches - left.matches || (right.insight.score ?? 0) - (left.insight.score ?? 0)).map((candidate) => candidate.insight);
	const seen = /* @__PURE__ */ new Set();
	return [...admitted, ...original].filter((insight) => {
		if (seen.has(insight.id)) return false;
		seen.add(insight.id);
		return true;
	}).slice(0, limit);
}
/** Put query-covering evidence first before the smaller model envelope runs. */
function prioritizeRecoveryEvidence(selected, plan) {
	return selected.map((entry, index) => ({
		entry,
		index,
		matches: recoveryMatchCount(entry.candidate.insight.content, plan)
	})).sort((left, right) => {
		const leftAdmitted = left.matches >= plan.requiredMatches;
		const rightAdmitted = right.matches >= plan.requiredMatches;
		if (leftAdmitted !== rightAdmitted) return rightAdmitted ? 1 : -1;
		if (leftAdmitted && left.matches !== right.matches) return right.matches - left.matches;
		return left.index - right.index;
	}).map((candidate) => candidate.entry);
}
function insightColor(category) {
	if (category === "preference") return "#9b59b6";
	if (category === "decision") return "#e74c3c";
	if (category === "fact") return "#3498db";
	if (category === "insight") return "#2ecc71";
	if (category === "context") return "#f39c12";
	return "#6574d9";
}
function boundedInteger(value, fallback, min, max) {
	if (value === void 0) return fallback;
	if (!Number.isInteger(value) || value < min || value > max) throw new Error(`value must be an integer within ${min}..${max}`);
	return value;
}
function required(value, label, max) {
	const normalized = value.trim();
	if (normalized === "") throw new Error(`${label} is required`);
	if (normalized.length > max) throw new Error(`${label} is too long (max ${max} characters)`);
	return normalized;
}
function allowed(value, values, label) {
	if (value !== void 0 && !values.includes(value)) throw new Error(`${label} must be one of: ${values.join(", ")}`);
	return value;
}
function commaList(values, label, limit) {
	if (values === void 0) return void 0;
	const normalized = values.map((value) => value.trim()).filter((value) => value !== "");
	if (normalized.length > limit) throw new Error(`${label} accepts at most ${limit} values`);
	if (normalized.some((value) => value.includes(","))) throw new Error(`${label} values cannot contain commas`);
	return normalized.length === 0 ? void 0 : normalized.join(",");
}
const COMMITTED_MUTATION_STATES = /* @__PURE__ */ new Set([
	"added",
	"committed",
	"completed",
	"created",
	"deleted",
	"forgotten",
	"imported",
	"invalidated",
	"linked",
	"merged",
	"removed",
	"replaced",
	"stored",
	"succeeded",
	"success",
	"updated"
]);
const PENDING_MUTATION_STATES = /* @__PURE__ */ new Set([
	"accepted",
	"pending",
	"processing",
	"queued",
	"running"
]);
const FAILED_MUTATION_STATES = /* @__PURE__ */ new Set([
	"canceled",
	"cancelled",
	"error",
	"failed"
]);
const COMMITTED_MUTATION_COUNTS = [
	"created",
	"deleted",
	"edges_inserted",
	"imported",
	"removed",
	"stored",
	"updated"
];
/** Source-private translation of Provider receipts; Core does not interpret Provider payloads. */
function mutationResultCompletion(result) {
	if (typeof result !== "object" || result === null || Array.isArray(result)) return "unknown";
	const value = result;
	const states = [
		value.action,
		value.status,
		value.state
	].filter((entry) => typeof entry === "string").map((entry) => entry.trim().toLocaleLowerCase());
	const changed = COMMITTED_MUTATION_COUNTS.some((key) => typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] > 0);
	const errors = Array.isArray(value.errors) ? value.errors.length > 0 : typeof value.errors === "number" && value.errors > 0;
	if (states.includes("partial") || errors && changed) return "partial";
	if (value.success === false || value.ok === false || errors || states.some((state) => FAILED_MUTATION_STATES.has(state))) return "failed";
	if (states.includes("candidate")) return "candidate";
	if (states.some((state) => PENDING_MUTATION_STATES.has(state))) return "accepted";
	if (value.committed === false || value.durable === false || states.includes("skipped")) return "unknown";
	if (value.committed === true || value.durable === true || states.some((state) => COMMITTED_MUTATION_STATES.has(state)) || changed) return "committed";
	return "unknown";
}
function mutationResultCommitted(result) {
	return mutationResultCompletion(result) === "committed";
}
var MemorySpacesService = class {
	runner;
	config;
	recallQualityPolicyRegistry;
	providerCatalog;
	memorySpaces;
	/** @deprecated Use memorySpaces. Both names share the same registry authority. */
	memoryBodies;
	providers;
	recallQualityPolicy;
	spacesInFlight;
	providersDisposed = false;
	providerTypeId(providerId) {
		const catalog = this.providerCatalog;
		if (!catalog.has(providerId)) return providerId;
		const descriptor = catalog.descriptor(providerId);
		return descriptor.typeId ?? descriptor.id;
	}
	isNativeProvider(providerId) {
		return this.providerTypeId(providerId) === "mnemon-native";
	}
	isNativeSpace(body) {
		return (body.provider.typeId ?? body.provider.id) === "mnemon-native";
	}
	constructor(runner, config, memorySpaces, recallQualityPolicyRegistry = recallQualityPolicies, providerAdapterRegistry = new MemoryProviderAdapterRegistry(), providerCatalog = EMPTY_MEMORY_PROVIDER_CATALOG) {
		this.runner = runner;
		this.config = config;
		this.recallQualityPolicyRegistry = recallQualityPolicyRegistry;
		this.providerCatalog = providerCatalog;
		this.memorySpaces = memorySpaces === void 0 ? new MemorySpaceRegistry(runner, true, () => /* @__PURE__ */ new Date(), providerCatalog) : providerCatalog === EMPTY_MEMORY_PROVIDER_CATALOG ? memorySpaces : memorySpaces.withProviderCatalog(providerCatalog);
		this.memoryBodies = this.memorySpaces;
		this.recallQualityPolicy = recallQualityPolicyRegistry.resolve(config.recallQuality.policy);
		this.providers = providerAdapterRegistry.create({
			memorySpaces: this.memorySpaces,
			memoryBodies: this.memorySpaces,
			config: this.config,
			nativeRunner: this.runner
		});
	}
	/** Release clients owned by one composable Memory Spaces generation. */
	async dispose() {
		if (this.providersDisposed) return;
		this.providersDisposed = true;
		const failures = [];
		for (const provider of [...this.providers.values()].reverse()) try {
			await provider.dispose?.();
		} catch (error) {
			failures.push(error);
		}
		this.providers.clear();
		if (failures.length > 0) throw new AggregateError(failures, "Memory Space Provider disposal failed");
	}
	async spaces(signal) {
		if (signal !== void 0) return this.collectSpaces(signal);
		if (this.spacesInFlight !== void 0) return this.spacesInFlight;
		const pending = this.collectSpaces();
		this.spacesInFlight = pending;
		try {
			return await pending;
		} finally {
			if (this.spacesInFlight === pending) this.spacesInFlight = void 0;
		}
	}
	/** Coalesce simultaneous Status/Memory-page probes without caching mutations. */
	async collectSpaces(signal) {
		const directory = this.spaceDirectory();
		const items = await Promise.all(directory.items.map(async (body) => {
			let status;
			if (!(body.providerEnabled !== false)) status = {
				healthy: false,
				error: `${body.provider.label} is disabled in Settings`
			};
			else try {
				status = await this.providerFor(body).status(body, signal);
			} catch (error) {
				status = {
					healthy: false,
					error: error instanceof Error ? error.message : String(error)
				};
			}
			const { statusLoading: _statusLoading, ...metadata } = body;
			return {
				...metadata,
				...status
			};
		}));
		return {
			...directory,
			items,
			activeCount: items.filter((body) => body.active && body.providerEnabled !== false).length,
			generatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	}
	/** Return the control-plane directory without waiting for provider I/O. */
	spaceDirectory() {
		const mnemonDefaultStore = this.runner.persistedStore();
		const all = this.memorySpaces.list();
		const enabled = new Set(this.memorySpaces.providerServices().items.filter((service) => service.enabled).map((service) => service.providerId));
		const items = all.map((body) => {
			const nativeProvider = this.isNativeSpace(body);
			const providerEnabled = nativeProvider || enabled.has(body.provider.id);
			return {
				...body,
				providerEnabled,
				mnemonDefault: nativeProvider && body.id === mnemonDefaultStore,
				healthy: false,
				statusLoading: true
			};
		});
		return {
			items,
			providers: this.providerCatalog.providers.map((provider) => ({
				...provider,
				serviceConfigured: (provider.typeId ?? provider.id) === "mnemon-native" || enabled.has(provider.id)
			})),
			persistenceStrategy: {
				mode: this.config.persistenceStrategy.mode,
				providerId: this.config.persistenceStrategy.providerId,
				prompt: this.config.persistenceStrategy.prompt,
				rules: { ...this.config.persistenceStrategy.rules }
			},
			total: items.length,
			activeCount: items.filter((body) => body.active && body.providerEnabled !== false).length,
			directory: this.memorySpaces.directory,
			generatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
	}
	/** Stable, secret-free checkpoint for the projected Memory Space authority. */
	memoryRevision() {
		return this.memoryState().revision;
	}
	/** One local metadata observation supplies membership and its revision. */
	memoryState() {
		const all = this.memorySpaces.list();
		const serviceItems = this.memorySpaces.providerServices().items;
		const enabled = new Set(serviceItems.filter((service) => service.enabled).map((service) => service.providerId));
		const active = all.filter((body) => body.active && (this.isNativeSpace(body) || enabled.has(body.provider.id))).sort((left, right) => left.id.localeCompare(right.id));
		const spaces = [...all].sort((left, right) => left.id.localeCompare(right.id)).map((body) => ({
			id: body.id,
			name: body.name,
			description: body.description,
			active: body.active,
			providerId: body.provider.id,
			updatedAt: body.updatedAt,
			capabilities: body.provider.capabilities
		}));
		const services = serviceItems.map((service) => ({
			providerId: service.providerId,
			enabled: service.enabled,
			configured: service.configured
		})).sort((left, right) => left.providerId.localeCompare(right.providerId));
		return {
			all,
			active,
			revision: createHash("sha256").update(JSON.stringify({
				bodies: spaces,
				services
			})).digest("hex")
		};
	}
	/** Return a usable system snapshot without waiting for any Provider I/O. */
	statusSummary() {
		const catalog = this.spaceDirectory();
		const dshActiveStores = catalog.items.filter((body) => body.active && body.providerEnabled !== false).map((body) => body.id);
		const providerServices = this.memorySpaces.providerServices().items.map((service) => {
			const descriptor = this.providerCatalog.descriptor(service.providerId);
			const spaces = catalog.items.filter((body) => body.provider.id === service.providerId);
			const activeSpaces = spaces.filter((body) => body.active && body.providerEnabled !== false);
			return {
				providerId: service.providerId,
				label: descriptor.label,
				...descriptor.icon === void 0 ? {} : { icon: descriptor.icon },
				enabled: service.enabled,
				configured: service.configured,
				status: !service.enabled ? "disabled" : "idle",
				memoryBodyCount: spaces.length,
				activeMemoryBodyCount: activeSpaces.length
			};
		});
		return {
			healthy: true,
			cliPath: this.runner.command,
			commandFound: this.runner.commandFound,
			dataDir: this.runner.effectiveDataDir(),
			store: dshActiveStores.join(", ") || "none",
			mnemonDefaultStore: this.runner.persistedStore(),
			dshActiveStores,
			writeEnabled: this.config.writeEnabled,
			timeoutMs: this.config.timeoutMs,
			defaultRecallLimit: this.config.defaultRecallLimit,
			recallQuality: this.config.recallQuality,
			memoryBodyDirectory: catalog.directory,
			memoryBodies: catalog.items,
			providerServices
		};
	}
	/** Probe the effective Mnemon embedding runtime and its default Store coverage. */
	async embeddingStatus(signal) {
		const output = record(await this.runner.runJson(["embed", "--status"], signal === void 0 ? {} : { signal }));
		const available = output?.embedding_available ?? output?.ollama_available;
		const model = text(output?.model)?.trim();
		const protocol = text(output?.protocol)?.trim();
		const totalInsights = number(output?.total_insights);
		const embedded = number(output?.embedded);
		const coverage = text(output?.coverage)?.trim();
		if (typeof available !== "boolean" || model === void 0 || model === "" || model.length > 200 || /[\u0000-\u001f\u007f]/u.test(model) || !Number.isInteger(totalInsights) || totalInsights < 0 || !Number.isInteger(embedded) || embedded < 0 || embedded > totalInsights || coverage === void 0 || !/^(?:100|\d{1,2})%$/u.test(coverage)) throw new Error("mnemon embed --status returned an invalid response");
		return {
			available,
			model,
			totalInsights,
			embedded,
			coverage,
			...protocol !== void 0 && protocol.length <= 32 && !/[\u0000-\u001f\u007f]/u.test(protocol) ? { protocol } : {}
		};
	}
	async status(signal) {
		const hasNativeSpace = this.memorySpaces.list().some((body) => this.isNativeSpace(body));
		let versionError;
		const [catalog, rawVersion] = await Promise.all([this.spaces(signal), hasNativeSpace ? this.runner.runText(["--version"], signal === void 0 ? { globalFlags: false } : {
			signal,
			globalFlags: false
		}).catch((error) => {
			versionError = error;
		}) : Promise.resolve(void 0)]);
		const active = catalog.items.filter((body) => body.active && body.providerEnabled !== false);
		const dshActiveStores = active.map((body) => body.id);
		const providerServices = this.memorySpaces.providerServices().items.map((service) => {
			const descriptor = this.providerCatalog.descriptor(service.providerId);
			const spaces = catalog.items.filter((body) => body.provider.id === service.providerId);
			const activeSpaces = spaces.filter((body) => body.active && body.providerEnabled !== false);
			const failed = activeSpaces.filter((body) => !body.healthy);
			const status = !service.enabled ? "disabled" : activeSpaces.length === 0 ? "idle" : failed.length === 0 ? "healthy" : "unhealthy";
			return {
				providerId: service.providerId,
				label: descriptor.label,
				...descriptor.icon === void 0 ? {} : { icon: descriptor.icon },
				enabled: service.enabled,
				configured: service.configured,
				status,
				memoryBodyCount: spaces.length,
				activeMemoryBodyCount: activeSpaces.length,
				...failed.length === 0 ? {} : { error: failed.map((body) => `${body.name}: ${body.error ?? "unavailable"}`).join("; ") }
			};
		});
		const base = {
			cliPath: this.runner.command,
			commandFound: this.runner.commandFound,
			dataDir: this.runner.effectiveDataDir(),
			store: dshActiveStores.join(", ") || "none",
			mnemonDefaultStore: this.runner.persistedStore(),
			dshActiveStores,
			writeEnabled: this.config.writeEnabled,
			timeoutMs: this.config.timeoutMs,
			defaultRecallLimit: this.config.defaultRecallLimit,
			recallQuality: this.config.recallQuality,
			memoryBodyDirectory: catalog.directory,
			memoryBodies: catalog.items,
			providerServices
		};
		try {
			if (versionError !== void 0) throw versionError;
			const healthySpaces = active.filter((body) => body.healthy && body.stats !== void 0);
			const topEntities = /* @__PURE__ */ new Map();
			const byCategory = {};
			for (const body of healthySpaces) {
				for (const [category, count] of Object.entries(body.stats.byCategory)) byCategory[category] = (byCategory[category] ?? 0) + count;
				for (const entity of body.stats.topEntities) topEntities.set(entity.entity, (topEntities.get(entity.entity) ?? 0) + entity.count);
			}
			const stats = {
				totalInsights: healthySpaces.reduce((total, body) => total + body.stats.totalInsights, 0),
				deletedInsights: healthySpaces.reduce((total, body) => total + body.stats.deletedInsights, 0),
				edgeCount: healthySpaces.reduce((total, body) => total + body.stats.edgeCount, 0),
				oplogCount: healthySpaces.reduce((total, body) => total + body.stats.oplogCount, 0),
				dbSizeBytes: healthySpaces.reduce((total, body) => total + body.stats.dbSizeBytes, 0),
				byCategory,
				topEntities: [...topEntities].map(([entity, count]) => ({
					entity,
					count
				})).sort((left, right) => right.count - left.count),
				...active.length === 1 ? { dbPath: active[0].dbPath } : {}
			};
			const failed = active.filter((body) => !body.healthy);
			return {
				healthy: true,
				...base,
				...rawVersion === void 0 ? {} : { version: rawVersion.trim().replace(/^mnemon version\s+/i, "") },
				stats,
				...failed.length === 0 ? {} : { error: failed.map((body) => `${body.name}: ${body.error ?? "unavailable"}`).join("; ") }
			};
		} catch (error) {
			return {
				healthy: true,
				...base,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	async reconnectSpace(id, signal) {
		const body = this.memorySpaces.list().find((candidate) => candidate.id === id);
		if (body === void 0) throw new Error(`unknown memory space: ${id}`);
		if (!this.isNativeSpace(body)) {
			if (!this.memorySpaces.providerServiceEnabled(body.provider.id)) throw new Error(`${body.provider.label} is disabled in Settings`);
		}
		const provider = this.providerFor(body);
		provider.invalidateStatus?.(body.id);
		const status = await provider.status(body, signal);
		return {
			...body,
			providerEnabled: true,
			mnemonDefault: this.isNativeSpace(body) && body.id === this.runner.persistedStore(),
			...status
		};
	}
	async search(request, signal) {
		const query = required(request.query, "query", 2e3);
		const limit = boundedInteger(request.limit, this.config.defaultRecallLimit, 1, 50);
		const qualityContext = {
			requestedLimit: limit,
			config: this.config.recallQuality
		};
		const preparedPolicy = prepareRecallQualityPolicy(this.recallQualityPolicy, qualityContext);
		const mode = allowed(request.mode, [
			"smart",
			"keyword",
			"basic"
		], "mode") ?? "smart";
		const category = allowed(request.category, CATEGORIES$1, "category");
		const source = allowed(request.source, SOURCES$1, "source");
		const intent = allowed(request.intent, INTENTS$1, "intent");
		const spaces = this.readSpaces(request.memoryBodyIds);
		const normalizedRequest = {
			query,
			mode,
			limit: preparedPolicy.candidateLimit,
			...category === void 0 ? {} : { category },
			...source === void 0 ? {} : { source },
			...intent === void 0 ? {} : { intent }
		};
		let batches = await Promise.all(spaces.map(async (body) => {
			if (!body.provider.capabilities.search) return {
				body,
				result: {
					results: [],
					hint: "search is not supported"
				},
				source: readSource(body, "unsupported", "unsupported", 0, { hint: "This provider does not expose search." })
			};
			try {
				const result = await this.providerFor(body).search(body, normalizedRequest, signal);
				return {
					body,
					result,
					source: readSource(body, "search", result.results.length === 0 ? "empty" : "ready", result.results.length, result.hint === void 0 ? {} : { hint: result.hint })
				};
			} catch (error) {
				const hint = error instanceof Error ? error.message : String(error);
				return {
					body,
					result: {
						results: [],
						hint: `unavailable: ${hint}`
					},
					source: readSource(body, "search", "unavailable", 0, { hint })
				};
			}
		}));
		const recoveryPlan = mode === "smart" && category === void 0 && source === void 0 && intent === void 0 ? exactSearchAnchorPlan(query) ?? lexicalSearchRecoveryPlan(query) : void 0;
		const evaluate = (selectedBatches) => {
			const candidates = [];
			const hints = [];
			for (const [bodyOrder, { body, result }] of selectedBatches.entries()) {
				const scoreSemantics = this.providerFor(body).scoreSemantics;
				candidates.push(...result.results.map((entry, index) => ({
					insight: this.annotate(entry, body),
					memoryBodyId: body.id,
					providerId: body.provider.id,
					providerRank: index + 1,
					bodyOrder,
					...scoreSemantics === void 0 ? {} : { scoreSemantics }
				})));
				if (result.hint !== void 0) hints.push(`${body.name}: ${result.hint}`);
			}
			const heterogeneous = new Set(spaces.map((body) => body.provider.id)).size > 1;
			if (heterogeneous) for (const candidate of candidates) candidate.insight.federatedScore = 1 / (60 + candidate.providerRank);
			candidates.sort((left, right) => heterogeneous ? (right.insight.federatedScore ?? 0) - (left.insight.federatedScore ?? 0) || left.bodyOrder - right.bodyOrder : (right.insight.score ?? 0) - (left.insight.score ?? 0));
			return {
				hints,
				quality: applyRecallQualityPolicy(preparedPolicy, candidates, qualityContext)
			};
		};
		let evaluation = evaluate(batches);
		const hasRecoveryEvidence = recoveryPlan !== void 0 && evaluation.quality.selected.some((candidate) => recoveryMatchCount(candidate.candidate.insight.content, recoveryPlan) >= recoveryPlan.requiredMatches);
		if (recoveryPlan !== void 0 && !hasRecoveryEvidence) {
			batches = await Promise.all(batches.map(async (batch) => {
				if (!this.isNativeSpace(batch.body) || batch.source.status === "unsupported" || batch.source.status === "unavailable") return batch;
				try {
					const recovered = await this.providerFor(batch.body).search(batch.body, {
						query: recoveryPlan.query,
						mode: "keyword",
						limit: Math.min(limit, preparedPolicy.candidateLimit)
					}, signal);
					const admitted = recovered.results.some((insight) => recoveryMatchCount(insight.content, recoveryPlan) >= recoveryPlan.requiredMatches);
					const results = mergeRecoveryResults(batch.result.results, recovered.results, recoveryPlan, preparedPolicy.candidateLimit);
					return {
						...batch,
						result: {
							results,
							...admitted || batch.result.hint === void 0 ? {} : { hint: batch.result.hint }
						}
					};
				} catch {
					return batch;
				}
			}));
			evaluation = evaluate(batches);
		}
		const { hints, quality } = evaluation;
		const selected = recoveryPlan === void 0 ? quality.selected : prioritizeRecoveryEvidence(quality.selected, recoveryPlan);
		const qualityStats = (memoryBodyId) => {
			const evaluated = quality.evaluated.filter((candidate) => candidate.candidate.memoryBodyId === memoryBodyId);
			const selected = quality.selected.filter((candidate) => candidate.candidate.memoryBodyId === memoryBodyId);
			return {
				policyId: quality.policyId,
				...quality.fallbackFrom === void 0 ? {} : { fallbackFrom: quality.fallbackFrom },
				fetched: evaluated.length,
				retained: evaluated.filter((candidate) => candidate.decision.action === "keep").length,
				selected: selected.length,
				droppedLowScore: evaluated.filter((candidate) => candidate.decision.action === "drop" && candidate.decision.reason === "low-score").length,
				droppedNonPositiveScore: evaluated.filter((candidate) => candidate.decision.action === "drop" && candidate.decision.reason === "non-positive-score").length,
				droppedInvalidScore: evaluated.filter((candidate) => candidate.decision.action === "drop" && candidate.decision.reason === "invalid-score").length,
				unscored: evaluated.filter((candidate) => candidate.decision.reason === "unscored").length,
				unscaled: evaluated.filter((candidate) => candidate.decision.reason === "unscaled-score").length
			};
		};
		return {
			query,
			mode,
			results: selected.map(({ candidate, decision }) => ({
				...candidate.insight,
				relevanceTier: decision.tier,
				...decision.normalizedScore === void 0 ? {} : { normalizedScore: decision.normalizedScore }
			})),
			sources: batches.map((batch) => {
				const stats = qualityStats(batch.body.id);
				if (batch.source.status === "unavailable" || batch.source.status === "unsupported") return {
					...batch.source,
					quality: stats
				};
				return {
					...batch.source,
					status: stats.retained === 0 ? "empty" : "ready",
					itemCount: stats.retained,
					quality: stats
				};
			}),
			...hints.length === 0 ? {} : { hint: hints.join("\n") }
		};
	}
	/**
	* Read a deliberately small metadata sample through the cheapest useful path
	* exposed by the owning Provider. This avoids federated ranking, graph
	* expansion, and large browse projections before an LLM metadata pass.
	*/
	async metadataSample(memoryBodyId, signal) {
		const body = this.readSpaces([memoryBodyId])[0];
		const provider = this.providerFor(body);
		const limit = 6;
		let method;
		let items;
		if (this.isNativeSpace(body)) {
			method = "native-basic";
			items = provider.metadataSample === void 0 ? await provider.list(body, { limit }, signal) : await provider.metadataSample(body, limit, signal);
		} else if (METADATA_SEARCH_FIRST_PROVIDERS.has(body.provider.typeId ?? body.provider.id) || !body.provider.capabilities.browse) {
			method = "search";
			const query = (body.description.trim() || body.name.trim()).slice(0, 400);
			items = (await provider.search(body, {
				query,
				mode: "basic",
				limit
			}, signal)).results;
		} else {
			method = "browse";
			items = await provider.list(body, { limit }, signal);
		}
		return {
			memoryBodyId: body.id,
			name: body.name,
			description: body.description,
			providerId: body.provider.id,
			providerLabel: body.provider.label,
			method,
			evidence: items.slice(0, limit).map((item) => ({
				content: item.content.length > 720 ? `${item.content.slice(0, 719)}…` : item.content,
				...item.category === void 0 ? {} : { category: item.category },
				...item.entities === void 0 ? {} : { entities: item.entities.slice(0, 8) }
			}))
		};
	}
	async graph(signal, memoryBodyIds) {
		const spaces = this.readSpaces(memoryBodyIds);
		const nodes = [];
		const edges = [];
		const sources = [];
		const snapshots = await Promise.all(spaces.map(async (body) => {
			const mode = body.provider.capabilities.graph ? "graph" : body.provider.capabilities.browse ? "projection" : body.provider.capabilities.search ? "query-only" : "unsupported";
			if (mode === "query-only") return {
				body,
				source: readSource(body, mode, "query-required", 0, {
					edgeCount: 0,
					hint: "Use Recall to query this provider."
				})
			};
			if (mode === "unsupported") return {
				body,
				source: readSource(body, mode, "unsupported", 0, {
					edgeCount: 0,
					hint: "This provider exposes neither graph nor browse projection."
				})
			};
			try {
				const snapshot = await this.providerFor(body).graph(body, signal);
				return {
					body,
					snapshot,
					source: readSource(body, mode, snapshot.nodes.length === 0 ? "empty" : "ready", snapshot.nodes.length, { edgeCount: snapshot.edges.length })
				};
			} catch (error) {
				return {
					body,
					source: readSource(body, mode, "unavailable", 0, {
						edgeCount: 0,
						hint: error instanceof Error ? error.message : String(error)
					})
				};
			}
		}));
		for (const item of snapshots) {
			sources.push(item.source);
			if (item.snapshot === void 0) continue;
			const { body, snapshot } = item;
			const graphId = (id) => `${body.id}:${id}`;
			nodes.push(...snapshot.nodes.map((node) => ({
				...this.annotate(node, body),
				color: node.color,
				graphId: graphId(node.id)
			})));
			edges.push(...snapshot.edges.map((edge) => ({
				...edge,
				sourceId: graphId(edge.sourceId),
				targetId: graphId(edge.targetId)
			})));
		}
		return {
			nodes,
			edges,
			generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			memoryBodies: spaces.map(({ id, name, active }) => ({
				id,
				name,
				active
			})),
			sources
		};
	}
	async list(request = {}, signal) {
		const rawQuery = request.query?.trim() ?? "";
		const query = rawQuery.toLocaleLowerCase();
		if (rawQuery.length > 500) throw new Error("query is too long (max 500 characters)");
		const category = allowed(request.category, CATEGORIES$1, "category");
		const limit = boundedInteger(request.limit, 200, 1, 1e3);
		const spaces = this.readSpaces(request.memoryBodyIds);
		const batches = await Promise.all(spaces.map(async (body) => {
			const mode = body.provider.capabilities.browse ? "enumerable" : body.provider.capabilities.search ? "query-only" : "unsupported";
			if (mode === "query-only" && rawQuery === "") return {
				body,
				items: [],
				source: readSource(body, mode, "query-required", 0, { hint: "Enter a query to inspect this provider." })
			};
			if (mode === "unsupported") return {
				body,
				items: [],
				source: readSource(body, mode, "unsupported", 0, { hint: "This provider does not expose content browsing." })
			};
			try {
				const provider = this.providerFor(body);
				const items = (mode === "query-only" ? (await provider.search(body, {
					query: rawQuery,
					limit
				}, signal)).results : await provider.list(body, {
					...request,
					limit
				}, signal)).filter((item) => (category === void 0 || item.category === category) && (query === "" || item.content.toLocaleLowerCase().includes(query) || item.id.toLocaleLowerCase().includes(query)));
				return {
					body,
					items,
					source: readSource(body, mode, items.length === 0 ? "empty" : "ready", items.length)
				};
			} catch (error) {
				return {
					body,
					items: [],
					source: readSource(body, mode, "unavailable", 0, { hint: error instanceof Error ? error.message : String(error) })
				};
			}
		}));
		const items = batches.flatMap(({ body, items: bodyItems }) => bodyItems.map((item) => ({
			...this.annotate(item, body),
			color: insightColor(item.category)
		})));
		return {
			items: items.slice(0, limit),
			total: items.length,
			generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
			sources: batches.map((batch) => batch.source)
		};
	}
	async entities(entity, limit, signal) {
		const active = (await this.spaces(signal)).items.filter((body) => body.active);
		const capable = active.filter((body) => body.provider.capabilities.entities);
		const entityCounts = /* @__PURE__ */ new Map();
		for (const body of capable) for (const item of body.stats?.topEntities ?? []) entityCounts.set(item.entity, (entityCounts.get(item.entity) ?? 0) + item.count);
		const items = [...entityCounts].map(([name, count]) => ({
			entity: name,
			count
		})).sort((left, right) => right.count - left.count);
		const sources = active.map((body) => {
			if (!body.provider.capabilities.entities) return readSource(body, "unsupported", "unsupported", 0, { hint: "This provider does not expose an entity index." });
			if (!body.healthy) return readSource(body, "entities", "unavailable", 0, { hint: body.error ?? "Provider unavailable." });
			const count = body.stats?.topEntities.length ?? 0;
			return readSource(body, "entities", count === 0 ? "empty" : "ready", count);
		});
		const selected = entity?.trim() ?? "";
		if (selected === "") return {
			items,
			insights: [],
			sources
		};
		if (selected.length > 200) throw new Error("entity is too long (max 200 characters)");
		const readableIds = capable.filter((body) => body.healthy).map((body) => body.id);
		return {
			items,
			selected,
			insights: readableIds.length === 0 ? [] : (await this.search({
				query: selected,
				intent: "ENTITY",
				limit: boundedInteger(limit, 20, 1, 50),
				memoryBodyIds: readableIds
			}, signal)).results,
			sources
		};
	}
	async remember(request, signal) {
		this.assertWritable();
		const prepared = this.prepareRemember(request);
		const result = await this.providerFor(prepared.body).remember(prepared.body, prepared.request, signal);
		this.activateAfterWrite(prepared.body, mutationResultCommitted(result));
		return this.annotateResult(result, prepared.body);
	}
	/**
	* Persist a host-authorized set of exact memories without involving a model
	* in the data plane. Mnemon Native requests share one import per destination;
	* other Providers retain their adapter-defined write semantics.
	*/
	async rememberMany(requests, signal) {
		this.assertWritable();
		const prepared = requests.map((request) => this.prepareRemember(request));
		const results = new Array(prepared.length);
		const groups = /* @__PURE__ */ new Map();
		for (const [index, entry] of prepared.entries()) groups.set(entry.body.id, [...groups.get(entry.body.id) ?? [], {
			...entry,
			index
		}]);
		for (const group of groups.values()) {
			const body = group[0].body;
			const provider = this.providerFor(body);
			let providerChanged = false;
			const batchWriter = provider.rememberMany;
			const batch = batchWriter === void 0 ? [] : group.filter((entry) => !this.isNativeSpace(body) || entry.request.content.length <= 8e3);
			if (batchWriter !== void 0 && batch.length > 0) {
				const written = await batchWriter.call(provider, body, batch.map((entry) => entry.request), signal);
				if (written.length !== batch.length) throw new Error(`batch remember did not return one receipt per request for Memory Space ${body.id}`);
				for (const [offset, result] of written.entries()) {
					const entry = batch[offset];
					results[entry.index] = this.annotateResult(result, body);
					providerChanged ||= mutationResultCommitted(result);
				}
			}
			for (const entry of group) {
				if (batch.includes(entry)) continue;
				const result = await provider.remember(body, entry.request, signal);
				results[entry.index] = this.annotateResult(result, body);
				providerChanged ||= mutationResultCommitted(result);
			}
			this.activateAfterWrite(body, providerChanged);
		}
		return results;
	}
	async related(id, depth = 2, edge, signal, memoryBodyId) {
		const body = this.readSpace(memoryBodyId);
		const selectedEdge = allowed(edge, EDGE_TYPES, "edge");
		const provider = this.providerFor(body);
		if (provider.related === void 0 || !body.provider.capabilities.related) throw new Error(`${body.provider.label} does not support related-memory traversal`);
		return (await provider.related(body, required(id, "id", 2e3), boundedInteger(depth, 2, 1, 5), selectedEdge, signal)).map((entry) => this.annotate(entry, body));
	}
	async link(sourceId, targetId, type = "semantic", weight = .5, reason, signal, memoryBodyId) {
		this.assertWritable();
		const body = this.writeSpace(memoryBodyId);
		if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error("weight must be within 0..1");
		const selectedType = allowed(type, EDGE_TYPES, "type") ?? "semantic";
		const provider = this.providerFor(body);
		if (provider.link === void 0 || !body.provider.capabilities.link) throw new Error(`${body.provider.label} does not support explicit memory links`);
		const result = await provider.link(body, required(sourceId, "sourceId", 2e3), required(targetId, "targetId", 2e3), selectedType, weight, reason === void 0 || reason.trim() === "" ? void 0 : required(reason, "reason", 1e3), signal);
		this.activateAfterWrite(body, mutationResultCommitted(result));
		return this.annotateResult(result, body);
	}
	async forget(id, signal, memoryBodyId) {
		this.assertWritable();
		const body = this.writeSpace(memoryBodyId);
		const provider = this.providerFor(body);
		if (provider.forget === void 0 || !body.provider.capabilities.forget) throw new Error(`${body.provider.label} does not expose safe forget semantics in this integration`);
		const result = await provider.forget(body, required(id, "id", 2e3), signal);
		this.activateAfterWrite(body, mutationResultCommitted(result));
		return this.annotateResult(result, body);
	}
	prepareSpacePlacement(request) {
		if (request.placement === void 0) throw new Error("automatic provider placement request is required");
		if (request.providerId !== void 0) throw new Error("automatic provider placement cannot include a fixed providerId");
		return prepareMemoryPlacement(request.placement, this.memorySpaces.placementCandidates(request));
	}
	async createSpace(request, signal, placement) {
		this.assertWritable();
		return await this.memorySpaces.create(request, signal, placement);
	}
	/**
	* Create a Memory Space from the configured distillation policy. The model
	* may choose only among candidates already filtered by the host; manual mode
	* ignores model preference and always uses the configured fixed provider.
	*/
	async createSpaceForPersistence(body, selection, signal, delegation = {
		runId: "memory-write",
		provider: "task-agent"
	}) {
		const strategy = this.config.persistenceStrategy;
		if (strategy.mode === "manual") {
			const connection = strategy.providerConnections[strategy.providerId];
			return this.createSpace({
				...body,
				providerId: strategy.providerId,
				...this.isNativeProvider(strategy.providerId) || connection === void 0 ? {} : { connection }
			}, signal);
		}
		const request = {
			...body,
			placement: {
				mode: "automatic",
				...strategy.prompt === "" ? {} : { prompt: strategy.prompt },
				rules: { ...strategy.rules }
			},
			...Object.keys(strategy.providerConnections).length === 0 ? {} : { providerConnections: strategy.providerConnections }
		};
		const prepared = this.prepareSpacePlacement(request);
		const decision = rulesOnlyPlacement(prepared) ?? finalizeLlmPlacement(prepared, selection ?? {
			providerId: "",
			reason: "",
			confidence: ""
		}, delegation);
		return this.createSpace(request, signal, decision);
	}
	async updateProviderService(providerId, settings, clearSecrets = [], enabled = true, signal) {
		this.assertWritable();
		if (this.isNativeProvider(providerId)) throw new Error("Mnemon Native service settings are managed by the native configuration");
		if (!enabled) return this.memorySpaces.updateProviderService(providerId, settings, clearSecrets, false);
		const connection = this.memorySpaces.resolveProviderService(providerId, settings, clearSecrets);
		const provider = this.providers.get(providerId);
		if (provider?.discover === void 0) throw new Error(`${this.providerCatalog.descriptor(providerId).label} does not support Memory Space discovery`);
		const discovered = await provider.discover(connection, signal);
		return this.memorySpaces.syncProviderService(providerId, connection, discovered);
	}
	updateSpace(id, request) {
		this.assertWritable();
		return this.memorySpaces.update(id, request);
	}
	updateSpaceMetadata(updates) {
		this.assertWritable();
		return this.memorySpaces.updateMetadata(updates);
	}
	async deleteSpace(id, signal) {
		this.assertWritable();
		return await this.memorySpaces.remove(id, signal);
	}
	async mergeSpaces(targetSpaceId, sourceSpaceIds, deactivateSources = true, signal) {
		this.assertWritable();
		const target = this.memorySpaces.get(targetSpaceId);
		if (!this.isNativeSpace(target)) throw new Error("memory-space merge currently requires a Mnemon Native target");
		const sourceIds = [...new Set(sourceSpaceIds.map((id) => id.trim()).filter((id) => id !== ""))];
		if (sourceIds.length === 0) throw new Error("sourceMemoryBodyIds requires at least one memory space");
		if (sourceIds.includes(target.id)) throw new Error("target memory space cannot also be a merge source");
		const sources = sourceIds.map((id) => this.memorySpaces.get(id));
		if (sources.some((source) => !this.isNativeSpace(source))) throw new Error("memory-space merge currently supports Mnemon Native sources only");
		const insights = [];
		const edges = [];
		for (const source of sources) {
			const offset = insights.length;
			const sourceInsights = await this.providerFor(source).list(source, { limit: 1e5 }, signal);
			const indexById = new Map(sourceInsights.map((insight, index) => [insight.id, offset + index]));
			for (const insight of sourceInsights) insights.push({
				content: insight.content,
				...insight.category === void 0 ? {} : { category: insight.category },
				...insight.importance === void 0 ? {} : { importance: insight.importance },
				...insight.tags === void 0 ? {} : { tags: insight.tags },
				...insight.entities === void 0 ? {} : { entities: insight.entities },
				...insight.source === void 0 ? {} : { source: insight.source },
				...insight.createdAt === void 0 ? {} : { created_at: insight.createdAt }
			});
			const graph = await this.providerFor(source).graph(source, signal);
			for (const edge of graph.edges) {
				const sourceIndex = indexById.get(edge.sourceId);
				const targetIndex = indexById.get(edge.targetId);
				if (sourceIndex === void 0 || targetIndex === void 0 || edge.type === void 0) continue;
				edges.push({
					source_index: sourceIndex,
					target_index: targetIndex,
					edge_type: edge.type,
					weight: .5,
					reason: edge.label
				});
			}
		}
		if (insights.length === 0) {
			if (deactivateSources) for (const source of sources) {
				if (!source.active) continue;
				this.memorySpaces.setActive(source.id, false);
			}
			return {
				action: "merged",
				imported: 0,
				updated: 0,
				skipped: 0,
				edges_inserted: 0,
				targetMemoryBodyId: target.id
			};
		}
		const temporary = mkdtempSync(join(tmpdir(), "dsh-mnemon-merge-"));
		const draftPath = join(temporary, "memory-draft.json");
		try {
			writeFileSync(draftPath, JSON.stringify({
				schema_version: "1",
				source: "dsh-mnemon-merge",
				insights,
				edges
			}), {
				encoding: "utf8",
				mode: 384
			});
			const result = await this.runner.runJson(["import", draftPath], {
				...signal === void 0 ? {} : { signal },
				store: target.id
			});
			const summary = record(result);
			const counts = [
				summary?.imported,
				summary?.updated,
				summary?.skipped
			];
			const complete = mutationResultCommitted(result) && summary?.errors === 0 && counts.every((value) => typeof value === "number" && Number.isInteger(value) && value >= 0) && counts.reduce((sum, value) => sum + Number(value), 0) === insights.length;
			this.activateAfterWrite(target, complete);
			if (deactivateSources && complete) for (const source of sources) {
				if (!source.active) continue;
				this.memorySpaces.setActive(source.id, false);
			}
			const completion = mutationResultCompletion(result);
			return this.annotateResult({
				...summary,
				status: complete ? "committed" : completion === "committed" ? "partial" : completion
			}, target);
		} finally {
			rmSync(temporary, {
				recursive: true,
				force: true
			});
		}
	}
	providerFor(body) {
		const provider = this.providers.get(body.provider.id);
		if (provider === void 0) throw new Error(`unsupported memory provider: ${body.provider.id}`);
		return provider;
	}
	readSpaces(ids) {
		const active = this.memorySpaces.active();
		if (ids === void 0 || ids.length === 0) return active;
		return [...new Set(ids.map((id) => id.trim()).filter((id) => id !== ""))].map((id) => {
			const body = this.memorySpaces.get(id);
			if (!body.active) throw new Error(`memory space is not active for reading: ${id}`);
			if (!this.isNativeSpace(body) && !this.memorySpaces.providerServiceEnabled(body.provider.id)) throw new Error(`${body.provider.label} is disabled in Settings`);
			return body;
		});
	}
	readSpace(id) {
		if (id !== void 0 && id.trim() !== "") {
			const body = this.memorySpaces.get(id);
			if (!body.active) throw new Error(`memory space is not active for reading: ${body.id}`);
			if (!this.isNativeSpace(body) && !this.memorySpaces.providerServiceEnabled(body.provider.id)) throw new Error(`${body.provider.label} is disabled in Settings`);
			return body;
		}
		const active = this.memorySpaces.active();
		if (active.length !== 1) throw new Error("memoryBodyId is required when the number of active memory spaces is not exactly one");
		return active[0];
	}
	writeSpace(id) {
		if (id !== void 0 && id.trim() !== "") {
			const body = this.memorySpaces.get(id);
			if (!this.isNativeSpace(body) && !this.memorySpaces.providerServiceEnabled(body.provider.id)) throw new Error(`${body.provider.label} is disabled in Settings`);
			return body;
		}
		const active = this.memorySpaces.active();
		if (active.length !== 1) throw new Error("memoryBodyId is required when the number of active memory spaces is not exactly one");
		return active[0];
	}
	prepareRemember(request) {
		const body = this.writeSpace(request.memoryBodyId);
		const content = required(request.content, "content", 8192);
		const importance = boundedInteger(request.importance, 3, 1, 5);
		const category = allowed(request.category, CATEGORIES$1, "category") ?? "general";
		const source = allowed(request.source, SOURCES$1, "source") ?? "user";
		const tags = commaList(request.tags, "tags", 20)?.split(",");
		const entities = commaList(request.entities, "entities", 50)?.split(",");
		return {
			body,
			request: {
				content,
				importance,
				category,
				source,
				memoryBodyId: body.id,
				...tags === void 0 ? {} : { tags },
				...entities === void 0 ? {} : { entities }
			}
		};
	}
	annotate(insight, body) {
		return {
			...insight,
			memoryBodyId: body.id,
			memoryBodyName: body.name,
			memoryProviderId: body.provider.id,
			memoryProviderLabel: body.provider.label,
			memoryCapabilities: body.provider.capabilities
		};
	}
	annotateResult(result, body) {
		const value = record(result);
		return value === void 0 ? result : {
			...value,
			memoryBodyId: body.id,
			memoryBodyName: body.name,
			memoryProviderId: body.provider.id,
			memoryProviderLabel: body.provider.label
		};
	}
	activateAfterWrite(body, providerChanged) {
		if (!providerChanged) return;
		if (!body.active) this.memorySpaces.setActive(body.id, true);
		else this.memorySpaces.touch(body.id);
	}
	assertWritable() {
		if (!this.config.writeEnabled) throw new Error("dsh-mnemon is configured read-only (writeEnabled: false)");
	}
	/** @deprecated Use spaces. */
	bodies(...args) {
		return this.spaces(...args);
	}
	/** @deprecated Use spaceDirectory. */
	bodyDirectory(...args) {
		return this.spaceDirectory(...args);
	}
	/** @deprecated Use reconnectSpace. */
	reconnectBody(...args) {
		return this.reconnectSpace(...args);
	}
	/** @deprecated Use prepareSpacePlacement. */
	prepareBodyPlacement(...args) {
		return this.prepareSpacePlacement(...args);
	}
	/** @deprecated Use createSpace. */
	createBody(...args) {
		return this.createSpace(...args);
	}
	/** @deprecated Use createSpaceForPersistence. */
	createBodyForPersistence(...args) {
		return this.createSpaceForPersistence(...args);
	}
	/** @deprecated Use updateSpace. */
	updateBody(...args) {
		return this.updateSpace(...args);
	}
	/** @deprecated Use updateSpaceMetadata. */
	updateBodyMetadata(...args) {
		return this.updateSpaceMetadata(...args);
	}
	/** @deprecated Use deleteSpace. */
	deleteBody(...args) {
		return this.deleteSpace(...args);
	}
	/** @deprecated Use mergeSpaces. */
	mergeBodies(...args) {
		return this.mergeSpaces(...args);
	}
};
//#endregion
//#region src/runner.ts
function expandHome(path) {
	return path === "~" ? homedir() : path.startsWith("~/") || path.startsWith("~\\") ? join(homedir(), path.slice(2)) : path;
}
var MnemonCliError = class extends Error {
	exitCode;
	stderr;
	constructor(message, exitCode = null, stderr = "") {
		super(message);
		this.name = "MnemonCliError";
		this.exitCode = exitCode;
		this.stderr = stderr;
	}
};
const EMBEDDING_ENVIRONMENT_KEYS = /* @__PURE__ */ new Set([
	"MNEMON_EMBED_ENDPOINT",
	"MNEMON_EMBED_MODEL",
	"MNEMON_EMBED_API_KEY",
	"MNEMON_EMBED_PROTOCOL"
]);
/** Preserve the Host environment while making saved embedding overrides authoritative. */
function processEnvironment(config) {
	if (!config.embedding.enabled) return void 0;
	return {
		...Object.fromEntries(Object.entries(process.env).filter(([key]) => !EMBEDDING_ENVIRONMENT_KEYS.has(key.toUpperCase()))),
		MNEMON_EMBED_ENDPOINT: config.embedding.endpoint,
		MNEMON_EMBED_MODEL: config.embedding.model,
		MNEMON_EMBED_API_KEY: config.embedding.apiKey,
		...config.embedding.protocol === "auto" ? {} : { MNEMON_EMBED_PROTOCOL: config.embedding.protocol }
	};
}
function createRunner(config, processRunner = runProcess, workspaceRoot) {
	const currentCommand = () => findMnemonCommand(config) ?? config.cliPath ?? "mnemon";
	const globalArgs = (store) => {
		const args = [];
		if (config.storageScope !== "global" || config.dataDir !== void 0) args.push("--data-dir", effectiveDataDir());
		if (store !== void 0) args.push("--store", store);
		else if (config.store !== void 0) args.push("--store", config.store);
		return args;
	};
	const effectiveDataDir = () => {
		if (config.storageScope === "workspace") return resolve(workspaceRoot ?? process.cwd(), ".mnemon");
		if (config.storageScope === "custom") return expandHome(config.dataDir);
		return expandHome(process.env.MNEMON_DATA_DIR?.trim() || "~/.mnemon");
	};
	const persistedStore = () => {
		const active = join(effectiveDataDir(), "active");
		if (existsSync(active)) try {
			const value = readFileSync(active, "utf8").trim();
			if (/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) return value;
		} catch {}
		return "default";
	};
	const launch = async (args, options = {}) => {
		if (options.signal?.aborted === true) throw new MnemonCliError(`mnemon command aborted: ${String(options.signal.reason ?? "cancelled")}`);
		const argv = options.globalFlags === false ? [...args] : [...globalArgs(options.store), ...args];
		const environment = processEnvironment(config);
		const processOptions = {
			timeoutMs: config.timeoutMs,
			...environment === void 0 ? {} : { env: environment },
			...options.signal === void 0 ? {} : { signal: options.signal }
		};
		let result;
		try {
			const command = currentCommand();
			const launcher = mnemonNpmLauncher(command);
			result = await processRunner(launcher === void 0 ? command : process.execPath, launcher === void 0 ? argv : [launcher, ...argv], launcher === void 0 ? processOptions : {
				...processOptions,
				env: nodeLauncherEnvironment(processOptions.env)
			});
		} catch (error) {
			throw new MnemonCliError(`${error instanceof Error ? error.message : String(error)}. ${process.platform === "win32" ? "Install the official Mnemon Windows release, ensure mnemon.exe is on PATH or under %LOCALAPPDATA%\\Programs\\mnemon, or set MNEMON_CLI_PATH or mnemon.cliPath to its absolute path." : "Install Mnemon and ensure \"mnemon\" is on PATH, or set MNEMON_CLI_PATH or mnemon.cliPath."}`);
		}
		if (result.exitCode !== 0) {
			const detail = result.stderr.trim() || result.stdout.trim() || "no output";
			throw new MnemonCliError(`mnemon ${args.join(" ")} exited ${String(result.exitCode)}: ${detail}`, result.exitCode, result.stderr);
		}
		return result.stdout;
	};
	const execute = (args, options = {}) => {
		return withMemoryStorageLock(effectiveDataDir(), () => launch(args, options));
	};
	return {
		get command() {
			return currentCommand();
		},
		get commandFound() {
			const found = findMnemonCommand(config);
			return found !== void 0 && isMnemonExecutable(found);
		},
		config,
		async runJson(args, options) {
			const stdout = await execute(args, options);
			try {
				return JSON.parse(stdout);
			} catch {
				throw new MnemonCliError(`mnemon ${args.join(" ")} returned invalid JSON`);
			}
		},
		runText: execute,
		runTextBatch(commands) {
			return withMemoryStorageLock(effectiveDataDir(), async () => {
				const outputs = [];
				for (const command of commands) outputs.push(await launch(command.args, command.options));
				return outputs;
			});
		},
		withExclusive(operation) {
			return withMemoryStorageLock(effectiveDataDir(), operation);
		},
		effectiveDataDir() {
			return effectiveDataDir();
		},
		persistedStore() {
			return persistedStore();
		},
		effectiveStore() {
			if (config.store !== void 0) return config.store;
			const fromEnvironment = process.env.MNEMON_STORE?.trim();
			if (fromEnvironment !== void 0 && fromEnvironment !== "") return fromEnvironment;
			return persistedStore();
		}
	};
}
//#endregion
//#region src/config.ts
const MemorySpacesConfig = z.object({
	dataDir: z.string(),
	cliPath: z.string(),
	store: z.string(),
	timeoutMs: z.number().step(1).min(1).max(6e5),
	defaultRecallLimit: z.number().step(1).min(1).max(50),
	writeEnabled: z.boolean(),
	embedding: z.any(),
	recallQuality: z.any(),
	persistenceStrategy: z.any()
});
function optionalText(value) {
	return value?.trim() || void 0;
}
const MEMORY_PROVIDER_ID = /^[a-z][a-z0-9-]{0,127}$/u;
const MEMORY_PLACEMENT_CAPABILITY_SET = /* @__PURE__ */ new Set([
	"graph",
	"entities",
	"related",
	"exact-write",
	"link",
	"forget"
]);
const MEMORY_PLACEMENT_PREFERENCE_SET = /* @__PURE__ */ new Set([
	"balanced",
	"local-first",
	"shared-first"
]);
function resolvePersistenceStrategy(value) {
	const mode = value?.mode ?? "manual";
	if (mode !== "manual" && mode !== "automatic") throw new Error(`dsh-mnemon: unsupported persistence strategy mode: ${String(mode)}`);
	const providerId = value?.providerId ?? "mnemon-native";
	if (!MEMORY_PROVIDER_ID.test(providerId)) throw new Error(`dsh-mnemon: invalid persistence strategy provider: ${String(providerId)}`);
	const prompt = value?.prompt?.trim() ?? "";
	if (prompt.length > 4e3) throw new Error("dsh-mnemon: persistence strategy prompt is too long (max 4000 characters)");
	const configuredProviderIds = value?.rules?.allowedProviderIds;
	const allowedProviderIds = [...new Set(configuredProviderIds === void 0 || configuredProviderIds.length === 0 && mode === "manual" ? ["mnemon-native"] : configuredProviderIds)];
	if (allowedProviderIds.length === 0) throw new Error("dsh-mnemon: persistence strategy requires at least one allowed provider");
	for (const id of allowedProviderIds) if (!MEMORY_PROVIDER_ID.test(id)) throw new Error(`dsh-mnemon: invalid persistence strategy provider: ${String(id)}`);
	const dataBoundary = value?.rules?.dataBoundary ?? "allow-remote";
	if (dataBoundary !== "allow-remote" && dataBoundary !== "local-only") throw new Error(`dsh-mnemon: unsupported persistence data boundary: ${String(dataBoundary)}`);
	const requiredCapabilities = [...new Set(value?.rules?.requiredCapabilities ?? [])];
	for (const capability of requiredCapabilities) if (!MEMORY_PLACEMENT_CAPABILITY_SET.has(capability)) throw new Error(`dsh-mnemon: unsupported persistence capability: ${String(capability)}`);
	const preference = value?.rules?.preference ?? "balanced";
	if (!MEMORY_PLACEMENT_PREFERENCE_SET.has(preference)) throw new Error(`dsh-mnemon: unsupported persistence preference: ${String(preference)}`);
	const providerConnections = Object.fromEntries(Object.entries(value?.providerConnections ?? {}).flatMap(([id, connection]) => {
		if (!MEMORY_PROVIDER_ID.test(id) || connection === void 0) return [];
		return [[id, Object.fromEntries(Object.entries(connection).filter((entry) => [
			"string",
			"number",
			"boolean"
		].includes(typeof entry[1])))]];
	}));
	return {
		mode,
		providerId,
		prompt,
		rules: {
			allowedProviderIds,
			dataBoundary,
			requiredCapabilities,
			preference
		},
		providerConnections
	};
}
function resolveEmbedding(value) {
	const endpoint = optionalText(value?.endpoint) ?? "http://localhost:11434";
	if (endpoint.length > 2048) throw new Error("dsh-mnemon: embedding endpoint is too long");
	let parsed;
	try {
		parsed = new URL(endpoint);
	} catch {
		throw new Error("dsh-mnemon: embedding endpoint must be an absolute HTTP or HTTPS URL");
	}
	if (!["http:", "https:"].includes(parsed.protocol) || parsed.username !== "" || parsed.password !== "" || endpoint.includes("?") || endpoint.includes("#")) throw new Error("dsh-mnemon: embedding endpoint must be an absolute HTTP or HTTPS URL without credentials, query, or fragment");
	const normalizedEndpoint = endpoint.replace(/\/+$/u, "");
	const model = optionalText(value?.model) ?? "nomic-embed-text";
	if (model.length > 200 || /[\u0000-\u001f\u007f]/u.test(model)) throw new Error("dsh-mnemon: embedding model must contain 1..200 characters without control characters");
	const apiKey = optionalText(value?.apiKey) ?? "";
	if (apiKey.length > 2048 || /[\u0000-\u001f\u007f]/u.test(apiKey)) throw new Error("dsh-mnemon: embedding API key must contain 0..2048 characters without control characters");
	const protocol = value?.protocol ?? "auto";
	if (!MNEMON_EMBEDDING_PROTOCOLS.includes(protocol)) throw new Error(`dsh-mnemon: unsupported embedding protocol: ${String(protocol)}`);
	return {
		enabled: value?.enabled === true,
		endpoint: normalizedEndpoint,
		model,
		apiKey,
		protocol
	};
}
function resolveRecallQuality(value) {
	const policy = optionalText(value?.policy) ?? "strict-v1";
	if (!/^[a-z][a-z0-9-]{0,63}$/u.test(policy)) throw new Error("dsh-mnemon: recall quality policy id must match [a-z][a-z0-9-]{0,63}");
	const lowScoreThreshold = value?.lowScoreThreshold ?? .25;
	const highScoreThreshold = value?.highScoreThreshold ?? .6;
	const candidateMultiplier = value?.candidateMultiplier ?? 3;
	const maxMediumResults = value?.maxMediumResults ?? 4;
	const maxUnknownResults = value?.maxUnknownResults ?? 2;
	if (!Number.isFinite(lowScoreThreshold) || lowScoreThreshold < 0 || lowScoreThreshold > 1) throw new Error("dsh-mnemon: recall low score threshold must be within 0..1");
	if (!Number.isFinite(highScoreThreshold) || highScoreThreshold < 0 || highScoreThreshold > 1) throw new Error("dsh-mnemon: recall high score threshold must be within 0..1");
	if (lowScoreThreshold >= highScoreThreshold) throw new Error("dsh-mnemon: recall low score threshold must be less than the high score threshold");
	if (!Number.isInteger(candidateMultiplier) || candidateMultiplier < 1 || candidateMultiplier > 5) throw new Error("dsh-mnemon: recall candidate multiplier must be an integer within 1..5");
	if (!Number.isInteger(maxMediumResults) || maxMediumResults < 0 || maxMediumResults > 50) throw new Error("dsh-mnemon: recall max medium results must be an integer within 0..50");
	if (!Number.isInteger(maxUnknownResults) || maxUnknownResults < 0 || maxUnknownResults > 50) throw new Error("dsh-mnemon: recall max unknown results must be an integer within 0..50");
	return {
		policy,
		lowScoreThreshold,
		highScoreThreshold,
		candidateMultiplier,
		maxMediumResults,
		maxUnknownResults
	};
}
/** Capture only this Source's settings, with an instance-local default authority. */
function resolveMemorySpacesConfig(value = {}, sourceInstanceKey = "standalone") {
	const config = MemorySpacesConfig(value);
	const requested = optionalText(config.dataDir);
	const dataDir = requested === void 0 ? join(homedir(), ".mnemon", "sources", encodeURIComponent(sourceInstanceKey)) : requested === "~" ? homedir() : requested.startsWith("~/") ? join(homedir(), requested.slice(2)) : requested;
	if (!isAbsolute(dataDir)) throw new Error("Memory Spaces dataDir must be absolute or start with ~/");
	const store = optionalText(config.store);
	if (store !== void 0 && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(store)) throw new Error("Memory Spaces store has an invalid identifier");
	const cliPath = optionalText(config.cliPath);
	return {
		storageScope: "custom",
		dataDir,
		...cliPath === void 0 ? {} : { cliPath },
		...store === void 0 ? {} : { store },
		timeoutMs: config.timeoutMs ?? 1e4,
		defaultRecallLimit: config.defaultRecallLimit ?? 10,
		writeEnabled: config.writeEnabled ?? true,
		embedding: resolveEmbedding(config.embedding),
		recallQuality: resolveRecallQuality(config.recallQuality),
		persistenceStrategy: resolvePersistenceStrategy(config.persistenceStrategy)
	};
}
//#endregion
//#region src/source.ts
const CATEGORIES = /* @__PURE__ */ new Set([
	"preference",
	"decision",
	"fact",
	"insight",
	"context",
	"general"
]);
const SOURCES = /* @__PURE__ */ new Set([
	"user",
	"agent",
	"external"
]);
const INTENTS = /* @__PURE__ */ new Set([
	"WHY",
	"WHEN",
	"ENTITY",
	"GENERAL"
]);
const EDGES = /* @__PURE__ */ new Set([
	"temporal",
	"semantic",
	"causal",
	"entity"
]);
function grantIds(grant) {
	return memoryInputStringArray(memoryInputRecord(grant.value, "Memory Spaces ReadGrant").memoryBodyIds, "memoryBodyIds", 1e4) ?? [];
}
function scalarRecord(value, label) {
	if (value === void 0) return void 0;
	const input = memoryInputRecord(value, label);
	const result = {};
	for (const [key, item] of Object.entries(input)) {
		if (!/^[a-z][a-zA-Z0-9_-]{0,127}$/u.test(key)) throw new Error(`${label} contains an invalid field: ${key}`);
		if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") throw new Error(`${label}.${key} must be a string, number, or boolean`);
		result[key] = item;
	}
	return result;
}
function providerConnections(value) {
	if (value === void 0) return void 0;
	const input = memoryInputRecord(value, "providerConnections");
	return Object.fromEntries(Object.entries(input).map(([providerId, connection]) => [memoryInputText(providerId, "providerId", 128), scalarRecord(connection, `providerConnections.${providerId}`)]));
}
function createSpaceRequest(value) {
	const input = memoryInputRecord(value, "Memory Space body-create request");
	const providerId = memoryInputText(input.providerId, "providerId", 128, false);
	const connection = scalarRecord(input.connection, "connection");
	const connections = providerConnections(input.providerConnections);
	const placementValue = input.placement === void 0 ? void 0 : memoryInputRecord(input.placement, "placement");
	const rulesValue = placementValue?.rules === void 0 ? void 0 : memoryInputRecord(placementValue.rules, "placement.rules");
	const allowedProviderIds = rulesValue === void 0 ? void 0 : memoryInputStringArray(rulesValue.allowedProviderIds, "placement.rules.allowedProviderIds", 100);
	const requiredCapabilities = rulesValue === void 0 ? void 0 : memoryInputStringArray(rulesValue.requiredCapabilities, "placement.rules.requiredCapabilities", 20);
	const placement = placementValue === void 0 ? void 0 : {
		mode: memoryInputText(placementValue.mode, "placement.mode", 20),
		...memoryInputText(placementValue.prompt, "placement.prompt", 4e3, false) === void 0 ? {} : { prompt: memoryInputText(placementValue.prompt, "placement.prompt", 4e3, false) },
		...rulesValue === void 0 ? {} : { rules: {
			...allowedProviderIds === void 0 ? {} : { allowedProviderIds },
			...memoryInputText(rulesValue.dataBoundary, "placement.rules.dataBoundary", 30, false) === void 0 ? {} : { dataBoundary: memoryInputText(rulesValue.dataBoundary, "placement.rules.dataBoundary", 30, false) },
			...requiredCapabilities === void 0 ? {} : { requiredCapabilities },
			...memoryInputText(rulesValue.preference, "placement.rules.preference", 30, false) === void 0 ? {} : { preference: memoryInputText(rulesValue.preference, "placement.rules.preference", 30, false) }
		} }
	};
	return {
		name: memoryInputText(input.name, "name", 100),
		description: memoryInputText(input.description, "description", 1e3),
		...typeof input.active !== "boolean" ? {} : { active: input.active },
		...providerId === void 0 ? {} : { providerId },
		...connection === void 0 ? {} : { connection },
		...connections === void 0 ? {} : { providerConnections: connections },
		...placement === void 0 ? {} : { placement }
	};
}
function updateSpaceRequest(value) {
	const input = memoryInputRecord(value, "Memory Space body-update request");
	const connection = scalarRecord(input.connection, "connection");
	return {
		memoryBodyId: memoryInputText(input.memoryBodyId, "memoryBodyId", 300),
		request: {
			...memoryInputText(input.name, "name", 100, false) === void 0 ? {} : { name: memoryInputText(input.name, "name", 100, false) },
			...memoryInputText(input.description, "description", 1e3, false) === void 0 ? {} : { description: memoryInputText(input.description, "description", 1e3, false) },
			...typeof input.active !== "boolean" ? {} : { active: input.active },
			...connection === void 0 ? {} : { connection },
			...memoryInputStringArray(input.clearSecrets, "clearSecrets", 100) === void 0 ? {} : { clearSecrets: memoryInputStringArray(input.clearSecrets, "clearSecrets", 100) }
		}
	};
}
function placementDecision(value) {
	if (value === void 0) return void 0;
	const input = memoryInputRecord(value, "Memory Space placement decision");
	return {
		mode: memoryInputText(input.mode, "placement decision mode", 20),
		providerId: memoryInputText(input.providerId, "placement decision providerId", 128),
		decidedBy: memoryInputText(input.decidedBy, "placement decision decidedBy", 20),
		reason: memoryInputText(input.reason, "placement decision reason", 1e3),
		confidence: memoryInputText(input.confidence, "placement decision confidence", 20),
		candidateProviderIds: memoryInputStringArray(input.candidateProviderIds, "placement decision candidateProviderIds", 100),
		appliedRules: memoryInputStringArray(input.appliedRules, "placement decision appliedRules", 100),
		decidedAt: memoryInputText(input.decidedAt, "placement decision decidedAt", 100),
		...memoryInputText(input.runId, "placement decision runId", 500, false) === void 0 ? {} : { runId: memoryInputText(input.runId, "placement decision runId", 500, false) },
		...memoryInputText(input.subagentProvider, "placement decision subagentProvider", 500, false) === void 0 ? {} : { subagentProvider: memoryInputText(input.subagentProvider, "placement decision subagentProvider", 500, false) }
	};
}
function managementResult(service, value) {
	return {
		revision: service.memoryRevision(),
		value
	};
}
async function manageMemorySpaces(service, request) {
	const input = request.input === null ? {} : memoryInputRecord(request.input, `Memory Spaces management ${request.operation}`);
	if (request.mode === "read") switch (request.operation) {
		case "embedding-status": return managementResult(service, await service.embeddingStatus(request.signal));
		case "status-summary": return managementResult(service, service.statusSummary());
		case "status": return managementResult(service, await service.status(request.signal));
		case "body-directory": return managementResult(service, service.spaceDirectory());
		case "bodies": return managementResult(service, await service.spaces(request.signal));
		case "provider-services": return managementResult(service, service.memorySpaces.providerServices());
		case "graph": return managementResult(service, await service.graph(request.signal, memoryInputStringArray(input.memoryBodyIds, "memoryBodyIds", 1e4)));
		case "list": return managementResult(service, await service.list({
			...memoryInputText(input.query, "query", 2e3, false) === void 0 ? {} : { query: memoryInputText(input.query, "query", 2e3, false) },
			...memoryInputText(input.category, "category", 30, false) === void 0 ? {} : { category: memoryInputText(input.category, "category", 30, false) },
			...input.limit === void 0 ? {} : { limit: memoryInputInteger(input.limit, 100, 1, 1e4) },
			...memoryInputStringArray(input.memoryBodyIds, "memoryBodyIds", 1e4) === void 0 ? {} : { memoryBodyIds: memoryInputStringArray(input.memoryBodyIds, "memoryBodyIds", 1e4) }
		}, request.signal));
		case "entities": return managementResult(service, await service.entities(memoryInputText(input.entity, "entity", 500, false), input.limit === void 0 ? void 0 : memoryInputInteger(input.limit, 100, 1, 1e4), request.signal));
		case "search": return managementResult(service, await service.search({
			query: memoryInputText(input.query, "query", 2e3),
			...memoryInputText(input.mode, "mode", 20, false) === void 0 ? {} : { mode: memoryInputText(input.mode, "mode", 20, false) },
			...input.limit === void 0 ? {} : { limit: memoryInputInteger(input.limit, 10, 1, 1e3) },
			...memoryInputText(input.category, "category", 30, false) === void 0 ? {} : { category: memoryInputText(input.category, "category", 30, false) },
			...memoryInputText(input.source, "source", 30, false) === void 0 ? {} : { source: memoryInputText(input.source, "source", 30, false) },
			...memoryInputText(input.intent, "intent", 30, false) === void 0 ? {} : { intent: memoryInputText(input.intent, "intent", 30, false) },
			...memoryInputStringArray(input.memoryBodyIds, "memoryBodyIds", 1e4) === void 0 ? {} : { memoryBodyIds: memoryInputStringArray(input.memoryBodyIds, "memoryBodyIds", 1e4) }
		}, request.signal));
		case "related": return managementResult(service, await service.related(memoryInputText(input.id, "id", 2e3), memoryInputInteger(input.depth, 2, 1, 5), memoryInputText(input.edge, "edge", 30, false), request.signal, memoryInputText(input.memoryBodyId, "memoryBodyId", 300, false)));
		case "body-reconnect": return managementResult(service, await service.reconnectSpace(memoryInputText(input.memoryBodyId, "memoryBodyId", 300), request.signal));
		case "prepare-body-placement": return managementResult(service, service.prepareSpacePlacement(createSpaceRequest(request.input)));
		case "finalize-placement": {
			const prepared = memoryInputRecord(input.prepared, "prepared placement");
			if (!Array.isArray(prepared.candidates) || prepared.candidates.length === 0) throw new Error("placement candidates are required");
			const selection = input.selection === void 0 ? void 0 : memoryInputRecord(input.selection, "placement selection");
			return managementResult(service, selection === void 0 ? rulesOnlyPlacement(prepared) ?? null : finalizeLlmPlacement(prepared, {
				providerId: memoryInputText(selection.providerId, "providerId", 128),
				reason: memoryInputText(selection.reason, "reason", 4e3),
				confidence: memoryInputText(selection.confidence, "confidence", 40)
			}, {
				runId: memoryInputText(input.runId, "runId", 300),
				provider: memoryInputText(input.provider, "provider", 300)
			}));
		}
		case "metadata-sample": return managementResult(service, await service.metadataSample(memoryInputText(input.memoryBodyId, "memoryBodyId", 300), request.signal));
		default: throw new Error(`unsupported Memory Spaces management read operation: ${request.operation}`);
	}
	if (!request.confirmed) throw new Error("Memory Spaces management mutation requires explicit confirmation");
	switch (request.operation) {
		case "provider-service-update": {
			const providerId = memoryInputText(input.providerId, "providerId", 128);
			await service.updateProviderService(providerId, scalarRecord(input.settings, "settings") ?? {}, memoryInputStringArray(input.clearSecrets, "clearSecrets", 100) ?? [], input.enabled === void 0 ? true : input.enabled === true, request.signal);
			return managementResult(service, service.memorySpaces.providerServices().items.find((item) => item.providerId === providerId));
		}
		case "remember": return managementResult(service, await service.remember({
			content: memoryInputText(input.content, "content", 1e5),
			...memoryInputText(input.category, "category", 30, false) === void 0 ? {} : { category: memoryInputText(input.category, "category", 30, false) },
			...typeof input.importance !== "number" ? {} : { importance: input.importance },
			...memoryInputStringArray(input.tags, "tags", 100) === void 0 ? {} : { tags: memoryInputStringArray(input.tags, "tags", 100) },
			...memoryInputStringArray(input.entities, "entities", 100) === void 0 ? {} : { entities: memoryInputStringArray(input.entities, "entities", 100) },
			...memoryInputText(input.source, "source", 30, false) === void 0 ? {} : { source: memoryInputText(input.source, "source", 30, false) },
			...memoryInputText(input.memoryBodyId, "memoryBodyId", 300, false) === void 0 ? {} : { memoryBodyId: memoryInputText(input.memoryBodyId, "memoryBodyId", 300, false) }
		}, request.signal));
		case "link": return managementResult(service, await service.link(memoryInputText(input.sourceId, "sourceId", 2e3), memoryInputText(input.targetId, "targetId", 2e3), memoryInputText(input.type, "type", 30, false) ?? "semantic", typeof input.weight === "number" ? input.weight : .5, memoryInputText(input.reason, "reason", 1e3, false), request.signal, memoryInputText(input.memoryBodyId, "memoryBodyId", 300, false)));
		case "forget": return managementResult(service, await service.forget(memoryInputText(input.id, "id", 2e3), request.signal, memoryInputText(input.memoryBodyId, "memoryBodyId", 300, false)));
		case "body-create": {
			const bodyInput = input.request ?? request.input;
			return managementResult(service, await service.createSpace(createSpaceRequest(bodyInput), request.signal, placementDecision(input.placementDecision)));
		}
		case "body-update": {
			const parsed = updateSpaceRequest(request.input);
			return managementResult(service, service.updateSpace(parsed.memoryBodyId, parsed.request));
		}
		case "remember-many":
			if (!Array.isArray(input.requests) || input.requests.length > 1e3) throw new Error("remember-many requires at most 1000 requests");
			return managementResult(service, await service.rememberMany(input.requests.map((value) => memoryInputRecord(value, "remember request")), request.signal));
		case "body-create-for-persistence": {
			const selection = input.selection === void 0 ? void 0 : memoryInputRecord(input.selection, "placement selection");
			return managementResult(service, await service.createSpaceForPersistence(createSpaceRequest(input.request ?? request.input), selection === void 0 ? void 0 : {
				providerId: memoryInputText(selection.providerId, "providerId", 128),
				reason: memoryInputText(selection.reason, "reason", 4e3),
				confidence: memoryInputText(selection.confidence, "confidence", 40)
			}, request.signal));
		}
		case "body-metadata-update": {
			if (!Array.isArray(input.updates) || input.updates.length > 20) throw new Error("metadata update requires at most 20 entries");
			const updates = input.updates.map((value) => {
				const update = memoryInputRecord(value, "metadata update");
				return {
					memoryBodyId: memoryInputText(update.memoryBodyId, "memoryBodyId", 300),
					title: memoryInputText(update.title, "title", 48),
					description: memoryInputText(update.description, "description", 200)
				};
			});
			return managementResult(service, service.updateSpaceMetadata(updates));
		}
		case "body-merge": return managementResult(service, await service.mergeSpaces(memoryInputText(input.targetMemoryBodyId, "targetMemoryBodyId", 300), memoryInputStringArray(input.sourceMemoryBodyIds, "sourceMemoryBodyIds", 1e3) ?? [], input.deactivateSources !== false, request.signal));
		case "reload":
			service.memorySpaces.reload();
			return managementResult(service, { reloaded: true });
		case "body-delete": return managementResult(service, await service.deleteSpace(memoryInputText(input.memoryBodyId, "memoryBodyId", 300), request.signal));
		default: throw new Error(`unsupported Memory Spaces management mutation operation: ${request.operation}`);
	}
}
function createMemorySpacesSource(providerSnapshot, config = {}) {
	const capturedConfig = structuredClone(config);
	return defineMemorySource({
		manifest: {
			apiVersion: COMPOSABLE_MEMORY_API_VERSION,
			kind: "source",
			typeId: "memory-spaces",
			packageName: "dsh-mnemon-source-memory-spaces",
			role: "durable-evidence",
			capabilities: [
				"status",
				"project",
				"recall",
				"related",
				"write",
				"link",
				"forget"
			],
			consistency: "namespace-pinned-live-read",
			routes: [
				{
					id: "inspect",
					description: "Inspect bounded Memory Space health or routing metadata without exposing storage paths or credentials.",
					capability: "status",
					inputSchema: {
						type: "object",
						required: ["section"],
						additionalProperties: false,
						properties: { section: {
							type: "string",
							enum: ["directory", "health"]
						} }
					},
					maxCalls: 4,
					maxResults: 1,
					maxCharacters: 12e3
				},
				{
					id: "recall",
					description: "Recall evidence only from Memory Spaces pinned into this View.",
					capability: "recall",
					inputSchema: {
						type: "object",
						required: ["query"],
						additionalProperties: false,
						properties: {
							query: { type: "string" },
							mode: {
								type: "string",
								enum: [
									"smart",
									"keyword",
									"basic"
								]
							},
							limit: { type: "integer" },
							category: { type: "string" },
							source: { type: "string" },
							intent: { type: "string" },
							memoryBodyIds: { type: "array" }
						}
					},
					maxCalls: 4,
					maxResults: 20,
					maxCharacters: 16e3
				},
				{
					id: "related",
					description: "Traverse related memories only from evidence already admitted by this View.",
					capability: "related",
					inputSchema: {
						type: "object",
						required: ["id"],
						additionalProperties: false,
						properties: {
							id: { type: "string" },
							depth: { type: "integer" },
							edge: { type: "string" },
							memoryBodyId: { type: "string" }
						}
					},
					maxCalls: 4,
					maxResults: 20,
					maxCharacters: 16e3
				}
			],
			actions: [
				{
					id: "manage-spaces",
					description: "Create a Memory Space under the configured persistence policy, or update/merge spaces in this View scope.",
					capability: "write",
					inputSchema: {
						type: "object",
						required: ["operation"],
						additionalProperties: false,
						properties: {
							operation: {
								type: "string",
								enum: [
									"create",
									"update",
									"merge"
								]
							},
							request: { type: "object" },
							selection: { type: "object" },
							memoryBodyId: { type: "string" },
							name: { type: "string" },
							description: { type: "string" },
							active: { type: "boolean" },
							targetMemoryBodyId: { type: "string" },
							sourceMemoryBodyIds: { type: "array" },
							deactivateSources: { type: "boolean" }
						}
					}
				},
				{
					id: "remember",
					description: "Record memory using an authorized Space and its Provider; the receipt distinguishes accepted extraction from commitment.",
					capability: "write",
					inputSchema: {
						type: "object",
						required: ["content"],
						additionalProperties: false,
						properties: {
							content: { type: "string" },
							category: { type: "string" },
							importance: { type: "number" },
							tags: { type: "array" },
							entities: { type: "array" },
							source: { type: "string" },
							memoryBodyId: { type: "string" }
						}
					}
				},
				{
					id: "link",
					description: "Link two evidence items admitted by this View and owned by the same Memory Space.",
					capability: "link",
					inputSchema: {
						type: "object",
						required: ["sourceId", "targetId"],
						additionalProperties: false,
						properties: {
							sourceId: { type: "string" },
							targetId: { type: "string" },
							memoryBodyId: { type: "string" },
							type: { type: "string" },
							weight: { type: "number" },
							reason: { type: "string" }
						}
					}
				},
				{
					id: "forget",
					description: "Forget one returned evidence item using its Provider deletion mode (soft or hard); not a guarantee of universal erasure.",
					capability: "forget",
					inputSchema: {
						type: "object",
						required: ["id"],
						additionalProperties: false,
						properties: {
							id: { type: "string" },
							memoryBodyId: { type: "string" }
						}
					}
				}
			],
			management: {
				label: "Memory Spaces",
				description: "Durable evidence across local and remote Provider-backed namespaces."
			}
		},
		create(context) {
			const resolved = resolveMemorySpacesConfig({
				...context.configuration,
				...capturedConfig
			}, context.sourceInstanceKey);
			const service = new MemorySpacesService(createRunner(resolved), resolved, void 0, void 0, providerSnapshot.adapterRegistry(), new MemoryProviderCatalog(providerSnapshot.descriptors()));
			const canRemember = providerSnapshot.entries.some((entry) => entry.definition.manifest.capabilities.remember);
			const prepared = /* @__PURE__ */ new WeakMap();
			const sourceState = (scope) => {
				const value = service.memoryState();
				prepared.set(scope, value);
				return value;
			};
			const admittedByView = /* @__PURE__ */ new Map();
			const createdByView = /* @__PURE__ */ new Map();
			const admit = (viewId, entries) => {
				const current = admittedByView.get(viewId) ?? /* @__PURE__ */ new Map();
				for (const entry of entries) if (entry.memoryBodyId !== void 0) current.set(entry.memoryBodyId + "/" + entry.id, entry.memoryBodyId);
				admittedByView.delete(viewId);
				admittedByView.set(viewId, current);
				while (admittedByView.size > 128) admittedByView.delete(admittedByView.keys().next().value);
			};
			const evidence = (request, items, unavailable) => {
				const catalog = request.route.sourceRouteId === "inspect";
				let remaining = request.route.maxCharacters ?? 16e3;
				let truncated = false;
				const visible = items.slice(0, request.route.maxResults ?? 20).flatMap((item) => {
					if (remaining <= 0 || catalog && item.content.length > remaining) {
						truncated = true;
						return [];
					}
					const content = catalog ? item.content : truncateMemoryText(item.content, remaining);
					remaining -= content.length;
					const clipped = content !== item.content;
					truncated ||= clipped;
					return [{
						item,
						content,
						clipped
					}];
				});
				truncated ||= visible.length < items.length;
				if (!catalog) admit(request.view.id, visible.map(({ item }) => item));
				return {
					id: `evidence:${randomUUID()}`,
					viewId: request.view.id,
					routeId: request.route.id,
					sourceInstanceKey: context.sourceInstanceKey,
					observedAt: (/* @__PURE__ */ new Date()).toISOString(),
					items: visible.map(({ item, content, clipped }) => ({
						id: item.id,
						text: content,
						...(item.normalizedScore ?? item.score) === void 0 ? {} : { score: item.normalizedScore ?? item.score },
						...item.createdAt === void 0 ? {} : { revision: item.createdAt },
						provenance: {
							...item.memoryBodyId === void 0 ? {} : { memoryBodyId: item.memoryBodyId },
							...item.memoryBodyName === void 0 ? {} : { memoryBodyName: item.memoryBodyName },
							...item.memoryProviderId === void 0 ? {} : { memoryProviderId: item.memoryProviderId },
							...item.memoryProviderLabel === void 0 ? {} : { memoryProviderLabel: item.memoryProviderLabel },
							...item.memoryCapabilities === void 0 ? {} : { memoryCapabilities: { ...item.memoryCapabilities } },
							...item.relevanceTier === void 0 ? {} : { relevanceTier: item.relevanceTier },
							...item.category === void 0 ? {} : { category: item.category },
							...item.importance === void 0 ? {} : { importance: item.importance },
							...item.createdAt === void 0 ? {} : { createdAt: item.createdAt },
							...item.tags === void 0 ? {} : { tags: item.tags },
							...item.entities === void 0 ? {} : { entities: item.entities },
							...item.source === void 0 ? {} : { source: item.source },
							...item.depth === void 0 ? {} : { depth: item.depth },
							...item.edgeType === void 0 ? {} : { edgeType: item.edgeType },
							...item.externalUri === void 0 ? {} : { externalUri: item.externalUri }
						}
					})),
					truncated,
					...unavailable === void 0 ? {} : { unavailable },
					...catalog && visible.length === 0 ? { unavailable: "Inspection cannot fit the View budget as valid catalog JSON." } : {}
				};
			};
			return {
				facts(request) {
					const { active, revision } = sourceState(request.scope);
					const routeIds = [
						"inspect",
						...active.some((body) => body.provider.capabilities.search) ? ["recall"] : [],
						...active.some((body) => body.provider.capabilities.related) ? ["related"] : []
					];
					const actionIds = service.config.writeEnabled ? [
						"manage-spaces",
						...canRemember ? ["remember"] : [],
						...active.some((body) => body.provider.capabilities.link) ? ["link"] : [],
						...active.some((body) => body.provider.capabilities.forget) ? ["forget"] : []
					] : [];
					const capabilities = ["status", "project"];
					if (routeIds.includes("recall")) capabilities.push("recall");
					if (routeIds.includes("related")) capabilities.push("related");
					if (actionIds.includes("manage-spaces") || actionIds.includes("remember")) capabilities.push("write");
					if (actionIds.includes("link")) capabilities.push("link");
					if (actionIds.includes("forget")) capabilities.push("forget");
					return {
						sourceInstanceKey: context.sourceInstanceKey,
						sourceTypeId: "memory-spaces",
						role: "durable-evidence",
						availability: active.length === 0 ? "degraded" : "ready",
						revision,
						capabilities: [...capabilities],
						routeIds,
						actionIds,
						hints: {
							activeCount: active.length,
							providerCount: new Set(active.map((body) => body.provider.id)).size
						}
					};
				},
				project(request) {
					const { all, active, revision } = prepared.get(request.scope) ?? sourceState(request.scope);
					prepared.delete(request.scope);
					if (revision !== request.expectedRevision) throw new Error("Memory Spaces projection revision changed during composition");
					const cover = `${active.length} active of ${all.length} configured Memory Space${all.length === 1 ? "" : "s"} available through scoped recall.`;
					return {
						fragments: request.includeProjection ? [{
							id: `${context.sourceInstanceKey}/projection`,
							sourceInstanceKey: context.sourceInstanceKey,
							mode: request.mode,
							text: truncateMemoryText(cover, request.maxCharacters),
							revision,
							provenance: { sourceTypeId: "memory-spaces" }
						}] : [],
						readGrant: {
							id: `${context.sourceInstanceKey}/grant/${revision}`,
							sourceInstanceKey: context.sourceInstanceKey,
							schema: "dsh-mnemon.memory-spaces/v1",
							value: {
								memoryBodyIds: active.map((body) => body.id),
								knownMemoryBodyIds: all.map((body) => body.id)
							},
							revision,
							consistency: "namespace-pinned-live-read"
						},
						presentation: {
							visibleItems: active.length,
							totalItems: all.length,
							items: active.slice(0, 24).map((body) => ({
								id: body.id,
								title: truncateMemoryText(body.name, 160),
								...body.description.trim() === "" ? {} : { excerpt: truncateMemoryText(body.description, 600) }
							}))
						}
					};
				},
				async query(request) {
					const allowedBodies = grantIds(request.grant);
					const input = memoryInputRecord(request.input, `Memory Spaces ${request.route.sourceRouteId}`);
					if (request.route.sourceRouteId === "inspect") {
						const known = memoryInputStringArray(memoryInputRecord(request.grant.value, "Memory Spaces scope").knownMemoryBodyIds, "knownMemoryBodyIds", 1e4) ?? allowedBodies;
						let value;
						if (input.section === "directory") {
							const catalog = service.spaceDirectory();
							const owned = createdByView.get(request.view.id);
							value = modelSpaceCatalog({
								...catalog,
								items: catalog.items.filter((body) => known.includes(body.id) || owned?.has(body.id))
							});
						} else if (input.section === "health") value = modelStatus(await service.status(request.signal));
						else throw new Error("unknown Memory Spaces inspection section");
						return evidence(request, [{
							id: "memory-spaces:" + String(input.section),
							content: modelJson(value, request.route.maxCharacters ?? 12e3)
						}]);
					}
					if (request.route.sourceRouteId === "recall") {
						const category = memoryInputText(input.category, "category", 30, false);
						const source = memoryInputText(input.source, "source", 30, false);
						const intent = memoryInputText(input.intent, "intent", 30, false);
						if (category !== void 0 && !CATEGORIES.has(category)) throw new Error(`unsupported category: ${category}`);
						if (source !== void 0 && !SOURCES.has(source)) throw new Error(`unsupported source: ${source}`);
						if (intent !== void 0 && !INTENTS.has(intent)) throw new Error(`unsupported intent: ${intent}`);
						const requestedSpaces = memoryInputStringArray(input.memoryBodyIds, "memoryBodyIds", 1e4) ?? allowedBodies;
						if (requestedSpaces.some((id) => !allowedBodies.includes(id))) throw new Error("Recall requested a Memory Space outside this View ReadGrant");
						const mode = memoryInputText(input.mode, "mode", 20, false);
						const result = await service.search({
							query: memoryInputText(input.query, "query", 2e3),
							...mode === void 0 ? {} : { mode },
							limit: Math.min(request.route.maxResults ?? 20, memoryInputInteger(input.limit, 10, 1, 20)),
							memoryBodyIds: requestedSpaces,
							...category === void 0 ? {} : { category },
							...source === void 0 ? {} : { source },
							...intent === void 0 ? {} : { intent }
						}, request.signal);
						return evidence(request, result.results, result.results.length === 0 ? result.hint : void 0);
					}
					if (request.route.sourceRouteId === "related") {
						const id = memoryInputText(input.id, "id", 2e3);
						const requestedSpace = memoryInputText(input.memoryBodyId, "memoryBodyId", 300, false);
						const admitted = admittedByView.get(request.view.id);
						const owners = [...admitted?.entries() ?? []].filter(([reference]) => reference.endsWith("/" + id)).map(([, bodyId]) => bodyId);
						const owner = requestedSpace === void 0 ? owners.length === 1 ? owners[0] : void 0 : admitted?.get(requestedSpace + "/" + id);
						if (owner === void 0) throw new Error("related-memory traversal requires evidence already admitted by this View");
						if (!allowedBodies.includes(owner)) throw new Error("related-memory owner is outside this View ReadGrant");
						const edge = memoryInputText(input.edge, "edge", 30, false);
						if (edge !== void 0 && !EDGES.has(edge)) throw new Error(`unsupported edge: ${edge}`);
						const results = await service.related(id, memoryInputInteger(input.depth, 2, 1, 5), edge, request.signal, owner);
						return evidence(request, results);
					}
					throw new Error(`unsupported Memory Spaces Route: ${request.route.sourceRouteId}`);
				},
				async mutate(request) {
					const input = memoryInputRecord(request.input, `Memory Spaces ${request.offer.sourceActionId}`);
					if (!service.config.writeEnabled) throw new Error("Memory Spaces is configured read-only");
					const grant = request.grant;
					if (grant === void 0) throw new Error("Memory Spaces action has no View ReadGrant");
					const allowedBodies = grantIds(grant);
					const knownBodies = memoryInputStringArray(memoryInputRecord(grant.value, "Memory Spaces scope").knownMemoryBodyIds, "knownMemoryBodyIds", 1e4) ?? allowedBodies;
					const created = createdByView.get(request.view.id) ?? /* @__PURE__ */ new Set();
					const writeBodies = [.../* @__PURE__ */ new Set([...knownBodies, ...created])];
					const admittedOwner = (id) => {
						const requestedSpace = memoryInputText(input.memoryBodyId, "memoryBodyId", 300, false);
						const entries = admittedByView.get(request.view.id);
						if (requestedSpace !== void 0) return entries?.get(requestedSpace + "/" + id);
						const owners = [...entries?.entries() ?? []].filter(([reference]) => reference.endsWith("/" + id)).map(([, owner]) => owner);
						return owners.length === 1 ? owners[0] : void 0;
					};
					let result;
					let bodyId;
					if (request.offer.sourceActionId === "manage-spaces") {
						if (input.operation === "create") {
							const selection = input.selection === void 0 ? void 0 : memoryInputRecord(input.selection, "placement selection");
							const body = await service.createSpaceForPersistence(createSpaceRequest(input.request), selection === void 0 ? void 0 : {
								providerId: memoryInputText(selection.providerId, "providerId", 128),
								reason: memoryInputText(selection.reason, "reason", 4e3),
								confidence: memoryInputText(selection.confidence, "confidence", 40)
							}, request.signal);
							created.add(body.id);
							createdByView.set(request.view.id, created);
							while (createdByView.size > 128) createdByView.delete(createdByView.keys().next().value);
							bodyId = body.id;
							result = {
								action: "created",
								memoryBodyId: body.id,
								name: body.name,
								description: body.description
							};
						} else if (input.operation === "update") {
							bodyId = memoryInputText(input.memoryBodyId, "memoryBodyId", 300);
							if (!writeBodies.includes(bodyId)) throw new Error("Memory Space update is outside this View scope");
							const body = service.updateSpace(bodyId, {
								...input.name === void 0 ? {} : { name: memoryInputText(input.name, "name", 100) },
								...input.description === void 0 ? {} : { description: memoryInputText(input.description, "description", 1e3) },
								...typeof input.active === "boolean" ? { active: input.active } : {}
							});
							result = {
								action: "updated",
								memoryBodyId: body.id,
								name: body.name,
								description: body.description,
								active: body.active
							};
						} else if (input.operation === "merge") {
							const target = memoryInputText(input.targetMemoryBodyId, "targetMemoryBodyId", 300);
							const sources = memoryInputStringArray(input.sourceMemoryBodyIds, "sourceMemoryBodyIds", 20) ?? [];
							if ([target, ...sources].some((id) => !writeBodies.includes(id))) throw new Error("Memory Space merge is outside this View scope");
							bodyId = target;
							result = await service.mergeSpaces(target, sources, input.deactivateSources !== false, request.signal);
						} else throw new Error("unsupported Memory Space management action");
					} else if (request.offer.sourceActionId === "remember") {
						bodyId = memoryInputText(input.memoryBodyId, "memoryBodyId", 300, false);
						if (bodyId === void 0) {
							const defaults = [.../* @__PURE__ */ new Set([...allowedBodies, ...created])];
							if (defaults.length !== 1) throw new Error("remember requires an explicit Memory Space in this View scope");
							bodyId = defaults[0];
						}
						if (!writeBodies.includes(bodyId)) throw new Error("remember destination is outside this View scope");
						const category = memoryInputText(input.category, "category", 30, false);
						const source = memoryInputText(input.source, "source", 30, false);
						if (category !== void 0 && !CATEGORIES.has(category)) throw new Error(`unsupported category: ${category}`);
						if (source !== void 0 && !SOURCES.has(source)) throw new Error(`unsupported source: ${source}`);
						result = await service.remember({
							content: memoryInputText(input.content, "content", 1e5),
							...category === void 0 ? {} : { category },
							...source === void 0 ? {} : { source },
							...typeof input.importance !== "number" ? {} : { importance: input.importance },
							...input.tags === void 0 ? {} : { tags: memoryInputStringArray(input.tags, "tags") ?? [] },
							...input.entities === void 0 ? {} : { entities: memoryInputStringArray(input.entities, "entities") ?? [] },
							...bodyId === void 0 ? {} : { memoryBodyId: bodyId }
						}, request.signal);
					} else if (request.offer.sourceActionId === "link") {
						const sourceId = memoryInputText(input.sourceId, "sourceId", 2e3);
						const targetId = memoryInputText(input.targetId, "targetId", 2e3);
						const sourceSpace = admittedOwner(sourceId);
						const targetSpace = admittedOwner(targetId);
						if (sourceSpace === void 0 || targetSpace === void 0 || sourceSpace !== targetSpace || !allowedBodies.includes(sourceSpace)) throw new Error("link requires two evidence items admitted by this View from the same Memory Space");
						bodyId = sourceSpace;
						const edge = memoryInputText(input.type, "type", 30, false);
						if (edge !== void 0 && !EDGES.has(edge)) throw new Error(`unsupported edge: ${edge}`);
						const weight = typeof input.weight === "number" ? input.weight : .5;
						result = await service.link(sourceId, targetId, edge, weight, memoryInputText(input.reason, "reason", 1e3, false), request.signal, bodyId);
					} else if (request.offer.sourceActionId === "forget") {
						const id = memoryInputText(input.id, "id", 2e3);
						bodyId = admittedOwner(id);
						if (bodyId === void 0 || !allowedBodies.includes(bodyId)) throw new Error("forget requires evidence already admitted by this View");
						result = await service.forget(id, request.signal, bodyId);
					} else throw new Error(`unsupported Memory Spaces action: ${request.offer.sourceActionId}`);
					return createMemoryMutationReceipt(request.view.id, request.offer.id, context.sourceInstanceKey, service.memoryRevision(), {
						memoryBodyId: bodyId ?? null,
						result
					}, mutationResultCompletion(result));
				},
				manage(request) {
					return manageMemorySpaces(service, request);
				},
				async dispose() {
					admittedByView.clear();
					createdByView.clear();
					await service.dispose();
				}
			};
		}
	});
}
/** Empty template; actual installations must provide explicit Provider children. */
//#endregion
//#region src/index.ts
const name = "dsh-mnemon-source-memory-spaces";
const inject = ["mnemonMemory"];
const memoryPlugin = defineMemoryPlugin({
	packageName: name,
	label: {
		en: "Memory Spaces",
		"zh-CN": "记忆空间"
	},
	description: {
		en: "Durable evidence backed by explicitly configured Provider children.",
		"zh-CN": "由显式配置的 Provider 子插件承载的长期证据。"
	},
	roles: ["source"],
	provides: [{ id: "source" }, { id: "source.durable-evidence" }]
});
const MemorySpaceProviderDeclarationSchema = z.object({
	use: z.string().required(),
	instanceId: z.string(),
	config: z.any()
});
const Config = z.intersect([MemorySpacesConfig, z.object({ providers: z.array(z.union([z.string(), MemorySpaceProviderDeclarationSchema])).default([]) })]);
function sourceInstanceId(ctx, explicit) {
	const configured = explicit?.trim();
	if (configured !== void 0 && configured !== "") return configured;
	const located = (typeof ctx.get === "function" ? ctx.get("loader", false) : void 0)?.locate(ctx.fiber)?.trim();
	if (located !== void 0 && located !== "") return located;
	const entryId = ctx.fiber.entry?.options?.id;
	if (typeof entryId === "string" && entryId.trim() !== "") return entryId.trim();
	throw new Error("Memory Spaces requires a stable Loader Entry id; pass instanceId for a direct mount");
}
function importedProviderModule(loader, value, specifier) {
	const unwrapped = loader.unwrapExports?.(value) ?? (typeof value === "object" && value !== null && "default" in value ? value.default : value);
	if (typeof unwrapped !== "object" || unwrapped === null) throw new Error(`Memory Space Provider module ${specifier} did not export a typed child module`);
	return defineMemorySpaceProvider(unwrapped);
}
/** Resolve only the explicitly listed children; no dependency scanning occurs. */
async function resolveMemorySpaceProviderEntries(ctx, declarations) {
	if (declarations.length === 0) throw new Error("Memory Spaces requires at least one explicit Provider child");
	const loader = typeof ctx.get === "function" ? ctx.get("loader", false) : void 0;
	const entries = [];
	const instanceIds = /* @__PURE__ */ new Set();
	for (const declaration of declarations) {
		const use = (typeof declaration === "string" ? declaration : declaration.use).trim();
		if (use === "") throw new Error("Memory Space Provider declaration use is required");
		if (loader?.import === void 0) throw new Error("cannot resolve installed Memory Space Provider module without the DSH Loader: " + use);
		const module = importedProviderModule(loader, await loader.import(use), use);
		const entry = {
			instanceId: typeof declaration === "string" ? module.id : declaration.instanceId?.trim() || module.id,
			module,
			config: typeof declaration === "string" ? void 0 : declaration.config
		};
		if (instanceIds.has(entry.instanceId)) throw new Error(`duplicate Memory Space Provider child: ${entry.instanceId}`);
		instanceIds.add(entry.instanceId);
		entries.push(entry);
	}
	return entries;
}
/** Compose an explicit Provider child list into one effective Source. */
async function installMemorySpaces(ctx, entries, options = {}) {
	if (entries.length === 0) throw new Error("Memory Spaces requires at least one explicit Provider child");
	const entryId = sourceInstanceId(ctx, options.instanceId);
	resolveMemorySpacesConfig(options.config, entryId);
	const privateHost = new PrivateMemorySpaceProviderHost(entryId);
	const children = [];
	try {
		for (const entry of entries) children.push(ctx.plugin(createMemorySpaceProviderPlugin(entry, privateHost), entry.config));
		await Promise.all(children.map((child) => child.await()));
		for (const entry of entries) if (!privateHost.has(entry.instanceId)) throw new Error(`Memory Space Provider child did not install a definition: ${entry.instanceId}`);
		const snapshot = privateHost.snapshot();
		installMemory(ctx, {
			plugin: memoryPlugin,
			sources: [createMemorySpacesSource(snapshot, options.config)]
		}, {
			instanceId: entryId,
			effectiveDigest: "providers:" + memoryConfigurationDigest({
				providers: snapshot.digest,
				config: options.config ?? {}
			}).slice(7)
		});
	} catch (error) {
		await Promise.allSettled(children.reverse().map((child) => child.dispose()));
		throw error;
	}
}
async function apply(ctx, config = { providers: [] }) {
	const { providers, ...sourceConfig } = config;
	await installMemorySpaces(ctx, await resolveMemorySpaceProviderEntries(ctx, providers), { config: sourceConfig });
}
//#endregion
export { Config, MemorySpaceProviderDeclarationSchema, apply, inject, installMemorySpaces, memoryPlugin, name, resolveEmbedding, resolveMemorySpaceProviderEntries, resolvePersistenceStrategy, resolveRecallQuality };
