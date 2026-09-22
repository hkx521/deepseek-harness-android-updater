package com.deepseek.harness;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.UUID;

/**
 * 批次55-B：DSH 引擎「转发事件通道」（Remote Event）客户端。
 *
 * <p>背景：引擎调用 {@code ask_user_question} 或请求高危操作审批时，Host 会通过
 * 转发事件瀑布（{@code user-questions/request} / {@code approval/request}）向**所有**已连接的
 * 客户端广播，谁先回填结果谁生效；引擎侧**没有任何超时**，没有客户端接单就永久挂住
 * （真机实测卡死 110s）。
 *
 * <p>本类实现两条腿（协议取证见 docs/批次55B-引擎问询事件协议取证.md）：
 * <ul>
 *   <li><b>下行</b>：WebSocket {@code /api/remote.mux} 打开逻辑流 {@code $events}，
 *       收 {@code ready} / {@code waterfall} / {@code cancel} 帧；</li>
 *   <li><b>上行</b>：HTTP RPC {@code POST /api/$events/result}，把
 *       {@code {clientId,eventId,outcome}} 回填给引擎（信封与既有 RPC 同构，
 *       唯一差别是 {@code payload.args} 直接是结果对象）。</li>
 * </ul>
 *
 * <p>工程约束：本包没有 okhttp，Android 也没有 {@code java.net.http.WebSocket}，
 * 因此这里手写最小 RFC6455 客户端（文本帧 + 掩码 + 必须回 pong：服务端每 2000ms ping，
 * 连续 2 次未 pong 即 terminate）。任何异常都不上报主流程，只重连。
 */
final class DshEventMux {

    /** 引擎请求人类输入的回调（线程：mux IO 线程，调用方自行切主线程）。 */
    interface Listener {
        /** 连接状态变化（仅用于日志/诊断）。 */
        void onMuxState(boolean connected, String detail);

        /** 引擎提问（user-questions/request）：request.questions[]。 */
        void onQuestion(String eventId, String agentId, JSONObject request);

        /** 引擎请求高危操作授权（approval/request）：request.toolName / reason。 */
        void onApproval(String eventId, String agentId, JSONObject request);

        /** 该请求已结束（本端或其它客户端已回答 / 引擎撤销）。 */
        void onCleared(String eventId);

        /** 批次82-N4：第二条逻辑流（\`session/follow\`）的下行帧：snapshot / event / assistant-stream。 */
        void onSessionFrame(JSONObject frame);

        /** 批次82-N4：第二条逻辑流的开关状态（**不影响** \`$events\` 提问/审批那条流的连接语义）。 */
        void onSessionStreamState(boolean open, String detail);
    }

    private static final String TAG = "dsh-overlay-mux";
    private static final String PREFS = "dsh_prefs";
    private static final String KEY_PORT = "engine_port";
    private static final String KEY_COOKIE = "engine_cookie";
    private static final int DEFAULT_PORT = 3080;

    /** 常量出处：packages/api/gateway/src/stream-protocol.ts。 */
    private static final String MUX_PATH = "/api/remote.mux";
    private static final String EVENTS_ENDPOINT = "$events";
    private static final String RESULT_ENDPOINT = "$events/result";
    private static final String STREAM_ID = "overlay-events";
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final String EVENT_QUESTION = "user-questions/request";
    private static final String EVENT_APPROVAL = "approval/request";
    /**
     * 批次82-N4：第二条逻辑流 —— 引擎 \`session/follow\`（stream 型 Remote 方法，见
     * \`@deepseek-ai/dsh-api-session-controller\` 生成的 \`TypertRemoteMap['session/follow']\`）。
     *
     * <p>它与 \`$events\` 共用同一条 WebSocket，靠 \`streamId\` 分流：\`$events\` 继续只承载引擎提问/审批
     * （waterfall），本流只承载「会话 turn/message 级推送」，用来把面板的「AI：回复中…」和
     * 「本轮已结束」从「最多 3 秒的轮询快照」提前到毫秒级。</p>
     */
    private static final String SESSION_STREAM_ID = "overlay-session";
    private static final String SESSION_FOLLOW_ENDPOINT = "session/follow";

