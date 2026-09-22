package com.deepseek.harness;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 审批通知的「允许/拒绝」按钮回调（v1.8.4 阶段 2 安全加固，manifest 注册）。
 * 点击按钮 → ConfirmStore.resolve(id, allowed) → 插件轮询 /confirm/result 得到结果。
 */
public class ConfirmReceiver extends BroadcastReceiver {

    static final String ACTION_ALLOW = "com.deepseek.harness.CONFIRM_ALLOW";
    static final String ACTION_DENY = "com.deepseek.harness.CONFIRM_DENY";

    @Override
    public void onReceive(Context context, Intent intent) {
        String id = intent.getStringExtra("id");
        boolean allowed = ACTION_ALLOW.equals(intent.getAction());
        if (id != null) {
            ConfirmStore.resolve(id, allowed);
        }
        try {
            int nid = intent.getIntExtra("nid", 0);
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(nid);
        } catch (Throwable ignored) {
        }
    }
}
