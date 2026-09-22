window.__ModuleLoader__.load({
	id: "dsh-agy",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		/** Required browser services. */
		const inject = ["slots"];
		/** Renders the Settings tab link to the loopback-only Antigravity dashboard. */
		function AgySettingsLink() {
			return (0, react.createElement)("section", null, (0, react.createElement)("h3", null, "Antigravity"), (0, react.createElement)("p", null, "Manage Google Antigravity accounts, quotas, and model checks."), (0, react.createElement)("a", {
				href: "/agy",
				target: "_blank",
				rel: "noreferrer"
			}, "Open Antigravity dashboard"));
		}
		/**
		* Registers the Antigravity Settings tab while this client plugin is active.
		* @param ctx - Client Cordis context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "agy",
				order: 10,
				label: "Antigravity"
			}, AgySettingsLink)), "dsh-agy: Settings tab");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