    private static final int CONNECT_TIMEOUT_MS = 3000;
    private static final int READ_TIMEOUT_MS = 25000;
    private static final int HTTP_TIMEOUT_MS = 5000;
    private static final int MAX_IDLE_TIMEOUTS = 3;
    private static final int MAX_FRAME_BYTES = 8 * 1024 * 1024;
    private static final long RECONNECT_MIN_MS = 1000L;
    private static final long RECONNECT_MAX_MS = 15000L;

    private static final SecureRandom RANDOM = new SecureRandom();

    private final SharedPreferences prefs;
    private final int enginePort;
    private final Listener listener;
    private final Object stateLock = new Object();
    private final Object writeLock = new Object();

    private volatile boolean started;
    private volatile boolean connected;
    private volatile String clientId = "";
    private volatile boolean reopenRequested;
    private volatile Thread worker;
    private volatile Socket socket;
    private volatile OutputStream socketOut;
    /** 批次82-N4：要 follow 的会话 id（空 = 不开第二条流；断线重连按它自动补发 open）。 */
    private volatile String followSessionId = "";
    /** 批次82-N4：第二条流是否已发出 open（收到 end / error 时置回 false）。 */
    private volatile boolean sessionStreamOpen = false;

    DshEventMux(Context ctx, Listener listener) {
        if (ctx == null) {
            throw new IllegalArgumentException("ctx is required");
        }
        Context appContext = ctx.getApplicationContext();
        if (appContext == null) {
            appContext = ctx;
        }
        this.prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int configuredPort = prefs.getInt(KEY_PORT, DEFAULT_PORT);
        this.enginePort = configuredPort > 0 ? configuredPort : DEFAULT_PORT;
        this.listener = listener;
    }

    /** 启动常驻连接（幂等）。断线后按 1s→15s 退避自动重连，直到 {@link #stop()}。 */
    void start() {
        synchronized (stateLock) {
            if (started) {
                return;
            }
            started = true;
            Thread thread = new Thread(new Runnable() {
                @Override
                public void run() {
                    runLoop();
                }
            }, "dsh-overlay-mux");
            worker = thread;
            thread.start();
        }
    }

    /** 停止连接与重连。 */
    void stop() {
        Thread thread;
        Socket current;
        synchronized (stateLock) {
            started = false;
            reopenRequested = false;
            followSessionId = "";
            sessionStreamOpen = false;
            thread = worker;
            worker = null;
            current = socket;
            socket = null;
            socketOut = null;
        }
        closeQuietly(current);
        if (thread != null) {
            thread.interrupt();
        }
        setConnected(false, "已停止");
    }

    boolean isConnected() {
        return connected;
    }

    /** 回填提问答案：{answers:[{id,selected:[],custom?}]}。 */
    void answerQuestion(String eventId, JSONArray answers) {
        try {
            JSONObject value = new JSONObject();
            value.put("answers", answers == null ? new JSONArray() : answers);
            submitResult(eventId, value);
        } catch (Throwable e) {
            Log.w(TAG, "构造提问答案失败: " + e.getClass().getSimpleName());
        }
    }

    /** 回填审批结论：'allowed-once' 或 'rejected'。 */
    void answerApproval(String eventId, String outcome) {
        submitResult(eventId, outcome == null ? "rejected" : outcome);
    }

    /** 取消提问：拒绝瀑布，引擎侧 ask_user_question 以 ASK_CANCELLED 结束。 */
    void cancelQuestion(String eventId) {
        try {
            JSONObject error = new JSONObject();
            error.put("name", "UserQuestionError");
            error.put("message", "the user cancelled ask_user_question");
            error.put("code", "ASK_CANCELLED");
            JSONObject outcome = new JSONObject();
            outcome.put("kind", "rejected");
            outcome.put("error", error);
            postOutcome(eventId, outcome);
        } catch (Throwable e) {
            Log.w(TAG, "构造取消结果失败: " + e.getClass().getSimpleName());
        }
    }

