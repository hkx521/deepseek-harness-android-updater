# dsh-codearts-auth

deepseek-harness 插件：执行 CodeArts（华为云）登录流程，默认走新式 IAM OAuth
（portal `/authorize` 授权 → 本地 `/oauth/callback` 回调 → STS token 端点换取含
`refresh_token` 的凭据），到期前静默续期，无需再次打开浏览器；旧 ticket 流程保留
为显式回退（`flow: 'ticket'`）。插件还注册一个 `codearts` LLM provider 路由，使该
凭证可直接用于 CodeArts 后端模型调用。

此外插件内置另外两个 provider 路由：

- **buddy（腾讯 CodeBuddy）** — 见 [buddy provider](#buddy-provider)。

## 安装

该包尚未发布到 npm registry。提供两种安装方式：**git 仓库安装**（推荐，自动拉取
并构建）和**源码目录安装**（本地开发联调）。

### 方式一：从 git 仓库安装（推荐）

先在 profile 的 `pnpm-workspace.yaml` 中放行该包的 build 脚本
（路径形如 `~/.dsh/profiles/<name>/pnpm-workspace.yaml`）：

```yaml
allowBuilds:
  dsh-codearts-auth@git+https://gitee.com/iJetLi/deepseek-harness-codearts.git: true
```

再用 `dsh plugin add` 从 gitee 拉取并安装：

```sh
dsh plugin --profile <name> add "https://gitee.com/iJetLi/deepseek-harness-codearts.git"
```

`add` 以 `git+https` 方式安装，pnpm 会运行 `prepare` 脚本自动构建 `lib/`，无需
手动 `pnpm build`。每次升级时重新 `add` 即可拉取最新版本并重建。

### 方式二：从源码目录安装（本地开发）

先在本仓库中构建 `lib/`，再用 `dsh plugin install` 将本地检出安装为 pnpm `link:`
依赖（指向本目录）：

```sh
pnpm build
dsh plugin --profile <name> install <path-to-this-repo>
```

> `dsh plugin install` 以 `link:` 方式安装，pnpm 不会为 `link:` 依赖运行
> `prepare` 脚本，因此必须先手动执行 `pnpm build` 生成 `lib/`，否则 dsh 启动时
> 报 `ERR_MODULE_NOT_FOUND: ... dsh-codearts-auth/lib/index.js`。

每次修改 `src/` 后都需要重新执行 `pnpm build`——dsh 启动时不会自动重建。

### 通用说明

该包声明了 `dsh.bundle` 补丁（`cordis.patch.yml`），因此 profile 的 layer 栈会
自动拾取 `codearts-auth` 行。插件注入由 dsh base 提供的 `credentials`、
`commands` 和 `llm` 服务。

## 用法

- `/codearts-login` — 在浏览器中打开华为云 portal 授权页；授权后，插件经本地
  `/oauth/callback` 回调收取 `code`，并由 STS token 端点换取含 `refresh_token` 的
  AK/SK/SecurityToken 凭据。
- `/codearts-status` — 显示 `configured`、`source`、`expiresAt`、
  `refreshable` 以及最新的 `refreshError`。
- `/codearts-refresh` — 手动静默续期凭据（refresh_token 换取；无 refresh_token 时提示重新登录）。
- 编程式调用：`ctx.codeartsAuth.login()`、`ctx.codeartsAuth.status()`、
  `ctx.codeartsAuth.refresh()`、`ctx.codeartsAuth.logout()`。

## LLM provider

插件在 `ctx.llm` 上注册了一个 `codearts` provider 路由（OpenAI 兼容端点
`https://snap-access.cn-north-4.myhuaweicloud.com/api/v2`）。每个模型请求都使用
存储的 AK/SK/SecurityToken 按华为 `SDK-HMAC-SHA256` 方案签名，并附带
`Chat-Id`/`Session-Id` 请求头。默认广告的模型为 GLM-5.2、GLM-5.1、
GLM-5、GLM-5.3 Flash（`glm-5.3-flash`，1M 上下文）、盘古
openpangu-2.0-flash (92B) / openpangu-2.0-pro (505B)，
以及 DeepSeek V4 deepseek-v4-flash / deepseek-v4-pro（UI 标注每日 1000 万免费
Tokens 福利）。
登录后在 dsh Models 页面选择该 provider 即可。

> 注 1：CodeArts Agent IDE 模型列表显示的 flash ID 为 `deepseek-v4-flash-0731`
> （带日期后缀），但后端实际注册的可用 ID 是 `deepseek-v4-flash`（无后缀）。
> 用 `deepseek-v4-flash-0731` 调用会返回 `InferHub.002002009.404 The model is
> not registered`，因此本插件只注册无后缀的 `deepseek-v4-flash`。
>
> 注 2：`glm-5.3-flash`（GLM-5.3 Flash，2026-08 加入，1M 上下文）是 benefit
> （免费额度）模型：其 chat 请求必须携带 `maas_type: benefit` 请求头且该头
> 参与 `SDK-HMAC-SHA256` 签名，否则后端返回 `InferHub.002002009.404 The model
> is not registered`。适配器已自动处理，无需手动配置。
> （逆向自 CodeArts Agent IDE mitmproxy 抓包，对齐 deveco-code-rust 90aeb17d。）

凭据来自默认的新式 IAM OAuth 流程（含 `refresh_token`）。请求发起时会解析最新
凭据，若已过期则先静默续期，再用新 AK/SK/SecurityToken 签名，无需重新打开浏览器。

## 凭证

- Ref：`CODEARTS_ACCESS_TOKEN`（POSIX 标识符格式的凭证 ref）。
- 值：JSON 字符串 `{ access_key_id, secret_access_key, security_token,
  expires_at, domain_id?, user_id?, user_name? }` — AK/SK 对用于给每个 CodeArts
  后端 API 请求签名。
- `status()` 报告 `configured`、`source`、`expiresAt`、`refreshable` 和
  `refreshError`。

## 续期（refresh）

- 默认登录流程为**新式 IAM OAuth**（PKCE + DPoP）：portal `/authorize` 授权 → 本地
  `/oauth/callback` 回调收取 `code` → `sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens`
  换取含 `refresh_token` 的凭据。
- 凭据在过期前 1 小时静默续期（`getFirstRefreshTime` 语义：距过期 ≤1h 立即刷，
  否则 `now+1h` 叠加随机秒偏移），全程无浏览器、无人工操作。
- 刷新失败后 10 分钟重试（异常网络 1 分钟）；`refresh_token` 失效后停止续期并提示
  重新登录（原因会体现在 `status().refreshError` 中）。
- 旧 ticket 流程保留为显式回退：`/codearts-login` 默认走 OAuth；编程式调用
  `ctx.codeartsAuth.login({ flow: 'ticket' })`。ticket 凭据没有 `refresh_token`，
  其续期仍意味着重新运行浏览器登录流程。
- 手动续期：`/codearts-refresh` 或 `ctx.codeartsAuth.refresh()`。
- 续期定时器是 unref 的，在 `logout()` 和插件卸载时停止。
- 运行时依赖新增 `jose`（用于 DPoP JWS 签发，与 CodeArts Agent 插件实现一致）。

## 开发

- `pnpm test` — 单元测试（快速，无网络）。
- `pnpm test:e2e` — 针对华为线上端点的真实登录流程；需要在打开的浏览器中由人工
  点击授权按钮（续期为静默刷新，无需再次点击）。
- `pnpm typecheck`、`pnpm build`。

### 构建

- `pnpm build` — 用 tsc 将 `src/` 编译到 `lib/`（生成 `.js`、`.d.ts` 和 source
  map）。插件入口是 `lib/index.js`，而 `lib/` 已被 gitignore，因此构建是安装或
  运行前的必需步骤。
- `pnpm typecheck` — 只做类型检查（`tsc --noEmit`），不产出文件，可在构建前快速
  验证。

每次修改 `src/` 后都需要重新执行 `pnpm build`——dsh 启动时不会自动重建。

### 安装到 profile 之前先构建

详见「安装」小节。`dsh plugin install` 以 `link:` 方式安装，pnpm 不会为 `link:`
依赖运行 `prepare` 脚本，因此必须先 `pnpm build` 生成 `lib/`。

## 工作原理

默认登录流程（新式 IAM OAuth，PKCE + DPoP）：

1. 生成 PKCE 配对与 DPoP ES256 密钥对，并启动本地 `127.0.0.1` 回调服务器。
2. 构造 portal `/authorize` URL 并打开华为云授权页面。
3. 授权后浏览器回调本地 `/oauth/callback`，携带授权码 `code`。
4. 向 STS token 端点（`sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens`）用
   `code` 换取含 `refresh_token` 的凭据 JSON，并存储到 `CODEARTS_ACCESS_TOKEN` 下。
5. 凭据到期前静默续期（见「续期（refresh）」），无需再次打开浏览器。

旧 ticket 流程保留为显式回退（编程式调用 `ctx.codeartsAuth.login({ flow: 'ticket' })`）：
生成 `ticket_id`，打开 `devcloud.cn-north-4.huaweicloud.com/doer/redirect` 认证页，
回调后轮询 snap-manager ticket 端点（120 × 1 秒）获取临时凭证；此类凭据没有
`refresh_token`，其续期仍意味着重新运行浏览器登录流程。

## buddy provider

独立路由 `buddy`（腾讯 CodeBuddy，OpenAI 兼容端点
`https://copilot.tencent.com/v2/chat/completions`），Bearer `access_token` 鉴权。

登录采用 external-link-v2 轮询式（与 CodeArts 的本地回调服务器不同，CodeBuddy
不起本地端口，而是轮询后端 API）：

1. `POST /v2/plugin/auth/state?platform=ide` → 取得 `state` 与 `authUrl`。
2. 打开浏览器到 `https://www.codebuddy.cn/login/?platform=ide&state=...`。
3. 轮询 `GET /v2/plugin/auth/token?state=...`（1 秒间隔、5 分钟超时）→ 令牌；
   错误码 `11217` 表示 token 未就绪，继续轮询。
4. 轮询 `GET /v2/plugin/login/account?state=...` → 账户信息；错误码 `12151`
   表示账户信息未就绪，继续轮询。
5. 续期：`POST /v2/plugin/auth/token/refresh`，通过 `X-Refresh-Token` 头提交
   refresh_token。

- 命令：`/buddy-login`、`/buddy-status`、`/buddy-refresh`。
- 编程式调用：`ctx.buddyAuth.login()` / `status()` / `refresh()` / `logout()` /
  `fetchModels()`。
- 模型列表：登录后从 `GET /v3/config`（craft agent 的 `models`）动态拉取，
  拉取失败时回退到内置静态列表（DeepSeek V4、Hy4、GLM、Kimi、MiniMax 等）。
- 请求头：除 `Authorization: Bearer` 外，还需 `X-Domain`、`X-Product`、
  `X-Product-Code` 以及伪装为 `CodeBuddyIDE/1.106.1` 的 `User-Agent`。
- 凭据 ref：`BUDDY_ACCESS_TOKEN`，值为含 `access_token` / `refresh_token` /
  `expires_at` 的 JSON 字符串。

> **流式工具调用 id 稳定性**：CodeBuddy 仅首个工具调用分片携带真实 id
> （`chatcmpl-tool-xxx`），后续参数分片只有 `index`。适配器按 index 缓存并沿用
> 真实 id（缺失时回退 `call_{index}`），保证同一工具的所有分片 id 一致——否则
> 跨轮次（每轮都从 `call_0` 重新编号）会把 `tool/result` 配对到错误的历史条目。
