package com.deepseek.harness;

import android.accessibilityservice.GestureDescription;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Display;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;

/**
 * 无障碍服务（v1.7.3）：给 AI 提供「看屏幕 + 操作屏幕」能力。
 * 与 node 插件 dsh-tool-accessibility 通过本地 HTTP（127.0.0.1:<a11yPort>）通信。
 * 端口 = 引擎端口 + 101（正式版 3181 / Lite 3183 / 兼容版 3185），三版本共存不冲突。
 * 注意：javac -bootclasspath android.jar 下不能用 lambda/方法引用，全部用显式匿名类。
 *
 * v1.7.3 新增「通用触摸手势引擎」（/gesture /touch /swipe /hold /touch-release /touch-status）：
 *  - 多笔时间轴：一次请求可含 down/move/up/tap/swipe/hold/wait，全部同时注入（真多指）；
 *  - 按住保持：down 后不 up 的手指会一直按住（willContinue），可跨请求延续——"左手按住摇杆，
 *    右手同时点技能"就是 down(0) 之后再来 tap(1)；
 *  - 分数坐标：所有坐标支持 fx/fy（0~1 相对屏幕比例），彻底消除截图缩放误差；
 *  - 安全网：手指按住超时（30s）自动抬起、同 finger 覆盖、release_all 一键复位、
 *    手势失败/服务断开全部复位。
 */
public class AccessibilityService extends android.accessibilityservice.AccessibilityService {

    private static final String TAG = "dsh-a11y";
    private static final String PREFS = "dsh_prefs";
    private static final String KEY_A11Y_PORT = "a11y_port";
    // 批次47（策略调整）：本服务**不再**做厂商助手（YOYO / 小艺 / 小爱 …）的识别、压灭与接管。
    // 用户已明确：不与 YOYO 绑定，产品只保留「助手浮层的保活与启动」；
    // 历史实现（批次43/45/46）见 git 历史与 docs/批次47-策略调整-去YOYO化与悬浮球聚焦.md（旧称，仅文档名保留）。

    /** 服务是否已连接（用户已在系统设置开启无障碍）。 */
    public static volatile boolean isRunning = false;
    /** 当前活跃窗口的包名。 */
    public static volatile String activePackage = "";

    /** 最近一次非 Harness 外部前台包；仅作活动窗口包名不可读时的兜底。 */
    private volatile String lastExternalPackage = "";
    private volatile ContextTarget lastReadableContextTarget;

    /** M1 /context 固定读取主屏，不在请求路径中自动切换虚拟屏。 */
    private static final int CONTEXT_DISPLAY_ID = 0;
    private static final String REASON_NO_ACCESSIBILITY_READABLE_WINDOW =
            "NO_ACCESSIBILITY_READABLE_WINDOW";

    private static final int MAX_NODES = 250;
    private static final int MAX_DEPTH = 40;
    private static final int MAX_TEXT_LEN = 120;
    private static final int SOCKET_TIMEOUT_MS = 8000;

    /** 批次6：最近一次无障碍事件到达时间戳（事件驱动点击验证用）。
     *  onAccessibilityEvent 只做一次赋值，开销可忽略；volatile 保证跨线程可见。 */
    private volatile long lastEventAtMs = 0L;

    /** 批次19v2：最近一次 TYPE_VIEW_CLICKED 时刻（performClick 同步发出）——「点击监听真的执行」的
     *  强证据。环境噪音（content-changed）不能证明点击生效：外部复测在高噪 WebView 界面实测 6/6 假成功。 */
    private volatile long lastViewClickAtMs = 0L;
    /** 批次19v2：最近一次窗口级事件（TYPE_WINDOW_STATE_CHANGED / TYPE_WINDOWS_CHANGED）时刻——
     *  点击打开新窗口/对话框的强证据（环境噪音不产生窗口事件）。 */
    private volatile long lastWindowEventAtMs = 0L;
    /** 批次19v2：事件计数（/status 透出，装机验证 typeViewClicked 声明是否生效用）。 */
    private volatile long viewClickEventCount = 0L;
    private volatile long windowEventCount = 0L;

    // ===================== 批次8b #55 ScreenState 缓存 =====================
    /** 条件请求快路径的缓存最大年龄：超过后即使非脏也强制全量刷新。
     *  防极少数事件类型漏报导致的过期屏幕——宁可命中率低，不可返回过期屏幕。 */
    private static final long SCREEN_CACHE_MAX_AGE_MS = 3000;
    /** ScreenState 版本决策/快路径判定的锁（只保护计数器读改写，控件树遍历不加锁）。 */
    private final Object screenStateLock = new Object();

    // 批次10d（#3181）：POST JSON body 顶层标量参数（本次请求）。每个连接在独立线程处理
    // （handleConnection 的 a11y-conn 线程），route() 入口 set、queryParam 优先读取——
    // 使 /tap /input 等 handler 对 POST 请求优先读 body 参数（与 3081 行为对齐），
    // GET 请求无 body、走 query，既有 GET 用法完全兼容。
    private final ThreadLocal<java.util.Map<String, String>> bodyParams = new ThreadLocal<>();
    // 批次14w3（T1 spike）：/sod 成功时的 PNG 二进制载荷（仅调试探针用）。handleConnection
    // 与 route() 在同一条 a11y-conn 线程执行，用 ThreadLocal 携带二进制（null=无二进制，
    // 走既有 JSON 写回路径）；route() 入口清空，keep-alive 复用连接时不串包。
    private final ThreadLocal<byte[]> binaryResp = new ThreadLocal<>();
    /** 屏幕状态版本号：只增不减。全量 dump 检测到变化（脏/哈希变/尺寸变/首次）时 +1。 */
    private long screenVersion = 0L;
    /** 上次全量 dump 完成时刻（快路径年龄判定用）。 */
    private long screenRefreshedAtMs = 0L;
    /** 事件驱动失效标记：收到窗口/内容/窗口列表/滚动/文本/选中事件时记录事件时刻（0=非脏）。
     *  volatile：主线程（onAccessibilityEvent）写、桥线程（dump 判定/消费）读。 */
    private volatile long screenDirtyAtMs = 0L;
    /** 上次全量 dump 的输出节点集合哈希（windowSignature 思路：cls|text|desc|vid|flags|bounds 滚动哈希）。 */
    private String lastScreenHash = "";
    /** 上次全量 dump 时的屏幕尺寸（旋转/分屏/折叠判定）。 */
    private int lastScreenW = 0;
    private int lastScreenH = 0;

    /** 手势引擎：最大手指数（多数设备 getMaxStrokeCount() ≥ 10）。 */
    private static final int MAX_FINGERS = 8;
    /** 手指按住保持超时（毫秒），超过自动抬起，防止 AI 失控后手指一直压着屏幕。 */
    private static final long HOLD_TIMEOUT_MS = 30000;
    /** 单次手势时间轴总长上限（毫秒）。 */
    private static final long MAX_GESTURE_TOTAL_MS = 120000;

    private final Object gestureLock = new Object();
    private final boolean[] fingerDown = new boolean[MAX_FINGERS];
    private final float[] fingerX = new float[MAX_FINGERS];
    private final float[] fingerY = new float[MAX_FINGERS];
    private final long[] fingerDownAt = new long[MAX_FINGERS];
    private int screenW = 0;
    private int screenH = 0;

    private ServerSocket serverSocket;

    private static class StrokeDesc {
        Path path;
        long startTime;
        long duration;
        boolean willContinue;
        StrokeDesc(Path p, long s, long d, boolean wc) {
            path = p;
            startTime = s;
            duration = d;
            willContinue = wc;
        }
    }

    /** 批次45：供悬浮窗「液态毛玻璃」背景捕获使用的服务实例（连接即登记，销毁即清空）。 */
    public static volatile AccessibilityService instance = null;


    public static String extractTextInSelectionRect(final Rect selectionRect) {
        final AccessibilityService svc = instance;
        if (svc == null || selectionRect == null || selectionRect.width() <= 0 || selectionRect.height() <= 0) {
            return "";
        }
        try {
            AccessibilityNodeInfo root = svc.getRootInActiveWindow();
            if (root == null) return "";
            final List<RectText> list = new ArrayList<RectText>();
            svc.walk(root, new NodeVisitor() {
                @Override
                public void visit(AccessibilityNodeInfo node, int depth) {
                    if (node == null) return;
                    try {
                        CharSequence textCs = node.getText();
                        CharSequence descCs = node.getContentDescription();
                        String text = textCs != null ? textCs.toString().trim() : "";
                        if (text.isEmpty() && descCs != null) text = descCs.toString().trim();
                        if (text.isEmpty()) return;

                        Rect bounds = new Rect();
                        node.getBoundsInScreen(bounds);
                        if (bounds.width() <= 0 || bounds.height() <= 0) return;

                        if (Rect.intersects(bounds, selectionRect)) {
                            int interW = Math.max(0, Math.min(bounds.right, selectionRect.right) - Math.max(bounds.left, selectionRect.left));
                            int interH = Math.max(0, Math.min(bounds.bottom, selectionRect.bottom) - Math.max(bounds.top, selectionRect.top));
                            int interArea = interW * interH;
                            int nodeArea = Math.max(1, bounds.width() * bounds.height());
                            if (interArea >= nodeArea * 0.30 || selectionRect.contains(bounds)) {
                                list.add(new RectText(bounds, text));
                            }
                        }
                    } catch (Throwable ignored) {}
                }
            }, 0);

            java.util.Collections.sort(list, new java.util.Comparator<RectText>() {
                @Override
                public int compare(RectText a, RectText b) {
                    if (Math.abs(a.bounds.top - b.bounds.top) > 24) {
                        return Integer.compare(a.bounds.top, b.bounds.top);
                    }
                    return Integer.compare(a.bounds.left, b.bounds.left);
                }
            });

            StringBuilder sb = new StringBuilder();
            String prev = "";
            for (RectText rt : list) {
                if (rt.text.equals(prev)) continue;
                if (sb.length() > 0) sb.append((char) 10);
                sb.append(rt.text);
                prev = rt.text;
            }
            return sb.toString().trim();
        } catch (Throwable t) {
            Log.w(TAG, "extractTextInSelectionRect failed: " + t);
            return "";
        }
    }

    private static class RectText {
        final Rect bounds;
        final String text;
        RectText(Rect b, String t) { this.bounds = b; this.text = t; }
    }

    public static boolean isConnected() {
        return instance != null;
    }

