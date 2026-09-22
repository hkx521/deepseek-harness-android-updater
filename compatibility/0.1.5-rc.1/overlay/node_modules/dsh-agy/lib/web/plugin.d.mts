import { Context } from "@deepseek-ai/cordis";
//#region src/web/plugin.d.ts
declare const name = "dsh-agy-web";
declare const inject: string[];
declare function apply(ctx: Context): void;
//#endregion
export { apply, inject, name };
//# sourceMappingURL=plugin.d.mts.map