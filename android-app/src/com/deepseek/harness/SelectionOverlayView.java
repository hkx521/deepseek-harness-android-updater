package com.deepseek.harness;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * 批次60：多模态即时选区取景全屏遮罩（SelectionOverlayView）。
 * 黑曜石半透明蒙层 + 单指圈选 + 局部镂空 + 4手柄微调 + 动态操作气泡。
 */
public class SelectionOverlayView extends FrameLayout {
    private static final String TAG = "SelectionOverlay";

    public interface OnSelectionActionListener {
        void onAskWithImage(Bitmap cropped, Rect rect);
        void onExtractText(Bitmap cropped, Rect rect);
        void onCopyImage(Bitmap cropped, Rect rect);
        void onCancel();
    }

    private final WindowManager wm;
    private final Bitmap fullScreenBitmap;
    private final OnSelectionActionListener listener;

    private Rect currentRect = null;
    private int startX, startY;
    private boolean isSelecting = false;
    private boolean isAttached = false;

    private LinearLayout bubbleLayout;
    private TextView topExitBtn;

    private Paint maskPaint;
    private Paint clearPaint;
    private Paint borderPaint;
    private Paint handlePaint;
    private Paint gridPaint;
    private Paint badgeBgPaint;
    private Paint badgeTextPaint;

    public SelectionOverlayView(Context context, Bitmap fullScreenBitmap, OnSelectionActionListener listener) {
        super(context);
        this.fullScreenBitmap = fullScreenBitmap;
        this.listener = listener;
        this.wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        setWillNotDraw(false);
        initPaints();
        buildViews();
    }

    private int dp(float dpValue) {
        float scale = getResources().getDisplayMetrics().density;
        return (int) (dpValue * scale + 0.5f);
    }

