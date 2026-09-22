package com.deepseek.harness;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Toast;
import android.view.Window;
import android.view.WindowManager;

/**
 * 批次42：系统默认助手入口 Activity。
 * 响应 android.intent.action.ASSIST，长按导航条或手势唤起小鲸鱼。
 */
public class AssistActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 批次83：呼出瞬间系统状态栏会切一次外观（appearance=0）并补一块不透明黑底，用户看到的
        // 就是「顶端黑长条闪一下」（真机取证见 docs/批次83-液态玻璃材质统一方案.md §11）。
        // 这里显式声明「本窗口绘制系统栏背景 + 状态栏透明」，让系统不再用黑底填充状态栏区域。
        try {
            Window w = getWindow();
            w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            w.setStatusBarColor(android.graphics.Color.TRANSPARENT);
        } catch (Throwable ignored) {
        }
        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "请先授予小鲸鱼悬浮窗权限", Toast.LENGTH_SHORT).show();
            Intent permIntent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
            startActivity(permIntent);
            finish();
            return;
        }
        OverlayService.openAssistantFromKey(this);
        // 批次83 探针：把窗口级真模糊参数透传给悬浮服务（不带 glass_blur extra 时零影响）。
        // 悬浮服务 exported=false，adb 无法直接 start-service，故经本 Activity（exported=true）转发。
        if (getIntent() != null && (getIntent().hasExtra("glass_backdrop")
                || getIntent().hasExtra("glass_fill") || getIntent().hasExtra("glass_refract")
                || getIntent().hasExtra("flow_origin"))) {
            Intent probe = new Intent(this, OverlayService.class);
            probe.putExtra("glass_backdrop", getIntent().getIntExtra("glass_backdrop", -1));
            probe.putExtra("glass_fill", getIntent().getIntExtra("glass_fill", -1));
            probe.putExtra("glass_refract", getIntent().getIntExtra("glass_refract", -1));
            probe.putExtra("flow_origin", getIntent().getIntExtra("flow_origin", -1));   // 批次93：起点口径 A/B
            try { startService(probe); } catch (Throwable ignored) {}
        }
        // 批次51：延后微小时间销毁，避免透明 Activity 过早销毁破坏输入法焦点通道与转场
        getWindow().getDecorView().postDelayed(new Runnable() {
            @Override public void run() {
                if (Build.VERSION.SDK_INT >= 21) {
                    // 批次55-C 修正：这是本 App 主动移除任务，不是用户划掉——先给悬浮服务留痕，
                    // 避免被保活自检误判成「被系统清理」而白烧自愈额度。
                    OverlayService.noteInternalTaskRemoval();
                    finishAndRemoveTask();
                } else {
                    finish();
                }
                overridePendingTransition(0, 0);
            }
        }, 180L);
    }
}
