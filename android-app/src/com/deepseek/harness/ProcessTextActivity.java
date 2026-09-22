package com.deepseek.harness;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Toast;

/**
 * 批次42：全局划词处理 Activity。
 * 在浏览器/任意 App 中选中文字后，系统菜单呼出「小鲸鱼处理」，一键填充并提交分析。
 */
public class ProcessTextActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        CharSequence text = getIntent().getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        if (text != null && text.length() > 0) {
            String selected = text.toString().trim();
            if (!selected.isEmpty()) {
                if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) {
                    Toast.makeText(this, "请先授予悬浮窗权限以显示处理结果", Toast.LENGTH_SHORT).show();
                    Intent permIntent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                    startActivity(permIntent);
                    finish();
                    return;
                }
                OverlayService.handleIncomingText(this, selected);
            }
        }
        finish();
    }
}
