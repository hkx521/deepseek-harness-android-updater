package com.deepseek.harness;

import android.app.AlertDialog;
import android.app.Dialog;
import android.content.Context;
import android.content.DialogInterface;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.util.DisplayMetrics;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;

/**
 * 批次82-N5：Prompt Studio —— 「常用指令库」的用户可见管理页。
 *
 * <p>批次60 已经落地了数据层（{@link PromptChipManager} + {@link PromptChipItem}）与面板药丸渲染，
 * 缺的是「用户找得到的管理入口」与「顺序管理」：本类补齐这两块，并保证改完<b>立即</b>生效。</p>
 *
 * <p><b>三条边界</b>：
 * <ol>
 *   <li>只读写 {@link PromptChipManager}（{@code dsh_prefs/custom_prompt_chips} 唯一存储点），
 *       不自己碰 SharedPreferences —— 存储契约由批次60 的闸门钉住；</li>
 *   <li>排序一律用 {@code order} 字段（上移 / 下移 = 与相邻项交换、置顶 = moveToTop），
 *       <b>不引入 pinned 之类的第二套语义</b>；</li>
 *   <li>内置芯片可编辑 / 可排序，但<b>不可删除</b>（沿用 {@code deleteChip} 的保护）。</li>
 * </ol>
 *
 * <p><b>窗口类型</b>：从 OverlayService 的面板拉起时必须用 {@code TYPE_APPLICATION_OVERLAY}，
 * 从 MainActivity 设置页拉起则是普通 Dialog —— 由调用方用 {@code overlayWindow} 指定。</p>
 */
public final class PromptStudio {

    private static final String TAG = "PromptStudio";
    private static final int BG = 0xF2121620;
    private static final int CARD = 0x1FFFFFFF;
    private static final int TEXT = 0xFFFFFFFF;
    private static final int SUB = 0x99FFFFFF;
    private static final int ACCENT = 0xFF60A5FA;
    private static final int DANGER = 0xFFF87171;

    private PromptStudio() {}

