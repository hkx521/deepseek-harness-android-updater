import { a as MemoryProviderCatalog, n as PrivateMemorySpaceProviderHost, t as createMemorySpaceProviderPlugin } from "./plugin-DlsNeZbQ.js";
import { n as deepFreeze } from "./definitions-DfmOqJjR.js";
import { Context } from "@deepseek-ai/cordis";
//#region src/testing.ts
/** Real private-child registration and factory validation, without exposing its Host/Registry. */
async function mountMemorySpaceProvider(module, options) {
	const context = new Context();
	const host = new PrivateMemorySpaceProviderHost(options.sourceInstanceId ?? "test-memory-spaces");
	const instanceId = options.instanceId ?? module.id;
	const plugin = createMemorySpaceProviderPlugin({
		instanceId,
		module,
		config: options.config
	}, host);
	const bound = {
		...plugin,
		apply: (ctx, config) => plugin.apply(ctx, config)
	};
	const child = context.plugin(bound, options.config);
	try {
		await child.await();
		if (!host.has(instanceId)) throw new Error(`Memory Space Provider child did not install a definition: ${instanceId}`);
		const snapshot = host.snapshot();
		const adapters = /* @__PURE__ */ new Set();
		let closing;
		return Object.freeze({
			get registered() {
				return host.has(instanceId);
			},
			descriptor: deepFreeze(snapshot.descriptors()[0]),
			manifest: snapshot.entries[0].definition.manifest,
			createAdapter: (input) => {
				if (closing !== void 0) throw new Error("Memory Space Provider test is disposed");
				const adapter = snapshot.adapterRegistry().create(input).get(instanceId);
				adapters.add(adapter);
				return adapter;
			},
			dispose: () => {
				closing ??= Promise.resolve().then(async () => {
					const failures = [];
					for (const adapter of adapters) try {
						await adapter.dispose?.();
					} catch (error) {
						failures.push(error);
					}
					adapters.clear();
					try {
						await context.fiber.dispose();
					} catch (error) {
						failures.push(error);
					}
					if (failures.length > 0) throw new AggregateError(failures, "Memory Space Provider test cleanup failed");
				});
				return closing;
			}
		});
	} catch (error) {
		await context.fiber.dispose();
		throw error;
	}
}
/** Driver fixture only: real descriptor validation, no Core or service singleton. */
function createMemorySpaceProviderFixture(descriptor, input = {}, options) {
	const instanceId = options.instanceId ?? descriptor.id;
	const catalog = new MemoryProviderCatalog([{
		...descriptor,
		id: instanceId,
		...instanceId === descriptor.id ? {} : { typeId: descriptor.id }
	}]);
	const connection = catalog.normalize(instanceId, input);
	const publicConnection = catalog.public(instanceId, connection);
	const body = {
		id: options.memoryBodyId ?? "test-memory",
		name: "Test memory",
		description: "Provider-owned test fixture",
		active: true,
		dbPath: "",
		createdAt: "2026-08-30T00:00:00.000Z",
		updatedAt: "2026-08-30T00:00:00.000Z",
		provider: {
			id: instanceId,
			...instanceId === descriptor.id ? {} : { typeId: descriptor.id },
			label: descriptor.label,
			kind: descriptor.kind,
			origin: descriptor.origin,
			location: String(connection.endpoint ?? options.dataDir),
			apiKeyConfigured: publicConnection.configuredSecrets.includes("apiKey"),
			...publicConnection,
			capabilities: structuredClone(descriptor.capabilities)
		}
	};
	return {
		body,
		authority: {
			runner: { effectiveDataDir: () => options.dataDir },
			list: () => [body],
			providerConnection(id, expectedProviderId) {
				if (id !== body.id || expectedProviderId !== void 0 && expectedProviderId !== instanceId) throw new Error("Provider attempted to cross its test authority boundary");
				return structuredClone(connection);
			}
		},
		connection
	};
}
//#endregion
export { createMemorySpaceProviderFixture, mountMemorySpaceProvider };
