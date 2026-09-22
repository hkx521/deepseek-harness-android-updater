import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
import { C as OAUTH_TOKEN_URL, D as getAgyBootstrapUserAgent, E as getAgyBootstrapClientMetadata, O as resolveAgyClientCredentials, b as AGY_ENDPOINT_FALLBACKS, m as calculateTokenExpiry, w as OAUTH_USERINFO_URL } from "./accounts-CjOuS29o.mjs";
import { i as proxiedFetch } from "./proxy-DQPIwUov.mjs";
import { createHash, randomBytes } from "node:crypto";
//#region src/oauth/pkce.ts
/** Minimal PKCE (RFC 7636) with S256, hand-rolled on node:crypto (no extra dependency). */
function base64url(input) {
	return input.toString("base64url");
}
/** Generate a PKCE verifier (43-char URL-safe random) and its S256 challenge. */
function generatePkcePair() {
	const verifier = base64url(randomBytes(32));
	return {
		verifier,
		challenge: base64url(createHash("sha256").update(verifier).digest())
	};
}
/** Encode an object into a URL-safe base64 string (used for the OAuth state). */
function encodeState(payload) {
	return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
/** Decode a URL-safe base64 OAuth state back into its structured representation. */
function decodeState(state) {
	const normalized = state.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, "=");
	const json = Buffer.from(padded, "base64").toString("utf8");
	return JSON.parse(json);
}
//#endregion
//#region src/oauth/exchange.ts
var exchange_exports = /* @__PURE__ */ __exportAll({
	bootstrapAccount: () => bootstrapAccount,
	exchangeAntigravity: () => exchangeAntigravity,
	extractOnboardTierId: () => extractOnboardTierId,
	loadCodeAssist: () => loadCodeAssist,
	onboardAndDiscoverProject: () => onboardAndDiscoverProject
});
const FETCH_TIMEOUT_MS = 1e4;
async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await proxiedFetch(url, {
			...options,
			signal: controller.signal
		});
	} finally {
		clearTimeout(timeout);
	}
}
/** Build the metadata payload shared by loadCodeAssist and onboardUser.
* Only `ideType` is sent: `platform`/`pluginType` values are rejected by the
* backend's enum validation (verified live: INVALID_ARGUMENT on "MACOS"), and
* the official clients send ideType alone (OmniRoute capture). */
function bootstrapMetadata() {
	return { ideType: "ANTIGRAVITY" };
}
function extractProjectId(data) {
	const project = data.cloudaicompanionProject;
	if (typeof project === "string" && project) return project;
	const record = project;
	return record && typeof record.id === "string" && record.id ? record.id : "";
}
/**
* Extract the subscription tier id used for onboardUser, mirroring OmniRoute's
* codeAssistSubscription: paid → current → default allowed → legacy-tier.
*/
function extractOnboardTierId(subscriptionInfo) {
	const subscription = subscriptionInfo ?? {};
	const tierOf = (value, field) => {
		const picked = value?.[field];
		return typeof picked === "string" && picked.trim() ? picked.trim() : null;
	};
	const paidId = tierOf(subscription.paidTier, "id");
	if (paidId) return paidId;
	if (!(Array.isArray(subscription.ineligibleTiers) && subscription.ineligibleTiers.length > 0)) {
		const currentId = tierOf(subscription.currentTier, "id");
		if (currentId) return currentId;
	}
	if (Array.isArray(subscription.allowedTiers)) for (const tierValue of subscription.allowedTiers) {
		const tier = tierValue;
		if (tier.isDefault) {
			const defaultId = tierOf(tier, "id");
			if (defaultId) return defaultId;
		}
	}
	const currentId = tierOf(subscription.currentTier, "id");
	if (currentId) return currentId;
	return "legacy-tier";
}
/** Resolve project id + tier id via loadCodeAssist across fallback endpoints. */
async function loadCodeAssist(accessToken) {
	const errors = [];
	const loadHeaders = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		"User-Agent": getAgyBootstrapUserAgent(),
		"Client-Metadata": getAgyBootstrapClientMetadata()
	};
	for (const baseEndpoint of AGY_ENDPOINT_FALLBACKS) try {
		const response = await fetchWithTimeout(`${baseEndpoint}/v1internal:loadCodeAssist`, {
			method: "POST",
			headers: loadHeaders,
			body: JSON.stringify({ metadata: bootstrapMetadata() })
		});
		if (!response.ok) {
			const message = await response.text().catch(() => "");
			errors.push(`loadCodeAssist ${response.status} at ${baseEndpoint}${message ? `: ${message}` : ""}`);
			continue;
		}
		const data = await response.json();
		const projectId = extractProjectId(data);
		if (projectId) return {
			projectId,
			tierId: extractOnboardTierId(data.subscriptionInfo)
		};
		errors.push(`loadCodeAssist missing project id at ${baseEndpoint}`);
	} catch (error) {
		errors.push(`loadCodeAssist error at ${baseEndpoint}: ${error instanceof Error ? error.message : String(error)}`);
	}
	return {
		projectId: "",
		tierId: "legacy-tier"
	};
}
/**
* Onboard a new account (no Cloud Code project yet): POST onboardUser with the
* tier id, then retry loadCodeAssist. Mirrors OmniRoute's postExchange flow
* (bounded inline onboarding, 10 attempts × 5s).
*/
async function onboardAndDiscoverProject(accessToken, tierId, options = {}) {
	const maxAttempts = options.maxAttempts ?? 3;
	const retryDelayMs = options.retryDelayMs ?? 3e3 + Math.floor(Math.random() * 4e3);
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		"User-Agent": getAgyBootstrapUserAgent(),
		"Client-Metadata": getAgyBootstrapClientMetadata()
	};
	const metadata = bootstrapMetadata();
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			for (const baseEndpoint of AGY_ENDPOINT_FALLBACKS) {
				const response = await fetchWithTimeout(`${baseEndpoint}/v1internal:onboardUser`, {
					method: "POST",
					headers,
					body: JSON.stringify({
						tier_id: tierId,
						metadata
					})
				});
				if (!response.ok) continue;
				if ((await response.json()).done === true) {
					const discovered = await loadCodeAssist(accessToken);
					if (discovered.projectId) return discovered;
				}
			}
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
	}
	return {
		projectId: "",
		tierId
	};
}
/** Full bootstrap for a fresh account: discover the project, onboarding if needed. */
async function bootstrapAccount(accessToken, options = {}) {
	const discovered = await loadCodeAssist(accessToken);
	if (discovered.projectId) return discovered;
	return onboardAndDiscoverProject(accessToken, discovered.tierId, options);
}
/**
* Exchange the authorization code (from the loopback callback) for access/refresh
* tokens, resolve the email, and discover the project id.
* @param code - the `code` query parameter from the redirect.
* @param state - the `state` query parameter (encodes verifier + projectId).
* @param redirectUri - must match the authorize() redirectUri.
*/
async function exchangeAntigravity(code, state, redirectUri, expectedVerifier) {
	try {
		const { verifier, projectId } = decodeState(state);
		if (!verifier) return {
			type: "failed",
			error: "Missing PKCE verifier in state"
		};
		if (expectedVerifier && verifier !== expectedVerifier) return {
			type: "failed",
			error: "State does not match the issued authorization"
		};
		const startTime = Date.now();
		const { clientId, clientSecret } = resolveAgyClientCredentials();
		const tokenResponse = await proxiedFetch(OAUTH_TOKEN_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
				Accept: "*/*",
				"User-Agent": getAgyBootstrapUserAgent()
			},
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				code,
				grant_type: "authorization_code",
				redirect_uri: redirectUri,
				code_verifier: verifier
			})
		});
		if (!tokenResponse.ok) return {
			type: "failed",
			error: await tokenResponse.text()
		};
		const tokenPayload = await tokenResponse.json();
		const userInfoResponse = await proxiedFetch(`${OAUTH_USERINFO_URL}?alt=json`, { headers: {
			Authorization: `Bearer ${tokenPayload.access_token}`,
			"User-Agent": getAgyBootstrapUserAgent()
		} });
		const userInfo = userInfoResponse.ok ? await userInfoResponse.json() : {};
		const refreshToken = tokenPayload.refresh_token;
		if (!refreshToken) return {
			type: "failed",
			error: "Missing refresh token in response"
		};
		const effectiveProjectId = projectId || (await bootstrapAccount(tokenPayload.access_token)).projectId;
		return {
			type: "success",
			refresh: `${refreshToken}|${effectiveProjectId || ""}`,
			access: tokenPayload.access_token,
			expires: calculateTokenExpiry(startTime, tokenPayload.expires_in),
			email: userInfo.email,
			projectId: effectiveProjectId || "",
			clientId
		};
	} catch (error) {
		return {
			type: "failed",
			error: error instanceof Error ? error.message : "Unknown error"
		};
	}
}
//#endregion
export { generatePkcePair as i, exchange_exports as n, encodeState as r, exchangeAntigravity as t };

//# sourceMappingURL=exchange-DNrUFqeJ.mjs.map