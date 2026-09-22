package com.deepseek.harness;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.AppOpsManager;
import android.app.Dialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.DocumentsContract;
import android.provider.Settings;
import android.system.ErrnoException;
import android.system.Os;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.media.MediaScannerConnection;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.net.HttpURLConnection;
import java.net.URL;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.security.SecureRandom;
import java.net.Socket;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import org.json.JSONObject;

import rikka.shizuku.Shizuku;

public class MainActivity extends Activity {
    private static final String TAG = "DeepSeekHarness";
    // 引擎端口：固定默认端口（v1.5.4 起移除「端口冲突自动换端口」功能，用于排查慢启动是否与其相关）。
    // 共存版（Lite/抢先版）各用独立默认端口，靠包名隔离，不依赖动态切换。
    private int enginePort = 3080;
    // engineAuthUrl / engineAuthCookie / engineAuthRequired 见下方「批次 3」进程级字段声明
    private String cleanHomeUrl() { return "http://127.0.0.1:" + enginePort; }
    private String homeUrl() { return engineAuthUrl != null ? engineAuthUrl : cleanHomeUrl(); }
    // bin.js 相对 dshroot 目录的路径（dshroot 可能位于外部公共目录或内部 fallback）
    private static final String REL_BINJS = "lib/node_modules/@deepseek-ai/dsh/lib/bin.js";
    // 外部 dshroot 公共目录名（挂在 /sdcard 下，卸载不丢；node 二进制/凭证仍留内部）
    private static final String EXT_DSHROOT_ROOT = "DeepSeekHarness";
    // 官方维护、需随 APK 更新的路径前缀：即使外部 dshroot 已有同名文件也强制覆盖
    // （避免"保留 AI 修改"策略挡住官方修复，例如 shizuku 插件的三层补丁）。
    private static final String[] FORCE_OVERWRITE_PREFIXES = {
        // v1.8 hoisted npm layout (DSH 0.1.5+):
        "dshroot/lib/node_modules/@deepseek-ai/dsh/package.json",
        "dshroot/lib/node_modules/@deepseek-ai/dsh-web-frontend/dist/mobile.css",
        "dshroot/lib/node_modules/@deepseek-ai/dsh-web-frontend/dist/mobile.js",
        "dshroot/lib/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html",
        "dshroot/lib/node_modules/@deepseek-ai/dsh-tool-shizuku/",
        "dshroot/lib/node_modules/@deepseek-ai/dsh-tool-android/",
        "dshroot/lib/node_modules/@deepseek-ai/dsh-native-command/",
        // Legacy nested layout used by v1.7.x and earlier:
        "dshroot/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-shizuku/",
        "dshroot/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-android/",
        // v1.3.x 核心 UI 改动（侧栏改造/插件按钮）必须随 APK 覆盖：
        // 否则旧版升级用户的外部 dshroot 保留旧 client.js → 页面仍是旧 UI（无竖屏适配）
        "dshroot/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js",
        "dshroot/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-cordis/lib/client.js",
        "dshroot/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/mobile.css",
        "dshroot/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/mobile.js",
        "dshroot/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html",
        "dshroot/lib/node_modules/@deepseek-ai/dsh/package.json"
    };
    // 外部 dshroot 解压完成标记（App 在 dshroot 补齐后写入；清空/重置时随目录删除）。
    // 用于识别「解压中途被打断」：即使 REVISION 一致也强制补齐缺失文件。
    private static final String DSHROOT_COMPLETE = ".complete";
    private static final String PREFS = "dsh_setup";
    private static final int REQ_STORAGE = 200;
    private static final int REQ_NOTIFICATION = 201;
    private static final int REQ_SHIZUKU = 300;
    private static final int REQ_WORKSPACE_TREE = 400;
    /** 批次30：网页 <input type="file"> 的选文件回调（WebChromeClient.onShowFileChooser 用）。 */
    private static final int REQ_FILE_CHOOSER = 401;

    // 悬浮窗前后台联动：App 在前台时隐藏悬浮窗（不挡界面），退后台时显示（随时可查引擎状态）。
    // 由 onStart/onStop 维护；OverlayService 启动时按此标志决定初始可见性。
    // 批次47 修复：缺省必须是 false。此前的 true 让「冷启动的进程」被误判成「App 在前台」——
    // 开机自启 / 覆盖安装自启 / START_STICKY 重建时，MainActivity 根本没起来，OverlayService
    // 读到 true 就 applyVisible(false)，球被建出来却是 GONE（无 surface），用户看不到球。
    // 真正的 App 生命周期由 onStart/onStop 覆盖（进前台置 true 并隐藏球，退后台置 false 并显示球）。
    public static volatile boolean overlayForeground = false;

    private WebView webView;
    /** 批次30：网页 <input type="file"> 的待回传回调。
     *  必须在 onShowFileChooser 返回前先置空（防重入），并在 onActivityResult 中
     *  无论成功失败都调用一次 onReceiveValue（失败传 null）——否则 WebView 会认为
     *  该次文件选择未结束，后续点击被永久阻塞。 */
    private ValueCallback<Uri[]> pendingFileChooser;
    private TextView statusView;
    private ProgressBar progressBar;
    private ImageView splashLogo;
    private TextView splashBrand;
    private final Handler ui = new Handler(Looper.getMainLooper());
    // 运行时确定的 dshroot 目录（外部公共目录优先，失败回退内部 files/payload/dshroot）
    private File dshrootDir = null;
    private boolean watchdogStarted = false;
    /** 仅确认退出当前实例时置位，安装/系统回收触发的 finish 不参与引擎回收。 */
    private boolean exitRequested = false;
    private long lastRespawnAt = 0L;
    // 引擎 node 进程
    // 批次 3：以下字段改为 static（进程级）——MainActivity 是 standard 启动模式，系统可能同时存在
    // 多个实例（图三：MULTIPLE_TASK / 配置变更重建 / 分享新实例），每个实例一份实例字段会让
    // 「单飞闸门」「鉴权 URL」「node 句柄」形同虚设，回到 L1/L2/L3 的老毛病。
    // 一个进程只可能有一个引擎，这些状态本来就该是进程级。
    private static Process nodeProcess = null;
    /** 用户主动退出后禁止看门狗再拉起已终止的引擎。 */
    private static volatile boolean engineShutdownRequested = false;
    private static volatile String engineAuthUrl = null;
    private static volatile String engineAuthCookie = null;
    private static volatile boolean engineAuthRequired = false;
    // 批次 3（2026-09-12）引擎启动健壮性：
    //  - engineStartInFlight：启动单飞（single-flight）闸门。同一时刻只允许一条 spawn+wait 流程；
    //    并发调用（第二个 MainActivity 实例 / 看门狗 / 补齐重试）必须等待或退让，绝不重复 spawn，
    //    否则第二次 node 会撞 3080 报 EADDRINUSE 并覆盖 nodeProcess 句柄。
    //  - lastSpawnEaddrInUse：本次 spawn 的 node 输出里是否出现过「地址已被占用」。
    //    撞端口导致的失败绝不能计入 glibc 降级计数（否则会把好好的 glibc 引擎误降级成 bionic）。
    private static final java.util.concurrent.atomic.AtomicBoolean engineStartInFlight =
            new java.util.concurrent.atomic.AtomicBoolean(false);
    private static volatile boolean lastSpawnEaddrInUse = false;
    private static volatile int spawnSeq = 0;
    // v1.5.2 慢启动修复：本次启动走了「快速同步」（同内核升级，只补白名单+REVISION）。
    // 若引擎启动超时，用它触发一次全量补齐（防止快速路径漏掉缺失文件）。
    private volatile boolean fastSyncedThisBoot = false;
    // v1.9.0 双 runtime（glibc 直跑 + bionic 回退，方案 D7）：
    // runtimeMode = dsh_prefs/runtime_mode（glibc 默认 | bionic）；glibcFailCount =
    // glibc 模式连续启动失败计数（未存活到 3080 LISTEN 即失败），连续 3 次写回
    // runtime_mode=bionic 降级；手动把 prefs 改回 glibc 即重置。
    private volatile String runtimeMode = "glibc";
    private int glibcFailCount = 0;
    private static final int GLIBC_FAIL_LIMIT = 3;

    // 权限界面
    private final List<PermRow> permRows = new ArrayList<>();
    private File rishDex;
    // AI 工作区（可选）：外部共享存储目录，传给引擎作为 bash/文件工具的工作根目录
    private TextView workspaceDescView;

    // ===== 批次55-C：保活自检卡片（权限/诊断页与设置弹窗共用同一构建方法）=====
    /** 当前活着的保活卡片容器；null = 没有卡片在场（refreshAllStatuses 跳过刷新）。 */
    private LinearLayout keepAliveCard;
    /** 卡片一行结论（保活自检 OK/WARN/FAIL + 项数）。 */
    private TextView keepAliveSummaryView;
    /** 批次70：实况窗（灵动胶囊）开关按钮 —— 文案由 refreshKeepAliveCard 刷新。 */
    private TextView liveUpdateToggleView;
    /** 批次80：「直接执行」开关（dsh_prefs/agent_auto_proceed）。 */
    private TextView autoProceedToggleView;
    /** 卡片明细（逐条判据真机取值 + 引导文案 + 最近一次自检）。 */
    private TextView keepAliveDetailView;

    // ===== 批次10d（#30）冷启动埋点：SystemClock.elapsedRealtime() 原始值，0 = 未采集 =====
    private long stOnCreate;
    private long stPayload;
    private long stSpawn;
    private long stEngine;
    private long stUi;
    private boolean stTraceReported;

    // ===== 批次13 P0/A1 埋点补充：只新增键（jsonl 新键 / logcat 新行），既有字段名/语义不变 =====
    private volatile long stPbStart;          // pb.start() 时刻（spawnNode 内首次；0=未采集）
    private volatile long stWebMarkerAt;      // node-log 捕获 "dsh web:" marker 时刻（0=未捕获）
    private final StringBuffer stExtractLog = new StringBuffer(); // 每次 extractPayload 的 mode=耗时ms/写入数
    private volatile String stDshrootSync = ""; // dshrootNeedsSync 判定结果（含同步/配置刷新耗时）
    private volatile long stResolvMs = -1;    // spawnNode 内 resolv.conf 段耗时（bionic 未走=-1，命中 D1 缓存≈0）
    private volatile long stProbeMs = -1;     // spawnNode 内 root/shizuku 探测耗时
    private volatile boolean stPayloadFpSkip = false; // A1 指纹命中跳过解压（jsonl 新键 payloadSkip）

    // 批次13 E1：waitForServer 等待闸门——node-log 线程看到 "dsh web:" marker 时 notifyAll
    // 提前唤醒轮询（配合间隔 1000→250ms）。无等待者时 notifyAll 为 no-op。
    private final Object engineWaitGate = new Object();

    private interface StatusProvider { boolean granted(); }
    private static class PermRow {
        TextView status;
        StatusProvider provider;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 用户从启动器打开 App 时解除退出闸门；旧实例安装/系统回收触发的销毁不置位。
        Intent launchIntent = getIntent();
        if (launchIntent != null
                && Intent.ACTION_MAIN.equals(launchIntent.getAction())) {
            engineShutdownRequested = false;
        }
        stOnCreate = android.os.SystemClock.elapsedRealtime(); // 批次10d（#30）启动埋点：onCreate 进入
        installCrashHandler();
        checkAbiCompat(); // ② ABI 检测：非 arm64 设备引擎可能无法运行，弹提示
        checkBatteryOptimization(); // ④ 电池优化引导：被限制时提示（挂后台可能被杀）
        // ⑧ 更新提示已停用（批次8，用户要求）：魔改版 versionName 不对齐上游（如 1.8.5-dsh0.1.5rc1 vs 上游 1.11.0），
        //    比对必然误报；checkForUpdate() 保留但不再调用。
        // checkForUpdate();

        webView = new WebView(this);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setDatabaseEnabled(true);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setSupportZoom(false);
        ws.setBuiltInZoomControls(false);
        ws.setDisplayZoomControls(false);
        ws.setTextZoom(100);
        webView.setBackgroundColor(Color.parseColor("#0b0f1a"));
        checkWebViewCompat(); // WebView 兼容检测：老内核提示引导（DSH 前端需 Chromium 80+）
        // 批次30 修复「上传文件按钮点了没反应」：Android WebView 里网页的 <input type="file">
        // 必须由宿主通过 WebChromeClient.onShowFileChooser 接管并弹出系统选择器；未设置
        // WebChromeClient 时该请求被静默丢弃（无异常、无日志），表现为按钮完全无响应。
        // 本 App 此前只设了 WebViewClient（管页面加载），故上传按钮一直失效。
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             WebChromeClient.FileChooserParams params) {
                // 先置空防重入：上一次选择未结束时再次点击，直接拒绝新请求并放行旧回调
                if (pendingFileChooser != null) {
                    try { pendingFileChooser.onReceiveValue(null); } catch (Throwable ignored) {}
                    pendingFileChooser = null;
                }
                pendingFileChooser = callback;
                Intent intent = null;
                try {
                    // 官方推荐：由 WebView 依 accept / mode 自动构造正确的 Intent
                    if (params != null) intent = params.createIntent();
                } catch (Throwable ignored) {}
                if (intent == null) {
                    // 兜底（部分 ROM 的 createIntent 可能失败）：手拼 ACTION_GET_CONTENT
                    intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    if (params != null) {
                        int mode = params.getMode();
                        if (mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                        }
                        String[] accept = params.getAcceptTypes();
                        if (accept != null && accept.length > 0) {
                            String first = accept[0];
                            if (first != null && !first.isEmpty()) intent.setType(first);
                        }
                    }
                }
                try {
                    startActivityForResult(intent, REQ_FILE_CHOOSER);
                    return true;
                } catch (Throwable t) {
                    // 无可用选择器等情况：必须回传 null 解除阻塞，否则按钮会永久失效
                    Log.w(TAG, "onShowFileChooser 启动选择器失败", t);
                    if (pendingFileChooser != null) {
                        try { pendingFileChooser.onReceiveValue(null); } catch (Throwable ignored) {}
                        pendingFileChooser = null;
                    }
                    return false;
                }
            }
        });
        webView.setWebViewClient(new android.webkit.WebViewClient() {
            private int errorRetries = 0;

            @Override
            public void onReceivedError(WebView view, android.webkit.WebResourceRequest request,
                                         android.webkit.WebResourceError error) {
                // 主框架加载失败（如 ERR_CONNECTION_REFUSED）时自动重试，直到服务器就绪
                if (request != null && request.isForMainFrame() && errorRetries < 120) {
                    errorRetries++;
                    final WebView wv = view;
                    view.postDelayed(new Runnable() {
                        @Override public void run() { wv.loadUrl(homeUrl()); }
                    }, 2500L);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                errorRetries = 0;
                // 批次10d（#30）启动埋点：UI 就绪（页面加载完成回调存在，无需回退到引擎就绪处）
                  if (stUi == 0) stUi = android.os.SystemClock.elapsedRealtime();
                  reportStartupTrace();
              }
          });

          // 批次33：注册 DownloadListener，接管 WebUI 导出会话、下载代码及附件请求
          webView.setDownloadListener(new DownloadListener() {
              @Override
              public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                          String mimetype, long contentLength) {
                  handleDownload(url, userAgent, contentDisposition, mimetype, contentLength);
              }
          });
  
          statusView = new TextView(this);
          statusView.setText("正在启动 DeepSeek Harness…");
        statusView.setTextColor(Color.parseColor("#e6edf3"));
        statusView.setTextSize(15);
        statusView.setGravity(Gravity.CENTER);
        statusView.setPadding(dp(24), dp(12), dp(24), dp(12));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(0);
        progressBar.setVisibility(View.GONE);

        // 提取 rish dex（DSH 的 shizuku_shell 插件执行命令用，与 payload 解压解耦）
        rishDex = extractRishDex();

        // Shizuku API：监听 binder 与授权结果（实现授权弹窗）
        try {
            Shizuku.addBinderReceivedListenerSticky(new Shizuku.OnBinderReceivedListener() {
                @Override public void onBinderReceived() { probeShizuku(); }
            });
            Shizuku.addBinderDeadListener(new Shizuku.OnBinderDeadListener() {
                @Override public void onBinderDead() { shizukuOk = false; refreshAllStatuses(); }
            });
            Shizuku.addRequestPermissionResultListener(new Shizuku.OnRequestPermissionResultListener() {
                @Override public void onRequestPermissionResult(int requestCode, int grantResult) {
                    if (grantResult == PackageManager.PERMISSION_GRANTED) {
                        shizukuOk = true;
                    }
                    refreshAllStatuses();
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "Shizuku listener init failed", t);
        }

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        // 批次85-R4：事件触发器注册（幂等）—— 电源/电量/亮灭屏/耳机/网络；
        // 包安装/卸载/替换走清单注册的 TriggerReceiver。
        TriggerEngine.ensureRegistered(getApplicationContext());
        // 批次85-R1 探针（默认关，可随时摘除）：--ez show_permission true 时直接打开「首次使用 · 配置手机权限」页，
        // 供装机后复验权限页渲染（该页原本只在 setup_done=false 时可达）。
        if (getIntent() != null && getIntent().getBooleanExtra("show_permission", false)) {
            showPermissionScreen();
        } else if (prefs.getBoolean("setup_done", false)) {
            // 定时任务自动执行：闹钟到点可能带着 scheduledTask extra 启动本 Activity
            Intent in = getIntent();
            if (in != null) {
                String task = in.getStringExtra("scheduledTask");
                if (task != null && !task.isEmpty()) pendingScheduledTask = task;
                // v1.8.5 系统分享接入：其他 App「分享 → DeepSeek Harness」
                handleShareIntent(in);
            }
            showEngineScreen();
            startEngine();
        } else {
            showPermissionScreen();
        }
    }

    // 定时任务自动执行：闹钟到点带来的任务文本（引擎就绪后自动 prompt 执行）
    private String pendingScheduledTask = null;

    // ============ WebView 兼容检测（老安卓 WebView 缺失/过旧） ============
    /** DSH 前端是 Vite 构建的现代应用（<script type="module"> + 可选链/nullish），
     *  需要 Chromium 80+ 才能渲染；Android 7/8 出厂 WebView（Chromium 51/59）或长期未更新的
     *  系统 WebView 会白屏，用户误以为「引擎启动失败」。检测到过旧版本时弹提示引导，
     *  不阻断启动（引擎本身与 WebView 无关，node 进程照常拉起）。 */
    private void checkWebViewCompat() {
        try {
            int chrome = parseChromeMajor(webView.getSettings().getUserAgentString());
            // UA 无 Chrome 标记时（部分 ROM 魔改 UA），API 26+ 用 WebView 包版本兜底
            if (chrome <= 0 && Build.VERSION.SDK_INT >= 26) {
                try {
                    android.content.pm.PackageInfo pi = WebView.getCurrentWebViewPackage();
                    if (pi != null && pi.versionName != null) {
                        chrome = parseChromeMajor(pi.versionName);
                    }
                } catch (Throwable ignored) {}
            }
            if (chrome <= 0 || chrome >= 80) return; // 拿不到版本或够新 → 不打扰
            final int ver = chrome;
            ui.post(new Runnable() {
                @Override public void run() {
                    try {
                        new AlertDialog.Builder(MainActivity.this)
                                .setTitle("系统 WebView 版本过旧")
                                .setMessage("检测到系统 WebView 内核为 Chromium " + ver
                                        + "（DSH 界面需要 80 以上）。\n\n"
                                        + "界面可能无法正常显示（白屏/无法交互），引擎本身不受影响。\n\n"
                                        + "建议：① 更新\"Android System WebView\"后重试；"
                                        + "② 安装「DeepSeek Harness 兼容版」（专为老设备优化）。")
                                .setPositiveButton("去更新", new DialogInterface.OnClickListener() {
                                    @Override public void onClick(DialogInterface d, int w) { openWebViewUpdate(); }
                                })
                                .setNegativeButton("继续尝试", null)
                                .show();
                    } catch (Throwable ignored) {}
                }
            });
        } catch (Throwable ignored) {}
    }

    /** 从 UA（"... Chrome/51.0.2704.81 ..."）或版本名（"80.0.3987.149"）解析主版本号。 */
    private int parseChromeMajor(String s) {
        if (s == null) return -1;
        int i = s.indexOf("Chrome/");
        int base = 0;
        if (i < 0) { i = s.indexOf("Chrome "); if (i < 0) return -1; base = "Chrome ".length(); }
        else { base = "Chrome/".length(); }
        int start = i + base;
        int e = start;
        while (e < s.length() && Character.isDigit(s.charAt(e))) e++;
        if (e == start) return -1;
        try { return Integer.parseInt(s.substring(start, e)); } catch (Throwable t) { return -1; }
    }

    /** 引导更新系统 WebView：优先系统 WebView 设置页，失败兜底应用商店。 */
    private void openWebViewUpdate() {
        try {
            Intent i = new Intent("android.settings.WEBVIEW_SETTINGS");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            return;
        } catch (Throwable ignored) {}
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.webview"));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Throwable ignored) {}
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private int sp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().scaledDensity);
    }

    // ============ 权限引导界面 ============
    private void detachView(View v) {
        if (v != null && v.getParent() != null) {
            ((ViewGroup) v.getParent()).removeView(v);
        }
    }

    private void showEngineScreen() {
        // 批次16u（界面美化）：引擎页根布局从「全屏 WebView + 右上角悬浮 topBtns」改为
        // 垂直 LinearLayout：独立顶栏（32dp：蓝色大肥鱼 logo + DSH + 设置/退出 pill）+ 内容区。
        // App 控件与 DSH 网页内容物理分层，根治悬浮按钮遮挡网页右上角控件的问题；
        // 设置/退出点击行为（showSettingsDialog / confirmExit）原样接线，零逻辑改动。
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0b0f1a"));
        root.addView(buildAppTopBar(), new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(32)));

        // 内容区（占顶栏以下全部剩余空间）：WebView 铺满 + 启动加载浮层。
        // 沿用原 FrameLayout 叠层结构，仅从 root 改挂到顶栏之下。
        FrameLayout content = new FrameLayout(this);
        // 成员视图（webView/statusView/progressBar）可能已挂在旧容器上，先全部摘下，避免重复挂载崩溃。
        detachView(webView);
        detachView(statusView);
        detachView(progressBar);
        content.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);

        // 鲸鱼 logo（加载页视觉零改动，仍用 ic_launcher）
        splashLogo = new ImageView(this);
        splashLogo.setImageResource(R.drawable.ic_launcher);
        LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(dp(92), dp(92));
        llp.gravity = Gravity.CENTER_HORIZONTAL;
        llp.bottomMargin = dp(22);
        box.addView(splashLogo, llp);

        // 品牌名
        splashBrand = new TextView(this);
        splashBrand.setText("DeepSeek Harness");
        splashBrand.setTextColor(Color.parseColor("#f0f6fc"));
        splashBrand.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        splashBrand.setTypeface(null, android.graphics.Typeface.BOLD);
        splashBrand.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        blp.gravity = Gravity.CENTER_HORIZONTAL;
        blp.bottomMargin = dp(26);
        box.addView(splashBrand, blp);

        // 状态文字
        box.addView(statusView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        // 进度条（深色主题：亮蓝进度 + 暗灰轨道）
        android.content.res.ColorStateList tint = android.content.res.ColorStateList.valueOf(Color.parseColor("#4d6bfe"));
        progressBar.setProgressTintList(tint);
        progressBar.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.parseColor("#1f2733")));
        LinearLayout.LayoutParams pbp = new LinearLayout.LayoutParams(dp(260), dp(6));
        pbp.topMargin = dp(18);
        pbp.gravity = Gravity.CENTER_HORIZONTAL;
        box.addView(progressBar, pbp);

        FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        bp.gravity = Gravity.CENTER;
        content.addView(box, bp);

        root.addView(content, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);
    }

    /**
     * 批次16u：引擎页独立顶栏（高 32dp，背景 #E60D1117，与系统状态栏视觉衔接——本 Activity
     * 为 Theme.Black.NoTitleBar.Fullscreen 全屏无状态栏，顶栏即页面最顶端）。
     * 左：蓝色大肥鱼 logo（20dp，ic_fish_blue）+「DSH」(11sp #99FFFFFF)；中部弹性 spacer；
     * 右（批次17d 改版）：单 ⚙ 图标（18sp、白 80%、paddingH 10dp，触控热区 40dp 宽 × 顶栏全高）
     * 开设置弹窗；原「设置」「退出」两 pill 移除，退出行收进设置弹窗底部 destructive 区
     * （confirmExit 链路零改动）。
     */
    private View buildAppTopBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#E60D1117"));
        bar.setPadding(dp(10), 0, dp(10), 0);

        // 左：蓝色大肥鱼 logo（20dp；drawable 内在比例 5:4，ImageView 默认 fitCenter 居中不变形）
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.ic_fish_blue);
        bar.addView(logo, new LinearLayout.LayoutParams(dp(20), dp(20)));

        TextView brand = new TextView(this);
        brand.setText("DSH");
        brand.setTextColor(Color.parseColor("#99FFFFFF"));
        brand.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        blp.leftMargin = dp(6);
        bar.addView(brand, blp);

        // 中部弹性 spacer：把右侧按钮推到顶栏最右
        View spacer = new View(this);
        bar.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1f));

        // 右：单 ⚙ 图标（批次17d：设置/退出两 pill 收敛为一个齿轮入口，退出行移入设置弹窗底部）
        // 18sp、白 80%、paddingH 10dp；宽 40dp × 顶栏全高（32dp），保证足够触控热区
        TextView gearBtn = new TextView(this);
        gearBtn.setText("⚙\uFE0E"); // U+2699 + 文本变体选择符（VS15），避免被渲染成彩色 emoji
        gearBtn.setTextColor(Color.parseColor("#CCFFFFFF"));
        gearBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        gearBtn.setGravity(Gravity.CENTER);
        gearBtn.setPadding(dp(10), 0, dp(10), 0);
        gearBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showSettingsDialog(); }
        });
        bar.addView(gearBtn, new LinearLayout.LayoutParams(
                dp(40), LinearLayout.LayoutParams.MATCH_PARENT));

        return bar;
    }

    /** 退出确认对话框（浮动按钮与系统返回键共用）。批次17d 文案纠正：退出只停保活通知 +
     *  收 UI，并显式停止 node 引擎，避免用户主动退出后留下孤儿进程。 */
    private void confirmExit() {
        new AlertDialog.Builder(this)
                .setTitle("退出 deepdive")
                .setMessage("确定要退出吗？后台引擎和保活服务将停止。")
                .setPositiveButton("退出", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        exitRequested = true;
                        engineShutdownRequested = true;
                        stopKeepAliveService(); // 用户主动退出：停止保活服务
                        finish();
                    }
                })
                .setNegativeButton("取消", null)
                .show();
    }

    // ============ 设置（批次12m #6：引擎 runtime_mode glibc/bionic 一键切换）============
    /**
     * 设置弹窗（批次17d 彻底重设计）：自绘 Dialog（弃用 AlertDialog 系统形态），深色圆角面板
     * （#F0121620，圆角 20dp，宽度 = 屏宽 - 48dp，无系统标题/按钮）。结构自上而下：
     * 头部（肥鱼 icon 16dp +「设置」15sp 白粗；副标「Runtime 切换 · 重启 App 生效」11sp，
     * 生效时机全文仅此一处）→ 两张可点 Runtime 卡片（垂直排列间距 8dp：行1 = 自绘 18dp radio
     * 圆点 + 名称 13sp 白 + chip 标签「默认/兼容」，行2 = 11sp 描述；选中卡 1.5dp 蓝描边
     * #4A9EFF + 底色 #1A4A9EFF，未选中描边 #22FFFFFF + 底色 #14000000）→ ⚠ glibc 产物缺失
     * 条件行（仅缺失时出现，#FFB74D）→ 分隔线 + 底栏（左「本次启动：glibc」仅本进程 spawn 过
     * node 时显示实际值否则隐藏；右「关闭」pill → dismiss）→ 分隔线 + destructive 退出行
     * 「退出 deepdive · 停止保活」（#E57373，收编自批次16u 顶栏「退出」pill，dismiss 后走
     * confirmExit() 原确认链路）。
     * 只写 dsh_prefs/runtime_mode——spawnNode 每次引擎启动自行 readRuntimeMode() 决定启动命令
     * （v1.9.0 既有逻辑，本批次不改），因此切换只在下次引擎启动生效，运行中的引擎不切换。
     * 选中态来自 prefs 实读；glibc 产物缺失按现状如实提示，不夸大。
     */
    private void showSettingsDialog() {
        try {
            final Dialog dialog = new Dialog(this);
            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
            final String cur = readRuntimeMode(); // prefs 实读（非法值按 glibc 归一）

            // 根容器：垂直 LinearLayout + 圆角 20dp 深色面板 #F0121620
            LinearLayout root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            GradientDrawable rootBg = new GradientDrawable();
            rootBg.setColor(Color.parseColor("#F0121620"));
            rootBg.setCornerRadius(dp(20));
            root.setBackground(rootBg);
            root.setPadding(dp(18), dp(16), dp(18), dp(8));

            // 头部行：肥鱼 icon 16dp +「设置」15sp 白粗
            LinearLayout head = new LinearLayout(this);
            head.setOrientation(LinearLayout.HORIZONTAL);
            head.setGravity(Gravity.CENTER_VERTICAL);
            ImageView headIcon = new ImageView(this);
            headIcon.setImageResource(R.drawable.ic_fish_blue);
            head.addView(headIcon, new LinearLayout.LayoutParams(dp(16), dp(16)));
            TextView title = new TextView(this);
            title.setText("设置");
            title.setTextColor(Color.WHITE);
            title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            title.setTypeface(null, android.graphics.Typeface.BOLD);
            LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            tlp.leftMargin = dp(8);
            head.addView(title, tlp);
            root.addView(head, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

            // 副标：生效时机全文只在这一处出现
            TextView subtitle = new TextView(this);
            subtitle.setText("Runtime 切换 · 重启 App 生效");
            subtitle.setTextColor(Color.parseColor("#99FFFFFF"));
            subtitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            slp.leftMargin = dp(24); // 与标题文字对齐（16dp icon + 8dp 间距）
            slp.topMargin = dp(6);
            root.addView(subtitle, slp);

            // ===== 两张 Runtime 卡片（垂直排列，间距 8dp）=====
            final String[] names = {"glibc", "bionic"};
            final String[] chips = {"默认", "兼容"};
            final String[] descs = {"性能最优；异常自动回退", "保守回退模式"};
            final LinearLayout[] cards = new LinearLayout[2];
            final View[] dots = new View[2];
            LinearLayout cardsBox = new LinearLayout(this);
            cardsBox.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams cblp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            cblp.topMargin = dp(14);
            for (int i = 0; i < names.length; i++) {
                final int idx = i;
                LinearLayout card = new LinearLayout(this);
                card.setOrientation(LinearLayout.VERTICAL);
                card.setPadding(dp(14), dp(14), dp(14), dp(14));

                // 行1：radio 圆点（18dp 自绘）+ 名称 13sp 白 + chip 标签
                LinearLayout row1 = new LinearLayout(this);
                row1.setOrientation(LinearLayout.HORIZONTAL);
                row1.setGravity(Gravity.CENTER_VERTICAL);
                View dot = new View(this);
                row1.addView(dot, new LinearLayout.LayoutParams(dp(18), dp(18)));
                TextView name = new TextView(this);
                name.setText(names[i]);
                name.setTextColor(Color.WHITE);
                name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
                LinearLayout.LayoutParams nlp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                nlp.leftMargin = dp(10);
                row1.addView(name, nlp);
                TextView chip = new TextView(this);
                chip.setText(chips[i]);
                chip.setTextColor(Color.parseColor("#A8CCEE"));
                chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
                GradientDrawable chipBg = new GradientDrawable();
                chipBg.setColor(Color.parseColor("#2E4A6B"));
                chipBg.setCornerRadius(dp(8));
                chip.setBackground(chipBg);
                chip.setPadding(dp(6), dp(2), dp(6), dp(2));
                LinearLayout.LayoutParams chlp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                chlp.leftMargin = dp(8);
                row1.addView(chip, chlp);
                card.addView(row1, new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

                // 行2：描述 11sp
                TextView desc = new TextView(this);
                desc.setText(descs[i]);
                desc.setTextColor(Color.parseColor("#88FFFFFF"));
                desc.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
                LinearLayout.LayoutParams dlp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                dlp.leftMargin = dp(28); // 与行1 名称对齐（18dp 圆点 + 10dp 间距）
                dlp.topMargin = dp(6);
                card.addView(desc, dlp);

                applyRuntimeCardStyle(card, dot, names[i].equals(cur));
                card.setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        String pick = names[idx];
                        if (pick.equals(readRuntimeMode())) return; // 未变更不写不提示
                        getSharedPreferences("dsh_prefs", MODE_PRIVATE)
                                .edit().putString("runtime_mode", pick).apply();
                        Log.i(TAG, "runtime_mode set to " + pick
                                + " (takes effect on next engine start)");
                        // 立即刷新两卡选中态（无需重开弹窗）
                        for (int j = 0; j < names.length; j++) {
                            applyRuntimeCardStyle(cards[j], dots[j], names[j].equals(pick));
                        }
                        android.widget.Toast.makeText(MainActivity.this,
                                "已切换，重启 App 生效",
                                android.widget.Toast.LENGTH_LONG).show();
                    }
                });
                cards[i] = card;
                dots[i] = dot;
                LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                clp.topMargin = dp(i > 0 ? 8 : 0); // 卡片间距 8dp
                cardsBox.addView(card, clp);
            }
            root.addView(cardsBox, cblp);

            // ⚠ 条件行：glibc 产物缺失（与 spawnNode 安全网同判据，沿用 isFile）——
            // 选了 glibc 也会以 bionic 启动，如实提示
            File glibcWrapper = new File(getFilesDir(), "payload/runtime/bin/node.glibc");
            File glibcNode = new File(getFilesDir(), "payload/runtime-glibc/bin/node");
            boolean glibcMissing = !(glibcWrapper.isFile() && glibcNode.isFile());
            TextView warn = new TextView(this);
            warn.setText("⚠ glibc 产物缺失，本次仍以 bionic 启动");
            warn.setTextColor(Color.parseColor("#FFB74D"));
            warn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            LinearLayout.LayoutParams wlp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            wlp.topMargin = dp(10);
            warn.setVisibility(glibcMissing ? View.VISIBLE : View.GONE);
            root.addView(warn, wlp);

            // ===== 后台虚拟屏模式 Switch 开关卡片 =====
            LinearLayout vscreenCard = new LinearLayout(this);
            vscreenCard.setOrientation(LinearLayout.HORIZONTAL);
            vscreenCard.setGravity(Gravity.CENTER_VERTICAL);
            vscreenCard.setPadding(dp(14), dp(12), dp(14), dp(12));
            GradientDrawable vsBg = new GradientDrawable();
            vsBg.setCornerRadius(dp(14));
            vsBg.setColor(Color.parseColor("#14000000"));
            vsBg.setStroke(Math.round(1f * getResources().getDisplayMetrics().density),
                    Color.parseColor("#22FFFFFF"));
            vscreenCard.setBackground(vsBg);

            LinearLayout vsTextCol = new LinearLayout(this);
            vsTextCol.setOrientation(LinearLayout.VERTICAL);

            TextView vsTitle = new TextView(this);
            vsTitle.setText("后台虚拟屏模式");
            vsTitle.setTextColor(Color.WHITE);
            vsTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            vsTextCol.addView(vsTitle);

            TextView vsSub = new TextView(this);
            vsSub.setText("自动化任务在独立副屏静默执行，不干扰主屏使用");
            vsSub.setTextColor(Color.parseColor("#88FFFFFF"));
            vsSub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            LinearLayout.LayoutParams vsSubLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            vsSubLp.topMargin = dp(4);
            vsTextCol.addView(vsSub, vsSubLp);

            LinearLayout.LayoutParams vsTextLp = new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
            vsTextLp.rightMargin = dp(10);
            vscreenCard.addView(vsTextCol, vsTextLp);

            final Switch vsSwitch = new Switch(this);
            final SharedPreferences vsPrefs = getSharedPreferences("vscreen_prefs", MODE_PRIVATE);
            boolean vsCurrent = vsPrefs.getBoolean("vscreen_mode", true);
            vsSwitch.setChecked(vsCurrent);
            // 批次29r2：系统 Switch 在深色主题下 thumb/track tint 渲染近乎透明（真机截图中
            // 滑块完全不可见，仅余一个极暗的「开启」字），用户根本看不到可点的控件。
            // 改为自绘可见开关（胶囊轨道 + 圆形滑块），彻底摆脱系统主题 tint 的不确定性。
            final TextView vsToggle = new TextView(this);
            final int vsTrackOn = Color.parseColor("#4A9EFF");
            final int vsTrackOff = Color.parseColor("#33FFFFFF");
            final int vsThumbOn = Color.WHITE;
            final int vsThumbOff = Color.parseColor("#B0BEC5");
            final Runnable vsPaintToggle = new Runnable() {
                @Override
                public void run() {
                    boolean on = vsSwitch.isChecked();
                    android.view.ViewParent parent = vsToggle.getParent();
                    if (parent instanceof android.widget.FrameLayout) {
                        android.widget.FrameLayout fr = (android.widget.FrameLayout) parent;
                        if (fr.getChildCount() > 1) {
                            View thumb = fr.getChildAt(1);
                            GradientDrawable tb = new GradientDrawable();
                            tb.setShape(GradientDrawable.OVAL);
                            tb.setColor(on ? vsThumbOn : vsThumbOff);
                            thumb.setBackground(tb);
                            int tSize = dp(24);
                            int pad = dp(3);
                            android.widget.FrameLayout.LayoutParams tlp =
                                    (android.widget.FrameLayout.LayoutParams) thumb.getLayoutParams();
                            tlp.width = tSize;
                            tlp.height = tSize;
                            tlp.gravity = (on ? Gravity.END : Gravity.START) | Gravity.CENTER_VERTICAL;
                            tlp.leftMargin = on ? 0 : pad;
                            tlp.rightMargin = on ? pad : 0;
                            thumb.setLayoutParams(tlp);
                        }
                    }
                    GradientDrawable gb = new GradientDrawable();
                    gb.setShape(GradientDrawable.RECTANGLE);
                    gb.setCornerRadius(dp(15));
                    gb.setColor(on ? vsTrackOn : vsTrackOff);
                    vsToggle.setBackground(gb);
                    // 无文字：纯色胶囊轨道 + 圆形滑块即可表达开关状态
                }
            };
            // 自绘开关：胶囊轨道(Toggle 自身) + 圆形滑块(叠加其上)
            View vsThumb = new View(this);
            final android.widget.FrameLayout vsFrame = new android.widget.FrameLayout(this);
            vsFrame.addView(vsToggle, new android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT));
            android.widget.FrameLayout.LayoutParams vsThumbFrameLp = new android.widget.FrameLayout.LayoutParams(dp(24), dp(24));
            vsThumbFrameLp.gravity = Gravity.CENTER_VERTICAL;
            vsFrame.addView(vsThumb, vsThumbFrameLp);
            final LinearLayout vsOuter = new LinearLayout(this);
            vsOuter.setOrientation(LinearLayout.HORIZONTAL);
            vsOuter.setGravity(Gravity.CENTER_VERTICAL);
            LinearLayout.LayoutParams vsFrameOuterLp = new LinearLayout.LayoutParams(dp(56), dp(30));
            vsOuter.addView(vsFrame, vsFrameOuterLp);
            vsSwitch.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
                @Override
                public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
                    vsPrefs.edit().putBoolean("vscreen_mode", isChecked).apply();
                    try {
                        getSharedPreferences("dsh_prefs", MODE_PRIVATE)
                                .edit().putBoolean("vscreen_mode", isChecked).apply();
                    } catch (Throwable ignored) {}
                    vsPaintToggle.run();
                    Log.i(TAG, "vscreen_mode set to " + isChecked);
                }
            });
            // 点击自绘开关或整行 = 翻转真实 Switch
            View.OnClickListener vsFlip = new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    vsSwitch.setChecked(!vsSwitch.isChecked());
                }
            };
            vsFrame.setOnClickListener(vsFlip);
            vscreenCard.setOnClickListener(vsFlip);
            vsPaintToggle.run();
            // 无障碍：让自绘开关可被读屏与 /dump 识别为可点控件
            vsFrame.setContentDescription(vsSwitch.isChecked() ? "后台虚拟屏模式，已开启" : "后台虚拟屏模式，已关闭");
            vsFrame.setClickable(true);
            vsFrame.setFocusable(true);

            // 自绘开关挂进卡片右侧（文本列已带 weight=1 占据左侧空间）
            LinearLayout.LayoutParams vsOuterLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            vsOuterLp.gravity = Gravity.CENTER_VERTICAL;
            vscreenCard.addView(vsOuter, vsOuterLp);

            LinearLayout.LayoutParams vslp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            vslp.topMargin = dp(10);
            root.addView(vscreenCard, vslp);

            // 批次55-C：保活自检入口（后台常驻诊断；卡片与权限页共用同一构建方法）
            LinearLayout keepAliveEntry = new LinearLayout(this);
            keepAliveEntry.setOrientation(LinearLayout.HORIZONTAL);
            keepAliveEntry.setGravity(Gravity.CENTER_VERTICAL);
            keepAliveEntry.setPadding(dp(14), dp(12), dp(14), dp(12));
            GradientDrawable kaBg = new GradientDrawable();
            kaBg.setCornerRadius(dp(14));
            kaBg.setColor(Color.parseColor("#14000000"));
            kaBg.setStroke(Math.round(1f * getResources().getDisplayMetrics().density),
                    Color.parseColor("#22FFFFFF"));
            keepAliveEntry.setBackground(kaBg);
            TextView kaText = new TextView(this);
            kaText.setText("保活自检 · 后台常驻诊断\n逐条判据 + 直达「应用启动管理」");
            kaText.setTextColor(Color.parseColor("#CCFFFFFF"));
            kaText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            keepAliveEntry.addView(kaText, new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            TextView kaArrow = new TextView(this);
            kaArrow.setText("›");
            kaArrow.setTextColor(Color.parseColor("#88FFFFFF"));
            kaArrow.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            keepAliveEntry.addView(kaArrow);
            keepAliveEntry.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    dialog.dismiss();
                    showKeepAliveDialog();
                }
            });
            LinearLayout.LayoutParams kalp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            kalp.topMargin = dp(10);
            root.addView(keepAliveEntry, kalp);

            // 批次82-N5：指令库管理入口（Prompt Studio）——改动立即同步到悬浮面板药丸行
            LinearLayout chipStudioEntry = new LinearLayout(this);
            chipStudioEntry.setOrientation(LinearLayout.HORIZONTAL);
            chipStudioEntry.setGravity(Gravity.CENTER_VERTICAL);
            chipStudioEntry.setPadding(dp(14), dp(12), dp(14), dp(12));
            GradientDrawable csBg = new GradientDrawable();
            csBg.setCornerRadius(dp(14));
            csBg.setColor(Color.parseColor("#14000000"));
            csBg.setStroke(Math.round(1f * getResources().getDisplayMetrics().density),
                    Color.parseColor("#22FFFFFF"));
            chipStudioEntry.setBackground(csBg);
            TextView csText = new TextView(this);
            csText.setText("指令库 · 常用指令药丸\n" + PromptChipManager.getChips(this).size()
                    + " 条：新增 / 编辑 / 排序（改完立即生效）");
            csText.setTextColor(Color.parseColor("#CCFFFFFF"));
            csText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            chipStudioEntry.addView(csText, new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            TextView csArrow = new TextView(this);
            csArrow.setText("›");
            csArrow.setTextColor(Color.parseColor("#88FFFFFF"));
            csArrow.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            chipStudioEntry.addView(csArrow);
            chipStudioEntry.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    dialog.dismiss();
                    PromptStudio.show(MainActivity.this, false, null);
                }
            });
            LinearLayout.LayoutParams cslp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            cslp.topMargin = dp(10);
            root.addView(chipStudioEntry, cslp);

            // 批次82-N7：实况窗胶囊「静默续期心跳」开关（dsh_prefs/promoted_capsule_heartbeat）
            // 关（默认）= 遵守 MagicOS 原生行为：单步静默超 5 分钟后胶囊自然收成圆点；
            // 开 = 活跃期每 4 分钟续期一次，长静默步骤期间始终保持「展开有字」。
            LinearLayout capsuleHbRow = new LinearLayout(this);
            capsuleHbRow.setOrientation(LinearLayout.HORIZONTAL);
            capsuleHbRow.setGravity(Gravity.CENTER_VERTICAL);
            capsuleHbRow.setPadding(dp(14), dp(12), dp(14), dp(12));
            GradientDrawable hbBg = new GradientDrawable();
            hbBg.setCornerRadius(dp(14));
            hbBg.setColor(Color.parseColor("#14000000"));
            hbBg.setStroke(Math.round(1f * getResources().getDisplayMetrics().density),
                    Color.parseColor("#22FFFFFF"));
            capsuleHbRow.setBackground(hbBg);
            TextView hbText = new TextView(this);
            hbText.setText("胶囊续期 · 实况窗静默续期\n"
                    + (PromotedProgressNotifier.isHeartbeatEnabled(this)
                            ? "已开启（每 4 分钟续期一次）" : "已关闭（静默 5 分钟后收成圆点）")
                    + "（点此切换）");
            hbText.setTextColor(Color.parseColor("#CCFFFFFF"));
            hbText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            capsuleHbRow.addView(hbText, new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            TextView hbArrow = new TextView(this);
            hbArrow.setText("›");
            hbArrow.setTextColor(Color.parseColor("#88FFFFFF"));
            hbArrow.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            capsuleHbRow.addView(hbArrow);
            capsuleHbRow.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    boolean on = !PromotedProgressNotifier.isHeartbeatEnabled(MainActivity.this);
                    getSharedPreferences("dsh_prefs", MODE_PRIVATE).edit()
                            .putBoolean(PromotedProgressNotifier.KEY_HEARTBEAT, on).apply();
                    hbText.setText("胶囊续期 · 实况窗静默续期\n"
                            + (on ? "已开启（每 4 分钟续期一次）" : "已关闭（静默 5 分钟后收成圆点）")
                            + "（点此切换）");
                    showToast(on ? "已开启胶囊续期（长静默期间保持展开）"
                            : "已关闭胶囊续期（静默 5 分钟后胶囊收成圆点）");
                }
            });
            LinearLayout.LayoutParams hblp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            hblp.topMargin = dp(10);
            root.addView(capsuleHbRow, hblp);

            // 批次85-R1b：配置手机权限入口（复用首次使用页；revisit 口径，改完从这里返回）
            LinearLayout permEntry = new LinearLayout(this);
            permEntry.setOrientation(LinearLayout.HORIZONTAL);
            permEntry.setGravity(Gravity.CENTER_VERTICAL);
            permEntry.setPadding(dp(14), dp(12), dp(14), dp(12));
            GradientDrawable peBg = new GradientDrawable();
            peBg.setCornerRadius(dp(14));
            peBg.setColor(Color.parseColor("#14000000"));
            peBg.setStroke(Math.round(1f * getResources().getDisplayMetrics().density),
                    Color.parseColor("#22FFFFFF"));
            permEntry.setBackground(peBg);
            TextView peText = new TextView(this);
            peText.setText("配置手机权限\n逐项查看/开启：无障碍、通知使用权、悬浮窗、电池优化…（点此进入）");
            peText.setTextColor(Color.parseColor("#CCFFFFFF"));
            peText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            permEntry.addView(peText, new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            TextView peArrow = new TextView(this);
            peArrow.setText("›");
            peArrow.setTextColor(Color.parseColor("#88FFFFFF"));
            peArrow.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            permEntry.addView(peArrow);
            permEntry.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    dialog.dismiss();
                    showPermissionScreen(true);
                }
            });
            LinearLayout.LayoutParams pelp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            pelp.topMargin = dp(10);
            root.addView(permEntry, pelp);

            // 批次85-R3：危险操作审批门现状（confirm_gate）—— 此前 App 内既看不到也改不了
            LinearLayout gateRow = new LinearLayout(this);
            gateRow.setOrientation(LinearLayout.HORIZONTAL);
            gateRow.setGravity(Gravity.CENTER_VERTICAL);
            gateRow.setPadding(dp(14), dp(12), dp(14), dp(12));
            GradientDrawable grBg = new GradientDrawable();
            grBg.setCornerRadius(dp(14));
            grBg.setColor(Color.parseColor("#14000000"));
            grBg.setStroke(Math.round(1f * getResources().getDisplayMetrics().density),
                    Color.parseColor("#22FFFFFF"));
            gateRow.setBackground(grBg);
            final TextView gateText = new TextView(this);
            gateText.setText(confirmGateRowText());
            gateText.setTextColor(Color.parseColor("#CCFFFFFF"));
            gateText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            gateRow.addView(gateText, new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            TextView grArrow = new TextView(this);
            grArrow.setText("›");
            grArrow.setTextColor(Color.parseColor("#88FFFFFF"));
            grArrow.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            gateRow.addView(grArrow);
            gateRow.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    SharedPreferences sp = getSharedPreferences("dsh_prefs", MODE_PRIVATE);
                    boolean hosted = sp.contains(HostedEngineManager.KEY_CONFIRM_GATE_BACKUP);
                    boolean cur = hosted
                            ? sp.getBoolean(HostedEngineManager.KEY_CONFIRM_GATE_BACKUP, false)
                            : sp.getBoolean(HostedEngineManager.KEY_CONFIRM_GATE, false);
                    boolean next = !cur;
                    SharedPreferences.Editor ed = sp.edit();
                    if (hosted) {
                        // 托管期写「退出托管后生效」的原值，否则会被 HostedEngineManager 重新强制覆盖
                        ed.putBoolean(HostedEngineManager.KEY_CONFIRM_GATE_BACKUP, next);
                    } else {
                        ed.putBoolean(HostedEngineManager.KEY_CONFIRM_GATE, next);
                    }
                    ed.apply();
                    gateText.setText(confirmGateRowText());
                    Log.i(TAG, "[b85r3] confirm_gate user=" + next + " hosted=" + hosted);
                    showToast(next ? "危险操作审批：开启（危险操作会先问你）"
                            : "危险操作审批：关闭（免审批，危险操作直接执行）");
                }
            });
            LinearLayout.LayoutParams grlp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            grlp.topMargin = dp(10);
            root.addView(gateRow, grlp);

            // 批次85-R2：定时任务管理入口（列表 / 下次触发 / 启停 / 立即执行 / 删除 / 最近记录）
            LinearLayout schedEntry = new LinearLayout(this);
            schedEntry.setOrientation(LinearLayout.HORIZONTAL);
            schedEntry.setGravity(Gravity.CENTER_VERTICAL);
            schedEntry.setPadding(dp(14), dp(12), dp(14), dp(12));
            GradientDrawable scBg = new GradientDrawable();
            scBg.setCornerRadius(dp(14));
            scBg.setColor(Color.parseColor("#14000000"));
            scBg.setStroke(Math.round(1f * getResources().getDisplayMetrics().density),
                    Color.parseColor("#22FFFFFF"));
            schedEntry.setBackground(scBg);
            TextView scText = new TextView(this);
            scText.setText(scheduleSummaryText());
            scText.setTextColor(Color.parseColor("#CCFFFFFF"));
            scText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            schedEntry.addView(scText, new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            TextView scArrow = new TextView(this);
            scArrow.setText("›");
            scArrow.setTextColor(Color.parseColor("#88FFFFFF"));
            scArrow.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
            schedEntry.addView(scArrow);
            schedEntry.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    dialog.dismiss();
                    showScheduleManager();
                }
            });
            LinearLayout.LayoutParams sclp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            sclp.topMargin = dp(10);
            root.addView(schedEntry, sclp);

            // 批次86-P0-3：事件触发器入口**撤下**（批次85-R4 加的那一行）。
            // 用户反馈「这些事件有什么用」属实——动作侧目前只有「交给 AI 执行」一种，做不了
            // 「接通电源→静音」这类最自然的用法，入口留着只会误导。引擎 / TriggerReceiver /
            // android_trigger 工具 / `/trigger` 路由全部保留（见 docs/批次86-重审与瘦身方案.md
            // §P1-3），等有 ≥3 个真实动作场景再把入口放回来。

            // 分隔线 + 底栏（左状态 + 右「关闭」pill）
            View div1 = new View(this);
            div1.setBackgroundColor(Color.parseColor("#1FFFFFFF"));
            LinearLayout.LayoutParams d1lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, dp(1));
            d1lp.topMargin = dp(14);
            root.addView(div1, d1lp);

            LinearLayout foot = new LinearLayout(this);
            foot.setOrientation(LinearLayout.HORIZONTAL);
            foot.setGravity(Gravity.CENTER_VERTICAL);
            TextView launchMode = new TextView(this);
            launchMode.setTextColor(Color.parseColor("#66FFFFFF"));
            launchMode.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            // 左侧 weight 占位：nodeProcess == null 时隐藏状态文字，关闭 pill 仍贴右
            foot.addView(launchMode, new LinearLayout.LayoutParams(0,
                    LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            if (nodeProcess != null) {
                // 仅本进程确实 spawn 过 node 时展示 runtimeMode（含产物缺失/自动降级的本次回退）
                launchMode.setText("本次启动：" + runtimeMode);
            } else {
                launchMode.setVisibility(View.GONE);
            }
            TextView closeBtn = new TextView(this);
            closeBtn.setText("关闭");
            closeBtn.setTextColor(Color.WHITE);
            closeBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            GradientDrawable closeBg = new GradientDrawable();
            closeBg.setColor(Color.parseColor("#33000000"));
            closeBg.setCornerRadius(dp(12));
            closeBtn.setBackground(closeBg);
            closeBtn.setPadding(dp(14), dp(6), dp(14), dp(6));
            closeBtn.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { dialog.dismiss(); }
            });
            foot.addView(closeBtn);
            LinearLayout.LayoutParams flp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            flp.topMargin = dp(10);
            root.addView(foot, flp);

            // 分隔线 + destructive 退出行（收编自顶栏「退出」pill）：dismiss 后走原确认弹窗
            View div2 = new View(this);
            div2.setBackgroundColor(Color.parseColor("#1FFFFFFF"));
            LinearLayout.LayoutParams d2lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, dp(1));
            d2lp.topMargin = dp(12);
            root.addView(div2, d2lp);

            TextView exitRow = new TextView(this);
            exitRow.setText("退出 deepdive · 停止保活");
            exitRow.setTextColor(Color.parseColor("#E57373"));
            exitRow.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            exitRow.setGravity(Gravity.CENTER);
            exitRow.setPadding(0, dp(12), 0, dp(12));
            exitRow.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    dialog.dismiss();
                    confirmExit();
                }
            });
            root.addView(exitRow, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

            // 无系统标题/按钮；窗口背景透明（露出自绘圆角），宽度 = 屏宽 - 48dp
            // 批次85-R4：设置面板的入口行随批次只增不减，已经超过一屏（真机实测：新增的「事件触发器」行被裁在屏外，而 Dialog 本身不滚动）。
            // 包一层 ScrollView + 限高，让底部行（定时任务 / 退出）始终可达。
            ScrollView settingsScroll = new ScrollView(this);
            settingsScroll.addView(root, new ScrollView.LayoutParams(
                    ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT));
            dialog.setContentView(settingsScroll);
            Window win = dialog.getWindow();
            if (win != null) {
                win.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
                android.util.DisplayMetrics dm = new android.util.DisplayMetrics();
                getWindowManager().getDefaultDisplay().getMetrics(dm);
                // 限高（屏高 - 2×60dp 边距）：内容短时仍然包住内容，超长时改为滚动
                win.setLayout(dm.widthPixels - dp(48), Math.min(dm.heightPixels - dp(120), dm.heightPixels));
            }
            dialog.show();
        } catch (Throwable t) {
            Log.w(TAG, "settings dialog failed", t);
        }
    }

    /** 批次17d：Runtime 卡片选中态绘制。选中 = 1.5dp 蓝描边 #4A9EFF + 底色 #1A4A9EFF +
     *  18dp 实心蓝圆点；未选中 = 描边 #22FFFFFF + 底色 #14000000 + 2dp 描边空心圆点 #66FFFFFF。 */
    private void applyRuntimeCardStyle(LinearLayout card, View dot, boolean selected) {
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(14));
        bg.setStroke(Math.round(1.5f * getResources().getDisplayMetrics().density),
                Color.parseColor(selected ? "#4A9EFF" : "#22FFFFFF"));
        bg.setColor(Color.parseColor(selected ? "#1A4A9EFF" : "#14000000"));
        card.setBackground(bg);
        GradientDrawable dotBg = new GradientDrawable();
        dotBg.setShape(GradientDrawable.OVAL);
        if (selected) {
            dotBg.setColor(Color.parseColor("#4A9EFF"));
        } else {
            dotBg.setColor(Color.TRANSPARENT);
            dotBg.setStroke(dp(2), Color.parseColor("#66FFFFFF"));
        }
        dot.setBackground(dotBg);
    }

    // ============ 调试 · 本地桥 Token（批次14w3 T2）============
    /** 本实例是否已弹过 token 查看框：intent extra 会随 Activity 存活（onResume 反复触发），
     *  不加守卫会每次回前台都弹。仅内存态，不持久化（进程重启后 am start 重来即可再弹）。 */
    private boolean debugTokenShown = false;

    /**
     * 调试入口（批次14w3 T2）：`adb shell am start -n com.deepseek.harness/.MainActivity
     * --es dsh_debug_token 1` 时在 onResume 弹出 localToken() 查看框。
     * 仅本机排查用：不落日志、不写文件、不自动复制剪贴板——token 用等宽字体展示、
     * setTextIsSelectable(true) 长按手动选中复制（避免自动写剪贴板扩大嗅探面）。
     * 无持久化开关；extra 不传则第一行判断即返回，行为与现在完全一致。
     * 失败只 Log.w（不含 token 内容），不影响主流程。
     */
    private void maybeShowDebugTokenDialog() {
        if (debugTokenShown) return;
        try {
            Intent in = getIntent();
            if (in == null || !"1".equals(in.getStringExtra("dsh_debug_token"))) return;
            debugTokenShown = true; // 本实例只弹一次
            final String token = localToken();
            // 说明行 + token 行：全程序化自绘（项目 UI 惯例，同 12m 设置弹窗），深色主题下可读
            android.widget.LinearLayout box = new android.widget.LinearLayout(this);
            box.setOrientation(android.widget.LinearLayout.VERTICAL);
            TextView hint = new TextView(this);
            hint.setText("仅本机排查用；请勿泄露。长按 token 可选中复制（不会自动进剪贴板）。");
            hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            hint.setTextColor(Color.parseColor("#8b98a9"));
            hint.setPadding(dp(8), dp(2), dp(8), dp(6));
            box.addView(hint);
            TextView tv = new TextView(this);
            tv.setText(token == null || token.isEmpty() ? "（token 为空：未配置鉴权，桥未校验来源）" : token);
            tv.setTypeface(android.graphics.Typeface.MONOSPACE);
            tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            tv.setTextColor(Color.WHITE);
            tv.setTextIsSelectable(true); // 长按选中复制
            tv.setPadding(dp(8), dp(4), dp(8), dp(14));
            box.addView(tv);
            new AlertDialog.Builder(this)
                    .setTitle("调试 · 本地桥 Token")
                    .setView(box)
                    .setNegativeButton("关闭", null)
                    .show();
        } catch (Throwable t) {
            // 调试入口失败不影响主流程；异常里不含 token 内容
            Log.w(TAG, "debug token dialog failed", t);
        }
    }

    // ============ 界面主题色（跟随系统深/浅色，权限页与加载页共用）============
    private boolean isDark() {
        int m = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return m == Configuration.UI_MODE_NIGHT_YES;
    }
    private int cBg() { return Color.parseColor(isDark() ? "#0b0f1a" : "#f7f8fb"); }
    private int cCard() { return Color.parseColor(isDark() ? "#161c2a" : "#ffffff"); }
    private int cText() { return Color.parseColor(isDark() ? "#e6edf3" : "#1f2328"); }
    private int cSub() { return Color.parseColor(isDark() ? "#8b98a9" : "#6b7280"); }
    private int cGreen() { return Color.parseColor("#1f9d6b"); }
    private int cRed() { return Color.parseColor("#d9503f"); }

    private long deleteRecursive(File f) {
        if (f == null || !f.exists()) return 0;
        long total = 0;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) for (File c : children) total += deleteRecursive(c);
        }
        total += f.length();
        if (!f.delete()) {
            // 删除失败（通常是目录仍非空，因子项删除失败）。再递归扫一遍重试。
            if (f.isDirectory()) {
                File[] children = f.listFiles();
                if (children != null) for (File c : children) total += deleteRecursive(c);
            }
            f.delete();
        }
        return total;
    }

    // ② ABI 检测：node 引擎仅 arm64，非 arm64 设备会启动失败——尽早提示用户
    private void checkAbiCompat() {
        try {
            if (Build.SUPPORTED_ABIS == null || Build.SUPPORTED_ABIS.length == 0) return;
            String abi = Build.SUPPORTED_ABIS[0];
            boolean arm64 = abi.startsWith("arm64") || abi.contains("arm64-v8a");
            if (arm64) return; // 支持，正常继续
            // 32 位设备：引擎（node arm64 二进制）无法运行，提示但不阻止（用户可能知道自己在做什么）
            ui.post(new Runnable() {
                @Override public void run() {
                    try {
                        new AlertDialog.Builder(MainActivity.this)
                                .setTitle("设备架构不受支持")
                                .setMessage("当前设备为 32 位（" + abi + "），而 DSH 引擎仅支持 64 位（arm64）。\n\nAI 引擎可能无法启动，建议更换 64 位设备使用。")
                                .setNegativeButton("知道了", null)
                                .show();
                    } catch (Throwable ignored) {}
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "checkAbiCompat error", t);
        }
    }

    // ④ 电池优化引导：App 被系统限制后台时，引擎挂后台可能被杀——提示用户设"不限制"
    private void checkBatteryOptimization() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            if (pm.isIgnoringBatteryOptimizations(getPackageName())) return; // 已"不限制"，正常
            ui.post(new Runnable() {
                @Override public void run() {
                    try {
                        new AlertDialog.Builder(MainActivity.this)
                                .setTitle("建议：允许后台运行")
                                .setMessage("当前应用被系统限制后台活动，AI 执行任务时挂后台可能被系统杀掉。\n\n建议将本应用设为「不限制」电池优化，确保任务持续运行。")
                                .setPositiveButton("去设置", new DialogInterface.OnClickListener() {
                                    @Override public void onClick(DialogInterface d, int w) {
                                        openSystemSetting(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                                    }
                                })
                                .setNegativeButton("暂不", null)
                                .show();
                    } catch (Throwable ignored) {}
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "checkBatteryOptimization error", t);
        }
    }

    // ⑧ 更新提示：后台查 GitHub Releases 最新 tag，与本地 versionName 比对，有新版弹提示
    private void checkForUpdate() {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    URL url = new URL("https://api.github.com/repos/hkx521/deepseek-harness-android-updater/releases/latest");
                    HttpURLConnection c = (HttpURLConnection) url.openConnection();
                    c.setConnectTimeout(5000);
                    c.setReadTimeout(5000);
                    c.setRequestProperty("User-Agent", "dsh-android");
                    int code = c.getResponseCode();
                    if (code != 200) { c.disconnect(); return; }
                    InputStream in = c.getInputStream();
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] b = new byte[4096];
                    int n;
                    while ((n = in.read(b)) > 0) out.write(b, 0, n);
                    in.close();
                    c.disconnect();
                    String json = new String(out.toByteArray(), "UTF-8");
                    // 解析 "tag_name":"vX.Y.Z"
                    String tag = null;
                    int ti = json.indexOf("\"tag_name\"");
                    if (ti >= 0) {
                        int q1 = json.indexOf('"', ti + 10);
                        int q2 = q1 >= 0 ? json.indexOf('"', q1 + 1) : -1;
                        if (q1 >= 0 && q2 > q1) tag = json.substring(q1 + 1, q2);
                    }
                    if (tag == null || tag.isEmpty()) return;
                    String latest = tag.replace("v", "").replace("-lite", "").replace("-beta", "");
                    String local = "";
                    try { local = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Throwable ignored) {}
                    // 只比较主版本号（数字部分），忽略后缀
                    final String fLocal = local;
                    if (isNewerVersion(latest, fLocal)) {
                        final String ftag = tag;
                        ui.post(new Runnable() {
                            @Override public void run() {
                                try {
                                    new AlertDialog.Builder(MainActivity.this)
                                            .setTitle("发现新版本 " + ftag)
                                            .setMessage("当前版本 " + fLocal + "，最新 " + ftag + "。\n\n前往 GitHub Releases 下载更新（正式版 / Lite 共存版可选）。")
                                            .setPositiveButton("去下载", new DialogInterface.OnClickListener() {
                                                @Override public void onClick(DialogInterface d, int w) {
                                                    try {
                                                        startActivity(new Intent(Intent.ACTION_VIEW,
                                                                Uri.parse("https://github.com/hkx521/deepseek-harness-android-updater/releases")));
                                                    } catch (Throwable ignored) {}
                                                }
                                            })
                                            .setNegativeButton("稍后", null)
                                            .show();
                                } catch (Throwable ignored) {}
                            }
                        });
                    }
                } catch (Throwable t) {
                    // 网络失败/离线时静默跳过（不打扰用户）
                }
            }
        }, "update-check").start();
    }

    /** 简单版本号比较："1.4.0" vs "1.3.3" → true（1.4.0 更新）。 */
    private boolean isNewerVersion(String latest, String local) {
        try {
            String[] a = latest.split("\\.");
            String[] b = (local == null ? "" : local).split("\\.");
            for (int i = 0; i < Math.max(a.length, b.length); i++) {
                int x = i < a.length ? parseIntSafe(a[i]) : 0;
                int y = i < b.length ? parseIntSafe(b[i]) : 0;
                if (x != y) return x > y;
            }
            return false;
        } catch (Throwable t) {
            return false;
        }
    }

    private int parseIntSafe(String s) {
        // 版本段可能带后缀（如 "5-test"/"5-lite"）：提取前导数字，避免 1.6.5-test 被误判为低于 1.6.1
        if (s == null) return 0;
        int i = 0;
        String t = s.trim();
        while (i < t.length() && Character.isDigit(t.charAt(i))) i++;
        if (i == 0) return 0;
        try { return Integer.parseInt(t.substring(0, i)); } catch (Throwable ex) { return 0; }
    }

    // 捕获未处理异常，写到外部崩溃日志（便于无 adb 时排查闪退）
    private void installCrashHandler() {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override public void uncaughtException(Thread t, Throwable e) {
                try {
                    File dir = new File(Environment.getExternalStorageDirectory(), EXT_DSHROOT_ROOT);
                    if (!dir.exists()) dir.mkdirs();
                    File f = new File(dir, "crash.log");
                    FileOutputStream fos = new FileOutputStream(f, true);
                    String s = "\n==== " + new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date())
                            + " thread=" + t.getName() + " ====\n";
                    fos.write(s.getBytes("UTF-8"));
                    java.io.StringWriter sw = new java.io.StringWriter();
                    e.printStackTrace(new java.io.PrintWriter(sw));
                    fos.write(sw.toString().getBytes("UTF-8"));
                    fos.close();
                } catch (Throwable ignored) {}
                if (prev != null) prev.uncaughtException(t, e);
                else android.os.Process.killProcess(android.os.Process.myPid());
            }
        });
    }

    // 清理外部公共目录下遗留的 .trash-* 垃圾目录（清空数据 rename 后后台删除未完成）。
    private void cleanupTrashDirs(File externalRoot) {
        File[] children = externalRoot.listFiles();
        if (children == null) return;
        for (File c : children) {
            if (c.isDirectory() && c.getName().startsWith(".trash-")) {
                deleteRecursive(c);
            }
        }
    }

    /** 批次85-R1b：设置页入口复用本页；revisit=true 时用「配置手机权限」口径，且**不改** setup_done。 */
    private void showPermissionScreen() { showPermissionScreen(false); }

    private void showPermissionScreen(boolean revisit) {
        permRows.clear();

        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(cBg());

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(24), dp(20), dp(24), dp(24));
        scroll.addView(col, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT));

        // 标题
        TextView title = new TextView(this);
        title.setText(revisit ? "配置手机权限" : "首次使用 · 配置手机权限");
        title.setTextColor(cText());
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        col.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText(revisit
                ? "状态每次进来都重新读系统设置；点任意一行直达对应的系统授权页。"
                : "在进入 DeepSeek Harness 之前，请先授权以下能力。\n配好后点底部「开始使用」才会解压运行时。");
        subtitle.setTextColor(cSub());
        subtitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        subtitle.setPadding(0, dp(8), 0, dp(16));
        col.addView(subtitle);

        // 权限项
        // 批次86-P2-2：合并「存储权限 / 所有文件访问」两行 —— 对用户是同一件事
        // （Android 11+ 由「所有文件访问」覆盖，11 以下由运行时存储权限覆盖），
        // 状态取二者「或」，点击时按当前缺的那一环走（11+ 缺所有文件访问 → 跳系统页，否则申请运行时权限）。
        addPermRow(col, "存储与文件访问", "读写手机文件、导入导出内容；Android 11 及以上需在系统页单独授予「所有文件访问」。",
                new StatusProvider() {
                    @Override public boolean granted() {
                        boolean runtime = checkSelfPermission("android.permission.READ_EXTERNAL_STORAGE") == PackageManager.PERMISSION_GRANTED
                                && checkSelfPermission("android.permission.WRITE_EXTERNAL_STORAGE") == PackageManager.PERMISSION_GRANTED;
                        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager() || runtime;
                        return runtime;
                    }
                },
                new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        if (Build.VERSION.SDK_INT >= 30 && !Environment.isExternalStorageManager()) {
                            try {
                                Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                                i.setData(Uri.parse("package:" + getPackageName()));
                                startActivity(i);
                            } catch (Exception e) {
                                try {
                                    startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                                } catch (Exception e2) {
                                    Log.w(TAG, "无法打开所有文件访问设置", e2);
                                }
                            }
                        } else {
                            requestPermissions(new String[]{
                                    "android.permission.READ_EXTERNAL_STORAGE",
                                    "android.permission.WRITE_EXTERNAL_STORAGE"}, REQ_STORAGE);
                        }
                    }
                });

        // 批次85-R1：无障碍服务是读屏/点击的命脉，此前权限页没有它（只在被系统关掉后弹通知）。
        addPermRow(col, "无障碍服务（读屏与自动操作）", "让 AI 读取屏幕内容并模拟点击、输入。未授权时助手只能对话，不能替你操作手机。",
                new StatusProvider() {
                    @Override public boolean granted() { return a11yEnabledInSecureSettings(); }
                },
                new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        try {
                            Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(i);
                        } catch (Throwable t) {
                            Log.w(TAG, "打开无障碍设置失败", t);
                        }
                    }
                });

        // 批次85-R1：通知使用权（NotificationListener）—— 能力早已实现，此前 App 侧既无入口也无状态显示。
        addPermRow(col, "通知使用权（读取通知）", "让 AI 读取通知内容（验证码、快递、日程提醒等）。开关在系统「通知使用权」页里。",
                new StatusProvider() {
                    @Override public boolean granted() {
                        if (NotificationListener.isReady()) return true;
                        try {
                            String enabled = Settings.Secure.getString(getContentResolver(),
                                    "enabled_notification_listeners");
                            if (enabled == null || enabled.isEmpty()) return false;
                            ComponentName cn = new ComponentName(MainActivity.this, NotificationListener.class);
                            return enabled.contains(cn.flattenToString())
                                    || enabled.contains(cn.flattenToShortString());
                        } catch (Throwable t) {
                            return false;
                        }
                    }
                },
                new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        try {
                            Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
                            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(i);
                        } catch (Throwable t) {
                            Log.w(TAG, "打开通知使用权设置失败", t);
                        }
                    }
                });

        addPermRow(col, "悬浮窗", "让 AI 和工具能在其它应用之上显示内容。",
                new StatusProvider() {
                    @Override public boolean granted() { return Settings.canDrawOverlays(MainActivity.this); }
                },
                new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        openSystemSetting(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                    }
                });

        addPermRow(col, "修改系统设置", "允许读写系统设置（亮度、音量、常亮等）。",
                new StatusProvider() {
                    @Override public boolean granted() { return Settings.System.canWrite(MainActivity.this); }
                },
                new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        openSystemSetting(Settings.ACTION_MANAGE_WRITE_SETTINGS);
                    }
                });

        addPermRow(col, "使用情况访问", "查看应用使用时长与统计信息。",
                new StatusProvider() {
                    @Override public boolean granted() {
                        AppOpsManager ops = (AppOpsManager) getSystemService(Context.APP_OPS_SERVICE);
                        int mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), getPackageName());
                        return mode == AppOpsManager.MODE_ALLOWED;
                    }
                },
                new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        openSystemSetting(Settings.ACTION_USAGE_ACCESS_SETTINGS);
                    }
                });

        addPermRow(col, "安装未知来源应用", "允许安装 APK（侧载、AI 帮你装应用）。",
                new StatusProvider() {
                    @Override public boolean granted() {
                        if (Build.VERSION.SDK_INT < 26) return true;
                        return getPackageManager().canRequestPackageInstalls();
                    }
                },
                new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        openSystemSetting(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    }
                });

        addPermRow(col, "忽略电池优化", "后台常驻不被系统杀掉（保持服务在线）。",
                new StatusProvider() {
                    @Override public boolean granted() {
                        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                        return pm.isIgnoringBatteryOptimizations(getPackageName());
                    }
                },
                new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        openSystemSetting(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    }
                });

        addPermRow(col, "通知权限", "接收 AI 完成、提醒等通知。",
                new StatusProvider() {
                    @Override public boolean granted() {
                        if (Build.VERSION.SDK_INT < 33) return true;
                        return checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
                    }
                },
                new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        if (Build.VERSION.SDK_INT >= 33) {
                            if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIFICATION);
                            } else {
                                // 已授权，跳到应用通知设置
                                try {
                                    Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                                    i.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                                    startActivity(i);
                                } catch (Exception e) {
                                    openSystemSetting(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                                }
                            }
                        } else {
                            openSystemSetting(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                        }
                    }
                });

        addPermRow(col, "应用启动管理（荣耀/自启保活）", "MagicOS 专属：设为「手动管理」并开启允许自启动、允许关联启动与允许后台活动，确保助手开机自愈不被系统查杀。",
                new StatusProvider() {
                    @Override public boolean granted() {
                        return false;
                    }
                },
                new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        openStartupManager();
                    }
                });

        // 批次55-C：保活自检卡片（逐条判据的真机取值 + 一键引导 + 最近一次自检）。
        // 放在「应用启动管理」行下面：那一行是「怎么放行」，这张卡是「现在到底通不通」。
        col.addView(buildKeepAliveCard());

        addPermRow(col, "Shizuku / Root 特权（可选）", "不授权也能正常使用：文件读写、预览、编辑只需「所有文件访问」权限。授权后可让 AI 执行系统级操作（安装/卸载应用、改系统设置、模拟点击等）。",
                new StatusProvider() {
                    @Override public boolean granted() {
                        // 只读缓存：root 探测在后台线程执行（probeShizuku），不在主线程跑 su
                        return (shizukuOk != null && shizukuOk) || (rootOk != null && rootOk);
                    }
                },
                new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        showShizukuDialog();
                    }
                });

        // ===== AI 工作区（可选）：选择外部共享存储文件夹作为 AI 文件操作的工作根目录 =====
        LinearLayout wsRow = new LinearLayout(this);
        wsRow.setOrientation(LinearLayout.HORIZONTAL);
        wsRow.setGravity(Gravity.CENTER_VERTICAL);
        wsRow.setPadding(dp(16), dp(14), dp(16), dp(14));
        wsRow.setBackgroundColor(cCard());
        LinearLayout.LayoutParams wslp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        wslp.bottomMargin = dp(10);
        wsRow.setLayoutParams(wslp);

        LinearLayout wsLeft = new LinearLayout(this);
        wsLeft.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams wsllp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        wsLeft.setLayoutParams(wsllp);

        TextView wsTitle = new TextView(this);
        wsTitle.setText("AI 工作区（可选）");
        wsTitle.setTextColor(cText());
        wsTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        wsTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        wsLeft.addView(wsTitle);

        workspaceDescView = new TextView(this);
        workspaceDescView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        workspaceDescView.setTextColor(cSub());
        workspaceDescView.setPadding(0, dp(3), 0, 0);
        wsLeft.addView(workspaceDescView);

        wsRow.addView(wsLeft);
        wsRow.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { onWorkspaceRowClick(); }
        });
        col.addView(wsRow);

        // 开始使用按钮
        Button start = new Button(this);
        start.setText(revisit ? "返回" : "开始使用");
        start.setTextColor(Color.WHITE);
        start.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        start.setBackgroundColor(Color.parseColor("#4d6bfe"));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        lp.topMargin = dp(20);
        start.setLayoutParams(lp);
        start.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (revisit) { showEngineScreen(); return; }   // 批次85-R1b：从设置页进来时只返回
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("setup_done", true).apply();
                showEngineScreen();
                startEngine();
            }
        });
        col.addView(start);

        TextView skip = new TextView(this);
        skip.setText("部分权限可稍后在系统设置中开启");
        skip.setTextColor(cSub());
        skip.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        skip.setGravity(Gravity.CENTER);
        skip.setPadding(0, dp(10), 0, 0);
        col.addView(skip);

        setContentView(scroll);
        refreshAllStatuses();
        probeShizuku();
    }

    /**
     * 批次85-R3：危险操作审批门（dsh_prefs/confirm_gate）的现状文案。
     *
     * <p>托管模式会**强制开启**该门（HostedEngineManager 把用户原值存进
     * confirm_gate_hosted_backup，退出托管时还原），所以这里必须同时显示「当前生效」与
     * 「你的设置」—— 只显示一个布尔会误导用户。</p>
     */
    private String confirmGateRowText() {
        SharedPreferences sp = getSharedPreferences("dsh_prefs", MODE_PRIVATE);
        boolean hosted = sp.contains(HostedEngineManager.KEY_CONFIRM_GATE_BACKUP);
        boolean effective = sp.getBoolean(HostedEngineManager.KEY_CONFIRM_GATE, false);
        boolean wanted = hosted
                ? sp.getBoolean(HostedEngineManager.KEY_CONFIRM_GATE_BACKUP, false)
                : effective;
        StringBuilder sb = new StringBuilder("危险操作审批\n");
        if (hosted) {
            sb.append(effective ? "托管模式：强制开启（卸载/改系统设置等会先问你）"
                    : "托管模式：当前未开启");
            sb.append("；你的设置：").append(wanted ? "开启" : "关闭").append("（退出托管后生效）");
        } else {
            sb.append(effective ? "已开启：危险操作会先问你"
                    : "已关闭（免审批）：危险操作直接执行，不询问");
        }
        return sb.append("（点此切换）").toString();
    }
 
    private void addPermRow(LinearLayout parent, String title, String desc,
                            final StatusProvider provider, final View.OnClickListener click) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(16), dp(14), dp(16), dp(14));
        row.setBackgroundColor(cCard());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(10);
        row.setLayoutParams(lp);

        LinearLayout left = new LinearLayout(this);
        left.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        left.setLayoutParams(llp);

        TextView t = new TextView(this);
        t.setText(title);
        t.setTextColor(cText());
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        t.setTypeface(null, android.graphics.Typeface.BOLD);
        left.addView(t);

        TextView d = new TextView(this);
        d.setText(desc);
        d.setTextColor(cSub());
        d.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        d.setPadding(0, dp(3), 0, 0);
        left.addView(d);

        TextView status = new TextView(this);
        status.setText("检测中…");
        status.setTextColor(cSub());
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        status.setGravity(Gravity.CENTER_VERTICAL);
        status.setPadding(dp(10), 0, dp(4), 0);

        row.addView(left);
        row.addView(status);
        row.setOnClickListener(click);
        parent.addView(row);

        PermRow pr = new PermRow();
        pr.status = status;
        pr.provider = provider;
        permRows.add(pr);
    }

    // ============ 批次55-C：保活自检卡片（后台常驻诊断 + 一键引导） ============

    /**
     * 构建「保活自检」卡片：逐条判据的真机取值 + 引导文案 + 一键跳转 + 最近一次自检。
     *
     * <p>判据与文案全部来自 {@link KeepAlivePolicy#selfCheck}（纯逻辑、自带 JVM 自测），本方法只做
     * 「取值 → 渲染 → 跳转」三件事。卡片实例字段会被后建的那一份覆盖（权限页与设置弹窗各一份），
     * {@link #refreshKeepAliveCard()} 始终刷新最后建出来的一份。</p>
     */
    private LinearLayout buildKeepAliveCard() {
        keepAliveCard = new LinearLayout(this);
        keepAliveCard.setOrientation(LinearLayout.VERTICAL);
        keepAliveCard.setPadding(dp(16), dp(14), dp(16), dp(14));
        keepAliveCard.setBackgroundColor(cCard());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(10);
        keepAliveCard.setLayoutParams(lp);

        TextView title = new TextView(this);
        title.setText("保活自检（后台常驻）");
        title.setTextColor(cText());
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        keepAliveCard.addView(title);

        keepAliveSummaryView = new TextView(this);
        keepAliveSummaryView.setText("检测中…");
        keepAliveSummaryView.setTextColor(cSub());
        keepAliveSummaryView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        keepAliveSummaryView.setPadding(0, dp(4), 0, 0);
        keepAliveCard.addView(keepAliveSummaryView);

        keepAliveDetailView = new TextView(this);
        keepAliveDetailView.setTextColor(cSub());
        keepAliveDetailView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        keepAliveDetailView.setPadding(0, dp(6), 0, 0);
        keepAliveCard.addView(keepAliveDetailView);

        // 一键引导：全部失败时各自有降级链（详见 openStartupManager / openBatteryOptimizationSetting）
        LinearLayout btns = new LinearLayout(this);
        btns.setOrientation(LinearLayout.HORIZONTAL);
        btns.setPadding(0, dp(10), 0, 0);
        btns.addView(keepAliveJumpButton("应用启动管理", new View.OnClickListener() {
            @Override public void onClick(View v) {
                openStartupManager();
                refreshKeepAliveCard();
            }
        }));
        btns.addView(keepAliveJumpButton("电池优化", new View.OnClickListener() {
            @Override public void onClick(View v) {
                openBatteryOptimizationSetting();
                refreshKeepAliveCard();
            }
        }));
        btns.addView(keepAliveJumpButton("应用详情", new View.OnClickListener() {
            @Override public void onClick(View v) {
                openSystemSetting(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                refreshKeepAliveCard();
            }
        }));
        btns.addView(keepAliveJumpButton("重新自检", new View.OnClickListener() {
            @Override public void onClick(View v) {
                refreshKeepAliveCard();
                showToast("已重新自检");
            }
        }));
        // 批次67：引擎级常驻入口（托管开关 / Shizuku 授权 / 实况窗设置）
        btns.addView(keepAliveJumpButton("引擎托管", new View.OnClickListener() {
            @Override public void onClick(View v) {
                boolean on = !HostedEngineManager.hostedWanted(MainActivity.this);
                HostedEngineManager.setHostedWanted(MainActivity.this, on);
                if (on) {
                    new Thread(new Runnable() {
                        @Override public void run() { HostedEngineManager.ensureRunning(MainActivity.this); }
                    }, "hosted-enable").start();
                }
                showToast(on ? "已开启引擎托管常驻（覆盖安装/强停不再中断）" : "已回退 App 内引擎模式");
                refreshKeepAliveCard();
            }
        }));
        btns.addView(keepAliveJumpButton("Shizuku 授权", new View.OnClickListener() {
            @Override public void onClick(View v) {
                requestShizukuPermissionOrOpen();
                refreshKeepAliveCard();
            }
        }));
        // 批次70：实况窗（灵动胶囊）显式开关 —— 绑定 dsh_prefs/promoted_live_update，
        // 关闭即撤销实况窗并退回自绘胶囊兜底（批次55/56 语义）。
        liveUpdateToggleView = keepAliveJumpButton("实况窗", new View.OnClickListener() {
            @Override public void onClick(View v) {
                boolean on = !PromotedProgressNotifier.isEnabled(MainActivity.this);
                getSharedPreferences("dsh_prefs", MODE_PRIVATE).edit()
                        .putBoolean(PromotedProgressNotifier.KEY_ENABLED, on).apply();
                if (!on) PromotedProgressNotifier.stop(MainActivity.this);
                showToast(on ? "已开启实况窗（灵动胶囊）" : "已关闭实况窗（退回自绘胶囊）");
                refreshKeepAliveCard();
            }
        });
        btns.addView(liveUpdateToggleView);
        btns.addView(keepAliveJumpButton("实况窗设置", new View.OnClickListener() {
            @Override public void onClick(View v) {
                openPromotedNotificationSetting();
                refreshKeepAliveCard();
            }
        }));
        // 批次80：「直接执行」开关 —— 长自动化被模型反复问「要不要继续 / 请授权」时，
        // 用它在 prompt 里前置用户授权（只影响措辞，不改变任何权限或安全闸门）。
        autoProceedToggleView = keepAliveJumpButton("直接执行", new View.OnClickListener() {
            @Override public void onClick(View v) {
                SharedPreferences sp = getSharedPreferences("dsh_prefs", MODE_PRIVATE);
                boolean on = !sp.getBoolean("agent_auto_proceed", false);
                sp.edit().putBoolean("agent_auto_proceed", on).apply();
                showToast(on ? "已开启「直接执行」：任务不再反复征求授权"
                             : "已关闭「直接执行」：恢复任务中确认");
                refreshKeepAliveCard();
            }
        });
        btns.addView(autoProceedToggleView);
        // 批次79 修复（真机取证）：保活卡片可用宽仅 ~864px（竖屏 1088 −边距），8 个 WRAP_CONTENT
        // 按钮里后 5 个（含「实况窗：开/关」「实况窗设置」）被压成 **0 宽** —— dump 里直接
        // 不出现（AccessibilityService 丢弃 w<=0 节点），坐标点击也打空，用户根本够不到该开关。
        // 改为横向滚动容器：按钮保持原始宽度，超出部分可横滑（不改任何按钮行为/文案）。
        HorizontalScrollView btnsScroll = new HorizontalScrollView(this);
        btnsScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout.LayoutParams btnsScrollLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        btnsScroll.setLayoutParams(btnsScrollLp);
        btnsScroll.addView(btns, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT));
        keepAliveCard.addView(btnsScroll);

        refreshKeepAliveCard();
        return keepAliveCard;
    }

    /** 卡片内胶囊按钮：自绘（系统 Button 在深色主题下会近乎不可见 —— 批次29r2 的教训）。 */
    private TextView keepAliveJumpButton(String text, View.OnClickListener click) {
        TextView b = new TextView(this);
        b.setText(text);
        b.setTextColor(cText());
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(12), dp(7), dp(12), dp(7));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(14));
        bg.setStroke(Math.max(1, dp(1)), cSub());
        b.setBackground(bg);
        b.setOnClickListener(click);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = dp(8);
        b.setLayoutParams(lp);
        return b;
    }

    /**
     * 重算自检并把结果渲染进卡片；同时把本轮自检写进 {@code dsh_prefs}
     * （{@code keepalive_last_check_at} / {@code keepalive_last_check}），
     * 卡片末尾另显示「上一次」自检，便于对照「这次比上次好了没有」。
     */
    private void refreshKeepAliveCard() {
        if (keepAliveSummaryView == null || keepAliveDetailView == null) return;
        KeepAlivePolicy.SelfCheckReport rep;
        try {
            rep = KeepAlivePolicy.selfCheck(keepAliveInputs());
        } catch (Throwable t) {
            Log.w(TAG, "keepalive selfCheck failed", t);
            keepAliveSummaryView.setText("保活自检不可用：" + t.getMessage());
            keepAliveSummaryView.setTextColor(cRed());
            return;
        }
        // 先取上一次的记录（本轮结果马上会覆盖它），再写盘
        long lastAt = 0L;
        String lastSummary = "";
        try {
            SharedPreferences sp = getSharedPreferences(KeepAlivePolicy.PREFS_NAME, MODE_PRIVATE);
            lastAt = sp.getLong(KeepAlivePolicy.PREF_LAST_CHECK_AT, 0L);
            lastSummary = sp.getString(KeepAlivePolicy.PREF_LAST_CHECK_SUMMARY, "");
        } catch (Throwable ignored) {}
        long now = System.currentTimeMillis();
        try {
            getSharedPreferences(KeepAlivePolicy.PREFS_NAME, MODE_PRIVATE).edit()
                    .putLong(KeepAlivePolicy.PREF_LAST_CHECK_AT, now)
                    .putString(KeepAlivePolicy.PREF_LAST_CHECK_SUMMARY, rep.summary).apply();
        } catch (Throwable t) {
            Log.w(TAG, "keepalive check persist failed", t);
        }
        Log.i(TAG, "keepalive self-check -> " + rep.summary);

        if (liveUpdateToggleView != null) {
            // 批次70：开关按钮文案直接反映当前值
            liveUpdateToggleView.setText("实况窗："
                    + (PromotedProgressNotifier.isEnabled(this) ? "开" : "关"));
        }
        if (autoProceedToggleView != null) {
            // 批次80：同上，文案直接反映 dsh_prefs/agent_auto_proceed
            boolean autoOn = false;
            try {
                autoOn = getSharedPreferences("dsh_prefs", MODE_PRIVATE)
                        .getBoolean("agent_auto_proceed", false);
            } catch (Throwable ignored) {
            }
            autoProceedToggleView.setText("直接执行：" + (autoOn ? "开" : "关"));
        }
        keepAliveSummaryView.setText((rep.ok ? "✓ " : "✗ ") + rep.summary);
        keepAliveSummaryView.setTextColor(KeepAlivePolicy.LEVEL_OK.equals(rep.level) ? cGreen()
                : (KeepAlivePolicy.LEVEL_FAIL.equals(rep.level) ? cRed() : cText()));

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < rep.items.length; i++) {
            KeepAlivePolicy.Criterion c = rep.items[i];
            sb.append(c.ok ? "✓ " : "✗ ").append(c.name).append("：").append(c.actual).append('\n');
        }
        // 批次81-T5：App 侧能力（3081）单独一行 —— 它不是「保活」判据（服务在跑也不代表桥在监听），
        // 但它是「引擎在跑、助手报失败」时用户最需要看到的中间态。取悬浮面板同源的探测缓存，
        // 不在主线程发 HTTP（避免 ANR），并如实标注新鲜度。
        sb.append("App 侧能力（3081）：").append(appSideCapabilityLine()).append('\n');
        sb.append('\n').append(rep.guidance);
        sb.append("\n\n最近一次自检：");
        if (lastAt > 0L) {
            sb.append(new java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.US)
                    .format(new java.util.Date(lastAt))).append(" · ").append(lastSummary);
        } else {
            sb.append("无记录（本次为首次）");
        }
        keepAliveDetailView.setText(sb.toString());
    }

    /**
     * 批次81-T5：设置页「App 侧能力（3081）」一行文案。
     *
     * <p>3081 由本进程的 {@code startNotifyServer()} 提供，承载虚拟屏 / 剪贴板 / 通知 /
     * 悬浮窗 / 定时任务上报。App 进程不在场时托管引擎 3080 照常在跑，但助手侧工具全部失败；
     * 这里如实呈现该中间态与恢复动作（打开小鲸鱼助手 / 主界面）。</p>
     *
     * <p>不在主线程发 HTTP：读悬浮面板探测循环写入的静态缓存（{@link OverlayService#appBridgeUp}），
     * 并标注新鲜度；面板未在跑（无缓存）时给出「未探测」而不是假装可用。</p>
     */
    private String appSideCapabilityLine() {
        long at = OverlayService.lastAppBridgeProbeAt;
        if (at <= 0L) {
            return "未探测（悬浮窗未运行；打开悬浮窗或点「开始使用」后可自检）";
        }
        long ageSec = Math.max(0L, (System.currentTimeMillis() - at) / 1000L);
        if (OverlayService.appBridgeUp) {
            return "可用（3081 在监听，最近探活 " + ageSec + "s 前）";
        }
        return "不可用（3081 未监听，最近探活 " + ageSec + "s 前）——打开小鲸鱼助手（App 主界面）后重试；"
                + "虚拟屏/剪贴板/通知/悬浮窗依赖它，引擎 3080 可能仍在运行，属正常";
    }

    /** 采集保活自检的真机取值（照实取，勿凭记忆 —— 批次47 的教训）。 */
    private KeepAlivePolicy.SelfCheck keepAliveInputs() {
        boolean battery = false;
        boolean restricted = false;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            battery = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
        } catch (Throwable t) {
            Log.w(TAG, "battery optimize probe failed", t);
        }
        try {
            android.app.ActivityManager am =
                    (android.app.ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            restricted = am != null && am.isBackgroundRestricted();
        } catch (Throwable t) {
            Log.w(TAG, "background restricted probe failed", t);
        }
        boolean guided = false;
        long beat = 0L;
        try {
            SharedPreferences dp = getSharedPreferences(KeepAlivePolicy.PREFS_NAME, MODE_PRIVATE);
            guided = dp.getBoolean(KeepAlivePolicy.PREF_STARTUP_GUIDED, false);
            beat = dp.getLong(KeepAlivePolicy.PREF_LAST_BEAT_AT, 0L);
        } catch (Throwable ignored) {}
        // 自启开关按权威源读（dsh_prefs 优先、dsh_setup 兼容回退，缺省 true）
        boolean autostart = ballAutostartWanted();
        String manu = "";
        try {
            manu = Build.MANUFACTURER;
        } catch (Throwable ignored) {}
        // 批次67：引擎级取值（照实探测，勿凭记忆 —— 批次47 的教训）
        boolean engineUp = false;
        boolean hostedNow = false;
        boolean watchdogUp = false;
        boolean shizukuOk = false;
        try {
            shizukuOk = HostedEngineManager.shizukuReady();
            HostedEngineManager.Status st = HostedEngineManager.probe(this);
            hostedNow = st.hosted;
            watchdogUp = st.watchdogPid > 0;
            engineUp = st.portListening;
        } catch (Throwable t) {
            Log.w(TAG, "hosted engine probe failed", t);
        }
        if (!engineUp) engineUp = HostedEngineManager.engineOnline(this);
        boolean exactAlarm = true;
        try {
            android.app.AlarmManager alarmMgr =
                    (android.app.AlarmManager) getSystemService(Context.ALARM_SERVICE);
            exactAlarm = alarmMgr == null || Build.VERSION.SDK_INT < 31
                    || alarmMgr.canScheduleExactAlarms();
        } catch (Throwable t) {
            Log.w(TAG, "exact alarm probe failed", t);
        }
        boolean promoted = true;
        try {
            android.app.NotificationManager nm =
                    (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            promoted = nm == null || Build.VERSION.SDK_INT < 36
                    || nm.canPostPromotedNotifications();
        } catch (Throwable t) {
            Log.w(TAG, "promoted notification probe failed", t);
        }
        return new KeepAlivePolicy.SelfCheck(battery, restricted, autostart, OverlayService.isRunning,
                bootReceiverDeclared(), guided, beat, System.currentTimeMillis(), manu,
                engineUp, hostedNow, watchdogUp, exactAlarm, promoted, shizukuOk, false,
                HostedEngineManager.activeChannel());
    }

    /** 批次67：Shizuku 授权（已装未授权则拉起授权请求；服务没跑则打开 Shizuku 应用让用户激活）。 */
    private void requestShizukuPermissionOrOpen() {
        try {
            if (HostedEngineManager.shizukuReady()) {
                showToast("Shizuku 已授权，托管引擎可常驻");
                return;
            }
            if (HostedEngineManager.shizukuBinderAlive()) {
                Shizuku.requestPermission(REQ_SHIZUKU);
                return;
            }
            openShizukuApp();
        } catch (Throwable t) {
            Log.w(TAG, "requestShizukuPermissionOrOpen failed", t);
            openShizukuApp();
        }
    }

    /** 批次67：Android 16 实况窗（Live Updates）应用级开关页；老系统退回本应用通知设置。 */
    private void openPromotedNotificationSetting() {
        try {
            if (Build.VERSION.SDK_INT >= 36) {
                Intent i = new Intent("android.settings.MANAGE_APP_PROMOTED_NOTIFICATIONS");
                i.setData(Uri.parse("package:" + getPackageName()));
                startActivity(i);
                return;
            }
        } catch (Throwable t) {
            Log.w(TAG, "promoted notification settings unavailable", t);
        }
        openSystemSetting(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
    }

    /** 开机/更新自启接收器是否真的在册（查询本包对 BOOT_COMPLETED 的接收器，别只看 manifest 文本）。 */
    private boolean bootReceiverDeclared() {
        try {
            Intent probe = new Intent(Intent.ACTION_BOOT_COMPLETED);
            probe.setPackage(getPackageName());
            return !getPackageManager().queryBroadcastReceivers(probe, 0).isEmpty();
        } catch (Throwable t) {
            Log.w(TAG, "query boot receiver failed", t);
            return false;
        }
    }

    /**
     * 助手自启开关（权威源 = {@code dsh_prefs/ball_autostart}，与 BootReceiver 同源）。
     *
     * <p>批次47 把开关写在了 {@code dsh_setup}（MainActivity 的 PREFS 常量），而 BootReceiver 读的是
     * {@code dsh_prefs} —— 两份文件不同，用户「关闭助手浮层」的选择在重启后不生效（BootReceiver 只看到
     * 缺省 true）。批次55-C 起开关以 {@code dsh_prefs} 为权威源，{@code dsh_setup} 仅作旧值兼容回退。</p>
     */
    private boolean ballAutostartWanted() {
        try {
            SharedPreferences dsh = getSharedPreferences(KeepAlivePolicy.PREFS_NAME, MODE_PRIVATE);
            if (dsh.contains(KeepAlivePolicy.KEY_BALL_AUTOSTART)) {
                return dsh.getBoolean(KeepAlivePolicy.KEY_BALL_AUTOSTART, true);
            }
        } catch (Throwable ignored) {}
        try {
            return getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(PREF_BALL_AUTOSTART, true);
        } catch (Throwable ignored) {
            return true;
        }
    }

    /**
     * 电池优化跳转降级链：请求忽略（带包名）→ 电池优化列表页 → 应用详情页。
     * MagicOS 上第一跳可能被系统拒绝（厂商策略），故必须有后两跳。
     */
    private void openBatteryOptimizationSetting() {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + getPackageName()));
            startActivity(i);
            return;
        } catch (Throwable t1) {
            Log.w(TAG, "请求忽略电池优化失败，退到电池优化列表页", t1);
        }
        try {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            return;
        } catch (Throwable t2) {
            Log.w(TAG, "电池优化列表页打不开，退到应用详情页", t2);
        }
        openSystemSetting(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
    }

    /** 设置弹窗入口：保活卡片放进自绘弹窗（诊断内容不塞进主设置面板）。 */
    private void showKeepAliveDialog() {
        try {
            final Dialog dialog = new Dialog(this);
            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
            ScrollView scroll = new ScrollView(this);
            scroll.setBackgroundColor(cBg());
            LinearLayout col = new LinearLayout(this);
            col.setOrientation(LinearLayout.VERTICAL);
            col.setPadding(dp(16), dp(16), dp(16), dp(16));
            scroll.addView(col, new ScrollView.LayoutParams(
                    ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT));
            col.addView(buildKeepAliveCard());
            LinearLayout closeRow = new LinearLayout(this);
            closeRow.setGravity(Gravity.END);
            closeRow.addView(keepAliveJumpButton("关闭", new View.OnClickListener() {
                @Override public void onClick(View v) {
                    dialog.dismiss();
                }
            }));
            col.addView(closeRow);
            dialog.setContentView(scroll);
            Window win = dialog.getWindow();
            if (win != null) {
                win.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
                android.util.DisplayMetrics dm = new android.util.DisplayMetrics();
                getWindowManager().getDefaultDisplay().getMetrics(dm);
                // 卡片很长（7 条判据 + 引导）：给固定高度让内容区可滚动，不被屏幕裁掉
                win.setLayout(dm.widthPixels - dp(48), Math.round(dm.heightPixels * 0.8f));
            }
            dialog.show();
        } catch (Throwable t) {
            Log.w(TAG, "keepalive dialog failed", t);
        }
    }

    private void refreshAllStatuses() {
        // 线程安全：Shizuku binder 回调、后台线程都可能调用；setText 必须在 UI 线程。
        if (Looper.myLooper() != Looper.getMainLooper()) {
            ui.post(new Runnable() {
                @Override public void run() { refreshAllStatuses(); }
            });
            return;
        }
        for (PermRow pr : permRows) {
            boolean g = false;
            try { g = pr.provider.granted(); } catch (Throwable ignored) {}
            pr.status.setText(g ? "已授权" : "未授权");
            pr.status.setTextColor(g ? cGreen() : cRed());
        }
        // 工作区行状态（非权限，显示已设置/未设置）
        if (workspaceDescView != null) {
            String p = workspacePath();
            if (p == null || p.isEmpty()) {
                workspaceDescView.setText("未设置：AI 文件操作在内部目录。点此选择外部文件夹（如 /sdcard/Documents）。");
            } else {
                workspaceDescView.setText("已设置：" + p + "（点此更改或恢复默认）");
            }
        }
        // 批次55-C：从系统设置页返回时判据会变（电池优化 / 应用启动管理），保活卡片一并刷新。
        // 只刷「真的挂在窗口上」的那一份：否则卡片已随界面切走后，onResume 仍会重算并回写
        // 「最近一次自检」，把不可见的自检混进用户能看到的历史里。
        if (keepAliveCard != null && keepAliveCard.isAttachedToWindow()) refreshKeepAliveCard();
    }

    // ============ AI 工作区（可选） ============
    private static final String KEY_WORKSPACE = "workspace_path";

    /** 当前配置的工作区路径（外部共享存储目录），未设置返回 null。 */
    private String workspacePath() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_WORKSPACE, null);
    }

    /** 工作区行点击：未设置直接选目录；已设置弹菜单（重新选择/恢复默认）。 */
    private void onWorkspaceRowClick() {
        final String cur = workspacePath();
        if (cur == null || cur.isEmpty()) { openWorkspacePicker(); return; }
        try {
            new AlertDialog.Builder(this)
                    .setTitle("AI 工作区")
                    .setMessage("当前工作区：\n" + cur + "\n\n选择其他文件夹，或恢复默认？")
                    .setPositiveButton("重新选择", new DialogInterface.OnClickListener() {
                        @Override public void onClick(DialogInterface d, int w) { openWorkspacePicker(); }
                    })
                    .setNegativeButton("恢复默认", new DialogInterface.OnClickListener() {
                        @Override public void onClick(DialogInterface d, int w) {
                            getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(KEY_WORKSPACE).apply();
                            refreshAllStatuses();
                        }
                    })
                    .setNeutralButton("取消", null)
                    .show();
        } catch (Throwable ignored) {}
    }

    /** 打开系统文件夹选择器（SAF），选中的目录持久化为工作区。 */
    private void openWorkspacePicker() {
        try {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
            startActivityForResult(i, REQ_WORKSPACE_TREE);
        } catch (Throwable t) {
            Log.w(TAG, "open document tree failed", t);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_WORKSPACE_TREE && resultCode == RESULT_OK && data != null && data.getData() != null) {
            Uri tree = data.getData();
            // 持久化 SAF 授权（重启后仍可访问该目录）
            try {
                getContentResolver().takePersistableUriPermission(tree,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Throwable ignored) {}
            String path = treeUriToPath(tree);
            if (path != null && !path.isEmpty()) {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_WORKSPACE, path).apply();
                refreshAllStatuses();
            } else {
                try {
                    new AlertDialog.Builder(this)
                            .setTitle("无法使用该目录")
                            .setMessage("无法解析所选文件夹的真实路径，请选择手机存储（内部存储或 SD 卡）内的文件夹。")
                            .setPositiveButton("知道了", null)
                            .show();
                } catch (Throwable ignored) {}
            }
            return;
        }
        // 批次30：网页 <input type="file"> 选文件结果回传。
        // 无论成功/取消/失败都必须恰好调用一次 onReceiveValue（失败传 null），
        // 否则 WebView 认为该次选择未结束，后续点击文件输入会被永久阻塞。
        if (requestCode == REQ_FILE_CHOOSER) {
            if (pendingFileChooser != null) {
                ValueCallback<Uri[]> cb = pendingFileChooser;
                pendingFileChooser = null;
                Uri[] result = null;
                try {
                    result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                } catch (Throwable t) {
                    Log.w(TAG, "解析文件选择结果失败", t);
                }
                try { cb.onReceiveValue(result); } catch (Throwable t) {
                    Log.w(TAG, "回传文件选择结果失败", t);
                }
            }
            return; // 已消费，不再交给 super（避免与其他 requestCode 处理重叠）
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /** SAF 树 URI → 真实路径。
     *  关键：SAF 的 docId 与真实挂载路径不是简单字符串拼接。
     *  - "primary:*"（内部存储）→ /storage/emulated/0/*（Environment.getExternalStorageDirectory 基准）
     *  - "downloads:*"（Downloads 卷）→ /storage/emulated/0/Download/*
     *  - "home:*" → 内部存储根
     *  - "XXXX-XXXX:*"（SD 卡卷）→ 无法可靠映射，回退 /storage/<volume>/*
     *  - "raw:/..."（部分 ROM）→ 直接用 raw: 后的真实路径
     *  解析失败返回 null（调用方提示用户重新选择）。 */
    private String treeUriToPath(Uri uri) {
        try {
            String docId = DocumentsContract.getTreeDocumentId(uri);
            if (docId == null || docId.isEmpty()) return null;
            Log.i(TAG, "SAF docId=" + docId);
            if (docId.startsWith("raw:")) {
                String raw = docId.substring(4);
                return raw.isEmpty() ? null : raw;
            }
            int colon = docId.indexOf(':');
            String volume = colon > 0 ? docId.substring(0, colon) : docId;
            String rest = colon > 0 ? docId.substring(colon + 1) : "";
            File base;
            if ("primary".equals(volume)) {
                base = Environment.getExternalStorageDirectory();
            } else if ("downloads".equals(volume)) {
                // Downloads 卷实际位于内部存储的 Download 目录
                base = new File(Environment.getExternalStorageDirectory(), "Download");
            } else if ("home".equals(volume)) {
                base = Environment.getExternalStorageDirectory();
            } else {
                // 其它卷（如 SD 卡 XXXX-XXXX）：返回 /storage/<volume>/<rest>（可能不准，但极少用）
                String p = "/storage/" + volume + (rest.isEmpty() ? "" : "/" + rest);
                Log.w(TAG, "SAF 非标准卷 -> " + p);
                return p;
            }
            File out;
            if (rest.isEmpty()) out = base;
            else out = new File(base, rest.replace('\\', '/'));
            Log.i(TAG, "SAF 路径 -> " + out.getAbsolutePath());
            return out.getAbsolutePath();
        } catch (Throwable t) {
            Log.w(TAG, "treeUriToPath error", t);
            return null;
        }
    }

    private void openSystemSetting(String action) {
        try {
            Intent i = new Intent(action);
            i.setData(Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Exception e) {
            try {
                Intent i = new Intent(action);
                startActivity(i);
            } catch (Exception e2) {
                Log.w(TAG, "无法打开设置: " + action, e2);
            }
        }
    }

    private void openShizukuApp() {
        String[] pkgs = {"moe.shizuku.privileged.api", "rikka.shizuku"};
        for (String p : pkgs) {
            Intent i = getPackageManager().getLaunchIntentForPackage(p);
            if (i != null) {
                try { startActivity(i); return; } catch (Exception ignored) {}
            }
        }
        Log.w(TAG, "未找到 Shizuku 应用，请手动打开并授权");
    }

    /**
     * 荣耀/MagicOS 应用启动管理引导（批次49 引入，批次55-C 把链收敛成单点定义）。
     *
     * <p>降级链来自 {@link KeepAlivePolicy#startupManagerTargets()}：Honor 启动管理组件
     * （{@link KeepAlivePolicy#HONOR_STARTUP_PKG} / {@link KeepAlivePolicy#HONOR_STARTUP_CLS}）→
     * Honor 私有 action（{@link KeepAlivePolicy#HONOR_STARTUP_ACTION}）→ 系统应用详情页兜底。
     * 批次49 已在真机验证前两跳可达原厂启动管理，本方法只做「按链尝试」，不再各存一份字面量。</p>
     *
     * <p>顺带记一笔 {@link KeepAlivePolicy#PREF_STARTUP_GUIDED}：用户点过引导页即视为「引导已走过」
     * （系统是否真放行程序读不到，卡片据此只做软判定，绝不假报「已授权」）。</p>
     */
    private void openStartupManager() {
        String[][] targets = KeepAlivePolicy.startupManagerTargets();
        for (int i = 0; i < targets.length; i++) {
            String[] t = targets[i];
            try {
                Intent intent;
                if (KeepAlivePolicy.KIND_COMPONENT.equals(t[0])) {
                    intent = new Intent();
                    intent.setComponent(new ComponentName(t[1], t[2]));
                } else if (KeepAlivePolicy.KIND_ACTION.equals(t[0])) {
                    intent = new Intent(t[1]);
                } else {
                    // 末级兜底：应用详情页（所有 ROM 都有，用户可从那里进电池/自启管理）
                    intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
                // 真的跳出去了才记「引导已走过」（跳失败不算，卡片仍会提示去引导）
                try {
                    getSharedPreferences(KeepAlivePolicy.PREFS_NAME, MODE_PRIVATE).edit()
                            .putBoolean(KeepAlivePolicy.PREF_STARTUP_GUIDED, true).apply();
                } catch (Throwable ignored) {}
                Log.i(TAG, "启动管理引导 -> " + t[0] + ":" + t[1]);
                return;
            } catch (Throwable e) {
                Log.w(TAG, "启动管理跳转失败（" + t[0] + ":" + t[1] + "），尝试下一级", e);
            }
        }
        android.widget.Toast.makeText(this, "无法打开应用启动管理设置", android.widget.Toast.LENGTH_SHORT).show();
    }

    private void showShizukuDialog() {
        boolean installed = false;
        for (String p : new String[]{"moe.shizuku.privileged.api", "rikka.shizuku"}) {
            try { getPackageManager().getPackageInfo(p, 0); installed = true; break; } catch (Exception ignored) {}
        }
        boolean binderOk = false;
        try { binderOk = Shizuku.pingBinder(); } catch (Throwable ignored) {}
        boolean rootOkNow = rootOk != null && rootOk;

        if (rootOkNow || (shizukuOk != null && shizukuOk)) {
            AlertDialog.Builder b = new AlertDialog.Builder(this);
            b.setTitle("系统特权（可选）");
            b.setMessage((rootOkNow ? "已检测到 Root（su）可用，AI 可以执行系统级操作。\n" : "") +
                    ((shizukuOk != null && shizukuOk) ? "Shizuku 已授权，AI 可以执行系统级操作。\n" : "") +
                    "\n不授予特权也能正常使用：文件读写、预览、编辑只需「所有文件访问」权限。");
            b.setNegativeButton("关闭", null);
            b.show();
        } else if (binderOk) {
            // 服务在运行但未授权 → 直接弹 Shizuku 授权对话框
            try {
                Shizuku.requestPermission(REQ_SHIZUKU);
            } catch (Throwable t) {
                Log.w(TAG, "Shizuku requestPermission failed", t);
                fallbackShizukuDialog(installed);
            }
        } else {
            fallbackShizukuDialog(installed);
        }
    }

    private void fallbackShizukuDialog(boolean installed) {
        String msg;
        if (installed) {
            msg = "Shizuku 服务未运行。\n\n请先打开 Shizuku 应用并启动服务，然后回来点击「重新检测」；服务启动后本应用会自动弹出授权对话框。";
        } else {
            msg = "未检测到 Shizuku 应用。请先安装 Shizuku（官方版），再回来授权。";
        }
        AlertDialog.Builder b = new AlertDialog.Builder(this);
        b.setTitle("Shizuku 特权");
        b.setMessage(msg);
        if (installed) {
            b.setPositiveButton("去启动 Shizuku", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) { openShizukuApp(); }
            });
        }
        b.setNeutralButton("重新检测", new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface d, int w) { probeShizuku(); }
        });
        b.setNegativeButton("关闭", null);
        b.show();
    }

    // =============================================================================================
    // Shizuku 检测（Shizuku API，异步）
    private volatile Boolean shizukuOk = null;

    private void probeShizuku() {
        new Thread(new Runnable() {
            @Override public void run() {
                final boolean ok = shizukuAvailable();
                shizukuOk = ok;
                // 顺带在后台探测 root（避免在主线程执行 su）
                try { rootAvailable(); } catch (Throwable ignored) {}
                ui.post(new Runnable() { @Override public void run() { refreshAllStatuses(); } });
            }
        }, "shizuku-probe").start();
    }

    private boolean shizukuAvailable() {
        try {
            if (!Shizuku.pingBinder()) return false;
            return Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    /** 探测 root（su）是否可用：执行 `su -c id`，输出含 uid=0 即视为可用。结果缓存，onResume 时重置。 */
    private volatile Boolean rootOk = null;
    private boolean rootAvailable() {
        Boolean cached = rootOk;
        if (cached != null) return cached;
        boolean ok = probeRoot();
        rootOk = ok;
        return ok;
    }

    /** 批次95：root 探测口径收敛到 {@link HostedEngineManager#probeRootNow()}（应用内唯一实现，60s TTL 缓存）。 */
    private boolean probeRoot() {
        return HostedEngineManager.probeRootNow();
    }

    // ===== 批次13 D1：spawn 前探测/环境预计算（解压期间后台执行，spawnNode 读短 TTL 缓存） =====
    // 竞态设计（onResume 会把 rootOk 置 null，以便「从设置页/Shizuku 返回后重新探测」——该
    // 语义保持不变）：
    //  1) 本缓存独立于 rootOk/shizukuOk 字段，只服务 spawnNode 的 env 注入，不影响权限页 UI 展示；
    //  2) 缓存带时间戳 + 60s 短 TTL：过期后 spawnNode 回退原路径现场探测（结果照常写回
    //     rootOk/shizukuOk 与本缓存）。resolv.conf 的「每次引擎启动刷新（网络切换安全）」语义
    //     由 TTL 兜底：60s 内复用预刷新结果，watchdog 延迟 respawn（>60s）自动重刷；
    //  3) 预热线程与 spawnNode 并发探测只可能出现在「解压被 A1 跳过且预热未完成」的窗口，
    //     探测为幂等只读操作，最坏重复一次 su/dumpsys 开销，无正确性影响。
    private static final Object dshProbeLock = new Object();
    private static final long DSH_PROBE_TTL_MS = 60000L;
    private static long dshProbeAt = 0L;
    private static Boolean dshProbeRoot = null;
    private static Boolean dshProbeShizuku = null;
    private static long dshResolvAt = 0L; // resolv.conf 预刷新完成时刻（0=未预刷新）

    /** 批次13 D1：解压/同步期间后台预计算 root/shizuku 探测与 resolv.conf 刷新（结果进 TTL 缓存）。 */
    private void startSpawnPrewarm(File payload) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    long t0 = android.os.SystemClock.elapsedRealtime();
                    boolean sh = shizukuAvailable();
                    boolean ro = rootAvailable();
                    synchronized (dshProbeLock) {
                        dshProbeShizuku = sh;
                        dshProbeRoot = ro;
                        dshProbeAt = android.os.SystemClock.elapsedRealtime();
                    }
                    refreshResolvConf(payload);
                    synchronized (dshProbeLock) {
                        dshResolvAt = android.os.SystemClock.elapsedRealtime();
                    }
                    Log.i(TAG, "spawn prewarm done in "
                            + (android.os.SystemClock.elapsedRealtime() - t0)
                            + "ms (root=" + ro + " shizuku=" + sh + ")");
                } catch (Throwable t) {
                    Log.w(TAG, "spawn prewarm failed", t);
                }
            }
        }, "dsh-prewarm").start();
    }

    /** 批次13 D1：TTL 内读缓存的 root 探测（未命中走 rootAvailable() 原路径）。 */
    private boolean rootAvailableCached() {
        synchronized (dshProbeLock) {
            if (dshProbeRoot != null
                    && android.os.SystemClock.elapsedRealtime() - dshProbeAt < DSH_PROBE_TTL_MS) {
                return dshProbeRoot.booleanValue();
            }
        }
        boolean ok = rootAvailable();
        synchronized (dshProbeLock) {
            dshProbeRoot = ok;
            dshProbeAt = android.os.SystemClock.elapsedRealtime();
        }
        return ok;
    }

    /** 批次13 D1：TTL 内读缓存的 shizuku 探测（未命中走 shizukuAvailable() 原路径）。 */
    private boolean shizukuAvailableCached() {
        synchronized (dshProbeLock) {
            if (dshProbeShizuku != null
                    && android.os.SystemClock.elapsedRealtime() - dshProbeAt < DSH_PROBE_TTL_MS) {
                return dshProbeShizuku.booleanValue();
            }
        }
        boolean ok = shizukuAvailable();
        synchronized (dshProbeLock) {
            dshProbeShizuku = ok;
            dshProbeAt = android.os.SystemClock.elapsedRealtime();
        }
        return ok;
    }

    /** 批次13 D1：resolv.conf 预刷新是否仍新鲜（60s TTL 内）。 */
    private boolean resolvConfFresh() {
        synchronized (dshProbeLock) {
            return dshResolvAt > 0
                    && android.os.SystemClock.elapsedRealtime() - dshResolvAt < DSH_PROBE_TTL_MS;
        }
    }

    private File extractRishDex() {
        try {
            File dir = new File(getFilesDir(), "rish");
            if (!dir.exists()) dir.mkdirs();
            File dex = new File(dir, "rish_shizuku.dex");
            if (dex.exists() && dex.length() > 0) return dex;
            InputStream in = getAssets().open("rish_shizuku.dex");
            FileOutputStream out = new FileOutputStream(dex);
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            out.close();
            in.close();
            return dex;
        } catch (Exception e) {
            Log.w(TAG, "extract rish dex failed", e);
            return null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        refreshAllStatuses();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        rootOk = null; // 从设置页/Shizuku 返回时重新探测 root
        refreshAllStatuses();
        // 从 Shizuku/设置页返回时重新检测
        if (permRows != null && !permRows.isEmpty()) probeShizuku();
        // 批次 3 任务 2：App 回前台时做一次无障碍掉线检测（异步，非常驻轮询）
        checkA11yAliveAsync();
        // 批次14w3（T2）：调试入口——am start 带 --es dsh_debug_token 1 时弹 token 查看框；
        // extra 不传时立即返回，既有行为完全不变。
        maybeShowDebugTokenDialog();
        // 批次48/52：悬浮窗离线一键静默自愈拉起引擎（silent=true 时退后台不切屏）
        Intent in = getIntent();
        // 批次67：托管引擎控制入口（停止/清理/切换开关）
        handleHostedExtras(in);
        if (in != null && in.getBooleanExtra("action_launch_engine", false)) {
            boolean silent = in.getBooleanExtra("silent", false);
            in.removeExtra("action_launch_engine");
            startEngine();
            if (silent) moveTaskToBack(true);
        }
        // 批次58（方案B）：从悬浮窗一键直达保活自检大卡片
        if (in != null && in.getBooleanExtra("action_open_keepalive", false)) {
            in.removeExtra("action_open_keepalive");
            showKeepAliveDialog();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // 批次67：托管引擎控制入口（热启动路径）
        handleHostedExtras(intent);
        if (intent != null && intent.getBooleanExtra("action_launch_engine", false)) {
            boolean silent = intent.getBooleanExtra("silent", false);
            intent.removeExtra("action_launch_engine");
            startEngine();
            if (silent) moveTaskToBack(true);
            return;
        }
        // 批次51 修复：仅当外部显式要求呼出助手时才退后台弹窗，绝不拦截桌面正常打开应用
        if (intent != null && intent.getBooleanExtra("action_open_assistant", false)) {
            intent.removeExtra("action_open_assistant");
            moveTaskToBack(true);
            OverlayService.openAssistantFromKey(this);
            return;
        }
        // 批次58（方案B）：从悬浮窗一键直达保活自检大卡片（热启动路径）
        if (intent != null && intent.getBooleanExtra("action_open_keepalive", false)) {
            intent.removeExtra("action_open_keepalive");
            showKeepAliveDialog();
            return;
        }
    }

    @Override
    protected void onStart() {
        super.onStart();
        overlayForeground = true;
        OverlayService.setOverlayVisible(false); // 回到前台：隐藏悬浮窗
    }

    @Override
    protected void onStop() {
        overlayForeground = false;
        OverlayService.setOverlayVisible(true);  // 退后台：显示悬浮窗
        super.onStop();
    }

    // ============ 引擎启动（原逻辑）============
    private void startEngine() {
        startKeepAliveService();   // 前台保活：挂后台不被杀（引擎持续运行）
        scheduleEngineProbe();     // 批次67：精确闹钟探活（Shizuku/托管掉线时兜底发现）
        // 引擎端口持久化（供 OverlayService/其他组件读取）；已授权悬浮窗时自动拉起蓝色大肥鱼
        try {
            getSharedPreferences("dsh_prefs", MODE_PRIVATE)
                    .edit().putInt("engine_port", enginePort).apply();
        } catch (Throwable ignored) {}
        if (Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this)) {
            // 批次47：尊重用户对助手浮层的选择——用户主动关过（ball_autostart=false）时，
            // 启动引擎不再把它偷偷拉回来（否则「隐藏助手浮层」形同虚设）。
            // 批次55-C：改用权威源 dsh_prefs/ball_autostart（与 BootReceiver 同一份，见 ballAutostartWanted）
            boolean ballWanted = ballAutostartWanted();
            if (ballWanted) startOverlayService();
        }
        new Thread(new Runnable() {
            @Override public void run() {
                // 批次 3：启动单飞闸门放在最外层，覆盖「解压 / 补丁 / dshroot 同步 / spawn」整套流程。
                // 真机实测（2026-09-12）：第二个 MainActivity 实例并发走这套流程时，会并发改写
                // payload（internal-patch 会先删再解压 dshhome/profiles/web/node_modules）并把
                // 先起的 node 弄死 → 3080 永不 LISTEN → 90s 超时 + 误计 glibc 失败。
                // 因此并发实例只等待并复用第一条流程的结果，绝不重复执行整套启动流程。
                startNotifyServer();
                if (engineOnline()) {
                    Log.i(TAG, "engine already online on port " + enginePort + ", skip boot");
                    loadHome();
                    return;
                }
                if (!beginEngineStart()) {
                    Log.i(TAG, "engine boot already in flight, waiting instead of a second boot");
                    long deadline = System.currentTimeMillis() + 180000;
                    while (engineStartInFlight.get() && System.currentTimeMillis() < deadline) {
                        try { Thread.sleep(500); } catch (InterruptedException e) { return; }
                    }
                    if (engineOnline()) {
                        glibcFailCount = 0;
                        loadHome();
                    }
                    return;
                }
                try {
                    // v1.5.4：已移除「端口冲突自动换端口」（resolveEnginePort/portInUse/saveEnginePort/engine_port 持久化），
                    // 引擎固定默认端口启动，用于排查慢启动是否与端口探测相关。
                    // 通知通道在后台线程启动（端口 = enginePort+1）。
                    startNotifyServer();

                    File files = getFilesDir();
                    File payload = new File(files, "payload");
                    File done = new File(payload, ".extracted");

                    // 批次13 D1：解压/同步期间后台预计算 spawn 前探测与环境
                    //（root/shizuku 探测 + resolv.conf 刷新，结果进 60s TTL 缓存，spawnNode 读缓存）
                    startSpawnPrewarm(payload);

                    // v1.5.3 慢启动根因修复：内核目录改为【内部存储优先】。
                    // 现象：v1.5.x 真机启动 50-60s（v1.4 的 10s），payload/node/启动参数逐字节对比无差异，
                    // 模拟器正常（4s）→ 根因是 node 每次启动从【外部 /sdcard（FUSE）】读取 2 万+ 内核文件，
                    // require() 解析时海量 stat/read 过 FUSE 极慢（真机如此，模拟器宿主机磁盘快测不出）。
                    // 修复：node 恒从内部存储（files/payload/dshroot）读内核（快、可靠）；
                    // 外部目录仅作【内部空间不足】时的回退，以及保留 .nomedia/相册保护等兼容逻辑。
                    File externalRoot = new File(Environment.getExternalStorageDirectory(), EXT_DSHROOT_ROOT);
                    boolean useExternal = externalDshrootWritable(externalRoot);

                    // 后台清理上次「清空」遗留的 .trash-* 目录（rename 后后台删除未完成），不阻塞启动。
                    if (useExternal) {
                        final File extCleanup = externalRoot;
                        new Thread(new Runnable() {
                            @Override public void run() { cleanupTrashDirs(extCleanup); }
                        }, "trash-cleanup").start();
                        // 相册保护：外部 dshroot（历史版本遗留）里 2 万+ 文件会被 MediaStore
                        // 内容嗅探误判为视频。.nomedia 让 MediaStore 忽略整个目录。幂等。
                        File nomedia = new File(externalRoot, ".nomedia");
                        if (!nomedia.exists()) {
                            try { nomedia.createNewFile(); } catch (Throwable ignored) {}
                        }
                    }

                    // v1.8.5 轻壳：assets 无 payload → 从外部 payload.zip 导入；指纹未变则跳过全部解压
                    boolean liteShell = !assetsHasPayload();
                    String extFp = liteShell ? externalPayloadFingerprint() : null;
                    String storedFp = getSharedPreferences("dsh_prefs", MODE_PRIVATE)
                            .getString("payload_ext_fp", "");
                    boolean skipExtract = liteShell && extFp != null && extFp.equals(storedFp);
                    Log.i(TAG, "lite-shell fp: current=" + extFp + " stored=" + storedFp + " skip=" + skipExtract);
                    if (liteShell && extFp == null) {
                        setStatus("轻壳模式缺 payload：请先 adb push payload.zip 到 /sdcard/DeepSeekHarness/");
                    }
                    // 批次13 A1：全量 APK 指纹跳过解压——指纹 = base APK(sourceDir) 的
                    // (length,lastModified,versionCode)。命中且守卫齐全（.extracted/.complete、
                    // REVISION 匹配、关键文件在位）→ 跳过 internal-patch 与 dshroot 同步块；
                    // 任一不符 → 现行补丁路径原样走（幂等守卫全部保留）。
                    String apkFp = liteShell ? null : apkPayloadFingerprint();
                    String storedApkFp = apkFp != null
                            ? getSharedPreferences("dsh_prefs", MODE_PRIVATE).getString("payload_fp", "")
                            : "";
                    boolean fpSkip = apkFp != null && apkFp.equals(storedApkFp)
                            && internalPayloadReady(payload);
                    if (fpSkip) {
                        // P0 埋点补充：跳过解压打标记（stPayload 语义不变仍为 -1，jsonl 新增 payloadSkip 键）
                        stPayloadFpSkip = true;
                        Log.i(TAG, "extract skipped (fingerprint match): " + apkFp);
                    }
                    boolean kernelOnExternal = false;
                    if (!skipExtract && !fpSkip) {
                    if (!done.exists()) {
                        // 关键：先解压内部关键运行时（node/.so/dshhome/bin/rish），再解压 dshroot。
                        // 解压中途被打断时，只要内部已就位引擎仍能启动；缺的文件由 dshrootNeedsSync 幂等补齐。
                        extractPayload(payload, null, "internal");
                        done.createNewFile();
                    } else {
                        // 覆盖升级：profile dependencies are build artifacts, not
                        // runtime data. Remove the previous generation before
                        // restoring the minimal package set, so an older APK's
                        // duplicate DSH core cannot survive the upgrade.
                        try {
                            File profileModules = new File(payload,
                                    "dshhome/profiles/web/node_modules");
                            if (profileModules.exists()) deleteRecursive(profileModules);
                            extractPayload(payload, null, "internal-patch");
                        } catch (Throwable t) {
                            Log.w(TAG, "profile dependency refresh failed", t);
                        }
                    }

                    // 内部 dshroot 同步（node 从此处读内核）：
                    // REVISION 不匹配（重装）或 .complete 缺失（中断）都补。
                    // v1.5.2：REVISION 是构建时间戳每次构建都变——同内核升级走「快速同步」
                    //（只更新 REVISION+白名单文件，秒级）；.complete 缺失或内核版本变化才全量补齐。
                    File internalBase = payload; // 内部 dshroot 位于 payload/dshroot
                    File internalDshroot = new File(payload, "dshroot");
                    try {
                        long tSync0 = android.os.SystemClock.elapsedRealtime();
                        if (dshrootNeedsSync(internalBase)) {
                            boolean revisionChanged = dshrootRevisionChanged(internalBase);
                            boolean full = dshrootNeedsFullSync(internalBase);
                            fastSyncedThisBoot = !full;
                            extractPayload(payload, null, full ? "dshroot" : "dshroot-fast");
                            writeDshrootComplete(internalBase);
                            long tCfg = -1;
                            if (revisionChanged) {
                                long tCfg0 = android.os.SystemClock.elapsedRealtime();
                                refreshInternalConfig(payload);
                                tCfg = android.os.SystemClock.elapsedRealtime() - tCfg0;
                            }
                            // 批次13 P0：dshrootNeedsSync 判定结果埋点（归因 payload→spawn 黑盒）
                            stDshrootSync = "needs=true revisionChanged=" + revisionChanged
                                    + " full=" + full
                                    + " syncMs=" + (android.os.SystemClock.elapsedRealtime() - tSync0)
                                    + (tCfg >= 0 ? " cfgMs=" + tCfg : "");
                            Log.i(TAG, "dshroot-sync: " + stDshrootSync);
                        } else {
                            stDshrootSync = "needs=false";
                            Log.i(TAG, "dshroot-sync: needs=false (REVISION match, .complete present)");
                        }
                        dshrootDir = internalDshroot;
                        // 批次78：用户数据（sessions/attachments/storages）接共享 home ——
                        // 两种运行模式共用同一份会话真源，避免「dsh 里有时看不到刚才的任务」。
                        HostedEngineManager.linkSharedData(new File(payload, "dshhome"), getApplicationContext());
                    } catch (Throwable t) {
                        // 内部解压失败（通常为内部存储空间不足）→ 回退外部（慢但可用）
                        Log.w(TAG, "internal dshroot sync failed, fallback to external", t);
                        stDshrootSync = "internal-sync-error";
                        // 清理不完整的内部 dshroot，避免双重占空间
                        try { deleteRecursive(internalDshroot); } catch (Throwable ignored) {}
                        if (useExternal) {
                            if (dshrootNeedsSync(externalRoot)) {
                                boolean full = dshrootNeedsFullSync(externalRoot);
                                extractPayload(payload, externalRoot, full ? "dshroot" : "dshroot-fast");
                                writeDshrootComplete(externalRoot);
                            }
                            dshrootDir = new File(externalRoot, "dshroot");
                            kernelOnExternal = true;
                        } else {
                            throw t;
                        }
                    }

                    // 跑完解压/补齐后记录当前外部 payload 指纹（下次启动指纹未变即跳过）
                    if (liteShell && extFp != null) {
                        getSharedPreferences("dsh_prefs", MODE_PRIVATE)
                                .edit().putString("payload_ext_fp", extFp).apply();
                    }
                    // 批次13 A1：全量 APK 记录指纹（下次启动守卫齐全即跳过解压）。
                    // 内核回退外部（kernelOnExternal）时不记录——内部守卫不齐会自动回退补丁路径。
                    if (!liteShell && apkFp != null && !kernelOnExternal) {
                        getSharedPreferences("dsh_prefs", MODE_PRIVATE)
                                .edit().putString("payload_fp", apkFp).apply();
                    }
                } else if (fpSkip) {
                    // 批次13 A1：指纹命中 → 复用现有 payload（internal-patch 与 dshroot 同步全跳过）。
                    // applyLinks/setExecutables/ensurePatchConfig 在块外照常执行（幂等、毫秒级）；
                    // bin.js 缺失的兜底重解路径保持不变（见下方 REL_BINJS 存在性检查）。
                    dshrootDir = new File(payload, "dshroot");
                } else {
                    // 轻壳：payload 指纹未变 → 跳过解压/patch，直接复用（秒级启动）
                    dshrootDir = new File(payload, "dshroot");
                    Log.i(TAG, "lite-shell: payload unchanged (" + extFp + "), skip extract");
                }

                    // 兜底：确保 dshroot 确实就位（例如首次内部解压被系统打断）。
                    if (!new File(dshrootDir, REL_BINJS).exists()) {
                        Log.w(TAG, "dshroot missing at " + dshrootDir + ", repopulating");
                        extractPayload(payload, kernelOnExternal ? externalRoot : null, "dshroot");
                        if (kernelOnExternal) writeDshrootComplete(externalRoot);
                    }

                    applyLinks(payload);
                    setExecutables(payload);
                    ensurePatchConfig(payload); // ③ 补丁启动自检：cordis.patch.yml 缺失/被改则自动补齐
                    // 批次 3：引擎启动单飞入口（替代原先裸调 spawnNode+waitForServer）。
                    // 端口已被自家引擎占用 → 不 spawn 直接复用；已有启动流程在跑 → 等它结束，
                    // 不再发生「两次 spawnNode + 两个 waitForServer」并发（L1）。
                    startEngineLocked(payload);
                } catch (Throwable t) {
                    Log.e(TAG, "engine error", t);
                    String msg = String.valueOf(t.getMessage());
                    setStatus("引擎启动失败：" + msg);
                    writeStartupDiag(msg);
                } finally {
                    endEngineStart();
                }
            }
        }, "engine-boot").start();
    }

    // ============ 批次 3：引擎启动单飞（single-flight）============
    /** 批次 3：重置引擎握手状态。只在「明确要重启引擎」（旧进程已死 / 已确认启动失败）时调用，
     *  不要在每次 spawnNode 开头无脑清空（L2 根因）。 */
    private void resetEngineHandshakeState() {
        engineAuthUrl = null;
        engineAuthCookie = null;
        engineAuthRequired = false;
    }

    /** 批次 3：引擎是否已在线。硬信号 = 3080 端口可达且确认为 DSH 引擎（401 可信 / 首页 title 命中）。
     *  不依赖 nodeProcess 句柄：失败的 spawn 会覆盖句柄（L3），句柄存活在此不可信。 */
    private boolean engineOnline() {
        return isDshEngine(enginePort);
    }

    /** 批次 3：单飞闸门——抢到返回 true；已有启动流程在跑时返回 false（调用方应退让）。 */
    private boolean beginEngineStart() {
        return engineStartInFlight.compareAndSet(false, true);
    }

    private void endEngineStart() {
        engineStartInFlight.set(false);
    }

    /**
     * 批次 3：在「已持有启动闸门」的前提下探测端口并启动引擎（调用方必须已 beginEngineStart()）。
     * <ul>
     *   <li>端口已被自家引擎占用（401 可信 / 首页 title 命中）→ 不 spawn，直接复用并刷新 UI
     *       （修复 L3/L4/L5：句柄不可信导致的误 respawn、误判超时、误计 glibc 失败）；</li>
     *   <li>否则 spawn + wait——<b>不再</b>无条件清空握手状态（修复 L2）。</li>
     * </ul>
     */
    /** 批次78：把当前引擎模式写进 dsh_prefs（供面板 ⓘ 自查「我的任务落在哪个 home」）。 */
    private void recordEngineMode(String mode) {
        try {
            getSharedPreferences("dsh_prefs", MODE_PRIVATE).edit()
                    .putString("engine_mode", mode).apply();
            Log.i(TAG, "[b78] engine mode: " + mode);
        } catch (Throwable ignored) {
        }
    }

    private void startEngineLocked(File payload) {
        if (engineOnline()) {
            Log.i(TAG, "engine already online on port " + enginePort + ", skip spawn");
            glibcFailCount = 0;
            // 批次78：记录当前引擎模式（ⓘ 详情用它做自查）
            recordEngineMode(HostedEngineManager.modeLabel(this));
            // 批次67：引擎已在线时也要在托管模式下「收养」它（补上看护脚本 + 复用标记）
            adoptOnlineHostedEngineAsync();
            loadHome();
            return;
        }
        try {
            showIndeterminate("正在启动 DeepSeek Harness…");
            // 批次67/95：优先托管（root 或 shell 身份常驻，覆盖安装/强停不中断引擎）；不可用则原样走 App 内模式
            if (startHostedEngineIfUsable(payload)) return;
            recordEngineMode("App 内");
            spawnNode(payload);
            waitForServer();
        } catch (Throwable t) {
            Log.e(TAG, "engine error", t);
            String msg = String.valueOf(t.getMessage());
            setStatus("引擎启动失败：" + msg);
            writeStartupDiag(msg);
        }
    }

    /**
     * 批次67/95：优先走托管引擎（root(su) 或 Shizuku 拉起 + setsid 脱离 App 进程树）。
     * <p>失败一律回退 App 内模式（spawnNode），并留 [b67] 日志供真机取证：
     * {@code [b67] fallback to in-app engine (reason=...)}。</p>
     *
     * @return true = 托管引擎已就绪（调用方不要再 spawn App 内进程，避免两个引擎抢 3080）
     */
    private boolean startHostedEngineIfUsable(File payload) {
        if (!HostedEngineManager.hostedUsable(this)) {
            String reason = HostedEngineManager.hostedWanted(this)
                    ? "NO_HOST_CHANNEL" : "HOSTED_DISABLED";
            Log.i(TAG, "[b67] fallback to in-app engine (reason=" + reason + ")");
            return false;
        }
        try {
            HostedEngineManager.Result r = HostedEngineManager.startEngine(
                    this, payload, HostedEngineManager.apkFingerprint(this));
            if (!r.ok) {
                Log.w(TAG, "[b67] fallback to in-app engine (reason=" + r.reason + ")");
                return false;
            }
            if (r.authUrl != null) {
                engineAuthUrl = r.authUrl;
                engineAuthRequired = false;
            }
            if (r.cookie != null) engineAuthCookie = r.cookie;
            scheduleEngineProbe();
            loadHome();
            // 批次78：托管就绪 → 记录模式（ⓘ 详情展示；批次95 起区分 root / shell）
            recordEngineMode(HostedEngineManager.modeLabel(this));
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "[b67] fallback to in-app engine (reason=EXCEPTION)", t);
            return false;
        }
    }

    /** 批次67：引擎已在线时的托管收养（后台线程；非托管模式为 no-op）。 */
    private void adoptOnlineHostedEngineAsync() {
        if (!HostedEngineManager.hostedUsable(this)) return;
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    HostedEngineManager.adoptOnlineEngine(MainActivity.this);
                } catch (Throwable t) {
                    Log.w(TAG, "adoptOnlineHostedEngine failed", t);
                }
            }
        }, "hosted-adopt").start();
    }

    /** 批次67：精确闹钟探活（15 分钟一次；托管/App 内两种模式都靠它兜底发现引擎掉线）。 */
    private void scheduleEngineProbe() {
        try {
            AlarmReceiver.scheduleEngineProbe(this);
        } catch (Throwable t) {
            Log.w(TAG, "scheduleEngineProbe failed", t);
        }
    }

    /**
     * 批次67：托管引擎入口（intent extra 驱动；设置页与 e2e 脚本共用同一入口）。
     * <ul>
     *   <li>{@code action_hosted_stop=true}：停看护 + 杀托管引擎；</li>
     *   <li>{@code action_hosted_cleanup=true}：连 /data/local/tmp/dsh 运行目录一起清（会话数据保留）；</li>
     *   <li>{@code action_hosted_switch=true|false}：显式开关托管（只写偏好，不打断在线引擎）。</li>
     * </ul>
     */
    private void handleHostedExtras(Intent in) {
        if (in == null) return;
        try {
            if (in.getBooleanExtra("action_hosted_stop", false)) {
                in.removeExtra("action_hosted_stop");
                new Thread(new Runnable() {
                    @Override public void run() { HostedEngineManager.stopEngine(MainActivity.this); }
                }, "hosted-stop").start();
                showToast("已停止托管引擎（App 内模式不受影响）");
            }
            if (in.getBooleanExtra("action_hosted_cleanup", false)) {
                in.removeExtra("action_hosted_cleanup");
                new Thread(new Runnable() {
                    @Override public void run() { HostedEngineManager.cleanup(MainActivity.this); }
                }, "hosted-cleanup").start();
                showToast("已清理托管运行目录（会话数据保留）");
            }
            if (in.hasExtra("action_hosted_switch")) {
                boolean on = in.getBooleanExtra("action_hosted_switch", true);
                in.removeExtra("action_hosted_switch");
                HostedEngineManager.setHostedWanted(this, on);
                showToast(on ? "已开启引擎托管常驻" : "已回退 App 内引擎模式");
            }
        } catch (Throwable t) {
            Log.w(TAG, "handleHostedExtras failed", t);
        }
    }

    /** v1.7：启动失败时把引擎日志尾部与状态写进外部目录（多位置，保证至少一处成功），用户无需 adb 即可反馈排查。 */
    private void writeStartupDiag(String errorMsg) {
        try {
            String sub = getPackageName().contains("beta") ? "DeepSeekHarnessLite"
                    : getPackageName().contains("compat") ? "DeepSeekHarnessCompat" : "DeepSeekHarness";
            StringBuilder sb = new StringBuilder();
            sb.append("时间: ").append(new java.util.Date()).append('\n');
            sb.append("错误: ").append(errorMsg).append('\n');
            sb.append("enginePort=").append(enginePort).append(" notifyPort=").append(notifyPort()).append('\n');
            // 批次 3：node 存活判据以端口可达为硬信号（句柄会被失败 spawn 覆盖，不可信）
            sb.append("node存活=").append(engineOnline()
                    || (nodeProcess != null && nodeProcess.isAlive())).append('\n');
            File log = new File(getFilesDir(), "dsh-web.log");
            if (log.exists()) {
                java.io.RandomAccessFile raf = new java.io.RandomAccessFile(log, "r");
                long len = raf.length();
                long start = Math.max(0, len - 65536);
                raf.seek(start);
                byte[] buf = new byte[(int) (len - start)];
                raf.readFully(buf);
                raf.close();
                sb.append("--- dsh-web.log 尾部 ---\n").append(new String(buf, "UTF-8"));
            }
            byte[] content = sb.toString().getBytes("UTF-8");
            // 多位置都尝试：外部目录（需存储权限）、App 专属外部目录（无需权限）、Download（最易找）
            String[] paths = new String[]{
                    new File(android.os.Environment.getExternalStorageDirectory(), sub + "/startup-diag.txt").getAbsolutePath(),
                    new File(getExternalFilesDir(null), "startup-diag.txt").getAbsolutePath(),
                    new File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS), "DeepSeekHarness-startup-diag.txt").getAbsolutePath()
            };
            String written = "";
            for (String p : paths) {
                try {
                    File f = new File(p);
                    File parent = f.getParentFile();
                    if (parent != null && !parent.exists()) parent.mkdirs();
                    FileOutputStream fos = new FileOutputStream(f);
                    fos.write(content);
                    fos.close();
                    written += "\n" + p;
                } catch (Throwable ignored) {
                }
            }
            Log.i(TAG, "启动诊断已写入:" + written);
        } catch (Throwable ignored) {
        }
    }

    // ============ ③ 补丁启动自检 ============
    /** 检查内部 dshhome/cordis.patch.yml 是否完整（含禁用的三个插件），
     *  缺失/被外部改动破坏则从 payload.zip 重新提取官方配置（幂等）。
     *  背景：补丁配置被改/删会导致 llm-pi-ai/sandbox/bash-sandbox 启用失败 → 启动崩溃。 */
    private void ensurePatchConfig(File payload) {
        try {
            File patch = new File(payload, "dshhome/cordis.patch.yml");
            boolean need = !patch.exists();
            if (!need) {
                String content = readFileText(patch);
                // 关键禁用项缺任一 → 视为损坏，重新提取
                need = !(content.contains("llm-pi-ai") && content.contains("sandbox")
                        && content.contains("bash-sandbox") && content.contains("disabled: true"));
            }
            if (need) {
                Log.w(TAG, "cordis.patch.yml missing or incomplete, restoring from payload.zip");
                refreshInternalConfig(payload); // 重新覆盖 dshhome 官方配置（凭证/会话保留）
            }
        } catch (Throwable t) {
            Log.w(TAG, "ensurePatchConfig error", t);
        }
    }

    // ============ ① 端口冲突处理 ============
    /** 判断端口上是否真的是 DSH 引擎（而非任意 HTTP 服务/占位页）。
     *  强特征：首页 HTML 含 <title>DeepSeek Harness</title>（占位服务/Termux busy 页不会恰好相同）。
     *  v1.5.1 修复：旧 healthOk() 只认"任意 HTTP 响应(200-499)"，占位服务返回 200 时被误判为
     *  引擎健康 → 不换端口、node 不启动、WebView 显示占位内容。 */
    private boolean isDshEngine(int port) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("http://127.0.0.1:" + port + "/").openConnection();
            c.setConnectTimeout(1200);
            c.setReadTimeout(1500);
            c.setRequestProperty("User-Agent", "dsh-probe");
            if (engineAuthCookie != null) c.setRequestProperty("Cookie", engineAuthCookie);
            int code = c.getResponseCode();
            // DSH 0.1.5 gates the index behind a process token. A trusted 401
            // proves the engine is alive while the authenticated URL is being
            // captured from its stdout.
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
                engineAuthRequired = body.toString("UTF-8")
                        .contains("dsh web authentication required");
                return engineAuthRequired;
            }
            if (code < 200 || code >= 400) return false;
            InputStream in = c.getInputStream();
            // v1.5.5 修复：首页实际约 14KB（13KB 内联脚本在前，<title> 位于页面末尾第 13.4KB 处），
            // 旧实现只读前 4096 字节 → 永远匹配不到 → waitForServer 干等 90s 超时（慢启动根因）。
            // 改为读完整页（上限 256KB，本地读取 <50ms）。
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int total = 0;
            int r;
            while ((r = in.read(chunk)) > 0 && total < 262144) {
                body.write(chunk, 0, r);
                total += r;
            }
            try { in.close(); } catch (Throwable ignored) {}
            boolean matched = body.toString("UTF-8").contains("<title>DeepSeek Harness</title>");
            if (matched) engineAuthRequired = false;
            return matched;
        } catch (Throwable t) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Capture and exchange the one-time DSH web URL printed after the server is ready. */
    private void captureEngineAuthUrl(String output) {
        if (engineAuthUrl != null) return;
        String marker = "dsh web: http://127.0.0.1:" + enginePort + "/?token=";
        int markerAt = output.indexOf(marker);
        if (markerAt < 0) return;
        int start = markerAt + "dsh web: ".length();
        int end = start;
        while (end < output.length() && !Character.isWhitespace(output.charAt(end))) end++;
        final String url = output.substring(start, end);
        engineAuthUrl = url;
        // 批次13 P0：marker 时刻（与 stPbStart 之差 = node 进程拉起 → 引擎就绪打点的时差）
        if (stWebMarkerAt == 0) stWebMarkerAt = android.os.SystemClock.elapsedRealtime();
        Log.i(TAG, "captured authenticated DSH web URL");

        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(2000);
            c.setReadTimeout(2000);
            c.setRequestProperty("User-Agent", "dsh-probe");
            int code = c.getResponseCode();
            String setCookie = c.getHeaderField("Set-Cookie");
            if (code == 303 && setCookie != null) {
                int semi = setCookie.indexOf(';');
                engineAuthCookie = semi >= 0 ? setCookie.substring(0, semi) : setCookie;
                engineAuthRequired = false;
                // v1.8.5：持久化引擎会话 cookie——系统分享等场景会创建第二个 Activity 实例，
                // 其 engineAuthCookie 为 null，rpcCall 需要从 prefs 恢复（rpcCall 里有惰性读取）。
                try {
                    getSharedPreferences("dsh_prefs", MODE_PRIVATE)
                            .edit().putString("engine_cookie", engineAuthCookie).apply();
                } catch (Throwable ignored) {}
            }
        } catch (Throwable t) {
            Log.w(TAG, "DSH web token exchange failed", t);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Prevent the process token from persisting in either engine log. */
    private String redactEngineAuthUrl(String text) {
        String redacted = text;
        if (engineAuthUrl != null) {
            redacted = redacted.replace(engineAuthUrl, cleanHomeUrl() + "/?token=[redacted]");
        }
        int tokenAt = redacted.indexOf("?token=");
        if (tokenAt >= 0) {
            int end = tokenAt + "?token=".length();
            while (end < redacted.length() && !Character.isWhitespace(redacted.charAt(end))) end++;
            if (end > tokenAt + "?token=".length()) {
                redacted = redacted.substring(0, tokenAt) + "?token=[redacted]"
                        + redacted.substring(end);
            }
        }
        return redacted;
    }

    // ============ 前台保活服务 ============
    /** 启动前台服务（带常驻通知），引擎运行期间挂后台不被系统杀掉。 */
    private void startKeepAliveService() {
        try {
            Intent i = new Intent(this, EngineService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                startForegroundService(i);
            } else {
                startService(i);
            }
            Log.i(TAG, "keep-alive service started");
        } catch (Throwable t) {
            Log.w(TAG, "keep-alive service start failed", t);
        }
    }

    /** 停止前台服务（用户主动退出时调用）。 */
    private void stopKeepAliveService() {
        try {
            stopService(new Intent(this, EngineService.class));
        } catch (Throwable ignored) {}
    }

    /** 用户主动退出：先阻止看门狗重启，再终止当前 node 进程。 */
    private void stopEngineForExit() {
        engineShutdownRequested = true;
        final Process proc = nodeProcess;
        nodeProcess = null;
        resetEngineHandshakeState();
        if (proc == null) return;
        try {
            proc.destroy();
        } catch (Throwable t) {
            Log.w(TAG, "engine destroy failed", t);
        }
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    Thread.sleep(2500);
                    if (proc.isAlive()) {
                        if (Build.VERSION.SDK_INT >= 26) proc.destroyForcibly();
                        else proc.destroy();
                    }
                } catch (Throwable ignored) {}
            }
        }, "engine-exit-kill").start();
    }

    // ============ AI 发通知通道（本地端口，只需通知权限） ============
    /** 通知渠道（App 内发通知用，与保活服务的渠道分开）。 */
    private static final String NOTIFY_CHANNEL_ID = "dsh_ai_notify";
    private static final String NOTIFY_CHANNEL_NAME = "AI 通知";
    private static final String CONFIRM_CHANNEL_ID = "dsh_confirm";
    // 通知端口动态跟随引擎端口（enginePort+1），保证两个 App 共存时不冲突
    private int notifyPort() { return enginePort + 1; }

    private static final String KEY_LOCAL_TOKEN = "local_token";

    /**
     * 本地桥接鉴权 token（v1.8.4 安全加固）：3081/3181 只 bind 127.0.0.1，但 Android 所有应用
     * 共享 loopback 网络命名空间——第三方应用可直连伪造通知（3081）或注入触摸/截屏（3181）。
     * 随机 token 生成一次存 dsh_prefs，注入引擎环境变量 APP_LOCAL_TOKEN，插件经 X-DSH-Token
     * 头回传，服务端校验。
     * 批次 11：改为包内可见——VscreensManager 网关向 8998 转发时复用同一 token（与 3081 同源）。
     * 批次 20：生成/自愈实现统一到 TokenStore（3081/3181 共用唯一来源；此前两处各自实现且
     * 已分叉——a11y 侧只读不生成）。token 不可用（存储异常返回空串）时服务端 fail-closed 拒绝，
     * 不再跳过校验（旧行为等于允许任何本机应用旁路）。
     */
    String localToken() {
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

    /** 启动本地通知监听：AI 通过插件请求 http://127.0.0.1:<notifyPort> 发通知（仅需通知权限）。 */
    private final java.util.concurrent.atomic.AtomicBoolean notifyServerStarted = new java.util.concurrent.atomic.AtomicBoolean(false);

    private void startNotifyServer() {
        if (!notifyServerStarted.compareAndSet(false, true)) {
            return;
        }
        final int port = notifyPort();
        new Thread(new Runnable() {
            @Override public void run() {
                ServerSocket ss = null;
                try {
                    ss = new ServerSocket();
                    ss.setReuseAddress(true);
                    ss.bind(new InetSocketAddress("127.0.0.1", port));
                    Log.i(TAG, "notify server listening on " + port);
                    while (!Thread.currentThread().isInterrupted()) {
                        try {
                            final Socket s = ss.accept();
                            handleNotifyConnection(s);
                        } catch (Throwable t) {
                            // accept 异常（连接被重置/中断）不退出监听循环，短暂等待后继续
                            try { Thread.sleep(100); } catch (Throwable ignored) {}
                        }
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "notify server stopped", t);
                } finally {
                    try { if (ss != null) ss.close(); } catch (Throwable ignored) {}
                    notifyServerStarted.set(false);
                }
            }
        }, "notify-server").start();
    }

    /** 处理一条本地请求：按 HTTP 路径分发（/notify 通知、/setting 系统设置、/clipboard 剪贴板）。
     *  批次 7 keep-alive：同一连接上循环读请求，直到客户端要求关闭或空闲超时
     *  （SoTimeout 5s 抛 SocketTimeoutException）退出；响应头按请求 Connection 头回写。 */
    private void handleNotifyConnection(final Socket s) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    s.setSoTimeout(5000);
                    InputStream in = s.getInputStream();
                    while (true) {
                    // 1) 读请求行 + 请求头，解析路径和 Content-Length
                    int contentLength = 0;
                    StringBuilder head = new StringBuilder();
                    int c;
                    while ((c = in.read()) != -1) {
                        head.append((char) c);
                        if (head.length() >= 4 && head.substring(head.length() - 4).equals("\r\n\r\n")) break;
                        if (head.length() > 8192) break; // 防异常大头部
                    }
                    if (head.length() == 0) break; // 客户端关闭连接
                    String h = head.toString();
                    // 请求行形如: POST /notify HTTP/1.1
                    String path = "/notify";
                    int sp1 = h.indexOf(' ');
                    int sp2 = sp1 >= 0 ? h.indexOf(' ', sp1 + 1) : -1;
                    if (sp1 >= 0 && sp2 > sp1) path = h.substring(sp1 + 1, sp2);
                    // 批次 11：vscreen 路由需要区分 GET/POST（/vscreen/see=GET、/vscreen/tap=POST…）
                    String httpMethod = sp1 > 0 ? h.substring(0, sp1) : "GET";
                    // 原始请求路径（含 ?query）：路由匹配用去掉 query 的 path，
                    // 但 handler 取参必须用带 query 的原始串，否则 queryField(path,…) 永远取不到值
                    // （曾导致 /overlay?action=、/usage?days= 等 query 形式参数全部静默失效）。
                    final String rawPath = path;
                    int qIdx = path.indexOf('?');
                    if (qIdx >= 0) path = path.substring(0, qIdx);
                    int clIdx = h.toLowerCase().indexOf("content-length:");
                    if (clIdx >= 0) {
                        int eol = h.indexOf('\r', clIdx);
                        if (eol < 0) eol = h.indexOf('\n', clIdx);
                        if (eol < 0) eol = h.length();
                        try {
                            contentLength = Integer.parseInt(h.substring(clIdx + 15, eol).trim());
                        } catch (Exception ignored) {}
                    }
                    // 2) 读取正文（JSON body）
                    StringBuilder body = new StringBuilder();
                    if (contentLength > 0 && contentLength < 65536) {
                        byte[] buf = new byte[contentLength];
                        int off = 0;
                        while (off < contentLength) {
                            int n = in.read(buf, off, contentLength - off);
                            if (n < 0) break;
                            off += n;
                        }
                        body.append(new String(buf, 0, off, "UTF-8"));
                    } else {
                        // contentLength==0（如 GET 请求 /usage?days=N /overlay /status）：不读 body，
                        // 否则阻塞等 EOF 会 5s 读超时（SocketTimeoutException），所有 GET 路由卡死。
                    }
                    // 3) 鉴权：X-DSH-Token 必须匹配（插件经 env APP_LOCAL_TOKEN 获知，第三方应用拿不到）。
                    //    批次 20 fail-closed：token 不可用（TokenStore 存储异常返回空串）时拒绝服务，
                    //    不再跳过校验——旧行为 token 为空即放行，等于允许任何本机应用伪造通知。
                    //    正常路径 TokenStore.getOrCreate 必产出非空 token，本分支仅存储异常可达。
                    //    比较走 TokenStore.constantTimeHeaderEquals（MessageDigest.isEqual，防时序侧信道）。
                    //    引擎运行中 token 被清空重生成时，插件 env 里的旧 token 会 401 直到引擎重启
                    //    （fail-closed 的既有代价，此前重生成场景同样 401），不做引擎自动重启（超出本批范围）。
                    String expectToken = localToken();
                    boolean authorized;
                    if (expectToken.isEmpty()) {
                        // 批次20 fail-closed：token 存储不可用时拒绝服务（旧行为是放行=旁路）。
                        Log.w(TAG, "local token unavailable — rejecting bridge request (fail-closed)");
                        authorized = false;
                    } else {
                        authorized = TokenStore.constantTimeHeaderEquals(h, "x-dsh-token", expectToken);
                    }
                    if (!authorized) {
                        Log.w(TAG, "local-bridge auth reject: " + path + " from " + s.getRemoteSocketAddress());
                        String rb = "{\"ok\":false,\"error\":\"unauthorized\"}";
                        BufferedWriter rw = new BufferedWriter(new OutputStreamWriter(s.getOutputStream(), "UTF-8"));
                        rw.write("HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: "
                                + rb.getBytes("UTF-8").length + "\r\nConnection: close\r\n\r\n" + rb);
                        rw.flush();
                        break; // 401 后不再复用该连接（批次 7 keep-alive：退出循环并关闭）
                    }
                    // 4) 分发处理
                    String respBody;
                    if (path.startsWith("/setting")) {
                        respBody = handleSettingRequest(body.toString());
                    } else if (path.startsWith("/clipboard")) {
                        respBody = handleClipboardRequest(body.toString());
                    } else if (path.startsWith("/notifications")) {
                        int limit = 20;
                        try {
                            String s = queryField(rawPath, "limit");
                            if (!s.isEmpty()) limit = Math.max(1, Math.min(50, Integer.parseInt(s.trim())));
                        } catch (Exception ignored) {}
                        respBody = NotificationListener.queryJson(limit);
                    } else if (path.startsWith("/confirm/result")) {
                        respBody = handleConfirmResult(rawPath, body.toString());
                    } else if (path.startsWith("/confirm")) {
                        respBody = handleConfirmRequest(body.toString());
                    } else if (path.startsWith("/schedule")) {
                        respBody = handleScheduleRequest(body.toString());
                    } else if (path.startsWith("/trigger")) {
                        respBody = handleTriggerRequest(rawPath, body.toString());
                    } else if (path.startsWith("/usage")) {
                        respBody = handleUsageRequest(rawPath, body.toString());
                    } else if (path.startsWith("/overlay")) {
                        respBody = handleOverlayRequest(rawPath, body.toString());
                    } else if (path.startsWith("/status")) {
                        respBody = handleStatusRequest();
                    } else if (path.startsWith("/a11y-selfheal")) {
                        // 批次6：root 自动重开无障碍（阶段1实验证实：App 活着时 root 写回 secure 设置
                        // 服务立即重绑；force-stop 场景进程已死无法自救，仍走通知/deep-link）
                        respBody = handleA11ySelfheal();
                    } else if (path.startsWith("/wakelock") || path.startsWith("/open-file")
                            || path.startsWith("/open-url")) {
                        // 批次86-P3-2：三条死路由**删除**（全仓零调用方，见 docs/批次86-重审与瘦身方案.md §P3-2；
                        // 备份实现见 git 历史：/open-url 的 ACTION_VIEW、/open-file 的配置查看器、/wakelock 的
                        // PARTIAL_WAKE_LOCK，后者早由 TaskStore/KeepAlivePolicy 接管、批次23 D5 已标 deprecated）。
                        // 这里保留一个**明确的拒绝**响应，避免请求落到下面的 handleNotifyRequest 兜底（那会把它
                        // 误当成"发通知"，静默干错事）。
                        respBody = "{\"ok\":false,\"error\":\"该路由已于批次86 删除（全仓无调用方）\"}";
                    } else if (path.startsWith("/task/")) {
                        // 批次23 S1（D8 S1）：Task DB 桥路由 list/get/upsert/finish——TaskStore 独占读写。
                        respBody = handleTaskRequest(httpMethod, rawPath, body.toString());
                    } else if (path.startsWith("/a11y-open-settings")) {
                        // 批次 3 任务 2：直达系统无障碍设置页
                        respBody = handleA11yOpenSettings();
                    } else if (path.startsWith("/vscreen/")) {
                        // 批次 11：vscreen 虚拟屏（root/Shizuku 双通道）——委托 VscreensManager 网关。
                        // see 返回 PNG 字节流需原样透传，不能走下方 JSON 文本路径，响应由网关直接写回 socket。
                        boolean clientCloseV = h.contains("HTTP/1.0")
                                || headerValueEquals(h, "connection", "close");
                        VscreensManager.get().handleLocal(MainActivity.this, httpMethod, rawPath,
                                body.toString(), s, clientCloseV);
                        if (clientCloseV) break;
                        continue;
                    } else {
                        respBody = handleNotifyRequest(body.toString());
                    }
                    boolean clientClose = h.contains("HTTP/1.0")
                            || headerValueEquals(h, "connection", "close");
                    BufferedWriter w = new BufferedWriter(new OutputStreamWriter(s.getOutputStream(), "UTF-8"));
                    w.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
                            + respBody.getBytes("UTF-8").length + "\r\nConnection: "
                            + (clientClose ? "close" : "keep-alive") + "\r\n\r\n" + respBody);
                    w.flush();
                    if (clientClose) break;
                    } // while (keep-alive 循环)
                    s.close();
                } catch (Throwable t) {
                    Log.w(TAG, "local server connection error", t);
                    // 空闲超时（keep-alive 连接上无后续请求）或客户端断开：正常关闭
                    try { s.close(); } catch (Throwable ignored) {}
                }
            }
        }, "local-conn").start();
    }

    /** 处理 /usage：查询应用使用时长（UsageStats）。参数 days=N（默认 1，上限 30）。 */
    private String handleUsageRequest(String path, String raw) {
        try {
            String days = jsonField(raw, "days");
            if (days.isEmpty()) days = queryField(path, "days");
            int d = 1;
            try { if (!days.isEmpty()) d = Integer.parseInt(days.trim()); } catch (Exception ignored) {}
            return UsageStatsHelper.queryUsageJson(this, d);
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}";
        }
    }

    /** 处理 /status：引擎/服务运行状态（供悬浮窗与 AI 查询）。 */
    private String handleStatusRequest() {
        boolean engineOk = isDshEngine(enginePort);
        // 批次 3：nodeAlive 以端口可达为硬信号。字段名保持不变，只改判据——
        // 旧判据（Process 句柄存活）在失败 spawn 覆盖 nodeProcess 后恒为 false，与 engineReady
        // 自相矛盾（曾出现 engineReady:true + nodeAlive:false 而 3080 实测 401 在线）。
        boolean handleAlive = nodeProcess != null && nodeProcess.isAlive();
        StringBuilder sb = new StringBuilder("{\"ok\":true");
        sb.append(",\"enginePort\":").append(enginePort);
        sb.append(",\"engineReady\":").append(engineOk);
        sb.append(",\"nodeAlive\":").append(engineOk || handleAlive);
        sb.append(",\"overlay\":").append(OverlayService.isRunning);
        sb.append(",\"overlayEngineUp\":").append(OverlayService.engineUp);
        sb.append(",\"usageGranted\":").append(UsageStatsHelper.permissionGranted(this));
        sb.append(",\"overlayGranted\":").append(Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this));
        // 批次 3 任务 2：无障碍运行状态（setting 列表 ∪ 3181 桥可用），并给出实际来源便于排查
        boolean a11yBySetting = a11yEnabledInSecureSettings();
        boolean a11yByBridge = a11yBridgeAlive();
        String a11ySource = a11yBySetting && a11yByBridge ? "setting+bridge"
                : a11yBySetting ? "setting" : a11yByBridge ? "bridge" : "none";
        sb.append(",\"a11yRunning\":").append(a11yBySetting || a11yByBridge);
        sb.append(",\"a11ySource\":\"").append(a11ySource).append('"');
        // 批次82-N2：屏幕状态。用户已拍板放弃「息屏下虚拟屏渲染」（本机息屏后 VD 必黑），
        // 因此视觉类工具（截图 / 虚拟屏 see）必须能据此诚实失败，而不是把黑帧当成功返回。
        boolean screenOn = isScreenInteractive();
        sb.append(",\"screenOn\":").append(screenOn);
        sb.append(",\"screenState\":\"").append(screenOn ? "on" : "off").append('"');
        sb.append('}');
        return sb.toString();
    }

    /** 批次82-N2：屏幕是否亮着（PowerManager.isInteractive）。取不到时按「亮」处理，宁可放过不可误杀。 */
    private boolean isScreenInteractive() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            return pm == null || pm.isInteractive();
        } catch (Throwable t) {
            return true;
        }
    }

    /** 处理 /overlay：控制蓝色大肥鱼悬浮窗。action=show|hide|toggle|status。 */
    private String handleOverlayRequest(String path, String raw) {
        try {
            String action = jsonField(raw, "action");
            if (action.isEmpty()) action = queryField(path, "action");
            if (action.isEmpty()) action = "status";
            if (action.equals("status")) {
                return "{\"ok\":true,\"running\":" + OverlayService.isRunning
                        + ",\"engineUp\":" + OverlayService.engineUp
                        + ",\"granted\":" + (Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this)) + "}";
            }
            if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) {
                return "{\"ok\":false,\"error\":\"未授予悬浮窗权限，请在权限引导页/系统设置里开启\"}";
            }
            if (action.equals("show") || action.equals("toggle")) {
                if (OverlayService.isRunning) {
                    if (action.equals("toggle")) { stopOverlayService(); return "{\"ok\":true,\"running\":false}"; }
                    return "{\"ok\":true,\"running\":true,\"msg\":\"已在运行\"}";
                }
                startOverlayService();
                return "{\"ok\":true,\"running\":true}";
            }
            if (action.equals("hide")) {
                stopOverlayService();
                return "{\"ok\":true,\"running\":false}";
            }
            return "{\"ok\":false,\"error\":\"未知 action（show/hide/toggle/status）\"}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}";
        }
    }

    /** 启动蓝色大肥鱼悬浮窗（需已授予悬浮窗权限；权限引导页里会调用）。 */
    /** 批次47：助手自启开关（与 BootReceiver 同源，缺省 true）。 */
    private static final String PREF_BALL_AUTOSTART = "ball_autostart";

    private void startOverlayService() {
        try {
            Intent i = new Intent(this, OverlayService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                startForegroundService(i);
            } else {
                startService(i);
            }
            // 批次47：用户主动开启助手浮层 → 记住「开机/更新后要把它带回来」
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putBoolean(PREF_BALL_AUTOSTART, true).apply();
            // 批次55-C：BootReceiver 读的是 dsh_prefs/ball_autostart（批次47 曾写到 dsh_setup，
            // 导致「关闭球」的选择在重启后被忽略）——开关按权威源再写一份，两份保持同值。
            getSharedPreferences(KeepAlivePolicy.PREFS_NAME, MODE_PRIVATE).edit()
                    .putBoolean(KeepAlivePolicy.KEY_BALL_AUTOSTART, true).apply();
            Log.i(TAG, "overlay service starting");
        } catch (Throwable t) {
            Log.w(TAG, "overlay start failed", t);
        }
    }

    /** 停止蓝色大肥鱼悬浮窗。 */
    private void stopOverlayService() {
        try {
            stopService(new Intent(this, OverlayService.class));
            // 批次47：用户主动关闭助手浮层 → 尊重选择，重启后不再自动拉起
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putBoolean(PREF_BALL_AUTOSTART, false).apply();
            // 批次55-C：权威源同步一份（同上，BootReceiver 只认 dsh_prefs/ball_autostart）
            getSharedPreferences(KeepAlivePolicy.PREFS_NAME, MODE_PRIVATE).edit()
                    .putBoolean(KeepAlivePolicy.KEY_BALL_AUTOSTART, false).apply();
        } catch (Throwable t) {
            Log.w(TAG, "overlay stop failed", t);
        }
    }

    /** 处理 /notify：发系统通知（仅需通知权限）。 */
    private String handleNotifyRequest(String raw) {
        String title = "", text = "";
        int ti = raw.indexOf("\"title\"");
        int tx = raw.indexOf("\"text\"");
        if (ti >= 0 || tx >= 0) {
            title = jsonField(raw, "title");
            text = jsonField(raw, "text");
        } else {
            title = queryField(raw, "title");
            text = queryField(raw, "text");
        }
        if (title.isEmpty()) title = "DeepSeek Harness";
        if (text.isEmpty()) text = "(空消息)";
        boolean granted = checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            postNotification(title, text);
            return "{\"ok\":true}";
        }
        return "{\"ok\":false,\"error\":\"通知权限未授予，无法发送通知\"}";
    }

    /** 处理 /setting：改系统设置（⑤，走 App 的 WRITE_SETTINGS 权限，仅限 System 命名空间，免 Shizuku）。
     *  音量类 key 必须走 AudioManager.setStreamVolume（Settings.System 的记录不生效）；
     *  其余 System 项走 Settings.System.put。 */
    private String handleSettingRequest(String raw) {
        try {
            String key = jsonField(raw, "key");
            String value = jsonField(raw, "value");
            if (key.isEmpty()) {
                key = queryField(raw, "key");
                value = queryField(raw, "value");
            }
            if (key.isEmpty()) return "{\"ok\":false,\"error\":\"缺少 key 参数\"}";
            // 音量：走 AudioManager（真实生效，无需 WRITE_SETTINGS）
            if (key.startsWith("volume_")) {
                return handleVolumeRequest(key, value);
            }
            // 其余 System 设置：需要 WRITE_SETTINGS 权限
            if (Build.VERSION.SDK_INT < 23 || !Settings.System.canWrite(this)) {
                return "{\"ok\":false,\"error\":\"未授予「修改系统设置」权限（WRITE_SETTINGS），无法修改；请先在权限引导页/系统设置里开启\"}";
            }
            boolean ok;
            if (isNumeric(value)) {
                ok = Settings.System.putInt(getContentResolver(), key, Integer.parseInt(value));
            } else {
                ok = Settings.System.putString(getContentResolver(), key, value);
            }
            return ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"写入失败（key 可能不存在或不允许修改）\"}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}";
        }
    }

    /** 音量调节：走 AudioManager.setStreamVolume（真实改变音量）。 */
    private String handleVolumeRequest(String key, String value) {
        try {
            android.media.AudioManager am = (android.media.AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return "{\"ok\":false,\"error\":\"音频服务不可用\"}";
            int stream;
            switch (key) {
                case "volume_music": stream = android.media.AudioManager.STREAM_MUSIC; break;
                case "volume_ring": stream = android.media.AudioManager.STREAM_RING; break;
                case "volume_alarm": stream = android.media.AudioManager.STREAM_ALARM; break;
                case "volume_notification": stream = android.media.AudioManager.STREAM_NOTIFICATION; break;
                case "volume_system": stream = android.media.AudioManager.STREAM_SYSTEM; break;
                case "volume_voice_call": stream = android.media.AudioManager.STREAM_VOICE_CALL; break;
                default: return "{\"ok\":false,\"error\":\"不支持的音量类型: " + key + "\"}";
            }
            int max = am.getStreamMaxVolume(stream);
            int val;
            if (value.endsWith("%")) {
                // 支持百分比：如 "50%"
                val = (int) Math.round(max * Integer.parseInt(value.replace("%", "").trim()) / 100.0);
            } else {
                val = Integer.parseInt(value.trim());
            }
            if (val < 0) val = 0;
            if (val > max) val = max;
            // flags=0：不显示音量条、不播放提示音（静默调整，避免打扰）
            am.setStreamVolume(stream, val, 0);
            return "{\"ok\":true,\"stream\":\"" + key + "\",\"level\":" + val + ",\"max\":" + max + "}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}";
        }
    }

    /** 处理 /clipboard：读写剪贴板（⑦，无需任何特殊权限）。 */
    private String handleClipboardRequest(String raw) {
        try {
            String action = jsonField(raw, "action");
            if (action.isEmpty()) action = queryField(raw, "action");
            if (action.isEmpty()) action = "read";
            if (action.equals("write")) {
                String content = jsonField(raw, "content");
                if (content.isEmpty()) content = queryField(raw, "content");
                if (content.isEmpty()) return "{\"ok\":false,\"error\":\"缺少 content 参数\"}";
                android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(android.content.ClipData.newPlainText("dsh", content));
                return "{\"ok\":true}";
            }
            if (action.equals("clear")) {
                // 批次 7（#54）：粘贴注入会在系统剪贴板留下注入文本，插件按 clear_clipboard
                // 调用本动作清空（置空 ClipData；write 路径拒绝空 content，故单独提供 clear）。
                android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(android.content.ClipData.newPlainText("dsh", ""));
                return "{\"ok\":true}";
            }
            // read
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null || !cm.hasPrimaryClip()) return "{\"ok\":true,\"content\":\"\"}";
            CharSequence cs = cm.getPrimaryClip().getItemAt(0).coerceToText(this);
            String content = cs == null ? "" : cs.toString();
            // JSON 转义
            content = content.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
            return "{\"ok\":true,\"content\":\"" + content + "\"}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}";
        }
    }

    /** 处理 WebView 文件下载：保存到公共 Download 目录，避免下载请求被静默丢弃 */
    private void handleDownload(final String url, final String userAgent,
                                final String contentDisposition, final String mimetype,
                                final long contentLength) {
        if (url == null || url.trim().isEmpty()) return;
        final String finalUrl = url.trim();

        // 1. data: 协议直接在本地解码写入
        if (finalUrl.startsWith("data:")) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        int comma = finalUrl.indexOf(',');
                        if (comma < 0) return;
                        String header = finalUrl.substring(5, comma);
                        String data = finalUrl.substring(comma + 1);
                        byte[] bytes;
                        if (header.contains(";base64")) {
                            bytes = Base64.decode(data, Base64.DEFAULT);
                        } else {
                            bytes = java.net.URLDecoder.decode(data, "UTF-8").getBytes("UTF-8");
                        }
                        String ext = ".bin";
                        if (header.contains("image/png")) ext = ".png";
                        else if (header.contains("image/jpeg")) ext = ".jpg";
                        else if (header.contains("text/plain")) ext = ".txt";
                        else if (header.contains("application/json")) ext = ".json";

                        String filename = "download_" + System.currentTimeMillis() + ext;
                        File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                        if (!downloadDir.exists()) downloadDir.mkdirs();
                        File outFile = new File(downloadDir, filename);
                        FileOutputStream fos = new FileOutputStream(outFile);
                        fos.write(bytes);
                        fos.close();

                        notifyDownloadSuccess(outFile);
                    } catch (Throwable t) {
                        Log.w(TAG, "data: download failed", t);
                        showToast("下载失败: " + t.getMessage());
                    }
                }
            }).start();
            return;
        }

        // 2. blob: 协议在前端无法由底层直接抓取，注入 JS 读成 data URI
        if (finalUrl.startsWith("blob:")) {
            showToast("正在导出数据...");
            if (webView != null) {
                final String js = "(function() {" +
                        "  fetch('" + finalUrl + "')" +
                        "    .then(r => r.blob())" +
                        "    .then(b => {" +
                        "      var reader = new FileReader();" +
                        "      reader.onloadend = function() {" +
                        "        window.location.href = reader.result;" +
                        "      };" +
                        "      reader.readAsDataURL(b);" +
                        "    })" +
                        "    .catch(e => console.error('blob fetch error', e));" +
                        "})();";
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (Build.VERSION.SDK_INT >= 19) {
                            webView.evaluateJavascript(js, null);
                        } else {
                            webView.loadUrl("javascript:" + js);
                        }
                    }
                });
            }
            return;
        }

        // 3. http / https 协议
        final String rawName = URLUtil.guessFileName(finalUrl, contentDisposition, mimetype);
        final String filename = (rawName == null || rawName.trim().isEmpty() || "downloadfile.bin".equalsIgnoreCase(rawName))
                ? ("dsh_file_" + System.currentTimeMillis()) : rawName;

        showToast("开始下载: " + filename);

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    if (!downloadDir.exists()) downloadDir.mkdirs();
                    File outFile = new File(downloadDir, filename);
                    if (outFile.exists()) {
                        String nameWithoutExt = filename;
                        String ext = "";
                        int dot = filename.lastIndexOf('.');
                        if (dot > 0) {
                            nameWithoutExt = filename.substring(0, dot);
                            ext = filename.substring(dot);
                        }
                        int counter = 1;
                        while (outFile.exists() && counter < 1000) {
                            outFile = new File(downloadDir, nameWithoutExt + " (" + counter + ")" + ext);
                            counter++;
                        }
                    }

                    HttpURLConnection conn = (HttpURLConnection) new URL(finalUrl).openConnection();
                    conn.setConnectTimeout(10000);
                    conn.setReadTimeout(30000);
                    if (userAgent != null && !userAgent.isEmpty()) {
                        conn.setRequestProperty("User-Agent", userAgent);
                    }
                    String cookie = null;
                    try {
                        cookie = CookieManager.getInstance().getCookie(finalUrl);
                    } catch (Throwable ignored) {}
                    if (cookie == null || cookie.isEmpty()) {
                        cookie = engineAuthCookie;
                    }
                    if (cookie != null && !cookie.isEmpty()) {
                        conn.setRequestProperty("Cookie", cookie);
                    }

                    int respCode = conn.getResponseCode();
                    if (respCode >= 200 && respCode < 300) {
                        InputStream in = conn.getInputStream();
                        FileOutputStream fos = new FileOutputStream(outFile);
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) >= 0) {
                            fos.write(buf, 0, n);
                        }
                        fos.flush();
                        fos.close();
                        in.close();
                        conn.disconnect();

                        notifyDownloadSuccess(outFile);
                    } else {
                        conn.disconnect();
                        showToast("下载失败，HTTP " + respCode);
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "download failed for " + finalUrl, t);
                    showToast("下载异常: " + t.getMessage());
                }
            }
        }).start();
    }

    private void notifyDownloadSuccess(final File file) {
        try {
            MediaScannerConnection.scanFile(
                    this,
                    new String[]{file.getAbsolutePath()},
                    null,
                    null
            );
        } catch (Throwable ignored) {}

        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                android.widget.Toast.makeText(MainActivity.this, "已下载到: Download/" + file.getName(), android.widget.Toast.LENGTH_LONG).show();
            }
        });
    }

    private void showToast(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                android.widget.Toast.makeText(MainActivity.this, msg, android.widget.Toast.LENGTH_SHORT).show();
            }
        });
    }

     private boolean isNumeric(String s) {
         if (s == null || s.isEmpty()) return false;
         for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch < '0' || ch > '9') return false;
        }
        return true;
    }

    // ============ ⑥ 定时任务（半自动版）============
    /** 处理 /schedule：AI 设置定时提醒 → AlarmManager 注册系统闹钟。
     *  到点系统唤醒 AlarmReceiver（即使 App 被杀也能触发）→ 推送通知提醒。
     *  若 App 仍在后台（保活生效），点通知可回 App 继续执行。 */
    private String handleScheduleRequest(String raw) {
        try {
            String text = jsonField(raw, "text");
            if (text.isEmpty()) text = queryField(raw, "text");
            // 批次85-R2：数值型字段必须**先**走 jsonNumField。
            // 踩过的坑：jsonField 遇到 {"k":60} 这种裸数字时，会去抓冒号后**下一个引号串**当值
            // （实测把 "when" 当成了 intervalMin 的值）→ 非空但不可解析 → 永远报「缺少 intervalMin」。
            String when = jsonNumField(raw, "when");
            if (when.isEmpty()) when = jsonField(raw, "when");
            if (when.isEmpty()) when = queryField(raw, "when");
            // 重复模式（Kun 式调度）：once 一次性（默认）| daily 每天 | interval 每隔 N 分钟
            String repeat = jsonField(raw, "repeat");
            if (repeat.isEmpty()) repeat = queryField(raw, "repeat");
            if (repeat.isEmpty()) repeat = "once";
            String im = jsonNumField(raw, "intervalMin");               // 裸数字（工具 schema 是 number）
            if (im.isEmpty()) im = jsonField(raw, "intervalMin");       // 字符串形态 "60"
            if (im.isEmpty()) im = queryField(raw, "intervalMin");
            // 只取前缀整数：queryField 对 JSON body 会回出 60,"when":"3600" 这类串，
            // 直接 parseInt 会抛异常 → intervalMin 停在 0 → 永远报「缺少 intervalMin」（真机实测）。
            return createScheduledTask(text, when, repeat, leadingInt(im));
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}";
        }
    }

    /** 批次86-P1：建一条定时任务（校验 → 解析触发时刻 → 存盘 → 注册系统闹钟）。
     *  {@code /schedule} 路由与 App 内「＋ 新建 / 编辑」表单**共用同一条链路**（表单不走 JSON 往返，
     *  免得手写 {@code jsonField} 的引号/转义解析边界再咬人一次）。 */
    private String createScheduledTask(String text, String when, String repeat, int intervalMin) {
        try {
            if (!repeat.equals("once") && !repeat.equals("daily") && !repeat.equals("interval")) {
                return "{\"ok\":false,\"error\":\"repeat 仅支持 once/daily/interval\"}";
            }
            if (repeat.equals("interval") && intervalMin <= 0) {
                return "{\"ok\":false,\"error\":\"interval 模式需要 intervalMin（分钟）参数\"}";
            }
            if (text.isEmpty()) return "{\"ok\":false,\"error\":\"缺少 text 参数\"}";
            if (when.isEmpty()) {
                // interval 模式允许省略 when（默认 1 分钟后首次触发）
                if (repeat.equals("interval")) when = "60";
                else return "{\"ok\":false,\"error\":\"缺少 when 参数（ISO 时间或相对秒数）\"}";
            }

            long triggerAt;
            // 支持两种格式：纯数字 = 相对秒数；否则按 ISO 时间解析
            if (isNumeric(when)) {
                triggerAt = System.currentTimeMillis() + Long.parseLong(when) * 1000L;
            } else {
                // 批次88 修 D7/D14：SimpleDateFormat 默认 lenient，会把非法时间**静默**归一化
                // ——真机实测 when="99:99" 建出「11 小时 20 分钟后」的任务（= 次日 04:39），
                // 用户完全不知道时间填错了。改为严格解析 + 字段范围校验 + 中文错误。
                Long parsed = parseScheduleWhenStrict(when.trim());
                if (parsed == null) {
                    return "{\"ok\":false,\"error\":\"时间格式不对或不是合法时刻（支持 HH:mm、yyyy-MM-dd HH:mm、yyyy-MM-dd HH:mm:ss，或相对秒数）\"}";
                }
                triggerAt = parsed;
            }
            if (triggerAt <= System.currentTimeMillis()) {
                // interval 模式：when 已过则从 1 分钟后起算（避免报错打断循环任务）
                if (repeat.equals("interval")) {
                    triggerAt = System.currentTimeMillis() + 60 * 1000L;
                } else {
                    return "{\"ok\":false,\"error\":\"触发时间已过，请设置未来的时间\"}";
                }
            }

            android.app.AlarmManager am = (android.app.AlarmManager) getSystemService(Context.ALARM_SERVICE);
            // 存任务到文件（AlarmReceiver 到点时读取并自动执行）
            String taskId = "task-" + System.currentTimeMillis();
            saveScheduledTask(taskId, text, triggerAt, repeat, intervalMin);
            Intent i = new Intent(this, AlarmReceiver.class);
            i.putExtra("task", text);
            i.putExtra("taskId", taskId);
            i.putExtra("repeatType", repeat);
            i.putExtra("intervalMin", intervalMin);
            i.putExtra("triggerAt", triggerAt);
        // 批次85-R2：requestCode 必须按 taskId 区分 —— 原来固定 0 会让**后建的任务覆盖前一个**的闹钟
        // （filterEquals 忽略 extras，同一 requestCode 的 PendingIntent 是同一个），多任务时只剩最后一个会响。
        android.app.PendingIntent pi = android.app.PendingIntent.getBroadcast(this, taskId.hashCode(), i,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            // 用 setAlarmClock（系统最高优先级闹钟，无需特殊权限、Doze 也触发）最可靠；
            // 失败则降级 setExactAndAllowWhileIdle / set
            try {
                if (Build.VERSION.SDK_INT >= 21) {
                    Intent show = new Intent(this, MainActivity.class);
                    show.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    android.app.PendingIntent showPi = android.app.PendingIntent.getActivity(this, 1, show,
                            android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
                    am.setAlarmClock(new android.app.AlarmManager.AlarmClockInfo(triggerAt, showPi), pi);
                } else {
                    am.setExact(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi);
                }
            } catch (Throwable t) {
                try {
                    if (Build.VERSION.SDK_INT >= 23) {
                        am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi);
                    } else {
                        am.setExact(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi);
                    }
                } catch (Throwable t2) {
                    am.set(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi);
                }
            }
            long secs = (triggerAt - System.currentTimeMillis()) / 1000;
            String whenStr = secs >= 3600
                    ? (secs / 3600) + "小时" + ((secs % 3600) / 60) + "分钟后"
                    : (secs / 60) + "分钟后";
            String repStr;
            if (repeat.equals("daily")) repStr = "每天";
            else if (repeat.equals("interval")) repStr = "每" + intervalMin + "分钟";
            else repStr = "一次性";
            return "{\"ok\":true,\"at\":\"" + whenStr + "\",\"repeat\":\"" + repStr
                    + "\",\"hint\":\"到点会自动拉起引擎执行任务（无需操作），完成后推送通知；重复任务到点后自动安排下一次；若 App 被杀，闹钟仍会触发并自动启动\"}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}";
        }
    }

    // ============ 定时任务持久化 ============
    /** 任务文件：内部私有目录（AlarmReceiver 与 MainActivity 都能读） */
    private File scheduledTasksFile() { return new File(getFilesDir(), "scheduled-tasks.json"); }
    /**
     * 执行记录日志（**外部**，与到点执行链路同源）。
     *
     * <p>批次88 修 D1：到点执行的记录由 {@link ScheduleExecutor#log} 写到
     * {@code /sdcard/DeepSeekHarness/scheduled-log.txt}（AlarmReceiver 也用它），
     * 而本方法原先返回**内部**私有目录的同名文件 —— 于是管理页「最近执行记录」
     * 永远看不到到点执行的真实结果（真机实证：内部日志尾部是「任务已保存/任务已删除」，
     * 外部日志尾部才是「闹钟触发 / 开始执行任务 / 任务已发送给 AI」）。
     * 同一页的 {@link #recentTriggerLog} 本来就读外部日志，这里统一口径。</p>
     */
    private File scheduledLogFile() {
        String rootName = getPackageName().contains(".beta") ? "DeepSeekHarnessLite" : "DeepSeekHarness";
        File root = new File(Environment.getExternalStorageDirectory(), rootName);
        if (!root.exists()) root.mkdirs();
        return new File(root, "scheduled-log.txt");
    }

    /** 保存一条定时任务到文件（jsonl 格式：taskId|triggerAt|repeatType|intervalMin|text）。
     *  repeatType: once=一次性 daily=每天 interval=每隔 N 分钟（intervalMin>0）。 */
    private void saveScheduledTask(String taskId, String text, long triggerAt, String repeatType, int intervalMin) {
        try {
            File f = scheduledTasksFile();
            String line = taskId + "|" + triggerAt + "|" + repeatType + "|" + intervalMin + "|"
                    + text.replace("|", " ").replace("\n", " ") + "\n";
            FileOutputStream fos = new FileOutputStream(f, true);
            fos.write(line.getBytes("UTF-8"));
            fos.close();
            logSchedule("任务已设置: " + text + " @ " + new java.text.SimpleDateFormat("MM-dd HH:mm:ss", Locale.US).format(new Date(triggerAt)));
        } catch (Throwable t) {
            Log.w(TAG, "saveScheduledTask error", t);
        }
    }

    private void logSchedule(String msg) {
        try {
            FileOutputStream fos = new FileOutputStream(scheduledLogFile(), true);
            String line = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date()) + " " + msg + "\n";
            fos.write(line.getBytes("UTF-8"));
            fos.close();
        } catch (Throwable ignored) {}
    }

    /** 从 JSON 里取字符串字段值（简易解析，不引第三方库）。 */
    /** 设置弹窗入口行文案（启用/停用条数 + 有无）。 */
    private String scheduleSummaryText() {
        List<String[]> tasks = latestScheduledTasks();
        int on = 0, off = 0;
        for (String[] p : tasks) { if (scheduledTaskEnabled(p)) on++; else off++; }
        if (tasks.isEmpty()) return "⏰ 定时任务 · 到点自动执行\n暂无任务；点进来「＋ 新建任务」即可创建（也可对助手说「每天 8 点提醒我…」）";
        return "⏰ 定时任务 · 到点自动执行\n共 " + tasks.size() + " 条（启用 " + on + " / 停用 " + off
                + "）；点此新建 / 查看下次触发 / 看最近结果";
    }

    /** 最近 N 条执行记录（倒序，来自 scheduled-log.txt）。 */
    private String recentScheduleLog(int n) {
        try {
            File f = scheduledLogFile();
            if (!f.exists()) return "（暂无执行记录）";
            java.util.ArrayDeque<String> q = new java.util.ArrayDeque<String>();
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
            String line;
            while ((line = r.readLine()) != null) {
                if (line.trim().isEmpty()) continue;
                q.addLast(line);
                if (q.size() > n) q.removeFirst();
            }
            r.close();
            StringBuilder sb = new StringBuilder();
            while (!q.isEmpty()) sb.append(q.pollLast()).append("\n");
            return sb.length() == 0 ? "（暂无执行记录）" : sb.toString().trim();
        } catch (Throwable t) {
            return "（读取记录失败: " + t.getMessage() + "）";
        }
    }

    /** 清掉历史遗留的「requestCode=0」闹钟（批次85-R2 之前的实现所有任务共用一个）。 */
    private void cancelLegacyScheduledAlarm() {
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Intent i = new Intent(this, AlarmReceiver.class);
            android.app.PendingIntent pi = android.app.PendingIntent.getBroadcast(this, 0, i,
                    android.app.PendingIntent.FLAG_NO_CREATE | android.app.PendingIntent.FLAG_IMMUTABLE);
            if (pi != null) { am.cancel(pi); pi.cancel(); }
        } catch (Throwable ignored) {}
    }

    private static long parseLongSafe(String s) {
        try { return Long.parseLong(s.trim()); } catch (Exception e) { return 0L; }
    }

    /** 管理页排序档位：0=启用且未到期，1=已过期，2=已停用。 */
    private static int scheduleRank(String[] p) {
        if (!scheduledTaskEnabled(p)) return 2;
        return parseLongSafe(p[1]) > System.currentTimeMillis() ? 0 : 1;
    }

    /** 批次85-R4：/trigger 路由 —— action=list|events|add|remove|enable|disable|fire|test。 */
    private String handleTriggerRequest(String rawPath, String raw) {
        try {
            String action = jsonField(raw, "action");
            if (action.isEmpty()) action = queryField(raw, "action");
            if (action.isEmpty()) action = "list";
            if (action.equals("events")) return TriggerEngine.eventsJson();
            if (action.equals("list")) return TriggerEngine.listJson(this);
            if (action.equals("add")) {
                String event = jsonField(raw, "event");
                if (event.isEmpty()) event = queryField(raw, "event");
                String match = jsonField(raw, "match");
                if (match.isEmpty()) match = queryField(raw, "match");
                String text = jsonField(raw, "text");
                if (text.isEmpty()) text = queryField(raw, "text");
                String cd = jsonNumField(raw, "cooldownSec");
                if (cd.isEmpty()) cd = queryField(raw, "cooldownSec");
                int cool = leadingInt(cd);
                if (!TriggerEngine.isKnownEvent(event)) {
                    return "{\"ok\":false,\"error\":\"unknown event\",\"events\":" + TriggerEngine.eventsJson() + "}";
                }
                String id = TriggerEngine.add(this, event, match, text, cool);
                if (id == null) return "{\"ok\":false,\"error\":\"add failed (text/event?)\"}";
                logSchedule("触发器已新增: " + TriggerEngine.label(event) + " → " + text);
                return "{\"ok\":true,\"id\":\"" + id + "\"}";
            }
            String id = jsonField(raw, "id");
            if (id.isEmpty()) id = queryField(raw, "id");
            if (action.equals("remove")) {
                boolean ok = TriggerEngine.remove(this, id);
                logSchedule("触发器已删除: " + id);
                return "{\"ok\":" + ok + "}";
            }
            if (action.equals("enable") || action.equals("disable")) {
                boolean ok = TriggerEngine.setEnabled(this, id, action.equals("enable"));
                logSchedule("触发器" + (action.equals("enable") ? "已启用: " : "已停用: ") + id);
                return "{\"ok\":" + ok + "}";
            }
            if (action.equals("fire")) {
                boolean ok = TriggerEngine.fireById(this, id);
                return "{\"ok\":" + ok + "}";
            }
            if (action.equals("test")) {
                String event = jsonField(raw, "event");
                if (event.isEmpty()) event = queryField(raw, "event");
                String match = jsonField(raw, "match");
                if (match.isEmpty()) match = queryField(raw, "match");
                int n = TriggerEngine.dispatchForTest(this, event, match);
                return "{\"ok\":true,\"hits\":" + n + "}";
            }
            return "{\"ok\":false,\"error\":\"unknown action\"}";
        } catch (Throwable t) {
            Log.w(TAG, "handleTriggerRequest error", t);
            return "{\"ok\":false,\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}";
        }
    }

    /** 批次85-R4：最近 N 条触发器日志（读外部日志，只挑含「触发器」的行）。 */
    private String recentTriggerLog(int n) {
        try {
            File root2 = new File(android.os.Environment.getExternalStorageDirectory(),
                    getPackageName().contains(".beta") ? "DeepSeekHarnessLite" : "DeepSeekHarness");
            File f = new File(root2, "scheduled-log.txt");
            if (!f.exists()) return "（暂无记录）";
            java.util.ArrayDeque<String> q = new java.util.ArrayDeque<String>();
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
            String line;
            while ((line = r.readLine()) != null) {
                if (line.indexOf("触发器") < 0) continue;
                q.addLast(line);
                if (q.size() > n) q.removeFirst();
            }
            r.close();
            StringBuilder sb = new StringBuilder();
            while (!q.isEmpty()) sb.append(q.pollLast()).append("\n");
            return sb.length() == 0 ? "（暂无记录）" : sb.toString().trim();
        } catch (Throwable t) {
            return "（读取失败: " + t.getMessage() + "）";
        }
    }

    /** 批次85-R4：事件触发器管理页（列表 / 测试 / 启停 / 删除 / 事件清单 / 手动模拟事件）。 */
    private void showTriggerManager() {
        try {
            AlertDialog.Builder b = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert);
            b.setTitle("⚡ 事件触发器");
            final AlertDialog dialog = b.create();
            ScrollView sv = new ScrollView(this);
            LinearLayout col = new LinearLayout(this);
            col.setOrientation(LinearLayout.VERTICAL);
            col.setPadding(dp(16), dp(10), dp(16), dp(14));
            sv.addView(col);

            TextView head = new TextView(this);
            head.setText("触发器 = 事件 × 动作。命中后后台拉起引擎，把任务交给 AI 执行（App 被杀也生效）。"
                    + "\n防抖：每条带冷却秒数（默认 60s）。");
            head.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            head.setTextColor(cSub());
            col.addView(head);

            final List<String[]> rows = TriggerEngine.readAll(this);
            if (rows.isEmpty()) {
                TextView empty = new TextView(this);
                empty.setText("暂无触发器。\n对助手说「插上充电器就静音」/「连上 WiFi 就同步笔记」即可创建。");
                empty.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
                empty.setTextColor(cText());
                LinearLayout.LayoutParams elp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                elp.topMargin = dp(12);
                col.addView(empty, elp);
            } else {
                for (String[] r : rows) col.addView(buildTriggerRow(dialog, r));
            }

            TextView logTitle = new TextView(this);
            logTitle.setText("最近触发记录");
            logTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            logTitle.setTypeface(null, android.graphics.Typeface.BOLD);
            logTitle.setTextColor(cText());
            LinearLayout.LayoutParams ltlp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            ltlp.topMargin = dp(16);
            col.addView(logTitle, ltlp);
            TextView logView = new TextView(this);
            logView.setText(recentTriggerLog(6));
            logView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            logView.setTextColor(cSub());
            col.addView(logView);

            // 事件清单 + 手动模拟（真机验证用：不依赖真实系统广播）
            TextView evTitle = new TextView(this);
            evTitle.setText("事件清单（点任一个 = 手动模拟该事件，用于验证）");
            evTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            evTitle.setTypeface(null, android.graphics.Typeface.BOLD);
            evTitle.setTextColor(cText());
            LinearLayout.LayoutParams etlp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            etlp.topMargin = dp(16);
            col.addView(evTitle, etlp);

            final android.widget.LinearLayout chips = new android.widget.LinearLayout(this);
            chips.setOrientation(LinearLayout.VERTICAL);
            for (String[] ev : TriggerEngine.EVENTS) {
                final String en = ev[0];
                TextView chip = new TextView(this);
                chip.setText(ev[1] + "（" + ev[0] + "）");
                chip.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
                chip.setTextColor(0xFFCFE3FF);
                chip.setPadding(dp(10), dp(9), dp(10), dp(9));
                chip.setBackground(roundBg(0x16CFE3FF, 10, 0, 0));
                LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                clp.topMargin = dp(6);
                chip.setLayoutParams(clp);
                chip.setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        int n = TriggerEngine.dispatchForTest(MainActivity.this, en, "");
                        logSchedule("手动模拟事件: " + en + " 命中 " + n + " 条");
                        showToast("模拟 " + en + "：命中 " + n + " 条触发器");
                        dialog.dismiss();
                        showTriggerManager();
                    }
                });
                chips.addView(chip);
            }
            col.addView(chips);

            LinearLayout foot = new LinearLayout(this);
            foot.setOrientation(LinearLayout.HORIZONTAL);
            foot.setGravity(Gravity.CENTER_VERTICAL);
            LinearLayout.LayoutParams flp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            flp.topMargin = dp(14);
            TextView close = new TextView(this);
            close.setText("关闭");
            close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            close.setTextColor(0xFFCCCCCC);
            close.setPadding(dp(18), dp(8), dp(18), dp(8));
            close.setBackground(roundBg(0x22FFFFFF, 12, 0, 0));
            close.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { dialog.dismiss(); }
            });
            foot.addView(close, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            col.addView(foot, flp);

            dialog.setView(sv);
            dialog.show();
        } catch (Throwable t) {
            Log.w(TAG, "showTriggerManager failed", t);
            showToast("打开触发器管理失败: " + t.getMessage());
        }
    }

    /** 触发器列表里的一条：事件 + 匹配 + 动作文本 + 三个动作（测试 / 启停 / 删除）。 */
    private View buildTriggerRow(final AlertDialog dialog, final String[] r) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(12), dp(10), dp(12), dp(8));
        box.setBackground(roundBg(0x14FFFFFF, 12, 1, 0x22FFFFFF));
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        blp.topMargin = dp(10);
        box.setLayoutParams(blp);

        boolean on = TriggerEngine.enabled(r);
        TextView title = new TextView(this);
        title.setText("当：" + TriggerEngine.label(r[1]) + (r[2] == null || r[2].trim().isEmpty() ? "" : "（" + r[2] + "）"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        title.setTextColor(0xFF9BD1FF);
        box.addView(title);

        TextView body = new TextView(this);
        body.setText("则：" + r[3]);
        body.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        body.setTextColor(cText());
        body.setMaxLines(3);
        body.setEllipsize(android.text.TextUtils.TruncateAt.END);
        box.addView(body);

        TextView meta = new TextView(this);
        String last = "0".equals(r[6]) ? "从未触发" : ("上次 " + fmtScheduleAt(parseLongSafe(r[6])));
        meta.setText("冷却 " + r[5] + "s · " + last + (on ? "" : " · 已停用"));
        meta.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        meta.setTextColor(cSub());
        box.addView(meta);

        LinearLayout btns = new LinearLayout(this);
        btns.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams ptlp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        ptlp.topMargin = dp(8);
        btns.setLayoutParams(ptlp);

        TextView run = new TextView(this);
        run.setText("测试");
        run.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        run.setTextColor(0xFF9BD1FF);
        run.setPadding(dp(10), dp(7), dp(10), dp(7));
        run.setBackground(roundBg(0x1A9BD1FF, 10, 0, 0));
        run.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                TriggerEngine.fireById(MainActivity.this, r[0]);
                showToast("已手动触发（引擎就绪后交给 AI）");
                dialog.dismiss();
                showTriggerManager();
            }
        });
        btns.addView(run);

        TextView toggle = new TextView(this);
        toggle.setText(on ? "停用" : "启用");
        toggle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        toggle.setTextColor(0xFFFFD79B);
        toggle.setPadding(dp(10), dp(7), dp(10), dp(7));
        toggle.setBackground(roundBg(0x1AFFD79B, 10, 0, 0));
        LinearLayout.LayoutParams tl2 = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        tl2.leftMargin = dp(8);
        toggle.setLayoutParams(tl2);
        toggle.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                boolean nowOn = TriggerEngine.enabled(r);
                TriggerEngine.setEnabled(MainActivity.this, r[0], !nowOn);
                logSchedule(nowOn ? "触发器已停用: " + r[0] : "触发器已启用: " + r[0]);
                dialog.dismiss();
                showTriggerManager();
            }
        });
        btns.addView(toggle);

        TextView del = new TextView(this);
        del.setText("删除");
        del.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        del.setTextColor(0xFFFF9B9B);
        del.setPadding(dp(10), dp(7), dp(10), dp(7));
        del.setBackground(roundBg(0x1AFF9B9B, 10, 0, 0));
        LinearLayout.LayoutParams dl2 = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        dl2.leftMargin = dp(8);
        del.setLayoutParams(dl2);
        del.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                TriggerEngine.remove(MainActivity.this, r[0]);
                logSchedule("触发器已删除: " + r[0]);
                dialog.dismiss();
                showTriggerManager();
            }
        });
        btns.addView(del);
        box.addView(btns);
        return box;
    }

    private GradientDrawable roundBg(int color, int radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setCornerRadius(dp(radiusDp));
        d.setColor(color);
        return d;
    }

    private GradientDrawable roundBg(int color, int radiusDp, int strokeDp, int strokeColor) {
        GradientDrawable d = roundBg(color, radiusDp);
        if (strokeDp > 0) d.setStroke(Math.round(strokeDp * getResources().getDisplayMetrics().density), strokeColor);
        return d;
    }

    /** 批次85-R2：定时任务管理页（列表 / 下次触发 / 启停 / 立即执行 / 删除 / 最近记录）。 */
    private void showScheduleManager() {
        try {
            AlertDialog.Builder b = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert);
            b.setTitle("⏰ 定时任务管理");
            final AlertDialog dialog = b.create();
            ScrollView sv = new ScrollView(this);
            LinearLayout col = new LinearLayout(this);
            col.setOrientation(LinearLayout.VERTICAL);
            col.setPadding(dp(16), dp(10), dp(16), dp(14));
            sv.addView(col);

            final TextView head = new TextView(this);
            head.setText("引擎：检测中…\n到点由系统闹钟唤醒 AlarmReceiver → 前台服务执行（App 被杀也生效）");
            head.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            head.setTextColor(cSub());
            col.addView(head);
            // 不能在主线程发 HTTP：NetworkOnMainThreadException 会被 catch 吞成「引擎离线」假象（本轮真机踩到）
            new Thread(new Runnable() {
                @Override public void run() {
                    boolean up = false;
                    try { up = HostedEngineManager.engineOnline(MainActivity.this); } catch (Throwable ignored) {}
                    final boolean online = up;
                    runOnUiThread(new Runnable() {
                        @Override public void run() {
                            head.setText("引擎：" + (online ? "在线" : "离线（到点会先自动拉起）")
                                    + "\n到点由系统闹钟唤醒 AlarmReceiver → 前台服务执行（App 被杀也生效）");
                        }
                    });
                }
            }, "b85r2-engine-probe").start();

            // 批次86-P1：页顶「＋ 新建任务」——此前这一页只能「管」不能「建」，
            // 唯一建法是「对助手说」（AI 调 android_schedule），用户明确抱怨过这一点。
            TextView addBtn = new TextView(this);
            addBtn.setText("＋ 新建任务");
            addBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            addBtn.setTextColor(0xFF9BD1FF);
            addBtn.setGravity(Gravity.CENTER);
            addBtn.setPadding(dp(12), dp(10), dp(12), dp(10));
            addBtn.setBackground(roundBg(0x1A9BD1FF, 12, 1, 0x339BD1FF));
            addBtn.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    dialog.dismiss();
                    showScheduleForm(null);
                }
            });
            LinearLayout.LayoutParams addLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            addLp.topMargin = dp(12);
            col.addView(addBtn, addLp);

            // 排序：启用且未到期（按触发时间升序）→ 已过期 → 已停用
            final List<String[]> tasks = latestScheduledTasks();
            java.util.Collections.sort(tasks, new java.util.Comparator<String[]>() {
                @Override public int compare(String[] a, String[] b) {
                    int ra = scheduleRank(a), rb = scheduleRank(b);
                    if (ra != rb) return ra - rb;
                    return Long.compare(parseLongSafe(a[1]), parseLongSafe(b[1]));
                }
            });
            if (tasks.isEmpty()) {
                TextView empty = new TextView(this);
                empty.setText("暂无定时任务。\n点上面「＋ 新建任务」自己建一条（也可以对助手说「每天早上 8 点提醒我…」）。");
                empty.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
                empty.setTextColor(cText());
                LinearLayout.LayoutParams elp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                elp.topMargin = dp(12);
                col.addView(empty, elp);
            } else {
                for (String[] p : tasks) col.addView(buildScheduleTaskRow(dialog, p));
            }

            TextView logTitle = new TextView(this);
            logTitle.setText("最近执行记录");
            logTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            logTitle.setTypeface(null, android.graphics.Typeface.BOLD);
            logTitle.setTextColor(cText());
            LinearLayout.LayoutParams ltlp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            ltlp.topMargin = dp(16);
            col.addView(logTitle, ltlp);
            TextView logView = new TextView(this);
            logView.setText(recentScheduleLog(6));
            logView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            logView.setTextColor(cSub());
            col.addView(logView);

            LinearLayout foot = new LinearLayout(this);
            foot.setOrientation(LinearLayout.HORIZONTAL);
            foot.setGravity(Gravity.CENTER_VERTICAL);
            LinearLayout.LayoutParams flp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            flp.topMargin = dp(14);
            TextView repair = new TextView(this);
            repair.setText("重排全部闹钟");
            repair.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            repair.setTextColor(0xFF9BD1FF);
            repair.setPadding(dp(10), dp(8), dp(10), dp(8));
            repair.setBackground(roundBg(0x1A9BD1FF, 12, 0, 0));
            repair.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    cancelLegacyScheduledAlarm();
                    int n = 0;
                    for (String[] p : tasks) {
                        if (!scheduledTaskEnabled(p)) continue;
                        long at = 0L;
                        try { at = Long.parseLong(p[1].trim()); } catch (Exception ignored) {}
                        long next = registerScheduledAlarm(p[0], p[4], at, p[2], parseIntSafe(p[3]));
                        if (next > 0) { p[1] = String.valueOf(next); n++; }
                    }
                    // 批次88 修 D8：原来调 rewriteScheduledTasks(null, null, false) ——
                    // 那个方法会**重新读文件**再写，上面循环里改的 p[1] 全被丢弃 ⇒
                    // 闹钟注册了新的、列表却仍显示旧时刻（甚至继续标「已过期」）。
                    // 改为把内存里已更新的整表落盘。
                    writeScheduledTasksAll(tasks);
                    logSchedule("已重排闹钟 " + n + " 条（并清理历史共用的 requestCode=0 闹钟）");
                    showToast("已重排 " + n + " 条闹钟");
                    dialog.dismiss();
                    showScheduleManager();
                }
            });
            foot.addView(repair, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            // 批次88 修 D13：多任务管理缺「批量清理」——过期的一次性任务此前只能逐条点删除，
            // 任务攒多了就得点很多次（真机现状：6 条里有 5 条是过期的测试任务）。
            TextView purge = new TextView(this);
            purge.setText("清理已过期");
            purge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            purge.setTextColor(0xFFFF9B9B);
            purge.setPadding(dp(10), dp(8), dp(10), dp(8));
            purge.setBackground(roundBg(0x1AFF9B9B, 12, 0, 0));
            LinearLayout.LayoutParams plp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            plp.leftMargin = dp(8);
            purge.setLayoutParams(plp);
            purge.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    long now = System.currentTimeMillis();
                    int n = 0;
                    java.util.List<String[]> keep = new ArrayList<String[]>();
                    for (String[] p : tasks) {
                        long at = 0L;
                        try { at = Long.parseLong(p[1].trim()); } catch (Exception ignored) {}
                        boolean expiredOnce = at <= now && !"interval".equals(p[2]) && !"daily".equals(p[2]);
                        if (expiredOnce) {
                            cancelScheduledAlarm(p[0]);
                            logSchedule("清理已过期任务: " + (p[4] == null ? "" : p[4]));
                            n++;
                        } else {
                            keep.add(p);
                        }
                    }
                    if (n == 0) { showToast("没有已过期的一次性任务"); return; }
                    writeScheduledTasksAll(keep);
                    showToast("已清理 " + n + " 条过期任务");
                    dialog.dismiss();
                    showScheduleManager();
                }
            });
            foot.addView(purge);
            TextView close = new TextView(this);
            close.setText("关闭");
            close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            close.setTextColor(0xFFCCCCCC);
            close.setPadding(dp(18), dp(8), dp(18), dp(8));
            close.setBackground(roundBg(0x22FFFFFF, 12, 0, 0));
            close.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { dialog.dismiss(); }
            });
            foot.addView(close);
            col.addView(foot, flp);

            dialog.setView(sv);
            dialog.show();
        } catch (Throwable t) {
            Log.w(TAG, "showScheduleManager failed", t);
            showToast("打开定时任务管理失败: " + t.getMessage());
        }
    }

    /** 管理页里的一条任务：文本 + 重复/下次触发 + 三个动作（立即执行 / 启停 / 删除）。 */
    private View buildScheduleTaskRow(final AlertDialog dialog, final String[] p) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(12), dp(10), dp(12), dp(8));
        box.setBackground(roundBg(0x14FFFFFF, 12, 1, 0x22FFFFFF));
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        blp.topMargin = dp(10);
        box.setLayoutParams(blp);

        boolean on = scheduledTaskEnabled(p);
        final String text = p[4] == null ? "" : p[4];
        long at = 0L;
        try { at = Long.parseLong(p[1].trim()); } catch (Exception ignored) {}
        boolean expiredOnce = on && at <= System.currentTimeMillis() && !"interval".equals(p[2]) && !"daily".equals(p[2]);

        TextView title = new TextView(this);
        title.setText(text.isEmpty() ? "(空任务)" : text);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        title.setTextColor(cText());
        title.setMaxLines(2);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        box.addView(title);

        TextView meta = new TextView(this);
        meta.setText(scheduledRepeatLabel(p) + " · " + fmtScheduleAt(at) + "（" + relativeFromNow(at) + "）"
                + (on ? (expiredOnce ? " · 已过期（点启用可重排）" : "") : " · 已停用"));
        meta.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        meta.setTextColor(cSub());
        box.addView(meta);

        LinearLayout btns = new LinearLayout(this);
        btns.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams ptlp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        ptlp.topMargin = dp(8);
        btns.setLayoutParams(ptlp);

        TextView run = new TextView(this);
        run.setText("立即执行");
        run.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        run.setTextColor(0xFF9BD1FF);
        run.setPadding(dp(10), dp(7), dp(10), dp(7));
        run.setBackground(roundBg(0x1A9BD1FF, 10, 0, 0));
        run.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                logSchedule("手动执行任务: " + text);
                pendingScheduledTask = text;
                executePendingScheduledTask();
                showToast("已提交执行（引擎就绪后自动发送给 AI）");
                dialog.dismiss();
            }
        });
        btns.addView(run);

        // 批次86-P1：加「编辑」——改时间 / 改重复方式不用删了重建（走与「＋ 新建任务」同一个表单）。
        TextView edit = new TextView(this);
        edit.setText("编辑");
        edit.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        edit.setTextColor(0xFF9BE3B0);
        edit.setPadding(dp(10), dp(7), dp(10), dp(7));
        edit.setBackground(roundBg(0x1A9BE3B0, 10, 0, 0));
        LinearLayout.LayoutParams edlp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        edlp.leftMargin = dp(8);
        edit.setLayoutParams(edlp);
        edit.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                dialog.dismiss();
                showScheduleForm(p);
            }
        });
        btns.addView(edit);

        TextView toggle = new TextView(this);
        toggle.setText(on ? "停用" : "启用");
        toggle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        toggle.setTextColor(0xFFFFD79B);
        toggle.setPadding(dp(10), dp(7), dp(10), dp(7));
        toggle.setBackground(roundBg(0x1AFFD79B, 10, 0, 0));
        LinearLayout.LayoutParams tglp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        tglp.leftMargin = dp(8);
        toggle.setLayoutParams(tglp);
        toggle.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                boolean nowOn = scheduledTaskEnabled(p);
                if (nowOn) {
                    cancelScheduledAlarm(p[0]);
                    p[5] = "off";
                    rewriteScheduledTasks(p[0], p, false);
                    logSchedule("任务已停用: " + text);
                    showToast("已停用（闹钟已取消）");
                } else {
                    long at0 = 0L;
                    try { at0 = Long.parseLong(p[1].trim()); } catch (Exception ignored) {}
                    long next = registerScheduledAlarm(p[0], text, at0, p[2], parseIntSafe(p[3]));
                    if (next <= 0L) {
                        showToast("一次性任务时间已过 —— 请重新创建（或改为每天/间隔）");
                        return;
                    }
                    p[1] = String.valueOf(next);
                    p[5] = "on";
                    rewriteScheduledTasks(p[0], p, false);
                    logSchedule("任务已启用: " + text + " @ " + fmtScheduleAt(next));
                    showToast("已启用，下次 " + fmtScheduleAt(next));
                }
                dialog.dismiss();
                showScheduleManager();
            }
        });
        btns.addView(toggle);

        TextView del = new TextView(this);
        del.setText("删除");
        del.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        del.setTextColor(0xFFFF9B9B);
        del.setPadding(dp(10), dp(7), dp(10), dp(7));
        del.setBackground(roundBg(0x1AFF9B9B, 10, 0, 0));
        LinearLayout.LayoutParams dlp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        dlp.leftMargin = dp(8);
        del.setLayoutParams(dlp);
        del.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                cancelScheduledAlarm(p[0]);
                rewriteScheduledTasks(p[0], null, true);
                logSchedule("任务已删除: " + text);
                showToast("已删除该定时任务");
                dialog.dismiss();
                showScheduleManager();
            }
        });
        btns.addView(del);
        box.addView(btns);
        return box;
    }

    // ============ 批次86-P1：定时任务表单（新建 / 编辑；全程不需要跟 AI 说话）============

    /** 表单小标题。 */
    private TextView formLabel(String s) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        t.setTextColor(cSub());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(12);
        t.setLayoutParams(lp);
        return t;
    }

    /** 表单里的胶囊按钮（选中态由 {@link #paintFormChips} 统一涂）。 */
    private TextView formChip(String label, View.OnClickListener l) {
        TextView t = new TextView(this);
        t.setText(label);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        t.setPadding(dp(12), dp(7), dp(12), dp(7));
        if (l != null) t.setOnClickListener(l);
        return t;
    }

    /** 选中 = 亮底白字；未选中 = 暗底灰字。 */
    private void paintFormChips(TextView[] chips, int selected) {
        for (int i = 0; i < chips.length; i++) {
            boolean on = (i == selected);
            chips[i].setTextColor(on ? 0xFFFFFFFF : 0xFF9A9A9A);
            chips[i].setBackground(roundBg(on ? 0x3D9BD1FF : 0x14FFFFFF, 10, on ? 1 : 0, 0x669BD1FF));
        }
    }

    private void addChipGap(LinearLayout row, TextView chip) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.leftMargin = dp(8);
        chip.setLayoutParams(lp);
        row.addView(chip);
    }

    /** 新建表单默认时间 = 10 分钟后（写成绝对时刻，避免「今天/明天」歧义）。 */
    private String defaultScheduleWhenSpec() {
        return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)
                .format(new Date(System.currentTimeMillis() + 10 * 60 * 1000L));
    }

    /** 快捷「明早 08:00」。 */
    private String tomorrowMorningSpec() {
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.add(java.util.Calendar.DAY_OF_YEAR, 1);
        c.set(java.util.Calendar.HOUR_OF_DAY, 8);
        c.set(java.util.Calendar.MINUTE, 0);
        c.set(java.util.Calendar.SECOND, 0);
        return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(c.getTime());
    }

    /** 编辑表单回填触发时间（p[1] = epoch ms）。 */
    private String scheduleFormWhenSpec(String[] p) {
        long at = parseLongSafe(p[1]);
        if (at <= 0L) return defaultScheduleWhenSpec();
        return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(new Date(at));
    }

    private static String safeRepeatType(String s) {
        if ("daily".equals(s) || "interval".equals(s)) return s;
        return "once";
    }

    private static int repeatIndex(String s) {
        if ("daily".equals(s)) return 1;
        if ("interval".equals(s)) return 2;
        return 0;
    }

    /** 定时任务表单：{@code existing == null} = 新建；非空 = 编辑该行（保存 = 取消旧闹钟 + 删旧行 + 建新）。
     *  与 {@code /schedule} 共用 {@link #createScheduledTask}，不经过 JSON 往返。 */
    private void showScheduleForm(final String[] existing) {
        try {
            final boolean isEdit = existing != null;
            AlertDialog.Builder b = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert);
            b.setTitle(isEdit ? "✎ 编辑定时任务" : "＋ 新建定时任务");
            final AlertDialog dialog = b.create();
            ScrollView sv = new ScrollView(this);
            final LinearLayout col = new LinearLayout(this);
            col.setOrientation(LinearLayout.VERTICAL);
            col.setPadding(dp(16), dp(6), dp(16), dp(14));
            sv.addView(col);

            col.addView(formLabel("任务内容（到点后交给 AI 执行）"));
            final EditText textIn = new EditText(this);
            textIn.setHint("例如：整理下载文件夹");
            textIn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            textIn.setTextColor(cText());
            textIn.setText(isEdit && existing[4] != null ? existing[4] : "");
            col.addView(textIn);

            col.addView(formLabel("触发时间（HH:mm = 今天/明天该时刻 · yyyy-MM-dd HH:mm = 具体日期 · 纯数字 = N 秒后）"));
            final EditText whenIn = new EditText(this);
            whenIn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            whenIn.setTextColor(cText());
            whenIn.setText(isEdit ? scheduleFormWhenSpec(existing) : defaultScheduleWhenSpec());
            col.addView(whenIn);
            LinearLayout quick = new LinearLayout(this);
            quick.setOrientation(LinearLayout.HORIZONTAL);
            quick.addView(formChip("＋10 分钟", new View.OnClickListener() {
                @Override public void onClick(View v) { whenIn.setText("600"); }
            }));
            addChipGap(quick, formChip("＋1 小时", new View.OnClickListener() {
                @Override public void onClick(View v) { whenIn.setText("3600"); }
            }));
            addChipGap(quick, formChip("明早 08:00", new View.OnClickListener() {
                @Override public void onClick(View v) { whenIn.setText(tomorrowMorningSpec()); }
            }));
            LinearLayout.LayoutParams qlp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            qlp.topMargin = dp(6);
            col.addView(quick, qlp);

            col.addView(formLabel("重复方式"));
            final String[] repeat = { isEdit ? safeRepeatType(existing[2]) : "once" };
            final int[] sel = { repeatIndex(repeat[0]) };
            final EditText intervalIn = new EditText(this);
            intervalIn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
            intervalIn.setTextColor(cText());
            intervalIn.setHint("间隔分钟数（≥1）");
            intervalIn.setText(String.valueOf(isEdit ? Math.max(1, parseIntSafe(existing[3])) : 60));
            final TextView onceChip = formChip("一次", null);
            final TextView dailyChip = formChip("每天", null);
            final TextView intervalChip = formChip("每 N 分钟", null);
            final TextView[] chips = { onceChip, dailyChip, intervalChip };
            View.OnClickListener pick = new View.OnClickListener() {
                @Override public void onClick(View v) {
                    sel[0] = (v == onceChip) ? 0 : (v == dailyChip) ? 1 : 2;
                    repeat[0] = (sel[0] == 0) ? "once" : (sel[0] == 1) ? "daily" : "interval";
                    paintFormChips(chips, sel[0]);
                    intervalIn.setVisibility(sel[0] == 2 ? View.VISIBLE : View.GONE);
                }
            };
            onceChip.setOnClickListener(pick);
            dailyChip.setOnClickListener(pick);
            intervalChip.setOnClickListener(pick);
            LinearLayout rep = new LinearLayout(this);
            rep.setOrientation(LinearLayout.HORIZONTAL);
            rep.addView(onceChip);
            addChipGap(rep, dailyChip);
            addChipGap(rep, intervalChip);
            col.addView(rep);
            paintFormChips(chips, sel[0]);
            intervalIn.setVisibility(sel[0] == 2 ? View.VISIBLE : View.GONE);
            col.addView(intervalIn);

            LinearLayout foot = new LinearLayout(this);
            foot.setOrientation(LinearLayout.HORIZONTAL);
            foot.setGravity(Gravity.END);
            TextView cancel = formChip("取消", new View.OnClickListener() {
                @Override public void onClick(View v) { dialog.dismiss(); }
            });
            cancel.setTextColor(0xFFCCCCCC);
            cancel.setBackground(roundBg(0x22FFFFFF, 12, 0, 0));
            TextView save = formChip("保存", new View.OnClickListener() {
                @Override public void onClick(View v) {
                    String text = textIn.getText().toString().trim();
                    if (text.isEmpty()) { showToast("请填任务内容"); return; }
                    String when = whenIn.getText().toString().trim();
                    if (when.isEmpty()) { showToast("请填触发时间"); return; }
                    int iv = leadingInt(intervalIn.getText().toString());
                    if ("interval".equals(repeat[0]) && iv <= 0) {
                        showToast("「每 N 分钟」需要填 ≥1 的分钟数");
                        return;
                    }
                    if (isEdit) {
                        // 编辑 = 取消旧闹钟 + 删旧行，再走同一条建任务链路（任务 id 变，闹钟按 id 注册）
                        cancelScheduledAlarm(existing[0]);
                        rewriteScheduledTasks(existing[0], null, true);
                        logSchedule("任务已编辑（旧条目先删）: " + existing[4]);
                    }
                    String resp = createScheduledTask(text, when, repeat[0], iv);
                    if (resp.contains("\"ok\":false")) {
                        String err = jsonField(resp, "error");
                        showToast("保存失败：" + (err.isEmpty() ? "时间已过，请填未来时刻" : err));
                        return;
                    }
                    logSchedule((isEdit ? "任务已保存: " : "任务已创建: ") + text + " · " + when + " · "
                            + ("daily".equals(repeat[0]) ? "每天"
                                    : "interval".equals(repeat[0]) ? ("每 " + iv + " 分钟") : "一次性"));
                    showToast(isEdit ? "已保存" : "已创建定时任务");
                    dialog.dismiss();
                    showScheduleManager();
                }
            });
            save.setTextColor(0xFFFFFFFF);
            save.setBackground(roundBg(0x3D9BD1FF, 12, 1, 0x669BD1FF));
            foot.addView(save);
            addChipGap(foot, cancel);
            LinearLayout.LayoutParams flp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            flp.topMargin = dp(16);
            col.addView(foot, flp);

            dialog.setView(sv);
            dialog.show();
        } catch (Throwable t) {
            Log.w(TAG, "showScheduleForm failed", t);
            showToast("打开表单失败: " + t.getMessage());
        }
    }

    // ============ 批次85-R2：定时任务管理（列表 / 倒计时 / 启停 / 立即执行 / 删除 / 最近记录）============

    /** 解析一行任务：taskId|triggerAt|repeatType|intervalMin|text[|on|off]（第 6 段缺省 = 启用）。 */
    private static String[] parseScheduledLine(String line) {
        if (line == null || line.trim().isEmpty()) return null;
        String[] p = new String[6];
        int start = 0;
        for (int k = 0; k < 4; k++) {
            int i = line.indexOf(0x7C, start);   // 0x7C = '|'
            if (i < 0) return null;
            p[k] = line.substring(start, i);
            start = i + 1;
        }
        String rest = line.substring(start);
        int bar = rest.indexOf(0x7C);
        if (bar >= 0) { p[4] = rest.substring(0, bar); p[5] = rest.substring(bar + 1).trim(); }
        else { p[4] = rest; p[5] = "on"; }
        if (p[5].isEmpty()) p[5] = "on";
        // 批次86-P0-1：历史行可能是转义文本（批次85 之前建的 5 条就是，真机实测字面渲染）→
        // 读出来即解码；展示与再次改写都会写回真实字符（文件自愈）。
        p[4] = unescapeJson(p[4]);
        return p;
    }

    private static String joinScheduledLine(String[] p) {
        long at = 0L;
        try { at = Long.parseLong(p[1].trim()); } catch (Exception ignored) {}
        int iv = 0;
        try { iv = Integer.parseInt(p[3].trim()); } catch (Exception ignored) {}
        String text = p[4] == null ? "" : p[4].replace("|", " ").replace("\n", " ");
        String flag = "off".equalsIgnoreCase(p[5]) ? "off" : "on";
        return p[0] + "|" + at + "|" + p[2] + "|" + iv + "|" + text + "|" + flag;
    }

    private List<String[]> readScheduledTaskLines() {
        List<String[]> out = new ArrayList<String[]>();
        try {
            File f = scheduledTasksFile();
            if (!f.exists()) return out;
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
            String line;
            while ((line = r.readLine()) != null) {
                String[] p = parseScheduledLine(line);
                if (p != null) out.add(p);
            }
            r.close();
        } catch (Throwable t) {
            Log.w(TAG, "readScheduledTaskLines error", t);
        }
        return out;
    }

    /** 同一 taskId 会因「重复任务到点后追加下一次」而出现多行 —— 归组后只保留最后一行。 */
    private List<String[]> latestScheduledTasks() {
        java.util.LinkedHashMap<String, String[]> map = new java.util.LinkedHashMap<String, String[]>();
        for (String[] p : readScheduledTaskLines()) {
            map.remove(p[0]);
            map.put(p[0], p);
        }
        return new ArrayList<String[]>(map.values());
    }

    private static boolean scheduledTaskEnabled(String[] p) {
        return !(p.length >= 6 && "off".equalsIgnoreCase(p[5]));
    }

    private static String scheduledRepeatLabel(String[] p) {
        int iv = 0;
        try { iv = Integer.parseInt(p[3].trim()); } catch (Exception ignored) {}
        if ("daily".equals(p[2])) return "每天";
        if ("interval".equals(p[2])) return "每 " + iv + " 分钟";
        return "一次性";
    }

    private static String fmtScheduleAt(long at) {
        return new java.text.SimpleDateFormat("MM-dd HH:mm", Locale.US).format(new Date(at));
    }

    private static String relativeFromNow(long at) {
        long d = at - System.currentTimeMillis();
        if (d <= 0) return "已过期 " + (-d / 60000L) + " 分钟";
        long m = d / 60000L;
        if (m < 60) return m + " 分钟后";
        if (m < 60 * 24) return (m / 60) + " 小时 " + (m % 60) + " 分钟后";
        return (m / (60 * 24)) + " 天后";
    }

    /**
     * 重写任务文件：先按 taskId 去重压缩（每个 taskId 只留最后一行），再对 targetId 执行「删除 / 更新为 keepNew」。
     * 去重顺带清掉历史长出来的重复行（重复任务每次到点都会追加一行）。
     */
    private boolean rewriteScheduledTasks(String targetId, String[] keepNew, boolean doRemove) {
        try {
            java.util.LinkedHashMap<String, String[]> map = new java.util.LinkedHashMap<String, String[]>();
            for (String[] p : readScheduledTaskLines()) {
                map.remove(p[0]);
                map.put(p[0], p);
            }
            if (targetId != null) {
                if (doRemove) map.remove(targetId);
                else if (keepNew != null) { map.remove(targetId); map.put(targetId, keepNew); }
            }
            StringBuilder sb = new StringBuilder();
            for (String[] p : map.values()) sb.append(joinScheduledLine(p)).append("\n");
            FileOutputStream fos = new FileOutputStream(scheduledTasksFile(), false);
            fos.write(sb.toString().getBytes("UTF-8"));
            fos.close();
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "rewriteScheduledTasks error", t);
            return false;
        }
    }

    /**
     * 批次88 修 D8：把**内存里**的整张任务表落盘（不做去重、不重读文件）。
     *
     * <p>与 {@link #rewriteScheduledTasks} 的分工：后者是「按 id 增删改一条」的读-改-写，
     * 会把调用方在内存里改过的字段丢掉；本方法是「调用方已把整表改好，直接覆盖写」，
     * 供「重排全部闹钟」「批量清理过期任务」这类整体操作使用。</p>
     */
    private boolean writeScheduledTasksAll(List<String[]> rows) {
        try {
            StringBuilder sb = new StringBuilder();
            if (rows != null) {
                for (String[] p : rows) {
                    if (p == null || p[0] == null || p[0].isEmpty()) continue;
                    sb.append(joinScheduledLine(p)).append("\n");
                }
            }
            FileOutputStream fos = new FileOutputStream(scheduledTasksFile(), false);
            fos.write(sb.toString().getBytes("UTF-8"));
            fos.close();
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "writeScheduledTasksAll error", t);
            return false;
        }
    }

    /** 取消某任务的闹钟（requestCode = taskId.hashCode()）。 */
    private void cancelScheduledAlarm(String taskId) {
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Intent i = new Intent(this, AlarmReceiver.class);
            android.app.PendingIntent pi = android.app.PendingIntent.getBroadcast(this, taskId.hashCode(), i,
                    android.app.PendingIntent.FLAG_NO_CREATE | android.app.PendingIntent.FLAG_IMMUTABLE);
            if (pi != null) { am.cancel(pi); pi.cancel(); }
        } catch (Throwable t) {
            Log.w(TAG, "cancelScheduledAlarm error", t);
        }
    }

    /** 注册/更新某任务的闹钟；triggerAt 已过时按 repeatType 顺延（一次性任务返回 0 = 不再注册）。 */
    private long registerScheduledAlarm(String taskId, String text, long triggerAt, String repeatType, int intervalMin) {
        long now = System.currentTimeMillis();
        long at = triggerAt;
        if (at <= now) {
            if ("interval".equals(repeatType) && intervalMin > 0) at = now + intervalMin * 60L * 1000L;
            else if ("daily".equals(repeatType)) { at = triggerAt + 24L * 3600L * 1000L; while (at <= now) at += 24L * 3600L * 1000L; }
            else return 0L;
        }
        try {
            android.app.AlarmManager am = (android.app.AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am == null) return 0L;
            Intent i = new Intent(this, AlarmReceiver.class);
            i.putExtra("task", text);
            i.putExtra("taskId", taskId);
            i.putExtra("repeatType", repeatType);
            i.putExtra("intervalMin", intervalMin);
            i.putExtra("triggerAt", at);
            android.app.PendingIntent pi = android.app.PendingIntent.getBroadcast(this, taskId.hashCode(), i,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            try {
                if (Build.VERSION.SDK_INT >= 21) {
                    Intent show = new Intent(this, MainActivity.class);
                    show.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    android.app.PendingIntent showPi = android.app.PendingIntent.getActivity(this, 1, show,
                            android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
                    am.setAlarmClock(new android.app.AlarmManager.AlarmClockInfo(at, showPi), pi);
                } else {
                    am.setExact(android.app.AlarmManager.RTC_WAKEUP, at, pi);
                }
            } catch (Throwable t) {
                if (Build.VERSION.SDK_INT >= 23) am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, at, pi);
                else am.setExact(android.app.AlarmManager.RTC_WAKEUP, at, pi);
            }
            return at;
        } catch (Throwable t) {
            Log.w(TAG, "registerScheduledAlarm error", t);
            return 0L;
        }
    }
    /**
     * 批次88 修 D7：严格解析「触发时间」字符串，非法时刻返回 null（**不再静默归一化**）。
     *
     * <p>支持三种绝对时刻格式（与表单提示一致）+ 相对秒数由调用方处理：
     * {@code HH:mm}（今天该时刻，已过则顺延到明天）、{@code yyyy-MM-dd HH:mm}、
     * {@code yyyy-MM-dd HH:mm:ss}。也兼容 {@code T} 分隔与结尾 {@code Z}。</p>
     *
     * <p>为什么必须严格：{@link java.text.SimpleDateFormat} 默认 lenient，会把
     * {@code "99:99"} 静默解析成次日 04:39（真机实测：建出「11 小时 20 分钟后」的任务），
     * 用户完全不知道时间填错了。这里 {@code setLenient(false)} + 显式范围校验，
     * 并把 {@code ParseException} 转成 null 由调用方给中文错误。</p>
     */
    private static Long parseScheduleWhenStrict(String raw) {
        if (raw == null) return null;
        String w = raw.trim().replace("T", " ").replace("Z", " ").trim();
        if (w.isEmpty()) return null;
        try {
            if (w.length() <= 5) {
                // HH:mm —— 先按严格格式解析，再显式校验范围（lenient=false 已能挡住 99:99，
                // 这里再加一层，避免不同 ROM 的 DateTimeFormatter 差异）
                String[] hm = w.split(":");
                if (hm.length != 2) return null;
                int hh = Integer.parseInt(hm[0].trim());
                int mm = Integer.parseInt(hm[1].trim());
                if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
                java.util.Calendar cal = java.util.Calendar.getInstance();
                cal.set(java.util.Calendar.HOUR_OF_DAY, hh);
                cal.set(java.util.Calendar.MINUTE, mm);
                cal.set(java.util.Calendar.SECOND, 0);
                cal.set(java.util.Calendar.MILLISECOND, 0);
                long at = cal.getTimeInMillis();
                if (at <= System.currentTimeMillis()) at += 24L * 3600L * 1000L; // 已过 → 明天
                return at;
            }
            java.text.SimpleDateFormat fmt;
            if (w.length() <= 16) {
                fmt = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US);
            } else {
                fmt = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US);
            }
            fmt.setLenient(false);
            return fmt.parse(w).getTime();
        } catch (Throwable t) {
            return null;
        }
    }

    /** 批次85-R2：取字符串前缀里的第一个整数（"60" / 60,"when":"3600" / 无数字 → 60 / 60 / 0）。 */
    private static int leadingInt(String s) {
        if (s == null) return 0;
        int i = 0, v = 0;
        while (i < s.length() && (s.charAt(i) < 0x30 || s.charAt(i) > 0x39)) i++;
        while (i < s.length() && s.charAt(i) >= 0x30 && s.charAt(i) <= 0x39) { v = v * 10 + (s.charAt(i) - 0x30); i++; }
        return v;
    }

    /**
     * 批次86-P0-1：解 JSON/JS 风格转义（反斜杠 + u 的四位十六进制转义、反斜杠 n / t / 引号 / 反斜杠 自身等）。
     *
     * <p>背景（真机实测）：定时任务管理页把任务文本渲染成**字面**的「反斜杠 u8bf7 反斜杠 u5206 5 …」
     * —— 上游 POST body 里中文已经是转义形式，而 {@code jsonField} 只按引号截串、不做解码
     * （双重转义）。取字段后统一解一次即可；输入里没有转义时原样返回（幂等）。
     * 认不出的转义**保留反斜杠原样输出**，避免把 Windows 路径这类正常文本改坏。</p>
     */
    private static String unescapeJson(String s) {
        if (s == null || s.isEmpty() || s.indexOf('\\') < 0) return s == null ? "" : s;
        StringBuilder out = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c != '\\' || i + 1 >= s.length()) { out.append(c); continue; }
            char n = s.charAt(++i);
            if (n == 'u' && i + 4 < s.length()) {
                int v = 0;
                boolean ok = true;
                for (int k = 1; k <= 4; k++) {
                    int d = Character.digit(s.charAt(i + k), 16);
                    if (d < 0) { ok = false; break; }
                    v = v * 16 + d;
                }
                if (ok) { out.append((char) v); i += 4; continue; }
            }
            switch (n) {
                case 'n': out.append('\n'); break;
                case 't': out.append('\t'); break;
                case 'r': out.append('\r'); break;
                case 'b': out.append('\b'); break;
                case 'f': out.append('\f'); break;
                case '/': out.append('/'); break;
                case '"': out.append('"'); break;
                case '\\': out.append('\\'); break;
                default: out.append('\\').append(n); break;
            }
        }
        return out.toString();
    }

    private String jsonField(String json, String key) {
        try {
            String k = "\"" + key + "\"";
            int i = json.indexOf(k);
            if (i < 0) return "";
            int c = json.indexOf(':', i + k.length());
            if (c < 0) return "";
            int q1 = json.indexOf('"', c + 1);
            if (q1 < 0) return "";
            int q2 = json.indexOf('"', q1 + 1);
            if (q2 < 0) return "";
            // 批次86-P0-1：引号串里可能还是转义形态（真机实测任务文本把中文渲染成字面转义）→ 解一次
            return unescapeJson(json.substring(q1 + 1, q2));
        } catch (Throwable t) {
            return "";
        }
    }

    /** 从 query 字符串里取字段值（title=..&text=..）。 */
    private String queryField(String q, String key) {
        try {
            String k = key + "=";
            int i = q.indexOf(k);
            if (i < 0) return "";
            int e = q.indexOf('&', i + k.length());
            if (e < 0) e = q.length();
            // 批次86-P0-1：query 形态同样可能带转义 → 与 jsonField 统一解码
            return unescapeJson(q.substring(i + k.length(), e).replace("+", " "));
        } catch (Throwable t) {
            return "";
        }
    }

    // ============ 批次 3 任务 2：无障碍掉线检测 + deep-link 引导 ============

    private static final String A11Y_NOTIFY_CHANNEL_ID = "dsh_a11y";
    /** 上一次观测到的无障碍运行状态（写在 dsh_prefs；缺省 = 未知 → 首次检测不误报）。 */
    private static final String PREF_A11Y_LAST_RUNNING = "a11y_last_running";

    /** 无障碍服务是否在系统「已启用的无障碍服务」列表里（Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES）。 */
    private boolean a11yEnabledInSecureSettings() {
        try {
            String enabled = Settings.Secure.getString(getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (enabled == null || enabled.isEmpty()) return false;
            ComponentName cn = new ComponentName(this, AccessibilityService.class);
            String flat = cn.flattenToString();          // com.deepseek.harness/com.deepseek.harness.AccessibilityService
            String shortFlat = cn.flattenToShortString(); // com.deepseek.harness/.AccessibilityService
            for (String part : enabled.split(":")) {
                String v = part.trim();
                if (v.equalsIgnoreCase(flat) || v.equalsIgnoreCase(shortFlat)) return true;
            }
            return false;
        } catch (Throwable t) {
            return false;
        }
    }

    /** 无障碍桥（默认 3181，端口取自 dsh_prefs/a11y_port）是否可用。 */
    private boolean a11yBridgeAlive() {
        HttpURLConnection c = null;
        try {
            int port = getSharedPreferences("dsh_prefs", MODE_PRIVATE).getInt("a11y_port", notifyPort() + 100);
            c = (HttpURLConnection) new URL("http://127.0.0.1:" + port + "/status").openConnection();
            c.setConnectTimeout(800);
            c.setReadTimeout(1200);
            c.setRequestProperty("X-DSH-Token", localToken());
            c.setRequestProperty("User-Agent", "dsh-a11y-probe");
            return c.getResponseCode() == 200;
        } catch (Throwable t) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /**
     * 批次 3 任务 2：无障碍掉线检测。判据 = setting 列表命中 ∪ 3181 桥可用（取或）。
     * 只在关键时机调用（引擎就绪 / App 回前台），<b>不引入常驻轮询</b>。
     * 仅在「上一次记录为开、本次为关」时发通知（首次运行状态未知 → 只记录不打扰），
     * 因此 force-stop 后 ROM 重置开关、用户再次打开 App 时正好命中该转变。
     */
    private void checkA11yAlive() {
        try {
            boolean running = a11yEnabledInSecureSettings() || a11yBridgeAlive();
            SharedPreferences p = getSharedPreferences("dsh_prefs", MODE_PRIVATE);
            boolean known = p.contains(PREF_A11Y_LAST_RUNNING);
            boolean prev = p.getBoolean(PREF_A11Y_LAST_RUNNING, false);
            if (known && prev && !running) {
                // 批次6：掉线时先尝试 root 自愈（阶段1实验证实可行：App 活着时 root 写回
                // secure 设置服务立即重绑）；自愈失败才发通知引导用户手动开启。
                boolean healed = false;
                if (rootAvailable() && !a11yEnabledInSecureSettings()) {
                    try {
                        ComponentName cn = new ComponentName(this, AccessibilityService.class);
                        Process pr = Runtime.getRuntime().exec(new String[]{"su", "-c",
                                "settings put secure enabled_accessibility_services " + cn.flattenToString()});
                        int rc = pr.waitFor();
                        try { pr.destroy(); } catch (Throwable ignored) {}
                        if (rc == 0) {
                            Process pr2 = Runtime.getRuntime().exec(new String[]{"su", "-c",
                                    "settings put secure accessibility_enabled 1"});
                            try { pr2.waitFor(); } finally { try { pr2.destroy(); } catch (Throwable ignored) {} }
                        }
                    } catch (Throwable t) {
                        Log.w(TAG, "a11y selfheal via checkA11yAlive failed", t);
                    }
                    // 给服务重绑留时间，再复测（最多等 6s）
                    for (int i = 0; i < 6 && !a11yBridgeAlive(); i++) {
                        try { Thread.sleep(1000); } catch (InterruptedException ignored) {}
                    }
                    healed = a11yEnabledInSecureSettings() || a11yBridgeAlive();
                    Log.i(TAG, "a11y selfheal attempt -> healed=" + healed);
                }
                if (!healed) {
                    Log.w(TAG, "a11y lost: was running, now off -> notify user");
                    postA11yNotification();
                } else {
                    Log.i(TAG, "a11y lost -> root selfheal succeeded");
                }
                running = healed;
            } else if (known && !prev && running) {
                Log.i(TAG, "a11y restored");
            }
            if (!known || prev != running) {
                p.edit().putBoolean(PREF_A11Y_LAST_RUNNING, running).apply();
            }
        } catch (Throwable t) {
            Log.w(TAG, "a11y check failed", t);
        }
    }

    /** 异步版（onResume 在主线程，探测要走 HTTP，不能阻塞主线程）。 */
    private void checkA11yAliveAsync() {
        new Thread(new Runnable() {
            @Override public void run() { checkA11yAlive(); }
        }, "a11y-check").start();
    }

    /** 无障碍掉线通知：点按直达系统「无障碍」设置页。无通知权限时静默失败，不影响主流程。 */
    private void postA11yNotification() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(A11Y_NOTIFY_CHANNEL_ID, "无障碍服务状态",
                        NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("无障碍服务被系统关闭时提醒重新开启（否则 AI 无法读屏/点击）");
                nm.createNotificationChannel(ch);
            }
            Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            android.app.PendingIntent pi = android.app.PendingIntent.getActivity(this, 2, i,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= 26) {
                b = new Notification.Builder(this, A11Y_NOTIFY_CHANNEL_ID);
            } else {
                b = new Notification.Builder(this).setPriority(Notification.PRIORITY_HIGH);
            }
            String text = "重启/强制停止后系统会重置无障碍开关，AI 的读屏与点击能力已失效。点此重新开启。";
            Notification n = b.setContentTitle("DeepSeek Harness 无障碍服务已关闭")
                    .setContentText(text)
                    .setStyle(new Notification.BigTextStyle().bigText(text))
                    .setSmallIcon(R.drawable.ic_launcher)
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .build();
            nm.notify(A11Y_NOTIFY_CHANNEL_ID.hashCode() & 0x7fffffff, n);
            Log.i(TAG, "a11y lost notification sent");
        } catch (Throwable t) {
            Log.w(TAG, "a11y notification failed", t);
        }
    }

    /** 批次 3 任务 2：/a11y-open-settings —— 直达系统「无障碍」设置页（供 AI 主动引导用户重开）。 */
    private String handleA11yOpenSettings() {
        try {
            Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            Log.i(TAG, "a11y settings opened by local bridge request");
            return "{\"ok\":true}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}";
        }
    }

    /**
     * 批次6：/a11y-selfheal —— root 自动重开无障碍服务（阶段1真机实验结论：可行）。
     * 实验（2026-09-12 Pixel 6 Pro）：① App 进程活着 + secure 设置被 ROM 清空 → root 写回
     * enabled_accessibility_services + accessibility_enabled=1 后服务立即重绑（dumpsys
     * Bound services 命中、3181 /status running=true），写回值不被 ROM 回收；
     * ② force-stop 后 ROM 立即清空设置且进程死亡——该场景无进程可自救，仍走通知/deep-link。
     * 行为：仅当 setting 列表里没有本服务且 3181 桥不可达时写回；写回后轮询重绑（最多 ~8s）。
     * root 不可用 / 写回失败 → ok:false（调用方回落到现有通知+deep-link 方案）。
     */
    private String handleA11ySelfheal() {
        try {
            boolean bySetting = a11yEnabledInSecureSettings();
            boolean byBridge = a11yBridgeAlive();
            if (bySetting || byBridge) {
                return "{\"ok\":true,\"healed\":false,\"running\":true,\"note\":\"a11y 已在运行，无需自愈\"}";
            }
            if (!rootAvailable()) {
                return "{\"ok\":false,\"healed\":false,\"running\":false,\"error\":\"无 root 通道（ROOT_AVAILABLE=0），无法自动重开，请走通知/deep-link 引导用户手动开启\"}";
            }
            ComponentName cn = new ComponentName(this, AccessibilityService.class);
            String flat = cn.flattenToString();
            String cmd1 = "settings put secure enabled_accessibility_services " + flat;
            String cmd2 = "settings put secure accessibility_enabled 1";
            boolean execOk = rootShell(cmd1) && rootShell(cmd2);
            if (!execOk) {
                return "{\"ok\":false,\"healed\":false,\"running\":false,\"error\":\"su 写回 secure 设置失败\"}";
            }
            // 轮询等待服务重绑（实验实测 ≤5s 内 Bound services 命中、桥恢复）
            boolean rebound = false;
            for (int i = 0; i < 8; i++) {
                try { Thread.sleep(1000); } catch (InterruptedException ignored) {}
                if (a11yBridgeAlive()) { rebound = true; break; }
            }
            Log.i(TAG, "a11y selfheal: wrote settings, rebound=" + rebound);
            if (rebound) {
                getSharedPreferences("dsh_prefs", MODE_PRIVATE)
                        .edit().putBoolean(PREF_A11Y_LAST_RUNNING, true).apply();
                return "{\"ok\":true,\"healed\":true,\"running\":true}";
            }
            return "{\"ok\":false,\"healed\":true,\"running\":false,\"error\":\"设置已写回但服务未在 8s 内重绑，请稍后重试或引导用户手动检查\"}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}";
        }
    }

    /** 用 su 执行一条命令（忽略输出，只看 exit==0）；超时 10s 防卡。
     *  批次23 S2：实例方法改静态（无实例状态，调用点不变）——包内薄包装
     *  {@link #rootShellForTaskReaper} 需要以静态门面暴露给 TaskReaper。 */
    private static boolean rootShell(String command) {
        Process p = null;
        try {
            p = Runtime.getRuntime().exec(new String[]{"su", "-c", command});
            final Process proc = p;
            Thread killer = new Thread(new Runnable() {
                @Override public void run() {
                    try { Thread.sleep(10000); } catch (InterruptedException ignored) {}
                    try { proc.destroy(); } catch (Throwable ignored) {}
                }
            }, "root-shell-killer");
            killer.setDaemon(true);
            killer.start();
            return p.waitFor() == 0;
        } catch (Throwable t) {
            Log.w(TAG, "rootShell failed: " + command, t);
            return false;
        } finally {
            if (p != null) try { p.destroy(); } catch (Throwable ignored) {}
        }
    }

    /**
     * 批次23 S2（指令 ②）：包内可见薄包装——TaskReaper 收养对账用它执行 su 可用性探测
     * （"true"）与 {@code kill -0 -&lt;pgid&gt;} 判活。rootShell 本体保持 private（boolean-only
     * 通道，设计文档冲突 4 的"带输出 su 通道"另行立项），仅加静态门面收窄暴露面：不改签名、
     * 不改语义、零重构。调用约定（TaskReaper.reconcilePgid）：先探测 "true" 成功才发 kill -0，
     * 避免 su 失败（同样返回 false）被误判成进程组已死。
     */
    static boolean rootShellForTaskReaper(String command) {
        return rootShell(command);
    }

    /** 从 JSON body 里取数字型字段（"key": 12345，无引号值；jsonField 只认字符串值）。
     *  注意冒号后可能带空格（JSON.stringify 无空格、其他客户端常有），必须先跳过。 */
    private String jsonNumField(String json, String key) {
        try {
            int i = json.indexOf("\"" + key + "\"");
            if (i < 0) return "";
            int colon = json.indexOf(':', i + key.length() + 2);
            if (colon < 0) return "";
            int s = colon + 1;
            while (s < json.length() && json.charAt(s) == ' ') s++;
            int e = s;
            while (e < json.length() && (Character.isDigit(json.charAt(e)) || json.charAt(e) == '-')) e++;
            return e > s ? json.substring(s, e) : "";
        } catch (Throwable t) {
            return "";
        }
    }

    // ============ 批次23 S1：Task DB 桥路由（D8 S1；TaskStore/KeepAlivePolicy/TaskReaper 详见各类） ============

    /**
     * 处理 /task/*：App 侧任务注册表（TaskStore，filesDir/tasks/tasks.json）的读写桥。
     * <ul>
     *   <li>鉴权：沿用本桥既有 X-DSH-Token 校验（本方法在 401 分支之后才被分发到，鉴权逻辑零改动）；
     *       错误写回沿用相邻 handler 惯例：catch Throwable → {"ok":false,"error":...}（引号转义）；</li>
     *   <li>GET  /task/list → {"ok":true,"activeCount":N,"tasks":[...]}；</li>
     *   <li>GET  /task/get?id= → {"ok":true,"task":{...}} 或 {"ok":false,"error":"not found"}；</li>
     *   <li>POST /task/upsert（body 单条任务 JSON，id 缺省自动生成）→ 幂等 upsert（批次23 S2
     *       已接线：插件 startChrootJob 成功后上报，含 pgid/session_dir，S2 指令 ①）；</li>
     *   <li>POST /task/finish?id=&exit=&finishedAt=&state= → markFinished（exit=0→COMPLETED 否则
     *       FAILED；显式 state 如 kill 后补 CANCELLED 优先，D4）；query 优先、缺参回退 body 字段，
     *       与 /usage?days、/wakelock timeout_ms 的双通道取参惯例一致。</li>
     * </ul>
     * 最小接线（D5）：list/upsert 后 TaskReaper.ensure（仅活跃任务时建线程）；finish 后 nudge
     * （终态落库尽快走 RELEASE 防抖判定）。S1 刻意不做 LocalBridge 抽取（路由内联，重构另行立项）。
     */
    private String handleTaskRequest(String method, String rawPath, String body) {
        try {
            String p = rawPath;
            int qi = p.indexOf('?');
            if (qi >= 0) p = p.substring(0, qi);
            TaskStore store = TaskStore.get(this);
            if (p.equals("/task/list")) {
                String resp = store.listJson();
                // list 是插件的观察入口：顺带 ensure Reaper（遗留 RUNNING 任务的下一次重建机会，S1 最小接线）
                TaskReaper.ensure(this);
                return resp;
            }
            if (p.equals("/task/get")) {
                String id = queryField(rawPath, "id");
                if (id.isEmpty()) id = jsonField(body, "id");
                if (id.isEmpty()) return "{\"ok\":false,\"error\":\"缺少 id\"}";
                return store.getJson(id);
            }
            if (p.equals("/task/upsert")) {
                if (!"POST".equals(method)) return "{\"ok\":false,\"error\":\"upsert 需 POST\"}";
                String resp = store.upsertJson(body);
                TaskReaper.ensure(this); // 注册 RUNNING 任务后确保 Reaper 存活（仅活跃任务时存在，D5）
                return resp;
            }
            if (p.equals("/task/finish")) {
                if (!"POST".equals(method)) return "{\"ok\":false,\"error\":\"finish 需 POST\"}";
                String id = queryField(rawPath, "id");
                String exit = queryField(rawPath, "exit");
                String finishedAt = queryField(rawPath, "finishedAt");
                String state = queryField(rawPath, "state");
                if (id.isEmpty()) id = jsonField(body, "id");
                if (exit.isEmpty()) exit = jsonNumField(body, "exit");
                if (finishedAt.isEmpty()) finishedAt = jsonNumField(body, "finishedAt");
                if (state.isEmpty()) state = jsonField(body, "state");
                if (id.isEmpty()) return "{\"ok\":false,\"error\":\"缺少 id\"}";
                long exitCode = 0;
                long finAt = System.currentTimeMillis();
                try { if (!exit.isEmpty()) exitCode = Long.parseLong(exit.trim()); } catch (Exception ignored) {}
                try { if (!finishedAt.isEmpty()) finAt = Long.parseLong(finishedAt.trim()); } catch (Exception ignored) {}
                String resp = store.markFinishedJson(id, exitCode, finAt, state);
                TaskReaper.nudge(); // 幂等无害：即使 finish 失败也只是让 Reaper 提前走一次判定
                return resp;
            }
            return "{\"ok\":false,\"error\":\"未知 task 路由（list/get/upsert/finish）\"}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}";
        }
    }

    /** 处理 /confirm：高危操作确认请求。body {title,text,timeoutSec} → 发高优先级通知（允许/拒绝）。
     *  插件随后轮询 /confirm/result?id=；超时未确认由看护线程按拒绝写入（fail-closed）。 */
    private String handleConfirmRequest(String raw) {
        // 批次 3 清账：审批门关闭（dsh_prefs/confirm_gate=false，默认）时 /confirm 直接不受理。
        // 旧实现只看 spawnNode 注入的 env（APP_CONFIRM_DANGEROUS），路由本身没有开关，
        // 关闭状态下仍会受理请求、发确认通知、占用一次确认 id —— 属早先记录的小缺口。
        if (!getSharedPreferences("dsh_prefs", MODE_PRIVATE).getBoolean("confirm_gate", false)) {
            return "{\"ok\":false,\"error\":\"审批门已关闭（dsh_prefs/confirm_gate=false），/confirm 不受理\"}";
        }
        try {
            String title = jsonField(raw, "title");
            String text = jsonField(raw, "text");
            int timeoutSec = 60;
            try {
                String s = jsonField(raw, "timeoutSec");
                if (!s.isEmpty()) timeoutSec = Math.max(5, Math.min(300, Integer.parseInt(s.trim())));
            } catch (Exception ignored) {}
            if (title.isEmpty() && text.isEmpty()) {
                return "{\"ok\":false,\"error\":\"缺少 title/text\"}";
            }
            byte[] buf = new byte[4];
            new SecureRandom().nextBytes(buf);
            StringBuilder sb = new StringBuilder(8);
            for (byte b : buf) {
                sb.append(Character.forDigit((b >> 4) & 0xf, 16));
                sb.append(Character.forDigit(b & 0xf, 16));
            }
            final String id = sb.toString();
            ConfirmStore.create(id, title, text);
            final int timeout = timeoutSec;
            postConfirmNotification(id, title.isEmpty() ? "AI 请求确认高危操作" : title,
                    text.isEmpty() ? "(无描述)" : text, timeoutSec);
            // 超时看护线程：到期仍 pending → 按拒绝写入（resolve 只覆盖 pending，不会覆盖用户点击）
            new Thread(new Runnable() {
                @Override public void run() {
                    try { Thread.sleep(timeout * 1000L); } catch (InterruptedException ignored) {}
                    ConfirmStore.resolve(id, false);
                }
            }, "confirm-watchdog-" + id).start();
            Log.i(TAG, "confirm requested: id=" + id + " title=" + title);
            return "{\"ok\":true,\"id\":\"" + id + "\",\"timeoutSec\":" + timeoutSec + "}";
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"" + String.valueOf(t.getMessage()).replace("\"", "'") + "\"}";
        }
    }

    /** 处理 /confirm/result：插件轮询审批结果。status=pending|allowed|denied；未知 id=expired。
     *  id 兼容两种传递：URL query（?id=）与 POST JSON body（插件 appPost 走 body）。 */
    private String handleConfirmResult(String rawPath, String body) {
        String id = queryField(rawPath, "id");
        if (id.isEmpty()) id = jsonField(body == null ? "" : body, "id");
        ConfirmStore.Entry e = ConfirmStore.get(id);
        if (e == null) return "{\"ok\":true,\"status\":\"expired\"}";
        return "{\"ok\":true,\"status\":\"" + e.status + "\"}";
    }

    /** 发高优先级确认通知（带「允许/拒绝」按钮，timeoutSec 后自动消失）。 */
    private void postConfirmNotification(String id, String title, String text, int timeoutSec) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CONFIRM_CHANNEL_ID, "AI 高危操作确认",
                    NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("AI 请求执行敏感操作（装/卸应用、改系统设置、特权命令）时的确认通知");
            nm.createNotificationChannel(ch);
        }
        int nid = ("confirm-" + id).hashCode() & 0x7fffffff;
        Intent allow = new Intent(this, ConfirmReceiver.class)
                .setAction(ConfirmReceiver.ACTION_ALLOW)
                .putExtra("id", id).putExtra("nid", nid);
        Intent deny = new Intent(this, ConfirmReceiver.class)
                .setAction(ConfirmReceiver.ACTION_DENY)
                .putExtra("id", id).putExtra("nid", nid);
        android.app.PendingIntent piAllow = android.app.PendingIntent.getBroadcast(this, nid,
                allow, android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
        android.app.PendingIntent piDeny = android.app.PendingIntent.getBroadcast(this, nid + 1,
                deny, android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            b = new Notification.Builder(this, CONFIRM_CHANNEL_ID);
        } else {
            b = new Notification.Builder(this).setPriority(Notification.PRIORITY_HIGH);
        }
        Notification n = b.setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setSmallIcon(R.drawable.ic_launcher)
                .addAction(0, "允许", piAllow)
                .addAction(0, "拒绝", piDeny)
                .setAutoCancel(true)
                .setTimeoutAfter(timeoutSec * 1000L)
                .build();
        nm.notify(nid, n);
        Log.i(TAG, "confirm notification sent: id=" + id);
    }

    /** 发一条 AI 通知（仅需 POST_NOTIFICATIONS，无需 Shizuku/root）。 */
    private void postNotification(String title, String text) {        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(NOTIFY_CHANNEL_ID, NOTIFY_CHANNEL_NAME,
                        NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("AI 任务完成/需要你关注时推送");
                nm.createNotificationChannel(ch);
            }
            Intent i = new Intent(this, MainActivity.class);
            i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            android.app.PendingIntent pi = android.app.PendingIntent.getActivity(this, 1, i,
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= 26) {
                b = new Notification.Builder(this, NOTIFY_CHANNEL_ID);
            } else {
                b = new Notification.Builder(this);
            }
            Notification n = b.setContentTitle(title)
                    .setContentText(text)
                    .setSmallIcon(R.drawable.ic_launcher)
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .build();
            int id = (int) (System.currentTimeMillis() & 0x7fffffff);
            nm.notify(id, n);
            Log.i(TAG, "AI notification sent: " + title);
        } catch (Throwable t) {
            Log.w(TAG, "post notification failed", t);
        }
    }

    // 探测外部公共目录是否可写（不需要"所有文件访问"时也能降级内部）
    private boolean externalDshrootWritable(File externalRoot) {
        try {
            if (!externalRoot.exists() && !externalRoot.mkdirs()) return false;
            File probe = new File(externalRoot, ".probe");
            if (!probe.createNewFile()) return false;
            probe.delete();
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "external dshroot not writable, fallback to internal", t);
            return false;
        }
    }

    private String readAssetText(String asset) throws IOException {
        InputStream in = getAssets().open(asset);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[4096];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        in.close();
        return new String(out.toByteArray(), "UTF-8");
    }

    private String readFileText(File f) throws IOException {
        FileInputStream in = new FileInputStream(f);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[4096];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        in.close();
        return new String(out.toByteArray(), "UTF-8");
    }

    private String builtinDshrootRevision() {
        try {
            return readAssetText("dshroot_revision.txt").trim();
        } catch (Throwable t) {
            Log.w(TAG, "read dshroot revision failed", t);
            return "";
        }
    }

    // v1.5.3：dshroot 版本检查统一以「基目录」为单位——外部模式传 /sdcard/DeepSeekHarness，
    // 内部模式传 files/payload（内部 dshroot 位于 payload/dshroot，路径拼接一致）。
    private String dshrootRevisionAt(File dshrootBase) {
        File revFile = new File(dshrootBase, "dshroot/REVISION");
        try {
            return revFile.exists() ? readFileText(revFile).trim() : "";
        } catch (Throwable t) {
            return "";
        }
    }

    private boolean dshrootRevisionChanged(File dshrootBase) {
        String builtin = builtinDshrootRevision();
        String external = dshrootRevisionAt(dshrootBase);
        return !builtin.isEmpty() && !builtin.equals(external);
    }

    // dshroot 是否需要补齐：REVISION 不匹配（重装）或缺完成标记（解压被打断）。
    private boolean dshrootNeedsSync(File dshrootBase) {
        if (dshrootRevisionChanged(dshrootBase)) return true;
        File complete = new File(dshrootBase, "dshroot/" + DSHROOT_COMPLETE);
        return !complete.exists();
    }

    // v1.5.2 慢启动修复：是否必须走全量补齐（扫描 2 万+ 文件）。
    // 仅两种情况需要：① .complete 缺失（上次解压被打断，缺文件）② 内核版本变化（新内核新增包文件）。
    // 同内核升级（REVISION 变化但内容几乎不变）→ false → 走快速同步，避免真机外部存储 FUSE 上
    // 2 万+ 次 stat 造成的 50-60s 慢启动（模拟器宿主机磁盘快，测不出）。
    private boolean dshrootNeedsFullSync(File dshrootBase) {
        File complete = new File(dshrootBase, "dshroot/" + DSHROOT_COMPLETE);
        if (!complete.exists()) return true;
        return dshKernelChanged(dshrootBase);
    }

    // 对比 dshroot 的 DSH 内核版本与 APK 内置版本（build.sh 写入 dshroot_kernel_version.txt）。
    // 版本不同 → 内核升级（如 rc.6 → rc.2）→ 新增包文件必须补齐，否则引擎起不来。
    private boolean dshKernelChanged(File dshrootBase) {
        try {
            String builtin = readAssetText("dshroot_kernel_version.txt").trim();
            if (builtin.isEmpty()) return true; // 无版本标记（旧 APK）→ 保守走全量
            File pkg = new File(dshrootBase, "dshroot/lib/node_modules/@deepseek-ai/dsh/package.json");
            if (!pkg.exists()) return true;
            return !readFileText(pkg).contains("\"version\":\"" + builtin + "\"");
        } catch (Throwable t) {
            return true; // 读不到 → 保守全量
        }
    }

    private void writeDshrootComplete(File dshrootBase) {
        File complete = new File(dshrootBase, "dshroot/" + DSHROOT_COMPLETE);
        try {
            FileOutputStream fos = new FileOutputStream(complete);
            fos.write(builtinDshrootRevision().getBytes("UTF-8"));
            fos.close();
        } catch (Throwable t) {
            Log.w(TAG, "write dshroot complete marker failed", t);
        }
    }

    // ============ 壳/payload 分离（v1.8.5）：轻壳开发模式 ============

    private static final String EXT_PAYLOAD_ZIP = "DeepSeekHarness/payload.zip";

    /** assets 是否带 payload（轻壳构建 BUILD_LITE_SHELL=1 时没有）。 */
    private boolean assetsHasPayload() {
        try {
            // 必须直接读 assets（不能用 openPayloadStream——轻壳下它回退外部文件，永远 true）
            java.io.InputStream in = getAssets().open("payload.zip");
            in.close();
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /** 外部 payload.zip（/sdcard/DeepSeekHarness/payload.zip）指纹：size+mtime。 */
    private String externalPayloadFingerprint() {
        try {
            File f = new File(Environment.getExternalStorageDirectory(), EXT_PAYLOAD_ZIP);
            Log.i(TAG, "lite-shell ext payload probe: " + f.getAbsolutePath()
                    + " exists=" + f.exists() + " isFile=" + f.isFile()
                    + " canRead=" + f.canRead() + " len=" + (f.isFile() ? f.length() : -1));
            if (!f.isFile()) return null;
            return f.length() + "-" + f.lastModified();
        } catch (Throwable t) {
            Log.w(TAG, "lite-shell ext payload probe failed", t);
            return null;
        }
    }

    // ===== 批次13 A1：全量 APK 指纹跳过解压 =====

    /** APK 指纹 = base APK(sourceDir) 的 (length,lastModified,versionCode)。
     *  APK 更新/重装后必然变化 → 回退完整补丁路径；取不到返回 null（视为不命中）。 */
    private String apkPayloadFingerprint() {
        try {
            String src = getApplicationInfo() != null ? getApplicationInfo().sourceDir : null;
            if (src == null || src.isEmpty()) return null;
            File apk = new File(src);
            if (!apk.isFile()) return null;
            int vcode = 0;
            try {
                android.content.pm.PackageInfo pi =
                        getPackageManager().getPackageInfo(getPackageName(), 0);
                vcode = pi.versionCode;
            } catch (Throwable ignored) {
            }
            return apk.length() + "-" + apk.lastModified() + "-" + vcode;
        } catch (Throwable t) {
            Log.w(TAG, "apk fingerprint failed", t);
            return null;
        }
    }

    /** 批次13 A1：内部 payload 是否「守卫齐全」可直接复用：
     *  .extracted/.complete 标记、REVISION 与 APK 内置一致、关键文件（bionic node、glibc
     *  wrapper、glibc node、dshroot bin.js、dshhome cordis.patch.yml——路径均按代码实际
     *  拼接核对）全部在位。任一不满足 → 返回 false，走现行 internal-patch/dshroot 同步
     *  （幂等补齐）；glibc 产物缺失自动本次回退 bionic 的安全网不受影响。 */
    private boolean internalPayloadReady(File payload) {
        try {
            if (!new File(payload, ".extracted").isFile()) return false;
            if (!new File(payload, "dshroot/" + DSHROOT_COMPLETE).isFile()) return false;
            if (dshrootRevisionChanged(payload)) return false;
            String[] must = {
                    "runtime/bin/node",
                    "runtime/bin/node.glibc",
                    "runtime-glibc/bin/node",
                    "dshroot/" + REL_BINJS,
                    "dshhome/cordis.patch.yml"
            };
            for (String p : must) {
                if (!new File(payload, p).isFile()) return false;
            }
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    /** 打开 payload.zip 输入流：assets 优先（发布包），轻壳回退外部 /sdcard/DeepSeekHarness/payload.zip。 */
    private java.io.InputStream openPayloadStream() throws IOException {
        try {
            return getAssets().open("payload.zip");
        } catch (IOException assetsMissing) {
            File ext = new File(Environment.getExternalStorageDirectory(), EXT_PAYLOAD_ZIP);
            if (ext.isFile()) {
                Log.i(TAG, "lite-shell: payload from " + ext.getAbsolutePath());
                return new java.io.FileInputStream(ext);
            }
            throw assetsMissing;
        }
    }

    // 批次15 T3（#9b）：internal-patch 原子性——以下三个关键启动二进制先写临时文件再
    // rename 原子替换（其余条目保持直写不变，不动整体结构）。此前直接写最终路径：
    // 解压中途被杀（force-stop/断电）会留下半截 node，而 spawnNode/internalPayloadReady
    // 的 isFile() 检查照常通过 → exec 失败（glibc 连续 3 次失败误降级 bionic / 引擎起不来），
    // 且 fpSkip 命中时补丁块被跳过、半截文件无人补齐。改为同目录 temp + rename(2)：
    // 最终路径要么是旧完整文件、要么是新完整文件；被杀只可能留下 *.dsh-tmp 残片，
    // 下次运行同名条目总是 force-overwrite 重写该临时文件，天然幂等。
    private static final java.util.Set<String> ATOMIC_REPLACE_ENTRIES = new java.util.HashSet<>(java.util.Arrays.asList(
            "runtime/bin/node", "runtime/bin/node.glibc", "runtime-glibc/bin/node"));

    private void extractPayload(File destInternal, File externalRoot, String mode) throws IOException {
        // mode: "internal" = 只解压内部条目（runtime/bin/dshhome/rish，不含 dshroot）；
        //       "dshroot"  = 只解压 dshroot 条目（外部优先，回退内部）；
        //       "dshroot-fast" = 快速同步：只更新 REVISION + 官方白名单文件，不 stat 已有文件
        //                        （同内核升级用，避免真机 FUSE 2 万+ 次 stat 造成慢启动）。
        final boolean fast = "dshroot-fast".equals(mode);
        final boolean internalPatch = "internal-patch".equals(mode);
        final boolean internalOnly = "internal".equals(mode) || internalPatch;
        final boolean dshrootOnly = "dshroot".equals(mode) || fast;
        if (!destInternal.exists() && !destInternal.mkdirs()) throw new IOException("mkdir failed: " + destInternal);
        long tExtract0 = android.os.SystemClock.elapsedRealtime(); // 批次13 P0：extract 起始时刻
        // 批次13 B1：消除 countPayloadEntries 全量预扫（顺序 zip 流上跳过条目也须完整 inflate，
        // 预扫等于多付一整遍）。进度改按「已消费压缩字节 / zip 总长」——包一层 CountingInputStream，
        // APK 体积与构建脚本零变化。快速同步（fast）与原逻辑一致不显示进度条。
        long totalBytes = fast ? -1 : payloadZipLength();
        lastProgressPct = 0;
        if (totalBytes > 0) setProgress(0, "正在解压运行时 0/" + (totalBytes >> 20) + " MB…");
        byte[] buf = new byte[128 * 1024];
        CountingInputStream cin = new CountingInputStream(openPayloadStream());
        ZipInputStream zis = new ZipInputStream(cin);
        ZipEntry e;
        int written = 0;
        while ((e = zis.getNextEntry()) != null) {
            String name = e.getName();
            if (e.isDirectory() || name.startsWith("__MACOSX/") || name.startsWith("META-INF/")) { zis.closeEntry(); continue; }
            boolean isDshroot = name.startsWith("dshroot/");
            if (dshrootOnly && !isDshroot) { zis.closeEntry(); continue; }
            if (internalOnly && isDshroot) { zis.closeEntry(); continue; }

            File target;
            boolean skipIfExists = false;
            if (isDshroot && externalRoot != null) {
                target = new File(externalRoot, name);
                // 外部 dshroot：REVISION 与官方白名单路径总是覆盖；其他已有文件跳过（保留 AI 运行时修改）。
                if (fast) {
                    // 快速同步（内外通用）：只处理 REVISION + 白名单文件，其余条目直接跳过（不做 exists() stat）
                    if (!name.equals("dshroot/REVISION") && !isForceOverwrite(name)) { zis.closeEntry(); continue; }
                    skipIfExists = false;
                } else {
                    skipIfExists = !name.equals("dshroot/REVISION") && !isForceOverwrite(name) && target.exists();
                }
            } else {
                target = new File(destInternal, name);
                if (fast) {
                    // 快速同步：内部 dshroot 也只更新 REVISION + 白名单文件（同内核升级，避免全量重写）
                    if (!name.equals("dshroot/REVISION") && !isForceOverwrite(name)) { zis.closeEntry(); continue; }
                    skipIfExists = false;
                } else if (internalPatch) {
                    // 覆盖升级补齐：内部运行时只写缺失文件（新增文件如 runtime/bin/rg），白名单路径总是覆盖。
                    // v1.9.0 真机修复（2026-09-11）：runtime* 与 bin/ 是版本锁定的官方文件，
                    // 必须总是覆盖——否则升级后旧 wrapper/旧二进制残留（实证：旧 node.glibc
                    // 留在设备上，新构建的修复从未生效）。
                    skipIfExists = !isForceOverwrite(name) && target.exists()
                            && !name.startsWith("runtime/")
                            && !name.startsWith("runtime-glibc/")
                            && !name.startsWith("bin/");
                }
            }

            if (skipIfExists) {
                zis.closeEntry();
                updateProgressBytes(cin.consumed(), totalBytes);
                continue;
            }

            File parent = target.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("mkdir failed: " + parent);
            // 批次15 T3：关键二进制原子写（见 ATOMIC_REPLACE_ENTRIES 注释）。
            boolean atomic = ATOMIC_REPLACE_ENTRIES.contains(name);
            File writeTarget = atomic ? new File(parent, target.getName() + ".dsh-tmp") : target;
            FileOutputStream fos = new FileOutputStream(writeTarget);
            int n;
            while ((n = zis.read(buf)) > 0) fos.write(buf, 0, n);
            if (atomic) {
                // 断电级持久化：仅这三个文件付 sync 代价（internal-patch 只在 APK 更新/
                // 守卫失效时才重写它们）。force-stop（进程被杀）场景 rename 本身已足够。
                fos.getFD().sync();
            }
            fos.close();
            if (atomic) {
                if (!writeTarget.renameTo(target)) {
                    writeTarget.delete();
                    throw new IOException("atomic rename failed: " + target);
                }
            }
            zis.closeEntry();
            written++;
            updateProgressBytes(cin.consumed(), totalBytes);
        }
        zis.close();
        // 批次10d（#30）启动埋点：payload 就绪（首次 extractPayload 返回处；多次解压只记第一次完成）
        if (stPayload == 0) stPayload = android.os.SystemClock.elapsedRealtime();
        // 批次13 P0：extract 起止埋点（mode 粒度耗时），归因 payload 段的遍数组成
        long dtMs = android.os.SystemClock.elapsedRealtime() - tExtract0;
        stExtractLog.append(stExtractLog.length() > 0 ? ";" : "").append(mode).append('=')
                .append(dtMs).append("ms/").append(written);
        Log.i(TAG, "extracted " + written + " entries (external=" + (externalRoot != null) + ", mode=" + mode + ")");
        Log.i(TAG, "extract-timing: mode=" + mode + " durationMs=" + dtMs + " written=" + written);
    }

    // 判断某条目是否属于官方强制覆盖白名单（外部 dshroot 也随 APK 更新）。
    private boolean isForceOverwrite(String name) {
        for (String p : FORCE_OVERWRITE_PREFIXES) {
            if (name.startsWith(p)) return true;
        }
        return false;
    }

    // dshhome 里随 APK 更新的官方配置文件（凭证 .credentials.yaml、会话数据 storages/ 等不在内）。
    private static final String[] DSHHOME_CONFIG_PATHS = {
        "dshhome/cordis.patch.yml",
        // 批次23：settings.yaml 移出覆盖清单——llm-pi-ai 启用后用户添加的模型提供方写在此文件，
        // 属用户数据；随 APK 升级整文件覆盖会抹掉已配置的 provider（凭证本就不在清单内）。
        "dshhome/profiles/web/cordis.patch.yml",
        "dshhome/profiles/web/cordis.yml",
        "dshhome/profiles/web/package.json",
        "dshhome/profiles/web/pnpm-workspace.yaml"
    };

    // 重装后把 dshhome 的官方配置文件从 payload.zip 覆盖到内部（凭证/会话保留）。
    private void refreshInternalConfig(File payload) throws IOException {
        byte[] buf = new byte[128 * 1024];
        InputStream in = openPayloadStream();
        ZipInputStream zis = new ZipInputStream(in);
        ZipEntry e;
        int updated = 0;
        while ((e = zis.getNextEntry()) != null) {
            String name = e.getName();
            boolean isConfig = false;
            for (String p : DSHHOME_CONFIG_PATHS) {
                if (name.equals(p)) { isConfig = true; break; }
            }
            if (!isConfig) { zis.closeEntry(); continue; }
            File target = new File(payload, name);
            File parent = target.getParentFile();
            if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("mkdir failed: " + parent);
            FileOutputStream fos = new FileOutputStream(target);
            int n;
            while ((n = zis.read(buf)) > 0) fos.write(buf, 0, n);
            fos.close();
            zis.closeEntry();
            updated++;
        }
        zis.close();
        Log.i(TAG, "refreshed " + updated + " dshhome config files");
    }

    // ===== 批次13 B1：字节进度（已消费压缩字节 / zip 总长），替代 countPayloadEntries 全量预扫 =====

    // 进度节流：同一百分比不重复 post UI（setProgress 内部 ui.post）。
    private int lastProgressPct = -1;

    /** payload.zip 总长（进度条分母）：assets 未压缩存储用 openFd 取（build.sh `-0 zip`）；
     *  轻壳回退外部文件 length()；取不到返回 -1（此时不显示进度，仅保留前进感日志）。 */
    private long payloadZipLength() {
        try {
            android.content.res.AssetFileDescriptor fd = getAssets().openFd("payload.zip");
            long len = fd.getLength();
            fd.close();
            if (len > 0) return len;
        } catch (Throwable ignored) {
        }
        try {
            File ext = new File(Environment.getExternalStorageDirectory(), EXT_PAYLOAD_ZIP);
            if (ext.isFile()) return ext.length();
        } catch (Throwable ignored) {
        }
        return -1;
    }

    /** 进度推进：按已消费压缩字节换算百分比（pct 变化才发 UI），MB 数保留前进感文案。 */
    private void updateProgressBytes(long consumed, long totalBytes) {
        if (totalBytes <= 0) return;
        long pct = consumed * 100L / totalBytes;
        if (pct > 100) pct = 100;
        if ((int) pct == lastProgressPct) return;
        lastProgressPct = (int) pct;
        setProgress((int) pct, "正在解压运行时 " + (consumed >> 20) + "/" + (totalBytes >> 20) + " MB…");
    }

    /** 统计已消费压缩字节的流包装（B1）。ZipInputStream 顺序读过的字节即真实进度。 */
    private static class CountingInputStream extends java.io.FilterInputStream {
        private long count = 0;
        CountingInputStream(InputStream in) { super(in); }
        long consumed() { return count; }
        @Override public int read() throws IOException {
            int r = super.read();
            if (r >= 0) count++;
            return r;
        }
        @Override public int read(byte[] b) throws IOException {
            int r = super.read(b);
            if (r > 0) count += r;
            return r;
        }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            int r = super.read(b, off, len);
            if (r > 0) count += r;
            return r;
        }
        @Override public long skip(long n) throws IOException {
            long r = super.skip(n);
            if (r > 0) count += r;
            return r;
        }
    }

    private void applyLinks(File payload) throws IOException {
        File lib = new File(payload, "runtime/lib");
        File linksFile = new File(lib, "LINKS.txt");
        if (!linksFile.exists()) return;
        BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(linksFile), "UTF-8"));
        String line;
        int n = 0;
        while ((line = r.readLine()) != null) {
            line = line.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] parts = line.split("\\t+");
            if (parts.length < 2) continue;
            String linkName = parts[0].trim();
            String target = parts[1].trim();
            File link = new File(lib, linkName);
            File src = new File(lib, target);
            if (!link.exists() && src.exists()) {
                try {
                    Os.link(src.getAbsolutePath(), link.getAbsolutePath());
                    n++;
                } catch (ErrnoException e1) {
                    try {
                        Os.symlink(target, link.getAbsolutePath());
                        n++;
                    } catch (ErrnoException e2) {
                        try { copyFile(src, link); n++; } catch (IOException e3) {
                            Log.w(TAG, "link failed " + linkName, e3);
                        }
                    }
                }
            }
        }
        r.close();
    }

    private void copyFile(File src, File dst) throws IOException {
        FileInputStream in = new FileInputStream(src);
        FileOutputStream out = new FileOutputStream(dst);
        byte[] b = new byte[128 * 1024];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        out.close();
        in.close();
    }

    private void setExecutables(File payload) {
        // v1.9.0：补 glibc runtime（wrapper/官方 node/musl 工具）。busybox 已随批次15
        // （#9a）从 payload 移除（app 域 seccomp 杀 + 全仓无调用方），不再补位；
        // 升级设备上的残留 busybox 不受影响（本就不进 app 域 PATH 前段）。
        String[] execs = {"runtime/bin/node", "runtime/bin/node.glibc", "bin/bash",
                "runtime/bin/rg", "runtime/bin/curl",
                "runtime-glibc/bin/node", "runtime-glibc/bin/rg",
                "runtime-glibc/bin/curl", "runtime-glibc/bin/mnemon",
                // v1.9.0 真机修复（2026-09-11）：ld-linux 是 exec 入口，解压后缺 exec 位
                // 会导致 glibc node "inaccessible or not found"（root 测不出来）。
                "runtime-glibc/lib/ld-linux-aarch64.so.1", "runtime-glibc/lib/ld.so"};
        for (String p : execs) {
            File f = new File(payload, p);
            if (f.exists()) f.setExecutable(true, false);
        }
    }

    /**
     * 启动 node 引擎进程。
     *
     * 批次 3 修复（L2）：<b>不再</b>在方法开头无条件清空 engineAuthUrl/engineAuthCookie/
     * engineAuthRequired。旧实现每次 spawn 都清空，一旦发生第二次 spawn（并发实例 / 看门狗），
     * 第一次已经从 stdout 抓到的鉴权 URL 就被抹掉，而 waitForServer() 的就绪判据是
     * {@code healthOk() && (!engineAuthRequired || engineAuthUrl != null)}——第二次 spawn 恰好把端口
     * 撞成 EADDRINUSE（401 仍成立 → healthOk()=true、engineAuthRequired=true），于是该判据
     * 永远不会满足，干等 90s 报 engine start timeout，并被误计一次 glibc 启动失败。
     * 需要「干净重启」的调用方请先显式调用 {@link #resetEngineHandshakeState()}。
     */
    private void spawnNode(File payload) throws IOException {
        if (engineShutdownRequested) throw new IOException("engine shutdown requested");
        // 批次10d（#30）启动埋点：node spawn（方法入口覆盖所有调用点）
        if (stSpawn == 0) stSpawn = android.os.SystemClock.elapsedRealtime();
        // v1.9.0 启动命令选择：读 dsh_prefs/runtime_mode（默认 glibc）。glibc 模式 exec
        // runtime/bin/node.glibc（sh wrapper：LD_LIBRARY_PATH + LD_PRELOAD=TEG + exec
        // 随包 ld.so --library-path 启动官方 glibc node）；bionic 模式 exec 原 node 真身。
        // glibc 产物缺失时自动本次回退 bionic（安全网）。
        runtimeMode = readRuntimeMode();
        File glibcWrapper = new File(payload, "runtime/bin/node.glibc");
        File glibcNode = new File(payload, "runtime-glibc/bin/node");
        boolean useGlibc = "glibc".equals(runtimeMode)
                && glibcWrapper.isFile() && glibcNode.isFile();
        if ("glibc".equals(runtimeMode) && !useGlibc) {
            Log.w(TAG, "runtime_mode=glibc 但 glibc runtime 缺失（node.glibc/glibc node 不存在），"
                    + "本次以 bionic 启动");
            runtimeMode = "bionic";
        }
        File node = useGlibc ? glibcWrapper : new File(payload, "runtime/bin/node");
        // 批次95 修复：托管模式（root/Shizuku）启动时不会走 payload 预处理，dshrootDir 可能仍是 null；
        // 而 `new File(null, REL_BINJS)` 在 Java 里得到的是**相对路径**（不抛 NPE）⇒ 内层看门狗会以
        // 「dsh bin.js missing」每 20s 空转（真机 2026-09-22 实测：托管停机后回落 App 内即命中）。
        // 兜底：把内核目录解析/补齐到位（内部优先；缺则重解一次；再回退外部）。
        File dshroot = dshrootDir != null ? dshrootDir : new File(payload, "dshroot");
        File binjs = new File(dshroot, REL_BINJS);
        if (!binjs.exists()) {
            Log.w(TAG, "dshroot not prepared in spawnNode (dir=" + dshroot + ") -> repopulating");
            try {
                extractPayload(payload, null, "dshroot");
            } catch (Throwable t) {
                Log.w(TAG, "dshroot repopulate failed", t);
            }
            if (!binjs.exists()) {
                File ext = new File(new File(Environment.getExternalStorageDirectory(),
                        EXT_DSHROOT_ROOT), "dshroot");
                if (new File(ext, REL_BINJS).exists()) {
                    dshroot = ext;
                    binjs = new File(ext, REL_BINJS);
                    Log.i(TAG, "dshroot fallback to external: " + dshroot);
                }
            }
        }
        dshrootDir = dshroot;
        File lib = new File(payload, "runtime/lib");
        File home = new File(payload, "dshhome");
        // 批次78：App 内模式的用户数据（会话/附件/存储）接共享 home，与托管模式同一真源
        HostedEngineManager.linkSharedData(home, this);
        File bin = new File(payload, "bin");
        File tmp = new File(getCacheDir(), "tmp");
        if (!tmp.exists()) tmp.mkdirs();

        if (!node.exists()) throw new IOException("node binary missing");
        if (!binjs.exists()) throw new IOException("dsh bin.js missing");
        if (!node.canExecute()) node.setExecutable(true, false);

        // 注意：Android 兼容补丁（禁用 llm-pi-ai/sandbox/bash-sandbox 的 cordis.patch.yml）
        // 位于 $DSH_HOME/cordis.patch.yml，由 dsh profile-boot 的 homePatches 自动加载，
        // 无需 --patch 参数（重复传入会导致 duplicate loader entry 崩溃）。
        ProcessBuilder pb = new ProcessBuilder(
                node.getAbsolutePath(), "--expose-internals", binjs.getAbsolutePath(),
                "web", "--no-open", "--host", "127.0.0.1", "--port", String.valueOf(enginePort));
        java.util.Map<String, String> env = pb.environment();
        env.put("LD_LIBRARY_PATH", lib.getAbsolutePath());
        // Termux 共存修复（v1.7.4）：内置 node 在 Termux 环境编译，OPENSSLDIR 被编译死为
        // /data/data/com.termux/files/usr。装了 Termux 的设备读其 openssl.cnf 触发 EACCES，
        // node 启动即崩；没装 Termux 时靠 ENOENT 静默才碰巧正常。注入 OPENSSL_CONF 指向
        // payload 自带的可读 openssl.cnf（build.sh 生成），有无 Termux 都稳定。
        File osslConf = new File(payload, "runtime/etc/openssl.cnf");
        if (osslConf.exists()) env.put("OPENSSL_CONF", osslConf.getAbsolutePath());
        // v1.8.2：内置 curl 为 Termux 构建，证书路径编译死为 Termux 的 cert.pem（本机不
        // 存在）→ HTTPS 一律 error 77。注入 CURL_CA_BUNDLE 指向 payload 自带的 Mozilla
        // CA bundle（build.sh 打包 runtime/etc/curl-ca-bundle.crt），curl 优先级高于
        // 编译期 --with-ca-bundle，child bash/curl 全部生效。
        File curlCa = new File(payload, "runtime/etc/curl-ca-bundle.crt");
        if (curlCa.exists()) env.put("CURL_CA_BUNDLE", curlCa.getAbsolutePath());
        env.put("PATH", bin.getAbsolutePath() + ":" +
                new File(payload, "runtime/bin").getAbsolutePath() + ":" +
                // v1.9.0 复测修复（2026-09-11）：/system/bin（toybox 全套）必须排在
                // runtime-glibc/bin 之前——旧版 payload 该目录曾是 busybox（musl 静态
                // PIE，ET_DYN）的符号链接，glibc 静态 PIE 自举形态在 app 域 seccomp 下
                // SIGSYS(159)，会把 PATH 里的 ls/date/cat/grep 等全部打挂（toybox 则
                // 100% 可用）。批次15（#9a）起 payload 不再带 busybox 与其符号链接清单，
                // 但升级设备可能残留旧符号链接，排序保持不变以防回退。
                "/system/bin:/system/xbin:" +
                new File(payload, "runtime-glibc/bin").getAbsolutePath());
        // v1.9.0 复测修复（2026-09-11）：glibc 模式下 process.execPath 是 ld.so
        // （dirname=runtime-glibc/lib），dsh-tool-fs-search 的 resolveRgPath() 沿它
        // 找 rg 会落空并 reject（@vscode/ripgrep 无 linux-arm64 包）→ glob/grep 全灭。
        // 显式指定已实测可用的 musl 静态 rg（复测报告验证表第 2 行）。
        File rgPath = new File(payload, "runtime/bin/rg");
        if (rgPath.isFile()) env.put("DSH_RG_PATH", rgPath.getAbsolutePath());
        env.put("HOME", getFilesDir().getAbsolutePath());
        env.put("DSH_HOME", home.getAbsolutePath());
        env.put("DSH_ANDROID", "1");
        env.put("TMPDIR", tmp.getAbsolutePath());
        env.put("TERM", "xterm");
        // 批次13 F1：NODE_COMPILE_CACHE —— node v24 自带的 V8 编译缓存（ESM/CJS 均生效，
        // 子进程/worker 继承同享）。首次启动写缓存略慢，之后每次启动免去重复编译上千个模块。
        // 目录不存在则创建；glibc/bionic 两分支共用同一 env（pb.start 前统一注入），不改其他 env。
        File compileCache = new File(payload, "node-compile-cache");
        if (!compileCache.exists()) compileCache.mkdirs();
        env.put("NODE_COMPILE_CACHE", compileCache.getAbsolutePath());
        env.put("SHIZUKU_DEX", rishDex != null ? rishDex.getAbsolutePath() : "");
        env.put("SHIZUKU_APP_ID", "com.deepseek.harness");
        // 特权通道可用性：root(su) 或 Shizuku。两者都未授予时，DSH 插件不注册特权工具，
        // AI 不会反复尝试系统操作；文件读写仍可用 DSH 自带的 fs/bash 工具（只需存储权限）。
        // 批次13 D1：优先读解压期间预计算的 TTL 缓存（未命中回退原路径现场探测）；
        // 耗时计入 P0 埋点 stProbeMs。
        long tProbe0 = android.os.SystemClock.elapsedRealtime();
        env.put("SHIZUKU_AVAILABLE", shizukuAvailableCached() ? "1" : "0");
        env.put("ROOT_AVAILABLE", rootAvailableCached() ? "1" : "0");
        stProbeMs = android.os.SystemClock.elapsedRealtime() - tProbe0;
        // 启动期一次性打印特权通道可用性，便于真机排障（旧版本有这一行，当前源码缺失，
        // 导致「root/Shizuku 授权是否生效」无法从外部日志判断）。
        Log.i(TAG, "privilege probe: ROOT_AVAILABLE=" + env.get("ROOT_AVAILABLE")
                + " SHIZUKU_AVAILABLE=" + env.get("SHIZUKU_AVAILABLE")
                + " channel=" + ("1".equals(env.get("ROOT_AVAILABLE")) ? "root"
                        : "1".equals(env.get("SHIZUKU_AVAILABLE")) ? "shizuku" : "none")
                // v1.9.0：便于外部核实本次引擎跑的是哪套 runtime
                + " RUNTIME=" + runtimeMode);
        if (useGlibc) {
            // v1.9.0 D6：glibc 程序读 runtime-glibc/etc/resolv.conf（Android 无 /etc），
            // 每次启动刷新（网络切换安全）；D3：busybox 符号链接清单已随批次15（#9a）
            // busybox 清账从 payload 移除，applyGlibcSymlinks 幂等跳过。
            // 批次13 D1：解压期间已预刷新且在 TTL 内 → 跳过（网络切换安全由 TTL 过期重刷兜底）。
            long tResolv0 = android.os.SystemClock.elapsedRealtime();
            if (!resolvConfFresh()) refreshResolvConf(payload);
            stResolvMs = android.os.SystemClock.elapsedRealtime() - tResolv0;
            applyGlibcSymlinks(payload);
        }
        File hostTools = new File(dshrootDir,
                "lib/node_modules/@deepseek-ai/dsh-tools/lib/index.js");
        if (hostTools.isFile()) env.put("DSH_TOOLS_MODULE", hostTools.toURI().toString());
        env.put("APP_NOTIFY_PORT", String.valueOf(notifyPort()));
        // v1.8.4 安全加固：本地桥接鉴权 token，插件请求 3081/3181 时经 X-DSH-Token 头回传
        env.put("APP_LOCAL_TOKEN", localToken());
        // v1.8.5：审批门默认关闭（个人工具，少打扰）。dsh_prefs/confirm_gate 开关开启后才注入 1，
        // 高危操作（装/卸应用、写 global|secure、特权 shell 写命令）才需用户确认。
        env.put("APP_CONFIRM_DANGEROUS",
                getSharedPreferences("dsh_prefs", MODE_PRIVATE).getBoolean("confirm_gate", false) ? "1" : "0");
        // 后台虚拟屏模式：默认开启（true），传给引擎环境 DSH_VSCREEN_MODE
        boolean vscreenEnabled = getSharedPreferences("vscreen_prefs", MODE_PRIVATE)
                .getBoolean("vscreen_mode", true);
        env.put("DSH_VSCREEN_MODE", vscreenEnabled ? "1" : "0");
        // v1.7 无障碍服务端口（通知端口 + 100，三版本共存不冲突）：插件 dsh-tool-accessibility 经此端口
        // 调用 App 的无障碍服务（读屏/点击/输入/截图）。端口同时写入 dsh_prefs，供无障碍服务读取。
        final int a11yPort = notifyPort() + 100;
        env.put("APP_A11Y_PORT", String.valueOf(a11yPort));
        getSharedPreferences("dsh_prefs", MODE_PRIVATE).edit().putInt("a11y_port", a11yPort).apply();
        // AI 工作区（可选）：用户选择的外部共享存储目录，作为 bash/文件工具的工作根目录
        String ws = workspacePath();
        if (ws != null && !ws.isEmpty()) env.put("DSH_WORKSPACE", ws);
        pb.redirectErrorStream(true);

        final File logFile = new File(getFilesDir(), "dsh-web.log");
        // v1.7.1：同时镜像一份引擎日志到外部目录（无需 root/adb 可读），
        // 覆盖「node 反复崩溃但 waitForServer 未抛异常」时不产生 startup-diag.txt 的场景。
        final File extLogFile = new File(android.os.Environment.getExternalStorageDirectory(),
                (getPackageName().contains("beta") ? "DeepSeekHarnessLite"
                        : getPackageName().contains("compat") ? "DeepSeekHarnessCompat" : "DeepSeekHarness")
                        + "/dsh-web.log");
        // 批次 3（L6）：每次 spawn 写一段带序号/时间的段落头，排障时可区分「哪一次启动」的输出。
        // 说明：日志本来就是【追加】写入（new FileOutputStream(logFile, true)），并非旧判断所说的
        // 「每次覆盖」；这里只补段落分隔 + 容量上限，避免无限增长。
        final int seq = ++spawnSeq;
        final String segHeader = "\n===== [spawn #" + seq + "] " + new java.util.Date()
                + " runtime=" + runtimeMode + " port=" + enginePort + " =====\n";
        trimEngineLogIfNeeded(logFile);
        lastSpawnEaddrInUse = false;

        final Process proc = pb.start();
        // 批次13 P0：pb.start 时刻（webMarker = stWebMarkerAt - stPbStart，node 拉起→引擎就绪打点）
        if (stPbStart == 0) stPbStart = android.os.SystemClock.elapsedRealtime();
        nodeProcess = proc;
        new Thread(new Runnable() {
            @Override public void run() {
                FileOutputStream fos = null;
                FileOutputStream extFos = null;
                try {
                    fos = new FileOutputStream(logFile, true);
                    try {
                        fos.write(segHeader.getBytes("UTF-8"));
                        fos.flush();
                    } catch (Throwable ignored) {
                    }
                    try {
                        File extParent = extLogFile.getParentFile();
                        if (extParent != null && !extParent.exists()) extParent.mkdirs();
                        extFos = new FileOutputStream(extLogFile, true);
                        extFos.write(segHeader.getBytes("UTF-8"));
                        extFos.flush();
                    } catch (Throwable ignored) {
                    }
                    InputStream is = proc.getInputStream();
                    byte[] b = new byte[4096];
                    StringBuilder outputTail = new StringBuilder();
                    int n;
                    while ((n = is.read(b)) > 0) {
                        String s = new String(b, 0, n, "UTF-8");
                        outputTail.append(s);
                        if (outputTail.length() > 8192) {
                            outputTail.delete(0, outputTail.length() - 8192);
                        }
                        // 批次 3（L5）：记录本次 spawn 是否撞端口，供失败计数/降级决策排除「自己占着自己」
                        if (outputTail.indexOf("EADDRINUSE") >= 0
                                || outputTail.indexOf("address already in use") >= 0) {
                            lastSpawnEaddrInUse = true;
                        }
                        captureEngineAuthUrl(outputTail.toString());
                        // 批次13 E1：看到就绪 marker（鉴权 URL 已捕获）→ 立即唤醒 waitForServer
                        // 做一次就绪检查，消除最多 1s 的轮询粒度等待；无等待者时为 no-op。
                        if (engineAuthUrl != null) pokeEngineWait();
                        String safe = redactEngineAuthUrl(s);
                        byte[] safeBytes = safe.getBytes("UTF-8");
                        fos.write(safeBytes);
                        fos.flush();
                        if (extFos != null) {
                            try {
                                extFos.write(safeBytes);
                                extFos.flush();
                            } catch (Throwable ignored) {}
                        }
                        for (String line : safe.split("\n")) {
                            String t = line.trim();
                            if (!t.isEmpty()) Log.i(TAG, "node: " + t);
                        }
                    }
                } catch (IOException e) {
                    Log.w(TAG, "log reader error", e);
                } finally {
                    try { if (fos != null) fos.close(); } catch (IOException ignored) {}
                    try { if (extFos != null) extFos.close(); } catch (IOException ignored) {}
                }
            }
        }, "node-log").start();
    }

    private boolean healthOk() {
        return isDshEngine(enginePort);
    }

    /** 批次13 E1：立即唤醒 waitForServer 的等待（就绪 marker 已出现）。无等待者时为 no-op。 */
    private void pokeEngineWait() {
        synchronized (engineWaitGate) {
            engineWaitGate.notifyAll();
        }
    }

    /** 批次 3（L6）：引擎日志按段追加，超过 2MB 时只保留最近约 512KB，避免无限增长。 */
    private void trimEngineLogIfNeeded(File log) {
        try {
            long len = log.length();
            if (len <= 2L * 1024 * 1024) return;
            byte[] tail = new byte[512 * 1024];
            java.io.RandomAccessFile raf = new java.io.RandomAccessFile(log, "r");
            try {
                raf.seek(len - tail.length);
                raf.readFully(tail);
            } finally {
                raf.close();
            }
            FileOutputStream out = new FileOutputStream(log, false);
            try {
                out.write(tail);
            } finally {
                out.close();
            }
            Log.i(TAG, "engine log trimmed to last " + tail.length + " bytes");
        } catch (Throwable t) {
            Log.w(TAG, "engine log trim failed", t);
        }
    }

    /** v1.9.0：读取引擎 runtime 模式（dsh_prefs/runtime_mode，glibc 默认；非法值按 glibc 处理）。 */
    private String readRuntimeMode() {
        String m = getSharedPreferences("dsh_prefs", MODE_PRIVATE)
                .getString("runtime_mode", "glibc");
        return "bionic".equals(m) ? "bionic" : "glibc";
    }

    /**
     * v1.9.0 D7 降级：glibc 模式下连续 {@link #GLIBC_FAIL_LIMIT} 次启动失败
     * （node 未存活到引擎端口 LISTEN）→ 写 dsh_prefs/runtime_mode=bionic 并 logcat；
     * 之后的 spawnNode 读 prefs 自动走 bionic。手动把 prefs 改回 glibc 即重置计数。
     */
    private void recordGlibcStartFailure(String reason) {
        if (!"glibc".equals(runtimeMode)) return;
        glibcFailCount++;
        Log.w(TAG, "glibc start failure " + glibcFailCount + "/" + GLIBC_FAIL_LIMIT
                + " (" + reason + ")");
        if (glibcFailCount >= GLIBC_FAIL_LIMIT) {
            getSharedPreferences("dsh_prefs", MODE_PRIVATE)
                    .edit().putString("runtime_mode", "bionic").apply();
            runtimeMode = "bionic";
            Log.w(TAG, "runtime fallback: glibc -> bionic (count=" + glibcFailCount + ")");
            glibcFailCount = 0;
        }
    }

    /**
     * v1.9.0 D6 + 真机修复（2026-09-11）：glibc 编译期写死的 resolv.conf/nsswitch.conf
     * 路径（Termux 前缀）已由 fetch.py 二进制补丁改写到 filesDir/etc/{r,n}.conf
     * （App 私有目录，免存储权限、rootless 可用），内容每次引擎启动刷新（网络切换安全）。
     * DNS 源三级兜底：/system/etc/resolv.conf → getprop net.dns1/2 →
     * dumpsys connectivity DnsAddresses → 公共 DNS（AliDNS/DNSPod）。
     */
    private void refreshResolvConf(File payload) {
        try {
            File etc = new File(getFilesDir(), "etc");
            if (!etc.exists() && !etc.mkdirs()) return;
            // 批次69：DNS 探测逻辑抽到 HostedEngineManager.resolvConfText（托管模式要写同一份内容到
            // 共享目录，否则 shell 身份的引擎读不到 App 私有 resolv.conf → getaddrinfo EAI_AGAIN）。
            String text = HostedEngineManager.resolvConfText(this);
            FileOutputStream fos = new FileOutputStream(new File(etc, "r.conf"), false);
            fos.write(text.getBytes("UTF-8"));
            fos.close();
            // n.conf（nsswitch.conf，路径同样经二进制补丁改写）：缺失 = glibc 用内置默认值
            // （hosts: files dns），此处显式落盘让行为确定。
            FileOutputStream fn = new FileOutputStream(new File(etc, "n.conf"), false);
            fn.write("hosts: files dns\n".getBytes("UTF-8"));
            fn.close();
        } catch (Throwable t) {
            Log.w(TAG, "refreshResolvConf failed", t);
        }
    }

    private String getprop(String key) {
        try {
            Process p = new ProcessBuilder("/system/bin/getprop", key)
                    .redirectErrorStream(true).start();
            BufferedReader r = new BufferedReader(
                    new InputStreamReader(p.getInputStream(), "UTF-8"));
            String line = r.readLine();
            r.close();
            p.waitFor();
            return line == null ? "" : line.trim();
        } catch (Throwable t) {
            return "";
        }
    }

    /**
     * v1.9.0：按 runtime-glibc/symlinks.json（fetch.py 产物，bin/sh -> busybox 等）
     * 在设备上创建符号链接。Windows 宿主无法建 Linux symlink，故以清单随包 +
     * 此处运行期落地；link -> symlink -> copy 三级回退，复用 applyLinks 的模式
     * （bionic LINKS.txt 同款，Android FUSE/SELinux 下 symlink 可能被禁，copy 兜底）。
     * 批次15（#9a）：busybox 已从 payload 移除，新构建的 payload 不再带清单 →
     * 本方法对缺失清单幂等跳过；保留方法体以兼容升级设备上的旧清单（无副作用）。
     */
    private void applyGlibcSymlinks(File payload) {
        try {
            File manifest = new File(payload, "runtime-glibc/symlinks.json");
            if (!manifest.isFile()) return;
            StringBuilder sb = new StringBuilder();
            FileInputStream in = new FileInputStream(manifest);
            byte[] b = new byte[4096];
            int n;
            while ((n = in.read(b)) > 0) sb.append(new String(b, 0, n, "UTF-8"));
            in.close();
            JSONObject root = new JSONObject(sb.toString());
            JSONObject links = root.optJSONObject("links");
            if (links == null) return;
            java.util.Iterator<String> it = links.keys();
            int done = 0;
            while (it.hasNext()) {
                String linkPath = it.next();
                String target = links.optString(linkPath, "");
                if (target.isEmpty()) continue;
                File link = new File(payload, "runtime-glibc/" + linkPath);
                // 链接目标按同目录相对路径解析（bin/sh -> busybox 同在 bin/ 下）
                File src = new File(link.getParentFile(), target);
                if (link.exists() || !src.exists()) continue;
                try {
                    Os.link(src.getAbsolutePath(), link.getAbsolutePath());
                    done++;
                } catch (ErrnoException e1) {
                    try {
                        Os.symlink(target, link.getAbsolutePath());
                        done++;
                    } catch (ErrnoException e2) {
                        try { copyFile(src, link); done++; }
                        catch (IOException e3) {
                            Log.w(TAG, "glibc symlink failed " + linkPath, e3);
                        }
                    }
                }
            }
            Log.i(TAG, "glibc symlinks ready: " + done + "/" + links.length());
        } catch (Throwable t) {
            Log.w(TAG, "applyGlibcSymlinks failed", t);
        }
    }

    /** 批次10d（#30）冷启动埋点汇总：logcat 一条 + 追加写 files/startup-trace.jsonl（保留最近 50 条）。
     *  只采集、不改任何既有时序；未采集到的阶段记 -1。UI 就绪（onPageFinished）时触发。 */
    private void reportStartupTrace() {
        try {
            if (stTraceReported || stOnCreate == 0) return;
            stTraceReported = true;
            long now = android.os.SystemClock.elapsedRealtime();
            long payload = stPayload > 0 ? stPayload - stOnCreate : -1;
            long spawn = stSpawn > 0 ? stSpawn - stOnCreate : -1;
            long engine = stEngine > 0 ? stEngine - stOnCreate : -1;
            long ui = stUi > 0 ? stUi - stOnCreate : -1;
            long total = now - stOnCreate;
            Log.i(TAG, "startup-trace: onCreate=0 payload=" + payload + " spawn=" + spawn
                    + " engine=" + engine + " ui=" + ui + " total=" + total);
            // 批次13 P0/A1：细化埋点（独立 logcat 行，既有 startup-trace 行格式不变）
            long webMarker = (stWebMarkerAt > 0 && stPbStart > 0) ? stWebMarkerAt - stPbStart : -1;
            Log.i(TAG, "startup-trace-ext: extracts=" + stExtractLog
                    + " dshrootSync=" + stDshrootSync
                    + " resolvMs=" + stResolvMs + " probeMs=" + stProbeMs
                    + " webMarker=" + webMarker
                    + (stPayloadFpSkip ? " payloadSkip=fingerprint" : ""));
            JSONObject o = new JSONObject();
            o.put("ts", System.currentTimeMillis());
            o.put("onCreate", 0);
            o.put("payload", payload);
            o.put("spawn", spawn);
            o.put("engine", engine);
            o.put("ui", ui);
            o.put("total", total);
            // 批次13 P0/A1：新增键（既有字段名/语义不变，只增不改）
            o.put("resolvMs", stResolvMs);
            o.put("probeMs", stProbeMs);
            o.put("webMarker", webMarker);
            if (stExtractLog.length() > 0) o.put("extracts", stExtractLog.toString());
            if (stDshrootSync.length() > 0) o.put("dshrootSync", stDshrootSync);
            if (stPayloadFpSkip) o.put("payloadSkip", "fingerprint");
            File f = new File(getFilesDir(), "startup-trace.jsonl");
            java.util.List<String> lines = new ArrayList<>();
            if (f.exists()) {
                java.io.BufferedReader r = new java.io.BufferedReader(
                        new java.io.InputStreamReader(new java.io.FileInputStream(f), "UTF-8"));
                String l;
                while ((l = r.readLine()) != null) { if (!l.trim().isEmpty()) lines.add(l); }
                r.close();
            }
            lines.add(o.toString());
            while (lines.size() > 50) lines.remove(0);
            java.io.PrintWriter pw = new java.io.PrintWriter(
                    new java.io.OutputStreamWriter(new java.io.FileOutputStream(f, false), "UTF-8"));
            for (String s : lines) pw.println(s);
            pw.close();
        } catch (Throwable t) {
            Log.w(TAG, "startup-trace failed", t);
        }
    }

    private void waitForServer() {
        long start = System.currentTimeMillis();
        long deadline = start + 90000;
        long lastStatusAt = 0; // 批次13 E1：setStatus 降频节流
        while (System.currentTimeMillis() < deadline) {
            if (healthOk() && (!engineAuthRequired || engineAuthUrl != null)) {
                // v1.9.0 D7：引擎成功 LISTEN，glibc 失败计数清零
                glibcFailCount = 0;
                // 批次10d（#30）启动埋点：引擎就绪（healthOk 判定通过处）
                if (stEngine == 0) stEngine = android.os.SystemClock.elapsedRealtime();
                loadHome();
                executePendingScheduledTask();
                executePendingShare();
                return;
            }
            // 批次13 E1：setStatus 降频为 2s（轮询间隔缩短后避免每 250ms 刷一次 UI）
            long nowMs = System.currentTimeMillis();
            if (nowMs - lastStatusAt >= 2000) {
                lastStatusAt = nowMs;
                setStatus("正在启动 DeepSeek Harness…（已等待 " + (nowMs - start) / 1000 + " 秒）");
            }
            // 批次13 E1：轮询间隔 1000→250ms；node-log 线程看到 "dsh web:" marker 时
            // notifyAll 提前唤醒（engineWaitGate）。90s deadline 与 glibc 失败计数语义不变。
            synchronized (engineWaitGate) {
                try { engineWaitGate.wait(250); } catch (InterruptedException e) { return; }
            }
        }
        // 超时：带端口提示便于排查（node 日志已写入 files/dsh-web.log）
        Log.e(TAG, "engine start timeout on port " + enginePort + ", check dsh-web.log");
        // 批次 3（L5）：只有「引擎确实没起来」才算 glibc 启动失败。
        // 端口已被自家引擎占用时绝不能计失败——典型场景是第二次 spawn 撞 EADDRINUSE，
        // 401 让 healthOk() 恒真、engineAuthUrl 被抹掉让就绪判据恒假，干等 90s 后误报失败并把
        // 好端端的 glibc 引擎降级成 bionic（之后要 root 清 prefs 才能恢复）。
        if (engineOnline()) {
            glibcFailCount = 0;
            // 批次10d（#30）启动埋点：引擎就绪（超时分支但端口已被自家引擎占用的可达判定处）
            if (stEngine == 0) stEngine = android.os.SystemClock.elapsedRealtime();
            Log.w(TAG, "engine start timeout but port " + enginePort
                    + " is already serving us (auth URL lost?); not a runtime failure, not counting");
            setStatus("引擎已在运行（端口 " + enginePort + "）");
            loadHome();
            return;
        }
        if (lastSpawnEaddrInUse) {
            Log.w(TAG, "engine start timeout caused by EADDRINUSE (port already in use), "
                    + "not counting as glibc start failure");
        } else if ("glibc".equals(runtimeMode)) {
            // v1.9.0 D7：glibc 模式超时（node 未存活到 3080 LISTEN）计一次启动失败
            recordGlibcStartFailure("engine start timeout");
        }
        // v1.5.2 慢启动修复兜底：本次走了「快速同步」（同内核升级），若引擎仍起不来，
        // 可能外部 dshroot 有缺失文件（快速路径不 stat 已有文件）→ 全量补齐后重启引擎再等一轮。
        if (fastSyncedThisBoot) {
            fastSyncedThisBoot = false;
            Log.w(TAG, "fast sync may have missed files, forcing full dshroot repair");
            setStatus("引擎启动超时，正在补齐引擎文件后重试…");
            try {
                File externalRoot = new File(Environment.getExternalStorageDirectory(), EXT_DSHROOT_ROOT);
                extractPayload(new File(getFilesDir(), "payload"), externalRoot, "dshroot");
                writeDshrootComplete(externalRoot);
            } catch (Throwable t) {
                Log.w(TAG, "full repair failed", t);
            }
            try {
                // 批次 3：这里是「明确重启引擎」，旧的鉴权 URL/cookie 已失效 → 显式重置握手状态；
                // 同时再探一次端口，避免旧 node 其实还活着时又 spawn 一个（撞 EADDRINUSE）。
                if (engineOnline()) {
                    Log.w(TAG, "port " + enginePort + " already serving after repair, skip respawn");
                    glibcFailCount = 0;
                    loadHome();
                    return;
                }
                resetEngineHandshakeState();
                spawnNode(new File(getFilesDir(), "payload"));
            } catch (Throwable t) {
                Log.e(TAG, "respawn after repair failed", t);
            }
            waitForServer();
            return;
        }
        setStatus("引擎启动超时（端口 " + enginePort + "），请重启应用");
        loadHome();
    }

    /** 定时任务自动执行：闹钟到点后引擎就绪，把任务文本作为消息自动发送给 AI（无需用户操作）。 */
    private void executePendingScheduledTask() {
        final String task = pendingScheduledTask;
        pendingScheduledTask = null; // 只执行一次
        if (task == null || task.isEmpty()) return;
        logSchedule("开始自动执行任务: " + task);
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    // 等引擎完全就绪（HTTP 200 后 API 可能还需一点时间）
                    for (int i = 0; i < 20; i++) {
                        if (healthOk()) break;
                        Thread.sleep(1000);
                    }
                    // 调 DSH API：建会话 + 发消息（AI 自动执行任务）
                    String sessionId = createSession();
                    if (sessionId == null) {
                        // 批次81-T3：旧文案把 rpc 契约缺陷误导成「用户没配 API Key」，改为如实描述。
                        logSchedule("自动执行失败：引擎 /api 未接受建会话请求（检查 engine_cookie 在位情况）");
                        return;
                    }
                    boolean sent = sendPrompt(sessionId, task);
                    logSchedule(sent ? "任务已发送给 AI 执行: " + task : "任务发送失败: " + task);
                } catch (Throwable t) {
                    logSchedule("自动执行异常: " + t.getMessage());
                }
            }
        }, "scheduled-exec").start();
    }

    // ============ 系统分享接入（v1.8.5）：任意 App「分享 → DeepSeek Harness」直接发给 AI ============

    private String pendingShareText = null;

    /** 解析 SEND / SEND_MULTIPLE 分享意图：文本直接用；图片等流复制到私有 shared/ 目录，把路径交给 AI 查看。 */
    private void handleShareIntent(Intent intent) {
        try {
            if (intent == null || intent.getAction() == null) return;
            boolean isSend = Intent.ACTION_SEND.equals(intent.getAction());
            boolean isSendMultiple = Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction());
            if (!isSend && !isSendMultiple) return;
            StringBuilder msg = new StringBuilder("用户通过系统分享发来以下内容，请处理：\n");
            boolean has = false;
            if (isSend) {
                String text = intent.getStringExtra(Intent.EXTRA_TEXT);
                if (text != null && !text.trim().isEmpty()) {
                    msg.append(text.trim());
                    has = true;
                }
                android.net.Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (stream != null) {
                    String p = copySharedStream(stream);
                    if (p != null) { msg.append("\n[文件] ").append(p); has = true; }
                }
            } else {
                ArrayList<android.net.Uri> streams = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (streams != null) {
                    for (android.net.Uri u : streams) {
                        String p = copySharedStream(u);
                        if (p != null) { msg.append("\n[文件] ").append(p); has = true; }
                    }
                }
            }
            if (!has) {
                runOnUiThread(new Runnable() { @Override public void run() {
                    android.widget.Toast.makeText(MainActivity.this, "没有可分享的内容", android.widget.Toast.LENGTH_SHORT).show();
                }});
                return;
            }
            pendingShareText = msg.toString();
            // 直接后台线程执行（executePendingShare 内部自带就绪等待）。
            // 注意：不能在主线程调 healthOk()——它发 HTTP，会抛 NetworkOnMainThreadException
            // 被 catch 吞掉，导致分享静默丢弃（v1.8.5 首包实测踩坑）。
            executePendingShare();
        } catch (Throwable t) {
            Log.w(TAG, "handle share failed", t);
        }
    }

    /** 引擎就绪后把分享内容作为新会话消息发送（复用定时任务的 createSession/sendPrompt 链路）。 */
    private void executePendingShare() {
        final String content = pendingShareText;
        pendingShareText = null;
        if (content == null || content.isEmpty()) return;
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    for (int i = 0; i < 20; i++) {
                        if (healthOk()) break;
                        Thread.sleep(1000);
                    }
                    String sessionId = createSession();
                    if (sessionId == null) {
                        showShareFallback("引擎未就绪，分享内容已复制到剪贴板", content);
                        return;
                    }
                    boolean sent = sendPrompt(sessionId, content);
                    if (!sent) {
                        showShareFallback("分享发送失败，内容已复制到剪贴板", content);
                        return;
                    }
                    runOnUiThread(new Runnable() { @Override public void run() {
                        android.widget.Toast.makeText(MainActivity.this, "已发送给 AI", android.widget.Toast.LENGTH_SHORT).show();
                    }});
                } catch (Throwable t) {
                    showShareFallback("分享处理异常，内容已复制到剪贴板", content);
                }
            }
        }, "share-exec").start();
    }

    /** 分享发送失败的兜底：内容进剪贴板 + 提示。 */
    private void showShareFallback(final String tip, String content) {
        try {
            android.content.ClipData clip = android.content.ClipData.newPlainText("dsh-share", content);
            ((android.content.ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE)).setPrimaryClip(clip);
        } catch (Throwable ignored) {}
        runOnUiThread(new Runnable() { @Override public void run() {
            android.widget.Toast.makeText(MainActivity.this, tip, android.widget.Toast.LENGTH_LONG).show();
        }});
    }

    /** 把分享流（图片等）复制到应用私有 shared/ 目录（AI bash 同 uid 可读），返回绝对路径。 */
    private String copySharedStream(android.net.Uri uri) {
        java.io.InputStream in = null;
        java.io.FileOutputStream fos = null;
        try {
            java.io.File dir = new java.io.File(getFilesDir(), "shared");
            if (!dir.exists()) dir.mkdirs();
            String mime = getContentResolver().getType(uri);
            String ext = ".bin";
            if (mime != null) {
                if (mime.contains("png")) ext = ".png";
                else if (mime.contains("jpeg") || mime.contains("jpg")) ext = ".jpg";
                else if (mime.contains("webp")) ext = ".webp";
                else if (mime.contains("gif")) ext = ".gif";
                else if (mime.contains("pdf")) ext = ".pdf";
            }
            java.io.File out = new java.io.File(dir, "share-" + System.currentTimeMillis() + ext);
            in = getContentResolver().openInputStream(uri);
            fos = new java.io.FileOutputStream(out);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            return out.getAbsolutePath();
        } catch (Throwable t) {
            Log.w(TAG, "copy shared stream failed", t);
            return null;
        } finally {
            try { if (in != null) in.close(); } catch (Throwable ignored) {}
            try { if (fos != null) fos.close(); } catch (Throwable ignored) {}
        }
    }

    /** 调 DSH API 创建会话，返回 sessionId（失败返回 null）。 */
    private String createSession() {
        String json = rpcCall("session.create", "{}");
        if (json == null) return null;
        int i = json.indexOf("\"sessionId\":\"");
        if (i >= 0) {
            int q1 = i + "\"sessionId\":\"".length();
            int q2 = json.indexOf('"', q1);
            if (q2 > q1) return json.substring(q1, q2);
        }
        return null;
    }

    /** 调 DSH API 发送消息（AI 开始执行任务）。 */
    private boolean sendPrompt(String sessionId, String text) {
        // 批次81-T3：requestId 必需（缺它引擎返回 gateway/input-invalid，prompt 被静默拒绝）。
        String payload = "{\"requestId\":\"sched-" + System.currentTimeMillis()
                + "\",\"sessionId\":\"" + sessionId
                + "\",\"mode\":\"queue\",\"content\":[{\"type\":\"text\",\"text\":\""
                + escapeJson(text) + "\"}]}";
        String json = rpcCall("session.prompt", payload);
        return json != null && json.contains("\"ok\":true");
    }

    /**
     * DSH RPC 调用（形状与 {@link OverlayAgentClient} 的可用实现对齐）。
     *
     * <p>批次81-T3 真机取证（2026-09-19）修掉两条契约缺陷：① 端点必须把方法名的点换成斜杠
     * （{@code /api/session/create}；{@code /api/session.create} 返回 404 not found）；
     * ② payload 必须是 {@code {"args":{"request":…}}}，直接把 request 体放 payload 下会被
     * typert 边界校验拒（{@code gateway/input-invalid}）。Cookie 早已带（下方 setRequestProperty）。
     * 本方法被「定时任务经 Activity 路径」与「系统分享」共用，此前两条都会静默失败。</p>
     */
    private String rpcCall(String method, String payloadJson) {
        try {
            String endpoint = method.replace('.', '/');
            URL url = new URL(cleanHomeUrl() + "/api/" + endpoint);
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setRequestMethod("POST");
            c.setRequestProperty("Content-Type", "application/json");
            if (engineAuthCookie == null) {
                // v1.8.5：第二实例（如系统分享冷启动）没有走 token 交换，从 prefs 恢复
                engineAuthCookie = getSharedPreferences("dsh_prefs", MODE_PRIVATE)
                        .getString("engine_cookie", null);
            }
            if (engineAuthCookie != null) c.setRequestProperty("Cookie", engineAuthCookie);
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

    private String escapeJson(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
    }

    /** node 看门狗：引擎（3080）不可达且句柄已死时自动重启引擎并刷新页面。
     *  批次 3 修复：判据改为「端口可达 = 硬信号」（原先要求 healthOk() 与 nodeProcess.isAlive()
     *  同时为真，句柄被失败 spawn 覆盖后恒 false → 端口明明被自己占着仍反复 respawn / 误计降级）。 */
    private void startWatchdog() {
        if (watchdogStarted) return;
        watchdogStarted = true;
        new Thread(new Runnable() {
            @Override public void run() {
                while (!Thread.currentThread().isInterrupted()) {
                    if (engineShutdownRequested) return;
                    try { Thread.sleep(5000); } catch (InterruptedException e) { return; }
                    if (engineShutdownRequested) return;
                    try {
                        boolean serverUp = engineOnline();
                        boolean handleAlive = nodeProcess != null && nodeProcess.isAlive();
                        if (serverUp) {
                            // 端口在线即健康（句柄为 null/false 也不 respawn）→ 清零 glibc 失败计数
                            if (glibcFailCount > 0) glibcFailCount = 0;
                            continue;
                        }
                        if (handleAlive) continue; // node 正在启动（尚未 LISTEN），别重复 spawn
                        // 端口不可达且句柄已死 → 需要重启
                        long now = System.currentTimeMillis();
                        if (now - lastRespawnAt < 20000) continue; // 避免风车重启
                        // 批次 3：单飞——已有启动流程在跑就让给它（否则并发 spawn 撞端口）
                        if (!beginEngineStart()) continue;
                        try {
                            if (engineOnline()) { // 双检
                                glibcFailCount = 0;
                                continue;
                            }
                            lastRespawnAt = now;
                            // 批次 3（L5）：EADDRINUSE 一律不计 glibc 启动失败（端口被占≠runtime 坏）
                            if (lastSpawnEaddrInUse) {
                                Log.w(TAG, "skip glibc failure count: last spawn died with EADDRINUSE");
                            } else if ("glibc".equals(runtimeMode)) {
                                // v1.9.0 D7：glibc 模式 node 未存活即计一次启动失败，
                                // 连续 3 次写 dsh_prefs/runtime_mode=bionic 降级；
                                // 下方 spawnNode 会重新读 prefs，降级后自动走 bionic。
                                recordGlibcStartFailure("node died without engine listen");
                            }
                            Log.w(TAG, "node died, respawning engine (runtime=" + runtimeMode + ")");
                            resetEngineHandshakeState(); // 旧进程已死，鉴权 URL/cookie 随之失效
                            spawnNode(new File(getFilesDir(), "payload"));
                            final WebView wv = webView;
                            ui.post(new Runnable() {
                                @Override public void run() { wv.loadUrl(homeUrl()); }
                            });
                        } finally {
                            endEngineStart();
                        }
                    } catch (Throwable t) {
                        Log.w(TAG, "watchdog error", t);
                    }
                }
            }
        }, "node-watchdog").start();
    }

    private void loadHome() {
        startWatchdog();
        // 批次 3 任务 2：引擎就绪后做一次无障碍掉线检测（异步）
        checkA11yAliveAsync();
        // 确保持久化的 engine_cookie 注入 WebView CookieManager，避免重连时 401 渲染黑屏
        try {
            String cookie = getSharedPreferences("dsh_prefs", MODE_PRIVATE).getString("engine_cookie", null);
            if (cookie != null && !cookie.isEmpty()) {
                CookieManager.getInstance().setCookie("http://127.0.0.1:" + enginePort, cookie);
                if (Build.VERSION.SDK_INT >= 21) {
                    CookieManager.getInstance().flush();
                }
            }
        } catch (Throwable ignored) {}
        ui.post(new Runnable() {
            @Override public void run() {
                statusView.setVisibility(View.GONE);
                if (splashLogo != null) splashLogo.setVisibility(View.GONE);
                if (splashBrand != null) splashBrand.setVisibility(View.GONE);
                if (progressBar != null) {
                    progressBar.setIndeterminate(false);
                    progressBar.setVisibility(View.GONE);
                }
                webView.loadUrl(homeUrl());
            }
        });
    }

    private void setStatus(final String s) {
        ui.post(new Runnable() {
            @Override public void run() { statusView.setText(s); }
        });
    }

    private void setProgress(final int percent, final String s) {
        ui.post(new Runnable() {
            @Override public void run() {
                if (progressBar != null) {
                    progressBar.setIndeterminate(false);
                    progressBar.setVisibility(View.VISIBLE);
                    progressBar.setProgress(percent);
                }
                if (s != null) statusView.setText(s);
            }
        });
    }

    private void showIndeterminate(final String s) {
        ui.post(new Runnable() {
            @Override public void run() {
                if (progressBar != null) {
                    progressBar.setIndeterminate(true);
                    progressBar.setVisibility(View.VISIBLE);
                }
                if (s != null) statusView.setText(s);
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onDestroy() {
        // 批次 11：vscreen 会话收尾（close → kill → 释放 wakelock）。异步线程执行，onDestroy 不阻塞。
        // 批次 34：只有确认退出按钮置位的实例才收尾；安装/系统回收的 finish 不误伤新实例。
        // 系统性销毁（uiMode/配置变化触发重建）下会话属进程级（VscreensManager 单例），
        // 必须跨 Activity 重建存活——熄屏挂机场景解锁/主题切换不得杀会话。
        if (exitRequested) {
            stopKeepAliveService();
            stopEngineForExit();
            VscreensManager.get().shutdownAsync(this);
        }
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // 有历史先回退（可关掉侧边栏/返回上一页）；没有历史则询问是否退出
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        confirmExit();
    }
}
