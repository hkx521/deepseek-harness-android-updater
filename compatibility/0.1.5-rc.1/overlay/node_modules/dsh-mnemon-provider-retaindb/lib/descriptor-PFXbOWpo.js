//#endregion
//#region src/descriptor.ts
/** Browser-safe metadata owned by this Provider. */
const descriptor = {
	"id": "retaindb",
	"label": "RetainDB",
	"icon": {
		"kind": "data-url",
		"value": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHJ4PSIxMSIgZmlsbD0iI0Y4RjVFRiIvPgogIDxyZWN0IHg9IjExIiB5PSI3IiAgd2lkdGg9IjI2IiBoZWlnaHQ9IjUuNSIgcng9IjIuNzUiIGZpbGw9IiMwRDBCMDkiLz4KICA8cmVjdCB4PSIxMSIgeT0iMTYiIHdpZHRoPSIyNiIgaGVpZ2h0PSI1LjUiIHJ4PSIyLjc1IiBmaWxsPSIjMEQwQjA5Ii8+CiAgPHJlY3QgeD0iMTEiIHk9IjI1IiB3aWR0aD0iMTYiIGhlaWdodD0iNS41IiByeD0iMi43NSIgZmlsbD0iIzBEMEIwOSIvPgogIDxyZWN0IHg9IjExIiB5PSIzNCIgd2lkdGg9IjI2IiBoZWlnaHQ9IjUuNSIgcng9IjIuNzUiIGZpbGw9IiMwRDBCMDkiLz4KPC9zdmc+Cg=="
	},
	"kind": "remote",
	"workspaceBinding": "provider-global",
	"summary": "Cloud memory with hybrid vector/BM25 retrieval, profiles, and typed durable facts.",
	"summaryI18nKey": "overview.providerSummary.retaindb",
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
		"writeMode": "exact",
		"deletionMode": "hard"
	},
	"fields": [
		{
			"key": "endpoint",
			"label": "Endpoint",
			"scope": "service",
			"input": "url",
			"required": true,
			"defaultValue": "https://api.retaindb.com",
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
			"key": "project",
			"label": "Project",
			"scope": "memory",
			"input": "text",
			"required": true,
			"defaultValue": "dsh",
			"i18nKey": "overview.providerField.project"
		},
		{
			"key": "userId",
			"label": "User ID",
			"scope": "memory",
			"input": "text",
			"required": true,
			"defaultValue": "dsh-user",
			"i18nKey": "overview.providerField.userId"
		}
	]
};
//#endregion
export { descriptor as t };