    private void submitResult(String eventId, Object value) {
        try {
            JSONObject outcome = new JSONObject();
            outcome.put("kind", "result");
            outcome.put("value", value);
            postOutcome(eventId, outcome);
        } catch (Throwable e) {
            Log.w(TAG, "构造回填结果失败: " + e.getClass().getSimpleName());
        }
    }

    private void postOutcome(final String eventId, final JSONObject outcome) {
        final String currentClientId = clientId;
        if (eventId == null || eventId.isEmpty()) {
            return;
        }
        if (currentClientId.isEmpty()) {
            Log.w(TAG, "尚未收到 ready 帧，无法回填 " + eventId);
            return;
        }
        Thread thread = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject args = new JSONObject();
                    args.put("clientId", currentClientId);
                    args.put("eventId", eventId);
                    args.put("outcome", outcome);
                    JSONObject value = rpcResult(args);
                    Log.i(TAG, "回填成功 eventId=" + eventId
                            + " kind=" + outcome.optString("kind", "")
                            + " value=" + (value == null ? "null" : value.toString()));
                } catch (Throwable e) {
                    Log.w(TAG, "回填失败 eventId=" + eventId + ": "
                            + e.getClass().getSimpleName() + " " + e.getMessage());
                }
            }
        }, "dsh-mux-answer");
        thread.start();
    }

    // ==================== 连接循环 ====================

    private void runLoop() {
        long backoff = RECONNECT_MIN_MS;
        int attempt = 0;
        while (started) {
            Socket current = null;
            try {
                attempt++;
                Log.i(TAG, "连接尝试 #" + attempt + " → 127.0.0.1:" + enginePort + MUX_PATH);
                current = openConnection();
                backoff = RECONNECT_MIN_MS;
                Log.i(TAG, "WS 已升级，等待 ready 帧");
                readLoop(current);
            } catch (Throwable e) {
                if (started) {
                    Log.i(TAG, "mux 断开: " + e.getClass().getSimpleName()
                            + (e.getMessage() == null ? "" : (" " + e.getMessage())));
                }
            } finally {
                synchronized (stateLock) {
                    if (socket == current) {
                        socket = null;
                        socketOut = null;
                    }
                }
                closeQuietly(current);
                setConnected(false, started ? "重连中" : "已停止");
            }
            if (!started) {
                return;
            }
            if (!sleepQuietly(backoff)) {
                return;
            }
            backoff = Math.min(backoff * 2L, RECONNECT_MAX_MS);
        }
    }

    private Socket openConnection() throws IOException {
        Socket fresh = new Socket();
        fresh.connect(new InetSocketAddress("127.0.0.1", enginePort), CONNECT_TIMEOUT_MS);
        fresh.setTcpNoDelay(true);
        fresh.setSoTimeout(READ_TIMEOUT_MS);

        String key = newWebSocketKey();
        StringBuilder request = new StringBuilder();
        request.append("GET ").append(MUX_PATH).append(" HTTP/1.1\r\n");
        request.append("Host: 127.0.0.1:").append(enginePort).append("\r\n");
        request.append("Upgrade: websocket\r\n");
        request.append("Connection: Upgrade\r\n");
        request.append("Sec-WebSocket-Key: ").append(key).append("\r\n");
        request.append("Sec-WebSocket-Version: 13\r\n");
        String cookie = prefs.getString(KEY_COOKIE, null);
        if (cookie != null && !cookie.isEmpty()
                && cookie.indexOf('\r') < 0 && cookie.indexOf('\n') < 0) {
            request.append("Cookie: ").append(cookie).append("\r\n");
        }
        // 批次55B 取证结论：不带 Origin —— 带错不值当（Host 必须是 loopback authority + Cookie 鉴权）
        request.append("\r\n");

        OutputStream out = fresh.getOutputStream();
        out.write(request.toString().getBytes("UTF-8"));
        out.flush();

        InputStream in = fresh.getInputStream();
        String statusLine = readLine(in);
        if (statusLine == null || statusLine.indexOf(" 101") < 0) {
            String cookieForLog = prefs.getString(KEY_COOKIE, null);
            Log.w(TAG, "升级被拒绝 status=" + statusLine + " port=" + enginePort
                    + " cookieLen=" + (cookieForLog == null ? -1 : cookieForLog.length()));
            throw new IOException("升级被拒绝: " + statusLine
                    + " | http探测=" + plainProbe());
        }
        String accept = null;
        while (true) {
            String line = readLine(in);
            if (line == null || line.isEmpty()) {
                break;
            }
            int colon = line.indexOf(':');
            if (colon > 0 && "sec-websocket-accept".equalsIgnoreCase(line.substring(0, colon).trim())) {
                accept = line.substring(colon + 1).trim();
            }
        }
        String expected = websocketAccept(key);
        if (accept == null || !expected.equalsIgnoreCase(accept)) {
            throw new IOException("Sec-WebSocket-Accept 校验失败");
        }

        synchronized (stateLock) {
            socket = fresh;
            socketOut = out;
            reopenRequested = false;
            clientId = "";
        }
        sendText("{\"type\":\"open\",\"streamId\":\"" + STREAM_ID + "\",\"endpoint\":\""
                + EVENTS_ENDPOINT + "\",\"payload\":{\"args\":{}}}");
        // 批次82-N4：同一条连接上按需补开第二条逻辑流（会话事件 follow；断线重连后同样要重新 follow）
        sessionStreamOpen = false;
        sendSessionOpen();
        return fresh;
    }

    /** 诊断用：同端口发一条普通 HTTP 请求，回报对端原始响应（升级失败时才调用）。 */
    private String plainProbe() {
        Socket probe = null;
        try {
            probe = new Socket();
            probe.connect(new InetSocketAddress("127.0.0.1", enginePort), CONNECT_TIMEOUT_MS);
            probe.setSoTimeout(3000);
            OutputStream out = probe.getOutputStream();
            out.write(("GET " + MUX_PATH + " HTTP/1.1\r\nHost: 127.0.0.1:" + enginePort
                    + "\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
            out.flush();
            byte[] buffer = new byte[256];
            int read = probe.getInputStream().read(buffer);
            if (read <= 0) {
                return "(空响应)";
            }
            return new String(buffer, 0, read, "UTF-8").replace('\r', ' ').replace('\n', ' ');
        } catch (Throwable e) {
            return e.getClass().getSimpleName() + ":" + e.getMessage();
        } finally {
            closeQuietly(probe);
        }
    }

    private void readLoop(Socket current) throws IOException {
        InputStream in = current.getInputStream();
        int idleTimeouts = 0;
        while (started) {
            if (reopenRequested) {
                throw new IOException("事件流被服务端结束");
            }
            Frame frame;
            try {
                frame = readFrame(in);
            } catch (SocketTimeoutException e) {
                idleTimeouts++;
                if (idleTimeouts > MAX_IDLE_TIMEOUTS) {
                    throw new IOException("读超时过多");
                }
                sendControl(0x9, new byte[0]);
                continue;
            }
            idleTimeouts = 0;
            if (frame == null) {
                throw new EOFException("连接被对端关闭");
            }
            switch (frame.opcode) {
                case 0x1:
                    handleText(new String(frame.payload, "UTF-8"));
                    break;
                case 0x9:
                    sendControl(0xA, frame.payload);
                    break;
                case 0x8:
                    throw new IOException("服务端要求关闭");
                default:
                    // 0x2 二进制 / 0x0 续帧 / 0xA pong：本通道不使用
                    break;
            }
        }
    }

    private void handleText(String text) {
        JSONObject message;
        try {
            message = new JSONObject(text);
        } catch (Throwable e) {
            return;
        }
        String type = message.optString("type", "");
        String streamId = message.optString("streamId", "");
        boolean sessionStream = SESSION_STREAM_ID.equals(streamId);
        if ("item".equals(type)) {
            JSONObject value = message.optJSONObject("value");
            if (value != null) {
                if (sessionStream) {
                    sessionStreamOpen = true;
                    if (listener != null) listener.onSessionFrame(value);
                } else {
                    handleValue(value);
                }
            }
            return;
        }
        if ("error".equals(type)) {
            if (sessionStream) {
                // 批次82-N4：第二条流自己的错误只关它自己 —— 不能把提问/审批那条流一起踢掉
                sessionStreamOpen = false;
                Log.w(TAG, "[b82n4] session/follow error: " + message.optJSONObject("error"));
                if (listener != null) listener.onSessionStreamState(false, "error");
                return;
            }
            Log.w(TAG, "事件流错误: " + message.optString("error", ""));
            reopenRequested = true;
            return;
        }
        if ("end".equals(type)) {
            if (sessionStream) {
                sessionStreamOpen = false;
                Log.i(TAG, "[b82n4] session/follow ended by host");
                if (listener != null) listener.onSessionStreamState(false, "end");
                return;
            }
            reopenRequested = true;
        }
    }

    private void handleValue(JSONObject value) {
        String type = value.optString("type", "");
        if ("ready".equals(type)) {
            clientId = value.optString("clientId", "");
            Log.i(TAG, "ready 帧到达 clientId=" + clientId);
            setConnected(true, "已就绪");
            return;
        }
        if ("waterfall".equals(type)) {
            String event = value.optString("event", "");
            String eventId = value.optString("eventId", "");
            String agentId = value.optString("agentId", "");
            JSONObject request = value.optJSONObject("request");
            if (request == null || eventId.isEmpty() || listener == null) {
                return;
            }
            if (EVENT_QUESTION.equals(event)) {
                listener.onQuestion(eventId, agentId, request);
            } else if (EVENT_APPROVAL.equals(event)) {
                listener.onApproval(eventId, agentId, request);
            }
            return;
        }
        if ("cancel".equals(type)) {
            String eventId = value.optString("eventId", "");
            if (!eventId.isEmpty() && listener != null) {
                listener.onCleared(eventId);
            }
        }
        // emit：其它转发事件（会话活动/状态），本通道不消费
    }

    private void setConnected(boolean nowConnected, String detail) {
        boolean changed = connected != nowConnected;
        connected = nowConnected;
        if (changed && listener != null) {
            listener.onMuxState(nowConnected, detail == null ? "" : detail);
        }
    }

    // ==================== 批次82-N4：第二条逻辑流（session/follow） ====================

    /**
     * 批次82-N4：开始 follow 指定会话（幂等）。连接未就绪时只记下来，连上后由
     * {@link #openConnection()} 自动补发 open 帧；断线重连同样会重新 follow。
     */
    void followSession(String sessionId) {
        if (sessionId == null || sessionId.isEmpty()) return;
        boolean changed;
        synchronized (stateLock) {
            changed = !sessionId.equals(followSessionId);
            followSessionId = sessionId;
        }
        if (changed) {
            Log.i(TAG, "[b82n4] follow session=" + shortId(sessionId));
        }
        sendSessionOpen();
    }

    /** 批次82-N4：停止 follow（任务收尾/取消/急停）；只取消第二条流，提问/审批通道不受影响。 */
    void unfollowSession() {
        String prev;
        synchronized (stateLock) {
            prev = followSessionId;
            followSessionId = "";
            sessionStreamOpen = false;
        }
        if (prev != null && !prev.isEmpty()) {
            sendCancel(SESSION_STREAM_ID);
            Log.i(TAG, "[b82n4] unfollow session=" + shortId(prev));
        }
    }

    /**
     * 批次82-N4：发 `session/follow` 的 open 帧。
     * 信封与 `$events` 同构（\`{type:open,streamId,endpoint,payload:{args:{...}}}\`），
     * 差别只在 \`payload.args.request\` = \`{address:{kind:session,sessionId},assistantStream:true}\`。
     */
    private void sendSessionOpen() {
        String sessionId = followSessionId;
        if (sessionId == null || sessionId.isEmpty()) return;
        if (socketOut == null) return;        // 未连接：等 openConnection 补发
        if (sessionStreamOpen) return;        // 已开：不重复开流
        try {
            JSONObject address = new JSONObject();
            address.put("kind", "session");
            address.put("sessionId", sessionId);
            JSONObject request = new JSONObject();
            request.put("address", address);
            request.put("assistantStream", true);   // 要进程内实时帧（面板「AI 回复中/字数」即时化）
            request.put("maxMessages", 1);          // 只要基线：历史仍由既有分页/轮询负责
            JSONObject args = new JSONObject();
            args.put("request", request);
            JSONObject payload = new JSONObject();
            payload.put("args", args);
            JSONObject open = new JSONObject();
            open.put("type", "open");
            open.put("streamId", SESSION_STREAM_ID);
            open.put("endpoint", SESSION_FOLLOW_ENDPOINT);
            open.put("payload", payload);
            sendText(open.toString());
            sessionStreamOpen = true;
            Log.i(TAG, "[b82n4] session/follow open session=" + shortId(sessionId));
        } catch (Throwable t) {
            Log.w(TAG, "[b82n4] session/follow open failed: " + t);
        }
    }

    /** 批次82-N4：取消一条逻辑流（连接保留）。 */
    private void sendCancel(String streamId) {
        if (socketOut == null) return;
        try {
            JSONObject cancel = new JSONObject();
            cancel.put("type", "cancel");
            cancel.put("streamId", streamId);
            sendText(cancel.toString());
        } catch (Throwable ignored) {}
    }

    private static String shortId(String id) {
        if (id == null) return "";
        int at = id.lastIndexOf('.');
        String tail = at >= 0 ? id.substring(at + 1) : id;
        return tail.length() > 8 ? tail.substring(tail.length() - 8) : tail;
    }

    // ==================== 上行 RPC ====================

    private JSONObject rpcResult(JSONObject args) throws Exception {
        URL url = new URL("http://127.0.0.1:" + enginePort + "/api/" + RESULT_ENDPOINT);
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(HTTP_TIMEOUT_MS);
            String cookie = prefs.getString(KEY_COOKIE, null);
            if (cookie != null && !cookie.isEmpty()) {
                connection.setRequestProperty("Cookie", cookie);
            }
            String rpcId = "overlay-mux-" + UUID.randomUUID().toString();
            JSONObject envelope = new JSONObject();
            envelope.put("type", "client-request");
            envelope.put("rpcId", rpcId);
            envelope.put("method", RESULT_ENDPOINT);
            JSONObject payload = new JSONObject();
            payload.put("args", args);
            envelope.put("payload", payload);
            byte[] body = envelope.toString().getBytes("UTF-8");
            OutputStream output = connection.getOutputStream();
            output.write(body);
            output.close();

            int status = connection.getResponseCode();
            if (status == 401) {
                throw new IOException("引擎鉴权失败（401：本地凭据已失效，请重启引擎）");
            }
            if (status < 200 || status >= 300) {
                throw new IOException("引擎 RPC 失败（HTTP " + status + "）");
            }
            String response = readBody(connection.getInputStream());
            JSONObject root = new JSONObject(response);
            JSONObject result = root.optJSONObject("result");
            if (result == null || !result.optBoolean("ok", false)) {
                JSONObject error = result == null ? null : result.optJSONObject("error");
                throw new IOException("RPC 失败: "
                        + (error == null ? "unknown" : error.optString("code", "unknown")));
            }
            return result.optJSONObject("value");
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String readBody(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = input.read(buffer)) > 0) {
            output.write(buffer, 0, read);
        }
        return new String(output.toByteArray(), "UTF-8");
    }

    // ==================== WebSocket 收发 ====================

    private void sendText(String text) throws IOException {
        OutputStream out = socketOut;
        if (out == null) {
            throw new IOException("连接尚未就绪");
        }
        byte[] payload = text.getBytes("UTF-8");
        synchronized (writeLock) {
            writeFrame(out, 0x1, payload);
        }
    }

    private void sendControl(int opcode, byte[] payload) {
        OutputStream out = socketOut;
        if (out == null) {
            return;
        }
        try {
            synchronized (writeLock) {
                writeFrame(out, opcode, payload == null ? new byte[0] : payload);
            }
        } catch (Throwable e) {
            Log.w(TAG, "控制帧发送失败: " + e.getClass().getSimpleName());
        }
    }

    private static void writeFrame(OutputStream out, int opcode, byte[] payload) throws IOException {
        int length = payload.length;
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        header.write(0x80 | (opcode & 0x0F));
        if (length < 126) {
            header.write(0x80 | length);
        } else if (length <= 0xFFFF) {
            header.write(0x80 | 126);
            header.write((length >>> 8) & 0xFF);
            header.write(length & 0xFF);
        } else {
            header.write(0x80 | 127);
            long longLength = length;
            for (int shift = 56; shift >= 0; shift -= 8) {
                header.write((int) ((longLength >>> shift) & 0xFF));
            }
        }
        byte[] mask = new byte[4];
        RANDOM.nextBytes(mask);
        header.write(mask);
        out.write(header.toByteArray());
        byte[] masked = new byte[length];
        for (int i = 0; i < length; i++) {
            masked[i] = (byte) (payload[i] ^ mask[i % 4]);
        }
        out.write(masked);
        out.flush();
    }

    private static Frame readFrame(InputStream in) throws IOException {
        int first = in.read();
        if (first < 0) {
            return null;
        }
        int second = in.read();
        if (second < 0) {
            return null;
        }
        int opcode = first & 0x0F;
        boolean masked = (second & 0x80) != 0;
        long length = second & 0x7F;
        if (length == 126L) {
            byte[] extended = readN(in, 2);
            length = ((long) (extended[0] & 0xFF) << 8) | (extended[1] & 0xFF);
        } else if (length == 127L) {
            byte[] extended = readN(in, 8);
            length = 0L;
            for (byte b : extended) {
                length = (length << 8) | (b & 0xFF);
            }
        }
        if (length < 0 || length > MAX_FRAME_BYTES) {
            throw new IOException("帧长度非法: " + length);
        }
        byte[] mask = masked ? readN(in, 4) : null;
        byte[] payload = readN(in, (int) length);
        if (mask != null) {
            for (int i = 0; i < payload.length; i++) {
                payload[i] = (byte) (payload[i] ^ mask[i % 4]);
            }
        }
        return new Frame(opcode, payload);
    }

    private static byte[] readN(InputStream in, int count) throws IOException {
        byte[] buffer = new byte[count];
        int offset = 0;
        while (offset < count) {
            int read = in.read(buffer, offset, count - offset);
            if (read < 0) {
                throw new EOFException("连接提前结束");
            }
            offset += read;
        }
        return buffer;
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        int previous = -1;
        while (true) {
            int current = in.read();
            if (current < 0) {
                return line.size() == 0 ? null : line.toString("UTF-8");
            }
            if (previous == '\r' && current == '\n') {
                byte[] bytes = line.toByteArray();
                return new String(bytes, 0, Math.max(0, bytes.length - 1), "UTF-8");
            }
            line.write(current);
            previous = current;
        }
    }

    private static String newWebSocketKey() {
        byte[] nonce = new byte[16];
        RANDOM.nextBytes(nonce);
        return Base64.encodeToString(nonce, Base64.NO_WRAP);
    }

    private static String websocketAccept(String key) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-1");
            digest.update((key + WS_GUID).getBytes("UTF-8"));
            return Base64.encodeToString(digest.digest(), Base64.NO_WRAP);
        } catch (Exception e) {
            throw new IOException("SHA-1 不可用");
        }
    }

    private static void closeQuietly(Socket target) {
        if (target == null) {
            return;
        }
        try {
            target.close();
        } catch (Throwable ignored) {
            // 忽略
        }
    }

    private boolean sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
            return true;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private static final class Frame {
        final int opcode;
        final byte[] payload;

        Frame(int opcode, byte[] payload) {
            this.opcode = opcode;
            this.payload = payload;
        }
    }
}
