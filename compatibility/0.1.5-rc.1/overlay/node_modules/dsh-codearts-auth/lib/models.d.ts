import type { CodeArtsCredential } from './types.js';
/**
 * opengw 网关配置端点 — 返回 benefit（免费额度）模型列表（glm-5.3-flash 等）。
 * 逆向自 CodeArts Agent IDE mitmproxy 抓包（2026-08）。
 */
export declare const OPENGW_GATEWAY_CONFIG_URL = "https://opengw.developer.huaweicloud.com/api/v1/gateway/config";
/**
 * snap-access 内置模型列表端点 — 返回常规模型（GLM-5.2、openpangu、glm-5.2-sft-harmony 等）。
 * 响应结构：{ count, builtinModels: [{ model_id, model_name, ... }] }。
 * 用 AK/SK 签名 + Agent-Type: PromptCenter header。
 * 替代旧 SNAP_STATISTICS_URL（statistics/plugin 已不再返回 model_metrics）。
 */
export declare const SNAP_MODEL_BUILTIN_URL = "https://snap-access.cn-north-4.myhuaweicloud.com/v1/model/builtin";
/** 定时刷新远端模型列表的间隔（2 小时）。 */
export declare const MODEL_REFRESH_INTERVAL_MS: number;
export interface RemoteModel {
    id: string;
    name: string;
}
/**
 * 去掉模型 id 末尾的日期版本后缀：deepseek-v4-flash-0731 → deepseek-v4-flash。
 * 远端 gateway/config 返回带日期后缀的 model_id（-0731 = 7月31日版本），
 * 但 chat 端点只认不带后缀的 id（InferHub.002002009.404 "model is not registered"）。
 * 仅匹配末尾 -NNNN（4 位数字），避免误去 glm-5.3-flash 等无后缀 id。
 */
export declare function normalizeModelId(id: string): string;
/**
 * 从两个远端端点拉取模型列表并合并去重：
 * 1. opengw gateway/config → result.models（benefit 模型）
 * 2. snap-access /v1/model/builtin → builtinModels（常规模型）
 * 失败或空凭据时返回空数组（不阻断）。
 */
export declare function fetchCodeArtsRemoteModels(credential: CodeArtsCredential, fetcher?: typeof fetch): Promise<RemoteModel[]>;
/** 保存动态模型列表到缓存文件（原子写入 tmp+rename）。 */
export declare function saveModelsCache(models: RemoteModel[]): void;
/** 加载缓存文件中的动态模型列表; 文件不存在或解析失败时返回 undefined。 */
export declare function loadModelsCache(): RemoteModel[] | undefined;
/**
 * 取出可用模型列表，优先级：内存缓存 → 磁盘缓存 → 空。
 * 由 adapter 的 listModels 调用；无远端模型时仍回退到 adapter 的静态默认列表。
 */
export declare function availableCodeArtsModels(): RemoteModel[] | undefined;
/** 设置内存缓存（由 service 拉取成功后调用）。 */
export declare function setMemoryCache(models: RemoteModel[] | undefined): void;
//# sourceMappingURL=models.d.ts.map