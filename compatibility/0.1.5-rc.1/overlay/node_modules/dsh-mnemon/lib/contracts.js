//#region src/core/contracts/plugin.ts
/** Declarative identity and graph relations shared by every Mnemon plugin. */
const MEMORY_PLUGIN_API_VERSION = "dsh-mnemon/plugin/v1";
//#endregion
//#region src/core/contracts/view.ts
const COMPOSABLE_MEMORY_API_VERSION = "dsh-mnemon/v1";
const DEFAULT_MEMORY_VIEW_BUDGET = Object.freeze({
	maxProjectionCharacters: 65536,
	maxRoutes: 16,
	maxActions: 16,
	maxEvidenceResults: 16,
	maxEvidenceCharacters: 16384
});
//#endregion
//#region src/core/contracts/index.ts
const MEMORY_CAPABILITIES = [
	"status",
	"project",
	"recall",
	"search",
	"read",
	"browse",
	"write",
	"archive",
	"graph",
	"related",
	"link",
	"forget",
	"maintain",
	"export",
	"import"
];
const MEMORY_SOURCE_MODES = ["eager", "routed"];
//#endregion
export { COMPOSABLE_MEMORY_API_VERSION, DEFAULT_MEMORY_VIEW_BUDGET, MEMORY_CAPABILITIES, MEMORY_PLUGIN_API_VERSION, MEMORY_SOURCE_MODES };
