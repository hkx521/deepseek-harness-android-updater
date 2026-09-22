import { MemoryProviderConnection, MemoryProviderDescriptor, MemorySpace } from "./contracts.js";
import { f as MemoryProviderAdapter, h as MemorySpaceAuthority, o as MemorySpaceProviderManifest, p as MemoryProviderAdapterFactoryContext, s as MemorySpaceProviderModule } from "./definitions-C5y84OE6.js";
//#region src/testing.d.ts
interface MemorySpaceProviderTest {
  readonly registered: boolean;
  readonly descriptor: MemoryProviderDescriptor;
  readonly manifest: MemorySpaceProviderManifest;
  createAdapter(context: MemoryProviderAdapterFactoryContext): MemoryProviderAdapter;
  dispose(): Promise<void>;
}
/** Real private-child registration and factory validation, without exposing its Host/Registry. */
declare function mountMemorySpaceProvider<C>(module: MemorySpaceProviderModule<C>, options: {
  instanceId?: string;
  sourceInstanceId?: string;
  config: C;
}): Promise<MemorySpaceProviderTest>;
/** Driver fixture only: real descriptor validation, no Core or service singleton. */
declare function createMemorySpaceProviderFixture(descriptor: MemoryProviderDescriptor, input: MemoryProviderConnection | undefined, options: {
  dataDir: string;
  instanceId?: string;
  memoryBodyId?: string;
}): {
  body: MemorySpace;
  authority: MemorySpaceAuthority;
  connection: MemoryProviderConnection;
};
//#endregion
export { MemorySpaceProviderTest, createMemorySpaceProviderFixture, mountMemorySpaceProvider };