    /** 批次45：免弹窗无障碍截图（Android 11+）；未连接或版本不足返回 false，由调用方降级。 */
    public static boolean captureScreen(Executor executor, TakeScreenshotCallback callback) {
        AccessibilityService svc = instance;
        if (svc == null || Build.VERSION.SDK_INT < 30) return false;
        try {
            svc.takeScreenshot(Display.DEFAULT_DISPLAY, executor, callback);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    @Override
    public void onServiceConnected() {
        instance = this;
        isRunning = true;
        Log.i(TAG, "accessibility service connected");
        // 端口：MainActivity 启动时写入 dsh_prefs（a11y_port）；读不到时按包名推导默认引擎端口 + 101
        int port = 3181;
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            String pkg = getPackageName();
            int defaultEngine = pkg.contains("beta") ? 3082 : pkg.contains("compat") ? 3084 : 3080;
            port = prefs.getInt(KEY_A11Y_PORT, defaultEngine + 101);
        } catch (Throwable t) {
            Log.w(TAG, "read a11y port failed", t);
        }
        startServer(port);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        lastEventAtMs = System.currentTimeMillis();
        if (event != null) {
            if (event.getPackageName() != null) {
                String pkg = event.getPackageName().toString();
                activePackage = pkg;
            }
            // 批次8b #55：事件驱动失效——窗口/内容/窗口列表/滚动/文本/选中变化一律打脏标记。
            // 打脏集取保守超集（宁多勿漏）；防抖为隐式实现：标记幂等，150ms 内的突发事件
            // 只记最后一次时刻，由下一次 /dump 惰性消费，不逐事件刷新。
            int et = event.getEventType();
            // 批次19v2：分类采样强证据——VIEW_CLICKED（点击监听真的执行）与窗口级事件
            //（新窗口/对话框）是 ACTION_CLICK 生效的抗噪证据，环境噪音不含这两类（见 handleTap）。
            if (et == AccessibilityEvent.TYPE_VIEW_CLICKED) {
                lastViewClickAtMs = lastEventAtMs;
                viewClickEventCount++;
            }
            if (et == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || et == AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
                lastWindowEventAtMs = lastEventAtMs;
                windowEventCount++;
                rememberCurrentExternalTarget();
            }
            if (et == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                    || et == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                    || et == AccessibilityEvent.TYPE_WINDOWS_CHANGED
                    || et == AccessibilityEvent.TYPE_VIEW_SCROLLED
                    || et == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED
                    || et == AccessibilityEvent.TYPE_VIEW_SELECTED) {
                screenDirtyAtMs = lastEventAtMs;
            }
        }
    }


    @Override
    public void onInterrupt() {
        Log.w(TAG, "accessibility service interrupted");
        releaseAllFingers();
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        isRunning = false;
        activePackage = "";
        lastExternalPackage = "";
        lastReadableContextTarget = null;
        releaseAllFingers();
        stopServer();
        return super.onUnbind(intent);
    }

    private void stopServer() {
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (Throwable ignored) {
        }
        serverSocket = null;
    }

    private void startServer(final int port) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                ServerSocket ss = null;
                try {
                    ss = new ServerSocket();
                    ss.setReuseAddress(true);
                    ss.bind(new InetSocketAddress("127.0.0.1", port));
                    serverSocket = ss;
                    Log.i(TAG, "a11y server listening on " + port);
                    while (!Thread.currentThread().isInterrupted()) {
                        try {
                            final Socket s = ss.accept();
                            handleConnection(s);
                        } catch (Throwable t) {
                            try { Thread.sleep(100); } catch (Throwable ignored) {}
                        }
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "a11y server stopped", t);
                } finally {
                    try { if (ss != null) ss.close(); } catch (Throwable ignored) {}
                }
            }
        }, "a11y-server").start();
    }

    private String parsePath(String head) {
        int sp1 = head.indexOf(' ');
        int sp2 = sp1 >= 0 ? head.indexOf(' ', sp1 + 1) : -1;
        if (sp1 >= 0 && sp2 > sp1) return head.substring(sp1 + 1, sp2);
        return "/";
    }

    private String queryParam(String path, String key) {
        // 批次10d（#3181）：POST 请求优先读 JSON body 参数（route() 入口已解析到 bodyParams）；
        // GET / 无 body 时 bodyParams 为空 map，回落到 query —— 既有 GET 用法完全兼容。
        java.util.Map<String, String> bp = bodyParams.get();
        if (bp != null && bp.containsKey(key)) {
            String v = bp.get(key);
            return v == null ? "" : v;
        }
        int q = path.indexOf('?');
        if (q < 0) return "";
        String query = path.substring(q + 1);
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                String k = pair.substring(0, eq);
                if (k.equals(key)) {
                    try {
                        return java.net.URLDecoder.decode(pair.substring(eq + 1), "UTF-8");
                    } catch (Exception ignored) {
                        return pair.substring(eq + 1);
                    }
                }
            }
        }
        return "";
    }

    /** 批次10d（#3181）：解析 POST JSON body 顶层标量参数（string/number/boolean → 字符串）。
     *  实测：POST 3181 /tap body {"text":"..."} 报「tap 需要 text/desc 或 x/y」——原先
     *  handler 只用 queryParam 读 query，body 参数被整体忽略（3081 侧是 query 被剥、body 生效）。
     *  body 为空 / 非 JSON 对象（如 /gesture 的数组）返回空 map，不影响既有路径；嵌套结构不展开。 */
    private java.util.HashMap<String, String> parseBodyParams(String body) {
        java.util.HashMap<String, String> out = new java.util.HashMap<>();
        try {
            if (body == null) return out;
            String t = body.trim();
            if (t.isEmpty() || t.charAt(0) != '{') return out;
            JSONObject o = new JSONObject(t);
            java.util.Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                Object v = o.opt(k);
                if (v instanceof String) out.put(k, (String) v);
                else if (v instanceof Number || v instanceof Boolean) out.put(k, String.valueOf(v));
            }
        } catch (Throwable ignored) {
        }
        return out;
    }

    private double parseDoubleSafe(String s, double def) {
        try {
            return Double.parseDouble(s);
        } catch (Throwable t) {
            return def;
        }
    }

    /** 处理一条连接（批次 7 keep-alive：同一连接上循环读请求，直到客户端要求关闭
     *  或空闲超时（SoTimeout 8s）抛 SocketTimeoutException 退出。响应头按请求
     *  Connection 头回写 keep-alive/close，插件侧共享 keepAlive Agent 才能真正复用连接）。 */
    private void handleConnection(final Socket s) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    s.setSoTimeout(SOCKET_TIMEOUT_MS);
                    InputStream in = s.getInputStream();
                    while (true) {
                        StringBuilder head = new StringBuilder();
                        int c;
                        while ((c = in.read()) != -1) {
                            head.append((char) c);
                            if (head.length() >= 4 && head.substring(head.length() - 4).equals("\r\n\r\n")) break;
                            if (head.length() > 8192) break;
                        }
                        if (head.length() == 0) break; // 客户端关闭连接
                        String headStr = head.toString();
                        String path = parsePath(headStr);
                        // v1.8.4 安全加固：校验 X-DSH-Token（MainActivity 注入 env APP_LOCAL_TOKEN，
                        // 插件回传）。Android 所有应用共享 loopback，无鉴权时第三方应用可直连本端口
                        // 调 /tap /input /screenshot —— 等于免无障碍权限的屏幕操控接口。
                        // 批次 20 fail-closed：token 不可用（TokenStore 存储异常返回空串）时拒绝服务，
                        // 不再跳过校验——旧行为 token 为空即放行。本侧 token 此前只读不生成（与
                        // MainActivity 分叉），现统一走 TokenStore.getOrCreate，正常路径必产出非空
                        // token，本分支仅存储异常可达。比较走 TokenStore.constantTimeHeaderEquals
                        // （MessageDigest.isEqual，防时序侧信道）。引擎运行中 token 被清空重生成时，
                        // 插件 env 里的旧 token 会 401 直到引擎重启（既有代价），不做自动重启。
                        String expectToken = localToken();
                        boolean authorized;
                        if (expectToken.isEmpty()) {
                            Log.w(TAG, "local token unavailable — rejecting bridge request (fail-closed)");
                            authorized = false;
                        } else {
                            authorized = TokenStore.constantTimeHeaderEquals(headStr, "x-dsh-token", expectToken);
                        }
                        if (!authorized) {
                            Log.w(TAG, "a11y auth reject: " + path + " from " + s.getRemoteSocketAddress());
                            String rb = "{\"ok\":false,\"error\":\"unauthorized\"}";
                            BufferedWriter w = new BufferedWriter(new OutputStreamWriter(s.getOutputStream(), "UTF-8"));
                            w.write("HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: "
                                    + rb.getBytes("UTF-8").length + "\r\nConnection: close\r\n\r\n" + rb);
                            w.flush();
                            break;
                        }
                        // 读取 POST body（/gesture 传 JSON）
                        String body = "";
                        int ci = headStr.toLowerCase().indexOf("content-length:");
                        if (ci >= 0) {
                            int eol = headStr.indexOf("\r\n", ci);
                            if (eol > ci) {
                                String v = headStr.substring(ci + 15, eol).trim();
                                try {
                                    int len = Integer.parseInt(v);
                                    if (len > 0 && len < 262144) {
                                        byte[] buf = new byte[len];
                                        int off = 0;
                                        while (off < len) {
                                            int n = in.read(buf, off, len - off);
                                            if (n < 0) break;
                                            off += n;
                                        }
                                        body = new String(buf, 0, off, "UTF-8");
                                    }
                                } catch (Throwable ignored) {
                                }
                            }
                        }
                        String respBody;
                        // 批次14w3（T1 spike）：/sod 成功时 handleSod 经 binaryResp 携带 PNG 字节，
                        // 同线程 route() 返回后取走；其余路由恒为 null，走既有 JSON 写回。
                        byte[] respBin = null;
                        try {
                            respBody = route(path, body);
                            respBin = binaryResp.get();
                        } catch (Throwable t) {
                            respBody = jsonError("内部错误: " + t.getMessage());
                        }
                        binaryResp.remove(); // 无论哪条路径都清掉，keep-alive 下不影响下一请求
                        boolean clientClose = headStr.contains("HTTP/1.0")
                                || headerValueEquals(headStr, "connection", "close");
                        if (respBin != null) {
                            // 批次14w3（T1 spike）：二进制响应（仅 /sod 成功路径）。响应头先经
                            // 字符流写出并 flush，PNG 字节再走原始流——避免字符流编码破坏二进制。
                            BufferedWriter w = new BufferedWriter(new OutputStreamWriter(s.getOutputStream(), "UTF-8"));
                            w.write("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: "
                                    + respBin.length + "\r\nConnection: "
                                    + (clientClose ? "close" : "keep-alive") + "\r\n\r\n");
                            w.flush();
                            s.getOutputStream().write(respBin);
                            s.getOutputStream().flush();
                        } else {
                            BufferedWriter w = new BufferedWriter(new OutputStreamWriter(s.getOutputStream(), "UTF-8"));
                            w.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
                                    + respBody.getBytes("UTF-8").length + "\r\nConnection: "
                                    + (clientClose ? "close" : "keep-alive") + "\r\n\r\n" + respBody);
                            w.flush();
                        }
                        if (clientClose) break;
                    }
                    s.close();
                } catch (Throwable t) {
                    // 空闲超时（keep-alive 连接上无后续请求）或客户端断开：正常关闭
                    Log.w(TAG, "a11y connection error", t);
                    try { s.close(); } catch (Throwable ignored) {}
                }
            }
        }, "a11y-conn").start();
    }

    /** 本地桥接鉴权 token（批次 20）：统一走 TokenStore（3081/3181 共用唯一来源）。
     *  此前本侧只读不生成（须 MainActivity 先启动写入），与 MainActivity 实现已分叉；
     *  现任何一方先启动都能落盘同一 token。token 不可用（存储异常返回空串）时
     *  handleConnection fail-closed 拒绝服务，不再跳过校验（旧行为=放行）。 */
    private String localToken() {
        return TokenStore.getOrCreate(this);
    }

    /** 从 HTTP 请求头文本中取指定头（不区分大小写）并与期望值精确比较。 */
    private static boolean headerValueEquals(String head, String lowerName, String expect) {
        int i = head.toLowerCase().indexOf(lowerName + ":");
        if (i < 0) return false;
        int lineEnd = head.indexOf('\n', i);
        if (lineEnd < 0) lineEnd = head.length();
        String v = head.substring(i + lowerName.length() + 1, lineEnd).trim();
        return v.equals(expect);
    }

    private String jsonError(String msg) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("error", msg == null ? "未知错误" : msg);
            return o.toString();
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"json error\"}";
        }
    }

    private String route(String path, String body) throws Exception {
        // 批次10d（#3181）：每次请求先把 POST body 顶层标量参数解析到 bodyParams（本线程），
        // queryParam 优先读 body；GET 无 body → 空 map → 读 query。/gesture 仍直接拿原始 body。
        bodyParams.set(parseBodyParams(body));
        // 批次14w3（T1 spike）：每个请求先清二进制载荷（/sod 成功时 handleSod 再 set），
        // keep-alive 复用连接时上一个请求的 PNG 不会串到下一个请求。
        binaryResp.set(null);
        String base = path;
        int q = path.indexOf('?');
        if (q >= 0) base = path.substring(0, q);

        if (base.equals("/status")) return handleStatus();
        if (base.equals("/context")) return handleContext();
        if (base.equals("/dump")) return handleDump(path);
        if (base.equals("/tap")) return handleTap(path);
        if (base.equals("/input")) return handleInput(path);
        if (base.equals("/back")) return handleGlobalAction(GLOBAL_ACTION_BACK);
        if (base.equals("/home")) return handleGlobalAction(GLOBAL_ACTION_HOME);
        if (base.equals("/scroll")) return handleScroll(path);
        if (base.equals("/screenshot")) return handleScreenshot(path);
        // 批次74：/display-info —— 返回指定 display 的真实像素尺寸（默认主屏）。
        // 虚拟屏模式下的 fx/fy 换算必须用目标屏尺寸（主屏 1256x2808 vs 虚拟屏 1008x1792），
        // 否则同一组 fx/fy 会被按主屏放大，纵向点偏约 1.57 倍（批次74 真机缺陷）。
        if (base.equals("/display-info")) return handleDisplayInfo(path);
        // 批次14w3（T1 spike）：takeScreenshotOfDisplay 探针（调试用，非契约接口，随时可删）
        if (base.equals("/sod")) return handleSod(path);
        // 批次14tow（spike）：窗口枚举 + 按窗口截图调试探针（非契约接口，随时可删）。
        // /wins 枚举窗口拿 windowId（?all=1 跨所有 display 枚举），/sw 对指定 windowId 截图。
        if (base.equals("/wins")) return handleWins(path);
        if (base.equals("/sw")) return handleSw(path);
        if (base.equals("/swipe")) return handleSwipe(path);
        if (base.equals("/hold")) return handleHold(path);
        if (base.equals("/touch")) return handleTouch(path);
        if (base.equals("/touch-release")) return handleTouchRelease();
        if (base.equals("/touch-status")) return handleTouchStatus();
        if (base.equals("/gesture")) return handleGesture(body);
        return jsonError("未知路由: " + base);
    }

    // ===================== 屏幕尺寸 / 坐标 =====================

    /** 当前真实屏幕尺寸（物理像素，与无障碍截图同一坐标系）。 */
    private int[] screenSize() {
        try {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            DisplayMetrics dm = new DisplayMetrics();
            wm.getDefaultDisplay().getRealMetrics(dm);
            return new int[]{dm.widthPixels, dm.heightPixels};
        } catch (Throwable t) {
            try {
                DisplayMetrics dm = getResources().getDisplayMetrics();
                return new int[]{dm.widthPixels, dm.heightPixels};
            } catch (Throwable t2) {
                return new int[]{0, 0};
            }
        }
    }

    /** JSON 坐标解析：fx/fy（0~1 分数）优先，x/y（像素）兜底。 */
    private int resolveInt(JSONObject op, String fracKey, String pxKey, int screenLen, int def) {
        try {
            if (op.has(fracKey)) {
                double f = op.optDouble(fracKey, -1);
                if (f >= 0 && f <= 1) return (int) Math.round(f * screenLen);
            }
            if (op.has(pxKey)) return op.optInt(pxKey, -1);
        } catch (Throwable ignored) {
        }
        return def;
    }

    /** GET 查询参数坐标解析：fx/fy 优先，x/y 兜底。 */
    private int coordFromParams(String path, String pxKey, String fKey, int screenLen) {
        String p = queryParam(path, pxKey);
        String f = queryParam(path, fKey);
        if (!f.isEmpty()) {
            double d = parseDoubleSafe(f, -1);
            if (d >= 0 && d <= 1) return (int) Math.round(d * screenLen);
        }
        if (!p.isEmpty()) return (int) parseDoubleSafe(p, -1);
        return -1;
    }

    // ===================== 通用触摸手势引擎 =====================

    /** 批次49：急停总线。供悬浮窗巡航急停调用，强制抬起所有按住中的模拟手指。 */
    public static void forceReleaseFingers() {
        AccessibilityService svc = instance;
        if (svc != null) {
            try {
                svc.releaseAllFingers();
            } catch (Throwable t) {
                Log.w(TAG, "forceReleaseFingers failed", t);
            }
        }
    }

    /** 抬起全部按住中的手指（加锁入口，供服务生命周期调用）。 */
    void releaseAllFingers() {
        synchronized (gestureLock) {
            releaseAllFingersUnlocked();
        }
    }

    /** 抬起全部按住中的手指（调用方必须已持有 gestureLock）。 */
    private void releaseAllFingersUnlocked() {
        boolean any = false;
        for (int f = 0; f < MAX_FINGERS; f++) {
            if (fingerDown[f]) {
                any = true;
                fingerDown[f] = false;
            }
        }
        if (!any) return;
        try {
            GestureDescription.Builder gb = new GestureDescription.Builder();
            for (int f = 0; f < MAX_FINGERS; f++) {
                if (fingerX[f] >= 0 && fingerY[f] >= 0) {
                    // 注意：上面已把 fingerDown 全部置 false，这里用坐标数组判断即可
                    Path p = new Path();
                    p.moveTo(fingerX[f], fingerY[f]);
                    gb.addStroke(new GestureDescription.StrokeDescription(p, 0, 80, false));
                }
            }
            dispatchGesture(gb.build(), null, null);
        } catch (Throwable t) {
            Log.w(TAG, "release all failed", t);
        }
    }

    /**
     * 执行一组手势笔（时间轴编排，全部同时注入）。op 结构：
     *   { "kind": "down"|"move"|"up"|"tap"|"swipe"|"hold"|"wait",
     *     "finger": 0..7,
     *     "x"/"y" 或 "fx"/"fy"（0~1 分数）,
     *     "x2"/"y2" 或 "fx2"/"fy2"（swipe 终点）,
     *     "durationMs": 笔时长（wait=等待毫秒；tap 默认 60；swipe 默认 300；
     *                    hold 默认 500；move 默认 100；up 默认 100） }
     * down 后未 up 的手指保持按住，可跨请求延续；下次请求自动带上延续笔。
     */
    private String executeGesture(JSONArray ops) {
        synchronized (gestureLock) {
            try {
                int[] size = screenSize();
                if (size[0] <= 0 || size[1] <= 0) return jsonError("无法获取屏幕尺寸");
                // 屏幕尺寸变化（旋转/分辨率切换）→ 旧手指坐标失效，全部复位
                if (screenW != 0 && (size[0] != screenW || size[1] != screenH)) {
                    releaseAllFingersUnlocked();
                }
                screenW = size[0];
                screenH = size[1];

                int n = ops == null ? 0 : ops.length();
                if (n == 0) return jsonError("手势列表为空");

                // ===== 第一遍：解析 + 校验 + 时间轴（此时不修改任何真实状态）=====
                // 虚拟手指状态：模拟本请求内 down/move/up 的演化，用于校验（真实状态不动）
                boolean[] virtualDown = new boolean[MAX_FINGERS];
                System.arraycopy(fingerDown, 0, virtualDown, 0, MAX_FINGERS);
                long now = System.currentTimeMillis();
                boolean[] expired = new boolean[MAX_FINGERS];
                for (int f = 0; f < MAX_FINGERS; f++) {
                    if (fingerDown[f] && now - fingerDownAt[f] > HOLD_TIMEOUT_MS) expired[f] = true;
                }
                String[] kinds = new String[n];
                int[] fings = new int[n];
                int[] xs = new int[n];
                int[] ys = new int[n];
                int[] x2s = new int[n];
                int[] y2s = new int[n];
                long[] starts = new long[n];
                long[] ends = new long[n];
                // 真实按住且被本请求接管的手指 → 其首个 op 开始时刻（补「保持到 op 开始」的延续笔）
                long[] firstOpStart = new long[MAX_FINGERS];
                for (int f = 0; f < MAX_FINGERS; f++) firstOpStart[f] = -1;
                long t = 0;
                for (int i = 0; i < n; i++) {
                    JSONObject op = ops.getJSONObject(i);
                    String kind = op.optString("kind", "");
                    int finger = op.has("finger") ? op.optInt("finger", -1) : -1;
                    int x = resolveInt(op, "fx", "x", screenW, -1);
                    int y = resolveInt(op, "fy", "y", screenH, -1);
                    int x2 = resolveInt(op, "fx2", "x2", screenW, -1);
                    int y2 = resolveInt(op, "fy2", "y2", screenH, -1);
                    long dur = op.optLong("durationMs", -1);
                    long seg;
                    boolean held = finger >= 0 && finger < MAX_FINGERS && virtualDown[finger];
                    if ("wait".equals(kind)) {
                        seg = Math.max(0, op.optLong("ms", 0));
                    } else if ("down".equals(kind)) {
                        seg = 40;
                        if (finger < 0 || finger >= MAX_FINGERS) return jsonError("down 的 finger 越界（0~7）");
                        if (x < 0 || y < 0) return jsonError("down 需要 x/y 或 fx/fy");
                        if (expired[finger]) return jsonError("down 的手指 " + finger + " 已超时自动抬起，请重新 down");
                        if (held && firstOpStart[finger] < 0) firstOpStart[finger] = t;
                        virtualDown[finger] = true;
                    } else if ("move".equals(kind)) {
                        seg = dur >= 0 ? dur : 100;
                        if (finger < 0 || finger >= MAX_FINGERS) return jsonError("move 的 finger 越界（0~7）");
                        if (!held) return jsonError("move 的手指 " + finger + " 未按住（先 down）");
                        if (expired[finger]) return jsonError("move 的手指 " + finger + " 已超时自动抬起，请重新 down");
                        if (x < 0 || y < 0) return jsonError("move 需要 x/y 或 fx/fy");
                        if (firstOpStart[finger] < 0) firstOpStart[finger] = t;
                    } else if ("up".equals(kind)) {
                        seg = dur >= 0 ? dur : 100;
                        if (finger < 0 || finger >= MAX_FINGERS) return jsonError("up 的 finger 越界（0~7）");
                        if (!held) return jsonError("up 的手指 " + finger + " 未按住（先 down）");
                        if (expired[finger]) return jsonError("up 的手指 " + finger + " 已超时自动抬起，请重新 down");
                        if (firstOpStart[finger] < 0) firstOpStart[finger] = t;
                        virtualDown[finger] = false;
                    } else if ("tap".equals(kind)) {
                        OverlayService.showTapHighlight((int) x, (int) y);
                        seg = dur >= 0 ? dur : 60;
                        if (x < 0 || y < 0) return jsonError("tap 需要 x/y 或 fx/fy");
                        if (held) {
                            if (expired[finger]) return jsonError("tap 的手指 " + finger + " 已超时自动抬起，请重新 down");
                            if (firstOpStart[finger] < 0) firstOpStart[finger] = t;
                            virtualDown[finger] = false;
                        }
                    } else if ("swipe".equals(kind)) {
                        seg = dur >= 0 ? dur : 300;
                        if (x < 0 || y < 0 || x2 < 0 || y2 < 0) {
                            return jsonError("swipe 需要起点(x/y 或 fx/fy)和终点(x2/y2 或 fx2/fy2)");
                        }
                        if (held) {
                            if (expired[finger]) return jsonError("swipe 的手指 " + finger + " 已超时自动抬起，请重新 down");
                            if (firstOpStart[finger] < 0) firstOpStart[finger] = t;
                            virtualDown[finger] = false;
                        }
                    } else if ("hold".equals(kind)) {
                        seg = dur >= 0 ? dur : 500;
                        if (x < 0 || y < 0) return jsonError("hold 需要 x/y 或 fx/fy");
                        if (held) {
                            if (expired[finger]) return jsonError("hold 的手指 " + finger + " 已超时自动抬起，请重新 down");
                            if (firstOpStart[finger] < 0) firstOpStart[finger] = t;
                            virtualDown[finger] = false;
                        }
                    } else {
                        return jsonError("未知手势 kind: " + kind);
                    }
                    kinds[i] = kind;
                    fings[i] = finger;
                    xs[i] = x;
                    ys[i] = y;
                    x2s[i] = x2;
                    y2s[i] = y2;
                    starts[i] = t;
                    ends[i] = t + seg;
                    t += seg;
                }
                long totalT = t;
                if (totalT <= 0) return jsonError("手势时间轴为空");
                if (totalT > MAX_GESTURE_TOTAL_MS) {
                    return jsonError("手势总时长超限（>" + (MAX_GESTURE_TOTAL_MS / 1000) + "s）；长按请用 down 保持，不要用长 wait");
                }

                // ===== 第二遍准备：生成笔（所有校验已通过，不会中途返回）=====
                GestureDescription.Builder gb = new GestureDescription.Builder();
                List<StrokeDesc> strokes = new ArrayList<StrokeDesc>();

                // 保持中的手指：
                //  - 未接管 → 全程延续笔（保持到手势结束）
                //  - 被接管 → 保持到其首个 op 开始（op 笔接同一指针，避免等待期被系统误抬起）
                //  - 已过期 → 原地抬起笔
                for (int f = 0; f < MAX_FINGERS; f++) {
                    if (!fingerDown[f]) continue;
                    if (expired[f]) {
                        Path p = new Path();
                        p.moveTo(fingerX[f], fingerY[f]);
                        strokes.add(new StrokeDesc(p, 0, 80, false));
                    } else if (firstOpStart[f] < 0) {
                        Path p = new Path();
                        p.moveTo(fingerX[f], fingerY[f]);
                        strokes.add(new StrokeDesc(p, 0, totalT, true));
                    } else if (firstOpStart[f] > 0) {
                        Path p = new Path();
                        p.moveTo(fingerX[f], fingerY[f]);
                        strokes.add(new StrokeDesc(p, 0, firstOpStart[f], true));
                    }
                    // firstOpStart==0：op 笔从 0 开始，无需保持笔
                }

                // 第二遍：逐 op 生成笔（cur 为手指当前坐标；所有校验已通过，不会中途返回）
                float[] curX = new float[MAX_FINGERS];
                float[] curY = new float[MAX_FINGERS];
                System.arraycopy(fingerX, 0, curX, 0, MAX_FINGERS);
                System.arraycopy(fingerY, 0, curY, 0, MAX_FINGERS);

                for (int i = 0; i < n; i++) {
                    String kind = kinds[i];
                    int finger = fings[i];
                    int x = xs[i];
                    int y = ys[i];
                    int x2 = x2s[i];
                    int y2 = y2s[i];
                    long start = starts[i];
                    long end = ends[i];
                    long seg = end - start;
                    boolean held = finger >= 0 && finger < MAX_FINGERS && fingerDown[finger];

                    if ("wait".equals(kind)) {
                        // 无笔，仅占时间轴
                    } else if ("down".equals(kind)) {
                        if (held) {
                            // 已按住 → 视为滑到新位置并继续保持
                            Path path = new Path();
                            path.moveTo(curX[finger], curY[finger]);
                            path.lineTo(x, y);
                            strokes.add(new StrokeDesc(path, start, seg, true));
                        } else {
                            Path path = new Path();
                            path.moveTo(x, y);
                            strokes.add(new StrokeDesc(path, start, totalT - start, true));
                            fingerDownAt[finger] = now;
                        }
                        fingerDown[finger] = true;
                        fingerX[finger] = x;
                        fingerY[finger] = y;
                        curX[finger] = x;
                        curY[finger] = y;
                    } else if ("move".equals(kind)) {
                        Path path = new Path();
                        path.moveTo(curX[finger], curY[finger]);
                        path.lineTo(x, y);
                        strokes.add(new StrokeDesc(path, start, seg, true));
                        fingerX[finger] = x;
                        fingerY[finger] = y;
                        curX[finger] = x;
                        curY[finger] = y;
                    } else if ("up".equals(kind)) {
                        Path path = new Path();
                        path.moveTo(curX[finger], curY[finger]);
                        if (x >= 0 && y >= 0) {
                            path.lineTo(x, y); // 先滑到目标位置再抬起
                            fingerX[finger] = x;
                            fingerY[finger] = y;
                        }
                        strokes.add(new StrokeDesc(path, start, seg, false));
                        fingerDown[finger] = false;
                    } else if ("tap".equals(kind)) {
                        OverlayService.showTapHighlight((int) x, (int) y);
                        if (held) {
                            // 已按住的手指 tap → 滑到目标并抬起
                            Path path = new Path();
                            path.moveTo(curX[finger], curY[finger]);
                            path.lineTo(x, y);
                            strokes.add(new StrokeDesc(path, start, seg, false));
                            fingerDown[finger] = false;
                            fingerX[finger] = x;
                            fingerY[finger] = y;
                        } else {
                            // 新手指点按（按下即抬起）
                            Path path = new Path();
                            path.moveTo(x, y);
                            strokes.add(new StrokeDesc(path, start, seg, false));
                        }
                    } else if ("swipe".equals(kind)) {
                        if (held) {
                            // 已按住的手指 swipe → 从当前位置滑到终点并抬起
                            Path path = new Path();
                            path.moveTo(curX[finger], curY[finger]);
                            path.lineTo(x2, y2);
                            strokes.add(new StrokeDesc(path, start, seg, false));
                            fingerDown[finger] = false;
                            fingerX[finger] = x2;
                            fingerY[finger] = y2;
                        } else {
                            Path path = new Path();
                            path.moveTo(x, y);
                            path.lineTo(x2, y2);
                            strokes.add(new StrokeDesc(path, start, seg, false));
                        }
                    } else if ("hold".equals(kind)) {
                        if (held) {
                            // 已按住的手指 hold → 滑到目标位置按住到结束再抬起
                            Path path = new Path();
                            path.moveTo(curX[finger], curY[finger]);
                            path.lineTo(x, y);
                            strokes.add(new StrokeDesc(path, start, seg, false));
                            fingerDown[finger] = false;
                            fingerX[finger] = x;
                            fingerY[finger] = y;
                        } else {
                            // 新手指：按下 → 保持 duration → 抬起
                            Path path = new Path();
                            path.moveTo(x, y);
                            strokes.add(new StrokeDesc(path, start, seg, false));
                        }
                    }
                }

                if (strokes.isEmpty()) return jsonError("手势没有可执行的笔");
                // 注：getMaxStrokeCount() 是 @hide API，public android.jar 没有；固定 8 指远低于设备上限（通常 ≥10）
                if (strokes.size() > MAX_FINGERS + 2) {
                    releaseAllFingersUnlocked();
                    return jsonError("笔画数超限（单次最多 " + (MAX_FINGERS + 2) + " 笔）");
                }
                for (StrokeDesc sd : strokes) {
                    gb.addStroke(new GestureDescription.StrokeDescription(sd.path, sd.startTime, sd.duration, sd.willContinue));
                }
                final GestureDescription gesture = gb.build();

                final CountDownLatch latch = new CountDownLatch(1);
                final boolean[] success = {false};
                dispatchGesture(gesture, new GestureResultCallback() {
                    @Override
                    public void onCompleted(GestureDescription g) {
                        success[0] = true;
                        latch.countDown();
                    }

                    @Override
                    public void onCancelled(GestureDescription g) {
                        latch.countDown();
                    }
                }, null);
                boolean done = latch.await(totalT + 5000, TimeUnit.MILLISECONDS);
                if (!done) {
                    releaseAllFingersUnlocked();
                    return jsonError("手势执行超时，已复位所有手指");
                }
                if (!success[0]) {
                    releaseAllFingersUnlocked();
                    return jsonError("手势被系统取消（可能被新手势或手动触摸打断），已复位所有手指");
                }

                // 返回当前按住的手指
                JSONArray held = new JSONArray();
                for (int f = 0; f < MAX_FINGERS; f++) {
                    if (fingerDown[f]) {
                        JSONObject h = new JSONObject();
                        h.put("finger", f);
                        h.put("x", (int) fingerX[f]);
                        h.put("y", (int) fingerY[f]);
                        h.put("fx", fingerX[f] / screenW);
                        h.put("fy", fingerY[f] / screenH);
                        held.put(h);
                    }
                }
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("durationMs", totalT);
                o.put("held", held);
                return o.toString();
            } catch (Throwable t) {
                releaseAllFingersUnlocked();
                return jsonError("gesture error: " + t.getMessage());
            }
        }
    }

    /** /gesture：POST JSON 数组（或 {"strokes": [...]}），执行一组手势笔。 */
    private String handleGesture(String body) {
        try {
            if (body == null || body.trim().isEmpty()) return jsonError("gesture 需要 POST JSON body");
            String s = body.trim();
            JSONArray ops;
            if (s.startsWith("[")) {
                ops = new JSONArray(s);
            } else {
                JSONObject o = new JSONObject(s);
                ops = o.optJSONArray("strokes");
                if (ops == null) return jsonError("gesture body 需要是数组或 {\"strokes\":[...]}");
            }
            return executeGesture(ops);
        } catch (Throwable t) {
            return jsonError("gesture 参数解析失败: " + t.getMessage());
        }
    }

    /** /touch：action=down|move|up|release&finger=N&x/y 或 fx/fy（状态式单指操作）。 */
    private String handleTouch(String path) {
        try {
            String action = queryParam(path, "action");
            String fStr = queryParam(path, "finger");
            if (action.isEmpty()) return jsonError("touch 需要 action=down|move|up|release");
            if (fStr.isEmpty()) return jsonError("touch 需要 finger=0~7");
            int finger = (int) parseDoubleSafe(fStr, -1);
            if (finger < 0 || finger >= MAX_FINGERS) return jsonError("finger 越界（0~7）");
            JSONObject op = new JSONObject();
            op.put("kind", "release".equals(action) ? "up" : action);
            op.put("finger", finger);
            if (!"up".equals(action) && !"release".equals(action)) {
                int x = coordFromParams(path, "x", "fx", screenW == 0 ? screenSize()[0] : screenW);
                int y = coordFromParams(path, "y", "fy", screenH == 0 ? screenSize()[1] : screenH);
                if (x < 0 || y < 0) return jsonError("touch 需要 x/y 或 fx/fy");
                op.put("x", x);
                op.put("y", y);
            }
            JSONArray ops = new JSONArray();
            ops.put(op);
            return executeGesture(ops);
        } catch (Throwable t) {
            return jsonError("touch error: " + t.getMessage());
        }
    }

    /** /touch-release：抬起全部按住的手指。 */
    private String handleTouchRelease() {
        synchronized (gestureLock) {
            try {
                releaseAllFingersUnlocked();
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("held", new JSONArray());
                return o.toString();
            } catch (Throwable t) {
                return jsonError("touch-release error: " + t.getMessage());
            }
        }
    }

    /** /touch-status：查询当前按住的手指。 */
    private String handleTouchStatus() {
        try {
            int[] size = screenSize();
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("screenW", size[0]);
            o.put("screenH", size[1]);
            o.put("maxFingers", MAX_FINGERS);
            o.put("holdTimeoutMs", HOLD_TIMEOUT_MS);
            JSONArray held = new JSONArray();
            long now = System.currentTimeMillis();
            for (int f = 0; f < MAX_FINGERS; f++) {
                if (fingerDown[f]) {
                    JSONObject h = new JSONObject();
                    h.put("finger", f);
                    h.put("x", (int) fingerX[f]);
                    h.put("y", (int) fingerY[f]);
                    h.put("fx", screenW > 0 ? fingerX[f] / screenW : 0);
                    h.put("fy", screenH > 0 ? fingerY[f] / screenH : 0);
                    h.put("elapsedMs", now - fingerDownAt[f]);
                    held.put(h);
                }
            }
            o.put("held", held);
            return o.toString();
        } catch (Throwable t) {
            return jsonError("touch-status error: " + t.getMessage());
        }
    }

    /** /swipe：x1/y1→x2/y2（或 fx1/fy1→fx2/fy2），duration 毫秒。 */
    private String handleSwipe(String path) {
        try {
            int[] size = screenSize();
            if (screenW == 0) {
                screenW = size[0];
                screenH = size[1];
            }
            int x1 = coordFromParams(path, "x1", "fx1", screenW);
            int y1 = coordFromParams(path, "y1", "fy1", screenH);
            int x2 = coordFromParams(path, "x2", "fx2", screenW);
            int y2 = coordFromParams(path, "y2", "fy2", screenH);
            if (x1 < 0 || y1 < 0 || x2 < 0 || y2 < 0) {
                return jsonError("swipe 需要起点(x1/y1 或 fx1/fy1)和终点(x2/y2 或 fx2/fy2)");
            }
            long dur = (long) parseDoubleSafe(queryParam(path, "duration"), 300);
            JSONObject op = new JSONObject();
            op.put("kind", "swipe");
            op.put("x", x1);
            op.put("y", y1);
            op.put("x2", x2);
            op.put("y2", y2);
            op.put("durationMs", dur);
            if (!queryParam(path, "finger").isEmpty()) {
                op.put("finger", (int) parseDoubleSafe(queryParam(path, "finger"), 0));
            }
            JSONArray ops = new JSONArray();
            ops.put(op);
            return executeGesture(ops);
        } catch (Throwable t) {
            return jsonError("swipe error: " + t.getMessage());
        }
    }

    /** /hold：x/y（或 fx/fy）按住 duration 毫秒后自动抬起。 */
    private String handleHold(String path) {
        try {
            int[] size = screenSize();
            if (screenW == 0) {
                screenW = size[0];
                screenH = size[1];
            }
            int x = coordFromParams(path, "x", "fx", screenW);
            int y = coordFromParams(path, "y", "fy", screenH);
            if (x < 0 || y < 0) return jsonError("hold 需要 x/y 或 fx/fy");
            long dur = (long) parseDoubleSafe(queryParam(path, "duration"), 500);
            JSONObject op = new JSONObject();
            op.put("kind", "hold");
            op.put("x", x);
            op.put("y", y);
            op.put("durationMs", dur);
            if (!queryParam(path, "finger").isEmpty()) {
                op.put("finger", (int) parseDoubleSafe(queryParam(path, "finger"), 0));
            }
            JSONArray ops = new JSONArray();
            ops.put(op);
            return executeGesture(ops);
        } catch (Throwable t) {
            return jsonError("hold error: " + t.getMessage());
        }
    }

    // ===================== 原有路由（保留 + 增强） =====================

    /** /status：服务运行状态 + 能力自述。
     *  批次19v2 诊断字段：clickEvents/windowEvents 透出 TYPE_VIEW_CLICKED / 窗口级事件累计数，
     *  供装机验证 accessibility_config.xml 的 typeViewClicked 声明是否生效（点几下 UI 后 clickEvents 应增长）。 */
    private String handleStatus() {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("running", isRunning);
            o.put("package", activePackage);
            AccessibilityNodeInfo root = getRootInActiveWindow();
            o.put("nodeCount", root == null ? 0 : countNodes(root));
            o.put("apiLevel", Build.VERSION.SDK_INT);
            o.put("canScreenshot", Build.VERSION.SDK_INT >= 30);
            // 批次19v2 诊断字段：计数器只增不减，装机后对比点击前后的 clickEvents 增量即可确认事件已投递
            o.put("clickEvents", viewClickEventCount);
            o.put("windowEvents", windowEventCount);
            return o.toString();
        } catch (Throwable t) {
            return jsonError("status error: " + t.getMessage());
        }
    }

    /**
     * GET /context：返回当前主屏上的外部应用上下文。
     * 优先使用 active application window；包名缺失时才回退最近一次非 Harness 前台包。
     * 窗口或根节点不可读时始终返回完整结构，不以空对象或 Harness 自身冒充成功。
     */
    private String handleContext() {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false);
            o.put("available", false);
            o.put("package", "");
            o.put("applicationLabel", "");
            o.put("displayId", CONTEXT_DISPLAY_ID);
            o.put("nodeCount", 0);
            o.put("reason", REASON_NO_ACCESSIBILITY_READABLE_WINDOW);

            ContextTarget target = readContextTarget();
            if (target == null) return o.toString();

            String packageName = target.packageName;
            if (packageName.isEmpty()) packageName = lastExternalPackage;
            if (packageName.isEmpty() || isSelfPackage(packageName)) return o.toString();

            lastExternalPackage = packageName;
            o.put("ok", true);
            o.put("available", true);
            o.put("package", packageName);
            o.put("applicationLabel", applicationLabel(packageName));
            o.put("nodeCount", countNodes(target.root));
            o.put("reason", "");
            return o.toString();
        } catch (Throwable ignored) {
            return o.toString();
        }
    }

    /** 一次 /context 请求解析出的可读应用窗口。 */
    private static final class ContextTarget {
        final AccessibilityNodeInfo root;
        final String packageName;

        ContextTarget(AccessibilityNodeInfo root, String packageName) {
            this.root = root;
            this.packageName = packageName == null ? "" : packageName;
        }
    }

    /** 固定从主屏解析；悬浮面板抢焦点时，用最近外部包对应的非活动应用窗口兜底。 */
    private ContextTarget readContextTarget() {
        return readContextTarget(CONTEXT_DISPLAY_ID);
    }

    private ContextTarget readContextTarget(int displayId) {
        if (displayId == CONTEXT_DISPLAY_ID) {
            rememberCurrentExternalTarget();
        }
        try {
            ContextTarget preferred = null;
            ContextTarget fallback = null;
            String preferredPackage = (displayId == CONTEXT_DISPLAY_ID) ? lastExternalPackage : "";
            List<AccessibilityWindowInfo> wins = windowsForDisplay(displayId);
            if (wins != null) {
                for (int i = 0; i < wins.size(); i++) {
                    AccessibilityWindowInfo w = wins.get(i);
                    if (w == null || w.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) continue;
                    AccessibilityNodeInfo root = w.getRoot();
                    if (root == null) continue;
                    // 批次80：根节点存在但整棵树为空（窗口已被回收/不可读）不能当候选 —— 否则
                    // /dump?exclude_self=1 会返回 ok:true + 0 节点，把「读不到」伪装成「界面没有控件」。
                    if (countNodes(root) <= 0) continue;
                    String packageName = windowPkg(w);
                    if (isSelfPackage(packageName)) continue;
                    ContextTarget target = new ContextTarget(root, packageName);
                    if (w.isActive()) {
                        return (displayId == CONTEXT_DISPLAY_ID) ? rememberContextTarget(target) : target;
                    }
                    if (!preferredPackage.isEmpty() && preferredPackage.equals(packageName)) preferred = target;
                    if (fallback == null) fallback = target;
                }
            }
            if (preferred != null) {
                return (displayId == CONTEXT_DISPLAY_ID) ? rememberContextTarget(preferred) : preferred;
            }
            if (displayId == CONTEXT_DISPLAY_ID) {
                ContextTarget cached = lastReadableContextTarget;
                // 批次72：缓存快照可能已被系统回收（应用切走窗口消失后节点树失效，遍历得到 0 节点）。
                // 这种「伪空」结果必须弃用并回退到真实窗口枚举，否则 scope=current 会返回 package 正确
                // 但 count=0 的空列表，把「读不到」伪装成「界面没有控件」。
                if (!preferredPackage.isEmpty() && cached != null && preferredPackage.equals(cached.packageName)
                        && countNodes(cached.root) > 0) {
                    return cached;
                }
            }
            if (fallback != null) {
                return (displayId == CONTEXT_DISPLAY_ID) ? rememberContextTarget(fallback) : fallback;
            }
            if (displayId == CONTEXT_DISPLAY_ID) {
                AccessibilityNodeInfo root = getRootInActiveWindow();
                if (root == null) return null;
                AccessibilityWindowInfo window = root.getWindow();
                if (window == null || window.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) return null;
                try {
                    if (Build.VERSION.SDK_INT >= 30 && window.getDisplayId() != CONTEXT_DISPLAY_ID) {
                        return null;
                    }
                } catch (Throwable ignored) {
                }
                // 批次80：同上——活动窗口的根若整棵树为空，宁可诚实失败（NO_ACCESSIBILITY_READABLE_WINDOW）
                if (countNodes(root) <= 0) return null;
                CharSequence raw = root.getPackageName();
                String packageName = raw == null ? "" : raw.toString();
                if (isSelfPackage(packageName)) return null;
                return rememberContextTarget(new ContextTarget(root, packageName));
            }
            return null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private ContextTarget rememberContextTarget(ContextTarget target) {
        if (target != null && !target.packageName.isEmpty() && !isSelfPackage(target.packageName)) {
            lastExternalPackage = target.packageName;
            lastReadableContextTarget = target;
        }
        return target;
    }

    /** 在悬浮窗抢焦点前保存外部应用根节点，供 /context 与当前屏读屏复用。严禁虚拟屏事件污染主屏记录。 */
    private void rememberCurrentExternalTarget() {
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return;
            AccessibilityWindowInfo window = root.getWindow();
            if (window == null || window.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) return;
            try {
                if (Build.VERSION.SDK_INT >= 30 && window.getDisplayId() != CONTEXT_DISPLAY_ID) {
                    return; // 严禁非主屏（虚拟屏）应用篡改主屏外部应用记录
                }
            } catch (Throwable ignored) {
            }
            CharSequence raw = root.getPackageName();
            String packageName = raw == null ? "" : raw.toString();
            if (packageName.isEmpty() || isSelfPackage(packageName)) return;
            lastExternalPackage = packageName;
            lastReadableContextTarget = new ContextTarget(root, packageName);
        } catch (Throwable ignored) {
        }
    }

    private boolean isSelfPackage(String packageName) {
        return packageName != null && packageName.equals(getPackageName());
    }

    /** 包名可读但安装信息不可用时，按契约保留空标签。 */
    private String applicationLabel(String packageName) {
        try {
            android.content.pm.PackageManager pm = getPackageManager();
            android.content.pm.ApplicationInfo info = pm.getApplicationInfo(packageName, 0);
            CharSequence label = pm.getApplicationLabel(info);
            return label == null ? "" : label.toString();
        } catch (Throwable ignored) {
            return "";
        }
    }

    private int countNodes(AccessibilityNodeInfo root) {
        final int[] count = {0};
        walk(root, new NodeVisitor() {
            @Override
            public void visit(AccessibilityNodeInfo node, int depth) {
                count[0]++;
            }
        }, 0);
        return count[0];
    }

    /** 无 displayId 参数时沿用系统活动窗口；参数存在时必须为有效整数。 */
    private int requestedDisplayId(String path) {
        String raw = queryParam(path, "displayId").trim();
        if (raw.isEmpty()) return Integer.MIN_VALUE;
        return Integer.parseInt(raw);
    }

    /** 按 displayId 选择活动应用窗口根节点；虚拟屏窗口需经 getWindowsOnAllDisplays() 获取。 */
    private AccessibilityNodeInfo rootForPath(String path) throws Exception {
        int displayId = requestedDisplayId(path);
        boolean excludeSelf = "1".equals(queryParam(path, "exclude_self").trim());
        if (excludeSelf) {
            int dId = (displayId == Integer.MIN_VALUE) ? CONTEXT_DISPLAY_ID : displayId;
            ContextTarget target = readContextTarget(dId);
            return target == null ? null : target.root;
        }
        if (displayId == Integer.MIN_VALUE) return getRootInActiveWindow();
        List<AccessibilityWindowInfo> wins = windowsForDisplay(displayId);
        if (wins == null) return null;
        AccessibilityNodeInfo fallback = null;
        for (int i = 0; i < wins.size(); i++) {
            AccessibilityWindowInfo w = wins.get(i);
            if (w == null || w.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) continue;
            AccessibilityNodeInfo root = w.getRoot();
            if (root == null) continue;
            if (w.isActive()) return root;
            if (fallback == null) fallback = root;
        }
        return fallback;
    }

    /** 获取指定 display 的无障碍窗口；API 30+ 支持跨屏枚举。 */
    @SuppressWarnings("unchecked")
    /** /display-info：返回目标 display 的真实像素尺寸（默认主屏），供插件做 fx/fy 换算。
     *
     *  批次74 根因：虚拟屏（1008x1792）与主屏（1256x2808）尺寸不同，但 /tap 的 fx/fy
     *  一直按主屏尺寸换算。android_act 事务内的 tap 走 /tap（node-coord 路径），
     *  在虚拟屏上纵向点偏约 1.57 倍——同一组 fx=0.496/fy=0.17，单工具 android_tap
     *  （自带按虚拟屏尺寸换算）正确命中搜索框，事务 tap 却落到账号卡片。
     *
     *  displayId 缺省或 <= 0 时返回主屏；虚拟屏 displayId 由调用方从 /vscreen/create 获得。
     */
    private String handleDisplayInfo(String path) {
        int displayId = 0;
        String raw = queryParam(path, "displayId").trim();
        if (!raw.isEmpty()) {
            try {
                displayId = Integer.parseInt(raw);
            } catch (Throwable ignored) {
                displayId = 0;
            }
        }
        int w = 0;
        int h = 0;
        int density = 0;
        try {
            android.hardware.display.DisplayManager dm =
                    (android.hardware.display.DisplayManager) getSystemService(DISPLAY_SERVICE);
            if (dm != null) {
                Display d = dm.getDisplay(displayId);
                if (d != null) {
                    DisplayMetrics dmx = new DisplayMetrics();
                    d.getRealMetrics(dmx);
                    w = dmx.widthPixels;
                    h = dmx.heightPixels;
                    density = dmx.densityDpi;
                }
            }
        } catch (Throwable ignored) {
        }
        if (w <= 0 || h <= 0) {
            // 退化到主屏（displayId 无效/虚拟屏已销毁时也给出可用值，避免调用方无从换算）
            int[] size = screenSize();
            w = size[0];
            h = size[1];
            displayId = 0;
        }
        try {
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("displayId", displayId);
            o.put("width", w);
            o.put("height", h);
            if (density > 0) o.put("densityDpi", density);
            return o.toString();
        } catch (Throwable t) {
            return jsonError("display-info 序列化失败: " + t.getMessage());
        }
    }

    private List<AccessibilityWindowInfo> windowsForDisplay(int displayId) throws Exception {
        if (displayId == Integer.MIN_VALUE) return getWindows();
        if (Build.VERSION.SDK_INT < 30) return null;
        java.lang.reflect.Method m = android.accessibilityservice.AccessibilityService.class
                .getMethod("getWindowsOnAllDisplays");
        Object obj = m.invoke(this);
        if (!(obj instanceof android.util.SparseArray)) return null;
        android.util.SparseArray byDisplay = (android.util.SparseArray) obj;
        Object value = byDisplay.get(displayId);
        return value instanceof List ? (List<AccessibilityWindowInfo>) value : null;
    }

    private interface NodeVisitor {
        void visit(AccessibilityNodeInfo node, int depth);
    }

    private void walk(AccessibilityNodeInfo node, NodeVisitor visitor, int depth) {
        walkD(node, visitor, depth, MAX_DEPTH);
    }

    /** 批次6：带深度上限的遍历（/dump?depth=N 定向读屏用；默认上限同 MAX_DEPTH）。 */
    private void walkD(AccessibilityNodeInfo node, NodeVisitor visitor, int depth, int maxDepth) {
        if (node == null || depth > maxDepth) return;
        visitor.visit(node, depth);
        for (int i = 0; i < node.getChildCount(); i++) {
            try {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) {
                    walkD(child, visitor, depth + 1, maxDepth);
                    child.recycle();
                }
            } catch (Throwable ignored) {
            }
        }
    }

    /**
     * 读取屏幕节点树，转 JSON（过滤：只保留有文本/描述/可点击/可输入/可滚动节点）。
     * 批次6 定向 dump（默认行为不变）：可选 query 参数
     *   vid=<viewIdResourceName>  以第一个 viewId 匹配的节点为根，仅输出该子树（找不到时返回空集 + note）
     *   depth=<N>                 遍历深度上限（默认仍为 40）
     *   exclude_self=1            复用 /context 的外部窗口选择，固定主屏并过滤 Harness；无窗口时诚实失败
     * 输出节点新增 vid 字段（node.getViewIdResourceName()，取不到为空串），供 AI 按 viewId 精确定位。
     */
    private String handleDump(String path) {
        try {
            // 批次8b #55：条件请求 if_version —— 调用方带上次返回的 version；App 侧确认屏幕
            // 未变化（非脏 + 版本相等 + 缓存未超龄）时直接返回快路径响应，不重遍历控件树。
            // 不带该参数时行为与旧版完全一致（响应仅 additive 多一个 version 字段）。
            long ifVer = -1;
            String ivStr = queryParam(path, "if_version").trim();
            if (!ivStr.isEmpty()) {
                try {
                    ifVer = Long.parseLong(ivStr);
                } catch (Throwable ignored) {
                    ifVer = -1;
                }
            }
            boolean excludeSelf = "1".equals(queryParam(path, "exclude_self").trim());
            if (ifVer >= 0 && !excludeSelf) {
                long[] hitVer = {-1};
                if (screenCacheHit(ifVer, hitVer)) {
                    JSONObject o = new JSONObject();
                    o.put("ok", true);
                    o.put("changed", false);
                    o.put("cached", true);
                    o.put("version", hitVer[0]);
                    o.put("package", activePackage == null ? "" : activePackage);
                    o.put("count", 0);
                    o.put("truncated", false);
                    o.put("nodes", new JSONArray());
                    return o.toString();
                }
            }
            final AccessibilityNodeInfo root = rootForPath(path);
            JSONObject o = new JSONObject();
            o.put("ok", true);
            if (root == null) {
                if (excludeSelf) {
                    o.put("ok", false);
                    o.put("error", REASON_NO_ACCESSIBILITY_READABLE_WINDOW);
                    o.put("package", "");
                    o.put("count", 0);
                    o.put("truncated", false);
                    o.put("nodes", new JSONArray());
                    return o.toString();
                }
                o.put("package", activePackage);
                o.put("count", 0);
                o.put("truncated", false);
                o.put("nodes", new JSONArray());
                o.put("version", currentScreenVersion());
                o.put("note", "当前没有可读取的活动窗口（可能处于锁屏或安全页面）");
                return o.toString();
            }
            // 定向参数解析（缺省 = 与旧行为完全一致）
            final String wantVid = queryParam(path, "vid").trim();
            int maxDepth = MAX_DEPTH;
            String dStr = queryParam(path, "depth").trim();
            if (!dStr.isEmpty()) {
                try {
                    int d = Integer.parseInt(dStr);
                    if (d > 0) maxDepth = Math.min(d, MAX_DEPTH);
                } catch (Throwable ignored) {
                }
            }
            // vid 锚定：找到第一个 viewIdResourceName 匹配的节点作为遍历根
            AccessibilityNodeInfo anchor = root;
            if (!wantVid.isEmpty()) {
                final String needle = wantVid.toLowerCase();
                final AccessibilityNodeInfo[] hit = {null};
                walk(root, new NodeVisitor() {
                    @Override
                    public void visit(AccessibilityNodeInfo node, int depth) {
                        if (hit[0] != null || node == null) return;
                        try {
                            CharSequence v = node.getViewIdResourceName();
                            String vid = v == null ? "" : v.toString().trim().toLowerCase();
                            if (!vid.isEmpty() && (vid.equals(needle) || vid.endsWith(":id/" + needle) || vid.endsWith("/" + needle))) {
                                hit[0] = node;
                            }
                        } catch (Throwable ignored) {
                        }
                    }
                }, 0);
                if (hit[0] == null) {
                    o.put("package", root.getPackageName() == null ? "" : root.getPackageName().toString());
                    o.put("count", 0);
                    o.put("truncated", false);
                    o.put("nodes", new JSONArray());
                    o.put("version", currentScreenVersion());
                    o.put("note", "未找到 viewId 匹配 " + wantVid + " 的节点（注意 viewId 常为 pkg:id/name 全形）");
                    return o.toString();
                }
                anchor = hit[0];
            }
            final int walkMax = maxDepth;
            final JSONArray nodes = new JSONArray();
            final int[] emitted = {0};
            final boolean[] truncated = {false};
            // 批次8b #55：输出节点集合滚动哈希（含坐标与深度，捕捉纯布局变化）。
            // 借用 windowSignature 思路但在既有 dump 遍历内顺带计算，不增加第二次遍历。
            final long[] dumpHash = {1125899906842597L};
            final long dumpStartMs = System.currentTimeMillis();
            walkD(anchor, new NodeVisitor() {
                @Override
                public void visit(AccessibilityNodeInfo node, int depth) {
                    if (emitted[0] >= MAX_NODES) {
                        truncated[0] = true;
                        return;
                    }
                    if (node == null) return;
                    try {
                        CharSequence textCs = node.getText();
                        CharSequence descCs = node.getContentDescription();
                        String text = textCs == null ? "" : textCs.toString().trim();
                        String desc = descCs == null ? "" : descCs.toString().trim();
                        boolean clickable = node.isClickable();
                        boolean input = node.isEditable() || "android.widget.EditText".equals(node.getClassName() != null ? node.getClassName().toString() : "");
                        boolean scrollable = node.isScrollable();
                        if (text.isEmpty() && desc.isEmpty() && !clickable && !input && !scrollable) return;
                        Rect bounds = new Rect();
                        node.getBoundsInScreen(bounds);
                        if (bounds.width() <= 0 || bounds.height() <= 0) return;
                        if (text.length() > MAX_TEXT_LEN) text = text.substring(0, MAX_TEXT_LEN) + "…";
                        if (desc.length() > MAX_TEXT_LEN) desc = desc.substring(0, MAX_TEXT_LEN) + "…";
                        JSONObject n = new JSONObject();
                        n.put("text", text);
                        n.put("desc", desc);
                        n.put("cls", node.getClassName() == null ? "" : node.getClassName().toString());
                        // 批次6：viewId 资源名（精确定位的主键；取不到为空串）
                        String vid = "";
                        try {
                            CharSequence v = node.getViewIdResourceName();
                            vid = v == null ? "" : v.toString().trim();
                        } catch (Throwable ignored) {
                        }
                        n.put("vid", vid);
                        n.put("x", bounds.left);
                        n.put("y", bounds.top);
                        n.put("w", bounds.width());
                        n.put("h", bounds.height());
                        n.put("clickable", clickable);
                        n.put("input", input);
                        n.put("checked", node.isChecked());
                        n.put("selected", node.isSelected());
                        n.put("scrollable", scrollable);
                        n.put("depth", depth);
                        nodes.put(n);
                        emitted[0]++;
                        // 批次8b #55：把输出节点纳入滚动哈希（text|desc|vid|flags|bounds|depth）
                        StringBuilder hsb = new StringBuilder();
                        hsb.append(text).append('|').append(desc).append('|').append(vid)
                                .append('|').append(clickable ? '1' : '0').append(node.isChecked() ? '1' : '0')
                                .append(node.isSelected() ? '1' : '0').append(scrollable ? '1' : '0')
                                .append('|').append(bounds.left).append(',').append(bounds.top)
                                .append(',').append(bounds.width()).append(',').append(bounds.height())
                                .append('|').append(depth);
                        String hs = hsb.toString();
                        for (int hi = 0; hi < hs.length(); hi++) {
                            dumpHash[0] = dumpHash[0] * 31 + hs.charAt(hi);
                        }
                    } catch (Throwable ignored) {
                    }
                }
            }, 0, walkMax);
            o.put("package", root.getPackageName() == null ? "" : root.getPackageName().toString());
            o.put("count", emitted[0]);
            o.put("truncated", truncated[0]);
            o.put("nodes", nodes);
            // 批次8b #55：ScreenState 提交（仅全量 dump；vid 定向 dump 不消费失效标记、只回填当前版本）
            int[] sz = screenSize();
            long ver = wantVid.isEmpty()
                    ? commitScreenState(System.currentTimeMillis(), dumpStartMs,
                            emitted[0] + ":" + Long.toHexString(dumpHash[0]), sz[0], sz[1])
                    : currentScreenVersion();
            o.put("version", ver);
            if (ifVer >= 0) {
                o.put("changed", ver != ifVer);
                o.put("cached", false);
            }
            // v1.7.3：无节点界面（Unity 游戏/自绘 UI）引导 AI 改用截图 + 分数坐标
            if (emitted[0] == 0) {
                o.put("hint", "当前界面没有可读控件（常见于 Unity/游戏/自绘界面）。请改用 android_see 截屏看图，" +
                        "并优先用分数坐标（fx/fy，0~1）点击/滑动——截图会被模型查看器缩放，绝对像素坐标会点偏。");
            }
            return o.toString();
        } catch (Throwable t) {
            return jsonError("dump error: " + t.getMessage());
        }
    }

    // ===================== 批次8b #55 ScreenState 缓存辅助 =====================

    /** 条件请求快路径判定：非脏 + 版本相等 + 缓存未超龄 → true（out[0]=当前版本）。
     *  拿不准（脏 / 版本不符 / 超龄 / 尚未建态）一律 false，走全量 dump。 */
    private boolean screenCacheHit(long ifVersion, long[] out) {
        synchronized (screenStateLock) {
            if (screenVersion > 0 && screenVersion == ifVersion
                    && screenDirtyAtMs == 0L
                    && System.currentTimeMillis() - screenRefreshedAtMs <= SCREEN_CACHE_MAX_AGE_MS) {
                out[0] = screenVersion;
                return true;
            }
            return false;
        }
    }

    /** 全量 dump 完成后提交 ScreenState（版本决策 + 失效标记消费）。
     *  变化判定（任一成立即 bump 版本，只增不减）：
     *    ① dump 开始前有未消费的失效事件（脏）；
     *    ② 输出节点集合哈希与上次不同；
     *    ③ 屏幕尺寸变化（旋转/分屏/折叠）；
     *    ④ 首次建态（version==0）。
     *  遍历期间新到的事件不消费（保留脏标记），其影响由下一次 dump 反映——保证 fast path 不返回过期屏幕。
     *  返回提交后的版本号。 */
    private long commitScreenState(long nowMs, long dumpStartMs, String screenHash, int w, int h) {
        synchronized (screenStateLock) {
            boolean dirtyBefore = screenDirtyAtMs > 0L && screenDirtyAtMs <= dumpStartMs;
            boolean dirtyDuring = screenDirtyAtMs > dumpStartMs;
            boolean changed = dirtyBefore
                    || !screenHash.equals(lastScreenHash)
                    || w != lastScreenW || h != lastScreenH
                    || screenVersion == 0L;
            if (changed) screenVersion += 1;
            if (!dirtyDuring) screenDirtyAtMs = 0L;
            screenRefreshedAtMs = nowMs;
            lastScreenHash = screenHash;
            lastScreenW = w;
            lastScreenH = h;
            return screenVersion;
        }
    }

    /** 读取当前版本号（不消费失效标记、不建态；vid 定向 dump / 无根窗口等路径回填用）。 */
    private long currentScreenVersion() {
        synchronized (screenStateLock) {
            return screenVersion;
        }
    }

    // ===================== v1.9.x 无障碍可靠性工具（批次 1） =====================

    /** 小睡（等待前端事件处理后再回读）；被中断时提前返回。 */
    private void sleepQuiet(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** 节点 className（取不到返回空串）。 */
    private String nodeClassName(AccessibilityNodeInfo node) {
        if (node == null) return "";
        try {
            CharSequence cs = node.getClassName();
            return cs == null ? "" : cs.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    /** 批次10d（批次 7 遗留）：放宽的 editable 判定 —— isEditable() ||
     *  className 含 "EditText"。WebView DOM 映射节点 isEditable 上报不稳（同一节点时真时假），
     *  导致 textMatches 的放宽路径漏判；className 含 EditText 时视为可编辑兜底。 */
    private boolean editableLoose(AccessibilityNodeInfo node) {
        if (node == null) return false;
        try {
            if (node.isEditable()) return true;
            String cls = nodeClassName(node);
            return cls != null && cls.contains("EditText");
        } catch (Throwable t) {
            return false;
        }
    }

    /** 当前活动窗口的「节点集合签名」：节点数 + 最多 500 个节点的 cls|text|desc|clickable|checked
     *  滚动哈希。用途（批次 2）：ACTION_CLICK 在本机 ROM 对 DOM 映射节点常「返回 true 但界面无变化」，
     *  className 又不可靠，因此改用点击前后的签名差异做行为验证。
     *  取样上限 500 高于 dump 的 MAX_NODES(250)，保证侧边栏展开这类「节点数明显变化」一定被捕捉到。 */
    private String windowSignature() {
        final int[] count = {0};
        final long[] hash = {1125899906842597L};
        try {
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return "0:null";
            walk(root, new NodeVisitor() {
                @Override
                public void visit(AccessibilityNodeInfo node, int depth) {
                    if (node == null || count[0] >= 500) return;
                    count[0]++;
                    StringBuilder sb = new StringBuilder();
                    try {
                        CharSequence c = node.getClassName();
                        sb.append(c == null ? "" : c);
                    } catch (Throwable ignored) {
                    }
                    sb.append('|');
                    try {
                        CharSequence t = node.getText();
                        sb.append(t == null ? "" : t);
                    } catch (Throwable ignored) {
                    }
                    sb.append('|');
                    try {
                        CharSequence d = node.getContentDescription();
                        sb.append(d == null ? "" : d);
                    } catch (Throwable ignored) {
                    }
                    boolean clickable = false;
                    boolean checked = false;
                    try {
                        clickable = node.isClickable();
                        checked = node.isChecked();
                    } catch (Throwable ignored) {
                    }
                    sb.append('|').append(clickable ? '1' : '0');
                    sb.append('|').append(checked ? '1' : '0');
                    String s = sb.toString();
                    for (int i = 0; i < s.length(); i++) {
                        hash[0] = hash[0] * 31 + s.charAt(i);
                    }
                }
            }, 0);
        } catch (Throwable t) {
            Log.w(TAG, "windowSignature failed", t);
            return "0:error";
        }
        return count[0] + ":" + Long.toHexString(hash[0]);
    }

    /** 节点在屏幕上的中心坐标，写进 out[0]/out[1]；取不到或尺寸非正返回 false。 */
    private boolean nodeCenter(AccessibilityNodeInfo node, int[] out) {
        if (node == null) return false;
        try {
            Rect r = new Rect();
            node.getBoundsInScreen(r);
            if (r.width() <= 0 || r.height() <= 0) return false;
            out[0] = r.centerX();
            out[1] = r.centerY();
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** 软键盘（IME）窗口顶边 y 坐标；没有输入法窗口时返回 -1。
     *  根因（真机实测）：无障碍节点坐标是屏幕绝对坐标，软键盘弹出后同一 y 会落到键盘上。 */
    private int imeTopY() {
        return imeTopY(Integer.MIN_VALUE);
    }

    /** 指定 display 的软键盘窗口顶边；虚拟屏没有独立 IME 时返回 -1，输入链路不依赖可见键盘。 */
    private int imeTopY(int displayId) {
        try {
            List<AccessibilityWindowInfo> wins = windowsForDisplay(displayId);
            if (wins == null) return -1;
            for (int i = 0; i < wins.size(); i++) {
                AccessibilityWindowInfo w = wins.get(i);
                if (w == null) continue;
                if (w.getType() == AccessibilityWindowInfo.TYPE_INPUT_METHOD) {
                    Rect r = new Rect();
                    w.getBoundsInScreen(r);
                    if (r.top > 0) return r.top;
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "imeTopY failed", t);
        }
        return -1;
    }

    /** 把 imeTopY 写进返回体：无输入法窗口时写 JSON null（插件侧按 number 过滤）。 */
    private void putImeTop(JSONObject o, int imeTop) {
        try {
            o.put("imeTopY", imeTop > 0 ? imeTop : JSONObject.NULL);
        } catch (Throwable ignored) {
        }
    }

    /** 回读节点当前文本：refresh() 后先 getText，再退回 getContentDescription。 */
    private String readBackText(AccessibilityNodeInfo node) {
        if (node == null) return "";
        try {
            node.refresh();
        } catch (Throwable ignored) {
        }
        try {
            CharSequence t = node.getText();
            if (t != null && t.length() > 0) return t.toString().trim();
        } catch (Throwable ignored) {
        }
        try {
            CharSequence d = node.getContentDescription();
            if (d != null && d.length() > 0) return d.toString().trim();
        } catch (Throwable ignored) {
        }
        return "";
    }

    /** 回读值是否匹配期望：trim 后相等；editable（或 WebView/WebKit）节点额外允许 contains 容错。
     *  批次 2 真机修复：DSH 聊天输入框对 SET_TEXT/PASTE 表现为「追加」语义（不清空原有内容），
     *  严格相等会把「AAABBB」判成写入 BBB 失败（假失败）。因此 editable 节点放宽为 contains。
     *  语义不退化：expected 为空一律 false（空期望证明不了任何写入）；静默失败时回读为空串，
     *  空串 contains 非空期望同样为 false，仍判失败。非 editable 节点维持严格相等。 */
    private boolean textMatches(String actual, String expected, String cls, boolean editable) {
        if (actual == null || expected == null) return false;
        String a = actual.trim();
        String e = expected.trim();
        if (e.isEmpty()) return false;
        if (a.equals(e)) return true;
        boolean loose = editable || cls.contains("WebView") || cls.contains("android.webkit");
        if (loose && a.contains(e)) return true;
        return false;
    }

    private boolean safeIsFocused(AccessibilityNodeInfo node) {
        try {
            return node != null && node.isFocused();
        } catch (Throwable t) {
            return false;
        }
    }

    /** 找当前输入目标：FOCUS_INPUT 焦点节点优先，否则 DFS 取第一个 editable/focusable。 */
    private AccessibilityNodeInfo findInputTarget(AccessibilityNodeInfo root) {
        if (root == null) return null;
        AccessibilityNodeInfo focused = null;
        try {
            focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
        } catch (Throwable ignored) {
        }
        if (focused != null) return focused;
        final AccessibilityNodeInfo[] editable = {null};
        walk(root, new NodeVisitor() {
            @Override
            public void visit(AccessibilityNodeInfo node, int depth) {
                if (editable[0] != null) return;
                if (node != null && (node.isEditable() || node.isFocusable())) editable[0] = node;
            }
        }, 0);
        return editable[0];
    }

    private AccessibilityNodeInfo findNodeByText(String needle) {
        if (needle == null || needle.isEmpty()) return null;
        final AccessibilityNodeInfo[] found = {null};
        final String target = needle.trim().toLowerCase();
        final AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        walk(root, new NodeVisitor() {
            @Override
            public void visit(AccessibilityNodeInfo node, int depth) {
                // 改进（批次 1）：优先可点击命中项——已有不可点击候选时，遇到可点击的替换；
                // 已是可点击项则停止搜索（与插件侧 findNodeInSnapshot 语义一致）。
                if (found[0] != null && found[0].isClickable()) return;
                if (node == null) return;
                CharSequence textCs = node.getText();
                CharSequence descCs = node.getContentDescription();
                String text = textCs == null ? "" : textCs.toString().toLowerCase();
                String desc = descCs == null ? "" : descCs.toString().toLowerCase();
                if ((!text.isEmpty() && text.contains(target)) || (!desc.isEmpty() && desc.contains(target))) {
                    found[0] = node;
                }
            }
        }, 0);
        if (found[0] == null) return null;
        if (!found[0].isClickable()) {
            // 命中节点自身不可点击 → 向上找可点击祖先（最多 5 层），供 ACTION_CLICK 使用；
            // 找不到就返回原节点，由 handleTap 走坐标手势降级。
            AccessibilityNodeInfo p = found[0];
            for (int i = 0; i < 5; i++) {
                AccessibilityNodeInfo parent;
                try {
                    parent = p.getParent();
                } catch (Throwable t) {
                    parent = null;
                }
                if (parent == null) break;
                if (parent.isClickable()) return parent;
                p = parent;
            }
        }
        return found[0];
    }

    /** 按屏幕坐标命中节点（/tap x,y 的定位入口）。
     *  批次19：改为遍历全树取「最小可点击命中节点」优先——原实现取前序遍历第一个命中节点，
     *  即最外层容器：行内容器不可点击而行内子控件可点击时（或反之），ACTION_CLICK 会落在
     *  不响应触摸的层级上。现对每个 bounds.contains(x,y) 的节点记录：
     *  ①面积最小的可点击命中节点；②面积最小的任意命中节点（兜底）；
     *  有可点击命中返回 ①，否则返回 ②。坐标手势路径严格用请求坐标，
     *  不受命中节点选择影响（见 handleTap）。 */
    private AccessibilityNodeInfo findNodeByPoint(final int x, final int y) {
        final AccessibilityNodeInfo[] clickableHit = {null};
        final AccessibilityNodeInfo[] anyHit = {null};
        final long[] clickableArea = {Long.MAX_VALUE};
        final long[] anyArea = {Long.MAX_VALUE};
        final AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        walk(root, new NodeVisitor() {
            @Override
            public void visit(AccessibilityNodeInfo node, int depth) {
                if (node == null) return;
                Rect bounds = new Rect();
                node.getBoundsInScreen(bounds);
                if (!bounds.contains(x, y)) return;
                long area = (long) bounds.width() * bounds.height();
                if (area < anyArea[0]) {
                    anyArea[0] = area;
                    anyHit[0] = node;
                }
                if (node.isClickable() && area < clickableArea[0]) {
                    clickableArea[0] = area;
                    clickableHit[0] = node;
                }
            }
        }, 0);
        return clickableHit[0] != null ? clickableHit[0] : anyHit[0];
    }

    /** /tap：vid（viewId）> text/desc 按文本查找点击；x/y 或 fx/fy 按坐标点击。
     *  v1.9.x（批次 1）真机修复：
     *   1) WebView 降级——ACTION_CLICK 会返回成功但界面无变化；改用节点中心坐标 dispatchGesture
     *      点击，只有手势成功才 found:true。
     *   2) 键盘遮挡补偿——目标点 y ≥ 软键盘顶边时不直接点（会点到键盘上，实测误输入字符），
     *      先 GLOBAL_ACTION_BACK 收起输入法 → 等 300ms → 重新定位节点 → 再点；
     *      重定位失败则退回原始坐标。method 后缀 -after-ime-dismiss 标记该路径。
     *  v1.9.x（批次 2）真机修复：批次 1 的 WebView 判定靠 className 含 "WebView"，在本机 ROM
     *    永不命中（DOM 映射成 android.widget.Button 等），text 点击因此静默失效。现改为点击后置的
     *    行为验证：比对点击前后的窗口节点签名（windowSignature），不变即判静默无效并降级为手势重试，
     *    method 记 gesture-after-click-noop。
     *  批次6：定位优先级 vid（viewIdResourceName 精确匹配，复合定位最高优先）> text > desc > 坐标；
     *    点击生效验证改为事件驱动——点击后短窗口（~300ms）内收到任一无障碍事件
     *    （TYPE_WINDOW_CONTENT_CHANGED 等，onAccessibilityEvent 已更新 lastEventAtMs）即判生效，
     *    省去固定 350ms 等待 + 两次全树签名遍历；窗口内无事件时降级回原有签名比对（原样保留），
     *    签名也不变时仍走既有手势降级（原样保留）。
     *  批次19（假成功堵洞）：vid/坐标路径此前 ACTION_CLICK 返回 true 即报 found:true（零校验），
     *    现三条路径（vid/text/坐标）统一「事件窗口 + 签名比对」点击后置校验，校验链与 text 路径
     *    对等；手势路径（clickNoop 复点、非 clickable 目标直接手势）补 gestureTapVerified 后置
     *    验证——dispatchGesture 返回 true 只代表手势已派发，不代表目标响应注入，界面无动静时
     *    诚实失败（method=gesture-verified-noop，reason=INJECT_NO_EFFECT），不再假成功。
     *  批次19v2（抗噪证据链）：外部真机复测（2026-09-13 18:19，DSH 自身高噪 WebView 界面——
     *    消息流/动画持续产生 TYPE_WINDOW_CONTENT_CHANGED）实证：批次19 推广的「任意事件=生效」
     *    证据被环境噪音灌满，ACTION_CLICK 对 DOM 节点静默返回 true 仍被判生效（6/6 假成功，
     *    method=node-*；同坐标显式手势正常）。v2 改为只认三类抗噪证据：
     *    ① TYPE_VIEW_CLICKED——performClick 同步发出=点击监听真的执行；
     *    ② 窗口级事件——点击打开新窗口/对话框；
     *    ③ targetStateEffective 定向复查——目标节点自身 selected/checked/bounds/存在性变化。
     *    三者皆无 = 静默无效 → 记入 SILENT_CLICK_CACHE（下次该键跳过 ACTION_CLICK 直接手势
     *    先行）→ 走既有手势复点。「任意事件」证据就此从 click 链移除（content-changed 在高噪
     *    界面不可作证据；批次25 v3 起手势后验 gestureTapVerified 同样强证据化——有目标时
     *    VIEW_CLICKED/窗口级事件/定向复查三选一，无目标保持任意事件+签名，见其注释）。
     *  批次22 W-D（dump 经济）：targetStateEffective 增加事件门控——基线在 performAction 返回后
     *    立刻采样（先于 400ms 强证据等待），轮询期间无新无障碍事件且 ScreenState 无新脏标记时
     *    跳过重定位全树遍历（树不可能变化，正确性论证见其注释），安静场景遍历 ≤7 次→1 次。 */
    private String handleTap(String path) {
        try {
            String text = queryParam(path, "text");
            String desc = queryParam(path, "desc");
            String vid = queryParam(path, "vid").trim();
            int[] size = screenSize();
            if (screenW == 0) {
                screenW = size[0];
                screenH = size[1];
            }
            int tapX = coordFromParams(path, "x", "fx", screenW);
            int tapY = coordFromParams(path, "y", "fy", screenH);
            JSONObject o = new JSONObject();
            o.put("ok", true);

            boolean byText = !text.isEmpty() || !desc.isEmpty();
            boolean byVid = !vid.isEmpty();
            AccessibilityNodeInfo target = null;
            String method = "";
            if (byVid) {
                target = findNodeByViewId(vid);
                method = "node-vid";
            } else if (byText) {
                target = findNodeByText(!text.isEmpty() ? text : desc);
                method = "node-text";
            } else if (tapX >= 0 && tapY >= 0) {
                target = findNodeByPoint(tapX, tapY);
                method = "node-coord";
            } else {
                return jsonError("tap 需要 text/desc 或 x/y（或 fx/fy）参数");
            }
            String needle = !text.isEmpty() ? text : desc;

            int imeTop = imeTopY();
            boolean degraded = false;
            int[] center = new int[]{-1, -1};
            // 节点中心只用于 text/desc 命中后的降级手势；坐标路径必须严格用请求坐标
            // （批次19 起 findNodeByPoint 取最小可点击命中节点，但其中心仍可能与请求点
            // 相距甚远——如宽按钮的边缘，用命中节点中心会点到别处）。
            boolean haveCenter = byText && nodeCenter(target, center);

            // ---- 键盘遮挡补偿：目标点落在键盘区域内 → 先收起输入法，再重新定位点击 ----
            int probeY = haveCenter ? center[1] : tapY;
            if (imeTop > 0 && probeY >= imeTop) {
                degraded = true;
                performGlobalAction(GLOBAL_ACTION_BACK);
                sleepQuiet(300);
                if (byVid) {
                    AccessibilityNodeInfo again = findNodeByViewId(vid);
                    if (again != null) {
                        target = again;
                        haveCenter = nodeCenter(target, center);
                    }
                } else if (byText) {
                    AccessibilityNodeInfo again = findNodeByText(needle);
                    if (again != null) {
                        target = again;
                        haveCenter = nodeCenter(target, center);
                    }
                }
                imeTop = imeTopY();
            }
            putImeTop(o, imeTop);
            o.put("degraded", degraded);

            // ---- ACTION_CLICK 判定（批次19v2：只认抗噪强证据，噪音/签名不再作 click 证据）----
            boolean clickNoop = false;
            if (target != null && target.isClickable()) {
                // 批次19v2：v1 的「任意事件=生效」证据（批次6 语义推广到坐标/vid 路径）在高噪 WebView
                // 界面（DSH 自身 UI）被环境事件灌满——ACTION_CLICK 对 DOM 节点静默返回 true 仍被判生效
                // （外部复测 2026-09-13 18:19 实证 6/6 假成功，method=node-*）。改为只认三类抗噪证据：
                //   ① TYPE_VIEW_CLICKED —— performClick 同步发出，监听真的执行；
                //   ② 窗口级事件 —— 点击打开新窗口/对话框；
                //   ③ 定向状态复查 targetStateEffective —— 目标节点自身 selected/checked/bounds/存在性变化。
                // 三者皆无 = 静默无效 → 记入静默缓存（下次直接手势先行）→ 走既有手势复点。
                // 静默缓存命中时跳过 ACTION_CLICK（gesture-first，恢复点击速度）。
                // 批次6 的「任意事件」证据就此从 click 链移除（content-changed 在高噪界面不可作证据）；
                // 批次25 v3 起手势后验 gestureTapVerified 也强证据化（有目标三选一强证据，见其注释）——
                // 全链路不再有「任意事件=生效」的判定。
                String silentKey = silentClickKey(vid, needle, tapX, tapY, target, byVid, byText);
                if (!isKnownSilentClick(silentKey)) {
                    long clickBaseEvt = lastViewClickAtMs;
                    long windowBaseEvt = lastWindowEventAtMs;
                    boolean wasSelected = target.isSelected();
                    boolean wasChecked = target.isChecked();
                    Rect clickBounds = new Rect();
                    target.getBoundsInScreen(clickBounds);
                    String clickCls = nodeClassName(target);
                    if (target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                        // 批次22 W-D：事件门控基线——performAction 返回后立刻采样（先于 400ms 强证据
                        // 等待，与 waitForViewClickEvidence 调用同位）。两者在 targetStateEffective
                        // 轮询期间均无推进 = 无新事件/脏标记 → 该轮跳过全树遍历（见其注释）。
                        long eventBase = lastEventAtMs;
                        long dirtyBase = screenDirtyAtMs;
                        boolean clicked = waitForViewClickEvidence(clickBaseEvt, windowBaseEvt, 400);
                        if (!clicked) {
                            clicked = targetStateEffective(vid, needle, tapX, tapY,
                                    wasSelected, wasChecked, clickBounds, clickCls, byVid, byText,
                                    eventBase, dirtyBase);
                        }
                        if (clicked) {
                            forgetSilentClick(silentKey);
                            o.put("found", true);
                            o.put("method", method + (degraded ? "-after-ime-dismiss" : ""));
                            target.recycle();
                            return o.toString();
                        }
                        clickNoop = true;
                        rememberSilentClick(silentKey);
                    }
                }
            }

            // 静默无效（ACTION_CLICK 返回 true 但界面没变）→ 手势复点。
            // 批次19：复点坐标优先节点中心，中心不可用（尺寸非正）时回退请求坐标，两者都不可用
            // 才诚实失败；复点结果改用 gestureTapVerified 后置校验——dispatchGesture 返回 true
            // 只代表手势已派发，界面无动静时不再报成功（洞2）。
            // 批次19v2：clickNoop 另含「静默缓存未命中时的首次静默判定」——复点前不需要再做任何
            // 事件/签名确认（三类强证据皆无才会进到这里）。
            if (clickNoop) {
                boolean haveRetry = haveCenter || (tapX >= 0 && tapY >= 0);
                if (!haveRetry) {
                    o.put("found", false);
                    o.put("method", "gesture-after-click-noop");
                    o.put("error", "ACTION_CLICK 返回成功但界面无变化（静默无效），" +
                            "且节点尺寸非正取不到中心坐标，无法降级为手势点击");
                    return o.toString();
                }
                int rx = haveCenter ? center[0] : tapX;
                int ry = haveCenter ? center[1] : tapY;
                // 批次25 v3：复点后验同样强证据化——clickNoop 只在 target!=null && isClickable
                // 分支置位，此处 target 必非空，可传定向上下文（byVid/byText/请求坐标与 handleTap
                // 的定位参数一致，判定细节见 gestureTapVerified 注释）。
                int rv = gestureTapVerified(rx, ry, vid, needle, tapX, tapY,
                        byVid, byText, target != null);
                o.put("found", rv == 1);
                o.put("method", "gesture-after-click-noop");
                if (rv == 2) {
                    // 手势已派发但界面无变化 → 覆盖开头 put 的 ok:true，诚实失败
                    o.put("ok", false);
                    o.put("reason", "INJECT_NO_EFFECT");
                    o.put("error", "ACTION_CLICK 静默无效，手势复点后界面也无变化（目标未响应注入），" +
                            "建议改用特权通道 android_input action=tap");
                } else if (rv == 0) {
                    o.put("error", haveCenter
                            ? "ACTION_CLICK 静默无效，节点中心坐标手势点击亦失败"
                            : "ACTION_CLICK 静默无效，请求坐标手势点击亦失败");
                }
                return o.toString();
            }

            int gx = haveCenter ? center[0] : tapX;
            int gy = haveCenter ? center[1] : tapY;
            if (gx >= 0 && gy >= 0) {
                // 批次19：手势主路径补后置校验——dispatchGesture 返回 true 只代表手势已派发
                // （DocumentsUI 列表行等 OnTouchListener 控件可静默无效），界面确有动静才报成功。
                // 批次25 v3：有已定位目标（text/vid 命中但不可点击，或坐标命中非可点击节点）时
                // 传定向上下文走强证据判定；空白区/坐标无命中（target==null）保持无目标判定。
                int gv = gestureTapVerified(gx, gy, vid, needle, tapX, tapY,
                        byVid, byText, target != null);
                String gm = "none";
                if (gv == 1) {
                    if (degraded) gm = "gesture-after-ime-dismiss";
                    else if (target != null && byText) gm = "gesture-webview";
                    else gm = "gesture";
                } else if (gv == 2) {
                    gm = "gesture-verified-noop";
                }
                o.put("found", gv == 1);
                o.put("method", gm);
                if (gv == 2) {
                    // 手势已派发但界面无变化 → 覆盖开头 put 的 ok:true，诚实失败
                    o.put("ok", false);
                    o.put("reason", "INJECT_NO_EFFECT");
                    o.put("error", "手势已派发但界面无变化（目标未响应注入），" +
                            "建议改用特权通道 android_input action=tap");
                }
                return o.toString();
            }
            o.put("found", false);
            o.put("error", "未找到可点击的目标元素（text/desc 未匹配，或元素不可点击）");
            return o.toString();
        } catch (Throwable t) {
            return jsonError("tap error: " + t.getMessage());
        }
    }

    /** 批次6 事件驱动点击验证：自 baseline 之后 windowMs 窗口内是否收到任一无障碍事件。
     *  服务声明的 eventTypes 含 TYPE_WINDOW_CONTENT_CHANGED / TYPE_WINDOW_STATE_CHANGED /
     *  TYPE_WINDOWS_CHANGED，点击生效时这些事件必然有至少一个到达（onAccessibilityEvent 更新
     *  lastEventAtMs）。有事件 → 立即判生效（免固定等待 + 两次全树签名遍历）；
     *  无事件 → 返回 false，由调用方降级到原有窗口签名比对路径（原样保留）。
     *  批次19：窗口宽度参数化——click 链保持批次6 的 300ms（原生控件证据快），手势后置校验用
     *  1200ms（见 gestureTapVerified：WebView 页签切换等触控驱动控件的证据实测迟到 0.6~1.0s）。
     *  误判方向分析：无关事件（如光标闪烁）会让「未生效的点击」被判生效——与旧签名比对
     *  「无关文本变化导致签名不同」的风险等价；反之「生效但无事件」的场景比「生效但 500 节点
     *  签名不变」更罕见，整体风险不升。
     *  批次19v2 起 click 链不再用任意事件做证据（高噪 WebView 界面被环境事件污染，6/6 假成功实证）。
     *  批次25 v3 起手势后验有目标分支同样弃用任意事件（改强证据三选一，见 gestureTapVerified），
     *  本函数仅 gestureTapVerified 的无目标分支（空白区/纯坐标无节点）使用。 */
    private boolean clickEffectByEvent(long baseline, long windowMs) {
        final long deadline = System.currentTimeMillis() + windowMs;
        while (System.currentTimeMillis() < deadline) {
            if (lastEventAtMs > baseline) return true;
            try {
                Thread.sleep(25);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return lastEventAtMs > baseline;
    }

    /** 批次6 复合定位最高优先级：按 viewIdResourceName 精确匹配查找节点（兼容裸 name 形式）。
     *  自身不可点击时向上找可点击祖先（最多 5 层，语义与 findNodeByText 一致）。 */
    private AccessibilityNodeInfo findNodeByViewId(String needle) {
        if (needle == null || needle.isEmpty()) return null;
        final String target = needle.trim().toLowerCase();
        final AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        final AccessibilityNodeInfo[] found = {null};
        walk(root, new NodeVisitor() {
            @Override
            public void visit(AccessibilityNodeInfo node, int depth) {
                if (found[0] != null || node == null) return;
                try {
                    CharSequence v = node.getViewIdResourceName();
                    String vid = v == null ? "" : v.toString().trim().toLowerCase();
                    if (vid.isEmpty()) return;
                    if (vid.equals(target) || vid.endsWith(":" + target)
                            || vid.endsWith("/" + target)) {
                        found[0] = node;
                    }
                } catch (Throwable ignored) {
                }
            }
        }, 0);
        if (found[0] == null) return null;
        if (!found[0].isClickable()) {
            AccessibilityNodeInfo p = found[0];
            for (int i = 0; i < 5; i++) {
                AccessibilityNodeInfo parent;
                try {
                    parent = p.getParent();
                } catch (Throwable t) {
                    parent = null;
                }
                if (parent == null) break;
                if (parent.isClickable()) return parent;
                p = parent;
            }
        }
        return found[0];
    }

    private boolean gestureTap(final int x, final int y) {
        if (Build.VERSION.SDK_INT < 24) return false;
        try {
            OverlayService.showTapHighlight(x, y);
            Path path = new Path();
            path.moveTo(x, y);
            GestureDescription.StrokeDescription stroke =
                    new GestureDescription.StrokeDescription(path, 0, 60);
            GestureDescription gesture = new GestureDescription.Builder()
                    .addStroke(stroke)
                    .build();
            return dispatchGesture(gesture, null, null);
        } catch (Throwable t) {
            Log.w(TAG, "gesture tap failed", t);
            return false;
        }
    }

    /** 批次19 手势后置校验；批次25 v3 强证据化。派发前采样强证据基线 + 目标状态快照，派发成功后
     *  按「有目标 / 无目标」两套判定确认界面是否真的有动静。
     *  返回 0=dispatchGesture 失败；1=界面有动静（生效）；2=手势已派发但界面无变化（验证无效）。
     *  解决洞2：dispatchGesture 返回 true 只代表手势已派发，不代表目标响应注入
     *  （DocumentsUI 列表行等 OnTouchListener 控件实测可静默无效），未验证即报成功是假成功。
     *
     *  批次25 v3（有目标 → 强证据，消除批次22 W-A 指出的高噪假阳性残留）：批次19 起本函数对
     *  「任意无障碍事件」放行——在高噪 WebView（DSH 流式对话，content-changed 持续到达）里，
     *  真无效手势也会被环境事件误判生效（假阳性残留）。批次19v2 已在 click 链示范抗噪解法
     *  （VIEW_CLICKED/窗口级事件 + targetStateEffective 定向复查），v3 把同款判定引入手势后验。
     *  调用方已定位目标（target != null）时传 hasTargetState=true 与定位上下文
     *  （vid/needle/tapX/tapY/byVid/byText，与 handleTap 的定位参数一致），生效判定改为三选一：
     *    ① TYPE_VIEW_CLICKED（lastViewClickAtMs 推进）——点击监听真的执行；
     *    ② 窗口级事件（lastWindowEventAtMs 推进）——打开新窗口/对话框；
     *    ③ 定向状态复查——复用 targetStateEffective（windowMs 变体）：派发前用同款 find 系列
     *      （vid > text/desc > 请求坐标，见 locateTapTarget）重定位目标并快照
     *      selected/checked/bounds/类名，派发后轮询比对，任一变化或节点消失即生效。
     *    纯任意事件（content-changed 等）不再单独构成「生效」——高噪界面里它只证明"界面在动"，
     *    不证明"这次手势有效"；窗口签名兜底同理只保留给无目标分支（全树签名在高噪下同样被污染）。
     *  无目标（空白区/纯坐标且 findNodeByPoint 无命中）：保持批次19 现状（任意事件 1200ms +
     *  签名兜底）。原因：没有锚点可定向复查，且该路径误判面窄——空白区点按要么整页变化
     *  （滚动/键盘收起/新浮层，事件与签名都会动），要么什么都不发生；即便被环境噪音误判成功，
     *  代价也只是模型多看一眼屏幕，不存在"点到别的控件"的歧义。
     *
     *  判定窗与迟到证据（正确性红线，批次22 教训）：DSH WebView 页签切换的无障碍证据实测迟到
     *  0.6~1.0s——「强证据窗(400ms)+定向复查轮询(复用 900ms 量级)」合计若 <1.3s 会假阴性。故
     *  有目标时保持本函数现有 1200ms 总预算不变，结构改为两段：强证据窗(400ms) → 定向复查
     *  （吃满至派发后 1200ms 预算内，实测约占 800ms）。迟到证据必以事件形式到达 → 复查门控开 →
     *  遍历看到状态翻转，DSH 页签往返（轨迹/对话）真机用例仍 found:true；DocumentsUI 行点击
     *  （真机回归 T2）与空白区诚实失败（T3，无目标路径不变）不回退。clickNoop 复点路径另受
     *  批次19v2 既有兜底保护：click 与手势共享 lastEventAtMs/lastViewClickAtMs 时间线，click
     *  迟到的强证据落进手势窗同样判生效。
     *
     *  误判方向分析（v3 收紧后）：「高噪下真无效手势被环境事件报成功」（批次22 W-A 残留）被消除；
     *  残余风险转为假阴性——「有目标、但派发前快照与复查所见都无差异的手势」被诚实报失败
     *  （method=gesture-verified-noop，reason=INJECT_NO_EFFECT）：①效果恰好不改
     *  selected/checked/bounds/类名（如点已选中项、纯回调型控件）；②迟到效果落在 click 链复查
     *  末轮遍历之后、派发前快照之前（~0.1s 竞态窗，快照已含新状态而复点同目标不再变化）。
     *  假失败比假成功诚实——模型可用 android_see 复核后重试，或改走特权通道
     *  android_input action=tap 兜底。 */
    private int gestureTapVerified(final int x, final int y, final String vid, final String needle,
                                   final int tapX, final int tapY,
                                   final boolean byVid, final boolean byText,
                                   final boolean hasTargetState) {
        long evtBefore = lastEventAtMs;
        long clickBase = lastViewClickAtMs;
        long windowBase = lastWindowEventAtMs;
        String sigBefore = windowSignature();
        // 批次25 v3：有目标时派发前采目标快照（重定位用同款 find 系列，与复查定位一致）。
        // 定位不到 = 树正在剧变（窗口切换中等），无稳定锚点可定向 → 退回无目标判定
        // （保守回退：维持批次19 行为，不引入新失败模式）。
        boolean directed = false;
        boolean wasSelected = false;
        boolean wasChecked = false;
        Rect wasBounds = null;
        String wasCls = null;
        if (hasTargetState) {
            AccessibilityNodeInfo pre = locateTapTarget(vid, needle, tapX, tapY, byVid, byText);
            if (pre != null) {
                try {
                    Rect b = new Rect();
                    pre.getBoundsInScreen(b);
                    wasSelected = pre.isSelected();
                    wasChecked = pre.isChecked();
                    wasBounds = b;
                    wasCls = nodeClassName(pre);
                    directed = true;
                } catch (Throwable t) {
                    directed = false;
                }
            }
        }
        if (!gestureTap(x, y)) return 0;
        final long dispatchedAt = System.currentTimeMillis();
        if (!directed) {
            // 无目标：批次19 现状——任意事件窗优先（事件一到即返回），50ms 稳定窗后签名比对兜底。
            if (clickEffectByEvent(evtBefore, 1200)) return 1;
            sleepQuiet(50);
            return sigBefore.equals(windowSignature()) ? 2 : 1;
        }
        // 有目标：①+② 强证据窗 400ms（环境噪音不含这两类事件，见 waitForViewClickEvidence），
        // ③ 定向复查吃满剩余预算（与强证据窗合计保持 1200ms，迟到证据红线见方法注释）。
        if (waitForViewClickEvidence(clickBase, windowBase, 400)) return 1;
        long remain = dispatchedAt + 1200 - System.currentTimeMillis();
        // remain 理论值 ≈800ms；≤0 仅在强证据窗被异常拉长时出现（防御：直接诚实失败）。
        if (remain <= 0) return 2;
        // 门控基线在强证据窗后采样（同 click 链与 performAction 的相对位置）：期间到达的事件
        // 会让复查首轮之后照常遍历，完全安静则跳过遍历（批次22 W-D 语义不变）。
        return targetStateEffective(vid, needle, tapX, tapY,
                wasSelected, wasChecked, wasBounds, wasCls, byVid, byText,
                lastEventAtMs, screenDirtyAtMs, remain) ? 1 : 2;
    }

    // ===================== 批次19v2：click 链抗噪证据 + 静默点击缓存 =====================

    /** 批次19v2：已证实 ACTION_CLICK 静默无效的节点键 → 时刻。命中缓存跳过 ACTION_CLICK 直接手势
     *  先行（恢复高噪 WebView 界面的点击速度：首轮 ~2.5s 全链，后续 ~1.3s 手势链）。
     *  只记「performAction 返回 true 但强证据+定向复查皆无」的键；点击确认生效即移除。 */
    private static final java.util.LinkedHashMap<String, Long> SILENT_CLICK_CACHE =
            new java.util.LinkedHashMap<String, Long>(64, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(java.util.Map.Entry<String, Long> eldest) {
                    return size() > 64;
                }
            };
    private static final long SILENT_CLICK_TTL_MS = 5 * 60_000L;

    /** 批次19v2：静默缓存键——vid 精确匹配优先，其次 text/desc 文本，坐标路径退化为
     *  「类名@坐标」（WebView DOM 节点树重排后同坐标可能是别的节点，键只作启发式加速）。 */
    private String silentClickKey(String vid, String needle, int x, int y,
                                  AccessibilityNodeInfo target, boolean byVid, boolean byText) {
        if (byVid && vid != null && !vid.isEmpty()) return "v:" + vid.trim().toLowerCase();
        if (byText && needle != null && !needle.isEmpty()) return "t:" + needle.toLowerCase();
        return "c:" + nodeClassName(target) + "@" + x + "_" + y;
    }

    /** 批次19v2：键是否在静默缓存 TTL 内（命中 = 该节点已证实 ACTION_CLICK 静默无效）。 */
    private boolean isKnownSilentClick(String key) {
        if (key == null) return false;
        synchronized (SILENT_CLICK_CACHE) {
            Long at = SILENT_CLICK_CACHE.get(key);
            return at != null && System.currentTimeMillis() - at < SILENT_CLICK_TTL_MS;
        }
    }

    /** 批次19v2：记录一次「performAction 返回 true 但强证据皆无」的静默无效键。 */
    private void rememberSilentClick(String key) {
        if (key == null) return;
        synchronized (SILENT_CLICK_CACHE) {
            SILENT_CLICK_CACHE.put(key, System.currentTimeMillis());
        }
    }

    /** 批次19v2：点击确认生效即移除缓存键（下次恢复 ACTION_CLICK 快路径）。 */
    private void forgetSilentClick(String key) {
        if (key == null) return;
        synchronized (SILENT_CLICK_CACHE) {
            SILENT_CLICK_CACHE.remove(key);
        }
    }

    /** 批次19v2：ACTION_CLICK 后等待强证据——VIEW_CLICKED（监听执行）或窗口级事件（新窗口/对话框）。
     *  窗口宽 400ms：服务 notificationTimeout=200 会合流事件，过短会漏。环境噪音不含这两类事件。 */
    private boolean waitForViewClickEvidence(long clickBase, long windowBase, long windowMs) {
        final long deadline = System.currentTimeMillis() + windowMs;
        while (System.currentTimeMillis() < deadline) {
            if (lastViewClickAtMs > clickBase || lastWindowEventAtMs > windowBase) return true;
            try {
                Thread.sleep(25);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return lastViewClickAtMs > clickBase || lastWindowEventAtMs > windowBase;
    }

    /** 批次25 v3：按调用方的定位方式重定位目标节点（vid > text/desc > 请求坐标），供
     *  targetStateEffective 的复查与 gestureTapVerified 的派发前快照共用——同一目标必须走
     *  同款 find 系列，快照与复查才可比（vid 路径 findNodeByViewId 会向上补可点击祖先，
     *  快照与复查两侧取到的是同一个节点）。坐标路径用请求坐标（与 handleTap 定位一致，
     *  而非手势落点/节点中心）。 */
    private AccessibilityNodeInfo locateTapTarget(String vid, String needle, int x, int y,
                                                  boolean byVid, boolean byText) {
        try {
            if (byVid) return findNodeByViewId(vid);
            if (byText) return findNodeByText(needle);
            return findNodeByPoint(x, y);
        } catch (Throwable ignored) {
            return null;
        }
    }

    /** 批次19v2：定向状态复查——重新定位目标节点，比对类名/bounds/selected/checked。
     *  与环境噪音无关（噪音改的是别的节点）。判定为生效（返回 true）的条件：
     *  重定位不到（节点消失/窗口已切换），或类名、bounds、selected、checked 任一变化；
     *  完全一致 = 点击对该节点无效果（返回 false）。轮询至多 ~900ms（WebView 树更新可迟到 ~1s，
     *  900ms 内不翻转则交给手势复点兜底）。
     *  批次22 W-D（事件门控，dump 经济）：新增 eventBase/dirtyBase 基线入参（调用点在
     *  performAction 返回后立刻采样 lastEventAtMs/screenDirtyAtMs）。首轮无条件遍历保留（基线
     *  确认，在门控判断之前）；之后每轮先查门控再遍历——lastEventAtMs 与 screenDirtyAtMs 均无
     *  推进（自点击以来无任何无障碍事件、ScreenState 无新脏标记）→ 本轮跳过全树遍历直接
     *  sleep 150ms 进下一轮；任一推进（迟到证据到达）→ 该轮照常重定位遍历。
     *  正确性：a11y 树变化必然伴随事件投递（服务已声明 windowContentChanged/windowStateChanged/
     *  windowsChanged/viewClicked，onAccessibilityEvent 首行对每个事件无条件更新 lastEventAtMs，
     *  screenDirtyAtMs 再覆盖其中树脏子集），故「无事件+无脏标记 = 树不可能变化」，跳过遍历
     *  不丢迟到证据——迟到证据本身就是以事件形式到达，事件一到门控即开、下一轮照常遍历。
     *  效果：安静场景（绝大多数点按）全树遍历从 ≤7 次降到 1 次（每省一次遍历=省数十到数百次
     *  binder IPC，兼收功耗与延迟）；高噪场景事件持续推进、门控常开，行为与批次19v2 完全一致。
     *  返回语义不变（fresh==null→true、状态变化→true、完全一致→false）。 */
    private boolean targetStateEffective(String vid, String needle, int x, int y,
                                         boolean wasSelected, boolean wasChecked,
                                         Rect wasBounds, String wasCls,
                                         boolean byVid, boolean byText,
                                         long eventBase, long dirtyBase) {
        // 批次25 v3：click 链保持批次19v2 的 900ms 复查窗不变；手势后验走 windowMs 变体
        // （吃满 gestureTapVerified 的 1200ms 总预算剩余部分）。
        return targetStateEffective(vid, needle, x, y, wasSelected, wasChecked, wasBounds, wasCls,
                byVid, byText, eventBase, dirtyBase, 900);
    }

    /** 批次25 v3：targetStateEffective 的复查窗参数化变体——判定逻辑与上方 900ms 版完全一致，
     *  仅窗宽可调，供手势后验（gestureTapVerified）在「强证据窗 400ms」之后吃满 1200ms 总预算的
     *  剩余部分，保证 DSH 页签切换 0.6~1.0s 迟到证据不因两段窗合计变短而假阴性。 */
    private boolean targetStateEffective(String vid, String needle, int x, int y,
                                         boolean wasSelected, boolean wasChecked,
                                         Rect wasBounds, String wasCls,
                                         boolean byVid, boolean byText,
                                         long eventBase, long dirtyBase, long windowMs) {
        final long deadline = System.currentTimeMillis() + windowMs;
        boolean firstRound = true;
        while (true) {
            // 批次22 W-D：门控闭合（无新事件+无新脏标记=树不可能变化）→ 本轮跳过全树遍历。
            // 时间预算与原节奏一致：sleep 150ms 后不够再一轮即返回 false——与原「完全一致」
            // 收尾等价（期间无事件，最后再遍历也只会看到同样的树）。
            if (!firstRound && lastEventAtMs <= eventBase && screenDirtyAtMs <= dirtyBase) {
                if (System.currentTimeMillis() + 150 >= deadline) return false;
                try {
                    Thread.sleep(150);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return false;
                }
                continue;
            }
            firstRound = false;
            // 批次25 v3：重定位收口到 locateTapTarget（与手势派发前快照同款 find 系列，
            // 同一目标的快照与复查才可比）。
            AccessibilityNodeInfo fresh = locateTapTarget(vid, needle, x, y, byVid, byText);
            if (fresh == null) return true;
            boolean same;
            try {
                Rect nb = new Rect();
                fresh.getBoundsInScreen(nb);
                same = nodeClassName(fresh).equals(wasCls)
                        && nb.equals(wasBounds)
                        && fresh.isSelected() == wasSelected
                        && fresh.isChecked() == wasChecked;
            } catch (Throwable t) {
                same = false;
            }
            if (!same) return true;
            if (System.currentTimeMillis() + 150 >= deadline) return false;
            try {
                Thread.sleep(150);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
    }

    /** /input：text= 输入到当前聚焦输入框，并做回读校验（绝不静默成功）。
     *
     * v1.9.x（批次 1）真机修复：ACTION_SET_TEXT 对 WebView/contenteditable 常返回成功
     * 但界面不刷新（不触发前端 input 事件）→ 模型以为输入成功，实际发出空消息。
     * 现在写入后逐级回读，三级回退链命中即停：
     *   L1 ACTION_SET_TEXT（现状路径）
     *   L2 ACTION_PASTE（现状 paste 路径；写之前先把文本放进剪贴板）
     *   L3 特权 `input keyevent 279`（KEYCODE_PASTE）——由插件侧 dsh-tool-accessibility
     *      执行（App 进程内无法直接拿特权），本类只提供 verifyOnly=1 的回读校验入口。
     * 结果语义（三者必须可区分）：
     *   match    → ok:true  + verified:true  + method=实际生效的那一级
     *   mismatch → ok:false + error/warning + expected/actual（回读到但与期望不符）
     *   unknown  → ok:true  + verified:false + warning（节点不暴露文本，无法回读）
     * 参数：mode=paste 时把粘贴提到第一级（WebView/contenteditable 建议）；
     *       verifyOnly=1 时只回读校验、不写入（供插件侧 L3 之后复核）。
     * 返回字段：ok/error/focused/method/verified/expected/actual/warning/attempts[{method,ok,readback}]。 */
    private String handleInput(String path) {
        try {
            String text = queryParam(path, "text");
            String mode = queryParam(path, "mode");
            boolean verifyOnly = "1".equals(queryParam(path, "verifyOnly"));
            int targetDisplayId = requestedDisplayId(path);
            AccessibilityNodeInfo root = rootForPath(path);
            if (root == null) return jsonError("当前没有活动窗口");
            AccessibilityNodeInfo target = findInputTarget(root);
            if (target == null) return jsonError("未找到可输入的文本框");
            if (!target.isFocused()) {
                target.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
            }
            if (verifyOnly) {
                // 只读校验入口（不改内容）：插件侧 L3（input keyevent 279）执行完后用它回读；
                // 批次 7（#54）：附带 imeTopY 供插件在注入前做 IME/焦点预检（>0 = 输入法窗口在屏）。
                // 批次8b：text 为空串 = 清空语义，回读为空即校验通过（textMatches 对空期望恒 false，需绕过）。
                String rb = readBackText(target);
                JSONObject o = new JSONObject();
                o.put("ok", true);
                o.put("verified", text.isEmpty() ? rb.isEmpty()
                        : textMatches(rb, text, nodeClassName(target), editableLoose(target)));
                o.put("expected", text);
                o.put("actual", rb);
                o.put("focused", safeIsFocused(target));
                o.put("imeTopY", imeTopY(targetDisplayId));
                return o.toString();
            }

            // 剪贴板：L2（ACTION_PASTE）与插件侧 L3（input keyevent 279）都依赖它，
            // 写入前统一放好，保证回退链任一级拿到的都是同一份文本。
            try {
                android.content.ClipboardManager cm =
                        (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                cm.setPrimaryClip(android.content.ClipData.newPlainText("dsh-input", text));
            } catch (Throwable t) {
                Log.w(TAG, "set clipboard failed", t);
            }

            String cls = nodeClassName(target);
            final String[] levels = "paste".equals(mode)
                    ? new String[]{"paste", "set"} : new String[]{"set", "paste"};
            JSONArray attempts = new JSONArray();
            boolean verified = false;
            String method = "none";
            String actual = "";
            boolean sawAnyReadback = false;
            for (int i = 0; i < levels.length; i++) {
                String lv = levels[i];
                boolean applied;
                if ("paste".equals(lv)) {
                    applied = target.performAction(AccessibilityNodeInfo.ACTION_PASTE);
                } else {
                    android.os.Bundle args = new android.os.Bundle();
                    args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
                    applied = target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
                }
                // 小延时：给前端（WebView contenteditable）的事件处理留时间，再回读
                sleepQuiet(200);
                String rb = readBackText(target);
                if (!rb.isEmpty()) {
                    sawAnyReadback = true;
                    actual = rb;
                }
                JSONObject att = new JSONObject();
                att.put("method", lv);
                att.put("ok", applied);
                att.put("readback", rb);
                attempts.put(att);
                // 批次8b：空串 = 清空语义，回读为空即校验通过；非空保持 textMatches 原判定（paste 路径不受影响）
                boolean matched = text.isEmpty() ? rb.isEmpty()
                        : textMatches(rb, text, cls, editableLoose(target));
                if (matched) {
                    verified = true;
                    method = lv;
                    actual = rb;
                    break;
                }
            }

            JSONObject o = new JSONObject();
            o.put("focused", safeIsFocused(target));
            o.put("expected", text);
            o.put("actual", actual);
            o.put("verified", verified);
            o.put("attempts", attempts);
            if (verified) {
                o.put("ok", true);
                o.put("method", method);
                o.put("error", "");
            } else if (sawAnyReadback) {
                // mismatch：回读到了但与期望不符，且各级均失败 —— 绝不静默成功
                o.put("ok", false);
                o.put("method", "none");
                o.put("error", "输入未生效：setText/paste 均写入失败，回读内容与期望不符");
                o.put("warning", "回读=" + actual + " / 期望=" + text +
                        "。可改用 android_input（特权通道 input text），或先长按输入框再点「粘贴」。");
            } else {
                // unknown：节点不暴露文本（如 WebView 虚拟节点），无法回读校验
                o.put("ok", true);
                o.put("method", "unverified");
                o.put("error", "");
                o.put("warning", "无法回读校验（目标节点不暴露文本，可能是 WebView 虚拟节点）：" +
                        "是否真正输入未知，请用 android_screenshot 确认界面内容。");
            }
            return o.toString();
        } catch (Throwable t) {
            return jsonError("input error: " + t.getMessage());
        }
    }

    /** /scroll：direction=up/down/left/right（优先节点滚动）。 */
    private String handleScroll(String path) {
        try {
            String direction = queryParam(path, "direction");
            JSONObject o = new JSONObject();
            o.put("ok", true);
            o.put("direction", direction);
            AccessibilityNodeInfo root = getRootInActiveWindow();
            if (root == null) return jsonError("当前没有活动窗口");
            final int[] action = {AccessibilityNodeInfo.ACTION_SCROLL_FORWARD};
            if ("up".equals(direction)) action[0] = AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
            else if ("down".equals(direction)) action[0] = AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;
            else if ("left".equals(direction)) action[0] = AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
            else if ("right".equals(direction)) action[0] = AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;
            else return jsonError("direction 需要 up/down/left/right");
            final AccessibilityNodeInfo[] scroller = {null};
            walk(root, new NodeVisitor() {
                @Override
                public void visit(AccessibilityNodeInfo node, int depth) {
                    if (scroller[0] != null) return;
                    if (node != null && node.isScrollable()) scroller[0] = node;
                }
            }, 0);
            if (scroller[0] != null && scroller[0].performAction(action[0])) {
                o.put("method", "node");
                return o.toString();
            }
            o.put("method", "none");
            o.put("error", "未找到可滚动的区域");
            return o.toString();
        } catch (Throwable t) {
            return jsonError("scroll error: " + t.getMessage());
        }
    }

    private String handleGlobalAction(int action) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", performGlobalAction(action));
            return o.toString();
        } catch (Throwable t) {
            return jsonError("global action error: " + t.getMessage());
        }
    }

    /** 批次82-N2：屏幕是否亮着（取不到按「亮」处理，宁可放过不可误杀）。 */
    private boolean isScreenInteractive() {
        try {
            android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
            return pm == null || pm.isInteractive();
        } catch (Throwable t) {
            return true;
        }
    }

    /** /screenshot：Android 11+ 无障碍截图，存 PNG 到 filesDir/screenshots/，返回路径。
     *  grid=4/8 叠加网格线（帮模型按行列定位）；返回屏幕/图片尺寸与换算系数。 */
    private String handleScreenshot(String path) {
        if (Build.VERSION.SDK_INT < 30) {
            return jsonError("截图需要 Android 11+（当前 API " + Build.VERSION.SDK_INT + "）；低版本请用 /dump 读屏幕文本");
        }
        // 批次82-N2：屏幕熄灭时无障碍截图必然是黑帧（本机 Android 17 实测：面板 OFF 后合成停止）
        // —— 诚实失败，避免把「全黑图」当成功结果继续判断。
        if (!isScreenInteractive()) {
            return jsonError("SCREEN_OFF：屏幕已熄灭，截图 / 虚拟屏只在屏幕亮着时可靠。"
                    + "请点亮屏幕后重试（充电时常亮可在「小鲸鱼助手 → 保活自检」里开启）；"
                    + "不需要像素的步骤请改用 /dump 或 android_see 读节点。");
        }
        final String gridStr = queryParam(path, "grid");
        final int grid = "8".equals(gridStr) ? 8 : ("4".equals(gridStr) || "true".equals(gridStr) ? 4 : 0);
        final CountDownLatch latch = new CountDownLatch(1);
        final String[] result = {null};
        Executor executor = new Executor() {
            @Override
            public void execute(Runnable r) {
                new Handler(Looper.getMainLooper()).post(r);
            }
        };
        try {
            takeScreenshot(Display.DEFAULT_DISPLAY, executor, new TakeScreenshotCallback() {
                @Override
                public void onSuccess(ScreenshotResult screenshotResult) {
                    try {
                        // API 30-33：ScreenshotResult 提供 HardwareBuffer（+ColorSpace），包成 Bitmap 再转软件位图
                        android.hardware.HardwareBuffer hb = screenshotResult.getHardwareBuffer();
                        Bitmap bmp = Bitmap.wrapHardwareBuffer(hb, screenshotResult.getColorSpace());
                        if (bmp == null) {
                            result[0] = jsonError("截图位图为空");
                        } else {
                            Bitmap soft = bmp.copy(Bitmap.Config.ARGB_8888, true); // isMutable=true：后面要叠网格（new Canvas 需要可变位图）
                            bmp.recycle();
                            if (hb != null) hb.close();
                            // 网格叠加（半透明细线，帮模型按行列定位）
                            if (grid > 0 && soft.getWidth() > 0) {
                                Canvas cv = new Canvas(soft);
                                Paint paint = new Paint();
                                paint.setColor(0x66FFFFFF);
                                paint.setStrokeWidth(2f);
                                for (int i = 1; i < grid; i++) {
                                    float gx = soft.getWidth() * i / (float) grid;
                                    cv.drawLine(gx, 0, gx, soft.getHeight(), paint);
                                    float gy = soft.getHeight() * i / (float) grid;
                                    cv.drawLine(0, gy, soft.getWidth(), gy, paint);
                                }
                            }
                            File dir = null;
                            try {
                                File sharedBase = new File(android.os.Environment.getExternalStorageDirectory(), "DeepSeekHarness/screenshots");
                                if (sharedBase.exists() || sharedBase.mkdirs()) {
                                    dir = sharedBase;
                                }
                            } catch (Throwable t) {
                                // ignore
                            }
                            if (dir == null) {
                                try {
                                    File extDir = getExternalFilesDir("screenshots");
                                    if (extDir != null && (extDir.exists() || extDir.mkdirs())) {
                                        dir = extDir;
                                    }
                                } catch (Throwable t) {
                                    // ignore
                                }
                            }
                            if (dir == null) {
                                dir = new File(getFilesDir(), "screenshots");
                            }
                            if (!dir.exists()) dir.mkdirs();
                            File out = new File(dir, "screen-" + System.currentTimeMillis() + ".png");
                            FileOutputStream fos = new FileOutputStream(out);
                            soft.compress(Bitmap.CompressFormat.PNG, 100, fos);
                            fos.flush();
                            fos.close();
                            try {
                                out.setReadable(true, false);
                            } catch (Throwable t) {
                                // ignore
                            }
                            int[] size = screenSize();
                            JSONObject o = new JSONObject();
                            o.put("ok", true);
                            o.put("path", out.getAbsolutePath());
                            o.put("width", soft.getWidth());
                            o.put("height", soft.getHeight());
                            // 坐标系对齐：屏幕物理尺寸 / 截图尺寸 / 换算系数
                            o.put("screenW", size[0]);
                            o.put("screenH", size[1]);
                            o.put("imageW", soft.getWidth());
                            o.put("imageH", soft.getHeight());
                            o.put("scaleX", soft.getWidth() > 0 ? (double) size[0] / soft.getWidth() : 1.0);
                            o.put("scaleY", soft.getHeight() > 0 ? (double) size[1] / soft.getHeight() : 1.0);
                            o.put("grid", grid);
                            o.put("bytes", out.length());
                            result[0] = o.toString();
                        }
                    } catch (Throwable t) {
                        result[0] = jsonError("截图保存失败: " + t.getMessage());
                    } finally {
                        latch.countDown();
                    }
                }

                @Override
                public void onFailure(int errorCode) {
                    result[0] = jsonError("截图失败（错误码 " + errorCode + "，安全页面/未授权截图时常见）");
                    latch.countDown();
                }
            });
        } catch (Throwable t) {
            return jsonError("截图调用失败: " + t.getMessage());
        }
        try {
            if (!latch.await(6000, TimeUnit.MILLISECONDS)) {
                return jsonError("截图超时");
            }
        } catch (InterruptedException e) {
            return jsonError("截图被中断");
        }
        return result[0] == null ? jsonError("截图无结果") : result[0];
    }

    // ===================== 批次14w3（T1 spike）takeScreenshotOfDisplay 探针 =====================

    /**
     * GET /sod?displayId=N —— 调试探针：评估替代截屏通道，非契约接口，随时可删。
     * F3 背景（批次14f F2 黑帧调查 §四/§五）：S3 overlay 不在既有 /screenshot（无障碍
     * 截图）画面里；本端点探测 AccessibilityService#takeScreenshotOfDisplay 能否成为
     * 按屏截取的替代通道（尤其是 vscreen 虚拟 displayId）。
     *
     * javap android-37.0.jar 核实（2026-09-13）：公开 API 无 takeScreenshotOfDisplay，
     * 仅有 takeScreenshot(int,Executor,TakeScreenshotCallback)（API 30）与
     * takeScreenshotOfWindow(int,Executor,TakeScreenshotCallback)（API 36），
     * 任务书里的 (displayId, cancelId, executor, callback) 签名不存在——故走反射探测：
     * 设备运行时若该方法存在（厂商/未来版本开放）则按实际签名调用；不存在则如实返回
     * SOD_UNSUPPORTED（诚实失败，不臆造）。
     *
     * 成功 → binaryResp 置 PNG 字节（handleConnection 以 image/png 写回，不落盘）；
     * 失败 → JSON {ok:false,reason:"SOD_UNSUPPORTED"|"SOD_FAILED",detail}。
     * 鉴权与既有 3181 一致（handleConnection 入口 X-DSH-Token 校验，本端点无需额外处理）。
     * 线程：与既有 /screenshot 同构——回调经 executor 投到主线程，a11y-conn 线程
     * CountDownLatch 等待；探针取 3s 超时（快失败，/screenshot 为 6s）。
     * 前提：accessibility_config.xml 已有 canTakeScreenshot="true"（批次 v1.7 既置），
     * 服务未授权截图能力时走 invoke 异常/onFailure → 如实报错。
     */
    private String handleSod(String path) {
        // 能力前提：API 34+ 才可能有该 API（反射也找不到更老的）
        if (Build.VERSION.SDK_INT < 34) {
            return sodError("SOD_UNSUPPORTED", "需要 Android 14 (API 34+)，当前 API " + Build.VERSION.SDK_INT);
        }
        // displayId 解析：缺省主屏(0)；非整数 → SOD_FAILED（调用参数错误，非能力缺失）；
        // 乱值/不存在的 displayId 由系统回调 onFailure(ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY) → SOD_FAILED
        final int displayId;
        String ds = queryParam(path, "displayId");
        if (ds == null || ds.trim().isEmpty()) {
            displayId = Display.DEFAULT_DISPLAY;
        } else {
            try {
                displayId = Integer.parseInt(ds.trim());
            } catch (NumberFormatException e) {
                return sodError("SOD_FAILED", "displayId 非整数: " + ds);
            }
        }
        // 反射定位：先精确匹配 (int, Executor, TakeScreenshotCallback)，失配再按名扫描并记录实际签名
        java.lang.reflect.Method m = null;
        try {
            m = android.accessibilityservice.AccessibilityService.class.getMethod(
                    "takeScreenshotOfDisplay", int.class, Executor.class, TakeScreenshotCallback.class);
        } catch (NoSuchMethodException e) {
            for (java.lang.reflect.Method mm : android.accessibilityservice.AccessibilityService.class.getMethods()) {
                if ("takeScreenshotOfDisplay".equals(mm.getName())) {
                    m = mm;
                    break;
                }
            }
        }
        if (m == null) {
            return sodError("SOD_UNSUPPORTED",
                    "当前系统无 takeScreenshotOfDisplay（javap android-37.0.jar：公开面仅 takeScreenshot / takeScreenshotOfWindow）");
        }
        // 实际签名记录（按名兜底找到的变体也能如实上报）；参数个数 ≠3 时不强凑调用
        Class<?>[] ps = m.getParameterTypes();
        StringBuilder sgs = new StringBuilder("(");
        for (int i = 0; i < ps.length; i++) {
            if (i > 0) sgs.append(", ");
            sgs.append(ps[i].getName());
        }
        String signature = sgs.append(")").toString();
        if (ps.length != 3) {
            return sodError("SOD_UNSUPPORTED", "takeScreenshotOfDisplay 签名非预期 " + signature);
        }
        final CountDownLatch latch = new CountDownLatch(1);
        final byte[][] png = {null};
        final String[] fail = {null};
        // 与既有 /screenshot 同构：回调投主线程执行（onSuccess 里做 Bitmap/PNG 编码）
        Executor executor = new Executor() {
            @Override
            public void execute(Runnable r) {
                new Handler(Looper.getMainLooper()).post(r);
            }
        };
        TakeScreenshotCallback cb = new TakeScreenshotCallback() {
            @Override
            public void onSuccess(ScreenshotResult screenshotResult) {
                try {
                    // 与 /screenshot 同路径：HardwareBuffer(+ColorSpace) → Bitmap → 软件位图 → PNG
                    //（不叠网格、不落盘，直接出字节）
                    android.hardware.HardwareBuffer hb = screenshotResult.getHardwareBuffer();
                    Bitmap bmp = Bitmap.wrapHardwareBuffer(hb, screenshotResult.getColorSpace());
                    if (bmp == null) {
                        fail[0] = "截图位图为空";
                    } else {
                        Bitmap soft = bmp.copy(Bitmap.Config.ARGB_8888, false);
                        bmp.recycle();
                        if (hb != null) hb.close();
                        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                        soft.compress(Bitmap.CompressFormat.PNG, 100, bos);
                        soft.recycle();
                        png[0] = bos.toByteArray();
                    }
                } catch (Throwable t) {
                    fail[0] = "PNG 编码失败: " + t.getMessage();
                } finally {
                    latch.countDown();
                }
            }

            @Override
            public void onFailure(int errorCode) {
                // ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY 常见于乱值 displayId；SECURE_WINDOW /
                // NO_ACCESSIBILITY_ACCESS 为权限/安全页情形——如实带错误码返回
                fail[0] = "takeScreenshotOfDisplay 失败（错误码 " + errorCode + "）";
                latch.countDown();
            }
        };
        try {
            m.invoke(this, displayId, executor, cb);
        } catch (Throwable t) {
            // 反射被拒/服务无截图能力（Hidden API 政策、canTakeScreenshot 未授权等）→ 诚实失败
            return sodError("SOD_UNSUPPORTED",
                    "调用被拒: " + t.getClass().getSimpleName() + ": " + t.getMessage());
        }
        try {
            if (!latch.await(3000, TimeUnit.MILLISECONDS)) {
                return sodError("SOD_FAILED", "超时(3s) displayId=" + displayId + " 签名" + signature);
            }
        } catch (InterruptedException e) {
            return sodError("SOD_FAILED", "等待被中断 displayId=" + displayId);
        }
        if (fail[0] != null) {
            return sodError("SOD_FAILED", fail[0] + " displayId=" + displayId);
        }
        if (png[0] == null) {
            return sodError("SOD_FAILED", "无截图数据 displayId=" + displayId);
        }
        // 成功：PNG 字节交给 handleConnection 写回 image/png（respBody 置空串，二进制路径不读它）
        binaryResp.set(png[0]);
        return "";
    }

    /** 批次14w3（T1 spike）：/sod 失败响应统一结构 {ok:false,reason,detail}（与契约 JSON 错误区分）。
     *  批次14tow（spike）起 /wins、/sw 也复用本结构（reason 用 WINS_FAILED / SOW_*），属共享探针错误助手。 */
    private String sodError(String reason, String detail) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", false);
            o.put("reason", reason);
            o.put("detail", detail == null ? "" : detail);
            return o.toString();
        } catch (Throwable t) {
            return "{\"ok\":false,\"reason\":\"" + reason + "\",\"detail\":\"json error\"}";
        }
    }

    // ===================== 批次14tow（spike）窗口枚举 + takeScreenshotOfWindow 探针 =====================

    /**
     * GET /wins —— 调试探针：枚举无障碍服务可见窗口，非契约接口，随时可删。
     * 为 /sw 提供 windowId 选取依据。F3 背景：若 a11y 能枚举到虚拟屏（vscreen）窗口，
     * 「按窗口截图」通道（takeScreenshotOfWindow，API 36）才有意义——能否看到本身就是本
     * spike 的关键实验点：数组为空=前提不成立（诚实结论，附本端点即证据），非空即取
     * windowId 去 /sw 验证截图内容。
     *
     * 返回：JSON 数组 [{windowId, displayId, pkg, type, isActive}]（任务书规定字段；
     * type 为 AccessibilityWindowInfo.TYPE_* 原始 int，1=APPLICATION 2=INPUT_METHOD 3=SYSTEM
     * 4=ACCESSIBILITY_OVERLAY 5=SPLIT_SCREEN_DIVIDER 6=MAGNIFICATION_OVERLAY 7=WINDOW_CONTROL）。
     * 可见性前提：res/xml/accessibility_config.xml 已有 flagRetrieveInteractiveWindows
     * （v1.7 既置，本批次未动；javap 核实 getWindows() 需此 flag），无需运行时补 serviceInfo。
     * ?all=1 —— 改用 getWindowsOnAllDisplays()（公开 API 33）跨所有 display 枚举：
     * getWindows() 只回服务所跟踪 display（通常主屏）的窗口，虚拟屏窗口大概率只在 all=1
     * 才可见——这是「a11y 能否看到虚拟屏窗口」更彻底的实验。反射调用（历史构建的
     * android.jar 可能低于 API 33，反射保持本端点在任何 bootclasspath 下可编译；A17 运行时必有）。
     * 空数组 / 失败区分：getWindows()/getWindowsOnAllDisplays() 返回 null 或异常 →
     * {ok:false,reason:"WINS_FAILED",detail}（复用 /sod 的探针错误结构）；正常（含 0 窗口）→ 数组。
     * pkg 字段：AccessibilityWindowInfo#getPackageName 已从近年 SDK jar 公开面移除
     * （javap android-36.1/37.0 均无此方法，直接调用无法编译）→ 反射探测，失败回退窗口根节点
     * AccessibilityNodeInfo#getPackageName()（公开 API），再失败如实置空串（见 windowPkg）。
     * 鉴权与既有 3181 一致（handleConnection 入口 X-DSH-Token 校验，本端点无需额外处理）。
     */
    private String handleWins(String path) {
        try {
            String all = queryParam(path, "all");
            boolean wantAll = "1".equals(all) || "true".equals(all);
            JSONArray arr = new JSONArray();
            if (wantAll) {
                if (Build.VERSION.SDK_INT < 33) {
                    return sodError("WINS_FAILED", "all=1 需要 Android 13 (API 33+)，当前 API " + Build.VERSION.SDK_INT);
                }
                Object obj;
                try {
                    java.lang.reflect.Method m = android.accessibilityservice.AccessibilityService.class
                            .getMethod("getWindowsOnAllDisplays");
                    obj = m.invoke(this);
                } catch (Throwable t) {
                    return sodError("WINS_FAILED", "getWindowsOnAllDisplays 调用失败: "
                            + t.getClass().getSimpleName() + ": " + t.getMessage());
                }
                if (obj == null) {
                    return sodError("WINS_FAILED", "getWindowsOnAllDisplays() 返回 null（flagRetrieveInteractiveWindows 未生效？）");
                }
                android.util.SparseArray byDisplay = (android.util.SparseArray) obj;
                for (int i = 0; i < byDisplay.size(); i++) {
                    Object v = byDisplay.valueAt(i);
                    if (!(v instanceof List)) continue;
                    List lst = (List) v;
                    for (int j = 0; j < lst.size(); j++) {
                        Object wo = lst.get(j);
                        if (wo instanceof AccessibilityWindowInfo) putWindow(arr, (AccessibilityWindowInfo) wo);
                    }
                }
            } else {
                List<AccessibilityWindowInfo> wins = getWindows();
                if (wins == null) {
                    return sodError("WINS_FAILED", "getWindows() 返回 null（flagRetrieveInteractiveWindows 未生效？）");
                }
                for (int i = 0; i < wins.size(); i++) {
                    AccessibilityWindowInfo w = wins.get(i);
                    if (w != null) putWindow(arr, w);
                }
            }
            return arr.toString();
        } catch (Throwable t) {
            return sodError("WINS_FAILED", "wins error: " + t.getClass().getSimpleName() + ": " + t.getMessage());
        }
    }

    /** /wins 单窗口元素：{windowId, displayId, pkg, type, isActive}（任务书规定字段）。 */
    private void putWindow(JSONArray arr, AccessibilityWindowInfo w) {
        JSONObject o = new JSONObject();
        try {
            o.put("windowId", w.getId());
            o.put("displayId", w.getDisplayId());
            o.put("pkg", windowPkg(w));
            o.put("type", w.getType());
            o.put("isActive", w.isActive());
        } catch (Throwable ignored) {
        }
        arr.put(o);
    }

    /** /wins pkg 字段：反射探测 AccessibilityWindowInfo#getPackageName（已移出近年 SDK jar
     *  公开面，javap 36.1/37.0 均无；framework 运行时或在，受 Hidden API 政策限制则走回退），
     *  回退用窗口根节点 AccessibilityNodeInfo#getPackageName()（公开 API），再失败如实空串。 */
    private String windowPkg(AccessibilityWindowInfo w) {
        try {
            java.lang.reflect.Method m = AccessibilityWindowInfo.class.getMethod("getPackageName");
            Object v = m.invoke(w);
            if (v instanceof CharSequence && ((CharSequence) v).length() > 0) return v.toString();
        } catch (Throwable ignored) {
        }
        try {
            AccessibilityNodeInfo root = w.getRoot();
            if (root != null) {
                CharSequence cs = root.getPackageName();
                if (cs != null && cs.length() > 0) return cs.toString();
            }
        } catch (Throwable ignored) {
        }
        return "";
    }

    /**
     * GET /sw?windowId=N —— 调试探针：AccessibilityService#takeScreenshotOfWindow 按窗口截图，
     * 非契约接口，随时可删。F3 背景：Pixel 系无 root 时 S3 overlay 会话「看」的能力候选——
     * 验证该公开 API（API 36）能否截取虚拟屏上的窗口（windowId 从 /wins 或 /wins?all=1 获取）。
     *
     * javap android-37.0/android-36.1 核实（2026-09-13）：
     *   public void takeScreenshotOfWindow(int, java.util.concurrent.Executor,
     *       android.accessibilityservice.AccessibilityService$TakeScreenshotCallback)
     * 任务书猜测的 CancellationToken/android.os.CancellationSignal 参数不存在——按 javap 实际
     * 3 参签名公开 API 直呼（不臆造）。回调 ScreenshotResult{getHardwareBuffer, getColorSpace,
     * getTimestamp}，与既有 /screenshot 完全同一套公开类型。
     *
     * 成功 → binaryResp 置 PNG 字节（handleConnection 以 image/png 写回，不落盘、不叠网格）；
     * 失败 → JSON {ok:false,reason:"SOW_UNSUPPORTED"|"SOW_FAILED",detail}：
     *   - SOW_UNSUPPORTED：SDK < 36、调用被拒（能力缺失类，诚实失败）；
     *   - SOW_FAILED：windowId 缺失/非整数、onFailure 错误码（乱值 windowId 常见
     *     ERROR_TAKE_SCREENSHOT_INVALID_WINDOW=5；安全页 SECURE_WINDOW=6；服务未授权截图
     *     NO_ACCESSIBILITY_ACCESS=2）、超时、编码失败。
     * 鉴权与既有 3181 一致；线程与 /sod、/screenshot 同构——回调经 Executor 投主线程，
     * a11y-conn 线程 CountDownLatch.await(3000ms) 等待（探针快失败，/screenshot 为 6s）。
     * 编译前提：bootclasspath android.jar ≥ API 36（compileSdk 37 满足，见 build.sh ANDROID_JAR）。
     */
    private String handleSw(String path) {
        if (Build.VERSION.SDK_INT < 36) {
            return sodError("SOW_UNSUPPORTED", "需要 Android 16 (API 36+)，当前 API " + Build.VERSION.SDK_INT);
        }
        // windowId 解析：必填（windowId 无有意义缺省值，0 不是合法窗口句柄）；
        // 乱值由系统回调 onFailure(ERROR_TAKE_SCREENSHOT_INVALID_WINDOW=5) → SOW_FAILED
        String ws = queryParam(path, "windowId");
        if (ws == null || ws.trim().isEmpty()) {
            return sodError("SOW_FAILED", "windowId 缺失（先 GET /wins 或 /wins?all=1 枚举窗口取 windowId）");
        }
        final int windowId;
        try {
            windowId = Integer.parseInt(ws.trim());
        } catch (NumberFormatException e) {
            return sodError("SOW_FAILED", "windowId 非整数: " + ws);
        }
        final CountDownLatch latch = new CountDownLatch(1);
        final byte[][] png = {null};
        final String[] fail = {null};
        // 与既有 /sod、/screenshot 同构：回调投主线程执行（onSuccess 里做 Bitmap/PNG 编码）
        Executor executor = new Executor() {
            @Override
            public void execute(Runnable r) {
                new Handler(Looper.getMainLooper()).post(r);
            }
        };
        TakeScreenshotCallback cb = new TakeScreenshotCallback() {
            @Override
            public void onSuccess(ScreenshotResult screenshotResult) {
                try {
                    // 与 /sod 同路径：HardwareBuffer(+ColorSpace) → Bitmap → 软件位图 → PNG
                    //（不叠网格、不落盘，直接出字节）
                    android.hardware.HardwareBuffer hb = screenshotResult.getHardwareBuffer();
                    Bitmap bmp = Bitmap.wrapHardwareBuffer(hb, screenshotResult.getColorSpace());
                    if (bmp == null) {
                        fail[0] = "截图位图为空";
                    } else {
                        Bitmap soft = bmp.copy(Bitmap.Config.ARGB_8888, false);
                        bmp.recycle();
                        if (hb != null) hb.close();
                        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                        soft.compress(Bitmap.CompressFormat.PNG, 100, bos);
                        soft.recycle();
                        png[0] = bos.toByteArray();
                    }
                } catch (Throwable t) {
                    fail[0] = "PNG 编码失败: " + t.getMessage();
                } finally {
                    latch.countDown();
                }
            }

            @Override
            public void onFailure(int errorCode) {
                // INVALID_WINDOW(5)=windowId 不存在/不可截；SECURE_WINDOW(6)=安全页；
                // NO_ACCESSIBILITY_ACCESS(2)=服务未授权截图能力——如实带错误码返回
                fail[0] = "takeScreenshotOfWindow 失败（错误码 " + errorCode + "）";
                latch.countDown();
            }
        };
        try {
            // 公开 API 直呼（javap 核实 3 参签名，无 CancellationToken——任务书猜测签名不存在）
            takeScreenshotOfWindow(windowId, executor, cb);
        } catch (Throwable t) {
            // 服务无截图能力（canTakeScreenshot 未授权等）或系统拒绝 → 诚实失败
            return sodError("SOW_UNSUPPORTED",
                    "调用被拒: " + t.getClass().getSimpleName() + ": " + t.getMessage());
        }
        try {
            if (!latch.await(3000, TimeUnit.MILLISECONDS)) {
                return sodError("SOW_FAILED", "超时(3s) windowId=" + windowId);
            }
        } catch (InterruptedException e) {
            return sodError("SOW_FAILED", "等待被中断 windowId=" + windowId);
        }
        if (fail[0] != null) {
            return sodError("SOW_FAILED", fail[0] + " windowId=" + windowId);
        }
        if (png[0] == null) {
            return sodError("SOW_FAILED", "无截图数据 windowId=" + windowId);
        }
        // 成功：PNG 字节交给 handleConnection 写回 image/png（respBody 置空串，二进制路径不读它）
        binaryResp.set(png[0]);
        return "";
    }
}
