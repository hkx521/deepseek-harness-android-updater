/**
 * @file plugins/dsh-model-router/lib/index.js
 * @description DeepSeek Harness Android 移动端高可用模型路由与降级插件。
 * 遵循层②（事件瀑布劫持）架构规范，支持首字超时（TTFT）哨兵监控与不可恢复错误透明降级。
 */

export const name = 'model-router';

/**
 * Cordis 插件安装入口
 * @param {import('cordis').Context} ctx
 * @param {object} [userConfig]
 */
export function apply(ctx, userConfig = {}) {
  // 全局开关：允许环境变量或配置直接禁用路由劫持（恢复纯原生调度）
  if (process.env.DSH_ROUTER_DISABLE === '1' || userConfig.enabled === false) {
    ctx.logger?.info?.('[Router] 模型路由插件已通过配置禁用');
    return { enabled: false };
  }

  const getTimeoutMs = () => {
    if (process.env.DSH_ROUTER_TIMEOUT_MS) {
      const parsed = Number(process.env.DSH_ROUTER_TIMEOUT_MS);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return typeof userConfig.timeoutMs === 'number' && userConfig.timeoutMs > 0
      ? userConfig.timeoutMs
      : 30000;
  };

  const getPrimaryConfig = () => ({
    provider: process.env.DSH_PRIMARY_PROVIDER || userConfig.primary?.provider || '',
    model: process.env.DSH_PRIMARY_MODEL || userConfig.primary?.model || '',
  });

  const getFallbackConfig = () => {
    let rawProvider = process.env.DSH_FALLBACK_PROVIDER || userConfig.fallback?.provider || '';
    let rawModel = process.env.DSH_FALLBACK_MODEL || userConfig.fallback?.model || '';
    if (rawProvider === 'commandcode-go-provider') {
      try {
        if (ctx.llm?.adapters?.has?.('commandcode')) {
          rawProvider = 'commandcode';
        }
      } catch (_) {}
    }
    return {
      provider: rawProvider,
      model: rawModel,
    };
  };

  /** 检查指定提供方在系统中是否已挂载适配器 */
  function isAdapterAvailable(providerName) {
    if (!providerName) return false;
    try {
      const adapters = ctx.llm?.adapters;
      if (adapters && typeof adapters.has === 'function') {
        return adapters.has(providerName);
      }
    } catch (_) {}
    return true;
  }

  const circuitBreakerConfig = {
    enabled: userConfig.circuitBreaker?.enabled !== false,
    failureThreshold: userConfig.circuitBreaker?.failureThreshold ?? 2,
    coolDownMs: userConfig.circuitBreaker?.coolDownMs ?? 60000,
  };

  // 按主模型独立维护的熔断状态（防止单个模型异常连带锁死其他模型）
  const providerFailures = new Map();

  function getFailureRecord(providerKey) {
    const key = providerKey || 'default';
    let rec = providerFailures.get(key);
    if (!rec) {
      rec = { count: 0, lastTime: 0 };
      providerFailures.set(key, rec);
    }
    return rec;
  }

  // 按 agent session/turn/step 隔离的重试状态
  const activeStepStates = new Map();

  function getStepKey(agentId, turn, step) {
    return `${agentId ?? 'default'}:${turn ?? 0}:${step ?? 0}`;
  }

  function isCircuitOpen(providerKey) {
    if (!circuitBreakerConfig.enabled) return false;
    const fallback = getFallbackConfig();
    if (!fallback.provider || !fallback.model || !isAdapterAvailable(fallback.provider)) {
      return false;
    }
    const now = Date.now();
    if (providerKey) {
      const rec = getFailureRecord(providerKey);
      if (rec.count < circuitBreakerConfig.failureThreshold) return false;
      if (now - rec.lastTime > circuitBreakerConfig.coolDownMs) {
        rec.count = 0;
        return false;
      }
      return true;
    }
    for (const rec of providerFailures.values()) {
      if (rec.count >= circuitBreakerConfig.failureThreshold) {
        if (now - rec.lastTime <= circuitBreakerConfig.coolDownMs) {
          return true;
        }
        rec.count = 0;
      }
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────
  // 1. agent/request Waterfall: 路由解析与下发
  // ─────────────────────────────────────────────────────────────
  ctx.on('agent/request', async (payload, next) => {
    const { agent, turn, step, signal } = payload || {};

    // 严禁误伤：用户显式取消直接短路
    if (signal?.aborted) {
      if (typeof signal.throwIfAborted === 'function') {
        signal.throwIfAborted();
      }
      const abortErr = new Error('This operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const defaultProposal = await next();

    // 再次防范执行 next 期间用户主动取消
    if (signal?.aborted) {
      return defaultProposal;
    }

    const key = getStepKey(agent?.id, turn, step);
    let state = activeStepStates.get(key);
    const fallback = getFallbackConfig();
    const fallbackAvailable = Boolean(fallback.provider && fallback.model && isAdapterAvailable(fallback.provider));

    if (!state) {
      const primaryProvider = defaultProposal?.provider || '';
      const circuitOpen = isCircuitOpen(primaryProvider);
      state = {
        currentRoute: (circuitOpen && fallbackAvailable) ? 'fallback' : 'primary',
        attemptCount: 1,
        original: {
          provider: defaultProposal?.provider,
          model: defaultProposal?.model,
        },
      };
      activeStepStates.set(key, state);

      if (circuitOpen && fallbackAvailable) {
        ctx.logger?.info?.(
          `[Router] 主模型 [${primaryProvider}] 处于熔断冷却中，自动路由至 Fallback: ${fallback.provider}/${fallback.model}`
        );
        return {
          ...defaultProposal,
          provider: fallback.provider,
          model: fallback.model,
        };
      }
    }

    if (state.currentRoute === 'fallback' && fallbackAvailable) {
      ctx.logger?.info?.(
        `[Router] 步骤处于降级状态，执行 Fallback 路由: ${fallback.provider}/${fallback.model}`
      );
      return {
        ...defaultProposal,
        provider: fallback.provider,
        model: fallback.model,
      };
    }

    return defaultProposal;
  });

  // ─────────────────────────────────────────────────────────────
  // 2. llm/stream Waterfall: 流式首包 TTFT 哨兵监控
  // ─────────────────────────────────────────────────────────────
  ctx.on('llm/stream', async function* (options, next) {
    // 若外部传入 signal 已经 aborted，直接透传退出
    if (options?.signal?.aborted) {
      const stream = next(options) || next();
      yield* stream;
      return;
    }

    let timeoutMs = getTimeoutMs();
    const isReasoning = Boolean(
      (options?.config?.reasoningEffort && options?.config?.reasoningEffort !== 'none') ||
      (options?.reasoningEffort && options?.reasoningEffort !== 'none') ||
      /r1|reasoner|thinking|tiered/i.test(String(options?.config?.model || options?.model || ''))
    );
    if (isReasoning && timeoutMs < 60000) {
      timeoutMs = 60000;
    }

    const timeoutAbort = new AbortController();

    let compositeSignal;
    if (options?.signal) {
      if (typeof AbortSignal.any === 'function') {
        compositeSignal = AbortSignal.any([options.signal, timeoutAbort.signal]);
      } else {
        const combined = new AbortController();
        const onAbort = () => {
          combined.abort(options.signal.reason || timeoutAbort.signal.reason);
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
        timeoutAbort.signal.addEventListener('abort', onAbort, { once: true });
        compositeSignal = combined.signal;
      }
    } else {
      compositeSignal = timeoutAbort.signal;
    }

    let timer = null;
    let receivedFirstChunk = false;

    // 启动流式首包 TTFT 计时器
    timer = setTimeout(() => {
      if (!receivedFirstChunk) {
        const timeoutErr = new Error(`Model TTFT timeout after ${timeoutMs}ms`);
        timeoutErr.name = 'TimeoutError';
        timeoutErr.code = 'TIMEOUT';
        timeoutAbort.abort(timeoutErr);
      }
    }, timeoutMs);

    // 移动端功耗与退出纪律：unref 定时器不挂起事件循环
    if (timer && typeof timer.unref === 'function') {
      timer.unref();
    }

    try {
      const wrappedOptions = { ...options, signal: compositeSignal };
      const stream = next(wrappedOptions) || next();

      for await (const chunk of stream) {
        if (timeoutAbort.signal.aborted) {
          throw timeoutAbort.signal.reason;
        }
        if (!receivedFirstChunk) {
          receivedFirstChunk = true;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        }
        yield chunk;
      }
    } catch (error) {
      // 严禁误伤：用户主动取消绝对不拦截降级，直接抛出
      if (options?.signal?.aborted) {
        throw error;
      }

      // 若为首字超时触发的中断，转换为终端 failure 分片
      if (timeoutAbort.signal.aborted) {
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: {
              code: 'TIMEOUT',
              message: `首字响应超时 (>${timeoutMs}ms)，触发模型路由保护`,
              retryable: true,
            },
          },
        };
        return;
      }

      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 3. agent/request-error Waterfall: 降级决策与重试驱动
  // ─────────────────────────────────────────────────────────────
  ctx.on('agent/request-error', async (payload, next) => {
    const { agent, turn, step, provider, failure, error, signal } = payload || {};

    // 严禁误伤：用户显式取消（signal.aborted === true）绝对不发起重试降级
    if (signal?.aborted) {
      return next();
    }

    const key = getStepKey(agent?.id, turn, step);
    const state = activeStepStates.get(key);
    const fallback = getFallbackConfig();
    const fallbackAvailable = Boolean(fallback.provider && fallback.model && isAdapterAvailable(fallback.provider));

    const errCode = String(failure?.code || error?.code || '').toUpperCase();
    const errMsg = String(failure?.message || error?.message || '');

    // 排除用户取消的错误语义
    if (errMsg.includes('AbortError') || errMsg.includes('aborted') || errMsg.includes('This operation was aborted')) {
      if (signal?.aborted) {
        return next();
      }
    }

    // 仅当当前步骤仍处于 primary 且配置了有效可用的 fallback 模型时，才执行降级
    if (state && state.currentRoute === 'primary' && fallbackAvailable) {
      const isTimeout =
        errCode === 'TIMEOUT' ||
        errMsg.includes('TIMEOUT') ||
        errMsg.includes('timeout') ||
        errMsg.includes('首字响应超时');

      const fatalCodes = [
        'QUOTA_EXCEEDED',
        'RATE_LIMITED',
        'PROVIDER_ERROR',
        'UNAVAILABLE',
        'TIMEOUT',
        'AUTHENTICATION_ERROR',
        'INSUFFICIENT_QUOTA',
        'RESOURCE_EXHAUSTED',
      ];

      const isFatal =
        fatalCodes.includes(errCode) ||
        errMsg.includes('429') ||
        errMsg.includes('500') ||
        errMsg.includes('502') ||
        errMsg.includes('503') ||
        errMsg.toLowerCase().includes('quota') ||
        errMsg.toLowerCase().includes('rate limit');

      if (isTimeout || isFatal) {
        const primKey = provider || state.original?.provider || 'default';
        ctx.logger?.warn?.(
          `[Router] 主模型 [${primKey}] 异常 (${errCode || 'ERROR'}: ${errMsg})，触发转移至 Fallback [${fallback.provider}/${fallback.model}]`
        );

        // 仅累加该具体主模型的失败次数
        const rec = getFailureRecord(primKey);
        rec.count++;
        rec.lastTime = Date.now();

        // 状态迁移至 fallback，驱动 loop 发起重试
        state.currentRoute = 'fallback';
        state.attemptCount = (state.attemptCount || 1) + 1;

        return { kind: 'retry' };
      }
    }

    // 备选模型亦失败（或不满足降级条件）：清理状态并透传给下游终态报错
    activeStepStates.delete(key);
    return next();
  });

  // ─────────────────────────────────────────────────────────────
  // 4. 会话边界状态清理
  // ─────────────────────────────────────────────────────────────
  ctx.on('agent/assistant-stream', (payload) => {
    const { frame, agent, turn, step } = payload || {};
    if (frame?.type === 'end' || frame?.type === 'finish') {
      const key = getStepKey(agent?.id, turn, step);
      activeStepStates.delete(key);
    }
  });

  // 提供状态检查与调试服务句柄
  const routerService = {
    getConsecutiveFailures: (providerKey) => {
      if (providerKey) return getFailureRecord(providerKey).count;
      let max = 0;
      for (const rec of providerFailures.values()) {
        if (rec.count > max) max = rec.count;
      }
      return max;
    },
    isCircuitOpen,
    resetCircuitBreaker: (providerKey) => {
      if (providerKey) {
        getFailureRecord(providerKey).count = 0;
      } else {
        providerFailures.clear();
      }
    },
    getActiveStepStates: () => activeStepStates,
    clearAllStates: () => {
      providerFailures.clear();
      activeStepStates.clear();
    },
    getTimeoutMs,
    getFallbackConfig,
    getPrimaryConfig,
  };

  if (typeof ctx.provide === 'function') {
    ctx.provide('modelRouter', routerService);
  }
  ctx.modelRouter = routerService;
  return routerService;
}

export default {
  name,
  apply,
};
