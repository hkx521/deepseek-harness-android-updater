package com.deepseek.harness;

import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import android.widget.Toast;

/**
 * 批次42：下拉通知栏快捷磁贴服务（Quick Settings Tile）。
 * 支持任意界面下拉通知栏快速唤起或折叠小鲸鱼助手。
 */
public class AssistantTileService extends TileService {
    @Override
    public void onStartListening() {
        super.onStartListening();
        Tile tile = getQsTile();
        if (tile != null) {
            boolean active = OverlayService.isRunning;
            tile.setState(active ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
            tile.setLabel("小鲸鱼助手");
            tile.updateTile();
        }
    }

    @Override
    public void onClick() {
        super.onClick();
        if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "请先授予小鲸鱼悬浮窗权限", Toast.LENGTH_SHORT).show();
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (Build.VERSION.SDK_INT >= 24) {
                startActivityAndCollapse(intent);
            } else {
                startActivity(intent);
            }
            return;
        }

        OverlayService.toggleOrShowFromTile(this);
        Tile tile = getQsTile();
        if (tile != null) {
            tile.setState(Tile.STATE_ACTIVE);
            tile.updateTile();
        }
    }
}
