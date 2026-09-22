window.__ModuleLoader__.load({
	id: "dsh-mnemon-source-runtime",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let dsh_mnemon_client = require("dsh-mnemon/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region presentation/locales.json
		var zh = {
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
		var en = {
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
		//#region \0source-css:/home/runner/work/dsh-mnemon/dsh-mnemon/plugins/dsh-mnemon-source-runtime/presentation/page.module.css.mjs
		const css$2 = ".IIa07q_runtimeComposer{border:1px solid var(--mn-line);background:var(--mn-layer-1);background:linear-gradient(135deg, color-mix(in srgb, var(--mn-accent) 5%, var(--mn-layer-1)), var(--mn-layer-1) 55%);border-radius:12px;margin-bottom:13px;padding:15px}.IIa07q_runtimeComposerHeading{justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:11px;display:flex}.IIa07q_runtimeComposerHeading h3{margin:0 0 2px;font-size:14px}.IIa07q_runtimeComposerHeading p{color:var(--mn-muted);margin:0;font-size:10px}.IIa07q_runtimeComposerHeading>span{color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 9%, transparent);font:650 9px var(--mn-code);border-radius:999px;flex:none;padding:4px 8px}.IIa07q_runtimeComposer>textarea,.IIa07q_runtimeEntry textarea{resize:vertical;border:1px solid var(--mn-line);width:100%;color:var(--mn-text);background:var(--mn-input);border-radius:9px;outline:0;padding:10px 11px;line-height:1.6}.IIa07q_runtimeComposer>textarea:focus,.IIa07q_runtimeEntry textarea:focus{border-color:var(--mn-accent)}.IIa07q_runtimeComposerActions{justify-content:flex-end;align-items:flex-end;gap:9px;margin-top:10px;display:flex}.IIa07q_runtimeComposerActions label{color:var(--mn-faint);gap:4px;font-size:9px;display:grid}.IIa07q_runtimeComposerActions select,.IIa07q_runtimeEntry select{border:1px solid var(--mn-line);background:var(--mn-input);border-radius:8px;outline:0;min-width:135px;height:34px;padding:0 8px}.IIa07q_runtimeReadOnly{border:1px solid color-mix(in srgb, var(--mn-success) 28%, var(--mn-line));color:var(--mn-muted);background:color-mix(in srgb, var(--mn-success) 6%, var(--mn-layer-1));border-color:var(--mn-line);background:var(--mn-layer-1);border-radius:9px;margin-bottom:13px;padding:9px 12px;font-size:11px}.IIa07q_runtimeSummaryGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:10px;display:grid}.IIa07q_runtimeSummaryCard{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px;min-width:0}.IIa07q_runtimeBrowser{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px;overflow:hidden}.IIa07q_runtimeBrowserToolbar{border-bottom:1px solid var(--mn-line);justify-content:space-between;align-items:center;gap:12px;padding:10px;display:flex}.IIa07q_runtimeScopeFilter{flex-wrap:wrap;align-items:center;gap:3px;display:flex}.IIa07q_runtimeScopeFilter button{min-height:32px;color:var(--mn-muted);cursor:pointer;background:0 0;border:1px solid #0000;border-radius:7px;padding:0 10px}.IIa07q_runtimeScopeFilter button:hover{background:var(--mn-hover)}.IIa07q_runtimeScopeFilter button[data-active]{border-color:var(--mn-line);color:var(--mn-text);background:var(--mn-layer-2)}.IIa07q_runtimeScopeFilter b{color:var(--mn-faint);font:600 10px var(--mn-code);margin-left:4px}.IIa07q_runtimeFilterQuery{border:1px solid var(--mn-line);background:var(--mn-input);border-radius:8px;align-items:center;gap:7px;width:min(320px,42%);min-width:210px;padding:0 9px;display:flex}.IIa07q_runtimeFilterQuery>span{color:var(--mn-faint)}.IIa07q_runtimeFilterQuery input{width:100%;min-width:0;height:32px;color:var(--mn-text);background:0 0;border:0;outline:0}.IIa07q_runtimeUnifiedList{background:color-mix(in srgb, var(--mn-layer-2) 30%, var(--mn-layer-1));grid-template-columns:1fr;gap:8px;padding:10px;display:grid}.IIa07q_runtimeEntryBadges{flex-wrap:wrap;align-items:center;gap:5px;display:flex}.IIa07q_runtimeEntryMeta .IIa07q_runtimeEntryTarget{color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 8%, var(--mn-layer-2));font-family:var(--mn-code)}.IIa07q_runtimeEntryMeta .IIa07q_runtimeEntryBranch{text-overflow:ellipsis;white-space:nowrap;max-width:140px;color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 8%, var(--mn-layer-2));font-family:var(--mn-code);overflow:hidden}.IIa07q_runtimeComposerBranch{color:var(--mn-faint);gap:4px;font-size:9px;display:grid}.IIa07q_runtimeComposerBranch input{border:1px solid var(--mn-line);width:100%;color:var(--mn-text);background:var(--mn-input);border-radius:8px;outline:0;padding:7px 9px;font-size:12px}.IIa07q_runtimeComposerBranch input:focus{border-color:var(--mn-accent)}.IIa07q_bodyEditBranch{color:var(--mn-faint);gap:4px;font-size:9px;display:grid}.IIa07q_bodyEditBranch input{border:1px solid var(--mn-line);width:100%;color:var(--mn-text);background:var(--mn-input);border-radius:8px;outline:0;padding:7px 9px;font-size:12px}.IIa07q_bodyEditBranch input:focus{border-color:var(--mn-accent)}.IIa07q_bodyEditBranch small{color:var(--mn-faint);font-size:9px}.IIa07q_runtimeTargetHeader{justify-content:space-between;align-items:center;gap:14px;padding:14px 15px 9px;display:flex}.IIa07q_runtimeTargetHeader>div{gap:1px;display:grid}.IIa07q_runtimeTargetHeader span{color:var(--mn-faint);font:650 9px var(--mn-code);letter-spacing:.08em}.IIa07q_runtimeTargetHeader h3{margin:0;font-size:15px}.IIa07q_runtimeTargetHeader>strong{min-width:28px;height:28px;color:var(--mn-accent);background:color-mix(in srgb, var(--mn-accent) 9%, transparent);font:650 11px var(--mn-code);border-radius:8px;place-items:center;display:grid}.IIa07q_capacityLine{align-items:center;gap:9px;padding:0 15px;display:flex}.IIa07q_capacityLine>div{background:var(--mn-layer-2);border-radius:999px;flex:1;height:4px;overflow:hidden}.IIa07q_capacityLine i{border-radius:inherit;background:var(--mn-success);height:100%;transition:width .25s;display:block}.IIa07q_capacityLine>span{min-width:88px;color:var(--mn-faint);font:9px var(--mn-code);text-align:right}.IIa07q_runtimeTargetDescription{min-height:31px;color:var(--mn-muted);margin:8px 15px 12px;font-size:10px}.IIa07q_runtimeEntry{--mn-provider-color:var(--mn-accent);border:1px solid var(--mn-line);background:linear-gradient(90deg, color-mix(in srgb, var(--mn-provider-color) 5%, var(--mn-layer-1)), var(--mn-layer-1) 34%);box-shadow:inset 3px 0 0 color-mix(in srgb, var(--mn-provider-color) 68%, transparent);border-radius:8px;padding:11px 12px 10px;position:relative}.IIa07q_runtimeEntry[data-importance=critical]{--mn-provider-color:var(--mn-priority)}.IIa07q_runtimeEntry[data-importance=low]{--mn-provider-color:var(--mn-faint)}.IIa07q_runtimeEntryMeta{justify-content:space-between;align-items:center;gap:12px;display:flex}.IIa07q_runtimeEntryMeta>span,.IIa07q_runtimeEntryBadges>span{color:var(--mn-muted);background:var(--mn-layer-2);border-radius:999px;padding:2px 6px;font-size:9px}.IIa07q_runtimeEntry[data-importance=critical] .IIa07q_runtimeEntryMeta>span,.IIa07q_runtimeEntry[data-importance=critical] .IIa07q_runtimeEntryBadges>span:not(.IIa07q_runtimeEntryTarget){color:var(--mn-priority);background:color-mix(in srgb, var(--mn-priority) 9%, transparent)}.IIa07q_runtimeEntryMeta time{color:var(--mn-faint);font:8px var(--mn-code);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.IIa07q_runtimeEntry>p{white-space:pre-wrap;overflow-wrap:anywhere;min-height:42px;margin:9px 0;font-size:12px;line-height:1.6}.IIa07q_runtimeEntry>select{margin-top:7px}.IIa07q_runtimeEntry footer{border-top:1px solid var(--mn-line);justify-content:flex-end;align-items:center;gap:4px;min-height:30px;margin-top:7px;padding-top:7px;display:flex}.IIa07q_runtimeEntry footer>span{color:var(--mn-danger);margin-right:auto;font-size:10px}.IIa07q_runtimeEmpty{min-height:126px;color:var(--mn-faint);text-align:center;align-content:center;place-items:center;gap:5px;display:grid}.IIa07q_runtimeEmpty>span{font:24px var(--mn-code);opacity:.65}.IIa07q_runtimeEmpty p{margin:0;font-size:10px}@media (width<=1000px){.IIa07q_runtimeSummaryGrid{grid-template-columns:1fr}}@media (width<=760px){.IIa07q_runtimeComposerHeading,.IIa07q_runtimeComposerActions{flex-direction:column;align-items:stretch}.IIa07q_runtimeComposerActions select,.IIa07q_runtimeComposerActions button{width:100%}.IIa07q_runtimeBrowserToolbar{flex-direction:column;align-items:stretch}.IIa07q_runtimeFilterQuery{width:100%;min-width:0}}";
		const id$1 = "dsh-mnemon-source-runtime/presentation/page.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(id$1) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = id$1;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css$2) tag.textContent = css$2;
		}
		var page_module_css_default = {
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
		//#region \0source-css:/home/runner/work/dsh-mnemon/dsh-mnemon/plugins/dsh-mnemon-source-runtime/presentation/sidebar.module.css.mjs
		const css$1 = "._Bh55G_shell ._Bh55G_modal form[class*=runtimeComposer]{background:0 0;border:0;border-radius:0;margin:0;padding:0}._Bh55G_shell ._Bh55G_modal form[class*=runtimeComposer]>[class*=runtimeComposerHeading]{display:none}._Bh55G_shell [class*=runtimeComposerActions] label{color:var(--dsw-alias-label-secondary);gap:5px;font-size:12px;font-weight:500}._Bh55G_shell [class*=runtimeComposer]>textarea,._Bh55G_shell [class*=runtimeComposerActions] select,._Bh55G_shell [class*=runtimeEntry] select{border:1px solid var(--dsw-alias-border-l2);min-height:34px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:8px;padding:7px 10px;font-size:13px;font-weight:400}._Bh55G_shell [class*=runtimeTargetDescription]{font-size:12px}._Bh55G_shell [class*=runtimeEntryMeta]>span,._Bh55G_shell [class*=runtimeEntryBadges]>span,._Bh55G_shell [class*=runtimeEntryMeta] time{font-size:11px}._Bh55G_shell [class*=runtimeEntry]>p{font-size:13px}._Bh55G_shell [class*=runtimeEntryBadges]>span{border:1px solid var(--dsw-alias-border-l1);min-height:22px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-radius:999px;align-items:center;padding:0 8px;font-size:11px;font-weight:400;line-height:20px;display:inline-flex}._Bh55G_shell [class*=runtimeEntryBadges]>[class*=runtimeEntryTarget]{border-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, var(--dsw-alias-border-l1));color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-layer-1));font-family:var(--dsw-font-family);font-weight:500}._Bh55G_shell [class*=runtimeEntry][data-importance=critical] [class*=runtimeEntryBadges]>span:last-child{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 24%, var(--dsw-alias-border-l1));color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 6%, var(--dsw-alias-bg-layer-1))}._Bh55G_shell [class*=runtimeEntry] footer{gap:6px}";
		const id = "dsh-mnemon-source-runtime/presentation/sidebar.module.css";
		if (typeof document !== "undefined") {
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(id) + "]");
			if (!tag) {
				tag = document.createElement("style");
				tag.dataset.pluginCss = id;
				document.head.appendChild(tag);
			}
			if (tag.textContent !== css$1) tag.textContent = css$1;
		}
		var sidebar_module_css_default = {
			"modal": "_Bh55G_modal",
			"shell": "_Bh55G_shell"
		};
		//#endregion
		//#region src/client/presentation.ts
		const css = {
			...dsh_mnemon_client.memoryPageStyles,
			...page_module_css_default
		};
		const sidebarCss = {
			...dsh_mnemon_client.memorySidebarStyles,
			...sidebar_module_css_default
		};
		function useT() {
			const fallback = (0, dsh_mnemon_client.useT)();
			const locale = (0, dsh_mnemon_client.useLocale)();
			return (0, react.useMemo)(() => (key, params) => {
				const dictionary = locale.startsWith("en") ? en : zh;
				if (!Object.hasOwn(dictionary, key)) return fallback(key, params);
				const text = dictionary[key];
				return params === void 0 ? text : text.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
			}, [locale, fallback]);
		}
		//#endregion
		//#region src/client/pages.tsx
		function RuntimePage(props) {
			const t = useT();
			const locale = (0, dsh_mnemon_client.useLocale)();
			const runtimeAddFormId = (0, react.useId)();
			const runtimeEditFormId = (0, react.useId)();
			const pageSize = 10;
			const [snapshot, setSnapshot] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [target, setTarget] = (0, react.useState)("memory");
			const [importance, setImportance] = (0, react.useState)("normal");
			const [content, setContent] = (0, react.useState)("");
			const [saving, setSaving] = (0, react.useState)(false);
			const [editing, setEditing] = (0, react.useState)(null);
			const [editContent, setEditContent] = (0, react.useState)("");
			const [editImportance, setEditImportance] = (0, react.useState)("normal");
			const [branches, setBranches] = (0, react.useState)("");
			const [editBranches, setEditBranches] = (0, react.useState)("");
			const [editBranchesOriginal, setEditBranchesOriginal] = (0, react.useState)("");
			const [removing, setRemoving] = (0, react.useState)(null);
			const [adding, setAdding] = (0, react.useState)(false);
			const [filterTarget, setFilterTarget] = (0, react.useState)("all");
			const [filterQuery, setFilterQuery] = (0, react.useState)("");
			const [visibleLimit, setVisibleLimit] = (0, react.useState)(pageSize);
			const load = (0, react.useCallback)(async () => {
				setLoading(true);
				setError(null);
				try {
					setSnapshot(await props.client.runtimeMemory());
				} catch (reason) {
					setError((0, dsh_mnemon_client.message)(reason));
				} finally {
					setLoading(false);
				}
			}, [props.client]);
			(0, react.useEffect)(() => {
				load();
			}, [load, props.revision]);
			(0, react.useEffect)(() => {
				setVisibleLimit(pageSize);
			}, [filterQuery, filterTarget]);
			const entryKey = (entry) => `${entry.target}:${entry.created_at}:${entry.content}`;
			const mutate = async (request) => {
				setNotice(null);
				setError(null);
				const result = await props.client.mutateRuntimeMemory(request);
				setNotice(result.maintenance === void 0 ? t(`runtime.result.${request.action}`, {
					target: t(`runtime.target.${request.target}`),
					count: result.entryCount
				}) : result.maintenance.kind === "local-compaction" ? t("runtime.result.localCompaction", {
					target: t(`runtime.target.${request.target}`),
					count: result.entryCount
				}) : t("runtime.result.maintenance", {
					target: t(`runtime.target.${request.target}`),
					count: result.entryCount,
					spaces: result.maintenance.memoryBodyIds.join(", ") || "—"
				}));
				await load();
				props.onMutate();
			};
			const add = async (event) => {
				event.preventDefault();
				if (content.trim() === "") return;
				setSaving(true);
				try {
					const branchInput = target === "memory" ? (0, dsh_mnemon_client.parseBranchesInput)(branches) : void 0;
					await mutate({
						action: "add",
						target,
						content,
						importance,
						...branchInput === void 0 ? {} : { branches: branchInput }
					});
					setContent("");
					setBranches("");
					setAdding(false);
				} catch (reason) {
					setError((0, dsh_mnemon_client.message)(reason));
				} finally {
					setSaving(false);
				}
			};
			const beginEdit = (entry) => {
				const branchText = entry.branches?.join(", ") ?? "";
				setEditing(entryKey(entry));
				setEditContent(entry.content);
				setEditImportance(entry.importance);
				setEditBranches(branchText);
				setEditBranchesOriginal(branchText);
				setRemoving(null);
			};
			const replace = async (entry) => {
				if (editContent.trim() === "") return;
				setSaving(true);
				try {
					const rawBranches = editBranches.trim();
					const branchDelta = entry.target !== "memory" || rawBranches === editBranchesOriginal.trim() ? void 0 : rawBranches === "" ? [] : (0, dsh_mnemon_client.parseBranchesInput)(editBranches);
					await mutate({
						action: "replace",
						target: entry.target,
						old_text: entry.content,
						content: editContent,
						importance: editImportance,
						...branchDelta === void 0 ? {} : { branches: branchDelta }
					});
					setEditing(null);
				} catch (reason) {
					setError((0, dsh_mnemon_client.message)(reason));
				} finally {
					setSaving(false);
				}
			};
			const remove = async (entry) => {
				setSaving(true);
				try {
					await mutate({
						action: "remove",
						target: entry.target,
						old_text: entry.content
					});
					setRemoving(null);
				} catch (reason) {
					setError((0, dsh_mnemon_client.message)(reason));
				} finally {
					setSaving(false);
				}
			};
			const runtimeEditActionClass = (0, dsh_mnemon_client.appearanceClass)(css.ghostButton, (0, dsh_mnemon_client.appearanceClass)(sidebarCss.itemActionButton, sidebarCss.itemEditAction));
			const runtimeRemoveActionClass = (0, dsh_mnemon_client.appearanceClass)(css.dangerButton, (0, dsh_mnemon_client.appearanceClass)(sidebarCss.itemActionButton, sidebarCss.itemDangerAction));
			const runtimeEntry = (entry, showTarget = false) => {
				const key = entryKey(entry);
				const isRemoving = removing === key;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
					className: css.runtimeEntry,
					"data-importance": entry.importance,
					"data-target": entry.target,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: css.runtimeEntryMeta,
							children: [showTarget ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: css.runtimeEntryBadges,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: css.runtimeEntryTarget,
										children: entry.target === "user" ? "USER.md" : "MEMORY.md"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(`runtime.importance.${entry.importance}`) }),
									entry.branches !== void 0 && entry.branches.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: css.runtimeEntryBranch,
										title: t("runtime.branchBadge"),
										children: entry.branches.join(", ")
									})
								]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(`runtime.importance.${entry.importance}`) }), entry.branches !== void 0 && entry.branches.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: css.runtimeEntryBranch,
								title: t("runtime.branchBadge"),
								children: entry.branches.join(", ")
							})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
								dateTime: entry.created_at,
								children: new Date(entry.created_at).toLocaleString(locale)
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: entry.content }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("footer", { children: props.writeEnabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: runtimeEditActionClass,
							disabled: saving && isRemoving,
							onClick: () => beginEdit(entry),
							children: t("runtime.editAction")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: runtimeRemoveActionClass,
							disabled: saving && isRemoving,
							onClick: () => {
								setRemoving(key);
								setEditing(null);
							},
							children: t("runtime.removeAction")
						})] }) : null })
					]
				}, key);
			};
			const targetSummary = (value) => {
				const view = snapshot?.targets[value];
				const percentage = view === void 0 || view.limit === 0 ? 0 : Math.min(100, Math.round(view.used / view.limit * 100));
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: css.runtimeSummaryCard,
					"aria-label": t(`runtime.target.${value}`),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: css.runtimeTargetHeader,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: value === "user" ? "USER.md" : "MEMORY.md" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t(`runtime.target.${value}`) })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: view?.entryCount ?? 0 })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: css.capacityLine,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: { width: `${percentage}%` } }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: view === void 0 ? "—" : `${(0, dsh_mnemon_client.humanBytes)(view.used)} / ${(0, dsh_mnemon_client.humanBytes)(view.limit)}` })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: css.runtimeTargetDescription,
							children: t(`runtime.target.${value}.description`)
						})
					]
				});
			};
			const normalizedQuery = filterQuery.trim().toLocaleLowerCase();
			const filteredEntries = (snapshot?.entries ?? []).filter((entry) => (filterTarget === "all" || entry.target === filterTarget) && (normalizedQuery === "" || entry.content.toLocaleLowerCase().includes(normalizedQuery))).sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
			const visibleEntries = filteredEntries.slice(0, visibleLimit);
			const closeComposer = () => {
				setContent("");
				setAdding(false);
			};
			const composer = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				id: runtimeAddFormId,
				className: css.runtimeComposer,
				onSubmit: (event) => void add(event),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: css.runtimeComposerHeading,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("runtime.addTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("runtime.addDescription") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("runtime.hotContext") })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						"aria-label": t("runtime.content"),
						value: content,
						onChange: (event) => setContent(event.target.value),
						rows: 3,
						placeholder: t("runtime.placeholder")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: css.runtimeComposerActions,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("runtime.target"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								value: target,
								onChange: (event) => setTarget(event.target.value),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "memory",
									children: t("runtime.target.memory")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "user",
									children: t("runtime.target.user")
								})]
							})] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("runtime.importance"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								value: importance,
								onChange: (event) => setImportance(event.target.value),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "critical",
										children: t("runtime.importance.critical")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "normal",
										children: t("runtime.importance.normal")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: "low",
										children: t("runtime.importance.low")
									})
								]
							})] }),
							target === "memory" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								className: css.runtimeComposerBranch,
								children: [t("runtime.branches"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									value: branches,
									onChange: (event) => setBranches(event.target.value),
									placeholder: t("runtime.branchesPlaceholder"),
									"aria-label": t("runtime.branches")
								})]
							})
						]
					})
				]
			});
			const editingEntry = editing === null ? void 0 : snapshot?.entries.find((entry) => entryKey(entry) === editing);
			const removingEntry = removing === null ? void 0 : snapshot?.entries.find((entry) => entryKey(entry) === removing);
			const editForm = editingEntry === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				id: runtimeEditFormId,
				className: css.bodyEdit,
				onSubmit: (event) => {
					event.preventDefault();
					replace(editingEntry);
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("runtime.editContent"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						"aria-label": t("runtime.editContent"),
						value: editContent,
						onChange: (event) => setEditContent(event.target.value),
						rows: 7
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("runtime.importance"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						"aria-label": t("runtime.importance"),
						value: editImportance,
						onChange: (event) => setEditImportance(event.target.value),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "critical",
								children: t("runtime.importance.critical")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "normal",
								children: t("runtime.importance.normal")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "low",
								children: t("runtime.importance.low")
							})
						]
					})] }),
					editingEntry.target === "memory" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: css.bodyEditBranch,
						children: [
							t("runtime.branches"),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								value: editBranches,
								onChange: (event) => setEditBranches(event.target.value),
								placeholder: t("runtime.branchesPlaceholder"),
								"aria-label": t("runtime.branches")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("runtime.branchesHint") })
						]
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: css.page,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(dsh_mnemon_client.PageHeader, {
						title: t("runtime.title"),
						description: t("runtime.description"),
						meta: snapshot === null ? t("common.loading") : t("runtime.total", { count: snapshot.entries.length }),
						action: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: css.secondaryButton,
							disabled: loading,
							onClick: () => void load(),
							children: t("runtime.refresh")
						}), props.writeEnabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: css.primaryButton,
							onClick: () => setAdding(true),
							children: t("runtime.addButton")
						})] })
					}),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: css.inlineError,
						role: "alert",
						children: error
					}),
					notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: css.runtimeNotice,
						role: "status",
						children: notice
					}),
					!props.writeEnabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: css.runtimeReadOnly,
						children: t("runtime.readOnly")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: css.runtimeSummaryGrid,
						children: [targetSummary("user"), targetSummary("memory")]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: css.runtimeBrowser,
						"aria-label": t("runtime.entriesAria"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: css.runtimeBrowserToolbar,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: css.runtimeScopeFilter,
									role: "group",
									"aria-label": t("runtime.scopeAria"),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											"data-active": filterTarget === "all" || void 0,
											onClick: () => setFilterTarget("all"),
											children: [
												t("runtime.scopeAll"),
												" ",
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: snapshot?.entries.length ?? 0 })
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											"data-active": filterTarget === "user" || void 0,
											onClick: () => setFilterTarget("user"),
											children: [
												t("runtime.target.user"),
												" ",
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: snapshot?.targets.user.entryCount ?? 0 })
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											"data-active": filterTarget === "memory" || void 0,
											onClick: () => setFilterTarget("memory"),
											children: [
												t("runtime.target.memory"),
												" ",
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: snapshot?.targets.memory.entryCount ?? 0 })
											]
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: css.runtimeFilterQuery,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": "true",
										children: "⌕"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										"aria-label": t("runtime.filterAria"),
										value: filterQuery,
										onChange: (event) => setFilterQuery(event.target.value),
										placeholder: t("runtime.filterPlaceholder")
									})]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: css.runtimeUnifiedList,
								children: [visibleEntries.map((entry) => runtimeEntry(entry, true)), !loading && filteredEntries.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: css.runtimeEmpty,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "○" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("runtime.noMatch") })]
								})]
							}),
							!loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(dsh_mnemon_client.ProgressiveFooter, {
								visible: visibleEntries.length,
								total: filteredEntries.length,
								pageSize,
								onMore: () => setVisibleLimit((value) => value + pageSize)
							})
						]
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: css.runtimeFootnote,
						children: t("runtime.footnote")
					}),
					adding && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(dsh_mnemon_client.SidebarModal, {
						title: t("runtime.addTitle"),
						description: t("runtime.addDescription"),
						busy: saving,
						onClose: closeComposer,
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: css.modalFooterActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"data-dialog-close": true,
								className: css.ghostButton,
								disabled: saving,
								onClick: closeComposer,
								children: t("common.cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								form: runtimeAddFormId,
								className: css.primaryButton,
								disabled: saving || content.trim() === "",
								children: saving ? t("runtime.saving") : t("runtime.addAction")
							})]
						}),
						children: composer
					}),
					editingEntry !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(dsh_mnemon_client.SidebarModal, {
						title: t("runtime.editContent"),
						description: t(`runtime.target.${editingEntry.target}`),
						busy: saving,
						onClose: () => setEditing(null),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: css.modalFooterActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"data-dialog-close": true,
								className: css.ghostButton,
								disabled: saving,
								onClick: () => setEditing(null),
								children: t("common.cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								form: runtimeEditFormId,
								className: css.primaryButton,
								disabled: saving || editContent.trim() === "",
								children: t("runtime.saveEdit")
							})]
						}),
						children: editForm
					}),
					removingEntry !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(dsh_mnemon_client.SidebarModal, {
						title: t("runtime.removeTitle"),
						description: t(`runtime.target.${removingEntry.target}`),
						busy: saving,
						onClose: () => setRemoving(null),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: css.modalFooterActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"data-dialog-close": true,
								"data-autofocus": true,
								className: css.ghostButton,
								disabled: saving,
								onClick: () => setRemoving(null),
								children: t("common.cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: css.dangerSolidButton,
								disabled: saving,
								onClick: () => void remove(removingEntry),
								children: t("runtime.removeAction")
							})]
						}),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: css.bodyDeleteConfirm,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("runtime.removeWarning") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: css.bodyDeleteSummary,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: css.bodyDeleteContent,
									children: removingEntry.content
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t(`runtime.importance.${removingEntry.importance}`) })]
							})]
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/ui.tsx
		function runtimePageClient(management) {
			const client = (0, dsh_mnemon_client.createMemorySourcePageClient)(management);
			return {
				runtimeMemory: () => client.read("snapshot"),
				mutateRuntimeMemory: (input) => client.canAssist("mutate") ? client.assist("mutate", {
					...input,
					...input.old_text === void 0 ? {} : { oldText: input.old_text }
				}, true) : client.mutate("mutate", { ...input }, true)
			};
		}
		function RuntimeSourceView(props) {
			const client = (0, react.useMemo)(() => props.management === void 0 ? void 0 : runtimePageClient(props.management), [props.management]);
			const [revision, setRevision] = (0, react.useState)(0);
			if (client === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RuntimePage, {
				client,
				revision,
				writeEnabled: props.writable === true,
				onMutate: () => {
					setRevision((value) => value + 1);
					props.onRefresh?.();
				}
			});
		}
		function RuntimeSourcePage(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(dsh_mnemon_client.MemorySourcePageFrame, {
				locale: props.locale,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RuntimeSourceView, { ...props }, props.sourceInstanceKey)
			});
		}
		function installRuntimeMemoryUI(ctx, t = dsh_mnemon_client.translateEn) {
			return (0, dsh_mnemon_client.installMemorySourceUI)(ctx, {
				sourceTypeId: "runtime",
				pages: [{
					id: "entries",
					order: 100,
					navigation: {
						group: "storage",
						glyph: "◫"
					},
					label: () => t("nav.runtime"),
					component: RuntimeSourcePage
				}]
			});
		}
		const inject = ["slots", "locale"];
		function apply(ctx) {
			installRuntimeMemoryUI(ctx, ctx.locale?.bind("mnemon") ?? dsh_mnemon_client.translateEn);
		}
		//#endregion
		exports.RuntimePage = RuntimePage;
		exports.RuntimeSourcePage = RuntimeSourcePage;
		exports.apply = apply;
		exports.inject = inject;
		exports.installRuntimeMemoryUI = installRuntimeMemoryUI;
		exports.runtimePageClient = runtimePageClient;
		return module.exports;
	}
});
