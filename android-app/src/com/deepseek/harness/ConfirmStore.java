package com.deepseek.harness;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 敏感操作审批门状态存储（v1.8.4 阶段 2 安全加固）。
 *
 * 流程：AI 调用高危工具（装/卸应用、清数据、写 global/secure 设置、特权 shell 写命令）时，
 * 插件先 POST /confirm {title,text,timeoutSec} → MainActivity 发高优先级通知（允许/拒绝按钮）
 * → 用户点击触发 ConfirmReceiver.resolve() 写回结果 → 插件轮询 /confirm/result?id= 取结果。
 * 超时未确认由 MainActivity 的看护线程按拒绝处理（fail-closed）。
 */
final class ConfirmStore {

    static final class Entry {
        final String title;
        final String text;
        final long createdAt;
        volatile String status; // "pending" | "allowed" | "denied"

        Entry(String title, String text) {
            this.title = title;
            this.text = text;
            this.status = "pending";
            this.createdAt = System.currentTimeMillis();
        }
    }

    private static final Map<String, Entry> ENTRIES = new ConcurrentHashMap<String, Entry>();
    private static final long EXPIRE_MS = 600_000L; // 条目最长保留 10 分钟

    private ConfirmStore() {
    }

    static Entry create(String id, String title, String text) {
        Entry e = new Entry(title, text);
        ENTRIES.put(id, e);
        if (ENTRIES.size() > 16) {
            long now = System.currentTimeMillis();
            for (Map.Entry<String, Entry> en : ENTRIES.entrySet()) {
                if (now - en.getValue().createdAt > EXPIRE_MS) ENTRIES.remove(en.getKey());
            }
        }
        return e;
    }

    static Entry get(String id) {
        return id == null ? null : ENTRIES.get(id);
    }

    /** 仅当仍处于 pending 时写入结果，防止超时看护线程覆盖用户的真实点击。 */
    static void resolve(String id, boolean allowed) {
        Entry e = get(id);
        if (e == null) return;
        synchronized (e) {
            if ("pending".equals(e.status)) {
                e.status = allowed ? "allowed" : "denied";
            }
        }
    }
}