    private void initPaints() {
        maskPaint = new Paint();
        maskPaint.setColor(0x66000000);

        clearPaint = new Paint();
        clearPaint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));

        borderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        borderPaint.setStyle(Paint.Style.STROKE);
        borderPaint.setStrokeWidth(dp(2));
        borderPaint.setColor(0xFF3890F0); // 冰川蓝发光

        handlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        handlePaint.setStyle(Paint.Style.FILL);
        handlePaint.setColor(0xFFFFFFFF);

        gridPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        gridPaint.setStyle(Paint.Style.STROKE);
        gridPaint.setStrokeWidth(1);
        gridPaint.setColor(0x1AFFFFFF);

        badgeBgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        badgeBgPaint.setStyle(Paint.Style.FILL);
        badgeBgPaint.setColor(0xCC182030);

        badgeTextPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        badgeTextPaint.setColor(0xFF93C5FD);
        badgeTextPaint.setTextSize(dp(11));
        badgeTextPaint.setTextAlign(Paint.Align.CENTER);
    }

    private void buildViews() {
        // 1. 顶部右上角退出按钮
        topExitBtn = new TextView(getContext());
        topExitBtn.setText("✕ 退出划选");
        topExitBtn.setTextSize(13);
        topExitBtn.setTextColor(0xFFFFFFFF);
        topExitBtn.setGravity(Gravity.CENTER);
        topExitBtn.setPadding(dp(14), dp(6), dp(14), dp(6));
        GradientDrawable exitBg = new GradientDrawable();
        exitBg.setShape(GradientDrawable.RECTANGLE);
        exitBg.setCornerRadius(dp(16));
        exitBg.setColor(0x99182030);
        exitBg.setStroke(dp(1), 0x33FFFFFF);
        topExitBtn.setBackground(exitBg);
        topExitBtn.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) {
                dismiss();
                if (listener != null) listener.onCancel();
            }
        });
        FrameLayout.LayoutParams exitLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        exitLp.gravity = Gravity.TOP | Gravity.RIGHT;
        exitLp.topMargin = dp(42);
        exitLp.rightMargin = dp(20);
        topExitBtn.setLayoutParams(exitLp);
        addView(topExitBtn);

        // 2. 浮动操作气泡条
        bubbleLayout = new LinearLayout(getContext());
        bubbleLayout.setOrientation(LinearLayout.HORIZONTAL);
        bubbleLayout.setGravity(Gravity.CENTER_VERTICAL);
        GradientDrawable bubbleBg = new GradientDrawable();
        bubbleBg.setShape(GradientDrawable.RECTANGLE);
        bubbleBg.setCornerRadius(dp(20));
        bubbleBg.setColor(0xF2101624);
        bubbleBg.setStroke(dp(1), 0x4D3890F0);
        bubbleLayout.setBackground(bubbleBg);
        bubbleLayout.setPadding(dp(8), dp(4), dp(8), dp(4));
        bubbleLayout.setElevation(dp(8));
        bubbleLayout.setVisibility(View.GONE);

        bubbleLayout.addView(makeBubbleAction("💬 提问", 0xFF60A5FA, new OnClickListener() {
            @Override public void onClick(View v) {
                Bitmap crop = cropBitmap();
                Rect r = currentRect != null ? new Rect(currentRect) : new Rect();
                dismiss();
                if (listener != null) listener.onAskWithImage(crop, r);
            }
        }));

        bubbleLayout.addView(makeBubbleAction("📝 提取文字", 0xFF34D399, new OnClickListener() {
            @Override public void onClick(View v) {
                Bitmap crop = cropBitmap();
                Rect r = currentRect != null ? new Rect(currentRect) : new Rect();
                dismiss();
                if (listener != null) listener.onExtractText(crop, r);
            }
        }));

        bubbleLayout.addView(makeBubbleAction("📋 复制", 0xFFFCD34D, new OnClickListener() {
            @Override public void onClick(View v) {
                Bitmap crop = cropBitmap();
                Rect r = currentRect != null ? new Rect(currentRect) : new Rect();
                dismiss();
                if (listener != null) listener.onCopyImage(crop, r);
            }
        }));

        bubbleLayout.addView(makeBubbleAction("✕", 0xFF9CA3AF, new OnClickListener() {
            @Override public void onClick(View v) {
                currentRect = null;
                bubbleLayout.setVisibility(View.GONE);
                invalidate();
            }
        }));

        FrameLayout.LayoutParams bubbleLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        bubbleLayout.setLayoutParams(bubbleLp);
        addView(bubbleLayout);
    }

    private TextView makeBubbleAction(String text, int textColor, OnClickListener l) {
        TextView tv = new TextView(getContext());
        tv.setText(text);
        tv.setTextSize(12);
        tv.setTextColor(textColor);
        tv.setGravity(Gravity.CENTER);
        tv.setPadding(dp(9), dp(6), dp(9), dp(6));
        tv.setClickable(true);
        tv.setOnClickListener(l);
        return tv;
    }

    public void show() {
        if (wm == null) return;
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams();
        lp.width = WindowManager.LayoutParams.MATCH_PARENT;
        lp.height = WindowManager.LayoutParams.MATCH_PARENT;
        lp.type = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        lp.flags = WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
        if (Build.VERSION.SDK_INT >= 28) {
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
        }
        lp.format = PixelFormat.TRANSLUCENT;
        try {
            wm.addView(this, lp);
            isAttached = true;
        } catch (Throwable t) {
            Log.e(TAG, "show failed", t);
        }
    }

    public void dismiss() {
        if (!isAttached || wm == null) return;
        try {
            wm.removeView(this);
            isAttached = false;
        } catch (Throwable ignored) {}
    }

    public Bitmap cropBitmap() {
        if (fullScreenBitmap == null || currentRect == null) return null;
        int l = Math.max(0, currentRect.left);
        int t = Math.max(0, currentRect.top);
        int w = Math.min(fullScreenBitmap.getWidth() - l, currentRect.width());
        int h = Math.min(fullScreenBitmap.getHeight() - t, currentRect.height());
        if (w <= 0 || h <= 0) return null;
        try {
            return Bitmap.createBitmap(fullScreenBitmap, l, t, w, h);
        } catch (Throwable ignored) {
            return null;
        }
    }

    @Override
    public boolean onTouchEvent(MotionEvent ev) {
        int action = ev.getActionMasked();
        int x = (int) ev.getX();
        int y = (int) ev.getY();

        switch (action) {
            case MotionEvent.ACTION_DOWN:
                startX = x;
                startY = y;
                isSelecting = true;
                currentRect = new Rect(x, y, x, y);
                bubbleLayout.setVisibility(View.GONE);
                invalidate();
                return true;

            case MotionEvent.ACTION_MOVE:
                if (isSelecting) {
                    currentRect = new Rect(Math.min(startX, x), Math.min(startY, y),
                            Math.max(startX, x), Math.max(startY, y));
                    invalidate();
                }
                return true;

            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                isSelecting = false;
                if (currentRect != null && currentRect.width() > dp(30) && currentRect.height() > dp(30)) {
                    showBubbleForSelection();
                } else {
                    currentRect = null;
                    bubbleLayout.setVisibility(View.GONE);
                }
                invalidate();
                return true;
        }
        return super.onTouchEvent(ev);
    }

    private void showBubbleForSelection() {
        if (currentRect == null) return;
        int bubbleW = dp(240);
        int bubbleH = dp(44);

        int bx = Math.max(dp(12), Math.min(getWidth() - bubbleW - dp(12),
                currentRect.centerX() - bubbleW / 2));
        int by;
        if (currentRect.top >= bubbleH + dp(16)) {
            by = currentRect.top - bubbleH - dp(8);
        } else {
            by = currentRect.bottom + dp(8);
        }

        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) bubbleLayout.getLayoutParams();
        lp.leftMargin = bx;
        lp.topMargin = by;
        bubbleLayout.setLayoutParams(lp);
        bubbleLayout.setVisibility(View.VISIBLE);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int width = getWidth();
        int height = getHeight();
        if (width <= 0 || height <= 0) return;

        int saveCount = canvas.saveLayer(0, 0, width, height, null, Canvas.ALL_SAVE_FLAG);

        // 1. 底层高透黑曜石
        canvas.drawColor(0x66000000);

        // 2. 网格线
        int gridStep = dp(80);
        for (int gx = 0; gx < width; gx += gridStep) {
            canvas.drawLine(gx, 0, gx, height, gridPaint);
        }
        for (int gy = 0; gy < height; gy += gridStep) {
            canvas.drawLine(0, gy, width, gy, gridPaint);
        }

        // 3. 选区镂空与高亮描边
        if (currentRect != null && currentRect.width() > 0 && currentRect.height() > 0) {
            // 镂空露出底层真机画面
            canvas.drawRect(currentRect, clearPaint);

            // 冰川蓝发光描边
            canvas.drawRect(currentRect, borderPaint);

            // 4个手柄微调锚点
            int handleR = dp(4);
            canvas.drawCircle(currentRect.left, currentRect.top, handleR, handlePaint);
            canvas.drawCircle(currentRect.right, currentRect.top, handleR, handlePaint);
            canvas.drawCircle(currentRect.left, currentRect.bottom, handleR, handlePaint);
            canvas.drawCircle(currentRect.right, currentRect.bottom, handleR, handlePaint);

            // 尺寸药丸
            String sizeStr = currentRect.width() + " × " + currentRect.height();
            int badgeW = dp(80);
            int badgeH = dp(20);
            int badgeX = Math.min(width - badgeW - dp(8), currentRect.right - badgeW);
            int badgeY = currentRect.top - badgeH - dp(4);
            if (badgeY < dp(36)) badgeY = currentRect.bottom + dp(4);
            RectF badgeRect = new RectF(badgeX, badgeY, badgeX + badgeW, badgeY + badgeH);
            canvas.drawRoundRect(badgeRect, dp(10), dp(10), badgeBgPaint);
            canvas.drawText(sizeStr, badgeRect.centerX(), badgeRect.centerY() + dp(4), badgeTextPaint);
        }

        canvas.restoreToCount(saveCount);
    }
}
