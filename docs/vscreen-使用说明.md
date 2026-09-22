# 虚拟屏（vscreen）使用说明

> 面向使用者的功能介绍与排错指引。让 AI 在一台**独立的虚拟屏幕**上操作 App——**不抢你的主屏**。
> 本文以 App 的实际行为为准（如与实现不符，以代码为准）。

---

## 1. 这是什么

- AI 会在手机里创建一块**看不见的独立屏幕**（虚拟屏），把目标 App 启动到那块屏幕上，然后在上面看画面、点击、滑动、按键。
- **主屏归你**：虚拟屏上的操作不影响主屏前台，你可以继续玩手机、刷视频，甚至熄屏让它挂着跑。
- 典型场景：签到打卡、轮询刷任务、批量操作等**挂机类任务**——以前这类任务会霸占主屏，现在可以丢进虚拟屏后台跑。
- 虚拟屏是**会话制**的：用 `create` 开屏 → 干活 → `close` 关屏。同一时刻只有一块当前虚拟屏。

一句话记住 8 个工具：**开屏（create）→ 启动 App（launch）→ 看（see）→ 点/滑/按（tap/swipe/key）→ 关屏（close）**，外加随时可查的 `status`。

---

## 2. 开通条件：root 或 Shizuku，二选一

虚拟屏需要一个有特权的后台进程来创建屏幕，所以手机要满足以下**任意一个**条件：

### 方式 A：root 机（最省事）

1. 手机已 root（SukiSU / KernelSU / Magisk 等均可）。
2. 直接在 App 里让 AI 调用 `android_vscreen_create`。
3. root 管理器弹出授权请求时，**允许并勾选"记住"**即可。默认就走 root 通道，兼容性最好。

### 方式 B：无 root 机（用 Shizuku + 无线调试）

