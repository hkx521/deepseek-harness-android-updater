package com.deepseek.harness;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 批次85-R4：事件触发器的「清单注册」入口 —— 只收 App 进程未运行时也可能到达的广播
 * （包安装/卸载/替换；Android 8+ 隐式广播限制的例外名单里，这两类可以清单注册）。
 *
 * <p>运行期事件（电源/电量/亮灭屏/耳机/网络）由 {@link TriggerEngine#ensureRegistered} 动态注册，
 * 不走本接收器。</p>
 */
public class TriggerReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        try {
            TriggerEngine.handle(ctx.getApplicationContext(), intent);
        } catch (Throwable ignored) {
            // 接收器里绝不抛异常（否则会拖垮系统广播分发）
        }
    }
}

