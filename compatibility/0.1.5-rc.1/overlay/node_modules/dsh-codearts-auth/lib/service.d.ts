import { Service, type Context } from '@deepseek-ai/cordis';
import { type CredentialRef } from '@deepseek-ai/dsh-credentials';
import type { LoginFlowOptions } from './types.js';
import { AccountPool } from './account-pool.js';
/** CodeArts 登录结果存储所用的凭据引用。 */
export declare const CODEARTS_CREDENTIAL_REF = "CODEARTS_ACCESS_TOKEN";
/** 一次成功登录的结果。 */
export interface LoginResult {
    /** 已存储的凭据值（原始令牌或 JSON 凭据字符串）。 */
    access: string;
    /** 凭据过期的毫秒时间戳。 */
    expires: number;
    /** 凭据值存储所用的凭据引用。 */
    ref: CredentialRef;
    /** 打开的登录 URL。 */
    loginUrl: string;
    /** 凭据是否携带 refresh_token（新式 OAuth 流程为 true）。 */
    refreshable: boolean;
}
/** 用于配置界面的只读登录状态。 */
export interface LoginStatus {
    configured: boolean;
    source?: string;
    expiresAt?: number;
    /** 存储的凭据是否可通过刷新令牌静默续期。 */
    refreshable: boolean;
    /** 最近一次刷新失败的原因（如有）。 */
    refreshError?: string;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        codeartsAuth: CodeArtsAuth;
    }
}
/** CodeArts 登录服务：默认新式 IAM OAuth，ticket 流程回退，refresh_token 静默续期。 */
export declare class CodeArtsAuth extends Service {
    private readonly scheduler;
    /** refresh_token 已被后端判定失效（InvalidGrant）；登录/刷新成功时重置。 */
    private refreshTokenInvalid;
    private lastRefreshError;
    /** 登录会话是否仍处于活跃状态；logout()/stop() 置 false，防止在途刷新回写已登出凭据。 */
    private active;
    /** 远端模型列表定时刷新定时器。 */
    private modelRefreshTimer;
    /** 用于测试的可注入 fetch；默认为全局 fetch。 */
    private fetchImpl;
    /** 标记 refresh_token 已失效：停止重试，并向 status() 暴露 refreshable: false 与重新登录提示。 */
    private markRefreshTokenInvalid;
    constructor(ctx: Context, options?: {
        fetcher?: typeof fetch;
    });
    /** 运行登录流程（默认新式 OAuth；flow: 'ticket' 走旧流程回退）并持久化凭据。 */
    login(options?: {
        flow?: 'oauth' | 'ticket';
        refName?: string;
        accountId?: string;
        pool?: AccountPool;
    } & LoginFlowOptions): Promise<LoginResult>;
    /** 报告凭据是否已配置、过期时间、是否可刷新以及最近刷新错误。 */
    status(): Promise<LoginStatus>;
    /** 静默续期：refresh_token 换取；无 refresh_token 时明确报错（由命令提示重新登录）。 */
    refresh(): Promise<void>;
    /**
     * 批量续期所有 codearts 账号。
     * 遍历 pool 中 enabled + refreshable 的 codearts 账号，逐一续期。
     * 单账号失败不影响其他账号。
     */
    refreshAll(pool: AccountPool): Promise<void>;
    /** 移除已存储的凭据并停止任何待处理的刷新。 */
    logout(): Promise<void>;
    /** 停止刷新调度与模型刷新定时器（不清理凭据）。 */
    stop(): void;
    /** 启动时若已有可刷新凭据则安排续期（由 apply 调用）。 */
    scheduleRefresh(): void;
    /** 启动时若已有可刷新凭据则安排模型刷新（由 apply 调用）。 */
    scheduleModelRefresh(): void;
    /** 停止模型刷新定时器。 */
    stopModelRefresh(): void;
    /** 用当前凭据从远端拉取模型列表，非空时更新内存缓存与磁盘。返回模型列表（可能为空）。 */
    refreshModels(): Promise<Array<{
        id: string;
        name: string;
    }>>;
}
//# sourceMappingURL=service.d.ts.map