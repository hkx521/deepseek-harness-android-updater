window.__ModuleLoader__.load({
	id: "dsh-mnemon-source-documents",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let dsh_mnemon_client = require("dsh-mnemon/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region presentation/locales.json
		var zh = {
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
		var en = {
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
		//#region \0source-css:/home/runner/work/dsh-mnemon/dsh-mnemon/plugins/dsh-mnemon-source-documents/presentation/page.module.css.mjs
		const css$2 = ".IIa07q_documentSummary{grid-template-columns:.7fr .7fr 1.6fr;gap:9px;margin-bottom:12px;display:grid}.IIa07q_documentSummary article{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px;min-width:0;min-height:91px;padding:13px 14px}.IIa07q_documentSummary article>span{color:var(--mn-faint);font-size:9px;display:block}.IIa07q_documentSummary article>strong{font:650 21px/1 var(--mn-code);margin:7px 0 4px;display:block}.IIa07q_documentSummary article>small{color:var(--mn-muted);font-size:9px}.IIa07q_documentCapacity>div{background:var(--mn-layer-2);border-radius:999px;height:4px;margin:7px 0 6px;overflow:hidden}.IIa07q_documentCapacity>div i{border-radius:inherit;background:var(--mn-accent);height:100%;transition:width .3s;display:block}.IIa07q_documentToolbar{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px;align-items:center;gap:9px;margin-bottom:12px;padding:9px;display:flex}.IIa07q_documentToolbar form{flex:1;grid-template-columns:20px minmax(0,1fr) auto;align-items:center;gap:5px;min-width:260px;padding-left:8px;display:grid}.IIa07q_documentToolbar form>span{color:var(--mn-faint);font:15px var(--mn-code)}.IIa07q_documentToolbar input,.IIa07q_documentEditor input,.IIa07q_documentEditor textarea{border:1px solid var(--mn-line);background:var(--mn-input);border-radius:8px;outline:0;width:100%;padding:8px 10px}.IIa07q_documentToolbar input{background:0 0;border-color:#0000;height:34px}.IIa07q_documentToolbar input:focus,.IIa07q_documentEditor input:focus,.IIa07q_documentEditor textarea:focus{border-color:var(--mn-accent)}.IIa07q_documentToolbar>div{border:1px solid var(--mn-line);background:var(--mn-layer-2);border-radius:8px;align-items:center;gap:3px;padding:3px;display:flex}.IIa07q_documentToolbar>div button{min-height:32px;color:var(--mn-muted);cursor:pointer;background:0 0;border:0;border-radius:6px;padding:0 10px;font-size:10.5px}.IIa07q_documentToolbar>div button[data-active]{color:var(--mn-text);background:var(--mn-layer-1);box-shadow:0 1px 3px color-mix(in srgb, var(--mn-text) 8%, transparent)}.IIa07q_documentToolbar>div b{color:var(--mn-faint);font:600 9px var(--mn-code);margin-left:4px}.IIa07q_documentWorkspace{grid-template-columns:minmax(250px,310px) minmax(0,1fr);gap:10px;min-height:590px;display:grid}.IIa07q_documentList,.IIa07q_documentReader{border:1px solid var(--mn-line);background:var(--mn-layer-1);border-radius:11px;min-width:0;overflow:hidden}.IIa07q_documentList{align-self:stretch}.IIa07q_documentList>header{border-bottom:1px solid var(--mn-line);min-height:42px;color:var(--mn-faint);justify-content:space-between;align-items:center;padding:0 12px;font-size:9px;display:flex}.IIa07q_documentList>header code{color:var(--mn-accent)}.IIa07q_documentList>button{--mn-provider-color:var(--mn-faint);border:1px solid var(--mn-line);width:calc(100% - 16px);color:var(--mn-text);background:linear-gradient(90deg, color-mix(in srgb, var(--mn-provider-color) 5%, var(--mn-layer-1)), var(--mn-layer-1) 34%);box-shadow:inset 3px 0 0 color-mix(in srgb, var(--mn-provider-color) 55%, transparent);text-align:left;cursor:pointer;border-radius:8px;margin:8px 8px 0;padding:11px 11px 10px 14px;transition:border-color .15s,background-color .15s,box-shadow .15s;display:block}.IIa07q_documentList>button:hover{--mn-provider-color:var(--mn-accent);border-color:color-mix(in srgb, var(--mn-accent) 28%, var(--mn-line))}.IIa07q_documentList>button[data-selected]{--mn-provider-color:var(--mn-accent);border-color:color-mix(in srgb, var(--mn-accent) 38%, var(--mn-line));background:linear-gradient(90deg, color-mix(in srgb, var(--mn-accent) 7%, var(--mn-layer-1)), var(--mn-layer-1) 38%);box-shadow:inset 3px 0 0 color-mix(in srgb, var(--mn-accent) 78%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--mn-accent) 8%, transparent)}.IIa07q_documentList>button>div{justify-content:space-between;align-items:baseline;gap:12px;display:flex}.IIa07q_documentList>button strong{text-overflow:ellipsis;white-space:nowrap;font-size:12px;overflow:hidden}.IIa07q_documentList>button time{color:var(--mn-faint);font:8px var(--mn-code);flex:none}.IIa07q_documentList>button p{min-height:30px;color:var(--mn-muted);-webkit-line-clamp:2;-webkit-box-orient:vertical;margin:6px 0 9px;font-size:10px;line-height:1.5;display:-webkit-box;overflow:hidden}.IIa07q_documentList>button footer{color:var(--mn-faint);align-items:center;gap:8px;font-size:9px;display:flex}.IIa07q_documentList>button footer code{margin-left:auto}.IIa07q_documentList>button footer em{color:var(--mn-danger);font-style:normal}.IIa07q_documentListEmpty{min-height:230px;color:var(--mn-muted);text-align:center;align-content:center;place-items:center;gap:4px;padding:22px;display:grid}.IIa07q_documentListEmpty>span{color:var(--mn-accent);font:28px var(--mn-code);opacity:.6;margin-bottom:6px}.IIa07q_documentListEmpty p{color:var(--mn-faint);margin:0;font-size:10px}.IIa07q_documentReader{padding:clamp(16px,2vw,22px)}.IIa07q_documentReader>.IIa07q_emptyState{background:0 0;border:0;height:100%}.IIa07q_documentDetail>header{border-bottom:1px solid var(--mn-line);justify-content:space-between;align-items:flex-start;gap:18px;padding-bottom:15px;display:flex}.IIa07q_documentDetail>header span{color:var(--mn-accent);font:650 9px var(--mn-code);letter-spacing:.08em;text-transform:uppercase}.IIa07q_documentDetail>header h3{margin:5px 0 3px;font-size:18px}.IIa07q_documentDetail>header p{color:var(--mn-muted);margin:0;font-size:11px}.IIa07q_documentDetail>dl{border-top:1px solid var(--mn-line);border-left:1px solid var(--mn-line);grid-template-columns:2fr .45fr .8fr .55fr;margin:13px 0;display:grid}.IIa07q_documentDetail>dl>div{border-right:1px solid var(--mn-line);border-bottom:1px solid var(--mn-line);min-width:0;padding:8px 9px}.IIa07q_documentDetail dt{color:var(--mn-faint);margin-bottom:3px;font-size:8px}.IIa07q_documentDetail dd{text-overflow:ellipsis;white-space:nowrap;margin:0;font-size:9px;overflow:hidden}.IIa07q_documentSources{flex-wrap:wrap;align-items:center;gap:5px;margin:11px 0;display:flex}.IIa07q_documentSources>span{color:var(--mn-faint);margin-right:4px;font-size:9px}.IIa07q_documentSources code,.IIa07q_documentArchiveReceipt code{color:var(--mn-muted);background:var(--mn-layer-2);border-radius:5px;padding:3px 6px;font-size:8px}.IIa07q_markdownBody{overflow-wrap:anywhere;border:1px solid var(--mn-line);min-height:310px;color:var(--mn-text);background:color-mix(in srgb, var(--mn-layer-2) 30%, var(--mn-layer-1));border-radius:10px;margin:16px 0 0;padding:clamp(18px,2.5vw,28px);font-size:13px;line-height:1.78}.IIa07q_markdownBody>:first-child{margin-top:0}.IIa07q_markdownBody>:last-child{margin-bottom:0}.IIa07q_markdownBody h1,.IIa07q_markdownBody h2,.IIa07q_markdownBody h3,.IIa07q_markdownBody h4{color:var(--mn-text);letter-spacing:-.015em;margin:1.55em 0 .65em;line-height:1.3}.IIa07q_markdownBody h1{border-bottom:1px solid var(--mn-line);padding-bottom:.35em;font-size:1.75em}.IIa07q_markdownBody h2{border-bottom:1px solid var(--mn-line);padding-bottom:.3em;font-size:1.42em}.IIa07q_markdownBody h3{font-size:1.18em}.IIa07q_markdownBody p,.IIa07q_markdownBody ul,.IIa07q_markdownBody ol,.IIa07q_markdownBody blockquote,.IIa07q_markdownBody table,.IIa07q_markdownBody pre{margin:.85em 0}.IIa07q_markdownBody ul,.IIa07q_markdownBody ol{padding-left:1.6em}.IIa07q_markdownBody li+li{margin-top:.3em}.IIa07q_markdownBody blockquote{border-left:3px solid var(--mn-accent);color:var(--mn-muted);background:color-mix(in srgb, var(--mn-accent) 4%, transparent);margin-inline:0;padding:.15em 1em}.IIa07q_markdownBody code{color:var(--mn-text);background:var(--mn-layer-2);font:.88em/1.55 var(--mn-code);border-radius:5px;padding:.15em .38em}.IIa07q_markdownBody pre{border:1px solid var(--mn-line);background:var(--mn-layer-2);border-radius:9px;max-width:100%;padding:14px 16px;overflow:auto}.IIa07q_markdownBody pre code{background:0 0;padding:0;font-size:11px}.IIa07q_markdownBody a{color:var(--mn-accent);text-underline-offset:3px;text-decoration-thickness:1px}.IIa07q_markdownBody hr{border:0;border-top:1px solid var(--mn-line);margin:1.8em 0}.IIa07q_markdownBody table{border-collapse:collapse;max-width:100%;display:block;overflow-x:auto}.IIa07q_markdownBody th,.IIa07q_markdownBody td{border:1px solid var(--mn-line);text-align:left;vertical-align:top;padding:8px 10px}.IIa07q_markdownBody th{background:var(--mn-layer-2);font-weight:600}.IIa07q_markdownBody img{border-radius:8px;max-width:100%;height:auto}.IIa07q_documentArchiveReceipt{border:1px solid color-mix(in srgb, var(--mn-success) 28%, var(--mn-line));background:color-mix(in srgb, var(--mn-success) 5%, transparent);border-radius:9px;margin:12px 0;padding:11px 12px}.IIa07q_documentArchiveReceipt p{color:var(--mn-muted);margin:4px 0 8px;font-size:10px}.IIa07q_documentArchiveReceipt div{flex-wrap:wrap;gap:5px;display:flex}.IIa07q_documentDanger{border-top:1px solid var(--mn-line);justify-content:flex-end;align-items:center;gap:7px;min-height:57px;margin-top:13px;padding-top:12px;display:flex}.IIa07q_documentDanger>div{margin-right:auto}.IIa07q_documentDanger strong{font-size:11px;display:block}.IIa07q_documentDanger p{color:var(--mn-faint);margin:2px 0 0;font-size:9px}.IIa07q_documentDanger>span{color:var(--mn-danger);margin-right:auto;font-size:10px}.IIa07q_documentEditor{border:1px solid var(--mn-line);background:linear-gradient(135deg, color-mix(in srgb, var(--mn-accent) 5%, var(--mn-layer-1)), var(--mn-layer-1) 55%);border-radius:11px;margin-bottom:12px;padding:15px}.IIa07q_documentReader>.IIa07q_documentEditor{background:0 0;border:0;margin:0;padding:0}.IIa07q_documentEditor>header{justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:12px;display:flex}.IIa07q_documentEditor h3{margin:0;font-size:14px}.IIa07q_documentEditor header p{color:var(--mn-muted);margin:2px 0 0;font-size:10px}.IIa07q_documentEditor header>span,.IIa07q_documentEditor header>code{color:var(--mn-accent);font:650 9px var(--mn-code)}.IIa07q_documentEditor label{color:var(--mn-faint);gap:4px;margin-top:9px;font-size:9px;display:grid}.IIa07q_documentEditor textarea{resize:vertical;line-height:1.65}.IIa07q_documentEditorMeta{grid-template-columns:.8fr 1.2fr;gap:9px;display:grid}.IIa07q_documentEditorMeta label{margin:0}.IIa07q_documentEditor footer{justify-content:flex-end;gap:7px;margin-top:11px;display:flex}@media (width<=1000px){.IIa07q_documentWorkspace{grid-template-columns:minmax(220px,270px) minmax(0,1fr)}.IIa07q_documentDetail>dl{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (width<=760px){.IIa07q_documentSummary{grid-template-columns:repeat(2,minmax(0,1fr))}.IIa07q_documentCapacity{grid-column:1/-1}.IIa07q_documentToolbar{flex-direction:column;align-items:stretch}.IIa07q_documentToolbar form{min-width:0}.IIa07q_documentToolbar>div,.IIa07q_documentToolbar>button{width:100%}.IIa07q_documentToolbar>div button{flex:1}.IIa07q_documentWorkspace{grid-template-columns:1fr;min-height:0}.IIa07q_documentList{-webkit-overflow-scrolling:touch;max-height:330px;overflow:auto}.IIa07q_documentReader{min-height:430px}.IIa07q_documentEditorMeta{grid-template-columns:1fr}}@media (width<=520px){.IIa07q_documentDetail>header,.IIa07q_documentDanger{flex-direction:column;align-items:flex-start}.IIa07q_documentDetail>header>div:last-child,.IIa07q_documentDetail>header button{width:100%}.IIa07q_documentDanger>div,.IIa07q_documentDanger>span{margin-right:0}.IIa07q_documentDanger>button{width:100%}.IIa07q_documentDetail>dl{grid-template-columns:1fr}.IIa07q_markdownBody{padding:16px;font-size:12.5px}}";
		const id$1 = "dsh-mnemon-source-documents/presentation/page.module.css";
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
		//#region \0source-css:/home/runner/work/dsh-mnemon/dsh-mnemon/plugins/dsh-mnemon-source-documents/presentation/sidebar.module.css.mjs
		const css$1 = "._Bh55G_shell ._Bh55G_modal form[class*=documentEditor]{background:0 0;border:0;border-radius:0;margin:0;padding:0}._Bh55G_shell ._Bh55G_modal form[class*=documentEditor]>header{display:none}._Bh55G_shell [class*=documentEditor] label{color:var(--dsw-alias-label-secondary);gap:5px;font-size:12px;font-weight:500}._Bh55G_shell [class*=documentEditor] input,._Bh55G_shell [class*=documentEditor] textarea{border:1px solid var(--dsw-alias-border-l2);min-height:34px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:8px;padding:7px 10px;font-size:13px;font-weight:400}._Bh55G_shell [class*=documentList]>button p,._Bh55G_shell [class*=documentDetail]>header p,._Bh55G_shell [class*=documentArchiveReceipt] p{font-size:12px}._Bh55G_shell [class*=documentSummary] article>span,._Bh55G_shell [class*=documentSummary] article>small,._Bh55G_shell [class*=documentList]>header,._Bh55G_shell [class*=documentList]>button time,._Bh55G_shell [class*=documentList]>button footer,._Bh55G_shell [class*=documentDetail] dt,._Bh55G_shell [class*=documentSources]>span{font-size:11px}._Bh55G_shell [class*=documentToolbar]>div button,._Bh55G_shell [class*=documentDetail] dd,._Bh55G_shell [class*=documentDanger] p{font-size:12px}._Bh55G_shell [class*=documentList]>button strong{font-size:13px}._Bh55G_shell [class*=documentWorkspace]{align-items:stretch;height:clamp(520px,100dvh - 220px,760px);min-height:520px}._Bh55G_shell [class*=documentList],._Bh55G_shell [class*=documentReader]{overscroll-behavior:contain;scrollbar-gutter:stable;min-height:0;overflow-y:auto}@media (width<=760px){._Bh55G_shell [class*=documentWorkspace]{height:auto;min-height:0}._Bh55G_shell [class*=documentList]{scrollbar-gutter:auto;overflow-y:auto}._Bh55G_shell [class*=documentReader]{scrollbar-gutter:auto;overflow:visible}}";
		const id = "dsh-mnemon-source-documents/presentation/sidebar.module.css";
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
		//#region ../../node_modules/.pnpm/markdown-to-jsx@7.7.17_react@18.3.1/node_modules/markdown-to-jsx/dist/index.module.js
		function n() {
			return n = Object.assign ? Object.assign.bind() : function(r) {
				for (var n = 1; n < arguments.length; n++) {
					var e = arguments[n];
					for (var t in e) Object.prototype.hasOwnProperty.call(e, t) && (r[t] = e[t]);
				}
				return r;
			}, n.apply(this, arguments);
		}
		var e = ["children", "options"];
		var u = [
			"allowFullScreen",
			"allowTransparency",
			"autoComplete",
			"autoFocus",
			"autoPlay",
			"cellPadding",
			"cellSpacing",
			"charSet",
			"classId",
			"colSpan",
			"contentEditable",
			"contextMenu",
			"crossOrigin",
			"encType",
			"formAction",
			"formEncType",
			"formMethod",
			"formNoValidate",
			"formTarget",
			"frameBorder",
			"hrefLang",
			"inputMode",
			"keyParams",
			"keyType",
			"marginHeight",
			"marginWidth",
			"maxLength",
			"mediaGroup",
			"minLength",
			"noValidate",
			"radioGroup",
			"readOnly",
			"rowSpan",
			"spellCheck",
			"srcDoc",
			"srcLang",
			"srcSet",
			"tabIndex",
			"useMap"
		].reduce(function(r, n) {
			return r[n.toLowerCase()] = n, r;
		}, {
			class: "className",
			for: "htmlFor"
		});
		var a = {
			amp: "&",
			apos: "'",
			gt: ">",
			lt: "<",
			nbsp: "\xA0",
			quot: "“"
		};
		var i = [
			"style",
			"script",
			"pre"
		];
		var o = [
			"src",
			"href",
			"data",
			"formAction",
			"srcDoc",
			"action"
		];
		var c = /([-A-Z0-9_:]+)(?:\s*=\s*(?:(?:"((?:\\.|[^"])*)")|(?:'((?:\\.|[^'])*)')|(?:\{((?:\\.|{[^}]*?}|[^}])*)\})))?/gi;
		var f = /\n{2,}$/;
		var l = /^(\s*>[\s\S]*?)(?=\n\n|$)/;
		var _ = /^ *> ?/gm;
		var d = /^(?:\[!([^\]]*)\]\n)?([\s\S]*)/;
		var s = /^ {2,}\n/;
		var v = /^(?:([-*_])( *\1){2,}) *(?:\n *)+\n/;
		var p = /^(?: {1,3})?(`{3,}|~{3,}) *(\S+)? *([^\n]*?)?\n([\s\S]*?)(?:\1\n?|$)/;
		var y = /^(?: {4}[^\n]+\n*)+(?:\n *)+\n?/;
		var h = /^(`+)((?:\\`|(?!\1)`|[^`])+)\1/;
		var g = /^(?:\n *)*\n/;
		var m = /\r\n?/g;
		var k = /^\[\^([^\]]+)](:(.*)((\n+ {4,}.*)|(\n(?!\[\^).+))*)/;
		var x = /^\[\^([^\]]+)]/;
		var q = /\f/g;
		var b = /^---[ \t]*\n(.|\n)*\n---[ \t]*\n/;
		var S = /^\s*?\[(x|\s)\]/;
		var z = /^ *(#{1,6}) *([^\n]+?)(?: +#*)?(?:\n *)*(?:\n|$)/;
		var $ = /^ *(#{1,6}) +([^\n]+?)(?: +#*)?(?:\n *)*(?:\n|$)/;
		var E = /^([^\n]+)\n *(=|-)\2{2,} *\n/;
		var A = /^ *(?!<[a-z][^ >/]* ?\/>)<([a-z][^ >/]*) ?((?:[^>]*[^/])?)>\n?(\s*(?:<\1[^>]*?>[\s\S]*?<\/\1>|(?!<\1\b)[\s\S])*?)<\/\1>(?!<\/\1>)\n*/i;
		var R = /&([a-z0-9]+|#[0-9]{1,6}|#x[0-9a-fA-F]{1,6});/gi;
		var B = /^<!--[\s\S]*?(?:-->)/;
		var L = /^(data|aria|x)-[a-z_][a-z\d_.-]*$/;
		var O = /^ *<([a-z][a-z0-9:]*)(?:\s+((?:<.*?>|[^>])*))?\/?>(?!<\/\1>)(\s*\n)?/i;
		var j = /^\{.*\}$/;
		var C = /^(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/;
		var I = /^<([^ >]+[:@\/][^ >]+)>/;
		var T = /-([a-z])?/gi;
		var M = /^(\|.*)\n(?: *(\|? *[-:]+ *\|[-| :]*)\n((?:.*\|.*\n)*))?\n?/;
		var w = /^[^\n]+(?:  \n|\n{2,})/;
		var D = /^\[([^\]]*)\]:\s+<?([^\s>]+)>?\s*("([^"]*)")?/;
		var F = /^!\[([^\]]*)\] ?\[([^\]]*)\]/;
		var P = /^\[([^\]]*)\] ?\[([^\]]*)\]/;
		var Z = /(\n|^[-*]\s|^#|^ {2,}|^-{2,}|^>\s)/;
		var N = /\t/g;
		var G = /(^ *\||\| *$)/g;
		var U = /^ *:-+: *$/;
		var V = /^ *:-+ *$/;
		var H = /^ *-+: *$/;
		var Q = function(r) {
			return "(?=[\\s\\S]+?\\1" + (r ? "\\1" : "") + ")";
		};
		var W = "((?:\\[.*?\\][([].*?[)\\]]|<.*?>(?:.*?<.*?>)?|`.*?`|\\\\\\1|[\\s\\S])+?)";
		var J = RegExp("^([*_])\\1" + Q(1) + W + "\\1\\1(?!\\1)");
		var K = RegExp("^([*_])" + Q(0) + W + "\\1(?!\\1)");
		var X = RegExp("^(==)" + Q(0) + W + "\\1");
		var Y = RegExp("^(~~)" + Q(0) + W + "\\1");
		var rr = /^(:[a-zA-Z0-9-_]+:)/;
		var nr = /^\\([^0-9A-Za-z\s])/;
		var er = /\\([^0-9A-Za-z\s])/g;
		var tr = /^[\s\S](?:(?!  \n|[0-9]\.|http)[^=*_~\-\n:<`\\\[!])*/;
		var ur = /^\n+/;
		var ar = /^([ \t]*)/;
		var ir = /(?:^|\n)( *)$/;
		var or = "(?:\\d+\\.)";
		var cr = "(?:[*+-])";
		function fr(r) {
			return "( *)(" + (1 === r ? or : cr) + ") +";
		}
		var lr = fr(1);
		var _r = fr(2);
		function dr(r) {
			return RegExp("^" + (1 === r ? lr : _r));
		}
		var sr = dr(1);
		var vr = dr(2);
		function pr(r) {
			return RegExp("^" + (1 === r ? lr : _r) + "[^\\n]*(?:\\n(?!\\1" + (1 === r ? or : cr) + " )[^\\n]*)*(\\n|$)", "gm");
		}
		var yr = pr(1);
		var hr = pr(2);
		function gr(r) {
			var n = 1 === r ? or : cr;
			return RegExp("^( *)(" + n + ") [\\s\\S]+?(?:\\n{2,}(?! )(?!\\1" + n + " (?!" + n + " ))\\n*|\\s*\\n*$)");
		}
		var mr = gr(1);
		var kr = gr(2);
		function xr(r, n) {
			var e = 1 === n, t = e ? mr : kr, u = e ? yr : hr, a = e ? sr : vr;
			return {
				t: function(r) {
					return a.test(r);
				},
				u: jr(function(r, n) {
					var e = ir.exec(n.prevCapture);
					return e && (n.list || !n.inline && !n.simple) ? t.exec(r = e[1] + r) : null;
				}),
				i: 1,
				o: function(r, n, t) {
					var i = e ? +r[2] : void 0, o = r[0].replace(f, "\n").match(u), c = !1;
					return {
						items: o.map(function(r, e) {
							var u = a.exec(r)[0].length, i = RegExp("^ {1," + u + "}", "gm"), f = r.replace(i, "").replace(a, ""), l = e === o.length - 1, _ = -1 !== f.indexOf("\n\n") || l && c;
							c = _;
							var d, s = t.inline, v = t.list;
							t.list = !0, _ ? (t.inline = !1, d = zr(f) + "\n\n") : (t.inline = !0, d = zr(f));
							var p = n(d, t);
							return t.inline = s, t.list = v, p;
						}),
						ordered: e,
						start: i
					};
				},
				l: function(n, e, t) {
					return r(n.ordered ? "ol" : "ul", {
						key: t.key,
						start: "20" === n.type ? n.start : void 0
					}, n.items.map(function(n, u) {
						return r("li", { key: u }, e(n, t));
					}));
				}
			};
		}
		var qr = RegExp("^\\[((?:\\[[^\\[\\]]*(?:\\[[^\\[\\]]*\\][^\\[\\]]*)*\\]|[^\\[\\]])*)\\]\\(\\s*<?((?:\\([^)]*\\)|[^\\s\\\\]|\\\\.)*?)>?(?:\\s+['\"]([\\s\\S]*?)['\"])?\\s*\\)");
		var br = /^!\[(.*?)\]\( *((?:\([^)]*\)|[^() ])*) *"?([^)"]*)?"?\)/;
		function Sr(r) {
			return "string" == typeof r;
		}
		function zr(r) {
			for (var n = r.length; n > 0 && r[n - 1] <= " ";) n--;
			return r.slice(0, n);
		}
		function $r(r, n) {
			return r.startsWith(n);
		}
		function Er(r, n, e) {
			if (Array.isArray(e)) {
				for (var t = 0; t < e.length; t++) if ($r(r, e[t])) return !0;
				return !1;
			}
			return e(r, n);
		}
		function Ar(r) {
			return r.replace(/[ÀÁÂÃÄÅàáâãäåæÆ]/g, "a").replace(/[çÇ]/g, "c").replace(/[ðÐ]/g, "d").replace(/[ÈÉÊËéèêë]/g, "e").replace(/[ÏïÎîÍíÌì]/g, "i").replace(/[Ññ]/g, "n").replace(/[øØœŒÕõÔôÓóÒò]/g, "o").replace(/[ÜüÛûÚúÙù]/g, "u").replace(/[ŸÿÝý]/g, "y").replace(/[^a-z0-9- ]/gi, "").replace(/ /gi, "-").toLowerCase();
		}
		function Rr(r) {
			return H.test(r) ? "right" : U.test(r) ? "center" : V.test(r) ? "left" : null;
		}
		function Br(r, n, e, t) {
			var u = e.inTable;
			e.inTable = !0;
			var a = [[]], i = "";
			function o() {
				if (i) {
					var r = a[a.length - 1];
					r.push.apply(r, n(i, e)), i = "";
				}
			}
			return r.trim().split(/(`[^`]*`|\\\||\|)/).filter(Boolean).forEach(function(r, n, e) {
				"|" === r.trim() && (o(), t) ? 0 !== n && n !== e.length - 1 && a.push([]) : i += r;
			}), o(), e.inTable = u, a;
		}
		function Lr(r, n, e) {
			e.inline = !0;
			var t = r[2] ? r[2].replace(G, "").split("|").map(Rr) : [], u = r[3] ? function(r, n, e) {
				return r.trim().split("\n").map(function(r) {
					return Br(r, n, e, !0);
				});
			}(r[3], n, e) : [], a = Br(r[1], n, e, !!u.length);
			return e.inline = !1, u.length ? {
				align: t,
				cells: u,
				header: a,
				type: "25"
			} : {
				children: a,
				type: "21"
			};
		}
		function Or(r, n) {
			return null == r.align[n] ? {} : { textAlign: r.align[n] };
		}
		function jr(r) {
			return r.inline = 1, r;
		}
		function Cr(r) {
			return jr(function(n, e) {
				return e.inline ? r.exec(n) : null;
			});
		}
		function Ir(r) {
			return jr(function(n, e) {
				return e.inline || e.simple ? r.exec(n) : null;
			});
		}
		function Tr(r) {
			return function(n, e) {
				return e.inline || e.simple ? null : r.exec(n);
			};
		}
		function Mr(r) {
			return jr(function(n) {
				return r.exec(n);
			});
		}
		var wr = /(javascript|vbscript|data(?!:image)):/i;
		function Dr(r) {
			try {
				var n = decodeURIComponent(r).replace(/[^A-Za-z0-9/:]/g, "");
				if (wr.test(n)) return null;
			} catch (r) {
				return null;
			}
			return r;
		}
		function Fr(r) {
			return r ? r.replace(er, "$1") : r;
		}
		function Pr(r, n, e) {
			var t = e.inline || !1, u = e.simple || !1;
			e.inline = !0, e.simple = !0;
			var a = r(n, e);
			return e.inline = t, e.simple = u, a;
		}
		function Zr(r, n, e) {
			var t = e.inline || !1, u = e.simple || !1;
			e.inline = !1, e.simple = !0;
			var a = r(n, e);
			return e.inline = t, e.simple = u, a;
		}
		function Nr(r, n, e) {
			var t = e.inline || !1;
			e.inline = !1;
			var u = r(n, e);
			return e.inline = t, u;
		}
		var Gr = function(r, n, e) {
			return { children: Pr(n, r[2], e) };
		};
		function Ur() {
			return {};
		}
		function Vr() {
			return null;
		}
		function Hr() {
			return [].slice.call(arguments).filter(Boolean).join(" ");
		}
		function Qr(r, n, e) {
			for (var t = r, u = n.split("."); u.length && void 0 !== (t = t[u[0]]);) u.shift();
			return t || e;
		}
		function Wr(r, n) {
			var e = Qr(n, r);
			return e ? "function" == typeof e || "object" == typeof e && "render" in e ? e : Qr(n, r + ".component", r) : r;
		}
		function Jr(e, t) {
			var f;
			void 0 === e && (e = ""), void 0 === t && (t = {}), t.overrides = t.overrides || {}, t.namedCodesToUnicode = t.namedCodesToUnicode ? n({}, a, t.namedCodesToUnicode) : a;
			var G = t.slugify || Ar, U = t.sanitizer || Dr, V = t.createElement || react.createElement, H = [
				l,
				p,
				y,
				t.enforceAtxHeadings ? $ : z,
				E,
				M,
				mr,
				kr
			], Q = [].concat(H, [
				w,
				A,
				B,
				O
			]);
			function W(r, n) {
				for (var e = 0; e < r.length; e++) if (r[e].test(n)) return !0;
				return !1;
			}
			function er(r, e) {
				var u = Qr(t.overrides, r + ".props", {});
				return V.apply(void 0, [Wr(r, t.overrides), n({}, e, u, { className: Hr(null == e ? void 0 : e.className, u.className) || void 0 })].concat([].slice.call(arguments, 2)));
			}
			function ir(r) {
				r = r.replace(b, "");
				var n = !1;
				t.forceInline ? n = !0 : t.forceBlock || (n = !1 === Z.test(r));
				for (var e = dr(_r(n ? r : zr(r).replace(ur, "") + "\n\n", { inline: n })); Sr(e[e.length - 1]) && !e[e.length - 1].trim();) e.pop();
				if (null === t.wrapper) return e;
				var u, a = t.wrapper || (n ? "span" : "div");
				if (e.length > 1 || t.forceWrapper) u = e;
				else {
					if (1 === e.length) return "string" == typeof (u = e[0]) ? er("span", { key: "outer" }, u) : u;
					u = null;
				}
				return V(a, { key: "outer" }, u);
			}
			function or(r, n) {
				if (!n || !n.trim()) return null;
				var e = n.match(c);
				return e ? e.reduce(function(n, e) {
					var t = e.indexOf("=");
					if (-1 !== t) {
						var a = function(r) {
							return -1 !== r.indexOf("-") && null === r.match(L) && (r = r.replace(T, function(r, n) {
								return n.toUpperCase();
							})), r;
						}(e.slice(0, t)).trim(), i = function(r) {
							var n = r[0];
							return ("\"" === n || "'" === n) && r.length >= 2 && r[r.length - 1] === n ? r.slice(1, -1) : r;
						}(e.slice(t + 1).trim()), c = u[a] || a;
						if ("ref" === c) return n;
						var f = n[c] = function(r, n, e, t) {
							return "style" === n ? function(r) {
								var n = [], e = "", t = !1, u = !1, a = "";
								if (!r) return n;
								for (var i = 0; i < r.length; i++) {
									var o = r[i];
									if ("\"" !== o && "'" !== o || t || (u ? o === a && (u = !1, a = "") : (u = !0, a = o)), "(" === o && e.endsWith("url") ? t = !0 : ")" === o && t && (t = !1), ";" !== o || u || t) e += o;
									else {
										var c = e.trim();
										if (c) {
											var f = c.indexOf(":");
											if (f > 0) {
												var l = c.slice(0, f).trim(), _ = c.slice(f + 1).trim();
												n.push([l, _]);
											}
										}
										e = "";
									}
								}
								var d = e.trim();
								if (d) {
									var s = d.indexOf(":");
									if (s > 0) {
										var v = d.slice(0, s).trim(), p = d.slice(s + 1).trim();
										n.push([v, p]);
									}
								}
								return n;
							}(e).reduce(function(n, e) {
								var u = e[0], a = e[1];
								return n[u.replace(/(-[a-z])/g, function(r) {
									return r[1].toUpperCase();
								})] = t(a, r, u), n;
							}, {}) : -1 !== o.indexOf(n) ? t(Fr(e), r, n) : (e.match(j) && (e = Fr(e.slice(1, e.length - 1))), "true" === e || "false" !== e && e);
						}(r, a, i, U);
						"string" == typeof f && (A.test(f) || O.test(f)) && (n[c] = ir(f.trim()));
					} else "style" !== e && (n[u[e] || e] = !0);
					return n;
				}, {}) : null;
			}
			var cr = [], fr = {}, lr = ((f = {})[0] = {
				t: [">"],
				u: Tr(l),
				i: 1,
				o: function(r, n, e) {
					var t = r[0].replace(_, "").match(d);
					return {
						alert: t[1],
						children: n(t[2], e)
					};
				},
				l: function(r, n, e) {
					var t = { key: e.key };
					return r.alert && (t.className = "markdown-alert-" + G(r.alert.toLowerCase(), Ar), r.children.unshift({
						attrs: {},
						children: [{
							type: "27",
							text: r.alert
						}],
						noInnerParse: !0,
						type: "11",
						tag: "header"
					})), er("blockquote", t, n(r.children, e));
				}
			}, f[1] = {
				t: ["  "],
				u: Mr(s),
				i: 1,
				o: Ur,
				l: function(r, n, e) {
					return er("br", { key: e.key });
				}
			}, f[2] = {
				t: [
					"--",
					"__",
					"**",
					"- ",
					"* ",
					"_ "
				],
				u: Tr(v),
				i: 1,
				o: Ur,
				l: function(r, n, e) {
					return er("hr", { key: e.key });
				}
			}, f[3] = {
				t: ["    "],
				u: Tr(y),
				i: 0,
				o: function(r) {
					return {
						lang: void 0,
						text: Fr(zr(r[0].replace(/^ {4}/gm, "")))
					};
				},
				l: function(r, e, t) {
					return er("pre", { key: t.key }, er("code", n({}, r.attrs, { className: r.lang ? "lang-" + r.lang : "" }), r.text));
				}
			}, f[4] = {
				t: ["```", "~~~"],
				u: Tr(p),
				i: 0,
				o: function(r) {
					return {
						attrs: or("code", r[3] || ""),
						lang: r[2] || void 0,
						text: r[4],
						type: "3"
					};
				}
			}, f[5] = {
				t: ["`"],
				u: Ir(h),
				i: 3,
				o: function(r) {
					return { text: Fr(r[2]) };
				},
				l: function(r, n, e) {
					return er("code", { key: e.key }, r.text);
				}
			}, f[6] = {
				t: ["[^"],
				u: Tr(k),
				i: 0,
				o: function(r) {
					return cr.push({
						footnote: r[2],
						identifier: r[1]
					}), {};
				},
				l: Vr
			}, f[7] = {
				t: ["[^"],
				u: Cr(x),
				i: 1,
				o: function(r) {
					return {
						target: "#" + G(r[1], Ar),
						text: r[1]
					};
				},
				l: function(r, n, e) {
					return er("a", {
						key: e.key,
						href: U(r.target, "a", "href")
					}, er("sup", { key: e.key }, r.text));
				}
			}, f[8] = {
				t: ["[ ]", "[x]"],
				u: Cr(S),
				i: 1,
				o: function(r) {
					return { completed: "x" === r[1].toLowerCase() };
				},
				l: function(r, n, e) {
					return er("input", {
						checked: r.completed,
						key: e.key,
						readOnly: !0,
						type: "checkbox"
					});
				}
			}, f[9] = {
				t: ["#"],
				u: Tr(t.enforceAtxHeadings ? $ : z),
				i: 1,
				o: function(r, n, e) {
					return {
						children: Pr(n, r[2], e),
						id: G(r[2], Ar),
						level: r[1].length
					};
				},
				l: function(r, n, e) {
					return er("h" + r.level, {
						id: r.id,
						key: e.key
					}, n(r.children, e));
				}
			}, f[10] = {
				t: function(r) {
					var n = r.indexOf("\n");
					return n > 0 && n < r.length - 1 && ("=" === r[n + 1] || "-" === r[n + 1]);
				},
				u: Tr(E),
				i: 1,
				o: function(r, n, e) {
					return {
						children: Pr(n, r[1], e),
						level: "=" === r[2] ? 1 : 2,
						type: "9"
					};
				}
			}, f[11] = {
				t: ["<"],
				u: Mr(A),
				i: 1,
				o: function(r, n, e) {
					var t = r[3].match(ar), u = RegExp("^" + t[1], "gm"), a = r[3].replace(u, ""), o = W(Q, a) ? Nr : Pr, c = r[1].toLowerCase(), f = -1 !== i.indexOf(c), l = (f ? c : r[1]).trim(), _ = {
						attrs: or(l, r[2]),
						noInnerParse: f,
						tag: l
					};
					if (e.inAnchor = e.inAnchor || "a" === c, f) _.text = r[3];
					else {
						var d = e.inHTML;
						e.inHTML = !0, _.children = o(n, a, e), e.inHTML = d;
					}
					return e.inAnchor = !1, _;
				},
				l: function(r, e, t) {
					return er(r.tag, n({ key: t.key }, r.attrs), r.text || (r.children ? e(r.children, t) : ""));
				}
			}, f[13] = {
				t: ["<"],
				u: Mr(O),
				i: 1,
				o: function(r) {
					var n = r[1].trim();
					return {
						attrs: or(n, r[2] || ""),
						tag: n
					};
				},
				l: function(r, e, t) {
					return er(r.tag, n({}, r.attrs, { key: t.key }));
				}
			}, f[12] = {
				t: ["<!--"],
				u: Mr(B),
				i: 1,
				o: function() {
					return {};
				},
				l: Vr
			}, f[14] = {
				t: ["!["],
				u: Ir(br),
				i: 1,
				o: function(r) {
					return {
						alt: Fr(r[1]),
						target: Fr(r[2]),
						title: Fr(r[3])
					};
				},
				l: function(r, n, e) {
					return er("img", {
						key: e.key,
						alt: r.alt || void 0,
						title: r.title || void 0,
						src: U(r.target, "img", "src")
					});
				}
			}, f[15] = {
				t: ["["],
				u: Cr(qr),
				i: 3,
				o: function(r, n, e) {
					return {
						children: Zr(n, r[1], e),
						target: Fr(r[2]),
						title: Fr(r[3])
					};
				},
				l: function(r, n, e) {
					return er("a", {
						key: e.key,
						href: U(r.target, "a", "href"),
						title: r.title
					}, n(r.children, e));
				}
			}, f[16] = {
				t: ["<"],
				u: Cr(I),
				i: 0,
				o: function(r) {
					var n = r[1], e = !1;
					return -1 !== n.indexOf("@") && -1 === n.indexOf("//") && (e = !0, n = n.replace("mailto:", "")), {
						children: [{
							text: n,
							type: "27"
						}],
						target: e ? "mailto:" + n : n,
						type: "15"
					};
				}
			}, f[17] = {
				t: function(r, n) {
					return !n.inAnchor && !t.disableAutoLink && ($r(r, "http://") || $r(r, "https://"));
				},
				u: Cr(C),
				i: 0,
				o: function(r) {
					return {
						children: [{
							text: r[1],
							type: "27"
						}],
						target: r[1],
						title: void 0,
						type: "15"
					};
				}
			}, f[20] = xr(er, 1), f[33] = xr(er, 2), f[19] = {
				t: ["\n"],
				u: Tr(g),
				i: 3,
				o: Ur,
				l: function() {
					return "\n";
				}
			}, f[21] = {
				u: jr(function(r, n) {
					if (n.inline || n.simple || n.inHTML && -1 === r.indexOf("\n\n") && -1 === n.prevCapture.indexOf("\n\n")) return null;
					for (var e = "", t = 0;;) {
						var u = r.indexOf("\n", t), a = r.slice(t, -1 === u ? void 0 : u + 1);
						if (W(H, a)) break;
						if (e += a, -1 === u || !a.trim()) break;
						t = u + 1;
					}
					var i = zr(e);
					return "" === i ? null : [
						e,
						,
						i
					];
				}),
				i: 3,
				o: Gr,
				l: function(r, n, e) {
					return er("p", { key: e.key }, n(r.children, e));
				}
			}, f[22] = {
				t: ["["],
				u: Cr(D),
				i: 0,
				o: function(r) {
					return fr[r[1]] = {
						target: r[2],
						title: r[4]
					}, {};
				},
				l: Vr
			}, f[23] = {
				t: ["!["],
				u: Ir(F),
				i: 0,
				o: function(r) {
					return {
						alt: r[1] ? Fr(r[1]) : void 0,
						ref: r[2]
					};
				},
				l: function(r, n, e) {
					return fr[r.ref] ? er("img", {
						key: e.key,
						alt: r.alt,
						src: U(fr[r.ref].target, "img", "src"),
						title: fr[r.ref].title
					}) : null;
				}
			}, f[24] = {
				t: function(r) {
					return "[" === r[0] && -1 === r.indexOf("](");
				},
				u: Cr(P),
				i: 0,
				o: function(r, n, e) {
					return {
						children: n(r[1], e),
						fallbackChildren: r[0],
						ref: r[2]
					};
				},
				l: function(r, n, e) {
					return fr[r.ref] ? er("a", {
						key: e.key,
						href: U(fr[r.ref].target, "a", "href"),
						title: fr[r.ref].title
					}, n(r.children, e)) : er("span", { key: e.key }, r.fallbackChildren);
				}
			}, f[25] = {
				t: ["|"],
				u: Tr(M),
				i: 1,
				o: Lr,
				l: function(r, n, e) {
					var t = r;
					return er("table", { key: e.key }, er("thead", null, er("tr", null, t.header.map(function(r, u) {
						return er("th", {
							key: u,
							style: Or(t, u)
						}, n(r, e));
					}))), er("tbody", null, t.cells.map(function(r, u) {
						return er("tr", { key: u }, r.map(function(r, u) {
							return er("td", {
								key: u,
								style: Or(t, u)
							}, n(r, e));
						}));
					})));
				}
			}, f[27] = {
				u: jr(function(r, n) {
					var e;
					return $r(r, ":") && (e = rr.exec(r)), e || tr.exec(r);
				}),
				i: 4,
				o: function(r) {
					var n = r[0];
					return { text: -1 === n.indexOf("&") ? n : n.replace(R, function(r, n) {
						return t.namedCodesToUnicode[n] || r;
					}) };
				},
				l: function(r) {
					return r.text;
				}
			}, f[28] = {
				t: ["**", "__"],
				u: Ir(J),
				i: 2,
				o: function(r, n, e) {
					return { children: n(r[2], e) };
				},
				l: function(r, n, e) {
					return er("strong", { key: e.key }, n(r.children, e));
				}
			}, f[29] = {
				t: function(r) {
					var n = r[0];
					return ("*" === n || "_" === n) && r[1] !== n;
				},
				u: Ir(K),
				i: 3,
				o: function(r, n, e) {
					return { children: n(r[2], e) };
				},
				l: function(r, n, e) {
					return er("em", { key: e.key }, n(r.children, e));
				}
			}, f[30] = {
				t: ["\\"],
				u: Ir(nr),
				i: 1,
				o: function(r) {
					return {
						text: r[1],
						type: "27"
					};
				}
			}, f[31] = {
				t: ["=="],
				u: Ir(X),
				i: 3,
				o: Gr,
				l: function(r, n, e) {
					return er("mark", { key: e.key }, n(r.children, e));
				}
			}, f[32] = {
				t: ["~~"],
				u: Ir(Y),
				i: 3,
				o: Gr,
				l: function(r, n, e) {
					return er("del", { key: e.key }, n(r.children, e));
				}
			}, f);
			!0 === t.disableParsingRawHTML && (delete lr[11], delete lr[13]);
			var _r = function(r) {
				var n = Object.keys(r);
				function e(t, u) {
					var a = [];
					if (u.prevCapture = u.prevCapture || "", t.trim()) for (; t;) for (var i = 0; i < n.length;) {
						var o = n[i], c = r[o];
						if (!c.t || Er(t, u, c.t)) {
							var f = c.u(t, u);
							if (f && f[0]) {
								t = t.substring(f[0].length);
								var l = c.o(f, e, u);
								u.prevCapture += f[0], l.type || (l.type = o), a.push(l);
								break;
							}
							i++;
						} else i++;
					}
					return u.prevCapture = "", a;
				}
				return n.sort(function(n, e) {
					return r[n].i - r[e].i || (n < e ? -1 : 1);
				}), function(r, n) {
					return e(function(r) {
						return r.replace(m, "\n").replace(q, "").replace(N, "    ");
					}(r), n);
				};
			}(lr), dr = function(r, n) {
				return function e(t, u) {
					if (void 0 === u && (u = {}), Array.isArray(t)) {
						for (var a = u.key, i = [], o = !1, c = 0; c < t.length; c++) {
							u.key = c;
							var f = e(t[c], u), l = Sr(f);
							l && o ? i[i.length - 1] += f : null !== f && i.push(f), o = l;
						}
						return u.key = a, i;
					}
					return function(e, t, u) {
						var a = r[e.type].l;
						return n ? n(function() {
							return a(e, t, u);
						}, e, t, u) : a(e, t, u);
					}(t, e, u);
				};
			}(lr, t.renderRule), sr = ir(e);
			return cr.length ? er("div", null, sr, er("footer", { key: "footer" }, cr.map(function(r) {
				return er("div", {
					id: G(r.identifier, Ar),
					key: r.identifier
				}, r.identifier, dr(_r(r.footnote, { inline: !0 })));
			}))) : sr;
		}
		function index_module_default(n) {
			var t = n.children, u = n.options, a = function(r, n) {
				if (null == r) return {};
				var e, t, u = {}, a = Object.keys(r);
				for (t = 0; t < a.length; t++) n.indexOf(e = a[t]) >= 0 || (u[e] = r[e]);
				return u;
			}(n, e);
			return react.cloneElement(Jr(null == t ? "" : t, u), a);
		}
		//#endregion
		//#region src/client/pages.tsx
		const SAFE_LINK_PATTERN = /^(?:https?:|mailto:|#|\/)/iu;
		function safeLink(href) {
			if (href == null) return void 0;
			const value = href.trim();
			return SAFE_LINK_PATTERN.test(value) ? value : void 0;
		}
		/** Render managed Markdown without raw HTML and with a deliberately small link surface. */
		function DocumentMarkdown(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: css.markdownBody,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(index_module_default, {
					options: {
						disableParsingRawHTML: true,
						forceBlock: true,
						overrides: { a: { component: ({ href, children, ...rest }) => {
							const target = safeLink(href);
							return target === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								...rest,
								href: target,
								target: target.startsWith("http") ? "_blank" : void 0,
								rel: target.startsWith("http") ? "noreferrer noopener" : void 0,
								children
							});
						} } }
					},
					children: props.content
				})
			});
		}
		function DocumentsPage(props) {
			const t = useT();
			const locale = (0, dsh_mnemon_client.useLocale)();
			const documentCreateFormId = (0, react.useId)();
			const documentEditFormId = (0, react.useId)();
			const pageSize = 8;
			const readerRef = (0, react.useRef)(null);
			const [snapshot, setSnapshot] = (0, react.useState)(null);
			const [items, setItems] = (0, react.useState)([]);
			const [visibleLimit, setVisibleLimit] = (0, react.useState)(pageSize);
			const [selectedId, setSelectedId] = (0, react.useState)(null);
			const [selected, setSelected] = (0, react.useState)(null);
			const [status, setStatus] = (0, react.useState)("active");
			const [query, setQuery] = (0, react.useState)("");
			const [loading, setLoading] = (0, react.useState)(true);
			const [saving, setSaving] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [composing, setComposing] = (0, react.useState)(false);
			const [editing, setEditing] = (0, react.useState)(false);
			const [confirmArchive, setConfirmArchive] = (0, react.useState)(false);
			const [title, setTitle] = (0, react.useState)("");
			const [description, setDescription] = (0, react.useState)("");
			const [content, setContent] = (0, react.useState)("");
			const [sources, setSources] = (0, react.useState)("");
			const displayRequests = (0, dsh_mnemon_client.useRequestVersion)();
			const display = (0, react.useCallback)(async (nextQuery, nextStatus) => {
				const request = displayRequests.begin();
				setLoading(true);
				setError(null);
				setVisibleLimit(pageSize);
				try {
					const current = await props.client.documents();
					const filtered = (nextQuery.trim() === "" ? current.documents : (await props.client.searchDocuments(nextQuery, nextStatus === "archived")).results).filter((record) => record.status === nextStatus).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
					if (!displayRequests.isCurrent(request)) return;
					setSnapshot(current);
					setItems(filtered);
					setSelectedId((previous) => previous !== null && filtered.some((record) => record.id === previous) ? previous : filtered[0]?.id ?? null);
				} catch (reason) {
					if (!displayRequests.isCurrent(request)) return;
					setError((0, dsh_mnemon_client.message)(reason));
					setSnapshot(null);
					setItems([]);
					setSelectedId(null);
				} finally {
					if (displayRequests.isCurrent(request)) setLoading(false);
				}
			}, [
				displayRequests,
				pageSize,
				props.client
			]);
			(0, react.useEffect)(() => {
				display(query, status);
			}, [
				display,
				props.revision,
				status
			]);
			(0, react.useEffect)(() => {
				setSelected(null);
				if (selectedId === null) return;
				let active = true;
				props.client.document(selectedId).then((value) => {
					if (active) setSelected(value);
				}).catch((reason) => {
					if (active) setError((0, dsh_mnemon_client.message)(reason));
				});
				return () => {
					active = false;
				};
			}, [
				props.client,
				selectedId,
				props.revision
			]);
			(0, react.useLayoutEffect)(() => {
				if (readerRef.current !== null) readerRef.current.scrollTop = 0;
			}, [selectedId]);
			(0, react.useEffect)(() => {
				if (selectedId === null) return;
				const index = items.findIndex((item) => item.id === selectedId);
				if (index >= visibleLimit) setVisibleLimit(Math.ceil((index + 1) / pageSize) * pageSize);
			}, [
				items,
				pageSize,
				selectedId,
				visibleLimit
			]);
			const resetComposer = () => {
				setTitle("");
				setDescription("");
				setContent("");
				setSources("");
				setComposing(false);
			};
			const startComposer = () => {
				setTitle("");
				setDescription("");
				setContent("");
				setSources("");
				setEditing(false);
				setComposing(true);
			};
			const sourcePaths = (value) => value.split(/\r?\n|,/gu).map((path) => path.trim()).filter(Boolean);
			const create = async (event) => {
				event.preventDefault();
				setSaving(true);
				setError(null);
				setNotice(null);
				try {
					const result = await props.client.mutateDocument({
						action: "create",
						title,
						description,
						content,
						sourcePaths: sourcePaths(sources)
					});
					setNotice(result.maintenance === void 0 ? t("documents.created") : t("documents.createdAfterArchive", { count: result.maintenance.archivedDocumentIds.length }));
					setStatus("active");
					setQuery("");
					resetComposer();
					props.onMutate();
					await display("", "active");
					setSelectedId(result.document.id);
				} catch (reason) {
					setError((0, dsh_mnemon_client.message)(reason));
				} finally {
					setSaving(false);
				}
			};
			const beginEdit = () => {
				if (selected === null) return;
				setTitle(selected.title);
				setDescription(selected.description);
				setContent(selected.content);
				setSources(selected.sourcePaths.join("\n"));
				setEditing(true);
				setComposing(false);
				setConfirmArchive(false);
			};
			const update = async (event) => {
				event.preventDefault();
				if (selected === null) return;
				setSaving(true);
				setError(null);
				setNotice(null);
				try {
					const result = await props.client.mutateDocument({
						action: "update",
						id: selected.id,
						title,
						description,
						content,
						sourcePaths: sourcePaths(sources)
					});
					setNotice(result.maintenance === void 0 ? t("documents.updated") : t("documents.updatedAfterArchive", { count: result.maintenance.archivedDocumentIds.length }));
					setEditing(false);
					props.onMutate();
					await display(query, status);
					setSelectedId(result.document.id);
				} catch (reason) {
					setError((0, dsh_mnemon_client.message)(reason));
				} finally {
					setSaving(false);
				}
			};
			const archive = async () => {
				if (selected === null) return;
				setSaving(true);
				setError(null);
				setNotice(null);
				try {
					const result = await props.client.archiveDocument(selected.id);
					setNotice(t("documents.archived", { spaces: result.maintenance?.memoryBodyIds.join(", ") || "—" }));
					setConfirmArchive(false);
					setStatus("archived");
					setQuery("");
					props.onMutate();
					await display("", "archived");
					setSelectedId(result.document.id);
				} catch (reason) {
					setError((0, dsh_mnemon_client.message)(reason));
				} finally {
					setSaving(false);
				}
			};
			const usage = snapshot === null ? 0 : Math.min(100, snapshot.activeBytes / snapshot.limitBytes * 100);
			const activeCount = snapshot?.activeCount ?? 0;
			const archivedCount = snapshot?.archivedCount ?? 0;
			const composer = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				id: documentCreateFormId,
				className: css.documentEditor,
				onSubmit: (event) => void create(event),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("documents.newTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("documents.editorHint") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("documents.managedCopy") })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: css.documentEditorMeta,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("documents.name"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: title,
							onChange: (event) => setTitle(event.target.value),
							required: true
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("documents.routing"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: description,
							onChange: (event) => setDescription(event.target.value)
						})] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("documents.sources"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						value: sources,
						onChange: (event) => setSources(event.target.value),
						placeholder: t("documents.sourcesPlaceholder")
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("documents.markdown"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						value: content,
						onChange: (event) => setContent(event.target.value),
						rows: 10,
						required: true
					})] })
				]
			});
			const editComposer = selected === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
				id: documentEditFormId,
				className: css.documentEditor,
				onSubmit: (event) => void update(event),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("documents.editTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("documents.editorHint") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: selected.id })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: css.documentEditorMeta,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("documents.name"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: title,
							onChange: (event) => setTitle(event.target.value),
							required: true
						})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("documents.routing"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							value: description,
							onChange: (event) => setDescription(event.target.value)
						})] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("documents.sources"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						value: sources,
						onChange: (event) => setSources(event.target.value)
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", { children: [t("documents.markdown"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						value: content,
						onChange: (event) => setContent(event.target.value),
						rows: 18,
						required: true
					})] })
				]
			});
			const documentEditActionClass = (0, dsh_mnemon_client.appearanceClass)(css.ghostButton, (0, dsh_mnemon_client.appearanceClass)(sidebarCss.itemActionButton, sidebarCss.itemEditAction));
			const documentArchiveActionClass = (0, dsh_mnemon_client.appearanceClass)(css.dangerButton, (0, dsh_mnemon_client.appearanceClass)(sidebarCss.itemActionButton, sidebarCss.itemDangerAction));
			const visibleItems = items.slice(0, visibleLimit);
			const selectDocument = (documentId) => {
				if (selectedId === documentId) return;
				setSelected(null);
				setSelectedId(documentId);
				setEditing(false);
				setConfirmArchive(false);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: css.page,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(dsh_mnemon_client.PageHeader, {
						title: t("documents.title"),
						description: t("documents.description"),
						meta: snapshot === null ? t("common.loading") : t("documents.capacity", {
							used: (0, dsh_mnemon_client.humanBytes)(snapshot.activeBytes),
							limit: (0, dsh_mnemon_client.humanBytes)(snapshot.limitBytes)
						}),
						action: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: css.secondaryButton,
							disabled: loading,
							onClick: () => void display(query, status),
							children: t("documents.refresh")
						}), props.writeEnabled && (props.canCreate ?? props.sessionId !== void 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: css.primaryButton,
							onClick: startComposer,
							children: t("documents.new")
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: css.documentSummary,
						"aria-label": t("documents.summary"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("documents.active") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: activeCount }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("documents.activeHint") })
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("documents.archivedCount") }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: archivedCount }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("documents.archivedHint") })
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
								className: css.documentCapacity,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("documents.activeCapacity") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: snapshot === null ? "—" : `${usage.toFixed(1)}%` }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: { width: `${usage}%` } }) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("documents.capacityHint") })
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: css.documentToolbar,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
							onSubmit: (event) => {
								event.preventDefault();
								display(query, status);
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									"aria-hidden": "true",
									children: "⌕"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									"aria-label": t("documents.searchAria"),
									value: query,
									onChange: (event) => setQuery(event.target.value),
									placeholder: t("documents.searchPlaceholder")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "submit",
									className: css.secondaryButton,
									children: t("documents.search")
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							role: "group",
							"aria-label": t("documents.scope"),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								"data-active": status === "active" || void 0,
								onClick: () => setStatus("active"),
								children: [
									t("documents.active"),
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: activeCount })
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								"data-active": status === "archived" || void 0,
								onClick: () => setStatus("archived"),
								children: [
									t("documents.archivedCount"),
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: archivedCount })
								]
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: css.documentWorkspace,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
							className: css.documentList,
							"aria-label": t("documents.list"),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: status === "active" ? t("documents.activeList") : t("documents.archiveList") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: items.length })] }),
								visibleItems.map((document) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									"aria-pressed": selectedId === document.id,
									"data-selected": selectedId === document.id || void 0,
									onClick: () => selectDocument(document.id),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: document.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
											dateTime: document.createdAt,
											children: new Date(document.createdAt).toLocaleDateString(locale)
										})] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: document.description || document.excerpt || t("documents.noDescription") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: (0, dsh_mnemon_client.humanBytes)(document.sizeBytes) }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: document.id.slice(0, 8) }),
											document.healthy === false && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("em", { children: t("documents.missing") })
										] })
									]
								}, document.id)),
								!loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(dsh_mnemon_client.ProgressiveFooter, {
									compact: true,
									visible: visibleItems.length,
									total: items.length,
									pageSize,
									onMore: () => setVisibleLimit((value) => value + pageSize)
								}),
								!loading && items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: css.documentListEmpty,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "▤" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: status === "active" ? t("documents.emptyActive") : t("documents.emptyArchived") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: status === "active" ? t("documents.emptyActiveText") : t("documents.emptyArchivedText") })
									]
								}),
								loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: css.loading,
									children: t("common.loading")
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
							ref: readerRef,
							className: css.documentReader,
							"aria-label": t("documents.reader"),
							"data-scroll-region": "",
							children: selected === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(dsh_mnemon_client.EmptyState, {
								glyph: "▤",
								title: t("documents.selectTitle"),
								children: t("documents.selectText")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
								className: css.documentDetail,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: selected.status === "active" ? t("documents.active") : t("documents.coldArchive") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: selected.title }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: selected.description || t("documents.noDescription") })
									] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: props.writeEnabled && selected.status === "active" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: documentEditActionClass,
										onClick: beginEdit,
										children: t("documents.edit")
									}) })] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("documents.path") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: selected.relativePath }) })] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("documents.revision") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: selected.revision })] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("documents.hash") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: selected.contentHash.slice(0, 16) }) })] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("documents.size") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: (0, dsh_mnemon_client.humanBytes)(selected.sizeBytes) })] })
									] }),
									selected.sourcePaths.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: css.documentSources,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("documents.sources") }), selected.sourcePaths.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: path }, path))]
									}),
									selected.status === "archived" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: css.documentArchiveReceipt,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("documents.archiveReceipt") }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: selected.archiveSummary }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: selected.memoryBodyIds.map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: id }, id)) })
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DocumentMarkdown, { content: selected.content }),
									props.writeEnabled && selected.status === "active" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("footer", {
										className: css.documentDanger,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: t("documents.archiveTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("documents.archiveDescription") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: documentArchiveActionClass,
											onClick: () => setConfirmArchive(true),
											children: t("documents.archive")
										})] })
									})
								]
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: css.runtimeFootnote,
						children: t("documents.footnote")
					}),
					composing && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(dsh_mnemon_client.SidebarModal, {
						title: t("documents.newTitle"),
						description: t("documents.editorHint"),
						busy: saving,
						onClose: resetComposer,
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: css.modalFooterActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"data-dialog-close": true,
								className: css.ghostButton,
								disabled: saving,
								onClick: resetComposer,
								children: t("common.cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								form: documentCreateFormId,
								className: css.primaryButton,
								disabled: saving || title.trim() === "" || content.trim() === "",
								children: saving ? t("documents.saving") : t("documents.create")
							})]
						}),
						children: composer
					}),
					editing && selected !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(dsh_mnemon_client.SidebarModal, {
						title: t("documents.editTitle"),
						description: selected.title,
						busy: saving,
						onClose: () => setEditing(false),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: css.modalFooterActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"data-dialog-close": true,
								className: css.ghostButton,
								disabled: saving,
								onClick: () => setEditing(false),
								children: t("common.cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "submit",
								form: documentEditFormId,
								className: css.primaryButton,
								disabled: saving,
								children: saving ? t("documents.saving") : t("documents.save")
							})]
						}),
						children: editComposer
					}),
					confirmArchive && selected !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(dsh_mnemon_client.SidebarModal, {
						title: t("documents.archiveConfirm"),
						description: selected.title,
						busy: saving,
						onClose: () => setConfirmArchive(false),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: css.modalFooterActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								"data-dialog-close": true,
								"data-autofocus": true,
								className: css.ghostButton,
								disabled: saving,
								onClick: () => setConfirmArchive(false),
								children: t("common.cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: css.dangerSolidButton,
								disabled: saving,
								onClick: () => void archive(),
								children: saving ? t("documents.archiving") : t("documents.archiveNow")
							})]
						}),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: css.bodyDeleteConfirm,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("documents.archiveDescription") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: css.bodyDeleteSummary,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: selected.title }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									selected.relativePath,
									" · ",
									(0, dsh_mnemon_client.humanBytes)(selected.sizeBytes)
								] })]
							})]
						})
					})
				]
			});
		}
		//#endregion
		//#region src/client/ui.tsx
		function documentsPageClient(management) {
			const client = (0, dsh_mnemon_client.createMemorySourcePageClient)(management);
			return {
				documents: () => client.read("snapshot"),
				document: (id) => client.read("document", { id }),
				searchDocuments: (query, includeArchived = false, limit = 50) => client.read("search", {
					query,
					includeArchived,
					limit
				}),
				mutateDocument: (input) => client.canAssist("mutate") ? client.assist("mutate", { ...input }, true) : client.mutate("mutate", { ...input }, true),
				archiveDocument: (id) => client.canAssist("archive") ? client.assist("archive", { id }, true) : client.mutate("archive", { id }, true)
			};
		}
		function DocumentsSourceView(props) {
			const client = (0, react.useMemo)(() => props.management === void 0 ? void 0 : documentsPageClient(props.management), [props.management]);
			const [revision, setRevision] = (0, react.useState)(0);
			if (client === void 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DocumentsPage, {
				canCreate: true,
				client,
				revision,
				writeEnabled: props.writable === true,
				onMutate: () => {
					setRevision((value) => value + 1);
					props.onRefresh?.();
				}
			});
		}
		function DocumentsSourcePage(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(dsh_mnemon_client.MemorySourcePageFrame, {
				locale: props.locale,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DocumentsSourceView, { ...props }, props.sourceInstanceKey)
			});
		}
		function installDocumentsMemoryUI(ctx, t = dsh_mnemon_client.translateEn) {
			return (0, dsh_mnemon_client.installMemorySourceUI)(ctx, {
				sourceTypeId: "documents",
				pages: [{
					id: "library",
					order: 200,
					navigation: {
						group: "storage",
						glyph: "▤"
					},
					label: () => t("nav.documents"),
					component: DocumentsSourcePage
				}]
			});
		}
		const inject = ["slots", "locale"];
		function apply(ctx) {
			installDocumentsMemoryUI(ctx, ctx.locale?.bind("mnemon") ?? dsh_mnemon_client.translateEn);
		}
		//#endregion
		exports.DocumentsPage = DocumentsPage;
		exports.DocumentsSourcePage = DocumentsSourcePage;
		exports.apply = apply;
		exports.documentsPageClient = documentsPageClient;
		exports.inject = inject;
		exports.installDocumentsMemoryUI = installDocumentsMemoryUI;
		return module.exports;
	}
});
