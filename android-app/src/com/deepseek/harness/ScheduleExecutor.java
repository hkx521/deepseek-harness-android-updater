package com.deepseek.harness;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 定时任务后台执行器（⑥ 全自动）：
 * 闹钟到点后由 AlarmReceiver 调用，**不依赖 Activity** ——
 * 直接定位引擎文件、启动 node、等 HTTP 就绪、调 DSH API 让 AI 自动执行任务。
 * 引擎已在运行时（3080 有响应）直接复用，不重复启动。
 */
public final class ScheduleExecutor {
    private static final String TAG = "ScheduleExecutor";
    private static final String REL_BINJS = "lib/node_modules/@deepseek-ai/dsh/lib/bin.js";

    private ScheduleExecutor() {}

    /** 引擎端口：固定默认端口（v1.5.4 起移除「端口冲突自动换端口」，与 MainActivity 一致，不再读 engine_port）。 */
    private static int enginePort(Context ctx) {
        return 3080; // 默认（正式版；Lite 版由构建时改 3082 / 抢先版 3084）
    }

    /** 执行一条定时任务（后台线程，调用方勿阻塞主线程）。 */
    public static void execute(Context ctx, String task) {
        if (task == null || task.isEmpty()) return;
        log(ctx, "开始执行任务: " + task);
        try {
            if (!engineReady(ctx)) {
                log(ctx, "引擎未运行，尝试启动…");
                if (!startEngine(ctx)) {
                    log(ctx, "引擎启动失败，无法自动执行任务");
                    // 批次88 修 D5：失败必须让用户看见（原先三条失败路径只写日志、不发通知，
                    // 加上 D1 的日志错位，用户会以为任务跑了）。
                    notifyResult(ctx, false, "引擎启动失败，任务未执行：\n" + task);
                    return;
                }
            }
            // 等引擎完全就绪（批次88 修 D4：30s → 90s，与 MainActivity.waitForServer 对齐）。
            // 真机日志留证：2026-09-18 22:58:51 / 23:07:52 两条「引擎 30 秒未就绪，放弃」——
            // 冷启动慢时任务被整条放弃，用户只看到提醒、没有任何失败提示。
            for (int i = 0; i < 90; i++) {
                if (engineReady(ctx)) break;
                Thread.sleep(1000);
            }
            if (!engineReady(ctx)) {
                log(ctx, "引擎 90 秒未就绪，放弃");
                notifyResult(ctx, false, "引擎 90 秒未就绪，任务未执行：\n" + task);
                return;
            }
            String sessionId = createSession(ctx);
            if (sessionId == null) {
                // 批次81-T3：旧文案把契约缺陷误导成「用户没配 API Key」。真机取证（2026-09-19）
                // 的真实原因是 rpc 契约不符（端点/信封/Cookie，见 rpc 方法注释），与 API Key 无关，
                // 故改为如实描述 + 指明排查方向。
                log(ctx, "创建会话失败（引擎 /api 未接受请求：检查 engine_cookie 是否在位、"
                        + "或引擎版本是否变更了 RPC 契约）");
                notifyResult(ctx, false, "创建会话失败，任务未执行（检查引擎 /api 鉴权）：\n" + task);
                return;
            }
            String promptResp = sendPromptRaw(ctx, sessionId, task);
            boolean ok = promptResp != null && promptResp.contains("\"ok\":true");
            String summary;
            if (promptResp == null) {
                summary = "任务发送失败（无响应）: " + task;
            } else if (ok) {
                summary = "任务已发送给 AI: " + task;
            } else {
                summary = "任务发送失败，响应: " + promptResp.replace("\n", " ").substring(0, Math.min(300, promptResp.length()));
            }
            log(ctx, summary);
            // 批次70：定时任务实况互通 —— 提交后接实况窗，有界轮询到 running 由 true 回落
            if (ok && PromotedProgressNotifier.isEnabled(ctx)) {
                PromotedProgressNotifier.start(ctx, "定时任务：" + shortTask(ctx, task));
                String verdict = pollScheduled(ctx, sessionId);
                if ("done".equals(verdict)) {
                    PromotedProgressNotifier.finish(ctx, "✓ 定时任务已完成");
                } else if ("timeout".equals(verdict)) {
                    PromotedProgressNotifier.finish(ctx, "⚠ 定时任务超时未确认");
                } else {
                    PromotedProgressNotifier.finish(ctx, "✕ 定时任务未完成");
                }
            }
            // 批次70：即时通知文案改为「已提交」，避免与实况窗完成态语义冲突
            notifyResult(ctx, ok, ok ? "任务已提交：\n" + task : summary);
        } catch (Throwable t) {
            String msg = "执行异常: " + t.getMessage();
            log(ctx, msg);
            notifyResult(ctx, false, msg);
        }
    }

