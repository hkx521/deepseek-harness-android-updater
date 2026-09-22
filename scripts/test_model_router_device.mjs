import { Context } from '/data/user/0/com.deepseek.harness/files/payload/dshroot/lib/node_modules/@deepseek-ai/cordis/lib/index.js';
import routerPlugin from '/data/user/0/com.deepseek.harness/files/payload/dshhome/profiles/web/node_modules/@jiesou/dsh-model-router/lib/index.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    failed++;
    throw new Error(message);
  } else {
    console.log(`[PASS] ${message}`);
    passed++;
  }
}

async function runTests() {
  console.log('=== 开始 Pixel 6 Pro 真机环境模型路由插件热验证 ===\n');

  // ─────────────────────────────────────────────────────────────
  // 测试 1: 插件初始化与 Cordis 挂载
  // ─────────────────────────────────────────────────────────────
  console.log('--- 测试 1: 插件初始化与 Cordis 服务注入 ---');
  const ctx = new Context();
  await ctx.plugin(routerPlugin, {
    timeoutMs: 800,
    primary: { provider: 'deepseek-api', model: 'deepseek-chat' },
    fallback: { provider: 'commandcode-go-provider', model: 'deepseek-chat' },
    circuitBreaker: { enabled: true, failureThreshold: 2, coolDownMs: 5000 },
  });

  const modelRouter = ctx.modelRouter;
  assert(modelRouter !== undefined, 'modelRouter 服务句柄已成功挂载到 Cordis Context (ctx.modelRouter)');
  assert(typeof modelRouter.getTimeoutMs === 'function', 'getTimeoutMs 接口可用');
  assert(modelRouter.getTimeoutMs() === 800, '配置超时时间 timeoutMs = 800ms 正确生效');
  assert(modelRouter.getFallbackConfig().provider === 'commandcode-go-provider', 'Fallback provider 配置正确');

  // ─────────────────────────────────────────────────────────────
  // 测试 2: 流式首包 TTFT 哨兵超时拦截
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 测试 2: 流式首包 TTFT 哨兵超时拦截 ---');
  
  // 2.1 模拟正常流（快速返回首包）
  async function* mockFastStream() {
    yield { type: 'chunk', text: 'Hello' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
  const fastGenerator = ctx.events.waterfall('llm/stream', { signal: new AbortController().signal }, () => mockFastStream());
  const fastChunks = [];
  for await (const chunk of await fastGenerator) {
    fastChunks.push(chunk);
  }
  assert(fastChunks.length === 2 && fastChunks[0].text === 'Hello', '正常快速流未被哨兵打断');

  // 2.2 模拟超时流（首包延迟 > 800ms）
  async function* mockSlowStream(opts) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 1200);
      opts?.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(opts.signal.reason);
      }, { once: true });
    });
    yield { type: 'chunk', text: 'Too late' };
  }
  const slowGenerator = ctx.events.waterfall('llm/stream', { signal: new AbortController().signal }, (wrappedOpts) => mockSlowStream(wrappedOpts));
  const slowChunks = [];
  for await (const chunk of await slowGenerator) {
    slowChunks.push(chunk);
  }
  assert(slowChunks.length === 1, '超时流只产出终态 failure 帧');
  assert(slowChunks[0].type === 'finish', '超时帧类型为 finish');
  assert(slowChunks[0].reason?.failure?.code === 'TIMEOUT', '超时帧包含 failure.code = TIMEOUT');
  assert(slowChunks[0].reason?.failure?.retryable === true, '超时标记为 retryable = true');
  console.log(`  -> 捕获超时保护分片: ${JSON.stringify(slowChunks[0].reason.failure)}`);

  // ─────────────────────────────────────────────────────────────
  // 测试 3: 异常状态拦截与自动降级重试 (Waterfall)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 测试 3: 异常状态拦截与自动降级重试 ---');
  const agentPayload = {
    agent: { id: 'test-agent-1' },
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
  };

  // 3.1 初始尝试：路由提议为 primary
  const proposal1 = await ctx.events.waterfall('agent/request', agentPayload, () => ({
    provider: 'deepseek-api',
    model: 'deepseek-chat',
  }));
  assert(proposal1.provider === 'deepseek-api', '第 1 次尝试正确使用主模型: deepseek-api');

  // 3.2 模拟主模型产生 500 严重故障
  const errPayload = {
    agent: { id: 'test-agent-1' },
    turn: 1,
    step: 1,
    provider: 'deepseek-api',
    failure: { code: 'PROVIDER_ERROR', message: 'Internal Server Error 500' },
    signal: agentPayload.signal,
  };
  const errDecision = await ctx.events.waterfall('agent/request-error', errPayload, () => ({ kind: 'fail' }));
  assert(errDecision.kind === 'retry', '拦截 500 严重故障，触发 retry 决策');
  assert(modelRouter.getConsecutiveFailures() === 1, '主模型连续失败计数自增为 1');

  // 3.3 重试尝试：同 turn 同 step 再次请求，必须自动透明切换至 fallback
  const proposal2 = await ctx.events.waterfall('agent/request', agentPayload, () => ({
    provider: 'deepseek-api',
    model: 'deepseek-chat',
  }));
  assert(proposal2.provider === 'commandcode-go-provider', '降级重试自动路由至 Fallback provider: commandcode-go-provider');
  assert(proposal2.model === 'deepseek-chat', '降级重试使用 Fallback model: deepseek-chat');

  // 3.4 模拟 step 成功结束，会话状态清理
  ctx.events.emit('agent/assistant-stream', {
    agent: { id: 'test-agent-1' },
    turn: 1,
    step: 1,
    frame: { type: 'finish' },
  });
  const stepStates = modelRouter.getActiveStepStates();
  assert(!stepStates.has('test-agent-1:1:1'), 'Step 结束后主动清理隔离状态');

  // ─────────────────────────────────────────────────────────────
  // 测试 4: 熔断器 (Circuit Breaker) 保护
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 测试 4: 熔断器连续失败阈值与熔断状态 ---');
  // 之前已有 1 次失败，再注入 1 次 429 失败，达到阈值 2
  const errPayload2 = {
    agent: { id: 'test-agent-2' },
    turn: 1,
    step: 1,
    provider: 'deepseek-api',
    failure: { code: 'RATE_LIMITED', message: 'Too many requests 429' },
    signal: new AbortController().signal,
  };
  // 先触发 agent/request 初始化 state
  await ctx.events.waterfall('agent/request', errPayload2, () => ({ provider: 'deepseek-api', model: 'deepseek-chat' }));
  await ctx.events.waterfall('agent/request-error', errPayload2, () => ({ kind: 'fail' }));
  
  assert(modelRouter.getConsecutiveFailures() === 2, '连续失败次数达到阈值: 2');
  assert(modelRouter.isCircuitOpen() === true, '熔断器状态已进入 OPEN 熔断状态');

  // 新 step 发起，初次尝试就直接被短路到 Fallback
  const newStepPayload = {
    agent: { id: 'test-agent-3' },
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
  };
  const proposalCircuit = await ctx.events.waterfall('agent/request', newStepPayload, () => ({
    provider: 'deepseek-api',
    model: 'deepseek-chat',
  }));
  assert(proposalCircuit.provider === 'commandcode-go-provider', '熔断生效：新会话直接旁路至 Fallback 模型');

  // ─────────────────────────────────────────────────────────────
  // 测试 5: 用户显式取消 (AbortSignal) 防误伤
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 测试 5: 用户显式主动取消防误伤 ---');
  const abortCtrl = new AbortController();
  abortCtrl.abort(); // 提前主动取消

  const abortPayload = {
    agent: { id: 'test-abort' },
    turn: 1,
    step: 1,
    signal: abortCtrl.signal,
  };

  let caughtAbort = false;
  try {
    await ctx.events.waterfall('agent/request', abortPayload, () => ({ provider: 'deepseek-api', model: 'deepseek-chat' }));
  } catch (err) {
    if (err.name === 'AbortError' || err.message.includes('aborted')) {
      caughtAbort = true;
    }
  }
  assert(caughtAbort, 'agent/request 严禁误伤：用户取消立即抛出 AbortError 短路');

  const abortErrPayload = {
    agent: { id: 'test-abort' },
    turn: 1,
    step: 1,
    failure: { code: 'ABORT', message: 'This operation was aborted' },
    signal: abortCtrl.signal,
  };
  const abortErrDecision = await ctx.events.waterfall('agent/request-error', abortErrPayload, () => ({ kind: 'user_aborted' }));
  assert(abortErrDecision.kind === 'user_aborted', 'agent/request-error 用户取消不触发 retry 降级');

  console.log(`\n=========================================`);
  console.log(`Pixel 6 Pro 真机验证全部完成: ${passed} 项通过, ${failed} 项失败`);
  console.log(`=========================================`);
}

runTests().catch((err) => {
  console.error('测试运行异常:', err);
  process.exit(1);
});
