/**
 * @file tests/test_model_router.mjs
 * @description 模型路由核心插件独立自测脚本
 * 覆盖场景：
 *  1. 正常请求（首字及时返回）-> 零干扰透传，Timer 被清理
 *  2. 首字超时（TTFT 超时）-> 触发超时中断并驱动重试到 Fallback 模型
 *  3. 致命错误（429 / 500 / Quota 耗尽）-> 触发降级切到 Fallback 模型
 *  4. 用户手动取消（signal.abort）-> 立即终止，严格禁止触发降级或重试
 *  5. 熔断器阈值触发与冷却恢复机制
 *  6. 双重失败（Fallback 亦失败）-> 终态透传报错，防止死循环
 */

import assert from 'node:assert/strict';
import { apply as applyModelRouter } from '../plugins/dsh-model-router/lib/index.js';

/**
 * 模拟 Cordis Context 与事件洋葱模型
 */
class MockContext {
  constructor() {
    this.handlers = new Map();
    this.logger = {
      info: (msg) => console.log('    [ctx:info]', msg),
      warn: (msg) => console.log('    [ctx:warn]', msg),
      error: (msg) => console.log('    [ctx:error]', msg),
    };
  }

  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(handler);
    return () => {
      const list = this.handlers.get(event) || [];
      const idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  async emitRequest(payload, defaultNext) {
    const handlers = this.handlers.get('agent/request') || [];
    const dispatch = async (i) => {
      if (i < handlers.length) {
        return handlers[i](payload, () => dispatch(i + 1));
      }
      return defaultNext();
    };
    return dispatch(0);
  }

  async *emitStream(options, leafNext) {
    const handlers = this.handlers.get('llm/stream') || [];
    const dispatch = (i, currOptions) => {
      if (i < handlers.length) {
        return handlers[i](currOptions, (nextOpts) => dispatch(i + 1, nextOpts || currOptions));
      }
      return leafNext(currOptions);
    };
    yield* dispatch(0, options);
  }

  async emitRequestError(payload, defaultNext) {
    const handlers = this.handlers.get('agent/request-error') || [];
    const dispatch = async (i) => {
      if (i < handlers.length) {
        return handlers[i](payload, () => dispatch(i + 1));
      }
      return defaultNext ? defaultNext() : { kind: 'error' };
    };
    return dispatch(0);
  }

  emit(event, payload) {
    const handlers = this.handlers.get(event) || [];
    for (const h of handlers) {
      h(payload);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// 测试套件运行入口
// ─────────────────────────────────────────────────────────────
async function runTests() {
  console.log('=== 开始执行模型路由插件离线自测试 ===\n');

  // -------------------------------------------------------------
  // 场景 1: 正常请求（首字在超时阈值内返回）
  // -------------------------------------------------------------
  {
    console.log('[测试 1] 正常请求：首字及时返回 -> 零干扰透传，Timer 被清理');
    const ctx = new MockContext();
    const router = applyModelRouter(ctx, {
      timeoutMs: 100, // 100ms 超时用于加速测试
      primary: { provider: 'deepseek', model: 'deepseek-chat' },
      fallback: { provider: 'commandcode-go-provider', model: 'deepseek-chat' },
    });

    const agent = { id: 'agent-1' };
    const turn = 1;
    const step = 1;

    // 1. 发起请求协商
    const requestConfig = await ctx.emitRequest({ agent, turn, step }, async () => {
      return { provider: 'deepseek', model: 'deepseek-chat' };
    });
    assert.equal(requestConfig.provider, 'deepseek', '初始应保持 primary provider');
    assert.equal(requestConfig.model, 'deepseek-chat', '初始应保持 primary model');

    // 2. 模拟底层正常流（首字在 20ms 返回，后续在 40ms 返回）
    async function* mockNormalStream(opts) {
      await sleep(20);
      yield { type: 'delta', text: 'Hello' };
      await sleep(20);
      yield { type: 'delta', text: ' world' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }

    const chunks = [];
    for await (const chunk of ctx.emitStream({}, mockNormalStream)) {
      chunks.push(chunk);
    }

    assert.equal(chunks.length, 3, '应完整收到 3 个分片');
    assert.equal(chunks[0].text, 'Hello', '首字内容正确透传');
    assert.equal(chunks[1].text, ' world', '第二分片内容正确透传');
    assert.equal(chunks[2].type, 'finish', '正常 finish 分片透传');

    // 等待超过 100ms 验证 Timer 确实已被清理，未引发延迟 abort 或错误
    await sleep(120);
    assert.equal(router.getConsecutiveFailures(), 0, '正常流程不应记录任何失败');

    // 触发完成通知，清理状态
    ctx.emit('agent/assistant-stream', { frame: { type: 'end' }, agent, turn, step });
    console.log('  -> 场景 1 验证通过: 零干扰透传，Timer 准时清理\n');
  }

  // -------------------------------------------------------------
  // 场景 2: 首字超时（>timeoutMs 无首字）
  // -------------------------------------------------------------
  {
    console.log('[测试 2] 首字超时：超过阈值无首字 -> 触发超时中断并驱动重试到 Fallback 模型');
    const ctx = new MockContext();
    const router = applyModelRouter(ctx, {
      timeoutMs: 60, // 60ms 超时
      primary: { provider: 'deepseek', model: 'deepseek-chat' },
      fallback: { provider: 'commandcode-go-provider', model: 'deepseek-chat' },
    });

    const agent = { id: 'agent-2' };
    const turn = 1;
    const step = 1;

    // 1. Attempt 1: agent/request 下发主模型配置
    const configAttempt1 = await ctx.emitRequest({ agent, turn, step }, async () => {
      return { provider: 'deepseek', model: 'deepseek-chat' };
    });
    assert.equal(configAttempt1.provider, 'deepseek');

    // 2. 模拟远端卡死 Hang（延迟 150ms 远超 60ms 阈值）
    async function* mockHangingStream(opts) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 150);
        if (opts.signal) {
          opts.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
      yield { type: 'delta', text: '迟到的输出' };
    }

    const chunks = [];
    for await (const chunk of ctx.emitStream({}, mockHangingStream)) {
      chunks.push(chunk);
    }

    // 验证生成了 TIMEOUT finish 分片
    assert.equal(chunks.length, 1, '超时应终止流并产生 1 个 finish 分片');
    assert.equal(chunks[0].type, 'finish');
    assert.equal(chunks[0].reason?.failure?.code, 'TIMEOUT', '分片 failure code 应为 TIMEOUT');

    // 3. 错误进入 agent/request-error
    const errorAction = await ctx.emitRequestError({
      agent,
      turn,
      step,
      provider: 'deepseek',
      failure: chunks[0].reason.failure,
    }, async () => ({ kind: 'terminate' }));

    assert.equal(errorAction.kind, 'retry', '发生超时应返回 retry 动作');
    assert.equal(router.getConsecutiveFailures(), 1, '应记录一次熔断失败');

    // 4. Attempt 2: 重新进入 agent/request，验证路由改写为 Fallback
    const configAttempt2 = await ctx.emitRequest({ agent, turn, step }, async () => {
      return { provider: 'deepseek', model: 'deepseek-chat' };
    });
    assert.equal(configAttempt2.provider, 'commandcode-go-provider', 'Attempt 2 必须被重写为 fallback provider');
    assert.equal(configAttempt2.model, 'deepseek-chat', 'Attempt 2 必须被重写为 fallback model');

    // 5. Fallback 模型执行正常
    async function* mockFallbackStream() {
      yield { type: 'delta', text: '来自备选模型的回复' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
    const fallbackChunks = [];
    for await (const chunk of ctx.emitStream({}, mockFallbackStream)) {
      fallbackChunks.push(chunk);
    }
    assert.equal(fallbackChunks[0].text, '来自备选模型的回复');

    ctx.emit('agent/assistant-stream', { frame: { type: 'end' }, agent, turn, step });
    console.log('  -> 场景 2 验证通过: 首字超时自动中断并成功切换至 Fallback 重试\n');
  }

  // -------------------------------------------------------------
  // 场景 3: 致命错误（429 / 500 / Quota 耗尽）
  // -------------------------------------------------------------
  {
    console.log('[测试 3] 致命错误：429 / 500 / Quota 耗尽 -> 自动降级切到 Fallback 模型');
    const ctx = new MockContext();
    const router = applyModelRouter(ctx, {
      timeoutMs: 8000,
      primary: { provider: 'deepseek', model: 'deepseek-chat' },
      fallback: { provider: 'commandcode-go-provider', model: 'deepseek-chat' },
    });

    const agent = { id: 'agent-3' };
    const turn = 1;
    const step = 1;

    // 1. 发起请求
    await ctx.emitRequest({ agent, turn, step }, async () => {
      return { provider: 'deepseek', model: 'deepseek-chat' };
    });

    // 2. 模拟上游返回 429 致命错误
    const errorAction429 = await ctx.emitRequestError({
      agent,
      turn,
      step,
      provider: 'deepseek',
      failure: {
        code: 'RATE_LIMITED',
        message: 'HTTP 429: Too Many Requests. Quota exhausted.',
      },
    }, async () => ({ kind: 'terminate' }));

    assert.equal(errorAction429.kind, 'retry', '429 致命错误必须触发 retry 降级');
    assert.equal(router.getConsecutiveFailures(), 1);

    // 3. 驱动重试：agent/request 下发备用模型
    const fallbackConfig = await ctx.emitRequest({ agent, turn, step }, async () => {
      return { provider: 'deepseek', model: 'deepseek-chat' };
    });
    assert.equal(fallbackConfig.provider, 'commandcode-go-provider', '必须路由至 fallback provider');

    ctx.emit('agent/assistant-stream', { frame: { type: 'end' }, agent, turn, step });
    console.log('  -> 场景 3 验证通过: 429/Quota 错误平滑降级切换至 Fallback 模型\n');
  }

  // -------------------------------------------------------------
  // 场景 4: 用户手动取消（signal.abort）
  // -------------------------------------------------------------
  {
    console.log('[测试 4] 用户显式取消：signal.abort -> 立即终止，严禁触发重试与降级');
    const ctx = new MockContext();
    const router = applyModelRouter(ctx, {
      timeoutMs: 5000,
      primary: { provider: 'deepseek', model: 'deepseek-chat' },
      fallback: { provider: 'commandcode-go-provider', model: 'deepseek-chat' },
    });

    const agent = { id: 'agent-4' };
    const turn = 1;
    const step = 1;

    // 4a. 验证流式中用户手动取消
    const userAbortController = new AbortController();
    async function* mockStreamWithUserAbort(opts) {
      await sleep(10);
      userAbortController.abort(new Error('User clicked Stop'));
      if (opts.signal?.aborted) {
        const abortErr = new Error('User clicked Stop');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      yield { type: 'delta', text: '不应输出' };
    }

    let threwAbort = false;
    try {
      for await (const chunk of ctx.emitStream({ signal: userAbortController.signal }, mockStreamWithUserAbort)) {
        // 不应进入
      }
    } catch (err) {
      threwAbort = true;
      assert.equal(err.message, 'User clicked Stop', '必须直接抛出用户取消异常');
    }
    assert.ok(threwAbort, '必须向上抛出 Abort 异常');

    // 4b. 错误处理层接收到包含用户取消信号的错误
    const defaultAction = { kind: 'cancelled_by_user' };
    const action = await ctx.emitRequestError({
      agent,
      turn,
      step,
      provider: 'deepseek',
      signal: userAbortController.signal,
      failure: { code: 'CANCELLED', message: 'User aborted' },
    }, async () => defaultAction);

    assert.equal(action.kind, 'cancelled_by_user', '用户取消时必须透传 defaultAction，严禁返回 retry');
    assert.equal(router.getConsecutiveFailures(), 0, '用户取消绝对不能记录为模型熔断失败');

    // 4c. 验证 agent/request 在 signal.aborted 时直接短路抛出
    await assert.rejects(async () => {
      await ctx.emitRequest({ agent, turn, step, signal: userAbortController.signal }, async () => {
        return { provider: 'deepseek', model: 'deepseek-chat' };
      });
    }, (err) => {
      return err === userAbortController.signal.reason ||
             err.name === 'AbortError' ||
             err.message.includes('Stop') ||
             err.message.includes('aborted');
    }, 'agent/request 必须在 signal 已取消时直接短路');

    console.log('  -> 场景 4 验证通过: 用户主动取消立即短路，零降级误伤\n');
  }

  // -------------------------------------------------------------
  // 场景 5: 惰性熔断器阈值开启与冷却恢复
  // -------------------------------------------------------------
  {
    console.log('[测试 5] 熔断机制：连续失败达到阈值开启熔断，冷却后半开恢复');
    const ctx = new MockContext();
    const router = applyModelRouter(ctx, {
      timeoutMs: 1000,
      primary: { provider: 'deepseek', model: 'deepseek-chat' },
      fallback: { provider: 'commandcode-go-provider', model: 'deepseek-chat' },
      circuitBreaker: {
        enabled: true,
        failureThreshold: 2,
        coolDownMs: 80, // 80ms 冷却时间用于测试
      },
    });

    const agent = { id: 'agent-5' };

    // 连续失败 2 次
    for (let i = 1; i <= 2; i++) {
      await ctx.emitRequest({ agent, turn: i, step: 1 }, async () => ({
        provider: 'deepseek',
        model: 'deepseek-chat',
      }));
      await ctx.emitRequestError({
        agent,
        turn: i,
        step: 1,
        provider: 'deepseek',
        failure: { code: 'PROVIDER_ERROR', message: '500 Internal Server Error' },
      });
    }

    assert.equal(router.getConsecutiveFailures(), 2);
    assert.equal(router.isCircuitOpen(), true, '达到 2 次阈值后熔断器必须为 Open');

    // 新的 Turn：请求一上来就应该被重写为 Fallback
    const tripConfig = await ctx.emitRequest({ agent, turn: 3, step: 1 }, async () => ({
      provider: 'deepseek',
      model: 'deepseek-chat',
    }));
    assert.equal(tripConfig.provider, 'commandcode-go-provider', '熔断期内新会话请求必须直接重写为 Fallback');

    // 等待冷却时间过去（>80ms）
    await sleep(90);
    assert.equal(router.isCircuitOpen(), false, '冷却时间过去后熔断器应转为关闭/半开');

    const recoveredConfig = await ctx.emitRequest({ agent, turn: 4, step: 1 }, async () => ({
      provider: 'deepseek',
      model: 'deepseek-chat',
    }));
    assert.equal(recoveredConfig.provider, 'deepseek', '冷却后新会话允许重新尝试 Primary');
    console.log('  -> 场景 5 验证通过: 熔断器计数、阻断与冷却半开恢复均正常\n');
  }

  // -------------------------------------------------------------
  // 场景 6: 双重失败（Primary 失败 -> Fallback 亦失败）
  // -------------------------------------------------------------
  {
    console.log('[测试 6] 双重失败：Fallback 亦失败 -> 终态透传报错，防止死循环重试');
    const ctx = new MockContext();
    const router = applyModelRouter(ctx, {
      fallback: { provider: 'commandcode-go-provider', model: 'deepseek-chat' },
    });

    const agent = { id: 'agent-6' };
    const turn = 1;
    const step = 1;

    // 1. Primary 失败
    await ctx.emitRequest({ agent, turn, step }, async () => ({ provider: 'deepseek', model: 'deepseek-chat' }));
    const retryAction = await ctx.emitRequestError({
      agent,
      turn,
      step,
      provider: 'deepseek',
      failure: { code: '500', message: '500 Server Error' },
    });
    assert.equal(retryAction.kind, 'retry', 'Primary 失败应重试');

    // 2. Fallback 介入
    const fallbackConfig = await ctx.emitRequest({ agent, turn, step }, async () => ({
      provider: 'deepseek',
      model: 'deepseek-chat',
    }));
    assert.equal(fallbackConfig.provider, 'commandcode-go-provider');

    // 3. Fallback 也失败
    const finalAction = await ctx.emitRequestError({
      agent,
      turn,
      step,
      provider: 'commandcode-go-provider',
      failure: { code: '503', message: '503 Fallback also down' },
    }, async () => ({ kind: 'terminal_error' }));

    assert.equal(finalAction.kind, 'terminal_error', 'Fallback 也失败时必须透传终态报错，严禁死循环');
    console.log('  -> 场景 6 验证通过: 双重失败正确终态透传\n');
  }

  // -------------------------------------------------------------
  // 场景 7: 环境变量覆盖验证
  // -------------------------------------------------------------
  {
    console.log('[测试 7] 环境变量覆盖机制：DSH_ROUTER_TIMEOUT_MS 与 DSH_FALLBACK_* 优先级测试');
    process.env.DSH_ROUTER_TIMEOUT_MS = '1234';
    process.env.DSH_FALLBACK_PROVIDER = 'env-provider';
    process.env.DSH_FALLBACK_MODEL = 'env-model';

    const ctx = new MockContext();
    const router = applyModelRouter(ctx, {
      timeoutMs: 8000,
      fallback: { provider: 'config-provider', model: 'config-model' },
    });

    assert.equal(router.getTimeoutMs(), 1234, 'DSH_ROUTER_TIMEOUT_MS 应具有最高优先级');
    const fallback = router.getFallbackConfig();
    assert.equal(fallback.provider, 'env-provider', 'DSH_FALLBACK_PROVIDER 应覆盖配置');
    assert.equal(fallback.model, 'env-model', 'DSH_FALLBACK_MODEL 应覆盖配置');

    delete process.env.DSH_ROUTER_TIMEOUT_MS;
    delete process.env.DSH_FALLBACK_PROVIDER;
    delete process.env.DSH_FALLBACK_MODEL;
    console.log('  -> 场景 7 验证通过: 环境变量覆盖机制正常生效\n');
  }

  console.log('====================================');
  console.log('🎉 全部 7 个核心测试场景均 100% 通过！');
  console.log('====================================');
}

runTests().catch((err) => {
  console.error('❌ 测试运行失败:', err);
  process.exit(1);
});
