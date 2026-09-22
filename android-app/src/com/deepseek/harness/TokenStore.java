package com.deepseek.harness;
/** 批次20：本地桥鉴权 token 的唯一来源（3081/3181 共用）。
 *  getOrCreate：dsh_prefs/local_token 长度≥32 直接用；否则 SecureRandom 生成 32 位 hex 并持久化（自愈）。
 *  两个桥此前各自实现且已分叉（a11y 侧只读不生成）——统一到本类后任何一方先启动都能落盘，另一方读到同一值。 */
public final class TokenStore {
    private static final Object LOCK = new Object();
    private TokenStore() {}
    static synchronized String getOrCreate(android.content.Context ctx) {
        try {
            android.content.SharedPreferences prefs =
                    ctx.getSharedPreferences("dsh_prefs", android.content.Context.MODE_PRIVATE);
            String t = prefs.getString("local_token", "");
            if (t.length() >= 32) return t;
            byte[] buf = new byte[16];
            new java.security.SecureRandom().nextBytes(buf);
            StringBuilder sb = new StringBuilder(32);
            for (byte b : buf) {
                sb.append(Character.forDigit((b >> 4) & 0xf, 16));
                sb.append(Character.forDigit(b & 0xf, 16));
            }
            t = sb.toString();
            prefs.edit().putString("local_token", t).apply();
            return t;
        } catch (Throwable t2) {
            android.util.Log.w("TokenStore", "token getOrCreate failed", t2);
            return "";
        }
    }

    /** 批次20：token 比较改常量时间（MessageDigest.isEqual），防时序侧信道；仅用于鉴权头。
     *  头解析逻辑与两处既有 headerValueEquals 相同，仅末尾比较替换；
     *  connection 等非机密头仍走各自原 headerValueEquals。 */
    static boolean constantTimeHeaderEquals(String head, String lowerName, String expect) {
        int i = head.toLowerCase().indexOf(lowerName + ":");
        if (i < 0) return false;
        int lineEnd = head.indexOf('\n', i);
        if (lineEnd < 0) lineEnd = head.length();
        String v = head.substring(i + lowerName.length() + 1, lineEnd).trim();
        return java.security.MessageDigest.isEqual(v.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                expect.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
}
