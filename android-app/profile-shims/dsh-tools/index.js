const target = process.env.DSH_TOOLS_MODULE
  || new URL("../../../../../../dshroot/lib/node_modules/@deepseek-ai/dsh-tools/lib/index.js", import.meta.url).href;
const tools = await import(target);

export const defineTool = tools.defineTool;
export default tools.default;
