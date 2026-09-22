package com.deepseek.harness;

import org.json.JSONObject;

/**
 * 批次60：复杂意图模板预设（Prompt Chip）数据模型。
 */
public class PromptChipItem {
    public String id;
    public String label;
    public String prompt;
    public boolean isBuiltin;
    public int order;

    public PromptChipItem(String id, String label, String prompt, boolean isBuiltin, int order) {
        this.id = id;
        this.label = label;
        this.prompt = prompt;
        this.isBuiltin = isBuiltin;
        this.order = order;
    }

    public JSONObject toJson() {
        JSONObject obj = new JSONObject();
        try {
            obj.put("id", id);
            obj.put("label", label);
            obj.put("prompt", prompt);
            obj.put("isBuiltin", isBuiltin);
            obj.put("order", order);
        } catch (Throwable ignored) {}
        return obj;
    }

    public static PromptChipItem fromJson(JSONObject obj) {
        if (obj == null) return null;
        String id = obj.optString("id", "");
        String label = obj.optString("label", "");
        String prompt = obj.optString("prompt", "");
        boolean isBuiltin = obj.optBoolean("isBuiltin", false);
        int order = obj.optInt("order", 0);
        if (id.isEmpty() || label.isEmpty()) return null;
        return new PromptChipItem(id, label, prompt, isBuiltin, order);
    }
}
