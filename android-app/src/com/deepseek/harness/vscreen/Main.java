package com.deepseek.harness.vscreen;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.view.KeyEvent;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Looper;
import android.os.Process;
import android.view.Surface;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.json.JSONObject;

/**
 * 虚拟屏特权服务端（app_process / shell 身份，由 Shizuku 或 root 拉起）。
 *
 * 为什么必须是特权进程：App 身份建出来的虚拟屏既不能承载外部 App
 * （startActivityAsUser 会因 launchDisplayId 被 SafeActivityOptions.checkPermissions 拒绝），
 * 也无法把外部 App 画面渲染进自己的 display。shell 身份没有这两个限制。
 *
 * 对外只提供 HTTP（默认 8998），由 App 内 VsreenBridgeService 代理到插件用的 8999。
 * 所有能力都来自公开 API + 反射常量，不使用 MediaProjection（那只是主屏镜像，且需要用户授权弹窗）。
 */
public class Main {

    private static final String TAG = "ShowerMain";

    /**
     * 服务端构建指纹。
     * App 侧 VsreenBridgeService.EXPECTED_CORE_BUILD 必须与此一致：
     * 不一致就会杀掉旧 core 重新拉起（旧进程偷生会让新路由/新参数静默失效）。
     */
    // ⚠ 改过任何影响对外行为的核心代码（路由 / 参数 / 尺寸归一化等）都必须同时升这个值：
    // 只改代码不升指纹，App 就判不出"跑的是旧 core"，改动会静默失效。
    static final String BUILD = "b12";

    private static final int DEFAULT_PORT = 8998;
    private static final String LOG_PATH = "/data/local/tmp/vscreen.log";

    /** JSON 应答统一 Content-Type。 */
    private static final String CT_JSON = "application/json; charset=utf-8";

    /** 预览帧最大边（服务端缩放后再 JPEG，避免把 720x1520 原图传给 App）。 */
    private static final int PREVIEW_MAX_WIDTH = 360;
    private static final int PREVIEW_JPEG_QUALITY = 70;

    /** 帧泵节流：屏幕静止时不空转烧 CPU，动起来时最多约 20fps 刷新。 */
    private static final long PUMP_IDLE_SLEEP_MS = 30;

    /** S3 overlay：settings put 后轮询 dumpsys display 等新 display 的超时与间隔。 */
    private static final long OVERLAY_POLL_TIMEOUT_MS = 10000;
    private static final long OVERLAY_POLL_INTERVAL_MS = 400;

    private static Context sContext;
    private static int sPort = DEFAULT_PORT;
    private static String sToken;
    private static String sPidFile;
    private static long sStartMs;

    private static final ConcurrentHashMap<Integer, Session> sSessions = new ConcurrentHashMap<>();
    private static final AtomicInteger sDisplaySeq = new AtomicInteger(0);
    private static volatile int sCurrentDisplayId = -1;
    /** 当前会话策略：trusted | plain | overlay；无会话 = null（契约 §1 /health 形状）。 */
    private static volatile String sStrategy;
    /** 当前会话尺寸（VDM 与 overlay 会话统一记录，单会话复用判断用）。 */
    private static volatile int sCurW;
    private static volatile int sCurH;
    /** S3 overlay：settings 改前值（null = 原本未设置）与改前 displayId 基线（超时/关闭时还原）。 */
    private static String sOverlayOriginal;
    private static Set<Integer> sOverlayBaseline = new HashSet<>();

    public static void main(String[] args) {
        Looper.prepareMainLooper();
        parseArgs(args);
        sStartMs = System.currentTimeMillis();
        writePidFile();
        log("server starting uid=" + Process.myUid() + " sdk=" + Build.VERSION.SDK_INT
                + " brand=" + Build.BRAND + " port=" + sPort, null);

        try {
            sContext = FakeContext.get();
            log("FakeContext ready (package=" + sContext.getPackageName() + ")", null);
        } catch (Throwable t) {
            log("FakeContext init failed, 虚拟屏不可用", t);
        }

        try {
            startHttpServer();
        } catch (Throwable t) {
            log("HTTP 服务启动失败", t);
            return;
        }

        try {
            Looper.loop();
        } catch (Throwable t) {
            log("Looper.loop 退出", t);
        }
    }

    private static void parseArgs(String[] args) {
        if (args == null) {
            return;
        }
        for (int i = 0; i < args.length; i++) {
            String a = args[i];
            if ("--port".equals(a) && i + 1 < args.length) {
                try {
                    sPort = Integer.parseInt(args[++i].trim());
                } catch (Throwable ignored) {
                }
            } else if ("--token".equals(a) && i + 1 < args.length) {
                sToken = args[++i].trim();
            } else if ("--pidfile".equals(a) && i + 1 < args.length) {
                sPidFile = args[++i].trim();
            }
        }
    }

    /** 契约 §1：启动即写 pidfile，单行 JSON {"pid":N,"uid":N,"version":"b12"}。 */
    private static void writePidFile() {
        if (sPidFile == null || sPidFile.length() == 0) {
            return;
        }
        try {
            File pf = new File(sPidFile);
            File parent = pf.getParentFile();
            if (parent != null && !parent.exists()) {
                parent.mkdirs();
            }
            String json = "{\"pid\":" + Process.myPid() + ",\"uid\":" + Process.myUid()
                    + ",\"version\":\"" + BUILD + "\"}";
            FileOutputStream fos = new FileOutputStream(pf, false);
            fos.write((json + "\n").getBytes("UTF-8"));
            fos.flush();
            fos.close();
            log("pidfile 已写入: " + sPidFile + " -> " + json, null);
        } catch (Throwable t) {
            log("pidfile 写入失败: " + sPidFile, t);
        }
    }

    // ==================== 会话（一个虚拟屏 = 一个 ImageReader + 帧泵） ====================

    private static final class Session {
        final int displayId;
        final int width;
        final int height;
        final VirtualDisplay virtualDisplay;
        final ImageReader reader;

