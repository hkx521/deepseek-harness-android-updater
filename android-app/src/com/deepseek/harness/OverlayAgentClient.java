package com.deepseek.harness;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.UUID;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** DSH RPC client used by the M1 overlay assistant. */
final class OverlayAgentClient {
    interface Listener {
        void onStarted(String sessionId);

        void onProgress(String text);

        /** 批次37：轮询到新的助手文本就回吐一次，供悬浮卡片流式展示。 */
        void onPartial(String text);

        /** 批次38 P0：结构化诊断（sessionId / running / 已等待秒数 / records 数）。 */
        void onDiag(String info);

        void onResult(String text);

        void onError(String message);
    }

    private static final String TAG = "dsh-overlay-agent";
    private static final String PREFS = "dsh_prefs";
    private static final String KEY_PORT = "engine_port";
    private static final String KEY_COOKIE = "engine_cookie";
    private static final String KEY_LAST_SESSION = "overlay_last_session_id";
    private static final int DEFAULT_PORT = 3080;
    // 批次63：长任务重载/多步骤操作时，引擎事件较密集，短超时（5s）易在轮询期间误判网络断开
    // 调整连接超时至 6s，读取超时至 15s，并增加单次轮询失败重试
    private static final int CONNECT_TIMEOUT_MS = 6000;
    private static final int READ_TIMEOUT_MS = 15000;
    private static final long POLL_INTERVAL_MS = 1000L;
    /** 批次38 P0：硬超时（原 120s 一刀切导致「等两分钟还失败」）。 */
    /** 批次41 自适应长生命周期超时（从 180s 拓宽至 600s，适配 20+ 步真实自动化任务）。 */
    private static final long TOTAL_TIMEOUT_MS = 600000L;
    /** 单步空闲超时（连续无任何活动 120s 告警）。 */
    private static final long STEP_IDLE_TIMEOUT_MS = 120000L;
    /** 批次38 P0：软超时 —— 到点先给用户一个可见的阶段提示，不再静默等待。 */
    private static final long SOFT_TIMEOUT_MS = 25000L;
    private static final int MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
    /**
     * 批次77（用户拍板「助手只展示 dsh 的真实状态」）：
     * 1) session.page 默认窗口 / 失配时加宽窗口（本轮 prompt 被 50 条消息窗口挤出时重取）；
     * 2) 轮询类 RPC（session.list / session.page）I/O 重试：连续 3 次失败才交给上层；
     * 3) 引擎 running=true 即视为任务仍在推进，deadline 滚动续期（带绝对上限）；
     * 4) 本地不再因「连续几轮 running=false」判死 —— 只有长时间取不到本轮终态才中性收尾。
     */
    private static final int PAGE_MAX_MESSAGES = 50;
    private static final int PAGE_MAX_MESSAGES_WIDE = 240;
    private static final int POLL_IO_MAX_ATTEMPTS = 3;
    private static final long[] POLL_IO_BACKOFF_MS = { 1000L, 2000L, 4000L };
    /** running=true 驱动的续期绝对上限（防止引擎侧异常挂起导致会话永不结束）。 */
    private static final long ACTIVITY_ABSOLUTE_CAP_MS = 6L * 60L * 60L * 1000L;
    /**
     * 批次79：中性收尾门槛从「连续 30 轮 running=false」（≈30s）改为「连续 120 轮
     * **既没在跑、也没有任何新事件**」（≈120s 真静默）。引擎在 checkpoint 拼接、queue
     * 排队、轮间空档都会短暂 running=false，旧门槛会把「引擎还要继续跑」误判成本轮结束。
     */
    private static final int ENDED_WITHOUT_RESULT_ROUNDS = 120;
    /**
     * 批次79 兜底：即使引擎在 running=false 期间仍偶尔产出事件（把静默计数不断清零），
     * 只要「不在运行」连续达到该轮数（≈10 分钟）也中性收尾 —— 避免面板被杂散事件永久挂着。
     */
    private static final int IDLE_WITHOUT_RESULT_ABS_CAP_ROUNDS = 600;
    /** 批次79：续跟（只读跟踪既有会话）收尾前缀 —— 上层据此走「引擎侧状态」展示，
     *  既不谎报成功也不判失败；续跟不发 prompt、不新建会话、不 cancel。 */
    public static final String TRACK_RESULT_PREFIX = "【续跟】";
    /** 批次79：续跟模式下，引擎侧既没在跑也没有新事件的连续轮数达到该值即收尾（≈10s）。 */
    private static final int TRACK_SETTLE_ROUNDS = 10;
    /** 中性收尾文案：属「引擎侧已结束」，不是「执行失败」；OverlayService 据此走中性状态。 */
    public static final String ENDED_WITHOUT_RESULT_TEXT =
            "（引擎侧本轮已结束，但未取到文本结果；可在 dsh 会话里查看本轮详情）";

    private final Object stateLock = new Object();
    private final Object rpcLock = new Object();
    private final SharedPreferences prefs;
    private final int enginePort;

    private volatile boolean running;
    private volatile boolean closed;
    private volatile boolean cancelRequested;
    private volatile boolean cancelInFlight;
    private volatile long generation;
    private volatile Thread worker;
    private volatile String activeSessionId;
    /** 批次82-N1：一次性会话钉选（「一键放行」= 同一会话补发）；submit 一进入就取走。 */
    private String pinnedSession;
    private volatile HttpURLConnection activeConnection;

    OverlayAgentClient(Context ctx) {
        if (ctx == null) {
            throw new IllegalArgumentException("ctx is required");
        }
        Context appContext = ctx.getApplicationContext();
        if (appContext == null) {
            appContext = ctx;
        }
        prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int configuredPort = prefs.getInt(KEY_PORT, DEFAULT_PORT);
        enginePort = configuredPort > 0 ? configuredPort : DEFAULT_PORT;
    }

