//#endregion
//#region src/descriptor.ts
/** Browser-safe metadata owned by this Provider. */
const descriptor = {
	"id": "supermemory",
	"label": "Supermemory",
	"icon": {
		"kind": "data-url",
		"value": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMCAyNCIgZmlsbD0ibm9uZSI+CiAgPHBhdGggZD0iTTI5LjMzODggOS40Njc2N0gxOC40NDhWMC4wMDE0NjQ4NEgxNC45MjkzVjEwLjI3MjVDMTQuOTI5MyAxMS4zNjM0IDE1LjM2IDEyLjQxMSAxNi4xMjU0IDEzLjE4M0wyNS4wMTggMjIuMTUxTDI3LjUwNiAxOS42NDE5TDIwLjkzOCAxMy4wMTgzSDI5LjM0MDhWOS40Njk3NUwyOS4zMzg4IDkuNDY3NjdaIiBmaWxsPSIjMEIxMDE1Ii8+CiAgPHBhdGggZD0iTTEuODI4MzkgNC4zNjA1Nkw4LjM5NjMzIDEwLjk4NDJILTAuMDA2NDY5NzNWMTQuNTMyOEgxMC44ODQzVjIzLjk5OUgxNC40MDNWMTMuNzI4QzE0LjQwMyAxMi42MzcgMTMuOTcyMyAxMS41ODk0IDEzLjIwNjkgMTAuODE3NUw0LjMxNjM1IDEuODUxNDdMMS44MjgzOSA0LjM2MDU2WiIgZmlsbD0iIzBCMTAxNSIvPgo8L3N2Zz4K"
	},
	"kind": "remote",
	"workspaceBinding": "provider-global",
	"summary": "Semantic memory, persistent profiles, conversation ingest, and multi-container recall.",
	"summaryI18nKey": "overview.providerSummary.supermemory",
	"origin": "third-party",
	"capabilities": {
		"search": true,
		"browse": true,
		"graph": false,
		"entities": false,
		"related": false,
		"remember": true,
		"link": false,
		"forget": true,
		"writeMode": "async-extracting",
		"deletionMode": "soft"
	},
	"fields": [
		{
			"key": "endpoint",
			"label": "Endpoint",
			"scope": "service",
			"input": "url",
			"required": true,
			"defaultValue": "https://api.supermemory.ai",
			"i18nKey": "overview.providerEndpoint"
		},
		{
			"key": "apiKey",
			"label": "API key",
			"scope": "service",
			"input": "secret",
			"required": true,
			"i18nKey": "overview.providerApiKey"
		},
		{
			"key": "containerTag",
			"label": "Container tag",
			"scope": "memory",
			"input": "text",
			"required": true,
			"defaultValue": "dsh",
			"maxLength": 100,
			"pattern": "^[a-zA-Z0-9_:-]+$",
			"i18nKey": "overview.providerField.containerTag"
		},
		{
			"key": "searchMode",
			"label": "Search mode",
			"scope": "memory",
			"input": "select",
			"required": true,
			"defaultValue": "hybrid",
			"options": [
				{
					"value": "hybrid",
					"label": "Hybrid",
					"i18nKey": "overview.providerOption.hybrid"
				},
				{
					"value": "memories",
					"label": "Memories",
					"i18nKey": "overview.providerOption.memories"
				},
				{
					"value": "documents",
					"label": "Documents",
					"i18nKey": "overview.providerOption.documents"
				}
			],
			"i18nKey": "overview.providerField.searchMode"
		}
	]
};
//#endregion
export { descriptor as t };
