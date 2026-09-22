//#region src/native-cli.d.ts
/** Execute JavaScript with the Host binary even when it is Electron's GUI executable. */
declare function nodeLauncherEnvironment(environment?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
declare function mnemonNpmLauncher(command: string): string | undefined;
interface CommandDiscoveryOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  isExecutable?: (path: string) => boolean;
}
declare function isMnemonExecutable(path: string, platform?: NodeJS.Platform): boolean;
/** Locate the local Mnemon binary without invoking a shell. */
declare function findMnemonCommand(config: {
  cliPath?: string | undefined;
}, options?: CommandDiscoveryOptions): string | undefined;
//#endregion
export { CommandDiscoveryOptions, findMnemonCommand, isMnemonExecutable, mnemonNpmLauncher, nodeLauncherEnvironment };