    boolean isRunning() {
        return running && !closed;
    }

    void submit(String prompt, final Listener listener) {
        if (listener == null) {
            throw new IllegalArgumentException("listener is required");
        }
        if (prompt == null || prompt.trim().isEmpty()) {
            listener.onError("提示词为空");
            return;
        }

        // 批次82-N1：钉选只对「这一次 submit」有效 —— 进入即取走，无论本轮成败都不残留。
        final String pinnedSessionId;
        synchronized (stateLock) {
            pinnedSessionId = (pinnedSession == null || pinnedSession.isEmpty()) ? null : pinnedSession;
            pinnedSession = null;
        }

        final long taskGeneration;
        synchronized (stateLock) {
            if (closed) {
                listener.onError("悬浮助手客户端已关闭");
                return;
            }
            if (running || cancelInFlight) {
                listener.onError("已有任务执行中");
                return;
            }
            taskGeneration = ++generation;
            running = true;
            cancelRequested = false;
            activeSessionId = null;
            final String taskPrompt = prompt;
            Thread task = new Thread(new Runnable() {
                @Override
                public void run() {
                    runTask(taskPrompt, pinnedSessionId, listener, taskGeneration);
                }
            }, "overlay-agent-" + taskGeneration);
            worker = task;
            task.start();
        }
    }

    /**
     * 批次82-N1：「一键放行」把下一次 {@link #submit} 钉在指定会话上 —— 放行 = 同一会话补发，
     * 不走 {@link #resolveSession} 的事件数轮换，也不改写 {@code overlay_last_session_id}
     * （历史成果 / 「续跟引擎」仍指向用户可见的那次会话）。
     *
     * <p>之所以是「钉住下一次」而不是给 submit 加参数：放行路径与普通路径共用
     * {@code client.submit(prompt, listener)} 同一处 listener 装配，避免复制一份 6 回调监听器。</p>
     *
     * <p>一次性：{@link #submit} 进入即取走（即使随后因「已有任务执行中」被拒也不残留）；
     * 调用方只在提交前一刻钉，不跨轮复用。</p>
     */
    void pinNextSession(String sessionId) {
        synchronized (stateLock) {
            pinnedSession = sessionId == null ? null : sessionId.trim();
        }
    }

    /**
     * 批次79：只读续跟一个既有会话（面板「续跟引擎」入口）。
     * 不发 prompt、不新建会话、不 cancel —— 只把面板重新接回引擎的真实状态：
     * 引擎在跑就持续刷新「运行中 · 事件#N」，引擎空闲且静默 TRACK_SETTLE_ROUNDS 轮后收尾，
     * 收尾文案以 TRACK_RESULT_PREFIX 开头（既不谎报成功也不判失败）。
     */
    void track(String sessionId, final Listener listener) {
        if (listener == null) {
            throw new IllegalArgumentException("listener is required");
        }
        if (sessionId == null || sessionId.trim().isEmpty()) {
            listener.onError("没有可续跟的会话");
            return;
        }
        final String target = sessionId.trim();
        final long taskGeneration;
        Thread task;
        synchronized (stateLock) {
            if (closed) {
                listener.onError("悬浮助手客户端已关闭");
                return;
            }
            if (running || cancelInFlight) {
                listener.onError("已有任务执行中");
                return;
            }
            taskGeneration = ++generation;
            running = true;
            cancelRequested = false;
            activeSessionId = target;
            task = new Thread(new Runnable() {
                @Override
                public void run() {
                    runTrack(target, listener, taskGeneration);
                }
            }, "overlay-track-" + taskGeneration);
            worker = task;
        }
        task.start();
    }

