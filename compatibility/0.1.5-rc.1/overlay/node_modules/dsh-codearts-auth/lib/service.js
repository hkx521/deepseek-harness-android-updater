import { Service } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { runLoginFlow, runOAuthFlow } from './login.js';
import { RefreshTokenExpiredError, credentialFromTokenResponse, exchangeRefreshToken, keyPairFromStoredJwk, } from './oauth.js';
import { RefreshScheduler } from './refresh.js';
import { fetchCodeArtsRemoteModels, MODEL_REFRESH_INTERVAL_MS, saveModelsCache, setMemoryCache, } from './models.js';
/** CodeArts 登录结果存储所用的凭据引用。 */
export const CODEARTS_CREDENTIAL_REF = 'CODEARTS_ACCESS_TOKEN';
/** 从存储值解析凭据 JSON；解析失败返回 undefined。 */
function parseCredential(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return undefined;
    }
}
/** CodeArts 登录服务：默认新式 IAM OAuth，ticket 流程回退，refresh_token 静默续期。 */
export class CodeArtsAuth extends Service {
    scheduler = new RefreshScheduler(() => this.refresh(), (error) => {
        if (error instanceof RefreshTokenExpiredError) {
            // 失效：停止重试，并向 status() 暴露 refreshable: false 与重新登录提示。
            this.markRefreshTokenInvalid();
            return;
        }
        this.lastRefreshError = error instanceof Error ? error.message : String(error);
    });
    /** refresh_token 已被后端判定失效（InvalidGrant）；登录/刷新成功时重置。 */
    refreshTokenInvalid = false;
    lastRefreshError;
    /** 登录会话是否仍处于活跃状态；logout()/stop() 置 false，防止在途刷新回写已登出凭据。 */
    active = true;
    /** 远端模型列表定时刷新定时器。 */
    modelRefreshTimer;
    /** 用于测试的可注入 fetch；默认为全局 fetch。 */
    fetchImpl = fetch;
    /** 标记 refresh_token 已失效：停止重试，并向 status() 暴露 refreshable: false 与重新登录提示。 */
    markRefreshTokenInvalid() {
        this.refreshTokenInvalid = true;
        this.lastRefreshError = 'refresh_token 已失效，请重新登录';
    }
    constructor(ctx, options = {}) {
        super(ctx, 'codeartsAuth');
        if (options.fetcher)
            this.fetchImpl = options.fetcher;
    }
    /** 运行登录流程（默认新式 OAuth；flow: 'ticket' 走旧流程回退）并持久化凭据。 */
    async login(options = {}) {
        this.active = true;
        const ref = options.refName ? credentialRef(options.refName) : credentialRef(CODEARTS_CREDENTIAL_REF);
        const flow = options.flow === 'ticket'
            ? await runLoginFlow(options)
            : await runOAuthFlow(options);
        await this.ctx.credentials.set(ref, flow.access);
        this.refreshTokenInvalid = false;
        this.lastRefreshError = undefined;
        this.scheduleRefresh();
        void this.refreshModels();
        const credential = parseCredential(flow.access);
        // 多账号：accountId 提供时自动注册到 pool
        if (options.accountId && options.pool) {
            const expiresAt = credential?.expires_at ? Date.parse(credential.expires_at) : undefined;
            await options.pool.addAccount({
                id: options.accountId,
                provider: 'codearts',
                nickname: options.accountId,
                enabled: true,
                credentialRef: options.refName ?? CODEARTS_CREDENTIAL_REF,
                createdAt: Date.now(),
                expiresAt: Number.isNaN(expiresAt) ? undefined : expiresAt,
                refreshable: Boolean(credential?.refresh_token),
            });
        }
        return {
            access: flow.access,
            expires: flow.expires,
            ref,
            loginUrl: flow.loginUrl,
            refreshable: Boolean(credential?.refresh_token),
        };
    }
    /** 报告凭据是否已配置、过期时间、是否可刷新以及最近刷新错误。 */
    async status() {
        const ref = credentialRef(CODEARTS_CREDENTIAL_REF);
        const info = await this.ctx.credentials.describe(ref);
        if (!info.configured)
            return { configured: false, refreshable: false };
        let expiresAt;
        let refreshable = false;
        const resolved = await this.ctx.credentials.resolve(ref);
        if (resolved) {
            const credential = parseCredential(resolved.value);
            if (credential) {
                if (credential.expires_at) {
                    const parsedDate = Date.parse(credential.expires_at);
                    if (!Number.isNaN(parsedDate))
                        expiresAt = parsedDate;
                }
                refreshable = Boolean(credential.refresh_token) && !this.refreshTokenInvalid;
            }
        }
        return {
            configured: true,
            source: info.source,
            expiresAt,
            refreshable,
            ...this.lastRefreshError === undefined ? {} : { refreshError: this.lastRefreshError },
        };
    }
    /** 静默续期：refresh_token 换取；无 refresh_token 时明确报错（由命令提示重新登录）。 */
    async refresh() {
        const ref = credentialRef(CODEARTS_CREDENTIAL_REF);
        const resolved = await this.ctx.credentials.resolve(ref);
        if (!resolved)
            throw new Error('未配置凭据，请先登录');
        const credential = parseCredential(resolved.value);
        if (!credential?.refresh_token || !credential.code_verifier || !credential.dpop_private_key_jwk) {
            throw new Error('无 refresh_token，请重新登录');
        }
        const keyPair = keyPairFromStoredJwk(credential.dpop_private_key_jwk);
        try {
            const token = await exchangeRefreshToken(credential.refresh_token, credential.code_verifier, keyPair, this.fetchImpl);
            // 登出竞态保护：在途刷新期间已 logout()/stop() 时，跳过凭据回写与调度武装，
            // 避免已登出的凭据被在途刷新复活。
            if (!this.active)
                return;
            const refreshed = credentialFromTokenResponse(token, { codeVerifier: credential.code_verifier, codeChallenge: '' }, keyPair);
            // 保留无变化字段（domain_id/user_id/user_name 等）。
            refreshed.domain_id = credential.domain_id;
            refreshed.user_id = credential.user_id;
            refreshed.user_name = credential.user_name;
            await this.ctx.credentials.set(ref, JSON.stringify(refreshed));
            this.refreshTokenInvalid = false;
            this.lastRefreshError = undefined;
            this.scheduleRefresh();
        }
        catch (error) {
            // 手动 refresh()（或 llm-adapter 触发）遇 refresh_token 失效同样更新状态，
            // 供 /codearts-status 展示 refreshable: false 与重新登录提示。
            if (error instanceof RefreshTokenExpiredError)
                this.markRefreshTokenInvalid();
            throw error;
        }
    }
    /**
     * 批量续期所有 codearts 账号。
     * 遍历 pool 中 enabled + refreshable 的 codearts 账号，逐一续期。
     * 单账号失败不影响其他账号。
     */
    async refreshAll(pool) {
        const accounts = await pool.listAccounts('codearts');
        for (const entry of accounts) {
            if (!entry.enabled || !entry.refreshable)
                continue;
            try {
                const ref = credentialRef(entry.credentialRef);
                const resolved = await this.ctx.credentials.resolve(ref);
                if (!resolved) {
                    // 凭据缺失：标记不可续期
                    await pool.updateAccount(entry.id, { refreshable: false });
                    continue;
                }
                const credential = parseCredential(resolved.value);
                if (!credential?.refresh_token || !credential.code_verifier || !credential.dpop_private_key_jwk) {
                    await pool.updateAccount(entry.id, { refreshable: false });
                    continue;
                }
                const keyPair = keyPairFromStoredJwk(credential.dpop_private_key_jwk);
                const token = await exchangeRefreshToken(credential.refresh_token, credential.code_verifier, keyPair, this.fetchImpl);
                const refreshed = credentialFromTokenResponse(token, { codeVerifier: credential.code_verifier, codeChallenge: '' }, keyPair);
                // 保留无变化字段
                refreshed.domain_id = credential.domain_id;
                refreshed.user_id = credential.user_id;
                refreshed.user_name = credential.user_name;
                // 保留模型重置时间
                if (credential.model_rate_limits) {
                    refreshed.model_rate_limits = credential.model_rate_limits;
                }
                await this.ctx.credentials.set(ref, JSON.stringify(refreshed));
                // 更新 account entry 的过期时间与 refreshable
                const expiresAt = refreshed.expires_at ? Date.parse(refreshed.expires_at) : undefined;
                await pool.updateAccount(entry.id, {
                    expiresAt: expiresAt !== undefined && !Number.isNaN(expiresAt) ? expiresAt : undefined,
                    refreshable: Boolean(refreshed.refresh_token),
                });
            }
            catch (error) {
                if (error instanceof RefreshTokenExpiredError) {
                    try {
                        await pool.updateAccount(entry.id, { refreshable: false });
                    }
                    catch {
                        // 忽略 updateAccount 本身的错误
                    }
                }
                // 单账号失败不中断循环
            }
        }
    }
    /** 移除已存储的凭据并停止任何待处理的刷新。 */
    async logout() {
        // 先置 inactive，再清凭据：在途刷新完成后不得回写/重新武装调度。
        this.active = false;
        this.scheduler.stop();
        this.stopModelRefresh();
        await this.ctx.credentials.unset(credentialRef(CODEARTS_CREDENTIAL_REF));
    }
    /** 停止刷新调度与模型刷新定时器（不清理凭据）。 */
    stop() {
        this.active = false;
        this.scheduler.stop();
        this.stopModelRefresh();
    }
    /** 启动时若已有可刷新凭据则安排续期（由 apply 调用）。 */
    scheduleRefresh() {
        void this.ctx.credentials.resolve(credentialRef(CODEARTS_CREDENTIAL_REF)).then((resolved) => {
            if (!resolved)
                return;
            const credential = parseCredential(resolved.value);
            if (!credential?.expires_at || !credential.refresh_token)
                return;
            const expiresAt = Date.parse(credential.expires_at);
            if (!Number.isNaN(expiresAt))
                this.scheduler.arm(expiresAt);
        });
    }
    /** 启动时若已有可刷新凭据则安排模型刷新（由 apply 调用）。 */
    scheduleModelRefresh() {
        this.stopModelRefresh();
        void this.ctx.credentials.resolve(credentialRef(CODEARTS_CREDENTIAL_REF)).then((resolved) => {
            if (!resolved)
                return;
            const credential = parseCredential(resolved.value);
            if (!credential?.access_key_id || !credential?.secret_access_key)
                return;
            void this.refreshModels();
            this.modelRefreshTimer = setInterval(() => void this.refreshModels(), MODEL_REFRESH_INTERVAL_MS);
            if (this.modelRefreshTimer?.unref)
                this.modelRefreshTimer.unref();
        });
    }
    /** 停止模型刷新定时器。 */
    stopModelRefresh() {
        if (this.modelRefreshTimer !== undefined) {
            clearInterval(this.modelRefreshTimer);
            this.modelRefreshTimer = undefined;
        }
    }
    /** 用当前凭据从远端拉取模型列表，非空时更新内存缓存与磁盘。返回模型列表（可能为空）。 */
    async refreshModels() {
        if (!this.active)
            return [];
        const resolved = await this.ctx.credentials.resolve(credentialRef(CODEARTS_CREDENTIAL_REF));
        if (!resolved)
            return [];
        const credential = parseCredential(resolved.value);
        if (!credential?.access_key_id || !credential?.secret_access_key)
            return [];
        const models = await fetchCodeArtsRemoteModels(credential, this.fetchImpl);
        if (models.length > 0) {
            setMemoryCache(models);
            saveModelsCache(models);
        }
        return models;
    }
}
//# sourceMappingURL=service.js.map