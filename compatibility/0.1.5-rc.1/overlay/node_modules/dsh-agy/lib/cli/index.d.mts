import { Command } from "commander";
//#region src/oauth/constants.d.ts
/** Default loopback callback used by the standalone CLI listener (fixed port, like opencode). */
declare const AGY_DEFAULT_REDIRECT_URI = "http://localhost:51121/oauth-callback";
//#endregion
//#region src/cli/index.d.ts
declare function createProgram(): Command;
//#endregion
export { AGY_DEFAULT_REDIRECT_URI, createProgram };
//# sourceMappingURL=index.d.mts.map