    private void runTrack(String sessionId, Listener listener, long taskGeneration) {
        try {
            emitDiag(taskGeneration, listener, "续跟会话 " + shortId(sessionId));
            emitProgress(taskGeneration, listener, "已接回引擎状态（只跟踪，不重新执行）");
            String snapshot = trackSession(taskGeneration, sessionId, listener);
            if (snapshot != null) {
                emitResult(taskGeneration, listener, snapshot);
            }
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        } catch (AgentException e) {
            Log.w(TAG, "agent track failed: " + e.describe());
            emitError(taskGeneration, listener, e.describe());
        } catch (Exception e) {
            Log.w(TAG, "agent track failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            emitError(taskGeneration, listener, "[track/" + e.getClass().getSimpleName() + "] 续跟异常");
        } finally {
            finishTask(taskGeneration);
        }
    }

    /** 续跟主循环：只读 session.list / session.page，绝不触碰 prompt / cancel。 */
    private String trackSession(long taskGeneration, String sessionId, Listener listener)
            throws AgentException, InterruptedException, JSONException {
        long startedAt = System.currentTimeMillis();
        long lastSeenSeq = -1L;
        long deadline = startedAt + TOTAL_TIMEOUT_MS;
        int quietRounds = 0;
        boolean sawRunning = false;
        String lastPartial = "";
        while (isActive(taskGeneration)) {
            JSONObject listValue = rpc("session.list", new JSONObject(), taskGeneration, false, true);
            JSONObject summary = findSession(listValue, sessionId);
            if (summary == null) {
                throw new AgentException("track", "session-missing", "会话不存在或已被删除");
            }
            boolean sessionRunning = booleanField(summary, "running");
            long seq = sessionAsOfSeq(summary);
            // requestId 传空串（不是 null）：既不匹配任何本轮，也不会 NPE；
            // 续跟只展示引擎侧状态与最新文本，不判本轮成败。
            PageState page = fetchPage(taskGeneration, sessionId, seq, PAGE_MAX_MESSAGES, "");
            long waitedSec = (System.currentTimeMillis() - startedAt) / 1000L;
            if (page.latestAssistantText != null && !page.latestAssistantText.isEmpty()
                    && !page.latestAssistantText.equals(lastPartial)) {
                lastPartial = page.latestAssistantText;
                emitPartial(taskGeneration, listener, lastPartial);
            }
            emitProgress(taskGeneration, listener, "续跟：引擎侧"
                    + (sessionRunning ? "运行中" : "空闲") + " · 事件#" + seq
                    + " · 已跟" + waitedSec + "s"
                    + ((page.lastTool == null || page.lastTool.isEmpty())
                        ? "" : " · 最近工具 " + friendlyTool(page.lastTool)));
            boolean advanced = seq > lastSeenSeq;
            if (advanced) {
                lastSeenSeq = seq;
            }
            if (sessionRunning) {
                sawRunning = true;
                quietRounds = 0;
                long extended = System.currentTimeMillis() + TOTAL_TIMEOUT_MS;
                if (extended - startedAt <= ACTIVITY_ABSOLUTE_CAP_MS && extended > deadline) {
                    deadline = extended;
                }
            } else if (advanced) {
                quietRounds = 0;
            } else {
                quietRounds++;
            }
            if (!sessionRunning && quietRounds >= TRACK_SETTLE_ROUNDS) {
                return trackSnapshot(sessionId, lastSeenSeq, waitedSec, lastPartial, sawRunning);
            }
            if (System.currentTimeMillis() >= deadline) {
                // 续跟不是任务：超时只提示引擎侧仍在运行，绝不标记失败。
                return TRACK_RESULT_PREFIX + "跟踪超时（引擎侧仍在运行，事件#" + lastSeenSeq
                        + "）。可在 dsh 里继续查看。";
            }
            Thread.sleep(POLL_INTERVAL_MS);
        }
        throw new InterruptedException();
    }

    private static String trackSnapshot(String sessionId, long seq, long waitedSec,
                                        String latestText, boolean sawRunning) {
        StringBuilder sb = new StringBuilder();
        sb.append(TRACK_RESULT_PREFIX).append("引擎侧该会话")
                .append(sawRunning ? "已运行结束" : "当前空闲")
                .append("（事件#").append(seq).append("，跟踪 ").append(waitedSec)
                .append("s，会话 ").append(shortId(sessionId)).append("）");
        if (latestText != null && !latestText.isEmpty()) {
            sb.append('\n').append(latestText);
        }
        return sb.toString();
    }

    void cancel() {
        Thread task;
        synchronized (stateLock) {
            if (closed || !running) {
                return;
            }
            cancelRequested = true;
            cancelInFlight = true;
            running = false;
            generation++;
            task = worker;
        }
        disconnectActiveConnection();
        if (task != null) {
            task.interrupt();
        }
    }

    /** 批次41：重置/清空会话引用，确保下次任务从独立干净会话发起，避免历史 Context 爆炸。 */
    void resetSession() {
        prefs.edit().remove(KEY_LAST_SESSION).apply();
    }

    void close() {
        Thread task;
        synchronized (stateLock) {
            if (closed) {
                return;
            }
            closed = true;
            cancelRequested = false;
            cancelInFlight = false;
            running = false;
            generation++;
            task = worker;
            worker = null;
            activeSessionId = null;
        }
        disconnectActiveConnection();
        if (task != null) {
            task.interrupt();
        }
    }

    private void runTask(String prompt, String pinnedSessionId, Listener listener, long taskGeneration) {
        try {
            // 批次82-N1：钉住会话时跳过 resolveSession（不新建会话、不轮换、不写 prefs）
            String sessionId = (pinnedSessionId != null && !pinnedSessionId.isEmpty())
                    ? pinnedSessionId
                    : resolveSession(taskGeneration);
            if (pinnedSessionId != null && !pinnedSessionId.isEmpty()) {
                Log.i(TAG, "[b82n1] proceed resubmit session=" + shortId(sessionId));
            }
            if (sessionId == null) {
                return;
            }
            if (!markSession(taskGeneration, sessionId)) {
                return;
            }

            JSONObject promptPayload = new JSONObject();
            String requestId = "overlay-" + UUID.randomUUID().toString();
            promptPayload.put("requestId", requestId);
            promptPayload.put("sessionId", sessionId);
            promptPayload.put("mode", "queue");
            JSONArray content = new JSONArray();
            JSONObject textBlock = new JSONObject();
            textBlock.put("type", "text");
            textBlock.put("text", prompt);
            content.put(textBlock);
            promptPayload.put("content", content);

            JSONObject promptValue = rpc("session.prompt", promptPayload, taskGeneration, false);
            requireAccepted(promptValue, "session.prompt");
            if (!isActive(taskGeneration)) {
                return;
            }
            emitDiag(taskGeneration, listener, "prompt accepted, session=" + shortId(sessionId));
            emitStarted(taskGeneration, listener, sessionId);
            emitProgress(taskGeneration, listener, "等待 Agent 回复...");

            String result = pollForResult(taskGeneration, sessionId, requestId, listener);
            if (result != null) {
                emitResult(taskGeneration, listener, result);
            }
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        } catch (AgentException e) {
            // 批次38 P0：保留 stage/code，便于用户与日志判别（原实现只取 getMessage）。
            Log.w(TAG, "agent task failed: " + e.describe());
            emitError(taskGeneration, listener, e.describe());
        } catch (Exception e) {
            Log.w(TAG, "agent task failed: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            emitError(taskGeneration, listener, "[task/" + e.getClass().getSimpleName() + "] Agent 请求异常");
        } finally {
            finishTask(taskGeneration);
        }
    }

    private String resolveSession(long taskGeneration) throws AgentException, InterruptedException {
        String stored = prefs.getString(KEY_LAST_SESSION, null);
        if (stored != null && !stored.trim().isEmpty() && isActive(taskGeneration)) {
            JSONObject listValue = rpc("session.list", new JSONObject(), taskGeneration, false, true);
            JSONObject existing = findSession(listValue, stored);
            if (existing != null) {
                long seq = sessionAsOfSeq(existing);
                if (seq < 30) {
                    return stored;
                }
                Log.i(TAG, "session " + shortId(stored) + " has " + seq + " events, rotating new session");
            }
        }

        JSONObject createValue = rpc("session.create", new JSONObject(), taskGeneration, false);
        String sessionId = stringField(createValue, "sessionId");
        if (sessionId.isEmpty()) {
            throw new AgentException("session", "no-session-id", "DSH 响应缺少 sessionId");
        }
        prefs.edit().putString(KEY_LAST_SESSION, sessionId).apply();
        return sessionId;
    }

    private String pollForResult(long taskGeneration, String sessionId, String requestId,
                                   Listener listener)
            throws AgentException, InterruptedException, JSONException {
        long startedAt = System.currentTimeMillis();
        long deadline = startedAt + TOTAL_TIMEOUT_MS;
        long lastActivityAt = startedAt;
        String lastReportedTool = "";
        long lastSeenSeq = -1L;
        long softDeadline = startedAt + SOFT_TIMEOUT_MS;
        boolean progressSent = false;
        boolean softNotified = false;
        String lastPartial = "";
        int round = 0;
        /**
         * 批次77：引擎侧 running=false 的连续轮数。不再据此判死，只用于
         * 「长时间取不到本轮终态」时的中性收尾（ENDED_WITHOUT_RESULT_ROUNDS）。
         */
        int endedRounds = 0;
        /** 批次79：连续 running=false 的轮数（不因新事件清零，只作兜底上限）。 */
        int idleRounds = 0;

        while (isActive(taskGeneration)) {
            round++;
            JSONObject listPayload = new JSONObject();
            JSONObject listValue = rpc("session.list", listPayload, taskGeneration, false, true);
            JSONObject summary = findSession(listValue, sessionId);
            if (summary == null) {
                throw new AgentException("poll", "session-missing", "会话不存在或已被删除");
            }
            if (!summary.has("running")) {
                throw new AgentException("poll", "no-running-field",
                        "DSH session.list 响应缺少 running");
            }
            boolean sessionRunning = booleanField(summary, "running");
            long waitedSec = (System.currentTimeMillis() - startedAt) / 1000L;
            // 批次38 诊断：会话元数据（blank/cwd/agentPreset 为空常意味本轮无从执行）
            if (round == 1) {
                String meta = summary.toString();
                Log.i(TAG, "session meta: "
                        + (meta.length() > 300 ? meta.substring(0, 300) : meta));
            }

            long latestSeq = sessionAsOfSeq(summary);
            // 批次77：默认窗口取不到本轮 prompt 时（长任务/长会话把 rpcId 挤出 50 条窗口），
            // 自动加宽窗口重取一次 —— 绝不因为「看不到」就判失败。
            PageState page = fetchPage(taskGeneration, sessionId, latestSeq,
                    PAGE_MAX_MESSAGES, requestId);
            if (page.promptSeq < 0 && page.recordCount > 0) {
                PageState wide = fetchPage(taskGeneration, sessionId, latestSeq,
                        PAGE_MAX_MESSAGES_WIDE, requestId);
                if (wide.promptSeq >= 0 || wide.resultText != null || wide.failureText != null
                        || wide.completedWithoutText) {
                    page = wide;
                    emitDiag(taskGeneration, listener,
                            "窗口失配 → 加宽重取命中（records=" + wide.recordCount + "）");
                } else {
                    emitDiag(taskGeneration, listener,
                            "窗口失配：默认/加宽窗口都未命中本轮 rpcId（records="
                                    + page.recordCount + "）");
                }
            }
            // 下面保留 throughSeq 契约注释（取数实现已抽到 fetchPage）：
            // 批次38 P0 根因修复：throughSeq 不能传 -1。
            // 真机实测：throughSeq=-1 时 records 恒为 0（拿不到任何回复）；
            // 完全省略该字段则被网关判为 gateway/input-invalid（该字段是必填）。
            // 正确取值来自 session.list 的 projections.asOfSeq（当前最新事件序号），
            // 引擎按 `log.slice(0, throughSeq + 1)` 切片，asOfSeq 即含全部事件。
            // （原 M1 契约里的 throughSeq=-1 是错的，见 docs/批次38 根因记录。）
            emitDiag(taskGeneration, listener, "session=" + shortId(sessionId)
                    + " running=" + sessionRunning + " 已等待" + waitedSec + "s"
                    + " 轮询#" + round
                    + " records=" + page.recordCount
                    + " kinds=" + (page.kinds.isEmpty() ? "-" : page.kinds));

            // 批次79：本轮引擎是否产出了新事件（区分「真的静默」与「轮间空档」）。
            final boolean seqAdvanced = latestSeq > lastSeenSeq;
            if (seqAdvanced) {
                lastSeenSeq = latestSeq;
                lastActivityAt = System.currentTimeMillis();
                // 批次65-B：动态心跳延期 —— 只要引擎持续产出新事件，截止时间自动向后滚动续期 10 分钟
                deadline = lastActivityAt + TOTAL_TIMEOUT_MS;
            }
            if (page.lastTool != null && !page.lastTool.isEmpty()
                    && (!page.lastTool.equals(lastReportedTool) || page.step > 0)) {
                lastReportedTool = page.lastTool;
                lastActivityAt = System.currentTimeMillis();
                // 批次65-B：动态心跳延期 —— 只要 Agent 在调用新工具操作，截止时间自动向后滚动续期 10 分钟
                deadline = lastActivityAt + TOTAL_TIMEOUT_MS;
                emitProgress(taskGeneration, listener, "正在执行: " + friendlyTool(page.lastTool)
                        + (page.step > 0 ? " (步骤 #" + page.step + ")" : ""));
            }
            // 批次77：引擎侧 running=true 本身就是「任务仍在推进」的证据 —— 等用户回答/长思考/
            // 单步超长工具期间不会有新事件，旧逻辑会在 600s 后误判 hard-timeout。
            // 这里按 running 滚动续期，并用 ACTIVITY_ABSOLUTE_CAP_MS 兜底防止永不结束。
            if (sessionRunning) {
                long extended = System.currentTimeMillis() + TOTAL_TIMEOUT_MS;
                if (extended - startedAt <= ACTIVITY_ABSOLUTE_CAP_MS && extended > deadline) {
                    deadline = extended;
                }
            }

            // 批次37：无论是否结束，只要有新的助手文本就先流式回吐一次
            if (page.resultText != null && !page.resultText.equals(lastPartial)) {
                lastPartial = page.resultText;
                emitPartial(taskGeneration, listener, lastPartial);
            }
            if (!sessionRunning && page.resultText != null) {
                return page.resultText;
            }
            if (!sessionRunning && page.failureText != null) {
                throw new AgentException("agent", "failed", page.failureText);
            }
            // 批次77：completedWithoutText 只在确实看到「本轮」turn/end 时才算数（promptSeq>=0），
            // 否则窗口失配会把别的轮次终态误判成本轮结果。
            if (!sessionRunning && page.completedWithoutText && page.promptSeq >= 0) {
                throw new AgentException("result", "empty-text", "Agent 未返回文本结果");
            }
            // 批次77（用户拍板：助手只展示引擎状态）：running=false 只代表「此刻引擎侧没在跑」，
            // 轮间、checkpoint 拼接、queue 排队未开始都会短暂为 false —— 绝不据此判死。
            // 只有长时间（ENDED_WITHOUT_RESULT_ROUNDS 轮）取不到本轮终态，才中性收尾（不算失败）。
            if (!sessionRunning) {
                endedRounds++;
                idleRounds++;
                // 批次79：真正静默 = 「没在跑」且「没有任何新事件」。引擎在 checkpoint 拼接、
                // 自动续跑、queue 排队推进期间 running=false 但事件仍在增长 —— 这不是结束，
                // 是还在跑，静默计数必须清零（旧实现只看 running=false，会抢在引擎前面收尾）。
                if (seqAdvanced) {
                    endedRounds = 0;
                    emitDiag(taskGeneration, listener,
                            "引擎侧 running=false 但仍有新事件（静默计数清零）");
                } else if (endedRounds == 3 || endedRounds % 30 == 0) {
                    emitProgress(taskGeneration, listener,
                            "引擎侧当前未在运行（已等待 " + waitedSec + "s，继续等待终态…）");
                }
                if (!seqAdvanced && endedRounds >= ENDED_WITHOUT_RESULT_ROUNDS) {
                    return ENDED_WITHOUT_RESULT_TEXT;
                }
                if (idleRounds >= IDLE_WITHOUT_RESULT_ABS_CAP_ROUNDS) {
                    return ENDED_WITHOUT_RESULT_TEXT;
                }
            } else {
                endedRounds = 0;
                idleRounds = 0;
            }
            if (!softNotified && System.currentTimeMillis() >= softDeadline) {
                softNotified = true;
                emitProgress(taskGeneration, listener,
                        "Agent 仍在处理（已 " + (SOFT_TIMEOUT_MS / 1000L) + "s），可继续等待或取消");
            }
            if (sessionRunning && !progressSent) {
                emitProgress(taskGeneration, listener, "Agent 处理中...");
                progressSent = true;
            }
            long now = System.currentTimeMillis();
            if (now >= deadline) {
                throw new AgentException("timeout", "hard-timeout",
                        "等待引擎响应超时（" + (TOTAL_TIMEOUT_MS / 1000L)
                                + "s 内无新事件且引擎未在运行；可在 dsh 会话里继续跟踪）");
            }
            if (now - lastActivityAt >= STEP_IDLE_TIMEOUT_MS && sessionRunning) {
                emitProgress(taskGeneration, listener, "单步处理中（已无动作 "
                        + ((now - lastActivityAt) / 1000L) + "s），可继续等待或取消");
            }
            Thread.sleep(POLL_INTERVAL_MS);
        }
        throw new InterruptedException();
    }

    /** 批次77：取页面快照（可指定窗口大小），抽出来便于「窗口失配 → 加宽重取」。 */
    private PageState fetchPage(long taskGeneration, String sessionId, long throughSeq, int maxMessages,
                                String requestId)
            throws AgentException, InterruptedException, JSONException {
        JSONObject pagePayload = new JSONObject();
        JSONObject address = new JSONObject();
        address.put("kind", "session");
        address.put("sessionId", sessionId);
        pagePayload.put("address", address);
        pagePayload.put("maxMessages", maxMessages);
        // 批次38 P0 根因修复：throughSeq 不能传 -1（传 -1 时 records 恒为 0；省略该字段会被
        // 网关判 gateway/input-invalid）。正确取值来自 session.list 的 projections.asOfSeq。
        pagePayload.put("throughSeq", throughSeq);
        JSONObject pageValue = rpc("session.page", pagePayload, taskGeneration, false, true);
        logRawResponse("session.page", pageValue);
        return parsePage(pageValue, requestId);
    }

    private static PageState parsePage(JSONObject value, String requestId) throws AgentException {
        JSONArray records = value.optJSONArray("records");
        if (records == null) {
            throw new AgentException("page", "no-records", "DSH session.page 响应缺少 records");
        }

        PageState state = new PageState();
        long promptSeq = -1L;
        // 批次38：记录最近若干事件类型，用于判断是否卡在工具调用/审批等待
        StringBuilder kinds = new StringBuilder();
        int kindsCount = 0;
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.optJSONObject(i);
            if (record == null || !"event".equals(record.optString("type"))) {
                continue;
            }
            JSONObject event = record.optJSONObject("event");
            if (event == null) {
                continue;
            }
            long seq = event.optLong("seq", -1L);
            String type = event.optString("type", "");
            if (kindsCount < 6) {
                if (kinds.length() > 0) kinds.append(',');
                kinds.append(type);
                kindsCount++;
            }
            JSONObject data = event.optJSONObject("data");
            if (data == null) {
                continue;
            }

            // 批次79：无条件记录窗口内最后一条助手文本（供续跟模式展示引擎侧最新进展）。
            if ("assistant/message".equals(type)) {
                String latest = assistantText(data);
                if (!latest.isEmpty()) {
                    state.latestAssistantText = latest;
                }
            }

            if ("tool/call".equals(type)) {
                String toolName = stringField(data, "name");
                int step = data.optInt("step", 0);
                if (!toolName.isEmpty()) {
                    state.lastTool = toolName;
                    state.step = step;
                }
                continue;
            }

            if ("user/message".equals(type)) {
                JSONObject source = data.optJSONObject("source");
                String rpcId = source == null ? "" : stringField(source, "rpcId");
                if (requestId.equals(rpcId)) {
                    promptSeq = seq;
                }
                continue;
            }
            if (promptSeq < 0 || seq <= promptSeq) {
                continue;
            }
            if ("assistant/message".equals(type)) {
                String text = assistantText(data);
                if (!text.isEmpty()) {
                    state.resultText = text;
                }
                continue;
            }
            if ("turn/end".equals(type)) {
                JSONObject reason = data.optJSONObject("reason");
                String kind = reason == null ? "" : reason.optString("kind", "");
                if ("completed".equals(kind)) {
                    state.completedWithoutText = true;
                } else if ("error".equals(kind)) {
                    JSONObject error = reason.optJSONObject("error");
                    String message = error == null ? "" : stringField(error, "message");
                    state.failureText = message.isEmpty() ? "Agent 执行失败" : "Agent 执行失败: " + message;
                } else if ("aborted".equals(kind) || "interrupted".equals(kind)) {
                    state.failureText = "Agent 执行已中断";
                } else if ("blocked".equals(kind)) {
                    state.failureText = "Agent 执行被阻止";
                }
            }
        }
        state.kinds = kinds.toString();
        state.recordCount = records.length();
        state.promptSeq = promptSeq;
        return state;
    }

    private static String assistantText(JSONObject data) {
        JSONObject message = data.optJSONObject("message");
        if (message == null) {
            return "";
        }
        if (!"assistant".equals(stringField(message, "role"))) {
            return "";
        }
        JSONArray blocks = message.optJSONArray("content");
        if (blocks == null) {
            return "";
        }

        StringBuilder text = new StringBuilder();
        for (int i = 0; i < blocks.length(); i++) {
            JSONObject block = blocks.optJSONObject(i);
            if (block == null || !"text".equals(block.optString("type", ""))) {
                continue;
            }
            String part = stringField(block, "text");
            if (part.trim().isEmpty()) {
                continue;
            }
            if (text.length() > 0) {
                text.append('\n');
            }
            text.append(part);
        }
        return text.toString();
    }

    private static String friendlyTool(String name) {
        if (name == null || name.isEmpty()) return "工具处理";
        if (name.contains("android_screen") || name.contains("screen")) return "读取屏幕";
        if (name.contains("tap") || name.contains("click")) return "点击元素";
        if (name.contains("scroll") || name.contains("swipe")) return "滑动屏幕";
        if (name.contains("input") || name.contains("type")) return "输入文本";
        if (name.contains("back")) return "返回";
        if (name.contains("home")) return "返回桌面";
        if (name.contains("act") || name.contains("touch")) return "操作屏幕";
        if (name.contains("bash") || name.contains("exec")) return "执行系统命令";
        if (name.contains("confirm")) return "等待审批确认";
        if (name.contains("ask_user_question") || name.contains("question")) return "等待您回答提问";
        return name;
    }

    /** 批次77：提交类 RPC 走这里 —— 不重试（避免重复投递 prompt / 重复建会话）。 */
    private JSONObject rpc(String method, JSONObject payload, long taskGeneration, boolean cancelCall)
            throws AgentException, InterruptedException {
        return rpc(method, payload, taskGeneration, cancelCall, false);
    }

    /**
     * 批次77：轮询类 RPC（session.list / session.page）带 I/O 重试 —— 单次读超时/连接抖动
     * 不再直接判任务失败（批次63 注释承诺过「单次轮询失败重试」，当时并未落地）。
     */
    private JSONObject rpc(String method, JSONObject payload, long taskGeneration, boolean cancelCall,
                           boolean retryIo)
            throws AgentException, InterruptedException {
        int attempts = retryIo ? POLL_IO_MAX_ATTEMPTS : 1;
        for (int attempt = 1; ; attempt++) {
            try {
                return rpcOnce(method, payload, taskGeneration, cancelCall);
            } catch (AgentException e) {
                if (!isRetryableIo(e) || attempt >= attempts) {
                    throw e;
                }
                long backoff = POLL_IO_BACKOFF_MS[
                        Math.min(attempt - 1, POLL_IO_BACKOFF_MS.length - 1)];
                Log.w(TAG, "RPC " + method + " I/O 失败（" + e.describe() + "），" + backoff
                        + "ms 后重试（第 " + attempt + "/" + (attempts - 1) + " 次）");
                try {
                    Thread.sleep(backoff);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new InterruptedException();
                }
            }
        }
    }

    /** 只有网络类错误可重试；协议/鉴权/参数错误立即上报（重试无意义）。 */
    private static boolean isRetryableIo(AgentException e) {
        return e != null && "net".equals(e.stage);
    }

    private JSONObject rpcOnce(String method, JSONObject payload, long taskGeneration, boolean cancelCall)
            throws AgentException, InterruptedException {
        synchronized (rpcLock) {
            if (cancelCall ? closed : !isActive(taskGeneration)) {
                throw new InterruptedException();
            }

            HttpURLConnection connection = null;
            try {
                String endpoint = method.replace('.', '/');
                URL url = new URL("http://127.0.0.1:" + enginePort + "/api/" + endpoint);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
                connection.setReadTimeout(READ_TIMEOUT_MS);
                String cookie = prefs.getString(KEY_COOKIE, null);
                if (cookie != null && !cookie.isEmpty()) {
                    connection.setRequestProperty("Cookie", cookie);
                }
                activeConnection = connection;

                String rpcId = "overlay-" + UUID.randomUUID().toString();
                JSONObject envelope = new JSONObject();
                envelope.put("type", "client-request");
                envelope.put("rpcId", rpcId);
                envelope.put("method", endpoint);
                String argumentName = "session.list".equals(method) ? "_request" : "request";
                JSONObject arguments = new JSONObject();
                arguments.put(argumentName, payload);
                JSONObject payloadWrapper = new JSONObject();
                payloadWrapper.put("args", arguments);
                envelope.put("payload", payloadWrapper);
                byte[] body = envelope.toString().getBytes("UTF-8");
                OutputStream output = connection.getOutputStream();
                output.write(body);
                output.close();

                int status = connection.getResponseCode();
                if (status == 401) {
                    // 说明：cookie 每次 rpc 都从 prefs 现读（见上方 setRequestProperty），
                    // 因此 401 不是「客户端缓存了旧 cookie」，而是 prefs 里的凭据已失效
                    // （引擎重启后轮换 / MainActivity 尚未回写）。此处只如实上报，不猜测。
                    throw new AgentException("auth", "http-401",
                            "引擎鉴权失败（HTTP 401：本地凭据已失效，请重启引擎）");
                }
                if (status < 200 || status >= 300) {
                    throw new AgentException("rpc", "http-" + status,
                            "引擎 RPC 失败（HTTP " + status + "）");
                }
                String response = readBody(connection.getInputStream());
                if (cancelCall ? closed : !isActive(taskGeneration)) {
                    throw new InterruptedException();
                }

                JSONObject root;
                try {
                    root = new JSONObject(response);
                } catch (JSONException e) {
                    throw new AgentException("rpc", "bad-envelope", "DSH 响应解析失败");
                }
                if (!"server-response".equals(root.optString("type", ""))) {
                    throw new AgentException("rpc", "bad-json", "DSH 响应格式错误");
                }
                if (!rpcId.equals(root.optString("rpcId", ""))) {
                    throw new AgentException("rpc", "rpcid-mismatch", "DSH 响应关联 ID 不匹配");
                }
                JSONObject result = root.optJSONObject("result");
                if (result == null || !result.has("ok")) {
                    throw new AgentException("rpc", "no-result", "DSH 响应缺少 result");
                }
                if (!result.optBoolean("ok", false)) {
                    JSONObject error = result.optJSONObject("error");
                    String code = error == null ? "" : stringField(error, "code");
                    throw new AgentException("rpc", "error-result", code.isEmpty()
                            ? "DSH RPC 调用失败"
                            : "DSH RPC 调用失败: " + code);
                }
                JSONObject value = result.optJSONObject("value");
                if (value == null) {
                    throw new AgentException("rpc", "no-value", "DSH 响应缺少 value");
                }
                return value;
            } catch (SocketTimeoutException e) {
                throw new AgentException("net", "connect-timeout", "引擎请求超时");
            } catch (ConnectException e) {
                throw new AgentException("net", "unreachable", "引擎不可达");
            } catch (AgentException e) {
                if ((!cancelCall && !isActive(taskGeneration)) || (cancelCall && closed)) {
                    throw new InterruptedException();
                }
                throw e;
            } catch (IOException e) {
                if ((!cancelCall && !isActive(taskGeneration)) || (cancelCall && closed)) {
                    throw new InterruptedException();
                }
                Log.w(TAG, "RPC " + method + " I/O failed: " + e.getClass().getSimpleName());
                throw new AgentException("net", "read-failed", "引擎连接失败");
            } catch (JSONException e) {
                throw new AgentException("rpc", "write-failed", "DSH 请求构造失败");
            } finally {
                if (activeConnection == connection) {
                    activeConnection = null;
                }
                if (connection != null) {
                    connection.disconnect();
                }
            }
        }
    }

    private String readBody(InputStream input) throws IOException, AgentException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int total = 0;
        int read;
        while ((read = input.read(buffer)) >= 0) {
            total += read;
            if (total > MAX_RESPONSE_BYTES) {
                throw new AgentException("rpc", "too-large", "DSH 响应过大");
            }
            output.write(buffer, 0, read);
        }
        input.close();
        return output.toString("UTF-8");
    }