        final Object frameLock = new Object();
        Bitmap frame;             // 最新一帧（复用，读取方必须持锁拷贝）
        long frameTs;
        volatile boolean pumping = true;
        volatile boolean sawFrame = false;

        Session(int displayId, int width, int height, VirtualDisplay vd, ImageReader reader) {
            this.displayId = displayId;
            this.width = width;
            this.height = height;
            this.virtualDisplay = vd;
            this.reader = reader;
        }

        void release() {
            pumping = false;
            synchronized (frameLock) {
                if (frame != null) {
                    frame.recycle();
                    frame = null;
                }
            }
            try {
                virtualDisplay.release();
            } catch (Throwable t) {
                log("virtualDisplay.release 失败: " + t.getMessage(), null);
            }
            try {
                reader.close();
            } catch (Throwable t) {
                log("reader.close 失败: " + t.getMessage(), null);
            }
        }
    }

    /**
     * 帧泵：持续 acquireLatestImage 并保存最新帧。
     * ImageReader 只有在被 acquire 后才会继续交付新帧，所以必须常驻消费；
     * 屏幕静止时没有新帧，靠缓存的最后一帧对外服务。
     */
    private static void startFramePump(final Session s) {
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                int consecutiveNull = 0;
                while (s.pumping) {
                    Image img = null;
                    try {
                        img = s.reader.acquireLatestImage();
                    } catch (Throwable t2) {
                        log("acquireLatestImage 异常: " + t2.getMessage(), null);
                    }
                    if (img == null) {
                        consecutiveNull++;
                        try {
                            Thread.sleep(consecutiveNull > 20 ? 60 : PUMP_IDLE_SLEEP_MS);
                        } catch (InterruptedException e) {
                            return;
                        }
                        continue;
                    }
                    consecutiveNull = 0;
                    try {
                        copyImageToSession(s, img);
                        s.sawFrame = true;
                        s.frameTs = System.currentTimeMillis();
                    } catch (Throwable t2) {
                        log("copyImageToSession 异常: " + t2.getMessage(), null);
                    } finally {
                        try {
                            img.close();
                        } catch (Throwable ignored) {
                        }
                    }
                }
            }
        }, "vscreen-pump-" + s.displayId);
        t.setDaemon(true);
        t.start();
    }

    private static void copyImageToSession(Session s, Image img) {
        int w = img.getWidth();
        int h = img.getHeight();
        Image.Plane plane = img.getPlanes()[0];
        ByteBuffer buf = plane.getBuffer();
        int pixelStride = plane.getPixelStride();
        int rowStride = plane.getRowStride();
        int rowPadding = rowStride - pixelStride * w;
        buf.rewind();

        synchronized (s.frameLock) {
            // rowStride == pixelStride * width 时（本机实测 2880 == 4*720）可直接复用同一张 Bitmap，
            // 否则带 padding 的帧复制进复用的 Bitmap 会整体错位，只能另建带 padding 宽度的 Bitmap。
            if (rowPadding == 0 && pixelStride == 4) {
                if (s.frame == null || s.frame.getWidth() != w || s.frame.getHeight() != h
                        || s.frame.isRecycled()) {
                    if (s.frame != null) {
                        s.frame.recycle();
                    }
                    s.frame = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                }
                s.frame.copyPixelsFromBuffer(buf);
            } else {
                Bitmap padded = Bitmap.createBitmap(w + rowPadding / Math.max(1, pixelStride), h,
                        Bitmap.Config.ARGB_8888);
                padded.copyPixelsFromBuffer(buf);
                Bitmap cropped = Bitmap.createBitmap(padded, 0, 0, w, h);
                padded.recycle();
                if (s.frame != null) {
                    s.frame.recycle();
                }
                s.frame = cropped;
            }
        }
    }

    private static Bitmap snapshotFrame(Session s) {
        synchronized (s.frameLock) {
            if (s.frame == null || s.frame.isRecycled()) {
                return null;
            }
            return s.frame.copy(Bitmap.Config.ARGB_8888, false);
        }
    }

    // ==================== 建屏 ====================

    private static int flag(String name) {
        try {
            Field f = DisplayManager.class.getField(name);
            return f.getInt(null);
        } catch (Throwable t) {
            return 0;
        }
    }

    // ==================== 尺寸归一化：只允许 9:16（竖）/ 16:9（横）====================
    /** 最短边取 144(=9×16) 的倍数：长边 = 短边×16/9 时两个方向都自然 16 对齐，比例精确。 */
    private static int normalizeShortEdge(int requested) {
        int v = requested > 0 ? requested : 1008; // 默认 1008×1792（≈FHD 竖屏）
        int units = Math.round(v / 144f);
        if (units < 1) units = 1;
        if (units > 10) units = 10; // 上限 1440 → 1440×2560
        return units * 144;
    }

    /**
     * 把请求宽高归一成手机比例：宽>高 → 16:9 横屏，否则 9:16 竖屏。
     * 这样预览小窗（按虚拟屏宽高比自适应高度）始终是正常手机的竖屏/横屏比例，
     * 不会出现 1520×720 这类 19:9 的怪比例。
     * @param w - 请求宽度（≤0 → 用默认竖屏短边）
     * @param h - 请求高度
     * @returns {宽, 高}
     */
    private static int[] toPhoneSize(int w, int h) {
        boolean hasRequest = w > 0 || h > 0;
        boolean landscape = hasRequest && w > h;
        int shortReq = 0;
        if (hasRequest) {
            int ww = w > 0 ? w : h;
            int hh = h > 0 ? h : w;
            shortReq = Math.min(ww, hh);
        }
        int shortEdge = normalizeShortEdge(shortReq);
        int longEdge = shortEdge * 16 / 9;
        return landscape ? new int[]{longEdge, shortEdge} : new int[]{shortEdge, longEdge};
    }

    /**
     * 契约 §1 三级建屏阶梯（全部在服务端，单会话）：
     * S1 = 上游 v1.11 全量 flags（含 TRUSTED）→ 失败存 detail →
     * S2 = 同 flags 去 TRUSTED → 仍失败且 allowOverlay!==false →
     * S3 = overlay 模拟副屏（settings put overlay_display_devices + dumpsys 轮询）。
     */
    private static synchronized String createDisplay(int reqW, int reqH, int reqDpi, boolean allowOverlay) {
        // 批次66 修复（真机症状「虚拟屏销毁重建再销毁」的一个直接来源）：
        // 请求未指定尺寸时（插件自愈建屏固定发 {}），旧实现会把它归一化成默认 1008x1792，
        // 与「本轮用显式尺寸建好的现有 display」不等 → closeDisplay() 销毁重建。
        // 于是「agent 建屏（显式尺寸）→ 插件自愈/模型重试建屏（{}）→ 再建屏」会反复销毁重建，
        // 用户看到的就是虚拟屏被来回销毁重建，任务期间画面/会话全部中断。
        // 新语义：未指定尺寸 = 「沿用现有会话」，绝不因为默认值不同而拆掉正在跑的 display。
        boolean sizeSpecified = reqW > 0 || reqH > 0;
        if (sCurrentDisplayId >= 0 && !sizeSpecified) {
            log("create 未指定尺寸 → 复用现有 display " + sCurrentDisplayId
                    + " " + sCurW + "x" + sCurH, null);
            return "{\"ok\":true,\"displayId\":" + sCurrentDisplayId
                    + ",\"strategy\":\"" + sStrategy + "\",\"reused\":true}";
        }
        int[] phone = toPhoneSize(reqW, reqH);
        reqW = phone[0];
        reqH = phone[1];
        // 单会话复用：同尺寸请求直接返回当前 display（VDM / overlay 通吃）
        if (sCurrentDisplayId >= 0 && reqW == sCurW && reqH == sCurH) {
            return "{\"ok\":true,\"displayId\":" + sCurrentDisplayId
                    + ",\"strategy\":\"" + sStrategy + "\"}";
        }
        if (sCurrentDisplayId >= 0) {
            // 尺寸/朝向变了：必须重建，否则横竖屏切换会被静默忽略（曾表现为“尺寸永远 720x1520”）
            log("create 请求 " + reqW + "x" + reqH + " 与现有 " + sCurW + "x" + sCurH
                    + " 不同 → 重建", null);
            closeDisplay();
        }

        int w = reqW;
        int h = reqH;
        int d = reqDpi > 0 ? reqDpi : 320;

        // 上游 v1.11 flags 基座（TRUSTED 单独拆出供 S1/S2 差分）
        int baseFlags = flag("VIRTUAL_DISPLAY_FLAG_PUBLIC")
                | flag("VIRTUAL_DISPLAY_FLAG_PRESENTATION")
                | flag("VIRTUAL_DISPLAY_FLAG_OWN_CONTENT_ONLY")
                | flag("VIRTUAL_DISPLAY_FLAG_SUPPORTS_TOUCH")
                | flag("VIRTUAL_DISPLAY_FLAG_ROTATES_WITH_CONTENT")
                | flag("VIRTUAL_DISPLAY_FLAG_DESTROY_CONTENT_ON_REMOVAL");
        if (Build.VERSION.SDK_INT >= 33) {
            baseFlags |= flag("VIRTUAL_DISPLAY_FLAG_OWN_DISPLAY_GROUP")
                    | flag("VIRTUAL_DISPLAY_FLAG_ALWAYS_UNLOCKED")
                    | flag("VIRTUAL_DISPLAY_FLAG_TOUCH_FEEDBACK_DISABLED");
        }
        if (Build.VERSION.SDK_INT >= 34) {
            baseFlags |= flag("VIRTUAL_DISPLAY_FLAG_OWN_FOCUS")
                    | flag("VIRTUAL_DISPLAY_FLAG_DEVICE_DISPLAY_GROUP");
        }

        String vdmDetail = null;
        if (sContext != null) {
            // S1：上游 v1.11 全量 flags（含 TRUSTED）——uid 0 / 宽容 ROM 一次过
            try {
                Session s = createVdmSession(w, h, d, baseFlags | flag("VIRTUAL_DISPLAY_FLAG_TRUSTED"));
                registerSession(s, d, "trusted");
                return "{\"ok\":true,\"displayId\":" + s.displayId + ",\"strategy\":\"trusted\"}";
            } catch (Throwable t) {
                vdmDetail = "S1(trusted): " + t;
                log("S1 建屏失败", t);
            }
            // S2：同 flags 去 TRUSTED（不触发 ADD_TRUSTED_DISPLAY 权限检查）
            try {
                Session s = createVdmSession(w, h, d, baseFlags);
                registerSession(s, d, "plain");
                return "{\"ok\":true,\"displayId\":" + s.displayId + ",\"strategy\":\"plain\"}";
            } catch (Throwable t) {
                vdmDetail = vdmDetail + " | S2(plain): " + t;
                log("S2 建屏失败", t);
            }
        } else {
            vdmDetail = "特权进程 Context 初始化失败（Shizuku/root 通道不可用）";
        }

        // S3：overlay 模拟副屏（请求 allowOverlay!==false 时；服务端已是特权 uid，无需 su）
        if (allowOverlay) {
            String overlayErr = createOverlayDisplay(w, h, d);
            if (overlayErr == null) {
                return "{\"ok\":true,\"displayId\":" + sCurrentDisplayId + ",\"strategy\":\"overlay\"}";
            }
            return fail("OVERLAY_FAILED",
                    vdmDetail == null ? overlayErr : vdmDetail + " | S3(overlay): " + overlayErr);
        }
        return fail("VDM_DENIED",
                vdmDetail == null ? "建屏失败（未启用 overlay 回退）" : vdmDetail + "（allowOverlay=false）");
    }

    /** 上游 v1.11 建屏逻辑原样抽取（ImageReader + 反射 createVirtualDisplay），按传入 flags 抛出失败。 */
    private static Session createVdmSession(int w, int h, int d, int flags) throws Throwable {
        ImageReader reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2);
        try {
            Surface surface = reader.getSurface();

            Constructor<DisplayManager> ctor =
                    DisplayManager.class.getDeclaredConstructor(Context.class);
            ctor.setAccessible(true);
            DisplayManager dm = ctor.newInstance(sContext);

            String name = "DSHVscreen-" + sDisplaySeq.incrementAndGet();
            VirtualDisplay vd = dm.createVirtualDisplay(name, w, h, d, surface, flags);
            if (vd == null || vd.getDisplay() == null) {
                throw new IllegalStateException("createVirtualDisplay 返回空 display");
            }
            return new Session(vd.getDisplay().getDisplayId(), w, h, vd, reader);
        } catch (Throwable t) {
            try {
                reader.close();
            } catch (Throwable ignored) {
            }
            throw t;
        }
    }

    /** S1/S2 成功后的会话登记（displayId/策略/尺寸/帧泵）。 */
    private static void registerSession(Session s, int dpi, String strategy) {
        sSessions.put(s.displayId, s);
        sCurrentDisplayId = s.displayId;
        sStrategy = strategy;
        sCurW = s.width;
        sCurH = s.height;
        startFramePump(s);
        log("建屏成功 displayId=" + s.displayId + " " + s.width + "x" + s.height + " dpi=" + dpi
                + " strategy=" + strategy, null);
    }

    private static synchronized String closeDisplay() {
        boolean restored = false;
        if ("overlay".equals(sStrategy)) {
            restored = restoreOverlaySetting();
        }
        int id = sCurrentDisplayId;
        sCurrentDisplayId = -1;
        sStrategy = null;
        sCurW = 0;
        sCurH = 0;
        Session s = id >= 0 ? sSessions.remove(id) : null;
        if (s != null) {
            s.release();
            log("已释放 displayId=" + id, null);
        }
        return "{\"ok\":true,\"restoredOverlay\":" + restored + "}";
    }

    /**
     * S3：overlay 模拟副屏（契约 §1 三级阶梯第三级）。
     * 服务端已是特权 uid（root/shell），直接 Runtime.exec settings/dumpsys，无需 su。
     * 先记 overlay_display_devices 改前值 → put 新值 → 轮询 dumpsys display 差分出新 displayId；
     * 失败/超时必须还原原值。返回 null = 成功（sCurrentDisplayId 已指向新屏）；非 null = 失败 detail。
     */
    private static String createOverlayDisplay(int w, int h, int dpi) {
        try {
            String got = execOut("/system/bin/settings", "get", "global", "overlay_display_devices");
            sOverlayOriginal = (got == null || got.length() == 0 || "null".equals(got)) ? null : got;
            sOverlayBaseline = collectDisplayIds();

            String putOut = execCapture("/system/bin/settings", "put", "global",
                    "overlay_display_devices", w + "x" + h + "/" + dpi);
            if (!putOut.startsWith("exit=0")) {
                restoreOverlaySetting();
                return "settings put overlay_display_devices 失败: " + putOut;
            }

            long deadline = System.currentTimeMillis() + OVERLAY_POLL_TIMEOUT_MS;
            while (System.currentTimeMillis() < deadline) {
                Integer fresh = firstNewDisplayId(sOverlayBaseline);
                if (fresh != null) {
                    sCurrentDisplayId = fresh;
                    sStrategy = "overlay";
                    sCurW = w;
                    sCurH = h;
                    log("overlay 建屏成功 displayId=" + fresh + " " + w + "x" + h + " dpi=" + dpi, null);
                    return null;
                }
                Thread.sleep(OVERLAY_POLL_INTERVAL_MS);
            }
            // 超时：还原原值（契约 §1：超时 → OVERLAY_FAILED，需还原原值）
            restoreOverlaySetting();
            return "轮询 dumpsys display 超时（" + OVERLAY_POLL_TIMEOUT_MS
                    + "ms）未发现新 overlay display";
        } catch (Throwable t) {
            restoreOverlaySetting();
            return "overlay 建屏异常: " + t;
        }
    }

    /** 还原 overlay_display_devices 改前值（原本未设置 → settings delete）。返回是否还原成功。 */
    private static boolean restoreOverlaySetting() {
        String original = sOverlayOriginal;
        sOverlayOriginal = null;
        String out;
        if (original == null) {
            out = execCapture("/system/bin/settings", "delete", "global", "overlay_display_devices");
        } else {
            out = execCapture("/system/bin/settings", "put", "global", "overlay_display_devices", original);
        }
        boolean restored = out.startsWith("exit=0");
        log("还原 overlay_display_devices (" + (original == null ? "<delete>" : original)
                + ") -> " + out, null);
        return restored;
    }

    /** 解析 dumpsys display，收集现有逻辑 displayId（mDisplayId=N 与 "Display N:"/"Display N=" 两种形态）。 */
    private static Set<Integer> collectDisplayIds() {
        Set<Integer> ids = new HashSet<>();
        String out = execOut("/system/bin/dumpsys", "display");
        if (out == null) {
            return ids;
        }
        Matcher m = Pattern.compile("mDisplayId=(\\d+)").matcher(out);
        while (m.find()) {
            ids.add(Integer.parseInt(m.group(1)));
        }
        m = Pattern.compile("Display (\\d+)[:=]").matcher(out);
        while (m.find()) {
            ids.add(Integer.parseInt(m.group(1)));
        }
        return ids;
    }

    /** 差分找新出现的非主屏 displayId（overlay 建屏识别；0 = 默认屏，永不属于新屏）。 */
    private static Integer firstNewDisplayId(Set<Integer> baseline) {
        for (Integer id : collectDisplayIds()) {
            if (id > 0 && !baseline.contains(id)) {
                return id;
            }
        }
        return null;
    }

    private static Session currentSession() {
        int id = sCurrentDisplayId;
        return id >= 0 ? sSessions.get(id) : null;
    }

    // ==================== 启动 App 到虚拟屏 ====================

    private static String execCapture(String... cmd) {
        try {
            java.lang.Process p = Runtime.getRuntime().exec(cmd);
            StringBuilder sb = new StringBuilder();
            BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()));
            String line;
            while ((line = r.readLine()) != null) {
                sb.append(line).append('\n');
            }
            r = new BufferedReader(new InputStreamReader(p.getErrorStream()));
            while ((line = r.readLine()) != null) {
                sb.append(line).append('\n');
            }
            int code = p.waitFor();
            return "exit=" + code + " " + sb.toString().trim();
        } catch (Throwable t) {
            return "exec失败: " + t;
        }
    }

    /** 执行命令并返回 stdout（trim 后），stderr 丢弃；失败返回 null（settings get / dumpsys 用）。 */
    private static String execOut(String... cmd) {
        try {
            java.lang.Process p = Runtime.getRuntime().exec(cmd);
            StringBuilder sb = new StringBuilder();
            BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()));
            String line;
            while ((line = r.readLine()) != null) {
                sb.append(line).append('\n');
            }
            byte[] sink = new byte[4096];
            InputStream err = p.getErrorStream();
            while (err.read(sink) != -1) {
                // 丢弃 stderr，避免管道写满阻塞
            }
            p.waitFor();
            return sb.toString().trim();
        } catch (Throwable t) {
            return null;
        }
    }

    /** 执行命令并捕获 stdout 原始字节（screencap -d 的 PNG 用）；退出码非 0 或异常返回 null。 */
    private static byte[] execCaptureBytes(String[] cmd) {
        try {
            java.lang.Process p = Runtime.getRuntime().exec(cmd);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            InputStream in = p.getInputStream();
            int n;
            while ((n = in.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            InputStream err = p.getErrorStream();
            while (err.read(buf) != -1) {
                // 丢弃 stderr，避免管道写满阻塞
            }
            int code = p.waitFor();
            if (code != 0) {
                log("execCaptureBytes " + cmd[0] + " exit=" + code, null);
                return null;
            }
            return bos.toByteArray();
        } catch (Throwable t) {
            log("execCaptureBytes 失败", t);
            return null;
        }
    }

    /** 按关键字匹配已安装第三方应用包名（取最短命中，避免匹配到同名子包）。 */
    private static String matchPackage(String keyword) {
        String out = execCapture("/system/bin/cmd", "package", "list", "packages", "-3");
        String lower = keyword.toLowerCase(Locale.US);
        String best = null;
        for (String line : out.split("\n")) {
            int i = line.indexOf("package:");
            if (i < 0) {
                continue;
            }
            String p = line.substring(i + 8).trim();
            if (p.isEmpty()) {
                continue;
            }
            if (p.toLowerCase(Locale.US).contains(lower)
                    && (best == null || p.length() < best.length())) {
                best = p;
            }
        }
        return best;
    }

    private static String launchApp(String pkg, String activity) {
        int id = sCurrentDisplayId;
        if (id < 0) {
            return fail("NOT_CREATED", "虚拟屏未创建，请先调用 /vscreen/create");
        }
        if (pkg == null || pkg.trim().isEmpty()) {
            return fail("INVALID_ARGUMENT", "缺少 packageName 参数");
        }
        pkg = pkg.trim();

        // 契约可选参数 activity：显式组件名直接交给 am start（".Foo" 简写由 am 展开）
        if (activity != null && activity.trim().length() > 0) {
            String out = execCapture("/system/bin/am", "start", "--display", String.valueOf(id),
                    "-n", pkg + "/" + activity.trim());
            log("launch " + pkg + "/" + activity.trim() + " on " + id + " : " + out, null);
            if (out.contains("Error:") || out.startsWith("exec失败")) {
                return fail("LAUNCH_FAILED", "启动失败：" + out.replace("\n", " "));
            }
            return "{\"ok\":true}";
        }

        // ——以下为上游 v1.11 原样机制：应用名匹配 + resolve-activity 解析组件——
        // AI 常直接说应用名（如"微信"）：不是完整包名时先用已安装应用列表做唯一/最短匹配。
        if (!pkg.contains(".")) {
            String matched = matchPackage(pkg);
            if (matched != null) {
                log("launch 包名解析: " + pkg + " -> " + matched, null);
                pkg = matched;
            }
        }

        // am start 只能用组件名（-p 在 Android 15 上解析失败，实测），先解析启动组件。
        String resolved = execCapture("/system/bin/cmd", "package", "resolve-activity", "--brief", pkg);
        String component = null;
        for (String line : resolved.split("\n")) {
            line = line.trim();
            if (line.contains("/") && line.startsWith(pkg)) {
                component = line;
            }
        }
        if (component == null) {
            log("launch 解析组件失败: " + resolved, null);
            return fail("LAUNCH_FAILED", "无法解析启动组件：" + pkg
                    + "（" + resolved.replace("\n", " ") + "）");
        }

        String out = execCapture("/system/bin/am", "start", "--display", String.valueOf(id),
                "-n", component);
        log("launch " + pkg + " -> " + component + " on " + id + " : " + out, null);
        if (out.contains("Error:") || out.startsWith("exec失败")) {
            return fail("LAUNCH_FAILED", "启动失败：" + out.replace("\n", " "));
        }
        return "{\"ok\":true}";
    }

    // ==================== 截图 / 预览 ====================

    /** see 结果：png != null = 成功；否则 reason/detail 为契约 §3 失败语义。 */
    private static final class SeeResult {
        final byte[] png;
        final String reason;
        final String detail;

        SeeResult(byte[] png, String reason, String detail) {
            this.png = png;
            this.reason = reason;
            this.detail = detail;
        }
    }

    /** 契约 §1：/vscreen/see → image/png（无 display → 404 NOT_CREATED）。 */
    private static SeeResult see() {
        int id = sCurrentDisplayId;
        if (id < 0) {
            return new SeeResult(null, "NOT_CREATED", "虚拟屏未创建，请先调用 /vscreen/create");
        }
        // S3 overlay：没有 ImageReader 面，用 screencap -d（契约 §1）
        if ("overlay".equals(sStrategy)) {
            byte[] png = execCaptureBytes(
                    new String[]{"/system/bin/screencap", "-d", String.valueOf(id)});
            if (png == null || png.length == 0) {
                return new SeeResult(null, "SESSION_DEAD",
                        "screencap -d " + id + " 失败（display 可能已失效）");
            }
            return new SeeResult(png, null, null);
        }
        // S1/S2：上游 ImageReader 帧泵最新帧
        Session s = currentSession();
        if (s == null) {
            return new SeeResult(null, "NOT_CREATED", "虚拟屏未创建，请先调用 /vscreen/create");
        }
        Bitmap bmp = snapshotFrame(s);
        if (bmp == null) {
            return new SeeResult(null, "DISPLAY_TIMEOUT", "虚拟屏暂无画面（App 尚未渲染或屏幕刚创建）");
        }
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 100, bos);
            return new SeeResult(bos.toByteArray(), null, null);
        } catch (Throwable t) {
            log("PNG 编码失败", t);
            return new SeeResult(null, "CREATE_FAILED", "PNG 编码失败: " + t);
        } finally {
            bmp.recycle();
        }
    }

    /** 契约 §1：/vscreen/preview → {"ok":true,"jpegBase64":…,"w":N,"h":N}（缩放 JPEG，上游同款缩放）。 */
    private static String preview() {
        int id = sCurrentDisplayId;
        if (id < 0) {
            return fail("NOT_CREATED", "虚拟屏未创建");
        }
        Bitmap bmp;
        if ("overlay".equals(sStrategy)) {
            // S3：screencap -d 出 PNG → 解码 → 缩放转 JPEG（android.graphics 可用）
            byte[] png = execCaptureBytes(
                    new String[]{"/system/bin/screencap", "-d", String.valueOf(id)});
            if (png == null || png.length == 0) {
                return fail("SESSION_DEAD", "screencap -d " + id + " 失败（display 可能已失效）");
            }
            bmp = BitmapFactory.decodeByteArray(png, 0, png.length);
            if (bmp == null) {
                return fail("SESSION_DEAD", "screencap PNG 解码失败");
            }
        } else {
            Session s = currentSession();
            if (s == null) {
                return fail("NOT_CREATED", "虚拟屏未创建");
            }
            bmp = snapshotFrame(s);
            if (bmp == null) {
                return fail("DISPLAY_TIMEOUT", "虚拟屏暂无画面（App 尚未渲染或屏幕刚创建）");
            }
        }
        Bitmap scaled = null;
        try {
            int pw = Math.min(PREVIEW_MAX_WIDTH, bmp.getWidth());
            int ph = Math.max(1, Math.round(bmp.getHeight() * (pw / (float) bmp.getWidth())));
            scaled = Bitmap.createScaledBitmap(bmp, pw, ph, true);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            scaled.compress(Bitmap.CompressFormat.JPEG, PREVIEW_JPEG_QUALITY, bos);
            String b64 = android.util.Base64.encodeToString(bos.toByteArray(), android.util.Base64.NO_WRAP);
            return "{\"ok\":true,\"jpegBase64\":\"" + b64 + "\",\"w\":" + pw + ",\"h\":" + ph + "}";
        } catch (Throwable t) {
            return fail("CREATE_FAILED", "预览编码失败: " + t);
        } finally {
            bmp.recycle();
            if (scaled != null) {
                scaled.recycle();
            }
        }
    }

    // ==================== 输入注入 ====================

    /** 上游 v1.11 机制原样：input -d <displayId>（VDM 与 overlay display 通吃）。 */
    private static String input(String action, String... args) {
        int id = sCurrentDisplayId;
        if (id < 0) {
            return fail("NOT_CREATED", "虚拟屏未创建，请先调用 /vscreen/create");
        }
        String[] cmd = new String[4 + args.length];
        cmd[0] = "/system/bin/input";
        cmd[1] = "-d";
        cmd[2] = String.valueOf(id);
        cmd[3] = action;
        System.arraycopy(args, 0, cmd, 4, args.length);
        String out = execCapture(cmd);
        if (!out.startsWith("exit=0")) {
            log("input " + action + " 失败: " + out, null);
            return fail("INJECT_FAILED", "注入失败：" + out.replace("\n", " "));
        }
        return "{\"ok\":true}";
    }

    // ==================== 健康检查 ====================

    /** 契约 §1 /health：pid/uid/version/displayId/strategy/uptimeMs。 */
    private static String health() {
        int id = sCurrentDisplayId;
        String strategy = sStrategy;
        return "{\"ok\":true,\"pid\":" + Process.myPid()
                + ",\"uid\":" + Process.myUid()
                + ",\"version\":\"" + BUILD + "\""
                + ",\"displayId\":" + (id >= 0 ? String.valueOf(id) : "null")
                + ",\"strategy\":" + (strategy == null ? "null" : "\"" + strategy + "\"")
                + ",\"uptimeMs\":" + (System.currentTimeMillis() - sStartMs) + "}";
    }

    // ==================== HTTP ====================

    private static void startHttpServer() throws IOException {
        final ServerSocket ss = new ServerSocket(sPort, 16, InetAddress.getByName("127.0.0.1"));
        log("HTTP listening on 127.0.0.1:" + sPort, null);
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                while (true) {
                    try {
                        final Socket sock = ss.accept();
                        // 具名类而非嵌套匿名类：d8 8.2 在 "匿名类内再套匿名类" 的 class 上会内部 NPE。
                        new Thread(new ConnRunner(sock), "vscreen-http").start();
                    } catch (Throwable e) {
                        log("accept 失败: " + e.getMessage(), null);
                    }
                }
            }
        }, "vscreen-http-accept");
        t.setDaemon(true);
        t.start();
    }

    /** 单连接处理线程（具名类，见 startHttpServer 注释）。 */
    private static final class ConnRunner implements Runnable {
        private final Socket sock;

        ConnRunner(Socket sock) {
            this.sock = sock;
        }

        @Override
        public void run() {
            handle(sock);
        }
    }

    private static void handle(Socket sock) {
        try {
            sock.setSoTimeout(15000);
            InputStream is = sock.getInputStream();
            String head = readHead(is);

            // 解析请求行 + 请求头：取 X-DSH-TOKEN（契约鉴权）与 Content-Length（POST body）
            String requestLine = "";
            String token = null;
            int contentLength = 0;
            for (String line : head.split("\r\n|\n")) {
                if (requestLine.length() == 0) {
                    if (!line.trim().isEmpty()) {
                        requestLine = line.trim();
                    }
                    continue;
                }
                int colon = line.indexOf(':');
                if (colon <= 0) {
                    continue;
                }
                String name = line.substring(0, colon).trim();
                String value = line.substring(colon + 1).trim();
                if ("x-dsh-token".equalsIgnoreCase(name)) {
                    token = value;
                } else if ("content-length".equalsIgnoreCase(name)) {
                    try {
                        contentLength = Integer.parseInt(value);
                    } catch (Throwable ignored) {
                    }
                }
            }

            String path = "";
            String query = "";
            String[] parts = requestLine.split(" ");
            if (parts.length >= 2) {
                String target = parts[1];
                int q = target.indexOf('?');
                path = q >= 0 ? target.substring(0, q) : target;
                query = q >= 0 ? target.substring(q + 1) : "";
            }

            long started = System.currentTimeMillis();

            // 契约 §1：所有请求必须带 X-DSH-TOKEN；不符 → 403 BAD_TOKEN
            //（--token 未配置 = 启动参数缺失，同样拒绝：宁拒不漏）
            if (sToken == null || sToken.length() == 0 || !sToken.equals(token)) {
                respond(sock, 403, CT_JSON,
                        "{\"ok\":false,\"reason\":\"BAD_TOKEN\"}".getBytes("UTF-8"));
                return;
            }

            // POST JSON body（契约 §1 请求形态）；空 body = 全缺省参数
            String rawBody = readBody(is, contentLength);
            JSONObject json = null;
            if (rawBody != null && rawBody.trim().length() > 0) {
                try {
                    json = new JSONObject(rawBody);
                } catch (Throwable t) {
                    respond(sock, 400, CT_JSON,
                            fail("INVALID_ARGUMENT", "请求体不是合法 JSON: " + t).getBytes("UTF-8"));
                    return;
                }
            }

            int code = 200;
            String contentType = CT_JSON;
            byte[] bytes;

            if ("/health".equals(path)) {
                bytes = health().getBytes("UTF-8");
            } else if ("/vscreen/create".equals(path)) {
                // 参数优先级：JSON body（契约）→ query（上游兼容），全可省
                bytes = createDisplay(
                        jInt(json, "width", qIntEither(query, "w", "width", 0)),
                        jInt(json, "height", qIntEither(query, "h", "height", 0)),
                        jInt(json, "dpi", qIntEither(query, "d", "dpi", 0)),
                        json == null || json.optBoolean("allowOverlay", true)).getBytes("UTF-8");
            } else if ("/vscreen/launch".equals(path)) {
                String pkg = jStr(json, "packageName");
                if (pkg == null) pkg = qStr(query, "packageName");
                if (pkg == null) pkg = qStr(query, "pkg");
                String activity = jStr(json, "activity");
                if (activity == null) activity = qStr(query, "activity");
                bytes = launchApp(pkg, activity).getBytes("UTF-8");
            } else if ("/vscreen/see".equals(path)) {
                SeeResult r = see();
                if (r.png != null) {
                    contentType = "image/png";
                    bytes = r.png;
                } else {
                    code = "NOT_CREATED".equals(r.reason) ? 404 : 503;
                    bytes = fail(r.reason, r.detail).getBytes("UTF-8");
                }
            } else if ("/vscreen/preview".equals(path)) {
                bytes = preview().getBytes("UTF-8");
            } else if ("/vscreen/tap".equals(path)) {
                bytes = input("tap", fmt(jFloat(json, "x", qFloat(query, "x", 0))),
                        fmt(jFloat(json, "y", qFloat(query, "y", 0)))).getBytes("UTF-8");
            } else if ("/vscreen/swipe".equals(path)) {
                bytes = input("swipe", fmt(jFloat(json, "x1", qFloat(query, "x1", 0))),
                        fmt(jFloat(json, "y1", qFloat(query, "y1", 0))),
                        fmt(jFloat(json, "x2", qFloat(query, "x2", 0))),
                        fmt(jFloat(json, "y2", qFloat(query, "y2", 0))),
                        String.valueOf(jInt(json, "durationMs", qInt(query, "dur", 300)))).getBytes("UTF-8");
            } else if ("/vscreen/key".equals(path)) {
                int meta = jInt(json, "metaState", 0);
                if (meta != 0) {
                    // input keyevent 无 metaState 能力（上游 v1.11 机制如此，不臆造），记录后按纯 keycode 注入
                    log("key metaState=" + meta + " 非 0：input keyevent 不支持 metaState，已忽略", null);
                }
                // 批次 18 修复（回归缺陷 2）：A17 的 input 对数字串按 KEYCODE_<数字键> 符号名解析
                // （"4" → KEYCODE_4 数字"4"键，而非 BACK 的键值 4）→ 静默注入错键（真机实证：
                // 数字形态 exit=0 画面不变，KEYCODE_BACK 字符串形态生效）。统一转符号名注入。
                int keycode = jInt(json, "keycode", qInt(query, "keycode", 0));
                String codeArg = (keycode == 0)
                        ? "KEYCODE_UNKNOWN"
                        : KeyEvent.keyCodeToString(keycode);
                bytes = input("keyevent", codeArg).getBytes("UTF-8");
            } else if ("/vscreen/close".equals(path)) {
                bytes = closeDisplay().getBytes("UTF-8");
            } else if ("/vscreen/kill".equals(path)) {
                // 清理（销毁 display / 还原 overlay）→ 应答发出后再 System.exit(0)
                bytes = closeDisplay().getBytes("UTF-8");
            } else {
                code = 404;
                bytes = fail("INVALID_ARGUMENT", "未知路径 " + path).getBytes("UTF-8");
            }

            respond(sock, code, contentType, bytes);

            long cost = System.currentTimeMillis() - started;
            if (cost > 1500 || !path.equals("/vscreen/preview")) {
                String brief = "image/png".equals(contentType)
                        ? bytes.length + "B binary" : summarize(new String(bytes, "UTF-8"));
                log("HTTP " + path + " -> " + brief + " (" + cost + "ms)", null);
            }

            if ("/vscreen/kill".equals(path)) {
                log("收到 /vscreen/kill，服务端退出", null);
                System.exit(0);
            }
        } catch (Throwable t) {
            log("handle 异常: " + t.getMessage(), null);
            try {
                // 应答/处理异常时尽力回一个 500，避免 App 侧干等超时
                respond(sock, 500, CT_JSON,
                        fail("CREATE_FAILED", "服务端内部异常: " + t).getBytes("UTF-8"));
            } catch (Throwable ignored) {
            }
        } finally {
            try {
                sock.close();
            } catch (Throwable ignored) {
            }
        }
    }

    /** 从 socket 读请求头（读到 \r\n\r\n 为止）。 */
    private static String readHead(InputStream is) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        int a = -1, b = -1, c = -1, d = -1;
        int ch;
        while ((ch = is.read()) != -1) {
            bos.write(ch);
            a = b;
            b = c;
            c = d;
            d = ch;
            if (a == '\r' && b == '\n' && c == '\r' && d == '\n') {
                break;
            }
        }
        return bos.toString("UTF-8");
    }

    /** 按 Content-Length 读请求体（UTF-8；多字节时按字节读满，避免字符流阻塞）。 */
    private static String readBody(InputStream is, int contentLength) throws IOException {
        if (contentLength <= 0) {
            return "";
        }
        byte[] buf = new byte[contentLength];
        int off = 0;
        while (off < contentLength) {
            int n = is.read(buf, off, contentLength - off);
            if (n < 0) {
                break;
            }
            off += n;
        }
        return new String(buf, 0, off, "UTF-8");
    }

    private static void respond(Socket sock, int code, String contentType, byte[] body)
            throws IOException {
        OutputStream os = sock.getOutputStream();
        os.write(("HTTP/1.1 " + code + " " + phrase(code) + "\r\n"
                + "Content-Type: " + contentType + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: close\r\n\r\n").getBytes("UTF-8"));
        os.write(body);
        os.flush();
    }

    private static String phrase(int code) {
        switch (code) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 500: return "Internal Server Error";
            case 503: return "Service Unavailable";
            default: return "Status";
        }
    }

    private static String summarize(String body) {
        return body.length() > 160 ? body.substring(0, 160) + "..." : body;
    }

    private static String fmt(float f) {
        if (f == Math.rint(f)) {
            return String.valueOf((long) f);
        }
        return String.valueOf(f);
    }

    private static String qStr(String query, String key) {
        for (String kv : query.split("&")) {
            int eq = kv.indexOf('=');
            if (eq > 0 && kv.substring(0, eq).equals(key)) {
                return urlDecode(kv.substring(eq + 1));
            }
        }
        return null;
    }

    /** 同一含义的多个参数名都接受（插件用 width/height/dpi，内部/旧调用用 w/h/d）。 */
    private static int qIntEither(String query, String k1, String k2, int def) {
        int v = qInt(query, k1, Integer.MIN_VALUE);
        return v != Integer.MIN_VALUE ? v : qInt(query, k2, def);
    }

    private static int qInt(String query, String key, int def) {
        try {
            String v = qStr(query, key);
            return v == null ? def : (int) Double.parseDouble(v);
        } catch (Throwable t) {
            return def;
        }
    }

    private static float qFloat(String query, String key, float def) {
        try {
            String v = qStr(query, key);
            return v == null ? def : Float.parseFloat(v);
        } catch (Throwable t) {
            return def;
        }
    }

    private static String urlDecode(String s) {
        try {
            return java.net.URLDecoder.decode(s, "UTF-8");
        } catch (Throwable t) {
            return s;
        }
    }

    /** JSON body 取参：键缺失 / JSON null → 回退值（再退到上游 query 解析）。 */
    private static String jStr(JSONObject json, String key) {
        if (json == null || !json.has(key) || json.isNull(key)) {
            return null;
        }
        return json.optString(key, null);
    }

    private static int jInt(JSONObject json, String key, int def) {
        if (json == null || !json.has(key) || json.isNull(key)) {
            return def;
        }
        return json.optInt(key, def);
    }

    private static float jFloat(JSONObject json, String key, float def) {
        if (json == null || !json.has(key) || json.isNull(key)) {
            return def;
        }
        return (float) json.optDouble(key, def);
    }

    /** 契约 §3 失败语义：reason 枚举 + detail。 */
    private static String fail(String reason, String detail) {
        return "{\"ok\":false,\"reason\":\"" + reason + "\",\"detail\":\""
                + escape(detail) + "\"}";
    }

    private static String escape(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ");
    }

    // ==================== 日志 ====================

    /** 兼容旧调用点（DisplayCapture 等）保留的别名。 */
    static void logToFile(String msg, Throwable t) {
        log(msg, t);
    }

    static void log(String msg, Throwable t) {
        String stamp = new SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US).format(new Date());
        StringBuilder sb = new StringBuilder();
        sb.append(stamp).append(' ').append(msg);
        if (t != null) {
            sb.append(" | ").append(t.getClass().getSimpleName()).append(": ").append(t.getMessage());
            StackTraceElement[] st = t.getStackTrace();
            for (int i = 0; i < Math.min(6, st.length); i++) {
                sb.append("\n    at ").append(st[i]);
            }
        }
        System.out.println(TAG + ": " + sb);
        try {
            FileOutputStream fos = new FileOutputStream(LOG_PATH, true);
            fos.write((TAG + ": " + sb + "\n").getBytes("UTF-8"));
            fos.flush();
            fos.close();
        } catch (Throwable ignored) {
        }
    }
}
