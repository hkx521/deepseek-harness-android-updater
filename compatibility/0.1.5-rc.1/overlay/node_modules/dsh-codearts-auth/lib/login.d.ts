import { createServer } from 'node:http';
import type { CodeArtsCredential, CodeArtsCredentialResponse, LoginFlowOptions, LoginFlowResult } from './types.js';
import type { DpopKeyPair, PkcePair } from './oauth.js';
export declare const CODEARTS_LOGIN_BASE = "https://devcloud.cn-north-4.huaweicloud.com/doer/redirect";
export declare const HUAWEI_AUTH_BASE = "https://auth.huaweicloud.com/authui/login.html";
export declare const CREDENTIAL_ENDPOINT = "https://snap-access.cn-north-4.myhuaweicloud.com/snap-manager/v1/login/ticket";
/** 与重定向流程共享的随机 64 字符小写十六进制密钥。 */
export declare function generateRandomSecret(): string;
/** 构建 doer/redirect URL 及包裹它的华为认证页面 URL。 */
export declare function buildLoginUrl(port: number, ticketId: string): {
    redirectUrl: string;
    loginUrl: string;
};
/** 将一次 ticket 响应归一化为凭据，未完成时返回 null。 */
export declare function parseCredentialResponse(data: CodeArtsCredentialResponse): CodeArtsCredential | null;
/** 凭据的过期时间戳（毫秒）；时间戳无法解析时回退为 +24 小时。 */
export declare function expiresFromCredential(credential: CodeArtsCredential): number;
/**
 * 轮询 ticket 端点，直到收到完整凭据或尝试
 * 次数耗尽。瞬时失败会被跳过，不会视为致命错误。
 */
export declare function pollForCredential(ticketId: string, secret: string, options?: {
    fetcher?: typeof fetch;
    maxAttempts?: number;
    pluginName?: string;
    pluginVersion?: string;
}): Promise<CodeArtsCredential>;
/** 使用平台默认打开器打开 URL；永不抛出异常。 */
export declare function openBrowser(url: string): void;
/** 浏览器重定向的本地回调服务器；当某个分支完成时 resolve `result`。 */
export declare function startCallbackServer(ticketId: string, secret: string, options: LoginFlowOptions): Promise<{
    port: number;
    server: ReturnType<typeof createServer>;
    result: Promise<LoginFlowResult>;
}>;
/** 运行完整的浏览器登录流程，返回已存储的凭据值。 */
export declare function runLoginFlow(options?: LoginFlowOptions): Promise<LoginFlowResult>;
/** 新式 IAM OAuth 的 portal 授权端点（对齐真实插件的 getPortalHost + /authorize）。 */
export declare const PORTAL_AUTHORIZE_BASE = "https://codearts.huaweicloud.com/portal/authorize";
/** portal 登录结果页（登录完成后重定向目标，对齐真实插件回调处理器的 login_succeed 页）。 */
export declare const PORTAL_LOGIN_BASE = "https://codearts.huaweicloud.com/portal/login";
/** 构建 portal 登录结果页 URL（真实插件在回调成功后 307 重定向到此页）。 */
export declare function buildPortalLoginResultUrl(succeeded: boolean): string;
/** portal 期望的插件名（逆向常量，硬编码）。 */
export declare const LOGIN_PLUGIN_NAME = "snap_AIIDE";
/** portal 期望的插件版本（逆向常量，硬编码为真实扩展版本，勿用本包版本）。 */
export declare const LOGIN_PLUGIN_VERSION = "5.2.0";
/** 主题色 kind（对齐 IDE 的 activeColorTheme.kind：2 = Dark）。 */
export declare const OAUTH_THEME = "2";
/** 界面语言（对齐 env.language）。 */
export declare const OAUTH_LOCALE = "zh-cn";
/** 构建新式 IAM OAuth 的 portal 授权 URL（参数完全对齐真实插件 buildLoginUrl）。 */
export declare function buildOAuthLoginUrl(port: number, pkce: PkcePair, ticketId: string): string;
/** 新式 OAuth 的本地回调服务器：收到 code（新流程）或 secret（旧流程回退）后换取凭据并 resolve。 */
export declare function startOAuthCallbackServer(ticketId: string, pkce: PkcePair, keyPair: DpopKeyPair, options: LoginFlowOptions): Promise<{
    port: number;
    server: ReturnType<typeof createServer>;
    result: Promise<LoginFlowResult>;
}>;
/** 运行完整的新式 IAM OAuth 登录流程（默认登录方式）。 */
export declare function runOAuthFlow(options?: LoginFlowOptions): Promise<LoginFlowResult>;
//# sourceMappingURL=login.d.ts.map