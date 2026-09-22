package com.deepseek.harness;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 批次 12w：vscreen 预览悬浮窗（简版，会话绑定）。
 *
 * <p>生命周期由 {@link VscreensManager} 驱动（悬浮窗只反映活跃会话，无会话必不显示）：
 * <ul>
 *   <li>/vscreen/create 成功 → {@link #start(Context)}（onStartCommand 里显示窗口 + 恢复轮询）；</li>
 *   <li>/vscreen/close、/vscreen/shutdown、SessionSupervisor 判死（SESSION_DEAD）→
 *       {@link #stopSession()}（stopSelf，onDestroy 移窗 + 停轮询兜底）。</li>
 * </ul>
 * 窗内右上角「×」只<b>隐藏本会话内窗口</b>并停轮询省电（服务不 stop）；下次 create 经
 * onStartCommand 重新显示。轮询：后台单线程 {@code vscreen-preview}，800ms 间隔 GET
 * 127.0.0.1:8998 /vscreen/preview（带 X-DSH-TOKEN，token 与 MainActivity.localToken() 同源
 * ——localToken 持久化在 dsh_prefs/local_token，这里实读同一键）→ base64 解码 → 主线程
 * setImageBitmap。连续 {@value #MAX_FAIL_STREAK} 次失败 → 自动隐藏 + 停轮询（诚实降级，
 * logcat 记原因），服务保留待下次 create 恢复。</p>
 *
 * <p>线程模型（ANR 红线）：网络只发生在 vscreen-preview 后台线程（HttpURLConnection，
 * connect/read 超时各 2s）；UI（setImageBitmap / 显隐 / 移窗）一律 mainHandler.post 到主线程。
 * stop/隐藏时先置 polling=false 再 interrupt 轮询线程（sleep 立即醒；进行中的请求靠 2s 超时
 * 自然收尾），并回收 lastBitmap。Strategy=overlay 的会话 preview 同样可用（服务端 S3 走
 * screencap 路径），App 层不区分，统一打 8998。</p>
 *
 * <p>窗口/拖动/权限样板照抄 {@link OverlayService}（TYPE_APPLICATION_OVERLAY + FLAG_NOT_FOCUSABLE
 * + getRawX 拖动；App 已有 SYSTEM_ALERT_WINDOW）。非前台服务：会话已由 VscreensManager 持
 * PARTIAL_WAKE_LOCK，悬浮窗随会话起止，被系统回收属可接受降级（下次 create 重启服务），故
 * START_NOT_STICKY、不做前台通知。</p>
 */
public class VscreensPreviewService extends Service {

    private static final String TAG = "VscreensPreview";

    // ==== 服务端（契约 §1：8998 特权服务端，全部请求头 X-DSH-TOKEN） ====
    private static final int SERVER_PORT = 8998;
    private static final String PREFS = "dsh_prefs";
    private static final String KEY_LOCAL_TOKEN = "local_token"; // MainActivity.localToken() 写入，同源复用
    /** 批次62：虚拟屏预览窗口全局显隐开关偏好键（默认 false：不主动弹出黑屏窗口；需要看时由用户打开）。 */
    public static final String KEY_PREVIEW_ENABLED = "vscreen_preview_enabled";

    // ==== 轮询参数（批次 12w 冻结设计） ====
    private static final long POLL_INTERVAL_MS = 800L;
    private static final int CONNECT_TIMEOUT_MS = 2000;
    private static final int READ_TIMEOUT_MS = 2000;
    private static final int MAX_FAIL_STREAK = 3;
    /** 批次 12 Gate 修复：首帧前（虚拟屏刚建/无内容）帧泵可能长时间无帧，失败不计入降级；
     *  但封顶 MAX_BLANK_TRIES（约 30×800ms+超时 ≈ 40s+）仍无帧则按真故障降级，防死轮询。 */
    private static final int MAX_BLANK_TRIES = 30;
    /** /vscreen/preview 响应体上限（缩放 JPEG 的 base64，实际远小于此，兜底防异常响应撑爆内存）。 */
    private static final int BODY_CAP = 16 * 1024 * 1024;

    /** 当前运行实例（VscreensManager 会话钩子经静态方法控制，OverlayService.instance 同款）。 */
    private static volatile VscreensPreviewService instance = null;

    private WindowManager wm;
    private WindowManager.LayoutParams lp;
    private FrameLayout rootView;
    private ImageView imageView;
    private TextView placeholder;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // ==== 轮询线程状态（跨主线程 / vscreen-preview 线程读写，volatile） ====
    private volatile boolean polling = false;
    private volatile Thread pollThread = null;
    private volatile int failStreak = 0;
    private volatile boolean everOk = false; // 批次 12：首帧是否成功过（决定失败是否计入降级）
    private volatile int blankTries = 0;     // 首帧前空窗尝试计数
    private volatile String lastErr = null;

    /** 会话内被用户（或降级）隐藏：只隐藏窗口并停轮询，服务保留，下次 create 再显示。 */
    private volatile boolean hidden = false;

    // ==== 帧状态（主线程读写） ====
    private Bitmap lastBitmap = null;
    private int frameW = 0, frameH = 0;
    private boolean attached = false;

    // ==== 拖动（照抄 OverlayService 触摸逻辑） ====
    private float touchX, touchY, startX, startY;
    private boolean dragging = false;

    /**
     * create 成功（VscreensManager.handleCreate，local-conn 线程）调用：启动/复用服务。
     * 已在跑则只触发 onStartCommand（重新显示 + 恢复轮询）。App 在后台且引擎前台服务不在时
     * startService 可能被系统拒（IllegalStateException）——try/catch 记 logcat，不影响 create 主流程。
     */
    public static void start(Context ctx) {
        try {
            // 批次62：检查用户「是否允许显示虚拟屏预览小窗」全局偏好
            // 默认 false：后台虚拟屏正常跑、静默不弹窗；用户想看时打开开关才显示
            boolean enabled = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getBoolean(KEY_PREVIEW_ENABLED, false);
            if (!enabled) {
                Log.i(TAG, "start skipped: vscreen preview window is hidden by user preference");
                return;
            }
            Context app = ctx.getApplicationContext();
            app.startService(new Intent(app, VscreensPreviewService.class));
        } catch (Throwable t) {
            Log.w(TAG, "start preview service failed: " + t);
        }
    }

    /** 会话结束（close / shutdown / SESSION_DEAD，VscreensManager 各收尾点调用）：整个服务 stop。 */
    public static void stopSession() {
        VscreensPreviewService s = instance;
        if (s != null) {
            try { s.stopSelf(); } catch (Throwable ignored) {}
        }
    }

    /**
     * 批次62：动态切换预览小窗显隐（供悬浮助手顶栏或 App 设置实时触发）。
     * @return 切换后的状态（true=显示中，false=已隐藏）
     */
    public static boolean togglePreviewVisibility(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean current = sp.getBoolean(KEY_PREVIEW_ENABLED, false);
        boolean next = !current;
        sp.edit().putBoolean(KEY_PREVIEW_ENABLED, next).apply();
        if (next) {
            if (VscreensManager.isSessionActive()) {
                start(ctx);
            }
        } else {
            stopSession();
        }
        return next;
    }

    public static boolean isPreviewEnabled(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean(KEY_PREVIEW_ENABLED, false);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        buildOverlay();
        addToWindow();
        startPolling();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 每次 create（含会话恢复）都重新显示：× 隐藏过也复位；降级过也重试
        hidden = false;
        failStreak = 0;
        if (rootView != null && !attached) addToWindow();
        startPolling();
        return START_NOT_STICKY; // 会话绑定服务：被系统回收不复活，下次 create 再拉起
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        stopPolling();
        removeWindow();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    // =============================================================================================
    // 窗口构建（样板照抄 OverlayService：TYPE_APPLICATION_OVERLAY + 拖动；简版：仅 ImageView + ×）
    // =============================================================================================

    private void buildOverlay() {
        // 根布局：黑色圆角底框，ImageView 铺满（首帧前显示占位文字）
        rootView = new FrameLayout(this);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xF0101018);
        bg.setCornerRadius(dp(8));
        bg.setStroke(dp(1), 0xFF4D6BFE);
        rootView.setBackground(bg);

        imageView = new ImageView(this);
        imageView.setScaleType(ImageView.ScaleType.FIT_CENTER);
        rootView.addView(imageView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        placeholder = new TextView(this);
        placeholder.setText("虚拟屏预览…");
        placeholder.setTextColor(0xFF9DB4FF);
        placeholder.setTextSize(12);
        placeholder.setGravity(Gravity.CENTER);
        rootView.addView(placeholder, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        // 右上角「×」：仅隐藏本会话内窗口（不 stop 服务，停轮询省电；下次 create 再显示）
        TextView closeBtn = new TextView(this);
        closeBtn.setText("×");
        closeBtn.setTextColor(0xFFE8EDFF);
        closeBtn.setTextSize(14);
        closeBtn.setGravity(Gravity.CENTER);
        GradientDrawable cbg = new GradientDrawable();
        cbg.setColor(0x88000000);
        cbg.setCornerRadius(dp(10));
        closeBtn.setBackground(cbg);
        closeBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { hideByUser(); }
        });
        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(dp(22), dp(22),
                Gravity.TOP | Gravity.END);
        clp.topMargin = dp(4);
        clp.rightMargin = dp(4);
        rootView.addView(closeBtn, clp);

        // 拖动（OverlayService 同款逻辑；× 是可点击子 View 自消费触摸，与拖动不冲突）
        rootView.setOnTouchListener(new View.OnTouchListener() {
            @Override public boolean onTouch(View v, MotionEvent ev) {
                switch (ev.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        touchX = ev.getRawX(); touchY = ev.getRawY();
                        startX = lp.x; startY = lp.y;
                        dragging = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        if (Math.abs(ev.getRawX() - touchX) > dp(8) || Math.abs(ev.getRawY() - touchY) > dp(8)) {
                            dragging = true;
                        }
                        if (dragging) {
                            lp.x = (int) (startX + (ev.getRawX() - touchX));
                            lp.y = (int) (startY + (ev.getRawY() - touchY));
                            try { wm.updateViewLayout(rootView, lp); } catch (Throwable ignored) {}
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        return true;
                }
                return false;
            }
        });
    }

    private void addToWindow() {
        int type = Build.VERSION.SDK_INT >= 26
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        lp = new WindowManager.LayoutParams(
                initialWidth(), initialHeight(),
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        lp.x = dp(12);
        lp.y = dp(160);
        if (placeholder != null) placeholder.setVisibility(View.VISIBLE);
        try {
            wm.addView(rootView, lp);
            attached = true;
        } catch (Throwable t) {
            // 悬浮窗权限被收回等：诚实记日志，本会话内不再重试（下次 create 经 onStartCommand 再试）
            Log.w(TAG, "add preview window failed: " + t);
            stopSelf();
        }
    }

    /** 初始宽：约屏宽 40%。 */
    private int initialWidth() {
        return Math.round(getResources().getDisplayMetrics().widthPixels * 0.4f);
    }

    /** 初始高：首帧前无 w/h，按 16:9 占位；首帧后 applyFrameSize 按真实比例调整。 */
    private int initialHeight() {
        return Math.round(initialWidth() * 9f / 16f);
    }

    /** 首帧（或服务端缩放尺寸变化）后按真实 w/h 调窗：宽 40% 屏宽、比例 w:h，超高限 70% 屏高。主线程调用。 */
    private void applyFrameSize() {
        if (!attached || lp == null || frameW <= 0 || frameH <= 0) return;
        int sw = getResources().getDisplayMetrics().widthPixels;
        int sh = getResources().getDisplayMetrics().heightPixels;
        int pw = Math.round(sw * 0.4f);
        int ph = Math.round(pw * (float) frameH / frameW);
        if (ph > Math.round(sh * 0.7f)) {
            // 竖屏虚拟屏（h > w）：限高，等比回退缩宽
            ph = Math.round(sh * 0.7f);
            pw = Math.round(ph * (float) frameW / frameH);
        }
        if (pw == lp.width && ph == lp.height) return;
        lp.width = pw;
        lp.height = ph;
        try { wm.updateViewLayout(rootView, lp); } catch (Throwable ignored) {}
    }

    private void removeWindow() {
        if (attached && rootView != null && wm != null) {
            try { wm.removeView(rootView); } catch (Throwable ignored) {}
        }
        attached = false;
        if (lastBitmap != null) {
            lastBitmap.recycle();
            lastBitmap = null;
        }
        if (imageView != null) imageView.setImageBitmap(null);
    }

    /** 「×」：只隐藏本会话内窗口 + 停轮询（服务保留；下次 create 经 onStartCommand 再显示）。主线程调用。 */
    private void hideByUser() {
        hidden = true;
        stopPolling();
        removeWindow();
        Log.i(TAG, "preview window hidden by user (service kept, polling stopped; next create re-shows)");
    }

    /** 连续 3 次拉取失败：自动隐藏 + 停轮询（诚实降级），服务保留待下次 create 恢复。主线程调用。 */
    private void degradeHide() {
        hidden = true;
        stopPolling();
        removeWindow();
        Log.w(TAG, "preview degraded: " + MAX_FAIL_STREAK + " consecutive fetch failures ("
                + lastErr + ") -> window hidden, polling stopped; will retry on next create");
    }

    // =============================================================================================
    // 轮询（后台单线程 vscreen-preview；网络绝不进主线程）
    // =============================================================================================

    private synchronized void startPolling() {
        if (polling) return;
        polling = true;
        Thread t = new Thread(new Runnable() {
            @Override public void run() { pollLoop(); }
        }, "vscreen-preview");
        t.setDaemon(true);
        pollThread = t;
        t.start();
        Log.i(TAG, "preview polling started (interval " + POLL_INTERVAL_MS + "ms)");
    }

    private synchronized void stopPolling() {
        polling = false;
        Thread t = pollThread;
        pollThread = null;
        if (t != null) t.interrupt(); // sleep 立即醒；进行中的 HTTP 靠 2s 超时自然收尾
    }

    private void pollLoop() {
        while (polling) {
            Frame f = fetchFrame();
            if (f != null) {
                failStreak = 0;
                blankTries = 0;
                everOk = true;
                lastErr = null;
                final Bitmap bmp = f.bitmap;
                final int w = f.w, h = f.h;
                mainHandler.post(new Runnable() {
                    @Override public void run() { showFrame(bmp, w, h); }
                });
            } else {
                // 批次 12 Gate 修复：首帧前空窗（刚建屏无内容/无帧）不计入降级，只累计 blankTries；
                // 首帧成功后才开始 3 连败降级（真实故障）。两道封顶均防死轮询。
                if (!everOk) {
                    blankTries++;
                    Log.i(TAG, "preview blank (" + blankTries + "/" + MAX_BLANK_TRIES + "): " + lastErr);
                    if (blankTries >= MAX_BLANK_TRIES) {
                        polling = false;
                        lastErr = "blank display: no frame within " + MAX_BLANK_TRIES + " tries";
                        mainHandler.post(new Runnable() {
                            @Override public void run() { degradeHide(); }
                        });
                        return;
                    }
                } else {
                failStreak++;
                Log.w(TAG, "preview fetch failed (" + failStreak + "/" + MAX_FAIL_STREAK + "): " + lastErr);
                if (failStreak >= MAX_FAIL_STREAK) {
                    polling = false; // 先落标志，防 startPolling 撞上垂死线程
                    mainHandler.post(new Runnable() {
                        @Override public void run() { degradeHide(); }
                    });
                    return;
                }
                }
            }
            try {
                Thread.sleep(POLL_INTERVAL_MS);
            } catch (InterruptedException e) {
                return; // stopPolling / onDestroy 中断：立即退出
            }
        }
    }

    /** 一帧预览。失败返回 null（原因记 lastErr），不抛异常（轮询线程静默，OverlayService 探测同款）。 */
    private Frame fetchFrame() {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("http://127.0.0.1:" + SERVER_PORT + "/vscreen/preview")
                    .openConnection();
            c.setConnectTimeout(CONNECT_TIMEOUT_MS);
            c.setReadTimeout(READ_TIMEOUT_MS);
            c.setRequestProperty("X-DSH-TOKEN", token());
            int code = c.getResponseCode();
            if (code != 200) {
                lastErr = "HTTP " + code;
                return null;
            }
            InputStream in = c.getInputStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0 && bos.size() < BODY_CAP) {
                bos.write(buf, 0, n);
            }
            try { in.close(); } catch (Throwable ignored) {}
            JSONObject o = new JSONObject(bos.toString("UTF-8"));
            if (!o.optBoolean("ok")) {
                // 服务端失败体（NOT_CREATED / SESSION_DEAD / …）也按失败计（诚实降级）
                lastErr = "server: " + o.optString("reason", "unknown");
                return null;
            }
            byte[] jpeg = Base64.decode(o.optString("jpegBase64", ""), Base64.DEFAULT);
            Bitmap bmp = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length);
            if (bmp == null) {
                lastErr = "jpeg decode failed";
                return null;
            }
            Frame f = new Frame();
            f.bitmap = bmp;
            f.w = o.optInt("w", 0) > 0 ? o.optInt("w") : bmp.getWidth();
            f.h = o.optInt("h", 0) > 0 ? o.optInt("h") : bmp.getHeight();
            return f;
        } catch (Throwable t) {
            lastErr = String.valueOf(t);
            return null;
        } finally {
            if (c != null) {
                try { c.disconnect(); } catch (Throwable ignored) {}
            }
        }
    }

    /** 上帧上屏（主线程）：先换新图再回收旧图（旧图此时已不在视图上）。 */
    private void showFrame(Bitmap bmp, int w, int h) {
        if (rootView == null || !polling || hidden) {
            // 帧到达前已停轮询/隐藏：丢弃本帧（防泄漏）
            if (bmp != null) bmp.recycle();
            return;
        }
        if (placeholder != null) placeholder.setVisibility(View.GONE);
        Bitmap old = lastBitmap;
        imageView.setImageBitmap(bmp);
        lastBitmap = bmp;
        if (old != null && old != bmp) old.recycle();
        if (frameW != w || frameH != h) {
            frameW = w;
            frameH = h;
            applyFrameSize();
        }
    }

    /** token：与 MainActivity.localToken() / VscreensManager 网关同源（dsh_prefs/local_token 实读，
     *  每帧重读成本低（SharedPreferences 有内存缓存），token 重新生成也能跟新）。 */
    private String token() {
        try {
            SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
            return sp.getString(KEY_LOCAL_TOKEN, "");
        } catch (Throwable t) {
            return "";
        }
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    /** 一帧：解码后的位图 + 服务端声明的虚拟屏缩放尺寸（宽高比用）。 */
    private static final class Frame {
        Bitmap bitmap;
        int w;
        int h;
    }
}