    /** 批次70：实况窗正文用的任务摘要（去掉换行、限长）。 */
    private static String shortTask(Context ctx, String task) {
        String t = task == null ? "" : task.replace('\n', ' ').trim();
        return t.length() <= 30 ? t : t.substring(0, 30) + "…";
    }

    /**
     * 批次70：有界轮询（3s 间隔 / 上限 600s）—— 判断本轮是否跑完，顺带给出步骤序号。
     *
     * <p>语义：必须**先观测到 running=true**，之后 running 回落才判完成（避免提交瞬间的
     * false 被误当结束 —— 批次77 同源教训）。超时只提示「未确认」，**不杀引擎**。</p>
     */
    private static String pollScheduled(Context ctx, String sessionId) {
        long t0 = System.currentTimeMillis();
        boolean sawRunning = false;
        while (System.currentTimeMillis() - t0 < 600000L) {
            try {
                Thread.sleep(3000L);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return "interrupted";
            }
            long secs = (System.currentTimeMillis() - t0) / 1000L;
            String list = rpc(ctx, "session.list", "{}");
            if (list == null) continue;
            int i = list.indexOf("\"sessionId\":\"" + sessionId + "\"");
            if (i < 0) continue;
            int r = list.indexOf("\"running\":", i);
            boolean running = r >= 0 && list.startsWith("true", r + "\"running\":".length());
            int asOf = -1;
            int a = list.indexOf("\"asOfSeq\":", i);
            if (a >= 0) {
                int s = a + "\"asOfSeq\":".length();
                int e = s;
                while (e < list.length() && Character.isDigit(list.charAt(e))) e++;
                try { asOf = Integer.parseInt(list.substring(s, e)); } catch (Throwable ignored) {}
            }
            PromotedProgressNotifier.update(ctx, "定时任务执行中 · 已 " + secs + "s",
                    asOf > 0 ? asOf : 1, secs);
            if (running) {
                sawRunning = true;
            } else if (sawRunning) {
                return "done";
            }
        }
        return "timeout";
    }

    /** 定时任务结果通知（Kun 式回报：执行成功/失败都通知用户，点开进 App）。 */
    private static void notifyResult(Context ctx, boolean ok, String summary) {
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                android.app.NotificationChannel ch = new android.app.NotificationChannel("dsh_schedule", "定时任务",
                        android.app.NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("AI 设置的定时提醒与任务结果");
                nm.createNotificationChannel(ch);
            }
            Intent open = new Intent(ctx, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            android.app.PendingIntent pi = android.app.PendingIntent.getActivity(ctx, 0, open,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            android.app.Notification.Builder b;
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                b = new android.app.Notification.Builder(ctx, "dsh_schedule");
            } else {
                b = new android.app.Notification.Builder(ctx);
            }
            String title = ok ? "✅ 定时任务执行成功" : "❌ 定时任务执行失败";
            String text = summary != null && summary.length() > 200 ? summary.substring(0, 200) : summary;
            android.app.Notification n = b.setContentTitle(title)
                    .setContentText(text)
                    .setSmallIcon(R.drawable.ic_launcher)
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .build();
            nm.notify(ok ? 9003 : 9004, n);
        } catch (Throwable ignored) {}
    }

