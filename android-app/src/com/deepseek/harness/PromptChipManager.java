package com.deepseek.harness;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * 批次60：Prompt 芯片持久化与工作流管理器。
 * 序列化至 dsh_prefs 中的 custom_prompt_chips 键。
 */
public class PromptChipManager {
    private static final String TAG = "PromptChipManager";
    public static final String PREFS = "dsh_prefs";
    public static final String KEY_CUSTOM_CHIPS = "custom_prompt_chips";
    /** 批次82-N5：芯片条数上限（面板是横向滚动行；上限只为防误操作与 JSON 无限膨胀）。 */
    public static final int MAX_CHIPS = 30;

    public static List<PromptChipItem> getChips(Context ctx) {
        List<PromptChipItem> list = new ArrayList<PromptChipItem>();
        if (ctx == null) return getDefaultChips();
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String raw = sp.getString(KEY_CUSTOM_CHIPS, null);
            if (raw == null || raw.trim().isEmpty()) {
                list = getDefaultChips();
                saveChips(ctx, list);
                return list;
            }
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                PromptChipItem item = PromptChipItem.fromJson(arr.optJSONObject(i));
                if (item != null) {
                    list.add(item);
                }
            }
            if (list.isEmpty()) {
                list = getDefaultChips();
                saveChips(ctx, list);
            } else {
                sortChips(list);
            }
        } catch (Throwable t) {
            Log.w(TAG, "getChips failed, fallback to default", t);
            list = getDefaultChips();
        }
        return list;
    }

    public static synchronized void saveChips(Context ctx, List<PromptChipItem> list) {
        if (ctx == null || list == null) return;
        try {
            sortChips(list);
            JSONArray arr = new JSONArray();
            for (PromptChipItem item : list) {
                arr.put(item.toJson());
            }
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            sp.edit().putString(KEY_CUSTOM_CHIPS, arr.toString()).apply();
        } catch (Throwable t) {
            Log.w(TAG, "saveChips failed", t);
        }
    }

    public static synchronized PromptChipItem addChip(Context ctx, String label, String prompt) {
        if (label == null || label.trim().isEmpty()) return null;
        if (isFull(ctx)) return null; // 批次82-N5：上限保护（调用方按 isFull 给「已满」提示）
        List<PromptChipItem> list = getChips(ctx);
        int maxOrder = 0;
        for (PromptChipItem item : list) {
            if (item.order > maxOrder) maxOrder = item.order;
        }
        String id = "chip_" + System.currentTimeMillis();
        PromptChipItem newItem = new PromptChipItem(id, label.trim(), prompt != null ? prompt.trim() : "", false, maxOrder + 1);
        list.add(newItem);
        saveChips(ctx, list);
        return newItem;
    }

    public static synchronized boolean updateChip(Context ctx, String id, String newLabel, String newPrompt) {
        if (id == null) return false;
        List<PromptChipItem> list = getChips(ctx);
        for (PromptChipItem item : list) {
            if (id.equals(item.id)) {
                if (newLabel != null && !newLabel.trim().isEmpty()) {
                    item.label = newLabel.trim();
                }
                if (newPrompt != null) {
                    item.prompt = newPrompt.trim();
                }
                saveChips(ctx, list);
                return true;
            }
        }
        return false;
    }

    public static synchronized boolean deleteChip(Context ctx, String id) {
        if (id == null) return false;
        List<PromptChipItem> list = getChips(ctx);
        for (int i = 0; i < list.size(); i++) {
            PromptChipItem item = list.get(i);
            if (id.equals(item.id)) {
                if (item.isBuiltin) return false;
                list.remove(i);
                saveChips(ctx, list);
                return true;
            }
        }
        return false;
    }

    public static synchronized boolean moveToTop(Context ctx, String id) {
        if (id == null) return false;
        List<PromptChipItem> list = getChips(ctx);
        PromptChipItem target = null;
        for (PromptChipItem item : list) {
            if (id.equals(item.id)) {
                target = item;
                break;
            }
        }
        if (target == null) return false;
        int minOrder = 0;
        for (PromptChipItem item : list) {
            if (item.order < minOrder) minOrder = item.order;
        }
        target.order = minOrder - 1;
        saveChips(ctx, list);
        return true;
    }

    /** 批次82-N5：是否已达条数上限（新增前先查，便于给出人话提示）。 */
    public static boolean isFull(Context ctx) {
        return getChips(ctx).size() >= MAX_CHIPS;
    }

    /**
     * 批次82-N5：与相邻项交换 order（顺序管理）。到边界 / 找不到 → false，调用方给提示。
     *
     * <p>与 {@link #moveToTop} 的区别：只交换相邻两项的 order，不做整表重排，
     * 也不会像置顶那样把 order 持续推向负方向。</p>
     */
    public static synchronized boolean moveUp(Context ctx, String id) {
        return swapNeighbour(ctx, id, -1);
    }

    /** 批次82-N5：下移一位（与相邻项交换 order）。 */
    public static synchronized boolean moveDown(Context ctx, String id) {
        return swapNeighbour(ctx, id, 1);
    }

    private static boolean swapNeighbour(Context ctx, String id, int delta) {
        if (ctx == null || id == null) return false;
        List<PromptChipItem> list = getChips(ctx);
        int index = -1;
        for (int i = 0; i < list.size(); i++) {
            if (id.equals(list.get(i).id)) {
                index = i;
                break;
            }
        }
        int other = index + delta;
        if (index < 0 || other < 0 || other >= list.size()) return false;
        int tmp = list.get(index).order;
        list.get(index).order = list.get(other).order;
        list.get(other).order = tmp;
        saveChips(ctx, list);
        return true;
    }

    public static synchronized void resetToDefault(Context ctx) {
        if (ctx == null) return;
        List<PromptChipItem> defaults = getDefaultChips();
        saveChips(ctx, defaults);
    }

    public static List<PromptChipItem> getDefaultChips() {
        List<PromptChipItem> list = new ArrayList<PromptChipItem>();
        list.add(new PromptChipItem("builtin_screen", "识别屏幕", "识别当前屏幕内容，提取核心信息并给出简短总结", true, 1));
        list.add(new PromptChipItem("builtin_summary", "总结", "总结页面", true, 2));
        list.add(new PromptChipItem("builtin_ocr", "提取", "提取文字", true, 3));
        list.add(new PromptChipItem("builtin_translate", "翻译", "翻译页面", true, 4));
        return list;
    }

    private static void sortChips(List<PromptChipItem> list) {
        Collections.sort(list, new Comparator<PromptChipItem>() {
            @Override public int compare(PromptChipItem a, PromptChipItem b) {
                return Integer.compare(a.order, b.order);
            }
        });
    }
}
