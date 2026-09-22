import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
import { EnvHttpProxyAgent, ProxyAgent } from "undici";
import { createConnection } from "node:net";
//#region src/proxy.ts
/**
* Proxy-aware fetch: per-account proxy (http/https/socks5) + env fallback.
* - account.proxy present => per-account dispatcher (fail-closed, not affected by NO_PROXY)
* - otherwise => EnvHttpProxyAgent (honours HTTP_PROXY/HTTPS_PROXY/NO_PROXY)
* Applied per-request via dispatcher option so the host's global dispatcher stays untouched.
*/
var proxy_exports = /* @__PURE__ */ __exportAll({
	_envAgentForTest: () => envAgent,
	dispatcherForAsync: () => dispatcherForAsync,
	isProxyReachable: () => isProxyReachable,
	isProxyUnreachableError: () => isProxyUnreachableError,
	normalizeProxyUrl: () => normalizeProxyUrl,
	proxiedFetch: () => proxiedFetch,
	proxyUrlForLogs: () => proxyUrlForLogs,
	tagProxyUnreachable: () => tagProxyUnreachable
});
const envAgent = new EnvHttpProxyAgent();
const dispatcherCache = /* @__PURE__ */ new Map();
const SUPPORTED = /* @__PURE__ */ new Set([
	"http:",
	"https:",
	"socks5:",
	"socks5h:"
]);
function defaultPort(protocol) {
	if (protocol === "https:") return "443";
	if (protocol === "socks5:" || protocol === "socks5h:") return "1080";
	return "8080";
}
function normalizeProxyUrl(proxyUrl) {
	let raw = proxyUrl.trim();
	if (!raw) throw new Error("[proxy] empty proxy URL");
	if (raw.toLowerCase().startsWith("socks://")) raw = "socks5://" + raw.slice(8);
	const familyMatch = raw.match(/\?family=(ipv4|ipv6)$/);
	const familySuffix = familyMatch ? familyMatch[0] : "";
	const baseRaw = familySuffix ? raw.slice(0, -familySuffix.length) : raw;
	let parsed;
	try {
		parsed = new URL(baseRaw);
	} catch {
		throw new Error(`[proxy] invalid proxy URL: ${proxyUrlForLogs(proxyUrl)}`);
	}
	let protocol = parsed.protocol.toLowerCase();
	if (protocol === "socks5h:") protocol = "socks5:";
	if (!SUPPORTED.has(protocol) && protocol !== "socks5:") {
		if (!SUPPORTED.has(parsed.protocol.toLowerCase())) throw new Error(`[proxy] unsupported protocol: ${parsed.protocol}`);
	}
	if (![
		"http:",
		"https:",
		"socks5:"
	].includes(protocol)) throw new Error(`[proxy] unsupported protocol: ${parsed.protocol}`);
	if (!parsed.hostname) throw new Error("[proxy] missing host");
	let port = parsed.port;
	if (!port) port = defaultPort(protocol);
	const portNum = Number(port);
	if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) throw new Error("[proxy] invalid port");
	const auth = parsed.username ? `${encodeURIComponent(parsed.username)}${parsed.password ? `:${encodeURIComponent(parsed.password)}` : ""}@` : "";
	const normalizedBase = `${protocol}//${auth}${parsed.hostname}:${port}`;
	return familySuffix ? `${normalizedBase}${familySuffix}` : normalizedBase;
}
function proxyUrlForLogs(proxyUrl) {
	try {
		const fam = proxyUrl.match(/\?family=(ipv4|ipv6)$/);
		const base = fam ? proxyUrl.slice(0, -fam[0].length) : proxyUrl;
		const u = new URL(base);
		const port = u.port || defaultPort(u.protocol);
		return `${u.protocol}//${u.hostname}:${port}`;
	} catch {
		return proxyUrl;
	}
}
const PROXY_UNREACHABLE_CODES = /* @__PURE__ */ new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"ENETUNREACH",
	"EHOSTUNREACH",
	"EPIPE",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_SOCKET"
]);
function isLoopbackUrl(url) {
	try {
		const h = (typeof url === "string" ? new URL(url) : url).hostname.toLowerCase();
		return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "::ffff:127.0.0.1";
	} catch {
		return false;
	}
}
function isProxyUnreachableError(err) {
	const seen = /* @__PURE__ */ new Set();
	let cur = err;
	for (let depth = 0; cur && depth < 5 && !seen.has(cur); depth++) {
		seen.add(cur);
		if (cur && typeof cur === "object") {
			const code = cur.code;
			if (typeof code === "string" && PROXY_UNREACHABLE_CODES.has(code)) return true;
			const errorCode = cur.errorCode;
			if (errorCode === "proxy_unreachable" || errorCode === "PROXY_UNREACHABLE") return true;
			if (cur.statusCode === 503) {
				const m = cur.message;
				if (typeof m === "string" && m.includes("Proxy unreachable")) return true;
			}
			const msg = cur.message;
			if (typeof msg === "string") {
				if (msg.includes("proxy_unreachable") || msg.includes("PROXY_UNREACHABLE")) return true;
				for (const c of PROXY_UNREACHABLE_CODES) if (msg.includes(c)) return true;
			}
		}
		cur = cur?.cause;
		if (!cur && err?.errors && depth === 0) {
			const errs = err.errors;
			if (Array.isArray(errs)) {
				for (const e of errs) if (isProxyUnreachableError(e)) return true;
			}
		}
	}
	return false;
}
function tagProxyUnreachable(err) {
	if (isProxyUnreachableError(err)) {
		const e = err;
		e.code = "PROXY_UNREACHABLE";
		e.errorCode = "proxy_unreachable";
	}
	return err;
}
const FAST_FAIL_TIMEOUT_MS = 2e3;
const HEALTHY_TTL_MS = 3e4;
const UNHEALTHY_TTL_MS = 2e3;
const healthCache = /* @__PURE__ */ new Map();
const healthInflight = /* @__PURE__ */ new Map();
function tcpCheck(host, port, timeoutMs) {
	return new Promise((resolve) => {
		const socket = createConnection({
			host,
			port
		}, () => {
			socket.destroy();
			resolve(true);
		});
		socket.setTimeout(timeoutMs);
		socket.on("error", () => resolve(false));
		socket.on("timeout", () => {
			socket.destroy();
			resolve(false);
		});
	});
}
async function isProxyReachable(proxyUrl, timeoutMs = FAST_FAIL_TIMEOUT_MS) {
	const key = normalizeProxyUrl(proxyUrl);
	const cached = healthCache.get(key);
	if (cached && Date.now() - cached.at < cached.ttl) return cached.healthy;
	const existing = healthInflight.get(key);
	if (existing) return existing;
	let url;
	try {
		const base = key.replace(/\?family=(ipv4|ipv6)$/, "");
		url = new URL(base);
	} catch {
		healthCache.set(key, {
			healthy: false,
			at: Date.now(),
			ttl: UNHEALTHY_TTL_MS
		});
		return false;
	}
	const probe = tcpCheck(url.hostname.replace(/^\[/, "").replace(/\]$/, ""), Number(url.port || defaultPort(url.protocol)), timeoutMs).then((healthy) => {
		healthCache.set(key, {
			healthy,
			at: Date.now(),
			ttl: healthy ? HEALTHY_TTL_MS : UNHEALTHY_TTL_MS
		});
		return healthy;
	});
	healthInflight.set(key, probe);
	try {
		return await probe;
	} finally {
		if (healthInflight.get(key) === probe) healthInflight.delete(key);
	}
}
async function createSocksDispatcher(proxyUrl, dispatcherOpts) {
	const { SocksProxyAgent } = await import("socks-proxy-agent");
	return new SocksProxyAgent(proxyUrl);
}
function createHttpDispatcher(proxyUrl, dispatcherOpts) {
	const clean = proxyUrl.replace(/\?family=(ipv4|ipv6)$/, "");
	return new ProxyAgent({
		uri: clean,
		proxyTunnel: true,
		...dispatcherOpts
	});
}
const DISPATCHER_OPTS = {
	headersTimeout: 3e4,
	bodyTimeout: 3e4,
	connectTimeout: 1e4,
	keepAliveTimeout: 1,
	keepAliveMaxTimeout: 1,
	pipelining: 0
};
async function dispatcherForAsync(proxyUrl) {
	if (!proxyUrl) return envAgent;
	const normalized = normalizeProxyUrl(proxyUrl);
	const cached = dispatcherCache.get(normalized);
	if (cached) return cached;
	const famClean = normalized.replace(/\?family=(ipv4|ipv6)$/, "");
	let dispatcher;
	if (famClean.startsWith("socks5:")) dispatcher = await createSocksDispatcher(normalized, DISPATCHER_OPTS);
	else dispatcher = createHttpDispatcher(normalized, DISPATCHER_OPTS);
	dispatcherCache.set(normalized, dispatcher);
	return dispatcher;
}
function getTargetUrlString(input) {
	if (typeof input === "string") return input;
	try {
		if (input instanceof URL) return input.toString();
		if (typeof input.url === "string") return input.url;
	} catch {}
	return "";
}
/** fetch() that respects per-account proxyUrl (when given) otherwise env. */
const proxiedFetch = async (input, init, opts) => {
	const proxyUrl = opts?.proxyUrl ?? init?.proxyUrl;
	const cleanInit = { ...init };
	if (cleanInit.proxyUrl) delete cleanInit.proxyUrl;
	if (!proxyUrl) return fetch(input, {
		...cleanInit,
		dispatcher: envAgent
	});
	const targetStr = getTargetUrlString(input);
	if (targetStr && isLoopbackUrl(targetStr)) return fetch(input, cleanInit);
	try {
		if (!await isProxyReachable(proxyUrl)) {
			const err = /* @__PURE__ */ new Error(`[Proxy Fast-Fail] Proxy unreachable: ${proxyUrlForLogs(proxyUrl)}`);
			err.code = "PROXY_UNREACHABLE";
			err.errorCode = "proxy_unreachable";
			err.statusCode = 503;
			throw err;
		}
	} catch (e) {
		if (e?.errorCode === "proxy_unreachable") throw e;
		if (e instanceof Error && e.message.startsWith("[proxy]")) throw e;
	}
	let dispatcher;
	try {
		dispatcher = await dispatcherForAsync(proxyUrl);
	} catch (e) {
		throw tagProxyUnreachable(e);
	}
	try {
		return await fetch(input, {
			...cleanInit,
			dispatcher
		});
	} catch (err) {
		throw tagProxyUnreachable(err);
	}
};
//#endregion
export { proxyUrlForLogs as a, proxiedFetch as i, isProxyUnreachableError as n, proxy_exports as o, normalizeProxyUrl as r, isProxyReachable as t };

//# sourceMappingURL=proxy-DQPIwUov.mjs.map