    /** 批次38：把引擎原始响应截断落日志，用于定位 input-invalid 等校验失败。 */
    private static void logRawResponse(String method, JSONObject value) {
        String raw = value == null ? "null" : value.toString();
        Log.i(TAG, method + " raw: " + (raw.length() > 400 ? raw.substring(0, 400) : raw));
    }

    private static void requireAccepted(JSONObject value, String method) throws AgentException {
        if (!value.has("accepted") || !booleanField(value, "accepted")) {
            throw new AgentException("rpc", "not-accepted", method + " 未被接受");
        }
    }

    /** 批次38：从 session.list 的会话摘要里取 projections.asOfSeq（最新事件序号）。 */
    private static long sessionAsOfSeq(JSONObject summary) {
        if (summary == null) return -1L;
        JSONObject projections = summary.optJSONObject("projections");
        if (projections == null) return -1L;
        long seq = projections.optLong("asOfSeq", -1L);
        return seq;
    }

    private static JSONObject findSession(JSONObject value, String sessionId)
            throws AgentException {
        JSONArray items = value.optJSONArray("items");
        if (items == null) {
            throw new AgentException("page", "no-items", "DSH session.list 响应缺少 items");
        }
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null && sessionId.equals(stringField(item, "sessionId"))) {
                return item;
            }
        }
        return null;
    }

    private static String stringField(JSONObject object, String name) {
        Object value = object.opt(name);
        return value instanceof String ? (String) value : "";
    }

    /** 会话 id 缩短展示（诊断用，避免刷屏）。 */
    private static String shortId(String id) {
        if (id == null) return "-";
        // 会话 id 形如 session-<random>，只留前缀无信息量，改为保留尾部
        return id.length() <= 14 ? id : "..." + id.substring(id.length() - 11);
    }

    private static boolean booleanField(JSONObject object, String name) throws AgentException {
        Object value = object.opt(name);
        if (!(value instanceof Boolean)) {
            throw new AgentException("rpc", "field-type", "DSH 响应字段类型错误: " + name);
        }
        return ((Boolean) value).booleanValue();
    }

    private boolean markSession(long taskGeneration, String sessionId) {
        synchronized (stateLock) {
            if (!isActive(taskGeneration)) {
                return false;
            }
            activeSessionId = sessionId;
            return true;
        }
    }

    private boolean isActive(long taskGeneration) {
        synchronized (stateLock) {
            return !closed && running && !cancelRequested && generation == taskGeneration;
        }
    }

    private void emitStarted(long taskGeneration, Listener listener, String sessionId) {
        synchronized (stateLock) {
            if (isActive(taskGeneration)) {
                listener.onStarted(sessionId);
            }
        }
    }

    /** 批次37：流式结果回调（代际校验，避免取消后串包）。 */
    private void emitPartial(long taskGeneration, Listener listener, String text) {
        if (!isActive(taskGeneration)) {
            return;
        }
        try {
            listener.onPartial(text);
        } catch (Throwable t) {
            Log.w(TAG, "onPartial failed: " + t.getClass().getSimpleName());
        }
    }

    /** 批次38 P0：诊断信息（代际校验；失败不致命）。 */
    private void emitDiag(long taskGeneration, Listener listener, String info) {
        if (!isActive(taskGeneration)) {
            return;
        }
        try {
            listener.onDiag(info);
        } catch (Throwable t) {
            Log.w(TAG, "onDiag failed: " + t.getClass().getSimpleName());
        }
    }

    private void emitProgress(long taskGeneration, Listener listener, String text) {
        synchronized (stateLock) {
            if (isActive(taskGeneration)) {
                listener.onProgress(text);
            }
        }
    }

    private void emitResult(long taskGeneration, Listener listener, String text) {
        synchronized (stateLock) {
            if (isActive(taskGeneration)) {
                listener.onResult(text);
            }
        }
    }

    private void emitError(long taskGeneration, Listener listener, String text) {
        synchronized (stateLock) {
            if (isActive(taskGeneration)) {
                listener.onError(text);
            }
        }
    }

    private void finishTask(long taskGeneration) {
        String cancelSessionId = null;
        boolean cancelCall = false;
        synchronized (stateLock) {
            Thread current = Thread.currentThread();
            if (worker == current) {
                worker = null;
            }
            cancelCall = cancelRequested && !closed && activeSessionId != null;
            cancelSessionId = activeSessionId;
            if (generation == taskGeneration) {
                running = false;
                activeSessionId = null;
            }
        }

        if (cancelCall) {
            try {
                JSONObject cancelPayload = new JSONObject();
                cancelPayload.put("sessionId", cancelSessionId);
                rpc("session.cancel", cancelPayload, taskGeneration, true);
            } catch (Exception ignored) {
                Log.w(TAG, "session.cancel failed");
            }
        }

        synchronized (stateLock) {
            if (generation != taskGeneration || closed) {
                activeSessionId = null;
            }
            cancelInFlight = false;
        }
    }

    private void disconnectActiveConnection() {
        HttpURLConnection connection = activeConnection;
        if (connection != null) {
            try {
                connection.disconnect();
            } catch (Throwable ignored) {
            }
        }
    }

    private static final class PageState {
        String resultText;
        /** 批次79：窗口内最后一条 assistant/message 文本（续跟模式没有 requestId 可匹配，
         *  只能展示引擎侧最新一段文本；主流程仍以 promptSeq 匹配到的 resultText 为准）。 */
        String latestAssistantText;
        String failureText;
        boolean completedWithoutText;
        /** 批次77：本轮 prompt（rpcId 匹配）在窗口里的 seq；<0 = 窗口失配（未命中本轮）。 */
        long promptSeq = -1L;
        /** 最近事件的类型摘要（批次38 诊断用） */
        String kinds = "";
        /** records 条数 */
        int recordCount;
        String lastTool;
        int step;
    }

    /** 批次38 P0：失败必须可判别（阶段 + 机器可读 code），不再只给一句中文。 */
    private static final class AgentException extends Exception {
        final String stage;
        final String code;

        AgentException(String message) {
            this("task", "unknown", message);
        }

        AgentException(String stage, String code, String message) {
            super(message);
            this.stage = stage;
            this.code = code;
        }

        String describe() {
            return "[" + stage + "/" + code + "] " + getMessage();
        }
    }
}
