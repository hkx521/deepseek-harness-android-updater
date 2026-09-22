/** 在凭据过期前提前这么长时间触发刷新（1 小时；对齐真实插件的 36e5）。 */
export declare const REFRESH_LEAD_MS = 3600000;
/** 普通刷新失败后的重试间隔（10 分钟；对齐 RENEW_TOKEN_INTERVAL_WHEN_LAST_TIME_FAILED）。 */
export declare const REFRESH_RETRY_MS = 600000;
/** 异常网络（fetch failed 等）后的重试间隔（1 分钟；对齐 …_BY_ABNORMAL_NETWORK）。 */
export declare const REFRESH_ABNORMAL_NETWORK_RETRY_MS = 60000;
/**
 * 计算首次刷新触发前的毫秒数（对齐真实插件 getFirstRefreshTime）：
 * - 无有效过期时间或距过期 ≤1h → 0（立即刷新）；
 * - 否则触发点 = now + 1h，再叠加 0-59 秒随机偏移。
 */
export declare function computeFirstRefreshDelayMs(expiresAtMs: number, nowMs?: number): number;
/** 静默刷新调度器：一次触发 + 失败重试（失效则停止）。 */
export declare class RefreshScheduler {
    private readonly refresh;
    private readonly onError;
    private timer;
    private pending;
    /** 调度代号：stop()/arm() 都会推进它，用于让在途 run() 放弃失败后的重试武装。 */
    private generation;
    constructor(refresh: () => Promise<void>, onError?: (error: unknown) => void);
    /** 为在 `expiresAtMs` 过期的凭据安排下次刷新；`nowMs` 仅供测试注入。 */
    arm(expiresAtMs: number, nowMs?: number): void;
    /** 取消任何待处理的刷新（并让在途 run() 失败后不再重试）。 */
    stop(): void;
    /** 立即执行一次刷新（供启动时已处于到期窗口内的凭据使用）。 */
    refreshOnce(): Promise<void>;
    private run;
}
//# sourceMappingURL=refresh.d.ts.map