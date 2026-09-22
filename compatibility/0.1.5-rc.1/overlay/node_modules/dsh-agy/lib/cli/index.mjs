import { a as deriveKey, c as resolveDshHome, d as isAgyDisabled, i as createAesGcmCodec, l as resolveMasterKeyCodec, n as maskProxyUrl, o as loadMasterKey, t as JsonAccountStore, u as AgySessionManager, y as AGY_DEFAULT_REDIRECT_URI } from "../accounts-CjOuS29o.mjs";
import { r as normalizeProxyUrl, t as isProxyReachable } from "../proxy-DQPIwUov.mjs";
import { t as exchangeAntigravity } from "../exchange-DNrUFqeJ.mjs";
import { n as upsertImportedAccount, r as authorizeAntigravity, t as importManySources } from "../import-CL05Tqhk.mjs";
import { r as encodeCredentialBlob } from "../blob-D1e7_uT1.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createServer } from "node:http";
//#region src/cli/callback-server.ts
/** Loopback OAuth callback server for the standalone CLI login flow. */
const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Login successful</title></head>
<body style="font-family:system-ui;text-align:center;padding:3rem">
<h2>✓ Authentication successful</h2>
<p>You can close this tab and return to the terminal.</p>
</body></html>`;
/** Listen on 127.0.0.1:<port>/oauth-callback and resolve with the code+state. */
function startCallbackServer(options = {}) {
	const port = options.port ?? 51121;
	const timeoutMs = options.timeoutMs ?? 3e5;
	let resolveResult;
	let rejectResult;
	const result = new Promise((resolve, reject) => {
		resolveResult = resolve;
		rejectResult = reject;
	});
	let resolveReady;
	let rejectReady;
	const ready = new Promise((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (url.pathname === "/oauth-callback") {
			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");
			if (!code || !state) {
				res.writeHead(400, { "Content-Type": "text/html" });
				res.end("<h2>Missing code or state</h2>");
				return;
			}
			res.writeHead(200, {
				"Content-Type": "text/html",
				connection: "close"
			});
			res.end(SUCCESS_HTML);
			resolveResult({
				code,
				state,
				url: url.toString()
			});
			setTimeout(() => server.close(), 1500);
			return;
		}
		res.writeHead(404);
		res.end("Not found");
	});
	server.on("error", (error) => {
		if (error.code === "EADDRINUSE") rejectResult(/* @__PURE__ */ new Error(`Port ${port} is already in use — pass --port to pick another.`));
		else rejectResult(error);
		rejectReady(error);
	});
	server.listen(port, "127.0.0.1", () => {
		resolveReady();
	});
	const timeout = setTimeout(() => {
		rejectResult(/* @__PURE__ */ new Error("Authentication timed out — no callback received."));
		server.close();
	}, timeoutMs);
	return {
		result,
		ready,
		async close() {
			clearTimeout(timeout);
			if (server.listening) {
				server.closeAllConnections();
				await new Promise((resolve) => server.close(() => resolve()));
			}
		}
	};
}
/** Open a URL in the system browser (best effort). */
async function openBrowser(url) {
	const { spawn } = await import("node:child_process");
	const platform = process.platform;
	const command = platform === "darwin" ? ["open", url] : platform === "win32" ? [
		"cmd",
		"/c",
		"start",
		"",
		url
	] : ["xdg-open", url];
	return new Promise((resolve) => {
		const child = spawn(command[0], command.slice(1), { stdio: "ignore" });
		child.on("error", () => resolve(false));
		child.on("spawn", () => resolve(true));
	});
}
//#endregion
//#region src/cli/index.ts
/**
* dsh-agy CLI: login / status / import / verify / logout.
* Standalone bin — the dsh launcher has no plugin subcommand slot, and the
* remote paste-blob flow must run on machines without a harness.
*/
/** Package version, read from the shipped package.json — never hard-coded twice. */
const { version: PACKAGE_VERSION } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
function createStore(options = {}) {
	const dshHome = resolveDshHome();
	let codec;
	if (options.readOnly) {
		const masterKey = loadMasterKey(dshHome);
		if (!masterKey) throw new Error("No agy account store found — run `dsh-agy login` first.");
		codec = createAesGcmCodec(deriveKey(masterKey));
	} else codec = resolveMasterKeyCodec(dshHome).codec;
	return new JsonAccountStore({
		file: `${dshHome}/agy-accounts.json`,
		codec
	});
}
/** Read-only store with a friendly error when no credentials exist yet. */
function createReadOnlyStoreOrExit() {
	try {
		return createStore({ readOnly: true });
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
function resolveProxyOption(raw) {
	if (raw === void 0) return void 0;
	if (!raw.trim()) return "";
	try {
		return normalizeProxyUrl(raw);
	} catch (error) {
		console.error(`Invalid proxy URL: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
}
async function ask(question) {
	const rl = createInterface({
		input: stdin,
		output: stdout
	});
	try {
		return (await rl.question(question)).trim();
	} finally {
		rl.close();
	}
}
/** Remote/SSH sessions cannot reach a local browser; auto-select headless paste. */
function isRemoteSession() {
	return !!(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY);
}
async function loginCommand(options) {
	const proxyInput = resolveProxyOption(options.proxy);
	const normalizedProxy = proxyInput === "" ? "" : proxyInput;
	const store = createStore();
	const redirectUri = `http://localhost:${options.port}/oauth-callback`;
	if (!options.headless && isRemoteSession()) {
		console.log("(SSH session detected — using headless paste flow; pass --headless explicitly to force)");
		options.headless = true;
	}
	let callback;
	if (!options.headless) {
		callback = startCallbackServer({
			port: options.port,
			timeoutMs: Number(options.timeout) || 3e5
		});
		try {
			await callback.ready;
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	}
	const { url, verifier } = await authorizeAntigravity(redirectUri, options.project ?? "");
	console.log(`\nOpen this URL in a browser to authorize:\n\n  ${url}\n`);
	let code;
	let state;
	if (options.headless) {
		const pasted = await ask("After approving, paste the full redirected URL here: ");
		const parsed = new URL(pasted);
		code = parsed.searchParams.get("code") ?? "";
		state = parsed.searchParams.get("state") ?? "";
		if (!code || !state) {
			console.error("Error: pasted URL is missing code or state.");
			process.exit(1);
		}
	} else {
		if (!await openBrowser(url)) console.log("(Could not open a browser automatically — open the URL manually.)");
		let callbackResult;
		try {
			callbackResult = await callback.result;
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
		code = callbackResult.code;
		state = callbackResult.state;
	}
	const result = await exchangeAntigravity(code, state, redirectUri, verifier);
	if (result.type === "failed") {
		console.error(`Login failed: ${result.error}`);
		process.exit(1);
	}
	if (options.blob) {
		if (normalizedProxy !== void 0) console.log("(Note: --proxy is ignored with --blob; proxy is only stored with the account)");
		const blob = encodeCredentialBlob("agy", {
			access_token: result.access,
			refresh_token: result.refresh.split("|")[0],
			expires_in: Math.max(0, Math.round((result.expires - Date.now()) / 1e3))
		});
		console.log(`\nPaste this blob into the remote dashboard/CLI:\n\n${blob}\n`);
	} else {
		const proxyForUpsert = normalizedProxy !== void 0 ? normalizedProxy : void 0;
		const { account, created } = await upsertImportedAccount(store, {
			accessToken: result.access,
			refreshToken: result.refresh.split("|")[0],
			tokenType: "Bearer",
			expiresAt: new Date(result.expires).toISOString(),
			authMethod: "oauth",
			email: result.email ?? null,
			projectId: result.projectId || null,
			clientId: result.clientId || null
		}, {
			overwriteExisting: true,
			...proxyForUpsert !== void 0 ? { proxy: proxyForUpsert } : {}
		});
		const masked = maskProxyUrl(account.proxy);
		console.log(`${created ? "Added" : "Updated"} account: ${account.email ?? "(no email)"} (project: ${result.projectId || "default"})${masked ? ` proxy: ${masked}` : ""}`);
	}
	await callback?.close();
}
async function statusCommand() {
	const store = createReadOnlyStoreOrExit();
	const storage = await store.load();
	if (storage.accounts.length === 0) {
		console.log("No agy accounts. Run `dsh-agy login` first.");
		return;
	}
	console.log(`\n${storage.accounts.length} account(s), active index ${storage.activeIndex}:\n`);
	const sessions = new AgySessionManager({ store });
	for (const [index, account] of storage.accounts.entries()) {
		const marker = index === storage.activeIndex ? "★" : " ";
		const state = account.enabled === false ? "disabled" : account.verificationRequired ? "verification-required" : account.coolingDownUntil && account.coolingDownUntil > Date.now() ? "cooling" : "active";
		const maskedProxy = maskProxyUrl(account.proxy);
		console.log(` ${marker} [${index}] ${account.email ?? "(no email)"} — ${state}${account.projectId ? ` (project: ${account.projectId})` : ""}${maskedProxy ? ` proxy: ${maskedProxy}` : ""}`);
		const session = await sessions.getSession().catch(() => void 0);
		if (session && session.index === index) try {
			const { fetchAvailableModels } = await import("../models-BTMqI4Md.mjs").then((n) => n.r);
			const discovered = await fetchAvailableModels(session.auth.access, session.account.projectId);
			const entries = Object.entries(discovered.models ?? {});
			if (entries.length > 0) {
				const withQuota = entries.map(([id, entry]) => ({
					id,
					...entry.quotaInfo
				})).filter((e) => typeof e.remainingFraction === "number").sort((a, b) => (a.remainingFraction ?? 0) - (b.remainingFraction ?? 0));
				if (withQuota.length > 0) {
					const lowest = withQuota[0];
					console.log(`       models: ${entries.length}, lowest quota: ${Math.round((lowest.remainingFraction ?? 0) * 100)}% (${lowest.id})${lowest.resetTime ? `, resets ${new Date(lowest.resetTime).toISOString()}` : ""}`);
				} else console.log(`       models: ${entries.length} (no per-model quota reported)`);
			}
		} catch (error) {
			console.log(`       quota: unavailable (${error instanceof Error ? error.message : String(error)})`);
		}
	}
}
async function importCommand(options) {
	const store = createStore();
	const proxyForUpsert = resolveProxyOption(options.proxy);
	let items;
	if (options.files && options.files.length > 0) items = options.files.map((file) => {
		const raw = readFileSync(file, "utf8");
		return {
			source: options.blob ? raw : JSON.parse(raw),
			kind: options.blob ? "blob" : "json"
		};
	});
	else items = [{
		source: await ask("Paste the agy token JSON (or blob with --blob): "),
		kind: options.blob ? "blob" : "json"
	}];
	const importOpts = {
		email: options.email,
		overwriteExisting: options.overwrite
	};
	if (proxyForUpsert !== void 0) importOpts.proxy = proxyForUpsert;
	const result = await importManySources(items, store, importOpts);
	console.log(`Imported ${result.imported}, replaced ${result.replaced}${result.errors.length > 0 ? `, ${result.errors.length} failed` : ""}`);
	for (const error of result.errors) console.log(`  ! ${error}`);
}
async function exportCommand(options) {
	const store = createReadOnlyStoreOrExit();
	const sessions = new AgySessionManager({ store });
	const storage = await store.load();
	const indices = options.index !== void 0 ? [Number(options.index)] : storage.accounts.map((_, i) => i);
	let exported = 0;
	for (const index of indices) {
		const account = storage.accounts[index];
		if (!account) {
			console.log(`[${index}] not found`);
			continue;
		}
		const result = await sessions.exportBlob(index);
		if (!result.blob) {
			console.log(`[${index}] ${account.email ?? ""} — FAILED: ${result.error}`);
			continue;
		}
		if (options.out) {
			const file = join(options.out, `dsh-agy-${index}.blob`);
			writeFileSync(file, result.blob + "\n");
			console.log(`[${index}] ${account.email ?? ""} — wrote ${file}`);
		} else console.log(result.blob);
		exported++;
	}
	if (!options.out) console.log(`\n${exported} blob(s) exported — one line each, paste into a remote import`);
}
async function verifyCommand(options) {
	const store = createReadOnlyStoreOrExit();
	const sessions = new AgySessionManager({ store });
	const storage = await store.load();
	const indices = options.index !== void 0 ? [Number(options.index)] : storage.accounts.map((_, i) => i);
	for (const index of indices) {
		const account = storage.accounts[index];
		if (!account) {
			console.log(`[${index}] not found`);
			continue;
		}
		const result = await sessions.verifyAccount(index);
		if (result.ok) console.log(`[${index}] ${account.email ?? ""} — OK${result.email && result.email !== account.email ? ` (userinfo: ${result.email})` : ""}`);
		else console.log(`[${index}] ${account.email ?? ""} — FAILED: ${result.error}`);
	}
}
async function healthCommand(options) {
	const store = createReadOnlyStoreOrExit();
	const sessions = new AgySessionManager({
		store,
		onHealthReport: (results) => {
			for (const result of results) if (result.ok) console.log(`[${result.index}] ${result.email ?? ""} — OK`);
			else console.log(`[${result.index}] ${result.email ?? ""} — FAILED: ${result.error}`);
		}
	});
	const indices = options.index?.map((value) => Number(value));
	if (options.interval) {
		const intervalMs = Number(options.interval);
		if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
			console.error("Error: --interval must be a positive number of milliseconds.");
			process.exit(1);
		}
		console.log(`Health probe every ${intervalMs}ms (Ctrl+C to stop).`);
		sessions.startHealthProbe(intervalMs, { unref: false });
		await new Promise(() => {});
		return;
	}
	if ((await sessions.checkAccounts(indices)).length === 0) console.log("No enabled accounts — run `dsh-agy login` first.");
}
async function logoutCommand(options) {
	await createReadOnlyStoreOrExit().mutate((storage) => {
		const index = options.index !== void 0 ? Number(options.index) : options.email ? storage.accounts.findIndex((a) => a.email?.toLowerCase() === options.email.toLowerCase()) : storage.activeIndex;
		if (index < 0 || index >= storage.accounts.length) throw new Error(`account not found (index ${index})`);
		const [removed] = storage.accounts.splice(index, 1);
		if (storage.activeIndex >= storage.accounts.length) storage.activeIndex = 0;
		console.log(`Removed account: ${removed?.email ?? `[${index}]`}`);
	});
}
async function proxySetCommand(options) {
	const idx = Number(options.index);
	if (!Number.isInteger(idx) || idx < 0) {
		console.error("Invalid --index (must be >= 0)");
		process.exit(1);
	}
	const raw = options.proxy ?? "";
	if (!raw.trim()) {
		console.error("Missing --proxy value");
		process.exit(1);
	}
	let normalized;
	try {
		normalized = normalizeProxyUrl(raw);
	} catch (error) {
		console.error(`Invalid proxy URL: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
	await createStore().mutate((storage) => {
		const account = storage.accounts[idx];
		if (!account) throw new Error(`account not found (index ${idx})`);
		account.proxy = normalized;
	});
	console.log(`[${idx}] proxy set to ${maskProxyUrl(normalized)}`);
}
async function proxyClearCommand(options) {
	const idx = Number(options.index);
	if (!Number.isInteger(idx) || idx < 0) {
		console.error("Invalid --index (must be >= 0)");
		process.exit(1);
	}
	await createStore().mutate((storage) => {
		const account = storage.accounts[idx];
		if (!account) throw new Error(`account not found (index ${idx})`);
		delete account.proxy;
	});
	console.log(`[${idx}] proxy cleared`);
}
async function proxyTestCommand(options) {
	const idx = Number(options.index);
	if (!Number.isInteger(idx) || idx < 0) {
		console.error("Invalid --index (must be >= 0)");
		process.exit(1);
	}
	const account = (await createReadOnlyStoreOrExit().load()).accounts[idx];
	if (!account) {
		console.error(`account not found (index ${idx})`);
		process.exit(1);
	}
	if (!account.proxy) {
		console.log(`[${idx}] no proxy configured`);
		return;
	}
	const masked = maskProxyUrl(account.proxy);
	if (await isProxyReachable(account.proxy)) console.log(`[${idx}] ${masked} — ok`);
	else console.log(`[${idx}] ${masked} — proxy_unreachable`);
}
async function proxyListCommand() {
	const storage = await createReadOnlyStoreOrExit().load();
	if (storage.accounts.length === 0) {
		console.log("No agy accounts.");
		return;
	}
	for (const [index, account] of storage.accounts.entries()) {
		const masked = maskProxyUrl(account.proxy);
		console.log(` [${index}] ${account.email ?? "(no email)"} — ${masked ?? "(no proxy)"}`);
	}
}
function createProgram() {
	const program = new Command();
	program.name("dsh-agy").description("Google Antigravity (agy) account management for DeepSeek Harness").version(PACKAGE_VERSION);
	program.hook("preAction", () => {
		if (isAgyDisabled()) {
			console.error("dsh-agy is disabled (DSH_AGY_DISABLE=1).");
			process.exit(1);
		}
	});
	program.command("login").description("OAuth login (browser, or headless paste)").option("--headless", "print the URL and wait for a pasted redirect URL", false).option("--blob", "print a paste-credential blob instead of storing the account", false).option("--port <n>", "loopback callback port", "51121").option("--project <id>", "bind the login to a specific project").option("--timeout <ms>", "callback timeout", "300000").option("--proxy <url>", "per-account proxy URL (http/https/socks5); empty to clear").action(async (options) => {
		await loginCommand({
			...options,
			timeout: options.timeout
		});
	});
	program.command("status").description("List accounts and their health").action(async () => {
		await statusCommand();
	});
	program.command("import").description("Import agy token files or paste credentials").argument("[files...]", "paths to agy auth.json token files (multiple allowed)").option("--blob", "the pasted value is a credential blob", false).option("--email <email>", "account email (skips userinfo verification)").option("--overwrite", "replace an existing account with the same email", false).option("--proxy <url>", "per-account proxy URL (http/https/socks5); empty to clear").action(async (files, options) => {
		await importCommand({
			...options,
			files
		});
	});
	program.command("export").description("Export account credentials as paste blobs").option("--index <n>", "export one account by index; default all").option("--out <dir>", "write one dsh-agy-<index>.blob file per account into this directory (default: print to stdout)").action(async (options) => {
		await exportCommand(options);
	});
	program.command("verify").description("Verify account credentials (refresh + userinfo)").option("--index <n>", "verify one account by index; default all").action(async (options) => {
		await verifyCommand(options);
	});
	program.command("health").description("Check every enabled account (refresh + userinfo), optionally on an interval").option("--interval <ms>", "repeat on an interval instead of once").option("--index <n...>", "check only these accounts").action(async (options) => {
		await healthCommand(options);
	});
	program.command("logout").description("Remove an account").option("--index <n>", "account index (default: active)").option("--email <email>", "account email").action(async (options) => {
		await logoutCommand(options);
	});
	const proxy = program.command("proxy").description("Manage per-account proxies");
	proxy.command("set").description("Set proxy for an account").requiredOption("--index <n>", "account index").requiredOption("--proxy <url>", "proxy URL (http/https/socks5)").action(async (options) => {
		await proxySetCommand(options);
	});
	proxy.command("clear").description("Clear proxy for an account").requiredOption("--index <n>", "account index").action(async (options) => {
		await proxyClearCommand(options);
	});
	proxy.command("test").description("Test proxy reachability for an account (TCP 2s fast-fail)").requiredOption("--index <n>", "account index").action(async (options) => {
		await proxyTestCommand(options);
	});
	proxy.command("list").description("List accounts with masked proxies").action(async () => {
		await proxyListCommand();
	});
	return program;
}
//#endregion
export { AGY_DEFAULT_REDIRECT_URI, createProgram };

//# sourceMappingURL=index.mjs.map