/** 华为云 SDK-HMAC-SHA256 请求签名 extraHeaders */
export declare function sha256Hex(data: Uint8Array): Promise<string>;
export declare function hmacSha256Hex(key: Uint8Array, data: Uint8Array): Promise<string>;
export declare function buildCanonicalRequest(method: string, uri: string, query: string, headers: Map<string, string>, payloadHash: string): string;
/** 签名一个华为请求；返回需合并到请求中的头映射。 */
export declare function signRequestHuawei(ak: string, sk: string, securityToken: string, method: string, urlStr: string, body: Uint8Array, extraHeaders?: Readonly<Record<string, string>>): Promise<Map<string, string>>;
//# sourceMappingURL=sign.d.ts.map