1. 安装 [Shizuku](https://shizuku.rikka.app/)（Google Play 或官网下载）。
2. 打开系统设置 → 开发者选项（没有就先在"关于手机"里连点"版本号"7 次解锁）→ 开启**无线调试**。
3. 打开 Shizuku → 选**"通过无线调试启动"**：
   - 首次需要配对：回到"无线调试"页面 → 点**"使用配对码配对设备"** → 把弹出的配对码和端口填进 Shizuku；
   - 配对成功后 Shizuku 会显示"运行中"。
4. 回到 Harness App，让 AI 调用任意虚拟屏工具（如 `android_vscreen_status` / `android_vscreen_create`），在弹出的授权对话框里**允许** Shizuku 访问。
5. 之后每次用之前确认 Shizuku 是"运行中"即可（手机重启后无线调试会被关掉，需要重新启动一次 Shizuku）。

> 两个都配了也没关系——App 会自动选最合适的通道（见下节）。

---

## 3. 通道选择（高级：`vscreen_channel` 设置）

App 按偏好值 `dsh_prefs/vscreen_channel` 决定走哪条特权通道，**缺省 `auto`，一般不用动**：

| 值 | 含义 |
|---|---|
| `auto`（默认） | **root 优先**：有 root 走 root；没有 root 但 Shizuku 已授权，走 Shizuku；两个都没有 → 报 `NO_PRIVILEGE` 并引导你去开通 |
| `root` | 强制只走 root。没有 root 时直接报 `ROOT_DENIED`，不会悄悄换道 |
| `shizuku` | 强制只走 Shizuku。Shizuku 没在运行时报 `SHIZUKU_UNAVAILABLE`，授权被拒报 `SHIZUKU_DENIED` |

auto 模式下还有"掉线自动换道"：正在用的通道失效（比如 su 授权被撤、Shizuku 服务停了），App 会尝试用另一条通道把虚拟屏恢复出来；救不回来才会报 `SESSION_DEAD` 并发掉线通知。强制通道模式只诚实报错，不自动换。

会话期间 App 会保持唤醒（wakelock），避免 AI 干活干到一半被系统杀掉。

---

## 4. 8 个工具速查表

| 工具 | 干什么 | 参数 |
|---|---|---|
| `android_vscreen_create` | 开一块虚拟屏（**首次调用可能要等数十秒**：要冷启动特权进程 + 建屏） | `width?` `height?` `dpi?`（都可省略，默认 1080×1920 / 440dpi） |
| `android_vscreen_status` | 查当前状态：root/Shizuku 是否可用、当前通道与策略、屏有没有开、进程号等 | 无 |
| `android_vscreen_launch` | 把指定 App 启动到虚拟屏上 | `packageName`（必填，包名） |
| `android_vscreen_see` | 截一张虚拟屏画面发给视觉模型看 | 无（返回 PNG 图片） |
| `android_vscreen_tap` | 在虚拟屏上点一下 | `x` `y`（必填，基于虚拟屏画面坐标） |
| `android_vscreen_swipe` | 在虚拟屏上滑动 | `x1` `y1` `x2` `y2`（必填）、`durationMs?`（默认 300） |
| `android_vscreen_key` | 在虚拟屏上按系统键 | `key`：`HOME` / `BACK` / `ENTER` / 数字键值等 |
| `android_vscreen_close` | 关闭当前虚拟屏收尾（用过 overlay 保底模式时会自动还原系统设置） | 无 |

使用要点：

- **还没 create 时**，除 `status` / `create` 外的工具都会返回"先 `android_vscreen_create`"的提示；
- 屏开一次可以连续 launch / see / tap / swipe / key 多轮，不用每步都 create；
- `create` 的返回里会带 `strategy`（建屏策略，见下节）和 `channel`（走的通道），AI 可据此自行判断能力边界；
- 干完活记得 `close`；App 退出时也会自动帮你收尾（关屏 → 停服务 → 释放唤醒锁）。

---

## 5. 建屏策略（status 里的 `strategy`）

系统对不同渠道建虚拟屏的权限管得不一样，App 会从最强到最稳逐级尝试：

| 策略 | 是什么 | 体验 |
|---|---|---|
| `trusted` | 特权"受信"虚拟屏（root 通道基本都走这条） | 最完整：独立于主屏，截图快，熄屏也可用 |
| `plain` | 普通虚拟屏（去掉了受信标志，用来绕过被收紧的权限） | 与 trusted 基本等效 |
| `overlay` | **保底模式**：用"模拟二级显示"机制拼一块屏出来（纯 Shizuku 无 root 的兜底） | 能用，但**主屏上会出现一个系统小窗**，截图也稍慢 |

失败时报 `VDM_DENIED` / `OVERLAY_FAILED` 并附一句引导，AI 会拿着这些信息告诉你下一步该怎么办。

---

## 6. 出错了吗？对照这张表

| 报错原因 | 人话 | 你要做的 |
|---|---|---|
| `NO_PRIVILEGE` | 手机既没有 root，Shizuku 也没开通 | 按本文 §2 开通 Shizuku（无线调试）或 root 后重试 |
| `ROOT_DENIED` | root 管理器拒绝了授权 | 到 SukiSU/Magisk 管理器里允许本 App（可勾"记住"），或改用 Shizuku |
| `SHIZUKU_UNAVAILABLE` | Shizuku 服务没在运行 | 打开手机"无线调试"，再到 Shizuku 里点"通过无线调试启动" |
| `SHIZUKU_DENIED` | Shizuku 的授权弹窗被拒了 | 在 Shizuku 里重新允许本 App 访问 |
| `SPAWN_FAILED` | 特权后台进程没拉起来 | 确认 root/Shizuku 状态正常后重试；仍不行重启 App 再试 |
| `VDM_DENIED` | 系统拒绝了"直接创建虚拟屏" | 无 root 时属正常现象，App 会自动走 overlay 保底；想要完整体验请用 root |
| `OVERLAY_FAILED` | 保底的 overlay 方式也失败了 | 重试一次；检查开发者选项里"模拟二级显示"是否被占用手动开着；或改用 root |
| `DISPLAY_TIMEOUT` | 建屏等太久超时了 | 直接重试 create |
| `CREATE_FAILED` | 建屏失败（通用） | 重试；用 `android_vscreen_status` 看通道与权限状态 |
| `LAUNCH_FAILED` | App 没能启动到虚拟屏 | 确认 `packageName` 写对了、目标 App 已安装 |
| `INJECT_FAILED` | 点击/滑动/按键没送进去 | 重试一次；确认虚拟屏还开着（status 看 `displayId`） |
| `NOT_CREATED` | 还没开屏就先操作了 | 先调 `android_vscreen_create` |
| `SESSION_DEAD` | 虚拟屏后台进程掉线了 | 重新 `create` 即可；auto 模式下 App 通常已自动换道恢复 |
| `BAD_TOKEN` | 会话凭证对不上（服务端被换过） | 重新 `create` 开新会话 |
| `INVALID_ARGUMENT` | 参数给错了 | 检查工具参数（坐标是不是数字、key 是不是支持的名字） |
| `BRIDGE_UNREACHABLE` | App 内部桥接不通 | 确认 App 在前台/后台活着，必要时重启 App |

每个失败响应都会带一句 `hint` 提示，AI 会转述给你。

---

## 7. 已知限制（用前必读）

1. **overlay 保底模式会在主屏留一个小窗**：这是系统"模拟二级显示"的窗口本体（可以拖动），此时"完全不占主屏"要打折扣。想要干净的独立屏，请用 root 通道（`trusted` / `plain`）。
2. **熄屏行为待真机验证**：overlay 模式依赖亮屏合成，**熄屏挂机场景建议用 root 通道**（trusted/plain 与主屏独立，不受影响）。其他模式的熄屏表现以你机器实测为准。
3. **Android 17 是本项目首次验证的版本**：上游（Operit / deepseek-harness-android-app）实测到 Android 14–16；Android 17（API 37）上各策略的表现属于本项目首发验证范围，遇到问题请带 `android_vscreen_status` 的输出反馈。
4. **overlay 会话中途崩溃可能残留小窗**：正常 close / App 退出都会自动还原系统设置；万一 App 在 overlay 会话中途被系统强杀，主屏可能残留一个虚拟屏小窗。可任选其一手工还原：
   - 连上电脑 adb 后执行：`adb shell settings delete global overlay_display_devices`（如果改之前本来就有值，则用 `adb shell settings put global overlay_display_devices <原值>` 恢复）；
   - 或在开发者选项里找到"模拟二级显示"，手动关闭它。
   - 改动前 `adb shell settings get global overlay_display_devices` 可以先看看原值。
5. **截图速度**：overlay 模式下截图走系统截屏通道，比 trusted/plain 略慢（约半秒到一秒），连续看画面时会有明显节奏感。
6. **虚拟屏里的输入法**：部分系统弹窗（如输入法）在虚拟屏上的行为与主屏有差异，但 `android_type` 的语义写入路径不依赖键盘窗口停留在虚拟屏。
7. **虚拟屏输入不再依赖可见软键盘**：`android_screen` 会显式读取虚拟屏的语义树，`android_type` 优先对目标输入框执行语义写入并回读校验；系统输入法窗口仍可能留在主屏，属于后台虚拟屏的正常行为。语义写入不可用时才回退到带回读校验的 `KEYCODE_PASTE`。
8. **Android 17（API 37）实测结论（2026-09-13，Pixel 6 Pro）**：
   - root 通道 `trusted` 策略**全链路可用**（建屏 0.37s、tap/swipe/key/see/launch 全部通过，App 真实运行在虚拟屏且不抢主屏）；
   - **overlay 保底模式在 A17 上受限**：建屏可用、`input -d` 注入可用，但 `screencap -d` 截屏（root 亦然）与 shell 域 `am start --display` 被系统拒绝——即 **S3 回退在 A17 上暂无"看"的能力**（替代截屏方案已列入后续任务）；
   - **Shizuku 通道已补测通过（2026-09-13，荣耀 BKQ-AN10 / A17 / 无 root）**：无 root 时 App 自动选 Shizuku 通道，该 ROM 上直达最优的 trusted 策略（全能力含截图）。注意各 ROM 策略不一：Pixel 系（Android 15+）无 root 时会落到 overlay 保底（受限，见上一条）；
   - 3081 桥鉴权失败统一返回 HTTP 401 `{"ok":false,"error":"unauthorized"}`（与 /clipboard 等既有路由同一鉴权面）。

---

## 8. 与无障碍（a11y）工具的分工

本项目同时有两套"AI 操作手机"的工具，**同一时刻让目标 App 只待在其中一侧**：

| | 虚拟屏工具（`android_vscreen_*`） | 无障碍工具（`android_screen` / `android_tap` 等） |
|---|---|---|
| 操作对象 | **虚拟屏**上的 App（独立于主屏） | 虚拟屏模式开启时同样指向当前虚拟屏；关闭时指向主屏前台 App |
| 定位方式 | 坐标或语义；虚拟屏模式下 `android_screen` / `android_type` 会携带 displayId | 控件语义（按文字/描述点击，精度高） |
| 适合场景 | 挂机、并行、不占主屏；游戏/自绘界面等无控件标注的 App | 语义定位、输入与回读校验；虚拟屏下无需可见软键盘 |

**分工原则：同一个 App 只操作一个 display。** 虚拟屏模式开启时，`android_screen` / `android_tap` / `android_type` 等无障碍工具会自动透明路由到当前虚拟屏；不要再通过主屏坐标或特权输入操作同一个 App，避免两边竞态。

---

*虚拟屏功能的第三方合规声明见 [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。*
