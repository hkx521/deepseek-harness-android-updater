//#endregion
//#region src/descriptor.ts
/** Browser-safe metadata owned by this Provider. */
const descriptor = {
	"id": "holographic",
	"label": "Holographic",
	"icon": {
		"kind": "data-url",
		"value": "data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMzYgMzYiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjM2IiBoZWlnaHQ9IjM2IiByeD0iOSIgZmlsbD0iIzE1MTcyOSIvPjxwYXRoIGQ9Ik0xOCA3LjUgMjguNSAxOCAxOCAyOC41IDcuNSAxOCAxOCA3LjVaIiBzdHJva2U9IiNBRUI3RkYiIHN0cm9rZS13aWR0aD0iMS41Ii8+PHBhdGggZD0iTTE4IDExLjUgMjQuNSAxOCAxOCAyNC41IDExLjUgMTggMTggMTEuNVoiIHN0cm9rZT0iIzdGOENGNCIgc3Ryb2tlLXdpZHRoPSIxLjUiLz48Y2lyY2xlIGN4PSIxOCIgY3k9IjE4IiByPSIyLjc1IiBmaWxsPSIjRENFMEZGIi8+PC9zdmc+"
	},
	"kind": "local",
	"workspaceBinding": "optional-override",
	"summary": "Local structured fact memory with trust scoring, entity resolution, and compositional retrieval.",
	"summaryI18nKey": "overview.providerSummary.holographic",
	"origin": "third-party",
	"capabilities": {
		"search": true,
		"browse": true,
		"graph": true,
		"entities": true,
		"related": true,
		"remember": true,
		"link": false,
		"forget": true,
		"writeMode": "exact",
		"deletionMode": "hard"
	},
	"fields": [
		{
			"key": "dataPath",
			"label": "Fact store path",
			"scope": "service",
			"role": "global-location",
			"input": "path",
			"required": false,
			"i18nKey": "overview.providerField.dataPath"
		},
		{
			"key": "defaultTrust",
			"label": "Default trust",
			"scope": "memory",
			"input": "number",
			"required": true,
			"defaultValue": .5,
			"min": 0,
			"max": 1,
			"i18nKey": "overview.providerField.defaultTrust"
		},
		{
			"key": "minTrust",
			"label": "Minimum recall trust",
			"scope": "memory",
			"input": "number",
			"required": true,
			"defaultValue": .3,
			"min": 0,
			"max": 1,
			"i18nKey": "overview.providerField.minTrust"
		}
	]
};
//#endregion
export { descriptor as t };
