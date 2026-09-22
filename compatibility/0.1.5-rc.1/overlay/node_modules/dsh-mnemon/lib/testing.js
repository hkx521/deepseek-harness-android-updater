import { t as provideMemoryRuntime } from "./runtime-AtIOTeP1.js";
import { DEFAULT_MEMORY_VIEW_BUDGET } from "./contracts.js";
import { c as jsonClone } from "./definitions-j0FLgE0-.js";
import { Context } from "@deepseek-ai/cordis";
import { readFileSync } from "node:fs";
//#region src/sdk/testing.ts
/**
* A test fixture, not a production service or a second Loader. It mounts real
* Cordis Fibers against the same Runtime/compiler used by the Host. The small
* Loader identity adapter supplies only stable Entry ids for installMemory.
* No built-in Source, Provider, database, browser, or private binding is needed.
*/
var MemoryCompositionRunner = class {
	context = new Context();
	#runtime = provideMemoryRuntime(this.context);
	#generations;
	#entryIds = /* @__PURE__ */ new WeakMap();
	#entries = /* @__PURE__ */ new Map();
	#turns = /* @__PURE__ */ new Set();
	#beginnings = /* @__PURE__ */ new Set();
	#closed = false;
	#closing;
	constructor(options = {}) {
		this.context.provide("loader", {
			locate: (fiber) => this.#entryIds.get(fiber),
			import: (specifier) => import(specifier),
			unwrapExports: (module) => module.default ?? module
		});
		const { sourceConfiguration, sourceCapabilities, ...selection } = options;
		this.#generations = this.#runtime.attachGeneration({
			...selection,
			...sourceConfiguration === void 0 ? {} : { sourceConfiguration: (source) => sourceConfiguration(Object.freeze({
				sourceInstanceKey: source.instanceKey,
				manifest: source.definition.manifest,
				provenance: source.provenance
			})) },
			...sourceCapabilities === void 0 ? {} : { sourceCapabilities: (source) => sourceCapabilities(Object.freeze({
				sourceInstanceKey: source.instanceKey,
				manifest: source.definition.manifest,
				provenance: source.provenance
			})) }
		}).host;
	}
	async mount(plugin, entry) {
		this.#assertOpen();
		const id = entry.instanceId.trim();
		if (id === "" || this.#entries.has(id)) throw new Error(`duplicate or empty test Entry id: ${id}`);
		const boundPlugin = {
			...plugin,
			apply: (ctx, config) => {
				this.#entryIds.set(ctx.fiber, id);
				return plugin.apply(ctx, config);
			}
		};
		const fiber = this.context.plugin(boundPlugin, entry.config);
		this.#entries.set(id, fiber);
		try {
			await fiber.await();
			this.#assertOpen();
		} catch (error) {
			if (this.#entries.get(id) === fiber) this.#entries.delete(id);
			await fiber.dispose();
			throw error;
		}
		return async () => {
			if (this.#entries.get(id) !== fiber) return;
			this.#entries.delete(id);
			await fiber.dispose();
		};
	}
	async beginTurn(request = {}, signal) {
		this.#assertOpen();
		signal?.throwIfAborted();
		const budget = { ...request.budget ?? DEFAULT_MEMORY_VIEW_BUDGET };
		const lease = this.#generations.acquire();
		const controller = new AbortController();
		const abort = () => controller.abort(signal.reason);
		signal?.addEventListener("abort", abort, { once: true });
		this.#beginnings.add(controller);
		try {
			const view = await lease.generation.compose({
				scope: request.scope ?? { storage: "custom" },
				scenario: request.scenario ?? "plugin-test",
				budget
			}, controller.signal);
			this.#assertOpen();
			let active = true;
			const assertActive = () => {
				this.#assertOpen();
				if (!active) throw new Error("Memory test turn is released");
			};
			const release = () => {
				if (!active) return;
				active = false;
				this.#turns.delete(release);
				lease.release();
			};
			this.#turns.add(release);
			return Object.freeze({
				view,
				executeRoute: async (routeId, input, signal) => {
					assertActive();
					const operation = this.#generations.acquire(lease.id);
					try {
						return await operation.generation.executeRoute(view, routeId, input, signal, budget);
					} finally {
						operation.release();
					}
				},
				executeAction: async (offerId, input, authorize, signal) => {
					assertActive();
					const operation = this.#generations.acquire(lease.id);
					try {
						return await operation.generation.executeAction(view, offerId, input, authorize, signal);
					} finally {
						operation.release();
					}
				},
				release
			});
		} catch (error) {
			lease.release();
			throw error;
		} finally {
			signal?.removeEventListener("abort", abort);
			this.#beginnings.delete(controller);
		}
	}
	inspect() {
		return jsonClone(this.#generations.inspect(), "memory test diagnostics");
	}
	async managementCatalog(scope = { storage: "custom" }) {
		this.#assertOpen();
		const lease = this.#generations.acquire();
		try {
			return await lease.generation.managementCatalog(scope);
		} finally {
			lease.release();
		}
	}
	/** Exercise the public protocol, including rejected confirmation/revision cases. */
	async executeManagement(request) {
		this.#assertOpen();
		const lease = this.#generations.acquire();
		try {
			return await lease.generation.executeManagement(request);
		} finally {
			lease.release();
		}
	}
	/** Same scoped management contract a Source page receives, backed by real generations. */
	async managementClient(sourceInstanceKey, scopeValue = { storage: "custom" }) {
		const scope = structuredClone(scopeValue);
		const instance = (await this.managementCatalog(scope)).sources.find((source) => source.sourceInstanceKey === sourceInstanceKey);
		if (instance === void 0) throw new Error(`No managed test Source: ${sourceInstanceKey}`);
		let revision = instance.revision;
		const execute = async (mode, operation, input, options) => {
			const result = await this.executeManagement({
				sourceInstanceKey,
				scope,
				mode,
				operation,
				input,
				confirmed: options?.confirmed === true,
				...mode === "read" ? {} : { expectedRevision: options?.expectedRevision ?? revision }
			});
			revision = result.revision;
			return result;
		};
		return {
			sourceInstanceKey,
			get revision() {
				return revision;
			},
			read: (operation, input = null) => execute("read", operation, input),
			mutate: (operation, input, options) => execute("mutate", operation, input, options)
		};
	}
	dispose() {
		if (this.#closing !== void 0) return this.#closing;
		this.#closed = true;
		for (const controller of this.#beginnings) controller.abort(/* @__PURE__ */ new Error("MemoryCompositionRunner is disposed"));
		for (const release of this.#turns) release();
		this.#closing = (async () => {
			const failures = [];
			for (const fiber of [...this.#entries.values()].reverse()) try {
				await fiber.dispose();
			} catch (error) {
				failures.push(error);
			}
			this.#entries.clear();
			try {
				await this.context.fiber.dispose();
			} catch (error) {
				failures.push(error);
			}
			if (failures.length > 0) throw new AggregateError(failures, "MemoryCompositionRunner cleanup failed");
		})();
		return this.#closing;
	}
	#assertOpen() {
		if (this.#closed) throw new Error("MemoryCompositionRunner is disposed");
	}
};
/**
* Evaluate a trusted, already-built DSH Client artifact in a test. Dependencies
* are explicit (normally the test's React and UI primitives), so no production
* Loader, global registry, source alias, or second copy of React is required.
* This is a test fixture, not another Client Loader implementation.
*/
function loadMemoryClientArtifact(path, dependencies) {
	let declaration;
	const loader = { load(value) {
		if (declaration !== void 0 || value === void 0 || typeof value.id !== "string" || typeof value.factory !== "function") throw new Error("Expected exactly one DSH Client artifact declaration");
		declaration = value;
	} };
	const actualWindow = globalThis.window ?? {};
	const window = new Proxy(actualWindow, { get(target, key) {
		if (key === "__ModuleLoader__") return loader;
		const value = Reflect.get(target, key, target);
		return typeof value === "function" ? value.bind(target) : value;
	} });
	new Function("window", readFileSync(path, "utf8"))(window);
	if (declaration === void 0) throw new Error("No DSH Client declaration in artifact");
	return declaration.factory((id) => {
		if (!Object.hasOwn(dependencies, id)) throw new Error(`Missing Client test dependency: ${id}`);
		return dependencies[id];
	});
}
//#endregion
export { DEFAULT_MEMORY_VIEW_BUDGET, MemoryCompositionRunner, loadMemoryClientArtifact };