    /**
     * 打开「指令库管理」页面。
     *
     * @param overlayWindow 从 OverlayService 拉起时传 true（窗口类型必须是 overlay）
     * @param onChanged     每次改动后的回调（可为 null）；面板侧由本类直接触发刷新
     */
    public static void show(final Context ctx, final boolean overlayWindow, final Runnable onChanged) {
        if (ctx == null) return;
        try {
            final Dialog dialog = new Dialog(ctx);
            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
            final ScrollView scroll = new ScrollView(ctx);
            scroll.setBackgroundColor(BG);
            final LinearLayout col = new LinearLayout(ctx);
            col.setOrientation(LinearLayout.VERTICAL);
            col.setPadding(dp(ctx, 18), dp(ctx, 16), dp(ctx, 18), dp(ctx, 16));
            scroll.addView(col, new ScrollView.LayoutParams(
                    ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT));
            render(ctx, col, dialog, overlayWindow, onChanged);
            dialog.setContentView(scroll);
            Window win = dialog.getWindow();
            if (win != null) {
                win.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
                DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
                win.setLayout(Math.max(dp(ctx, 280), dm.widthPixels - dp(ctx, 48)),
                        Math.round(dm.heightPixels * 0.8f));
                if (overlayWindow) {
                    win.setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY);
                }
            }
            dialog.show();
        } catch (Throwable t) {
            Log.w(TAG, "prompt studio failed", t);
        }
    }

    private static void render(final Context ctx, final LinearLayout col, final Dialog dialog,
                              final boolean overlayWindow, final Runnable onChanged) {
        col.removeAllViews();

        TextView title = new TextView(ctx);
        title.setText("指令库 · 常用指令药丸");
        title.setTextColor(TEXT);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        col.addView(title);

        TextView hint = new TextView(ctx);
        hint.setText("点药丸即按预设指令发送；这里是它的增删改与排序。"
                + "改动立即同步到悬浮面板（不需要重开 App）。内置药丸可改可排序，但不能删除。");
        hint.setTextColor(SUB);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        LinearLayout.LayoutParams hLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        hLp.topMargin = dp(ctx, 6);
        col.addView(hint, hLp);

        List<PromptChipItem> items = PromptChipManager.getChips(ctx);
        for (int i = 0; i < items.size(); i++) {
            col.addView(buildRow(ctx, items.get(i), i == 0, i == items.size() - 1,
                    dialog, overlayWindow, onChanged));
        }
        if (items.isEmpty()) {
            TextView empty = new TextView(ctx);
            empty.setText("（指令库为空，点下方「新建」添加）");
            empty.setTextColor(SUB);
            empty.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            LinearLayout.LayoutParams eLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            eLp.topMargin = dp(ctx, 12);
            col.addView(empty, eLp);
        }

        col.addView(buildFooter(ctx, dialog, overlayWindow, onChanged));
    }

    private static View buildRow(final Context ctx, final PromptChipItem item, final boolean isFirst,
                                 final boolean isLast, final Dialog dialog, final boolean overlayWindow,
                                 final Runnable onChanged) {
        LinearLayout card = new LinearLayout(ctx);
        card.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(ctx, 14));
        bg.setColor(CARD);
        card.setBackground(bg);
        card.setPadding(dp(ctx, 12), dp(ctx, 10), dp(ctx, 12), dp(ctx, 10));
        LinearLayout.LayoutParams cLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        cLp.topMargin = dp(ctx, 10);
        card.setLayoutParams(cLp);

        TextView label = new TextView(ctx);
        label.setText(item.label + (item.isBuiltin ? "   · 内置" : ""));
        label.setTextColor(TEXT);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        label.setTypeface(null, android.graphics.Typeface.BOLD);
        card.addView(label);

        TextView preview = new TextView(ctx);
        preview.setText(item.prompt == null || item.prompt.isEmpty() ? "（未设置预设指令）" : item.prompt);
        preview.setTextColor(SUB);
        preview.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        preview.setSingleLine(true);
        preview.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams pLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        pLp.topMargin = dp(ctx, 4);
        card.addView(preview, pLp);

        LinearLayout btns = new LinearLayout(ctx);
        btns.setOrientation(LinearLayout.HORIZONTAL);
        btns.setGravity(Gravity.CENTER_VERTICAL);

        btns.addView(pill(ctx, "⬆ 上移", !isFirst, ACCENT, new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (!PromptChipManager.moveUp(ctx, item.id)) {
                    toast(ctx, "「" + item.label + "」已经在最前");
                    return;
                }
                afterChange(ctx, onChanged);
                reshow(ctx, dialog, overlayWindow, onChanged);
            }
        }));
        btns.addView(pill(ctx, "⬇ 下移", !isLast, ACCENT, new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (!PromptChipManager.moveDown(ctx, item.id)) {
                    toast(ctx, "「" + item.label + "」已经在最后");
                    return;
                }
                afterChange(ctx, onChanged);
                reshow(ctx, dialog, overlayWindow, onChanged);
            }
        }));
        btns.addView(pill(ctx, "📌 置顶", !isFirst, ACCENT, new View.OnClickListener() {
            @Override public void onClick(View v) {
                PromptChipManager.moveToTop(ctx, item.id);
                afterChange(ctx, onChanged);
                reshow(ctx, dialog, overlayWindow, onChanged);
            }
        }));
        btns.addView(pill(ctx, "✏️ 编辑", true, TEXT, new View.OnClickListener() {
            @Override public void onClick(View v) {
                showEditDialog(ctx, item, overlayWindow, onChanged, dialog);
            }
        }));
        if (!item.isBuiltin) {
            btns.addView(pill(ctx, "🗑 删除", true, DANGER, new View.OnClickListener() {
                @Override public void onClick(View v) {
                    confirmDelete(ctx, item, dialog, overlayWindow, onChanged);
                }
            }));
        }
        card.addView(btns);
        return card;
    }

    private static View buildFooter(final Context ctx, final Dialog dialog, final boolean overlayWindow,
                                    final Runnable onChanged) {
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams rLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        rLp.topMargin = dp(ctx, 16);
        row.setLayoutParams(rLp);

        row.addView(pill(ctx, "➕ 新建", true, ACCENT, new View.OnClickListener() {
            @Override public void onClick(View v) {
                showEditDialog(ctx, null, overlayWindow, onChanged, dialog);
            }
        }));
        row.addView(pill(ctx, "🔄 恢复默认", true, TEXT, new View.OnClickListener() {
            @Override public void onClick(View v) {
                confirmReset(ctx, dialog, overlayWindow, onChanged);
            }
        }));
        row.addView(pill(ctx, "关闭", true, TEXT, new View.OnClickListener() {
            @Override public void onClick(View v) {
                dialog.dismiss();
            }
        }));
        return row;
    }

    private static void confirmDelete(final Context ctx, final PromptChipItem item, final Dialog dialog,
                                      final boolean overlayWindow, final Runnable onChanged) {
        AlertDialog.Builder b = new AlertDialog.Builder(ctx, android.R.style.Theme_DeviceDefault_Dialog_Alert);
        b.setTitle("删除药丸");
        b.setMessage("确定删除「" + item.label + "」？该预设指令会一并删除。");
        b.setPositiveButton("删除", new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface d, int which) {
                if (!PromptChipManager.deleteChip(ctx, item.id)) {
                    toast(ctx, "内置药丸不可删除");
                    return;
                }
                afterChange(ctx, onChanged);
                reshow(ctx, dialog, overlayWindow, onChanged);
            }
        });
        b.setNegativeButton("取消", null);
        AlertDialog d = b.create();
        if (overlayWindow && d.getWindow() != null) {
            d.getWindow().setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY);
        }
        d.show();
    }

    private static void confirmReset(final Context ctx, final Dialog dialog, final boolean overlayWindow,
                                     final Runnable onChanged) {
        AlertDialog.Builder b = new AlertDialog.Builder(ctx, android.R.style.Theme_DeviceDefault_Dialog_Alert);
        b.setTitle("恢复默认");
        b.setMessage("会重置为 4 个内置药丸，自己新增的药丸将全部丢失。确定继续？");
        b.setPositiveButton("恢复默认", new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface d, int which) {
                PromptChipManager.resetToDefault(ctx);
                afterChange(ctx, onChanged);
                reshow(ctx, dialog, overlayWindow, onChanged);
            }
        });
        b.setNegativeButton("取消", null);
        AlertDialog d = b.create();
        if (overlayWindow && d.getWindow() != null) {
            d.getWindow().setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY);
        }
        d.show();
    }

    private static void showEditDialog(final Context ctx, final PromptChipItem item,
                                       final boolean overlayWindow, final Runnable onChanged,
                                       final Dialog parent) {
        final boolean isNew = item == null;
        if (isNew && PromptChipManager.isFull(ctx)) {
            toast(ctx, "指令库已满（上限 " + PromptChipManager.MAX_CHIPS + " 条），请先删除一条");
            return;
        }
        AlertDialog.Builder b = new AlertDialog.Builder(ctx, android.R.style.Theme_DeviceDefault_Dialog_Alert);
        b.setTitle(isNew ? "➕ 新建指令药丸" : ("✏️ 编辑 · " + item.label));
        LinearLayout layout = new LinearLayout(ctx);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(ctx, 20), dp(ctx, 10), dp(ctx, 20), dp(ctx, 10));

        final EditText nameInput = new EditText(ctx);
        nameInput.setHint("药丸文案（建议 ≤6 字，如：速记）");
        nameInput.setTextColor(TEXT);
        nameInput.setHintTextColor(0xFF888888);
        if (!isNew) nameInput.setText(item.label);
        layout.addView(nameInput);

        final EditText promptInput = new EditText(ctx);
        promptInput.setHint("预设指令（点药丸就发送这段原文）");
        promptInput.setTextColor(TEXT);
        promptInput.setHintTextColor(0xFF888888);
        if (!isNew) promptInput.setText(item.prompt);
        LinearLayout.LayoutParams pLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        pLp.topMargin = dp(ctx, 10);
        promptInput.setLayoutParams(pLp);
        layout.addView(promptInput);

        b.setView(layout);
        b.setPositiveButton("保存", new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface d, int which) {
                String name = nameInput.getText().toString().trim();
                String prompt = promptInput.getText().toString().trim();
                if (name.isEmpty()) {
                    toast(ctx, "药丸文案不能为空");
                    return;
                }
                boolean ok = isNew
                        ? (PromptChipManager.addChip(ctx, name, prompt) != null)
                        : PromptChipManager.updateChip(ctx, item.id, name, prompt);
                if (!ok) {
                    toast(ctx, "保存失败（条目可能已不存在或已达上限）");
                    return;
                }
                afterChange(ctx, onChanged);
                reshow(ctx, parent, overlayWindow, onChanged);
                toast(ctx, isNew ? ("已新增「" + name + "」") : ("已更新「" + name + "」"));
            }
        });
        b.setNegativeButton("取消", null);
        AlertDialog d = b.create();
        if (overlayWindow && d.getWindow() != null) {
            d.getWindow().setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY);
        }
        d.show();
    }

    /** 改完重画：直接重建整个页面（条目最多 30 条，重建比增量同步简单可靠，也保证读到的都是落盘后的值）。 */
    private static void reshow(Context ctx, Dialog dialog, boolean overlayWindow, Runnable onChanged) {
        try {
            if (dialog != null) dialog.dismiss();
        } catch (Throwable ignored) {}
        show(ctx, overlayWindow, onChanged);
    }

    /** 改完立即生效：面板药丸行由 OverlayService 的同进程静态入口重画（服务不在场时空转）。 */
    private static void afterChange(Context ctx, Runnable onChanged) {
        OverlayService.refreshPromptChipsFromOutside();
        if (onChanged != null) {
            try {
                onChanged.run();
            } catch (Throwable ignored) {}
        }
    }

    private static TextView pill(Context ctx, String text, boolean enabled, int color,
                                 View.OnClickListener click) {
        TextView b = new TextView(ctx);
        b.setText(text);
        b.setTextColor(enabled ? color : 0x4DFFFFFF);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(ctx, 10), dp(ctx, 6), dp(ctx, 10), dp(ctx, 6));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(ctx, 12));
        bg.setStroke(Math.max(1, dp(ctx, 1)), enabled ? 0x66FFFFFF : 0x22FFFFFF);
        b.setBackground(bg);
        b.setEnabled(enabled);
        if (enabled && click != null) b.setOnClickListener(click);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.rightMargin = dp(ctx, 8);
        lp.topMargin = dp(ctx, 8);
        b.setLayoutParams(lp);
        return b;
    }

    private static void toast(Context ctx, String text) {
        if (ctx == null) return;
        try {
            Toast.makeText(ctx, text, Toast.LENGTH_SHORT).show();
        } catch (Throwable ignored) {}
    }

    private static int dp(Context ctx, int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value,
                ctx.getResources().getDisplayMetrics()));
    }
}

