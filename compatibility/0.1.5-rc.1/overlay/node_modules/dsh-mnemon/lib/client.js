window.__ModuleLoader__.load({
	id: "dsh-mnemon",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_dom = require("react-dom");
		//#region src/host/view-protocol.ts
		const MNEMON_VIEW_CHANNEL = "/dsh-mnemon-view";
		const MNEMON_VIEW_WRITE_CHANNEL = "/dsh-mnemon-view-settings";
		//#endregion
		//#region src/host/display-mode.ts
		/** Keep the historical misspelling at input boundaries, never in UI or runtime state. */
		function normalizeDisplayMode(value) {
			if (value === void 0 || value === "sidebar") return "sidebar";
			if (value === "builtin" || value === "buildin") return "builtin";
			throw new Error("dsh-mnemon: displayMode must be sidebar or builtin (legacy buildin is accepted)");
		}
		//#endregion
		//#region src/host/protocol.ts
		/** Starter Entry ids remain reserved when DSH nests them under an include. */
		function isDefaultSourceInstance(instanceKey, sourceTypeId) {
			return instanceKey.startsWith("source:") && instanceKey.endsWith(":mnemon-source-" + sourceTypeId);
		}
		const MNEMON_READ_CHANNEL = "/dsh-mnemon-read";
		const MNEMON_ACTIVATION_CHANNEL = "/dsh-mnemon-activation";
		const MNEMON_WRITE_CHANNEL = "/dsh-mnemon-write";
		const MNEMON_PACK_CHANNEL = "/dsh-mnemon-pack";
		const MNEMON_SETTINGS_CHANNEL = "/dsh-mnemon-settings";
		/** DSH API Gateway endpoints used by paired remote Web clients. */
		const MNEMON_REMOTE_CHANNEL = "/api";
		const MNEMON_REMOTE_NAMESPACE = "dshMnemon";
		const MNEMON_REMOTE_READ_ENDPOINT = `${MNEMON_REMOTE_NAMESPACE}/read`;
		const MNEMON_REMOTE_ACTIVATION_ENDPOINT = `${MNEMON_REMOTE_NAMESPACE}/activation`;
		const MNEMON_REMOTE_WRITE_ENDPOINT = `${MNEMON_REMOTE_NAMESPACE}/write`;
		const MNEMON_REMOTE_PACK_ENDPOINT = `${MNEMON_REMOTE_NAMESPACE}/pack`;
		const MNEMON_REMOTE_SETTINGS_ENDPOINT = `${MNEMON_REMOTE_NAMESPACE}/settings`;
		const MNEMON_REMOTE_VIEW_ENDPOINT = `${MNEMON_REMOTE_NAMESPACE}/view`;
		const MNEMON_REMOTE_VIEW_WRITE_ENDPOINT = `${MNEMON_REMOTE_NAMESPACE}/viewWrite`;
		const MNEMON_SETTINGS_NAMESPACE = "mnemon";
		const MNEMON_UI_SETTINGS_NAMESPACE = "mnemon-ui";
		function isWorkspaceStorageScope(scope) {
			return scope === "workspace" || scope === "workspaces";
		}
		const DEFAULT_EMBEDDING_ENDPOINT = "http://localhost:11434";
		const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
		const MNEMON_EMBEDDING_PROTOCOLS = [
			"auto",
			"ollama",
			"openai"
		];
		//#endregion
		//#region src/client/remote-rpc.ts
		const REMOTE_ENDPOINT = /* @__PURE__ */ new Map([
			[MNEMON_READ_CHANNEL, MNEMON_REMOTE_READ_ENDPOINT],
			[MNEMON_ACTIVATION_CHANNEL, MNEMON_REMOTE_ACTIVATION_ENDPOINT],
			[MNEMON_WRITE_CHANNEL, MNEMON_REMOTE_WRITE_ENDPOINT],
			[MNEMON_PACK_CHANNEL, MNEMON_REMOTE_PACK_ENDPOINT],
			[MNEMON_SETTINGS_CHANNEL, MNEMON_REMOTE_SETTINGS_ENDPOINT],
			[MNEMON_VIEW_CHANNEL, MNEMON_REMOTE_VIEW_ENDPOINT],
			[MNEMON_VIEW_WRITE_CHANNEL, MNEMON_REMOTE_VIEW_WRITE_ENDPOINT]
		]);
		function isClientRpcResult(value) {
			if (typeof value !== "object" || value === null || !Object.hasOwn(value, "ok")) return false;
			const candidate = value;
			if (candidate.ok === true) return Object.hasOwn(candidate, "value");
			if (candidate.ok !== false || typeof candidate.error !== "object" || candidate.error === null) return false;
			return typeof candidate.error.message === "string";
		}
		function isLoopbackHostname(hostname) {
			if (hostname === "localhost" || hostname === "[::1]") return true;
			const parts = hostname.split(".");
			return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
		}
		function isRemoteConnection(connection) {
			const hostname = globalThis.location?.hostname;
			return typeof hostname === "string" && hostname !== "" && !isLoopbackHostname(hostname) || connection.isLoopback === false;
		}
		/** Route only paired remote pages through API Gateway; local clients retain legacy channels. */
		async function callMnemonRpc(connection, channel, endpoint, payload, signal) {
			const remoteEndpoint = REMOTE_ENDPOINT.get(channel);
			if (!isRemoteConnection(connection) || remoteEndpoint === void 0) return signal === void 0 ? connection.rpc.call(channel, endpoint, payload) : connection.rpc.call(channel, endpoint, payload, signal);
			const remotePayload = { args: {
				endpoint,
				payload
			} };
			const response = await (signal === void 0 ? connection.rpc.call(MNEMON_REMOTE_CHANNEL, remoteEndpoint, remotePayload) : connection.rpc.call(MNEMON_REMOTE_CHANNEL, remoteEndpoint, remotePayload, signal));
			if (!response.ok) return response;
			if (!isClientRpcResult(response.value)) throw new Error("DSH API Gateway returned an invalid Mnemon response");
			return response.value;
		}
		//#endregion
		//#region src/client/api.ts
		const turnActivityCache = /* @__PURE__ */ new WeakMap();
		async function loadTurnActivities(connection, sessionId, requiredCursor) {
			let sessions = turnActivityCache.get(connection);
			if (sessions === void 0) {
				sessions = /* @__PURE__ */ new Map();
				turnActivityCache.set(connection, sessions);
			}
			const key = sessionId ?? "";
			let entry = sessions.get(key);
			if (entry === void 0) {
				entry = {
					cursor: -1,
					activities: /* @__PURE__ */ new Map()
				};
				sessions.set(key, entry);
			}
			if (entry.cursor >= requiredCursor) return {
				cursor: entry.cursor,
				activities: [...entry.activities.values()]
			};
			if (entry.inFlight !== void 0) {
				const snapshot = await entry.inFlight;
				return snapshot.cursor >= requiredCursor ? snapshot : loadTurnActivities(connection, sessionId, requiredCursor);
			}
			const request = callMnemonRpc(connection, MNEMON_READ_CHANNEL, "turn-activities", sessionId === void 0 ? {} : { sessionId }).then((response) => {
				if (!response.ok) throw new Error(response.error.message);
				const snapshot = response.value;
				entry.cursor = snapshot.cursor;
				entry.activities = new Map(snapshot.activities.map((activity) => [activity.turn, activity]));
				return snapshot;
			}).finally(() => {
				delete entry.inFlight;
			});
			entry.inFlight = request;
			return request;
		}
		var MnemonClient = class {
			connection;
			sessionId;
			workspaceId;
			constructor(connection, sessionId, workspaceId) {
				this.connection = connection;
				this.sessionId = sessionId;
				this.workspaceId = workspaceId;
			}
			async call(channel, endpoint, payload) {
				const response = await callMnemonRpc(this.connection, channel, endpoint, payload);
				if (!response.ok) throw new Error(response.error.message);
				return response.value;
			}
			scoped(payload = {}) {
				return {
					...payload,
					...this.sessionId === void 0 ? {} : { sessionId: this.sessionId },
					...this.workspaceId === void 0 ? {} : { workspaceId: this.workspaceId }
				};
			}
			status() {
				return this.call(MNEMON_READ_CHANNEL, "status", this.scoped());
			}
			statusSummary() {
				return this.call(MNEMON_READ_CHANNEL, "status-summary", this.scoped());
			}
			embeddingStatus() {
				return this.call(MNEMON_READ_CHANNEL, "embedding-status", this.scoped());
			}
			memorySystem() {
				return this.call(MNEMON_READ_CHANNEL, "memory-system", this.scoped());
			}
			viewDashboard() {
				return this.call(MNEMON_VIEW_CHANNEL, "dashboard", this.scoped());
			}
			applyView(configuration) {
				return this.call(MNEMON_VIEW_WRITE_CHANNEL, "apply", this.scoped({
					configuration,
					confirmed: true
				}));
			}
			sourceManagementCatalog() {
				return this.call(MNEMON_READ_CHANNEL, "source-management-catalog", this.scoped());
			}
			readSourceManagement(sourceInstanceKey, operation, input = null) {
				return this.call(MNEMON_READ_CHANNEL, "source-management-read", this.scoped({
					sourceInstanceKey,
					operation,
					input
				}));
			}
			mutateSourceManagement(sourceInstanceKey, operation, input, expectedRevision, confirmed) {
				return this.call(MNEMON_WRITE_CHANNEL, "source-management-mutate", this.scoped({
					sourceInstanceKey,
					operation,
					input,
					expectedRevision,
					confirmed
				}));
			}
			assistSource(sourceInstanceKey, operation, input, expectedRevision, confirmed) {
				return this.call(operation === "activation" ? MNEMON_ACTIVATION_CHANNEL : confirmed ? MNEMON_WRITE_CHANNEL : MNEMON_READ_CHANNEL, "source-assistance", this.scoped({
					sourceInstanceKey,
					operation,
					input,
					expectedRevision,
					confirmed
				}));
			}
			taskAgentModels(includeCatalog) {
				return this.call(MNEMON_READ_CHANNEL, "task-agent-models", includeCatalog === void 0 ? {} : { includeCatalog });
			}
			versions() {
				return this.call(MNEMON_READ_CHANNEL, "versions", {});
			}
			updateVersion(component) {
				return this.call(MNEMON_WRITE_CHANNEL, "version-update", { component });
			}
			providerServices() {
				return this.call(MNEMON_READ_CHANNEL, "provider-services", this.scoped());
			}
			updateProviderService(request) {
				return this.call(MNEMON_WRITE_CHANNEL, "provider-service-update", this.scoped(request));
			}
			/** Settled memory-tool activity of one turn, shared across all mounted tails. */
			async turnActivity(turn, cursor = 0) {
				return (await loadTurnActivities(this.connection, this.sessionId, cursor)).activities.find((activity) => activity.turn === turn) ?? null;
			}
			/** Plain text of one finalized assistant message; null when absent or empty. */
			assistantMessageText(messageId) {
				return this.call(MNEMON_READ_CHANNEL, "assistant-message", {
					sessionId: this.sessionId,
					messageId
				});
			}
			supervise(content, idempotencyKey) {
				return this.call(MNEMON_WRITE_CHANNEL, "supervise", this.scoped({
					content,
					...idempotencyKey === void 0 ? {} : { idempotencyKey }
				}));
			}
			packTarget() {
				return this.call(MNEMON_PACK_CHANNEL, "target", this.scoped());
			}
			exportPack() {
				return this.call(MNEMON_PACK_CHANNEL, "export", this.scoped());
			}
			inspectPack(base64, fileName) {
				return this.call(MNEMON_PACK_CHANNEL, "inspect", this.scoped({
					base64,
					...fileName === void 0 ? {} : { fileName }
				}));
			}
			importPack(base64) {
				return this.call(MNEMON_PACK_CHANNEL, "import", this.scoped({ base64 }));
			}
		};
		//#endregion
		//#region \0dsh-mnemon-css:/home/runner/work/dsh-mnemon/dsh-mnemon/src/client/MnemonSettingsCard.module.css.mjs
		const css$11 = "._v_wrq_page{box-sizing:border-box;width:100%;min-width:0;max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:28px;padding-bottom:28px;font-family:inherit;display:flex}._v_wrq_page *,._v_wrq_page :before,._v_wrq_page :after{box-sizing:border-box}._v_wrq_page button,._v_wrq_page input,._v_wrq_page select{color:inherit;font:inherit}._v_wrq_loading{min-height:140px;color:var(--dsw-alias-label-tertiary);text-align:center;margin:0;font-size:13px;line-height:140px}._v_wrq_pageHeader h1{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}._v_wrq_pageHeader p{max-width:64ch;color:var(--dsw-alias-label-tertiary);margin:8px 0 0;font-size:14px;line-height:22px}._v_wrq_section{flex-direction:column;gap:12px;min-width:0;display:flex}._v_wrq_sectionHeading{justify-content:space-between;align-items:flex-start;gap:18px;min-width:0;display:flex}._v_wrq_sectionHeading>div{flex:1;min-width:0}._v_wrq_sectionHeading h2{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;font-weight:500;line-height:22px}._v_wrq_sectionHeading p{max-width:66ch;color:var(--dsw-alias-label-tertiary);margin:1px 0 0;font-size:12px;line-height:18px}._v_wrq_choiceGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;display:grid}._v_wrq_topologyUnavailable{border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);border-radius:12px;margin:0;padding:13px;font-size:11px;line-height:17px}._v_wrq_topologyList{gap:8px;min-width:0;display:grid}._v_wrq_topologyLayer{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;overflow:hidden}._v_wrq_topologyLayer[data-enabled=false]{background:color-mix(in srgb, var(--dsw-alias-bg-layer-3) 68%, transparent)}._v_wrq_topologyLayer>header{justify-content:space-between;align-items:center;gap:14px;min-width:0;padding:12px 13px;display:flex}._v_wrq_topologyLayer>header>span{flex-direction:column;flex:1;min-width:0;display:flex}._v_wrq_topologyLayer>header strong{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}._v_wrq_topologyLayer>header small{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}._v_wrq_topologyToggle{color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none;align-items:center;gap:7px;font-size:10px;display:flex;position:relative}._v_wrq_topologyToggle input{clip-path:inset(50%);width:1px;height:1px;position:absolute;overflow:hidden}._v_wrq_topologyToggle i{background:var(--dsw-alias-bg-layer-2);width:34px;height:20px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);border-radius:999px;display:block;position:relative}._v_wrq_topologyToggle i:after{content:\"\";background:var(--dsw-alias-bg-layer-3);width:14px;height:14px;box-shadow:0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent);border-radius:50%;transition:transform .14s;position:absolute;top:3px;left:3px}._v_wrq_topologyToggle input:checked+i{background:var(--dsw-alias-label-primary)}._v_wrq_topologyToggle input:checked+i:after{transform:translate(14px)}._v_wrq_topologyToggle:has(input:disabled){cursor:default;opacity:.45}._v_wrq_miniSpinner{border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-secondary);border-radius:50%;flex:none;width:16px;height:16px;margin-top:3px;animation:.7s linear infinite _v_wrq_task-agent-spin}._v_wrq_taskAgentPanel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;flex-direction:column;gap:12px;min-width:0;padding:12px 13px;display:flex}._v_wrq_taskAgentPanel[data-mode=fixed]{background:color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 54%, var(--dsw-alias-bg-layer-3))}._v_wrq_taskAgentFields{gap:12px;min-width:0;display:grid}._v_wrq_taskAgentFields>label{gap:6px;min-width:0;display:grid}._v_wrq_taskAgentFields>label>span{flex-direction:column;min-width:0;display:flex}._v_wrq_taskAgentFields strong{font-size:12px;font-weight:500;line-height:18px}._v_wrq_taskAgentFields small{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}._v_wrq_taskAgentFields select{border:1px solid var(--dsw-alias-border-l2);width:100%;min-width:0;height:38px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font:inherit;border-radius:10px;outline:none;padding:0 10px;font-size:12px}._v_wrq_taskAgentFields select:disabled{cursor:default;opacity:.46}._v_wrq_taskAgentFields select:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}._v_wrq_taskAgentEffective{justify-content:space-between;align-items:center;gap:12px;min-width:0;display:flex}._v_wrq_taskAgentEffective>span{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}._v_wrq_taskAgentEffective code{min-width:0;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);font-family:var(--ds-font-family-code,ui-monospace, monospace);text-overflow:ellipsis;white-space:nowrap;border-radius:999px;padding:3px 8px;font-size:10px;line-height:16px;overflow:hidden}._v_wrq_taskAgentEffective small{min-width:0;color:var(--dsw-alias-label-tertiary);text-align:right;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:16px;overflow:hidden}._v_wrq_taskAgentWarning{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary));overflow-wrap:anywhere;margin:0;font-size:10px;line-height:16px}@keyframes _v_wrq_task-agent-spin{to{transform:rotate(360deg)}}._v_wrq_providerPanel{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:14px;overflow:hidden}._v_wrq_providerPanel>summary{cursor:pointer;justify-content:space-between;align-items:center;gap:16px;min-height:70px;padding:12px 14px;list-style:none;display:flex}._v_wrq_providerPanel>summary::-webkit-details-marker{display:none}._v_wrq_providerPanel>summary:after{content:\"›\";color:var(--dsw-alias-label-tertiary);font-size:20px;transition:transform .14s;transform:rotate(90deg)}._v_wrq_providerPanel[open]>summary:after{transform:rotate(-90deg)}._v_wrq_providerPanel[open]>summary{border-bottom:1px solid var(--dsw-alias-border-l2)}._v_wrq_providerIdentity{flex:1;align-items:center;gap:11px;min-width:0;display:flex}._v_wrq_providerIdentity>span{flex-direction:column;min-width:0;display:flex}._v_wrq_providerIdentity strong{font-size:14px;font-weight:500;line-height:21px}._v_wrq_providerIdentity small{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}._v_wrq_nativeMark{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;flex:none;place-items:center;width:34px;height:34px;padding:4px;display:grid;overflow:hidden}._v_wrq_nativeMark>svg{border-radius:6px;width:100%;height:100%;display:block}._v_wrq_providerMark{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:10px;flex:none;place-items:center;width:34px;height:34px;padding:4px;display:grid;overflow:hidden}._v_wrq_providerMark>img,._v_wrq_providerMark>svg{object-fit:contain;border-radius:6px;width:100%;height:100%;display:block}._v_wrq_providerHeaderMeta{flex:none;align-items:center;gap:7px;display:flex}._v_wrq_providerScopeTag{border-radius:999px;flex:none;padding:3px 8px;font-size:10px;font-weight:500;line-height:16px}._v_wrq_providerScopeTag[data-scope=global]{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary));background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary)) 11%, transparent)}._v_wrq_providerScopeTag[data-scope=workspace]{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-secondary));background:color-mix(in srgb, var(--dsw-alias-state-business-primary,var(--dsw-alias-label-secondary)) 11%, transparent)}._v_wrq_providerState{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:999px;flex:none;padding:3px 8px;font-size:10px;line-height:16px}._v_wrq_providerPanelBody{flex-direction:column;gap:12px;padding:0 14px 14px;display:flex}._v_wrq_providerList{flex-direction:column;gap:10px;min-width:0;display:flex}._v_wrq_providerRow{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:14px;overflow:hidden}._v_wrq_providerRowHeader{align-items:center;gap:16px;min-width:0;min-height:70px;padding:12px 14px;display:flex}._v_wrq_providerRow[data-expanded] ._v_wrq_providerRowHeader{border-bottom:1px solid var(--dsw-alias-border-l2)}._v_wrq_providerDisclosure{appearance:none;min-width:0;color:inherit;cursor:pointer;text-align:left;background:0 0;border:0;outline:none;flex:1;align-items:center;gap:8px;padding:0;display:flex}._v_wrq_providerDisclosure:disabled{cursor:default}._v_wrq_providerDisclosure:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);border-radius:8px}._v_wrq_providerChevron{color:var(--dsw-alias-label-tertiary);flex:none;font-size:18px;font-style:normal;transition:transform .14s;display:inline-block;transform:rotate(90deg)}._v_wrq_providerDisclosure[aria-expanded=true] ._v_wrq_providerChevron{transform:rotate(-90deg)}._v_wrq_providerEnableControl{flex:none;align-items:center;gap:10px;display:flex}._v_wrq_providerState[data-enabled]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, transparent)}._v_wrq_providerToggle{cursor:pointer;display:inline-flex;position:relative}._v_wrq_providerToggle>input{clip:rect(0 0 0 0);clip-path:inset(50%);width:1px;height:1px;position:absolute;overflow:hidden}._v_wrq_providerToggle>span{background:var(--dsw-alias-bg-layer-2);width:38px;height:22px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);border-radius:999px;transition:background-color .14s;display:block;position:relative}._v_wrq_providerToggle>span>i{background:var(--dsw-alias-bg-layer-3);width:16px;height:16px;box-shadow:0 1px 3px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);border-radius:50%;transition:transform .14s;position:absolute;top:3px;left:3px}._v_wrq_providerToggle>input:checked+span{background:var(--dsw-alias-label-primary);box-shadow:none}._v_wrq_providerToggle>input:checked+span>i{transform:translate(16px)}._v_wrq_providerToggle>input:focus-visible+span{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}._v_wrq_providerToggle:has(input:disabled){cursor:default;opacity:.42}._v_wrq_providerInlineBody{padding:0 14px 14px}._v_wrq_providerToggleError{color:var(--dsw-alias-state-error-primary);margin:0;padding:0 14px 12px;font-size:10px;line-height:16px}._v_wrq_providerServiceForm{flex-direction:column;gap:12px;min-width:0;padding-top:13px;display:flex}._v_wrq_providerServicePrompt{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:17px}._v_wrq_globalLocationSetting{flex-direction:column;min-width:0;display:flex}._v_wrq_providerServiceLocation{border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:12px}._v_wrq_providerServiceLocation>._v_wrq_nativeLocation{min-height:0;padding:0 0 12px}._v_wrq_providerLocationField{border-top:1px solid var(--dsw-alias-border-l2);padding-top:11px}._v_wrq_nativeLocation{justify-content:space-between;align-items:center;gap:18px;min-height:68px;padding:12px 0;display:flex}._v_wrq_inlineChoices{flex:none;align-items:center;gap:6px;display:flex}._v_wrq_inlineChoices label{cursor:pointer;position:relative}._v_wrq_inlineChoices input{z-index:1;opacity:0;width:100%;height:100%;cursor:inherit;margin:0;position:absolute;inset:0}._v_wrq_inlineChoices span{border:1px solid var(--dsw-alias-border-l2);height:32px;color:var(--dsw-alias-label-secondary);border-radius:16px;align-items:center;padding:0 11px;font-size:12px;display:inline-flex}._v_wrq_inlineChoices input:checked+span{border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}._v_wrq_inlineChoices input:focus-visible+span{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}._v_wrq_inlineChoices input:disabled+span{cursor:default;opacity:.42}._v_wrq_embeddedSection,._v_wrq_embeddingSection{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:10px;min-width:0;padding-top:13px;display:flex}._v_wrq_embeddingHeading h3{color:var(--dsw-alias-label-primary);margin:0;font-size:13px;font-weight:500;line-height:20px}._v_wrq_embeddingHeading p{color:var(--dsw-alias-label-tertiary);margin:1px 0 0;font-size:10px;line-height:16px}._v_wrq_embeddingSection ._v_wrq_toggleRow{min-height:58px;padding:9px 0}._v_wrq_embeddingSecurity{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-tertiary));margin:0;font-size:10px;line-height:16px}._v_wrq_embeddingTest{justify-content:space-between;align-items:center;gap:10px;min-width:0;min-height:28px;display:flex}._v_wrq_embeddingTest>span{min-width:0;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;font-size:10px;line-height:16px}._v_wrq_embeddingTest>span._v_wrq_error{color:var(--dsw-alias-state-error-primary)}._v_wrq_memoryConfig{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:12px;flex-direction:column;gap:12px;min-width:0;padding:12px;display:flex}._v_wrq_memoryConfig:first-child{margin-top:12px}._v_wrq_memoryConfigHeader{justify-content:space-between;align-items:center;gap:12px;min-width:0;display:flex}._v_wrq_memoryConfigHeader>div{flex-direction:column;min-width:0;display:flex}._v_wrq_memoryConfigHeader strong{text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:20px;overflow:hidden}._v_wrq_memoryConfigHeader small{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}._v_wrq_configActive{color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;align-items:center;gap:6px;font-size:11px;display:inline-flex}._v_wrq_configActive input{accent-color:var(--dsw-alias-label-primary)}._v_wrq_providerIdentityFields{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;min-width:0;display:grid}._v_wrq_providerSettingsGrid{grid-template-columns:minmax(0,1fr);gap:12px;min-width:0;display:grid}._v_wrq_providerIdentityFields>label,._v_wrq_providerFieldControl>label:not(._v_wrq_providerBoolean){min-width:0;color:var(--dsw-alias-label-secondary);flex-direction:column;gap:4px;font-size:10px;line-height:16px;display:flex}._v_wrq_providerIdentityFields input,._v_wrq_providerIdentityFields select,._v_wrq_providerFieldControl input:not([type=checkbox]),._v_wrq_providerFieldControl select{border:1px solid var(--dsw-alias-border-l2);width:100%;min-width:0;height:36px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);font:inherit;border-radius:9px;outline:none;padding:0 10px;font-size:12px}._v_wrq_providerIdentityFields select,._v_wrq_taskAgentFields select,._v_wrq_providerFieldControl select{appearance:none;cursor:pointer;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");background-position:right 12px center;background-repeat:no-repeat;background-size:12px 12px;padding-right:32px}._v_wrq_providerIdentityFields select:disabled,._v_wrq_taskAgentFields select:disabled,._v_wrq_providerFieldControl select:disabled{cursor:default}._v_wrq_providerIdentityFields input:focus-visible,._v_wrq_providerIdentityFields select:focus-visible,._v_wrq_providerFieldControl input:focus-visible,._v_wrq_providerFieldControl select:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}._v_wrq_providerIdentityFields input:disabled,._v_wrq_providerIdentityFields select:disabled,._v_wrq_providerFieldControl input:disabled,._v_wrq_providerFieldControl select:disabled{opacity:.5}._v_wrq_providerFieldControl{flex-direction:column;justify-content:flex-end;gap:3px;min-width:0;display:flex}._v_wrq_providerBoolean{min-height:36px;color:var(--dsw-alias-label-secondary);align-items:center;gap:7px;font-size:11px;display:flex}._v_wrq_providerBoolean input{accent-color:var(--dsw-alias-label-primary)}._v_wrq_providerSecretInput{min-width:0;position:relative}._v_wrq_providerSecretInput>input{padding-right:39px}._v_wrq_providerSecretVisibility{appearance:none;width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:7px;place-items:center;padding:0;display:grid;position:absolute;top:4px;right:4px}._v_wrq_providerSecretVisibility:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}._v_wrq_providerSecretVisibility:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}._v_wrq_providerSecretVisibility:disabled{cursor:default;opacity:.35}._v_wrq_providerSecretVisibility svg{width:17px;height:17px}._v_wrq_memoryConfigFooter{border-top:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:10px;min-height:36px;padding-top:10px;display:flex}._v_wrq_memoryConfigFooter>div{align-items:center;gap:6px;display:flex}._v_wrq_providerServiceFooter{flex-direction:column;align-items:stretch;min-height:0}._v_wrq_providerServiceFooter>button{align-self:flex-end}._v_wrq_configFeedback{flex:1;min-width:0;font-size:10px;line-height:15px}._v_wrq_addConfigButton{appearance:none;border:1px dashed var(--dsw-alias-border-l2);min-height:36px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:10px;font-size:11px}._v_wrq_addConfigButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}._v_wrq_addConfigButton:disabled{cursor:default;opacity:.4}._v_wrq_scopeChanging,._v_wrq_providerTarget{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);border-radius:10px;margin:0;padding:8px 10px;font-size:10px;line-height:16px}._v_wrq_scopeChanging{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary))}._v_wrq_providerTarget{background:0 0;margin-top:-4px;padding:0}._v_wrq_providerLoadError{justify-content:space-between;align-items:center;gap:10px;font-size:11px;display:flex}._v_wrq_choiceCard{cursor:pointer;min-width:0;display:block;position:relative}._v_wrq_choiceCard>input,._v_wrq_toggleRow>input,._v_wrq_visuallyHidden{clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}._v_wrq_choiceFace{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;flex-direction:column;justify-content:center;gap:1px;min-width:0;min-height:66px;padding:10px 34px 10px 13px;transition:border-color .14s,background-color .14s;display:flex;position:relative}._v_wrq_choiceFace:hover{background:var(--dsw-alias-interactive-bg-hover)}._v_wrq_choiceFace strong{text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:21px;overflow:hidden}._v_wrq_choiceFace small{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:17px;overflow:hidden}._v_wrq_check{font-size:14px;line-height:18px;display:none;position:absolute;top:11px;right:12px}._v_wrq_choiceCard>input:checked+._v_wrq_choiceFace{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-interactive-bg-hover)}._v_wrq_choiceCard>input:checked+._v_wrq_choiceFace ._v_wrq_check{display:block}._v_wrq_choiceCard>input:disabled+._v_wrq_choiceFace{cursor:default;opacity:.42}._v_wrq_choiceCard:has(input:disabled){cursor:default}._v_wrq_settingRow,._v_wrq_toggleRow{border-top:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:18px;min-width:0;min-height:62px;padding:11px 0;display:flex;position:relative}._v_wrq_settingCopy{flex-direction:column;flex:1;min-width:0;display:flex}._v_wrq_settingCopy strong{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:21px}._v_wrq_settingCopy small{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}._v_wrq_settingCopy code{font-family:var(--ds-font-family-code,ui-monospace, monospace)}._v_wrq_directoryControl{flex:0 420px;align-items:center;gap:8px;min-width:0;max-width:60%;display:flex}._v_wrq_directoryInput{border:1px solid var(--dsw-alias-border-l2);width:100%;min-width:0;height:38px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);font-family:var(--ds-font-family-code,ui-monospace, monospace);border-radius:10px;outline:none;padding:0 11px;font-size:12px;line-height:20px}._v_wrq_directoryInput::placeholder{color:var(--dsw-alias-label-caption)}._v_wrq_directoryInput:disabled{cursor:default;opacity:.46}._v_wrq_rowGroup{border-bottom:1px solid var(--dsw-alias-border-l2)}._v_wrq_enhancementsSection{container-type:inline-size}._v_wrq_toggleRow{cursor:pointer}._v_wrq_toggleRow:first-child{border-top:1px solid var(--dsw-alias-border-l2)}._v_wrq_toggleRow:has(input:disabled){cursor:default;opacity:.46}._v_wrq_switch{background:var(--dsw-alias-bg-layer-2);width:40px;height:24px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);border-radius:999px;flex:none;transition:background-color .14s;display:block;position:relative}._v_wrq_switch i{background:var(--dsw-alias-bg-layer-3);width:18px;height:18px;box-shadow:0 1px 3px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);border-radius:50%;transition:transform .14s;position:absolute;top:3px;left:3px}._v_wrq_toggleRow>input:checked+._v_wrq_switch{background:var(--dsw-alias-label-primary);box-shadow:none}._v_wrq_toggleRow>input:checked+._v_wrq_switch i{transform:translate(16px)}._v_wrq_pillButton,._v_wrq_primaryPill,._v_wrq_actions button{appearance:none;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);height:36px;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;background:0 0;border-radius:18px;justify-content:center;align-items:center;gap:4px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}._v_wrq_pillButton:hover:not(:disabled),._v_wrq_actions button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}._v_wrq_pillButton:disabled,._v_wrq_primaryPill:disabled,._v_wrq_actions button:disabled,._v_wrq_textButton:disabled{cursor:default;opacity:.4}._v_wrq_primaryPill,._v_wrq_save{color:var(--dsw-alias-label-primary-foreground)!important;background:var(--dsw-alias-button-primary-fill)!important;border-color:#0000!important}._v_wrq_primaryPill:hover:not(:disabled),._v_wrq_save:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)!important}._v_wrq_textButton{appearance:none;box-sizing:border-box;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;background:0 0;border:0;border-radius:14px;flex:none;justify-content:center;align-items:center;padding:0 10px;font-size:12px;line-height:18px;display:inline-flex}._v_wrq_textButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}._v_wrq_activePath{width:fit-content;max-width:100%;color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;margin-top:4px;font-size:11px;line-height:17px;overflow:hidden}._v_wrq_scopeMeta{color:var(--dsw-alias-label-tertiary);margin-top:1px;font-size:10px;font-style:normal;line-height:15px}._v_wrq_rowActions{flex:none;align-items:center;gap:8px;display:flex}._v_wrq_importBar{background:var(--dsw-alias-bg-layer-2);border-radius:12px;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;min-width:0;padding:10px 12px;display:grid}._v_wrq_importBar>div{min-width:0;display:grid}._v_wrq_importBar strong{text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500;line-height:18px;overflow:hidden}._v_wrq_importBar small{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:15px}._v_wrq_importBar ._v_wrq_textButton{padding:0 10px}._v_wrq_feedback,._v_wrq_packFeedback{gap:4px;display:grid}._v_wrq_feedback:empty,._v_wrq_packFeedback:empty{display:none}._v_wrq_feedback p,._v_wrq_packFeedback p{overflow-wrap:anywhere;margin:0;font-size:12px;line-height:18px}._v_wrq_error{color:var(--dsw-alias-state-error-primary)}._v_wrq_success{color:var(--dsw-alias-state-success-primary)}._v_wrq_readOnly{color:var(--dsw-alias-label-tertiary)}._v_wrq_packSuccess{color:var(--dsw-alias-state-success-primary)}._v_wrq_actions{display:none}._v_wrq_actionsVisible{border-top:1px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:16px;padding-top:14px;display:flex}._v_wrq_actions>span{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}._v_wrq_actions>div{gap:8px;display:flex}._v_wrq_discard{color:var(--dsw-alias-label-primary);background:0 0;border-color:var(--dsw-alias-border-l2)!important}._v_wrq_settingsNote{color:var(--dsw-alias-label-tertiary);margin:-14px 0 0;font-size:10px;line-height:16px}._v_wrq_settingsNote code{color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,ui-monospace, monospace)}._v_wrq_choiceCard>input:focus-visible+._v_wrq_choiceFace,._v_wrq_toggleRow>input:focus-visible+._v_wrq_switch,._v_wrq_directoryInput:focus-visible,._v_wrq_pillButton:focus-visible,._v_wrq_primaryPill:focus-visible,._v_wrq_textButton:focus-visible,._v_wrq_actions button:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}@media (width<=620px){._v_wrq_page{gap:24px}._v_wrq_choiceGrid{grid-template-columns:minmax(0,1fr)}._v_wrq_settingRow{flex-direction:column;align-items:stretch;gap:9px}._v_wrq_directoryControl{justify-content:space-between;max-width:none}._v_wrq_rowActions{width:100%}._v_wrq_rowActions button{flex:1}._v_wrq_importBar{grid-template-columns:minmax(0,1fr) auto}._v_wrq_importBar ._v_wrq_primaryPill{grid-column:1/-1}._v_wrq_actionsVisible{flex-direction:column;align-items:stretch}._v_wrq_actions>div,._v_wrq_actions button{flex:1}._v_wrq_nativeLocation{flex-direction:column;align-items:stretch;gap:9px}._v_wrq_inlineChoices{width:100%}._v_wrq_inlineChoices label{flex:1}._v_wrq_inlineChoices span{justify-content:center;width:100%}._v_wrq_providerIdentityFields{grid-template-columns:minmax(0,1fr)}._v_wrq_providerRowHeader{align-items:flex-start;gap:8px}._v_wrq_providerEnableControl{flex-direction:column-reverse;align-items:flex-end;gap:5px;max-width:116px}._v_wrq_providerState{text-overflow:ellipsis;white-space:nowrap;max-width:108px;overflow:hidden}._v_wrq_memoryConfigFooter{flex-direction:column;align-items:stretch}._v_wrq_memoryConfigFooter>div:last-child{width:100%}._v_wrq_memoryConfigFooter button{flex:1}}@container (width<=180px){._v_wrq_enhancementsSection ._v_wrq_sectionHeading p,._v_wrq_enhancementsSection ._v_wrq_settingCopy small{display:none}._v_wrq_enhancementsSection ._v_wrq_toggleRow{grid-template-columns:minmax(0,1fr);gap:6px;min-height:0;padding:10px 0;display:grid}._v_wrq_enhancementsSection ._v_wrq_settingCopy strong{overflow-wrap:anywhere}._v_wrq_enhancementsSection ._v_wrq_switch{justify-self:end}}@media (prefers-reduced-motion:reduce){._v_wrq_choiceFace,._v_wrq_switch,._v_wrq_switch i,._v_wrq_providerChevron,._v_wrq_providerToggle>span,._v_wrq_providerToggle>span>i{transition:none}._v_wrq_miniSpinner{animation:none}}._v_wrq_storageChoiceGrid>:last-child{grid-column:1/-1}._v_wrq_workspaceStorageLocation{margin-top:16px}._v_wrq_workspaceStorageLocation>p{color:var(--dsw-alias-label-caption);margin:10px 0 0;font-size:12px;line-height:1.5}";
		const tagId$11 = "dsh-mnemon/src/client/MnemonSettingsCard.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$11) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = tagId$11;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css$11) tag.textContent = css$11;
		}
		var MnemonSettingsCard_module_css_default = {
			"actions": "_v_wrq_actions",
			"actionsVisible": "_v_wrq_actionsVisible",
			"activePath": "_v_wrq_activePath",
			"addConfigButton": "_v_wrq_addConfigButton",
			"check": "_v_wrq_check",
			"choiceCard": "_v_wrq_choiceCard",
			"choiceFace": "_v_wrq_choiceFace",
			"choiceGrid": "_v_wrq_choiceGrid",
			"configActive": "_v_wrq_configActive",
			"configFeedback": "_v_wrq_configFeedback",
			"directoryControl": "_v_wrq_directoryControl",
			"directoryInput": "_v_wrq_directoryInput",
			"discard": "_v_wrq_discard",
			"embeddedSection": "_v_wrq_embeddedSection",
			"embeddingHeading": "_v_wrq_embeddingHeading",
			"embeddingSection": "_v_wrq_embeddingSection",
			"embeddingSecurity": "_v_wrq_embeddingSecurity",
			"embeddingTest": "_v_wrq_embeddingTest",
			"enhancementsSection": "_v_wrq_enhancementsSection",
			"error": "_v_wrq_error",
			"feedback": "_v_wrq_feedback",
			"globalLocationSetting": "_v_wrq_globalLocationSetting",
			"importBar": "_v_wrq_importBar",
			"inlineChoices": "_v_wrq_inlineChoices",
			"loading": "_v_wrq_loading",
			"memoryConfig": "_v_wrq_memoryConfig",
			"memoryConfigFooter": "_v_wrq_memoryConfigFooter",
			"memoryConfigHeader": "_v_wrq_memoryConfigHeader",
			"miniSpinner": "_v_wrq_miniSpinner",
			"nativeLocation": "_v_wrq_nativeLocation",
			"nativeMark": "_v_wrq_nativeMark",
			"packFeedback": "_v_wrq_packFeedback",
			"packSuccess": "_v_wrq_packSuccess",
			"page": "_v_wrq_page",
			"pageHeader": "_v_wrq_pageHeader",
			"pillButton": "_v_wrq_pillButton",
			"primaryPill": "_v_wrq_primaryPill",
			"providerBoolean": "_v_wrq_providerBoolean",
			"providerChevron": "_v_wrq_providerChevron",
			"providerDisclosure": "_v_wrq_providerDisclosure",
			"providerEnableControl": "_v_wrq_providerEnableControl",
			"providerFieldControl": "_v_wrq_providerFieldControl",
			"providerHeaderMeta": "_v_wrq_providerHeaderMeta",
			"providerIdentity": "_v_wrq_providerIdentity",
			"providerIdentityFields": "_v_wrq_providerIdentityFields",
			"providerInlineBody": "_v_wrq_providerInlineBody",
			"providerList": "_v_wrq_providerList",
			"providerLoadError": "_v_wrq_providerLoadError",
			"providerLocationField": "_v_wrq_providerLocationField",
			"providerMark": "_v_wrq_providerMark",
			"providerPanel": "_v_wrq_providerPanel",
			"providerPanelBody": "_v_wrq_providerPanelBody",
			"providerRow": "_v_wrq_providerRow",
			"providerRowHeader": "_v_wrq_providerRowHeader",
			"providerScopeTag": "_v_wrq_providerScopeTag",
			"providerSecretInput": "_v_wrq_providerSecretInput",
			"providerSecretVisibility": "_v_wrq_providerSecretVisibility",
			"providerServiceFooter": "_v_wrq_providerServiceFooter",
			"providerServiceForm": "_v_wrq_providerServiceForm",
			"providerServiceLocation": "_v_wrq_providerServiceLocation",
			"providerServicePrompt": "_v_wrq_providerServicePrompt",
			"providerSettingsGrid": "_v_wrq_providerSettingsGrid",
			"providerState": "_v_wrq_providerState",
			"providerTarget": "_v_wrq_providerTarget",
			"providerToggle": "_v_wrq_providerToggle",
			"providerToggleError": "_v_wrq_providerToggleError",
			"readOnly": "_v_wrq_readOnly",
			"rowActions": "_v_wrq_rowActions",
			"rowGroup": "_v_wrq_rowGroup",
			"save": "_v_wrq_save",
			"scopeChanging": "_v_wrq_scopeChanging",
			"scopeMeta": "_v_wrq_scopeMeta",
			"section": "_v_wrq_section",
			"sectionHeading": "_v_wrq_sectionHeading",
			"settingCopy": "_v_wrq_settingCopy",
			"settingRow": "_v_wrq_settingRow",
			"settingsNote": "_v_wrq_settingsNote",
			"storageChoiceGrid": "_v_wrq_storageChoiceGrid",
			"success": "_v_wrq_success",
			"switch": "_v_wrq_switch",
			"task-agent-spin": "_v_wrq_task-agent-spin",
			"taskAgentEffective": "_v_wrq_taskAgentEffective",
			"taskAgentFields": "_v_wrq_taskAgentFields",
			"taskAgentPanel": "_v_wrq_taskAgentPanel",
			"taskAgentWarning": "_v_wrq_taskAgentWarning",
			"textButton": "_v_wrq_textButton",
			"toggleRow": "_v_wrq_toggleRow",
			"topologyLayer": "_v_wrq_topologyLayer",
			"topologyList": "_v_wrq_topologyList",
			"topologyToggle": "_v_wrq_topologyToggle",
			"topologyUnavailable": "_v_wrq_topologyUnavailable",
			"visuallyHidden": "_v_wrq_visuallyHidden",
			"workspaceStorageLocation": "_v_wrq_workspaceStorageLocation"
		};
		//#endregion
		//#region src/client/GlobalLocationSetting.tsx
		/** Shared global/default location control for Native and workspace-aware providers. */
		function GlobalLocationSetting(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: `${MnemonSettingsCard_module_css_default.globalLocationSetting}${props.className === void 0 ? "" : ` ${props.className}`}`,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MnemonSettingsCard_module_css_default.nativeLocation,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonSettingsCard_module_css_default.settingCopy,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: props.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: props.hint })]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonSettingsCard_module_css_default.inlineChoices,
						role: "radiogroup",
						"aria-label": props.ariaLabel,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "radio",
							name: props.name,
							checked: props.workspace || !props.custom,
							disabled: props.disabled || props.workspace,
							onClick: props.onInteract,
							onChange: () => props.onChange(false)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.defaultLabel })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "radio",
							name: props.name,
							checked: !props.workspace && props.custom,
							disabled: props.disabled || props.workspace,
							onClick: props.onInteract,
							onChange: () => props.onChange(true)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.customLabel })] })]
					})]
				}), !props.workspace && props.custom ? props.children : null]
			});
		}
		//#endregion
		//#region plugins/dsh-mnemon-source-runtime/presentation/locales.json
		var zh$3 = {
			"nav.runtime": "运行时",
			"runtime.title": "运行时记忆",
			"runtime.description": "管理每轮随上下文加载的紧凑热记忆。结构化数据由统一控制层维护，并自动投影为 USER.md 与 MEMORY.md。",
			"runtime.total": "{count} 条热记忆",
			"runtime.entriesAria": "运行时记忆列表",
			"runtime.scopeAria": "运行时记忆范围",
			"runtime.scopeAll": "全部",
			"runtime.filterAria": "筛选运行时记忆",
			"runtime.filterPlaceholder": "按内容筛选…",
			"runtime.noMatch": "没有符合当前范围与查询条件的热记忆。",
			"runtime.refresh": "刷新",
			"runtime.hotContext": "每轮上下文",
			"runtime.addTitle": "添加热记忆",
			"runtime.addDescription": "稳定但仍需频繁使用的信息优先留在这里，长期归档由 Mnemon 记忆空间承接。",
			"runtime.content": "运行时记忆内容",
			"runtime.placeholder": "输入一条简洁、独立、未来仍然有用的信息…",
			"runtime.target": "分类",
			"runtime.importance": "重要性",
			"runtime.saving": "处理中…",
			"runtime.addButton": "添加记忆",
			"runtime.addAction": "添加",
			"runtime.target.user": "用户画像",
			"runtime.target.user.description": "身份、角色、习惯、表达偏好与明确的协作要求；容量整理始终留在本地，不进入记忆空间。",
			"runtime.target.memory": "工作记忆",
			"runtime.target.memory.description": "项目、环境、决策、约定、工具特性与可复用经验；容量达到上限时按主题归档到一个或多个记忆空间。",
			"runtime.importance.critical": "关键",
			"runtime.importance.normal": "普通",
			"runtime.importance.low": "低",
			"runtime.branches": "适用分支",
			"runtime.branchesPlaceholder": "如 main、dev（逗号分隔；留空=全部分支可见）",
			"runtime.branchesHint": "留空表示清除分支限制（全部分支可见）",
			"runtime.branchBadge": "分支限定",
			"runtime.editContent": "编辑运行时记忆",
			"runtime.editAction": "编辑",
			"runtime.saveEdit": "保存修改",
			"runtime.removeAction": "移除",
			"runtime.removeTitle": "移除运行时记忆？",
			"runtime.removeWarning": "移除后，这条内容将不再随每轮上下文加载。该操作无法撤销。",
			"runtime.result.add": "已添加到{target} · 当前 {count} 条",
			"runtime.result.replace": "已更新{target} · 当前 {count} 条",
			"runtime.result.remove": "已从{target}移除 · 当前 {count} 条",
			"runtime.result.maintenance": "容量整理完成：已先归档到记忆空间 {spaces}，再更新{target} · 当前 {count} 条",
			"runtime.result.localCompaction": "本地画像整理完成：未写入记忆空间，已更新{target} · 当前 {count} 条",
			"runtime.readOnly": "当前部署为只读模式；热记忆仍会进入上下文，但不能在此修改。",
			"runtime.footnote": "memories.json 是唯一事实源；两个 Markdown 文件由控制层生成，不应直接编辑。"
		};
		var en$3 = {
			"nav.runtime": "Runtime",
			"runtime.title": "Runtime Memory",
			"runtime.description": "Manage compact hot memory loaded into every turn. A single control plane owns structured data and projects USER.md and MEMORY.md.",
			"runtime.total": "{count} hot memories",
			"runtime.entriesAria": "Runtime memory list",
			"runtime.scopeAria": "Runtime memory scope",
			"runtime.scopeAll": "All",
			"runtime.filterAria": "Filter runtime memory",
			"runtime.filterPlaceholder": "Filter by content…",
			"runtime.noMatch": "No hot memory matches the current scope and query.",
			"runtime.refresh": "Refresh",
			"runtime.hotContext": "Every-turn context",
			"runtime.addTitle": "Add hot memory",
			"runtime.addDescription": "Keep stable, frequently useful information here; Mnemon Memory Spaces remain the durable archive.",
			"runtime.content": "Runtime memory content",
			"runtime.placeholder": "Enter one compact, self-contained fact that will remain useful…",
			"runtime.target": "Target",
			"runtime.importance": "Importance",
			"runtime.saving": "Working…",
			"runtime.addButton": "Add memory",
			"runtime.addAction": "Add",
			"runtime.target.user": "User Profile",
			"runtime.target.user.description": "Identity, role, habits, communication preferences, and explicit collaboration requirements. Capacity maintenance stays local and never enters a Memory Space.",
			"runtime.target.memory": "Working Memory",
			"runtime.target.memory.description": "Projects, environment, decisions, conventions, tool behavior, and reusable lessons. At capacity, entries are routed into one or more topic-specific Memory Spaces.",
			"runtime.importance.critical": "Critical",
			"runtime.importance.normal": "Normal",
			"runtime.importance.low": "Low",
			"runtime.branches": "Branches",
			"runtime.branchesPlaceholder": "e.g. main, dev (comma-separated; empty = visible on all branches)",
			"runtime.branchesHint": "Empty input clears the branch restriction (visible on all branches)",
			"runtime.branchBadge": "Branch-scoped",
			"runtime.editContent": "Edit runtime memory",
			"runtime.editAction": "Edit",
			"runtime.saveEdit": "Save change",
			"runtime.removeAction": "Remove",
			"runtime.removeTitle": "Remove runtime memory?",
			"runtime.removeWarning": "After removal, this content will no longer load with every turn. This action cannot be undone.",
			"runtime.result.add": "Added to {target} · {count} entries",
			"runtime.result.replace": "Updated {target} · {count} entries",
			"runtime.result.remove": "Removed from {target} · {count} entries",
			"runtime.result.maintenance": "Capacity maintenance complete: archived to {spaces}, then updated {target} · {count} entries",
			"runtime.result.localCompaction": "Local profile compaction complete: no Memory Space write; updated {target} · {count} entries",
			"runtime.readOnly": "This deployment is read only. Hot memory still enters context but cannot be changed here.",
			"runtime.footnote": "memories.json is the only source of truth. The control plane generates both Markdown files; do not edit them directly."
		};
		//#endregion
		//#region plugins/dsh-mnemon-source-documents/presentation/locales.json
		var zh$2 = {
			"nav.documents": "档案",
			"documents.title": "项目档案",
			"documents.description": "在当前工作区维护结构化的项目文档。活跃档案参与近场检索；达到 10 MB 上限前，最久未使用的档案会先在 Mnemon 中建立索引，再迁入归档。",
			"documents.capacity": "{used} / {limit}",
			"documents.refresh": "刷新",
			"documents.summary": "档案存储摘要",
			"documents.active": "活跃档案",
			"documents.activeHint": "近场检索范围",
			"documents.archivedCount": "归档",
			"documents.archivedHint": "不占活跃容量",
			"documents.activeCapacity": "活跃容量",
			"documents.capacityHint": "按实际 UTF-8 文件大小计算",
			"documents.searchAria": "检索项目档案",
			"documents.searchPlaceholder": "搜索设计、调查、流程或交接记录…",
			"documents.search": "检索",
			"documents.scope": "档案范围",
			"documents.new": "新建档案",
			"documents.newTitle": "创建托管档案",
			"documents.editTitle": "编辑活跃档案",
			"documents.editorHint": "控制层会生成 frontmatter、哈希与修订号；原项目文件始终只读。",
			"documents.managedCopy": "托管副本",
			"documents.name": "标题",
			"documents.routing": "检索说明",
			"documents.sources": "来源路径",
			"documents.sourcesPlaceholder": "src/index.ts, docs/architecture.md",
			"documents.markdown": "Markdown 内容",
			"documents.saving": "保存中…",
			"documents.create": "创建档案",
			"documents.save": "保存修订",
			"documents.created": "已创建活跃档案。",
			"documents.createdAfterArchive": "已先迁移 {count} 份旧档案，再创建活跃档案。",
			"documents.updated": "已保存新的档案修订。",
			"documents.updatedAfterArchive": "已先迁移 {count} 份旧档案，再保存修订。",
			"documents.archived": "已建立 Mnemon 冷索引并归档；关联记忆空间：{spaces}",
			"documents.list": "项目档案列表",
			"documents.activeList": "活跃目录",
			"documents.archiveList": "归档目录",
			"documents.noDescription": "暂无检索说明。",
			"documents.missing": "文件缺失",
			"documents.emptyActive": "还没有活跃档案",
			"documents.emptyActiveText": "复杂对话达到活动评分门槛后会自动审阅并整理档案，也可以在上方手动创建。",
			"documents.emptyArchived": "还没有归档",
			"documents.emptyArchivedText": "只有完成 Mnemon 索引的档案才会迁移到这里。",
			"documents.reader": "档案阅读器",
			"documents.selectTitle": "选择一份档案",
			"documents.selectText": "在左侧查看活跃项目知识或沿 Mnemon 引用打开归档原文。",
			"documents.coldArchive": "归档原文",
			"documents.edit": "编辑",
			"documents.path": "托管路径",
			"documents.revision": "修订",
			"documents.hash": "内容哈希",
			"documents.size": "文件大小",
			"documents.archiveReceipt": "Mnemon 冷索引回执",
			"documents.archiveTitle": "迁入归档",
			"documents.archiveDescription": "独立任务 Agent 先拟定摘要和目标空间；Host 校验后写入冷索引，再移动原文。需要已启用且支持精确写入与删除的记忆空间。",
			"documents.archive": "归档",
			"documents.archiveConfirm": "确认建立 Mnemon 索引并迁移这份档案？",
			"documents.archiving": "索引并迁移中…",
			"documents.archiveNow": "确认归档",
			"documents.footnote": "`.mnemon/documents/index.json` 是控制面事实源；active 总量固定不超过 10 MB，archived 不计入上限，项目源文件不会被修改。"
		};
		var en$2 = {
			"nav.documents": "Documents",
			"documents.title": "Project Documents",
			"documents.description": "Maintain structured project documents in the current workspace. Active documents support near-field search; before the 10 MB limit is exceeded, the least-recently-used document is indexed in Mnemon and moved to the archive.",
			"documents.capacity": "{used} / {limit}",
			"documents.refresh": "Refresh",
			"documents.summary": "Document storage summary",
			"documents.active": "Active",
			"documents.activeHint": "Near-field search scope",
			"documents.archivedCount": "Archive",
			"documents.archivedHint": "Excluded from active capacity",
			"documents.activeCapacity": "Active capacity",
			"documents.capacityHint": "Measured from actual UTF-8 files",
			"documents.searchAria": "Search project documents",
			"documents.searchPlaceholder": "Search designs, investigations, procedures, or handoffs…",
			"documents.search": "Search",
			"documents.scope": "Document scope",
			"documents.new": "New document",
			"documents.newTitle": "Create managed document",
			"documents.editTitle": "Edit active document",
			"documents.editorHint": "The control plane generates frontmatter, hashes, and revisions. Project source files stay read only.",
			"documents.managedCopy": "Managed copy",
			"documents.name": "Title",
			"documents.routing": "Retrieval description",
			"documents.sources": "Source paths",
			"documents.sourcesPlaceholder": "src/index.ts, docs/architecture.md",
			"documents.markdown": "Markdown content",
			"documents.saving": "Saving…",
			"documents.create": "Create document",
			"documents.save": "Save revision",
			"documents.created": "Active document created.",
			"documents.createdAfterArchive": "Archived {count} older document(s), then created the active document.",
			"documents.updated": "New document revision saved.",
			"documents.updatedAfterArchive": "Archived {count} older document(s), then saved the revision.",
			"documents.archived": "Mnemon cold index created and document archived; Memory Spaces: {spaces}",
			"documents.list": "Project document list",
			"documents.activeList": "Active directory",
			"documents.archiveList": "Archive directory",
			"documents.noDescription": "No retrieval description.",
			"documents.missing": "File missing",
			"documents.emptyActive": "No active documents yet",
			"documents.emptyActiveText": "Complex work is reviewed after it reaches the activity-score gate, or you can create a Document above.",
			"documents.emptyArchived": "No archives yet",
			"documents.emptyArchivedText": "Only documents with a completed Mnemon index are moved here.",
			"documents.reader": "Document reader",
			"documents.selectTitle": "Select a document",
			"documents.selectText": "Read active project knowledge or follow a Mnemon reference to an archived original.",
			"documents.coldArchive": "Archived original",
			"documents.edit": "Edit",
			"documents.path": "Managed path",
			"documents.revision": "Revision",
			"documents.hash": "Content hash",
			"documents.size": "File size",
			"documents.archiveReceipt": "Mnemon cold-index receipt",
			"documents.archiveTitle": "Move to archive",
			"documents.archiveDescription": "An independent task Agent proposes a summary and destination. The Host validates and writes the cold index before moving the original. An active Memory Space with exact writes and safe deletion is required.",
			"documents.archive": "Archive",
			"documents.archiveConfirm": "Create the Mnemon index and archive this document?",
			"documents.archiving": "Indexing and moving…",
			"documents.archiveNow": "Confirm archive",
			"documents.footnote": "`.mnemon/documents/index.json` is the control-plane source of truth. active stays at or below 10 MB, archived is excluded, and project source files are never modified."
		};
		//#endregion
		//#region plugins/dsh-mnemon-source-memory-spaces/presentation/locales.json
		var zh$1 = {
			"term.space": "记忆空间",
			"term.spaces": "记忆空间",
			"category.decision": "决策",
			"category.preference": "偏好",
			"category.fact": "事实",
			"category.insight": "洞察",
			"category.context": "上下文",
			"category.general": "通用",
			"nav.memory.aria": "记忆空间页面",
			"nav.overview": "概览",
			"nav.bodies": "记忆空间",
			"nav.search": "检索",
			"nav.entities": "实体",
			"nav.rememberAction": "沉淀记忆",
			"nav.content": "内容",
			"overview.title": "记忆空间",
			"overview.description": "统一管理由 Mnemon Native 或第三方 Provider 承载的记忆空间；已激活的空间共同参与读取、路由与实时快照。",
			"overview.pageDescription": "创建和启停记忆空间，查看每个 Provider 的存储状态与实时关联快照。",
			"overview.interval": "进入时全量同步 · 点击卡片按需同步",
			"overview.fullSyncPending": "等待首次全量同步",
			"overview.fullSyncJustNow": "上次全量同步：刚刚",
			"overview.fullSyncSeconds": "上次全量同步：{count} 秒前",
			"overview.fullSyncMinutes": "上次全量同步：{count} 分钟前",
			"overview.fullSyncHours": "上次全量同步：{count} 小时前",
			"overview.fullSyncDays": "上次全量同步：{count} 天前",
			"overview.syncing": "同步中…",
			"overview.syncNow": "立即同步",
			"overview.directory": "记忆空间目录",
			"overview.directory.description": "每张卡片对应一个记忆空间。第三方 Provider 首次接入时建立映射，之后点击卡片只检测该空间；本地维护的标题与说明不会被重连覆盖。",
			"overview.directory.waiting": "等待目录",
			"overview.directory.unsynced": "目录尚未同步",
			"overview.directory.unsyncedBadge": "目录待同步",
			"overview.directoryLoading": "正在加载记忆空间目录",
			"overview.healthLoading": "正在检测各记忆空间状态",
			"overview.storageHealthy": "存储正常",
			"overview.storageUnhealthy": "存储异常",
			"overview.storageChecking": "检测中",
			"overview.reconnecting": "重连中",
			"overview.reconnectHint": "点击卡片重新检测并同步这个记忆空间",
			"overview.reconnectAria": "重新连接{name}",
			"overview.snapshotLoading": "正在加载多记忆空间实时快照",
			"overview.metadataAction": "AI 维护元信息",
			"overview.metadataTitle": "AI 维护记忆空间元信息",
			"overview.metadataDescription": "选择一个或多个已激活记忆空间。系统会分别通过各 Provider 最快的原生查询路径读取少量样本，再由独立任务 Agent 生成标题与说明。",
			"overview.metadataUnavailable": "暂时无法运行：未找到与当前记忆范围匹配的活跃 Agent",
			"overview.metadataLoading": "正在载入可维护的记忆空间…",
			"overview.metadataEmpty": "当前没有可由 AI 维护元信息的已激活记忆空间。",
			"overview.metadataSelected": "已选择 {count} 个记忆空间",
			"overview.metadataSelectAll": "全选",
			"overview.metadataClear": "清空",
			"overview.metadataSafety": "仅更新本地标题与说明，不会修改、移动或删除记忆内容。Provider 关闭后，这些本地元数据会随映射一起清理。",
			"overview.metadataGenerate": "AI 生成（{count}）",
			"overview.metadataGenerating": "AI 正在生成…",
			"overview.metadataRunningCount": "{count} 个生成中",
			"overview.metadataTaskRunning": "生成中…",
			"overview.metadataTaskSuccess": "已更新",
			"overview.metadataTaskError": "失败：{error}",
			"overview.metadataTaskUnknown": "未知错误",
			"overview.metadataCompleted": "已更新 {count} 个记忆空间的元信息。",
			"overview.mnemonDefault": "Mnemon 默认",
			"overview.toggleAria": "{name}读取开关",
			"overview.toggling": "切换中",
			"overview.noDescription": "尚未提供路由说明。",
			"overview.unsyncedTitle": "记忆空间目录尚未同步",
			"overview.unsyncedShort": "当前 Web 客户端与 DSH Host 状态不一致；重启 Host 后会重新登记既有 Store。",
			"overview.unsyncedLong": "当前 Host 仍在使用旧插件契约；重启 DSH 后会重新发现既有 Store，期间不会删除任何 .db。",
			"overview.emptyTitle": "还没有记忆空间",
			"overview.emptyShort": "创建第一个记忆空间并写入稳定上下文后，它会出现在这里。",
			"overview.emptyLong": "创建一个 Mnemon 记忆空间，或在“设置 → 记忆系统”启用第三方 Provider 以同步其已有记忆空间。",
			"overview.noActiveTitle": "没有激活的记忆空间",
			"overview.noActiveText": "开启至少一个记忆空间的读取开关，即可在这里聚合它的实时图谱。",
			"overview.noContentTitle": "已激活记忆空间尚无内容",
			"overview.noContentText": "向任意记忆空间沉淀稳定上下文后，这里会聚合呈现节点与关系。",
			"overview.createTitle": "创建记忆空间",
			"overview.createDialogHint": "这里定义记忆空间用途并选择底层 Provider；服务、凭据和全局数据位置沿用“设置 → 记忆系统”的配置。",
			"overview.createIdentityTitle": "记忆空间信息",
			"overview.createIdentityHint": "名称用于识别；描述会帮助 Agent 判断什么内容应写入和召回。",
			"overview.createPlacementTitle": "记忆空间 Provider",
			"overview.createPlacementHint": "这是一次明确的手动创建；选择一个已启用 Provider。自动选择由“沉淀策略”统一管理。",
			"overview.createName": "新记忆空间名称",
			"overview.createNamePlaceholder": "名称",
			"overview.createDescription": "新记忆空间描述",
			"overview.createDescriptionPlaceholder": "说明哪些内容属于它，以及何时应被召回",
			"overview.placementMode": "底层选择方式",
			"overview.placementManual": "手动指定",
			"overview.placementManualHint": "直接选择一个已启用 Provider",
			"overview.placementAutomatic": "智能选择",
			"overview.placementAutomaticHint": "先应用数据边界与能力规则，再由 Agent 在合格候选中选择",
			"overview.placementUnavailable": "需要一个已连接且与当前工作区对齐的对话",
			"overview.recommended": "推荐",
			"overview.placementPolicy": "选择策略",
			"overview.placementPolicyHint": "规则由系统强制执行，Prompt 只影响合格候选之间的判断。",
			"overview.agentDecision": "Agent 决策",
			"overview.placementPrompt": "策略 Prompt（可选）",
			"overview.placementPromptPlaceholder": "例如：这是团队协作知识；在满足精确写入要求时优先本地，否则优先共享。",
			"overview.dataBoundary": "数据边界",
			"overview.dataBoundaryRemote": "允许远程服务",
			"overview.dataBoundaryLocal": "仅限本地",
			"overview.preference": "软偏好",
			"overview.preferenceBalanced": "综合平衡",
			"overview.preferenceLocal": "本地优先",
			"overview.preferenceShared": "共享优先",
			"overview.requiredCapabilities": "必须具备（可多选）",
			"overview.capability.graph": "关系图谱",
			"overview.capability.exact-write": "精确写入",
			"overview.capability.forget": "安全遗忘",
			"overview.candidateNativeReady": "官方原生 · 跟随当前记忆范围",
			"overview.providerServiceRequired": "尚未启用；请先前往“设置 → 记忆系统”完成服务配置",
			"overview.workspaceBinding.automatic": "跟随当前记忆范围",
			"overview.workspaceBinding.optional-override": "跟随当前范围；全局可自定义位置",
			"overview.workspaceBinding.provider-global": "始终使用全局范围",
			"overview.candidateOpenViking": "纳入远程候选并提供连接",
			"overview.candidateLocal": "本地 Provider · 跟随当前记忆范围",
			"overview.candidateRemote": "远程 Provider · 使用全局服务配置",
			"overview.placementByLlm": "Agent 智能选择",
			"overview.placementByRules": "规则自动确定",
			"overview.placementConfidence": "置信度：{confidence}",
			"overview.confidence.high": "高",
			"overview.confidence.medium": "中",
			"overview.confidence.low": "低",
			"overview.providerLabel": "记忆引擎",
			"overview.nativeOfficial": "官方原生",
			"overview.providerNativeHint": "官方原生、本地优先，保留完整图谱与软删除能力",
			"strategy.action": "沉淀策略",
			"strategy.title": "沉淀策略",
			"strategy.description": "定义 Agent 在沉淀过程中需要新建记忆空间时，如何选择底层 Provider。已有记忆空间仍会优先按名称、描述与能力路由。",
			"strategy.loading": "正在读取 Provider 目录…",
			"strategy.modeTitle": "Provider 选择方式",
			"strategy.modeHint": "该策略只影响 Agent 沉淀时的新记忆空间创建；手动点击“创建记忆空间”始终由你指定。",
			"strategy.manualHint": "固定使用一个 Provider，Agent 无法改选",
			"strategy.automaticHint": "先执行硬规则，再由任务 Agent 选择合格 Provider",
			"strategy.manualTitle": "固定 Provider",
			"strategy.manualDescription": "当现有记忆空间都不适合时，新记忆空间固定创建在这个 Provider 中。",
			"strategy.automaticTitle": "智能选择规则",
			"strategy.automaticDescription": "数据边界与能力要求由主机强制执行，Prompt 只影响合格候选之间的判断。",
			"strategy.taskAgentReady": "任务 Agent 就绪",
			"strategy.taskAgentUnavailable": "等待任务 Agent",
			"strategy.save": "保存策略",
			"strategy.saving": "保存中…",
			"overview.providerOpenVikingHint": "连接已有 OpenViking 服务，由记忆空间工作流统一调度",
			"overview.providerSummary.mnemon-native": "官方原生、本地优先，保留完整图谱与软删除能力",
			"overview.providerSummary.openviking": "文件系统形态的共享记忆，支持分层读取与自动语义提炼",
			"overview.providerSummary.honcho": "跨会话用户建模、Peer 档案、辩证推理与持久结论",
			"overview.providerSummary.mem0": "自动事实提取、语义召回、重排与去重",
			"overview.providerSummary.hindsight": "知识图谱记忆，具备实体解析、多策略召回与反思",
			"overview.providerSummary.holographic": "本地结构化事实记忆，支持可信度、实体解析与组合召回",
			"overview.providerSummary.retaindb": "云端混合向量/BM25 召回、用户画像与类型化事实",
			"overview.providerSummary.byterover": "通过 brv CLI 使用的本地优先分层知识树",
			"overview.providerSummary.supermemory": "语义记忆、持久画像、会话摄取与多容器召回",
			"overview.providerEndpoint": "服务地址",
			"overview.providerEndpointPlaceholder": "例如：http://127.0.0.1:1933",
			"overview.providerTargetUri": "记忆范围 URI",
			"overview.providerTargetPlaceholder": "例如：viking://user/memories",
			"overview.providerAdvanced": "身份与凭据（可选）",
			"overview.providerApiKey": "API Key",
			"overview.providerApiKeyOptional": "未启用鉴权时可留空",
			"overview.providerApiKeyKeep": "已保存；留空表示保持不变",
			"overview.providerAccount": "Account",
			"overview.providerUser": "User",
			"overview.providerActorPeer": "Actor Peer",
			"overview.providerField.workspace": "工作区",
			"overview.providerField.userId": "用户 ID",
			"overview.providerField.agentId": "Agent ID",
			"overview.providerField.mode": "接入模式",
			"overview.providerField.rerank": "重排检索结果",
			"overview.providerField.bankId": "记忆库",
			"overview.providerField.budget": "召回预算",
			"overview.providerField.dataPath": "事实存储路径",
			"overview.providerField.defaultDirectory": "默认知识目录",
			"overview.providerField.defaultTrust": "默认可信度",
			"overview.providerField.minTrust": "最低召回可信度",
			"overview.providerField.project": "项目标识",
			"overview.providerField.cliPath": "brv 可执行文件",
			"overview.providerField.workingDirectory": "知识目录",
			"overview.providerField.containerTag": "容器标签",
			"overview.providerField.searchMode": "检索模式",
			"overview.providerOption.platform": "Mem0 Platform",
			"overview.providerOption.self-hosted": "自托管服务",
			"overview.providerOption.low": "低",
			"overview.providerOption.mid": "中",
			"overview.providerOption.high": "高",
			"overview.providerOption.hybrid": "混合检索",
			"overview.providerOption.memories": "仅记忆",
			"overview.providerOption.documents": "仅文档",
			"overview.providerKindLocal": "本地引擎",
			"overview.providerKindRemote": "远程服务",
			"overview.providerSecretClear": "清除已保存的凭据",
			"overview.providerWriteExact": "精确写入",
			"overview.providerWriteAsync": "异步语义提炼",
			"overview.providerGraphReady": "支持关系图谱",
			"overview.providerSearchReady": "支持统一检索",
			"overview.providerRemote": "三方远程记忆",
			"overview.providerLocal": "三方本地记忆",
			"overview.creating": "创建中…",
			"overview.createAction": "创建",
			"overview.editBody": "编辑",
			"overview.editBodyAria": "编辑{name}",
			"overview.editName": "名称",
			"overview.editDescription": "路由说明",
			"overview.saveBody": "保存",
			"overview.savingBody": "保存中…",
			"overview.deleteBody": "删除",
			"overview.deleteBodyAria": "删除{name}",
			"overview.deleteTitle": "删除“{name}”？",
			"overview.deleteWarning": "该操作会永久删除这个记忆空间及其中的全部记忆与关系，无法撤销。",
			"overview.lastStoreDeleteHint": "Mnemon 需要保留至少一个原生 Store；可将最后一个记忆空间设为未激活，但不能删除。",
			"overview.deleteAction": "确认删除",
			"overview.disconnectBody": "断开",
			"overview.disconnectBodyAria": "断开{name}",
			"overview.disconnectTitle": "断开“{name}”？",
			"overview.disconnectWarning": "这里只会从 DSH 记忆空间目录移除 {provider} 连接；底层引擎中的记忆不会被删除。",
			"overview.disconnectAction": "确认断开",
			"overview.deletingBody": "删除中…",
			"overview.snapshot": "多记忆空间实时快照",
			"overview.snapshotSources": "快照可观察范围",
			"overview.snapshotSourcesHint": "真实关系图、无边内容投影和查询型记忆空间分别呈现，不伪造 Provider 不具备的关系。",
			"overview.noVisualTitle": "当前记忆空间只支持按需查询",
			"overview.noVisualText": "这些 Provider 不提供可枚举内容或图谱；请前往“检索”输入明确问题。",
			"overview.waitingSnapshot": "等待首个快照",
			"overview.updatedAt": "更新于 {time}",
			"overview.edgeScope": "空间归属",
			"overview.edgeTemporal": "时间",
			"overview.edgeSemantic": "语义",
			"overview.edgeCausal": "因果",
			"overview.edgeEntity": "实体关联",
			"overview.graphComposition": "{spaces} 个空间 · {memories} 条记忆 · {entities} 个实体",
			"overview.graphCount": "展示 {visible} / {total} 个元素",
			"overview.graphEdges": "{count} 条图谱连接",
			"overview.inspector": "记忆详情",
			"overview.inspectorSpace": "记忆空间详情",
			"overview.inspectorEntity": "实体详情",
			"overview.selectNode": "选择一个图谱元素",
			"overview.selectNodeText": "查看记忆空间、实体或记忆的精确上下文。",
			"overview.closeInspector": "关闭节点详情",
			"overview.memoryId": "记忆 ID",
			"overview.spaceId": "记忆空间 ID",
			"overview.containedMemories": "包含记忆",
			"overview.entityMentions": "索引次数",
			"overview.exploreNode": "围绕它检索",
			"overview.previewAria": "查看全文",
			"overview.previewTitle": "内容全文",
			"overview.loading": "正在同步多记忆空间实时快照…",
			"graph.layoutAria": "图谱布局",
			"graph.layoutNatural": "自然布局",
			"graph.layoutUniform": "均匀布局",
			"graph.layoutCustom": "自定义布局",
			"graph.layoutStatus": "布局状态：{layout}",
			"graph.draggable": "{layout} · 可拖拽",
			"graph.naturalAction": "自然铺开",
			"graph.uniformAction": "均匀重置",
			"graph.aria": "Mnemon 实时记忆图谱，{nodes} 个元素，{edges} 条连接",
			"graph.kindSpace": "记忆空间",
			"graph.kindEntity": "实体",
			"search.title": "检索记忆",
			"search.description": "跨已激活记忆空间检索原始证据；每个 Provider 使用自己的原生召回方式并保留来源。",
			"search.maxResults": "最多 {count} 条",
			"search.placeholder": "为什么选用 SQLite？这个项目有哪些发布约定？",
			"search.queryAria": "记忆查询",
			"search.categoryAria": "记忆分类",
			"search.strategy": "策略",
			"search.modeAria": "检索模式",
			"search.modeSmart": "智能召回",
			"search.modeKeyword": "关键词检索",
			"search.modeBasic": "基础匹配",
			"search.searching": "检索中…",
			"search.action": "直接检索",
			"search.agentAction": "Agent 查询",
			"search.agentSearching": "Agent 分析中…",
			"search.agentAnswer": "Agent 查询结果",
			"search.agentAnswerHint": "基于下方召回证据",
			"search.startTitle": "从一个明确问题开始",
			"search.startText": "聚焦实体、决策或时间线，比批量加载整库更可靠。",
			"search.emptyTitle": "没有命中",
			"search.emptyText": "换一个更具体的实体、决策或时间线关键词试试。",
			"search.results": "原始召回内容",
			"search.related": "关联记忆",
			"search.closeRelated": "关闭关联记忆",
			"search.traversing": "正在遍历图谱…",
			"search.noRelated": "没有找到两跳内的关联节点。",
			"search.sourcesTitle": "本次检索范围",
			"entities.title": "实体查阅",
			"entities.description": "只在真正提供实体索引的记忆空间中，查阅实体跨越事实、决策与上下文的关系。",
			"entities.sourcesTitle": "实体能力范围",
			"entities.unsupportedTitle": "没有支持实体索引的记忆空间",
			"entities.unsupportedText": "当前激活 Provider 仍可通过“检索”召回，但不会在这里伪装成实体图谱。",
			"entities.count": "{count} 个活跃实体",
			"entities.nameAria": "实体名称",
			"entities.placeholder": "输入任意实体…",
			"entities.action": "查阅",
			"entities.top": "高频实体",
			"entities.frequency": "按出现频率",
			"entities.filterHint": "输入时即时过滤左侧列表（按 Esc 清空）",
			"entities.emptyRail": "写入带实体的记忆后，这里会形成入口。",
			"entities.filterEmpty": "本地无匹配。点“查阅”向宿主发起查询。",
			"entities.loading": "正在沿实体关系召回…",
			"entities.selectTitle": "选择或输入一个实体",
			"entities.selectText": "实体视图会聚合与它相关的记忆，而不是只做字面匹配。",
			"entities.emptyTitle": "没有关联记忆",
			"entities.emptyText": "尝试更完整的名称或另一个实体别名。",
			"remember.title": "沉淀记忆",
			"remember.description": "候选内容会进入无会话历史的独立任务 Agent，由它选择记忆空间、查重、提炼并执行写入，不占用主对话上下文。",
			"remember.readOnlyTitle": "当前为只读模式",
			"remember.readOnlyText": "当前部署禁止记忆写入；如需调整，请修改 DSH 的 Mnemon 配置并保存。",
			"remember.delegateTitle": "交给独立任务 Agent",
			"remember.noSession": "无可用会话",
			"remember.ready": "独立任务 Agent 就绪",
			"remember.noTaskAgent": "任务 Agent 不可用",
			"remember.taskAgentReady": "任务 Agent 就绪",
			"remember.candidate": "候选内容",
			"remember.candidateAria": "待沉淀内容",
			"remember.placeholder": "输入希望跨任务保留的背景、偏好、决策或洞察。模型会先判断它是否真的值得沉淀。",
			"remember.sessionHint": "当前视图没有可用的模型路由，无法创建独立任务 Agent。",
			"remember.taskAgentHint": "当前 Host 暂时无法创建独立任务 Agent，请刷新状态后重试。",
			"remember.processing": "独立任务 Agent 处理中…",
			"remember.action": "调度独立任务 Agent 判断并沉淀",
			"remember.advanced": "人工高级选项",
			"remember.advancedHint": "为独立任务 Agent 指定目标记忆空间与元数据约束",
			"remember.expand": "展开",
			"remember.target": "目标记忆空间",
			"remember.asyncProviderHint": "该记忆空间会等待远程提炼任务完成后再返回真实写入回执。",
			"remember.entities": "实体（逗号分隔）",
			"remember.tags": "标签（逗号分隔）",
			"remember.advancedText": "高级选项是约束而不是绕过监督；独立任务 Agent 仍会查重并返回结构化回执。",
			"remember.saving": "独立任务 Agent 写入中…",
			"remember.advancedAction": "按高级约束沉淀",
			"remember.skipped": "独立任务 Agent 判断无需写入",
			"remember.completed": "独立任务 Agent 已完成处理",
			"remember.processed": "独立任务 Agent 已处理：{action}",
			"remember.dispatchFailed": "调度失败：{error}",
			"remember.saveFailed": "保存失败：{error}",
			"content.title": "记忆内容",
			"content.description": "按 Provider 的真实浏览契约检查可观察内容；列表型、查询型与不可浏览引擎会明确区分。",
			"content.sourcesTitle": "Provider 内容模型",
			"content.count": "{count} 条记忆",
			"content.filterAria": "筛选记忆内容",
			"content.filterPlaceholder": "按内容或精确 ID 筛选…",
			"content.categoryAria": "记忆分类",
			"content.apply": "应用筛选",
			"content.notice": "内容页直接调用 Provider 的只读浏览契约；查询型引擎仅在输入查询后执行检索。",
			"content.queryRequiredTitle": "查询型记忆空间等待问题",
			"content.queryRequiredText": "输入一个明确查询即可读取 ByteRover 等不提供全量列表的 Provider。",
			"content.showing": "当前显示 {visible} / {total}",
			"content.showMore": "再显示 {count} 条",
			"content.emptyTitle": "没有符合条件的记忆",
			"content.emptyText": "清空筛选，或前往“沉淀”写入第一条稳定上下文。",
			"nav.spaces": "记忆空间",
			"overview.editSpace": "编辑",
			"overview.editSpaceAria": "编辑{name}",
			"overview.saveSpace": "保存",
			"overview.savingSpace": "保存中…",
			"overview.deleteSpace": "删除",
			"overview.deleteSpaceAria": "删除{name}",
			"overview.disconnectSpace": "断开",
			"overview.disconnectSpaceAria": "断开{name}",
			"overview.deletingSpace": "删除中…"
		};
		var en$1 = {
			"term.space": "Memory Space",
			"term.spaces": "Memory Spaces",
			"category.decision": "Decision",
			"category.preference": "Preference",
			"category.fact": "Fact",
			"category.insight": "Insight",
			"category.context": "Context",
			"category.general": "General",
			"nav.memory.aria": "Memory Space pages",
			"nav.overview": "Overview",
			"nav.bodies": "Memory Spaces",
			"nav.search": "Recall",
			"nav.entities": "Entities",
			"nav.rememberAction": "Remember",
			"nav.content": "Content",
			"overview.title": "Memory Spaces",
			"overview.description": "Manage memory spaces backed by Mnemon Native or third-party Providers. Active spaces participate in reads, routing, and live snapshots.",
			"overview.pageDescription": "Create and activate Memory Spaces, then inspect storage health and live relation snapshots across providers.",
			"overview.interval": "Full sync on entry · Click a card to sync on demand",
			"overview.fullSyncPending": "Waiting for the first full sync",
			"overview.fullSyncJustNow": "Last full sync: just now",
			"overview.fullSyncSeconds": "Last full sync: {count}s ago",
			"overview.fullSyncMinutes": "Last full sync: {count}m ago",
			"overview.fullSyncHours": "Last full sync: {count}h ago",
			"overview.fullSyncDays": "Last full sync: {count}d ago",
			"overview.syncing": "Syncing…",
			"overview.syncNow": "Sync now",
			"overview.directory": "Memory Space Directory",
			"overview.directory.description": "Each card represents a memory space. A third-party Provider creates its mapping on first connection; later card clicks check only that space, without overwriting locally maintained titles or descriptions.",
			"overview.directory.waiting": "Waiting for directory",
			"overview.directory.unsynced": "Directory not synchronized",
			"overview.directory.unsyncedBadge": "Directory pending",
			"overview.directoryLoading": "Loading the Memory Space directory",
			"overview.healthLoading": "Checking Memory Space health",
			"overview.storageHealthy": "Storage healthy",
			"overview.storageUnhealthy": "Storage unavailable",
			"overview.storageChecking": "Checking",
			"overview.reconnecting": "Reconnecting",
			"overview.reconnectHint": "Click the card to reconnect and synchronize this Memory Space",
			"overview.reconnectAria": "Reconnect {name}",
			"overview.snapshotLoading": "Loading the multi-space live snapshot",
			"overview.metadataAction": "AI metadata",
			"overview.metadataTitle": "Maintain Memory Space metadata with AI",
			"overview.metadataDescription": "Select one or more active Memory Spaces. The system reads a small sample through each Provider’s fastest native path, then gives each space to an independent task Agent for its title and description.",
			"overview.metadataUnavailable": "Temporarily unavailable: no active Agent matches the current memory scope",
			"overview.metadataLoading": "Loading maintainable Memory Spaces…",
			"overview.metadataEmpty": "There are no active Memory Spaces whose metadata can be maintained by AI.",
			"overview.metadataSelected": "{count} Memory Spaces selected",
			"overview.metadataSelectAll": "Select all",
			"overview.metadataClear": "Clear",
			"overview.metadataSafety": "Only local titles and descriptions are updated. Memory content is never changed, moved, or deleted. Disabling a Provider removes this local metadata with its projection.",
			"overview.metadataGenerate": "Generate with AI ({count})",
			"overview.metadataGenerating": "AI is generating…",
			"overview.metadataRunningCount": "{count} running",
			"overview.metadataTaskRunning": "Generating…",
			"overview.metadataTaskSuccess": "Updated",
			"overview.metadataTaskError": "Failed: {error}",
			"overview.metadataTaskUnknown": "Unknown error",
			"overview.metadataCompleted": "Updated metadata for {count} Memory Spaces.",
			"overview.mnemonDefault": "Mnemon default",
			"overview.toggleAria": "{name} read toggle",
			"overview.toggling": "Switching",
			"overview.noDescription": "No routing description yet.",
			"overview.unsyncedTitle": "Memory Space directory is not synchronized",
			"overview.unsyncedShort": "The Web client and DSH Host are using different contracts. Restart the Host to register existing Stores.",
			"overview.unsyncedLong": "The Host is still using the previous plugin contract. Restart DSH to rediscover existing Stores; no .db file will be deleted.",
			"overview.emptyTitle": "No Memory Spaces yet",
			"overview.emptyShort": "Create the first space and distill durable context into it.",
			"overview.emptyLong": "Create a Mnemon Memory Space, or enable a third-party provider in Settings → Memory System to synchronize its existing namespaces.",
			"overview.noActiveTitle": "No active Memory Spaces",
			"overview.noActiveText": "Enable read access for at least one space to aggregate its live graph here.",
			"overview.noContentTitle": "Active spaces have no content yet",
			"overview.noContentText": "Distill durable context into a space to populate nodes and relations.",
			"overview.createTitle": "Create Memory Space",
			"overview.createDialogHint": "Define this Memory Space and choose its provider here. It reuses services, credentials, and global data locations from Settings → Memory System.",
			"overview.createIdentityTitle": "Memory Space details",
			"overview.createIdentityHint": "The name identifies the space; the description guides when the agent writes and recalls it.",
			"overview.createPlacementTitle": "Memory Space provider",
			"overview.createPlacementHint": "This is an explicit manual creation. Choose one enabled Provider; automatic selection is managed by Distillation Strategy.",
			"overview.createName": "New Memory Space name",
			"overview.createNamePlaceholder": "Name",
			"overview.createDescription": "New Memory Space description",
			"overview.createDescriptionPlaceholder": "Describe what belongs here and when it should be recalled",
			"overview.placementMode": "Engine selection",
			"overview.placementManual": "Choose manually",
			"overview.placementManualHint": "Choose one enabled provider directly",
			"overview.placementAutomatic": "Smart selection",
			"overview.placementAutomaticHint": "Apply data-boundary and capability rules first, then let the agent choose among eligible providers",
			"overview.placementUnavailable": "Requires a connected conversation aligned with this workspace",
			"overview.recommended": "Recommended",
			"overview.placementPolicy": "Selection policy",
			"overview.placementPolicyHint": "The host enforces rules. The prompt only guides judgment among eligible candidates.",
			"overview.agentDecision": "Agent decision",
			"overview.placementPrompt": "Strategy prompt (optional)",
			"overview.placementPromptPlaceholder": "For example: This is collaborative knowledge. Prefer local storage when exact writes are required; otherwise prefer sharing.",
			"overview.dataBoundary": "Data boundary",
			"overview.dataBoundaryRemote": "Remote services allowed",
			"overview.dataBoundaryLocal": "Local only",
			"overview.preference": "Soft preference",
			"overview.preferenceBalanced": "Balanced",
			"overview.preferenceLocal": "Local first",
			"overview.preferenceShared": "Shared first",
			"overview.requiredCapabilities": "Required capabilities (select any)",
			"overview.capability.graph": "Relation graph",
			"overview.capability.exact-write": "Exact writes",
			"overview.capability.forget": "Safe forget",
			"overview.candidateNativeReady": "Official native · follows the active memory scope",
			"overview.providerServiceRequired": "Not enabled; configure the service in Settings → Memory System first",
			"overview.workspaceBinding.automatic": "Follows the active memory scope",
			"overview.workspaceBinding.optional-override": "Follows the active scope; global location can be customized",
			"overview.workspaceBinding.provider-global": "Always uses the global scope",
			"overview.candidateOpenViking": "Include the remote candidate and provide its connection",
			"overview.candidateLocal": "Local provider · follows the active memory scope",
			"overview.candidateRemote": "Remote provider · uses the global service configuration",
			"overview.placementByLlm": "Agent selected",
			"overview.placementByRules": "Rule selected",
			"overview.placementConfidence": "Confidence: {confidence}",
			"overview.confidence.high": "High",
			"overview.confidence.medium": "Medium",
			"overview.confidence.low": "Low",
			"overview.providerLabel": "Memory engine",
			"overview.nativeOfficial": "Official native",
			"overview.providerNativeHint": "Official native, local-first storage with the full graph and soft-delete semantics",
			"strategy.action": "Distillation strategy",
			"strategy.title": "Distillation strategy",
			"strategy.description": "Choose how the Agent selects a Provider when it must create a new Memory Space during distillation. Existing spaces are still routed by name, description, and capabilities first.",
			"strategy.loading": "Loading Provider directory…",
			"strategy.modeTitle": "Provider selection",
			"strategy.modeHint": "This policy applies only to Agent-created spaces during distillation. Manual Create Memory Space always asks you to choose.",
			"strategy.manualHint": "Fix one Provider; the Agent cannot override it",
			"strategy.automaticHint": "Apply hard rules first, then let the task Agent choose an eligible Provider",
			"strategy.manualTitle": "Fixed Provider",
			"strategy.manualDescription": "When no existing space fits, create the new space on this Provider.",
			"strategy.automaticTitle": "Smart selection rules",
			"strategy.automaticDescription": "The host enforces data and capability rules. The prompt only guides judgment among eligible candidates.",
			"strategy.taskAgentReady": "Task Agent ready",
			"strategy.taskAgentUnavailable": "Waiting for task Agent",
			"strategy.save": "Save strategy",
			"strategy.saving": "Saving…",
			"overview.providerOpenVikingHint": "Connect an existing OpenViking service under the same Memory Space workflow",
			"overview.providerSummary.mnemon-native": "Official native, local-first storage with the full graph and soft-delete semantics",
			"overview.providerSummary.openviking": "Filesystem-shaped shared memory with tiered reads and automatic semantic extraction",
			"overview.providerSummary.honcho": "Cross-session user modelling, peer profiles, dialectic reasoning, and persistent conclusions",
			"overview.providerSummary.mem0": "Automatic fact extraction, semantic retrieval, reranking, and deduplication",
			"overview.providerSummary.hindsight": "Knowledge-graph memory with entity resolution, multi-strategy recall, and reflection",
			"overview.providerSummary.holographic": "Local structured fact memory with trust scoring, entity resolution, and compositional retrieval",
			"overview.providerSummary.retaindb": "Cloud hybrid vector/BM25 retrieval, user profiles, and typed durable facts",
			"overview.providerSummary.byterover": "Local-first hierarchical knowledge tree accessed through the brv CLI",
			"overview.providerSummary.supermemory": "Semantic memory, persistent profiles, conversation ingest, and multi-container recall",
			"overview.providerEndpoint": "Service endpoint",
			"overview.providerEndpointPlaceholder": "For example: http://127.0.0.1:1933",
			"overview.providerTargetUri": "Memory scope URI",
			"overview.providerTargetPlaceholder": "For example: viking://user/memories",
			"overview.providerAdvanced": "Identity and credentials (optional)",
			"overview.providerApiKey": "API Key",
			"overview.providerApiKeyOptional": "Leave blank when authentication is disabled",
			"overview.providerApiKeyKeep": "Saved; leave blank to keep unchanged",
			"overview.providerAccount": "Account",
			"overview.providerUser": "User",
			"overview.providerActorPeer": "Actor Peer",
			"overview.providerField.workspace": "Workspace",
			"overview.providerField.userId": "User ID",
			"overview.providerField.agentId": "Agent ID",
			"overview.providerField.mode": "Mode",
			"overview.providerField.rerank": "Rerank search results",
			"overview.providerField.bankId": "Memory bank",
			"overview.providerField.budget": "Recall budget",
			"overview.providerField.dataPath": "Fact store path",
			"overview.providerField.defaultDirectory": "Default knowledge directory",
			"overview.providerField.defaultTrust": "Default trust",
			"overview.providerField.minTrust": "Minimum recall trust",
			"overview.providerField.project": "Project",
			"overview.providerField.cliPath": "brv executable",
			"overview.providerField.workingDirectory": "Knowledge directory",
			"overview.providerField.containerTag": "Container tag",
			"overview.providerField.searchMode": "Search mode",
			"overview.providerOption.platform": "Mem0 Platform",
			"overview.providerOption.self-hosted": "Self-hosted server",
			"overview.providerOption.low": "Low",
			"overview.providerOption.mid": "Medium",
			"overview.providerOption.high": "High",
			"overview.providerOption.hybrid": "Hybrid",
			"overview.providerOption.memories": "Memories",
			"overview.providerOption.documents": "Documents",
			"overview.providerKindLocal": "Local engine",
			"overview.providerKindRemote": "Remote service",
			"overview.providerSecretClear": "Clear the saved credential",
			"overview.providerWriteExact": "Exact writes",
			"overview.providerWriteAsync": "Asynchronous semantic extraction",
			"overview.providerGraphReady": "Relation graph available",
			"overview.providerSearchReady": "Unified search available",
			"overview.providerRemote": "Third-party remote memory",
			"overview.providerLocal": "Third-party local memory",
			"overview.creating": "Creating…",
			"overview.createAction": "Create",
			"overview.editBody": "Edit",
			"overview.editBodyAria": "Edit {name}",
			"overview.editName": "Name",
			"overview.editDescription": "Routing description",
			"overview.saveBody": "Save",
			"overview.savingBody": "Saving…",
			"overview.deleteBody": "Delete",
			"overview.deleteBodyAria": "Delete {name}",
			"overview.deleteTitle": "Delete “{name}”?",
			"overview.deleteWarning": "This permanently deletes the Memory Space and every memory and relation it contains. This cannot be undone.",
			"overview.lastStoreDeleteHint": "Mnemon must retain at least one native Store. The last Memory Space may be inactive, but it cannot be deleted.",
			"overview.deleteAction": "Delete permanently",
			"overview.disconnectBody": "Disconnect",
			"overview.disconnectBodyAria": "Disconnect {name}",
			"overview.disconnectTitle": "Disconnect “{name}”?",
			"overview.disconnectWarning": "This only removes the {provider} connection from the DSH Memory Space directory. Memories in the underlying engine remain untouched.",
			"overview.disconnectAction": "Disconnect",
			"overview.deletingBody": "Deleting…",
			"overview.snapshot": "Live multi-space snapshot",
			"overview.snapshotSources": "Snapshot observability",
			"overview.snapshotSourcesHint": "True relation graphs, edge-free content projections, and query-only spaces remain distinct; missing provider relations are never invented.",
			"overview.noVisualTitle": "Active spaces are query-only",
			"overview.noVisualText": "These providers expose neither enumerable content nor a graph. Open Recall and ask a focused question.",
			"overview.waitingSnapshot": "Waiting for the first snapshot",
			"overview.updatedAt": "Updated at {time}",
			"overview.edgeScope": "Space scope",
			"overview.edgeTemporal": "Temporal",
			"overview.edgeSemantic": "Semantic",
			"overview.edgeCausal": "Causal",
			"overview.edgeEntity": "Entity relation",
			"overview.graphComposition": "{spaces} spaces · {memories} memories · {entities} entities",
			"overview.graphCount": "Showing {visible} / {total} elements",
			"overview.graphEdges": "{count} graph edges",
			"overview.inspector": "Memory details",
			"overview.inspectorSpace": "Memory Space details",
			"overview.inspectorEntity": "Entity details",
			"overview.selectNode": "Select a graph element",
			"overview.selectNodeText": "Inspect the exact context for a Memory Space, entity, or memory.",
			"overview.closeInspector": "Close node details",
			"overview.memoryId": "Memory ID",
			"overview.spaceId": "Memory Space ID",
			"overview.containedMemories": "Contained memories",
			"overview.entityMentions": "Indexed mentions",
			"overview.exploreNode": "Recall around this",
			"overview.previewAria": "View full content",
			"overview.previewTitle": "Full content",
			"overview.loading": "Synchronizing the multi-space live snapshot…",
			"graph.layoutAria": "Graph layout",
			"graph.layoutNatural": "Natural layout",
			"graph.layoutUniform": "Uniform layout",
			"graph.layoutCustom": "Custom layout",
			"graph.layoutStatus": "Layout: {layout}",
			"graph.draggable": "{layout} · draggable",
			"graph.naturalAction": "Natural spread",
			"graph.uniformAction": "Uniform reset",
			"graph.aria": "Mnemon live memory graph with {nodes} elements and {edges} edges",
			"graph.kindSpace": "Memory Space",
			"graph.kindEntity": "Entity",
			"search.title": "Recall Memory",
			"search.description": "Retrieve raw evidence across active Memory Spaces; every provider uses its native recall method and keeps provenance.",
			"search.maxResults": "Up to {count} results",
			"search.placeholder": "Why did we choose SQLite? What release conventions apply?",
			"search.queryAria": "Memory query",
			"search.categoryAria": "Memory category",
			"search.strategy": "Strategy",
			"search.modeAria": "Recall mode",
			"search.modeSmart": "Smart recall",
			"search.modeKeyword": "Keyword search",
			"search.modeBasic": "Basic match",
			"search.searching": "Recalling…",
			"search.action": "Direct search",
			"search.agentAction": "Ask Agent",
			"search.agentSearching": "Agent analyzing…",
			"search.agentAnswer": "Agent answer",
			"search.agentAnswerHint": "Grounded in the recalled evidence below",
			"search.startTitle": "Start with a focused question",
			"search.startText": "A focused entity, decision, or timeline is more reliable than loading the whole database.",
			"search.emptyTitle": "No matches",
			"search.emptyText": "Try a more specific entity, decision, or timeline keyword.",
			"search.results": "Raw recalled evidence",
			"search.related": "Related memories",
			"search.closeRelated": "Close related memories",
			"search.traversing": "Traversing the graph…",
			"search.noRelated": "No related nodes found within two hops.",
			"search.sourcesTitle": "Search coverage",
			"entities.title": "Entity Explorer",
			"entities.description": "Inspect entity connections only in Memory Spaces that expose a real entity index.",
			"entities.sourcesTitle": "Entity capability coverage",
			"entities.unsupportedTitle": "No active space exposes an entity index",
			"entities.unsupportedText": "The active providers remain searchable through Recall, but are not presented here as a fabricated entity graph.",
			"entities.count": "{count} active entities",
			"entities.nameAria": "Entity name",
			"entities.placeholder": "Enter any entity…",
			"entities.action": "Explore",
			"entities.top": "Top entities",
			"entities.frequency": "By frequency",
			"entities.filterHint": "Type to filter the rail locally (Esc to clear).",
			"entities.emptyRail": "Entities appear here after memories with entity metadata are stored.",
			"entities.filterEmpty": "No local match. Press Explore to query the host.",
			"entities.loading": "Recalling entity relations…",
			"entities.selectTitle": "Select or enter an entity",
			"entities.selectText": "The entity view aggregates related memories instead of relying on literal matching.",
			"entities.emptyTitle": "No related memories",
			"entities.emptyText": "Try the full name or another entity alias.",
			"remember.title": "Distill Memory",
			"remember.description": "An independent task Agent with no conversation history selects a Memory Space, checks duplicates, distills the candidate, and completes the write without filling the main conversation context.",
			"remember.readOnlyTitle": "Read-only mode",
			"remember.readOnlyText": "This deployment disables memory writes. Change and save the DSH Mnemon configuration to enable them.",
			"remember.delegateTitle": "Send to independent task Agent",
			"remember.noSession": "No live session",
			"remember.ready": "Independent task Agent ready",
			"remember.noTaskAgent": "Task Agent unavailable",
			"remember.taskAgentReady": "Task Agent ready",
			"remember.candidate": "Candidate",
			"remember.candidateAria": "Memory candidate",
			"remember.placeholder": "Enter background, preferences, decisions, or insights worth retaining across tasks. The model decides whether they qualify.",
			"remember.sessionHint": "No usable model route is available for an independent task Agent.",
			"remember.taskAgentHint": "The Host cannot currently create an isolated task Agent. Refresh status and try again.",
			"remember.processing": "Independent task Agent is working…",
			"remember.action": "Evaluate and distill",
			"remember.advanced": "Advanced human constraints",
			"remember.advancedHint": "Constrain the target Memory Space and metadata",
			"remember.expand": "Expand",
			"remember.target": "Target Memory Space",
			"remember.asyncProviderHint": "This Memory Space waits for remote extraction to settle before returning a truthful write receipt.",
			"remember.entities": "Entities (comma-separated)",
			"remember.tags": "Tags (comma-separated)",
			"remember.advancedText": "Advanced options constrain the independent task Agent; they do not bypass supervision or duplicate checks.",
			"remember.saving": "Independent task Agent is writing…",
			"remember.advancedAction": "Distill with constraints",
			"remember.skipped": "The independent task Agent decided not to write",
			"remember.completed": "The independent task Agent completed processing",
			"remember.processed": "Independent task Agent processed: {action}",
			"remember.dispatchFailed": "Dispatch failed: {error}",
			"remember.saveFailed": "Save failed: {error}",
			"content.title": "Memory Content",
			"content.description": "Inspect observable content through each provider’s real browse contract, with enumerable, query-only, and unavailable engines kept distinct.",
			"content.sourcesTitle": "Provider content models",
			"content.count": "{count} memories",
			"content.filterAria": "Filter memory content",
			"content.filterPlaceholder": "Filter by content or exact ID…",
			"content.categoryAria": "Memory category",
			"content.apply": "Apply filters",
			"content.notice": "Content calls each provider’s read-only browse contract directly; query-only engines run only after you enter a query.",
			"content.queryRequiredTitle": "Query-only spaces are waiting",
			"content.queryRequiredText": "Enter a focused query to inspect providers such as ByteRover that do not expose a complete list.",
			"content.showing": "Showing {visible} / {total}",
			"content.showMore": "Show {count} more",
			"content.emptyTitle": "No matching memories",
			"content.emptyText": "Clear the filters or distill the first durable memory.",
			"nav.spaces": "Memory Spaces",
			"overview.editSpace": "Edit",
			"overview.editSpaceAria": "Edit {name}",
			"overview.saveSpace": "Save",
			"overview.savingSpace": "Saving…",
			"overview.deleteSpace": "Delete",
			"overview.deleteSpaceAria": "Delete {name}",
			"overview.disconnectSpace": "Disconnect",
			"overview.disconnectSpaceAria": "Disconnect {name}",
			"overview.deletingSpace": "Deleting…"
		};
		//#endregion
		//#region src/client/locales.ts
		/** Mnemon workspace copy, synchronized with DSH's global locale service. */
		const zh = {
			...zh$3,
			...zh$2,
			...zh$1,
			"tab.label": "记忆系统",
			"nav.aria": "Mnemon 页面",
			"nav.group.system": "系统",
			"nav.group.storage": "三层记忆",
			"nav.group.tools": "读写工具",
			"nav.group.sources": "Source 插件",
			"nav.status": "状态",
			"common.refresh": "刷新状态",
			"common.loading": "载入中…",
			"common.cancel": "取消",
			"common.copyId": "复制 ID",
			"common.readOnly": "只读模式",
			"common.activationOnly": "仅可切换激活状态",
			"common.agentSupervised": "独立任务 Agent",
			"common.active": "已激活",
			"common.inactive": "未激活",
			"common.category": "分类",
			"common.importanceLabel": "重要性",
			"common.importance": "重要性 {value}",
			"common.hops": "{count} 跳",
			"common.allCategories": "全部分类",
			"common.memories": "{count} 条记忆",
			"common.edges": "{count} 条连接",
			"common.count": "{count} 个",
			"common.showing": "当前显示 {visible} / {total}",
			"common.showMore": "再显示 {count} 条",
			"header.backToConversation": "返回会话",
			"header.checking": "检查中",
			"header.connected": "已连接",
			"header.unavailable": "不可用",
			"header.notReady": "Mnemon 尚未就绪",
			"workspace.viewing": "查看工作区",
			"workspace.selectorAria": "选择要查看的记忆工作区",
			"workspace.storageMode": "存储位置",
			"workspace.storageModeAria": "存储位置模式：{mode}",
			"workspace.mismatchTitle": "查看目录与当前会话未对齐",
			"workspace.mismatchShort": "非对话工作区",
			"workspace.selectedRoot": "查看：{root}",
			"workspace.effectiveRoot": "生效：{root}",
			"workspace.align": "对齐对话",
			"sourcePage.instance": "Source 实例",
			"sourcePage.instanceAria": "选择 Source 实例",
			"sourcePage.summaryAria": "Source 状态与权限摘要",
			"sourcePage.package": "来源包",
			"sourcePage.availability": "可用性",
			"sourcePage.availability.ready": "可用",
			"sourcePage.availability.degraded": "降级",
			"sourcePage.availability.unavailable": "不可用",
			"sourcePage.role": "语义角色",
			"sourcePage.revision": "当前修订",
			"sourcePage.permissions": "受权能力",
			"sourcePage.diagnostics": "诊断",
			"sourcePage.configuration": "声明式配置",
			"sourcePage.configurationDescription": "字段来自 Host 的脱敏 management descriptor；提交会按当前实例与修订重新授权。",
			"sourcePage.configLoading": "载入配置…",
			"sourcePage.configSave": "保存配置",
			"sourcePage.configSaving": "保存中…",
			"sourcePage.configSaved": "配置已提交，正在刷新 Source 状态。",
			"sourcePage.secretPlaceholder": "留空以保留现有密钥",
			"sourcePage.unavailable": "Source 当前不可用",
			"sourcePage.unavailableDescription": "当前 scope 中没有可调用的实例。Host 与 Headless 记忆运行不受此页面影响。",
			"telemetry.aria": "记忆统计",
			"telemetry.title": "记忆统计",
			"telemetry.memories": "激活记忆",
			"telemetry.graph": "激活图谱",
			"telemetry.entities": "激活实体",
			"telemetry.spaces": "记忆空间",
			"sidebar.activeSpaces": "已激活记忆空间",
			"config.providerSecretShow": "显示凭证",
			"config.providerSecretHide": "隐藏凭证",
			"config.providerSecretStoredValue": "已保存凭证",
			"card.confirmText": "软删除这条记忆？",
			"card.processing": "处理中…",
			"card.confirmForget": "确认忘记",
			"card.related": "查看关联",
			"card.clone": "基于此新建",
			"card.forget": "忘记",
			"turnTail.label": "本回合记忆",
			"turnTail.recall": "召回 {count}",
			"turnTail.write": "沉淀 {count}",
			"turnTail.documents": "档案检索 {count}",
			"turnTail.inspect": "检查 {count}",
			"turnTail.failed": "失败 {count}",
			"turnTail.toolList": "本回合记忆工具",
			"turnTail.openTool": "打开 {tool} 对应的记忆页面",
			"saveAction.button": "存入记忆",
			"saveAction.tooltip": "将这条回复存入记忆",
			"saveAction.title": "确认存入记忆",
			"saveAction.hint": "独立任务 Agent 会判断是否值得沉淀，并查重、提炼、选择记忆空间后写入；不会读取或挤占主对话上下文。",
			"saveAction.fetching": "提取消息文本…",
			"saveAction.missing": "无法从会话记录提取这条消息的文本。",
			"saveAction.candidate": "候选内容（可编辑）",
			"saveAction.truncated": "原回复较长，这里仅载入前 {limit} 个字符。",
			"saveAction.submit": "确认并交给独立任务 Agent",
			"saveAction.submitting": "调度中…",
			"saveAction.result": "独立任务 Agent：{summary}",
			"saveAction.failed": "调度失败：{error}",
			"saveAction.readOnly": "当前部署为只读模式，无法写入记忆。",
			"saveAction.close": "关闭",
			"readSources.all": "全部 Provider",
			"readSources.mode.search": "原生检索",
			"readSources.mode.graph": "真实关系图",
			"readSources.mode.projection": "内容投影",
			"readSources.mode.enumerable": "可枚举内容",
			"readSources.mode.query-only": "仅查询",
			"readSources.mode.entities": "实体索引",
			"readSources.mode.unsupported": "不支持",
			"readSources.status.ready": "{count} 条可观察",
			"readSources.status.empty": "已连接 · 暂无内容",
			"readSources.status.query-required": "输入查询后读取",
			"readSources.status.unsupported": "当前表面不可用",
			"readSources.status.unavailable": "连接不可用",
			"readSources.edges": "{count} 条真实关系",
			"readSources.model.mnemon-native": "事实、实体与类型关系",
			"readSources.model.openviking": "目录与分层内容",
			"readSources.model.honcho": "Peer 结论与画像",
			"readSources.model.mem0": "提炼后的语义记忆",
			"readSources.model.hindsight": "记忆单元与知识图",
			"readSources.model.holographic": "可信事实与实体",
			"readSources.model.retaindb": "画像与类型化事实",
			"readSources.model.byterover": "知识树查询",
			"readSources.model.supermemory": "记忆与摄取文档",
			"status.title": "系统状态",
			"status.description": "聚焦 dsh-mnemon、各记忆 Provider、三层存储和当前读写目录；连接配置由 DSH 部署统一管理。",
			"status.nominal": "系统正常",
			"status.reviewFailed": "后台审查失败",
			"status.reviewFailedDetail": "本轮记忆检查未完成；候选内容会保留到后续符合条件的审查。",
			"status.reviewContextWindow": "请在 Mnemon 设置中选择上下文窗口足以覆盖父会话的任务模型。后台审查需要继承父会话。",
			"status.checkRequired": "需要检查",
			"status.rechecking": "检查中…",
			"status.recheck": "重新检查",
			"status.aria": "Mnemon 运行状态",
			"status.engine": "记忆引擎",
			"status.engineConnected": "Mnemon 已连接",
			"status.engineUnavailable": "Mnemon 不可用",
			"status.engineChecking": "正在检查本地引擎",
			"status.versionWaiting": "等待版本信息",
			"status.pluginChecking": "正在检查插件状态",
			"status.pluginReady": "插件运行正常",
			"status.nativeAria": "mnemon Provider 状态",
			"status.nativeLabel": "Native Provider",
			"status.nativeCliMissing": "未找到 Mnemon CLI",
			"status.providersTitle": "三方 Provider",
			"status.providersDescription": "持续汇总已启用 Provider 及其记忆空间连接状态；关闭的 Provider 不进行探测或参与路由。",
			"status.providersAria": "三方 Provider 状态",
			"status.providersEnabled": "{enabled} / {total} 已启用",
			"status.providerState.disabled": "已关闭",
			"status.providerState.idle": "服务就绪 · 尚无已激活记忆空间",
			"status.providerState.healthy": "连接正常",
			"status.providerState.unhealthy": "连接需要检查",
			"status.providerSpaces": "{active} / {total} 个记忆空间参与运行",
			"versions.checkAction": "检查版本",
			"versions.title": "检查与更新版本",
			"versions.description": "查看当前安装，按需更新；展开 dsh-mnemon 可维护各子包。",
			"versions.missing": "待安装",
			"versions.restart": "待重启",
			"versions.local": "本地版本",
			"versions.modeNpmCli": "npm",
			"versions.hintNpm": "由 npm 管理；可在此更新，或在宿主终端运行 mnemon update。",
			"versions.hintNpmMissing": "已找到 npm 启动器，但宿主当前找不到 npm；请检查 Node.js 环境。",
			"versions.hintNpmUnmanaged": "当前 npm 不拥有这个 CLI 的全局安装；请切换到原 Node.js 环境，或按下方指引迁移。",
			"versions.hintUnreadable": "找到了 CLI，但无法读取版本；请在宿主终端检查该命令，或重新安装。",
			"versions.hintStarter": "随 dsh-mnemon 主包维护；升级主包以采用经过验证的子包组合。",
			"versions.npmRecommended": "npm 安装与维护",
			"versions.npmMaintenance": "通过 npm 维护 CLI",
			"versions.npmInstall": "通过 npm 安装（推荐）",
			"versions.npmMigrate": "改用 npm 维护（推荐）",
			"versions.npmRepair": "检查或修复 npm 安装",
			"versions.npmRepairDetail": "请先检查上方的安装状态。需要重新安装时，在运行 DSH 的宿主终端执行以下命令（Node.js 22+）。",
			"versions.npmUpdateDetail": "后续更新可直接运行以下命令；更新后点击“重新检查”确认生效。",
			"versions.npmInstallDetail": "Mnemon Native 需要独立的 CLI。在运行 DSH 的宿主终端执行以下命令（Node.js 22+）。",
			"versions.npmMigrateDetail": "若改用 npm，在 DSH 宿主终端执行（Node.js 22+）。",
			"versions.npmVerify": "安装后确认版本，再点击“重新检查”：",
			"versions.npmNextSteps": "安装后：验证版本与生效路径",
			"versions.npmPath": "确保 npm 全局命令目录位于 PATH 前部。若设置了 MNEMON_CLI_PATH 或 mnemon.cliPath，请同步指向新的启动器；宿主环境改变后重启 DSH，并核对上方的可执行文件路径。",
			"versions.installGuide": "查看安装说明",
			"versions.copy": "复制",
			"versions.copied": "已复制",
			"versions.copyCommand": "复制命令：{command}",
			"versions.copyFailed": "无法访问剪贴板，请选中命令手动复制。",
			"versions.readOnly": "当前为只读访问，可检查版本和复制命令；在拥有管理权限的连接中执行页面更新。",
			"versions.packages": "子包版本（{count}）",
			"versions.packagesOutdated": "{count} 个有新版本",
			"versions.packagesDetail": "展开查看维护方式",
			"versions.packagesHide": "收起子包详情",
			"versions.packagesHint": "默认组合随主包更新；在当前 Profile 中独立安装的子包可单独更新。更新后重启 dsh web。",
			"versions.managedStarter": "随主包维护",
			"versions.managedProfile": "Profile 独立维护",
			"versions.starterVersion": "主包指定",
			"versions.kind.source": "Sources · 记忆源",
			"versions.kind.strategy": "Strategies · 策略",
			"versions.kind.provider": "Providers · 后端",
			"versions.checking": "正在检查远程仓库中的新版本…",
			"versions.checkingShort": "检查中…",
			"versions.recheck": "重新检查",
			"versions.failed": "版本操作失败",
			"versions.timeout": "版本检查超时，请检查网络后重试。",
			"versions.current": "已是最新",
			"versions.available": "可更新",
			"versions.unknown": "无法确认",
			"versions.installed": "当前版本",
			"versions.latest": "最新版本",
			"versions.executable": "可执行文件",
			"versions.profileLocation": "Profile · {name}",
			"versions.sourceLocation": "源码",
			"versions.linkSourceLocation": "源码 · Profile {name}",
			"versions.packageLocation": "包目录",
			"versions.update": "更新",
			"versions.updating": "更新中…",
			"versions.updated": "{name} 已更新",
			"versions.alreadyCurrent": "当前已经是最新版本",
			"versions.restartRequired": "请重启 dsh web，以加载新的 dsh-mnemon 插件代码。",
			"versions.checkedAt": "检查于 {time}",
			"versions.latestUnavailable": "暂时无法读取远程最新版本；请检查网络后重试。",
			"versions.modeHomebrew": "Homebrew",
			"versions.modeGo": "Go 安装",
			"versions.modeNpm": "DSH Profile",
			"versions.modeLink": "本地 Link",
			"versions.modeManual": "手工安装",
			"versions.modeMissing": "未安装",
			"versions.hintHomebrew": "由 Homebrew 管理；发现新版本时可在此安全更新。",
			"versions.hintBrewMissing": "检测到 Homebrew 安装，但当前找不到 brew 命令。",
			"versions.hintGo": "由 go install 管理；发现新版本时可在此安全更新。",
			"versions.hintPnpm": "由当前 DSH Profile 管理；更新后需要重启 dsh web。",
			"versions.hintPnpmMissing": "检测到 DSH Profile 安装，但当前找不到 pnpm 命令。",
			"versions.hintLink": "当前为本地 Link 开发版本；请在源码目录拉取并构建，避免覆盖本地修改。",
			"versions.hintInstall": "未找到 Mnemon CLI；请先安装并确保 mnemon 位于 PATH，或设置 MNEMON_CLI_PATH / mnemon.cliPath。",
			"versions.hintManual": "无法安全识别安装来源；请沿用原安装方式手工更新。",
			"status.spaces": "记忆空间",
			"status.activeRatio": "{active} / {total} 已激活",
			"status.runtime": "运行时",
			"status.runtimeRatio": "{user} 用户 · {memory} 项目",
			"status.runtimeBytes": "{bytes} 已使用",
			"status.runtimeWaiting": "等待同步",
			"status.runtimeWaitingDetail": "宿主存储清单待返回",
			"status.directoryUnsynced": "目录尚未同步",
			"status.activeMemories": "{count} 条激活记忆",
			"status.documents": "项目档案",
			"status.documentsWaiting": "等待工作区",
			"status.documentsSession": "绑定活动会话后可用",
			"status.documentRatio": "{active} 份活跃 · {archived} 份归档",
			"status.documentUsage": "{used} / {limit} 活跃容量",
			"status.storageDomains": "存储域",
			"status.storageDomainsText": "当前选择决定热记忆、记忆空间和项目档案共同使用的目录边界。",
			"status.storageBrowseOnly": "查看不会切换写入",
			"status.storageScopeAria": "选择要查看的存储域",
			"status.storageGlobal": "全局",
			"status.storageWorkspace": "工作区",
			"status.storageWorkspaces": "集中存储 · 工作区隔离",
			"status.storageCustom": "自定义",
			"status.storageCurrent": "当前读写",
			"status.storageWaiting": "正在读取存储域目录…",
			"status.storageCustomUnset": "尚未配置自定义目录。当前只展示已经由 DSH 配置并启用的自定义根。",
			"status.storageWorkspaceUnavailable": "当前会话没有可用的工作区目录。",
			"status.storageActiveRoot": "当前读写根",
			"status.storageViewedRoot": "查看根",
			"status.storageAvailable": "目录可用",
			"status.storageNotCreated": "目录尚未创建",
			"status.storageRuntime": "运行时记忆",
			"status.storageBodies": "记忆空间",
			"status.storageSpaces": "记忆空间",
			"status.storageDocuments": "项目档案",
			"status.storageState": "后台状态",
			"status.storageReady": "正常",
			"status.storageEmpty": "空",
			"status.storageMissing": "未创建",
			"status.storageInvalid": "需修复",
			"status.storageItems": "项",
			"status.storageRuntimeDetail": "USER {user} · MEMORY {memory}",
			"status.storageBodiesDetail": "{active} 个激活 · {databases} 个数据库",
			"status.storageSpacesDetail": "{active} 个激活 · {databases} 个数据库",
			"status.storageDocumentsDetail": "{active} 份活跃 · {archived} 份归档",
			"status.storageStateReady": "审阅水位已经持久化",
			"status.storageStateVolatile": "当前审阅状态仍由 Host 进程维护",
			"status.storageFootnote": "当前实际读写根：{root}。存储范围只在 DSH「设置 → 记忆系统」中修改，保存后实时生效；插件不会自动迁移、合并或删除旧内容。",
			"config.aria": "记忆系统配置",
			"config.tab": "Mnemon",
			"config.title": "记忆系统设置",
			"config.description": "统一配置运行时记忆、项目档案、记忆空间和 DSH 界面；点击保存后立即生效。",
			"config.unsaved": "有未保存修改",
			"config.ready": "已保存并实时生效",
			"config.noticeBefore": "配置写入",
			"config.noticeAfter": "；所有设置点击保存后实时生效。切换范围不会自动迁移旧内容。",
			"config.displayTitle": "展示位置",
			"config.displayDescription": "两种入口使用相同的记忆系统界面；保存后立即切换，不改变存储范围或已有数据。",
			"config.displayAria": "记忆系统展示位置",
			"config.displaySidebar": "Sidebar",
			"config.displaySidebarHint": "侧边栏独立入口，可查看其他工作区",
			"config.displayBuiltin": "Builtin",
			"config.displayBuiltinHint": "会话内标签页，自动跟随当前会话的记忆范围",
			"config.storageTitle": "记忆范围",
			"config.storageDescription": "决定 Runtime、Documents、mnemon 及支持工作区绑定的 Provider 是否随当前工作区隔离；其余 Provider 保持自身全局作用域。",
			"config.scope": "存储范围",
			"config.scopeHint": "全局供所有工作区共享；工作区按当前 DSH 会话隔离；自定义使用指定目录。",
			"config.scopeAria": "记忆系统范围",
			"config.global": "全局",
			"config.workspace": "工作区",
			"config.workspaces": "集中存储 · 按工作区隔离",
			"config.workspacesHint": "统一根目录下，每个工作区使用独立子目录",
			"config.workspacesRoot": "集中根目录",
			"config.workspacesRootHint": "可选。使用绝对路径或 ~/；留空使用 MNEMON_DATA_DIR 或 ~/.mnemon。",
			"config.workspacesDefault": "默认目录（MNEMON_DATA_DIR 或 ~/.mnemon）",
			"config.workspacesIdentityHint": "数据保存在 workspaces/<工作区路径哈希>/ 下。移动或重命名工作区会使用新目录；切换范围不会迁移、合并或删除旧数据。",
			"config.custom": "自定义",
			"config.customHintShort": "填写一个目录",
			"config.customSelected": "已填写目录",
			"config.globalScopeHint": "跨工作区共享",
			"config.runtimeUserScopeTitle": "用户档案范围",
			"config.runtimeUserScopeDescription": "USER.md 可以跟随当前记忆范围，也可以单独保持全局；MEMORY.md、项目档案与记忆空间仍使用上方范围。",
			"config.runtimeUserScopeAria": "USER.md 用户档案范围",
			"config.runtimeUserScopeStorage": "跟随记忆范围",
			"config.runtimeUserScopeStorageHint": "USER.md 与 MEMORY.md 使用同一根目录",
			"config.runtimeUserScopeGlobal": "全局用户档案",
			"config.runtimeUserScopeGlobalHint": "跨工作区共享 USER.md，项目记忆继续隔离",
			"config.topologyTitle": "记忆层",
			"config.topologyDescription": "每层只有开启或关闭。开启后由系统按需使用；关闭不会删除已有数据，重新开启即可恢复。",
			"config.topologyLoading": "正在读取记忆层…",
			"config.topologyUnavailable": "当前 Host 尚未提供记忆层状态；已有配置与兼容行为保持不变。",
			"config.topologyEnabled": "已开启",
			"config.topologyDisabled": "已关闭",
			"config.topologyLayerToggle": "启用 {layer}",
			"config.enhancementsTitle": "记忆增强",
			"config.enhancementsDescription": "为默认三层记忆开启可选行为；切换后立即生效。",
			"config.enhancementCapture": "主动记录",
			"config.enhancementCaptureHint": "在当前对话中识别并保存值得长期保留的事实",
			"config.enhancementLightContext": "轻量上下文",
			"config.enhancementLightContextHint": "减少常驻内容，同时保留按需读取能力",
			"config.enhancementScoped": "范围组合",
			"config.enhancementScopedHint": "按稳定顺序组合当前可用的记忆来源",
			"config.enhancementsFailed": "无法更新记忆增强设置，请重试。",
			"config.enhancementsRefreshFailed": "设置已更新，但状态刷新失败；请重新打开设置。",
			"layers.runtimeLabel": "运行时记忆",
			"layers.runtimeDescription": "有界且确定的热记忆，在每个符合条件的回合中直接注入。",
			"layers.documentsLabel": "项目档案",
			"layers.documentsDescription": "可版本化的叙事文档，先检索，再按需阅读全文。",
			"layers.memorySpacesLabel": "记忆空间",
			"layers.memorySpacesDescription": "由 Provider 支撑的持久证据，按需跨任务与会话召回。",
			"layers.disabledBadge": "已关闭",
			"layers.disabledTitle": "{layer} 已关闭",
			"layers.disabledDescription": "此记忆层当前不参与记忆处理。",
			"layers.disabledText": "已有数据完整保留；在设置中重新开启后即可恢复读取、写入与按需调用。",
			"config.providersTitle": "记忆空间 Provider",
			"config.providersDescription": "在这里启用并配置 Provider 服务。启用或保存会同步服务中已有的记忆空间；关闭会移除本地映射，但不会删除第三方数据。范围标签显示当前生效边界。",
			"config.nativeSummary": "官方原生长期记忆与完整关系图",
			"config.officialNative": "官方原生",
			"config.nativeGlobalLocation": "全局数据位置",
			"config.nativeGlobalLocationHint": "mnemon 的全局范围可以使用默认目录或指定一个目录。",
			"config.nativeGlobalLocationWorkspaceHint": "当前使用工作区范围；切换到全局后可选择默认或自定义目录。",
			"config.nativeDefaultLocation": "默认 ~/.mnemon",
			"config.embeddingTitle": "本地向量嵌入",
			"config.embeddingDescription": "让 DSH Host 为每次 Mnemon CLI 调用注入嵌入 Endpoint 与模型；Endpoint 以 /v1 结尾时 Mnemon 自动使用 OpenAI 兼容协议（/v1/embeddings + Bearer 认证），否则使用 Ollama 协议；不以 /v1 结尾的兼容端点可在“协议”下拉中显式指定。",
			"config.embeddingManaged": "由 DSH 管理嵌入配置",
			"config.embeddingManagedHint": "开启后以这里保存的值覆盖 Mnemon 子进程环境；关闭后继续沿用 Host 环境与 Mnemon 默认值。",
			"config.embeddingEndpoint": "嵌入 Endpoint",
			"config.embeddingModel": "嵌入模型",
			"config.embeddingApiKey": "API Key（可选，OpenAI 兼容服务）",
			"config.embeddingApiKeyInvalid": "API Key 不能包含控制字符，且长度不超过 2048。",
			"config.embeddingProtocol": "协议",
			"config.embeddingProtocolAuto": "自动（按 /v1 探测）",
			"config.embeddingProtocolOllama": "Ollama",
			"config.embeddingProtocolOpenai": "OpenAI 兼容",
			"config.embeddingProtocolInvalid": "协议必须是 自动 / Ollama / OpenAI 兼容 之一。",
			"config.embeddingEndpointInvalid": "嵌入 Endpoint 必须是不含凭据、查询参数或片段的 HTTP(S) 绝对 URL。",
			"config.embeddingModelInvalid": "嵌入模型必须包含 1–200 个字符，且不能包含控制字符。",
			"config.embeddingSecurity": "Mnemon 会把记忆与查询正文发送到该 Endpoint；API Key 与其他设置一样保存在 DSH 设置文件中。远程 HTTP 会明文传输，请仅使用受信任的本地地址，或为远程服务配置 HTTPS。",
			"config.embeddingTest": "测试状态",
			"config.embeddingNotTested": "尚未检查当前 Mnemon Store 的连接与嵌入覆盖率。",
			"config.embeddingTesting": "正在通过 Mnemon 检查嵌入服务与覆盖率…",
			"config.embeddingSaveBeforeTest": "请先保存嵌入配置，再测试实际运行值。",
			"config.embeddingTestUnavailable": "当前 DSH Host 不提供嵌入状态检查。",
			"config.embeddingStatusAvailable": "嵌入服务可用 · {model} · 已嵌入 {embedded}/{total}（{coverage}）",
			"config.embeddingStatusAvailableWithProtocol": "嵌入服务可用 · {model} · 协议 {protocol} · 已嵌入 {embedded}/{total}（{coverage}）",
			"config.embeddingStatusUnavailable": "嵌入服务不可达 · {model} · 已嵌入 {embedded}/{total}（{coverage}）",
			"config.embeddingStatusUnavailableWithProtocol": "嵌入服务不可达 · {model} · 协议 {protocol} · 已嵌入 {embedded}/{total}（{coverage}）",
			"config.embeddingStatusFailed": "嵌入状态检查失败：{error}",
			"config.providerGlobalLocation": "全局数据位置",
			"config.providerGlobalLocationHint": "{provider} 默认使用全局范围目录，也可以指定一个自定义位置。",
			"config.providerGlobalLocationWorkspaceHint": "当前使用工作区默认位置；切换到全局范围后可指定自定义位置。",
			"config.providerDefaultLocation": "默认（跟随范围）",
			"config.providerDefaultName": "{provider} 记忆空间",
			"config.providerDefaultDescription": "由 dsh-mnemon 使用的 {provider} 长期记忆。",
			"config.newProviderConfig": "新记忆空间配置",
			"config.newProviderConfigHint": "保存后立即创建并启用，不需要再到概览重复连接。",
			"config.providerHealthy": "连接正常，可直接参与记忆工作流",
			"config.providerNeedsAttention": "连接需要检查，仍可修改并重新保存",
			"config.providerActive": "参与读取与路由",
			"config.providerMemoryName": "记忆空间名称",
			"config.providerMemoryDescription": "用途说明",
			"config.providerSaveFailed": "配置保存失败：{error}",
			"config.providerSaved": "配置已保存",
			"config.createAndEnable": "保存并启用",
			"config.saveProviderConfig": "保存配置",
			"config.addProviderConfig": "添加一份记忆空间配置",
			"config.providerNotConfigured": "未配置",
			"config.providerConfiguredCount": "{count} 份配置",
			"config.providerServiceTitle": "服务配置",
			"config.providerServiceHint": "供该 Provider 的所有记忆空间复用；启用或保存时会刷新记忆空间目录中的映射与元信息。",
			"config.providerEnableHint": "填写服务配置并保存后，Provider 会启用并同步所有可见记忆空间。",
			"config.providerServiceConfigured": "服务已配置",
			"config.providerServiceNotConfigured": "服务未配置",
			"config.providerEnabled": "已启用",
			"config.providerDisabled": "未启用",
			"config.providerDisabledConfigured": "已关闭 · 配置已保留",
			"config.providerNeedsConfiguration": "需要完成配置",
			"config.providerToggleAria": "启用 {provider}",
			"config.providerToggleFailed": "切换失败：{error}",
			"config.enableProvider": "保存并启用",
			"config.providerServiceSaved": "服务配置已保存，记忆空间目录已同步",
			"config.saveProviderService": "保存服务配置",
			"config.providerUnavailable": "当前 DSH 主机不支持 Provider 服务配置。",
			"config.saveScopeBeforeProviders": "存储范围有未保存修改。请先保存范围，再配置对应目录中的 Provider。",
			"config.providerTargetWorkspace": "当前工作区：{workspace}；标记“工作区”的 Provider 配置与记忆空间使用此范围。",
			"config.loadingProviders": "正在读取 Provider 配置…",
			"config.providerLoadFailed": "读取 Provider 配置失败：{error}",
			"config.retryProviders": "重试",
			"config.taskAgentTitle": "后台任务 Agent",
			"config.taskAgentDescription": "AI 元信息、Agent 查询、记忆沉淀、档案归档以及空闲复盘等子代理委托共用模型路由；这里只调整这些后台任务的模型，不影响主对话。",
			"config.taskAgentModeAria": "后台任务 Agent 模型路由",
			"config.taskAgentInherit": "跟随主链路",
			"config.taskAgentInheritHint": "使用 DSH 新会话默认模型",
			"config.taskAgentFixed": "指定模型 Provider",
			"config.taskAgentFixedHint": "为 Mnemon 后台任务 Agent 以及子代理委托固定路由",
			"config.taskAgentProvider": "模型 Provider",
			"config.taskAgentProviderHint": "选择 DSH 已配置的模型服务",
			"config.taskAgentModel": "模型",
			"config.taskAgentModelHint": "选择该 Provider 下的完整模型路由",
			"config.taskAgentChooseProvider": "选择 Provider",
			"config.taskAgentChooseModel": "选择模型",
			"config.taskAgentImageInput": "图片输入",
			"config.taskAgentEffective": "当前将使用",
			"config.taskAgentLoading": "正在读取模型目录",
			"config.taskAgentUnavailable": "尚无可用的 Provider / Model 路由",
			"config.taskAgentLoadFailed": "模型目录读取失败：{error}",
			"config.taskAgentPartial": "有 {count} 个 Provider 暂时无法读取，其他选项仍可使用。",
			"config.taskAgentRouteRequired": "指定后台任务模型时，必须同时选择 Provider 和模型。",
			"config.customPack": "自定义 Pack",
			"config.customPackAria": "选择自定义 Mnemon Pack",
			"config.customPackRequired": "请选择或添加一个自定义 Pack。",
			"config.customDefaultName": "自定义 Pack",
			"config.noCustomPacks": "尚未配置 Pack",
			"config.addPack": "添加 Pack",
			"config.cancelAddPack": "取消添加",
			"config.removePack": "移除",
			"config.customPackNameAria": "新 Pack 名称",
			"config.customPackNamePlaceholder": "例如：项目记忆",
			"config.newPackDirectoryAria": "新 Pack 数据目录",
			"config.confirmAddPack": "加入列表",
			"config.customDirectory": "自定义目录",
			"config.customHint": "整个 Mnemon 数据域都位于此处。",
			"config.customAria": "Mnemon 自定义数据目录",
			"config.customDirectoryHint": "填写 DSH Host 上的目录路径，只保存这一个目录。",
			"config.customPlaceholder": "例如：/data/mnemon 或 ~/mnemon",
			"config.invalidScope": "存储范围无效。",
			"config.invalidRuntimeUserScope": "USER.md 用户档案范围无效。",
			"config.customRequired": "选择自定义存储时必须填写数据目录。",
			"config.customAbsolute": "自定义目录必须是绝对路径或以 ~/ 开头；Windows 可填写盘符或 UNC 路径。",
			"config.saveFailed": "保存失败：{error}",
			"config.readOnly": "当前部署的插件设置为只读。",
			"config.unavailable": "无法加载记忆系统设置。请检查 Host 是否已为当前 Web 部署授权设置 RPC。",
			"config.discard": "放弃修改",
			"config.saving": "保存中…",
			"config.save": "保存",
			"config.overridden": "已覆盖",
			"config.interactionTitle": "对话界面",
			"config.interactionLive": "实时生效",
			"config.interactionHint": "保存后实时生效；关闭某项后恢复 DSH 原生呈现。",
			"config.interactionTurnBar": "回合记忆条",
			"config.interactionTurnBarHint": "在回合尾部展示召回、沉淀与检索活动",
			"config.interactionSaveAction": "存入记忆按钮",
			"config.interactionSaveActionHint": "在已定稿回复旁提供受监督的记忆沉淀入口",
			"config.interactionOn": "开启",
			"config.packTitle": "备份与迁移",
			"config.packDescription": "整体导出与导入当前生效目录；导入始终落到下方显示的位置。",
			"config.packActiveTarget": "当前生效目录",
			"config.packTargetLoading": "正在读取运行目标…",
			"config.packUnavailable": "当前 DSH 主机不支持 Mnemon ZIP 备份通道。",
			"config.packFull": "整体 Pack",
			"config.packFullHint": "Runtime、Documents 与记忆空间",
			"config.packRuntime": "Runtime",
			"config.packRuntimeHint": "热记忆与 USER / MEMORY 投影",
			"config.packDocuments": "Documents",
			"config.packDocumentsHint": "项目文档、归档与索引",
			"config.packMemorySpaces": "记忆空间",
			"config.packMemorySpacesHint": "目录清单与 mnemon.db",
			"config.packExport": "导出",
			"config.packImport": "导入",
			"config.packExporting": "导出中…",
			"config.packInspecting": "检查中…",
			"config.packImporting": "导入中…",
			"config.packChooseFile": "选择{component}文件",
			"config.packFormatHint": "统一使用 .mnemonpack（ZIP + manifest + SHA-256）；记忆空间仍以独立 mnemon.db 保存在包内。",
			"config.packPreviewEyebrow": "导入预览",
			"config.packUnnamed": "未命名 Mnemon Pack",
			"config.packSource": "来源",
			"config.packDestination": "导入到",
			"config.packArchiveSize": "压缩 / 展开",
			"config.packComponents": "选择要导入的组件",
			"config.packComponentSummary": "{items} 项 · {files} 个文件 · {size}",
			"config.packHasData": "目标已有数据",
			"config.packMerge": "安全合并（推荐）",
			"config.packMergeHint": "保留现有内容；冲突项自动去重或生成新 ID。",
			"config.packMergeAction": "合并导入",
			"config.packReplace": "覆盖当前组件？",
			"config.packReplaceHint": "所选组件会被 Pack 内容原子替换；其他组件不受影响。",
			"config.packReplaceAction": "覆盖导入…",
			"config.packConfirmReplace": "确认覆盖",
			"config.packComponentMissing": "这个 Pack 不包含所选组件。",
			"config.packExported": "已导出 {file}（{size}）。",
			"config.packImported": "已将 {components} 导入 {root}。",
			"config.packFailed": "ZIP 操作失败：{error}",
			"config.packSimpleDescription": "备份或恢复当前 Mnemon 数据；第三方 Provider 数据仍由对应服务管理。",
			"config.packWholeZip": "当前目录 ZIP",
			"config.packWholeZipHint": "包含 Runtime、Documents 和 mnemon 记忆空间；不包含第三方数据或密钥。",
			"config.packImportZip": "导入 ZIP",
			"config.packExportZip": "导出 ZIP",
			"config.packChooseZip": "选择 Mnemon 备份 ZIP",
			"config.packUnnamedZip": "Mnemon 备份.zip",
			"config.packZipReady": "校验通过 · {components} 个组件 · {items} 项 · {size}",
			"config.packImportZipAction": "安全导入",
			"config.packImportedWhole": "已将 ZIP 安全合并到 {root}。"
		};
		const en = {
			...en$3,
			...en$2,
			...en$1,
			"tab.label": "Memory System",
			"nav.aria": "Mnemon pages",
			"nav.group.system": "System",
			"nav.group.storage": "Memory tiers",
			"nav.group.tools": "Read and write",
			"nav.group.sources": "Source plugins",
			"nav.status": "Status",
			"common.refresh": "Refresh status",
			"common.loading": "Loading…",
			"common.cancel": "Cancel",
			"common.copyId": "Copy ID",
			"common.readOnly": "Read only",
			"common.activationOnly": "Activation control only",
			"common.agentSupervised": "Subagent supervised",
			"common.active": "Active",
			"common.inactive": "Inactive",
			"common.category": "Category",
			"common.importanceLabel": "Importance",
			"common.importance": "Importance {value}",
			"common.hops": "{count} hops",
			"common.allCategories": "All categories",
			"common.memories": "{count} memories",
			"common.edges": "{count} edges",
			"common.count": "{count}",
			"common.showing": "Showing {visible} / {total}",
			"common.showMore": "Show {count} more",
			"header.backToConversation": "Back to chat",
			"header.checking": "Checking",
			"header.connected": "Connected",
			"header.unavailable": "Unavailable",
			"header.notReady": "Mnemon is not ready",
			"workspace.viewing": "Viewing workspace",
			"workspace.selectorAria": "Select a memory workspace to inspect",
			"workspace.storageMode": "Storage",
			"workspace.storageModeAria": "Storage location mode: {mode}",
			"workspace.mismatchTitle": "The inspected directory is not aligned with this session",
			"workspace.mismatchShort": "Not conversation workspace",
			"workspace.selectedRoot": "Viewing: {root}",
			"workspace.effectiveRoot": "Effective: {root}",
			"workspace.align": "Align to conversation",
			"sourcePage.instance": "Source instance",
			"sourcePage.instanceAria": "Select Source instance",
			"sourcePage.summaryAria": "Source status and permission summary",
			"sourcePage.package": "Package",
			"sourcePage.availability": "Availability",
			"sourcePage.availability.ready": "Ready",
			"sourcePage.availability.degraded": "Degraded",
			"sourcePage.availability.unavailable": "Unavailable",
			"sourcePage.role": "Semantic role",
			"sourcePage.revision": "Current revision",
			"sourcePage.permissions": "Authorized capabilities",
			"sourcePage.diagnostics": "Diagnostics",
			"sourcePage.configuration": "Declarative configuration",
			"sourcePage.configurationDescription": "Fields come from the sanitized Host management descriptor; submission is re-authorized against this instance and revision.",
			"sourcePage.configLoading": "Loading configuration…",
			"sourcePage.configSave": "Save configuration",
			"sourcePage.configSaving": "Saving…",
			"sourcePage.configSaved": "Configuration submitted; refreshing Source status.",
			"sourcePage.secretPlaceholder": "Leave blank to keep the existing secret",
			"sourcePage.unavailable": "Source is unavailable",
			"sourcePage.unavailableDescription": "No callable instance is visible in this scope. Host and Headless memory behavior are unaffected by this page.",
			"telemetry.aria": "Memory statistics",
			"telemetry.title": "Memory statistics",
			"telemetry.memories": "Active memories",
			"telemetry.graph": "Active graph",
			"telemetry.entities": "Active entities",
			"telemetry.spaces": "Memory Spaces",
			"sidebar.activeSpaces": "Active Memory Spaces",
			"config.providerSecretShow": "Show credential",
			"config.providerSecretHide": "Hide credential",
			"config.providerSecretStoredValue": "Saved credential",
			"card.confirmText": "Soft-delete this memory?",
			"card.processing": "Processing…",
			"card.confirmForget": "Confirm forget",
			"card.related": "View related",
			"card.clone": "Create from this",
			"card.forget": "Forget",
			"turnTail.label": "Turn memory",
			"turnTail.recall": "recalled {count}",
			"turnTail.write": "wrote {count}",
			"turnTail.documents": "document search {count}",
			"turnTail.inspect": "inspected {count}",
			"turnTail.failed": "failed {count}",
			"turnTail.toolList": "Memory tools this turn",
			"turnTail.openTool": "Open the Memory page for {tool}",
			"saveAction.button": "Save to memory",
			"saveAction.tooltip": "Save this reply to memory",
			"saveAction.title": "Confirm save to memory",
			"saveAction.hint": "An independent task Agent qualifies, deduplicates, distills, chooses a Memory Space, and writes without reading or filling the main conversation context.",
			"saveAction.fetching": "Extracting message text…",
			"saveAction.missing": "Could not extract this message text from the session log.",
			"saveAction.candidate": "Candidate (editable)",
			"saveAction.truncated": "This reply is long; only the first {limit} characters are loaded here.",
			"saveAction.submit": "Confirm and send to task Agent",
			"saveAction.submitting": "Dispatching…",
			"saveAction.result": "Independent task Agent: {summary}",
			"saveAction.failed": "Dispatch failed: {error}",
			"saveAction.readOnly": "This deployment is read only; memory writes are disabled.",
			"saveAction.close": "Close",
			"readSources.all": "All providers",
			"readSources.mode.search": "Native search",
			"readSources.mode.graph": "True relation graph",
			"readSources.mode.projection": "Content projection",
			"readSources.mode.enumerable": "Enumerable content",
			"readSources.mode.query-only": "Query only",
			"readSources.mode.entities": "Entity index",
			"readSources.mode.unsupported": "Unsupported",
			"readSources.status.ready": "{count} observable",
			"readSources.status.empty": "Connected · no content",
			"readSources.status.query-required": "Read after a query",
			"readSources.status.unsupported": "Unavailable on this surface",
			"readSources.status.unavailable": "Connection unavailable",
			"readSources.edges": "{count} true relations",
			"readSources.model.mnemon-native": "Facts, entities, and typed relations",
			"readSources.model.openviking": "Hierarchy and tiered content",
			"readSources.model.honcho": "Peer conclusions and profiles",
			"readSources.model.mem0": "Extracted semantic memories",
			"readSources.model.hindsight": "Memory units and knowledge graph",
			"readSources.model.holographic": "Trusted facts and entities",
			"readSources.model.retaindb": "Profiles and typed facts",
			"readSources.model.byterover": "Knowledge-tree queries",
			"readSources.model.supermemory": "Memories and ingested documents",
			"status.title": "System Status",
			"status.description": "dsh-mnemon, memory providers, three-tier storage, and the current read/write root. DSH deployment owns connection configuration.",
			"status.nominal": "System nominal",
			"status.reviewFailed": "Background review failed",
			"status.reviewFailedDetail": "This memory checkpoint did not complete. Candidates remain pending for a later eligible review.",
			"status.reviewContextWindow": "Choose a task model in Mnemon settings whose context window covers the parent conversation. Background review inherits the parent conversation.",
			"status.checkRequired": "Check required",
			"status.rechecking": "Checking…",
			"status.recheck": "Check again",
			"status.aria": "Mnemon runtime status",
			"status.engine": "Memory engine",
			"status.engineConnected": "Mnemon connected",
			"status.engineUnavailable": "Mnemon unavailable",
			"status.engineChecking": "Checking the local engine",
			"status.versionWaiting": "Waiting for version",
			"status.pluginChecking": "Checking plugin status",
			"status.pluginReady": "Plugin running normally",
			"status.nativeAria": "mnemon provider status",
			"status.nativeLabel": "Native provider",
			"status.nativeCliMissing": "Mnemon CLI not found",
			"status.providersTitle": "Third-party providers",
			"status.providersDescription": "Live status for enabled providers and their Memory Spaces. Disabled providers are neither probed nor routed.",
			"status.providersAria": "Third-party provider status",
			"status.providersEnabled": "{enabled} / {total} enabled",
			"status.providerState.disabled": "Off",
			"status.providerState.idle": "Service ready · no active Memory Space",
			"status.providerState.healthy": "Connection healthy",
			"status.providerState.unhealthy": "Connection needs attention",
			"status.providerSpaces": "{active} / {total} Memory Spaces running",
			"versions.checkAction": "Check versions",
			"versions.title": "Check and update versions",
			"versions.description": "Review your installation and update when needed. Expand dsh-mnemon to maintain its subpackages.",
			"versions.missing": "Install needed",
			"versions.restart": "Restart needed",
			"versions.local": "Local version",
			"versions.modeNpmCli": "npm",
			"versions.hintNpm": "Managed by npm. Update here or run mnemon update in the Host terminal.",
			"versions.hintNpmMissing": "The npm launcher was found, but npm is unavailable on the Host. Check the Node.js environment.",
			"versions.hintNpmUnmanaged": "The current npm does not own this global CLI installation. Use its original Node.js environment or migrate below.",
			"versions.hintUnreadable": "The CLI was found, but its version could not be read. Check the command in the Host terminal or reinstall it.",
			"versions.hintStarter": "Maintained with the dsh-mnemon Starter. Update the Starter to use its tested package combination.",
			"versions.npmRecommended": "npm installation and maintenance",
			"versions.npmMaintenance": "Maintain the CLI with npm",
			"versions.npmInstall": "Install with npm (recommended)",
			"versions.npmMigrate": "Switch to npm (recommended)",
			"versions.npmRepair": "Check or repair the npm installation",
			"versions.npmRepairDetail": "Check the installation status above. To reinstall, run this command in the terminal on the DSH Host (Node.js 22+).",
			"versions.npmUpdateDetail": "Run this command for future updates, then choose Check again to verify the active version.",
			"versions.npmInstallDetail": "Mnemon Native needs a separate CLI. Run this command in the terminal on the DSH Host (Node.js 22+).",
			"versions.npmMigrateDetail": "To switch to npm, run this on the DSH Host (Node.js 22+).",
			"versions.npmVerify": "Verify the installed version, then choose Check again:",
			"versions.npmNextSteps": "After installation: verify the version and active path",
			"versions.npmPath": "Put the npm global bin directory first on PATH. If MNEMON_CLI_PATH or mnemon.cliPath is set, point it to the new launcher. Restart DSH after changing its environment and verify the executable path above.",
			"versions.installGuide": "Installation guide",
			"versions.copy": "Copy",
			"versions.copied": "Copied",
			"versions.copyCommand": "Copy command: {command}",
			"versions.copyFailed": "Clipboard unavailable. Select the command and copy it manually.",
			"versions.readOnly": "This connection is read-only. You can check versions and copy commands; use a connection with management access to update here.",
			"versions.packages": "Subpackage versions ({count})",
			"versions.packagesOutdated": "{count} updates available",
			"versions.packagesDetail": "Expand for maintenance options",
			"versions.packagesHide": "Collapse package details",
			"versions.packagesHint": "Default packages update with the Starter. Packages installed independently in this Profile can update individually. Restart dsh web afterward.",
			"versions.managedStarter": "Maintained with Starter",
			"versions.managedProfile": "Managed by Profile",
			"versions.starterVersion": "Starter pin",
			"versions.kind.source": "Sources",
			"versions.kind.strategy": "Strategies",
			"versions.kind.provider": "Providers",
			"versions.checking": "Checking remote repositories for new versions…",
			"versions.checkingShort": "Checking…",
			"versions.recheck": "Check again",
			"versions.failed": "Version operation failed",
			"versions.timeout": "The version check timed out. Check the network and try again.",
			"versions.current": "Up to date",
			"versions.available": "Update available",
			"versions.unknown": "Cannot verify",
			"versions.installed": "Installed",
			"versions.latest": "Latest",
			"versions.executable": "Executable",
			"versions.profileLocation": "Profile · {name}",
			"versions.sourceLocation": "Source",
			"versions.linkSourceLocation": "Source · Profile {name}",
			"versions.packageLocation": "Package directory",
			"versions.update": "Update",
			"versions.updating": "Updating…",
			"versions.updated": "{name} updated",
			"versions.alreadyCurrent": "Already on the latest version",
			"versions.restartRequired": "Restart dsh web to load the new dsh-mnemon plugin code.",
			"versions.checkedAt": "Checked at {time}",
			"versions.latestUnavailable": "The remote latest version is unavailable. Check the network and try again.",
			"versions.modeHomebrew": "Homebrew",
			"versions.modeGo": "Go install",
			"versions.modeNpm": "DSH Profile",
			"versions.modeLink": "Local link",
			"versions.modeManual": "Manual",
			"versions.modeMissing": "Missing",
			"versions.hintHomebrew": "Managed by Homebrew; an available release can be safely updated here.",
			"versions.hintBrewMissing": "A Homebrew installation was detected, but the brew command is unavailable.",
			"versions.hintGo": "Managed by go install; an available release can be safely updated here.",
			"versions.hintPnpm": "Managed by the current DSH Profile; restart dsh web after updating.",
			"versions.hintPnpmMissing": "A DSH Profile installation was detected, but the pnpm command is unavailable.",
			"versions.hintLink": "This is a local linked development build. Pull and build in the source directory to preserve local changes.",
			"versions.hintInstall": "Mnemon CLI was not found. Install it and place mnemon on PATH, or set MNEMON_CLI_PATH / mnemon.cliPath.",
			"versions.hintManual": "The installation source cannot be identified safely. Update it using the original installation method.",
			"status.spaces": "Memory Spaces",
			"status.activeRatio": "{active} / {total} active",
			"status.runtime": "Runtime",
			"status.runtimeRatio": "{user} user · {memory} project",
			"status.runtimeBytes": "{bytes} used",
			"status.runtimeWaiting": "Waiting",
			"status.runtimeWaitingDetail": "Awaiting the Host storage inventory",
			"status.directoryUnsynced": "Directory not synchronized",
			"status.activeMemories": "{count} active memories",
			"status.documents": "Project Documents",
			"status.documentsWaiting": "Waiting for workspace",
			"status.documentsSession": "Available after binding a live session",
			"status.documentRatio": "{active} active · {archived} archived",
			"status.documentUsage": "{used} / {limit} active capacity",
			"status.storageDomains": "Storage Domains",
			"status.storageDomainsText": "The current selection is the shared directory boundary for runtime memory, Memory Spaces, and project Documents.",
			"status.storageBrowseOnly": "Browsing does not switch writes",
			"status.storageScopeAria": "Select a storage domain to inspect",
			"status.storageGlobal": "Global",
			"status.storageWorkspace": "Workspace",
			"status.storageWorkspaces": "Centralized workspaces",
			"status.storageCustom": "Custom",
			"status.storageCurrent": "Current read/write",
			"status.storageWaiting": "Reading storage-domain directories…",
			"status.storageCustomUnset": "No custom directory is configured. This view exposes only a custom root already configured and active in DSH.",
			"status.storageWorkspaceUnavailable": "The current session has no available workspace directory.",
			"status.storageActiveRoot": "Current read/write root",
			"status.storageViewedRoot": "Viewed root",
			"status.storageAvailable": "Directory available",
			"status.storageNotCreated": "Directory not created",
			"status.storageRuntime": "Runtime Memory",
			"status.storageBodies": "Memory Spaces",
			"status.storageSpaces": "Memory Spaces",
			"status.storageDocuments": "Project Documents",
			"status.storageState": "Background State",
			"status.storageReady": "Ready",
			"status.storageEmpty": "Empty",
			"status.storageMissing": "Not created",
			"status.storageInvalid": "Repair needed",
			"status.storageItems": "items",
			"status.storageRuntimeDetail": "USER {user} · MEMORY {memory}",
			"status.storageBodiesDetail": "{active} active · {databases} databases",
			"status.storageSpacesDetail": "{active} active · {databases} databases",
			"status.storageDocumentsDetail": "{active} active · {archived} archived",
			"status.storageStateReady": "Review watermarks are persisted",
			"status.storageStateVolatile": "Review state is currently owned by the Host process",
			"status.storageFootnote": "Current read/write root: {root}. Change the scope only in DSH Settings → Memory System; it applies live after Save and never auto-migrates, merges, or deletes old content.",
			"config.aria": "Memory system configuration",
			"config.tab": "Mnemon",
			"config.title": "Memory system settings",
			"config.description": "Configure runtime memory, project Documents, Memory Spaces, and the DSH interface together. Changes apply immediately after Save.",
			"config.unsaved": "Unsaved changes",
			"config.ready": "Saved and applied live",
			"config.noticeBefore": "Configuration is written to",
			"config.noticeAfter": ". All settings apply live after Save. Switching scopes never migrates existing content automatically.",
			"config.displayTitle": "Entry placement",
			"config.displayDescription": "Both entries share the same memory workspace. Save to switch immediately without changing storage scope or existing data.",
			"config.displayAria": "Memory system entry placement",
			"config.displaySidebar": "Sidebar",
			"config.displaySidebarHint": "Standalone sidebar entry with workspace inspection",
			"config.displayBuiltin": "Builtin",
			"config.displayBuiltinHint": "Conversation tab that automatically follows the session memory scope",
			"config.storageTitle": "Memory scope",
			"config.storageDescription": "Choose whether Runtime, Documents, mnemon, and workspace-aware providers follow the current workspace. Other providers keep their own global scope.",
			"config.scope": "Storage scope",
			"config.scopeHint": "Global is shared across workspaces; Workspace is isolated by the current DSH session; Custom uses the directory below.",
			"config.scopeAria": "Memory system scope",
			"config.global": "Global",
			"config.workspace": "Workspace",
			"config.workspaces": "Centralized · isolated by workspace",
			"config.workspacesHint": "One root directory with a separate subdirectory for each workspace",
			"config.workspacesRoot": "Central root directory",
			"config.workspacesRootHint": "Optional. Use an absolute path or ~/; leave empty for MNEMON_DATA_DIR or ~/.mnemon.",
			"config.workspacesDefault": "Default (MNEMON_DATA_DIR or ~/.mnemon)",
			"config.workspacesIdentityHint": "Data lives in workspaces/<workspace-path-hash>/. Moving or renaming a workspace selects a new directory. Switching scopes never migrates, merges, or deletes old data.",
			"config.custom": "Custom",
			"config.customHintShort": "Enter one directory",
			"config.customSelected": "Directory entered",
			"config.globalScopeHint": "Shared across workspaces",
			"config.runtimeUserScopeTitle": "User profile scope",
			"config.runtimeUserScopeDescription": "USER.md can follow the active memory scope or remain global on its own. MEMORY.md, Documents, and Memory Spaces still use the scope above.",
			"config.runtimeUserScopeAria": "USER.md user profile scope",
			"config.runtimeUserScopeStorage": "Follow memory scope",
			"config.runtimeUserScopeStorageHint": "Keep USER.md and MEMORY.md in the same root",
			"config.runtimeUserScopeGlobal": "Global user profile",
			"config.runtimeUserScopeGlobalHint": "Share USER.md across workspaces while project memory stays isolated",
			"config.topologyTitle": "Memory layers",
			"config.topologyDescription": "Each layer is simply on or off. Enabled layers are used only when needed; disabling preserves all existing data for later re-enablement.",
			"config.topologyLoading": "Loading memory layers…",
			"config.topologyUnavailable": "This Host does not expose memory-layer state yet. Existing configuration and compatibility behavior are unchanged.",
			"config.topologyEnabled": "Enabled",
			"config.topologyDisabled": "Disabled",
			"config.topologyLayerToggle": "Enable {layer}",
			"config.enhancementsTitle": "Memory enhancements",
			"config.enhancementsDescription": "Enable optional behavior for the default three-layer memory. Changes apply immediately.",
			"config.enhancementCapture": "Active capture",
			"config.enhancementCaptureHint": "Identify and retain durable facts from the current conversation",
			"config.enhancementLightContext": "Light context",
			"config.enhancementLightContextHint": "Reduce resident content while keeping on-demand reads available",
			"config.enhancementScoped": "Scoped composition",
			"config.enhancementScopedHint": "Compose currently available memory sources in a stable order",
			"config.enhancementsFailed": "Could not update memory enhancements. Try again.",
			"config.enhancementsRefreshFailed": "The setting was updated, but its status could not be refreshed. Reopen Settings.",
			"layers.runtimeLabel": "Runtime Memory",
			"layers.runtimeDescription": "Bounded, deterministic hot memory injected directly into every eligible turn.",
			"layers.documentsLabel": "Project Documents",
			"layers.documentsDescription": "Versioned narrative documents searched first and read in full on demand.",
			"layers.memorySpacesLabel": "Memory Spaces",
			"layers.memorySpacesDescription": "Provider-backed durable evidence recalled on demand across tasks and sessions.",
			"layers.disabledBadge": "Off",
			"layers.disabledTitle": "{layer} is off",
			"layers.disabledDescription": "This memory layer is not participating in memory processing.",
			"layers.disabledText": "Existing data is preserved. Re-enable the layer in Settings to restore reads, writes, and on-demand use.",
			"config.providersTitle": "Memory providers",
			"config.providersDescription": "Enable and configure provider services here. Enabling or saving synchronizes existing provider namespaces; disabling removes local mappings without deleting third-party data. Scope tags show the active boundary.",
			"config.nativeSummary": "Official native long-term memory with a complete relation graph",
			"config.officialNative": "Official native",
			"config.nativeGlobalLocation": "Global data location",
			"config.nativeGlobalLocationHint": "mnemon can use its default global directory or a directory you choose.",
			"config.nativeGlobalLocationWorkspaceHint": "Workspace scope is active; switch to Global to choose the default or a custom directory.",
			"config.nativeDefaultLocation": "Default ~/.mnemon",
			"config.embeddingTitle": "Local vector embeddings",
			"config.embeddingDescription": "Have the DSH Host inject the embedding endpoint and model into every Mnemon CLI call; an endpoint ending in /v1 automatically uses the OpenAI-compatible protocol (/v1/embeddings with Bearer auth), otherwise the Ollama protocol. Compatible endpoints that do not end in /v1 can set the protocol explicitly.",
			"config.embeddingManaged": "Manage embedding settings in DSH",
			"config.embeddingManagedHint": "When enabled, saved values override the Mnemon child-process environment. When off, Mnemon keeps the Host environment and its built-in defaults.",
			"config.embeddingEndpoint": "Embedding endpoint",
			"config.embeddingModel": "Embedding model",
			"config.embeddingApiKey": "API key (optional, OpenAI-compatible servers)",
			"config.embeddingApiKeyInvalid": "The API key must contain no control characters and at most 2048 characters.",
			"config.embeddingProtocol": "Protocol",
			"config.embeddingProtocolAuto": "Auto (detect via /v1)",
			"config.embeddingProtocolOllama": "Ollama",
			"config.embeddingProtocolOpenai": "OpenAI-compatible",
			"config.embeddingProtocolInvalid": "The protocol must be one of Auto / Ollama / OpenAI-compatible.",
			"config.embeddingEndpointInvalid": "The embedding endpoint must be an absolute HTTP(S) URL without credentials, a query, or a fragment.",
			"config.embeddingModelInvalid": "The embedding model must contain 1–200 characters and no control characters.",
			"config.embeddingSecurity": "Mnemon sends memory and query text to this endpoint; the API key is stored in the DSH settings file like other settings. Remote HTTP is unencrypted; use a trusted local address or HTTPS for a remote service.",
			"config.embeddingTest": "Test status",
			"config.embeddingNotTested": "The current Mnemon Store connection and embedding coverage have not been checked.",
			"config.embeddingTesting": "Checking the embedding server and coverage through Mnemon…",
			"config.embeddingSaveBeforeTest": "Save the embedding settings before testing their effective runtime values.",
			"config.embeddingTestUnavailable": "This DSH Host does not provide embedding status checks.",
			"config.embeddingStatusAvailable": "Embedding server available · {model} · {embedded}/{total} embedded ({coverage})",
			"config.embeddingStatusAvailableWithProtocol": "Embedding server available · {model} · protocol {protocol} · {embedded}/{total} embedded ({coverage})",
			"config.embeddingStatusUnavailable": "Embedding server unreachable · {model} · {embedded}/{total} embedded ({coverage})",
			"config.embeddingStatusUnavailableWithProtocol": "Embedding server unreachable · {model} · protocol {protocol} · {embedded}/{total} embedded ({coverage})",
			"config.embeddingStatusFailed": "Embedding status check failed: {error}",
			"config.providerGlobalLocation": "Global data location",
			"config.providerGlobalLocationHint": "{provider} uses the global scope directory by default, or you can choose a custom location.",
			"config.providerGlobalLocationWorkspaceHint": "The workspace default is active. Switch to Global to choose a custom location.",
			"config.providerDefaultLocation": "Default (follows scope)",
			"config.providerDefaultName": "{provider} Memory Space",
			"config.providerDefaultDescription": "{provider} long-term memory used by dsh-mnemon.",
			"config.newProviderConfig": "New Memory Space configuration",
			"config.newProviderConfigHint": "Saving creates and enables it immediately; there is no second connection step in Overview.",
			"config.providerHealthy": "Connection is healthy and ready for memory workflows",
			"config.providerNeedsAttention": "Connection needs attention; update and save it again",
			"config.providerActive": "Use for reads and routing",
			"config.providerMemoryName": "Memory Space name",
			"config.providerMemoryDescription": "Purpose",
			"config.providerSaveFailed": "Could not save configuration: {error}",
			"config.providerSaved": "Configuration saved",
			"config.createAndEnable": "Save and enable",
			"config.saveProviderConfig": "Save configuration",
			"config.addProviderConfig": "Add a Memory Space configuration",
			"config.providerNotConfigured": "Not configured",
			"config.providerConfiguredCount": "{count} configurations",
			"config.providerServiceTitle": "Service configuration",
			"config.providerServiceHint": "Shared by this provider’s Memory Spaces; enabling or saving refreshes their directory mappings and metadata.",
			"config.providerEnableHint": "Complete and save the service configuration to enable the provider and synchronize every visible namespace.",
			"config.providerServiceConfigured": "Service configured",
			"config.providerServiceNotConfigured": "Service not configured",
			"config.providerEnabled": "Enabled",
			"config.providerDisabled": "Not enabled",
			"config.providerDisabledConfigured": "Off · configuration kept",
			"config.providerNeedsConfiguration": "Configuration required",
			"config.providerToggleAria": "Enable {provider}",
			"config.providerToggleFailed": "Could not change provider state: {error}",
			"config.enableProvider": "Save and enable",
			"config.providerServiceSaved": "Service configuration saved and Memory Spaces synchronized",
			"config.saveProviderService": "Save service configuration",
			"config.providerUnavailable": "This DSH host does not support provider service configuration.",
			"config.saveScopeBeforeProviders": "The storage scope has unsaved changes. Save the scope before configuring providers in that directory.",
			"config.providerTargetWorkspace": "Current workspace: {workspace}. Providers tagged Workspace use this scope for configuration and Memory Spaces.",
			"config.loadingProviders": "Loading provider configurations…",
			"config.providerLoadFailed": "Could not load provider configurations: {error}",
			"config.retryProviders": "Retry",
			"config.taskAgentTitle": "Background task Agent",
			"config.taskAgentDescription": "AI metadata, Agent Query, memory distillation, document archiving, and the idle checkpoint review subagent share one model route. This setting changes only their model route and does not affect the main conversation.",
			"config.taskAgentModeAria": "Background task Agent model route",
			"config.taskAgentInherit": "Follow the main route",
			"config.taskAgentInheritHint": "Use the DSH new-session default model",
			"config.taskAgentFixed": "Choose model provider",
			"config.taskAgentFixedHint": "Pin Mnemon background task Agents and subagent delegations to one route",
			"config.taskAgentProvider": "Model provider",
			"config.taskAgentProviderHint": "Choose a model service configured in DSH",
			"config.taskAgentModel": "Model",
			"config.taskAgentModelHint": "Choose a complete model route from that provider",
			"config.taskAgentChooseProvider": "Choose provider",
			"config.taskAgentChooseModel": "Choose model",
			"config.taskAgentImageInput": "Image input",
			"config.taskAgentEffective": "Will currently use",
			"config.taskAgentLoading": "Loading model directory",
			"config.taskAgentUnavailable": "No Provider / Model route is currently available",
			"config.taskAgentLoadFailed": "Could not load the model directory: {error}",
			"config.taskAgentPartial": "{count} providers could not be read; the remaining options are still available.",
			"config.taskAgentRouteRequired": "Choose both a Provider and model for a fixed background-task route.",
			"config.customPack": "Custom Pack",
			"config.customPackAria": "Select a custom Mnemon Pack",
			"config.customPackRequired": "Select or add a custom Pack.",
			"config.customDefaultName": "Custom Pack",
			"config.noCustomPacks": "No Packs configured",
			"config.addPack": "Add Pack",
			"config.cancelAddPack": "Cancel adding",
			"config.removePack": "Remove",
			"config.customPackNameAria": "New Pack name",
			"config.customPackNamePlaceholder": "For example: Project memory",
			"config.newPackDirectoryAria": "New Pack data directory",
			"config.confirmAddPack": "Add to list",
			"config.customDirectory": "Custom directory",
			"config.customHint": "The complete Mnemon data domain lives here.",
			"config.customAria": "Mnemon custom data directory",
			"config.customDirectoryHint": "Enter a directory path on the DSH Host; only this one directory is stored.",
			"config.customPlaceholder": "For example: /data/mnemon or ~/mnemon",
			"config.invalidScope": "The storage scope is invalid.",
			"config.invalidRuntimeUserScope": "The USER.md profile scope is invalid.",
			"config.customRequired": "A data directory is required for custom storage.",
			"config.customAbsolute": "The custom directory must be absolute or start with ~/. Windows drive and UNC paths are supported.",
			"config.saveFailed": "Save failed: {error}",
			"config.readOnly": "Plugin settings are read-only in this deployment.",
			"config.unavailable": "Memory System settings could not be loaded. Check whether the Host grants the settings RPC to this Web deployment.",
			"config.discard": "Discard changes",
			"config.saving": "Saving…",
			"config.save": "Save",
			"config.overridden": "Overridden",
			"config.interactionTitle": "Conversation interface",
			"config.interactionLive": "Live",
			"config.interactionHint": "Changes apply live after saving. Disabling an item restores DSH's native presentation.",
			"config.interactionTurnBar": "Turn memory bar",
			"config.interactionTurnBarHint": "Show recall, write, and search activity below each turn",
			"config.interactionSaveAction": "Save to memory action",
			"config.interactionSaveActionHint": "Add supervised memory distillation beside finalized replies",
			"config.interactionOn": "Enabled",
			"config.packTitle": "Backup and migration",
			"config.packDescription": "Export or import the complete effective directory. Imports always target the location shown below.",
			"config.packActiveTarget": "Active directory",
			"config.packTargetLoading": "Loading the running target…",
			"config.packUnavailable": "This DSH host does not provide the Mnemon ZIP backup channel.",
			"config.packFull": "Complete Pack",
			"config.packFullHint": "Runtime, Documents, and Memory Spaces",
			"config.packRuntime": "Runtime",
			"config.packRuntimeHint": "Hot memory and USER / MEMORY projections",
			"config.packDocuments": "Documents",
			"config.packDocumentsHint": "Project documents, archive, and index",
			"config.packMemorySpaces": "Memory Spaces",
			"config.packMemorySpacesHint": "Catalog and mnemon.db databases",
			"config.packExport": "Export",
			"config.packImport": "Import",
			"config.packExporting": "Exporting…",
			"config.packInspecting": "Inspecting…",
			"config.packImporting": "Importing…",
			"config.packChooseFile": "Choose a {component} file",
			"config.packFormatHint": "Uses .mnemonpack throughout (ZIP + manifest + SHA-256). Each Memory Space remains a separate mnemon.db inside the Pack.",
			"config.packPreviewEyebrow": "Import preview",
			"config.packUnnamed": "Unnamed Mnemon Pack",
			"config.packSource": "Source",
			"config.packDestination": "Import into",
			"config.packArchiveSize": "Archive / expanded",
			"config.packComponents": "Components to import",
			"config.packComponentSummary": "{items} items · {files} files · {size}",
			"config.packHasData": "Target has data",
			"config.packMerge": "Safe merge (recommended)",
			"config.packMergeHint": "Keeps existing data; conflicting items are deduplicated or assigned new IDs.",
			"config.packMergeAction": "Merge import",
			"config.packReplace": "Replace current components?",
			"config.packReplaceHint": "Selected components are atomically replaced by the Pack; other components are unchanged.",
			"config.packReplaceAction": "Replace import…",
			"config.packConfirmReplace": "Confirm replace",
			"config.packComponentMissing": "This Pack does not contain the selected component.",
			"config.packExported": "Exported {file} ({size}).",
			"config.packImported": "Imported {components} into {root}.",
			"config.packFailed": "ZIP operation failed: {error}",
			"config.packSimpleDescription": "Back up or restore the current Mnemon data. External provider data remains managed by its service.",
			"config.packWholeZip": "Current directory ZIP",
			"config.packWholeZipHint": "Includes Runtime, Documents, and mnemon Memory Spaces; excludes external data and credentials.",
			"config.packImportZip": "Import ZIP",
			"config.packExportZip": "Export ZIP",
			"config.packChooseZip": "Choose a Mnemon backup ZIP",
			"config.packUnnamedZip": "Mnemon backup.zip",
			"config.packZipReady": "Verified · {components} components · {items} items · {size}",
			"config.packImportZipAction": "Safe import",
			"config.packImportedWhole": "Safely merged the ZIP into {root}."
		};
		function interpolate(dictionary, key, params) {
			const template = dictionary[key];
			if (params === void 0) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
		}
		function translateZh(key, params) {
			return interpolate(zh, key, params);
		}
		function translateEn(key, params) {
			return interpolate(en, key, params);
		}
		//#endregion
		//#region src/client/MnemonPackSection.tsx
		const ZIP_ACCEPT = ".zip,application/zip";
		function fileBase64(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onerror = () => reject(reader.error ?? /* @__PURE__ */ new Error("Could not read ZIP file"));
				reader.onload = () => {
					const value = reader.result;
					if (typeof value !== "string") return reject(/* @__PURE__ */ new Error("Could not read ZIP file"));
					const separator = value.indexOf(",");
					if (separator < 0) return reject(/* @__PURE__ */ new Error("ZIP file encoding is invalid"));
					resolve(value.slice(separator + 1));
				};
				reader.readAsDataURL(file);
			});
		}
		function bytesFromBase64(base64) {
			const binary = atob(base64);
			const buffer = new ArrayBuffer(binary.length);
			const bytes = new Uint8Array(buffer);
			for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
			return buffer;
		}
		function download(result) {
			const blob = new Blob([bytesFromBase64(result.base64)], { type: result.mimeType });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = result.fileName;
			anchor.hidden = true;
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			window.setTimeout(() => URL.revokeObjectURL(url), 0);
		}
		function formatBytes(bytes) {
			if (bytes < 1024) return `${bytes} B`;
			if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / 1048576).toFixed(1)} MB`;
		}
		function MnemonPackSection({ connection, sessionId, workspaceId, refreshKey, t, embedded = false }) {
			const client = (0, react.useMemo)(() => connection === void 0 ? null : new MnemonClient(connection, sessionId, workspaceId), [
				connection,
				sessionId,
				workspaceId
			]);
			const input = (0, react.useRef)(null);
			const [target, setTarget] = (0, react.useState)(null);
			const [pending, setPending] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(client === null ? null : "target");
			const [failed, setFailed] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let active = true;
				if (client === null) return;
				setBusy("target");
				setFailed(null);
				client.packTarget().then((value) => {
					if (active) setTarget(value);
				}).catch((reason) => {
					if (active) setFailed(reason instanceof Error ? reason.message : String(reason));
				}).finally(() => {
					if (active) setBusy(null);
				});
				return () => {
					active = false;
				};
			}, [client, refreshKey]);
			const scopeLabel = (scope) => scope === "global" ? t("config.global") : scope === "workspace" ? t("config.workspace") : scope === "workspaces" ? t("config.workspaces") : t("config.custom");
			const exportZip = async () => {
				if (client === null || busy !== null) return;
				setBusy("export");
				setFailed(null);
				setNotice(null);
				try {
					const result = await client.exportPack();
					download(result);
					setNotice(t("config.packExported", {
						file: result.fileName,
						size: formatBytes(result.bytes)
					}));
				} catch (reason) {
					setFailed(reason instanceof Error ? reason.message : String(reason));
				} finally {
					setBusy(null);
				}
			};
			const inspectZip = async (file) => {
				if (client === null || busy !== null) return;
				setBusy("inspect");
				setFailed(null);
				setNotice(null);
				setPending(null);
				try {
					const base64 = await fileBase64(file);
					const preview = await client.inspectPack(base64, file.name);
					setPending({
						base64,
						preview
					});
				} catch (reason) {
					setFailed(reason instanceof Error ? reason.message : String(reason));
				} finally {
					setBusy(null);
				}
			};
			const chooseFile = (event) => {
				const file = event.currentTarget.files?.[0];
				event.currentTarget.value = "";
				if (file !== void 0) inspectZip(file);
			};
			const importZip = async () => {
				if (client === null || pending === null || busy !== null) return;
				setBusy("import");
				setFailed(null);
				setNotice(null);
				try {
					const result = await client.importPack(pending.base64);
					setNotice(t("config.packImportedWhole", { root: result.targetRoot }));
					setPending(null);
				} catch (reason) {
					setFailed(reason instanceof Error ? reason.message : String(reason));
				} finally {
					setBusy(null);
				}
			};
			const items = pending?.preview.manifest.summary.reduce((sum, component) => sum + component.items, 0) ?? 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: embedded ? MnemonSettingsCard_module_css_default.embeddedSection : MnemonSettingsCard_module_css_default.section,
				"aria-labelledby": "mnemon-pack-heading",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MnemonSettingsCard_module_css_default.sectionHeading,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: "mnemon-pack-heading",
							children: t("config.packTitle")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("config.packSimpleDescription") })] })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonSettingsCard_module_css_default.settingRow,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MnemonSettingsCard_module_css_default.settingCopy,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("config.packWholeZip") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("config.packWholeZipHint") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										className: MnemonSettingsCard_module_css_default.activePath,
										title: target?.root,
										children: target?.root ?? t("config.packTargetLoading")
									}),
									target !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", {
										className: MnemonSettingsCard_module_css_default.scopeMeta,
										children: scopeLabel(target.scope)
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MnemonSettingsCard_module_css_default.rowActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: MnemonSettingsCard_module_css_default.pillButton,
									disabled: client === null || busy !== null,
									onClick: () => input.current?.click(),
									children: busy === "inspect" ? t("config.packInspecting") : t("config.packImportZip")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: MnemonSettingsCard_module_css_default.pillButton,
									disabled: client === null || busy !== null || target === null,
									onClick: () => void exportZip(),
									children: busy === "export" ? t("config.packExporting") : t("config.packExportZip")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								ref: input,
								className: MnemonSettingsCard_module_css_default.visuallyHidden,
								type: "file",
								accept: ZIP_ACCEPT,
								"aria-label": t("config.packChooseZip"),
								onChange: chooseFile
							})
						]
					}),
					pending !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonSettingsCard_module_css_default.importBar,
						role: "status",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: pending.preview.fileName ?? t("config.packUnnamedZip") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("config.packZipReady", {
								components: pending.preview.manifest.components.length,
								items,
								size: formatBytes(pending.preview.archiveBytes)
							}) })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: MnemonSettingsCard_module_css_default.textButton,
								disabled: busy !== null,
								onClick: () => setPending(null),
								children: t("common.cancel")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: MnemonSettingsCard_module_css_default.primaryPill,
								disabled: busy !== null,
								onClick: () => void importZip(),
								children: busy === "import" ? t("config.packImporting") : t("config.packImportZipAction")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonSettingsCard_module_css_default.packFeedback,
						"aria-live": "polite",
						children: [
							failed !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: MnemonSettingsCard_module_css_default.error,
								role: "alert",
								children: t("config.packFailed", { error: failed })
							}),
							notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: MnemonSettingsCard_module_css_default.packSuccess,
								children: notice
							}),
							client === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: MnemonSettingsCard_module_css_default.readOnly,
								children: t("config.packUnavailable")
							})
						]
					})
				]
			});
		}
		//#endregion
		//#region src/client/MnemonLogo.tsx
		/** Official Mnemon mark from mnemon-dev/mnemon (Apache-2.0). */
		function MnemonLogo({ className, title = "Mnemon" }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				className,
				xmlns: "http://www.w3.org/2000/svg",
				viewBox: "0 0 400 400",
				role: "img",
				"aria-label": title,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						width: "400",
						height: "400",
						fill: "#1A1A1A"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M 91.5,153.5 L 98.5,146.5 L 98.5,98.5 L 146.5,98.5 L 153.5,91.5 L 91.5,91.5 Z",
						fill: "#D4D4D8"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M 246.5,91.5 L 253.5,98.5 L 301.5,98.5 L 301.5,146.5 L 308.5,153.5 L 308.5,91.5 Z",
						fill: "#D4D4D8"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M 91.5,246.5 L 98.5,253.5 L 98.5,301.5 L 146.5,301.5 L 153.5,308.5 L 91.5,308.5 Z",
						fill: "#D4D4D8"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M 308.5,246.5 L 301.5,253.5 L 301.5,301.5 L 253.5,301.5 L 246.5,308.5 L 308.5,308.5 Z",
						fill: "#D4D4D8"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", {
						points: "265,187 278,200 265,213",
						fill: "none",
						stroke: "#D4D4D8",
						strokeWidth: "2",
						strokeLinecap: "square"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polyline", {
						points: "135,187 122,200 135,213",
						fill: "none",
						stroke: "#D4D4D8",
						strokeWidth: "2",
						strokeLinecap: "square"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("polygon", {
						points: "200,155 245,200 200,245 155,200",
						fill: "none",
						stroke: "#D4D4D8",
						strokeWidth: "7"
					})
				]
			});
		}
		//#endregion
		//#region src/client/ProviderIcon.tsx
		function GenericProviderMark() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 36 36",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						width: "36",
						height: "36",
						rx: "9",
						fill: "#F1F3F7"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
						cx: "18",
						cy: "11",
						rx: "8",
						ry: "3.5",
						fill: "#68738A"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M10 11v7c0 1.93 3.58 3.5 8 3.5s8-1.57 8-3.5v-7M10 18v7c0 1.93 3.58 3.5 8 3.5s8-1.57 8-3.5v-7",
						stroke: "#68738A",
						strokeWidth: "1.6"
					})
				]
			});
		}
		/** Only the owning plugin supplies image data; unknown brands get a neutral mark. */
		function ProviderIcon({ providerId, icon, className, title }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className,
				"data-provider-icon": providerId,
				...title === void 0 ? { "aria-hidden": true } : {
					role: "img",
					"aria-label": title
				},
				children: icon?.kind === "brand" && icon.value === "mnemon" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MnemonLogo, {}) : icon?.kind === "glyph" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					"aria-hidden": "true",
					children: icon.value
				}) : icon?.kind === "data-url" && /^data:image\/(?:png|jpeg|webp|svg\+xml);/u.test(icon.value) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src: icon.value,
					alt: ""
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GenericProviderMark, {})
			});
		}
		//#endregion
		//#region src/client/use-request-version.ts
		/**
		* Guards UI state against responses from an older request or an unmounted
		* component. Starting a request invalidates every earlier version.
		*/
		function useRequestVersion() {
			const current = (0, react.useRef)(0);
			(0, react.useEffect)(() => () => {
				current.current += 1;
			}, []);
			return (0, react.useMemo)(() => ({
				begin: () => {
					current.current += 1;
					return current.current;
				},
				isCurrent: (version) => current.current === version
			}), []);
		}
		//#endregion
		//#region src/client/provider-presentation.ts
		function providerSummary(t, provider) {
			if (provider.summaryI18nKey === void 0) return provider.summary;
			const localized = t(provider.summaryI18nKey);
			return typeof localized !== "string" || localized.length === 0 || localized === provider.summaryI18nKey ? provider.summary : localized;
		}
		function providerFieldLabel(t, field) {
			if (field.i18nKey === void 0) return field.label;
			const localized = t(field.i18nKey);
			return typeof localized !== "string" || localized.length === 0 || localized === field.i18nKey ? field.label : localized;
		}
		function providerOptionLabel(t, option) {
			if (option.i18nKey === void 0) return option.label;
			const localized = t(option.i18nKey);
			return typeof localized !== "string" || localized.length === 0 || localized === option.i18nKey ? option.label : localized;
		}
		//#endregion
		//#region src/client/ProviderSettingsSection.tsx
		const SAVED_SECRET_MASK = "••••••••••••";
		const EMPTY_PROVIDER_CATALOG = {
			providers: [],
			items: [],
			generatedAt: ""
		};
		const providerCatalogCache = /* @__PURE__ */ new WeakMap();
		function catalogRouteKey(sessionId, workspaceId) {
			return `${sessionId ?? ""}\u0000${workspaceId ?? ""}`;
		}
		function cachedCatalog(connection, key) {
			return connection === void 0 ? void 0 : providerCatalogCache.get(connection)?.get(key);
		}
		function cacheCatalog(connection, key, catalog) {
			if (connection === void 0) return;
			let routes = providerCatalogCache.get(connection);
			if (routes === void 0) {
				routes = /* @__PURE__ */ new Map();
				providerCatalogCache.set(connection, routes);
			}
			routes.set(key, catalog);
		}
		function message$1(reason) {
			return reason instanceof Error ? reason.message : String(reason);
		}
		function stabilizeProviderCard(element) {
			const view = element.ownerDocument.defaultView;
			let scrollContainer;
			for (let ancestor = element.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
				const overflowY = view?.getComputedStyle(ancestor).overflowY ?? ancestor.style.overflowY;
				if (scrollContainer !== void 0 && overflowY === "hidden" && ancestor.scrollTop !== 0) ancestor.scrollTop = 0;
				if (scrollContainer === void 0 && (overflowY === "auto" || overflowY === "scroll") && ancestor.scrollHeight > ancestor.clientHeight) scrollContainer = ancestor;
				if (ancestor.getAttribute("role") === "dialog") break;
			}
			if (scrollContainer === void 0) return;
			const headerRect = (element.firstElementChild instanceof HTMLElement ? element.firstElementChild : element).getBoundingClientRect();
			const containerRect = scrollContainer.getBoundingClientRect();
			if (headerRect.top < containerRect.top) scrollContainer.scrollTop -= containerRect.top - headerRect.top;
			else if (headerRect.bottom > containerRect.bottom) scrollContainer.scrollTop += headerRect.bottom - containerRect.bottom;
		}
		function serviceFields(provider) {
			return provider.fields.filter((field) => field.scope === "service");
		}
		function globalLocationFields(provider) {
			return serviceFields(provider).filter((field) => field.role === "global-location");
		}
		function serviceDefaults(provider) {
			return Object.fromEntries(serviceFields(provider).flatMap((field) => field.defaultValue === void 0 ? [] : [[field.key, field.defaultValue]]));
		}
		function draftFor(provider, service) {
			return { settings: {
				...serviceDefaults(provider),
				...service.settings,
				...service.secretValues
			} };
		}
		function configurationComplete(provider, draft, service) {
			return serviceFields(provider).every((field) => {
				if (!field.required) return true;
				if (field.input === "secret" && service.configuredSecrets.includes(field.key)) return true;
				const value = draft.settings[field.key];
				return field.input === "boolean" ? typeof value === "boolean" : String(value ?? "").trim() !== "";
			});
		}
		function SecretVisibilityIcon({ visible }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 20 20",
				fill: "none",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M2.3 10s2.8-4.5 7.7-4.5 7.7 4.5 7.7 4.5-2.8 4.5-7.7 4.5S2.3 10 2.3 10Z",
						stroke: "currentColor",
						strokeWidth: "1.4",
						strokeLinecap: "round",
						strokeLinejoin: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: "10",
						cy: "10",
						r: "2.1",
						stroke: "currentColor",
						strokeWidth: "1.4"
					}),
					visible && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "m3.5 3.5 13 13",
						stroke: "currentColor",
						strokeWidth: "1.4",
						strokeLinecap: "round"
					})
				]
			});
		}
		function ServiceField(props) {
			const [secretVisible, setSecretVisible] = (0, react.useState)(false);
			const label = providerFieldLabel(props.t, props.field);
			const savedSecret = props.configuredSecrets.includes(props.field.key);
			const required = props.field.required && !savedSecret;
			const secret = props.field.input === "secret";
			const fieldValue = String(props.value ?? "");
			const showingSavedMask = secret && savedSecret && fieldValue === "";
			const displayValue = showingSavedMask ? secretVisible ? props.t("config.providerSecretStoredValue") : SAVED_SECRET_MASK : fieldValue;
			const input = props.field.input === "boolean" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: MnemonSettingsCard_module_css_default.providerBoolean,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					"aria-label": label,
					type: "checkbox",
					checked: Boolean(props.value),
					disabled: props.disabled,
					onChange: (event) => props.onChange(event.target.checked)
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
			}) : props.field.input === "select" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [label, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
				"aria-label": label,
				value: String(props.value ?? ""),
				required,
				disabled: props.disabled,
				onChange: (event) => props.onChange(event.target.value),
				children: props.field.options?.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
					value: option.value,
					children: providerOptionLabel(props.t, option)
				}, option.value))
			})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [label, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: secret ? MnemonSettingsCard_module_css_default.providerSecretInput : void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					"aria-label": label,
					type: secret ? secretVisible ? "text" : "password" : props.field.input === "number" ? "number" : props.field.input === "url" ? "url" : "text",
					value: displayValue,
					required,
					disabled: props.disabled,
					autoComplete: secret ? "new-password" : void 0,
					placeholder: props.field.placeholder ?? (secret ? props.t("overview.providerApiKeyOptional") : void 0),
					maxLength: props.field.maxLength ?? (secret ? 8e3 : 2e3),
					min: props.field.min,
					max: props.field.max,
					pattern: props.field.pattern,
					step: props.field.input === "number" ? "any" : void 0,
					onFocus: (event) => {
						if (showingSavedMask) event.currentTarget.select();
					},
					onClick: (event) => {
						if (showingSavedMask) event.currentTarget.select();
					},
					onChange: (event) => {
						const value = showingSavedMask ? event.target.value.replace(SAVED_SECRET_MASK, "").replace(props.t("config.providerSecretStoredValue"), "") : event.target.value;
						props.onChange(value);
					}
				}), secret && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: MnemonSettingsCard_module_css_default.providerSecretVisibility,
					"aria-label": props.t(secretVisible ? "config.providerSecretHide" : "config.providerSecretShow"),
					title: props.t(secretVisible ? "config.providerSecretHide" : "config.providerSecretShow"),
					"aria-pressed": secretVisible,
					disabled: props.disabled,
					onClick: () => setSecretVisible((value) => !value),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SecretVisibilityIcon, { visible: secretVisible })
				})]
			})] });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: MnemonSettingsCard_module_css_default.providerFieldControl,
				"data-input": props.field.input,
				children: input
			});
		}
		function ProviderServiceForm(props) {
			const [draft, setDraft] = (0, react.useState)(() => draftFor(props.provider, props.service));
			const [customLocations, setCustomLocations] = (0, react.useState)(() => new Set(globalLocationFields(props.provider).filter((field) => String(props.service.settings[field.key] ?? "").trim() !== "").map((field) => field.key)));
			const [saving, setSaving] = (0, react.useState)(false);
			const [failed, setFailed] = (0, react.useState)(null);
			const [saved, setSaved] = (0, react.useState)(false);
			const formRef = (0, react.useRef)(null);
			const stabilizeAfterLocationLayout = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				setDraft(draftFor(props.provider, props.service));
				setCustomLocations(new Set(globalLocationFields(props.provider).filter((field) => String(props.service.settings[field.key] ?? "").trim() !== "").map((field) => field.key)));
			}, [props.provider, props.service]);
			(0, react.useLayoutEffect)(() => {
				if (!stabilizeAfterLocationLayout.current || formRef.current === null) return;
				stabilizeAfterLocationLayout.current = false;
				stabilizeProviderCard(formRef.current.closest("[data-provider]") ?? formRef.current);
			}, [customLocations]);
			const submit = async (event) => {
				event.preventDefault();
				const locationsComplete = props.activeScope === "workspace" || globalLocationFields(props.provider).every((field) => !customLocations.has(field.key) || String(draft.settings[field.key] ?? "").trim() !== "");
				if (!configurationComplete(props.provider, draft, props.service) || !locationsComplete || saving || props.disabled) return;
				setSaving(true);
				setFailed(null);
				setSaved(false);
				const settings = { ...draft.settings };
				for (const field of globalLocationFields(props.provider)) if (props.activeScope === "workspace" || !customLocations.has(field.key)) settings[field.key] = "";
				try {
					await props.onSave(props.provider, { settings });
					setSaved(true);
				} catch (reason) {
					setFailed(message$1(reason));
				} finally {
					setSaving(false);
				}
			};
			const update = (key, value) => {
				setDraft((current) => ({
					...current,
					settings: {
						...current.settings,
						[key]: value
					}
				}));
				setFailed(null);
				setSaved(false);
			};
			const useCustomLocation = (field, custom) => {
				stabilizeAfterLocationLayout.current = true;
				setCustomLocations((current) => {
					const next = new Set(current);
					if (custom) next.add(field.key);
					else next.delete(field.key);
					return next;
				});
				setFailed(null);
				setSaved(false);
			};
			const stabilizeLocationCard = () => {
				if (formRef.current === null) return;
				stabilizeProviderCard(formRef.current.closest("[data-provider]") ?? formRef.current);
			};
			const locations = globalLocationFields(props.provider);
			const regularFields = serviceFields(props.provider).filter((field) => field.role !== "global-location");
			const locationsComplete = props.activeScope === "workspace" || locations.every((field) => !customLocations.has(field.key) || String(draft.settings[field.key] ?? "").trim() !== "");
			const formComplete = configurationComplete(props.provider, draft, props.service) && locationsComplete;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				ref: formRef,
				className: MnemonSettingsCard_module_css_default.providerServiceForm,
				onSubmit: (event) => void submit(event),
				"data-provider": props.provider.id,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: MnemonSettingsCard_module_css_default.providerServicePrompt,
						children: props.t(props.service.configured ? "config.providerServiceHint" : "config.providerEnableHint")
					}),
					locations.map((field) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GlobalLocationSetting, {
						className: MnemonSettingsCard_module_css_default.providerServiceLocation,
						name: `${props.provider.id}-${field.key}-location`,
						ariaLabel: `${props.provider.label} ${props.t("config.providerGlobalLocation")}`,
						label: props.t("config.providerGlobalLocation"),
						hint: props.t(props.activeScope === "workspace" ? "config.providerGlobalLocationWorkspaceHint" : "config.providerGlobalLocationHint", { provider: props.provider.label }),
						defaultLabel: props.t("config.providerDefaultLocation"),
						customLabel: props.t("config.custom"),
						custom: customLocations.has(field.key),
						workspace: props.activeScope === "workspace",
						disabled: props.disabled || saving,
						onInteract: stabilizeLocationCard,
						onChange: (custom) => useCustomLocation(field, custom),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: MnemonSettingsCard_module_css_default.providerLocationField,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ServiceField, {
								field,
								value: draft.settings[field.key],
								configuredSecrets: props.service.configuredSecrets,
								disabled: props.disabled || saving,
								t: props.t,
								onChange: (value) => update(field.key, value)
							})
						})
					}, field.key)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MnemonSettingsCard_module_css_default.providerSettingsGrid,
						children: regularFields.map((field) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ServiceField, {
							field,
							value: draft.settings[field.key],
							configuredSecrets: props.service.configuredSecrets,
							disabled: props.disabled || saving,
							t: props.t,
							onChange: (value) => update(field.key, value)
						}, field.key))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: `${MnemonSettingsCard_module_css_default.memoryConfigFooter} ${MnemonSettingsCard_module_css_default.providerServiceFooter}`,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MnemonSettingsCard_module_css_default.configFeedback,
							"aria-live": "polite",
							children: [failed !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: MnemonSettingsCard_module_css_default.error,
								children: props.t("config.providerSaveFailed", { error: failed })
							}), saved && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: MnemonSettingsCard_module_css_default.packSuccess,
								children: props.t("config.providerServiceSaved")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "submit",
							className: MnemonSettingsCard_module_css_default.primaryPill,
							disabled: props.disabled || saving || !formComplete,
							children: saving ? props.t("config.saving") : props.t(props.service.configured ? "config.saveProviderService" : "config.enableProvider")
						})]
					})
				]
			});
		}
		function ProviderPanel(props) {
			const [enabled, setEnabled] = (0, react.useState)(props.service.enabled);
			const [expanded, setExpanded] = (0, react.useState)(props.service.enabled && !props.service.configured);
			const [toggling, setToggling] = (0, react.useState)(false);
			const [failed, setFailed] = (0, react.useState)(null);
			const rowRef = (0, react.useRef)(null);
			const stabilizeAfterLayout = (0, react.useRef)(false);
			(0, react.useLayoutEffect)(() => {
				if (!stabilizeAfterLayout.current || rowRef.current === null) return;
				stabilizeAfterLayout.current = false;
				stabilizeProviderCard(rowRef.current);
			}, [enabled, expanded]);
			(0, react.useEffect)(() => {
				if (toggling) return;
				setEnabled(props.service.enabled);
				if (!props.service.enabled) setExpanded(false);
			}, [props.service.enabled, toggling]);
			const toggle = async (next) => {
				setFailed(null);
				stabilizeAfterLayout.current = true;
				if (next && !props.service.configured) {
					setEnabled(true);
					setExpanded(true);
					return;
				}
				if (!next && !props.service.enabled) {
					setEnabled(false);
					setExpanded(false);
					return;
				}
				const restoreEnabled = enabled;
				const restoreExpanded = expanded;
				setEnabled(next);
				if (!next && expanded) setExpanded(false);
				setToggling(true);
				try {
					const updated = await props.onToggle(props.provider, next);
					setEnabled(updated.enabled);
					if (!next) setExpanded(false);
				} catch (reason) {
					setEnabled(restoreEnabled);
					if (restoreExpanded) setExpanded(true);
					setFailed(message$1(reason));
				} finally {
					setToggling(false);
				}
			};
			const stateKey = enabled ? props.service.configured ? "config.providerEnabled" : "config.providerNeedsConfiguration" : props.service.configured ? "config.providerDisabledConfigured" : "config.providerDisabled";
			const providerScope = props.provider.workspaceBinding === "provider-global" ? "global" : props.activeScope;
			const controlDisabled = props.disabled || toggling;
			const toggleExpanded = () => {
				stabilizeAfterLayout.current = true;
				setExpanded((value) => !value);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: rowRef,
				className: MnemonSettingsCard_module_css_default.providerRow,
				"data-provider": props.provider.id,
				"data-enabled": enabled || void 0,
				"data-expanded": expanded || void 0,
				role: "group",
				"aria-label": `${props.provider.label} ${props.t("config.providerServiceTitle")}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonSettingsCard_module_css_default.providerRowHeader,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: MnemonSettingsCard_module_css_default.providerDisclosure,
							"aria-expanded": expanded,
							disabled: !enabled || controlDisabled,
							onClick: toggleExpanded,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: MnemonSettingsCard_module_css_default.providerIdentity,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderIcon, {
									providerId: props.provider.id,
									icon: props.provider.icon,
									className: MnemonSettingsCard_module_css_default.providerMark
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: props.provider.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: providerSummary(props.t, props.provider) })] })]
							}), enabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
								className: MnemonSettingsCard_module_css_default.providerChevron,
								"aria-hidden": "true",
								children: "›"
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MnemonSettingsCard_module_css_default.providerEnableControl,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: MnemonSettingsCard_module_css_default.providerScopeTag,
									"data-scope": providerScope,
									children: props.t(`config.${providerScope}`)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: MnemonSettingsCard_module_css_default.providerState,
									"data-enabled": enabled || void 0,
									children: props.t(stateKey)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: MnemonSettingsCard_module_css_default.providerToggle,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										"aria-label": props.t("config.providerToggleAria", { provider: props.provider.label }),
										checked: enabled,
										disabled: controlDisabled,
										onChange: (event) => void toggle(event.target.checked)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": "true",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {})
									})]
								})
							]
						})]
					}),
					failed !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: MnemonSettingsCard_module_css_default.providerToggleError,
						role: "alert",
						children: props.t("config.providerToggleFailed", { error: failed })
					}),
					enabled && expanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MnemonSettingsCard_module_css_default.providerInlineBody,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderServiceForm, {
							provider: props.provider,
							service: props.service,
							activeScope: props.activeScope,
							disabled: controlDisabled,
							t: props.t,
							onSave: props.onSave
						})
					})
				]
			});
		}
		function ProviderSettingsSection(props) {
			const client = (0, react.useMemo)(() => props.connection === void 0 ? null : new MnemonClient(props.connection, props.sessionId, props.workspaceId), [
				props.connection,
				props.sessionId,
				props.workspaceId
			]);
			const routeKey = catalogRouteKey(props.sessionId, props.workspaceId);
			const initialCatalog = cachedCatalog(props.connection, routeKey);
			const [catalog, setCatalog] = (0, react.useState)(() => initialCatalog ?? EMPTY_PROVIDER_CATALOG);
			const [loading, setLoading] = (0, react.useState)(client !== null && initialCatalog === void 0);
			const [failed, setFailed] = (0, react.useState)(null);
			const loadRequests = useRequestVersion();
			const load = (0, react.useCallback)(async (quiet = false) => {
				if (client === null) return;
				const request = loadRequests.begin();
				if (!quiet) setLoading(true);
				setFailed(null);
				try {
					const next = await client.providerServices();
					if (!loadRequests.isCurrent(request)) return;
					cacheCatalog(props.connection, routeKey, next);
					setCatalog(next);
				} catch (reason) {
					if (!loadRequests.isCurrent(request)) return;
					setFailed(message$1(reason));
				} finally {
					if (!quiet && loadRequests.isCurrent(request)) setLoading(false);
				}
			}, [
				client,
				loadRequests,
				props.connection,
				routeKey
			]);
			(0, react.useEffect)(() => {
				const cached = cachedCatalog(props.connection, routeKey);
				setCatalog(cached ?? EMPTY_PROVIDER_CATALOG);
				setLoading(client !== null && cached === void 0);
				load(cached !== void 0);
			}, [
				client,
				load,
				props.connection,
				props.refreshKey,
				routeKey
			]);
			const acceptService = (0, react.useCallback)((service) => {
				setCatalog((current) => {
					const items = current.items.some((item) => item.providerId === service.providerId) ? current.items.map((item) => item.providerId === service.providerId ? service : item) : [...current.items, service];
					const next = {
						...current,
						items,
						generatedAt: (/* @__PURE__ */ new Date()).toISOString()
					};
					cacheCatalog(props.connection, routeKey, next);
					return next;
				});
			}, [props.connection, routeKey]);
			const save = async (provider, draft) => {
				if (client === null) throw new Error(props.t("config.providerUnavailable"));
				const settings = Object.fromEntries(Object.entries(draft.settings).filter(([key, value]) => serviceFields(provider).find((field) => field.key === key)?.input !== "secret" || String(value).trim() !== ""));
				acceptService(await client.updateProviderService({
					providerId: provider.id,
					settings,
					enabled: true
				}));
			};
			const toggle = async (provider, enabled) => {
				if (client === null) throw new Error(props.t("config.providerUnavailable"));
				const updated = await client.updateProviderService({
					providerId: provider.id,
					settings: {},
					enabled
				});
				acceptService(updated);
				return updated;
			};
			const disabled = props.disabled || props.scopeChanging || client === null || loading || catalog.generatedAt === "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				props.scopeChanging && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: MnemonSettingsCard_module_css_default.scopeChanging,
					role: "status",
					children: props.t("config.saveScopeBeforeProviders")
				}),
				props.workspaceLabel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: MnemonSettingsCard_module_css_default.providerTarget,
					children: props.t("config.providerTargetWorkspace", { workspace: props.workspaceLabel })
				}),
				loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: MnemonSettingsCard_module_css_default.visuallyHidden,
					role: "status",
					children: props.t("config.loadingProviders")
				}),
				failed !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MnemonSettingsCard_module_css_default.providerLoadError,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: MnemonSettingsCard_module_css_default.error,
						children: props.t("config.providerLoadFailed", { error: failed })
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: MnemonSettingsCard_module_css_default.textButton,
						onClick: () => void load(),
						children: props.t("config.retryProviders")
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: MnemonSettingsCard_module_css_default.providerList,
					"aria-busy": loading,
					children: catalog.providers.map((provider) => {
						const service = catalog.items.find((item) => item.providerId === provider.id) ?? {
							providerId: provider.id,
							enabled: false,
							configured: false,
							settings: {},
							configuredSecrets: []
						};
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderPanel, {
							provider,
							service,
							disabled,
							activeScope: props.activeScope,
							t: props.t,
							onSave: save,
							onToggle: toggle
						}, provider.id);
					})
				})
			] });
		}
		//#endregion
		//#region src/client/MnemonSettingsCard.tsx
		const CORE_FIELDS = [
			"displayMode",
			"storageScope",
			"runtimeUserScope",
			"dataDir"
		];
		const EMBEDDING_FIELDS = [
			"embeddingEnabled",
			"embeddingEndpoint",
			"embeddingModel",
			"embeddingApiKey",
			"embeddingProtocol"
		];
		const INTERACTION_FIELDS = ["turnBar", "saveAction"];
		const TASK_AGENT_FIELDS = [
			"taskAgentModelMode",
			"taskAgentProvider",
			"taskAgentModel"
		];
		const MEMORY_ENHANCEMENTS = [
			{
				packageName: "dsh-mnemon-strategy-auto-capture",
				label: "config.enhancementCapture",
				hint: "config.enhancementCaptureHint"
			},
			{
				packageName: "dsh-mnemon-strategy-light-context",
				label: "config.enhancementLightContext",
				hint: "config.enhancementLightContextHint"
			},
			{
				packageName: "dsh-mnemon-strategy-scoped",
				label: "config.enhancementScoped",
				hint: "config.enhancementScopedHint"
			}
		];
		function record(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
		}
		function legacyPackDirectory(value) {
			const packs = value.customPacks ?? [];
			return packs.find((pack) => pack.id === value.customPackId)?.dataDir?.trim() ?? (packs.length === 1 ? packs[0]?.dataDir?.trim() : void 0) ?? "";
		}
		function coreDraft(value) {
			const resolved = value ?? {};
			const dataDir = resolved.dataDir?.trim() || legacyPackDirectory(resolved);
			return {
				displayMode: normalizeDisplayMode(resolved.displayMode),
				storageScope: resolved.storageScope ?? (dataDir === "" ? "global" : "custom"),
				runtimeUserScope: resolved.runtimeUserScope === "global" ? "global" : "storage",
				dataDir,
				embeddingEnabled: resolved.embedding?.enabled === true,
				embeddingEndpoint: resolved.embedding?.endpoint?.trim() || "http://localhost:11434",
				embeddingModel: resolved.embedding?.model?.trim() || "nomic-embed-text",
				embeddingApiKey: resolved.embedding?.apiKey?.trim() ?? "",
				embeddingProtocol: resolved.embedding?.protocol ?? "auto",
				taskAgentModelMode: resolved.taskAgentModel?.mode === "fixed" ? "fixed" : "inherit",
				taskAgentProvider: resolved.taskAgentModel?.provider?.trim() ?? "",
				taskAgentModel: resolved.taskAgentModel?.model?.trim() ?? ""
			};
		}
		function validEmbeddingEndpoint(value) {
			const endpoint = value.trim();
			if (endpoint === "" || endpoint.length > 2048) return false;
			try {
				const parsed = new URL(endpoint);
				return ["http:", "https:"].includes(parsed.protocol) && parsed.username === "" && parsed.password === "" && !endpoint.includes("?") && !endpoint.includes("#");
			} catch {
				return false;
			}
		}
		function validEmbeddingModel(value) {
			const model = value.trim();
			return model.length > 0 && model.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(model);
		}
		function validEmbeddingApiKey(value) {
			const key = value.trim();
			return key.length <= 2048 && !/[\u0000-\u001f\u007f]/u.test(key);
		}
		function interactionDraft(value) {
			return {
				turnBar: value?.turnBar !== false,
				saveAction: value?.saveAction !== false
			};
		}
		function draftOf(core, interaction) {
			return {
				...coreDraft(core),
				...interactionDraft(interaction)
			};
		}
		function topologyOf(descriptor) {
			return {
				id: descriptor.configuration.id,
				strategyId: descriptor.configuration.strategyId,
				layers: Object.entries(descriptor.configuration.layers).map(([id, layer]) => ({
					id,
					enabled: layer.enabled,
					participation: { ...layer.participation },
					adapterIds: [...layer.adapterIds]
				}))
			};
		}
		function validation(t, draft) {
			if (![
				"global",
				"workspace",
				"custom",
				"workspaces"
			].includes(draft.storageScope)) return t("config.invalidScope");
			if (!["storage", "global"].includes(draft.runtimeUserScope)) return t("config.invalidRuntimeUserScope");
			if (draft.storageScope === "custom" || draft.storageScope === "workspaces" && draft.dataDir.trim() !== "") {
				const directory = draft.dataDir.trim();
				if (directory === "") return t("config.customRequired");
				const posixAbsolute = directory.startsWith("/");
				const homeRelative = directory === "~" || directory.startsWith("~/");
				const windowsDriveAbsolute = /^[a-zA-Z]:[\\/]/.test(directory);
				const windowsUncAbsolute = /^\\\\[^\\/]+[\\/][^\\/]+/.test(directory);
				if (directory.includes("\0") || !posixAbsolute && !homeRelative && !windowsDriveAbsolute && !windowsUncAbsolute) return t("config.customAbsolute");
			}
			if (draft.embeddingEnabled && !validEmbeddingEndpoint(draft.embeddingEndpoint)) return t("config.embeddingEndpointInvalid");
			if (draft.embeddingEnabled && !validEmbeddingModel(draft.embeddingModel)) return t("config.embeddingModelInvalid");
			if (draft.embeddingEnabled && !validEmbeddingApiKey(draft.embeddingApiKey)) return t("config.embeddingApiKeyInvalid");
			if (draft.embeddingEnabled && !MNEMON_EMBEDDING_PROTOCOLS.includes(draft.embeddingProtocol)) return t("config.embeddingProtocolInvalid");
			if (draft.taskAgentModelMode === "fixed" && (draft.taskAgentProvider.trim() === "" || draft.taskAgentModel.trim() === "")) return t("config.taskAgentRouteRequired");
			return null;
		}
		function useScope(scope) {
			const subscribe = (0, react.useMemo)(() => scope.subscribe.bind(scope), [scope]);
			const getSnapshot = (0, react.useMemo)(() => scope.getSnapshot.bind(scope), [scope]);
			return (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
		}
		function operations(fields, dirty, draft) {
			return fields.flatMap((field) => {
				if (!dirty.has(field)) return [];
				if (field === "dataDir" && draft.dataDir.trim() === "" && draft.storageScope !== "workspaces") return [{
					op: "unset",
					path: [field]
				}];
				const value = draft[field];
				return [{
					op: "set",
					path: [field],
					value: typeof value === "string" ? value.trim() : value
				}];
			});
		}
		async function commit(scope, edits) {
			if (scope.mutate !== void 0) return scope.mutate(edits);
			for (const edit of edits) if (edit.path.length === 1) {
				if (edit.op === "set") await scope.set(edit.path[0], edit.value);
				else await scope.unset(edit.path[0]);
			} else if (edit.op === "set") await scope.setPath(edit.path, edit.value);
			else await scope.unsetPath(edit.path);
		}
		/** Dedicated Mnemon page contributed directly to DSH's settings navigation. */
		function MnemonSettingsCard({ scope, interactionScope: suppliedInteractionScope, connection, sessionId, workspaceId, workspaceLabel, t = translateZh }) {
			const interactionScope = suppliedInteractionScope ?? scope;
			const coreSnapshot = useScope(scope);
			const interactionSnapshot = useScope(interactionScope);
			const [draft, setDraft] = (0, react.useState)(() => draftOf(coreSnapshot.value, interactionSnapshot.value));
			const [dirty, setDirty] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [saving, setSaving] = (0, react.useState)(false);
			const [failed, setFailed] = (0, react.useState)(null);
			const [applied, setApplied] = (0, react.useState)(false);
			const [targetRevision, setTargetRevision] = (0, react.useState)(0);
			const [modelCatalog, setModelCatalog] = (0, react.useState)(null);
			const [modelCatalogState, setModelCatalogState] = (0, react.useState)(connection === void 0 ? "unavailable" : "loading");
			const [modelCatalogError, setModelCatalogError] = (0, react.useState)(null);
			const [fullModelCatalogLoaded, setFullModelCatalogLoaded] = (0, react.useState)(false);
			const modelCatalogRequest = (0, react.useRef)(0);
			const [memorySystem, setMemorySystem] = (0, react.useState)(null);
			const [topologyDraft, setTopologyDraft] = (0, react.useState)(null);
			const [topologyState, setTopologyState] = (0, react.useState)(connection === void 0 ? "unavailable" : "loading");
			const topologyRequest = (0, react.useRef)(0);
			const [embeddingStatus, setEmbeddingStatus] = (0, react.useState)(null);
			const [embeddingStatusState, setEmbeddingStatusState] = (0, react.useState)(connection === void 0 ? "unavailable" : "idle");
			const [embeddingStatusError, setEmbeddingStatusError] = (0, react.useState)(null);
			const embeddingStatusRequest = (0, react.useRef)(0);
			const configuredTaskAgentMode = coreSnapshot.value?.taskAgentModel?.mode === "fixed" ? "fixed" : "inherit";
			(0, react.useEffect)(() => {
				if (dirty.size === 0) setDraft(draftOf(coreSnapshot.value, interactionSnapshot.value));
			}, [
				dirty.size,
				coreSnapshot.value,
				interactionSnapshot.value
			]);
			const loadModelCatalog = (0, react.useCallback)((includeCatalog) => {
				if (connection === void 0) {
					modelCatalogRequest.current += 1;
					setModelCatalog(null);
					setModelCatalogState("unavailable");
					setModelCatalogError(null);
					setFullModelCatalogLoaded(false);
					return;
				}
				const request = modelCatalogRequest.current + 1;
				modelCatalogRequest.current = request;
				setModelCatalogState("loading");
				setModelCatalogError(null);
				new MnemonClient(connection).taskAgentModels(includeCatalog).then((catalog) => {
					if (modelCatalogRequest.current !== request) return;
					setModelCatalog(catalog);
					setModelCatalogState("ready");
					setFullModelCatalogLoaded(includeCatalog);
					if (includeCatalog) setDraft((current) => {
						if (current.taskAgentModelMode !== "fixed") return current;
						const provider = current.taskAgentProvider || catalog.defaultSelection?.provider || catalog.groups[0]?.id || "";
						const group = catalog.groups.find((candidate) => candidate.id === provider);
						const model = current.taskAgentModel || (catalog.defaultSelection?.provider === provider ? catalog.defaultSelection.model : void 0) || group?.models[0]?.id || "";
						return provider === current.taskAgentProvider && model === current.taskAgentModel ? current : {
							...current,
							taskAgentProvider: provider,
							taskAgentModel: model
						};
					});
				}, (reason) => {
					if (modelCatalogRequest.current !== request) return;
					setModelCatalogState("error");
					setModelCatalogError(reason instanceof Error ? reason.message : String(reason));
				});
			}, [connection]);
			(0, react.useEffect)(() => {
				loadModelCatalog(configuredTaskAgentMode === "fixed");
				return () => {
					modelCatalogRequest.current += 1;
				};
			}, [configuredTaskAgentMode, loadModelCatalog]);
			(0, react.useEffect)(() => {
				if (connection === void 0) {
					topologyRequest.current += 1;
					setMemorySystem(null);
					setTopologyDraft(null);
					setTopologyState("unavailable");
					return;
				}
				const request = topologyRequest.current + 1;
				topologyRequest.current = request;
				setTopologyState("loading");
				new MnemonClient(connection, sessionId, workspaceId).memorySystem().then((descriptor) => {
					if (topologyRequest.current !== request) return;
					setMemorySystem(descriptor);
					setTopologyDraft(topologyOf(descriptor));
					setTopologyState("ready");
				}, () => {
					if (topologyRequest.current !== request) return;
					setMemorySystem(null);
					setTopologyDraft(null);
					setTopologyState("error");
				});
				return () => {
					topologyRequest.current += 1;
				};
			}, [
				connection,
				sessionId,
				workspaceId,
				targetRevision
			]);
			(0, react.useEffect)(() => {
				embeddingStatusRequest.current += 1;
				setEmbeddingStatus(null);
				setEmbeddingStatusError(null);
				setEmbeddingStatusState(connection === void 0 ? "unavailable" : "idle");
				return () => {
					embeddingStatusRequest.current += 1;
				};
			}, [
				connection,
				sessionId,
				workspaceId,
				targetRevision
			]);
			const testEmbedding = () => {
				if (connection === void 0) return;
				const request = embeddingStatusRequest.current + 1;
				embeddingStatusRequest.current = request;
				setEmbeddingStatus(null);
				setEmbeddingStatusError(null);
				setEmbeddingStatusState("loading");
				new MnemonClient(connection, sessionId, workspaceId).embeddingStatus().then((status) => {
					if (embeddingStatusRequest.current !== request) return;
					setEmbeddingStatus(status);
					setEmbeddingStatusState("ready");
				}, (reason) => {
					if (embeddingStatusRequest.current !== request) return;
					setEmbeddingStatusError(reason instanceof Error ? reason.message : String(reason));
					setEmbeddingStatusState("error");
				});
			};
			const coreUser = (0, react.useMemo)(() => record(coreSnapshot.user), [coreSnapshot.user]);
			const activeScope = isWorkspaceStorageScope(coreDraft(coreSnapshot.value).storageScope) ? "workspace" : "global";
			const error = validation(t, draft);
			const loading = coreSnapshot.status === "loading" || interactionSnapshot.status === "loading";
			const writable = coreSnapshot.writable && interactionSnapshot.writable;
			if (coreSnapshot.status === "unavailable" && interactionSnapshot.status === "unavailable") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: MnemonSettingsCard_module_css_default.page,
				"aria-label": t("config.aria"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: MnemonSettingsCard_module_css_default.error,
					role: "alert",
					children: t("config.unavailable")
				})
			});
			const edit = (field, value) => {
				setDraft((current) => ({
					...current,
					[field]: value
				}));
				setDirty((current) => new Set(current).add(field));
				setFailed(null);
				setApplied(false);
			};
			const editMany = (values) => {
				setDraft((current) => ({
					...current,
					...values
				}));
				setDirty((current) => /* @__PURE__ */ new Set([...current, ...Object.keys(values)]));
				setFailed(null);
				setApplied(false);
			};
			const discard = () => {
				setDraft(draftOf(coreSnapshot.value, interactionSnapshot.value));
				setTopologyDraft(memorySystem === null ? null : topologyOf(memorySystem));
				setDirty(/* @__PURE__ */ new Set());
				setFailed(null);
				setApplied(false);
			};
			const save = async () => {
				if (error !== null || dirty.size === 0 || saving || !writable) return;
				setSaving(true);
				setFailed(null);
				try {
					const coreOps = operations(CORE_FIELDS, dirty, draft);
					const regularCoreChanged = coreOps.length > 0;
					const embeddingChanged = EMBEDDING_FIELDS.some((field) => dirty.has(field));
					const taskAgentChanged = TASK_AGENT_FIELDS.some((field) => dirty.has(field));
					const topologyChanged = [...dirty].some((field) => field.startsWith("memoryTopology."));
					if (regularCoreChanged) {
						if (Object.hasOwn(coreUser, "customPackId")) coreOps.push({
							op: "unset",
							path: ["customPackId"]
						});
						if (Object.hasOwn(coreUser, "customPacks")) coreOps.push({
							op: "unset",
							path: ["customPacks"]
						});
					}
					if (taskAgentChanged) coreOps.push({
						op: "set",
						path: ["taskAgentModel"],
						value: draft.taskAgentModelMode === "inherit" ? { mode: "inherit" } : {
							mode: "fixed",
							provider: draft.taskAgentProvider.trim(),
							model: draft.taskAgentModel.trim()
						}
					});
					if (embeddingChanged) {
						const validEndpoint = validEmbeddingEndpoint(draft.embeddingEndpoint);
						const validModel = validEmbeddingModel(draft.embeddingModel);
						const validApiKey = validEmbeddingApiKey(draft.embeddingApiKey);
						const validProtocol = MNEMON_EMBEDDING_PROTOCOLS.includes(draft.embeddingProtocol);
						coreOps.push({
							op: "set",
							path: ["embedding"],
							value: draft.embeddingEnabled ? {
								enabled: true,
								endpoint: draft.embeddingEndpoint.trim().replace(/\/+$/u, ""),
								model: draft.embeddingModel.trim(),
								protocol: draft.embeddingProtocol,
								apiKey: draft.embeddingApiKey.trim()
							} : {
								enabled: false,
								...validEndpoint ? { endpoint: draft.embeddingEndpoint.trim().replace(/\/+$/u, "") } : {},
								...validModel ? { model: draft.embeddingModel.trim() } : {},
								...validProtocol ? { protocol: draft.embeddingProtocol } : {},
								...validApiKey ? { apiKey: draft.embeddingApiKey.trim() } : {}
							}
						});
					}
					if (topologyChanged && topologyDraft !== null) for (const layer of topologyDraft.layers) {
						if (!dirty.has(`memoryTopology.${layer.id}.enabled`)) continue;
						coreOps.push({
							op: "set",
							path: [
								"memoryTopology",
								"layers",
								layer.id,
								"enabled"
							],
							value: layer.enabled
						});
					}
					const interactionOps = operations(INTERACTION_FIELDS, dirty, draft);
					await Promise.all([...coreOps.length === 0 ? [] : [commit(scope, coreOps)], ...interactionOps.length === 0 ? [] : [commit(interactionScope, interactionOps)]]);
					setDirty(/* @__PURE__ */ new Set());
					setApplied(true);
					if (regularCoreChanged || embeddingChanged || topologyChanged) setTargetRevision((revision) => revision + 1);
				} catch (reason) {
					setFailed(reason instanceof Error ? reason.message : String(reason));
				} finally {
					setSaving(false);
				}
			};
			const coreDisabled = loading || saving || !coreSnapshot.writable;
			const interactionDisabled = loading || saving || !interactionSnapshot.writable;
			const scopeChanging = dirty.has("storageScope") || dirty.has("runtimeUserScope") || dirty.has("dataDir");
			const embeddingChanging = EMBEDDING_FIELDS.some((field) => dirty.has(field));
			const editLayerEnabled = (layerId, enabled) => {
				setTopologyDraft((current) => current === null ? current : {
					...current,
					layers: current.layers.map((layer) => layer.id === layerId ? {
						...layer,
						enabled
					} : layer)
				});
				setDirty((current) => new Set(current).add(`memoryTopology.${layerId}.enabled`));
				setFailed(null);
				setApplied(false);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				className: MnemonSettingsCard_module_css_default.page,
				"aria-label": t("config.aria"),
				"aria-busy": saving || loading,
				children: loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: MnemonSettingsCard_module_css_default.loading,
					role: "status",
					children: t("common.loading")
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: MnemonSettingsCard_module_css_default.pageHeader,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children: t("config.title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("config.description") })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: MnemonSettingsCard_module_css_default.section,
						"aria-labelledby": "mnemon-display-heading",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: MnemonSettingsCard_module_css_default.sectionHeading,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								id: "mnemon-display-heading",
								children: t("config.displayTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("config.displayDescription") })] })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MnemonSettingsCard_module_css_default.choiceGrid,
							role: "radiogroup",
							"aria-label": t("config.displayAria"),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChoiceCard, {
								id: "mnemon-display-sidebar",
								name: "mnemon-display",
								label: t("config.displaySidebar"),
								detail: t("config.displaySidebarHint"),
								checked: draft.displayMode === "sidebar",
								disabled: coreDisabled,
								onChange: () => edit("displayMode", "sidebar")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChoiceCard, {
								id: "mnemon-display-builtin",
								name: "mnemon-display",
								label: t("config.displayBuiltin"),
								detail: t("config.displayBuiltinHint"),
								checked: draft.displayMode === "builtin",
								disabled: coreDisabled,
								onChange: () => edit("displayMode", "builtin")
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: MnemonSettingsCard_module_css_default.section,
						"aria-labelledby": "mnemon-storage-heading",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: MnemonSettingsCard_module_css_default.sectionHeading,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									id: "mnemon-storage-heading",
									children: t("config.storageTitle")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("config.storageDescription") })] })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: `${MnemonSettingsCard_module_css_default.choiceGrid} ${MnemonSettingsCard_module_css_default.storageChoiceGrid}`,
								role: "radiogroup",
								"aria-label": t("config.scopeAria"),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChoiceCard, {
										id: "mnemon-storage-global",
										name: "mnemon-storage",
										label: t("config.global"),
										detail: t("config.globalScopeHint"),
										checked: !isWorkspaceStorageScope(draft.storageScope),
										disabled: coreDisabled,
										onChange: () => edit("storageScope", draft.dataDir.trim() === "" ? "global" : "custom")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChoiceCard, {
										id: "mnemon-storage-workspace",
										name: "mnemon-storage",
										label: t("config.workspace"),
										detail: "<workspace>/.mnemon",
										checked: draft.storageScope === "workspace",
										disabled: coreDisabled,
										onChange: () => edit("storageScope", "workspace")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChoiceCard, {
										id: "mnemon-storage-workspaces",
										name: "mnemon-storage",
										label: t("config.workspaces"),
										detail: t("config.workspacesHint"),
										checked: draft.storageScope === "workspaces",
										disabled: coreDisabled,
										onChange: () => edit("storageScope", "workspaces")
									})
								]
							}),
							draft.storageScope === "workspaces" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MnemonSettingsCard_module_css_default.workspaceStorageLocation,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: MnemonSettingsCard_module_css_default.settingRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: MnemonSettingsCard_module_css_default.settingCopy,
										htmlFor: "mnemon-workspaces-directory",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("config.workspacesRoot") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("config.workspacesRootHint") })]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: MnemonSettingsCard_module_css_default.directoryControl,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											id: "mnemon-workspaces-directory",
											className: MnemonSettingsCard_module_css_default.directoryInput,
											type: "text",
											value: draft.dataDir,
											"aria-label": t("config.workspacesRoot"),
											"aria-invalid": error !== null,
											placeholder: t("config.workspacesDefault"),
											disabled: coreDisabled,
											autoComplete: "off",
											spellCheck: false,
											autoCapitalize: "none",
											autoCorrect: "off",
											onChange: (event) => edit("dataDir", event.target.value)
										})
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: MnemonSettingsCard_module_css_default.description,
									children: t("config.workspacesIdentityHint")
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: MnemonSettingsCard_module_css_default.section,
						"aria-labelledby": "mnemon-runtime-user-scope-heading",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: MnemonSettingsCard_module_css_default.sectionHeading,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								id: "mnemon-runtime-user-scope-heading",
								children: t("config.runtimeUserScopeTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("config.runtimeUserScopeDescription") })] })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MnemonSettingsCard_module_css_default.choiceGrid,
							role: "radiogroup",
							"aria-label": t("config.runtimeUserScopeAria"),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChoiceCard, {
								id: "mnemon-runtime-user-storage",
								name: "mnemon-runtime-user-scope",
								label: t("config.runtimeUserScopeStorage"),
								detail: t("config.runtimeUserScopeStorageHint"),
								checked: draft.runtimeUserScope === "storage",
								disabled: coreDisabled,
								onChange: () => edit("runtimeUserScope", "storage")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChoiceCard, {
								id: "mnemon-runtime-user-global",
								name: "mnemon-runtime-user-scope",
								label: t("config.runtimeUserScopeGlobal"),
								detail: t("config.runtimeUserScopeGlobalHint"),
								checked: draft.runtimeUserScope === "global",
								disabled: coreDisabled,
								onChange: () => edit("runtimeUserScope", "global")
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemoryTopologySection, {
						descriptor: memorySystem,
						topology: topologyDraft,
						state: topologyState,
						disabled: coreDisabled,
						onEnabled: editLayerEnabled,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MemoryEnhancementsSection, {
						...connection === void 0 ? {} : { connection },
						...sessionId === void 0 ? {} : { sessionId },
						...workspaceId === void 0 ? {} : { workspaceId },
						refreshKey: targetRevision,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: MnemonSettingsCard_module_css_default.section,
						"aria-labelledby": "mnemon-providers-heading",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: MnemonSettingsCard_module_css_default.sectionHeading,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									id: "mnemon-providers-heading",
									children: t("config.providersTitle")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("config.providersDescription") })] })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
								className: MnemonSettingsCard_module_css_default.providerPanel,
								open: true,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: MnemonSettingsCard_module_css_default.providerIdentity,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderIcon, {
										providerId: "mnemon-native",
										icon: {
											kind: "brand",
											value: "mnemon"
										},
										className: MnemonSettingsCard_module_css_default.nativeMark
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "mnemon" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("config.nativeSummary") })] })]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: MnemonSettingsCard_module_css_default.providerHeaderMeta,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: MnemonSettingsCard_module_css_default.providerScopeTag,
										"data-scope": activeScope,
										children: t(`config.${activeScope}`)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: MnemonSettingsCard_module_css_default.providerState,
										children: t("config.officialNative")
									})]
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: MnemonSettingsCard_module_css_default.providerPanelBody,
									children: [
										draft.storageScope !== "workspaces" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GlobalLocationSetting, {
											name: "mnemon-native-location",
											ariaLabel: t("config.nativeGlobalLocation"),
											label: t("config.nativeGlobalLocation"),
											hint: draft.storageScope === "workspace" ? t("config.nativeGlobalLocationWorkspaceHint") : t("config.nativeGlobalLocationHint"),
											defaultLabel: t("config.nativeDefaultLocation"),
											customLabel: t("config.custom"),
											custom: draft.storageScope === "custom",
											workspace: draft.storageScope === "workspace",
											disabled: coreDisabled,
											onChange: (custom) => custom ? edit("storageScope", "custom") : editMany({
												storageScope: "global",
												dataDir: ""
											}),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: MnemonSettingsCard_module_css_default.settingRow,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: MnemonSettingsCard_module_css_default.settingCopy,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("config.customDirectory") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("config.customDirectoryHint") })]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: MnemonSettingsCard_module_css_default.directoryControl,
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														id: "mnemon-custom-directory",
														name: "mnemon-custom-directory",
														type: "text",
														className: MnemonSettingsCard_module_css_default.directoryInput,
														"aria-label": t("config.customAria"),
														"aria-invalid": error !== null,
														placeholder: t("config.customPlaceholder"),
														value: draft.dataDir,
														disabled: coreDisabled,
														autoComplete: "off",
														spellCheck: false,
														autoCapitalize: "none",
														autoCorrect: "off",
														onChange: (event) => edit("dataDir", event.target.value)
													})
												})]
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmbeddingSettingsSection, {
											draft,
											disabled: coreDisabled,
											connectionAvailable: connection !== void 0,
											changing: embeddingChanging,
											status: embeddingStatus,
											state: embeddingStatusState,
											error: embeddingStatusError,
											onEdit: edit,
											onTest: testEmbedding,
											t
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MnemonPackSection, {
											...connection === void 0 ? {} : { connection },
											...sessionId === void 0 ? {} : { sessionId },
											...workspaceId === void 0 ? {} : { workspaceId },
											refreshKey: targetRevision,
											t,
											embedded: true
										})
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderSettingsSection, {
								...connection === void 0 ? {} : { connection },
								...sessionId === void 0 ? {} : { sessionId },
								...workspaceId === void 0 ? {} : { workspaceId },
								...activeScope !== "workspace" || workspaceLabel === void 0 ? {} : { workspaceLabel },
								activeScope,
								refreshKey: targetRevision,
								disabled: coreDisabled,
								scopeChanging,
								t
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TaskAgentModelSection, {
						draft,
						catalog: modelCatalog,
						state: modelCatalogState,
						error: modelCatalogError,
						disabled: coreDisabled,
						fullCatalogLoaded: fullModelCatalogLoaded,
						onLoadCatalog: () => loadModelCatalog(true),
						onEdit: edit,
						onEditMany: editMany,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: MnemonSettingsCard_module_css_default.section,
						"aria-labelledby": "mnemon-interaction-heading",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: MnemonSettingsCard_module_css_default.sectionHeading,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								id: "mnemon-interaction-heading",
								children: t("config.interactionTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("config.interactionHint") })] })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MnemonSettingsCard_module_css_default.rowGroup,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleRow, {
								id: "mnemon-interaction-turn-bar",
								label: t("config.interactionTurnBar"),
								hint: t("config.interactionTurnBarHint"),
								checked: draft.turnBar,
								disabled: interactionDisabled,
								onChange: (value) => edit("turnBar", value)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleRow, {
								id: "mnemon-interaction-save-action",
								label: t("config.interactionSaveAction"),
								hint: t("config.interactionSaveActionHint"),
								checked: draft.saveAction,
								disabled: interactionDisabled,
								onChange: (value) => edit("saveAction", value)
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonSettingsCard_module_css_default.feedback,
						"aria-live": "polite",
						children: [
							error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: MnemonSettingsCard_module_css_default.error,
								role: "alert",
								children: error
							}),
							failed !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: MnemonSettingsCard_module_css_default.error,
								role: "alert",
								children: t("config.saveFailed", { error: failed })
							}),
							applied && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: MnemonSettingsCard_module_css_default.success,
								role: "status",
								children: t("config.ready")
							}),
							!writable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: MnemonSettingsCard_module_css_default.readOnly,
								children: t("config.readOnly")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
						className: `${MnemonSettingsCard_module_css_default.actions} ${dirty.size > 0 ? MnemonSettingsCard_module_css_default.actionsVisible : ""}`,
						"aria-live": "polite",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("config.unsaved") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: MnemonSettingsCard_module_css_default.discard,
							disabled: saving,
							onClick: discard,
							children: t("config.discard")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: MnemonSettingsCard_module_css_default.save,
							disabled: saving || error !== null || !writable,
							onClick: () => void save(),
							children: saving ? t("config.saving") : t("config.save")
						})] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: MnemonSettingsCard_module_css_default.settingsNote,
						children: [
							t("config.noticeBefore"),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: ".dsh/settings.yaml" }),
							t("config.noticeAfter")
						]
					})
				] })
			});
		}
		/**
		* v0.5 exposes the shipped behavior toggles, not the underlying plugin graph.
		* Older Hosts simply omit this section when the View settings channel is absent.
		*/
		function MemoryEnhancementsSection(props) {
			const client = (0, react.useMemo)(() => props.connection === void 0 ? void 0 : new MnemonClient(props.connection, props.sessionId, props.workspaceId), [
				props.connection,
				props.sessionId,
				props.workspaceId
			]);
			const [dashboard, setDashboard] = (0, react.useState)(null);
			const [state, setState] = (0, react.useState)(client === void 0 ? "unavailable" : "loading");
			const [working, setWorking] = (0, react.useState)(null);
			const [failure, setFailure] = (0, react.useState)(null);
			const request = (0, react.useRef)(0);
			const load = (0, react.useCallback)(async () => {
				if (client === void 0) {
					request.current += 1;
					setDashboard(null);
					setState("unavailable");
					return;
				}
				const ticket = request.current + 1;
				request.current = ticket;
				setState("loading");
				try {
					const next = await client.viewDashboard();
					if (request.current !== ticket) return;
					setDashboard(next);
					setState("ready");
					setFailure(null);
				} catch {
					if (request.current !== ticket) return;
					setDashboard(null);
					setState("unavailable");
				}
			}, [client, props.refreshKey]);
			(0, react.useEffect)(() => {
				load();
				return () => {
					request.current += 1;
				};
			}, [load]);
			const entries = MEMORY_ENHANCEMENTS.flatMap((definition) => {
				const entry = dashboard?.entries.find((candidate) => candidate.packageName === definition.packageName && candidate.roles.includes("strategy-extension"));
				return entry === void 0 ? [] : [{
					definition,
					entry
				}];
			});
			if (state !== "ready" || dashboard === null || entries.length === 0) return null;
			const toggle = async (entry) => {
				if (client === void 0 || working !== null || !dashboard.writable || !entry.writable) return;
				const previous = dashboard;
				const enabled = !entry.enabled;
				const ticket = request.current + 1;
				request.current = ticket;
				setWorking(entry.packageName);
				setFailure(null);
				setDashboard({
					...dashboard,
					entries: dashboard.entries.map((candidate) => candidate.entryId === entry.entryId ? {
						...candidate,
						enabled
					} : candidate)
				});
				try {
					await client.applyView({
						expectedRevision: previous.revision,
						strategyTypeId: previous.strategyTypeId,
						entries: { [entry.entryId]: {
							enabled,
							config: structuredClone(entry.config)
						} }
					});
					try {
						const next = await client.viewDashboard();
						if (request.current !== ticket) return;
						setDashboard(next);
					} catch {
						if (request.current !== ticket) return;
						setDashboard((current) => current === null ? current : {
							...current,
							writable: false
						});
						setFailure("refresh");
					}
				} catch {
					if (request.current !== ticket) return;
					setDashboard(previous);
					setFailure("apply");
				} finally {
					if (request.current === ticket) setWorking(null);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: `${MnemonSettingsCard_module_css_default.section} ${MnemonSettingsCard_module_css_default.enhancementsSection}`,
				"aria-labelledby": "mnemon-enhancements-heading",
				"aria-busy": working !== null,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MnemonSettingsCard_module_css_default.sectionHeading,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: "mnemon-enhancements-heading",
							children: props.t("config.enhancementsTitle")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("config.enhancementsDescription") })] })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MnemonSettingsCard_module_css_default.rowGroup,
						children: entries.map(({ definition, entry }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleRow, {
							id: `mnemon-enhancement-${entry.entryId.replace(/[^a-zA-Z0-9_-]/gu, "-")}`,
							label: props.t(definition.label),
							hint: props.t(definition.hint),
							checked: entry.enabled,
							disabled: working !== null || !dashboard.writable || !entry.writable,
							onChange: () => void toggle(entry)
						}, entry.entryId))
					}),
					failure !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: MnemonSettingsCard_module_css_default.error,
						role: "alert",
						children: props.t(failure === "refresh" ? "config.enhancementsRefreshFailed" : "config.enhancementsFailed")
					})
				]
			});
		}
		function EmbeddingSettingsSection(props) {
			const feedback = props.changing ? props.t("config.embeddingSaveBeforeTest") : props.state === "loading" ? props.t("config.embeddingTesting") : props.state === "error" ? props.t("config.embeddingStatusFailed", { error: props.error ?? "" }) : props.state === "ready" && props.status !== null ? props.status.available ? props.status.protocol === void 0 ? props.t("config.embeddingStatusAvailable", {
				model: props.status.model,
				embedded: props.status.embedded,
				total: props.status.totalInsights,
				coverage: props.status.coverage
			}) : props.t("config.embeddingStatusAvailableWithProtocol", {
				model: props.status.model,
				protocol: props.status.protocol,
				embedded: props.status.embedded,
				total: props.status.totalInsights,
				coverage: props.status.coverage
			}) : props.status.protocol === void 0 ? props.t("config.embeddingStatusUnavailable", {
				model: props.status.model,
				embedded: props.status.embedded,
				total: props.status.totalInsights,
				coverage: props.status.coverage
			}) : props.t("config.embeddingStatusUnavailableWithProtocol", {
				model: props.status.model,
				protocol: props.status.protocol,
				embedded: props.status.embedded,
				total: props.status.totalInsights,
				coverage: props.status.coverage
			}) : props.state === "unavailable" ? props.t("config.embeddingTestUnavailable") : props.t("config.embeddingNotTested");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: MnemonSettingsCard_module_css_default.embeddingSection,
				"aria-labelledby": "mnemon-embedding-heading",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonSettingsCard_module_css_default.embeddingHeading,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							id: "mnemon-embedding-heading",
							children: props.t("config.embeddingTitle")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("config.embeddingDescription") })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToggleRow, {
						id: "mnemon-embedding-managed",
						label: props.t("config.embeddingManaged"),
						hint: props.t("config.embeddingManagedHint"),
						checked: props.draft.embeddingEnabled,
						disabled: props.disabled,
						onChange: (value) => props.onEdit("embeddingEnabled", value)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonSettingsCard_module_css_default.providerIdentityFields,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [props.t("config.embeddingEndpoint"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "url",
								"aria-label": props.t("config.embeddingEndpoint"),
								"aria-invalid": props.draft.embeddingEnabled && !validEmbeddingEndpoint(props.draft.embeddingEndpoint),
								value: props.draft.embeddingEndpoint,
								disabled: props.disabled || !props.draft.embeddingEnabled,
								autoComplete: "off",
								spellCheck: false,
								autoCapitalize: "none",
								autoCorrect: "off",
								placeholder: DEFAULT_EMBEDDING_ENDPOINT,
								onChange: (event) => props.onEdit("embeddingEndpoint", event.target.value)
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [props.t("config.embeddingModel"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "text",
								"aria-label": props.t("config.embeddingModel"),
								"aria-invalid": props.draft.embeddingEnabled && !validEmbeddingModel(props.draft.embeddingModel),
								value: props.draft.embeddingModel,
								disabled: props.disabled || !props.draft.embeddingEnabled,
								autoComplete: "off",
								spellCheck: false,
								autoCapitalize: "none",
								autoCorrect: "off",
								placeholder: DEFAULT_EMBEDDING_MODEL,
								onChange: (event) => props.onEdit("embeddingModel", event.target.value)
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [props.t("config.embeddingProtocol"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								"aria-label": props.t("config.embeddingProtocol"),
								value: props.draft.embeddingProtocol,
								disabled: props.disabled || !props.draft.embeddingEnabled,
								onChange: (event) => props.onEdit("embeddingProtocol", event.target.value),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "auto",
										children: props.t("config.embeddingProtocolAuto")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "ollama",
										children: props.t("config.embeddingProtocolOllama")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "openai",
										children: props.t("config.embeddingProtocolOpenai")
									})
								]
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [props.t("config.embeddingApiKey"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "password",
								"aria-label": props.t("config.embeddingApiKey"),
								"aria-invalid": props.draft.embeddingEnabled && !validEmbeddingApiKey(props.draft.embeddingApiKey),
								value: props.draft.embeddingApiKey,
								disabled: props.disabled || !props.draft.embeddingEnabled,
								autoComplete: "off",
								spellCheck: false,
								autoCapitalize: "none",
								autoCorrect: "off",
								placeholder: "sk-…",
								onChange: (event) => props.onEdit("embeddingApiKey", event.target.value)
							})] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: MnemonSettingsCard_module_css_default.embeddingSecurity,
						children: props.t("config.embeddingSecurity")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonSettingsCard_module_css_default.embeddingTest,
						"aria-live": "polite",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: props.state === "error" ? MnemonSettingsCard_module_css_default.error : void 0,
							role: props.state === "error" ? "alert" : void 0,
							children: feedback
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: MnemonSettingsCard_module_css_default.textButton,
							disabled: props.disabled || !props.connectionAvailable || props.changing || props.state === "loading",
							onClick: props.onTest,
							children: props.t("config.embeddingTest")
						})]
					})
				]
			});
		}
		function MemoryTopologySection(props) {
			const layerDescriptors = new Map(props.descriptor?.sources.map((source) => [source.sourceTypeId, source.management]) ?? []);
			const builtInCopy = (layerId) => {
				if (layerId === "runtime") return {
					label: props.t("layers.runtimeLabel"),
					description: props.t("layers.runtimeDescription")
				};
				if (layerId === "documents") return {
					label: props.t("layers.documentsLabel"),
					description: props.t("layers.documentsDescription")
				};
				if (layerId === "memory-spaces") return {
					label: props.t("layers.memorySpacesLabel"),
					description: props.t("layers.memorySpacesDescription")
				};
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: MnemonSettingsCard_module_css_default.section,
				"aria-labelledby": "mnemon-topology-heading",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MnemonSettingsCard_module_css_default.sectionHeading,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						id: "mnemon-topology-heading",
						children: props.t("config.topologyTitle")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("config.topologyDescription") })] }), props.state === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: MnemonSettingsCard_module_css_default.miniSpinner,
						"aria-hidden": "true"
					})]
				}), props.topology === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: MnemonSettingsCard_module_css_default.topologyUnavailable,
					children: props.state === "loading" ? props.t("config.topologyLoading") : props.t("config.topologyUnavailable")
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: MnemonSettingsCard_module_css_default.topologyList,
					children: props.topology.layers.map((layer) => {
						const descriptor = layerDescriptors.get(layer.id);
						const copy = builtInCopy(layer.id);
						const label = copy?.label ?? descriptor?.label ?? layer.id;
						const description = copy?.description ?? descriptor?.description ?? layer.id;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("article", {
							className: MnemonSettingsCard_module_css_default.topologyLayer,
							"data-enabled": layer.enabled,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: description })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: MnemonSettingsCard_module_css_default.topologyToggle,
								htmlFor: `mnemon-layer-${layer.id}`,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: layer.enabled ? props.t("config.topologyEnabled") : props.t("config.topologyDisabled") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: `mnemon-layer-${layer.id}`,
										type: "checkbox",
										"aria-label": props.t("config.topologyLayerToggle", { layer: label }),
										checked: layer.enabled,
										disabled: props.disabled,
										onChange: (event) => props.onEnabled(layer.id, event.target.checked)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { "aria-hidden": "true" })
								]
							})] })
						}, layer.id);
					})
				}) })]
			});
		}
		function TaskAgentModelSection(props) {
			const groups = props.catalog?.groups ?? [];
			const group = groups.find((candidate) => candidate.id === props.draft.taskAgentProvider);
			const inherited = props.catalog?.defaultSelection ?? (props.catalog?.effective?.source === "fixed" ? void 0 : props.catalog?.effective);
			const effective = props.draft.taskAgentModelMode === "fixed" ? props.draft.taskAgentProvider.trim() === "" || props.draft.taskAgentModel.trim() === "" ? void 0 : {
				provider: props.draft.taskAgentProvider,
				model: props.draft.taskAgentModel
			} : inherited;
			const chooseFixed = () => {
				const preferredProvider = props.draft.taskAgentProvider || inherited?.provider || groups[0]?.id || "";
				const models = groups.find((candidate) => candidate.id === preferredProvider)?.models ?? [];
				const preferredModel = props.draft.taskAgentModel || (inherited?.provider === preferredProvider ? inherited.model : void 0) || models[0]?.id || "";
				props.onEditMany({
					taskAgentModelMode: "fixed",
					taskAgentProvider: preferredProvider,
					taskAgentModel: preferredModel
				});
				if (!props.fullCatalogLoaded) props.onLoadCatalog();
			};
			const chooseProvider = (provider) => {
				const models = groups.find((candidate) => candidate.id === provider)?.models ?? [];
				props.onEditMany({
					taskAgentProvider: provider,
					taskAgentModel: models[0]?.id ?? ""
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: MnemonSettingsCard_module_css_default.section,
				"aria-labelledby": "mnemon-task-agent-heading",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonSettingsCard_module_css_default.sectionHeading,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: "mnemon-task-agent-heading",
							children: props.t("config.taskAgentTitle")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("config.taskAgentDescription") })] }), props.state === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MnemonSettingsCard_module_css_default.miniSpinner,
							"aria-hidden": "true"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonSettingsCard_module_css_default.choiceGrid,
						role: "radiogroup",
						"aria-label": props.t("config.taskAgentModeAria"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChoiceCard, {
							id: "mnemon-task-agent-inherit",
							name: "mnemon-task-agent",
							label: props.t("config.taskAgentInherit"),
							detail: props.t("config.taskAgentInheritHint"),
							checked: props.draft.taskAgentModelMode === "inherit",
							disabled: props.disabled,
							onChange: () => props.onEditMany({ taskAgentModelMode: "inherit" })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChoiceCard, {
							id: "mnemon-task-agent-fixed",
							name: "mnemon-task-agent",
							label: props.t("config.taskAgentFixed"),
							detail: props.t("config.taskAgentFixedHint"),
							checked: props.draft.taskAgentModelMode === "fixed",
							disabled: props.disabled || props.state === "unavailable",
							onChange: chooseFixed
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonSettingsCard_module_css_default.taskAgentPanel,
						"data-mode": props.draft.taskAgentModelMode,
						children: [
							props.draft.taskAgentModelMode === "fixed" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MnemonSettingsCard_module_css_default.taskAgentFields,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: props.t("config.taskAgentProvider") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: props.t("config.taskAgentProviderHint") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									"aria-label": props.t("config.taskAgentProvider"),
									value: props.draft.taskAgentProvider,
									disabled: props.disabled || props.state !== "ready",
									onChange: (event) => chooseProvider(event.target.value),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: props.t("config.taskAgentChooseProvider")
										}),
										props.draft.taskAgentProvider !== "" && !groups.some((candidate) => candidate.id === props.draft.taskAgentProvider) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: props.draft.taskAgentProvider,
											children: props.draft.taskAgentProvider
										}),
										groups.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: candidate.id,
											children: candidate.name
										}, candidate.id))
									]
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: props.t("config.taskAgentModel") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: props.t("config.taskAgentModelHint") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									"aria-label": props.t("config.taskAgentModel"),
									value: props.draft.taskAgentModel,
									disabled: props.disabled || props.state !== "ready" || group === void 0,
									onChange: (event) => props.onEdit("taskAgentModel", event.target.value),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: props.t("config.taskAgentChooseModel")
										}),
										props.draft.taskAgentModel !== "" && !group?.models.some((model) => model.id === props.draft.taskAgentModel) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: props.draft.taskAgentModel,
											children: props.draft.taskAgentModel
										}),
										(group?.models ?? []).map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
											value: model.id,
											children: [model.name, model.inputModalities?.includes("image") === true ? ` · ${props.t("config.taskAgentImageInput")}` : ""]
										}, model.id))
									]
								})] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MnemonSettingsCard_module_css_default.taskAgentEffective,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.t("config.taskAgentEffective") }), effective === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: props.state === "loading" ? props.t("config.taskAgentLoading") : props.t("config.taskAgentUnavailable") }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("code", { children: [
									effective.provider,
									" / ",
									effective.model
								] })]
							}),
							props.state === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: MnemonSettingsCard_module_css_default.taskAgentWarning,
								children: props.t("config.taskAgentLoadFailed", { error: props.error ?? "" })
							}),
							(props.catalog?.failures.length ?? 0) > 0 && groups.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: MnemonSettingsCard_module_css_default.taskAgentWarning,
								children: props.t("config.taskAgentPartial", { count: props.catalog.failures.length })
							})
						]
					})
				]
			});
		}
		function ChoiceCard(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: MnemonSettingsCard_module_css_default.choiceCard,
				htmlFor: props.id,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					id: props.id,
					name: props.name,
					type: "radio",
					"aria-label": props.label,
					checked: props.checked,
					disabled: props.disabled,
					onChange: props.onChange
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: MnemonSettingsCard_module_css_default.choiceFace,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: props.label }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: props.detail }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MnemonSettingsCard_module_css_default.check,
							"aria-hidden": "true",
							children: "✓"
						})
					]
				})]
			});
		}
		function ToggleRow(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: MnemonSettingsCard_module_css_default.toggleRow,
				htmlFor: props.id,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: MnemonSettingsCard_module_css_default.settingCopy,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: props.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: props.hint })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						id: props.id,
						type: "checkbox",
						"aria-label": props.label,
						checked: props.checked,
						disabled: props.disabled,
						onChange: (event) => props.onChange(event.target.checked)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: MnemonSettingsCard_module_css_default.switch,
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {})
					})
				]
			});
		}
		//#endregion
		//#region src/client/anchor.ts
		const MNEMON_ANCHOR_EVENT = "mnemon:anchor";
		const pendingBySession = /* @__PURE__ */ new Map();
		function keyOf(sessionId) {
			return sessionId === void 0 || sessionId === "" ? "*" : sessionId;
		}
		/** Ask the Mnemon view to open a page; held until a matching view consumes it. */
		function dispatchMnemonAnchor(anchor) {
			pendingBySession.set(keyOf(anchor.sessionId), anchor);
			window.dispatchEvent(new CustomEvent(MNEMON_ANCHOR_EVENT, { detail: anchor }));
		}
		/** Take the anchor held for this session (usually at mount time), or null. */
		function consumeMnemonAnchor(sessionId) {
			const key = keyOf(sessionId);
			const anchor = pendingBySession.get(key);
			if (anchor === void 0) return null;
			pendingBySession.delete(key);
			return anchor;
		}
		/** Subscribe to anchors addressed to this session; returns an unsubscribe. */
		function subscribeMnemonAnchor(sessionId, onAnchor) {
			const key = keyOf(sessionId);
			const handler = (event) => {
				const anchor = event.detail;
				if (anchor !== void 0 && keyOf(anchor.sessionId) === key) {
					if (pendingBySession.get(key) === anchor) pendingBySession.delete(key);
					onAnchor(anchor);
				}
			};
			window.addEventListener(MNEMON_ANCHOR_EVENT, handler);
			return () => window.removeEventListener(MNEMON_ANCHOR_EVENT, handler);
		}
		//#endregion
		//#region \0dsh-mnemon-css:/home/runner/work/dsh-mnemon/dsh-mnemon/src/client/MnemonTurnTail.module.css.mjs
		const css$10 = "._3g7pq_root{min-width:0;margin:2px 0}._3g7pq_bar{cursor:pointer;min-width:0;max-width:100%;height:22px;color:var(--dsw-alias-label-tertiary);background:0 0;border:1px solid #0000;border-radius:6px;align-items:center;gap:6px;padding:0 8px 0 6px;font-size:11px;line-height:22px;display:flex}._3g7pq_bar:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}._3g7pq_bar:focus-visible{outline:1.5px solid var(--dsw-alias-state-business-primary);outline-offset:2px}._3g7pq_mark{opacity:.8;flex:none;font-size:10px}._3g7pq_label{flex:none;font-weight:600}._3g7pq_metrics{align-items:center;gap:6px;min-width:0;display:inline-flex;overflow:hidden}._3g7pq_metrics span{white-space:nowrap}._3g7pq_failureMetric{color:var(--dsw-alias-state-error-primary,#d44)}._3g7pq_chevron{opacity:.7;flex:none;width:8px;height:8px;margin-left:auto}._3g7pq_chevron:before{content:\"\";border-bottom:1.5px solid;border-right:1.5px solid;width:5px;height:5px;transition:transform .12s;display:block;transform:rotate(45deg)translate(-1px,-1px)}._3g7pq_chevronOpen:before{transform:rotate(-135deg)translate(0)}._3g7pq_details{border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-markdown-code-block);border-radius:0 8px 8px 0;align-items:center;gap:10px;min-width:0;margin:2px 0 4px;padding:6px 8px;display:flex}._3g7pq_detailLabel{color:var(--dsw-alias-label-caption);letter-spacing:.08em;text-transform:uppercase;flex:none;font-size:10px;font-weight:650}._3g7pq_tools{flex-wrap:wrap;flex:auto;gap:4px;min-width:0;display:flex}._3g7pq_toolChip{cursor:pointer;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,Consolas, monospace);white-space:nowrap;border:none;border-radius:4px;padding:0 6px;font-size:10px;line-height:18px}._3g7pq_toolChip:hover{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-state-business-primary)}._3g7pq_toolChip:focus-visible{outline:1.5px solid var(--dsw-alias-state-business-primary);outline-offset:1px}";
		const tagId$10 = "dsh-mnemon/src/client/MnemonTurnTail.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$10) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = tagId$10;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css$10) tag.textContent = css$10;
		}
		var MnemonTurnTail_module_css_default = {
			"bar": "_3g7pq_bar",
			"chevron": "_3g7pq_chevron",
			"chevronOpen": "_3g7pq_chevronOpen",
			"detailLabel": "_3g7pq_detailLabel",
			"details": "_3g7pq_details",
			"failureMetric": "_3g7pq_failureMetric",
			"label": "_3g7pq_label",
			"mark": "_3g7pq_mark",
			"metrics": "_3g7pq_metrics",
			"root": "_3g7pq_root",
			"toolChip": "_3g7pq_toolChip",
			"tools": "_3g7pq_tools"
		};
		//#endregion
		//#region src/client/MnemonTurnTail.tsx
		function turnNumber(turn) {
			const value = turn?.turn;
			return typeof value === "number" ? value : void 0;
		}
		/** Route a settled tool name to the workbench page that explains its effect. */
		function memoryPageForTool(name) {
			if (name === "mnemon_document_search" || name === "mnemon_document_manage" || name === "mnemon_document_create") return "documents/library";
			if (name === "mnemon_runtime_memory") return "runtime/entries";
			if (name === "mnemon_recall" || name === "mnemon_related") return "memory-spaces/explore";
			if (name === "mnemon_status") return "status";
			return "memory-spaces/spaces";
		}
		/** Whether this entry renders for the owner; chain selectors decline quietly. */
		function selectMnemonTurnTail(owner) {
			return owner.turn.status === "closed" ? {} : null;
		}
		/** One-line memory-activity bar under a completed turn; hides when the turn touched no memory. */
		const MnemonTurnTail = (0, react.memo)(function MnemonTurnTail({ turn, seq, sessionId, connection, localeRuntime, t }) {
			const subscribeLocale = (0, react.useCallback)((listener) => localeRuntime.subscribe(listener), [localeRuntime]);
			const getLocale = (0, react.useCallback)(() => localeRuntime.getSnapshot(), [localeRuntime]);
			(0, react.useSyncExternalStore)(subscribeLocale, getLocale, getLocale);
			const [activity, setActivity] = (0, react.useState)(void 0);
			const [open, setOpen] = (0, react.useState)(false);
			const number = turnNumber(turn);
			(0, react.useEffect)(() => {
				if (number === void 0) {
					setActivity(null);
					return;
				}
				let alive = true;
				new MnemonClient(connection, sessionId).turnActivity(number, seq).then((result) => {
					if (alive) setActivity(result);
				}).catch(() => {
					if (alive) setActivity(null);
				});
				return () => {
					alive = false;
				};
			}, [
				connection,
				sessionId,
				number,
				seq
			]);
			if (activity === void 0 || activity === null) return null;
			if (number === void 0) return null;
			const openTool = (name, event) => {
				event.stopPropagation();
				dispatchMnemonAnchor({
					page: memoryPageForTool(name),
					...sessionId === void 0 ? {} : { sessionId }
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: MnemonTurnTail_module_css_default.root,
				"data-open": open || void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: MnemonTurnTail_module_css_default.bar,
					"aria-expanded": open,
					onClick: () => setOpen((value) => !value),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MnemonTurnTail_module_css_default.mark,
							"aria-hidden": "true",
							children: "◈"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MnemonTurnTail_module_css_default.label,
							children: t("turnTail.label")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: MnemonTurnTail_module_css_default.metrics,
							children: [
								activity.recalls > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("turnTail.recall", { count: activity.recalls }) }),
								activity.writes > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("turnTail.write", { count: activity.writes }) }),
								activity.documentSearches > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("turnTail.documents", { count: activity.documentSearches }) }),
								activity.inspections > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("turnTail.inspect", { count: activity.inspections }) }),
								activity.failures > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: MnemonTurnTail_module_css_default.failureMetric,
									children: t("turnTail.failed", { count: activity.failures })
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `${MnemonTurnTail_module_css_default.chevron} ${open ? MnemonTurnTail_module_css_default.chevronOpen : ""}`,
							"aria-hidden": "true"
						})
					]
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MnemonTurnTail_module_css_default.details,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: MnemonTurnTail_module_css_default.detailLabel,
						children: t("turnTail.toolList")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MnemonTurnTail_module_css_default.tools,
						children: activity.names.map((name, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: MnemonTurnTail_module_css_default.toolChip,
							"aria-label": t("turnTail.openTool", { tool: name }),
							onClick: (event) => openTool(name, event),
							children: name
						}, `${name}-${index}`))
					})]
				})]
			});
		});
		//#endregion
		//#region \0dsh-mnemon-css:/home/runner/work/dsh-mnemon/dsh-mnemon/src/client/MnemonSaveAction.module.css.mjs
		const css$9 = ".ypSjoa_wrap{display:inline-flex;position:relative}.ypSjoa_button{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:28px;justify-content:center;align-items:center;padding:6px;display:inline-flex}.ypSjoa_button:hover,.ypSjoa_button[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.ypSjoa_button:focus-visible{outline:1.5px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.ypSjoa_icon{flex:none;width:16px;height:16px}.ypSjoa_modal{width:min(640px, calc(100vw - max(12px, env(safe-area-inset-left,0px)) - max(12px, env(safe-area-inset-right,0px))));max-height:calc(100vh - 24px)}.ypSjoa_modalContent{overscroll-behavior:contain;-webkit-overflow-scrolling:touch;min-height:0;overflow-y:auto}.ypSjoa_modalAction{min-width:96px}.ypSjoa_status{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}.ypSjoa_readOnly{background:var(--dsw-alias-state-warn-bg,transparent);color:var(--dsw-alias-state-warn-primary);border-radius:6px;margin-top:8px;padding:6px 8px;font-size:11px}.ypSjoa_candidate{display:block}.ypSjoa_candidate>span{color:var(--dsw-alias-label-caption);margin-bottom:8px;font-size:12px;font-weight:650;line-height:18px;display:block}.ypSjoa_candidate textarea{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);resize:vertical;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-base));width:100%;min-height:260px;max-height:50vh;color:var(--dsw-alias-label-primary);font:13px/20px var(--ds-font-family-code,Consolas, monospace);border-radius:8px;padding:8px 10px;display:block}.ypSjoa_candidate textarea:focus-visible{outline:1.5px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.ypSjoa_truncated{color:var(--dsw-alias-label-tertiary);margin-top:4px;font-size:10px;line-height:14px;display:block}.ypSjoa_outcome{background:var(--dsw-alias-state-success-bg,transparent);color:var(--dsw-alias-state-success-primary);border-radius:6px;margin-top:8px;padding:6px 8px;font-size:11px}.ypSjoa_failure{background:var(--dsw-alias-state-error-bg,transparent);color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;border-radius:6px;margin-top:8px;padding:6px 8px;font-size:11px}@media (width<=640px),(height<=560px){.ypSjoa_modal{width:min(100%, calc(100vw - max(8px, env(safe-area-inset-left,0px)) - max(8px, env(safe-area-inset-right,0px))));max-height:calc(100vh - 16px)}.ypSjoa_modal .ypSjoa_modalAction{min-width:0;min-height:44px}.ypSjoa_candidate textarea{min-height:clamp(140px,32vh,220px);max-height:42vh}}@media (pointer:coarse) and (width<=640px),(pointer:coarse) and (height<=560px){.ypSjoa_candidate textarea{font-size:16px}}@supports (height:100dvh){.ypSjoa_modal{max-height:calc(100dvh - 24px)}@media (width<=640px),(height<=560px){.ypSjoa_modal{max-height:calc(100dvh - 16px)}.ypSjoa_candidate textarea{min-height:clamp(140px,32dvh,220px);max-height:42dvh}}}";
		const tagId$9 = "dsh-mnemon/src/client/MnemonSaveAction.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$9) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = tagId$9;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css$9) tag.textContent = css$9;
		}
		var MnemonSaveAction_module_css_default = {
			"button": "ypSjoa_button",
			"candidate": "ypSjoa_candidate",
			"failure": "ypSjoa_failure",
			"icon": "ypSjoa_icon",
			"modal": "ypSjoa_modal",
			"modalAction": "ypSjoa_modalAction",
			"modalContent": "ypSjoa_modalContent",
			"outcome": "ypSjoa_outcome",
			"readOnly": "ypSjoa_readOnly",
			"status": "ypSjoa_status",
			"truncated": "ypSjoa_truncated",
			"wrap": "ypSjoa_wrap"
		};
		//#endregion
		//#region src/client/MnemonSaveAction.tsx
		const PREVIEW_LIMIT = 8e3;
		/** Save-to-memory action on finalized assistant messages, routed through the supervised writeback gate. */
		const MnemonSaveAction = (0, react.memo)(function MnemonSaveAction({ messageId, sessionId, connection, settingsScope, localeRuntime, t }) {
			const subscribeLocale = (0, react.useCallback)((listener) => localeRuntime.subscribe(listener), [localeRuntime]);
			const getLocale = (0, react.useCallback)(() => localeRuntime.getSnapshot(), [localeRuntime]);
			(0, react.useSyncExternalStore)(subscribeLocale, getLocale, getLocale);
			const subscribeSettings = (0, react.useCallback)((listener) => settingsScope.subscribe(listener), [settingsScope]);
			const getSettingsSnapshot = (0, react.useCallback)(() => settingsScope.getSnapshot(), [settingsScope]);
			const settingsSnapshot = (0, react.useSyncExternalStore)(subscribeSettings, getSettingsSnapshot, getSettingsSnapshot);
			const managementWritable = settingsSnapshot.status === "ready" && settingsSnapshot.writable;
			const [open, setOpen] = (0, react.useState)(false);
			const [writeEnabled, setWriteEnabled] = (0, react.useState)(void 0);
			const [candidate, setCandidate] = (0, react.useState)(void 0);
			const [truncated, setTruncated] = (0, react.useState)(false);
			const [missing, setMissing] = (0, react.useState)(false);
			const [submitting, setSubmitting] = (0, react.useState)(false);
			const [outcome, setOutcome] = (0, react.useState)(null);
			const [failure, setFailure] = (0, react.useState)(null);
			const textareaRef = (0, react.useRef)(null);
			const openRef = (0, react.useRef)(false);
			const requestVersionRef = (0, react.useRef)(0);
			const submitActiveRef = (0, react.useRef)(false);
			const setPanelOpen = (next) => {
				requestVersionRef.current += 1;
				openRef.current = next;
				setOpen(next);
			};
			(0, react.useEffect)(() => {
				if (!open) {
					setWriteEnabled(void 0);
					setCandidate(void 0);
					setTruncated(false);
					setMissing(false);
					setSubmitting(submitActiveRef.current);
					setOutcome(null);
					setFailure(null);
					return;
				}
				const requestVersion = ++requestVersionRef.current;
				let alive = true;
				setSubmitting(submitActiveRef.current);
				const client = new MnemonClient(connection, sessionId);
				client.status().then((status) => {
					if (alive && requestVersionRef.current === requestVersion) setWriteEnabled(status.writeEnabled && managementWritable);
				}).catch(() => {
					if (alive && requestVersionRef.current === requestVersion) setWriteEnabled(false);
				});
				client.assistantMessageText(messageId).then((result) => {
					if (!alive || requestVersionRef.current !== requestVersion) return;
					if (result === null || result.text === "") setMissing(true);
					else {
						setTruncated(result.text.length > PREVIEW_LIMIT);
						setCandidate(result.text.slice(0, PREVIEW_LIMIT));
					}
				}).catch(() => {
					if (alive && requestVersionRef.current === requestVersion) setMissing(true);
				});
				return () => {
					alive = false;
				};
			}, [
				open,
				connection,
				sessionId,
				messageId,
				managementWritable
			]);
			const submit = () => {
				const content = textareaRef.current?.value.trim() ?? "";
				if (content === "" || writeEnabled !== true || submitActiveRef.current) return;
				const requestVersion = requestVersionRef.current;
				submitActiveRef.current = true;
				setSubmitting(true);
				setFailure(null);
				setOutcome(null);
				new MnemonClient(connection, sessionId).supervise(content, messageId).then((result) => {
					if (!openRef.current || requestVersionRef.current !== requestVersion) return;
					setOutcome({
						summary: result.summary,
						action: result.action
					});
					setCandidate(content);
				}).catch((reason) => {
					if (openRef.current && requestVersionRef.current === requestVersion) setFailure(reason instanceof Error ? reason.message : String(reason));
				}).finally(() => {
					submitActiveRef.current = false;
					if (openRef.current) setSubmitting(false);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: MnemonSaveAction_module_css_default.wrap,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("saveAction.tooltip"),
					side: "bottom",
					disabled: open,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: MnemonSaveAction_module_css_default.button,
						"aria-label": t("saveAction.button"),
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						onClick: () => setPanelOpen(!openRef.current),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDataOutline16, {
							size: 16,
							className: MnemonSaveAction_module_css_default.icon
						})
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
					open,
					onClose: () => setPanelOpen(false),
					title: t("saveAction.title"),
					closeLabel: t("saveAction.close"),
					description: t("saveAction.hint"),
					className: MnemonSaveAction_module_css_default.modal,
					contentClassName: MnemonSaveAction_module_css_default.modalContent,
					footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						className: MnemonSaveAction_module_css_default.modalAction,
						disabled: submitting,
						onClick: () => setPanelOpen(false),
						children: t("common.cancel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						className: MnemonSaveAction_module_css_default.modalAction,
						disabled: candidate === void 0 || submitting || writeEnabled !== true,
						onClick: submit,
						children: submitting ? t("saveAction.submitting") : t("saveAction.submit")
					})] }),
					children: [
						writeEnabled === false && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: MnemonSaveAction_module_css_default.readOnly,
							role: "status",
							children: t("saveAction.readOnly")
						}),
						candidate === void 0 && !missing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: MnemonSaveAction_module_css_default.status,
							children: t("saveAction.fetching")
						}),
						missing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: MnemonSaveAction_module_css_default.status,
							role: "status",
							children: t("saveAction.missing")
						}),
						candidate !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: MnemonSaveAction_module_css_default.candidate,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("saveAction.candidate") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									ref: textareaRef,
									rows: 12,
									defaultValue: candidate,
									autoFocus: true
								}),
								truncated && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
									className: MnemonSaveAction_module_css_default.truncated,
									children: t("saveAction.truncated", { limit: PREVIEW_LIMIT })
								})
							]
						}),
						outcome !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: MnemonSaveAction_module_css_default.outcome,
							role: "status",
							children: t("saveAction.result", { summary: outcome.summary })
						}),
						failure !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: MnemonSaveAction_module_css_default.failure,
							role: "alert",
							children: t("saveAction.failed", { error: failure })
						})
					]
				})]
			});
		});
		//#endregion
		//#region src/client/settings.ts
		var MnemonSettingsScope = class {
			connection;
			namespace;
			requestTimeoutMs;
			snapshot = {
				status: "loading",
				writable: false,
				mode: "host"
			};
			listeners = /* @__PURE__ */ new Set();
			tail = Promise.resolve();
			constructor(connection, namespace = MNEMON_SETTINGS_NAMESPACE, requestTimeoutMs = 12e3) {
				this.connection = connection;
				this.namespace = namespace;
				this.requestTimeoutMs = requestTimeoutMs;
				this.load();
			}
			getSnapshot = () => this.snapshot;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => this.listeners.delete(listener);
			};
			set(field, value) {
				return this.mutate([{
					op: "set",
					path: [field],
					value
				}]);
			}
			unset(field) {
				return this.mutate([{
					op: "unset",
					path: [field]
				}]);
			}
			/** Set a nested field. */
			setPath(path, value) {
				return this.mutate([{
					op: "set",
					path,
					value
				}]);
			}
			/** Unset a nested field, falling back to its schema default. */
			unsetPath(path) {
				return this.mutate([{
					op: "unset",
					path
				}]);
			}
			mutate(ops) {
				return this.write(ops);
			}
			async load() {
				try {
					const response = await this.call("get", { namespace: this.namespace });
					if (!response.ok) {
						this.publish({
							status: "unavailable",
							writable: false,
							mode: "host"
						});
						return;
					}
					this.publish(response.value);
				} catch {
					this.publish({
						status: "unavailable",
						writable: false,
						mode: "host"
					});
				}
			}
			write(ops) {
				const task = this.tail.then(async () => {
					const response = await this.call("mutate", {
						namespace: this.namespace,
						ops,
						...this.snapshot.revision === void 0 ? {} : { expectedRevision: this.snapshot.revision }
					});
					if (!response.ok) {
						await this.load();
						throw new Error(response.error.message);
					}
					this.publish(response.value);
				});
				this.tail = task.catch(() => {});
				return task;
			}
			async call(endpoint, payload) {
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), Math.max(1, this.requestTimeoutMs));
				try {
					return await callMnemonRpc(this.connection, MNEMON_SETTINGS_CHANNEL, endpoint, payload, controller.signal);
				} catch (error) {
					if (controller.signal.aborted) throw new Error("Mnemon settings request timed out");
					throw error;
				} finally {
					clearTimeout(timeout);
				}
			}
			publish(snapshot) {
				this.snapshot = snapshot;
				for (const listener of this.listeners) try {
					listener();
				} catch (error) {
					console.warn("dsh-mnemon: settings listener failed; keeping the published Host snapshot", error);
				}
			}
		};
		//#endregion
		//#region src/client/source-pages.tsx
		const MNEMON_SOURCE_PAGE_SLOT = "mnemon.source.page";
		/** Conventional operations used by Mnemon's descriptor-driven Source page. */
		const MNEMON_SOURCE_CONFIGURATION_READ = "configuration";
		const MNEMON_SOURCE_CONFIGURATION_MUTATE = "configuration";
		const SOURCE_TYPE_ID = /^[a-z][a-z0-9-]{0,127}$/u;
		const PAGE_ID = /^[a-z][a-z0-9-]{0,127}$/u;
		function memorySourcePageEntryId(sourceTypeId, pageId) {
			if (!SOURCE_TYPE_ID.test(sourceTypeId)) throw new Error("memory Source UI sourceTypeId must match [a-z][a-z0-9-]{0,127}");
			if (!PAGE_ID.test(pageId)) throw new Error("memory Source UI page id must match [a-z][a-z0-9-]{0,127}");
			return `${sourceTypeId}/${pageId}`;
		}
		/**
		* Thin Client-Fiber adapter over the DSH child Slot. It creates no service or
		* registry: `slots.inject/register` own declaration waiting and disposal.
		*/
		function installMemorySourceUI(ctx, contribution) {
			if (contribution.pages.length === 0) throw new Error("memory Source UI requires at least one page");
			const seen = /* @__PURE__ */ new Set();
			const pages = contribution.pages.map((page, index) => {
				const entryId = memorySourcePageEntryId(contribution.sourceTypeId, page.id);
				if (seen.has(entryId)) throw new Error(`memory Source UI page is duplicated: ${entryId}`);
				seen.add(entryId);
				return {
					page,
					entryId,
					order: page.order ?? 1e3 + index
				};
			});
			return ctx.slots.inject(MNEMON_SOURCE_PAGE_SLOT, () => {
				const disposers = [];
				try {
					for (const { page, entryId, order } of pages) disposers.push(ctx.slots.register({
						name: MNEMON_SOURCE_PAGE_SLOT,
						id: entryId,
						order,
						label: page.label
					}, Object.assign((props) => (0, react.createElement)(page.component, props), { mnemonNavigation: page.navigation })));
				} catch (error) {
					for (const dispose of disposers.reverse()) dispose();
					throw error;
				}
				return () => {
					for (const dispose of disposers.reverse()) dispose();
				};
			});
		}
		/** Stable uSES directory over the Slot ledger; no parallel page registry. */
		function createMemorySourcePageDirectory(ctx) {
			let version = -1;
			let localeSnapshot;
			let snapshot = Object.freeze([]);
			const read = () => {
				const currentVersion = ctx.slots.getVersion(MNEMON_SOURCE_PAGE_SLOT);
				const currentLocale = ctx.locale?.getSnapshot();
				if (currentVersion === version && currentLocale === localeSnapshot) return snapshot;
				version = currentVersion;
				localeSnapshot = currentLocale;
				snapshot = Object.freeze(ctx.slots.entriesOfSlot(MNEMON_SOURCE_PAGE_SLOT).flatMap((entry) => {
					const id = entry.options.id;
					if (id === void 0) return [];
					const separator = id.indexOf("/");
					if (separator <= 0 || separator === id.length - 1) return [];
					let label;
					try {
						label = typeof entry.options.label === "function" ? entry.options.label() : entry.options.label;
					} catch {}
					const metadata = entry.component?.mnemonNavigation;
					let navigation;
					if (metadata !== void 0) {
						let detail;
						try {
							detail = typeof metadata.detail === "function" ? metadata.detail() : metadata.detail;
						} catch {}
						navigation = {
							...metadata,
							...detail === void 0 ? { detail: void 0 } : { detail }
						};
					}
					return [{
						id,
						sourceTypeId: id.slice(0, separator),
						pageId: id.slice(separator + 1),
						label: label?.trim() || id.slice(separator + 1),
						order: entry.options.order ?? 0,
						...navigation === void 0 ? {} : { navigation }
					}];
				}).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)));
				return snapshot;
			};
			return {
				getSnapshot: read,
				subscribe(listener) {
					const changed = () => {
						read();
						listener();
					};
					const stopSlots = ctx.slots.subscribe(MNEMON_SOURCE_PAGE_SLOT, changed);
					const stopLocale = ctx.locale?.subscribe(changed);
					return () => {
						stopLocale?.();
						stopSlots();
					};
				}
			};
		}
		//#endregion
		//#region src/client/better-sidebar-seat.ts
		/**
		* Carries only Better Sidebar's DOM seat and scope into the DSH-owned renderer
		* tree. Source child Slots never cross this boundary: the shell entry renders
		* them itself and portals the resulting workspace into the supplied seat.
		*/
		var MnemonBetterSidebarSeat = class {
			placement;
			owner;
			listeners = /* @__PURE__ */ new Set();
			getSnapshot = () => this.placement;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			attach(target, scope, visible) {
				const owner = Symbol("better-sidebar-seat");
				this.owner = owner;
				this.placement = {
					target,
					scope,
					visible
				};
				this.emit();
				return () => {
					if (this.owner !== owner) return;
					this.owner = void 0;
					this.placement = void 0;
					this.emit();
				};
			}
			emit() {
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region src/client/view-styles.ts
		/** Compose shared view styles with the fixed sidebar skin. */
		function appearanceClass(base, sidebar) {
			return [base, sidebar].filter((value) => value !== void 0 && value !== "").join(" ");
		}
		//#endregion
		//#region \0dsh-mnemon-css:/home/runner/work/dsh-mnemon/dsh-mnemon/src/client/MnemonView.module.css.mjs
		const css$8 = ".IIa07q_shell{--mn-bg:var(--dsw-alias-bg-base);--mn-backdrop:var(--dsw-alias-bg-overlay,var(--mn-bg));--mn-surface:linear-gradient(var(--mn-bg), var(--mn-bg)), linear-gradient(var(--mn-backdrop), var(--mn-backdrop)) var(--mn-bg);--mn-layer-1:var(--dsw-alias-bg-layer-1);--mn-layer-2:var(--dsw-alias-bg-layer-2);--mn-input:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2));--mn-text:var(--dsw-alias-label-primary);--mn-muted:var(--dsw-alias-label-secondary);--mn-faint:var(--dsw-alias-label-tertiary);--mn-line:var(--dsw-alias-border-l1);--mn-line-strong:var(--dsw-alias-border-l2);--mn-accent:var(--dsw-alias-state-business-primary);--mn-hover:var(--dsw-alias-interactive-bg-hover);--mn-danger:var(--dsw-alias-state-error-primary);--mn-success:var(--dsw-alias-state-success-primary);--mn-priority:#9a6a18;--mn-code:var(--ds-font-family-code,\"SFMono-Regular\", Consolas, monospace);--mn-sans:var(--dsw-font-family,-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif);box-sizing:border-box;min-width:0;height:100%;min-height:0;color:var(--mn-text);background:var(--mn-surface);font:13px/1.55 var(--mn-sans);-webkit-tap-highlight-color:transparent;flex-direction:column;display:flex;overflow:hidden}.IIa07q_shell *,.IIa07q_shell :before,.IIa07q_shell :after{box-sizing:border-box}.IIa07q_shell button,.IIa07q_shell input,.IIa07q_shell select,.IIa07q_shell textarea{color:inherit;font:inherit}.IIa07q_shell button,.IIa07q_shell select{touch-action:manipulation}.IIa07q_shell button:focus-visible,.IIa07q_shell input:focus-visible,.IIa07q_shell select:focus-visible,.IIa07q_shell textarea:focus-visible,.IIa07q_shell summary:focus-visible,.IIa07q_shell [role=button]:focus-visible{outline:2px solid var(--mn-accent);outline-offset:2px}.IIa07q_masthead{border-bottom:1px solid var(--mn-line);background:var(--mn-surface);flex:none;grid-template-columns:minmax(220px,1fr) auto auto;align-items:center;gap:clamp(12px,2vw,24px);min-height:56px;padding:8px 16px;display:grid}.IIa07q_backButton{flex:none;align-items:center;gap:4px;min-width:max-content;display:inline-flex}.IIa07q_backButton>svg{flex:none}.IIa07q_brand{align-items:center;gap:11px;min-width:0;display:flex}.IIa07q_brand h1{letter-spacing:-.02em;margin:1px 0 0;font-size:16px;line-height:1.15}.IIa07q_storageMode{border:1px solid var(--mn-line-strong);min-height:32px;color:var(--mn-muted);background:var(--mn-layer-1);white-space:nowrap;border-radius:8px;flex:none;align-items:center;gap:6px;padding:0 9px;display:flex}.IIa07q_storageMode>span{font-size:10px}.IIa07q_storageMode>strong{color:var(--mn-text);font-size:11px;font-weight:600}.IIa07q_cardKicker,.IIa07q_sectionHeading>div>span{color:var(--mn-faint);font:650 9px/1.2 var(--mn-code);letter-spacing:.12em;text-transform:uppercase}.IIa07q_statusCluster{border:1px solid var(--mn-line-strong);min-height:34px;color:var(--mn-muted);background:var(--mn-layer-1);border-radius:9px;flex:none;align-items:center;gap:8px;padding:0 4px 0 11px;font-size:11px;display:flex}.IIa07q_statusDot{border-radius:50%;width:6px;height:6px}.IIa07q_online{background:var(--mn-success);box-shadow:0 0 0 3px color-mix(in srgb, var(--mn-success) 15%, transparent)}.IIa07q_offline{background:var(--mn-danger);box-shadow:0 0 0 3px color-mix(in srgb, var(--mn-danger) 14%, transparent)}.IIa07q_checking{background:var(--mn-faint);box-shadow:0 0 0 3px color-mix(in srgb, var(--mn-faint) 12%, transparent)}.IIa07q_iconButton{width:32px;height:32px;color:inherit;cursor:pointer;background:0 0;border:0;border-radius:7px;place-items:center;display:grid}.IIa07q_iconButton:hover{color:var(--mn-accent);background:var(--mn-hover)}.IIa07q_headerActions{justify-content:flex-end;align-items:center;gap:8px;min-width:0;display:flex}.IIa07q_workspacePicker{min-width:0;color:var(--mn-faint);align-items:center;gap:7px;font-size:10px;display:flex}.IIa07q_workspacePicker>span{white-space:nowrap}.IIa07q_workspacePicker select{border:1px solid var(--mn-line-strong);width:min(190px,22vw);min-width:112px;height:34px;color:var(--mn-text);background:var(--mn-input);cursor:pointer;border-radius:9px;outline:0;padding:0 28px 0 9px;font-size:11px}.IIa07q_workspacePicker select:hover{border-color:color-mix(in srgb, var(--mn-accent) 50%, var(--mn-line-strong))}.IIa07q_alert,.IIa07q_inlineError{border:1px solid color-mix(in srgb, var(--mn-danger) 32%, transparent);color:var(--mn-danger);background:color-mix(in srgb, var(--mn-danger) 7%, var(--mn-layer-1));border-radius:9px;padding:10px 13px;font-size:12px}.IIa07q_alert{flex-direction:column;flex:none;margin:10px clamp(18px,2.5vw,32px) 0;display:flex}.IIa07q_workspaceMismatch{border:1px solid color-mix(in srgb, var(--mn-accent) 36%, var(--mn-line));background:color-mix(in srgb, var(--mn-accent) 7%, var(--mn-layer-1));border-radius:10px;flex:none;justify-content:space-between;align-items:center;gap:18px;min-width:0;margin:10px clamp(18px,2.5vw,32px) 0;padding:11px 12px 11px 14px;display:flex}.IIa07q_workspaceMismatch>div{gap:2px;min-width:0;display:grid}.IIa07q_workspaceMismatch strong{font-size:12px}.IIa07q_workspaceMismatch span{color:var(--mn-muted);font-size:10px}.IIa07q_workspaceMismatch>div>div{flex-wrap:wrap;gap:5px 12px;min-width:0;margin-top:4px;display:flex}.IIa07q_workspaceMismatch code{color:var(--mn-faint);font:9px/1.4 var(--mn-code);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.IIa07q_workspaceMismatch>button{white-space:nowrap;flex:none;min-height:32px}.IIa07q_workspace{flex-direction:column;flex:1;min-height:0;display:flex}.IIa07q_topNavigation{border-bottom:1px solid var(--mn-line);background:var(--mn-layer-1);flex:none;justify-content:space-between;align-items:stretch;gap:14px;min-width:0;min-height:46px;padding:0 16px;display:flex}.IIa07q_nav{overscroll-behavior-inline:contain;scrollbar-width:none;align-items:stretch;gap:10px;min-width:0;display:flex;overflow-x:auto}.IIa07q_nav::-webkit-scrollbar{display:none}.IIa07q_nav button{min-width:max-content;min-height:44px;color:var(--mn-muted);text-align:left;cursor:pointer;background:0 0;border:0;align-items:center;gap:7px;padding:0 3px;display:flex;position:relative}.IIa07q_nav button:hover{color:var(--mn-text)}.IIa07q_nav button[data-layer-disabled]{color:var(--mn-faint)}.IIa07q_nav .IIa07q_layerDisabledBadge{border:1px solid var(--mn-line);color:var(--mn-faint);background:var(--mn-layer-2);font:500 8px/1.4 var(--mn-code);border-radius:999px;align-items:center;padding:1px 5px;font-style:normal;display:inline-flex}.IIa07q_nav button>span:last-child{min-width:0;display:block}.IIa07q_nav button strong{font-size:12px;font-weight:600}.IIa07q_nav button small{display:none}@media (width>=1000px){.IIa07q_nav button{min-height:50px}.IIa07q_nav button small{color:var(--mn-faint);margin-top:1px;font-size:9px;line-height:1.3;display:block}}.IIa07q_canvas{overscroll-behavior-x:contain;overscroll-behavior-y:auto;scroll-behavior:auto;-webkit-overflow-scrolling:touch;background:var(--mn-bg);flex:1;min-width:0;overflow:auto}.IIa07q_page{width:min(1320px,100%);min-height:100%;margin:0 auto;padding:clamp(16px,2vw,24px) clamp(16px,2.4vw,28px) clamp(96px,14vh,150px)}.IIa07q_pageHeader{justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:16px;display:flex}.IIa07q_pageHeader h2{letter-spacing:-.025em;margin:2px 0;font-size:20px;line-height:1.2}.IIa07q_pageHeader p{max-width:72ch;color:var(--mn-muted);margin:0;font-size:12px;line-height:1.65}.IIa07q_pageHeaderMeta{flex:none;align-items:center;gap:9px;display:flex}.IIa07q_pageHeaderMeta>code{border:1px solid var(--mn-line);color:var(--mn-faint);background:var(--mn-layer-1);font:600 9px/1 var(--mn-code);letter-spacing:.06em;border-radius:7px;padding:6px 8px}.IIa07q_pageSpinner{border:1px solid color-mix(in srgb, var(--mn-accent) 18%, var(--mn-line));width:24px;height:24px;color:var(--mn-accent);background:var(--mn-layer-1);border-radius:7px;flex:none;place-items:center;display:grid}.IIa07q_pageSpinner>i{border:1.5px solid color-mix(in srgb, currentColor 24%, transparent);border-top-color:currentColor;border-radius:50%;width:11px;height:11px;animation:.72s linear infinite IIa07q_mnemon-spin}.IIa07q_primaryButton,.IIa07q_secondaryButton,.IIa07q_ghostButton,.IIa07q_dangerButton,.IIa07q_dangerSolidButton{cursor:pointer;border-radius:8px;min-height:36px;padding:0 13px;font-size:12px;transition:border-color .14s,background-color .14s,color .14s,transform .14s}.IIa07q_primaryButton{border:1px solid var(--mn-accent);color:#fff;background:var(--mn-accent)}.IIa07q_secondaryButton{border:1px solid var(--mn-line-strong);color:var(--mn-text);background:var(--mn-layer-1)}.IIa07q_ghostButton,.IIa07q_dangerButton{background:0 0;border:1px solid #0000;min-height:32px;padding:0 9px}.IIa07q_ghostButton{color:var(--mn-muted)}.IIa07q_dangerButton{color:var(--mn-danger)}.IIa07q_dangerSolidButton{border:1px solid var(--mn-danger);color:#fff;background:var(--mn-danger);min-height:29px}.IIa07q_primaryButton:hover,.IIa07q_secondaryButton:hover,.IIa07q_ghostButton:hover,.IIa07q_dangerButton:hover{filter:brightness(.98);background-color:var(--mn-hover)}.IIa07q_primaryButton:hover{background-color:var(--mn-accent)}.IIa07q_shell button:disabled{cursor:not-allowed;opacity:.48}.IIa07q_emptyState{border:1px dashed var(--mn-line-strong);background:color-mix(in srgb, var(--mn-layer-1) 50%, transparent);border-radius:13px;justify-content:center;align-items:center;gap:22px;min-height:220px;padding:30px;display:flex}.IIa07q_emptyGlyph{border:1px solid color-mix(in srgb, var(--mn-accent) 35%, var(--mn-line));width:76px;height:76px;color:var(--mn-accent);background:radial-gradient(circle, color-mix(in srgb, var(--mn-accent) 12%, transparent), transparent 65%);font:500 26px/1 var(--mn-code);border-radius:50%;flex:none;place-items:center;display:grid}.IIa07q_emptyState h3{margin:0 0 5px;font-size:16px}.IIa07q_emptyState p{max-width:500px;color:var(--mn-muted);margin:0}.IIa07q_sourceManagementSummary{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:12px;grid-template-columns:minmax(220px,1.2fr) minmax(260px,1fr) minmax(220px,1fr);gap:14px;margin-top:13px;padding:15px;display:grid}.IIa07q_sourceManagementIdentity{grid-template-columns:9px minmax(0,1fr);align-items:center;gap:10px;min-width:0;display:grid}.IIa07q_sourceManagementIdentity>span{background:var(--mn-success);width:9px;height:9px;box-shadow:0 0 0 4px color-mix(in srgb, var(--mn-success) 12%, transparent);border-radius:50%}.IIa07q_sourceManagementSummary[data-availability=degraded] .IIa07q_sourceManagementIdentity>span{background:var(--mn-priority);box-shadow:0 0 0 4px color-mix(in srgb, var(--mn-priority) 12%, transparent)}.IIa07q_sourceManagementSummary[data-availability=unavailable] .IIa07q_sourceManagementIdentity>span{background:var(--mn-danger);box-shadow:0 0 0 4px color-mix(in srgb, var(--mn-danger) 12%, transparent)}.IIa07q_sourceManagementIdentity>div{gap:2px;min-width:0;display:grid}.IIa07q_sourceManagementIdentity small,.IIa07q_sourceManagementCapabilities>small{color:var(--mn-faint);font-size:9px}.IIa07q_sourceManagementIdentity strong{text-overflow:ellipsis;white-space:nowrap;font-size:12px;overflow:hidden}.IIa07q_sourceManagementIdentity code{color:var(--mn-muted);font:9px var(--mn-code);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.IIa07q_sourceManagementSummary dl{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0;display:grid}.IIa07q_sourceManagementSummary dl>div{background:var(--mn-layer-2);border-radius:8px;align-content:center;gap:3px;min-width:0;padding:8px;display:grid}.IIa07q_sourceManagementSummary dt{color:var(--mn-faint);font-size:8px}.IIa07q_sourceManagementSummary dd{text-overflow:ellipsis;white-space:nowrap;margin:0;font-size:10px;overflow:hidden}.IIa07q_sourceManagementSummary dd code{font:9px var(--mn-code)}.IIa07q_sourceManagementCapabilities{align-content:center;gap:6px;min-width:0;display:grid}.IIa07q_sourceManagementCapabilities>div{flex-wrap:wrap;gap:4px;display:flex}.IIa07q_sourceManagementCapabilities span{color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 9%, var(--mn-layer-2));font:650 8px var(--mn-code);border-radius:999px;padding:3px 6px}.IIa07q_sourceManagementDiagnostics,.IIa07q_sourceManagementForm{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:12px;margin-top:13px;padding:15px}.IIa07q_sourceManagementDiagnostics h3,.IIa07q_sourceManagementForm h3{margin:0;font-size:13px}.IIa07q_sourceManagementDiagnostics ul{color:var(--mn-muted);gap:5px;margin:10px 0 0;padding-left:18px;font-size:10px;line-height:1.5;display:grid}.IIa07q_sourceManagementForm>div:first-child p{color:var(--mn-muted);margin:3px 0 0;font-size:10px}.IIa07q_sourceManagementForm .IIa07q_formGrid label>small{color:var(--mn-faint);font-size:9px;line-height:1.45}.IIa07q_sourceManagementForm .IIa07q_formGrid input[type=checkbox]{width:16px;min-width:0;height:16px;accent-color:var(--mn-accent)}.IIa07q_loadingPanel{border:1px solid var(--mn-line);min-height:220px;color:var(--mn-muted);background:var(--mn-layer-1);border-radius:13px;place-items:center;display:grid}.IIa07q_sectionSpinner{z-index:6;border:1px solid color-mix(in srgb, var(--mn-accent) 18%, var(--mn-line));width:24px;height:24px;color:var(--mn-accent);background:color-mix(in srgb, var(--mn-layer-1) 90%, transparent);box-shadow:0 4px 12px color-mix(in srgb, var(--mn-text) 6%, transparent);backdrop-filter:blur(7px);border-radius:7px;place-items:center;display:grid;position:absolute;top:9px;right:9px}.IIa07q_sectionSpinner>i{border:1.5px solid color-mix(in srgb, currentColor 24%, transparent);border-top-color:currentColor;border-radius:50%;width:11px;height:11px;animation:.72s linear infinite IIa07q_mnemon-spin}@keyframes IIa07q_mnemon-spin{to{transform:rotate(360deg)}}.IIa07q_inlineError{margin:0 0 14px}.IIa07q_loading{color:var(--mn-faint);padding:16px 0;font-size:12px}.IIa07q_bodyEdit{gap:9px;padding-top:2px;display:grid}.IIa07q_bodyEdit label{color:var(--mn-faint);gap:4px;font-size:9px;display:grid}.IIa07q_bodyEdit input,.IIa07q_bodyEdit select,.IIa07q_bodyEdit textarea{border:1px solid var(--mn-line);width:100%;color:var(--mn-text);background:var(--mn-input);border-radius:8px;outline:0;padding:7px 9px;font-size:12px;line-height:1.5}.IIa07q_bodyEdit textarea{resize:vertical}.IIa07q_bodyEdit input:focus,.IIa07q_bodyEdit select:focus,.IIa07q_bodyEdit textarea:focus{border-color:var(--mn-accent)}.IIa07q_providerFieldControl{gap:4px;min-width:0;display:grid}.IIa07q_providerFieldControl input[type=checkbox]{width:14px;height:14px;accent-color:var(--mn-accent);margin:2px 0;padding:0}.IIa07q_bodyDeleteConfirm{gap:16px;display:grid}.IIa07q_bodyDeleteConfirm>p{color:var(--mn-muted);margin:0;font-size:12px;line-height:1.6}.IIa07q_bodyDeleteSummary{border:1px solid color-mix(in srgb, var(--mn-danger) 22%, var(--mn-line));background:color-mix(in srgb, var(--mn-danger) 5%, var(--mn-layer-1));border-radius:8px;gap:3px;padding:12px;display:grid}.IIa07q_bodyDeleteSummary strong{font-size:13px}.IIa07q_bodyDeleteContent{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:13px;font-weight:400;line-height:1.55}.IIa07q_bodyDeleteSummary span{color:var(--mn-muted);font-size:11px}.IIa07q_sectionHeading button{width:32px;height:32px;color:var(--mn-muted);cursor:pointer;background:0 0;border:0;border-radius:7px;place-items:center;display:grid}.IIa07q_sectionHeading button:hover{background:var(--mn-hover)}.IIa07q_formGrid label{color:var(--mn-muted);gap:5px;font-size:11px;display:grid}.IIa07q_formGrid select,.IIa07q_formGrid input{border:1px solid var(--mn-line);background:var(--mn-input);border-radius:8px;outline:0;min-width:140px;height:34px;padding:0 9px}.IIa07q_formGrid select:focus,.IIa07q_formGrid input:focus{border-color:var(--mn-accent)}.IIa07q_sectionHeading{justify-content:space-between;align-items:center;gap:16px;min-height:39px;margin-bottom:8px;display:flex}.IIa07q_sectionHeading h3{margin:2px 0 0;font-size:15px}.IIa07q_sectionHeading>strong{min-width:27px;height:27px;color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 9%, transparent);font:650 11px var(--mn-code);border-radius:7px;place-items:center;display:grid}.IIa07q_runtimeNotice{border:1px solid color-mix(in srgb, var(--mn-success) 28%, var(--mn-line));color:var(--mn-success);background:color-mix(in srgb, var(--mn-success) 6%, var(--mn-layer-1));border-radius:9px;margin-bottom:13px;padding:9px 12px;font-size:11px}.IIa07q_runtimeFootnote{color:var(--mn-faint);margin:10px 2px 0;font-size:9px}.IIa07q_formGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:13px;display:grid}.IIa07q_formGrid select,.IIa07q_formGrid input{width:100%;min-width:0}.IIa07q_listProgress{border-top:1px solid var(--mn-line);min-height:58px;color:var(--mn-faint);justify-content:center;align-items:center;gap:13px;margin-top:12px;padding:10px;font-size:10px;display:flex}.IIa07q_compactListProgress{border-top:1px solid var(--mn-line);color:var(--mn-faint);text-align:center;justify-items:stretch;gap:7px;margin-top:8px;padding:10px 2px 2px;font-size:10px;display:grid}.IIa07q_compactListProgress button{width:100%}.IIa07q_modalPortal{z-index:2147483647;isolation:isolate;pointer-events:none;position:fixed;inset:0}.IIa07q_modalTheme.IIa07q_modalTheme.IIa07q_modalTheme{width:auto;min-width:0;height:auto;min-height:0;color:var(--mn-text);pointer-events:none;background:0 0;display:block;position:absolute;inset:0;overflow:visible}.IIa07q_modalBackdrop{z-index:0;overscroll-behavior:contain;touch-action:none;pointer-events:auto;background:#0206178a;justify-content:center;align-items:center;padding:24px;animation:.18s ease-out both IIa07q_mnemon-dialog-backdrop-enter;display:flex;position:fixed;inset:0;overflow:hidden}.IIa07q_modal{box-sizing:border-box;border:1px solid var(--mn-line);background:linear-gradient(var(--mn-layer-2), var(--mn-layer-2)), var(--mn-surface);touch-action:auto;transform-origin:50% 100%;backface-visibility:hidden;will-change:transform, opacity;border-radius:14px;flex-direction:column;width:min(680px,100vw - 48px);min-height:0;max-height:calc(100vh - 48px);animation:.22s cubic-bezier(.2,.75,.2,1) both IIa07q_mnemon-dialog-enter;display:flex;overflow:hidden;box-shadow:0 22px 60px #02061738}.IIa07q_modalBackdrop[data-closing],.IIa07q_modal[data-closing]{pointer-events:none}.IIa07q_modalDragHandle{display:none}.IIa07q_modalWide{width:min(780px,100vw - 48px)}.IIa07q_modal>header{border-bottom:1px solid var(--mn-line);flex:none;justify-content:space-between;align-items:flex-start;gap:18px;padding:15px 18px;display:flex}.IIa07q_modal>header>div{min-width:0}.IIa07q_modal>header h2{margin:0;font-size:15px;line-height:22px}.IIa07q_modal>header p{overflow-wrap:anywhere;max-width:64ch;color:var(--mn-muted);margin:3px 0 0;font-size:12px;line-height:1.5}.IIa07q_modal>header .IIa07q_iconButton{flex:none}.IIa07q_modalBody{overscroll-behavior:contain;scrollbar-gutter:stable;touch-action:pan-y;-webkit-overflow-scrolling:touch;min-height:0;padding:18px;overflow:hidden auto}.IIa07q_modalFooter{border-top:1px solid var(--mn-line);background:0 0;flex:none;justify-content:flex-end;align-items:center;gap:14px;padding:12px 18px;display:flex}.IIa07q_modalFooterMeta{color:var(--mn-faint);margin-right:auto;font-size:9px}.IIa07q_modalFooterActions{justify-content:flex-end;align-items:center;gap:8px;min-width:0;margin-left:auto;display:flex}@supports (height:100dvh){.IIa07q_modal{max-height:calc(100dvh - 48px)}}@keyframes IIa07q_mnemon-dialog-backdrop-enter{0%{opacity:0}}@keyframes IIa07q_mnemon-dialog-enter{0%{opacity:0;transform:translateY(10px)scale(.985)}}@keyframes IIa07q_mnemon-sheet-enter{0%{transform:translateY(calc(100% + 32px))}to{transform:translate3d(0, var(--mn-modal-drag-y,0px), 0)}}@keyframes IIa07q_mnemon-metadata-sweep{to{transform:translate(120%)}}@keyframes IIa07q_mnemon-metadata-refreshed{0%{border-color:color-mix(in srgb, var(--mn-provider-color) 72%, var(--mn-line));box-shadow:inset 3px 0 0 var(--mn-provider-color), 0 0 0 3px color-mix(in srgb, var(--mn-provider-color) 14%, transparent)}to{border-color:var(--mn-line);box-shadow:inset 3px 0 0 color-mix(in srgb, var(--mn-provider-color) 68%, transparent)}}.IIa07q_healthStrip{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:12px;grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:13px;display:grid;position:relative;overflow:hidden}.IIa07q_asyncStatusBlock{min-width:0;min-height:36px;position:relative}.IIa07q_healthStrip article{box-sizing:border-box;border-right:1px solid var(--mn-line);align-items:flex-start;gap:10px;min-width:0;min-height:78px;padding:14px 15px;display:flex}.IIa07q_healthStrip article>div{min-width:0}.IIa07q_healthStrip article:last-child{border-right:0}.IIa07q_healthStrip small{color:var(--mn-faint);font:650 10px var(--mn-code);letter-spacing:.06em;margin-bottom:4px;display:block}.IIa07q_healthStrip strong{text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;display:block;overflow:hidden}.IIa07q_healthStrip p{color:var(--mn-muted);text-overflow:ellipsis;white-space:nowrap;margin:3px 0 0;font-size:10.5px;overflow:hidden}.IIa07q_healthIndicator{width:7px;height:7px;box-shadow:0 0 0 4px color-mix(in srgb, currentColor 9%, transparent);border-radius:50%;flex:none;margin-top:3px}.IIa07q_healthGood{color:var(--mn-success);background:currentColor}.IIa07q_healthBad{color:var(--mn-danger);background:currentColor}.IIa07q_healthMuted{color:var(--mn-faint);background:currentColor}.IIa07q_nativeProviderHealth{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px;align-items:center;gap:10px;min-width:0;min-height:62px;margin-bottom:9px;padding:10px 12px;display:flex}.IIa07q_nativeProviderHealth[data-status=healthy]{border-color:color-mix(in srgb, var(--mn-success) 22%, var(--mn-line))}.IIa07q_nativeProviderHealth[data-status=unhealthy]{border-color:color-mix(in srgb, var(--mn-danger) 30%, var(--mn-line));background:color-mix(in srgb, var(--mn-danger) 3%, var(--mn-layer-1))}.IIa07q_nativeProviderCopy{flex:1;gap:1px;min-width:0;display:grid}.IIa07q_nativeProviderCopy>small{color:var(--mn-faint);font:650 8px var(--mn-code);letter-spacing:.06em;text-transform:uppercase}.IIa07q_nativeProviderCopy>strong{font-size:11.5px}.IIa07q_nativeProviderCopy>p{color:var(--mn-danger);text-overflow:ellipsis;white-space:nowrap;margin:2px 0 0;font-size:8.5px;overflow:hidden}.IIa07q_nativeProviderMeta{text-align:right;flex:none;justify-items:end;gap:3px;display:grid}.IIa07q_nativeProviderMeta>span{color:var(--mn-muted);align-items:center;gap:6px;font-size:9px;display:flex}.IIa07q_nativeProviderMeta>span i{width:6px;height:6px;color:var(--mn-faint);box-shadow:0 0 0 3px color-mix(in srgb, currentColor 8%, transparent);background:currentColor;border-radius:50%}.IIa07q_nativeProviderHealth[data-status=healthy] .IIa07q_nativeProviderMeta>span i{color:var(--mn-success)}.IIa07q_nativeProviderHealth[data-status=idle] .IIa07q_nativeProviderMeta>span i{color:var(--mn-accent)}.IIa07q_nativeProviderHealth[data-status=unhealthy] .IIa07q_nativeProviderMeta>span,.IIa07q_nativeProviderHealth[data-status=unhealthy] .IIa07q_nativeProviderMeta>span i{color:var(--mn-danger)}.IIa07q_nativeProviderMeta>small{color:var(--mn-faint);font:9px var(--mn-code)}.IIa07q_providerHealth{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:12px;margin-bottom:13px;padding:16px}.IIa07q_providerHealthList{border-top:1px solid var(--mn-line);border-bottom:1px solid var(--mn-line);margin-top:12px}.IIa07q_providerHealthList article{align-items:center;gap:10px;min-width:0;min-height:58px;padding:9px 2px;display:flex}.IIa07q_providerHealthList article+article{border-top:1px solid var(--mn-line)}.IIa07q_providerHealthMark{box-sizing:border-box;border:1px solid var(--mn-line);background:var(--mn-layer-2);border-radius:8px;flex:none;place-items:center;width:30px;height:30px;padding:3px;display:grid;overflow:hidden}.IIa07q_providerHealthMark>img,.IIa07q_providerHealthMark>svg{object-fit:contain;border-radius:5px;width:100%;height:100%;display:block}.IIa07q_providerHealthCopy{flex:1;gap:1px;min-width:0;display:grid}.IIa07q_providerHealthCopy strong{text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;overflow:hidden}.IIa07q_providerHealthCopy small{color:var(--mn-faint);font-size:9px}.IIa07q_providerHealthCopy p{color:var(--mn-danger);text-overflow:ellipsis;white-space:nowrap;margin:2px 0 0;font-size:8.5px;overflow:hidden}.IIa07q_providerHealthMeta{flex:none;align-items:center;gap:7px;display:flex}.IIa07q_providerHealthMeta small{color:var(--mn-faint);font:9px var(--mn-code)}.IIa07q_providerHealthSignal{width:6px;height:6px;color:var(--mn-faint);box-shadow:0 0 0 3px color-mix(in srgb, currentColor 8%, transparent);background:currentColor;border-radius:50%}.IIa07q_providerHealthList article[data-status=healthy] .IIa07q_providerHealthSignal{color:var(--mn-success)}.IIa07q_providerHealthList article[data-status=unhealthy] .IIa07q_providerHealthSignal{color:var(--mn-danger)}.IIa07q_providerHealthList article[data-status=idle] .IIa07q_providerHealthSignal{color:var(--mn-accent)}.IIa07q_storageDomains{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:12px;margin-bottom:13px;padding:16px}.IIa07q_storageRoot{border:1px solid var(--mn-line);background:color-mix(in srgb, var(--mn-layer-2) 45%, transparent);border-radius:9px;justify-content:space-between;align-items:center;gap:18px;min-width:0;margin-top:12px;padding:11px 12px;display:flex}.IIa07q_storageRoot>div:first-child{gap:4px;min-width:0;display:grid}.IIa07q_storageRoot span,.IIa07q_storageRoot small{color:var(--mn-faint);font-size:9px}.IIa07q_storageRoot code{color:var(--mn-muted);text-overflow:ellipsis;white-space:nowrap;font-size:10px;overflow:hidden}.IIa07q_storageRoot>div:last-child{flex:none;justify-items:end;gap:3px;display:grid}.IIa07q_storageRoot strong{font:650 11px var(--mn-code)}.IIa07q_storageAreaGrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px;display:grid}.IIa07q_storageAreaGrid article{box-sizing:border-box;border:1px solid var(--mn-line);background:color-mix(in srgb, var(--mn-layer-2) 30%, var(--mn-layer-1));border-radius:9px;flex-direction:column;min-width:0;min-height:150px;padding:12px;display:flex}.IIa07q_storageAreaGrid article>header{justify-content:space-between;align-items:center;gap:8px;display:flex}.IIa07q_storageAreaGrid article>header>div{align-items:center;gap:7px;min-width:0;display:flex}.IIa07q_storageAreaGrid article>header span{background:var(--mn-faint);border-radius:50%;flex:none;width:6px;height:6px}.IIa07q_storageAreaGrid article[data-status=ready]>header span{background:var(--mn-success);box-shadow:0 0 0 3px color-mix(in srgb, var(--mn-success) 9%, transparent)}.IIa07q_storageAreaGrid article[data-status=invalid]>header span{background:var(--mn-danger);box-shadow:0 0 0 3px color-mix(in srgb, var(--mn-danger) 9%, transparent)}.IIa07q_storageAreaGrid article>header strong{text-overflow:ellipsis;white-space:nowrap;font-size:10px;overflow:hidden}.IIa07q_storageAreaGrid article>header em{color:var(--mn-faint);font:normal 8px var(--mn-code);white-space:nowrap}.IIa07q_storageAreaMetric{align-items:baseline;gap:5px;margin-top:14px;display:flex}.IIa07q_storageAreaMetric strong{font:650 20px var(--mn-code)}.IIa07q_storageAreaMetric span{color:var(--mn-faint);font-size:9px}.IIa07q_storageAreaMetric code{color:var(--mn-muted);margin-left:auto;font-size:9px}.IIa07q_storageAreaGrid article>p{min-height:28px;color:var(--mn-muted);margin:8px 0;font-size:9px;line-height:1.5}.IIa07q_storagePath{border-top:1px solid var(--mn-line);color:var(--mn-faint);text-overflow:ellipsis;white-space:nowrap;margin-top:auto;padding-top:8px;font-size:8px;display:block;overflow:hidden}.IIa07q_storageAreaGrid article>small{color:var(--mn-danger);margin-top:6px;font-size:8px;line-height:1.4;display:block}.IIa07q_storageUnavailable{border:1px dashed var(--mn-line);min-height:126px;color:var(--mn-muted);text-align:center;border-radius:9px;place-content:center;gap:5px;margin-top:12px;display:grid}.IIa07q_storageUnavailable strong{font-size:12px}.IIa07q_storageUnavailable p{max-width:520px;color:var(--mn-faint);margin:0;font-size:10px}.IIa07q_storageFootnote{color:var(--mn-faint);margin:11px 0 0;font-size:9px;line-height:1.5}.IIa07q_statusSectionHeader{justify-content:space-between;align-items:flex-start;gap:12px;display:flex}.IIa07q_statusSectionHeader h3{margin:4px 0 0;font-size:15px}.IIa07q_statusSectionHeader p{max-width:590px;color:var(--mn-muted);margin:5px 0 0;font-size:10px}.IIa07q_phaseBadge{border:1px solid color-mix(in srgb, var(--mn-accent) 25%, var(--mn-line));color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 7%, transparent);font:650 9px var(--mn-code);border-radius:999px;padding:4px 8px}.IIa07q_statusHeaderActions{align-items:center;gap:8px;display:flex}.IIa07q_versionDialogBody{gap:12px;display:grid}.IIa07q_versionChecking{min-height:112px;color:var(--mn-muted);justify-content:center;align-items:center;gap:10px;font-size:12px;display:flex}.IIa07q_versionChecking span{border:2px solid var(--mn-line);border-top-color:var(--mn-accent);border-radius:50%;width:14px;height:14px;animation:.8s linear infinite IIa07q_mnemon-spin}.IIa07q_versionError,.IIa07q_versionResult{border:1px solid color-mix(in srgb, var(--mn-danger) 28%, var(--mn-line));color:var(--mn-danger);background:color-mix(in srgb, var(--mn-danger) 6%, transparent);border-radius:9px;padding:11px 12px}.IIa07q_versionResult{border-color:color-mix(in srgb, var(--mn-success) 28%, var(--mn-line));color:var(--mn-success);background:color-mix(in srgb, var(--mn-success) 6%, transparent)}.IIa07q_versionError strong,.IIa07q_versionResult strong{font-size:12px}.IIa07q_versionError p,.IIa07q_versionResult p{color:var(--mn-muted);margin:3px 0 0;font-size:11px;line-height:1.5}.IIa07q_versionList{gap:9px;display:grid}.IIa07q_versionList article{border:1px solid var(--mn-line);background:color-mix(in srgb, var(--mn-layer-2) 34%, var(--mn-layer-1));border-radius:10px;padding:13px}.IIa07q_versionList article[data-outdated]{border-color:color-mix(in srgb, var(--mn-accent) 30%, var(--mn-line))}.IIa07q_versionList article>header{justify-content:space-between;align-items:center;gap:12px;display:flex}.IIa07q_versionList article>header>div{align-items:center;gap:8px;min-width:0;display:flex}.IIa07q_versionList article>header strong{font-size:13px}.IIa07q_versionList article>header span{border:1px solid var(--mn-line);color:var(--mn-muted);font:500 9px var(--mn-code);border-radius:999px;padding:3px 7px}.IIa07q_versionList article>header em{color:var(--mn-success);font:normal 10px var(--mn-code);white-space:nowrap}.IIa07q_versionList article[data-outdated]>header em{color:var(--mn-accent)}.IIa07q_versionNumbers{grid-template-columns:1fr auto 1fr;align-items:end;gap:10px;margin-top:10px;display:grid}.IIa07q_versionNumbers>div{gap:3px;display:grid}.IIa07q_versionNumbers small{color:var(--mn-faint);font-size:9px}.IIa07q_versionNumbers code{font-size:12px}.IIa07q_versionNumbers>span{color:var(--mn-faint);padding-bottom:1px}.IIa07q_versionLocation{min-width:0;color:var(--mn-faint);gap:6px;margin-top:9px;font-size:9px;display:flex}.IIa07q_versionLocation>span{flex:none}.IIa07q_versionLocation>code{min-width:0;color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:inherit;overflow:hidden}.IIa07q_versionList article>footer{border-top:1px solid var(--mn-line);justify-content:space-between;align-items:flex-end;gap:16px;margin-top:8px;padding-top:8px;display:flex}.IIa07q_versionList article>footer p{max-width:470px;color:var(--mn-muted);margin:0;font-size:10.5px;line-height:1.5}.IIa07q_versionList article>footer button{flex:none}.IIa07q_versionList article>header em[data-state=unknown],.IIa07q_versionList article>header em[data-state=local]{color:var(--mn-muted)}.IIa07q_versionList article>header em[data-state=missing],.IIa07q_versionList article>header em[data-state=restart]{color:var(--mn-accent)}.IIa07q_versionNotice{color:var(--mn-muted);margin:10px 0 0;font-size:11px;line-height:1.6}.IIa07q_versionGuidance{background:color-mix(in srgb, var(--mn-accent) 5%, var(--mn-layer-1));border-radius:8px;gap:6px;min-width:0;margin-top:10px;padding:10px;display:grid}.IIa07q_versionGuidance>strong{font-size:12px}.IIa07q_versionGuidance>p{color:var(--mn-muted);margin:0;font-size:11px;line-height:1.6}.IIa07q_versionGuidance>a{color:var(--mn-accent);justify-self:start;font-size:11px}.IIa07q_versionGuidanceDetails{min-width:0;color:var(--mn-muted);font-size:11px;line-height:1.6}.IIa07q_versionGuidanceDetails>summary{cursor:pointer}.IIa07q_versionGuidanceDetails>p{margin:8px 0}.IIa07q_versionGuidanceDetails>a{color:var(--mn-accent)}.IIa07q_versionCommand{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:6px;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;padding:8px;display:flex}.IIa07q_versionCommand>code{overflow-wrap:anywhere;white-space:pre-wrap;user-select:text;flex:1;min-width:0;font-size:11px}.IIa07q_versionCommand>button{flex:none}.IIa07q_versionCommand>small{color:var(--mn-muted);flex-basis:100%}.IIa07q_versionPackages{border-top:1px solid var(--mn-line);min-width:0;margin-top:14px}.IIa07q_versionPackagesToggle{width:100%;min-height:44px;color:var(--mn-text);text-align:start;cursor:pointer;background:0 0;border:0;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 0 0;display:flex}.IIa07q_versionPackagesToggle>strong{font-size:12px}.IIa07q_versionPackagesToggle>small{color:var(--mn-muted);margin-left:auto;font-size:10px}.IIa07q_versionPackages h4{color:var(--mn-muted);margin:16px 0 8px;font-size:11px;font-weight:600}.IIa07q_versionPackages ul{gap:8px;margin:0;padding:0;list-style:none;display:grid}.IIa07q_versionPackage{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:8px;min-width:0;padding:11px}.IIa07q_versionPackageHeader{flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:6px 12px;display:flex}.IIa07q_versionPackageHeader strong{overflow-wrap:anywhere;min-width:0;font:500 11px var(--mn-code)}.IIa07q_versionPackageHeader em{color:var(--mn-muted);font-size:10px;font-style:normal}.IIa07q_versionPackageHeader em[data-state=available],.IIa07q_versionPackageHeader em[data-state=restart]{color:var(--mn-accent)}.IIa07q_versionPackageHeader em[data-state=current]{color:var(--mn-success)}.IIa07q_versionPackageMeta,.IIa07q_versionPackageNumbers{color:var(--mn-muted);flex-wrap:wrap;gap:6px 14px;margin-top:8px;font-size:10px;display:flex}.IIa07q_versionPackageNumbers code{color:var(--mn-text)}.IIa07q_versionPackageAction{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;display:flex}.IIa07q_versionPackageAction p{min-width:150px;color:var(--mn-muted);flex:1;margin:0;font-size:10.5px;line-height:1.6}.IIa07q_versionPackageAction button{flex:none}@media (width<=1000px){.IIa07q_sourceManagementSummary{grid-template-columns:1fr 1fr}.IIa07q_sourceManagementCapabilities{grid-column:1/-1}.IIa07q_storageAreaGrid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (width<=760px){.IIa07q_sourceManagementSummary{grid-template-columns:1fr}.IIa07q_sourceManagementSummary dl,.IIa07q_sourceManagementCapabilities{grid-column:auto}.IIa07q_shell{min-height:0;overflow:hidden}.IIa07q_masthead{grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;min-height:76px;padding:10px 14px}.IIa07q_headerActions{max-width:52vw}.IIa07q_workspacePicker>span{display:none}.IIa07q_workspacePicker select{width:min(170px,32vw)}.IIa07q_statusCluster>span:not(.IIa07q_statusDot){display:none}.IIa07q_modalBackdrop{padding:max(10px, env(safe-area-inset-top,0px)) 0 0;align-items:flex-end}.IIa07q_modal,.IIa07q_modalWide{width:100vw;max-height:calc(100vh - max(10px, env(safe-area-inset-top,0px)));transform:translate3d(0, var(--mn-modal-drag-y,0px), 0);border-bottom:0;border-radius:18px 18px 0 0;animation-name:IIa07q_mnemon-sheet-enter;animation-duration:.34s;animation-timing-function:cubic-bezier(.2,.82,.2,1)}.IIa07q_modalDragHandle{cursor:grab;touch-action:none;user-select:none;flex:none;place-items:center;width:100%;height:28px;display:grid}.IIa07q_modalDragHandle span{background:var(--mn-line-strong);border-radius:999px;width:36px;height:4px;transition:width .14s,background-color .14s}.IIa07q_modal[data-dragging] .IIa07q_modalDragHandle{cursor:grabbing}.IIa07q_modal[data-dragging] .IIa07q_modalDragHandle span{background:color-mix(in srgb, var(--mn-accent) 52%, var(--mn-line-strong));width:44px}.IIa07q_modal>header{padding:10px max(14px, env(safe-area-inset-right,0px)) 12px max(14px, env(safe-area-inset-left,0px));gap:12px}.IIa07q_modal>header p{-webkit-line-clamp:2;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}.IIa07q_modal>header .IIa07q_iconButton{width:44px;height:44px;margin:-4px -5px -4px 0}.IIa07q_modalBody{padding:14px max(14px, env(safe-area-inset-right,0px)) 18px max(14px, env(safe-area-inset-left,0px));scrollbar-gutter:auto;scroll-padding-bottom:12px}.IIa07q_modalBody button{min-height:44px}.IIa07q_modalFooter{padding:10px max(14px, env(safe-area-inset-right,0px)) calc(10px + env(safe-area-inset-bottom,0px)) max(14px, env(safe-area-inset-left,0px));flex-direction:column;align-items:stretch;gap:8px}.IIa07q_modalFooterMeta{max-width:none;margin:0;font-size:10px}.IIa07q_modalFooterActions{grid-template-columns:minmax(82px,.55fr) minmax(0,1.45fr);gap:8px;width:100%;margin:0;display:grid}.IIa07q_modalFooterActions button{white-space:normal;min-width:0;min-height:44px;padding-block:8px}.IIa07q_versionList article>footer{flex-direction:column;align-items:stretch}.IIa07q_topNavigation{padding:0 10px;position:relative}.IIa07q_topNavigation:after{z-index:2;pointer-events:none;content:\"›\";width:34px;color:var(--mn-faint);background:linear-gradient(90deg, transparent, var(--mn-layer-1) 72%);font:16px var(--mn-code);place-items:center end;padding-right:5px;display:grid;position:absolute;top:0;bottom:0;right:0}.IIa07q_nav{flex:1;padding-right:26px;scroll-padding-inline:10px 34px}.IIa07q_nav button{text-align:center;flex-direction:column;justify-content:center;gap:3px;min-width:60px;padding:4px 3px}.IIa07q_page{padding:18px 13px calc(170px + env(safe-area-inset-bottom,0px))}.IIa07q_pageHeader{gap:10px;display:grid}.IIa07q_pageHeaderMeta{justify-content:space-between}.IIa07q_healthStrip{grid-template-columns:1fr}.IIa07q_nativeProviderHealth{align-items:flex-start}.IIa07q_nativeProviderMeta{justify-items:end}.IIa07q_providerHealthMeta{flex-direction:column;align-items:flex-end;gap:4px}.IIa07q_storageRoot{flex-direction:column;align-items:flex-start}.IIa07q_storageRoot>div:last-child{justify-items:start}.IIa07q_storageAreaGrid{grid-template-columns:1fr}.IIa07q_flowLegend span:last-child{width:100%;margin-left:0}.IIa07q_healthStrip article{border-right:0;border-bottom:1px solid var(--mn-line)}.IIa07q_healthStrip article:last-child{border-bottom:0}.IIa07q_workspaceMismatch{flex-direction:column;align-items:stretch;margin-inline:13px}.IIa07q_workspaceMismatch>button{align-self:flex-start}}@media (width<=520px){.IIa07q_masthead{min-height:68px}.IIa07q_brand h1{font-size:16px}.IIa07q_headerActions{max-width:58vw}.IIa07q_workspacePicker select{width:min(150px,39vw)}.IIa07q_nav{scroll-snap-type:x proximity}.IIa07q_nav button{scroll-snap-align:start;min-width:68px}.IIa07q_pageHeader h2{font-size:19px}.IIa07q_pageHeaderMeta{flex-wrap:wrap;align-items:stretch}.IIa07q_pageHeaderMeta>code{align-items:center;min-height:34px;display:flex}.IIa07q_pageHeaderMeta>button{flex:1}.IIa07q_emptyState{text-align:center;flex-direction:column;gap:14px;min-height:190px;padding:24px 18px}.IIa07q_emptyGlyph{width:62px;height:62px}.IIa07q_formGrid{grid-template-columns:1fr}}@media (width<=360px){.IIa07q_modalFooterActions{grid-template-columns:1fr}}@media (height<=420px){.IIa07q_modal>header p{white-space:nowrap;text-overflow:ellipsis;display:block;overflow:hidden}}@media (width>=761px) and (height<=560px){.IIa07q_modalBackdrop{padding:8px}.IIa07q_modal{max-height:calc(100vh - 16px)}}@supports (height:100dvh){@media (width<=760px){.IIa07q_modal,.IIa07q_modalWide{max-height:calc(100dvh - max(10px, env(safe-area-inset-top,0px)))}}@media (width>=761px) and (height<=560px){.IIa07q_modal{max-height:calc(100dvh - 16px)}}}@media (width<=1000px) and (height<=760px){.IIa07q_shell{min-height:0}.IIa07q_masthead{min-height:58px}.IIa07q_topNavigation{min-height:44px}.IIa07q_nav button{min-height:42px}}@media (width<=760px) and (pointer:coarse){.IIa07q_shell input,.IIa07q_shell select,.IIa07q_shell textarea{font-size:16px!important}}@media (pointer:coarse){.IIa07q_modal>header .IIa07q_iconButton{width:44px;min-width:44px;height:44px;min-height:44px}.IIa07q_modalBody button,.IIa07q_modalFooter button{min-height:44px}}@media (prefers-reduced-motion:reduce){.IIa07q_shell *,.IIa07q_shell :before,.IIa07q_shell :after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}.IIa07q_modalBackdrop,.IIa07q_modal{animation:none!important}.IIa07q_flowConnector[data-active] i:before{display:none}}";
		const tagId$8 = "dsh-mnemon/src/client/MnemonView.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$8) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = tagId$8;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css$8) tag.textContent = css$8;
		}
		var MnemonView_module_css_default = {
			"alert": "IIa07q_alert",
			"asyncStatusBlock": "IIa07q_asyncStatusBlock",
			"backButton": "IIa07q_backButton",
			"bodyDeleteConfirm": "IIa07q_bodyDeleteConfirm",
			"bodyDeleteContent": "IIa07q_bodyDeleteContent",
			"bodyDeleteSummary": "IIa07q_bodyDeleteSummary",
			"bodyEdit": "IIa07q_bodyEdit",
			"brand": "IIa07q_brand",
			"canvas": "IIa07q_canvas",
			"cardKicker": "IIa07q_cardKicker",
			"checking": "IIa07q_checking",
			"compactListProgress": "IIa07q_compactListProgress",
			"dangerButton": "IIa07q_dangerButton",
			"dangerSolidButton": "IIa07q_dangerSolidButton",
			"emptyGlyph": "IIa07q_emptyGlyph",
			"emptyState": "IIa07q_emptyState",
			"flowConnector": "IIa07q_flowConnector",
			"flowLegend": "IIa07q_flowLegend",
			"formGrid": "IIa07q_formGrid",
			"ghostButton": "IIa07q_ghostButton",
			"headerActions": "IIa07q_headerActions",
			"healthBad": "IIa07q_healthBad",
			"healthGood": "IIa07q_healthGood",
			"healthIndicator": "IIa07q_healthIndicator",
			"healthMuted": "IIa07q_healthMuted",
			"healthStrip": "IIa07q_healthStrip",
			"iconButton": "IIa07q_iconButton",
			"inlineError": "IIa07q_inlineError",
			"layerDisabledBadge": "IIa07q_layerDisabledBadge",
			"listProgress": "IIa07q_listProgress",
			"loading": "IIa07q_loading",
			"loadingPanel": "IIa07q_loadingPanel",
			"masthead": "IIa07q_masthead",
			"mnemon-dialog-backdrop-enter": "IIa07q_mnemon-dialog-backdrop-enter",
			"mnemon-dialog-enter": "IIa07q_mnemon-dialog-enter",
			"mnemon-metadata-refreshed": "IIa07q_mnemon-metadata-refreshed",
			"mnemon-metadata-sweep": "IIa07q_mnemon-metadata-sweep",
			"mnemon-sheet-enter": "IIa07q_mnemon-sheet-enter",
			"mnemon-spin": "IIa07q_mnemon-spin",
			"modal": "IIa07q_modal",
			"modalBackdrop": "IIa07q_modalBackdrop",
			"modalBody": "IIa07q_modalBody",
			"modalDragHandle": "IIa07q_modalDragHandle",
			"modalFooter": "IIa07q_modalFooter",
			"modalFooterActions": "IIa07q_modalFooterActions",
			"modalFooterMeta": "IIa07q_modalFooterMeta",
			"modalPortal": "IIa07q_modalPortal",
			"modalTheme": "IIa07q_modalTheme",
			"modalWide": "IIa07q_modalWide",
			"nativeProviderCopy": "IIa07q_nativeProviderCopy",
			"nativeProviderHealth": "IIa07q_nativeProviderHealth",
			"nativeProviderMeta": "IIa07q_nativeProviderMeta",
			"nav": "IIa07q_nav",
			"offline": "IIa07q_offline",
			"online": "IIa07q_online",
			"page": "IIa07q_page",
			"pageHeader": "IIa07q_pageHeader",
			"pageHeaderMeta": "IIa07q_pageHeaderMeta",
			"pageSpinner": "IIa07q_pageSpinner",
			"phaseBadge": "IIa07q_phaseBadge",
			"primaryButton": "IIa07q_primaryButton",
			"providerFieldControl": "IIa07q_providerFieldControl",
			"providerHealth": "IIa07q_providerHealth",
			"providerHealthCopy": "IIa07q_providerHealthCopy",
			"providerHealthList": "IIa07q_providerHealthList",
			"providerHealthMark": "IIa07q_providerHealthMark",
			"providerHealthMeta": "IIa07q_providerHealthMeta",
			"providerHealthSignal": "IIa07q_providerHealthSignal",
			"runtimeFootnote": "IIa07q_runtimeFootnote",
			"runtimeNotice": "IIa07q_runtimeNotice",
			"secondaryButton": "IIa07q_secondaryButton",
			"sectionHeading": "IIa07q_sectionHeading",
			"sectionSpinner": "IIa07q_sectionSpinner",
			"shell": "IIa07q_shell",
			"sourceManagementCapabilities": "IIa07q_sourceManagementCapabilities",
			"sourceManagementDiagnostics": "IIa07q_sourceManagementDiagnostics",
			"sourceManagementForm": "IIa07q_sourceManagementForm",
			"sourceManagementIdentity": "IIa07q_sourceManagementIdentity",
			"sourceManagementSummary": "IIa07q_sourceManagementSummary",
			"statusCluster": "IIa07q_statusCluster",
			"statusDot": "IIa07q_statusDot",
			"statusHeaderActions": "IIa07q_statusHeaderActions",
			"statusSectionHeader": "IIa07q_statusSectionHeader",
			"storageAreaGrid": "IIa07q_storageAreaGrid",
			"storageAreaMetric": "IIa07q_storageAreaMetric",
			"storageDomains": "IIa07q_storageDomains",
			"storageFootnote": "IIa07q_storageFootnote",
			"storageMode": "IIa07q_storageMode",
			"storagePath": "IIa07q_storagePath",
			"storageRoot": "IIa07q_storageRoot",
			"storageUnavailable": "IIa07q_storageUnavailable",
			"topNavigation": "IIa07q_topNavigation",
			"versionChecking": "IIa07q_versionChecking",
			"versionCommand": "IIa07q_versionCommand",
			"versionDialogBody": "IIa07q_versionDialogBody",
			"versionError": "IIa07q_versionError",
			"versionGuidance": "IIa07q_versionGuidance",
			"versionGuidanceDetails": "IIa07q_versionGuidanceDetails",
			"versionList": "IIa07q_versionList",
			"versionLocation": "IIa07q_versionLocation",
			"versionNotice": "IIa07q_versionNotice",
			"versionNumbers": "IIa07q_versionNumbers",
			"versionPackage": "IIa07q_versionPackage",
			"versionPackageAction": "IIa07q_versionPackageAction",
			"versionPackageHeader": "IIa07q_versionPackageHeader",
			"versionPackageMeta": "IIa07q_versionPackageMeta",
			"versionPackageNumbers": "IIa07q_versionPackageNumbers",
			"versionPackages": "IIa07q_versionPackages",
			"versionPackagesToggle": "IIa07q_versionPackagesToggle",
			"versionResult": "IIa07q_versionResult",
			"workspace": "IIa07q_workspace",
			"workspaceMismatch": "IIa07q_workspaceMismatch",
			"workspacePicker": "IIa07q_workspacePicker"
		};
		//#endregion
		//#region \0dsh-mnemon-css:/home/runner/work/dsh-mnemon/dsh-mnemon/src/client/MnemonSidebarView.module.css.mjs
		const css$7 = "._Bh55G_shell._Bh55G_shell{background:var(--mn-surface);font-family:var(--dsw-font-family)}._Bh55G_shell ._Bh55G_masthead{background:var(--mn-surface);border-bottom:0;align-items:center;gap:12px;min-height:50px;padding:10px 16px 6px;display:flex}._Bh55G_shell ._Bh55G_brand{flex-wrap:wrap;flex:auto;gap:4px 8px}._Bh55G_shell ._Bh55G_brand h1{letter-spacing:0;flex:none;margin:0;font-size:16px;font-weight:700;line-height:24px}._Bh55G_shell [class*=storageMode]{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);gap:5px;min-width:96px;min-height:32px;padding:0 9px}._Bh55G_shell [class*=storageMode]>span{color:var(--dsw-alias-label-tertiary);font-size:11px}._Bh55G_shell [class*=storageMode]>strong{color:var(--dsw-alias-label-primary);font-size:12px}._Bh55G_shell ._Bh55G_headerActions{flex:0 auto;gap:6px}._Bh55G_shell ._Bh55G_workspacePicker{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;flex:none;gap:7px;min-height:32px;padding-left:9px}._Bh55G_shell ._Bh55G_workspacePicker>span{color:var(--dsw-alias-label-tertiary);font-size:11px;display:block}._Bh55G_shell ._Bh55G_workspacePicker select{border:0;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-input-major);border-radius:0 7px 7px 0;width:min(190px,20vw);height:30px;padding:0 28px 0 10px;font-size:13px}._Bh55G_shell ._Bh55G_statusCluster{background:0 0;border:0;border-radius:8px;gap:7px;min-height:30px;padding:0 2px 0 8px;font-size:12px}._Bh55G_shell ._Bh55G_statusCluster>span:not([class*=statusDot]){min-width:56px}._Bh55G_shell ._Bh55G_workspaceMismatch{border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 34%, var(--dsw-alias-border-l1));background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-layer-1));white-space:nowrap;border-radius:8px;flex:none;justify-content:flex-start;gap:6px;min-height:32px;margin:0;padding:0 3px 0 9px}._Bh55G_shell ._Bh55G_workspaceMismatch>span{color:var(--dsw-alias-label-secondary);font-size:11px}._Bh55G_shell ._Bh55G_workspaceMismatch>button{border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 55%, var(--dsw-alias-border-l2));min-height:26px;color:var(--dsw-alias-state-business-primary);background:var(--mn-surface);cursor:pointer;border-radius:6px;padding:0 8px;font-size:11px}._Bh55G_shell ._Bh55G_workspaceMismatch>button:hover{background:var(--dsw-alias-interactive-bg-hover)}._Bh55G_shell ._Bh55G_topNavigation{background:var(--mn-surface);border-bottom:0;gap:0;min-height:0;padding:0 16px}._Bh55G_shell ._Bh55G_topNavigation:after{display:none}._Bh55G_shell ._Bh55G_nav{border-bottom:1px solid var(--dsw-alias-border-l1);flex:1;gap:2px;padding-right:0}._Bh55G_shell ._Bh55G_nav button{border-bottom:2px solid #0000;border-radius:6px 6px 0 0;gap:0;min-height:0;padding:7px 14px;font-size:13px;font-weight:400}._Bh55G_shell ._Bh55G_nav button:hover{background:var(--dsw-alias-interactive-bg-hover)}._Bh55G_shell ._Bh55G_nav button[data-active]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary);font-weight:600}._Bh55G_shell ._Bh55G_modalBackdrop{z-index:1300;overscroll-behavior:contain;background:var(--dsw-alias-bg-mask-1);justify-content:center;align-items:center;padding:24px;display:flex;position:fixed;inset:0}._Bh55G_shell ._Bh55G_modal{border:1px solid var(--dsw-alias-border-l2);width:min(680px,100vw - 48px);min-height:0;max-height:calc(100vh - 48px);box-shadow:var(--dsw-shadow-lv3);border-radius:14px;flex-direction:column;display:flex;overflow:hidden}._Bh55G_shell ._Bh55G_modal._Bh55G_modalWide{width:min(780px,100vw - 48px)}._Bh55G_shell ._Bh55G_modal>header{border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;justify-content:space-between;align-items:flex-start;gap:18px;padding:15px 18px;display:flex}._Bh55G_shell ._Bh55G_modal>header h2{margin:0;font-size:15px;line-height:22px}._Bh55G_shell ._Bh55G_modal>header p{max-width:64ch;color:var(--dsw-alias-label-secondary);margin:3px 0 0;font-size:12px;line-height:1.5}._Bh55G_shell ._Bh55G_modal>[class*=modalBody]{overscroll-behavior:contain;scrollbar-gutter:stable;touch-action:pan-y;-webkit-overflow-scrolling:touch;min-height:0;padding:18px;overflow:hidden auto}._Bh55G_shell ._Bh55G_modal>[class*=modalFooter]{border-top-color:var(--dsw-alias-border-l1)}@supports (height:100dvh){._Bh55G_shell ._Bh55G_modal{max-height:calc(100dvh - 48px)}}._Bh55G_shell ._Bh55G_modal [class*=formActions]{justify-content:flex-end}._Bh55G_shell [class*=primaryButton]{min-height:32px;color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-button-info-fill);white-space:nowrap;border:0;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:600}._Bh55G_shell [class*=primaryButton]:hover:not(:disabled){filter:none;background:var(--dsw-alias-button-info-hover)}._Bh55G_shell [class*=secondaryButton],._Bh55G_shell [class*=ghostButton]{border:1px solid var(--dsw-alias-border-l2);min-height:32px;color:var(--dsw-alias-label-primary);white-space:nowrap;background:0 0;border-radius:8px;padding:5px 12px;font-size:12px;font-weight:400}._Bh55G_shell [class*=secondaryButton]:hover:not(:disabled),._Bh55G_shell [class*=ghostButton]:hover:not(:disabled){filter:none;background:var(--dsw-alias-interactive-bg-hover)}._Bh55G_shell [class*=dangerButton]{min-height:0;color:var(--dsw-alias-state-error-primary);white-space:nowrap;background:0 0;border:0;border-radius:0;padding:0;font-size:12px;font-weight:400}._Bh55G_shell [class*=dangerButton]:hover:not(:disabled){filter:none;background:0 0;text-decoration:underline}._Bh55G_shell [class*=dangerSolidButton]{color:#fff;background:var(--dsw-alias-state-error-primary);white-space:nowrap;border:0;border-radius:8px;min-height:32px;padding:6px 14px;font-size:13px;font-weight:600}._Bh55G_shell [class*=dangerSolidButton]:hover:not(:disabled){filter:brightness(1.08)}._Bh55G_shell [class*=iconButton],._Bh55G_shell [class*=bodyEditButton],._Bh55G_shell [class*=sectionHeading] button{width:26px;height:26px;min-height:0;color:var(--dsw-alias-label-secondary);background:0 0;border:0;border-radius:6px;justify-content:center;align-items:center;padding:0;font-size:13px;display:inline-flex}._Bh55G_shell [class*=iconButton]:hover:not(:disabled),._Bh55G_shell [class*=bodyEditButton]:hover:not(:disabled),._Bh55G_shell [class*=sectionHeading] button:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:0}._Bh55G_shell [class*=primaryButton],._Bh55G_shell [class*=secondaryButton],._Bh55G_shell [class*=ghostButton],._Bh55G_shell [class*=dangerButton],._Bh55G_shell [class*=dangerSolidButton],._Bh55G_shell [class*=iconButton],._Bh55G_shell [class*=bodyEditButton],._Bh55G_shell [class*=sectionHeading] button{cursor:pointer;transition:background-color .12s,color .12s,border-color .12s,outline-color .12s,box-shadow .12s,transform .12s}._Bh55G_shell [class*=primaryButton]:active:not(:disabled),._Bh55G_shell [class*=secondaryButton]:active:not(:disabled),._Bh55G_shell [class*=ghostButton]:active:not(:disabled),._Bh55G_shell [class*=dangerButton]:active:not(:disabled),._Bh55G_shell [class*=dangerSolidButton]:active:not(:disabled),._Bh55G_shell [class*=iconButton]:active:not(:disabled),._Bh55G_shell [class*=bodyEditButton]:active:not(:disabled),._Bh55G_shell [class*=sectionHeading] button:active:not(:disabled){transform:translateY(1px)}._Bh55G_shell [class*=primaryButton]:disabled,._Bh55G_shell [class*=secondaryButton]:disabled,._Bh55G_shell [class*=ghostButton]:disabled,._Bh55G_shell [class*=dangerButton]:disabled,._Bh55G_shell [class*=dangerSolidButton]:disabled,._Bh55G_shell [class*=iconButton]:disabled,._Bh55G_shell [class*=bodyEditButton]:disabled{cursor:default;opacity:.45}._Bh55G_shell ._Bh55G_canvas{background:var(--mn-surface)}._Bh55G_shell button,._Bh55G_shell input,._Bh55G_shell select,._Bh55G_shell textarea{font-family:var(--dsw-font-family)}._Bh55G_shell button:focus-visible,._Bh55G_shell input:focus-visible,._Bh55G_shell select:focus-visible,._Bh55G_shell textarea:focus-visible,._Bh55G_shell summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}._Bh55G_shell ._Bh55G_canvas>div{width:100%;padding:14px 16px clamp(96px,14vh,150px)}._Bh55G_shell ._Bh55G_pageHeader{margin-bottom:12px}._Bh55G_shell ._Bh55G_pageHeader h2{letter-spacing:0;margin-top:0;font-size:16px;line-height:1.35}._Bh55G_shell ._Bh55G_pageHeader p{font-size:13px;line-height:1.55}._Bh55G_shell ._Bh55G_canvas[data-lock-page-header] [class*=pageHeader]{z-index:12;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--mn-surface);margin:-14px -16px 12px;padding:14px 16px 10px;position:sticky;top:0}._Bh55G_shell input,._Bh55G_shell select,._Bh55G_shell textarea{font-family:var(--dsw-font-family);font-size:13px;font-weight:400}._Bh55G_shell [class*=bodyEdit] label,._Bh55G_shell [class*=formGrid] label{color:var(--dsw-alias-label-secondary);gap:5px;font-size:12px;font-weight:500}._Bh55G_shell [class*=bodyEdit] input,._Bh55G_shell [class*=bodyEdit] select,._Bh55G_shell [class*=bodyEdit] textarea,._Bh55G_shell [class*=formGrid] select,._Bh55G_shell [class*=formGrid] input,._Bh55G_shell [class*=bodyCreate] input{border:1px solid var(--dsw-alias-border-l2);min-height:34px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:8px;padding:7px 10px;font-size:13px;font-weight:400}._Bh55G_shell select{cursor:pointer;font-weight:400}._Bh55G_shell textarea{font-weight:400;line-height:1.55}._Bh55G_shell [class*=cardKicker],._Bh55G_shell [class*=sectionHeading]>div>span{letter-spacing:.06em;font-size:11px}._Bh55G_shell [class*=healthStrip] p,._Bh55G_shell [class*=storageAreaGrid] article>p,._Bh55G_shell [class*=statusSectionHeader] p,._Bh55G_shell [class*=writeGuide] li span,._Bh55G_shell [class*=writeGuide]>p{font-size:12px}._Bh55G_shell [class*=runtimeFootnote],._Bh55G_shell [class*=storageRoot] span,._Bh55G_shell [class*=storageRoot] small,._Bh55G_shell [class*=storageAreaMetric] span,._Bh55G_shell [class*=storageAreaMetric] code,._Bh55G_shell [class*=storagePath],._Bh55G_shell [class*=storageAreaGrid] article>small,._Bh55G_shell [class*=storageFootnote]{font-size:11px}._Bh55G_shell [class*=listProgress],._Bh55G_shell [class*=compactListProgress]{color:var(--dsw-alias-label-tertiary);font-size:12px}._Bh55G_shell ._Bh55G_itemActionButton{border:1px solid;border-radius:7px;min-height:28px;padding:4px 9px;font-size:12px;line-height:18px}._Bh55G_shell ._Bh55G_itemEditAction{color:var(--dsw-alias-state-business-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 38%, var(--dsw-alias-border-l2));background:0 0}._Bh55G_shell ._Bh55G_itemEditAction:hover:not(:disabled){color:var(--dsw-alias-state-business-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 58%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent)}._Bh55G_shell ._Bh55G_itemDangerAction{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 34%, var(--dsw-alias-border-l2));background:0 0;padding:4px 9px}._Bh55G_shell ._Bh55G_itemDangerAction:hover:not(:disabled){border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 54%, var(--dsw-alias-border-l2));background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);text-decoration:none}._Bh55G_shell [class*=bodyDeleteConfirm]>p{font-size:13px}._Bh55G_shell [class*=pageHeaderMeta]>code{text-align:center;font-variant-numeric:tabular-nums;min-width:72px;font-size:11px}@media (width<=760px){._Bh55G_shell ._Bh55G_masthead{min-height:48px;padding:8px 12px 4px}._Bh55G_shell ._Bh55G_headerActions{max-width:none}._Bh55G_shell ._Bh55G_statusCluster>span:not([class*=statusDot]){display:inline}._Bh55G_shell [class*=storageMode]{min-width:0}._Bh55G_shell [class*=storageMode]>span,._Bh55G_shell ._Bh55G_workspacePicker>span,._Bh55G_shell ._Bh55G_workspaceMismatch>span{display:none}._Bh55G_shell ._Bh55G_workspacePicker{gap:0;padding-left:0}._Bh55G_shell ._Bh55G_workspacePicker select{border-left:0;width:min(160px,31vw)}._Bh55G_shell ._Bh55G_topNavigation{padding:0 12px}._Bh55G_shell ._Bh55G_nav button{text-align:left;flex-direction:row;min-width:max-content;padding:7px 12px}._Bh55G_shell ._Bh55G_canvas>div{padding:14px 12px calc(170px + env(safe-area-inset-bottom,0px))}._Bh55G_shell ._Bh55G_canvas[data-lock-page-header] [class*=pageHeader]{margin-inline:-12px;padding-inline:12px}._Bh55G_shell ._Bh55G_modalBackdrop{padding:max(10px, env(safe-area-inset-top,0px)) 0 0;align-items:flex-end}._Bh55G_shell ._Bh55G_modal,._Bh55G_shell ._Bh55G_modal._Bh55G_modalWide{width:100vw;max-height:calc(100vh - max(10px, env(safe-area-inset-top,0px)));border-bottom:0;border-radius:18px 18px 0 0}._Bh55G_shell ._Bh55G_modalDragHandle span{background:var(--dsw-alias-border-l2)}._Bh55G_shell ._Bh55G_modal>header{padding:10px max(14px, env(safe-area-inset-right,0px)) 12px max(14px, env(safe-area-inset-left,0px));gap:12px}._Bh55G_shell ._Bh55G_modal>header p{-webkit-line-clamp:2;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}._Bh55G_shell ._Bh55G_modal>header [class*=iconButton]{width:44px;min-width:44px;height:44px;min-height:44px}._Bh55G_shell ._Bh55G_modal>[class*=modalBody]{padding:14px max(14px, env(safe-area-inset-right,0px)) 18px max(14px, env(safe-area-inset-left,0px));scrollbar-gutter:auto}._Bh55G_shell ._Bh55G_modal>[class*=modalBody] button{min-height:44px}._Bh55G_shell ._Bh55G_modal>[class*=modalFooter]{padding:10px max(14px, env(safe-area-inset-right,0px)) calc(10px + env(safe-area-inset-bottom,0px)) max(14px, env(safe-area-inset-left,0px))}._Bh55G_shell ._Bh55G_modal>[class*=modalFooter] [class*=modalFooterActions] button{min-height:44px;padding-block:8px}}@media (width>=761px) and (height<=560px){._Bh55G_shell ._Bh55G_modalBackdrop{padding:8px}._Bh55G_shell ._Bh55G_modal{max-height:calc(100vh - 16px)}}@supports (height:100dvh){@media (width<=760px){._Bh55G_shell ._Bh55G_modal,._Bh55G_shell ._Bh55G_modal._Bh55G_modalWide{max-height:calc(100dvh - max(10px, env(safe-area-inset-top,0px)))}}@media (width>=761px) and (height<=560px){._Bh55G_shell ._Bh55G_modal{max-height:calc(100dvh - 16px)}}}@media (width<=520px){._Bh55G_shell ._Bh55G_masthead{min-height:46px}._Bh55G_shell ._Bh55G_brand{flex-wrap:wrap;gap:4px 8px}._Bh55G_shell ._Bh55G_brand h1{font-size:16px}._Bh55G_shell ._Bh55G_nav button{padding-inline:8px;font-size:12px}._Bh55G_shell ._Bh55G_headerActions{flex:none;max-width:none}._Bh55G_shell [class*=backButton]>span{display:none}._Bh55G_shell [class*=storageMode]{padding-inline:7px}._Bh55G_shell ._Bh55G_workspacePicker select{width:min(118px,30vw);padding-left:8px}._Bh55G_shell ._Bh55G_workspaceMismatch>button{padding-inline:6px}._Bh55G_shell ._Bh55G_statusCluster [class*=iconButton]{display:none}}@media (height<=420px){._Bh55G_shell ._Bh55G_modal>header p{white-space:nowrap;text-overflow:ellipsis;display:block;overflow:hidden}}@media (pointer:coarse){._Bh55G_shell ._Bh55G_modal>header [class*=iconButton]{width:44px;min-width:44px;height:44px;min-height:44px}._Bh55G_shell ._Bh55G_modal>[class*=modalBody] button,._Bh55G_shell ._Bh55G_modal>[class*=modalFooter] button{min-height:44px}}@media (prefers-reduced-motion:reduce){._Bh55G_shell [class*=primaryButton],._Bh55G_shell [class*=secondaryButton],._Bh55G_shell [class*=ghostButton],._Bh55G_shell [class*=dangerButton],._Bh55G_shell [class*=dangerSolidButton],._Bh55G_shell [class*=iconButton],._Bh55G_shell [class*=bodyEditButton],._Bh55G_shell [class*=sectionHeading] button{transition:none}}";
		const tagId$7 = "dsh-mnemon/src/client/MnemonSidebarView.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$7) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = tagId$7;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css$7) tag.textContent = css$7;
		}
		var MnemonSidebarView_module_css_default = {
			"brand": "_Bh55G_brand",
			"canvas": "_Bh55G_canvas",
			"headerActions": "_Bh55G_headerActions",
			"itemActionButton": "_Bh55G_itemActionButton",
			"itemDangerAction": "_Bh55G_itemDangerAction",
			"itemEditAction": "_Bh55G_itemEditAction",
			"masthead": "_Bh55G_masthead",
			"modal": "_Bh55G_modal",
			"modalBackdrop": "_Bh55G_modalBackdrop",
			"modalDragHandle": "_Bh55G_modalDragHandle",
			"modalWide": "_Bh55G_modalWide",
			"nav": "_Bh55G_nav",
			"pageHeader": "_Bh55G_pageHeader",
			"shell": "_Bh55G_shell",
			"statusCluster": "_Bh55G_statusCluster",
			"topNavigation": "_Bh55G_topNavigation",
			"workspaceMismatch": "_Bh55G_workspaceMismatch",
			"workspacePicker": "_Bh55G_workspacePicker"
		};
		//#endregion
		//#region src/client/MnemonDialog.tsx
		const SHEET_MEDIA = "(max-width: 760px)";
		const REDUCED_MOTION_MEDIA = "(prefers-reduced-motion: reduce)";
		const CLOSE_DURATION_MS = 240;
		const SNAP_DURATION_MS = 280;
		function matches(query) {
			return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
		}
		function currentTransform(element) {
			const value = window.getComputedStyle(element).transform;
			return value === "" || value === "none" ? "translate3d(0, 0, 0)" : value;
		}
		function currentTranslateY(element) {
			const transform = currentTransform(element);
			if (transform === "translate3d(0, 0, 0)") return 0;
			try {
				return Math.max(new DOMMatrixReadOnly(transform).m42, 0);
			} catch {
				const matrix3d = transform.match(/^matrix3d\((.+)\)$/);
				if (matrix3d !== null) return Math.max(Number(matrix3d[1]?.split(",")[13]) || 0, 0);
				const matrix = transform.match(/^matrix\((.+)\)$/);
				return matrix === null ? 0 : Math.max(Number(matrix[1]?.split(",")[5]) || 0, 0);
			}
		}
		function cancelAnimations(element) {
			if (element === null || typeof element.getAnimations !== "function") return;
			element.getAnimations().forEach((animation) => animation.cancel());
		}
		function releaseDragCapture(drag) {
			try {
				if (typeof drag.captureTarget.hasPointerCapture !== "function" || drag.captureTarget.hasPointerCapture(drag.pointerId)) drag.captureTarget.releasePointerCapture?.(drag.pointerId);
			} catch {}
		}
		function waitForAnimations(animations, duration) {
			return new Promise((resolve) => {
				let settled = false;
				const finish = () => {
					if (settled) return;
					settled = true;
					window.clearTimeout(timeout);
					resolve();
				};
				const timeout = window.setTimeout(finish, duration + 100);
				Promise.allSettled(animations.map((animation) => animation.finished)).then(finish);
			});
		}
		/** Shared top-layer dialog behavior for every Mnemon workspace action surface. */
		function MnemonDialog(props) {
			const titleId = (0, react.useId)();
			const descriptionId = (0, react.useId)();
			const backdropRef = (0, react.useRef)(null);
			const dialogRef = (0, react.useRef)(null);
			const closeButtonRef = (0, react.useRef)(null);
			const returnFocusRef = (0, react.useRef)(null);
			const dragRef = (0, react.useRef)(null);
			const snapGenerationRef = (0, react.useRef)(0);
			const closingRef = (0, react.useRef)(false);
			const mountedRef = (0, react.useRef)(true);
			const busyRef = (0, react.useRef)(props.busy === true);
			const onCloseRef = (0, react.useRef)(props.onClose);
			busyRef.current = props.busy === true;
			onCloseRef.current = props.onClose;
			const focusPreferredControl = (0, react.useCallback)(() => {
				(dialogRef.current?.querySelector("[data-autofocus]:not(:disabled)") ?? dialogRef.current?.querySelector("input:not(:disabled), textarea:not(:disabled), select:not(:disabled)"))?.focus({ preventScroll: true });
			}, []);
			const finishClose = (0, react.useCallback)(() => {
				if (mountedRef.current) onCloseRef.current();
			}, []);
			const requestClose = (0, react.useCallback)(() => {
				if (busyRef.current || closingRef.current) return;
				const dialog = dialogRef.current;
				const backdrop = backdropRef.current;
				if (dialog === null || backdrop === null || matches(REDUCED_MOTION_MEDIA) || typeof dialog.animate !== "function" || typeof backdrop.animate !== "function") {
					finishClose();
					return;
				}
				closingRef.current = true;
				snapGenerationRef.current += 1;
				dialog.dataset.closing = "true";
				backdrop.dataset.closing = "true";
				const sheet = matches(SHEET_MEDIA);
				const fromTransform = currentTransform(dialog);
				const fromBackdropOpacity = window.getComputedStyle(backdrop).opacity;
				cancelAnimations(dialog);
				cancelAnimations(backdrop);
				const easing = sheet ? "cubic-bezier(.4, 0, 1, 1)" : "cubic-bezier(.4, 0, .2, 1)";
				waitForAnimations([dialog.animate(sheet ? [{
					opacity: 1,
					transform: fromTransform
				}, {
					opacity: 1,
					transform: "translate3d(0, calc(100% + 32px), 0)"
				}] : [{
					opacity: 1,
					transform: fromTransform
				}, {
					opacity: 0,
					transform: "translate3d(0, 8px, 0) scale(.985)"
				}], {
					duration: CLOSE_DURATION_MS,
					easing,
					fill: "forwards"
				}), backdrop.animate([{ opacity: fromBackdropOpacity }, { opacity: 0 }], {
					duration: CLOSE_DURATION_MS,
					easing: "ease-out",
					fill: "forwards"
				})], CLOSE_DURATION_MS).then(finishClose);
			}, [finishClose]);
			const resetDrag = (0, react.useCallback)(() => {
				const dialog = dialogRef.current;
				const backdrop = backdropRef.current;
				if (dialog === null || backdrop === null) return;
				const drag = dragRef.current;
				const offset = drag?.offset ?? 0;
				const snapGeneration = ++snapGenerationRef.current;
				dragRef.current = null;
				if (drag !== null) releaseDragCapture(drag);
				delete dialog.dataset.dragging;
				if (offset <= 0 || matches(REDUCED_MOTION_MEDIA) || typeof dialog.animate !== "function" || typeof backdrop.animate !== "function") {
					dialog.style.removeProperty("--mn-modal-drag-y");
					backdrop.style.removeProperty("opacity");
					return;
				}
				const dialogAnimation = dialog.animate([{ transform: currentTransform(dialog) }, { transform: "translate3d(0, 0, 0)" }], {
					duration: SNAP_DURATION_MS,
					easing: "cubic-bezier(.2, .8, .2, 1)",
					fill: "forwards"
				});
				const backdropAnimation = backdrop.animate([{ opacity: window.getComputedStyle(backdrop).opacity }, { opacity: 1 }], {
					duration: SNAP_DURATION_MS,
					easing: "ease-out",
					fill: "forwards"
				});
				waitForAnimations([dialogAnimation, backdropAnimation], SNAP_DURATION_MS).then(() => {
					if (!mountedRef.current || snapGenerationRef.current !== snapGeneration) return;
					dialog.style.removeProperty("--mn-modal-drag-y");
					backdrop.style.removeProperty("opacity");
					dialogAnimation.cancel();
					backdropAnimation.cancel();
				});
			}, []);
			const beginDrag = (event) => {
				if (busyRef.current || closingRef.current || !event.isPrimary || !matches(SHEET_MEDIA)) return;
				if (event.pointerType === "mouse" && event.button !== 0) return;
				const dialog = dialogRef.current;
				if (dialog === null) return;
				snapGenerationRef.current += 1;
				const initialOffset = currentTranslateY(dialog);
				const backdrop = backdropRef.current;
				const initialBackdropOpacity = backdrop === null ? "" : window.getComputedStyle(backdrop).opacity;
				cancelAnimations(dialog);
				cancelAnimations(backdrop);
				const time = event.timeStamp;
				dragRef.current = {
					pointerId: event.pointerId,
					captureTarget: event.currentTarget,
					startY: event.clientY,
					initialOffset,
					lastY: event.clientY,
					lastTime: time,
					velocity: 0,
					offset: initialOffset,
					height: Math.max(dialog.getBoundingClientRect().height, 1)
				};
				dialog.dataset.dragging = "true";
				dialog.style.setProperty("--mn-modal-drag-y", `${initialOffset}px`);
				if (backdrop !== null) backdrop.style.opacity = initialBackdropOpacity;
				try {
					event.currentTarget.setPointerCapture?.(event.pointerId);
				} catch {}
			};
			const moveDrag = (0, react.useCallback)((event) => {
				const drag = dragRef.current;
				const dialog = dialogRef.current;
				const backdrop = backdropRef.current;
				if (drag === null || dialog === null || backdrop === null || drag.pointerId !== event.pointerId) return;
				event.preventDefault();
				const rawOffset = Math.max(0, drag.initialOffset + event.clientY - drag.startY);
				const offset = rawOffset <= drag.height ? rawOffset : drag.height + (rawOffset - drag.height) * .16;
				const elapsed = Math.max(event.timeStamp - drag.lastTime, 1);
				const sampleVelocity = (event.clientY - drag.lastY) / elapsed;
				drag.velocity = drag.velocity * .35 + sampleVelocity * .65;
				drag.lastY = event.clientY;
				drag.lastTime = event.timeStamp;
				drag.offset = offset;
				dialog.style.setProperty("--mn-modal-drag-y", `${offset}px`);
				backdrop.style.opacity = String(1 - Math.min(offset / drag.height * .58, .52));
			}, []);
			const endDrag = (0, react.useCallback)((event) => {
				const drag = dragRef.current;
				if (drag === null || drag.pointerId !== event.pointerId) return;
				const threshold = Math.min(Math.max(drag.height * .22, 96), 180);
				if (drag.offset >= threshold || drag.offset >= 28 && drag.velocity >= .55) {
					dragRef.current = null;
					releaseDragCapture(drag);
					if (dialogRef.current !== null) delete dialogRef.current.dataset.dragging;
					requestClose();
				} else resetDrag();
			}, [requestClose, resetDrag]);
			const cancelDrag = (0, react.useCallback)((event) => {
				if (dragRef.current?.pointerId === event.pointerId) resetDrag();
			}, [resetDrag]);
			(0, react.useLayoutEffect)(() => {
				returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
				(dialogRef.current?.querySelector("[data-autofocus]:not(:disabled)") ?? dialogRef.current?.querySelector("input:not(:disabled), textarea:not(:disabled), select:not(:disabled)") ?? dialogRef.current?.querySelector("button:not(:disabled)"))?.focus({ preventScroll: true });
				return () => {
					if (returnFocusRef.current?.isConnected === true) returnFocusRef.current.focus({ preventScroll: true });
				};
			}, []);
			(0, react.useLayoutEffect)(() => {
				if (props.contentReady !== true) return;
				const active = document.activeElement;
				if (active !== closeButtonRef.current && active !== dialogRef.current) return;
				focusPreferredControl();
			}, [focusPreferredControl, props.contentReady]);
			(0, react.useEffect)(() => {
				mountedRef.current = true;
				const previousOverflow = document.body.style.overflow;
				document.body.style.overflow = "hidden";
				return () => {
					mountedRef.current = false;
					document.body.style.overflow = previousOverflow;
				};
			}, []);
			(0, react.useEffect)(() => {
				const onKey = (event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						requestClose();
						return;
					}
					if (event.key !== "Tab" || closingRef.current) return;
					const controls = Array.from(dialogRef.current?.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex=\"-1\"])") ?? []).filter((control) => control.getAttribute("aria-hidden") !== "true");
					const first = controls[0];
					const last = controls.at(-1);
					if (first === void 0 || last === void 0) {
						event.preventDefault();
						return;
					}
					const active = document.activeElement;
					if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
						event.preventDefault();
						last.focus();
					} else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
						event.preventDefault();
						first.focus();
					}
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [requestClose]);
			(0, react.useEffect)(() => {
				const cancelOnBlur = () => {
					if (dragRef.current !== null) resetDrag();
				};
				const cancelWhenHidden = () => {
					if (document.visibilityState === "hidden") cancelOnBlur();
				};
				window.addEventListener("pointermove", moveDrag, { passive: false });
				window.addEventListener("pointerup", endDrag);
				window.addEventListener("pointercancel", cancelDrag);
				window.addEventListener("blur", cancelOnBlur);
				document.addEventListener("visibilitychange", cancelWhenHidden);
				return () => {
					window.removeEventListener("pointermove", moveDrag);
					window.removeEventListener("pointerup", endDrag);
					window.removeEventListener("pointercancel", cancelDrag);
					window.removeEventListener("blur", cancelOnBlur);
					document.removeEventListener("visibilitychange", cancelWhenHidden);
				};
			}, [
				cancelDrag,
				endDrag,
				moveDrag,
				resetDrag
			]);
			const interceptCloseControl = (event) => {
				const target = event.target instanceof Element ? event.target.closest("[data-dialog-close]") : null;
				if (target === null || !dialogRef.current?.contains(target)) return;
				event.preventDefault();
				event.stopPropagation();
				requestClose();
			};
			if (typeof document === "undefined") return null;
			return (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: MnemonView_module_css_default.modalPortal,
				"data-mnemon-dialog-portal": "",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: appearanceClass(appearanceClass(MnemonView_module_css_default.modalTheme, MnemonView_module_css_default.shell), MnemonSidebarView_module_css_default.shell),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						ref: backdropRef,
						className: appearanceClass(MnemonView_module_css_default.modalBackdrop, MnemonSidebarView_module_css_default.modalBackdrop),
						onPointerDown: (event) => {
							if (event.target === event.currentTarget) requestClose();
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							ref: dialogRef,
							className: appearanceClass(appearanceClass(MnemonView_module_css_default.modal, MnemonSidebarView_module_css_default.modal), props.wide === true ? appearanceClass(MnemonView_module_css_default.modalWide, MnemonSidebarView_module_css_default.modalWide) : void 0),
							role: "dialog",
							"aria-modal": "true",
							"aria-busy": props.contentReady === false || props.busy === true ? true : void 0,
							"aria-labelledby": titleId,
							"aria-describedby": props.description === void 0 ? void 0 : descriptionId,
							onClickCapture: interceptCloseControl,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: MnemonView_module_css_default.modalDragHandle,
									"data-dialog-drag-handle": "",
									"aria-hidden": "true",
									onPointerDown: beginDrag,
									onLostPointerCapture: (event) => {
										if (dragRef.current?.pointerId === event.pointerId) resetDrag();
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									id: titleId,
									children: props.title
								}), props.description !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									id: descriptionId,
									children: props.description
								})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									ref: closeButtonRef,
									type: "button",
									className: MnemonView_module_css_default.iconButton,
									disabled: props.busy,
									onClick: requestClose,
									"aria-label": props.closeLabel,
									children: "×"
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: MnemonView_module_css_default.modalBody,
									children: props.children
								}),
								props.footer !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("footer", {
									className: MnemonView_module_css_default.modalFooter,
									children: props.footer
								})
							]
						})
					})
				})
			}), document.body);
		}
		//#endregion
		//#region \0dsh-mnemon-css:/home/runner/work/dsh-mnemon/dsh-mnemon/plugins/dsh-mnemon-source-runtime/presentation/page.module.css.mjs
		const css$6 = ".IIa07q_runtimeComposer{border:1px solid var(--mn-line);background:var(--mn-layer-1);background:linear-gradient(135deg, color-mix(in srgb, var(--mn-accent) 5%, var(--mn-layer-1)), var(--mn-layer-1) 55%);border-radius:12px;margin-bottom:13px;padding:15px}.IIa07q_runtimeComposerHeading{justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:11px;display:flex}.IIa07q_runtimeComposerHeading h3{margin:0 0 2px;font-size:14px}.IIa07q_runtimeComposerHeading p{color:var(--mn-muted);margin:0;font-size:10px}.IIa07q_runtimeComposerHeading>span{color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 9%, transparent);font:650 9px var(--mn-code);border-radius:999px;flex:none;padding:4px 8px}.IIa07q_runtimeComposer>textarea,.IIa07q_runtimeEntry textarea{resize:vertical;border:1px solid var(--mn-line);width:100%;color:var(--mn-text);background:var(--mn-input);border-radius:9px;outline:0;padding:10px 11px;line-height:1.6}.IIa07q_runtimeComposer>textarea:focus,.IIa07q_runtimeEntry textarea:focus{border-color:var(--mn-accent)}.IIa07q_runtimeComposerActions{justify-content:flex-end;align-items:flex-end;gap:9px;margin-top:10px;display:flex}.IIa07q_runtimeComposerActions label{color:var(--mn-faint);gap:4px;font-size:9px;display:grid}.IIa07q_runtimeComposerActions select,.IIa07q_runtimeEntry select{border:1px solid var(--mn-line);background:var(--mn-input);border-radius:8px;outline:0;min-width:135px;height:34px;padding:0 8px}.IIa07q_runtimeReadOnly{border:1px solid color-mix(in srgb, var(--mn-success) 28%, var(--mn-line));color:var(--mn-muted);background:color-mix(in srgb, var(--mn-success) 6%, var(--mn-layer-1));border-color:var(--mn-line);background:var(--mn-layer-1);border-radius:9px;margin-bottom:13px;padding:9px 12px;font-size:11px}.IIa07q_runtimeSummaryGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:10px;display:grid}.IIa07q_runtimeSummaryCard{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px;min-width:0}.IIa07q_runtimeBrowser{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px;overflow:hidden}.IIa07q_runtimeBrowserToolbar{border-bottom:1px solid var(--mn-line);justify-content:space-between;align-items:center;gap:12px;padding:10px;display:flex}.IIa07q_runtimeScopeFilter{flex-wrap:wrap;align-items:center;gap:3px;display:flex}.IIa07q_runtimeScopeFilter button{min-height:32px;color:var(--mn-muted);cursor:pointer;background:0 0;border:1px solid #0000;border-radius:7px;padding:0 10px}.IIa07q_runtimeScopeFilter button:hover{background:var(--mn-hover)}.IIa07q_runtimeScopeFilter button[data-active]{border-color:var(--mn-line);color:var(--mn-text);background:var(--mn-layer-2)}.IIa07q_runtimeScopeFilter b{color:var(--mn-faint);font:600 10px var(--mn-code);margin-left:4px}.IIa07q_runtimeFilterQuery{border:1px solid var(--mn-line);background:var(--mn-input);border-radius:8px;align-items:center;gap:7px;width:min(320px,42%);min-width:210px;padding:0 9px;display:flex}.IIa07q_runtimeFilterQuery>span{color:var(--mn-faint)}.IIa07q_runtimeFilterQuery input{width:100%;min-width:0;height:32px;color:var(--mn-text);background:0 0;border:0;outline:0}.IIa07q_runtimeUnifiedList{background:color-mix(in srgb, var(--mn-layer-2) 30%, var(--mn-layer-1));grid-template-columns:1fr;gap:8px;padding:10px;display:grid}.IIa07q_runtimeEntryBadges{flex-wrap:wrap;align-items:center;gap:5px;display:flex}.IIa07q_runtimeEntryMeta .IIa07q_runtimeEntryTarget{color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 8%, var(--mn-layer-2));font-family:var(--mn-code)}.IIa07q_runtimeEntryMeta .IIa07q_runtimeEntryBranch{text-overflow:ellipsis;white-space:nowrap;max-width:140px;color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 8%, var(--mn-layer-2));font-family:var(--mn-code);overflow:hidden}.IIa07q_runtimeComposerBranch{color:var(--mn-faint);gap:4px;font-size:9px;display:grid}.IIa07q_runtimeComposerBranch input{border:1px solid var(--mn-line);width:100%;color:var(--mn-text);background:var(--mn-input);border-radius:8px;outline:0;padding:7px 9px;font-size:12px}.IIa07q_runtimeComposerBranch input:focus{border-color:var(--mn-accent)}.IIa07q_bodyEditBranch{color:var(--mn-faint);gap:4px;font-size:9px;display:grid}.IIa07q_bodyEditBranch input{border:1px solid var(--mn-line);width:100%;color:var(--mn-text);background:var(--mn-input);border-radius:8px;outline:0;padding:7px 9px;font-size:12px}.IIa07q_bodyEditBranch input:focus{border-color:var(--mn-accent)}.IIa07q_bodyEditBranch small{color:var(--mn-faint);font-size:9px}.IIa07q_runtimeTargetHeader{justify-content:space-between;align-items:center;gap:14px;padding:14px 15px 9px;display:flex}.IIa07q_runtimeTargetHeader>div{gap:1px;display:grid}.IIa07q_runtimeTargetHeader span{color:var(--mn-faint);font:650 9px var(--mn-code);letter-spacing:.08em}.IIa07q_runtimeTargetHeader h3{margin:0;font-size:15px}.IIa07q_runtimeTargetHeader>strong{min-width:28px;height:28px;color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 9%, transparent);font:650 11px var(--mn-code);border-radius:8px;place-items:center;display:grid}.IIa07q_capacityLine{align-items:center;gap:9px;padding:0 15px;display:flex}.IIa07q_capacityLine>div{background:var(--mn-layer-2);border-radius:999px;flex:1;height:4px;overflow:hidden}.IIa07q_capacityLine i{border-radius:inherit;background:var(--mn-success);height:100%;transition:width .25s;display:block}.IIa07q_capacityLine>span{min-width:88px;color:var(--mn-faint);font:9px var(--mn-code);text-align:right}.IIa07q_runtimeTargetDescription{min-height:31px;color:var(--mn-muted);margin:8px 15px 12px;font-size:10px}.IIa07q_runtimeEntry{--mn-provider-color:var(--mn-accent);border:1px solid var(--mn-line);background:linear-gradient(90deg, color-mix(in srgb, var(--mn-provider-color) 5%, var(--mn-layer-1)), var(--mn-layer-1) 34%);box-shadow:inset 3px 0 0 color-mix(in srgb, var(--mn-provider-color) 68%, transparent);border-radius:8px;padding:11px 12px 10px;position:relative}.IIa07q_runtimeEntry[data-importance=critical]{--mn-provider-color:var(--mn-priority)}.IIa07q_runtimeEntry[data-importance=low]{--mn-provider-color:var(--mn-faint)}.IIa07q_runtimeEntryMeta{justify-content:space-between;align-items:center;gap:12px;display:flex}.IIa07q_runtimeEntryMeta>span,.IIa07q_runtimeEntryBadges>span{color:var(--mn-muted);background:var(--mn-layer-2);border-radius:999px;padding:2px 6px;font-size:9px}.IIa07q_runtimeEntry[data-importance=critical] .IIa07q_runtimeEntryMeta>span,.IIa07q_runtimeEntry[data-importance=critical] .IIa07q_runtimeEntryBadges>span:not(.IIa07q_runtimeEntryTarget){color:var(--mn-priority);background:color-mix(in srgb, var(--mn-priority) 9%, transparent)}.IIa07q_runtimeEntryMeta time{color:var(--mn-faint);font:8px var(--mn-code);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.IIa07q_runtimeEntry>p{white-space:pre-wrap;overflow-wrap:anywhere;min-height:42px;margin:9px 0;font-size:12px;line-height:1.6}.IIa07q_runtimeEntry>select{margin-top:7px}.IIa07q_runtimeEntry footer{border-top:1px solid var(--mn-line);justify-content:flex-end;align-items:center;gap:4px;min-height:30px;margin-top:7px;padding-top:7px;display:flex}.IIa07q_runtimeEntry footer>span{color:var(--mn-danger);margin-right:auto;font-size:10px}.IIa07q_runtimeEmpty{min-height:126px;color:var(--mn-faint);text-align:center;align-content:center;place-items:center;gap:5px;display:grid}.IIa07q_runtimeEmpty>span{font:24px var(--mn-code);opacity:.65}.IIa07q_runtimeEmpty p{margin:0;font-size:10px}@media (width<=1000px){.IIa07q_runtimeSummaryGrid{grid-template-columns:1fr}}@media (width<=760px){.IIa07q_runtimeComposerHeading,.IIa07q_runtimeComposerActions{flex-direction:column;align-items:stretch}.IIa07q_runtimeComposerActions select,.IIa07q_runtimeComposerActions button{width:100%}.IIa07q_runtimeBrowserToolbar{flex-direction:column;align-items:stretch}.IIa07q_runtimeFilterQuery{width:100%;min-width:0}}";
		const tagId$6 = "dsh-mnemon-source-runtime/presentation/page.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$6) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = tagId$6;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css$6) tag.textContent = css$6;
		}
		var page_module_css_default$2 = {
			"bodyEditBranch": "IIa07q_bodyEditBranch",
			"capacityLine": "IIa07q_capacityLine",
			"runtimeBrowser": "IIa07q_runtimeBrowser",
			"runtimeBrowserToolbar": "IIa07q_runtimeBrowserToolbar",
			"runtimeComposer": "IIa07q_runtimeComposer",
			"runtimeComposerActions": "IIa07q_runtimeComposerActions",
			"runtimeComposerBranch": "IIa07q_runtimeComposerBranch",
			"runtimeComposerHeading": "IIa07q_runtimeComposerHeading",
			"runtimeEmpty": "IIa07q_runtimeEmpty",
			"runtimeEntry": "IIa07q_runtimeEntry",
			"runtimeEntryBadges": "IIa07q_runtimeEntryBadges",
			"runtimeEntryBranch": "IIa07q_runtimeEntryBranch",
			"runtimeEntryMeta": "IIa07q_runtimeEntryMeta",
			"runtimeEntryTarget": "IIa07q_runtimeEntryTarget",
			"runtimeFilterQuery": "IIa07q_runtimeFilterQuery",
			"runtimeReadOnly": "IIa07q_runtimeReadOnly",
			"runtimeScopeFilter": "IIa07q_runtimeScopeFilter",
			"runtimeSummaryCard": "IIa07q_runtimeSummaryCard",
			"runtimeSummaryGrid": "IIa07q_runtimeSummaryGrid",
			"runtimeTargetDescription": "IIa07q_runtimeTargetDescription",
			"runtimeTargetHeader": "IIa07q_runtimeTargetHeader",
			"runtimeUnifiedList": "IIa07q_runtimeUnifiedList"
		};
		//#endregion
		//#region \0dsh-mnemon-css:/home/runner/work/dsh-mnemon/dsh-mnemon/plugins/dsh-mnemon-source-runtime/presentation/sidebar.module.css.mjs
		const css$5 = "._Bh55G_shell ._Bh55G_modal form[class*=runtimeComposer]{background:0 0;border:0;border-radius:0;margin:0;padding:0}._Bh55G_shell ._Bh55G_modal form[class*=runtimeComposer]>[class*=runtimeComposerHeading]{display:none}._Bh55G_shell [class*=runtimeComposerActions] label{color:var(--dsw-alias-label-secondary);gap:5px;font-size:12px;font-weight:500}._Bh55G_shell [class*=runtimeComposer]>textarea,._Bh55G_shell [class*=runtimeComposerActions] select,._Bh55G_shell [class*=runtimeEntry] select{border:1px solid var(--dsw-alias-border-l2);min-height:34px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:8px;padding:7px 10px;font-size:13px;font-weight:400}._Bh55G_shell [class*=runtimeTargetDescription]{font-size:12px}._Bh55G_shell [class*=runtimeEntryMeta]>span,._Bh55G_shell [class*=runtimeEntryBadges]>span,._Bh55G_shell [class*=runtimeEntryMeta] time{font-size:11px}._Bh55G_shell [class*=runtimeEntry]>p{font-size:13px}._Bh55G_shell [class*=runtimeEntryBadges]>span{border:1px solid var(--dsw-alias-border-l1);min-height:22px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-radius:999px;align-items:center;padding:0 8px;font-size:11px;font-weight:400;line-height:20px;display:inline-flex}._Bh55G_shell [class*=runtimeEntryBadges]>[class*=runtimeEntryTarget]{border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, var(--dsw-alias-border-l1));color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-layer-1));font-family:var(--dsw-font-family);font-weight:500}._Bh55G_shell [class*=runtimeEntry][data-importance=critical] [class*=runtimeEntryBadges]>span:last-child{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 24%, var(--dsw-alias-border-l1));color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 6%, var(--dsw-alias-bg-layer-1))}._Bh55G_shell [class*=runtimeEntry] footer{gap:6px}";
		const tagId$5 = "dsh-mnemon-source-runtime/presentation/sidebar.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$5) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = tagId$5;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css$5) tag.textContent = css$5;
		}
		var sidebar_module_css_default$2 = {
			"modal": "_Bh55G_modal",
			"shell": "_Bh55G_shell"
		};
		//#endregion
		//#region \0dsh-mnemon-css:/home/runner/work/dsh-mnemon/dsh-mnemon/plugins/dsh-mnemon-source-documents/presentation/page.module.css.mjs
		const css$4 = ".IIa07q_documentSummary{grid-template-columns:.7fr .7fr 1.6fr;gap:9px;margin-bottom:12px;display:grid}.IIa07q_documentSummary article{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px;min-width:0;min-height:91px;padding:13px 14px}.IIa07q_documentSummary article>span{color:var(--mn-faint);font-size:9px;display:block}.IIa07q_documentSummary article>strong{font:650 21px/1 var(--mn-code);margin:7px 0 4px;display:block}.IIa07q_documentSummary article>small{color:var(--mn-muted);font-size:9px}.IIa07q_documentCapacity>div{background:var(--mn-layer-2);border-radius:999px;height:4px;margin:7px 0 6px;overflow:hidden}.IIa07q_documentCapacity>div i{border-radius:inherit;background:var(--mn-accent);height:100%;transition:width .3s;display:block}.IIa07q_documentToolbar{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px;align-items:center;gap:9px;margin-bottom:12px;padding:9px;display:flex}.IIa07q_documentToolbar form{flex:1;grid-template-columns:20px minmax(0,1fr) auto;align-items:center;gap:5px;min-width:260px;padding-left:8px;display:grid}.IIa07q_documentToolbar form>span{color:var(--mn-faint);font:15px var(--mn-code)}.IIa07q_documentToolbar input,.IIa07q_documentEditor input,.IIa07q_documentEditor textarea{border:1px solid var(--mn-line);background:var(--mn-input);border-radius:8px;outline:0;width:100%;padding:8px 10px}.IIa07q_documentToolbar input{background:0 0;border-color:#0000;height:34px}.IIa07q_documentToolbar input:focus,.IIa07q_documentEditor input:focus,.IIa07q_documentEditor textarea:focus{border-color:var(--mn-accent)}.IIa07q_documentToolbar>div{border:1px solid var(--mn-line);background:var(--mn-layer-2);border-radius:8px;align-items:center;gap:3px;padding:3px;display:flex}.IIa07q_documentToolbar>div button{min-height:32px;color:var(--mn-muted);cursor:pointer;background:0 0;border:0;border-radius:6px;padding:0 10px;font-size:10.5px}.IIa07q_documentToolbar>div button[data-active]{color:var(--mn-text);background:var(--mn-layer-1);box-shadow:0 1px 3px color-mix(in srgb, var(--mn-text) 8%, transparent)}.IIa07q_documentToolbar>div b{color:var(--mn-faint);font:600 9px var(--mn-code);margin-left:4px}.IIa07q_documentWorkspace{grid-template-columns:minmax(250px,310px) minmax(0,1fr);gap:10px;min-height:590px;display:grid}.IIa07q_documentList,.IIa07q_documentReader{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px;min-width:0;overflow:hidden}.IIa07q_documentList{align-self:stretch}.IIa07q_documentList>header{border-bottom:1px solid var(--mn-line);min-height:42px;color:var(--mn-faint);justify-content:space-between;align-items:center;padding:0 12px;font-size:9px;display:flex}.IIa07q_documentList>header code{color:var(--mn-accent)}.IIa07q_documentList>button{--mn-provider-color:var(--mn-faint);border:1px solid var(--mn-line);width:calc(100% - 16px);color:var(--mn-text);background:linear-gradient(90deg, color-mix(in srgb, var(--mn-provider-color) 5%, var(--mn-layer-1)), var(--mn-layer-1) 34%);box-shadow:inset 3px 0 0 color-mix(in srgb, var(--mn-provider-color) 55%, transparent);text-align:left;cursor:pointer;border-radius:8px;margin:8px 8px 0;padding:11px 11px 10px 14px;transition:border-color .15s,background-color .15s,box-shadow .15s;display:block}.IIa07q_documentList>button:hover{--mn-provider-color:var(--mn-accent);border-color:color-mix(in srgb, var(--mn-accent) 28%, var(--mn-line))}.IIa07q_documentList>button[data-selected]{--mn-provider-color:var(--mn-accent);border-color:color-mix(in srgb, var(--mn-accent) 38%, var(--mn-line));background:linear-gradient(90deg, color-mix(in srgb, var(--mn-accent) 7%, var(--mn-layer-1)), var(--mn-layer-1) 38%);box-shadow:inset 3px 0 0 color-mix(in srgb, var(--mn-accent) 78%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--mn-accent) 8%, transparent)}.IIa07q_documentList>button>div{justify-content:space-between;align-items:baseline;gap:12px;display:flex}.IIa07q_documentList>button strong{text-overflow:ellipsis;white-space:nowrap;font-size:12px;overflow:hidden}.IIa07q_documentList>button time{color:var(--mn-faint);font:8px var(--mn-code);flex:none}.IIa07q_documentList>button p{min-height:30px;color:var(--mn-muted);-webkit-line-clamp:2;-webkit-box-orient:vertical;margin:6px 0 9px;font-size:10px;line-height:1.5;display:-webkit-box;overflow:hidden}.IIa07q_documentList>button footer{color:var(--mn-faint);align-items:center;gap:8px;font-size:9px;display:flex}.IIa07q_documentList>button footer code{margin-left:auto}.IIa07q_documentList>button footer em{color:var(--mn-danger);font-style:normal}.IIa07q_documentListEmpty{min-height:230px;color:var(--mn-muted);text-align:center;align-content:center;place-items:center;gap:4px;padding:22px;display:grid}.IIa07q_documentListEmpty>span{color:var(--mn-accent);font:28px var(--mn-code);opacity:.6;margin-bottom:6px}.IIa07q_documentListEmpty p{color:var(--mn-faint);margin:0;font-size:10px}.IIa07q_documentReader{padding:clamp(16px,2vw,22px)}.IIa07q_documentReader>.IIa07q_emptyState{background:0 0;border:0;height:100%}.IIa07q_documentDetail>header{border-bottom:1px solid var(--mn-line);justify-content:space-between;align-items:flex-start;gap:18px;padding-bottom:15px;display:flex}.IIa07q_documentDetail>header span{color:var(--mn-accent);font:650 9px var(--mn-code);letter-spacing:.08em;text-transform:uppercase}.IIa07q_documentDetail>header h3{margin:5px 0 3px;font-size:18px}.IIa07q_documentDetail>header p{color:var(--mn-muted);margin:0;font-size:11px}.IIa07q_documentDetail>dl{border-top:1px solid var(--mn-line);border-left:1px solid var(--mn-line);grid-template-columns:2fr .45fr .8fr .55fr;margin:13px 0;display:grid}.IIa07q_documentDetail>dl>div{border-right:1px solid var(--mn-line);border-bottom:1px solid var(--mn-line);min-width:0;padding:8px 9px}.IIa07q_documentDetail dt{color:var(--mn-faint);margin-bottom:3px;font-size:8px}.IIa07q_documentDetail dd{text-overflow:ellipsis;white-space:nowrap;margin:0;font-size:9px;overflow:hidden}.IIa07q_documentSources{flex-wrap:wrap;align-items:center;gap:5px;margin:11px 0;display:flex}.IIa07q_documentSources>span{color:var(--mn-faint);margin-right:4px;font-size:9px}.IIa07q_documentSources code,.IIa07q_documentArchiveReceipt code{color:var(--mn-muted);background:var(--mn-layer-2);border-radius:5px;padding:3px 6px;font-size:8px}.IIa07q_markdownBody{overflow-wrap:anywhere;border:1px solid var(--mn-line);min-height:310px;color:var(--mn-text);background:color-mix(in srgb, var(--mn-layer-2) 30%, var(--mn-layer-1));border-radius:10px;margin:16px 0 0;padding:clamp(18px,2.5vw,28px);font-size:13px;line-height:1.78}.IIa07q_markdownBody>:first-child{margin-top:0}.IIa07q_markdownBody>:last-child{margin-bottom:0}.IIa07q_markdownBody h1,.IIa07q_markdownBody h2,.IIa07q_markdownBody h3,.IIa07q_markdownBody h4{color:var(--mn-text);letter-spacing:-.015em;margin:1.55em 0 .65em;line-height:1.3}.IIa07q_markdownBody h1{border-bottom:1px solid var(--mn-line);padding-bottom:.35em;font-size:1.75em}.IIa07q_markdownBody h2{border-bottom:1px solid var(--mn-line);padding-bottom:.3em;font-size:1.42em}.IIa07q_markdownBody h3{font-size:1.18em}.IIa07q_markdownBody p,.IIa07q_markdownBody ul,.IIa07q_markdownBody ol,.IIa07q_markdownBody blockquote,.IIa07q_markdownBody table,.IIa07q_markdownBody pre{margin:.85em 0}.IIa07q_markdownBody ul,.IIa07q_markdownBody ol{padding-left:1.6em}.IIa07q_markdownBody li+li{margin-top:.3em}.IIa07q_markdownBody blockquote{border-left:3px solid var(--mn-accent);color:var(--mn-muted);background:color-mix(in srgb, var(--mn-accent) 4%, transparent);margin-inline:0;padding:.15em 1em}.IIa07q_markdownBody code{color:var(--mn-text);background:var(--mn-layer-2);font:.88em/1.55 var(--mn-code);border-radius:5px;padding:.15em .38em}.IIa07q_markdownBody pre{border:1px solid var(--mn-line);background:var(--mn-layer-2);border-radius:9px;max-width:100%;padding:14px 16px;overflow:auto}.IIa07q_markdownBody pre code{background:0 0;padding:0;font-size:11px}.IIa07q_markdownBody a{color:var(--mn-accent);text-underline-offset:3px;text-decoration-thickness:1px}.IIa07q_markdownBody hr{border:0;border-top:1px solid var(--mn-line);margin:1.8em 0}.IIa07q_markdownBody table{border-collapse:collapse;max-width:100%;display:block;overflow-x:auto}.IIa07q_markdownBody th,.IIa07q_markdownBody td{border:1px solid var(--mn-line);text-align:left;vertical-align:top;padding:8px 10px}.IIa07q_markdownBody th{background:var(--mn-layer-2);font-weight:600}.IIa07q_markdownBody img{border-radius:8px;max-width:100%;height:auto}.IIa07q_documentArchiveReceipt{border:1px solid color-mix(in srgb, var(--mn-success) 28%, var(--mn-line));background:color-mix(in srgb, var(--mn-success) 5%, transparent);border-radius:9px;margin:12px 0;padding:11px 12px}.IIa07q_documentArchiveReceipt p{color:var(--mn-muted);margin:4px 0 8px;font-size:10px}.IIa07q_documentArchiveReceipt div{flex-wrap:wrap;gap:5px;display:flex}.IIa07q_documentDanger{border-top:1px solid var(--mn-line);justify-content:flex-end;align-items:center;gap:7px;min-height:57px;margin-top:13px;padding-top:12px;display:flex}.IIa07q_documentDanger>div{margin-right:auto}.IIa07q_documentDanger strong{font-size:11px;display:block}.IIa07q_documentDanger p{color:var(--mn-faint);margin:2px 0 0;font-size:9px}.IIa07q_documentDanger>span{color:var(--mn-danger);margin-right:auto;font-size:10px}.IIa07q_documentEditor{border:1px solid var(--mn-line);background:linear-gradient(135deg, color-mix(in srgb, var(--mn-accent) 5%, var(--mn-layer-1)), var(--mn-layer-1) 55%);border-radius:11px;margin-bottom:12px;padding:15px}.IIa07q_documentReader>.IIa07q_documentEditor{background:0 0;border:0;margin:0;padding:0}.IIa07q_documentEditor>header{justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:12px;display:flex}.IIa07q_documentEditor h3{margin:0;font-size:14px}.IIa07q_documentEditor header p{color:var(--mn-muted);margin:2px 0 0;font-size:10px}.IIa07q_documentEditor header>span,.IIa07q_documentEditor header>code{color:var(--mn-accent);font:650 9px var(--mn-code)}.IIa07q_documentEditor label{color:var(--mn-faint);gap:4px;margin-top:9px;font-size:9px;display:grid}.IIa07q_documentEditor textarea{resize:vertical;line-height:1.65}.IIa07q_documentEditorMeta{grid-template-columns:.8fr 1.2fr;gap:9px;display:grid}.IIa07q_documentEditorMeta label{margin:0}.IIa07q_documentEditor footer{justify-content:flex-end;gap:7px;margin-top:11px;display:flex}@media (width<=1000px){.IIa07q_documentWorkspace{grid-template-columns:minmax(220px,270px) minmax(0,1fr)}.IIa07q_documentDetail>dl{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (width<=760px){.IIa07q_documentSummary{grid-template-columns:repeat(2,minmax(0,1fr))}.IIa07q_documentCapacity{grid-column:1/-1}.IIa07q_documentToolbar{flex-direction:column;align-items:stretch}.IIa07q_documentToolbar form{min-width:0}.IIa07q_documentToolbar>div,.IIa07q_documentToolbar>button{width:100%}.IIa07q_documentToolbar>div button{flex:1}.IIa07q_documentWorkspace{grid-template-columns:1fr;min-height:0}.IIa07q_documentList{-webkit-overflow-scrolling:touch;max-height:330px;overflow:auto}.IIa07q_documentReader{min-height:430px}.IIa07q_documentEditorMeta{grid-template-columns:1fr}}@media (width<=520px){.IIa07q_documentDetail>header,.IIa07q_documentDanger{flex-direction:column;align-items:flex-start}.IIa07q_documentDetail>header>div:last-child,.IIa07q_documentDetail>header button{width:100%}.IIa07q_documentDanger>div,.IIa07q_documentDanger>span{margin-right:0}.IIa07q_documentDanger>button{width:100%}.IIa07q_documentDetail>dl{grid-template-columns:1fr}.IIa07q_markdownBody{padding:16px;font-size:12.5px}}";
		const tagId$4 = "dsh-mnemon-source-documents/presentation/page.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$4) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = tagId$4;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css$4) tag.textContent = css$4;
		}
		var page_module_css_default$1 = {
			"documentArchiveReceipt": "IIa07q_documentArchiveReceipt",
			"documentCapacity": "IIa07q_documentCapacity",
			"documentDanger": "IIa07q_documentDanger",
			"documentDetail": "IIa07q_documentDetail",
			"documentEditor": "IIa07q_documentEditor",
			"documentEditorMeta": "IIa07q_documentEditorMeta",
			"documentList": "IIa07q_documentList",
			"documentListEmpty": "IIa07q_documentListEmpty",
			"documentReader": "IIa07q_documentReader",
			"documentSources": "IIa07q_documentSources",
			"documentSummary": "IIa07q_documentSummary",
			"documentToolbar": "IIa07q_documentToolbar",
			"documentWorkspace": "IIa07q_documentWorkspace",
			"emptyState": "IIa07q_emptyState",
			"markdownBody": "IIa07q_markdownBody"
		};
		//#endregion
		//#region \0dsh-mnemon-css:/home/runner/work/dsh-mnemon/dsh-mnemon/plugins/dsh-mnemon-source-documents/presentation/sidebar.module.css.mjs
		const css$3 = "._Bh55G_shell ._Bh55G_modal form[class*=documentEditor]{background:0 0;border:0;border-radius:0;margin:0;padding:0}._Bh55G_shell ._Bh55G_modal form[class*=documentEditor]>header{display:none}._Bh55G_shell [class*=documentEditor] label{color:var(--dsw-alias-label-secondary);gap:5px;font-size:12px;font-weight:500}._Bh55G_shell [class*=documentEditor] input,._Bh55G_shell [class*=documentEditor] textarea{border:1px solid var(--dsw-alias-border-l2);min-height:34px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:8px;padding:7px 10px;font-size:13px;font-weight:400}._Bh55G_shell [class*=documentList]>button p,._Bh55G_shell [class*=documentDetail]>header p,._Bh55G_shell [class*=documentArchiveReceipt] p{font-size:12px}._Bh55G_shell [class*=documentSummary] article>span,._Bh55G_shell [class*=documentSummary] article>small,._Bh55G_shell [class*=documentList]>header,._Bh55G_shell [class*=documentList]>button time,._Bh55G_shell [class*=documentList]>button footer,._Bh55G_shell [class*=documentDetail] dt,._Bh55G_shell [class*=documentSources]>span{font-size:11px}._Bh55G_shell [class*=documentToolbar]>div button,._Bh55G_shell [class*=documentDetail] dd,._Bh55G_shell [class*=documentDanger] p{font-size:12px}._Bh55G_shell [class*=documentList]>button strong{font-size:13px}._Bh55G_shell [class*=documentWorkspace]{align-items:stretch;height:clamp(520px,100dvh - 220px,760px);min-height:520px}._Bh55G_shell [class*=documentList],._Bh55G_shell [class*=documentReader]{overscroll-behavior:contain;scrollbar-gutter:stable;min-height:0;overflow-y:auto}@media (width<=760px){._Bh55G_shell [class*=documentWorkspace]{height:auto;min-height:0}._Bh55G_shell [class*=documentList]{scrollbar-gutter:auto;overflow-y:auto}._Bh55G_shell [class*=documentReader]{scrollbar-gutter:auto;overflow:visible}}";
		const tagId$3 = "dsh-mnemon-source-documents/presentation/sidebar.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$3) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = tagId$3;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css$3) tag.textContent = css$3;
		}
		var sidebar_module_css_default$1 = {
			"modal": "_Bh55G_modal",
			"shell": "_Bh55G_shell"
		};
		//#endregion
		//#region \0dsh-mnemon-css:/home/runner/work/dsh-mnemon/dsh-mnemon/plugins/dsh-mnemon-source-memory-spaces/presentation/page.module.css.mjs
		const css$2 = ".IIa07q_entityHeading>span,.IIa07q_inspectorHeading>span{color:var(--mn-faint);font:650 9px/1.2 var(--mn-code);letter-spacing:.12em;text-transform:uppercase}.IIa07q_memoryHeaderActions{align-items:center;gap:7px;display:flex}.IIa07q_memoryHeaderActions>button{white-space:nowrap}.IIa07q_asyncRegion{min-width:0;position:relative}.IIa07q_asyncResults{min-width:0;min-height:120px;position:relative}.IIa07q_asyncPlaceholder{border:1px solid var(--mn-line);min-height:220px;color:var(--mn-muted);background:var(--mn-layer-1);border-radius:13px;place-items:center;display:grid;position:relative}.IIa07q_muted{color:var(--mn-faint);padding:16px 0;font-size:12px}.IIa07q_readSources{border:1px solid var(--mn-line);background:color-mix(in srgb, var(--mn-layer-1) 72%, transparent);border-radius:11px;gap:8px;margin:0 0 14px;padding:11px 12px;display:grid}.IIa07q_readSources>header{justify-content:space-between;align-items:flex-start;gap:14px;display:flex}.IIa07q_readSources>header>div{gap:2px;display:grid}.IIa07q_readSources>header strong{font-size:11px}.IIa07q_readSources>header p{max-width:92ch;color:var(--mn-muted);margin:0;font-size:9.5px;line-height:1.45}.IIa07q_readSources>header>button{border:1px solid var(--mn-line);min-height:26px;color:var(--mn-muted);background:var(--mn-layer-2);cursor:pointer;border-radius:7px;flex:none;padding:0 8px;font-size:9px}.IIa07q_readSources>header>button[data-selected]{border-color:color-mix(in srgb, var(--mn-accent) 42%, var(--mn-line));color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 7%, var(--mn-layer-2))}.IIa07q_readSources>div{grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:6px;display:grid}.IIa07q_readSourceCard,.IIa07q_bodyCard,.IIa07q_metadataList>label{border:1px solid var(--mn-line);color:var(--mn-text);background:linear-gradient(90deg, color-mix(in srgb, var(--mn-provider-color) 5%, var(--mn-layer-1)), var(--mn-layer-1) 34%);box-shadow:inset 3px 0 0 color-mix(in srgb, var(--mn-provider-color) 68%, transparent);border-radius:8px}.IIa07q_readSourceCard{text-align:left;grid-template-columns:7px minmax(0,1fr) auto;align-items:center;gap:8px;min-width:0;min-height:58px;padding:7px 8px 7px 11px;display:grid}button.IIa07q_readSourceCard{cursor:pointer}button.IIa07q_readSourceCard:hover{border-color:color-mix(in srgb, var(--mn-provider-color) 32%, var(--mn-line-strong));background:linear-gradient(90deg, color-mix(in srgb, var(--mn-provider-color) 8%, var(--mn-hover)), var(--mn-hover) 40%)}.IIa07q_readSourceCard[data-selected]{border-color:color-mix(in srgb, var(--mn-accent) 48%, var(--mn-line));box-shadow:inset 3px 0 0 var(--mn-provider-color), inset 0 0 0 1px color-mix(in srgb, var(--mn-accent) 10%, transparent)}.IIa07q_readSourceSignal{background:var(--mn-success);width:7px;height:7px;box-shadow:0 0 0 3px color-mix(in srgb, var(--mn-success) 12%, transparent);border-radius:50%}.IIa07q_readSourceCard[data-mode=projection] .IIa07q_readSourceSignal,.IIa07q_readSourceCard[data-mode=enumerable] .IIa07q_readSourceSignal{background:#6574d9;box-shadow:0 0 0 3px #6574d924}.IIa07q_readSourceCard[data-mode=query-only] .IIa07q_readSourceSignal{background:#c38a32;box-shadow:0 0 0 3px #c38a3224}.IIa07q_readSourceCard[data-status=unavailable] .IIa07q_readSourceSignal,.IIa07q_readSourceCard[data-status=unsupported] .IIa07q_readSourceSignal{background:var(--mn-danger);box-shadow:0 0 0 3px color-mix(in srgb, var(--mn-danger) 12%, transparent)}.IIa07q_readSourceCard[data-status=empty] .IIa07q_readSourceSignal{background:var(--mn-faint);box-shadow:0 0 0 3px color-mix(in srgb, var(--mn-faint) 12%, transparent)}.IIa07q_readSourceIdentity,.IIa07q_readSourceState{gap:1px;min-width:0;display:grid}.IIa07q_readSourceIdentity strong{text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;overflow:hidden}.IIa07q_readSourceMeta{align-items:center;gap:5px;min-width:0;margin-top:3px;display:flex}.IIa07q_readSourceMeta>small{color:var(--mn-faint);text-overflow:ellipsis;white-space:nowrap;font-size:8px;overflow:hidden}.IIa07q_readSourceState{text-align:right;justify-items:end}.IIa07q_readSourceState em{width:fit-content;color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 9%, transparent);font:650 8px var(--mn-code);white-space:nowrap;border-radius:999px;padding:2px 5px;font-style:normal}.IIa07q_readSourceState small{color:var(--mn-faint);white-space:nowrap;font-size:8px}.IIa07q_bodyDirectory{border:1px solid var(--mn-line);background:color-mix(in srgb, var(--mn-layer-1) 72%, var(--mn-bg));border-radius:11px;margin-bottom:12px;padding:12px 14px;position:relative}.IIa07q_bodyDirectoryHeader{flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:10px;display:flex}.IIa07q_bodyDirectoryHeader>div:first-child{flex:260px;min-width:0}.IIa07q_bodyDirectoryHeader h3{margin:1px 0;font-size:13px}.IIa07q_bodyDirectoryHeader p{color:var(--mn-muted);margin:0;font-size:10px}.IIa07q_bodyDirectoryPath{max-width:100%;color:var(--mn-faint);text-overflow:ellipsis;white-space:nowrap;margin-top:4px;font-size:9px;display:block;overflow:hidden}.IIa07q_bodyDirectoryControls{flex:none;justify-content:flex-end;align-items:center;gap:6px;padding-right:28px;display:flex}.IIa07q_bodyDirectoryControls>strong{color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 9%, transparent);font:650 9px var(--mn-code);border-radius:999px;flex:none;padding:5px 8px}.IIa07q_bodyGrid{grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:7px;display:grid}.IIa07q_bodyDirectoryEmpty{border:1px dashed color-mix(in srgb, var(--mn-line) 84%, transparent);min-height:92px;color:var(--mn-muted);border-radius:12px;grid-column:1/-1;justify-content:center;align-items:center;gap:14px;display:flex}.IIa07q_bodyDirectoryEmpty>span{opacity:.6;font-size:28px}.IIa07q_bodyDirectoryEmpty strong{color:var(--mn-text);display:block}.IIa07q_bodyDirectoryEmpty p{margin:3px 0 0;font-size:10px}.IIa07q_bodyCard{--mn-body-accent:var(--mn-success);opacity:.72;min-width:0;padding:9px 10px 9px 13px;transition:opacity .18s,border-color .18s,background-color .18s}.IIa07q_bodyCard[data-active]{opacity:1;box-shadow:inset 3px 0 0 color-mix(in srgb, var(--mn-provider-color) 78%, transparent)}.IIa07q_bodyCard[data-reconnectable]{cursor:pointer}.IIa07q_bodyCard[data-reconnectable]:hover{border-color:color-mix(in srgb, var(--mn-provider-color) 46%, var(--mn-line))}.IIa07q_bodyCard[data-reconnectable]:focus-visible{outline:2px solid color-mix(in srgb, var(--mn-accent) 58%, transparent);outline-offset:2px}.IIa07q_bodySignal{background:var(--mn-faint);border-radius:50%;width:7px;height:7px}.IIa07q_bodyCard[data-active] .IIa07q_bodySignal{background:var(--mn-body-accent);box-shadow:0 0 0 4px color-mix(in srgb, var(--mn-body-accent) 14%, transparent)}.IIa07q_bodyCard:not([data-healthy]) .IIa07q_bodySignal{background:var(--mn-danger);box-shadow:0 0 0 4px color-mix(in srgb, var(--mn-danger) 12%, transparent)}.IIa07q_bodyCard[data-status-loading] .IIa07q_bodySignal{background:var(--mn-faint);box-shadow:0 0 0 4px color-mix(in srgb, var(--mn-faint) 12%, transparent)}.IIa07q_bodyCard[data-reconnecting] .IIa07q_bodySignal{box-sizing:border-box;border:1.5px solid color-mix(in srgb, var(--mn-provider-color) 24%, transparent);border-top-color:var(--mn-provider-color);width:7px;height:7px;box-shadow:none;background:0 0;animation:.72s linear infinite IIa07q_mnemon-spin}.IIa07q_bodyHealth{color:var(--mn-success);font:650 8px var(--mn-code);letter-spacing:.07em;text-transform:uppercase}.IIa07q_bodyCard:not([data-healthy]) .IIa07q_bodyHealth{color:var(--mn-danger)}.IIa07q_bodyCard[data-status-loading] .IIa07q_bodyHealth{color:var(--mn-faint)}.IIa07q_mnemonDefaultBadge{border:1px solid color-mix(in srgb, var(--mn-accent) 24%, var(--mn-line));width:fit-content;color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 7%, transparent);font:650 8px var(--mn-code);white-space:nowrap;border-radius:999px;padding:2px 5px}.IIa07q_providerBadge{border:1px solid color-mix(in srgb, var(--mn-provider-color) 34%, var(--mn-line));width:fit-content;max-width:100%;min-height:17px;color:color-mix(in srgb, var(--mn-provider-color) 78%, var(--mn-text));background:color-mix(in srgb, var(--mn-provider-color) 10%, var(--mn-layer-1));font:650 8px/11px var(--mn-code);text-align:center;text-overflow:ellipsis;vertical-align:middle;white-space:nowrap;border-radius:999px;flex:none;justify-content:center;align-items:center;padding:2px 6px;display:inline-flex;overflow:hidden}.IIa07q_providerBadge,.IIa07q_readSourceCard,.IIa07q_bodyCard,.IIa07q_metadataList>label,.IIa07q_graphNode,.IIa07q_providerBadge[data-provider=mnemon-native],.IIa07q_readSourceCard[data-provider=mnemon-native],.IIa07q_bodyCard[data-provider=mnemon-native],.IIa07q_metadataList>label[data-provider=mnemon-native],.IIa07q_graphNode[data-provider=mnemon-native]{--mn-provider-color:#64748b}.IIa07q_providerBadge[data-provider=openviking],.IIa07q_readSourceCard[data-provider=openviking],.IIa07q_bodyCard[data-provider=openviking],.IIa07q_metadataList>label[data-provider=openviking],.IIa07q_graphNode[data-provider=openviking]{--mn-provider-color:#3b82d0}.IIa07q_providerBadge[data-provider=honcho],.IIa07q_readSourceCard[data-provider=honcho],.IIa07q_bodyCard[data-provider=honcho],.IIa07q_metadataList>label[data-provider=honcho],.IIa07q_graphNode[data-provider=honcho]{--mn-provider-color:#c44fcf}.IIa07q_providerBadge[data-provider=mem0],.IIa07q_readSourceCard[data-provider=mem0],.IIa07q_bodyCard[data-provider=mem0],.IIa07q_metadataList>label[data-provider=mem0],.IIa07q_graphNode[data-provider=mem0]{--mn-provider-color:#8b5cf6}.IIa07q_providerBadge[data-provider=hindsight],.IIa07q_readSourceCard[data-provider=hindsight],.IIa07q_bodyCard[data-provider=hindsight],.IIa07q_metadataList>label[data-provider=hindsight],.IIa07q_graphNode[data-provider=hindsight]{--mn-provider-color:#0891b2}.IIa07q_providerBadge[data-provider=holographic],.IIa07q_readSourceCard[data-provider=holographic],.IIa07q_bodyCard[data-provider=holographic],.IIa07q_metadataList>label[data-provider=holographic],.IIa07q_graphNode[data-provider=holographic]{--mn-provider-color:#6366d9}.IIa07q_providerBadge[data-provider=retaindb],.IIa07q_readSourceCard[data-provider=retaindb],.IIa07q_bodyCard[data-provider=retaindb],.IIa07q_metadataList>label[data-provider=retaindb],.IIa07q_graphNode[data-provider=retaindb]{--mn-provider-color:#d08a28}.IIa07q_providerBadge[data-provider=byterover],.IIa07q_readSourceCard[data-provider=byterover],.IIa07q_bodyCard[data-provider=byterover],.IIa07q_metadataList>label[data-provider=byterover],.IIa07q_graphNode[data-provider=byterover]{--mn-provider-color:#0f9a83}.IIa07q_providerBadge[data-provider=supermemory],.IIa07q_readSourceCard[data-provider=supermemory],.IIa07q_bodyCard[data-provider=supermemory],.IIa07q_metadataList>label[data-provider=supermemory],.IIa07q_graphNode[data-provider=supermemory]{--mn-provider-color:#df4d72}.IIa07q_bodySwitch{min-height:32px;color:var(--mn-faint);cursor:pointer;background:0 0;border:0;align-items:center;gap:6px;padding:0 1px;font-size:9.5px;display:flex}.IIa07q_bodySwitchTrack{border:1px solid var(--mn-line-strong);background:var(--mn-layer-2);border-radius:999px;flex:none;width:29px;height:17px;transition:border-color .18s,background-color .18s;position:relative}.IIa07q_bodySwitchTrack i{background:var(--mn-faint);border-radius:50%;width:11px;height:11px;transition:transform .2s cubic-bezier(.2,.8,.2,1),background-color .18s;position:absolute;top:2px;left:2px}.IIa07q_bodySwitch:hover{color:var(--mn-text)}.IIa07q_bodySwitch:hover .IIa07q_bodySwitchTrack{border-color:var(--mn-body-accent)}.IIa07q_bodySwitch[aria-checked=true]{color:var(--mn-text)}.IIa07q_bodySwitch[aria-checked=true] .IIa07q_bodySwitchTrack{border-color:color-mix(in srgb, var(--mn-body-accent) 65%, var(--mn-line));background:color-mix(in srgb, var(--mn-body-accent) 25%, var(--mn-layer-2))}.IIa07q_bodySwitch[aria-checked=true] .IIa07q_bodySwitchTrack i{background:var(--mn-body-accent);transform:translate(12px)}.IIa07q_bodyCardActions{align-items:center;gap:6px;display:flex}.IIa07q_bodyCreateForm{gap:14px;padding-top:0}.IIa07q_createSection{border:1px solid var(--mn-line);background:color-mix(in srgb, var(--mn-layer-2) 42%, var(--mn-layer-1));border-radius:11px;gap:11px;padding:13px;display:grid}.IIa07q_createSectionHeading{align-items:flex-start;gap:9px;display:flex}.IIa07q_createSectionHeading>span{width:25px;height:19px;color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 9%, transparent);font:650 8px var(--mn-code);border-radius:6px;flex:none;place-items:center;display:grid}.IIa07q_createSectionHeading>div{gap:2px;min-width:0;display:grid}.IIa07q_createSectionHeading strong{color:var(--mn-text);font-size:11.5px;line-height:17px}.IIa07q_createSectionHeading small{color:var(--mn-muted);font-size:9px;line-height:1.45}.IIa07q_createIdentityGrid{grid-template-columns:minmax(0,1fr);align-items:stretch;gap:10px;display:grid}.IIa07q_createIdentityGrid>label{align-content:start}.IIa07q_createIdentityGrid textarea{min-height:70px}.IIa07q_strategyForm{gap:14px;padding-top:0}.IIa07q_strategyLoading{border:1px dashed var(--mn-line);min-height:88px;color:var(--mn-muted);border-radius:10px;justify-content:center;align-items:center;font-size:10px;display:flex;position:relative}.IIa07q_strategyLoading .IIa07q_sectionSpinner{top:9px;right:9px}.IIa07q_placementMode{border:0;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:0;padding:0;display:grid}.IIa07q_placementMode legend{color:var(--mn-muted);margin-bottom:5px;font-size:10px}.IIa07q_placementMode label{border:1px solid var(--mn-line);cursor:pointer;background:color-mix(in srgb, var(--mn-layer-2) 62%, transparent);border-radius:9px;grid-template-columns:16px minmax(0,1fr);align-items:center;gap:8px;min-width:0;padding:10px;display:grid;position:relative}.IIa07q_placementMode label[data-selected]{border-color:color-mix(in srgb, var(--mn-accent) 52%, var(--mn-line));background:color-mix(in srgb, var(--mn-accent) 5%, var(--mn-layer-2));box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--mn-accent) 12%, transparent)}.IIa07q_placementMode label[data-disabled]{cursor:not-allowed;opacity:.58}.IIa07q_placementMode input{opacity:0;pointer-events:none;width:1px;height:1px;position:absolute}.IIa07q_placementMode span{gap:3px;display:grid}.IIa07q_placementMode strong{color:var(--mn-text);font-size:11px}.IIa07q_placementMode strong em{color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 10%, transparent);font:650 8px var(--mn-code);border-radius:999px;margin-left:4px;padding:2px 5px;font-style:normal}.IIa07q_placementMode small{color:var(--mn-muted);font-size:9px;line-height:1.45}.IIa07q_placementPolicy{border:1px solid color-mix(in srgb, var(--mn-accent) 26%, var(--mn-line));background:color-mix(in srgb, var(--mn-accent) 4%, var(--mn-layer-1));border-radius:10px;gap:9px;margin:0;padding:11px;display:grid}.IIa07q_placementPolicyHeading{justify-content:space-between;align-items:flex-start;gap:12px;display:flex}.IIa07q_placementPolicyHeading>div{gap:2px;display:grid}.IIa07q_placementPolicyHeading strong{font-size:11px}.IIa07q_placementPolicyHeading small{color:var(--mn-muted);font-size:9px;line-height:1.45}.IIa07q_placementPolicyHeading>span{border:1px solid color-mix(in srgb, var(--mn-accent) 22%, var(--mn-line));color:var(--mn-accent);font:650 8px var(--mn-code);border-radius:999px;flex:none;padding:3px 6px}.IIa07q_placementRuleGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;display:grid}.IIa07q_capabilityRules{border:0;flex-wrap:wrap;gap:6px;margin:0;padding:0;display:flex}.IIa07q_capabilityRules legend{width:100%;color:var(--mn-faint);margin-bottom:1px;font-size:9px}.IIa07q_capabilityRules label{border:1px solid var(--mn-line);width:fit-content;color:var(--mn-muted);background:var(--mn-input);cursor:pointer;border-radius:8px;align-items:center;gap:6px;padding:6px 8px;display:flex;position:relative}.IIa07q_capabilityRules label[data-selected]{border-color:color-mix(in srgb, var(--mn-accent) 42%, var(--mn-line));color:var(--mn-text);background:color-mix(in srgb, var(--mn-accent) 7%, var(--mn-input))}.IIa07q_capabilityRules input{opacity:0;pointer-events:none;width:1px;height:1px;position:absolute}.IIa07q_placementCandidates{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;display:grid}.IIa07q_placementCandidates>span,.IIa07q_placementCandidates>label{border:1px solid var(--mn-line);background:color-mix(in srgb, var(--mn-layer-2) 70%, transparent);border-radius:8px;grid-template-columns:28px minmax(0,1fr) 16px;align-items:center;gap:8px;min-width:0;padding:8px 9px;display:grid;position:relative}.IIa07q_placementCandidates>label{cursor:pointer}.IIa07q_placementCandidates>[data-selected]{border-color:color-mix(in srgb, var(--mn-accent) 38%, var(--mn-line));background:color-mix(in srgb, var(--mn-accent) 7%, transparent)}.IIa07q_placementCandidates>label[data-disabled]{cursor:not-allowed;opacity:.48}.IIa07q_placementCandidates input{opacity:0;pointer-events:none;width:1px;height:1px;position:absolute}.IIa07q_placementCandidates>span>span:not(.IIa07q_candidateIcon),.IIa07q_placementCandidates>label>span:not(.IIa07q_candidateIcon){gap:2px;min-width:0;display:grid}.IIa07q_placementCandidates strong{color:var(--mn-text);font-size:10px}.IIa07q_placementCandidates small{color:var(--mn-muted);font-size:8.5px;line-height:1.4}.IIa07q_providerChoice{border:0;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0;padding:0;display:grid}.IIa07q_providerChoice legend{color:var(--mn-muted);margin-bottom:5px;font-size:10px}.IIa07q_providerChoice label{border:1px solid var(--mn-line);cursor:pointer;background:color-mix(in srgb, var(--mn-layer-2) 72%, transparent);border-radius:9px;grid-template-columns:32px minmax(0,1fr) 16px;align-items:center;gap:9px;min-width:0;padding:10px;display:grid;position:relative}.IIa07q_providerChoice label[data-native]{border-color:color-mix(in srgb, var(--mn-accent) 20%, var(--mn-line));grid-column:1/-1}.IIa07q_providerChoice label[data-selected]{border-color:color-mix(in srgb, var(--mn-accent) 48%, var(--mn-line));background:color-mix(in srgb, var(--mn-accent) 5%, var(--mn-layer-2));box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--mn-accent) 12%, transparent)}.IIa07q_providerChoice label[data-disabled]{cursor:not-allowed;opacity:.5}.IIa07q_providerChoice input{opacity:0;pointer-events:none;width:1px;height:1px;position:absolute}.IIa07q_providerChoice span{gap:3px;display:grid}.IIa07q_providerChoice strong{color:var(--mn-text);font-size:11px}.IIa07q_providerChoice strong em{color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 10%, transparent);font:650 8px var(--mn-code);border-radius:999px;margin-left:5px;padding:2px 5px;font-style:normal}.IIa07q_providerChoice small{color:var(--mn-muted);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:9px;line-height:1.45;display:-webkit-box;overflow:hidden}.IIa07q_providerChoiceIcon,.IIa07q_candidateIcon,.IIa07q_providerFieldIcon{box-sizing:border-box;border:1px solid var(--mn-line);background:var(--mn-layer-1);place-items:center;display:grid;overflow:hidden}.IIa07q_providerChoiceIcon{border-radius:8px;width:32px;height:32px;padding:3px}.IIa07q_candidateIcon{border-radius:7px;width:28px;height:28px;padding:3px}.IIa07q_providerFieldIcon{border-radius:8px;flex:none;width:30px;height:30px;padding:3px}.IIa07q_providerChoiceIcon>img,.IIa07q_providerChoiceIcon>svg,.IIa07q_candidateIcon>img,.IIa07q_candidateIcon>svg,.IIa07q_providerFieldIcon>img,.IIa07q_providerFieldIcon>svg{object-fit:contain;border-radius:5px;width:100%;height:100%;display:block}.IIa07q_choiceControl{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--mn-muted) 52%, var(--mn-line));background:var(--mn-layer-1);border-radius:5px;flex:none;place-items:center;width:16px;height:16px;display:grid;position:relative}.IIa07q_choiceControl[data-kind=radio]{border-radius:50%}[data-selected]>.IIa07q_choiceControl{border-color:var(--mn-accent);background:var(--mn-accent)}[data-selected]>.IIa07q_choiceControl[data-kind=check]:after{content:\"\";border-bottom:1.5px solid #fff;border-left:1.5px solid #fff;width:7px;height:4px;transform:translateY(-1px)rotate(-45deg)}[data-selected]>.IIa07q_choiceControl[data-kind=radio]:after{content:\"\";background:#fff;border-radius:50%;width:6px;height:6px}.IIa07q_placementMode label:focus-within,.IIa07q_providerChoice label:focus-within,.IIa07q_capabilityRules label:focus-within,.IIa07q_placementCandidates label:focus-within{outline:2px solid color-mix(in srgb, var(--mn-accent) 28%, transparent);outline-offset:1px}.IIa07q_providerFields{border:1px solid color-mix(in srgb, #6574d9 25%, var(--mn-line));background:#6574d90d;border-radius:9px;gap:8px;padding:10px;display:grid}.IIa07q_providerFieldHeading{justify-content:space-between;align-items:flex-start;gap:12px;display:flex}.IIa07q_providerFieldIdentity{align-items:center;gap:8px;min-width:0;display:flex}.IIa07q_providerFieldIdentity>div{gap:2px;min-width:0;display:grid}.IIa07q_providerFieldHeading strong{color:var(--mn-text);font-size:11px}.IIa07q_providerFieldHeading small{color:var(--mn-muted);font-size:9px;line-height:1.45}.IIa07q_providerFieldHeading>span{border:1px solid color-mix(in srgb, #6574d9 24%, var(--mn-line));color:color-mix(in srgb, #8793ef 80%, var(--mn-text));font:650 8px var(--mn-code);border-radius:999px;flex:none;padding:3px 6px}.IIa07q_providerFields details{min-width:0}.IIa07q_providerFields summary{width:fit-content;color:var(--mn-accent);cursor:pointer;font-size:9px}.IIa07q_providerAdvancedGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px;display:grid}.IIa07q_providerFieldControl .IIa07q_providerSecretClear{color:var(--mn-muted);cursor:pointer;align-items:center;gap:5px;font-size:8.5px;display:flex}.IIa07q_providerWriteHint{color:color-mix(in srgb, #8793ef 72%, var(--mn-muted));margin-top:4px;font-size:9px;line-height:1.45;display:block}.IIa07q_placementReceipt{border:1px solid color-mix(in srgb, var(--mn-accent) 20%, var(--mn-line));min-width:0;color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 4%, transparent);border-radius:8px;align-items:flex-start;gap:7px;margin:7px 0;padding:7px 8px;display:flex}.IIa07q_placementReceipt>span{flex:none;font-size:10px}.IIa07q_placementReceipt>div{grid-template-columns:minmax(0,1fr) auto;gap:2px 8px;min-width:0;display:grid}.IIa07q_placementReceipt strong,.IIa07q_placementReceipt small{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.IIa07q_placementReceipt strong{font-size:9px}.IIa07q_placementReceipt small{color:var(--mn-muted);font-size:8px}.IIa07q_placementReceipt p{color:var(--mn-muted);text-overflow:ellipsis;white-space:nowrap;grid-column:1/-1;margin:0;font-size:8.5px;line-height:1.4;overflow:hidden}.IIa07q_bodyCard>p{min-height:15px;color:var(--mn-muted);margin:7px 0;font-size:10px;line-height:1.45}.IIa07q_bodyCard footer{border-top:1px solid var(--mn-line);min-width:0;color:var(--mn-faint);flex-wrap:nowrap;gap:5px 11px;padding-top:6px;font-size:9px;display:flex;overflow:hidden}.IIa07q_bodyFooterBlock{text-overflow:ellipsis;white-space:nowrap;flex:0 auto;min-width:0;display:block;overflow:hidden}.IIa07q_bodyFooterGrow{flex:auto}.IIa07q_graphLayout{grid-template-columns:minmax(0,1fr) minmax(240px,270px);gap:10px;display:grid}.IIa07q_graphPanel,.IIa07q_graphInspector{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px}.IIa07q_graphPanel{min-width:0;position:relative;overflow:hidden}.IIa07q_graphToolbar,.IIa07q_graphFooter{min-height:43px;color:var(--mn-muted);justify-content:space-between;align-items:center;gap:14px;padding:0 13px;font-size:10px;display:flex}.IIa07q_graphToolbar{border-bottom:1px solid var(--mn-line)}.IIa07q_graphToolbar>div:first-child{align-items:center;gap:7px;display:flex}.IIa07q_graphToolbar small{color:var(--mn-faint)}.IIa07q_liveDot{background:var(--mn-success);width:6px;height:6px;box-shadow:0 0 0 3px color-mix(in srgb, var(--mn-success) 15%, transparent);border-radius:50%}.IIa07q_graphLegend{flex-wrap:wrap;justify-content:flex-end;gap:5px 10px;display:flex}.IIa07q_graphLegend span{align-items:center;gap:4px;display:flex}.IIa07q_graphLegend span:before{content:\"\";background:var(--edge-color);border-radius:2px;width:13px;height:2px}.IIa07q_graphLegend [data-edge=temporal]{--edge-color:#87909f}.IIa07q_graphLegend [data-edge=scope]{--edge-color:#708199}.IIa07q_graphLegend [data-edge=scope]:before{background:repeating-linear-gradient(90deg, var(--edge-color) 0 4px, transparent 4px 7px)}.IIa07q_graphLegend [data-edge=semantic]{--edge-color:#4d7cfe}.IIa07q_graphLegend [data-edge=causal]{--edge-color:#ef6b5b}.IIa07q_graphLegend [data-edge=entity]{--edge-color:#22a879}.IIa07q_graphViewport{background:radial-gradient(circle at 50% 48%, color-mix(in srgb, var(--mn-accent) 6%, transparent), transparent 47%);min-height:clamp(390px,42vw,560px);position:relative;overflow:hidden}.IIa07q_graphCanvasControls{z-index:2;border:1px solid var(--mn-line);background:color-mix(in srgb, var(--mn-layer-1) 88%, transparent);box-shadow:0 6px 18px color-mix(in srgb, var(--mn-text) 7%, transparent);backdrop-filter:blur(10px);border-radius:9px;align-items:center;gap:5px;padding:4px;display:flex;position:absolute;top:10px;right:10px}.IIa07q_graphCanvasControls span{color:var(--mn-faint);font:9px var(--mn-code);align-items:center;gap:5px;padding:0 6px;display:flex}.IIa07q_graphCanvasControls span i{background:var(--mn-accent);width:5px;height:5px;box-shadow:0 0 0 3px color-mix(in srgb, var(--mn-accent) 12%, transparent);border-radius:50%}.IIa07q_graphCanvasControls button{min-height:30px;color:var(--mn-muted);cursor:pointer;background:0 0;border:1px solid #0000;border-radius:6px;padding:0 9px;font-size:9.5px}.IIa07q_graphCanvasControls button:hover,.IIa07q_graphCanvasControls button[data-active]{border-color:var(--mn-line);color:var(--mn-text);background:var(--mn-hover)}.IIa07q_graphCanvasControls button[data-active]{color:var(--mn-accent)}.IIa07q_graphSvg{touch-action:pan-y pinch-zoom;user-select:none;width:100%;height:clamp(390px,42vw,560px);display:block}.IIa07q_graphBackdrop{fill:var(--mn-layer-1)}.IIa07q_graphGridLine{stroke:var(--mn-line);stroke-width:.6px;opacity:.5}.IIa07q_graphEdge{fill:none;stroke:#87909f;stroke-width:1px;opacity:.32;vector-effect:non-scaling-stroke}.IIa07q_graphEdge[data-edge=scope]{stroke:#708199;stroke-dasharray:4 5;opacity:.28}.IIa07q_graphEdge[data-edge=semantic]{stroke:#4d7cfe;opacity:.48}.IIa07q_graphEdge[data-edge=causal]{stroke:#ef6b5b;opacity:.52}.IIa07q_graphEdge[data-edge=entity]{stroke:#22a879;stroke-width:1.45px;opacity:.78}.IIa07q_graphNode{--node:#8290a8;cursor:grab;touch-action:none;outline:none}.IIa07q_graphNode[data-dragging]{cursor:grabbing}.IIa07q_graphNode[data-category=decision]{--node:#ef8354}.IIa07q_graphNode[data-category=preference]{--node:#a879e1}.IIa07q_graphNode[data-category=fact]{--node:#4d7cfe}.IIa07q_graphNode[data-category=insight]{--node:#19a77d}.IIa07q_graphNode[data-category=context]{--node:#d8a624}.IIa07q_graphNode[data-kind=space]{--node:var(--mn-provider-color)}.IIa07q_graphNode[data-kind=entity]{--node:#2b9db9}.IIa07q_nodeHalo{fill:color-mix(in srgb, var(--node) 18%, var(--mn-layer-1));stroke:color-mix(in srgb, var(--node) 60%, var(--mn-layer-1));stroke-width:1.5px;transition:r .16s}.IIa07q_nodeCore{fill:var(--node)}.IIa07q_nodeLabel{fill:var(--mn-muted);font:10px var(--mn-code);pointer-events:auto}.IIa07q_nodeBodyLabel{fill:var(--mn-faint);font:650 8px var(--mn-code);letter-spacing:.04em;pointer-events:auto}.IIa07q_graphSvg[data-density=sparse] .IIa07q_nodeLabel{font-size:12px}.IIa07q_graphNode:hover .IIa07q_nodeHalo,.IIa07q_graphNode:focus .IIa07q_nodeHalo,.IIa07q_graphNode[data-selected] .IIa07q_nodeHalo{fill:color-mix(in srgb, var(--node) 28%, var(--mn-layer-1));stroke:var(--node)}.IIa07q_graphNode[data-selected] .IIa07q_nodeLabel{fill:var(--mn-text);font-weight:650}.IIa07q_graphFooter{border-top:1px solid var(--mn-line);min-height:38px;color:var(--mn-faint)}.IIa07q_graphInspector{min-width:0;min-height:calc(clamp(390px,42vw,560px) + 83px);padding:15px;overflow:hidden}.IIa07q_inspectorEmpty{text-align:center;flex-direction:column;justify-content:center;align-items:center;height:100%;display:flex}.IIa07q_inspectorLogo{opacity:.72;border-radius:11px;width:54px;height:54px;margin-bottom:15px}.IIa07q_inspectorEmpty h3{margin:7px 0 3px;font-size:14px}.IIa07q_inspectorEmpty p{color:var(--mn-faint);margin:0;font-size:11px}.IIa07q_inspectorHeading{justify-content:space-between;align-items:center;display:flex}.IIa07q_inspectorHeading button{width:32px;height:32px;color:var(--mn-muted);cursor:pointer;background:0 0;border:0;border-radius:7px;place-items:center;display:grid}.IIa07q_inspectorHeading button:hover{background:var(--mn-hover)}.IIa07q_inspectorChips{flex-wrap:wrap;align-items:center;gap:6px;margin-top:24px;display:flex}.IIa07q_categoryChip{color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 10%, transparent);border-radius:999px;padding:3px 8px;font-size:10px;display:inline-flex}.IIa07q_inspectorTitleRow{align-items:flex-start;gap:8px;min-width:0;margin:12px 0 20px;display:flex}.IIa07q_inspectorTitle{overflow-wrap:anywhere;white-space:pre-wrap;-webkit-line-clamp:6;-webkit-box-orient:vertical;flex:1;min-width:0;margin:0;font-size:14px;line-height:1.6;display:-webkit-box;overflow:hidden}.IIa07q_inspectorEye{border:1px solid var(--mn-line);width:27px;height:27px;color:var(--mn-muted);background:var(--mn-layer-1);cursor:pointer;border-radius:7px;flex:none;place-items:center;transition:color .15s,border-color .15s,background-color .15s;display:grid}.IIa07q_inspectorEye:hover{color:var(--mn-accent);border-color:var(--mn-line-strong);background:var(--mn-hover)}.IIa07q_inspectorMeta{margin:0}.IIa07q_inspectorMeta>div{border-top:1px solid var(--mn-line);gap:3px;padding:11px 0;display:grid}.IIa07q_inspectorMeta dt{color:var(--mn-faint);font:9px var(--mn-code);text-transform:uppercase}.IIa07q_inspectorMeta dd{overflow-wrap:anywhere;color:var(--mn-muted);margin:0;font-size:11px}.IIa07q_inspectorActions{gap:8px;margin-top:20px;display:grid}.IIa07q_previewContent{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--mn-text);margin:0;font-size:13px;line-height:1.7}.IIa07q_searchBar{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:13px;margin-bottom:18px;padding:13px}.IIa07q_queryField{border:1px solid var(--mn-line-strong);background:var(--mn-input);border-radius:9px;grid-template-columns:24px minmax(0,1fr) 24px;align-items:center;gap:5px;padding:0 10px;display:grid}.IIa07q_queryField>span{color:var(--mn-accent);font:18px var(--mn-code)}.IIa07q_queryField input{background:0 0;border:0;outline:0;width:100%;height:42px}.IIa07q_queryField kbd{color:var(--mn-faint);font:11px var(--mn-code)}.IIa07q_searchControls{justify-content:flex-end;align-items:flex-end;gap:10px;padding-top:10px;display:flex}.IIa07q_searchActions{align-items:center;gap:7px;display:flex}.IIa07q_agentAnswer{border:1px solid color-mix(in srgb, var(--mn-accent) 30%, var(--mn-line));background:linear-gradient(135deg, color-mix(in srgb, var(--mn-accent) 7%, var(--mn-layer-1)), var(--mn-layer-1) 60%);border-radius:11px;margin-bottom:16px;padding:16px 18px}.IIa07q_agentAnswerHeading{justify-content:space-between;align-items:flex-start;gap:16px;display:flex}.IIa07q_agentAnswerHeading span{color:var(--mn-accent);font:650 9px/1.2 var(--mn-code);letter-spacing:.08em}.IIa07q_agentAnswerHeading h3{margin:4px 0 0;font-size:15px}.IIa07q_agentAnswerHeading>code{color:var(--mn-faint);font-size:9px}.IIa07q_agentAnswer>p{white-space:pre-wrap;color:var(--mn-text);margin:12px 0;font-size:13px;line-height:1.7}.IIa07q_agentCitations{border-top:1px solid var(--mn-line);flex-wrap:wrap;gap:5px;padding-top:10px;display:flex}.IIa07q_agentCitations code{color:var(--mn-muted);background:var(--mn-layer-2);border-radius:5px;padding:3px 6px;font-size:9px}.IIa07q_searchControls label,.IIa07q_fieldWide{color:var(--mn-muted);gap:5px;font-size:11px;display:grid}.IIa07q_searchControls select,.IIa07q_listToolbar input,.IIa07q_listToolbar select,.IIa07q_entitySearch input{border:1px solid var(--mn-line);background:var(--mn-input);border-radius:8px;outline:0;min-width:140px;height:34px;padding:0 9px}.IIa07q_searchControls select:focus,.IIa07q_listToolbar input:focus,.IIa07q_listToolbar select:focus,.IIa07q_entitySearch input:focus,.IIa07q_supervisedForm textarea:focus{border-color:var(--mn-accent)}.IIa07q_singleColumn{max-width:830px}.IIa07q_resultLayout{grid-template-columns:minmax(0,1.15fr) minmax(300px,.85fr);align-items:start;gap:14px;display:grid}.IIa07q_results,.IIa07q_relatedPane,.IIa07q_entityResults{min-width:0}.IIa07q_relatedPane{border:1px solid var(--mn-line);background:var(--mn-layer-1);-webkit-overflow-scrolling:touch;border-radius:12px;max-height:calc(100dvh - 230px);padding:13px;scroll-margin-top:14px;position:sticky;top:12px;overflow:auto}.IIa07q_relatedSource{color:var(--mn-muted);background:var(--mn-layer-2);border-radius:8px;margin:0 0 13px;padding:10px;font-size:11px}.IIa07q_insightCard{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px;min-width:0;margin-bottom:9px;padding:14px;transition:border-color .15s,transform .15s,box-shadow .15s}.IIa07q_insightCard:hover{border-color:var(--mn-line-strong);transform:translateY(-1px)}.IIa07q_cardTop{justify-content:space-between;align-items:center;gap:10px;display:flex}.IIa07q_badges,.IIa07q_tags,.IIa07q_entities{flex-wrap:wrap;gap:5px;display:flex}.IIa07q_badge{color:var(--mn-muted);background:var(--mn-layer-2);border-radius:999px;padding:2px 6px;font-size:9px}.IIa07q_id{color:var(--mn-faint);font:9px var(--mn-code)}.IIa07q_content{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0;line-height:1.65}.IIa07q_tags{color:var(--mn-accent);font-size:10px}.IIa07q_entities{margin-top:7px}.IIa07q_entities span{border:1px solid var(--mn-line);color:var(--mn-muted);border-radius:5px;padding:2px 6px;font-size:9px}.IIa07q_cardActions{border-top:1px solid var(--mn-line);justify-content:flex-end;align-items:center;gap:3px;min-height:30px;margin-top:10px;padding-top:8px;display:flex}.IIa07q_entityLayout{grid-template-columns:265px minmax(0,1fr);align-items:start;gap:16px;display:grid}.IIa07q_entityRail{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:12px;padding:13px;position:sticky;top:0}.IIa07q_entitySearch{grid-template-columns:minmax(0,1fr) auto;gap:7px;display:grid}.IIa07q_entitySearch input{min-width:0}.IIa07q_entityHeading{justify-content:space-between;align-items:center;margin:18px 2px 7px;display:flex}.IIa07q_entityHeading small{color:var(--mn-faint);font-size:9px}.IIa07q_entityList{gap:3px;display:grid}.IIa07q_entityList button{min-height:34px;color:var(--mn-muted);cursor:pointer;text-align:left;background:0 0;border:0;border-radius:7px;justify-content:space-between;align-items:center;gap:10px;padding:0 9px;display:flex}.IIa07q_entityList button:hover,.IIa07q_entityList button[aria-pressed=true]{color:var(--mn-text);background:var(--mn-hover)}.IIa07q_entityList button>span{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;overflow:hidden}.IIa07q_entityList strong{color:var(--mn-faint);font:10px var(--mn-code);flex:none}.IIa07q_entityResults>.IIa07q_emptyState{min-height:360px}.IIa07q_supervisedComposer{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:12px;overflow:hidden}.IIa07q_supervisedForm{padding:18px}.IIa07q_supervisedHeading{justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px;display:flex}.IIa07q_supervisedHeading h3{margin:4px 0 0;font-size:17px}.IIa07q_sessionReady,.IIa07q_sessionMissing{font:650 9px var(--mn-code);border-radius:999px;padding:4px 8px}.IIa07q_sessionReady{color:var(--mn-success);background:color-mix(in srgb, var(--mn-success) 10%, transparent)}.IIa07q_sessionMissing{color:var(--mn-danger);background:color-mix(in srgb, var(--mn-danger) 10%, transparent)}.IIa07q_supervisedForm textarea{resize:vertical;border:1px solid var(--mn-line);width:100%;color:var(--mn-text);background:var(--mn-input);border-radius:9px;outline:0;padding:12px;line-height:1.65}.IIa07q_sessionHint{color:var(--mn-danger);margin:9px 0 0;font-size:11px}.IIa07q_fieldWide{grid-column:1/-1}.IIa07q_advancedWrite{border-top:1px solid var(--mn-line);background:color-mix(in srgb, var(--mn-layer-2) 45%, var(--mn-layer-1))}.IIa07q_advancedWrite summary{cursor:pointer;justify-content:space-between;align-items:center;gap:16px;min-height:58px;padding:10px 18px;list-style:none;display:flex}.IIa07q_advancedWrite summary::-webkit-details-marker{display:none}.IIa07q_advancedWrite summary>span:first-child{gap:2px;display:grid}.IIa07q_advancedWrite summary strong{font-size:12px}.IIa07q_advancedWrite summary small{color:var(--mn-faint);font-size:10px}.IIa07q_advancedWrite summary>span:last-child{color:var(--mn-accent);font:10px var(--mn-code)}.IIa07q_advancedWrite[open] summary{border-bottom:1px solid var(--mn-line)}.IIa07q_advancedWrite[open] summary>span:last-child{font-size:0}.IIa07q_advancedWrite[open] summary>span:last-child:after{content:\"−\";font-size:13px}.IIa07q_manualForm{padding:3px 18px 18px}.IIa07q_manualActions{justify-content:space-between;align-items:center;gap:14px;margin-top:15px;display:flex}.IIa07q_manualActions p{max-width:520px;color:var(--mn-faint);margin:0;font-size:10px}.IIa07q_listToolbar{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px;grid-template-columns:minmax(0,1fr) 170px auto;gap:9px;padding:12px;display:grid}.IIa07q_listToolbar input,.IIa07q_listToolbar select{width:100%;min-width:0}.IIa07q_listNotice{color:var(--mn-faint);margin:10px 0 16px;font-size:10px}.IIa07q_listNotice span{color:var(--mn-success);font:650 9px var(--mn-code);letter-spacing:.08em;margin-right:7px}.IIa07q_memoryList{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:9px;display:grid}.IIa07q_memoryList .IIa07q_insightCard{height:100%;margin:0}.IIa07q_modalFooterNote{max-width:54ch;color:var(--mn-muted);margin:0 auto 0 0;font-size:9px;line-height:1.5}.IIa07q_modalInlineStatus{color:var(--mn-muted);overflow-wrap:anywhere;margin:12px 0 0;font-size:11px;line-height:1.5}.IIa07q_metadataDialog{gap:12px;display:grid}.IIa07q_metadataToolbar{color:var(--mn-muted);justify-content:space-between;align-items:center;gap:12px;font-size:10px;display:flex}.IIa07q_metadataToolbar>span{align-items:center;gap:7px;min-width:0;display:flex}.IIa07q_metadataToolbar em{color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 9%, transparent);font:650 8px var(--mn-code);border-radius:999px;padding:2px 5px;font-style:normal}.IIa07q_metadataList{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;display:grid}.IIa07q_metadataEmpty{border:1px dashed var(--mn-line);color:var(--mn-muted);background:color-mix(in srgb, var(--mn-layer-2) 76%, transparent);text-align:center;border-radius:8px;grid-column:1/-1;padding:18px;font-size:10px}.IIa07q_metadataList>label{cursor:pointer;grid-template-columns:16px minmax(0,1fr);align-items:start;gap:9px;min-width:0;min-height:76px;padding:10px 10px 10px 13px;display:grid;position:relative}.IIa07q_metadataList>label[data-selected]{border-color:color-mix(in srgb, var(--mn-accent) 48%, var(--mn-line));box-shadow:inset 3px 0 0 var(--mn-provider-color), inset 0 0 0 1px color-mix(in srgb, var(--mn-accent) 10%, transparent)}.IIa07q_metadataList>label[data-refreshing]{overflow:hidden}.IIa07q_metadataList>label[data-refreshing]:after{content:\"\";background:linear-gradient(105deg, transparent 20%, color-mix(in srgb, var(--mn-provider-color) 16%, transparent) 45%, transparent 70%);pointer-events:none;animation:.9s ease-in-out infinite IIa07q_mnemon-metadata-sweep;position:absolute;inset:0;transform:translate(-120%)}.IIa07q_metadataList>label[data-refreshed]{animation:.9s ease-out IIa07q_mnemon-metadata-refreshed}.IIa07q_metadataList>label[data-failed]{border-color:color-mix(in srgb, var(--mn-danger) 42%, var(--mn-line))}.IIa07q_metadataList>label>input{opacity:0;pointer-events:none;width:1px;height:1px;position:absolute}.IIa07q_metadataList>label>span{gap:4px;min-width:0;display:grid}.IIa07q_metadataList strong{text-overflow:ellipsis;white-space:nowrap;font-size:11px;overflow:hidden}.IIa07q_metadataList small{color:var(--mn-muted);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:9px;line-height:1.45;display:-webkit-box;overflow:hidden}.IIa07q_metadataList>label>span>span{align-items:center;gap:6px;min-width:0;display:flex}.IIa07q_metadataList code{color:var(--mn-faint);font:8px var(--mn-code);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.IIa07q_metadataTaskStatus{min-width:0;font:650 8px var(--mn-code);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.IIa07q_metadataTaskStatus[data-status=running]{color:var(--mn-provider-color)}.IIa07q_metadataTaskStatus[data-status=success]{color:var(--mn-success)}.IIa07q_metadataTaskStatus[data-status=error]{color:var(--mn-danger)}@media (prefers-reduced-motion:reduce){.IIa07q_metadataList>label[data-refreshing]:after,.IIa07q_metadataList>label[data-refreshed]{animation:none}}@media (width<=1000px){.IIa07q_graphLayout{display:block;position:relative}.IIa07q_graphInspector{width:auto;min-height:0;box-shadow:none;margin-top:10px;position:static;overflow:visible}.IIa07q_graphInspector[data-empty]{display:none}.IIa07q_resultLayout{grid-template-columns:1fr}.IIa07q_relatedPane{grid-row:1;max-height:none;position:static}.IIa07q_memoryList{grid-template-columns:1fr}}@media (width<=760px){.IIa07q_metadataList{grid-template-columns:1fr}.IIa07q_modalFooterNote{max-width:none;margin:0;font-size:10px}.IIa07q_modal .IIa07q_supervisedForm textarea{min-height:clamp(130px,30vh,210px)}.IIa07q_entityLayout{grid-template-columns:1fr}.IIa07q_manualActions{flex-direction:column;align-items:stretch}.IIa07q_entityRail{position:static}.IIa07q_searchControls{grid-template-columns:repeat(2,minmax(0,1fr));display:grid}.IIa07q_searchActions{grid-column:1/-1}.IIa07q_searchActions>button{flex:1}.IIa07q_searchControls select{width:100%;min-width:0}.IIa07q_listToolbar{grid-template-columns:1fr}.IIa07q_bodyDirectoryHeader{grid-template-columns:minmax(0,1fr);display:grid}.IIa07q_bodyDirectoryHeader>div{min-width:0}.IIa07q_bodyDirectoryPath{max-width:100%}.IIa07q_bodyDirectoryControls{flex-wrap:wrap;justify-content:flex-start;padding-right:0}.IIa07q_createIdentityGrid,.IIa07q_placementMode,.IIa07q_placementRuleGrid,.IIa07q_placementCandidates,.IIa07q_providerChoice,.IIa07q_providerAdvancedGrid{grid-template-columns:1fr}.IIa07q_graphViewport{min-height:360px}.IIa07q_graphSvg{height:390px}.IIa07q_graphCanvasControls{top:7px;right:7px}.IIa07q_graphCanvasControls span{display:none}}@media (width<=520px){.IIa07q_memoryHeaderActions{width:100%}.IIa07q_memoryHeaderActions>button{flex:1}.IIa07q_supervisedHeading,.IIa07q_cardTop{flex-direction:column;align-items:flex-start}.IIa07q_cardActions{flex-wrap:wrap;align-items:stretch}.IIa07q_cardActions button{flex:1}.IIa07q_searchControls{grid-template-columns:1fr}}@supports (height:100dvh){@media (width<=760px){.IIa07q_modal .IIa07q_supervisedForm textarea{min-height:clamp(130px,30dvh,210px)}}}@media (width<=1000px) and (height<=760px){.IIa07q_graphViewport{min-height:300px}.IIa07q_graphSvg{height:300px}}@media (prefers-reduced-motion:reduce){.IIa07q_insightCard:hover{transform:none}}";
		const tagId$2 = "dsh-mnemon-source-memory-spaces/presentation/page.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = tagId$2;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css$2) tag.textContent = css$2;
		}
		var page_module_css_default = {
			"advancedWrite": "IIa07q_advancedWrite",
			"agentAnswer": "IIa07q_agentAnswer",
			"agentAnswerHeading": "IIa07q_agentAnswerHeading",
			"agentCitations": "IIa07q_agentCitations",
			"asyncPlaceholder": "IIa07q_asyncPlaceholder",
			"asyncRegion": "IIa07q_asyncRegion",
			"asyncResults": "IIa07q_asyncResults",
			"badge": "IIa07q_badge",
			"badges": "IIa07q_badges",
			"bodyCard": "IIa07q_bodyCard",
			"bodyCardActions": "IIa07q_bodyCardActions",
			"bodyCreateForm": "IIa07q_bodyCreateForm",
			"bodyDirectory": "IIa07q_bodyDirectory",
			"bodyDirectoryControls": "IIa07q_bodyDirectoryControls",
			"bodyDirectoryEmpty": "IIa07q_bodyDirectoryEmpty",
			"bodyDirectoryHeader": "IIa07q_bodyDirectoryHeader",
			"bodyDirectoryPath": "IIa07q_bodyDirectoryPath",
			"bodyFooterBlock": "IIa07q_bodyFooterBlock",
			"bodyFooterGrow": "IIa07q_bodyFooterGrow",
			"bodyGrid": "IIa07q_bodyGrid",
			"bodyHealth": "IIa07q_bodyHealth",
			"bodySignal": "IIa07q_bodySignal",
			"bodySwitch": "IIa07q_bodySwitch",
			"bodySwitchTrack": "IIa07q_bodySwitchTrack",
			"candidateIcon": "IIa07q_candidateIcon",
			"capabilityRules": "IIa07q_capabilityRules",
			"cardActions": "IIa07q_cardActions",
			"cardTop": "IIa07q_cardTop",
			"categoryChip": "IIa07q_categoryChip",
			"choiceControl": "IIa07q_choiceControl",
			"content": "IIa07q_content",
			"createIdentityGrid": "IIa07q_createIdentityGrid",
			"createSection": "IIa07q_createSection",
			"createSectionHeading": "IIa07q_createSectionHeading",
			"emptyState": "IIa07q_emptyState",
			"entities": "IIa07q_entities",
			"entityHeading": "IIa07q_entityHeading",
			"entityLayout": "IIa07q_entityLayout",
			"entityList": "IIa07q_entityList",
			"entityRail": "IIa07q_entityRail",
			"entityResults": "IIa07q_entityResults",
			"entitySearch": "IIa07q_entitySearch",
			"fieldWide": "IIa07q_fieldWide",
			"graphBackdrop": "IIa07q_graphBackdrop",
			"graphCanvasControls": "IIa07q_graphCanvasControls",
			"graphEdge": "IIa07q_graphEdge",
			"graphFooter": "IIa07q_graphFooter",
			"graphGridLine": "IIa07q_graphGridLine",
			"graphInspector": "IIa07q_graphInspector",
			"graphLayout": "IIa07q_graphLayout",
			"graphLegend": "IIa07q_graphLegend",
			"graphNode": "IIa07q_graphNode",
			"graphPanel": "IIa07q_graphPanel",
			"graphSvg": "IIa07q_graphSvg",
			"graphToolbar": "IIa07q_graphToolbar",
			"graphViewport": "IIa07q_graphViewport",
			"id": "IIa07q_id",
			"insightCard": "IIa07q_insightCard",
			"inspectorActions": "IIa07q_inspectorActions",
			"inspectorChips": "IIa07q_inspectorChips",
			"inspectorEmpty": "IIa07q_inspectorEmpty",
			"inspectorEye": "IIa07q_inspectorEye",
			"inspectorHeading": "IIa07q_inspectorHeading",
			"inspectorLogo": "IIa07q_inspectorLogo",
			"inspectorMeta": "IIa07q_inspectorMeta",
			"inspectorTitle": "IIa07q_inspectorTitle",
			"inspectorTitleRow": "IIa07q_inspectorTitleRow",
			"listNotice": "IIa07q_listNotice",
			"listToolbar": "IIa07q_listToolbar",
			"liveDot": "IIa07q_liveDot",
			"manualActions": "IIa07q_manualActions",
			"manualForm": "IIa07q_manualForm",
			"memoryHeaderActions": "IIa07q_memoryHeaderActions",
			"memoryList": "IIa07q_memoryList",
			"metadataDialog": "IIa07q_metadataDialog",
			"metadataEmpty": "IIa07q_metadataEmpty",
			"metadataList": "IIa07q_metadataList",
			"metadataTaskStatus": "IIa07q_metadataTaskStatus",
			"metadataToolbar": "IIa07q_metadataToolbar",
			"mnemon-metadata-refreshed": "IIa07q_mnemon-metadata-refreshed",
			"mnemon-metadata-sweep": "IIa07q_mnemon-metadata-sweep",
			"mnemon-spin": "IIa07q_mnemon-spin",
			"mnemonDefaultBadge": "IIa07q_mnemonDefaultBadge",
			"modal": "IIa07q_modal",
			"modalFooterNote": "IIa07q_modalFooterNote",
			"modalInlineStatus": "IIa07q_modalInlineStatus",
			"muted": "IIa07q_muted",
			"nodeBodyLabel": "IIa07q_nodeBodyLabel",
			"nodeCore": "IIa07q_nodeCore",
			"nodeHalo": "IIa07q_nodeHalo",
			"nodeLabel": "IIa07q_nodeLabel",
			"placementCandidates": "IIa07q_placementCandidates",
			"placementMode": "IIa07q_placementMode",
			"placementPolicy": "IIa07q_placementPolicy",
			"placementPolicyHeading": "IIa07q_placementPolicyHeading",
			"placementReceipt": "IIa07q_placementReceipt",
			"placementRuleGrid": "IIa07q_placementRuleGrid",
			"previewContent": "IIa07q_previewContent",
			"providerAdvancedGrid": "IIa07q_providerAdvancedGrid",
			"providerBadge": "IIa07q_providerBadge",
			"providerChoice": "IIa07q_providerChoice",
			"providerChoiceIcon": "IIa07q_providerChoiceIcon",
			"providerFieldControl": "IIa07q_providerFieldControl",
			"providerFieldHeading": "IIa07q_providerFieldHeading",
			"providerFieldIcon": "IIa07q_providerFieldIcon",
			"providerFieldIdentity": "IIa07q_providerFieldIdentity",
			"providerFields": "IIa07q_providerFields",
			"providerSecretClear": "IIa07q_providerSecretClear",
			"providerWriteHint": "IIa07q_providerWriteHint",
			"queryField": "IIa07q_queryField",
			"readSourceCard": "IIa07q_readSourceCard",
			"readSourceIdentity": "IIa07q_readSourceIdentity",
			"readSourceMeta": "IIa07q_readSourceMeta",
			"readSourceSignal": "IIa07q_readSourceSignal",
			"readSourceState": "IIa07q_readSourceState",
			"readSources": "IIa07q_readSources",
			"relatedPane": "IIa07q_relatedPane",
			"relatedSource": "IIa07q_relatedSource",
			"resultLayout": "IIa07q_resultLayout",
			"results": "IIa07q_results",
			"searchActions": "IIa07q_searchActions",
			"searchBar": "IIa07q_searchBar",
			"searchControls": "IIa07q_searchControls",
			"sectionSpinner": "IIa07q_sectionSpinner",
			"sessionHint": "IIa07q_sessionHint",
			"sessionMissing": "IIa07q_sessionMissing",
			"sessionReady": "IIa07q_sessionReady",
			"singleColumn": "IIa07q_singleColumn",
			"strategyForm": "IIa07q_strategyForm",
			"strategyLoading": "IIa07q_strategyLoading",
			"supervisedComposer": "IIa07q_supervisedComposer",
			"supervisedForm": "IIa07q_supervisedForm",
			"supervisedHeading": "IIa07q_supervisedHeading",
			"tags": "IIa07q_tags"
		};
		//#endregion
		//#region \0dsh-mnemon-css:/home/runner/work/dsh-mnemon/dsh-mnemon/plugins/dsh-mnemon-source-memory-spaces/presentation/sidebar.module.css.mjs
		const css$1 = "._Bh55G_shell ._Bh55G_memoryWorkspace{border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--mn-surface);flex:none;padding:12px 16px 0}._Bh55G_shell ._Bh55G_memoryWorkspace>[class*=pageHeader]{margin-bottom:8px}._Bh55G_shell ._Bh55G_memoryNavigation{flex:none;align-items:flex-end;gap:12px;min-width:0;padding:0;display:flex}._Bh55G_shell ._Bh55G_memoryTabs{scrollbar-width:none;flex:1;gap:2px;min-width:0;display:flex;overflow-x:auto}._Bh55G_shell ._Bh55G_memoryTabs::-webkit-scrollbar{display:none}._Bh55G_shell ._Bh55G_memoryTabs button{min-width:max-content;min-height:0;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-bottom:2px solid #0000;border-radius:6px 6px 0 0;padding:6px 12px;font-size:13px}._Bh55G_shell ._Bh55G_memoryTabs button:hover{background:var(--dsw-alias-interactive-bg-hover)}._Bh55G_shell ._Bh55G_memoryTabs button[data-active]{border-bottom-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary);font-weight:600}._Bh55G_shell ._Bh55G_memoryWriteButton{flex:none}._Bh55G_shell ._Bh55G_modal section[class*=supervisedComposer]{overflow:visible}._Bh55G_shell ._Bh55G_modal form[class*=supervisedForm]{padding:0}._Bh55G_shell ._Bh55G_modal [class*=supervisedHeading]{margin-bottom:10px}._Bh55G_shell ._Bh55G_modal [class*=supervisedHeading] h3{display:none}._Bh55G_shell ._Bh55G_modal details[class*=advancedWrite]{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;margin-top:14px;overflow:hidden}._Bh55G_shell [class*=inspectorEye],._Bh55G_shell [class*=inspectorHeading] button{width:26px;height:26px;min-height:0;color:var(--dsw-alias-label-secondary);background:0 0;border:0;border-radius:6px;justify-content:center;align-items:center;padding:0;font-size:13px;display:inline-flex}._Bh55G_shell [class*=inspectorEye]:hover:not(:disabled),._Bh55G_shell [class*=inspectorHeading] button:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:0}._Bh55G_shell [class*=inspectorEye],._Bh55G_shell [class*=inspectorHeading] button{cursor:pointer;transition:background-color .12s,color .12s,border-color .12s,outline-color .12s,box-shadow .12s,transform .12s}._Bh55G_shell [class*=inspectorEye]:active:not(:disabled),._Bh55G_shell [class*=inspectorHeading] button:active:not(:disabled){transform:translateY(1px)}._Bh55G_shell [class*=inspectorEye]:disabled{cursor:default;opacity:.45}._Bh55G_shell [class*=searchControls] label,._Bh55G_shell [class*=fieldWide]{color:var(--dsw-alias-label-secondary);gap:5px;font-size:12px;font-weight:500}._Bh55G_shell [class*=searchControls] select,._Bh55G_shell [class*=listToolbar] input,._Bh55G_shell [class*=listToolbar] select,._Bh55G_shell [class*=entitySearch] input{border:1px solid var(--dsw-alias-border-l2);min-height:34px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:8px;padding:7px 10px;font-size:13px;font-weight:400}._Bh55G_shell [class*=entityHeading]>span,._Bh55G_shell [class*=inspectorHeading]>span{letter-spacing:.06em;font-size:11px}._Bh55G_shell [class*=bodyDirectoryHeader] p,._Bh55G_shell [class*=bodyCard]>p,._Bh55G_shell [class*=graphToolbar],._Bh55G_shell [class*=graphFooter],._Bh55G_shell [class*=manualActions] p{font-size:12px}._Bh55G_shell [class*=bodyDirectoryPath],._Bh55G_shell [class*=bodyCard] footer,._Bh55G_shell [class*=bodyHealth],._Bh55G_shell [class*=badge],._Bh55G_shell [class*=entities] span{font-size:11px}._Bh55G_shell [class*=bodySwitch],._Bh55G_shell [class*=graphCanvasControls] button,._Bh55G_shell [class*=advancedWrite] summary small{font-size:12px}._Bh55G_shell [class*=inspectorMeta] dd{font-size:13px}._Bh55G_shell [class*=bodyGrid]{grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))}._Bh55G_shell article[class*=bodyCard]{border-color:var(--mn-line);background:linear-gradient(90deg, color-mix(in srgb, var(--mn-provider-color) 5%, var(--mn-layer-1)), var(--mn-layer-1) 34%);height:100%;box-shadow:inset 3px 0 0 color-mix(in srgb, var(--mn-provider-color) 68%, transparent);border-radius:8px;flex-direction:column;padding:11px 11px 11px 14px;display:flex}._Bh55G_shell article[class*=bodyCard][data-active]{border-color:var(--mn-line);box-shadow:inset 3px 0 0 color-mix(in srgb, var(--mn-provider-color) 78%, transparent)}._Bh55G_shell ._Bh55G_bodyCardHeader{justify-content:space-between;align-items:flex-start;gap:12px;min-width:0;display:flex}._Bh55G_shell ._Bh55G_bodyDirectoryActions{flex:none;align-items:center;gap:8px;display:flex}._Bh55G_shell ._Bh55G_bodyDirectoryActions>strong{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 8%, transparent);white-space:nowrap;border-radius:999px;padding:5px 8px;font-size:11px;font-weight:600}._Bh55G_shell ._Bh55G_bodyCardIdentity{flex:1;align-items:flex-start;gap:8px;min-width:0;display:flex}._Bh55G_shell ._Bh55G_bodyCardIdentity>[class*=bodySignal]{flex:none;width:6px;height:6px;margin-top:7px}._Bh55G_shell article[class*=bodyCard][data-reconnecting] ._Bh55G_bodyCardIdentity>[class*=bodySignal]{width:6px;height:6px}._Bh55G_shell ._Bh55G_bodyCardIdentity>div{flex:1;gap:2px;min-width:0;display:grid}._Bh55G_shell ._Bh55G_bodyCardIdentity strong{text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px;overflow:hidden}._Bh55G_shell ._Bh55G_bodyCardMeta{flex-wrap:wrap;align-items:center;gap:4px 8px;min-width:0;display:flex}._Bh55G_shell ._Bh55G_bodyCardMeta code{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;overflow:hidden}._Bh55G_shell ._Bh55G_bodyCardMeta [class*=bodyHealth]{letter-spacing:0;flex:none;font-size:11px}._Bh55G_shell ._Bh55G_bodyCardHeader>[class*=bodySwitch]{flex:none;min-height:24px}._Bh55G_shell article[class*=bodyCard]>p{-webkit-line-clamp:4;-webkit-box-orient:vertical;min-height:6.2em;max-height:6.2em;margin:12px 0;line-height:1.55;display:-webkit-box;overflow:hidden}._Bh55G_shell ._Bh55G_bodyCardFooter{white-space:nowrap;grid-template-columns:minmax(0,1fr) max-content;align-items:center;gap:10px;min-width:0;margin-top:auto;padding-top:9px;display:grid}._Bh55G_shell ._Bh55G_bodyCardStats{flex-wrap:nowrap;align-items:center;gap:10px;min-width:0;display:flex;overflow:hidden}._Bh55G_shell ._Bh55G_bodyCardFooter [class*=bodyCardActions]{flex-wrap:nowrap;flex:none;align-items:center;gap:6px;display:flex}._Bh55G_shell [class*=cardActions]{gap:6px}._Bh55G_shell ._Bh55G_inspectorGlyph{border:1px solid var(--dsw-alias-border-l1);width:44px;height:44px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1);font:20px/1 var(--mn-code);opacity:1;border-radius:10px;place-items:center;margin-bottom:10px;display:grid}@media (width<=760px){._Bh55G_shell ._Bh55G_memoryNavigation{padding-inline:12px}._Bh55G_shell ._Bh55G_memoryTabs button{padding-inline:10px}}@media (width<=520px){._Bh55G_shell ._Bh55G_memoryTabs button{padding-inline:8px;font-size:12px}}@media (prefers-reduced-motion:reduce){._Bh55G_shell [class*=inspectorEye],._Bh55G_shell [class*=inspectorHeading] button{transition:none}}";
		const tagId$1 = "dsh-mnemon-source-memory-spaces/presentation/sidebar.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = tagId$1;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css$1) tag.textContent = css$1;
		}
		var sidebar_module_css_default = {
			"bodyCardFooter": "_Bh55G_bodyCardFooter",
			"bodyCardHeader": "_Bh55G_bodyCardHeader",
			"bodyCardIdentity": "_Bh55G_bodyCardIdentity",
			"bodyCardMeta": "_Bh55G_bodyCardMeta",
			"bodyCardStats": "_Bh55G_bodyCardStats",
			"bodyDirectoryActions": "_Bh55G_bodyDirectoryActions",
			"inspectorGlyph": "_Bh55G_inspectorGlyph",
			"memoryNavigation": "_Bh55G_memoryNavigation",
			"memoryTabs": "_Bh55G_memoryTabs",
			"memoryWorkspace": "_Bh55G_memoryWorkspace",
			"memoryWriteButton": "_Bh55G_memoryWriteButton",
			"modal": "_Bh55G_modal",
			"shell": "_Bh55G_shell"
		};
		//#endregion
		//#region src/client/page-kit.tsx
		const I18nContext = (0, react.createContext)(translateZh);
		const LocaleContext = (0, react.createContext)("zh");
		function useT() {
			return (0, react.useContext)(I18nContext);
		}
		function useLocale() {
			const locale = (0, react.useContext)(LocaleContext);
			return locale === "en" ? "en-US" : locale === "zh" ? "zh-CN" : locale;
		}
		function humanBytes(bytes) {
			if (bytes < 1024) return `${bytes} B`;
			if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
			return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
		}
		function message(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function parseBranchesInput(raw) {
			const parsed = raw.split(",").map((value) => value.trim()).filter((value) => value !== "");
			return parsed.length === 0 ? void 0 : parsed;
		}
		function short(value, max) {
			return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
		}
		function PageHeader(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: appearanceClass(MnemonView_module_css_default.pageHeader, MnemonSidebarView_module_css_default.pageHeader),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: props.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.description })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MnemonView_module_css_default.pageHeaderMeta,
					children: [
						props.loadingLabel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PageSpinner, { label: props.loadingLabel }),
						props.meta !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: props.meta }),
						props.action
					]
				})]
			});
		}
		function PageSpinner({ label }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: MnemonView_module_css_default.pageSpinner,
				role: "status",
				"aria-label": label,
				title: label,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { "aria-hidden": "true" })
			});
		}
		function SectionSpinner({ label }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: MnemonView_module_css_default.sectionSpinner,
				role: "status",
				"aria-label": label,
				title: label,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { "aria-hidden": "true" })
			});
		}
		function ProgressiveFooter(props) {
			const t = useT();
			if (props.total === 0) return null;
			const remaining = Math.max(0, props.total - props.visible);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: props.compact === true ? MnemonView_module_css_default.compactListProgress : MnemonView_module_css_default.listProgress,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("common.showing", {
					visible: props.visible,
					total: props.total
				}) }), remaining > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: MnemonView_module_css_default.secondaryButton,
					onClick: props.onMore,
					children: t("common.showMore", { count: Math.min(props.pageSize, remaining) })
				})]
			});
		}
		/** DSH-style action dialog shared by Sidebar add/write flows. */
		function SidebarModal(props) {
			const t = useT();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MnemonDialog, {
				...props,
				closeLabel: t("common.cancel")
			});
		}
		function EmptyState(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: MnemonView_module_css_default.emptyState,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: MnemonView_module_css_default.emptyGlyph,
					"aria-hidden": "true",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.glyph })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: props.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.children })] })]
			});
		}
		const memoryPageStyles = {
			...MnemonView_module_css_default,
			...page_module_css_default$2,
			...page_module_css_default$1,
			...page_module_css_default
		};
		const memorySidebarStyles = {
			...MnemonSidebarView_module_css_default,
			...sidebar_module_css_default$2,
			...sidebar_module_css_default$1,
			...sidebar_module_css_default
		};
		//#endregion
		//#region src/client/VersionDialog.tsx
		function versionModeLabel(t, mode, cli = false) {
			if (mode === "homebrew") return t("versions.modeHomebrew");
			if (mode === "go") return t("versions.modeGo");
			if (mode === "npm") return t(cli ? "versions.modeNpmCli" : "versions.modeNpm");
			if (mode === "link") return t("versions.modeLink");
			if (mode === "missing") return t("versions.modeMissing");
			return t("versions.modeManual");
		}
		function versionHint(t, component) {
			if (component.updateHint === "npm") return t("versions.hintNpm");
			if (component.updateHint === "npm-missing") return t("versions.hintNpmMissing");
			if (component.updateHint === "npm-unmanaged") return t("versions.hintNpmUnmanaged");
			if (component.updateHint === "cli-unreadable") return t("versions.hintUnreadable");
			if (component.updateHint === "starter") return t("versions.hintStarter");
			if (component.updateHint === "brew") return t("versions.hintHomebrew");
			if (component.updateHint === "brew-missing") return t("versions.hintBrewMissing");
			if (component.updateHint === "go") return t("versions.hintGo");
			if (component.updateHint === "pnpm") return t("versions.hintPnpm");
			if (component.updateHint === "pnpm-missing") return t("versions.hintPnpmMissing");
			if (component.updateHint === "link") return t("versions.hintLink");
			if (component.updateHint === "install") return t("versions.hintInstall");
			return t("versions.hintManual");
		}
		function versionState(component) {
			if (component.installMode === "missing") return "missing";
			if (component.restartRequired) return "restart";
			if (component.current === void 0 || component.latest === void 0 || component.checkError !== void 0) return "unknown";
			if (component.outdated) return "available";
			return component.current.replace(/^v/, "") === component.latest.replace(/^v/, "") ? "current" : "local";
		}
		function CommandSnippet({ command }) {
			const t = useT();
			const [copied, setCopied] = (0, react.useState)(false);
			const [failed, setFailed] = (0, react.useState)(false);
			const copy = async () => {
				try {
					await navigator.clipboard.writeText(command);
					setCopied(true);
					setFailed(false);
				} catch {
					setCopied(false);
					setFailed(true);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: MnemonView_module_css_default.versionCommand,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: command }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: MnemonView_module_css_default.ghostButton,
						"aria-label": t("versions.copyCommand", { command }),
						onClick: () => void copy(),
						children: t(copied ? "versions.copied" : "versions.copy")
					}),
					failed && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", {
						role: "status",
						children: t("versions.copyFailed")
					})
				]
			});
		}
		function NpmGuidance({ component }) {
			const t = useT();
			const missing = component.installMode === "missing";
			const npm = component.installMode === "npm";
			const managed = npm && component.updateHint === "npm";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: MnemonView_module_css_default.versionGuidance,
				"aria-label": t("versions.npmRecommended"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t(managed ? "versions.npmMaintenance" : npm ? "versions.npmRepair" : missing ? "versions.npmInstall" : "versions.npmMigrate") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t(managed ? "versions.npmUpdateDetail" : npm ? "versions.npmRepairDetail" : missing ? "versions.npmInstallDetail" : "versions.npmMigrateDetail") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CommandSnippet, { command: managed ? "mnemon update" : "npm install --global @mnemon-dev/mnemon@latest" }),
					!managed && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: MnemonView_module_css_default.versionGuidanceDetails,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("versions.npmNextSteps") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("versions.npmVerify") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CommandSnippet, { command: "mnemon --version" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("versions.npmPath") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: "https://github.com/mnemon-dev/mnemon#install",
								target: "_blank",
								rel: "noreferrer",
								children: t("versions.installGuide")
							})
						]
					})
				]
			});
		}
		function dshInstallLabel(t, component) {
			if (component.installMode === "npm") return t("versions.profileLocation", { name: component.installProfile ?? "—" });
			if (component.installMode === "link") return component.installProfile === void 0 ? t("versions.sourceLocation") : t("versions.linkSourceLocation", { name: component.installProfile });
			return t("versions.packageLocation");
		}
		function VersionDialog(props) {
			const t = useT();
			const [snapshot, setSnapshot] = (0, react.useState)(null);
			const [checking, setChecking] = (0, react.useState)(true);
			const [updating, setUpdating] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [result, setResult] = (0, react.useState)(null);
			const [packagesOpen, setPackagesOpen] = (0, react.useState)(false);
			const updateInFlight = (0, react.useRef)(false);
			const checkRequestRef = (0, react.useRef)(0);
			const checkTimeoutRef = (0, react.useRef)(null);
			const check = (0, react.useCallback)(async () => {
				const requestVersion = ++checkRequestRef.current;
				setChecking(true);
				setError(null);
				let timeout;
				try {
					const deadline = new Promise((_resolve, reject) => {
						timeout = setTimeout(() => reject(new Error(t("versions.timeout"))), 15e3);
						checkTimeoutRef.current = timeout;
					});
					const next = await Promise.race([props.client.versions(), deadline]);
					if (checkRequestRef.current === requestVersion) setSnapshot(next);
				} catch (reason) {
					if (checkRequestRef.current === requestVersion) setError(message(reason));
				} finally {
					if (timeout !== void 0) clearTimeout(timeout);
					if (checkTimeoutRef.current === timeout) checkTimeoutRef.current = null;
					if (checkRequestRef.current === requestVersion) setChecking(false);
				}
			}, [props.client, t]);
			(0, react.useEffect)(() => {
				check();
				return () => {
					checkRequestRef.current += 1;
					if (checkTimeoutRef.current !== null) clearTimeout(checkTimeoutRef.current);
					checkTimeoutRef.current = null;
				};
			}, [check]);
			const update = async (component) => {
				if (updateInFlight.current || !props.writeEnabled) return;
				updateInFlight.current = true;
				setUpdating(component.id);
				setError(null);
				setResult(null);
				try {
					const next = await props.client.updateVersion(component.id);
					setResult(next);
					await check();
					props.onRefreshStatus();
				} catch (reason) {
					setError(message(reason));
				} finally {
					setUpdating(null);
					updateInFlight.current = false;
				}
			};
			const updatingBusy = updating !== null;
			const controlsBusy = checking || updatingBusy;
			const updateButton = (component) => props.writeEnabled && component.outdated && component.updateSupported && component.checkError === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: MnemonView_module_css_default.primaryButton,
				disabled: controlsBusy,
				onClick: () => void update(component),
				children: updating === component.id ? t("versions.updating") : t("versions.update")
			}) : null;
			const renderPackage = (component) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: MnemonView_module_css_default.versionPackage,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonView_module_css_default.versionPackageHeader,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: component.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", {
							"data-state": versionState(component),
							children: t(`versions.${versionState(component)}`)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonView_module_css_default.versionPackageMeta,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: versionModeLabel(t, component.installMode) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(component.managedBy === "starter" ? "versions.managedStarter" : "versions.managedProfile") })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonView_module_css_default.versionPackageNumbers,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								t("versions.installed"),
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: component.current ?? "—" })
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								t("versions.latest"),
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: component.latest ?? "—" })
							] }),
							component.expectedVersion !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								t("versions.starterVersion"),
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: component.expectedVersion })
							] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonView_module_css_default.versionPackageAction,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [versionHint(t, component), component.checkError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" ", t("versions.latestUnavailable")] })] }), updateButton(component)]
					})
				]
			}, component.id);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SidebarModal, {
				title: t("versions.title"),
				description: t("versions.description"),
				busy: updatingBusy,
				contentReady: !checking,
				onClose: props.onClose,
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: MnemonView_module_css_default.modalFooterMeta,
					children: snapshot === null ? "" : t("versions.checkedAt", { time: new Date(snapshot.checkedAt).toLocaleTimeString() })
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MnemonView_module_css_default.modalFooterActions,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						"data-dialog-close": true,
						className: MnemonView_module_css_default.ghostButton,
						disabled: updatingBusy,
						onClick: props.onClose,
						children: t("common.cancel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						"data-autofocus": true,
						className: MnemonView_module_css_default.secondaryButton,
						disabled: controlsBusy,
						onClick: () => void check(),
						children: checking ? t("versions.checkingShort") : t("versions.recheck")
					})]
				})] }),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MnemonView_module_css_default.versionDialogBody,
					children: [
						checking && snapshot === null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MnemonView_module_css_default.versionChecking,
							role: "status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {}), t("versions.checking")]
						}),
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MnemonView_module_css_default.versionError,
							role: "alert",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("versions.failed") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: error })]
						}),
						!props.writeEnabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: MnemonView_module_css_default.versionNotice,
							children: t("versions.readOnly")
						}),
						result !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MnemonView_module_css_default.versionResult,
							role: "status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: result.updated ? t("versions.updated", { name: result.component === "mnemon" ? "Mnemon CLI" : result.component }) : t("versions.alreadyCurrent") }), result.restartRequired && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("versions.restartRequired") })]
						}),
						snapshot !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: MnemonView_module_css_default.versionList,
							children: snapshot.components.map((component) => {
								const state = versionState(component);
								const packages = component.packages ?? [];
								const outdated = packages.filter((item) => item.outdated).length;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
									"data-outdated": component.outdated || void 0,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: component.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: versionModeLabel(t, component.installMode, component.id === "mnemon") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", {
											"data-state": state,
											children: t(`versions.${state}`)
										})] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: MnemonView_module_css_default.versionNumbers,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("versions.installed") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: component.current ?? "—" })] }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "→" }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("versions.latest") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: component.latest ?? "—" })] })
											]
										}),
										component.id === "mnemon" && component.executablePath !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", {
											className: MnemonView_module_css_default.versionLocation,
											title: component.executablePath,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("versions.executable") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: component.executablePath })]
										}),
										component.id === "dsh-mnemon" && component.installPath !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", {
											className: MnemonView_module_css_default.versionLocation,
											title: component.installPath,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: dshInstallLabel(t, component) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: component.installPath })]
										}),
										component.restartRequired && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: MnemonView_module_css_default.versionNotice,
											role: "status",
											children: t("versions.restartRequired")
										}),
										component.checkError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: MnemonView_module_css_default.versionNotice,
											children: t("versions.latestUnavailable")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: versionHint(t, component) }), updateButton(component)] }),
										component.id === "mnemon" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NpmGuidance, { component }),
										component.id === "dsh-mnemon" && packages.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: MnemonView_module_css_default.versionPackages,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: MnemonView_module_css_default.versionPackagesToggle,
												"aria-expanded": packagesOpen,
												"aria-controls": "mnemon-version-packages",
												onClick: () => setPackagesOpen((open) => !open),
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														"aria-hidden": "true",
														children: packagesOpen ? "▾" : "▸"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("versions.packages", { count: packages.length }) }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: outdated > 0 ? t("versions.packagesOutdated", { count: outdated }) : t(packagesOpen ? "versions.packagesHide" : "versions.packagesDetail") })
												]
											}), packagesOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												id: "mnemon-version-packages",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
													className: MnemonView_module_css_default.versionNotice,
													children: t("versions.packagesHint")
												}), [
													"source",
													"strategy",
													"provider"
												].map((kind) => {
													const members = packages.filter((item) => item.kind === kind);
													return members.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
														"aria-label": t(`versions.kind.${kind}`),
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: t(`versions.kind.${kind}`) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: members.map(renderPackage) })]
													}, kind);
												})]
											})]
										})
									]
								}, component.id);
							})
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/MnemonWorkbench.tsx
		const EMPTY_SOURCE_PAGE_SNAPSHOT = Object.freeze([]);
		const EMPTY_SOURCE_MANAGEMENT_FIELDS = [];
		const EMPTY_SOURCE_PAGE_DIRECTORY = {
			getSnapshot: () => EMPTY_SOURCE_PAGE_SNAPSHOT,
			subscribe: () => () => {}
		};
		function sourcePage(entryId) {
			return `source:${entryId}`;
		}
		function sourcePageEntryId(page) {
			return page.startsWith("source:") ? page.slice(7) : void 0;
		}
		function managedSourcePage(sourceTypeId) {
			return `source-management:${sourceTypeId}`;
		}
		function managedSourceTypeId(page) {
			return page.startsWith("source-management:") ? page.slice(18) : void 0;
		}
		function bindSourceManagementClient(client, instance, taskClient) {
			return {
				sourceInstanceKey: instance.sourceInstanceKey,
				revision: instance.revision,
				...instance.assistance === void 0 || instance.assistance.length === 0 ? {} : { assistance: {
					operations: instance.assistance,
					execute: (operation, input, options) => {
						return ([
							"agent-search",
							"supervise",
							"body-create",
							"body-metadata-maintain"
						].includes(operation) ? taskClient : client).assistSource(instance.sourceInstanceKey, operation, input, options.expectedRevision, options.confirmed);
					}
				} },
				read: (operation, input = null) => client.readSourceManagement(instance.sourceInstanceKey, operation, input),
				mutate: (operation, input, options) => client.mutateSourceManagement(instance.sourceInstanceKey, operation, input, options.expectedRevision ?? instance.revision, options.confirmed)
			};
		}
		function jsonRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
		}
		function SourceDisabledPage(props) {
			const t = useT();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: MnemonView_module_css_default.page,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PageHeader, {
					title: props.title,
					description: t("layers.disabledDescription"),
					meta: t("layers.disabledBadge")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EmptyState, {
					glyph: "⊘",
					title: t("layers.disabledTitle", { layer: props.title }),
					children: t("layers.disabledText")
				})]
			});
		}
		function WorkspaceNavigation(props) {
			const t = useT();
			const entries = [{
				id: "status",
				page: "status",
				label: t("nav.status"),
				detail: "",
				group: "system",
				glyph: "⌘",
				primary: true
			}, ...props.sourcePages];
			const selectedType = sourcePageEntryId(props.page)?.split("/")[0];
			const button = (item) => {
				const active = props.page === item.page || selectedType !== void 0 && selectedType === item.sourceTypeId;
				const disabled = item.sourceTypeId !== void 0 && props.disabledTypes.has(item.sourceTypeId);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					role: "tab",
					"aria-selected": active,
					"data-active": active ? "" : void 0,
					"aria-label": disabled ? item.label + " · " + t("layers.disabledBadge") : void 0,
					"data-layer-disabled": disabled ? "" : void 0,
					onClick: () => props.onSelect(item.page),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.label }), disabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", {
						className: MnemonView_module_css_default.layerDisabledBadge,
						children: t("layers.disabledBadge")
					})]
				}, item.id);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: appearanceClass(MnemonView_module_css_default.topNavigation, MnemonSidebarView_module_css_default.topNavigation),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: appearanceClass(MnemonView_module_css_default.nav, MnemonSidebarView_module_css_default.nav),
					role: "tablist",
					"aria-label": t("nav.aria"),
					children: entries.filter((entry) => entry.primary).map(button)
				})
			});
		}
		/** Fixed descriptor-driven baseline; custom Source pages can only add to it. */
		function SourceManagementPage(props) {
			const t = useT();
			const fields = props.instance.management.fields ?? EMPTY_SOURCE_MANAGEMENT_FIELDS;
			const [draft, setDraft] = (0, react.useState)({});
			const [loading, setLoading] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [saved, setSaved] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				let active = true;
				setDraft({});
				setError(null);
				setSaved(false);
				if (fields.length === 0 || props.management === void 0) {
					setLoading(false);
					return () => {
						active = false;
					};
				}
				setLoading(true);
				props.management.read(MNEMON_SOURCE_CONFIGURATION_READ).then((result) => {
					if (!active) return;
					const values = jsonRecord(jsonRecord(result.value)?.values ?? result.value) ?? {};
					setDraft(Object.fromEntries(fields.flatMap((field) => {
						if (field.secret === true || field.input === "secret") return [];
						const value = values[field.key];
						return value === void 0 ? [] : [[field.key, value]];
					})));
				}).catch((reason) => {
					if (active) setError(message(reason));
				}).finally(() => {
					if (active) setLoading(false);
				});
				return () => {
					active = false;
				};
			}, [
				fields,
				props.instance.revision,
				props.instance.sourceInstanceKey,
				props.management
			]);
			const submit = async (event) => {
				event.preventDefault();
				if (props.management === void 0) return;
				setSaving(true);
				setSaved(false);
				setError(null);
				try {
					const input = Object.fromEntries(fields.flatMap((field) => {
						const value = draft[field.key];
						if ((field.secret === true || field.input === "secret") && (value === void 0 || value === "")) return [];
						if (field.input === "number" && value !== void 0 && value !== "") return [[field.key, Number(value)]];
						if (field.input === "boolean") return [[field.key, value === true]];
						return value === void 0 || value === "" ? [] : [[field.key, value]];
					}));
					await props.management.mutate(MNEMON_SOURCE_CONFIGURATION_MUTATE, input, { confirmed: true });
					setSaved(true);
					props.onMutate();
				} catch (reason) {
					setError(message(reason));
				} finally {
					setSaving(false);
				}
			};
			const availability = t(`sourcePage.availability.${props.instance.availability}`);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: MnemonView_module_css_default.page,
				"data-source-management": props.instance.sourceTypeId,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PageHeader, {
						title: props.instance.management.label,
						description: props.instance.management.description,
						meta: props.instance.sourceTypeId,
						...loading ? { loadingLabel: t("sourcePage.configLoading") } : {}
					}),
					props.instances.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: MnemonView_module_css_default.workspacePicker,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("sourcePage.instance") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
							"aria-label": t("sourcePage.instanceAria"),
							value: props.instance.sourceInstanceKey,
							onChange: (event) => props.onSelect(event.target.value),
							children: props.instances.map((instance) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
								value: instance.sourceInstanceKey,
								children: [
									instance.management.label,
									" · ",
									instance.sourceInstanceKey
								]
							}, instance.sourceInstanceKey))
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: MnemonView_module_css_default.sourceManagementSummary,
						"data-availability": props.instance.availability,
						"aria-label": t("sourcePage.summaryAria"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MnemonView_module_css_default.sourceManagementIdentity,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { "aria-hidden": "true" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("sourcePage.package") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: props.instance.packageName }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: props.instance.sourceInstanceKey })
								] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("sourcePage.availability") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: availability })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("sourcePage.role") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: props.instance.role })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("sourcePage.revision") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: short(props.instance.revision, 32) }) })] })
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MnemonView_module_css_default.sourceManagementCapabilities,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("sourcePage.permissions") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: props.instance.capabilities.map((capability) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: capability }, capability)) })]
							})
						]
					}),
					props.instance.management.diagnostics !== void 0 && props.instance.management.diagnostics.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: MnemonView_module_css_default.sourceManagementDiagnostics,
						"aria-label": t("sourcePage.diagnostics"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("sourcePage.diagnostics") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: props.instance.management.diagnostics.map((diagnostic, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: diagnostic }, `${index}:${diagnostic}`)) })]
					}),
					fields.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: MnemonView_module_css_default.sourceManagementForm,
						onSubmit: (event) => void submit(event),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("sourcePage.configuration") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("sourcePage.configurationDescription") })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: MnemonView_module_css_default.formGrid,
								children: fields.map((field) => {
									const value = draft[field.key];
									const update = (next) => setDraft((current) => ({
										...current,
										[field.key]: next
									}));
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [
										field.label,
										field.input === "boolean" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: value === true,
											onChange: (event) => update(event.target.checked)
										}) : field.input === "select" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											value: typeof value === "string" ? value : "",
											required: field.required,
											onChange: (event) => update(event.target.value),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: "",
												children: "—"
											}), field.options?.map((option) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
												value: option.value,
												children: option.label
											}, option.value))]
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: field.input === "secret" ? "password" : field.input === "number" ? "number" : field.input === "url" ? "url" : "text",
											value: typeof value === "string" || typeof value === "number" ? value : "",
											required: field.required && field.input !== "secret",
											autoComplete: field.input === "secret" ? "new-password" : void 0,
											placeholder: field.input === "secret" ? t("sourcePage.secretPlaceholder") : void 0,
											onChange: (event) => update(event.target.value)
										}),
										field.description !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: field.description })
									] }, field.key);
								})
							}),
							error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: MnemonView_module_css_default.alert,
								role: "alert",
								children: error
							}),
							saved && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: MnemonView_module_css_default.runtimeNotice,
								role: "status",
								children: t("sourcePage.configSaved")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MnemonView_module_css_default.formActions,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "submit",
									className: MnemonView_module_css_default.primaryButton,
									disabled: saving || loading || props.management === void 0 || props.instance.availability === "unavailable",
									children: saving ? t("sourcePage.configSaving") : t("sourcePage.configSave")
								}), props.management === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("sourcePage.unavailable") })]
							})
						]
					}),
					fields.length === 0 && props.instance.availability === "unavailable" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonView_module_css_default.emptyState,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MnemonView_module_css_default.emptyGlyph,
							children: "!"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("sourcePage.unavailable") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("sourcePage.unavailableDescription") })] })]
					})
				]
			});
		}
		function StatusPage(props) {
			const t = useT();
			const [versionsOpen, setVersionsOpen] = (0, react.useState)(false);
			const status = props.status;
			const reviewError = status?.lifecycle?.current?.lastError;
			const documents = status?.documents;
			const catalogKnown = status?.memoryBodies !== void 0;
			const memorySpaces = (0, react.useMemo)(() => status?.memoryBodies ?? [], [status]);
			const activeSpaces = memorySpaces.filter((body) => body.active).length;
			const storage = status?.storage;
			const selectedScopeKind = storage?.activeKind ?? "global";
			const selectedScope = storage?.scopes.find((scope) => scope.kind === selectedScopeKind);
			const runtimeArea = selectedScope?.areas.find((area) => area.kind === "runtime");
			const runtimeUserEntries = runtimeArea === void 0 ? 0 : Number(runtimeArea.details.userEntries ?? 0);
			const runtimeMemoryEntries = runtimeArea === void 0 ? 0 : Number(runtimeArea.details.memoryEntries ?? 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: MnemonView_module_css_default.page,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PageHeader, {
						title: t("status.title"),
						description: t("status.description"),
						meta: status === null && props.loading ? t("common.loading") : status === null || reviewError !== void 0 ? t("status.checkRequired") : t("status.nominal"),
						...props.loading ? { loadingLabel: t("status.rechecking") } : {},
						action: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: MnemonView_module_css_default.statusHeaderActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: MnemonView_module_css_default.ghostButton,
								disabled: props.loading,
								onClick: props.onRefresh,
								children: props.loading ? t("status.rechecking") : t("status.recheck")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: MnemonView_module_css_default.secondaryButton,
								onClick: () => setVersionsOpen(true),
								children: t("versions.checkAction")
							})]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: MnemonView_module_css_default.healthStrip,
						"aria-label": t("status.aria"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${MnemonView_module_css_default.healthIndicator} ${status === null ? MnemonView_module_css_default.healthMuted : MnemonView_module_css_default.healthGood}` }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("status.engine") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: status?.dshMnemonVersion === void 0 ? "dsh-mnemon" : `dsh-mnemon ${status.dshMnemonVersion}` }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: status === null ? t("status.pluginChecking") : t("status.pluginReady") })
							] })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${MnemonView_module_css_default.healthIndicator} ${runtimeArea === void 0 ? MnemonView_module_css_default.healthMuted : runtimeArea.status === "invalid" ? MnemonView_module_css_default.healthBad : MnemonView_module_css_default.healthGood}` }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("status.runtime") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: runtimeArea === void 0 ? t("status.runtimeWaiting") : t("status.runtimeRatio", {
									user: runtimeUserEntries,
									memory: runtimeMemoryEntries
								}) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: runtimeArea === void 0 ? t("status.runtimeWaitingDetail") : t("status.runtimeBytes", { bytes: humanBytes(runtimeArea.bytes) }) })
							] })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${MnemonView_module_css_default.healthIndicator} ${activeSpaces > 0 ? MnemonView_module_css_default.healthGood : MnemonView_module_css_default.healthMuted}` }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("status.spaces") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: catalogKnown ? t("status.activeRatio", {
									active: activeSpaces,
									total: memorySpaces.length
								}) : t("status.directoryUnsynced") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("status.activeMemories", { count: status?.stats?.totalInsights ?? 0 }) })
							] })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${MnemonView_module_css_default.healthIndicator} ${documents === void 0 ? MnemonView_module_css_default.healthMuted : MnemonView_module_css_default.healthGood}` }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("status.documents") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: documents === void 0 ? t("status.documentsWaiting") : t("status.documentRatio", {
									active: documents.activeCount,
									archived: documents.archivedCount
								}) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: documents === void 0 ? t("status.documentsSession") : t("status.documentUsage", {
									used: humanBytes(documents.activeBytes),
									limit: humanBytes(documents.limitBytes)
								}) })
							] })] })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MnemonView_module_css_default.asyncStatusBlock,
						children: status !== null && status.memoryBodies !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NativeProviderHealth, { status })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MnemonView_module_css_default.asyncStatusBlock,
						children: status?.providerServices !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderHealth, { services: status.providerServices })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MnemonView_module_css_default.asyncStatusBlock,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StorageDomains, {
							catalog: storage,
							selected: selectedScope,
							selectedKind: selectedScopeKind
						})
					}),
					versionsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VersionDialog, {
						client: props.client,
						writeEnabled: props.writeEnabled,
						onClose: () => setVersionsOpen(false),
						onRefreshStatus: props.onRefresh
					})
				]
			});
		}
		function NativeProviderHealth({ status }) {
			const t = useT();
			const bodies = (status.memoryBodies ?? []).filter((body) => body.provider.origin === "native");
			const active = bodies.filter((body) => body.active);
			const pending = active.filter((body) => body.statusLoading === true);
			const failed = active.filter((body) => body.statusLoading !== true && !body.healthy);
			const state = !status.commandFound || failed.length > 0 ? "unhealthy" : active.length === 0 || pending.length > 0 ? "idle" : "healthy";
			const error = !status.commandFound ? t("status.nativeCliMissing") : failed.map((body) => `${body.name}: ${body.error ?? t("status.engineUnavailable")}`).join("; ");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: MnemonView_module_css_default.nativeProviderHealth,
				"aria-label": t("status.nativeAria"),
				"data-status": state,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderIcon, {
						providerId: "mnemon-native",
						icon: {
							kind: "brand",
							value: "mnemon"
						},
						className: MnemonView_module_css_default.providerHealthMark
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonView_module_css_default.nativeProviderCopy,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("status.nativeLabel") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "mnemon" }),
							error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								title: error,
								children: error
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonView_module_css_default.nativeProviderMeta,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { "aria-hidden": "true" }), t(`status.providerState.${state}`)] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: status.version === void 0 ? t("status.versionWaiting") : `Mnemon ${status.version}` }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [" · ", t("status.providerSpaces", {
							active: active.length,
							total: bodies.length
						})] })] })]
					})
				]
			});
		}
		function ProviderHealth({ services }) {
			const t = useT();
			const enabled = services.filter((service) => service.enabled).length;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: MnemonView_module_css_default.providerHealth,
				"aria-label": t("status.providersAria"),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: MnemonView_module_css_default.statusSectionHeader,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("status.providersTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("status.providersDescription") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: MnemonView_module_css_default.phaseBadge,
						children: t("status.providersEnabled", {
							enabled,
							total: services.length
						})
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: MnemonView_module_css_default.providerHealthList,
					children: services.map((service) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
						"data-status": service.status,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderIcon, {
								providerId: service.providerId,
								icon: service.icon,
								className: MnemonView_module_css_default.providerHealthMark
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MnemonView_module_css_default.providerHealthCopy,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: service.label }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t(`status.providerState.${service.status}`) }),
									service.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										title: service.error,
										children: service.error
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: MnemonView_module_css_default.providerHealthMeta,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: MnemonView_module_css_default.providerHealthSignal,
									"aria-hidden": "true"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("status.providerSpaces", {
									active: service.activeMemoryBodyCount,
									total: service.memoryBodyCount
								}) })]
							})
						]
					}, service.providerId))
				})]
			});
		}
		function storageScopeLabel(t, kind) {
			return t(kind === "global" ? "status.storageGlobal" : kind === "workspace" ? "status.storageWorkspace" : kind === "workspaces" ? "status.storageWorkspaces" : "status.storageCustom");
		}
		/** Resolve the configured scope before the first status round-trip to keep the Sidebar header stable. */
		function configuredStorageScope(config) {
			return config?.storageScope ?? (config?.dataDir?.trim() ? "custom" : "global");
		}
		function storageAreaLabel(t, kind) {
			return t(kind === "runtime" ? "status.storageRuntime" : kind === "memory-bodies" ? "status.storageSpaces" : kind === "documents" ? "status.storageDocuments" : "status.storageState");
		}
		function storageAreaDetails(t, area) {
			if (area.kind === "runtime") return t("status.storageRuntimeDetail", {
				user: area.details.userEntries ?? 0,
				memory: area.details.memoryEntries ?? 0
			});
			if (area.kind === "memory-bodies") return t("status.storageSpacesDetail", {
				active: area.details.activeBodies ?? 0,
				databases: area.details.databases ?? 0
			});
			if (area.kind === "documents") return t("status.storageDocumentsDetail", {
				active: area.details.activeDocuments ?? 0,
				archived: area.details.archivedDocuments ?? 0
			});
			return area.details.reviewLedger === true ? t("status.storageStateReady") : t("status.storageStateVolatile");
		}
		function StorageDomains(props) {
			const t = useT();
			const areaStatus = (status) => t(status === "ready" ? "status.storageReady" : status === "empty" ? "status.storageEmpty" : status === "missing" ? "status.storageMissing" : "status.storageInvalid");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: MnemonView_module_css_default.storageDomains,
				"aria-label": t("status.storageDomains"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonView_module_css_default.statusSectionHeader,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("status.storageDomains") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("status.storageDomainsText") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: MnemonView_module_css_default.phaseBadge,
							children: storageScopeLabel(t, props.selectedKind)
						})]
					}),
					props.catalog === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MnemonView_module_css_default.storageUnavailable,
						children: t("status.storageWaiting")
					}) : props.selected?.root === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonView_module_css_default.storageUnavailable,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: storageScopeLabel(t, props.selectedKind) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.selectedKind === "custom" ? t("status.storageCustomUnset") : t("status.storageWorkspaceUnavailable") })]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonView_module_css_default.storageRoot,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							storageScopeLabel(t, props.selectedKind),
							" · ",
							t("status.storageActiveRoot")
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: props.selected.root })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: humanBytes(props.selected.totalBytes) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: props.selected.available ? t("status.storageAvailable") : t("status.storageNotCreated") })] })]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MnemonView_module_css_default.storageAreaGrid,
						children: props.selected.areas.filter((area) => area.kind !== "state").map((area) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
							"data-status": area.status,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {}),
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: storageAreaLabel(t, area.kind) })
								] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", { children: areaStatus(area.status) })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: MnemonView_module_css_default.storageAreaMetric,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: area.itemCount }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("status.storageItems") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: humanBytes(area.bytes) })
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: storageAreaDetails(t, area) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									className: MnemonView_module_css_default.storagePath,
									children: area.path
								}),
								area.issue !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: area.issue })
							]
						}, area.kind))
					})] }),
					props.catalog !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: MnemonView_module_css_default.storageFootnote,
						children: t("status.storageFootnote", { root: props.catalog.activeRoot })
					})
				]
			});
		}
		function MnemonWorkbench(props) {
			const t = props.t ?? translateZh;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(I18nContext.Provider, {
				value: t,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LocaleContext.Provider, {
					value: props.locale ?? "zh",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MnemonWorkspace, { ...props })
				})
			});
		}
		function MnemonWorkspace({ connection, settingsScope, sessionId, workspaceId, workspaceSelection, surface = "sidebar", onClose, sourcePageDirectory = EMPTY_SOURCE_PAGE_DIRECTORY, renderSlot }) {
			const t = useT();
			const locale = useLocale();
			const subscribeSettings = (0, react.useCallback)((listener) => settingsScope.subscribe(listener), [settingsScope]);
			const getSettingsSnapshot = (0, react.useCallback)(() => settingsScope.getSnapshot(), [settingsScope]);
			const settingsSnapshot = (0, react.useSyncExternalStore)(subscribeSettings, getSettingsSnapshot, getSettingsSnapshot);
			const subscribeSourcePages = (0, react.useCallback)((listener) => sourcePageDirectory.subscribe(listener), [sourcePageDirectory]);
			const getSourcePages = (0, react.useCallback)(() => sourcePageDirectory.getSnapshot(), [sourcePageDirectory]);
			const sourcePageEntries = (0, react.useSyncExternalStore)(subscribeSourcePages, getSourcePages, getSourcePages);
			const client = (0, react.useMemo)(() => new MnemonClient(connection, sessionId, workspaceId), [
				connection,
				sessionId,
				workspaceId
			]);
			const taskClient = (0, react.useMemo)(() => surface === "builtin" ? client : new MnemonClient(connection, void 0, workspaceId), [
				client,
				connection,
				surface,
				workspaceId
			]);
			const viewContextKey = `${`${sessionId ?? ""}\u0000${workspaceId ?? ""}`}\u0000${settingsSnapshot.revision ?? "loading"}`;
			const [page, setPage] = (0, react.useState)("status");
			const canvasRef = (0, react.useRef)(null);
			const selectPage = (0, react.useCallback)((next) => setPage(next), []);
			/** Pages share one plugin-owned scroll container; never mutate DSH ancestor scrollports. */
			const resetViewportScroll = (0, react.useCallback)(() => {
				const canvas = canvasRef.current;
				if (canvas !== null) canvas.scrollTop = 0;
			}, []);
			(0, react.useLayoutEffect)(() => {
				resetViewportScroll();
			}, [
				viewContextKey,
				page,
				resetViewportScroll
			]);
			const [statusState, setStatusState] = (0, react.useState)(() => ({
				contextKey: viewContextKey,
				value: null,
				loading: true,
				error: null
			}));
			const currentStatusState = statusState.contextKey === viewContextKey ? statusState : {
				contextKey: viewContextKey,
				value: null,
				loading: true,
				error: null
			};
			const status = currentStatusState.value;
			const statusLoading = currentStatusState.loading;
			const statusError = currentStatusState.error;
			const statusRequest = (0, react.useRef)(0);
			const [revision, setRevision] = (0, react.useState)(0);
			const [sourceCatalogState, setSourceCatalogState] = (0, react.useState)(() => ({
				contextKey: viewContextKey,
				value: null,
				error: null
			}));
			const [selectedSourceInstances, setSelectedSourceInstances] = (0, react.useState)({});
			const [navigationInput, setNavigationInput] = (0, react.useState)();
			(0, react.useEffect)(() => {
				let active = true;
				client.sourceManagementCatalog().then((value) => {
					if (active) setSourceCatalogState({
						contextKey: viewContextKey,
						value,
						error: null
					});
				}).catch((reason) => {
					if (active) setSourceCatalogState({
						contextKey: viewContextKey,
						value: null,
						error: message(reason)
					});
				});
				return () => {
					active = false;
				};
			}, [
				client,
				revision,
				viewContextKey
			]);
			const sourceCatalog = sourceCatalogState.contextKey === viewContextKey ? sourceCatalogState.value : null;
			const sourceInstances = sourceCatalog?.sources ?? [];
			const sourceManagementClients = (0, react.useMemo)(() => new Map(sourceInstances.map((source) => [source.sourceInstanceKey, bindSourceManagementClient(client, source, taskClient)])), [
				client,
				sourceInstances,
				taskClient
			]);
			const visibleSourcePages = (0, react.useMemo)(() => {
				const visibleTypes = new Set(sourceInstances.map((source) => source.sourceTypeId));
				return sourcePageEntries.filter((entry) => visibleTypes.has(entry.sourceTypeId));
			}, [sourceInstances, sourcePageEntries]);
			const managedSourceTypes = (0, react.useMemo)(() => {
				const byType = /* @__PURE__ */ new Map();
				for (const source of sourceInstances) {
					if (sourcePageEntries.some((entry) => entry.sourceTypeId === source.sourceTypeId) && (source.management.fields?.length ?? 0) === 0) continue;
					const current = byType.get(source.sourceTypeId);
					if (current === void 0) byType.set(source.sourceTypeId, [source]);
					else current.push(source);
				}
				return [...byType.entries()].sort(([left], [right]) => left.localeCompare(right));
			}, [sourceInstances, sourcePageEntries]);
			const sourceNavigationEntries = (0, react.useMemo)(() => [...visibleSourcePages.map((entry) => ({
				id: entry.id,
				page: sourcePage(entry.id),
				sourceTypeId: entry.sourceTypeId,
				label: entry.label,
				detail: entry.navigation?.detail ?? entry.sourceTypeId,
				group: entry.navigation?.group ?? "sources",
				glyph: entry.navigation?.glyph ?? "◇",
				primary: entry.navigation?.primary ?? true
			})), ...managedSourceTypes.map(([sourceTypeId, instances]) => ({
				id: "management:" + sourceTypeId,
				page: managedSourcePage(sourceTypeId),
				sourceTypeId,
				label: instances[0].management.label,
				detail: sourceTypeId,
				group: "sources",
				glyph: "◇",
				primary: true
			}))], [managedSourceTypes, visibleSourcePages]);
			(0, react.useEffect)(() => {
				if (sourceCatalog === null) return;
				const entryId = sourcePageEntryId(page);
				const managedTypeId = managedSourceTypeId(page);
				if (entryId !== void 0 && !visibleSourcePages.some((entry) => entry.id === entryId) || managedTypeId !== void 0 && !managedSourceTypes.some(([sourceTypeId]) => sourceTypeId === managedTypeId)) setPage("status");
			}, [
				managedSourceTypes,
				page,
				visibleSourcePages,
				sourceCatalog
			]);
			(0, react.useLayoutEffect)(() => {
				setNavigationInput(void 0);
			}, [viewContextKey]);
			/** Anchors address Source page ids; no Source component is imported here. */
			const applyAnchor = (0, react.useCallback)((anchor) => {
				setNavigationInput({
					page: anchor.page,
					value: {
						seed: anchor.seed ?? "",
						nonce: Date.now()
					}
				});
				selectPage(anchor.page === "status" ? "status" : sourcePage(anchor.page));
			}, [selectPage]);
			(0, react.useEffect)(() => {
				const held = consumeMnemonAnchor(sessionId);
				if (held !== null) applyAnchor(held);
				return subscribeMnemonAnchor(sessionId, applyAnchor);
			}, [sessionId, applyAnchor]);
			const loadStatus = (0, react.useCallback)(async () => {
				const request = ++statusRequest.current;
				setStatusState((current) => ({
					contextKey: viewContextKey,
					value: current.contextKey === viewContextKey ? current.value : null,
					loading: true,
					error: null
				}));
				try {
					const summary = await client.statusSummary();
					if (request !== statusRequest.current) return;
					const needsDeepStatus = summary.memoryBodies?.some((body) => body.statusLoading === true) === true;
					setStatusState({
						contextKey: viewContextKey,
						value: summary,
						loading: needsDeepStatus,
						error: null
					});
					if (!needsDeepStatus) return;
					try {
						const next = await client.status();
						if (request === statusRequest.current) setStatusState({
							contextKey: viewContextKey,
							value: next,
							loading: false,
							error: null
						});
					} catch (reason) {
						if (request === statusRequest.current) setStatusState({
							contextKey: viewContextKey,
							value: summary,
							loading: false,
							error: message(reason)
						});
					}
				} catch (reason) {
					if (request === statusRequest.current) setStatusState({
						contextKey: viewContextKey,
						value: null,
						loading: false,
						error: message(reason)
					});
				}
			}, [client, viewContextKey]);
			(0, react.useEffect)(() => {
				loadStatus();
			}, [loadStatus]);
			const mutate = (0, react.useCallback)(() => {
				setRevision((value) => value + 1);
				loadStatus();
			}, [loadStatus]);
			const refreshAll = () => {
				setRevision((value) => value + 1);
				loadStatus();
			};
			const writeEnabled = status?.writeEnabled === true && settingsSnapshot.status === "ready" && settingsSnapshot.writable;
			status?.memoryBodies;
			(0, react.useMemo)(() => status?.memoryBodies ?? [], [status]).filter((body) => body.active).length;
			const workspaceContext = status?.workspaceContext;
			const storageMode = workspaceContext?.mode ?? status?.storage?.activeKind ?? configuredStorageScope(settingsSnapshot.value);
			const storageModeText = storageScopeLabel(t, storageMode);
			const showWorkspacePicker = isWorkspaceStorageScope(storageMode) && workspaceSelection !== void 0 && workspaceSelection.options.length > 0;
			const canAlignWorkspace = workspaceContext !== void 0 && isWorkspaceStorageScope(workspaceContext.mode) && !workspaceContext.aligned && workspaceSelection?.effectiveWorkspaceId !== void 0;
			const workspaceDifference = workspaceContext === void 0 ? "" : `${t("workspace.selectedRoot", { root: workspaceContext.selectedRoot })}; ${t("workspace.effectiveRoot", { root: workspaceContext.effectiveRoot })}`;
			const workspacePicker = showWorkspacePicker && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: appearanceClass(MnemonView_module_css_default.workspacePicker, MnemonSidebarView_module_css_default.workspacePicker),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("workspace.viewing") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
					"aria-label": t("workspace.selectorAria"),
					value: workspaceSelection.selectedWorkspaceId ?? "",
					onChange: (event) => workspaceSelection.onSelect(event.target.value),
					children: workspaceSelection.options.map((workspace) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: workspace.id,
						children: workspace.title
					}, workspace.id))
				})]
			});
			const connectionLabel = status === null && statusLoading ? t("header.checking") : status?.healthy !== true ? t("header.unavailable") : t("header.connected");
			const disabledTypes = new Set(Object.entries(status?.memorySystem?.configuration.layers ?? {}).filter(([, value]) => !value.enabled).map(([id]) => id));
			const allInstancesFor = (sourceTypeId) => sourceInstances.filter((source) => source.sourceTypeId === sourceTypeId);
			const instancesFor = (sourceTypeId) => allInstancesFor(sourceTypeId);
			const renderSourceContribution = (entryId) => {
				const sourceTypeId = entryId.split("/")[0];
				const instances = instancesFor(sourceTypeId);
				const selectedKey = selectedSourceInstances[sourceTypeId];
				const selected = instances.find((instance) => instance.sourceInstanceKey === selectedKey) ?? instances.find((instance) => isDefaultSourceInstance(instance.sourceInstanceKey, sourceTypeId)) ?? instances[0];
				if (selected === void 0 || renderSlot === void 0) return null;
				if (disabledTypes.has(sourceTypeId)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceDisabledPage, { title: selected.management.label });
				const management = sourceManagementClients.get(selected.sourceInstanceKey);
				const preferences = !isDefaultSourceInstance(selected.sourceInstanceKey, "memory-spaces") ? void 0 : {
					value: JSON.parse(JSON.stringify({ persistenceStrategy: {
						...settingsSnapshot.value?.persistenceStrategy,
						providerConnections: {}
					} })),
					writable: settingsSnapshot.writable,
					replace: async (value) => {
						const requested = jsonRecord(value)?.persistenceStrategy;
						const strategy = requested === void 0 ? void 0 : jsonRecord(requested);
						if (strategy === void 0) throw new Error("Persistence strategy preferences must be an object");
						const connections = jsonRecord(strategy.providerConnections ?? {}) ?? {};
						const merged = { ...settingsSnapshot.value?.persistenceStrategy?.providerConnections };
						for (const [id, fields] of Object.entries(connections)) merged[id] = {
							...merged[id],
							...jsonRecord(fields)
						};
						await settingsScope.setPath(["persistenceStrategy"], {
							...strategy,
							providerConnections: merged
						});
					}
				};
				return renderSlot("mnemon.source.page", {
					sourceTypeId,
					sourceInstanceKey: selected.sourceInstanceKey,
					sourceInstances: instances,
					writable: writeEnabled,
					locale,
					...management === void 0 ? {} : { management },
					...sessionId === void 0 ? {} : { sessionId },
					...workspaceId === void 0 ? {} : { workspaceId },
					...navigationInput?.page === entryId ? { navigationInput: navigationInput.value } : {},
					...preferences === void 0 ? {} : { preferences },
					onRefresh: mutate
				}, { only: entryId });
			};
			const activeSourcePageId = sourcePageEntryId(page);
			const activeSourcePage = activeSourcePageId === void 0 ? void 0 : visibleSourcePages.find((entry) => entry.id === activeSourcePageId);
			const activeSourceInstances = activeSourcePage === void 0 ? [] : instancesFor(activeSourcePage.sourceTypeId);
			const activeSelectedKey = activeSourcePage === void 0 ? void 0 : selectedSourceInstances[activeSourcePage.sourceTypeId];
			const activeSelectedInstance = activeSourceInstances.find((instance) => instance.sourceInstanceKey === activeSelectedKey) ?? activeSourceInstances.find((instance) => isDefaultSourceInstance(instance.sourceInstanceKey, activeSourcePage?.sourceTypeId ?? "")) ?? activeSourceInstances[0];
			const customSourcePage = activeSourcePage === void 0 || activeSelectedInstance === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				"data-source-page": activeSourcePage.id,
				children: [activeSourceInstances.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
					className: MnemonView_module_css_default.workspacePicker,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("sourcePage.instance") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
						"aria-label": t("sourcePage.instanceAria"),
						value: activeSelectedInstance.sourceInstanceKey,
						onChange: (event) => setSelectedSourceInstances((current) => ({
							...current,
							[activeSourcePage.sourceTypeId]: event.target.value
						})),
						children: activeSourceInstances.map((instance) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
							value: instance.sourceInstanceKey,
							children: [
								instance.management.label,
								" · ",
								instance.sourceInstanceKey
							]
						}, instance.sourceInstanceKey))
					})]
				}), renderSourceContribution(activeSourcePage.id)]
			});
			const activeManagedSourceTypeId = managedSourceTypeId(page);
			const activeManagedSourceInstances = activeManagedSourceTypeId === void 0 ? [] : allInstancesFor(activeManagedSourceTypeId);
			const activeManagedSelectedKey = activeManagedSourceTypeId === void 0 ? void 0 : selectedSourceInstances[activeManagedSourceTypeId];
			const activeManagedSourceInstance = activeManagedSourceInstances.find((instance) => instance.sourceInstanceKey === activeManagedSelectedKey) ?? activeManagedSourceInstances[0];
			const managedSourcePageContent = activeManagedSourceTypeId === void 0 || activeManagedSourceInstance === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceManagementPage, {
				instance: activeManagedSourceInstance,
				instances: activeManagedSourceInstances,
				...sourceManagementClients.get(activeManagedSourceInstance.sourceInstanceKey) === void 0 ? {} : { management: sourceManagementClients.get(activeManagedSourceInstance.sourceInstanceKey) },
				onSelect: (sourceInstanceKey) => setSelectedSourceInstances((current) => ({
					...current,
					[activeManagedSourceTypeId]: sourceInstanceKey
				})),
				onMutate: mutate
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("main", {
				className: appearanceClass(MnemonView_module_css_default.shell, MnemonSidebarView_module_css_default.shell),
				"data-mnemon-surface": surface,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: appearanceClass(MnemonView_module_css_default.masthead, MnemonSidebarView_module_css_default.masthead),
						children: [
							onClose !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: appearanceClass(MnemonView_module_css_default.ghostButton, MnemonView_module_css_default.backButton),
								onClick: onClose,
								"aria-label": t("header.backToConversation"),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutline14, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("header.backToConversation") })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: appearanceClass(MnemonView_module_css_default.brand, MnemonSidebarView_module_css_default.brand),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children: t("tab.label") }), surface === "sidebar" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: MnemonView_module_css_default.storageMode,
										"aria-label": t("workspace.storageModeAria", { mode: storageModeText }),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("workspace.storageMode") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: storageModeText })]
									}),
									workspacePicker,
									canAlignWorkspace && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: appearanceClass(MnemonView_module_css_default.workspaceMismatch, MnemonSidebarView_module_css_default.workspaceMismatch),
										role: "status",
										"aria-label": `${t("workspace.mismatchTitle")}. ${workspaceDifference}`,
										title: workspaceDifference,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("workspace.mismatchShort") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											onClick: workspaceSelection.onAlign,
											children: t("workspace.align")
										})]
									})
								] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: appearanceClass(MnemonView_module_css_default.headerActions, MnemonSidebarView_module_css_default.headerActions),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: appearanceClass(MnemonView_module_css_default.statusCluster, MnemonSidebarView_module_css_default.statusCluster),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${MnemonView_module_css_default.statusDot} ${statusLoading && status === null ? MnemonView_module_css_default.checking : status?.healthy === true ? MnemonView_module_css_default.online : MnemonView_module_css_default.offline}` }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: connectionLabel }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: MnemonView_module_css_default.iconButton,
											disabled: statusLoading,
											onClick: refreshAll,
											"aria-label": t("common.refresh"),
											children: "↻"
										})
									]
								})
							})
						]
					}),
					sourceCatalogState.contextKey === viewContextKey && sourceCatalogState.error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: MnemonView_module_css_default.alert,
						role: "alert",
						children: sourceCatalogState.error
					}),
					(statusError !== null || status?.healthy === false) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonView_module_css_default.alert,
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("header.notReady") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: statusError ?? status?.error })]
					}),
					status?.lifecycle?.current?.lastError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonView_module_css_default.alert,
						role: "alert",
						"aria-label": t("status.reviewFailed"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("status.reviewFailed") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: status.lifecycle.current.lastError }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("status.reviewFailedDetail") }),
							/CONTEXT_WINDOW_EXCEEDED|exceed(?:s|ed)? (?:the )?(?:available )?context (?:size|window)/iu.test(status.lifecycle.current.lastError) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("status.reviewContextWindow") })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: MnemonView_module_css_default.workspace,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkspaceNavigation, {
							page,
							onSelect: selectPage,
							sourcePages: sourceNavigationEntries,
							disabledTypes
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: appearanceClass(MnemonView_module_css_default.canvas, MnemonSidebarView_module_css_default.canvas),
							ref: canvasRef,
							"data-testid": "mnemon-canvas",
							"data-lock-page-header": activeSourcePage?.navigation?.stickyHeader !== false ? "" : void 0,
							children: [
								page === "status" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusPage, {
									client,
									status,
									loading: statusLoading,
									writeEnabled,
									onRefresh: () => void loadStatus()
								}),
								activeManagedSourceInstance !== void 0 && managedSourcePageContent,
								activeSourcePage !== void 0 && customSourcePage
							]
						}, viewContextKey)]
					})
				]
			});
		}
		//#endregion
		//#region \0dsh-mnemon-css:/home/runner/work/dsh-mnemon/dsh-mnemon/src/client/MnemonWorkspace.module.css.mjs
		const css = ".NS3bAW_workspacePanel{box-sizing:border-box;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-base));pointer-events:auto;min-width:0;min-height:0;display:flex;position:fixed;overflow:hidden}.NS3bAW_workspacePanel>*{flex:auto;width:100%;min-width:0}.NS3bAW_betterSidebarSeat{width:100%;min-width:0;height:100%;min-height:0;display:flex;overflow:hidden}.NS3bAW_betterSidebarSeat>*{flex:auto;min-width:0}.NS3bAW_entry{box-sizing:border-box;width:100%;min-height:36px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer;background:0 0;border:none;border-radius:8px;align-items:center;gap:10px;padding:0 10px;font-size:13px;display:flex}.NS3bAW_entry:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.NS3bAW_entry[data-active]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active);font-weight:600}.NS3bAW_entryIcon{flex:none;justify-content:center;align-items:center;width:24px;height:24px;display:inline-flex}.NS3bAW_entryIcon svg{width:18px;height:18px;display:block}.NS3bAW_entryLabel{text-overflow:ellipsis;overflow:hidden}[data-sidebar-collapsed] .NS3bAW_entry{width:36px;min-height:36px;color:var(--dsw-alias-label-primary);border-radius:50%;justify-content:center;margin:0 auto 12px;padding:0}[data-sidebar-collapsed] .NS3bAW_entryIcon svg{width:20px;height:20px}[data-sidebar-collapsed] .NS3bAW_entryLabel{display:none}";
		const tagId = "dsh-mnemon/src/client/MnemonWorkspace.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = tagId;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css) tag.textContent = css;
		}
		var MnemonWorkspace_module_css_default = {
			"betterSidebarSeat": "NS3bAW_betterSidebarSeat",
			"entry": "NS3bAW_entry",
			"entryIcon": "NS3bAW_entryIcon",
			"entryLabel": "NS3bAW_entryLabel",
			"workspacePanel": "NS3bAW_workspacePanel"
		};
		//#endregion
		//#region src/client/sidebar-entry.ts
		const FAMILY_SELECTOR = "[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-mnemon-entry]";
		function sidebarRoot() {
			const column = document.querySelector("[data-pane=\"sidebar\"], [class*=\"sidebarCol\"], .dshDesktopUpstreamSidebar");
			if (column === null) return void 0;
			return column.querySelector("[class*=\"logoRow\"]")?.parentElement ?? column.firstElementChild;
		}
		function newSessionButton(root) {
			const nested = root.querySelector("button[class*=\"newSession\"]");
			if (nested !== null) return nested;
			for (const child of root.children) if (child.tagName === "BUTTON") return child;
		}
		function createIcon() {
			const namespace = "http://www.w3.org/2000/svg";
			const icon = document.createElementNS(namespace, "svg");
			icon.setAttribute("viewBox", "0 0 16 16");
			icon.setAttribute("width", "18");
			icon.setAttribute("height", "18");
			icon.setAttribute("fill", "none");
			icon.setAttribute("stroke", "currentColor");
			icon.setAttribute("stroke-width", "1.5");
			icon.setAttribute("stroke-linecap", "round");
			icon.setAttribute("stroke-linejoin", "round");
			icon.setAttribute("aria-hidden", "true");
			const ellipse = document.createElementNS(namespace, "ellipse");
			ellipse.setAttribute("cx", "8");
			ellipse.setAttribute("cy", "3.5");
			ellipse.setAttribute("rx", "5");
			ellipse.setAttribute("ry", "2");
			const path = document.createElementNS(namespace, "path");
			path.setAttribute("d", "M3 3.5v4c0 1.1 2.2 2 5 2s5-.9 5-2v-4M3 7.5v4c0 1.1 2.2 2 5 2s5-.9 5-2v-4");
			icon.append(ellipse, path);
			return icon;
		}
		function createEntry(controller) {
			const entry = document.createElement("button");
			entry.type = "button";
			entry.dataset.dshMnemonEntry = "";
			entry.dataset.dshPlugin = "dsh-mnemon";
			entry.dataset.dshPart = "sidebar-entry";
			entry.className = MnemonWorkspace_module_css_default.entry ?? "";
			const icon = document.createElement("span");
			icon.className = MnemonWorkspace_module_css_default.entryIcon ?? "";
			icon.append(createIcon());
			const label = document.createElement("span");
			label.className = MnemonWorkspace_module_css_default.entryLabel ?? "";
			entry.append(icon, label);
			entry.addEventListener("click", () => {
				controller.open();
			});
			return {
				entry,
				label
			};
		}
		function placeEntry(root, entry) {
			const button = newSessionButton(root);
			if (button === void 0) return false;
			const row = button.closest("[class*=\"logoRow\"]");
			const base = row !== null && row.parentElement === root ? row : button;
			const parent = base.parentElement ?? root;
			if (entry.parentElement === parent) return true;
			const anchor = Array.from(parent.children).filter((element) => element instanceof HTMLElement && element.matches(FAMILY_SELECTOR)).at(-1)?.nextElementSibling ?? base.nextElementSibling;
			parent.insertBefore(entry, anchor !== null && anchor.parentElement === parent ? anchor : null);
			return true;
		}
		/** Mount a self-healing official-style entry under the New Session row. */
		function mountMnemonSidebarEntry(controller, t, subscribeLocale) {
			const { entry, label } = createEntry(controller);
			let root;
			let placed = false;
			const syncLabel = () => {
				const text = t("tab.label");
				if (entry.getAttribute("aria-label") !== text) entry.setAttribute("aria-label", text);
				if (entry.title !== text) entry.title = text;
				if (label.textContent !== text) label.textContent = text;
			};
			const rootObserver = new MutationObserver(() => {
				if (root === void 0 || !root.isConnected) {
					placed = false;
					tryPlace();
					return;
				}
				if (!root.contains(entry)) placed = placeEntry(root, entry);
			});
			const tryPlace = () => {
				syncLabel();
				if (root !== void 0 && !root.isConnected) {
					rootObserver.disconnect();
					root = void 0;
					placed = false;
				}
				if (placed && document.body.contains(entry)) return;
				if (placed) {
					rootObserver.disconnect();
					root = void 0;
					placed = false;
				}
				root ??= sidebarRoot();
				if (root === void 0) return;
				placed = placeEntry(root, entry);
				if (placed) rootObserver.observe(root, {
					childList: true,
					subtree: true
				});
			};
			const waitObserver = new MutationObserver(tryPlace);
			waitObserver.observe(document.body, {
				childList: true,
				subtree: true
			});
			const syncActive = () => {
				if (controller.getSnapshot().open) entry.dataset.active = "true";
				else delete entry.dataset.active;
			};
			const unsubscribe = controller.subscribe(syncActive);
			const unsubscribeLocale = subscribeLocale?.(syncLabel) ?? (() => {});
			const dispose = () => {
				waitObserver.disconnect();
				rootObserver.disconnect();
				unsubscribe();
				unsubscribeLocale();
				entry.remove();
			};
			try {
				syncActive();
				tryPlace();
				return dispose;
			} catch (error) {
				dispose();
				throw error;
			}
		}
		//#endregion
		//#region src/client/workspace-controller.ts
		/** Small framework-neutral state holder shared by the sidebar row and panel. */
		var MnemonWorkspaceController = class {
			snapshot = { open: false };
			listeners = /* @__PURE__ */ new Set();
			getSnapshot = () => this.snapshot;
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			open() {
				this.setOpen(true, true);
			}
			close() {
				this.setOpen(false);
			}
			toggle() {
				this.setOpen(!this.snapshot.open);
			}
			setOpen(open, reassert = false) {
				if (this.snapshot.open === open && !reassert) return;
				this.snapshot = { open };
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region src/client/workspace-mount.tsx
		const ACTIVE_ATTR = "data-dsh-mnemon-active";
		const TASKBOARD_ACTIVE_ATTR = "data-dsh-taskboard-active";
		const SSH_ACTIVE_ATTR = "data-dsh-ssh-active";
		const ACTIVATE_EVENT = "dsh-panel-activate";
		const SIDEBAR_CONTEXT_SELECTOR = "[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [class*=\"sessionRow\"], [class*=\"projectRow\"], [class*=\"searchResultRow\"], [class*=\"searchResultWorkspace\"], [class*=\"newSession\"]";
		function resolveWorkspaceSurface() {
			const explicit = document.querySelector("[data-pane=\"conversation\"]") ?? document.querySelector(".dshDesktopConversationSurface");
			if (explicit !== null) return { column: explicit };
			const column = document.querySelector("[class*=\"centerCol\"]");
			if (column === null) return void 0;
			const frame = column.parentElement;
			const details = frame === null ? void 0 : Array.from(frame.children).find((child) => child instanceof HTMLElement && child !== column && child.className.includes("detailsCol"));
			return frame === null || details === void 0 ? { column } : {
				column,
				frame,
				details
			};
		}
		function sameWorkspaceSurface(left, right) {
			return left?.column === right?.column && left?.frame === right?.frame && left?.details === right?.details;
		}
		function workspaceSurfaceBounds(surface) {
			const columnRect = surface.column.getBoundingClientRect();
			if (surface.frame === void 0) {
				const { left, top, width, height } = columnRect;
				return {
					left,
					top,
					width,
					height
				};
			}
			const frameRect = surface.frame.getBoundingClientRect();
			return {
				left: columnRect.left,
				top: frameRect.top,
				width: Math.max(0, frameRect.left + frameRect.width - columnRect.left),
				height: frameRect.height
			};
		}
		function normalizePath(value) {
			return value.replace(/[\\/]+$/u, "");
		}
		/** Builtin follows its DSH slot session, never the Sidebar's workspace picker. */
		function MnemonBuiltinWorkspaceHost(props) {
			const subscribeLocale = (0, react.useCallback)((listener) => props.localeRuntime.subscribe(listener), [props.localeRuntime]);
			const getLocale = (0, react.useCallback)(() => props.localeRuntime.getSnapshot(), [props.localeRuntime]);
			const locale = (0, react.useSyncExternalStore)(subscribeLocale, getLocale, getLocale);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MnemonWorkbench, {
				connection: props.connection,
				settingsScope: props.settingsScope,
				sessionId: props.sessionId,
				surface: "builtin",
				t: props.t,
				locale: locale.active,
				sourcePageDirectory: props.sourcePageDirectory,
				...props.renderSlot === void 0 ? {} : { renderSlot: props.renderSlot }
			});
		}
		/** Shared workspace body; its DSH registration owns Source child-render authority. */
		function MnemonWorkspaceHost(props) {
			const subscribeLocale = (0, react.useCallback)((listener) => props.localeRuntime.subscribe(listener), [props.localeRuntime]);
			const getLocale = (0, react.useCallback)(() => props.localeRuntime.getSnapshot(), [props.localeRuntime]);
			const subscribeSessions = (0, react.useCallback)((listener) => props.sessions.list.subscribe(listener), [props.sessions.list]);
			const getSessions = (0, react.useCallback)(() => props.sessions.list.getSnapshot(), [props.sessions.list]);
			const subscribeWorkspaces = (0, react.useCallback)((listener) => props.workspaces.list.subscribe(listener), [props.workspaces.list]);
			const getWorkspaces = (0, react.useCallback)(() => props.workspaces.list.getSnapshot(), [props.workspaces.list]);
			const locale = (0, react.useSyncExternalStore)(subscribeLocale, getLocale, getLocale);
			const sessions = (0, react.useSyncExternalStore)(subscribeSessions, getSessions, getSessions);
			const workspaces = (0, react.useSyncExternalStore)(subscribeWorkspaces, getWorkspaces, getWorkspaces);
			const [selectedWorkspaceId, setSelectedWorkspaceId] = (0, react.useState)();
			const sessionId = props.sessionId ?? sessions.current;
			const currentCwd = props.cwd ?? (sessionId === void 0 ? void 0 : sessions.byId[sessionId]?.cwd);
			const effectiveWorkspace = currentCwd === void 0 ? void 0 : workspaces.items.find((workspace) => normalizePath(workspace.path) === normalizePath(currentCwd));
			const fallbackWorkspace = effectiveWorkspace ?? workspaces.items[0];
			const resolvedSelectedId = selectedWorkspaceId !== void 0 && workspaces.items.some((workspace) => String(workspace.workspaceId) === selectedWorkspaceId) ? selectedWorkspaceId : fallbackWorkspace === void 0 ? void 0 : String(fallbackWorkspace.workspaceId);
			(0, react.useEffect)(() => {
				if (resolvedSelectedId !== selectedWorkspaceId) setSelectedWorkspaceId(resolvedSelectedId);
			}, [resolvedSelectedId, selectedWorkspaceId]);
			const selection = (0, react.useMemo)(() => ({
				options: workspaces.items.map((workspace) => ({
					id: String(workspace.workspaceId),
					title: workspace.title,
					path: workspace.path
				})),
				...resolvedSelectedId === void 0 ? {} : { selectedWorkspaceId: resolvedSelectedId },
				...effectiveWorkspace === void 0 ? {} : { effectiveWorkspaceId: String(effectiveWorkspace.workspaceId) },
				onSelect: setSelectedWorkspaceId,
				onAlign: () => {
					if (effectiveWorkspace !== void 0) setSelectedWorkspaceId(String(effectiveWorkspace.workspaceId));
				}
			}), [
				effectiveWorkspace,
				resolvedSelectedId,
				workspaces.items
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MnemonWorkbench, {
				connection: props.connection,
				settingsScope: props.settingsScope,
				...sessionId === void 0 ? {} : { sessionId },
				...resolvedSelectedId === void 0 ? {} : { workspaceId: resolvedSelectedId },
				workspaceSelection: selection,
				active: props.active ?? true,
				t: props.t,
				locale: locale.active,
				sourcePageDirectory: props.sourcePageDirectory,
				...props.renderSlot === void 0 ? {} : { renderSlot: props.renderSlot },
				...props.navigation === void 0 ? {} : { onClose: props.navigation.close }
			});
		}
		/** Sidebar presentation in DSH's additive shell.overlay, also without a session. */
		function MnemonSidebarWorkspaceHost(props) {
			const state = (0, react.useSyncExternalStore)(props.controller.subscribe, props.controller.getSnapshot, props.controller.getSnapshot);
			const subscribeBetterSidebar = (0, react.useCallback)((listener) => props.betterSidebarSeat?.subscribe(listener) ?? (() => {}), [props.betterSidebarSeat]);
			const getBetterSidebar = (0, react.useCallback)(() => props.betterSidebarSeat?.getSnapshot(), [props.betterSidebarSeat]);
			const betterSidebar = (0, react.useSyncExternalStore)(subscribeBetterSidebar, getBetterSidebar, getBetterSidebar);
			const [bounds, setBounds] = (0, react.useState)();
			(0, react.useEffect)(() => {
				if (!state.open) return;
				let surface;
				const previousInert = /* @__PURE__ */ new Map();
				const update = () => {
					if (surface === void 0) return;
					const { left, top, width, height } = workspaceSurfaceBounds(surface);
					setBounds((previous) => previous?.left === left && previous.top === top && previous.width === width && previous.height === height ? previous : {
						left,
						top,
						width,
						height
					});
				};
				const observer = typeof ResizeObserver === "undefined" ? void 0 : new ResizeObserver(update);
				const observedTargets = (value) => [...new Set([
					value.column,
					value.frame,
					value.details
				].filter((target) => target !== void 0))];
				const inertTargets = (value) => [value.column, value.details].filter((target) => target !== void 0);
				const detach = () => {
					if (surface !== void 0) for (const target of observedTargets(surface)) observer?.unobserve(target);
					for (const [target, inert] of previousInert) target.inert = inert;
					previousInert.clear();
					surface = void 0;
				};
				const connect = () => {
					const next = resolveWorkspaceSurface();
					if (!sameWorkspaceSurface(next, surface)) {
						detach();
						surface = next;
						if (surface !== void 0) {
							for (const target of inertTargets(surface)) {
								previousInert.set(target, target.inert);
								target.inert = true;
							}
							for (const target of observedTargets(surface)) observer?.observe(target);
						}
					}
					update();
				};
				connect();
				const shell = new MutationObserver(connect);
				shell.observe(document.body, {
					childList: true,
					subtree: true
				});
				window.addEventListener("resize", update);
				const escape = (event) => {
					if (event.key === "Escape" && !event.defaultPrevented && document.querySelector("[role=\"dialog\"]") === null) props.controller.close();
				};
				window.addEventListener("keydown", escape);
				return () => {
					shell.disconnect();
					observer?.disconnect();
					window.removeEventListener("resize", update);
					window.removeEventListener("keydown", escape);
					detach();
				};
			}, [state.open, props.controller]);
			const betterSidebarView = betterSidebar === void 0 ? null : (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MnemonWorkspaceHost, {
				connection: props.connection,
				settingsScope: props.settingsScope,
				sessions: props.sessions,
				workspaces: props.workspaces,
				localeRuntime: props.localeRuntime,
				sourcePageDirectory: props.sourcePageDirectory,
				sessionId: betterSidebar.scope.sessionId,
				...betterSidebar.scope.cwd === void 0 ? {} : { cwd: betterSidebar.scope.cwd },
				active: betterSidebar.visible,
				t: props.t,
				...props.renderSlot === void 0 ? {} : { renderSlot: props.renderSlot }
			}), betterSidebar.target);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [betterSidebarView, bounds !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				"data-dsh-mnemon-view": true,
				hidden: !state.open,
				className: MnemonWorkspace_module_css_default.workspacePanel,
				style: {
					...bounds,
					display: state.open ? void 0 : "none"
				},
				"aria-label": props.t("tab.label"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MnemonWorkspaceHost, {
					...props,
					active: state.open
				})
			})] });
		}
		/** Core-owned sidebar row; presentation state is shared with its DSH seat. */
		function mountMnemonSidebarLauncher(ctx, t, controller) {
			if (typeof document === "undefined" || typeof window === "undefined") return () => {};
			const stopEntry = mountMnemonSidebarEntry(controller, t, (listener) => ctx.locale.subscribe(listener));
			const stopPanels = coordinateSidebarPanels(controller);
			return () => {
				stopPanels();
				stopEntry();
			};
		}
		/** Coordinate released peer panels; their DOM flags also cover lost events. */
		function coordinateSidebarPanels(controller) {
			let announcing = false;
			const applyActive = () => {
				const html = document.documentElement;
				if (!controller.getSnapshot().open) {
					html.removeAttribute(ACTIVE_ATTR);
					return;
				}
				announcing = true;
				try {
					document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: "ssh" }));
					document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: "taskboard" }));
				} finally {
					announcing = false;
				}
				html.removeAttribute(TASKBOARD_ACTIVE_ATTR);
				html.removeAttribute(SSH_ACTIVE_ATTR);
				html.setAttribute(ACTIVE_ATTR, "");
				document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: "mnemon" }));
			};
			const onActivate = (event) => {
				if (announcing || !controller.getSnapshot().open) return;
				const detail = event.detail;
				if (detail === "taskboard" || detail === "ssh") controller.close();
			};
			const onContext = (event) => {
				if (controller.getSnapshot().open && event.target instanceof Element && event.target.closest(SIDEBAR_CONTEXT_SELECTOR) !== null) controller.close();
			};
			const observer = new MutationObserver(() => {
				if (!controller.getSnapshot().open) return;
				const html = document.documentElement;
				if (!html.hasAttribute(ACTIVE_ATTR) || html.hasAttribute(TASKBOARD_ACTIVE_ATTR) || html.hasAttribute(SSH_ACTIVE_ATTR)) controller.close();
			});
			observer.observe(document.documentElement, {
				attributes: true,
				attributeFilter: [
					ACTIVE_ATTR,
					TASKBOARD_ACTIVE_ATTR,
					SSH_ACTIVE_ATTR
				]
			});
			document.addEventListener("click", onContext, true);
			document.addEventListener(ACTIVATE_EVENT, onActivate);
			const unsubscribe = controller.subscribe(applyActive);
			applyActive();
			return () => {
				unsubscribe();
				observer.disconnect();
				document.removeEventListener("click", onContext, true);
				document.removeEventListener(ACTIVATE_EVENT, onActivate);
				document.documentElement.removeAttribute(ACTIVE_ATTR);
			};
		}
		//#endregion
		//#region src/client/better-sidebar.tsx
		/** Stable type id exposed to Better Sidebar and its persisted tab state. */
		const MNEMON_BETTER_SIDEBAR_TAB_ID = "dsh-mnemon:memory";
		function MnemonTabIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				"aria-hidden": "true",
				viewBox: "0 0 16 16",
				width: size,
				height: size,
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
					cx: "8",
					cy: "3.5",
					rx: "5",
					ry: "2"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 3.5v4c0 1.1 2.2 2 5 2s5-.9 5-2v-4M3 7.5v4c0 1.1 2.2 2 5 2s5-.9 5-2v-4" })]
			});
		}
		/** Better Sidebar supplies a DOM seat; the DSH renderer remains the owner. */
		function BetterSidebarMemoryTab(props) {
			const target = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (target.current === null) return;
				return props.seat.attach(target.current, props.scope, props.visible);
			}, [
				props.scope.cwd,
				props.scope.sessionId,
				props.seat,
				props.visible
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: target,
				className: MnemonWorkspace_module_css_default.betterSidebarSeat,
				"data-dsh-mnemon-better-sidebar-seat": true
			});
		}
		/**
		* Register Mnemon through Better Sidebar's documented optional service.
		*
		* The service is deliberately a soft dependency. Watching Cordis service
		* changes makes installation order and HMR irrelevant while preserving the
		* standalone Mnemon sidebar on profiles that do not install Better Sidebar.
		*/
		function mountBetterSidebarTab(ctx, t, seat) {
			let current;
			const reconcile = () => {
				const service = ctx.get("betterSidebar");
				if (current?.service === service) return;
				current?.dispose();
				current = void 0;
				if (service === void 0) return;
				current = {
					service,
					dispose: service.registerTab({
						id: MNEMON_BETTER_SIDEBAR_TAB_ID,
						title: () => t("tab.label"),
						icon: (size) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MnemonTabIcon, { size }),
						order: 55,
						single: true,
						component: ({ scope, visible }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BetterSidebarMemoryTab, {
							seat,
							scope,
							visible
						})
					})
				};
			};
			reconcile();
			const unsubscribe = ctx.on("internal/service", (name) => {
				if (name === "betterSidebar") reconcile();
			});
			return () => {
				unsubscribe();
				current?.dispose();
				current = void 0;
			};
		}
		//#endregion
		//#region src/client/subagent-token-usage.tsx
		/** Mnemon token-usage projection for DSH's fork-backed subagent token metric. */
		const MNEMON_SUBAGENT_TOKEN_USAGE_KEY = "mnemonSubagentTokenUsage";
		const SUBAGENT_LINEAGE_SLOT = "conversation.session.header.lineage";
		const SUBAGENT_LOCALE = "subagent";
		const MNEMON_SHADOW_PRIORITY = -100;
		const scopedSnapshots = /* @__PURE__ */ new WeakMap();
		function isTokenUsage(value) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			const usage = value;
			return [
				"uncachedInputTokens",
				"outputTokens",
				"cacheReadTokens",
				"cacheWriteTokens"
			].every((key) => {
				const count = usage[key];
				return typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
			});
		}
		/**
		* Present the child-local projection under the generic key expected by the
		* released official catalog component. All other consumers continue seeing
		* DSH's complete-log `tokenUsage` value.
		*/
		function scopeSubagentTokenUsage(state) {
			const cached = scopedSnapshots.get(state);
			if (cached !== void 0) return cached;
			let byId;
			for (const [id, summary] of Object.entries(state.byId)) {
				if (summary.origin !== "subagent") continue;
				const projections = summary.projectionValues;
				const scopedUsage = projections?.[MNEMON_SUBAGENT_TOKEN_USAGE_KEY];
				if (!isTokenUsage(scopedUsage)) continue;
				byId ??= { ...state.byId };
				byId[id] = {
					...summary,
					projectionValues: {
						...projections,
						tokenUsage: scopedUsage
					}
				};
			}
			const scoped = byId === void 0 ? state : {
				...state,
				byId
			};
			scopedSnapshots.set(state, scoped);
			return scoped;
		}
		/** Wrap the framework hook while preserving its selector/equality contract. */
		function createScopedUseSessions(useSessions) {
			return (selector, equal) => useSessions((state) => selector(scopeSubagentTokenUsage(state)), equal);
		}
		function lineageShadow(official) {
			return function MnemonSubagentHeaderLineage(props) {
				return (0, react.createElement)(official, {
					...props,
					useSessions: createScopedUseSessions(props.useSessions)
				});
			};
		}
		function officialLineage(entries) {
			return entries.find((entry) => (entry.options.priority ?? 0) === 0 && entry.locale === SUBAGENT_LOCALE && typeof entry.component === "function" && typeof entry.inject === "function");
		}
		/**
		* Shadow the released official single-slot entry at a lower priority. The
		* component and action factory are captured from the public slot ledger, so
		* Mnemon keeps the official UI, styles, locale, and navigation behavior.
		*/
		function mountSubagentTokenUsageOverride(ctx) {
			const slots = ctx.slots;
			if (typeof slots.entries !== "function" || typeof slots.subscribe !== "function" || typeof slots.register !== "function") return () => {};
			let official;
			let disposeShadow;
			const reconcile = () => {
				const entries = slots.entries(SUBAGENT_LINEAGE_SLOT);
				if (official !== void 0 && entries.includes(official)) return;
				const disposePreviousShadow = disposeShadow;
				disposeShadow = void 0;
				official = void 0;
				disposePreviousShadow?.();
				official = officialLineage(entries);
				if (official === void 0) return;
				disposeShadow = slots.register({
					name: SUBAGENT_LINEAGE_SLOT,
					priority: MNEMON_SHADOW_PRIORITY,
					locale: official.locale,
					inject: official.inject,
					registrant: "dsh-mnemon/subagent-token-usage"
				}, lineageShadow(official.component));
			};
			const unsubscribe = slots.subscribe(SUBAGENT_LINEAGE_SLOT, reconcile);
			reconcile();
			return () => {
				unsubscribe();
				disposeShadow?.();
			};
		}
		//#endregion
		//#region src/client/page-client.tsx
		/** Optional default presentation kit; custom pages may use their own UI. */
		function MemorySourcePageFrame(props) {
			const translate = props.locale.startsWith("en") ? translateEn : translateZh;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(I18nContext.Provider, {
				value: translate,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LocaleContext.Provider, {
					value: props.locale,
					children: props.children
				})
			});
		}
		/** Track revisions returned by reads as well as writes; never retry a conflict. */
		function createMemorySourcePageClient(management) {
			let revision = management.revision;
			let sequence = 0;
			let accepted = 0;
			async function request(mode, operation, input, confirmed = true) {
				const ticket = ++sequence;
				if (mode === "assist" && !management.assistance?.operations.includes(operation)) throw new Error("Host assistance is unavailable for this Source instance: " + operation);
				const result = mode === "assist" ? await management.assistance.execute(operation, input, {
					expectedRevision: revision,
					confirmed
				}) : mode === "read" ? await management.read(operation, input) : await management.mutate(operation, input, {
					confirmed: true,
					expectedRevision: revision
				});
				if (ticket >= accepted) {
					accepted = ticket;
					revision = result.revision;
				}
				return result.value;
			}
			return {
				canAssist: (operation) => management.assistance?.operations.includes(operation) === true,
				assist: (operation, input, confirmed) => request("assist", operation, input, confirmed),
				read: (operation, input = null) => request("read", operation, input),
				mutate: (operation, input, confirmed) => {
					if (confirmed !== true) return Promise.reject(/* @__PURE__ */ new Error("Source page mutation requires explicit confirmation"));
					return request("mutate", operation, input);
				}
			};
		}
		//#endregion
		//#region src/client/index.ts
		const inject = [
			"slots",
			"sessions",
			"workspaces",
			"connection",
			"locale"
		];
		const INTERACTION_UNITS = {
			turnBar: {
				slot: "conversation.chat.turnTail",
				enabled: (value) => enabledOf(value, "turnBar"),
				register(ctx, namespace, translate) {
					return ctx.slots.register({
						name: "conversation.chat.turnTail",
						locale: namespace,
						select: selectMnemonTurnTail,
						inject: (sessionId) => ({
							...typeof sessionId === "string" && sessionId !== "" ? { sessionId } : {},
							connection: ctx.connection,
							localeRuntime: ctx.locale,
							t: translate
						})
					}, MnemonTurnTail);
				}
			},
			saveAction: {
				slot: "conversation.chat.assistant-actions",
				enabled: (value) => enabledOf(value, "saveAction"),
				register(ctx, namespace, translate, settings) {
					return ctx.slots.register({
						name: "conversation.chat.assistant-actions",
						id: "mnemon-save",
						order: 90,
						locale: namespace,
						inject: (sessionId) => ({
							...typeof sessionId === "string" && sessionId !== "" ? { sessionId } : {},
							connection: ctx.connection,
							settingsScope: settings,
							localeRuntime: ctx.locale,
							t: translate
						})
					}, MnemonSaveAction);
				}
			}
		};
		/** Ready snapshots default each interaction on; loading has no value and mounts nothing. */
		function enabledOf(value, key) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
			return value[key] !== false;
		}
		function mountSidebarMemoryView(ctx, settings, namespace, translate) {
			const controller = new MnemonWorkspaceController();
			const navigation = {
				open: () => controller.open(),
				close: () => controller.close()
			};
			const sourcePageDirectory = createMemorySourcePageDirectory(ctx);
			const betterSidebarSeat = new MnemonBetterSidebarSeat();
			const slotName = "shell.overlay";
			const disposeView = ctx.slots.inject(slotName, () => ctx.slots.register({
				name: slotName,
				id: "mnemon",
				order: 30,
				label: () => translate("tab.label"),
				locale: namespace,
				children: { "mnemon.source.page": {
					kind: "list",
					scope: "root"
				} },
				inject: () => ({
					connection: ctx.connection,
					settingsScope: settings,
					sessions: ctx.sessions,
					workspaces: ctx.workspaces,
					localeRuntime: ctx.locale,
					sourcePageDirectory,
					navigation,
					controller,
					betterSidebarSeat,
					t: translate
				})
			}, MnemonSidebarWorkspaceHost));
			let disposeBetterSidebar;
			let disposeLauncher;
			let listening = false;
			let disposed = false;
			const openMemoryView = () => {
				navigation.open();
			};
			const dispose = () => {
				if (disposed) return;
				disposed = true;
				try {
					disposeLauncher?.();
				} finally {
					if (listening) window.removeEventListener(MNEMON_ANCHOR_EVENT, openMemoryView);
					try {
						disposeBetterSidebar?.();
					} finally {
						disposeView();
					}
				}
			};
			try {
				disposeBetterSidebar = mountBetterSidebarTab(ctx, translate, betterSidebarSeat);
				if (typeof window !== "undefined" && typeof document !== "undefined") {
					window.addEventListener(MNEMON_ANCHOR_EVENT, openMemoryView);
					listening = true;
					disposeLauncher = mountMnemonSidebarLauncher(ctx, translate, controller);
				}
				return dispose;
			} catch (error) {
				dispose();
				throw error;
			}
		}
		/** DSH supplies the owning session; Source pages retain the same render contract. */
		function mountBuiltinMemoryView(ctx, settings, namespace, translate) {
			const sourcePageDirectory = createMemorySourcePageDirectory(ctx);
			const disposeView = ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "mnemon",
				order: 30,
				label: () => translate("tab.label"),
				locale: namespace,
				children: { "mnemon.source.page": {
					kind: "list",
					scope: "root"
				} },
				inject: (sessionId) => ({
					connection: ctx.connection,
					settingsScope: settings,
					sessionId,
					localeRuntime: ctx.locale,
					sourcePageDirectory,
					t: translate
				})
			}, MnemonBuiltinWorkspaceHost));
			if (typeof window === "undefined" || typeof document === "undefined") return disposeView;
			const openView = (event) => {
				const sessionId = event.detail?.sessionId;
				if (sessionId !== void 0 && sessionId !== ctx.sessions.list.getSnapshot().current) return;
				const label = translate("tab.label").trim();
				[...document.querySelectorAll("[role=\"tab\"]")].find((candidate) => candidate.textContent?.trim() === label)?.click();
			};
			window.addEventListener(MNEMON_ANCHOR_EVENT, openView);
			return () => {
				window.removeEventListener(MNEMON_ANCHOR_EVENT, openView);
				disposeView();
			};
		}
		/** Mount the memory workspace plus the optional in-conversation interaction surfaces. */
		function apply(rawContext) {
			const ctx = rawContext;
			const settings = new MnemonSettingsScope(ctx.connection, MNEMON_SETTINGS_NAMESPACE);
			const interactionSettings = new MnemonSettingsScope(ctx.connection, MNEMON_UI_SETTINGS_NAMESPACE);
			const namespace = "mnemon";
			ctx.effect(() => ctx.locale.register(namespace, {
				zh,
				en
			}), "dsh-mnemon: locale dictionaries");
			const translate = ctx.locale.bind(namespace);
			ctx.slots.inject("conversation.session.header.lineage", () => mountSubagentTokenUsageOverride(ctx));
			let activeMemoryWorkspace;
			const reconcileMemoryWorkspace = () => {
				const snapshot = settings.getSnapshot();
				const mode = snapshot.status === "loading" || snapshot.value?.tabEnabled === false ? void 0 : normalizeDisplayMode(snapshot.value?.displayMode);
				if (activeMemoryWorkspace?.mode === mode) return;
				activeMemoryWorkspace?.dispose();
				activeMemoryWorkspace = mode === void 0 ? void 0 : {
					mode,
					dispose: mode === "builtin" ? mountBuiltinMemoryView(ctx, settings, namespace, translate) : mountSidebarMemoryView(ctx, settings, namespace, translate)
				};
			};
			ctx.effect(() => {
				const unsubscribe = settings.subscribe(reconcileMemoryWorkspace);
				reconcileMemoryWorkspace();
				return () => {
					unsubscribe();
					activeMemoryWorkspace?.dispose();
					activeMemoryWorkspace = void 0;
				};
			}, "dsh-mnemon: memory workspace entry");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "mnemon",
				order: 20,
				label: () => translate("tab.label"),
				locale: namespace,
				inject: () => {
					const sessions = ctx.sessions?.list?.getSnapshot?.() ?? {
						current: void 0,
						byId: {}
					};
					const workspaces = ctx.workspaces?.list?.getSnapshot?.() ?? { items: [] };
					const sessionId = sessions.current;
					const cwd = sessionId === void 0 ? void 0 : sessions.byId[sessionId]?.cwd;
					const normalizePath = (value) => value.replace(/[\\/]+$/u, "");
					const workspace = cwd === void 0 ? workspaces.items[0] : workspaces.items.find((candidate) => normalizePath(candidate.path) === normalizePath(cwd));
					return {
						scope: settings,
						interactionScope: interactionSettings,
						connection: ctx.connection,
						...sessionId === void 0 ? {} : { sessionId },
						...workspace === void 0 ? {} : {
							workspaceId: String(workspace.workspaceId),
							workspaceLabel: workspace.title
						},
						t: translate
					};
				}
			}, MnemonSettingsCard));
			const active = /* @__PURE__ */ new Map();
			const reconcile = () => {
				const value = interactionSettings.getSnapshot().value;
				for (const key of Object.keys(INTERACTION_UNITS)) {
					const unit = INTERACTION_UNITS[key];
					const enabled = unit.enabled(value);
					if (enabled && !active.has(key)) active.set(key, ctx.slots.inject(unit.slot, () => unit.register(ctx, namespace, translate, settings)));
					else if (!enabled && active.has(key)) {
						active.get(key)();
						active.delete(key);
					}
				}
			};
			ctx.effect(() => {
				const unsubscribe = interactionSettings.subscribe(reconcile);
				reconcile();
				return () => {
					unsubscribe();
					for (const dispose of [...active.values()].reverse()) dispose();
					active.clear();
				};
			}, "dsh-mnemon: interaction surfaces");
		}
		//#endregion
		exports.EmptyState = EmptyState;
		exports.I18nContext = I18nContext;
		Object.defineProperty(exports, "IconChevronLeftOutline14", {
			enumerable: true,
			get: function() {
				return _deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutline14;
			}
		});
		exports.LocaleContext = LocaleContext;
		exports.MNEMON_SOURCE_CONFIGURATION_MUTATE = MNEMON_SOURCE_CONFIGURATION_MUTATE;
		exports.MNEMON_SOURCE_CONFIGURATION_READ = MNEMON_SOURCE_CONFIGURATION_READ;
		exports.MNEMON_SOURCE_PAGE_SLOT = MNEMON_SOURCE_PAGE_SLOT;
		exports.MemorySourcePageFrame = MemorySourcePageFrame;
		exports.MnemonDialog = MnemonDialog;
		exports.MnemonLogo = MnemonLogo;
		exports.PageHeader = PageHeader;
		exports.PageSpinner = PageSpinner;
		exports.ProgressiveFooter = ProgressiveFooter;
		exports.SectionSpinner = SectionSpinner;
		exports.SidebarModal = SidebarModal;
		exports.appearanceClass = appearanceClass;
		exports.apply = apply;
		exports.createMemorySourcePageClient = createMemorySourcePageClient;
		exports.humanBytes = humanBytes;
		exports.inject = inject;
		exports.installMemorySourceUI = installMemorySourceUI;
		exports.memoryPageStyles = memoryPageStyles;
		exports.memorySidebarStyles = memorySidebarStyles;
		exports.memorySourcePageEntryId = memorySourcePageEntryId;
		exports.message = message;
		exports.parseBranchesInput = parseBranchesInput;
		exports.short = short;
		exports.translateEn = translateEn;
		exports.translateZh = translateZh;
		exports.useLocale = useLocale;
		exports.useRequestVersion = useRequestVersion;
		exports.useT = useT;
		return module.exports;
	}
});