    /** 引擎是否已在目标端口响应，且确认是 DSH 引擎（首页含 <title>DeepSeek Harness</title>）。
     *  修复 v1.5.1：原来任意 HTTP 200-499 都算就绪，占位服务会被误判为"引擎就绪"。 */
    private static boolean engineReady(Context ctx) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("http://127.0.0.1:" + enginePort(ctx) + "/").openConnection();
            c.setConnectTimeout(1500);
            c.setReadTimeout(1500);
            int code = c.getResponseCode();
            // 批次79 修复（真机取证）：dsh 0.1.5 把首页放到 process token 门禁之后，
            // 没有 token 时首页恒 401（body = "dsh web authentication required"）。
            // 旧实现读到 401 就在 getInputStream() 抛异常 → 恒 false → 定时任务永远走
            // 「引擎未运行 → 30 秒未就绪，放弃」，任务不执行、实况窗也不发布。
            // 401 + 该文案恰恰证明「引擎在监听且确实是 DSH」（与 MainActivity.healthOk 同判据）。
            if (code == 401) {
                InputStream error = c.getErrorStream();
                if (error == null) return false;
                ByteArrayOutputStream body = new ByteArrayOutputStream();
                byte[] chunk = new byte[2048];
                int r;
                while ((r = error.read(chunk)) > 0 && body.size() < 8192) {
                    body.write(chunk, 0, r);
                }
                error.close();
                return body.toString("UTF-8").contains("dsh web authentication required");
            }
            if (code < 200 || code >= 400) return false;
            InputStream in = c.getInputStream();
            // v1.5.5 修复：首页约 14KB，<title> 在页面末尾（旧实现只读 4096 字节永远匹配不到）。
            // 读完整页（上限 256KB），与 MainActivity.isDshEngine 保持一致。
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int total = 0;
            int r;
            while ((r = in.read(chunk)) > 0 && total < 262144) {
                body.write(chunk, 0, r);
                total += r;
            }
            try { in.close(); } catch (Throwable ignored) {}
            return body.toString("UTF-8").contains("<title>DeepSeek Harness</title>");
        } catch (Throwable t) {
            return false;
        } finally {
            try { if (c != null) c.disconnect(); } catch (Throwable ignored) {}
        }
    }

    /** 启动 node 引擎（同 MainActivity.spawnNode 的环境变量；payload 必须已解压）。
     *  端口 = enginePort(ctx)，与主引擎换端口后保持一致。 */
    private static boolean startEngine(Context ctx) {
        try {
            File payload = new File(ctx.getFilesDir(), "payload");
            File node = new File(payload, "runtime/bin/node");
            // dshroot：v1.5.3 起【内部优先】（主引擎同款——内部存储读内核快，避免真机外部 FUSE
            // 2 万+ 文件 stat 风暴造成 50-60s 慢启动）；内部缺失时回退本包外部目录
            //（正式版 DeepSeekHarness / Lite DeepSeekHarnessLite），再回退另一版本目录。
            File dshroot = null;
            File internal = new File(payload, "dshroot");
            if (new File(internal, REL_BINJS).exists()) {
                dshroot = internal;
            } else {
                String selfRoot = ctx.getPackageName().contains(".beta")
                        ? "DeepSeekHarnessLite" : "DeepSeekHarness";
                String otherRoot = selfRoot.equals("DeepSeekHarnessLite") ? "DeepSeekHarness" : "DeepSeekHarnessLite";
                for (String root : new String[]{selfRoot, otherRoot}) {
                    File ext = new File(android.os.Environment.getExternalStorageDirectory(), root + "/dshroot");
                    if (new File(ext, REL_BINJS).exists()) { dshroot = ext; break; }
                }
            }
            if (dshroot == null) { log(ctx, "dshroot 未找到"); return false; }
            File binjs = new File(dshroot, REL_BINJS);
            File lib = new File(payload, "runtime/lib");
            File home = new File(payload, "dshhome");
            // 批次78：同上（定时任务走 App 内引擎时要与托管模式共用同一份会话数据）
            HostedEngineManager.linkSharedData(home, ctx);
            File bin = new File(payload, "bin");
            File tmp = new File(ctx.getCacheDir(), "tmp");
            if (!tmp.exists()) tmp.mkdirs();
            if (!node.exists()) { log(ctx, "node 缺失"); return false; }
            if (!node.canExecute()) node.setExecutable(true, false);

            ProcessBuilder pb = new ProcessBuilder(
                    node.getAbsolutePath(), "--expose-internals", binjs.getAbsolutePath(),
                    "web", "--host", "127.0.0.1", "--port", String.valueOf(enginePort(ctx)));
            java.util.Map<String, String> env = pb.environment();
            env.put("LD_LIBRARY_PATH", lib.getAbsolutePath());
            // Termux 共存修复（v1.7.4）：同 MainActivity.spawnNode——内置 node 的 OPENSSLDIR
            // 编译死为 /data/data/com.termux/files/usr，装了 Termux 时读其 openssl.cnf EACCES
            // 启动即崩。注入 OPENSSL_CONF 指向 payload 自带的可读配置；存在才注入，避免升级
            // 中途文件缺失时显式指向不存在的路径反而比原来的 ENOENT 静默更糟。
            File osslConf = new File(payload, "runtime/etc/openssl.cnf");
            if (osslConf.exists()) env.put("OPENSSL_CONF", osslConf.getAbsolutePath());
            env.put("PATH", bin.getAbsolutePath() + ":" +
                    new File(payload, "runtime/bin").getAbsolutePath() + ":/system/bin:/system/xbin");
            env.put("HOME", ctx.getFilesDir().getAbsolutePath());
            env.put("DSH_HOME", home.getAbsolutePath());
            env.put("DSH_ANDROID", "1");
            env.put("TMPDIR", tmp.getAbsolutePath());
            env.put("TERM", "xterm");
            env.put("SHIZUKU_APP_ID", ctx.getPackageName());
            // 批次95 修复：定时任务引擎此前把两条特权通道都硬编码为 0 ⇒ 插件注册期直接跳过整族特权工具
            //（android_package / android_app / android_setting / android_input / android_screenshot /
            // android_device_info / android_sms / android_chroot_* …），「到点执行」的任务拿不到 root/Shizuku
            // 能力，与主引擎行为分叉。改为与主引擎同一口径：root(su) 优先、Shizuku 兜底。
            env.put("SHIZUKU_AVAILABLE", HostedEngineManager.shizukuReady() ? "1" : "0");
            env.put("SHIZUKU_DEX", HostedEngineManager.rishDexPath(ctx));
            env.put("ROOT_AVAILABLE", HostedEngineManager.rootReady() ? "1" : "0");
            env.put("APP_NOTIFY_PORT", String.valueOf(enginePort(ctx) + 1));
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            // 日志写入 dsh-web.log
            final File logFile = new File(ctx.getFilesDir(), "dsh-web.log");
            final InputStream is = proc.getInputStream();
            new Thread(new Runnable() {
                @Override public void run() {
                    try {
                        FileOutputStream fos = new FileOutputStream(logFile, true);
                        byte[] b = new byte[4096];
                        int n;
                        while ((n = is.read(b)) > 0) { fos.write(b, 0, n); fos.flush(); }
                        fos.close();
                    } catch (Throwable ignored) {}
                }
            }, "sched-node-log").start();
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "startEngine error", t);
            return false;
        }
    }

    /** 调 DSH API 创建会话。 */
    private static String createSession(Context ctx) {
        String json = rpc(ctx, "session.create", "{}");
        if (json == null) return null;
        // 解析 result.value.sessionId 或 result.sessionId
        int i = json.indexOf("\"sessionId\":\"");
        if (i >= 0) {
            int q1 = i + "\"sessionId\":\"".length();
            int q2 = json.indexOf('"', q1);
            if (q2 > q1) return json.substring(q1, q2);
        }
        return null;
    }

    /** 调 DSH API 发送消息（返回是否被接受）。 */
    private static boolean sendPrompt(Context ctx, String sessionId, String text) {
        String payload = promptRequestJson(sessionId, text);
        String json = rpc(ctx, "session.prompt", payload);
        return json != null && json.contains("\"ok\":true");
    }

    /** 调 DSH API 发送消息，返回完整响应（诊断用）。 */
    private static String sendPromptRaw(Context ctx, String sessionId, String text) {
        String payload = promptRequestJson(sessionId, text);
        return rpc(ctx, "session.prompt", payload);
    }

    /**
     * session.prompt 的 request 体。
     *
     * <p><b>requestId 必需</b>（2026-09-19 真机实测）：缺它时引擎返回
     * {@code gateway/input-invalid … wire field "request" failed boundary validation}，
     * 即 prompt 被静默拒绝（旧实现既没有它、也没有下面的 args.request 包装）。</p>
     */
    private static String promptRequestJson(String sessionId, String text) {
        return "{\"requestId\":\"sched-" + System.currentTimeMillis() + "\",\"sessionId\":\""
                + sessionId + "\",\"mode\":\"queue\",\"content\":[{\"type\":\"text\",\"text\":\""
                + escapeJson(text) + "\"}]}";
    }

    /** 引擎会话 Cookie（dsh_prefs/engine_cookie，由 MainActivity/HostedEngineManager 的 token 交换写入）。
     *  dsh 0.1.5 起 /api 全在门禁之后：没有它 rpc 一律 401 unauthorized。 */
    private static String engineCookie(Context ctx) {
        try {
            return ctx.getSharedPreferences("dsh_prefs", Context.MODE_PRIVATE)
                    .getString("engine_cookie", null);
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * DSH RPC 调用（形状与 {@link OverlayAgentClient} 的可用实现对齐）。
     *
     * <p><b>为什么必须这样写</b>（2026-09-19 真机实测，三条独立缺陷，旧实现全部命中）：</p>
     * <ol>
     *   <li><b>端点</b>：方法名的点要换成斜杠 —— {@code /api/session/create} 才是引擎端点，
     *       {@code /api/session.create} 返回 404 {@code not found}；</li>
     *   <li><b>信封</b>：payload 必须是 {@code {"args":{"request":…}}}。直接把 request 体
     *       放在 {@code payload} 下会被 typert 边界校验拒（{@code gateway/input-invalid}）；
     *       {@code session.list} 是唯一例外，用 {@code _request}（见 OverlayAgentClient 注释）；</li>
     *   <li><b>鉴权</b>：必须带引擎会话 Cookie（{@code dsh_prefs/engine_cookie}）。dsh 0.1.5 把
     *       首页与全部 /api 放到 process token 门禁之后，无 Cookie 一律 401 {@code unauthorized}。</li>
     * </ol>
     *
     * <p>旧实现三条全错，因此定时任务在 {@code createSession} 必失败并记「创建会话失败
     * （可能未配置 API Key）」—— 文案把契约缺陷误导成用户配置问题。</p>
     */
    private static String rpc(Context ctx, String method, String payloadJson) {
        try {
            String endpoint = method.replace('.', '/');
            URL url = new URL("http://127.0.0.1:" + enginePort(ctx) + "/api/" + endpoint);
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setRequestMethod("POST");
            c.setRequestProperty("Content-Type", "application/json");
            String cookie = engineCookie(ctx);
            if (cookie != null && !cookie.isEmpty()) {
                c.setRequestProperty("Cookie", cookie);
            }
            c.setDoOutput(true);
            c.setConnectTimeout(3000);
            c.setReadTimeout(5000);
            String rpcId = "sched-" + System.currentTimeMillis();
            String request = (payloadJson == null || payloadJson.isEmpty()) ? "{}" : payloadJson;
            String argumentName = "session.list".equals(method) ? "_request" : "request";
            String body = "{\"type\":\"client-request\",\"rpcId\":\"" + rpcId + "\",\"method\":\""
                    + endpoint + "\",\"payload\":{\"args\":{\"" + argumentName + "\":" + request + "}}}";
            c.getOutputStream().write(body.getBytes("UTF-8"));
            int code = c.getResponseCode();
            if (code >= 200 && code < 300) {
                InputStream in = c.getInputStream();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] b = new byte[4096];
                int n;
                while ((n = in.read(b)) > 0) out.write(b, 0, n);
                in.close();
                c.disconnect();
                return new String(out.toByteArray(), "UTF-8");
            }
            c.disconnect();
        } catch (Throwable t) {
            Log.w(TAG, "rpc " + method + " error", t);
        }
        return null;
    }

    private static String escapeJson(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
    }

    /** 追加执行记录到外部目录（Lite 版用 DeepSeekHarnessLite，正式版用 DeepSeekHarness，便于排查）。 */
    static void log(Context ctx, String msg) {
        try {
            String rootName = ctx.getPackageName().contains(".beta")
                    ? "DeepSeekHarnessLite" : "DeepSeekHarness";
            File root = new File(android.os.Environment.getExternalStorageDirectory(), rootName);
            if (!root.exists()) root.mkdirs();
            File f = new File(root, "scheduled-log.txt");
            FileOutputStream fos = new FileOutputStream(f, true);
            String line = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date()) + " " + msg + "\n";
            fos.write(line.getBytes("UTF-8"));
            fos.close();
        } catch (Throwable ignored) {}
    }
}
