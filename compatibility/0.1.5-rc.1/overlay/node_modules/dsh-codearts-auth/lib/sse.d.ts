/**
 * SSE 流读取与工具参数归一化的共享工具。
 *
 * codearts 与 buddy 两个适配器都消费 OpenAI 风格的 SSE chat 响应，并面临
 * 同一类后端行为：网关在连接空闲一段时间后静默掐断，或模型在生成大工具
 * 参数期间长时间不 flush 任何字节。若不主动检测空闲，`reader.read()` 会
 * 无限期挂起——适配器的 generator 永不返回，harness 当前步骤既不出结果
 * 也不报错"，web 端表现为后续指令无响应。主动超时并把失败归类为可重试的
 * TIMEOUT，harness 才能重试该步骤，把控制权交还给用户。
 */
/** SSE 读取阶段：等待首 token 与已收到数据后的 chunk 间等待。 */
export type SsePhase = 'first-token' | 'chunk';
/**
 * 在空闲超时内读取一个流块。超过 {@link timeoutMs} 无数据则取消
 * reader 并抛可重试的 `LlmError('TIMEOUT')`——比被动等待网关掐断更早
 * 失败，且归类为可重试 code。尊重用户传入的 {@link signal}：若已 abort
 * 则直接抛 abort 原因，不误报超时。
 *
 * @param label - 提供者标签，仅用于错误消息前缀（如 'codearts' / 'buddy'）。
 * @param phase - 仅用于错误消息区分首 token 超时与 chunk 间超时。
 */
export declare function readWithIdleTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs: number, label: string, signal?: AbortSignal, phase?: SsePhase): Promise<{
    done: boolean;
    value: Uint8Array | undefined;
}>;
/**
 * 把工具调用的 arguments 文本归一化为合法的 JSON 对象字面量。
 *
 * 后端在两种情况下会给出非对象的 arguments：
 * - 无参数工具只下发一个空分片（`"arguments":""`），拼接结果为空串；
 * - SSE 流被截断（连接中断 / 网关掐断），只收到半截 JSON。
 *
 * 两者都会让 harness 解析参数时报
 * `invalid arguments: "arguments" must be an object`，并把会话卡在错误态
 * ——web 后续"继续"指令无响应。归一化为 `{}` 后，缺少必填
 * 参数的工具会走正常的 schema 校验错误并回传给模型，由模型重新发起调用，
 * 而不是让整个会话崩溃。
 */
/**
 * 剔除无法配对的工具调用与工具结果。
 *
 * OpenAI 兼容协议要求：带 `tool_calls` 的 assistant 消息，其**每一个**
 * tool_call id 都必须紧跟一条对应的 `role:'tool'` 结果消息；反之，
 * `role:'tool'` 消息也必须有对应的前置 tool_call。缺任一侧，后端都会以
 * 400 拒绝整个请求。
 *
 * 工具执行失败时（参数非法、超时、工具不存在……）harness 会把 assistant 的
 * tool_calls 持久化进会话历史，却写不回结果消息。这条坏历史随后被**每次
 * 请求原样重放**，于是后端对之后每一条用户消息都返回 400——表现为"任务突然
 * 中断，此后发送任何内容都没有回复"，整个会话彻底报废。
 *
 * 适配器是最后一道防线：发出请求前剔除无法配对的条目让会话自愈。宁可丢失
 * 一轮工具上下文，也好过整条会话死亡。
 *
 * @param messages - harness 会话消息（按时间顺序）。
 * @returns 应当保留的 tool_call id 与 tool 结果 id 集合。
 */
export declare function resolveToolPairing(messages: readonly {
    role: string;
    content: unknown;
}[]): {
    keepCallIds: Set<string>;
    keepResultIds: Set<string>;
};
export declare function normalizeToolArguments(raw: string): string;
/**
 * 判断工具参数是否因分片丢失而残缺（区别于"该工具本就无参数"）。
 *
 * 两种"不合法"必须区分对待：
 * - **空串**：无参数工具（如 `list_dir`）只下发一个空分片，这是**合法**的，
 *   补 `{}` 即可，工具照常执行；
 * - **非空但无法解析**：说明参数分片在流式下发中丢了。后端并行下发多个工具
 *   调用时偶发——实测 session-23851745 turn1 step4，模型并行发起两个 `read`，
 *   两个调用都丢了 `{"file_path": "…` 前缀，仅剩路径中段与尾部。
 *
 * 后者绝不能补成 `{}` 了事：那等于伪造一个"看起来合法"的调用，harness 执行
 * 时报 `missing required property "file_path"`，模型收到莫名其妙的参数错误，
 * 而真正的病因（分片丢失）被掩盖。正确做法是判定为截断，报告 max-tokens，
 * 让 dsh 丢弃残缺调用并重试——实测重试一次即恢复正常。
 *
 * 注意：只把**无法解析**视为截断。能解析但类型不对（标量、数组）属于模型
 * 输出有误，交给 schema 校验回传即可，不应触发重试。
 */
export declare function isTruncatedArguments(raw: string): boolean;
//# sourceMappingURL=sse.d.ts.map