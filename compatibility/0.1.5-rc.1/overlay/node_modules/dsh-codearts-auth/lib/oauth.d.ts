import type { CodeArtsCredential } from './types.js';
/** CodeArts Agent 的 OAuth client_id（即其 URI scheme，来自 product.json）。 */
export declare const CLIENT_ID = "codearts-agent";
/** 本地回调路径（对齐真实插件的 AUTH_REDIRECT_URL）。 */
export declare const REDIRECT_PATH = "/oauth/callback";
/** 华为 STS token 端点（对齐真实插件的 IAM_TOKEN_API）。 */
export declare const STS_TOKEN_ENDPOINT = "https://sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens";
/** token 请求超时（与真实插件一致）。 */
export declare const TOKEN_TIMEOUT_MS = 60000;
/** OAuth 授权码换取。 */
export declare const GRANT_AUTHORIZATION_CODE = "authorization_code";
/** OAuth 刷新令牌换取。 */
export declare const GRANT_REFRESH_TOKEN = "refresh_token";
/** PKCE 配对：验证器 + S256 挑战。 */
export interface PkcePair {
    codeVerifier: string;
    codeChallenge: string;
}
/** DPoP ES256 公钥 JWK（不含私钥材料）。 */
export interface DpopPublicJwk {
    kty: 'EC';
    crv: 'P-256';
    x: string;
    y: string;
}
/** DPoP ES256 私钥 JWK（仅持久化 privateKeyJwk）。 */
export interface DpopPrivateJwk extends DpopPublicJwk {
    d: string;
}
/** DPoP 密钥对（JWK 形式）。 */
export interface DpopKeyPair {
    privateKeyJwk: DpopPrivateJwk;
    publicKeyJwk: DpopPublicJwk;
}
/** /v1/oauth2/tokens 的响应体（换取所需字段）。 */
export interface TokenResponse {
    credentials?: {
        access_key_id?: string;
        secret_access_key?: string;
        security_token?: string;
        expiration?: string;
    };
    refresh_token?: string;
    error?: string;
    error_code?: string;
    error_msg?: string;
}
/** 生成 PKCE 配对：verifier 随机 48 字节 base64url，challenge 为 S256。 */
export declare function generatePkcePair(): PkcePair;
/** 生成 ES256（P-256）DPoP 密钥对，JWK 形式。 */
export declare function generateDpopKeyPair(): Promise<DpopKeyPair>;
/** 用持久化的 DPoP 私钥签发 dpop+jwt JWS（htm=HTTP 方法，htu=完整 URL）。 */
export declare function signDpopJws(keyPair: DpopKeyPair, htm: string, htu: string): Promise<string>;
/** refresh_token 已失效/被拒绝时抛出的错误；调度器据此停止续期。 */
export declare class RefreshTokenExpiredError extends Error {
    constructor(message: string);
}
/** 向 STS token 端点发起一次带 DPoP 的 token 请求。 */
export declare function requestToken(body: Record<string, string>, keyPair: DpopKeyPair, fetcher?: typeof fetch): Promise<TokenResponse>;
/** 授权码换取（登录回调收到 code 后调用）。 */
export declare function exchangeAuthorizationCode(code: string, codeVerifier: string, port: number, keyPair: DpopKeyPair, fetcher?: typeof fetch): Promise<TokenResponse>;
/** 刷新令牌换取（静默续期）。 */
export declare function exchangeRefreshToken(refreshToken: string, codeVerifier: string, keyPair: DpopKeyPair, fetcher?: typeof fetch): Promise<TokenResponse>;
/** 将 token 响应组装为持久化凭据 JSON（含刷新所需字段）。 */
export declare function credentialFromTokenResponse(token: TokenResponse, pkce: PkcePair, keyPair: DpopKeyPair): CodeArtsCredential;
/** 从持久化的私钥 JWK 恢复 DPoP 密钥对（公钥可从私钥 JWK 的 x/y 字段重建）。 */
export declare function keyPairFromStoredJwk(jwk: DpopPrivateJwk): DpopKeyPair;
//# sourceMappingURL=oauth.d.ts.map