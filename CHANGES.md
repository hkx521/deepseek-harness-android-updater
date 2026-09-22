## [未发布 - 批次97] - 2026-09-22：开源脱敏（签名口令移出源码 + .gitignore 补通配 + 真机标识占位）与「干净公开导出」（599 passed）

### 修复 / 变更
- **签名口令不再硬编码**（`tools/b47_build.py`）：改为 `_load_keystore_pass()` —— `KEYSTORE_PASS` 环境变量优先，回退 `.local/signing.env`；
  与原 `.local/` 镜像同步（双副本闸门 `tests/test_batch81_build_sync_hook.py`）。实测 `sign` 阶段仍出签名包。
- **`.gitignore` 补通配**：`*.jks` / `*.keystore` / `*.p12` / `*.pfx` / `*.env` / `signing.env` / `keystore.properties` + 托管 home 凭据文件名 + 工作区杂物（`AGENTS.md.bak.*`、`diff_*.txt`、`read_diff.ps1`）。
- **真机标识占位**：`OverlayService.java` 注释里的真机 serial、`tools/e2e_batch82_n8_flow_hang.py` 里硬编码的 `C:/Users/<用户名>/…`。
- **测试可移植性**：`tests/test_batch60_prompt_and_selection.py` 读 `.local/b47_build.py` 改为「工作区优先、缺失回退 `tools/b47_build.py`」（新克隆不再崩）。

### 验证
- `pytest` **599 passed**（工作区）；`javac_check` rc=0；`b47_build.py sign` ALL DONE。
- 另生成可公开副本 `.local/export-upload/`（单提交 / 2073 文件）：排除截图·取证物·开发日志·二维码·厂商私有通路文档，
  脱敏真机序列号/本机路径/邮箱/vendor `GOCSPX-`；**16 类模式扫描 0 命中**，导出内自测 **590 passed / 9 skipped**。
- 详见 `docs/批次97-开源脱敏与公开导出.md`。

### 续做（第二轮：全量字面量清理 + 导出重建 + 提交身份修正）

- **工作区全量脱敏**：一次替换 **186 处 / 89 文件**（三台真机 serial 141、`C:/Users/<本机用户名>` 7、本人邮箱 1、真实姓名与协调者代号 29、旧口令片段 3、打码拖尾 5）；
  含产品源码注释（`MainActivity.java`）与 12 篇协调者代号文档。真值清单仅存 `.local/b97_secrets.json`（gitignored），脚本不写死真值。
- **导出规则 v2**：收敛为「真值字面量 + 前缀锚定形态 + 占位符拖尾」；**修正过度脱敏**（第三方 `LICENSE` / `package.json` 的 `author` 邮箱不再被替换，MIT 署名保留）；
  vendor `dsh-agy` 内置 OAuth client secret 定点改写为 `process.env.AGY_CLIENT_SECRET || ""`（`node --check` rc=0）；导出副本显式写入 GitHub noreply 身份，
  **提交作者 = 提交者 = `hkx521 <hkx521@users.noreply.github.com>`**（不再继承本机真名/真邮箱）。

### 验证（第二轮）

- 导出重建：单提交 / **2073** 文件 / 工作树干净；`.local/b97_scan.py` v2 的 **22 条真值模式 0 命中（CLEAN）**；导出内 `pytest` **590 passed / 9 skipped**。
- 工作区：`pytest` **599 passed**、`javac_check` rc=0。

### 续做（第三轮：修掉脱敏自身引入的两处回退）

- **4 个真机 e2e 脚本 serial 恢复可覆盖**：`tools/e2e_keepalive_self_heal.py`、`tools/e2e_batch60_selection_and_chips.py`、
  `tools/e2e_batch66_lock_screen.py`、`tools/e2e_user_question.py` 统一改 `os.environ.get("ANDROID_SERIAL", "SN-HONOR-XXXX")`
  （前两个原本没有 `--serial`，占位符替换后必然失败）。
- **构建脚本口令改为按需读取**（`tools/b47_build.py`）：`KS_PASS = _load_keystore_pass()`（import 期强校验）→ `keystore_pass()` 惰性读取，
  于是 `r/j/d/res/pack` 无口令也能跑，只有 `sign` 阶段要求口令。

### 验证（第三轮）

- `py_compile` rc=0；`import tools/b47_build.py` 不再 SystemExit；`python tools/b47_build.py sign` **ALL DONE**；工作区 `pytest` **599 passed**。

### 续做（第四轮：导出 EOL 归一化 + 「内容等价 HEAD」自检）

- **CRLF 归一化**：导出文本文件统一以 LF 入库（依据：父仓库 **0 个文本 blob 含 CRLF**，含 CRLF 字节的 64 个文件全是二进制）⇒ 修掉「导出 126 个文本文件是 CRLF、上游是 LF」造成的整文件 diff 与无意义合并冲突。
- **新增导出自检**：用 `git cat-file --batch` 逐字节比对导出与父仓库 HEAD blob，只允许白名单不同；实测 **identical 2071 / changed 2**（`README.md` + vendor `dsh-agy/accounts-*.mjs`）。

### 验证（第四轮）

- 导出文本文件 CRLF = **0**；`.local/b97_scan.py` 22 条真值模式 **0 命中**；导出内 `pytest` **590 passed / 9 skipped**。

### 续做（第五轮：仓库归属 / 文档收缩 / 构建可移植化）

- **仓库归属**：README badge ×3、Releases ×3、Issues ×1 与 `MainActivity.java` 的更新检查 URL 由 `woaiys3/deepseek-harness-android-app` 改为 `hkx521/deepseek-harness-android-updater`；
  **上游署名保留**（`LICENSE` 版权行、`THIRD_PARTY_NOTICES.md`、README 致谢、插件注释）。
- **公开副本收缩**：不再发布 `AGENTS.md` 与内部 `docs/**`（批次文档 / STATE / PLAN-INDEX / journal / 截图 / 取证物 / 二维码 / 内部方案与审计报告），
  `docs/` 只留使用与贡献者文档（开发指南 / 启动排查 / vscreen 使用说明 / DSH更新与打包 / test-flows）⇒ 导出 **2073 → 1921** 文件（排除 235 条）。
- **构建可移植化**（`tools/b47_build.py`）：SDK 目录走 `ANDROID_HOME`/`ANDROID_SDK_ROOT` 回退；build-tools 可用 `ANDROID_BUILD_TOOLS` 覆盖（默认仍 36.1.0，不改本机工具链）；
  javac 走 `JAVAC` → 本机 Corretto → `JAVA_HOME` → `PATH`；**打印命令行时不再回显 `pass:<口令>`**（`_safe_args()`）。
- **README / CONTRIBUTING**：新增「从零构建：需要自备什么」依赖清单与两条构建路径；CONTRIBUTING 的 docs 行与 DSH 版本口径（`0.1.0-rc.6` → `0.1.5-rc.1`）纠正。
- **测试适配**：`tests/test_docs_contract.py` 3 条用例改为「缺内部文档即 skip」，公开副本不再 FAIL。

### 验证（第五轮）

- 工作区 `pytest` **599 passed** + `javac_check` rc=0；导出 **1921** 文件 / 单提交 / 22 条真值模式 **0 命中** / 导出内 `pytest` **587 passed / 12 skipped** / 与 HEAD blob 比对仅 2 处有意脱敏。

## [未发布 - 批次95] - 2026-09-22：root 托管常驻引擎（新功能）+ 特权环境/回落路径缺陷修复（真机 PASS=16/16 / 599 passed）

### 新增
- **托管引擎新增 root(su) 通道**（`HostedEngineManager`）：通道优先级 **root 优先 / Shizuku 兜底**（`activeChannel()`）；
  传输统一为 `runHost()`（root → `su -c <cmd>`；Shizuku → 原 `app_process rish`），类内 17 处 `shizukuRun(...)` 全部改走它；
  `ROOT_AVAILABLE` 按通道取值（root=1）+ 新增 `DSH_HOSTED_CHANNEL`；staging 指纹带通道（`hostedStamp`，幂等）⇒ 通道切换自动重新 staging。
  引擎以 **uid 0 + setsid（PPID=1）** 常驻 `/data/local/tmp/dsh`；staging、看护脚本、停止/清理全部复用既有链路；
  无通道时 `startEngine` 返回 `NO_HOST_CHANNEL` 并回退 App 内引擎；托管期仍强制开启危险操作审批门。
- 新增契约测试 `tests/test_batch95_root_hosted_engine.py`（19 条）与真机回归 `tools/e2e_batch95_root_hosted.py`（A1~A6，16 条判据）。

### 修复
- **定时任务引擎特权环境被写死为 0**（`ScheduleExecutor`）：`SHIZUKU_AVAILABLE`/`ROOT_AVAILABLE` 改为与主引擎同口径探测，并补注 `SHIZUKU_DEX`
  ⇒ 到点自拉引擎时插件不再于注册期跳过整族特权工具。
- **App 内回落路径「dsh bin.js missing」空转**（`MainActivity.spawnNode`）：托管模式下 `dshrootDir` 可能未被赋值，而 `new File(null, child)` 得到相对路径（不抛 NPE）
  ⇒ 内层看门狗每 20s 空转。现兜底解析 + 缺文件时重解一次 + 回退外部目录。

### 变更
- 展示口径：`HostedEngineManager.modeLabel()` = 托管(root) / 托管(shell) / App 内（MainActivity 记录与面板 ⓘ 共用）；保活自检「引擎托管常驻」身份词按真实通道；
  `Status.channel` + 日志 `[b67] hosted engine ready ch=<通道> uid=<0|2000>`。
- root 探测口径收敛到 `HostedEngineManager.probeRootNow()/rootReady()`（唯一实现 + 60s TTL），MainActivity 旧副本删除。

### 验证
- 离线：`pytest` **599 passed**（新增 19 条 + 更新批次67/78 两处旧口径断言）；`javac_check` rc=0；`b47_build.py all` ALL DONE + 签名 APK 装机。
- 真机（Pixel 6 Pro / SukiSU Ultra 4.1.3）：`tools/e2e_batch95_root_hosted.py` **PASS=16 FAIL=0** —— 引擎 uid=0 / PPID=1 / 3080 属主 uid=0 / 看护 root 常驻 /
  `ROOT_AVAILABLE=1`+`DSH_HOSTED_CHANNEL=root` / force-stop 后引擎 pid 不变且端口仍在 / **App 不在场时 kill -9 由 shell 看护复活**（state=RESTART + `revive ok`）/
  `action_hosted_cleanup` 后引擎与运行目录全清 / 冷启再次以 root 托管。
- 详见 `docs/批次95-root托管常驻引擎与特权环境修复.md`。

## [未发布 - 批次93] - 2026-09-22：入场起点口径实测（「为什么不能从灵动胶囊的位置展开」）+ 起点胶囊填满修复（装机真机 PASS / 581 passed）

### 修复
- **起点胶囊顶端 28px 是空的**（真机直证：材质自 y≈168 起，而窗口顶边在 136 ⇒ 顶边是平口、胶囊看着矮一截）。
  根因：屏幕空间补偿把材质**钉在静止屏幕位置**（`cdy = -squashTy`），而材质可绘制范围受 View 自身 bounds 裁剪 ⇒
  被抬起的起点窗口与材质区不重叠。改为 **`cdy = 0f`（材质随窗口走）** 后材质自 **y≈140** 起、圆头完整。

### 变更 / 实测结论（用户：「为什么不能是从灵动胶囊的位置展开，这样不是更自然吗」）
- **先量再答**：本机系统灵动胶囊 562×114px 落在状态栏内 **y 22..135**（状态栏高 136px）。
- **实测把起点搬过去会怎样**（新增探针 `flow_origin`，A/B 同包对比）：形状摆到 y 31..136 时，那一带屏幕上
  **看不到任何面板材质**（与基准帧差异低于噪声阈值），面板只有从 y≈136 往下才可见 ⇒ **系统状态栏窗口层级在我们之上**
  （本机呼出瞬间系统还会补一层不透明底，批次83 已记录），App 浮动窗口画不进那条带。
- 落地：起点位移集中到新方法 `flowStartTranslateY()`；默认口径 = **贴状态栏下缘**（= 系统胶囊正下方，App 侧能做到的最近位置）；
  「与系统胶囊同带」保留为常量 + 探针，代码注释写明实测不可用。

### 验证（真机 SN-HONOR-XXXX，装机）
- 默认口径复测：起点胶囊材质自 y≈140 起、完整圆头、紧贴状态栏下沿（`docs/screenshots/批次93/`）。
- 帧耗时：单轮呼出 `dumpsys gfxinfo` **88 帧 / janky 0（0.00%）/ P50 5ms / P90 5ms / P99 15ms**。
- 离线：**pytest 581 passed**（新增 `tests/test_batch93_capsule_origin.py` 5 条）；`javac_check` rc=0；签名 APK 202,249,445 B + 装机。


## [未发布 - 批次92] - 2026-09-22：助手入场动效重设计 —— 对齐系统「灵动胶囊展开」（装机真机 PASS / 576 passed）

### 变更（用户：「现在没黑影了但是依然不好看…就没有那种很流畅的出场动画吗，就像系统的灵动胶囊展开的样子…好好参考设计一下」）
- **先量参考再设计**：真机实测本机系统计时器灵动胶囊 → 点开（`.local/b91_capsule3.py`，pts 逐帧）：胶囊 **562×114px（160.6×32.6dp）**、
  展开总长 **~700ms**（生长 ~400ms + 回落 ~300ms）、宽度 548→**1246**→回落 **1208px**（速度呈**钟形**=缓入缓出，末段过冲 **+3.1%**）、高度 114→292→**263px**、圆角全程 **~60→107px 保持圆形**。
- **旧实现的三个结构性缺陷**：① 起点是 104dp × **8dp** 细缝且停留 110ms（「先空一拍」）；② 各向异性 scale 把本地圆角竖向压成椭圆（38px×3px ⇒ 两端看着是直角）；
  ③ 同一变换把「整张桌面快照」压进细缝（批次90/91 的顶端阴影根源）。
- **重做后的规格（批次92，参数全部外置 `FLOW_*`）**：起点 = **152dp × 30dp 胶囊圆头**（顶边贴状态栏下缘，与系统胶囊底边对齐）⇒
  ①铺开 0→180ms 横向到全宽（emphasized-decelerate）+高度微涨、②垂落 180→520ms 高度**缓入缓出**到 1.012×（对齐系统过冲量级）、
  ③定形 520→660ms 回落 1.0；内容 **200→480ms** 渐显并 **+16dp 上浮**到位。
- **技术核心 = 屏幕空间补偿**（`PanelGlassDrawable`）：形变期 ① 圆角按屏幕空间反解成本地**两轴半径**
  （`rScreen = min(26dp, min(w·sx, h·sy)/2)`，`rx=rScreen/sx`、`ry=rScreen/sy`）⇒ 细缝两端是真圆头、长到全尺寸自动收敛回 26dp；
  ② 材质先逆掉形变（`scale(1/sx,1/sy)` + `translate((sx−1)·w/2, −ty)`）再按静止态坐标画 ⇒ 细缝里是**真正背后的桌面**（玻璃窗口）。
  姿态 (sx, sy, ty) 由服务侧逐帧推入并留真相源（同批次91 机制）⇒ 背景图回调重建 drawable 后立刻复位。

### 验证（真机 SN-HONOR-XXXX，装机）
- 生命周期：`total=660ms` 日志与 `squashed=true →(660ms)→ false` 实测一致。
- 起点姿态：首帧轮廓实测 **525 × ~105 px**（= 设计值）；圆角拟合 **R ≈ 52px = 半高**（真圆头）；胶囊内部像素 **= 0.72 × 同位置桌面**（实测 0x6a767a vs 预测 0x6f7879）⇒ 玻璃窗口成立。
- 帧耗时：窄窗 `dumpsys gfxinfo` **109 帧 / janky 1（0.92%）/ P50 8ms / P90 13ms / P99 16ms**。
- 离线：**pytest 576 passed**（新增 `tests/test_batch92_capsule_expand.py` 6 条；`test_batch82_n8_flow_hang.py` 同步到新规格）；`javac_check` rc=0；签名 APK 202,249,445 B + 装机。
- 证据：`docs/screenshots/批次92/`（参考胶囊 / 起点胶囊 / 稳定态）。
- **诚实边界**：① 夜档 tint 均匀 ⇒ 「补偿窗口」与「平铺 tint」像素几乎同解，本次可见差别在**形状/起点/节奏/内容上浮**；
  ② **收起动效（260ms）仍是旧路径**（非逐帧驱动，拿不到姿态，维持「跳过背景位图」）；③ 面板高度 30dp→1655px 的缩放倍数远大于系统（32.6dp→263px），属「竖卡 vs 横条」固有差异。


## [未发布 - 批次91] - 2026-09-22：呼出顶端阴影（批次90 的缩扁态闸门从未生效）修复（装机真机 PASS / 570 passed）

### 修复（用户：「继续修 主要的问题是小鲸鱼助手出现的过程中最上边的这片阴影」；只修这一个缺陷）
- **根因（已确认，两条独立真机证据）**：批次90 在 `PanelGlassDrawable.draw()` 里加的 `entranceSquashed` 闸门**一次都没生效** ——
  `openAssistantCapsule()` 置位 `true` 后，下一帧 `playFlowHangEnter()` 第一句 `cancelFlowAnimator()` 里就有批次90 写的
  `setEntranceSquashedOnBackground(false)`（「打断 ⇒ 退出缩扁态」语义）⇒ **缩扁态在动效起跑前被清掉**，整段 540ms 照旧把
  整张桌面快照压扁进细缝（= 用户看到的顶端阴影）。
  - 日志直证：`refractionShader()` 只在背景分支绘制时调用，而装机日志里动效第 **3ms** 就打出 `[b83] AGSL refraction shader ready`。
  - 像素直证：同姿态条带 vs「0.72 × 桌面」模型 —— 修复前 MAE **34.1** / corr **0.13~0.30**；修复后 MAE **2.5** / corr **0.998~0.999**。
- **修复**：① 服务侧新增真相源字段 `entranceSquashedActive`，`setEntranceSquashedOnBackground()` 记录值并打 `[b91] entrance squashed=` 日志；
  ② `playFlowHangEnter()` / `applyFlowSeepPose()` 在 `cancelFlowAnimator()` **之后**重新置位（这两处摆的就是缩扁姿态）；
  ③ `applyPanelGlass()` 重建 drawable 后按真相源复位（消灭「置位 → 后台截屏回调重建 drawable → 又画压扁快照」的竞态）；
  ④ 缩扁态不画背景 ⇒ 折射 shader 首编译被推迟到动效结束那一帧，故新增 `PanelGlassDrawable.warmRefraction()` +
  `warmPanelGlassRefraction()`，在 `anim.start()` 后与「背景位图到位（retarget）」两处预热。

### 验证（真机 SN-HONOR-XXXX，装机）
- 连续 3 轮呼出：生命周期日志 `true → false → true →(540ms)→ false` 时序一致；每轮动效中段条带 MAE 2.3~2.5 / corr 0.996~0.999（183 帧逐帧跑模型）。
- 帧耗时：窄窗口 `dumpsys gfxinfo` **72 帧 / janky 0（0.00%）/ P50 5ms / P99 8ms**（静息对照窗 0 janky）⇒ 预热生效、动效结束帧无掉帧。
- 稳定态无回归：修复前后同姿态面板区 MAE 1.06 / corr 0.999（同录屏噪声下限 0.14）。
- 离线：**pytest 570 passed**（564 + `tests/test_batch91_entrance_squash_lifecycle.py` 6 条）；`javac_check` rc=0；`b47_build.py all` → 签名 APK 202,249,445 B。
  提交前把 `warmRefraction()` 从字段区挪到 setter 区（纯位置调整）后**重新构建 + 重装 + 复验一轮**（日志与像素结论不变），保证「已提交源码 == 已装机验证产物」。
- 证据图：`docs/screenshots/批次91/`（修复前/后对照 4 张）。
- **诚实边界**：① 夜档玻璃档 28% 黑 + 描边 alpha=0（入场「棱边高光」本身是空操作），细缝仍是干净的半透暗条而非带棱边的玻璃液滴 —— 若仍嫌像阴影属**材质设计改动**，需用户拍板；
  ② **收起动效（260ms）仍是同类缺陷**（`setScaleX(0.28)/setScaleY(0.08)` 时闸门为 false），本批按用户报告只修「出现的过程」。


## [未发布 - 批次90] - 2026-09-21：呼出顶端阴影（整张桌面快照被压扁进细缝）修复（装机真机 PASS / 564 passed）

### 修复（用户：「主要的问题是小鲸鱼助手出现的过程中最上边的这片阴影，不好看」；只修这一个缺陷）
- **根因（已确认，逐帧像素证据）**：`PanelGlassDrawable.draw()` 按 `getBounds()` 全尺寸（1144×1655）把**整张桌面快照**（1228×1739）画进面板矩形；
  入场「三段式流挂」动效把 `panelView` 压到 scaleX=0.318 / scaleY=0.017 ⇒ 画布变换把整张桌面快照**整张压扁进细缝**（桌面灰带）= 用户看到的「顶部阴影」。
  逐帧相关度对比（面板矩形内）：预测「整张桌面压扁」corr **+0.65 ~ +0.69** vs 预测「该位置 1:1」corr **+0.09 ~ +0.56**，6 帧全部前者胜（修复前 `.local/z.mp4`）。
  与批次89 是**不同**缺陷：批次89 修的是同一动效期的掉帧与圆角跳变（换 drawable 实例导致 AGSL 重编译）；本批修的是「背景位图在压扁的变换下不该画」。
- **修复**：`PanelGlassDrawable` 增加 `entranceSquashed` 字段 + setter，`draw()` 增加 `final boolean drawBackdrop = !entranceSquashed;` 门 ⇒ 入场动效期间不画背景位图，只画 tint 渐变 + 棱边；
  动效结束（`restorePanelGlassAndLayout()`）或被打断（`cancelFlowAnimator()`）时复位并恢复完整 AGSL 渲染。服务侧新增 `setEntranceSquashedOnBackground(boolean)`，3 处调用点。
  静态路径（无动效）与自动展开（`autoExpandAfterTask`）路径行为不变。

### 验证（真机 SN-HONOR-XXXX，装机）
- 动效期顶部条带（x 136~170 / y 400~900）灰度均值 **~108 → ~140**，与 `GLASS_FILL_TOP_NIGHT (0x47000000)` + 桌面透过率 ~0.72 的理论值吻合；
  修复前同位置可看到桌面图标/音乐卡片/Launcher 被压扁的灰带（corr(A) +0.69 vs corr(B) +0.19）。
- 连续 3 轮「面板收起 → 呼出」复测：玻璃质感稳定，顶部无桌面灰带。
- 离线：**pytest 564 passed**（558 + 新增 `tests/test_batch90_entrance_glass_squash.py` 6 条）；`python .local/b47_build.py all` → 签名 APK 202,249,445 B。
- **诚实边界**：细缝仍不像静止时那么清晰，属「流挂」出液设计本身（8dp 高细缝），不在本批改动范围；卡片内图标与文字仍按 N8 设计延后 110ms 渐显。

## [未发布 - 批次89] - 2026-09-21：呼出「顶端卡顿一下」根因修复（装机真机 PASS / 558 passed）

### 修复（用户：「换出小鲸鱼助手的瞬间，小鲸鱼的顶部会卡顿一下，看起来不好看」；只修这一个缺陷）
- **根因（已确认，非推测）**：入场「三段式流挂」动效（540ms）进行中，后台无障碍截屏回调落地并调用
  `applyPanelGlass()`，它每次都 `panelView.setBackground(buildPanelGlass())` **新建** `PanelGlassDrawable`；
  而 `GlassRefractor`（持有已编译 `RuntimeShader`）与 `contentShader`（`BitmapShader`）都是**绑在 drawable 实例上的字段**
  ⇒ 换实例即全部丢失，新 drawable 首帧要**重编译 AGSL + 重建 BitmapShader**（真机该帧 UI **20.3ms**，掉一帧）；
  同时 `buildPanelGlass()` 把 `cornerRadiusPx` / `strokeColor` 写回**静态终值**，打断 `onAnimationUpdate` 的逐帧插值
  （圆角 16→34→26dp、棱边高光 0.85→1.0）⇒ 顶端轮廓跳一下。截图往返 120~250ms 与 540ms 动效窗口**必然重叠**，故每次呼出都发生。
- **日志直证**：同一次呼出出现**两次** `[b83] AGSL refraction shader ready`（该日志只在 `GlassRefractor.init()` 打），
  第二次落在动效第 123ms（`flow-hang enter` 19:10:36.424 → `AGSL ready` 19:10:36.547）。
- **修复**：`applyPanelGlass()` 增加分支 —— 动效在飞时改走新增的 `retargetPanelGlassInPlace()`：复用**现有** drawable
  （`setBackdrop`/`setRefraction` 只置 `contentBitmap=null`，`refractor` 保留 ⇒ **不重编译**），且**不碰**动效正在插值的
  `cornerRadiusPx`/`strokeColor`；填充档按 `buildPanelGlass()` 同一口径取（兜底档 ↔ 玻璃档双向可切）。无动效时仍走原整块重建路径。

### 验证（真机 SN-HONOR-XXXX，装机）
- 修复后同一路径只剩服务启动那一次 `AGSL ready`，落地改为 `[b89] glass retargeted in place (entrance anim running)`；
- 逐帧 UI 耗时（冷启动首次呼出，同一 dump 口径）：截图回调落地那一帧 **20.3ms → 14.3ms（不再掉帧）**；
  连续 3 轮「面板收起 → 呼出」复测：动效窗口内除首帧外全部 **≤2.7ms**，无中段尖峰；
- 视觉：逐帧抽取 110–430px 顶部条带，细缝→垂落→定形三段轮廓连续，顶端圆角不再跳变；
- **已证伪三项假设**（避免改错地方）：AGSL 折射/色散太贵（`--ei glass_refract 0` A/B 无差异）、
  主线程同步 `takeScreenshot` 是元凶（`--ei glass_backdrop 0` A/B 同量级）、玻璃底「把整幅背景压进细缝」（预测相关≈0）；
- 离线：**pytest 558 passed**（553 + 新增 `tests/test_batch89_entrance_glass_retarget.py` 5 条）/ `b47_build.py all` → 签名 APK 202,249,445 B。
- **诚实边界**：`tools/e2e_batch82_n8_flow_hang.py` 仍报 `V2_first_stage_small: false`，与本次改动**无关**（改动前同样 FAIL；
  出液段首个可检测帧宽度 ≈366px > 峰值 25% 阈值），其余 V1/V3/V4（含两条棱线判据）全绿。
## [未发布 - 批次88] - 2026-09-21：定时任务与多任务管理缺陷修复（装机真机 PASS / 553 passed）

### 修复（用户明确要求「把定时任务做好，多任务管理做好」；只修现有缺陷，不加新功能）
- **D1（P0 数据错）管理页「最近执行记录」读错日志文件** —— `scheduledLogFile()` 返回**内部**私有目录，而到点执行（`ScheduleExecutor.log` / `AlarmReceiver`）写**外部** `/sdcard/DeepSeekHarness/scheduled-log.txt` ⇒ 页面**永远看不到到点执行的真实结果**。改为返回外部路径（与同页 `recentTriggerLog` 同口径）。真机：修后记录出现「任务已发送给 AI: 请分 5 步执行…」。
- **D7（P0 数据错）非法时间被静默归一化** —— `SimpleDateFormat` 默认 lenient；真机实测 `when=99:99` → `ok:true, at:"11小时20分钟后"`（**静默建出次日 04:39 的任务**）。新增 `parseScheduleWhenStrict()`（`setLenient(false)` + HH:mm 范围校验 + 中文错误）；修后返回 `ok:false + 中文提示`，合法 `23:59` 仍正常。
- **D4** 到点前等引擎 30s → **90s**（与 `waitForServer` 对齐）；真机日志留证过两条「引擎 30 秒未就绪，放弃」。
- **D5** 三条失败路径（引擎启动失败 / 未就绪 / 建会话失败）补 `notifyResult` ⇒ 失败不再静默。
- **D8** 「重排全部闹钟」不再调会重读文件的 `rewriteScheduledTasks`，改用新增的 `writeScheduledTasksAll()` 整表落盘（原先内存里更新的时刻被丢弃，列表与实际闹钟不一致）。
- **D9** `AlarmReceiver` 的 daily 迟到 >24h 时改为 while 顺延（原先守卫不成立 ⇒ **静默停止重复**）。
- **D13** 管理页页脚新增「**清理已过期**」批量操作（原先只能逐条删）。真机：一次清空 5 条过期任务。
- **D2** 删零调用死代码 `takeDueScheduledTasks()`（34 行）。

### 验证
- 离线：**pytest 553 passed**（542 + 新增 `tests/test_batch88_schedule_defects.py` 11 条）/ `javac_check` rc=0 errors=0 / `b47_build.py all` → 签名 APK 202,249,445 B。
- 装机真机（SN-HONOR-XXXX）：非法时间被拒 + 合法时间正常 / 执行记录出现真实到点结果 / 一键清理 5 条过期 / `dumpsys alarm` 4 条闹钟并存（每任务一条）/ 收尾复原（列表清空、闹钟回 1 条）。
- **证伪一条**：审计子代理报的「装机后闹钟全丢」经实测**不成立**（`adb install -r` 后任务闹钟仍在），故未改 `BootReceiver`。

### 边界（未修，见方案 §4）
- D3 真关机后重排（未测，需 ~30 行）/ D6「重试」按钮（**实测「立即执行」就是重试**，按「不做多余功能」不加）/ D10 引擎 spawn 单飞 / D11 任务文件条数上限 / D12 `setAlarmClock` 状态栏图标。

### 产品范围纪律（用户 2026-09-21 划定，写入项目 AGENTS.md）
- 只做「修现有功能缺陷」与「让现有功能更好用」；**明确拒绝**系统控制类动作（静音/勿扰/亮度/音量/WiFi/蓝牙）、事件触发器（保持已撤下）、面板状态视图、其他新能力。**批次87 的「直连动作层」作废**。

## [未发布 - 批次86-P0/P1/P2/P3] - 2026-09-21：重审瘦身落地（文字 / 入口 / 多余 / 死代码；装机真机 PASS / 542 passed）

### 修复（用户可见）
- **字面转义（反斜杠 u + 四位十六进制）双重转义** —— 用户「显示的文字也存在问题」属实：定时任务管理页把任务文本渲染成字面转义。新增 MainActivity.unescapeJson()（反斜杠 + u 转义 + 标准短转义；**认不出的转义保留反斜杠**，避免改坏 Windows 路径），jsonField / queryField / parseScheduledLine 统一解码 ⇒ 页面显示真中文，**且本机 5 条历史旧任务读盘即自愈**（无需重建）。行为验证：抽方法编译跑 **8/8 PASS**；真机 3181 dump 逐字对照通过。
- **「悬浮球」文案 35 处**（球形态批次60 已废除）：保活自检入口行/卡片标题、权限页「应用启动管理」描述、屏幕熄灭提示、插件 SCREEN_OFF_HINT，以及判据名「球自启开关」→「自启动开关」、「悬浮球服务」→「后台服务」；偏好键 ball_autostart 不动。真机 dump：卡片「保活自检（后台常驻）」+「✓ 保活自检 OK · 12/12」明细为新判据名。
- **权限页「存储权限 / 所有文件访问」二选一 confusion** → 合并为「存储与文件访问」一行（状态取二者或，点击按缺的那环走）。

### 变更（砍多余）
- **设置弹窗撤下「⚡事件触发器」入口行**（用户「这些事件有什么用」；动作侧只有「交给 AI」一种，做不了「插电→静音」）：引擎 / TriggerReceiver / android_trigger / trigger 路由 / 管理页全部保留，等有 ≥3 个真实动作场景再回 UI。
- **chroot 四件按设备能力注册**（android_chroot_exec / chroot_job / task_list / task_resume）：判据 = ROOT_AVAILABLE=1 或 rootfs 已在位；本机两条都不成立 ⇒ 不进工具表，root 机器行为不变，**代码零删除**。⚠ 方案原前提被实测修正：android_sms / calllog / contacts / location 在本机**可用**（content query 实测返回真实短信正文与通话记录），保持注册并补反向契约。
- **三条死路由删除**（/open-url、/open-file、/wakelock 及连带 4 个方法/字段，**-271 行**）：全仓零调用方；路由分支保留明确拒绝响应，避免落到 notify 兜底被误当「发通知」。
- 三个无入口脚本 git mv 到 tools/attic/（新增 README 说明下线理由）；回归入口口径改为 pytest + tools/e2e_*.py。

### 新增（补入口）
- 定时任务管理页：「**＋ 新建任务**」+ 每条「**编辑**」+ 表单（内容 / 触发时间 + 三个快捷 chip / 重复方式三态 + 间隔输入），带默认值（+10 分钟 / 一次 / 60）。
- 表单直调重构出的 createScheduledTask(...)（与 /schedule 共用同一条链路，**不经 JSON 往返**）；编辑 = 取消旧闹钟 + 删旧行 + 建新行。

### 验证
- 离线：**pytest 542 passed**（新增 12 + 9 条契约）；javac_check rc=0（errors=0）；两插件 node --check rc=0；行为型 node 用例 5/5 PASS。
- 装机：b47_build.py all → 签名 APK **202,249,445 B** → adb install -r 成功；真机（SN-HONOR-XXXX）逐项：文字修复（dump 逐字对照）、触发器行消失、新建/编辑表单全链路（含中文 + 弯引号落盘与显示、+1 小时改期无重复行）、权限页合并、保活卡片文案；截图 docs/screenshots/批次86/batch86-P0-1文字修复与P1新建编辑入口.png。
- 方案文档执行记录：docs/批次86-重审与瘦身方案.md §5。

## [未发布 - 批次86-P3a] - 2026-09-21：删死代码（第一批）+ 契约同步

### 变更（执行 docs/批次86-重审与瘦身方案.md 的 P3-1）
- 删 13 个**零引用**符号（批次85 §3 已核、本轮 symcheck 复核 refs=0）：`MainActivity.hideProgress`、`OverlayService.cardBgColor/cardBorderColor/runInfoOnSystemCapsule/saveFloatPosition` 等悬浮球遗留字段与方法、`AccessibilityService.putCoord/isWebViewNode` 等；`BootReceiver` 注释去「悬浮球坐标」残留。
- 契约同步：`tests/test_m1_overlay_source.py` 的批次40 玻璃材质断言（`0xD9161D2B`/`0x4DFFFFFF`）更新为批次83 令牌（`GLASS_FILL_TOP_DAY = 0x99FFFFFF` / `GLASS_HL_ALPHA = 0.29f` / `GLASS_REFRACT_BAND_DP = 12`）—— 旧常量随死代码清理删除，测试改为断言现存玻璃令牌。

### 验证
- `pytest tests/ -q` → **521 passed**；`b47_build.py all` → ALL DONE → 装机。
- N8 e2e 一度 FAIL —— 排查为 **R4 遗留的 AI 追问弹窗盖住面板**（引擎在等「息屏 5 步测试」的答复，弹窗遮罩使 diff 掩码量出 settled_width=452），force-stop App 清掉待办后 **PASS**（settled_width=915、V4_rim_left/right 均 true）。这个「待答复弹窗会遮面板 + 重启后仍在」本身记为待修 UX 问题（见批次86 方案排期）。

### 边界
- 特权工具按设备能力探测注册（P2-1）、触发器入口撤下（P0-3）、定时任务「新建/编辑」表单（P1-1）仍待执行 —— 见 docs/批次86-重审与瘦身方案.md。

## [未发布 - 批次85-R4] - 2026-09-20：事件触发器（Trigger）MVP —— 自动化从「定时」升级为「事件驱动」（装机真机 PASS / 521 passed）

### 新增
- **`TriggerEngine.java`**：13 个事件（接通/断开电源、电量低/恢复、屏幕亮/灭、插入/拔出耳机、网络连通/断开、安装/卸载/更新应用）× 任意动作；
  `triggers.txt` 存储（`id|event|match|text|enabled|cooldownSec|lastFiredMs`）、CRUD、事件分发、冷却防抖、`ensureRegistered` 幂等注册。
- **`TriggerReceiver.java`**：**清单注册**入口（包安装/卸载/替换 —— Android 8+ 隐式广播例外名单，App 进程未运行时也能被拉起）。
- **`MainActivity`**：设置弹窗新增「⚡ 事件触发器」入口行；**触发器管理页** = 触发器列表（事件 + 匹配 + 动作 + 冷却 + 上次触发）+ 每条「测试 / 启停 / 删除」+ 最近触发记录 + **事件清单（点任一 = 手动模拟该事件）**；新增 `/trigger` 路由。
- **插件 `android_trigger`**（`dsh-tool-shizuku`）：action = list / events / add / remove / enable / disable / fire / test。
- 新增契约 `tests/test_batch85_r4_triggers.py`（9 条）。

### 关键取舍（真机取证）
- **电源/电量不用 `ACTION_POWER_CONNECTED` / `ACTION_BATTERY_LOW`**：二者不在 Android 8+ 隐式广播例外名单（本机实测 `am broadcast` 直接 `SecurityException`），改为 sticky 的 `ACTION_BATTERY_CHANGED` + 边沿判定（持久化上次状态）。
- **包事件走清单注册**：真机实测「重装本 App → `MY_PACKAGE_REPLACED` → 触发器命中」，**进程被杀状态**下也被拉起。
- **动作复用 `ScheduleExecutor.execute`**（起线程、不阻塞广播主线程），与定时任务共享同一条执行链与日志。

### 顺带修（本轮 e2e 由 PASS 变 FAIL，逐层查清：前两条是真缺陷，第三条是量具缺陷）
- **F5**：`dispatch()` 在**空触发器**时也会 `writeAll()` —— `ACTION_BATTERY_CHANGED` 是 sticky 高频广播且 `onReceive` 在主线程 ⇒ 充电时持续主线程写盘。改为 `rows.isEmpty()` 直接 return + 只在真有命中时回写。
- **F6**：`handle()` 每次广播都读 `SharedPreferences` ⇒ 加前置短路 + `readAll` **进程内缓存**（`volatile CACHE`，写时同步，返回副本）。
- **F7（量具）**：`tools/e2e_batch82_n8_flow_hang.py` 的 `V4_final_centered` 用「diff 掩码连续段中点」，而面板中段是**透明玻璃**（批次83 定稿材质）⇒ 掩码成片空洞使中点漂移，且对**桌面壁纸**敏感（实测两次运行间壁纸由紫换绿，`settled cxb` 542.9 → 575.5）。
  已改为量 **面板玻璃棱线**（每行局部高光峰取中位数）并新增 `V4_rim_left` / `V4_rim_right`；改后**连续 4 次 PASS**。
- **F8（UI）**：设置弹窗用 `WRAP_CONTENT` 不滚动，入口行随批次增长后被**静默裁到屏外**（本轮新入口即「代码在、看不见」）⇒ 已包 `ScrollView` + 限高。

### 验证（真机 SN-HONOR-XXXX，装机）
- 管理页 dump：13 个事件 chip + 列表 + 最近记录齐全 ✓；`dumpsys package` 确认 `.TriggerReceiver` 及其 filter（含 `Scheme: package`）✓；logcat `[b85r4] runtime receivers registered` ✓。
- **真实事件 A** `package_replaced`：重装本 App → 日志 `触发器命中: 应用被更新 → R4-E2E…` → `开始执行任务` ✓（进程被杀下被拉起）。
- **真实事件 B** `screen_off`：`input keyevent KEYCODE_SLEEP` → 日志 `触发器命中: 屏幕熄灭 → R4-E2E…` → `任务已发送给 AI` ✓。
- `/trigger` 全部 action 实测可用 ✓；自测触发器已全部删除（`count:0`）✓。
- `pytest tests/ -q` → **521 passed**；`b47_build.py all` → 装机；`node --check` ✓；`sync_base_apk_plugins.py` → 8 文件同步 ✓；N8 e2e **PASS ×4**。
- 归档图：`docs/screenshots/批次85/batch85-R4-事件触发器.png`、`batch85-R4-事件清单.png`。

### 边界 / 后续
- 动作类型目前只有「交给 AI 执行」（复用定时任务链路）；「直接调系统动作（静音/亮度/WiFi）」需另立动作层，见批次85 §4-R4 的后续。
- 触发器事件依赖系统广播，实际触发可能比真实事件晚数秒。

## [未发布 - 批次85-R2] - 2026-09-20：定时任务管理页（装机真机 PASS / 512 passed）+ 顺带修 3 个真缺陷

### 新增
- **定时任务管理页**（设置弹窗新增入口行 → 全屏对话框）：任务列表（文本 + 重复方式 + 下次触发时刻/倒计时 + 已过期/已停用标记）、每条 **立即执行 / 启用·停用 / 删除**、**最近执行记录**（最近 6 条，来自 `scheduled-log.txt`）、**重排全部闹钟**；排序 = 启用未到期（按时间升序）→ 已过期 → 已停用。
- 「立即执行」复用既有链路（`pendingScheduledTask` + `executePendingScheduledTask`）；每个动作都写 `scheduled-log.txt`。

### 修复（本轮真机实测暴露）
- **F1 多任务互相覆盖**：`/schedule` 用固定 `requestCode = 0` 注册闹钟，而 `PendingIntent.filterEquals` **忽略 extras** ⇒ 后建任务顶掉前一个。改为 `taskId.hashCode()`，并新增 `cancelLegacyScheduledAlarm()` 清理旧实现遗留的那条。
- **F2 `repeat`/`intervalMin` 工具面不可达**：`android_schedule` 只传 text/when ⇒ 用户说「每天 8 点」只会建一次性任务。插件 schema 补参数并透传（`dsh-tool-shizuku`）。
- **F3 `interval` 永远报「缺少 intervalMin」**：① 该字段 schema 是 number，JSON 里是裸数字，`jsonField` 只认 `"60"`；② `jsonField` 遇到裸数字会抓**下一个引号串**当值（实测把 `"when"` 抓成 intervalMin）。数值字段改为**先** `jsonNumField` 再退回 `jsonField`，并新增 `leadingInt()` 取前缀整数。
- **F4 管理页「引擎」恒显示离线**：`HostedEngineManager.engineOnline()` 在主线程调用，`NetworkOnMainThreadException` 被 catch 吞掉。改为后台线程 + `runOnUiThread` 回填。

### 验证（真机 SN-HONOR-XXXX，装机）
- 列表/倒计时/排序 ✓；引擎状态 `在线` ✓；停用→按钮变「启用」、启用→恢复 ✓；立即执行 → 日志 `手动执行任务 → 开始自动执行任务 → 任务已发送给 AI 执行`（全链路通）✓；删除 ✓。
- `/schedule` 直发：`daily+when=08:30` → `每天`；`interval+intervalMin="60"` 与裸数字 `60` → 均 `每60分钟`（修复前裸数字报错）✓。
- F1：注册两次后 `dumpsys alarm` 出现**两条独立 AlarmReceiver 闹钟**（修复前会顶掉）✓。
- `pytest tests/ -q` → **512 passed**（新增 6 条）；`b47_build.py all` → 装机 + 无障碍重设；`node --check` ✓；`tools/sync_base_apk_plugins.py` → 8 个插件文件同步 ✓；
  `tools/e2e_batch82_n8_flow_hang.py` → **PASS**（onset 1.920s / ramp **153ms**）。
- 自测残留**已复原**：设置页摘要由 `共 14 条` 回到 `共 5 条（启用 5）`，AlarmReceiver 闹钟 19 → 12。
- 归档图：`docs/screenshots/批次85/batch85-R2-定时任务管理页.png`。

### 边界
- 管理页目前在主界面设置弹窗内；桌面小组件/快捷方式入口见 R5（未做）。

## [未发布 - 批次85-R1b/R3] - 2026-09-20：设置弹窗加「配置手机权限」入口 + 「危险操作审批门」现状行（装机真机 PASS / 506 passed）

### 新增
- **R1b 配置手机权限入口**：设置弹窗新增一行（点击 → `showPermissionScreen(true)`）；`showPermissionScreen` 拆出 `(boolean revisit)` 重载 ——
  revisit 时标题「配置手机权限」、底部按钮「返回」、**不写 `setup_done`**，让首次使用页可以常驻复用。
- **R3 危险操作审批门可见可切**：设置弹窗新增一行，显示「当前生效 + 你的设置」，点此切换；
  托管期写 `confirm_gate_hosted_backup`（退出托管后生效），非托管期写 `confirm_gate`；新增 `confirmGateRowText()`；
  新增日志 `[b85r3] confirm_gate user=… hosted=…`。
- `HostedEngineManager.KEY_CONFIRM_GATE` 由 private 改 **public**（设置页需要读写该门；仅可见性变化）。
- 新增契约 `tests/test_batch85_settings_entries.py`（4 条）。

### 验证（真机 SN-HONOR-XXXX，装机）
- 设置弹窗 dump：两行新入口齐全；点「配置手机权限」→ 页面标题「配置手机权限」+ 底部「返回」→ 返回后回到引擎页（dump 到 `DSH`）✓。
- 审批门行文案：`托管模式：强制开启（卸载/改系统设置等会先问你）；你的设置：关闭（退出托管后生效）`；
  点击 → `你的设置：开启` + logcat `[b85r3] confirm_gate user=true hosted=true`；再点复原 `关闭`（未留用户状态改动）✓。
- `pytest tests/ -q` → **506 passed**；`b47_build.py all` → 装机；装后 3080=401 / 3081=401 / 3181=200、无障碍在列。
- 归档图：`docs/screenshots/批次85/batch85-R1bR3-设置弹窗.png`、`batch85-R1b-配置权限页.png`。

### 踩坑
- `addPermRow(...)` 是多行签名，往「第一行之后」插方法会把签名劈开（javac 报 `需要 , ) 或 [`）——插入点取完整语句块之外。
- 权限页是 ScrollView，底部「返回」按钮初始不在屏内，dump 取不到，需先上滚再取坐标。

## [未发布 - 批次85-R1] - 2026-09-20：权限引导页补「无障碍服务 + 通知使用权」两行（装机真机 PASS / 502 passed）

### 新增
- `MainActivity.showPermissionScreen()` 新增两行（原 **10 行 → 12 行**，插在「悬浮窗」之前）：
  - **无障碍服务（读屏与自动操作）**：判据 `a11yEnabledInSecureSettings()`（读 `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES`），点击直达 `Settings.ACTION_ACCESSIBILITY_SETTINGS`。
  - **通知使用权（读取通知）**：判据 `NotificationListener.isReady()` 或 `Settings.Secure.enabled_notification_listeners` 含本组件，点击直达 `Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`。
- 顺带修掉审计发现的**死方法**：`NotificationListener.isReady()`（`NotificationListener.java:115`）此前全仓零引用，现为该行判据。
- 复验探针（默认关、可随时摘除）：`am start -n com.deepseek.harness/.MainActivity --ez show_permission true` —— 该页原本只在 `setup_done=false`（首次启动）可达。
- 新增契约 `tests/test_batch85_r1_permission_rows.py`（4 条）。

### 验证（真机 SN-HONOR-XXXX，装机）
- 3181 桥 dump：页内 12 行齐全，两行位置在「所有文件访问」与「悬浮窗」之间。
- 状态是活的：a11y 被强停清掉时显示 `未授权`，重新启用 + resume 刷新后 → **`已授权`** ✓；`通知使用权` 稳定 `未授权`，与 `enabled_notification_listeners` 为空一致 ✓。
- 两个跳转真实可达：`ACCESSIBILITY_SETTINGS` → `Settings$AccessibilitySettingsActivity`；`ACTION_NOTIFICATION_LISTENER_SETTINGS` → `Settings$NotificationAccessSettingsActivity`（**注意 action 常量带 `ACTION_` 前缀**，漏掉会 `No activity found`）。
- `pytest tests/ -q` → **502 passed**；`b47_build.py all` → 装机 + 无障碍重设；装后 3080=401 / 3081=401 / 3181=200、托管引擎 pid 31369 存活。
- 归档图：`docs/screenshots/批次85/batch85-R1-权限页.png`。

### 边界
- 该页仍只在「首次启动」或 adb 探针下可见；常驻入口（设置页一行「配置手机权限」）记为 **R1b**，建议与 R3（审批门可见）同批做。

## [未发布 - 批次85] - 2026-09-20：项目审计与方案重排（只落盘，未改代码）

### 新增
- `docs/批次85-项目审计与方案重排.md`：**3 个只读子代理并行审计**（代码健康 / 文档一致性 / 能力缺口）+ 仓库与真机快照；产出「真欠账 4 条 / 可以不要清单 / 真有提升 R1~R9 / 外部方向 / P0~P3 排期」。取证全文在 `.local/audit85/*.md`（git-ignored）。
- **真欠账（只剩 4 条）**：D1 批次82-N7 心跳窗口未复现 / D2 背景位图只在面板未显示时采样（`OverlayService.java:1474`）/ D3 101 处内联颜色未令牌化 / D4 批次80 插件侧真机验证与 privSetting 回读腿。
- **风险提示（写进方案 §0）**：`498 passed` 里 1534 条是字面量 `assertIn`、42 个 pytest 文件里 35 个直接读源码文本，真执行逻辑的仅约 63 条 ⇒ **真机判据不能省**。

### 变更（本轮 P0 清欠，纯文档 + 一处空文件删除）
- `docs/PLAN-INDEX.md`：**销账 10 行**（54 / 59 / 70 / 76 / 77 / 78 / 79 / 80 / 81 / 82），并修正 38 / 39 / 42 / 43 的失效链接。
- `docs/STATE.md`：新增「当前状态（2026-09-20）」段，把批次72 / 67 / 66b / 66 / 53 与批次55 标为**历史存档**；测试基线 461 / 486 → **498**；「折射/色散未做」回填为**已做**；删掉失效的 `PLACEHOLDER_B` 引用；FLAG_SECURE 标**已闭环**；撤销「锁屏保活待拍板」；安装命令去硬编码 serial；悬浮球相关口径标注「已移除」。
- `AGENTS.md`（项目）：计数收口 —— 27 → **28** 个 Java 文件、26 → **42** 个 pytest、380 → **498** passed、12 → **14** 组 node 用例。
- 删除 0 字节空文件 `docs/批次42-系统级唤起入口与全局划词方案.md`（**用户已批准**）。
- 批次文档内过期状态字回填：批次83 §5 / §11.5 折射「未做」、批次81-T1T2 的 T4/T5「待拍板」、批次68 标题与 §三「待拍板」、journal 09-18 的 `privSetting` 结论。

## [未发布 - 批次84] - 2026-09-20：下一阶段方案（只落盘，未改代码）

- 新增 `docs/批次84-下一阶段方案.md`：欠账 A1~A6 + 候选 B1~B9 + 四步排期 + 明确不做。
- **更正**：A1「批次79 §6 历史会话号未复验」写错了 —— 实为 2026-09-18 已复验（`docs/批次80-T5杂项收口.md:132` + `docs/journal/2026-09-18.md:393`），由批次85 审计发现并销账。

### 补记（批次85 审计发现的历史漏记，逐条带提交号）

- **批次60b**（`425ebeb` / `7896c71` / `eb503df`）：虚拟屏启用判定方案落地 + 取消/急停路径补回收虚拟屏 + STATE 自动区块刷新 —— 原文缺条目。
- **批次59**（`cf7c1ce`）：下一步方案规划与候选方向登记（三条候选：方案1 → 批次70、方案2 → 批次82-N5、方案3 → 批次84 关闭）。
- **批次71**（`ff42d5c` / `186bef3`）：截图全链路失效修复（EINVAL fsync + 跨 UID 私有目录读取 EACCES + 托管常驻 3081 桥未起）+ `fix-hosted-resolver.cjs` 语法错误防退化 —— 从未登记 PLAN-INDEX，本次补记。
- **批次54**：调研完成；结论由批次55-A1 回答（**不升 targetSdk 也能用 Live Updates**）、55-A2 落地，targetSdk 升级不立项。
- 说明：`CHANGES.md` 尾部（批次43 之后接 56 / 64 / 63 / 62 / 61）**非严格倒序**，属历史追加顺序；本次不重排（重排会产生 2000 行级 diff，收益低）—— 记为已知状态。

## [未发布 - 批次83 第七版] - 2026-09-20：照抄酷安**运行期真值**（容器 = surfaceColor「黑 0.28」+ 棱边高光 0.29）—— 修掉「磨砂白」（装机真机 PASS / 498 passed）

### 变更（用户反馈：「还是没有液态的感觉，现在像是磨砂白，你都逆向酷安了为什么参数不和他做成一样的」）
- **容器（这就是「磨砂白」的根因）**：`GLASS_FILL_*` **`0x4DFFFFFF`（White 0.30）→ 暗档 `0x47000000`（Black 0.28）/ 亮档 `0x99FFFFFF`（White 0.6）**。
  取证（子代理 dex 反汇编，`.local/glass_probe/apps/coolapk_params/BINDING.md`）：`White 0.30/0.50` 绑的是酷安 `LiquidGlassStyle.surfaceColor`
  （`onDrawSurface` 整面 `drawRect(surfaceColor)` 平铺），**但运行期 `CoolapkTheme` 会无条件覆盖成「暗色 Black 0.28 / 亮色 White 0.6」**
  —— 所以酷安上屏是**压暗**背景，不是**刷白**背景。
- **棱边高光**：`GLASS_HL_ALPHA` 0.5 → **0.29**（`Highlight.alpha` 0.58 × `HighlightStyle.Default` 的白 0.5）。
- **高光笔宽照抄上游**：`dp(GLASS_HL_WIDTH_DP)`（1.75px）→ **`ceil(dp(GLASS_HL_WIDTH_DP)) * 2f` = 4px**（`HighlightModifier.configurePaint()` 原文）。
- 真机 fill 扫描（同背景、卡片内边距环带、探针 `--ei glass_fill`，不动代码）：α=0 → 卡内 115,141,128（sat 0.252）≈ 背景；
  α=77（第六版真值）→ **155,175,166（sat 0.150）**，相对无面板 **+35 抬亮 + 饱和度掉 0.037** = 「磨砂白」；α=140 已是白板。

### 验证（真机 SN-HONOR-XXXX，夜模式，装机）
- 卡内纯玻璃：raw 121,140,131 → **第七版 83,103,93（Δ = −38 = 0.72 × 背景）**、**饱和度 0.187 → 0.254 ↑**；对照第六版 155,175,166（Δ = +35, sat 0.150）。
- 棱边：左棱边内 2px **126**（关折射同点 71 ⇒ **+55**）→ 4px 108 → 10px 88（4px 内收敛）；上棱边内 2px **156**（≈ +31）。
- 第二背景复核（Chrome 深色页，环带）：raw 67.3 → 面板 49.8 ⇒ 实际透过率 **0.74**（令牌 28% 黑 ⇒ 0.72 ✓）。
- `python -m pytest tests/ -q` → **498 passed**；`python .local/b47_build.py all` → 装机（含无障碍服务重设 + `dumpsys` 复核）；
  `python tools/e2e_batch82_n8_flow_hang.py` → **PASS**（onset 1.872s、ramp **187ms**）。
- 归档图：`docs/screenshots/批次83/batch83-第七版-桌面+面板.png` / `batch83-第七版-桌面+面板-折射off.png`。

### 边界 / 旋钮
- 0.28 是**酷安自己上屏的暗色值**（不是我拍的）：如果觉得偏暗，把容器 alpha 往下调即可（方案 §16.6）；亮色档可直接用 `White 0.6`。


## [未发布 - 批次83 第六版] - 2026-09-20：照抄酷安/上游真机参数（12dp/24dp、depth 0、无色散、vibrancy ×1.5、45° 高光）（装机真机 PASS / 498 passed）

### 新增 / 变更
- **确认上游**：酷安 16.6.2 内嵌 [Kyant0/AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass)（Apache-2.0，android 分支 1.0.3~1.0.6），
  参数一律照抄其真值：`GLASS_REFRACT_BAND_DP = 12`、`GLASS_REFRACT_AMOUNT_DP = 24`（上传取负）、`GLASS_REFRACT_DEPTH = 0`、
  `GLASS_DISPERSION = 0`（酷安默认不开色散）、`GLASS_VIBRANCY = 1.5`（饱和度 ×1.5）、`GLASS_HL_ANGLE_DEG = 45`、`GLASS_HL_FALLOFF = 1`、
  `GLASS_BLUR_RADIUS_PX = 7`（2dp）、`GLASS_BACKDROP_DOWNSCALE = 1`。
- AGSL 折射 shader 新增 `vib()`（饱和度插值）+ 方向性棱边高光（`hint = pow(|dot(hgrad, 45°)|, falloff) * highlight.a`）+ 对应 uniform。

### 验证（真机，装机）
- 卡内纯玻璃本底 95（纯黑背景 + White0.30 ⇒ 期望 76，余量来自高光）；无模糊（卡内外过渡 8px 内）；折射环带 42px 内收敛；
  45° 方向性：左下/右下 Δ=−58、左右中点 Δ=−36、左上/右上/上中/下中 ≈0。
- `python -m pytest tests/ -q` → **498 passed**；装机；`tools/e2e_batch82_n8_flow_hang.py` → **PASS**。

### 遗留
- 第六版装机后用户仍判「磨砂白」——第七版用真机 fill 扫描把根因定位到**容器那层 30% 平铺白**并改掉（见上）。


## [未发布 - 批次83 第五版] - 2026-09-20：去掉模糊（通透水滴玻璃）+ 白玻璃 + 斜向反光（装机真机验证 / 498 passed）

### 变更（用户定稿：「像透明水滴做的玻璃，没有模糊没有磨砂，只要通透+反光+折射；颜色不够白有点灰」）
- `GLASS_BLUR_RADIUS_PX` **30 → 0**（完全不模糊）：`makeGlassBackdrop` 在 0 时跳过盒式模糊。
- `GLASS_BACKDROP_DOWNSCALE` **6 → 1**（不缩放）：缩放的盒式平均本身也是一种模糊，1 = 背景位图 = 截屏原像素。
- 玻璃 tint **改白玻璃**：夜档 `0x8F2E2E2E/0x7A262628`（中性灰）→ **`0x42FFFFFF/0x2BFFFFFF`**；
  日档 `0xB8FFFFFF/0xA6FFFFFF` → `0x4AFFFFFF/0x33FFFFFF`。灰就来自中性深色 tint。
- 兜底档（夜）`0xF22E2E2E/0xE81C1C1E` → `0xF0F4F5F7/0xE6EFF1F4`（拿不到背景图时别突然变回深色板）。
- **新增斜向镜面反光** `GLASS_SPEC_DAY/NIGHT = 0x4DFFFFFF/0x3DFFFFFF` + `PanelGlassDrawable.setSpecular()`：
  从左上角往右下扫过的反光带（三段渐变，18% 处开始衰减）。
- 输入框衬底（夜）`0x33101828`（暗蓝）→ `0x2EFFFFFF`（同色系浅底）。

### 验证（真机 SN-HONOR-XXXX，装机）
- **无模糊**：黑白竖边测试图上卡内外过渡在 **8px 内**完成（30px 模糊时要跨 ~80px）。
- **折射/色散**（黑卡+白底测试图，`glass_refract 1/0`）：左边缘内 2px **253 vs 72（+181）**、10px 254 vs 72
  （+182）、18px 71 vs 71（出环带 ✓）；右边缘内 6px **254 vs 55（+199）** ⇒ 棱边把卡外像素折进来 15~20px。
- 顶/底边在该测试图上量不到（顶部被相册暗色 scrim 压暗、底部环带被拖动把手/输入行遮住）——已如实记录。
- `python -m pytest tests/ -q` → **498 passed**（令牌契约同步：blur=0 / downscale=1 / 白玻璃 / 反光层）；
  `python .local/b47_build.py all` → 签名 APK → 装机；`tools/e2e_batch82_n8_flow_hang.py` → **PASS**。
- 归档图：`docs/screenshots/批次83/batch83-第四版-*.png`（本轮已就地更新为第五版观感）。

### 风险
- 白玻璃 + 白字在**很亮的背景**上对比度会下降（本机夜模式+深色壁纸正常）；需要时再做「文字色自适应」或局部暗底。

## [未发布 - 批次83 第四版] - 2026-09-20：棱边折射 + 光谱色散（逆向酷安 AGSL）+ 更通透（装机真机验证 / 498 passed）

### 新增
- **逆向拿到酷安的 AGSL 源码**：`com.coolapk.market` 16.6.2 `classes.dex` 里未混淆地存着
  `RoundedRectRefractionWithDispersionShaderString`（折射+色散）、纯折射版、棱边高光版、边缘淡出+tint 版。
  关键细节：它的色散是 **7 次光谱采样**（红/橙/黄/绿/青/蓝/紫，权重 1/3.5 或 1/7）而不是 RGB 三分裂；
  折射剖面用 `circleMap(x)=1-√(1-x²)`。
- `OverlayService.GLASS_AGSL_REFRACT` + `OverlayService.GlassRefractor`（内部类，API 33+ 才加载）：
  `RuntimeShader` 版棱边透镜折射 + 光谱色散，`uniform shader content` 绑定背景位图的 `BitmapShader`。
- `panelSampleRect()`：采样矩形 = 卡片矩形向四周外扩一个折射环带（20dp），并把偏移记进 `glassBackdropDx/Dy`、
  尺寸记进 `glassBackdropSrcW/H` 供 drawable 对齐；`GlassRefractor` 只在 API 33+ 且 init 成功时启用，
  否则原位图路径降级。
- 探针 `glass_refract`（0 = 关折射做 A/B；-1 = 默认开）贯通 `AssistActivity` → `OverlayService`。
- `tests/test_batch83_liquid_glass.py` +5 条契约（AGSL 移植要点 / 禁止依赖子 shader localMatrix / API 门控与降级 /
  环带采样与令牌 / 探针贯通）。

### 变更
- `GLASS_BLUR_RADIUS_PX` **72 → 30**：磨砂太厚会把棱边位移抹平（真机实测 72px 时折射位移只剩几个单位）。
- 夜档 tint **62%/52% → 56%/48%**（`0x8F2E2E2E`/`0x7A262628`）：让折射/色散的画面透上来。
- 新增折射令牌：`GLASS_REFRACT_BAND_DP 20` / `GLASS_REFRACT_AMOUNT_DP 13` / `GLASS_REFRACT_DEPTH 0.28` /
  `GLASS_DISPERSION 1.0`。

### 修复（逆向过程中的三个真机坑）
- **AGSL 的 `uniform shader` 不认子 shader 的 `localMatrix`**：设了矩阵仍按位图像素坐标取样 ⇒ 卡片内部整块
  被采成 clamp 边缘（实测内部 R 恒定 46）。改为 `uniform float2 contentScale/contentOffset` + shader 内 `tap()`
  自己做变换。
- **探针 extra 是持久的**：`glass_refract=0` 一旦传过，之后不带 extra 打开仍是关（服务进程字段）——A/B 必须两次
  都显式带 extra，否则会把「没开」误判成「无效」。
- 真机取证时**荣耀相册看图会把顶部/底部压到 ~5% 亮度**（scrim），会让「白/黑硬边」测试图退化成黑/黑；
  改用「蓝|红竖边压卡片左边缘 + 底部红|绿横边」取到干净数据。

### 验证（真机 SN-HONOR-XXXX，装机）
- 折射位移（左边缘内，B 通道，ON vs OFF）：4px 处 **107 vs 71（+36）**、14px 处 83 vs 59（+24）、
  24px 处 61 vs 50（+11）、34px 处 44 vs 41（+3，环带内按 circleMap 收敛到 0 ✓）；底边内 3px 的 G 通道
  **127 vs 83（+44）**；卡片内 max|Δ|=**56**、>8 像素占比 **4.2%**，卡片外 0.19%（状态栏时钟噪声）。
- 方向：同一条边上 R 通道下降、B 通道上升 ⇒ 两通道反向位移 = **色散**（不是整体亮度差）。
- `logcat`：`[b83] AGSL refraction shader ready`（无回退）。
- `python -m pytest tests/ -q` → **498 passed**；`python .local/b47_build.py all` → 签名 APK 202,228,965 B → 装机；
  `tools/e2e_batch82_n8_flow_hang.py` → **PASS**（V1–V4，onset 9091 / ramp 136ms ⇒ 7 次采样没拖慢入场）。
- 归档图：`docs/screenshots/批次83/batch83-第四版-*.png`（桌面 / 照片背景，折射 on、off）。

## [未发布 - 批次83 第三版] - 2026-09-20：材质「更像是玻璃」+ 呼出「行云流水」（装机真机 PASS / 493 passed）

### 修复
- **「太黑」的真根因不是玻璃 tint，而是面板内部结果区容器**：`resultScroll` 夜档衬底 `0x470C121D`（28% 暗蓝）把卡片内部从「玻璃本底 125」压到 **87**，而同一位置系统通知栏玻璃是 **127**（白色页真机 A/B：`raw/shade/panel` 同矩形取中位数）。改夜档衬底为 `0x1AFFFFFF`（10% 白雾）后卡内 **87 → 128**，与系统同档；卡片纯玻璃区保持 127 不变。
- **玻璃底显示陈旧画面**：`GLASS_BACKDROP_TTL_MS` 由 `60000L` 收到 **`1200L`**。原值导致 60s 内反复呼出都复用旧背景——真机判定为「白色页 vs 深色桌面两次读数都是 86 ⇒ 有效透过率 t≈0」；现为 96/62（t=0.347，与系统通知栏 0.378 同档）。
- **呼出「顿一下」的第一个成因**：`setPanelVisible(true)` 里的同步 `wm.updateViewLayout`（去 `FLAG_NOT_FOCUSABLE` 取焦 + `SOFT_INPUT_ADJUST_RESIZE` 尺寸复核）。改为**动效结束后 80ms 取焦**（`FLOW_FOCUS_DELAY_MS`），展开路径不再 relayout；`setOverlayWindowFocusable(false)` 会取消待执行取焦。软键盘顺延到 `FLOW_IME_DELAY_MS`（真机复核 `mInputShown=true`）。

### 变更
- 棱边高光对齐系统实测（1–2px 近纯白、峰值 252）：`GLASS_STROKE_WIDTH_PX = 2` + day `0x80FFFFFF` / night `0xB8FFFFFF`（旧值 1dp@0.25，峰值仅 128）。
- 入场动效减负：逐帧 `GradientDrawable.setStroke` 改为量化去抖（`edgeHighlightApplied`，Δ<0.02 直接返回）；动效期间 `panelView.setElevation(0)` 关掉 49px 阴影（每帧跟圆角重算），`restorePanelGlassAndLayout()` 还原。
- 新增 `warmUpPanelDraw()`：服务起来 1.2s 后、面板仍 GONE 时把面板子树画进 1×1 离屏 Bitmap，吃掉冷启动首帧的 shaping/解码成本（批次82-N8 记录 ~200ms）。
- 新增 `[b83] backdrop probe` 诊断日志（每张背景图一行：屏幕尺寸 + 裁剪矩形 + 8 个采样点的「模糊后 s / 原始 r」对比），用于后续判定玻璃底是否忠实。

### 验证
- `python -m pytest tests/ -q` → **493 passed**（新增 6 条第三版契约：TTL 上限、展开路径不得同步 relayout、IME 在取焦之后、逐帧描边去抖、预热绘制、结果区衬底不得压黑）。
- `python .local/b47_build.py all` → javac ALL DONE + 签名 APK 202,228,965 B → `adb install -r` 装机（装机后按既有流程重设 `enabled_accessibility_services` 并 `dumpsys` 复核）。
- 材质（白色页同矩形中位数）：卡内 **87 → 128**、卡内纯玻璃 127、系统通知栏 107/118。
- 呼出：首帧可见量（录屏 y130–690 变化像素）**1,306 → 14,365**；onset − trigger **0.585s → 0.255s**；顶端黑条 **0 黑像素 × 107 帧**（`top.py`）。
- N8 动效回归 `tools/e2e_batch82_n8_flow_hang.py --serial <S>` → **PASS**（V1–V4 全绿，onset 面积 8951、ramp 135ms）。
- 软键盘复核：`dumpsys input_method` → `mInputShown=true`、`mServedView=android.widget.EditText{…0,0-844,126}`。

## [未发布 - 批次83 实施] - 2026-09-20：助手面板「液态玻璃」材质落地（客户端自绘玻璃）+ 呼出顶端黑条修复（均装机真机 PASS）

### 新增
- `OverlayService`：自绘玻璃 `PanelGlassDrawable`（圆角裁剪 → 背景位图 → 两段中性 tint → 1dp 白棱边；`getOutline` 供 `clipToOutline`、`setCornerRadius`/`setStroke` 供批次82-N8 动效）+ 背景采样 `refreshGlassBackdrop()` / `makeGlassBackdrop()`（无障碍截屏 → 按卡片矩形裁剪 → 1/6 缩放 → 三遍可分离盒式模糊）+ 并发护栏 + 95% 兜底档。
- `tests/test_batch83_liquid_glass.py`（13 条契约，含「**禁止回退到窗口级 `FLAG_BLUR_BEHIND`/`setBlurBehindRadius`**」硬约束与原因注释）。
- `docs/批次83-液态玻璃材质统一方案.md` §11（实施收口：材质修正 + 黑条根因取证与修复 + 验收数值）。
### 变更
- **放弃窗口级真模糊**：真机取证 Honor 为 `FLAG_BLUR_BEHIND` 建的 Dim 层覆盖**整个显示**（`Dim Layer for - Display 0 bounds={0,0,2808,1256}`）——开窗口模糊会把整屏背景一起糊掉，也会糊掉无障碍截屏内容（划选链路同源）。材质改为**客户端自绘**，作用范围严格 = 卡片圆角。
- 面板玻璃令牌从批次50 蓝调（`0xE6F5F8FE/0xE61A2233` + `0x8FB8FF` 蓝棱边）换成系统中性档：玻璃 80%/72% 白或中性黑、棱边中性白、兜底 95% 档。
- `AssistActivity` 显式声明「本窗口绘制系统栏背景 + 状态栏透明」（`FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS` + `setStatusBarColor(TRANSPARENT)`），修掉呼出瞬间顶端全宽黑长条。
- 探针参数更名：`glass_blur` → `glass_backdrop`（0 = 强制只看 tint 底，用于真机 A/B），`AssistActivity` 转发放行同步。
- 同步更新 3 条既有源码契约（`test_batch50_smart_capsule` / `test_batch53_overlay_layer` / `test_batch82_n8_flow_hang`）以匹配新结构（语义不变：唯一材质生成点、面板仍在状态栏下方、棱边基色仍由 N8 缩放）。
### 验证
- `python -m pytest tests/ -q` → **486 passed**；`python .local/b47_build.py all` → javac ALL DONE + 签名 APK 202,224,869 B → `adb install -r` 装机。
- 材质真机 A/B（`--ei glass_backdrop 0`）：卡片内 **93.0% 像素变化（mean 34.48）**，卡片左右与下方区域 **逐像素 0.00** ⇒ 玻璃严格限制在卡片圆角内。
- 呼出黑条：修复前峰值 **106,894** 黑像素 / 56 行整行全黑 / x 0–1255；修复后两次实测（桌面 / 酷安深色）顶部 200 行最大黑像素 **0 / 599（且不在状态栏区：y 0–40 全为 0）**。
- N8 动效回归 `python tools/e2e_batch82_n8_flow_hang.py --serial <S>` → **PASS**（V1 起点居中/贴挖孔、V2 首段细小、V3 宽度爬升、V4 终态居中 全绿）。

## [未发布 - 批次83 追加] - 2026-09-20：第三方 App「玻璃 dock」机制取证（酷安=自绘 AGSL 折射 / 荣耀音乐=Honor 私有材质 / 音乐盒子=无模糊）

### 调研（只读）
- 酷安 `com.coolapk.market`：**(c) 客户端自绘** —— 自带 `com.coolapk.market.widget.compose.liquid.*`（`LiquidGlassTabPanel.kt`）+ AGSL 源码串 `RoundedRectRefractionWithDispersionShaderString`（`content.eval(refractedCoord ± dispersedCoord)`、`refractionAmount`、`chromaticAberration`）+ `RenderEffect/createBlurEffect` + 打包 `RealtimeBlurView`；Honor 私有符号与 AOSP 窗口模糊关键字均 0 命中。
- 荣耀音乐 `com.hihonor.cloudmusic`：**(b) Honor 私有材质** —— `HnGlassEffect(HnMaterialType.LIQUID_GLASS, HnSceneType)`（调用点 `MainActivity.qe()/He()`、`MiniBarContainer.j0()`）；证书 `CN=apkkey_white_cloud_v1, OU=Hihonor, O=Honor`、`flags=[SYSTEM UPDATED_SYSTEM_APP]`、`/system/app/HnMusicCloudmusic` ⇒ **它本身就是系统预装应用，不是第三方**。
- `com.ttgk.musicbox`：三条都不是（`TransparentBottomNavigationView` + `setBackgroundColor(0)`/`setElevation(0)`，全包无 blur/glass/liquid 资源）。
- 运行期复核：三者前台时 SF 全部层 `backgroundBlurRadius=0`、`tianshan radius 0.000000`，两 App 窗口无任何模糊属性 ⇒ 它们的 dock 不走系统跨窗口模糊、也不走 tianshan。

### 新增发现（影响方落地）
- **窗口级真模糊的模糊区域 = 整个窗口 frame，不是卡片形状**：b0↔b200 逐像素复核显示卡片左右各 50px 页边（x<56 / x>1200）与窗口其它区域同样有 6~58 的像素变化 ⇒ 若保持 `MATCH_PARENT` 全宽窗口，屏幕顶部会出现一条整宽模糊带。落地时需把窗口收窄到卡片（含阴影留白）或接受该带。
- 复制路径结论：**路 A** 窗口级真模糊（已实测，优先）；**路 B** 客户端自绘 `RenderEffect`/`RuntimeShader`（酷安那条，形状可控、可做折射色散，需自截图，本 App 已有无障碍截屏能力）；**路 C** Honor 私有材质不可用（无对外分发通路）。

### 验证
- 只读取证（未改产品代码、未装机）：APK 静态分析（dexdump/字符串池/资源表/证书）+ 运行期 `dumpsys window`/`dumpsys SurfaceFlinger` 复核 + 逐像素复核（Python/PIL）。
- 文档：`docs/批次83-液态玻璃材质统一方案.md` §10（含逐包证据表）。

## [未发布 - 批次83] - 2026-09-20：小鲸鱼助手材质与系统「液态玻璃」统一（本机玻璃机制取证 + 第三方浮窗真模糊装机实测 PASS + 方案）

### 调研（只读）
- 本机（Honor BKQ-AN10 / MagicOS 11 / Android 17）玻璃三条通路并存：① AOSP 跨窗口模糊（`ro.surface_flinger.supports_background_blur=1`、WMS `mBlurEnabled=true`、SF 算法 `KawaseDualFilterV2`、`window_dynamic_blur`）
  ② Honor 自研折射材质玻璃（`HnLiquidGlassWindowManger` / `LiquidGlassMaterial` / `GlassParam{depth,dispersion,thickness,refraction,opacity,maskColor}` / `LayoutParams.hw*LayerBlurStyle` —— **全部 hiddenapi=BLOCKED，第三方拿不到**）
  ③ 截屏位图实时模糊（`HwBlurEngine` / `HnRealtimeScreenCaptureController`）。
- 系统玻璃令牌取证：`magic_corner_radius_{card,listcard,banner,notification}=18dp / dialog=32dp / popwindow=xlarge=30dp / chips=14dp / inputbox=18dp`；
  `color/magic_launchercard_public_blur_{1,2,3}`（day `#85fafafa/#b8ffffff/#f2fafafa`，night `#9e2e2e2e/#cc2e2e2e`）；`graphic_blur_radius=8` / `mask_color_blur_radius_general=12`；
  材质开关族 `hn_transparent_material_{level,flowLight,outlineShadow,pressLight,hdr,glass,headroom_or_max_ratio}`（透明材质/液态玻璃是官方特性：`transparent_texture:liquid`、`LiquidGlassTransparentGuideActivity`）。

### 新增
- `OverlayService.buildPanelGlass()`：面板玻璃底的**唯一生成点**（默认值与批次50 静态玻璃底逐位一致），为后续材质统一与探针共用；
- 液态玻璃探针（临时、默认关）：`FLAG_BLUR_BEHIND` + `LayoutParams.setBlurBehindRadius(px)` + 填充 alpha 可调 + `addCrossWindowBlurEnabledListener` 可用性回读；
  触发口 `onStartCommand` 读 `glass_blur`/`glass_fill`，并新增 `AssistActivity` 转发（服务 `exported=false`，adb 不能直接 start-service）；
- 真机取证归档图 `docs/screenshots/批次83/`（blur0/blur200 全屏 + 背景放大对比）；方案文档 `docs/批次83-液态玻璃材质统一方案.md`。

### 验证
- `python -m pytest tests/ -q` → **473 passed**（改源后同步更新 2 条源码契约：`test_batch50_smart_capsule`/`test_batch82_n8_flow_hang` 的 `glassBg` 断言改为 `buildPanelGlass()` 等价断言）；
- `python .local/b47_build.py all` → javac ALL DONE + 签名 APK 202,224,869 B → `adb install -r` 装机；
- **真机 PASS（第三方浮窗真模糊）**：`dumpsys window` 本窗口 `fl=BLUR_BEHIND` + `blurBehindRadius=60/120/200`；`dumpsys SurfaceFlinger` 出现 `alpha=0 backgroundBlurRadius=120` 的 Dimmer 层；
  像素：同参数复拍逐像素相同（噪声底 0.00），blur 0→200 面板区 >8 像素占比 82.5%、高频能量 5.795→3.764（**-35.1%**，局部放大区 -45.2%）；`crossBlurListener=true`（注册即回调）。
- 踩坑记档：`MainActivity.onStart → setOverlayVisible(false)` 会收起刚展开的面板（曾因此误判「模糊无效」）；装机后无障碍服务列表被 ROM 重置需重设。

### 待拍板
- S2 令牌化（玻璃底/描边/内嵌件换系统中性令牌 + 收敛 ~30 处硬编码）/ S3 降级联动 / S4 设置页开关 / S5 验收 —— 见方案 §5。

## [未发布 - 批次82 / N4] - 2026-09-20：助手状态接上引擎 session/follow 真事件流（turn/message 级推送）

### 新增
- DshEventMux 第二条逻辑流：SESSION_STREAM_ID="overlay-session" + SESSION_FOLLOW_ENDPOINT="session/follow"（与 $events 共用同一条 /api/remote.mux WebSocket，按外层 streamId 分流）；
  followSession(id) / unfollowSession() / sendSessionOpen() / sendCancel(streamId)；断线重连后自动补开第二条流。
- OverlayService：新回调 onSessionFrame / onSessionStreamState + handleSessionFrame()（snapshot / event / assistant-stream）+ setSessionEventText()（2.5s TTL）+
  kickSessionRefresh()（turn 结束立刻拉一次会话快照）+ 事件名/chunk 类型各留痕一次。
- 闸门 tests/test_batch82_n4_session_follow.py（12 条）。

### 变更
- DshEventMux.handleText 按 streamId 路由：会话流的 item 走新回调；**会话流自己的 error/end 只关这条流**，不再把提问/审批那条流一起踢掉（原实现任何流 error/end 都会 reopenRequested 整连接重建）。
- 面板语义：事件流只做「状态实时化」（AI：思考中…/回复中… N 字、turn/end → running=false + 立刻刷新），收尾与结果仍由既有轮询 + RPC 负责。
- tests/test_batch55b_user_questions.py 的 args.request 反向断言收窄到 rpcResult 方法体（语义不变；N4 的 session/follow open 帧必须带 args.request）。

### 验证
- python -m pytest tests/ -q → **473 passed**（461 + 12）；b47_build.py all → javac ALL DONE + 签名 APK 202,220,773 B → 装机；产物 dex 复核到 overlay-session / session/follow / [b82n4]。
- 真机 PASS：follow → session/follow open → snapshot(cursor=5,records=6) → 12 条 durable（含 turn/start、turn/end seq=36）→ 15 条 assistant 帧（chunk: block-start/tool-call-delta/block-end/usage/finish；end kind=committed）→ unfollow；
  面板文案由推送驱动（「AI：思考中…（事件流）」「AI：思考中… 3 字（事件流）」）。
- 只读复核：batch79「$events 不投递 api-session/* emit」的证据不足（窗口仅 ≈11.9s 且期间无状态跳变、emit 边沿触发且不补发；另有 23:15 的反向 logcat 物证）——已记档，N4 改走 stream 通道不受影响。
## [未发布 - 批次82 / N1] - 2026-09-19：助手「▶ 直接执行」一键放行（同一会话带授权补发）
## [未发布 - 批次82 / N5] - 2026-09-19：Prompt Studio「指令库管理」收尾（管理页 + 顺序管理 + 改完即时生效）+ 历史「🔁 重新执行」
## [未发布 - 批次82 / N9] - 2026-09-19：自愈 reason 精度（被只读闸门拒时不再显示 NOT_CREATED）
## [未发布 - 批次82 / N7] - 2026-09-19：实况窗「静默续期心跳」改为可选开关（默认关 = 静默 5 分钟后胶囊自然收成圆点）
## [未发布 - 批次82 / N8] - 2026-09-19：助手面板入场「三段式流挂」动效（批次51 P2 落地）

### 新增
- **批次82-N8：`OverlayService.playFlowHangEnter()`** —— 三段式「流挂」入场动效：出液 180ms（85dp×4dp 细缝，贴前摄挖孔下缘）
  → 垂落 280ms（以 X=50% 铺开、以 Y=0 向下生长，内容 200ms 起 / 280ms 内延迟渐显）
  → 定形 160ms（圆角收敛回 26dp、棱边高光 0.5→1.0 闪一次、落定 1.015→1.0），总时长 620ms；
  呼出（`openAssistantCapsule`）与任务完成自动展开（`autoExpandAfterTask`）**共用同一条实现**，参数全部外置成 `FLOW_*` 常量。
- 批次82-N8：`cancelFlowAnimator()`（收起 / 重开先取消，先摘监听器再 cancel）+ `restorePanelGlassAndLayout()`
  （圆角 / 棱边描边 / alpha·scale·translationY 精确还原）+ `setPanelGlassCorner()` / `setPanelEdgeHighlight()` / `setPanelChildrenAlpha()`。
- `tools/e2e_batch82_n8_flow_hang.py`：真机逐帧验收工具（adb + screenrecord + ffmpeg + numpy：乘性拟合扣背景压暗 + 5x5 均值 + 中线连续段取几何；
  输出 onset/mid/settled 关键帧与 report/曲线）。闸门 `tests/test_batch82_n8_flow_hang.py`（13 条）。
- **批次82-N7**：`PromotedProgressNotifier.KEY_HEARTBEAT = "promoted_capsule_heartbeat"` + `isHeartbeatEnabled(Context)`（默认关）；
  `MainActivity` 设置页新增一行可点开关「胶囊续期 · 实况窗静默续期」（文案就地回读 + toast）；闸门 `tests/test_batch82_n7_capsule_heartbeat.py`（8 条）。

### 变更
- **批次82-N7**：`scheduleHeartbeat()` 开头加闸门 `if (!isHeartbeatEnabled(ctx)) return;` —— 默认不再每 4 分钟续期，
  遵守 MagicOS 原生行为（单步静默超 `mCapsuleExpandDuration = 300000` 后胶囊自然收成圆点，诚实表达「还在跑、暂无新进展」；下一次 `update()` 重新发布并展开）。
  只停「续期」：`start()` / `update()` / `interaction()` 的正常发布不受影响；`HEARTBEAT_INTERVAL_MS = 240000L` 与依据注释保留（作为可选开关的间隔）。
- **批次82-N8**：形变原点改用 `baseTop = getLocationOnScreen()[1] - getTranslationY()` 与 `statusBarHeightPx()` 计算
  （必须先扣掉调用方刚设过的 -dp(34)；本机实测 `cutoutBottom=136 / baseTop=164 / startY=-28`）；IME 唤起 260ms → 460ms（垂落结束）；圆角 16dp → 34dp → 26dp。
- `tests/test_batch50_smart_capsule.py` 的 `test_droplet_expand_animation`：单条「液态水滴」参数已被三段式替换，用例改为钉
  「呼出前压初值 + 走 `playFlowHangEnter` 同一条实现 + `FLOW_TOTAL_MS` 存在」（材质类断言不变）。

### 验证
- 批次82-N8：`python -m pytest tests/ -q` → **461 passed**；`python .local/b47_build.py all` → javac `ALL DONE` + 签名 APK **202,220,773 B** → `adb install -r` 装机；
  产物 `classes.dex` 复核到 `playFlowHangEnter` / `FLOW_TOTAL_MS` / `baseTop=` ✓。真机日志（真实入口路径）：
  `[b82n8] flow-hang enter: w=1144.0 h=1426.0 startY=-28.0 baseTop=164.0 cutoutBottom=136 seep=85x4dp drip=220x26dp total=620ms`；
  真机逐帧 **PASS**：起点 bbox 中心 655.5（居中）/ 顶边 140（挖孔下缘）/ 面积 19,505 ≈ 终态 24% / 宽度爬升 170ms / 终态中心 624.5；
  关键帧 `docs/screenshots/batch82-N8/{onset,mid,settled}.png`。工具踩坑（已固化进脚本注释）：LTPO 静止 ~1fps ⇒ 时间轴必须用每帧 pts；
  桌面转场缩放 ⇒ 触发加 `--activity-no-animation`；MainActivity 留在任务栈会把面板顶掉 ⇒ 先 BACK 结束；冷启动首帧 ~200ms ⇒ 先热进程。
- 批次82-N7：`python -m pytest tests/ -q` → 461 passed（含既有批次56/70/82-N1 心跳契约不回退）；
  真机设置页行文案 = 「胶囊续期 · 实况窗静默续期 / 已关闭（静默 5 分钟后收成圆点）（点此切换）」；真机行为见 docs/批次82-N7-静默续期开关.md。

### 修复
- **App `VscreensManager`**：新增 `noSessionReason()` —— 无会话时若 `OverlayService.isReadOnlyTaskInFlight()` 则回 `READONLY_TASK`（否则 `NOT_CREATED`）；
  `proxyRouteInner` 的「服务端不可达 / 无响应」两条分支改走它；`hintFor()` 补 `case REASON_READONLY_TASK: return HINT_READONLY_TASK;`（原因与提示成对）。
- **插件 `dsh-tool-android`**：`vscreenRetryAfterSessionLoss()` 在自愈失败、且失败原因比 `NOT_CREATED`/`SESSION_DEAD` 更具体时（典型 `READONLY_TASK`），
  把该原因+提示透出；`BRIDGE_UNREACHABLE` 等瞬态仍沿用原失败结果（既有错误契约不被自愈文案覆盖）。
- 建屏硬闸门本身未改（N9 只改「原因怎么说」，不改「能不能建」）。

### 验证
- 新增闸门 `tests/test_batch82_n9_reason_precision.py`（7 条）；`tests/test_vscreen_router.mjs` 新增 **Test 14**（13 → 14 组）。
- `python -m pytest tests/ -q` → **440 passed**；`node tests/test_vscreen_router.mjs` → **14 组全绿**；`node --check` ✓。
- `tools/sync_base_apk_plugins.py` 同步插件进 payload（`--check` unchanged）；`all` → 签名 APK 202,216,677 B；
  从产物 `assets/payload.zip` 复核到插件已含 N9 代码。
- **真机 PASS**：纯只读任务运行期间 `/vscreen/see` 连续 14 次回 `READONLY_TASK`（此前为 `NOT_CREATED` +「先 android_vscreen_create」），任务收尾后回到 `NOT_CREATED`；期间 `/vscreen/status` 无会话。

---


### 新增
- `PromptStudio.java`（新类）：用户可见的「指令库管理」页 —— 列表（文案 + 指令预览）+ 每行 [⬆ 上移][⬇ 下移][📌 置顶][✏️ 编辑][🗑 删除] + 底栏 [➕ 新建][🔄 恢复默认][关闭]；
  **只调 `PromptChipManager`**（不直接碰 SharedPreferences），窗口类型由调用方指定（面板侧 overlay / 设置页普通 Dialog）。
- `MainActivity` 设置页新增入口行「指令库 · 常用指令药丸 · N 条：新增 / 编辑 / 排序（改完立即生效）」。
- `PromptChipManager`：`MAX_CHIPS = 30` + `isFull()` 上限保护；`moveUp()/moveDown()`（与相邻项交换 order，不做整表重排）。
- `OverlayService.refreshPromptChipsFromOutside()`：同进程静态刷新入口 —— 管理页改完，悬浮面板药丸行**立即重画**（不需重开 App）。
- 历史成果动作「🔁 重新执行」（批次59 方案2 的失败一键重试；复用回填 + `applyQuickAction`）。

### 变更
- 长按芯片菜单补「⬆ 上移 / ⬇ 下移」（索引顺延：编辑 0、上移 1、下移 2、设为首项 3、恢复默认/删除 4）。
- `tools/b47_build.py` + `.local/b47_build.py`：javac 注释登记 `PromptStudio`（两份保持字节一致）。

### 验证
- 新增闸门 `tests/test_batch82_n5_prompt_studio.py`（14 条）；`tests/test_batch79_state_fidelity.py` 的续跟分支索引 3→4 同步（语义未变）。
- `python -m pytest tests/ -q` → **433 passed**；`python .local/b47_build.py r,j` → javac `ALL DONE`
  （**踩坑**：单跑 `j` 不会重生成 `classes.rsp`，新增 Java 文件后必须 `r,j` 或 `all`，否则报「找不到符号」）；
  `all` → 签名 APK **202,216,677 B** → `adb install -r` 装机。
- **真机 PASS**：设置页入口行（6 条）→ 管理页（每行 上移/下移/置顶/编辑，**内置项无删除**）→ 点「⬇ 下移」后 `qq点赞`/`微博红包` 互换
  → **面板药丸行立即同步为新顺序**（未重启 App）→ 再点一次复原（未留残留改动）；长按面板芯片出现「⬆ 上移 / ⬇ 下移」。证据 `docs/screenshots/batch82-N5/`。

---


### 新增
- 终态实况窗（`0x55A1`）在「成功 / 已结束 / 失败」收尾时挂 `addAction("▶ 直接执行")`（service PendingIntent → `OverlayService` 新增 `action_auto_proceed` 分支），
  并把这条终态的停留时长从 5s 提到 **60s**（`ACTION_LINGER_MS`；普通完成态仍 5s，有界以免进程被杀后残留 ongoing 通知）。
- 助手面板药丸行新增同名 chip「▶ 直接执行」（`proceedChip`，失败 / 已结束 / **成功** 终态且不忙时露出）——
  **实况窗动作在 MagicOS 上能否渲染未取证**（批次53/55 教训：准入≠真渲染），这是不依赖 OEM 的兜底入口。
- `OverlayService.autoProceedTerminalTask()`：一键放行 = **同一引擎会话**补发上一条指令（内存 `currentPrompt` 优先，服务重建后回落 `task_history_items` 最近一条），本轮强制带「【用户已授权 · 直接执行】」前缀。
- `OverlayAgentClient.pinNextSession(String)`：一次性会话钉选；`runTask` 钉住时跳过 `resolveSession`（不新建 / 不轮换 / 不写 `overlay_last_session_id`）。

### 变更
- `PromotedProgressNotifier.finish(ctx,text,allowProceed)` 新增三参重载，原两参版变薄转发（定时任务等既有调用方零改动）。
- 授权前缀条件由 `agentAutoProceed()` 改为 `agentAutoProceed() || proceedAuthorizedThisRound`（点按钮本身就是这次授权；口径仍是**只改 prompt 措辞、不授予任何权限**，安全规范段一字不动）。

### 验证
- 新增闸门 `tests/test_batch82_n1_auto_proceed.py`（**17 条**）；`tests/test_batch56_live_update_carrier.py` 的 finish 锚点随重载同步（语义未变，注释已写明）。
- `python -m pytest tests/ -q` → **419 passed**（基线 402 + 17）；javac `ALL DONE`；`python .local/b47_build.py all` → 签名 APK 202,208,485 B，
  并从产物 `classes.dex` 复核到 `▶ 直接执行` / `action_auto_proceed` / `pinNextSession` / `b82n1`（含 N2 的 `screenOn`）。
- **真机（已装机，PASS）**：实况窗动作在 MagicOS 11 通知栏展开态**真渲染**（`docs/screenshots/batch82-N1/terminal-shade.png`：任务实况 / ✓ 任务已完成 / [▶ 直接执行]）；
  60s 窗口实测 `finish … lingerMs=60000 proceedable=true`（20:38:22）→ `stop id=21921`（20:39:22）；
  **两条入口都跑通同一会话补发**（通知按钮 20:44:41、面板 chip 20:40:14，`[b82n1] proceed resubmit session=` 与本轮 `prompt accepted` 同会话）；
  取消终态 `finish … text=已取消 lingerMs=5000 proceedable=false`、运行中无 chip。详见 `docs/批次82-N1-助手一键放行.md` §5.1。
- **真机补丁**：三个终态药丸由行尾改插**行首**（原先被挤出横向视口 ⇒ 3181 dump 里查无此节点）⇒ 终态即见 `▶ 直接执行`（闸门 `test_terminal_chips_are_pinned_to_row_head`）。
- **规则变更**：用户拍板「装机与真机测试免批准，只有破坏系统/数据的行为才需要」⇒ 写入 `AGENTS.md`（commit `7aea4c5`）。

---

## [未发布 - 批次82 / N2+N3] - 2026-09-19：息屏决策产品收口（诚实失败）+ 批次79「0 宽开关」真机复验 PASS

### 决策落地
- 用户拍板**放弃「息屏下虚拟屏渲染」路线**后，产品侧本轮收口 = **视觉类工具熄屏时如实失败**，不再把黑帧当成功。

### 新增 / 修复
- 3081 `/status` 新增 `screenOn` / `screenState`（App 侧唯一实时屏态源，`isInteractive()`，取不到按「亮」处理）。
- 熄屏时 **3081 `/vscreen/see`**（`VscreensManager` 单独分支）与 **3181 `/screenshot`**（`AccessibilityService` 截图前早退）如实失败：`reason=SCREEN_OFF` + 可执行 hint。
- 插件 `dsh-tool-android`：新增 `SCREEN_OFF_HINT` + `vscreenFail` 兜底映射 + `android_screenshot` 前置屏态检查（`appScreenOn()`）。

### 验证
- 新增闸门 `tests/test_batch82_n2_screen_state.py`（6 条）；`node --check` ✓；javac `ALL DONE` ✓；
  全量 `pytest` 首跑 **401 passed / 1 failed**（唯一失败=插件 payload 未同步）→ `python tools/sync_base_apk_plugins.py` 后复跑三闸门 **11 passed**。
- **N3 真机复验 PASS**：横滑保活卡片按钮行后 dump 出现「实况窗：开 / 实况窗设置 / 直接执行：关」，`tap?text=实况窗：开` 成功且回读翻转、再点还原 ⇒ 批次79「0 宽」修复确认；证据 `docs/screenshots/batch82-N3/`。
- **N2 真机验收 PASS（2026-09-19 装机）**：屏幕亮基线 → `3081 /status` `screenOn:true`、`3181 /screenshot` `ok:true`（1256×2808 真图）、`3081 /vscreen/see` 返回 `NOT_CREATED`（**不是** SCREEN_OFF ⇒ 证明是独立分支）；
  `input keyevent 223` 熄屏（`mWakefulness=Dozing`）后 → `3081 /status` `screenOn:false` / `screenState:"off"`；
  `3081 /vscreen/see` → `{"ok":false,"reason":"SCREEN_OFF","hint":"屏幕已熄灭：虚拟屏画面只在屏幕亮着时可靠…请点亮屏幕后重试…"}`；
  `3181 /screenshot` → `{"ok":false,"error":"SCREEN_OFF：屏幕已熄灭，截图 / 虚拟屏只在屏幕亮着时可靠…"}`（**早退，未产出图片**）；
  唤醒（`keyevent 224`）后 `screenOn:true` / `screenState:"on"` 复位；设备侧托管 home 的 `dsh-tool-android/lib/index.js` 已含 `SCREEN_OFF_HINT`（3 处 ⇒ payload 随装机采用）。

---

## [未发布 - 批次82] - 2026-09-19：**用户拍板放弃「息屏路线」** + 最新方案清单（仅文档）

### 决策
- **关闭「息屏/锁屏下让虚拟屏继续渲染」这条路线**（T4 正式收口）：不再投入隐藏通路 / 厂商私有通路 / 陪伴虚拟设备通路的探索；
  `stay_on_while_plugged_in` 保留为「按需兜底」；同时**撤销**「锁屏期面板保活锁导致屏幕微亮」的电池取舍待拍板项。
- 影响面：需要看屏幕的任务（截图 / 像素判据）只在屏幕亮时可靠；锁屏/息屏应走「暂停 → 解锁续跑」或「只做不需要像素的步骤」。

### 变更（仅文档，未改产品代码、未动设备）
- 新增 `docs/批次82-最新方案清单.md` —— 新的「下一步」唯一入口（§0 决策 / §1 未实施方案 N1~N12 / §2 排期 / §3 明确不做）
- `docs/PLAN-INDEX.md`：批次81 T4 标记为「用户拍板收口」；新增批次82 行

### 未实施方案摘要（详见批次82 文档）
- **P1**：N1 助手「一键放行」候选②（1 批）｜N2 息屏决策产品收口（半天）｜N3 批次79「0 宽开关」真机像素复验（30 分钟）
- **P2**：N4 `session/follow` 真事件流｜N5 Prompt Studio（批次59 方案2）｜N6 触控手感（方案3）｜N7 胶囊收圆点｜N8 流挂动效｜N9 自愈 reason 精度
- **P3**（需单独立项）：N10 原生 Live Updates（含 targetSdk 28→36）｜N11 引擎双模 home 统一｜N12 `stay_on` 会话级开关产品化
- **明确不做（新增）**：为过虚拟设备的门去改设备安全（CDM 配对 / 去掉锁屏凭据）

---

## [未发布 - 批次81 / T4b 虚拟屏替代途径] - 2026-09-19：虚拟屏「全部可达途径」盘点（反汇编 + 只读设备；**未做任何写设备操作**）

### 结论
- **能造「第二块屏」的途径只有 4 类**：DM 的 `VirtualDisplayAdapter` / `OverlayDisplayAdapter` / `WifiDisplayAdapter` + 物理外接屏（`LocalDisplayAdapter`），没有第 5 条；
  厂商私有 SF 级显示（`VirtualDisplayEx`）已证不可用且危险。**能承载真实 Activity 的只有 DM 逻辑屏**（WMS 只往 LogicalDisplay 放窗口）。
- **本 ROM 的显示组分配只有两种组**：`""`（primary = 组 0）与 `"secondary_mode"`；后者仅当 `contentMode==1(REASON_PROJECTED)` 才返回，
  而 `TYPE_VIRTUAL(5)` 在 `isDesktopModeSupportedOnDisplayLocked` 里**直接 return false** ⇒ **普通虚拟屏在本 ROM 永远进不了独立组**（设计使然，与两轮实测一致）。
- **唯一例外（本轮新发现）**：**陪伴虚拟设备（Companion Virtual Device）名下显示**走 `mVirtualDeviceDisplayMapping → mDeviceDisplayGroupIds` 分支，**分配独立组（≥1）**；
  客户端 AIDL `IVirtualDevice.createVirtualDisplay(VirtualDisplayConfig, IVirtualDisplayCallback)` 确认存在；shell uid（已 `granted=true` 持有 `CREATE_VIRTUAL_DEVICE`）
  另可直连 `createShellVirtualDevice`，绕过 `cmd virtualdevice` 自带的 `isKeyguardSecure()` 门。**熄屏后是否继续渲染 = 未验证（待批准实验）**。

### 变更（仅文档）
- 新增 `docs/批次81-T4b-虚拟屏全部可达途径盘点.md`

### 证据
- 反汇编（本机 jar，`dexdump`）：`LogicalDisplayMapper.assignDisplayGroupLocked / assignDisplayGroupIdLocked`、`DisplayGroupAllocator`、`VirtualDeviceImpl`、
  `VirtualDeviceManagerService`、`VirtualDeviceShellCommand`、`IVirtualDevice`（framework.jar）、`framework-magic.jar`
- 设备只读：`dumpsys display`（Adapters size=4 / Groups size=1 / Devices size=1）、`cmd display -h`（无建屏/建组命令）、`cmd virtualdevice help`、
  `dumpsys virtualdevice`、`dumpsys package com.android.shell`（`CREATE_VIRTUAL_DEVICE: granted=true, flags=[GRANTED_BY_ROLE]`）、`locksettings get-disabled=false`

### 联网调研佐证（子代理 net_research_vd_alternatives，64 处来源）
- AOSP 原文确认 `OWN_DISPLAY_GROUP` 语义 = 「不进默认组、进新组」，与本地反汇编的 `virtualDeviceId` 分支互证；`DEVICE_DISPLAY_GROUP` 需 `virtualDevice != null`。
- **重要修正**：独立组 ≠ 永不灭 —— 非默认组不被主屏熄屏带走，但会被**自己的 inactivity 超时**关掉；
  scrcpy 在 Android 15 的真实案例（issue #6787，`--new-display` 带 OWN_DISPLAY_GROUP）主屏熄屏后约 10 s 变黑，靠 `--keep-active`
  周期调 `IPowerManager.userActivity(displayId, …)` 绕过 ⇒ 实验 A 必须补「独立组 + userActivity 续命 + 内容变化判据」三步。
- 联网侧同时确认 `SurfaceControl.createDisplay` 自 Android 15 移除、`requestDisplayPower` 只能 OFF/复位、Overlay/WifiDisplay/MediaProjection 一律进默认组。

### 实验 A 实测（用户批准后已执行，2026-09-19 18:4x）
- **结论：路径代码真实存在，但本机被两道门挡住，都需要用户侧决定要不要开。**
- AIDL 里**没有** `createShellVirtualDevice`（它是服务端内部方法，`cmd virtualdevice` 在 system_server 里直接调）⇒ shell 无法外部走「免 CDM 配对」的快路。
- AIDL `createVirtualDevice` 第 3 个参数是**调用方包名下的 CDM associationId**，不是 device profile：传 1 → `No association with ID 1`；
  传 2（本机唯一配对 FreeBuds，属 `com.huawei.smartaudio`）→ `No association with ID 2`（按调用包名过滤，shell 名下一条都没有）；服务端位置 `VirtualDeviceManagerService.java:624`。
- `cmd virtualdevice create-device t4probe` 实测被门拦住：`Keyguard must be insecure to create a virtual device`（本机有安全锁屏凭据）。
- 探针侧两个坑（与系统无关）：一次 `T4vd` 进程 SIGABRT（ART `ExceptionInInitializerError`，重启进程即正常；**系统无影响**：uptime 连续 / Display Groups 仍 size=1 / 无新 xcollie / 无重启）；
  两个 listener 传 null 触发服务端 `Objects.requireNonNull`（改 Proxy 实现后消失）。
- 收尾核对：无残留进程、`Number of active virtual devices: 0`、`Display Groups: size=1`、`stay_on=0`、`doze_always_on=null`，设备侧实验文件已删。

### 需要用户
- 是否批准**实验 A**：shell uid 直连 `IVirtualDeviceManager.createShellVirtualDevice` + `IVirtualDevice.createVirtualDisplay` → 只读核对 `Display Groups` 是否 size=2 且 `displayGroupId ≥ 1` →
  成立再在熄屏窗口内做「内容变化判据」；收尾 `close()` 回滚。**本轮未执行任何写设备操作。**

---

## [未发布 - 批次81 / T4 厂商私有通路] - 2026-09-19：厂商私有显示通路调研 + 一次非预期重启事故（未改产品代码）

### 结论
- **厂商私有通路真实存在、也挖到了入口**：Honor framework-magic.jar 里 `com.hihonor.graphics.VirtualDisplayEx`（+`…Impl`）
  **绕过 DisplayManagerService、用 JNI（`libhihonor_graphics_jni.so`）直连 SurfaceFlinger** 建虚拟显示，
  并用 **SF 私有 binder transact code 7049 / 7054** 销毁与改属性（interface token `android.ui.ISurfaceComposer`）。
  但真机实测：**shell uid 调用 `createDisplay(...)` 返回 null**（不可用），且调用后
  **SurfaceFlinger 卡死（XCollie `onFrameSignal` 超时）→ 系统 PANIC 重启**（危险）→ 双重失败，列入「不得重试」。
- **显示组方向彻底证伪**：只留 `VIRTUAL_DISPLAY_FLAG_OWN_DISPLAY_GROUP` 时，VD 仍是 `displayGroupId=0`、
  `Display Groups: size=1`，且硬证据显示 **Group 0 同时装着物理屏 Display 0 与虚拟屏 Display 73**
  ⇒ **本 ROM 忽略该 flag**（AOSP 15+ 的按组供电对 `VirtualDisplayAdapter` 建的屏不生效）。
- 总结论不变：**不 root / 不改系统 / 不重启 ⇒ 本机无通路让 VD 在息屏/黑屏下继续渲染**；唯一可用仍是 `stay_on_while_plugged_in`。

### 变更（仅文档与证据，无源码 / 无 APK 改动）
- 重写 docs/批次81-T4-厂商私有通路调研.md（含 §6 事故报告、§3 反汇编级私有通路、§7 剩余未测选项）
- 新增证据 docs/evidence/batch81-T4-vendor-reboot/（XCollie SurfaceFlinger 卡死栈 + faultdetect PANIC 记录）

### ⚠️ 事故（如实记录）
- 时间线：17:52:57 SF onFrameSignal 开始卡 → 17:53:07 XCollie 判超时（10s）→ 17:53:1x adb 失联 →
  17:54:13 faultdetect 记 reason [bootfail] … category [PANIC] → 17:54:47 重启完成。
- 归因：卡死栈 = SurfaceFlingerEx::handleMessageOnRefresh ← SurfaceFlingerEx::commit(PhysicalDisplayId, …) ←
  Scheduler::onFrameSignal；同刻两个可疑动作（①厂商 JNI 建显返回 null、②实验自建 SF 图层 layerStack=0 自绘 150 帧）
  **无法唯一归因，均列入「不得重试」清单**。
- 影响与还原：设备自动恢复（Shizuku 自启、3080/3081/3181 均响应）；stay_on_while_plugged_in 重启后回读 **15 → 已还原 0**；
  实验 jar/脚本/日志/pidfile 全删、ps 无残留；screen_off_timeout=1800000、doze_always_on=null 未变；
  **未改产品代码 / 未重打 APK / 未 root / 未动系统文件**。

### 需要用户
1. 解锁屏幕（重启后处于锁屏态；wm dismiss-keyguard 无效）；
2. 拍板：A 接受 stay_on / B 诚实降级（锁屏暂停 + 解锁续跑）/ C 批准继续测 §7 ①②（低中风险，预计无效）/ D 授权 root 改显示栈（破坏性）。

---

## [未发布 - 批次81 / T4 穷尽实测] - 2026-09-19：息屏/黑屏下虚拟屏渲染 —— 9 条路径穷尽实测（未改产品代码）

### 结论
- **在「完全不改变主屏状态」的前提下，本机没有任何通路能让虚拟屏在息屏/黑屏下继续渲染。**
  唯一可用仍是 `stay_on_while_plugged_in`（充电保持唤醒），其本质就是**不让面板熄灭**。
- **用户的直觉对了一半**：系统确实有「按显示/按电源组独立控制」的隐藏能力
  （`cmd power sleep|wakeup --display-id|--group-id`、`cmd power set-wakelock -d <id> <type>`），
  **但本机 ROM 救不了虚拟屏**。

### 根因（本轮新取证，硬证据）
虚拟屏被并进**主屏所在的同一个 power group**：
```
dumpsys power:   Wakefulness Session Power Group powerGroupId: 0
                 dsh:vscreen-panel / dsh:vscreen  ... powerGroupId=0
dumpsys display: Display Groups: size=1   （Group 0 只含 Display 0）
```
VD 虽带 `FLAG_OWN_DISPLAY_GROUP`，系统**未为它建独立显示组** → 主屏电源组一睡，VD 同组同睡。

### 穷尽实测矩阵（9 条，判据=VD 内注入改内容比 sha256）
| # | 路径 | 结果 |
|---|---|---|
| P0 | 基线（无手段） | **DEAD** |
| P1 | `set-wakelock -d <VD>` × {PARTIAL,SCREEN_DIM,SCREEN_BRIGHT,PROXIMITY_SCREEN_OFF} | **无效**（锁 held=true 但 wake 仍睡） |
| P2 | `set-wakelock -d 0` × {PARTIAL,SCREEN_DIM} | **无效** |
| P3 | `cmd display power-reset <VD>` | **无效** |
| P4 | `cmd display enable-display <VD>` | **无效** |
| P5 | `cmd power suppress-ambient-display` | **无效** |
| P6 | `svc power stayon true` | ✅ **唯一有效** |
| P7 | S3 overlay 策略 | **拿不到**（S1 trusted 先成功） |
| P8 | `screencap -p -d <VD>` | **不可用**（Awake 下也产不出文件） |
| P9 | 熄屏下 `input -d <VD>` 注入 | **未被消费**（内容不变） |

### 新增硬事实
- `cmd power wakeup --display-id <VD>` 能唤醒 VD，但**主屏一起亮**（不区分「只唤醒 VD」）；
- `cmd power sleep --display-id <VD>` 与 `--group-id 0` 效果相同（都整机 Asleep）→ 无法分离；
- **不存在把 display 移入新组的公开命令**（`set-display-group`/`setDisplayGroup` 均 Unknown command）；
- `screencap -d <displayId>` 在本机**不支持**按 display 截屏。

### 方法论教训（已记档，避免重踩）
1. **v1 假 LIVE**：`am start` 在 VD 内切 App 会**唤醒主屏** → 所有路径误判 LIVE；改用 `input -d <VD>`；
2. **v2 假 INVALID**：`dumpsys` 的 stderr（`Broken pipe`）污染 stdout 解析 → 只取 stdout 精确匹配；
3. **熄屏窗口不稳定**：VD 会话期 App 自己的批次66 保活锁震荡（唤醒→~10s 压暗→再唤醒），
   需用 `cmd power sleep` 强制入睡抢采样。

### 测试耗时
9 条路径 + 6 轮迭代全部 ~25 分钟内完成，单条判据平均 **<90 秒**（`cmd power sleep` 秒级入睡，
不再等超时、不再盲等闪烁）。

### 建议（待拍板）
1. **接受 `stay_on`（推荐）**：仅有任务在跑时置位、收尾还原回读、面板如实显示「已生效（充电中）/未生效」；
2. 诚实降级：锁屏即暂停 VD 任务、解锁自动续跑；
3. 继续挖系统层需 root 改显示栈 —— **超出「不破坏系统」约束，未执行**。

### 收尾
设备操作全部可逆且已还原：`stayon=false`、6 把实验 wakelock 全 `held=false`、
`suppress-ambient-display` 已 false、`screen_off_timeout=1800000`、`doze_always_on=null`、
VD 全部 close、实验服务端与 jar 已删。**未改产品代码、未重打 APK、未重启、未 root、未动显示栈。**

## [未发布 - 批次81 / T4 方向3 补] - 2026-09-19：排除「旧缓存帧」假象 —— 实时渲染判据严格化（未改产品代码）

### 认知（关键补强）
- 子代理只读调查确认：服务端 `see` 在 `trusted/plain` 策略下返回 **ImageReader 缓存帧**且
  **不做帧龄校验**（`sawFrame`/`frameTs` 写入后**全工程无读取方**）→ **「200 + 某尺寸 PNG」不能证明实时渲染**。
- 新增**内容变化判据**（在 VD 内切换 App，比 sha256）：

| 条件 | 切换前 | 切换后 | 判定 |
|---|---|---|---|
| 锁屏 + **屏幕亮**（stay_on） | `c0c68b902d38`（141,225 B，settings） | `9caa8c02ce7d`（108,041 B，documentsui） | **实时渲染 LIVE** ✅ |
| 锁屏 + **屏幕熄**（Dozing） | `a1dccf063976`（11,025 B） | `a1dccf063976`（**未变**） | **渲染已死 STALE** ❌ |

→ **方向3 结论严格成立**：`stay_on` 让面板保持亮时，锁屏下 VD **真实时渲染**；面板熄灭时渲染**真的停了**
（不是「黑但还在画」）。
- 另一条只读事实：`see` 在**从未收到帧**时返回 `DISPLAY_TIMEOUT`（503），故「200 + 黑图」至少说明帧泵交付过帧 ——
  但**帧是否新鲜**必须用内容变化判据，不能只看尺寸/颜色数（此前只用颜色数，判据不够严）。

### 收尾
- 设备设置全部还原并回读：`screen_off_timeout=1800000`、`stay_on_while_plugged_in=0`、
  `doze_always_on=null`；实验服务端已 kill（`ps` 无 vscreen 进程）、实验 jar 已删、VD 已 `/vscreen/close`。
- **未改产品代码**，未重打 APK、未重启、未 root。

## [未发布 - 批次81 / T4 方向3] - 2026-09-19：锁屏下虚拟屏渲染通路已找到并真机验证（未改产品代码）

### 结论（重大）
- **找到锁屏下让虚拟屏继续渲染的通路，不需 root、不重启、不改系统文件**：
  让**面板在锁屏期保持亮**（而非旧思路的「让主屏不熄」）——手段是 Android 原生公开设置
  **`stay_on_while_plugged_in`（充电时保持唤醒）**，并修掉已失效的 `SCREEN_DIM` 点亮机制。
- 实测（锁屏 + 充电 + `mStayOn=true`）：VD **1008×1792 / 141,225 B / 54 种颜色 = 真实 UI**，
  持续 70s+ 稳定；同一 VD 面板熄灭时 **11,025 B / 1 色 = 纯黑**。
- **关键分离**：变量是**「面板是否熄灭」**，不是「是否锁屏」。屏幕亮着 + 锁屏态时 VD 渲染完全正常
  （54 色，三次复现）——这条推翻了此前「锁屏导致 VD 黑」的表述。

### 证伪（省得重走）
- **`DEVICE_DISPLAY_GROUP` 假设证伪**：自建实验 jar（去掉 `OWN_FOCUS`+`DEVICE_DISPLAY_GROUP`）在独立端口
  起服务端 A/B → 两个 VD 都是 `displayGroupId 0`，熄屏后**都黑**（均 11,025 B / 1 色）。改 flags 无用。
- **批次14f「面板 OFF → SF 停止合成 trusted VD」已过期**：VD 未被销毁，`see` 仍 200、无 SESSION_DEAD；
  黑帧来自面板熄灭而非层被拆。
- **`SCREEN_DIM_WAKE_LOCK` 已失效**：锁持有中（`ACQ=-1m7s`）而 `mWakefulness=Dozing`。

### 方案（待拍板）
1. 会话期（**仅有任务在跑时**）改用 `stay_on_while_plugged_in` 作主手段，**收尾必须还原原值并回读确认**
   （沿用批次66b 的「改过才还原」纪律）；保留 `SCREEN_DIM` 作为非充电场景的尽力而为。
2. 无 RUNNING 任务 + 无挂起交互 → 不点亮（省电）。
3. 面板/设置页如实显示「锁屏保活：已生效（充电中）/未生效（未充电 → 锁屏后虚拟屏会停）」。
4. 修掉现有「点一次 → 10s 又熄 → 再点」循环。
- **硬前提：需要充电**（`stay_on_while_plugged_in` 语义），正好匹配「插电过夜跑长任务」。

### 测试提速（实测）
- 本轮全部判据 **< 90 秒**拿到；核心判据 = 「面板状态 + VD 像素颜色数」两快照，各 5~10 秒；
- 用 `settings put system screen_off_timeout 20000` 把「等超时熄屏」从 30 分钟压到 20 秒（**用完即还原**）；
- 不再盲等闪烁，改读 `dumpsys power` 的 ACQ/REL 计数差；目标单次 **<60s**。

### 验证 / 收尾（设备操作全部可逆且已还原）
- `svc power stayon true` → 已还原 `false`（`stay_on_while_plugged_in=0`）；
- `screen_off_timeout 20000` → 已还原 **1800000**；
- 自建实验服务端（8997 + 实验 jar）→ 已 kill（仅剩现网 `dsh-vscreen`）；
- 实验 VD（displayId 55/56）→ 已 `/vscreen/close`；`doze_always_on` 回读 **null**；
  面板锁已 `REL dsh:vscreen-panel`。
- **未改产品代码**、未重打 APK、未重启、未 root、未动显示栈。

### 需要用户配合
- **解锁屏幕**（本机有锁屏凭据，`wm dismiss-keyguard` 实测无效）；
- 拍板是否接受「挂机需充电」+「锁屏期屏幕保持亮」。

## [未发布 - 批次81 / T4 重制] - 2026-09-19：锁屏下虚拟屏保活 —— 旧方案前提被真机取证推翻，方案重制（未改产品代码）

### 决策 / 方案（待用户拍板）
- **不再加亮屏类唤醒锁（方向已错）**。本轮真机取证证明锁屏保活的历史方案（批次66/66b 的
  `SCREEN_DIM_WAKE_LOCK + ACQUIRE_CAUSES_WAKEUP`）在 MagicOS 11 / Android 17 上已失效。
- 三选一（详见 `docs/批次81-T4-锁屏虚拟屏保活方案重制.md`）：
  **方向1（推荐）** 锁屏时不做虚拟屏，改走「主屏 + 特权注入」盲操作通路（读屏类任务锁屏态必须解锁）；
  **方向2** 诚实降级（锁屏不点亮 + 提示「长任务已暂停，解锁后自动续跑」+ 引导系统白名单）；
  **方向3** 继续找锁屏下让 VD 渲染的系统级通路（未验证、风险高、优先级最低）。

### 认知（真机取证，推翻三条旧假设）
- 实验（全程 <10 分钟）：VD `displayId=54`（trusted）→ 亮屏态 see **200 / 141,225 B / 54 色**（真实 UI）；
  `keyevent 223` 熄屏后同 VD see **200 / 11,025 B / 1 色 = 纯黑**；`dumpsys power` 显示
  `dsh:vscreen-panel` **锁持有中**（`ACQ=-1m7s`）却 `mWakefulness=Dozing`；锁屏态 3181 `displayId=54` dump `count=0`；
  而 `/vscreen/status` 仍 `ok=true`、serverPid 存活。
- ① 「面板 OFF → SF 停止合成 trusted VD」（批次14f）**已过期**：VD 现带 `OWN_DISPLAY_GROUP`（SDK≥33）+
  `ALWAYS_UNLOCKED`，主屏熄屏不再停合成（see 仍 200、无 SESSION_DEAD）；
  ② 「持 SCREEN_DIM 面板不熄」（批次66/66b）**已失效**：锁在而屏灭；
  ③ `ALWAYS_UNLOCKED` 只解 keyguard 约束，**渲染通路**在锁屏态仍被切断。
- 附带发现：`panel keepalive acquired` 后约 10s 屏幕又熄 → 再 reassert，形成「点一次→10s 熄灭」循环（费电且无收益）。
- **用户判断被证实**：App 进程保活早已解决（锁屏期间 3080/3081/3181 三桥全程 200、进程存活）——
  真正没解决的是「执行任务时虚拟屏在锁屏下拿不到渲染」。

### 变更（测试方法）
- **验收改快照式**（回应「测试时间过长」）：旧 e2e 慢在无界轮询 + 多阶段串行 + 固定长等待
  （`UNLOCK_WAIT_SECONDS=30` 等）；新方案用 `dumpsys power` + `/vscreen/see` 像素统计 + `/vscreen/status`
  三个终态快照，合并为单会话 3 次采样，目标**单次 <60s**；闪烁类改用 ACQ/REL 计数差即时判定。

### 已知约束（需用户配合，不假装能做）
- **解锁必须由用户完成**：本机有锁屏凭据，实测 `wm dismiss-keyguard` **无效**（`showing=true` 仍在）。
  涉及「解锁后恢复」的验证必须用户手动解锁。

### 验证 / 收尾
- 本轮**未改产品代码**，无构建、无装机。
- 已 `/vscreen/close`（`restoredOverlay=false`）；`dsh:vscreen-panel` 已 `REL`；
  `doze_always_on` 回读 **null**（本会话未改）。设备取证后仍锁屏，已提示用户解锁。

## [未发布 - 批次81 / T3] - 2026-09-19：定时任务到点验收 + 现场修掉「到点必失败」的 RPC 契约缺陷（三条）

### 修复（T3 现场发现，非计划内）
- **定时任务到点后恒失败于「创建会话失败（可能未配置 API Key）」** —— 真机取证（2026-09-19）
  用 curl 逐条复现，坐实 `ScheduleExecutor.rpc()` **三条独立契约缺陷**（旧实现全中）：
  1. **端点**：方法名的点没换斜杠 —— `/api/session.create` 返回 **404 not found**，`/api/session/create` 才 200；
  2. **信封**：request 体直接放在 `payload` 下 → `gateway/input-invalid`（typert 边界校验拒）；
     必须 `payload.args.request`（`session.list` 是唯一例外，用 `_request`，与 OverlayAgentClient 同口径）；
  3. **鉴权**：**完全没带引擎 Cookie** → 401 `unauthorized`；dsh 0.1.5 把首页与全部 `/api` 放到
     process token 门禁之后，必须带 `dsh_prefs/engine_cookie`。
  另有第 4 条：`session.prompt` 的 request **必须带 `requestId`**，缺它同样 `gateway/input-invalid`。
- **同一缺陷存在于 `MainActivity.rpcCall()`**（定时任务经 Activity 路径 + 系统分享共用）：Cookie 早就有，
  但端点与信封同样错 —— 即系统分享「发给 AI」也会静默失败。一并按可用形状修正。
- **误导性错误文案**：`创建会话失败（可能未配置 API Key）` / `无法创建会话（引擎未就绪或无 API Key？）`
  把**契约缺陷**说成**用户没配 API Key**。改为如实描述 + 指明排查方向（`engine_cookie` 是否在位）。
- **e2e 脚本取到结论后崩溃**：`tools/e2e_batch70_live_wait.py` 缺 UTF-8 stdout 处理，
  detail 含 `✓`（实况窗终态文案）时在 Windows cp936 控制台抛 `UnicodeEncodeError`——
  结果已拿到、报告却没落盘。新增 `use_utf8_stdout()` + `safe_print()`，所有输出走安全打印。

### 新增
- `tests/test_batch81_t3_scheduled_rpc.py`（5 条闸门：端点斜杠 / args.request 包装与 `_request` 例外 /
  Cookie 在位且与 OverlayAgentClient 同源 / prompt 必带 requestId 且两处共用同一构造 / 文案不再甩锅 API Key）。

### 验证
- 离线：`pytest 396 passed`（新增 5 条）；javac rc=0；签名 APK 202,208,485 B + `adb install -r` Success。
- **真机 T3 定时任务到点验收 PASS**（`python tools/e2e_batch70_live_wait.py scheduled`，121s）：
  实况窗发布=是 / 执行中采样=是 / 终态 `✓ 定时任务已完成`；文件日志出现
  `任务已发送给 AI: …`，且通知栏出现 `✅ 定时任务执行成功`。
  修前同一脚本为 FAIL，日志停在 `创建会话失败（可能未配置 API Key）`。
- **横滑确认（T3 另一项）已自动化完成**：设置弹窗 → 保活卡片按钮行是 `HorizontalScrollView`
  （MainActivity 的 Dialog，注入触摸有效，与 App 浮层不同）——`input swipe` 两次后 8 个按钮全部可达，
  `实况窗：开` / `直接执行：关` 均正常渲染，无 0 宽控件。

## [未发布 - 批次81 / T5] - 2026-09-19：App 侧本地桥（3081）不可用时的「可见 + 可操作」收口（拍板不自动拉起）

### 决策（用户拍板）
- **不做「看护自动拉起 3081 / App 进程」**。理由：会改批次67「App 可被杀、引擎不受影响」的设计，且牵涉 Honor 后台/自启策略（真机白名单不可控）。
  改为三件事：① 悬浮面板 + 设置页**显式呈现**该中间态；② 插件侧**统一可操作指引**；③ **记档为已知边界**。

### 修复
- **插件失败文案不可操作（两插件统一）**：新增常量 `APP_BRIDGE_HINT`，替换散落的
  `App 本地服务不可用（请先启动 DeepSeek Harness）` / `App 原生桥不可达` / `App 原生桥无响应` /
  `App 本地桥（3081 /vscreen/*）不可达`。新文案点明「App 侧本地桥（3081）」并给出恢复动作
  **「请打开「小鲸鱼助手」（App 主界面，或点悬浮球 / ⤢）后重试」**，同时说明「引擎 3080 可能仍在运行，属正常」。
  另加 `APP_BRIDGE_TIMEOUT_HINT`（超时腿：有响应但慢，同样要给恢复动作）——**只改 3081 侧**，3181 的
  `App 本地服务超时` 保持原样（它的 reason 由 `failReason` 归一到 `BRIDGE_UNREACHABLE`，语义不同）。
  接入点：`dsh-tool-android` 4 处（`appPost`/`appRequest` 的 error 与 timeout、`vscreenFail` hint、`android_task_list` 兜底）；
  `dsh-tool-accessibility` 3 处（`appRequest` error/timeout、`vscreenFail` hint）+ 2 处组合文案
  （`android_a11y_status` 双桥不可达、`android_open_a11y_settings` 失败）。

### 新增
- **悬浮面板「App 侧能力」详情行**（`OverlayService`）：探测循环同轮探一次 3081（`appBridgeAlive()`，
  判据「有 HTTP 响应即可」——3081 鉴权前置会对无 token 探测回 401，与 3080 口径一致），状态变化/首次探活留痕
  `[b81t5] app-side bridge (port 3081) up|down`。不可用时该行显示
  `App 侧能力：不可用（3081 未监听，最近探活 Ns 前）——点此打开小鲸鱼助手后重试；虚拟屏/剪贴板/通知/悬浮窗依赖它`，
  且**可点直达主应用**（恢复动作就在手边）。
- **状态标签区分「助手离线」**：引擎在线但 3081 不在场时不再只报「就绪」（会把「助手执行失败」误判成引擎/任务失败）；
  首次探活前不下结论，避免启动瞬间误报。
- **设置页保活卡片「App 侧能力（3081）」一行**（`MainActivity.appSideCapabilityLine()`）：读悬浮面板探测缓存
  （不在主线程发 HTTP，避免 ANR）并标注新鲜度；无缓存时如实显示「未探测」而不是假装可用。
- `tests/test_batch81_t5_app_bridge.py`（11 条闸门：探活口径 / 端口与 `notifyPort()` 一致 / 面板与设置页文案与可点性 /
  状态标签区分 / 两插件同文案 / **不新增自动拉起通路**）。
- `tools/e2e_batch81_app_bridge_visibility.py`（真机 e2e：Phase A 前置事实 + 设备侧插件已带新文案；Phase B 面板
  「助手离线」+ 详情行可操作指引 + 「唤起助手后 3081 仍未 LISTEN」前提自检；Phase C 设备侧插件探针——用引擎自己的 node
  加载**设备侧真实插件**、把 3081 指向死端口，断言 `execute.reason=BRIDGE_UNREACHABLE` 且 **模型可见 render 含新指引**）。
- `docs/批次81-T5-App侧桥可见性与提示收口.md`（决策 + 实施 + 真机取证 + 边界记档）、
  `docs/screenshots/batch81-T5/panel-app-bridge-down.png`。

### 变更（认知 / 文档）
- `AGENTS.md`：已知坑补「3081 只在 `MainActivity.startEngine()` 路径 bind」的**处置口径**——不自动拉起，
  面板/设置页可见 + 插件指引可操作 + 边界记档；e2e 清单补 `e2e_batch81_app_bridge_visibility.py`。
- 记档边界（新增一节）：**App 进程不在场时 3081 全族能力不可用属已知边界，不是缺陷**；恢复动作 = 打开小鲸鱼助手。

### 验证
- 离线：`pytest 391 passed`（含新闸门 11 条）；`node tests/test_vscreen_router.mjs` 13 组 100% 通过；`node --check` 两插件 rc=0；javac rc=0。
- 构建/装机：`python .local/b47_build.py all` → 签名 APK 202,208,485 B → `adb install -r` Success。
- 交付链：`tools/e2e_batch81_plugin_paths.py` Phase A `verdict=in-sync problems=0`（repo=payload=设备，
  android `f7d8f5e47813` / a11y `8e1d14411bfc`）。
- 真机中间态复现（Honor BKQ-AN10）：`install -r` 后 3080 LISTEN、3081 不 LISTEN（BootReceiver 拉起悬浮球但未走 MainActivity）
  → 日志 `[b81t5] app-side bridge (port 3081) down … engineUp=false (first probe)`；面板状态行 `助手离线`、
  详情行含恢复动作；`e2e_batch81_app_bridge_visibility.py --live` **连续 3 次 exit=0（15 条断言全 PASS）**。
- 3081 在场对照：打开主界面后日志 `notify server listening on 3081`、面板行变 `App 侧能力：可用（3081 在监听）`。
- Phase C 实测 render（模型实际看到的那一行）：
  `虚拟屏点击失败：BRIDGE_UNREACHABLE — App 侧本地桥（3081）不可达：请打开「小鲸鱼助手」…后重试——虚拟屏、剪贴板、通知、悬浮窗都依赖 App 进程在场（引擎 3080 可能仍在运行，属正常）。`


## [未发布 - 批次81 / T1+T2] - 2026-09-19：交付链固化进构建期 + 插件自愈闭环（含现场发现的陈旧守卫态与 3081 启动路径）

### 修复
- **插件交付链断点固化进构建期（T1）**：`tools/b47_build.py` 新增 `sync_plugins()`，`pack` 阶段第一步先 `tools/sync_base_apk_plugins.py --check`，不一致**自动同步**（`B47_PLUGIN_STRICT=1` 则失败退出）→ 「改了插件没进 APK」不再依赖人记得跑脚本。
- **构建脚本双副本收口**：`tools/b47_build.py`（受控，权威）与 `.local/b47_build.py` 字节一致，新增闸门 `tests/test_batch81_build_sync_hook.py`；AGENTS「待确认」整节删除。
- **虚拟屏直连工具自愈（T2-1）**：`android_vscreen_see/tap/swipe/key` 的本地守卫改为 `ensureVscreenCreated()`（原来直接本地返 `NOT_CREATED`，逼模型手动 create）。
- **陈旧守卫态自愈重试（T2-3，真机现场发现）**：App 任务收尾会回收虚拟屏，但插件进程内守卫态仍为 `true` → 下个任务首个 vscreen 调用必失败一次。新增 `vscreenRetryAfterSessionLoss()`：桥返回 `NOT_CREATED`/`SESSION_DEAD` 时清位 → 自愈建屏 → **重放同一请求一次**（最多 1 次；`unreachable` 与其它 reason 不重试）；接入 10 处（4 个直连工具 + `android_app` launch / `android_screenshot` / `android_input` tap·swipe·keyevent·text）。

### 新增
- `tests/test_batch81_build_sync_hook.py`（4 条：pack 调用顺序、helper 契约、双副本字节一致、假 APK 过期 payload 的行为验证）。
- `tools/e2e_batch81_plugin_paths.py`：Phase A = repo↔payload↔设备 三方 sha256 逐文件比对（退出码 0/1）；Phase B = 面板提交探针 → 哨兵判定（`B81_SELFHEAL_OK`=PASS / `B81_READONLY`=WARN exit 3 / `B81_GUARD_STILL`·超时=FAIL），前置检查含 3080 与 **App 本地桥 3081 `/status`**；支持 `--prompt` / `--prompt-file`。
- `tests/test_vscreen_router.mjs` 新增 Test 12（守卫态丢失自愈）与 Test 13（陈旧守卫态一次重试 + 负例不重试），全套 13 组。
- `docs/批次81-T1T2-交付链固化与插件自愈.md`（实施报告 + 真机证据 + 转写复核）、`docs/批次81-T4锁屏保活只读调查.md`（T4 拍板输入）。

### 变更（认知 / 文档）
- `AGENTS.md`：插件交付链改为「构建期自动同步」；双副本权威 = `tools/`；测试基线 380 + `.mjs` 入口；e2e 清单补 `e2e_batch81_plugin_paths.py`；**已知坑新增「3081 只在 `MainActivity.startEngine()` 路径 bind」**（App 进程重启后 vscreen/剪贴板/通知/overlay 全 `BRIDGE_UNREACHABLE`，而托管引擎 3080 照常跑）。

### 验证
- 离线：`pytest 380 passed`（含新闸门 4 条）；`node tests/test_vscreen_router.mjs` 13 组 100% 通过；javac rc=0。
- 构建/装机：`python .local/b47_build.py all` → pack 日志出现自动同步 → 签名 APK 202,204,389 B → `adb install -r` Success → 设备自 re-stage（引擎 pid 27523）。
- 三方一致性：`plugins/` = payload = 设备 `/data/local/tmp/dsh/home/.../dsh-tool-android/lib/index.js` = `cc0006a7b40a`（185,717 B）；改前状态 `cb214a409870 / e96dd947a640 / e96dd947a640` 被 Phase A 判 OUT-OF-SYNC。
- 真机 Phase B：13:31（改前）`NOT_CREATED` FAIL 复现 → 13:41:48 / 13:42:14（改前必失败的同序列）/ 13:43:30 连续 3 次 PASS；会话转写证明模型**未**调用 `android_vscreen_create`，只有 `android_vscreen_tap{x:500,y:500}` → `已在虚拟屏点击 (500, 500)`。
- 只读探针（see）在只读指令下按设计被 App 闸门拒建屏 → WARN/exit 3（非缺陷）。

## [未发布 - 批次80 补 / 工具链] - 2026-09-19：UI 取证通道实测（scrcpy MCP）+ 像素复验与批次79 §6 收口

### 新增认知（真机实测）
- **scrcpy MCP 可用**：v4.1，`start_session`/`screenshot`/`shell_exec`/`file_pull`/`tap`/`swipe`/`key_event`/`stop_session` 全部响应；截图归档链路 = `shell_exec screencap` → `file_pull docs/screenshots/<批次>/`。
- **scrcpy 的 `ui_dump`/`ui_find_element`（uiautomator）在本机恒返回空**（桌面与浮窗场景一致）→ 不可作判据，语义继续走 App 自带 3181 桥。
- **App 内部 overlay 对话框不保证响应注入触摸**（保活卡片「关闭」在 adb/ scrcpy/a11y 手势下均无反应，3181 桥 ACTION_CLICK 生效）→ 操作 App 浮层优先用 3181 桥。
- 通道选择规则已写进 `AGENTS.md`「屏幕取证通道怎么选」+ `docs/STATE.md` 已知坑。

### 复验（像素 + 语义）
- 保活卡片按钮行区域灰度 mean=96.2/stddev=47.8（有实际绘制）、行容器 864×142 单行、`应用详情` 宽 220 → 批次79「实况窗开关被压成 0 宽」确已消失；功能可达由 ACTION_CLICK 翻转 `agent_auto_proceed` 验证。
- **批次79 §6 第 3 条（历史抽屉会话号）复验通过**：抽屉逐条显示 `· 会话…7e7db566` 等，且三态标签（✓完成 / ✕失败 / •已结束）与今晚语义一致。
- 归档：`docs/screenshots/batch80/{b80_history.png, b80_card.png, b80_01_current.png}`。

### 未做
- 「手指横滑可达性」无法用注入输入验证（注入触摸对 App 内部对话框不生效）；定时任务到点验收仍待真实闹钟。


## [未发布 - 批次81] - 2026-09-19：下一步计划（交付链固化 / 插件验证 / 遗留收口 / 两项拍板 / 体验层）

### 计划（本轮只出方案，不动产品代码）
- **T1（P0）交付链固化**：`tools/b47_build.py` pack 阶段前置 `tools/sync_base_apk_plugins.py`（不一致即自动同步，可 `--strict` 失败退出）；并把 `.local/b47_build.py`（8,932 B / e807e916）与 `tools/b47_build.py`（9,237 B / ad1ae293）**双副本统一**（AGENTS 待确认项收口）。
- **T2（P0）插件缺口与真机验证**：`android_vscreen_tap/swipe/key/see` 补 `ensureVscreenCreated`（≈5 行/工具）+ 新增 `tools/e2e_batch81_plugin_paths.py` 验证「事务内 type 特权兜底 / BRIDGE_UNREACHABLE 文案与自愈 / privSetting 回读腿」。
- **T3（P0·需用户 5 分钟）**：定时任务到点验收（看 `scheduled-log.txt`）+ 保活卡片按钮行手指横滑确认。
- **T4（P1·需拍板）**：锁屏保活策略（省电 vs 锁屏可跑）；建议默认不改行为 + 新增「锁屏省电」开关 + 空闲 30s 释放防抖。
- **T5（P1·需拍板）**：看护是否守护 3081（App 桥）；建议不做自动拉起，只做提示层与文档边界。
- **T6（P2·按需）**：一键放行候选② / 批次59 剩余方向重评 / `session/follow` 真事件流。
- 明确暂不做：targetSdk 大升级、厂商胶囊私有接口、YOYO 拦截、scrcpy uiautomator、2.4-c c-ares。
## [未发布 - 批次80 / 78-T5] - 2026-09-19：T5 杂项收口（只读误判 / 直接执行 / 假空屏 / privSetting 回读 / 保活锁竞态 / 插件交付链修复）

### 🔴 交付链修复（最重要）
- **插件改动此前根本没进 APK**：`plugins/` 是唯一受控来源（`tools/dsh_updater/workspace.py:125`），设备侧插件来自 base APK 的 `assets/payload.zip`，而本地增量构建不重建 assets/。实测：批次74/75 的 `dsh-tool-accessibility` 改动（plugins c17244d7/138,608）**未进 payload** —— payload / staging / 设备三处都是 b1133e2d/127,154（base APK mtime 14:24 早于批次74 15:02）。
- 新增 **`tools/sync_base_apk_plugins.py`**：把 `plugins/**` 同步进 base APK payload（幂等、`--check`、顺带镜像 staging 派生副本）；新增闸门 **`tests/test_batch80_plugin_payload_sync.py`**。同步后真机复验：设备侧插件 = **c6976cd0e73a / 140,369 B**（含批次74/75 + 本批次修复）。
- `AGENTS.md` 更正：「改插件即改 staging，随 b47 重打包」是错误描述，已改为真实链路（`plugins/` → payload → 设备；staging 是 git-ignored 派生副本）。

### 修复
- **只读误判导致长自动化被反问授权**（OverlayService.shouldUseVscreen）：原来只读词命中即整轮判只读 → 注入「禁止虚拟屏」+ VscreensManager 硬闸门拒绝 `/vscreen/create` → 长任务回头问用户。改为「命中只读词 **且** 不含任何动作词」才判只读（新增 `ACTION_SCREEN_MARKERS`）。
- **面板「假空屏」**（AccessibilityService.readContextTarget）：活动窗口与候选窗口两条路径都加 `countNodes(root) <= 0 → 跳过/失败`；树可读但为空时诚实返回 `ok:false + NO_ACCESSIBILITY_READABLE_WINDOW`，不再返回 `ok:true + count:0` 伪装成「界面没有控件」。
- **privSetting 回读腿假报错**（VscreensManager）：新增 `privSettingGetRaw()`（读不到 → Java null），回读不可得时记 `unverified (readback unreadable)` 而不是 `ok=false`；`privSettingGet()` 的 `"null"` 契约保留（ensure 原值判断依赖）。
- **面板保活锁竞态**（VscreensManager.escalatePanelKeepAliveIfNeeded）：`sleep(1.5s)` 后、取锁前再核对 `sessionActive / shutdownRequested / 偏好` —— 会话已收尾不再取锁（此前会点亮到下一次会话收尾）。
- **android_act 事务内 type 未接特权兜底**（plugins/dsh-tool-accessibility）：抽出 `typePrivilegedFallback()`，单工具 `android_type` 与事务共用同一条链路（剪贴板 + `/vscreen/key 279` + A11y 回读 → `privilegedType` 按 displayId 直注 + 回读）。

### 新增
- 「直接执行」开关（MainActivity 保活卡片 + `dsh_prefs/agent_auto_proceed`，默认关）：开启后 prompt 首条写明「用户已授权 · 直接执行：不要反问/不要请求授权」，仅不可逆高风险动作才确认；开启时留 `[b80] prompt: auto-proceed authorized` 日志便于取证。

### 变更（旧结构契约同步，意图不变）
- tests/test_batch60_prompt_and_selection.py：只读判定断言改复合条件 + 镜像 `_need()` 同步动作词规则 + 新增「复合指令不是只读任务」用例。
- tests/test_batch72_scope_and_priv.py：`android_type` 兜底断言改为「工具体走 `typePrivilegedFallback` + 该链内含 `/vscreen/key 279` 与按 displayId 的 `privilegedType`」。

### 验证
- 离线：`python -m pytest tests/ -q` **376 passed**（新增 11 条）；`node --check` 插件 OK；`.mjs` 回归全绿（vscreen_router 11/11、permission_gate 44 项）；`.local/javac_check.py` rc=0；签名 APK + `adb install -r` Success；`sync_base_apk_plugins.py --check` unchanged。
- 真机：①设备侧插件 = c6976cd0e73a/140,369（交付链修复生效）；②桌面 `dump?displayId=0&exclude_self=1` 仍 63 节点（假空屏改动无回归）；③「直接执行」开关 `tap?text=直接执行：关/开` 双态 `found:true`，开启后提交任务出现 `[b80] prompt: auto-proceed authorized`；④保活卡片按钮行 864×142 单行（批次79 修复生效）；⑤`watchdog.state state=OK`。

### 决策（留档）
- 锁屏保活「按需保活」策略收紧 **待用户拍板**（省电 vs 锁屏可跑；批次14f：面板 OFF → SF 停止合成 trusted VD），本轮只做竞态硬化。
- `android_vscreen_*` 的 `BRIDGE_UNREACHABLE` **不改文案**（已含可操作指引，App 回来后 3 条路径自愈）；让看护守护 3081 属产品决策。
- 「单步静默 >5min 收圆点」**已闭环**（批次56-A 的 4min 心跳，`HEARTBEAT_INTERVAL_MS=240000`）→ 该遗留关闭。


## [未发布 - 批次79 / 78-T4] - 2026-09-18：助手状态实时化与续跟（真静默收尾 + 只读续跟 + 会话探测修复 + 两处静默失效修复）

### 修复
- **面板「AI：回复中…/空闲」恒显示「空闲」**（OverlayService.fetchSessionInfo）：探测走 `/api/session.list`（点号）且**不带 Cookie** → 网关 401（真机 `curl` 复测：`POST /api/session/list` 无 Cookie = `401 unauthorized`）→ 探测恒 null。改为路径口径统一 `/api/session/list` + 补 `Cookie: engine_cookie`；真机实测任务运行中详情显示 `AI：回复中…`。
- **中性收尾抢跑**（OverlayAgentClient.pollForResult）：`endedRounds` 改为「`running=false` **且本轮 asOfSeq 无增长**」才递增（`seqAdvanced` 一出现即清零），门槛 30 → **120 轮（≈120s 真静默）**，判死加 `!seqAdvanced` 前置 —— 引擎 checkpoint 拼接 / 自动续跑 / queue 排队期间不再被误当「本轮结束」。
- **定时任务链路整条失效（P1，子代理 e2e 发现）**（ScheduleExecutor.engineReady）：dsh 0.1.5 首页在 process token 门禁后，无 token 恒 401（`dsh web authentication required`）→ 旧实现 `getInputStream()` 抛异常 → 恒 false → 「引擎未运行，尝试启动…」→「30 秒未就绪，放弃」，任务不执行、实况窗不发布。改为认 401（与 MainActivity.healthOk 同判据），并把 `code>=500` 的宽松判据收口为 `>=400`。
- **设置页「实况窗：开/关」被压成 0 宽（P1，子代理 e2e 发现）**（MainActivity.buildKeepAliveCard）：8 个 `WRAP_CONTENT` 按钮挤在 864px 行内，后 5 个宽度为 0（dump 丢弃 `w<=0`、坐标点击打空）。按钮行改为 `HorizontalScrollView`（保持按钮原始宽度、超出可横滑）。
- **历史项无会话号**（OverlayService.saveTaskHistory/showHistoryDialog）：历史项落 `sessionId`，列表显示「· 会话…后8位」，可与 dsh 侧会话对账。

### 新增
- **只读续跟**（OverlayAgentClient.track/trackSession）：`🔄 续跟引擎` 用同一 `sessionId` 只读轮询 `session.list/page`，不发 prompt、不新建会话、不 cancel；空闲且静默 10s 收尾，文案带 `【续跟】` 前缀（上层不谎报成功、不判失败）；超时文案「跟踪超时（引擎侧仍在运行）」。
- **面板入口**（OverlayService）：终态（失败/已结束）且无任务在跑时露出「🔄 续跟引擎」chip（与既有系统 chip 同排，可横滑到）；历史操作菜单新增「🔄 续跟该会话」；续跟不写任务历史。
- **中性收尾兜底上限**（OverlayAgentClient）：`IDLE_WITHOUT_RESULT_ABS_CAP_ROUNDS=600` —— `running=false` 连续 ≈10 分钟也中性收尾，防杂散事件把面板永久挂着。
- **脚本工具**：`tools/e2e_batch79_track.py`（--mode live / --mode fail，含托管引擎 SIGSTOP/CONT 兜底恢复）；子代理并行交付 `tools/e2e_batch70_live_wait.py`（批次70 §3.2 矩阵）。

### 变更（旧结构契约同步）
- tests/test_m1_overlay_source.py：`postAgentCallback(generation, new Runnable()` 计数 6 → 10（续跟监听器 onProgress/onPartial/onResult/onError 各 +1），契约意图不变。

### 验证
- 离线：`python -m pytest tests/ -q` **364 passed**（新增 tests/test_batch79_state_fidelity.py 13 条）；`.local/javac_check.py` rc=0；签名 APK 202,200,293 B + `adb install -r` Success。
- 真机：①会话探测 `AI：回复中…`（运行期）/`AI：空闲`（结束）双态实测；②`--mode fail`：SIGSTOP 引擎 60s → 面板 `任务：失败：[net/connect-timeout] 引擎请求超时` → chip 出现（横滑后可见可点，`found:true`）→ 点击后 `任务：续跟中，续跟：引擎侧空闲 · 事件#14 · 已跟4s` → 10s 后 `任务：引擎侧状态已同步（续跟结束）` + `【续跟】引擎侧该会话当前空闲（事件#14，跟踪 13s，会话 …21e7e7db566）`；③持续 `running=false` 期间**未在 30s 收尾**，最终以中性「任务：已结束」收尾（不再谎报成功/失败）；④脚本 finally 保证 `SIGCONT`。
- 未跑：缺陷 A 的「定时到点端到端」（`EngineService` exported=false，唯一触发是真实闹钟）、缺陷 B 的像素复验、历史抽屉会话号 DOM 复验 —— 手工步骤见 docs/批次79 文档 §6。

### 决策（留档，含反证）
- **2.4-c c-ares dns-preload：不做**。全 payload 引用 `node:dns` 只有 dsh-web-fetch-http（`dns/promises.lookup`＝getaddrinfo，批次69 已修）与 undici `lib/interceptor/dns.js`；`dns.resolve*`（c-ares）**仅出现在 retry 包示例文件**（无生产调用）；修法需注入 `NODE_OPTIONS=--require`，preload 出错即引擎整体不可用，收益≈0。
- **事件驱动实时化（原 T4-5）：不做**。只读调查显示 `$events` 白名单定义了 `api-session/status` 等 emit，但真机实测（23:31，任务运行中）App 的 mux **整段窗口只收到 `ready` 一帧**，无任何 emit → 该通路在本环境不投递会话状态；已撤掉全部 emit 消费代码（DshEventMux 回到只有提问/审批语义），面板 AI 行继续由 session/list 轮询驱动。

## [未发布 - 批次70/78-T3] - 2026-09-18：全域实况互联落地（等待态实况窗 + 一键唤起 + 设置开关 + 定时任务互通 + privSetting 回读 + 看护忙闲两档）

### 新增 / 变更
- **等待态实况窗**（PromotedProgressNotifier）：新增 interaction(ctx, kind, elapsedSecs) / clearInteraction()；琥珀色进度段与通知 color（0xFFFF9800）、标题「等待您的回答 / 等待授权确认」、关键短文案「请作答 / 需审批」、正文带等待秒数；
- **一键唤起回答卡片**：有挂起交互时 contentIntent 改用 service PendingIntent（OverlayService + action_open_assistant），点实况窗直达助手面板；无挂起维持打开主界面；
- **驱动接线**（OverlayService）：showInteractionCard 与 1s elapsedTicker 都走等待态（复用既有 ticker，不新增定时器）；作答 / 取消提问 / 拒绝审批后 clearInteraction() 回进度态；
- **设置页显式开关**（MainActivity 保活卡片）：「实况窗」按钮翻转 dsh_prefs/promoted_live_update，关闭即 stop() 并退回自绘胶囊兜底；按钮文案随状态刷新；
- **定时任务实况互通**（ScheduleExecutor）：提交后 start(「定时任务：摘要」)，每 3s 读 session.list 的 running（必须先观测 true 再回落才算完成），asOfSeq 作步骤序号，上限 600s；三态收尾 ✓/✕/⚠ 超时未确认（超时不杀引擎）；即时通知文案改「任务已提交」；
- **privSetting 回读判定**（VscreensManager）：put 后回读校验，读流阶段异常降级为 info；结论日志 [b70] privSetting <args> ok=<bool> readback=<值>（消灭「已生效却记 failed」的假报错）；
- **看护间隔 45↔90 自适应**（HostedEngineManager）：按 3080 ESTABLISHED 连接数选档，watchdog.state 各状态追加 interval=<当前值>。

### 验证（真机）
- 等待态：NotificationRecord id=21921 flags=ONGOING_EVENT|ONLY_ALERT_ONCE|PROMOTED_ONGOING color=0xffff9800、title=等待您的回答、shortCriticalText=请作答、contentIntent=startService；面板同屏可见提问卡片与选项；
- 作答后：finish ✓ 任务已完成 → 5s 后 stop，color 回 0x00000000；普通短任务无回归（任务实况 / 完成 ✓ / 非琥珀）；
- 看护：watchdog.state 出现 interval=90（空闲档），部署脚本含 BUSY_HITS/IDLE_INTERVAL 判据。

### 门禁
- pytest **349 passed / 1 skipped**（新增 tests/test_batch70_live_update_wait.py 7 条）；javac rc=0；签名 APK + adb install -r Success。

### 文档
- docs/批次70-全域实况互联-实施报告.md（含未落地项：2.4-c c-ares、脚本化 e2e、privSetting 运行时证据）

## [未发布 - 批次78-T2] - 2026-09-18：引擎运行模式与存储可见性收网（看护 MODE_CONFLICT + 升级即生效 + App 内数据同源 + ⓘ 自查）

### 修复
- **看护端口归属校验**：watchdog 新增 INODE（从 /proc/net/tcp 取 3080 LISTEN socket inode）+ ls -l /proc/$P/fd 匹配 socket:[INODE] → OWNER=1；OK 条件改为「engine.pid 活着**且** 3080 属于它」。
- **新增 MODE_CONFLICT**：LISTEN!=0 且 OWNER==0（典型：App 内引擎占用 3080）→ 明确报冲突、**不重启**、并把重试预算 ATT 复位（旧逻辑会白耗 3 次后永久 COOLDOWN，托管引擎再也拉不回来）。
- **升级即生效**：看护脚本指纹变化时用 Shizuku 弹掉在跑的看护进程（旧 sh 已把 while 循环解析进内存，改文件不生效）并重起，免重启设备。
- **App 内模式用户数据接共享 home**：新增 HostedEngineManager.linkSharedData()（sessions/attachments/storages → /sdcard/DeepSeekHarness/home；已是正确 symlink 跳过，真实目录先补拷缺文件到共享目录、再改名 *.private-bak-<ts> 留存，**只补缺不删**），调用点为 MainActivity（payload 准备路径 + 内部引擎 env 前）与 ScheduleExecutor。
- **可自查**：面板 ⓘ 详情新增「模式：托管(shell)/App 内 · 用户数据：共享 home」（OverlayService + MainActivity.recordEngineMode）。

### 验证（真机）
- 升级后 logcat：private dir kept as sessions/attachments/storages.private-bak-… + shared data link done: linked=3 carried=23（下次启动 linked=0 carried=0，幂等）。
- 看护脚本变化 → watchdog script changed (5b34513f) → bounce=true → 新看护 pid=5531 接管。
- 已部署脚本沙箱双场景：伪造 pidfile → state=MODE_CONFLICT（不重启）；真实 pid → state=OK；真实 state 事后 state=OK pid=5711 attempts=1。
- ⓘ 实读：引擎端口 3080 · 在线 · 模式：托管(shell) · 用户数据：共享 home。

### 门禁
- pytest **342 passed / 1 skipped**（新增 tests/test_batch78_engine_mode.py 7 条；批次67 契约保持通过）；javac rc=0；签名 APK 202,196,197 B + adb install -r Success。

### 文档
- docs/批次78-T2-引擎模式与可见性收网.md

## [未发布 - 批次78] - 2026-09-18：批次77 定向验证（T1）—— 四条路径真机逐条钉死 + 新增 e2e 脚本

### 新增
- tools/e2e_batch77_state_fidelity.py：T1 定向验证脚本（io-retry / silence-renewal / window-refetch / neutral / rejudge-*）；设备侧注入走 App 划词入口，引擎暂停用 kill -STOP/CONT（宿主兜底 CONT），判定只认面板状态行 + logcat。

### 验证（真机 Honor BKQ-AN10，引擎为 Shizuku 托管模式）
- **T1-1 PASS**：任务运行中 STOP 引擎 25s → 1 次「RPC session.list I/O 失败（[net/connect-timeout]）…重试」、**0 条失败行**、任务继续跑到成功（批次77 之前此处直接判失败）。
- **T1-2 PASS**：引擎等待用户作答、静默 **666s** → running=true 持续、无 [timeout/hard-timeout]（首跑因脚本判定写错报 FAIL，已修并用 rejudge 对同一份日志重判为 PASS）。
- **T1-3 PASS（测试构建）**：PAGE_MAX_MESSAGES 临时改 5 → 「窗口失配 → 加宽重取命中」**16 次**、0 失败、任务成功。
- **T1-4 PASS（测试构建 + 面板实测）**：两侧窗口都改 5 → 40 次「失配未命中」、0 失败，面板实测「任务：已结束（引擎侧本轮已结束，未取到文本）」+ 状态点「已结束」。
- 测试替身已还原：PAGE_MAX_MESSAGES/WIDE 恢复 **50/240** 并重建装机；pytest **335 passed / 1 skipped**、javac rc=0。

### 文档
- docs/批次78-批次77定向验证报告.md（含原始 logcat 摘录、测试替身与还原说明）

## [未发布 - 批次77] - 2026-09-18：助手任务状态改为「以引擎（dsh）为准」—— 删本地判死 + 轮询重试 + 窗口重取 + running 续期

### 用户拍板
「所有直接在小鲸鱼助手上展示 dsh app 中的状态就行了，状态打通就行了」（承接批次76 §五 的 P0-1 / P0-2 / P1）。

### 修复
- OverlayAgentClient.pollForResult：**删除**「连续 3 轮 running=false 即抛 [poll/turn-ended-no-output]」的本地判死（实测会把轮间 / checkpoint 拼接 / queue 排队的中间态误判成失败，而引擎侧任务仍在跑）；改为只计数，连续 30 轮（约 30s）仍取不到本轮终态时用中性文案走 onResult 收尾（不算失败）。
- **轮询 I/O 重试**（把批次63 注释里承诺、但一直没实现的「单次轮询失败重试」落地）：session.list / session.page 连续 3 次失败才上报，退避 1s/2s/4s；只重试 stage==net（401/协议错误立即上报）；session.create/prompt/cancel 保持单次，防止重复投递。
- **窗口失配加宽重取**：session.page 默认 50 条窗口取不到本轮 rpcId 时，用 240 条窗口重取一次并替换快照；PageState 新增 promptSeq；completedWithoutText 加 promptSeq>=0 闸门（避免把别的轮次终态当本轮结果）。
- **deadline 续期**：引擎 running=true 即滚动续期 +600s（绝对上限 6h）；hard-timeout 文案改为「等待引擎响应超时（600s 内无新事件且引擎未在运行）」——等提问 / 长思考 / 单步超长工具不再被静默误杀。
- OverlayService：新增**中性终态**展示（NEUTRAL_COLOR + 「任务：已结束」状态分支 + 历史 ended 分支 + 实况窗中性文案），中性收尾不再谎报「✓ 任务已完成」，也不再显示为「失败」。

### 测试
- 契约更新：test_poll_terminates_when_turn_ended_without_output → test_poll_does_not_kill_task_on_transient_not_running；throughSeq/maxMessages 断言随 fetchPage(...) 重构更新；新增 test_batch77_assistant_follows_engine_state（重试只对 net / 宽窗口 / promptSeq 闸门 / 绝对上限）。
- 全量：**pytest 335 passed / 1 skipped**；javac_check.py rc=0 / errors=0。

### 真机验证
- 构建 b47_build.py all → 签名 APK 202,192,101 B；adb install -r Success；引擎 3080 恢复 LISTEN、3181 无障碍桥可用。
- 真实路径冒烟（App 划词入口注入 + 点「发送」）：14s 任务 running=true #1..#11 → running=false #12 records=29 → 面板「完成 / 任务：成功：已完成」；无失败行，中性分支未被误触发。
- 未覆盖：①3s 瞬态 running=false ②SIGSTOP 引擎抖动重试 ③>50 条窗口挤出 三条定向复现（见 docs/批次77 §四.4）。

### 文档
- docs/批次77-助手状态以引擎为准.md

## [未发布 - 批次76] - 2026-09-18：小鲸鱼助手 ↔ dsh 任务「打通性」核查 + 「助手报失败 / dsh 仍在跑」误判取证

### 核查结论（用户问：桌面的小鲸鱼助手和 dsh 软件内的任务打通了吗）
- **会话层已打通**：助手提交走的就是引擎 session/create + session/prompt，与 dsh 页面同一个 127.0.0.1:3080 实例（真机 ps：PID 9465 / uid u0_a234）；本次实测会话 `session-8430938c-2d0c-4b34-8559-983e093c16b3` 即在引擎会话列表里。
- **状态层没打通**：助手**不订阅会话事件流**（WS /api/remote.mux 只用于提问/审批回填），任务进度/终态靠 1s 轮询 `session/list` + `session/page` 快照 + 本地启发式判定；本地判失败**不会 cancel** 引擎里的 turn，也没有重挂路径 → 「dsh 还在跑 / 助手说失败」在代码上是允许的稳态。
- **跟踪范围/历史/存储三处缺口**：只跟踪一个 `overlay_last_session_id`（asOfSeq≥30 就轮转新会话）；历史表 `task_history_items` 无 sessionId 无法与引擎对账；引擎双模 home（托管=共享目录 / App 内=App 私有 home，**实测当前为后者**）导致会话落点随模式变化。

### 取证（真机）
- 用户真机历史（App 📜「最近 10 条」）两次失败：`01:48:34 打开微博找到用户任务中心领取红包` → **[poll/turn-ended-no-output] 本轮已结束但未产生任何消息记录**（同一条指令 22:59:37 又成功 → 间歇性，与用户「有时候」一致）；`00:24:10` → [agent/failed] DeepSeek API request failed（引擎侧真报错，非误判）。
- 三条误判路径（OverlayAgentClient.java）：①`:335-341` 连续 3 轮 running=false 即判死（含 checkpoint 拼接中间态 / queue 排队 / 50 条窗口把本轮 prompt 挤出导致 promptSeq=-1）；②`:579-593` 单次轮询 I/O 失败即判死（文件头 `:45-46` 声称「单次轮询失败重试」，实际无任何重试代码）；③`:302-316` + `:355-357` 只在「有新事件/新工具」时续期 → running=true 但静默 600s 即 `[timeout/hard-timeout]`（等提问/长思考/超长单工具都会命中）。
- 真机长任务实测（17:01:52–17:03:36，103s，走 App 划词入口 + 点发送的真实路径）：`#1–#89 running=true` → #90 running=false records=79 → 面板自动展开、无失败行 → **正常路径助手与引擎一致，问题非必现**。

### 新增
- `tools/e2e_assistant_long_task.py`：划词入口注入提示词 + 无障碍桥自动定位「发送」+ 流式抓 logcat 抽取 `diag:`/`agent task failed:` + 每 15s 采样面板状态行 + ASSISTANT_OK/FAILED/DIVERGENCE 判定，报告落 `.local/e2e_assistant/<ts>/`。
- `docs/批次76-小鲸鱼助手与dsh任务打通性核查与失败误判取证.md`（含证据、三条路径行号、修复建议）。

### 验证
- `python -m py_compile tools/e2e_assistant_long_task.py` 通过；真机跑通一次完整长任务（时间线见文档 §2.2）。
- 本轮**未改产品代码**；修复方案见文档 §五（P0-1 终态证据门槛 / P0-2 轮询重试 / P1 续期与续跟），待拍板。

## [未发布 - 批次75] - 2026-09-18：虚拟屏内 android_tap 语义定位放行 + 构建脚本误删重建

### 新增能力：虚拟屏内 android_tap 支持 text/desc/vid 定位
批次29 起，虚拟屏模式下 `android_tap` 传 text/desc/vid 会被**直接拒绝**，报「虚拟屏模式点击需要指定坐标」。
当时的取舍是合理的：虚拟屏注入通道是 8998 服务端的 `input -d <displayId> tap x y`（**只认坐标**），
而 App 侧 `3181 /tap` 的 `handleTap()` 用 `performAction/dispatchGesture`，**只能打默认屏**——
两者拼起来只有"坐标"能端到端贯通；一旦"文本未命中就退主屏坐标兜底"，就会变成
「以为在点虚拟屏、实际动了主屏」，直接破坏"主屏零抢屏"承诺。所以当时选择显式拒绝而非模糊兜底。

批次74 已把「读虚拟屏语义树 → 解析成虚拟屏坐标 → 投 /vscreen/tap」这条链路接通，
限制的前提不复存在，本批次正式放行：

- `tapCore`：虚拟屏模式下只要给了定位词就**强制走快照解析**（连同批次74 的目标屏 displayId）；
  命中后直接把**节点中心像素**用于虚拟屏注入（不再经 fx/fy 二次换算，避免取整漂移 ±1px）。
- **硬约束**：定位不到时**诚实失败 `TARGET_NOT_FOUND`**，绝不退化为主屏坐标兜底（单工具与事务一致）。
- `android_tap` 工具描述同步说明该行为与新失败语义；坐标缺失时的报错文案改为
  「请传 text/desc/vid，或 x/y、fx/fy；若只有截图可用 android_screen 读出节点坐标后再点」。
- `attachFractionalCoords` 的分数基准改为**目标屏真实尺寸**（`/display-info` 优先，取不到才退回旧的
  "最大 x+w/y+h"）——旧基准在树里没有铺满全屏的节点时会整体放大 fx/fy，导致语义定位换算偏移。
  `findNodeInSnapshot` 优先沿用快照阶段的 fx/fy，避免同一坐标两套换算。

### 构建脚本误删与重建（重要）
- **事故**：一次过宽的本地清理 glob（`.local\b*.py`）把 `.local/b47_build.py` 一并删除；
  该文件被 gitignore，**无法从 git 恢复**（回收站亦无）。它是每次出包的必经环节
  （`pytest` 的批次60 契约也会读它），删除后构建与测试同时中断。
- **重建**：依据 `.local/_b47_run.txt`、`.local/b46_evidence/build_final.log` 里留存的完整命令行、
  `android-app/build.sh` 的七步流程、以及 `android-app/out/` 残留产物（`classes.rsp`、
  `shizuku-cls`、`resources.apk`、`dex`）逐段还原六个阶段（aapt R.java → javac → d8 → aapt 资源 →
  repack → zipalign → 签名）。恢复过程中修正了两处原脚本缺陷：
  1. **递归 glob 会把 `src/.../vscreen/*.java` 混进 APK dex**：那是"虚拟屏特权服务端"，
     按设计走独立 javac/d8 打进 `assets/vscreen/vscreen-server.jar`（LGPL 三文件不进 dex，
     见 build.sh 批次11 注释）。实测混入会多 8 个类、dex 虚胖约 77 KB。现只 glob harness 包**顶层**源文件。
  2. **`out/{gen,classes,dex}` 未清理**：javac/d8 增量产物会残留"已删除源文件的旧 class"混进 dex
     （repo 自己的 build.sh 已就此告警）。实测原脚本的 `out/classes` 累积了 424 个 class，
     而当前源码只产出 309 个——多出的约 115 个全是陈旧残留，dex 虚胖约 50 KB。
     现于 `stage_r_gen` 先清空三个目录再构建。
  3. d8 的类清单改走 `@argfile`：432+ 个 .class 直接拼命令行会超 Windows 长度上限（`WinError 206`），
     且 d8 的 argfile **不接受带引号的路径**（`InvalidPathException: Illegal char <">`），故写裸路径。
- **防复发**：新增**版本化权威副本 `tools/b47_build.py`**（内容与 `.local/b47_build.py` 一致，
  前者入库、后者保留为文档中的既有命令入口）。若 `.local/` 再被误清，一条命令即可恢复：
  `copy tools\b47_build.py .local\b47_build.py`。

### 验证
- **离线**：`pytest` **335 passed**；`javac_check` rc=0 / errors=0；5 个 `.mjs` 测试全部 rc=0
  （`test_vscreen_router` 11 组断言全绿）。
- **构建**：`python .local/b47_build.py all` → rc=0 / ALL DONE，签名 APK `202,192,101 B`；
  包内 `assets/payload.zip` 的 `dsh-attachment-local` 仍为补丁形态（`EINVAL=2`、花括号 238/238），
  dex 含批次74 的 `display-info` 路由。
- **真机（Honor BKQ-AN10 / MagicOS 11 / Android 17）**：
  - 安装后 App 起、无障碍服务在、引擎单实例（`3080` LISTEN）、`/display-info` → `1256x2808@560`、
    3081 `/vscreen/status` 正常；
  - **坐标路径**：`android_tap fx=0.107 fy=0.141` → `method=vscreen-tap` ✅；
  - **语义路径（本批次核心）**：`android_act [{action:"tap", text:"护眼"}]` → `method=vscreen-tap-snapshot`，
    界面进入护眼相关页 ✅；`android_tap text="显示和亮度"` 同类路径已验证可命中；
  - **反向契约**：不存在的文案 → `TARGET_NOT_FOUND` 且**未触碰主屏 `/tap`** ✅。
- 测试侧同步修正两处因新行为而过严的断言（`test_m1_current_scope.mjs`：mock 补 `/display-info`；
  「a11y 恰好 1 次请求」改为「**`/dump` 恰好 1 次**」——辅助的尺寸查询不参与该不变量）。

## [未发布 - 批次74] - 2026-09-18：修复 android_act 事务在虚拟屏上坐标错屏（fx/fy 被按主屏尺寸换算，纵向点偏 1.57 倍）

### 背景与根因（手机端第三轮自检发现）
虚拟屏模式下，**同一组 fx/fy 在两条路径上落到不同位置**：

| 路径 | method | 实测结果（设置主页，fx=0.496 / fy=0.17） |
|---|---|---|
| 单工具 `android_tap` | `vscreen-tap` | ✅ 命中搜索框 |
| `android_act` 事务内 tap | `node-coord` | ❌ 落到账号卡片，跳转荣耀账号中心 |

**机制**：单工具 `android_tap` 自带一份按"硬编码 1080x1920"的虚拟屏换算后交给 3081 `/vscreen/tap`；而事务内 tap 走模块级 `tapCore` → **App 侧 3181 `/tap`**，其 `handleTap()` 用 `screenSize()`（**主屏** 1256x2808）换算 fx/fy，再按主屏坐标注入。
虚拟屏实际为 **1008x1792** → 纵向 0.17×2808=477（账号卡片）而非 0.17×1792=305（搜索框），**偏移约 1.57 倍**。

同一缺陷还波及：事务内 `type`（无 displayId，按主屏 IME 预检 → 必报 `IME_NOT_READY`）、事务内 `scroll/back/home` 的 version 基线与收尾快照（读的是主屏，与虚拟屏无关）。

### 修复
- **App 侧新增 `GET /display-info[?displayId=N]`**（`AccessibilityService.java`）：用 `DisplayManager.getDisplay(N).getRealMetrics()` 返回目标屏真实像素尺寸与 density；displayId 无效/虚拟屏已销毁时退化为主屏，保证调用方永远拿得到可用值。
- **插件侧 `tapCore` 改造为「目标屏感知」**（`plugins/dsh-tool-accessibility/lib/index.js`）：
  1. 解析目标屏（虚拟屏已建 → vscreen displayId；仅开启开关未建屏 → 主屏）；
  2. 经 `/display-info` 取真实尺寸（3s 短路缓存），fx/fy 按**目标屏**换算，不再依赖任何硬编码；
  3. 虚拟屏模式下最终坐标直接交给 **3081 `/vscreen/tap`**，**不再落到主屏 `/tap`**（这是本缺陷的根因路径）；
  4. 快照定位（text/desc/vid）改用目标屏 displayId，避免"读主屏、点虚拟屏"的错配。
- **`android_tap` 单工具去重**：删除其自带的一份 1080x1920 换算分支，统一交给 `tapCore` —— 两条路径共用同一坐标语义，从结构上杜绝"同一 fx/fy 两套结果"。
- **事务内 `type` 对齐单工具语义**：虚拟屏模式下显式带 vscreen displayId 且 `skipImePrecheck:true`（虚拟屏内没有可弹出的软键盘，按主屏 IME 状态预检必然误报 `IME_NOT_READY`）。
- **事务 displayId 一致性**：`scroll/back/home` 的 version 基线、收尾快照统一用事务目标 displayId。
- **`android_swipe` 同步去硬编码**：fx/fy 换算改用目标屏真实尺寸。

### 验证
- **离线**：`pytest` **335 passed**；`javac_check` rc=0/errors=0；`node --check` 插件通过。
  `tests/test_vscreen_router.mjs` 由 8 组扩到 **10 组**（新增 Test 9/10）并全绿：
  - Test 9：事务 tap 必须查 `/display-info`（带 vscreen displayId）、必须走 `/vscreen/tap`、x/y 必须按 1008x1792 换算、**不得**出现主屏 `/tap`；
  - Test 10：事务 type 必须带 vscreen displayId 且不回落到主屏 IME 预检。
  另修掉两处测试自身的时序依赖（`android_screen` 10s TTL 缓存导致的偶发 skip；mock 新增 `/display-info` 后旧断言"零 a11y 请求"过强，改为"不得有主屏 /tap"），并同步更新旧的 1080x1920 断言。
- **真机（Honor BKQ-AN10 / MagicOS 11 / Android 17）**：
  - `/display-info` 主屏 → `1256x2808@560`；虚拟屏 → `1008x1792@320`（与真机一致）；
  - 事务内 tap 复现实验：`{"ok":true,"results":[{"action":"tap","ok":true,"method":"vscreen-tap"}],"version":2}`，**留在设置内**（此前跳荣耀账号中心）；
  - **端到端**：`android_act [{tap fx=0.496,fy=0.17}, {type "护眼"}]` → `{"ok":true,"results":[{"method":"vscreen-tap"},{"method":"set","verified":true}]}`，`android_screen_refresh` 回读搜索框内容 = **"护眼"**，列表出现"护眼模式/荣耀绿洲护眼/护眼统计"。

## [未发布 - 批次73] - 2026-09-18：修复"看图"链路整体失效（fsync EINVAL / 只读 erofs 根）并固化为构建预检

### 背景与真实根因
设备自检报告（手机端第二轮自检 + 会话回溯）显示：`read_image`、`android_see`、`android_vscreen_see` **三个入口全部失败**，统一报：
`EINVAL: invalid argument, fsync`
完整调用栈指向 `dsh-attachment-local/lib/index.js` 的 `syncDirectory` → `ensureDurableDirectory` → `ensureDurableHome` → `stageImmutableObject` → `commitPreparedImageFile`。

**机制**：附件库为保证持久性，会从 `DSH_HOME` 逐级向上 fsync 每一层父目录直到文件系统根 `/`。本机 `/` 是 **erofs 只读挂载**（`/dev/block/dm-54 / erofs ro,seclabel,...`），只读文件系统对 `fsync(2)` 返回 `EINVAL`。上游 catch 只容忍 `EACCES`/`EPERM`（针对 `/data/user/0` 的权限位），未覆盖"只读 fs 拒绝 fsync"，于是整条图片附件写入链路被打挂。

**为什么上一轮的修复没生效（本次真正的教训）**：
批次71 的 fsync 补丁只写到**磁盘上的运行时副本**与**手工打过补丁的 APK**，但 `android-app/DeepSeekHarness.apk`（BASE_APK）是 **git 忽略的构建输入、会被 Android 构建流水线重新生成**。上一次 `b47_build.py all` 重建 BASE_APK 后，`assets/payload.zip` 内的 `dsh-attachment-local` 悄悄回退到上游未打补丁的形态，设备重新 staging 后自然回归故障。**补丁必须固化进构建流程，而不是固化进产物。**

### 修复
- **新增 `tools/patch_base_apk_attachment.py`（幂等预检）**：把 `assets/payload.zip` 内 `dsh-attachment-local/lib/index.js` 的 `syncDirectory` 同步块改写为**花括号平衡**的形态，在 `EACCES`/`EPERM` 之外追加容忍 `EINVAL`、`EROFS`、`ENOTSUP`、`EOPNOTSUPP`；已打补丁时直接返回、不触碰文件。
- **接入构建流水线**：`.local/b47_build.py` 的 `stage_repack` 首行调用上述预检，**每次打包前必跑**，从机制上杜绝"重建 BASE_APK 导致补丁丢失"再次发生。
- **设备侧即时修复**：两处运行时副本（`/data/local/tmp/dsh/dshroot/...`、`/data/local/tmp/dsh/home/profiles/...`）与共享 home（`/sdcard/DeepSeekHarness/home/profiles/...`）统一改写为补丁形态，重启引擎使其加载。
- **新增防退化契约 `tests/test_batch73_attachment_fsync_einval.py`（6 条）**：① 形状守卫（4 个只读 fs 错误码 + 原有权限错误码 + 花括号平衡 + 取反重抛 + `node --check` 可解析）；② **行为守卫**：抽取真实 `syncDirectory` 函数体，用桩 `open()` 让 `handle.sync()` 分别抛 `EINVAL`/`EROFS`/`ENOTSUP`/`EOPNOTSUPP`/`EACCES`/`EPERM`，断言函数一律 **resolve 不抛**（同时验证 `open` 层的 `EACCES`/`EPERM` 仍被跳过）。

### 验证
- **离线**：`pytest` **335 passed**（329 + 新增 6 条批次73 契约）；`javac_check` rc=0/errors=0。
- **构建产物**：`b47_build.py pack,sign` 日志出现 `[attachment-preflight] already patched`，签名 APK `202,208,485 B`；包内 `assets/payload.zip` 校验 `EINVAL=2`、花括号 `238/238` 平衡。
- **真机（Honor BKQ-AN10 / MagicOS 11 / Android 17）**：
  - 引擎重启加载补丁版：`watchdog.state ts=... state=RESTART attempt=1`，新引擎 pid `16441`，`3080` 恢复 LISTEN。
  - 附件往返：`attach-roundtrip.mjs` → `SAVE OK 1008x1792` / `READ OK digest match: true`。
  - **用户报障路径实测**：对**上一轮报 EINVAL 的同一张真实虚拟屏截图**执行 `saveImageFile` + `readImageFile` → `264864B` 保存成功、回读 digest 一致，**不再出现 `EINVAL: invalid argument, fsync`**。
  - `adb install --no-streaming -r` 覆盖安装后复检：3 处运行时副本仍为补丁形态、语法 `node --check` OK、引擎单实例存活。

### 影响面与边界
- `android_screenshot` 只落盘、不走附件库，此前一直正常（能拿到 PNG 路径）；本批次修复的是"把图片喂给模型看"的链路。
- 补丁为**放宽**语义（不可 fsync 的祖先前缀持久性由 OS 负责，数据本身已 sync），与批次71 引入该容错的理由一致。
## [未发布 - 批次72] - 2026-09-18：修复 scope=current 主屏读屏被虚拟屏污染（返回设置页 / 节点数 0）+ android_device_info 掉字段（SHIZUKU_DEX 未配置）+ 虚拟屏内 android_type 无输入法兜底

### 修复
- **A. `scope=current` 主屏读屏被虚拟屏窗口事件污染**（真机稳定复现：虚拟屏里跑设置时读主屏返回设置的节点树；虚拟屏关闭后节点数 0）。
  - 根因1：`AccessibilityService.rememberCurrentExternalTarget()` 不区分 display —— 虚拟屏应用的窗口事件会把主屏的 `lastExternalPackage` / `lastReadableContextTarget` 改写成虚拟屏应用。
  - 根因2：`rootForPath()` 的 `exclude_self=1` 分支无条件调用主屏 `readContextTarget()`，把 `displayId` 参数丢掉了。
  - 根因3：缓存快照失效（应用切走后窗口离开无障碍窗口列表）仍被当结果返回，表现为 package 正确但 `count=0` 的「伪空」。
  - 修法：① `rememberCurrentExternalTarget()` 增加 `window.getDisplayId() != CONTEXT_DISPLAY_ID` 直接返回；② 新增 `readContextTarget(int displayId)`，非主屏调用既不写也不读主屏缓存，`rootForPath()` 透传 displayId；③ 缓存命中前校验 `countNodes(cached.root) > 0`，失效即回退真实窗口枚举 / `getRootInActiveWindow()`（同样校验 display）。
- **B. `android_device_info` 报「SHIZUKU_DEX 未配置」掉字段**：托管常驻下引擎自身已是 `shell` uid=2000，却仍走 app_process/rish 代理。
  - 修法：两个插件（`plugins/dsh-tool-android`、`plugins/dsh-tool-accessibility`）新增 `isHostedShellPrivileged()`（`DSH_HOSTED_DIR` 或 `getuid()===2000`），`privilegedAvailable()` 纳入该判定，`privCmd()` 顺序改为 **root(su) → 托管 shell `/system/bin/sh -c`（零 IPC、原生多行脚本）→ Shizuku(rish)**，删除「无 dex 即硬失败」分支。
- **C. 虚拟屏内 `android_type` 缺少输入法兜底**：虚拟屏软键盘不弹出，走到 IME 预检即以 `IME_NOT_READY` 终止。
  - 修法：新增 `privilegedType(args, displayId)`（ASCII → `input [-d N] text`；空串 → 清空键；非 ASCII → 剪贴板 + `input [-d N] keyevent 279`），**注入后一律 A11y verifyOnly 回读，回读一致才 `verified:true`**；`android_type` 虚拟屏分支与主屏 `IME_NOT_READY/POSTCONDITION_FAILED` 分支均接入。

### 文件
- `android-app/src/com/deepseek/harness/AccessibilityService.java`
- `plugins/dsh-tool-android/lib/index.js`、`plugins/dsh-tool-accessibility/lib/index.js`
- `tests/test_batch72_scope_and_priv.py`（新增 13 条契约）、`tests/test_m1_context_source.py`（两条断言随契约演进更新）
- payload 分发：`.local/sync_plugins.py --apply` → `android-app/assets/payload.zip` → base APK `assets/payload.zip`

### 验证（真机 Honor BKQ-AN10 / MagicOS 11 / Android 17）
- **主屏 current 隔离**：虚拟屏(display 36) 内跑 `com.android.settings`（isActive）时，`android_screen scope=current` 返回 `com.hihonor.android.launcher` + **count=62**，绝不返回设置页；`POST /vscreen/close` 后 `android_screen_refresh scope=current` 仍返回 launcher + **count=62**（非 0）。
- **设备信息**：`android_device_info` → `ok:true, elapsedMs=123`，电池 100%/充电/27℃、音量 music5/ring0/alarm16、亮度 12（timeout 1,800,000 ms）、存储 490.0 GiB（free 380.0 GiB）、网络 wifi 2401Mbps/RSSI -24dBm、机型 BKQ-AN10 / Android 17 / API 37、开机 565,916,680 ms，0 报错。
- **虚拟屏输入**：虚拟屏（display 35）点 `search_view` → `android_type "8241"` → `ok:true, verified:true, method=vscreen-set, actual=8241`；特权通道正向证据：uid=2000 执行 `input -d 35 text 'Z7'`（`privilegedType` 同款命令）后 A11y 回读 `expected=8241Z7 / actual=8241Z7 / verified=true`，且 `imeTopY=-1`（虚拟屏无输入法，正是 IME_NOT_READY 触发条件）。
- **截图链路**：主屏 `android_see` → `ok:true`（`/storage/emulated/0/DeepSeekHarness/screenshots/screen-1789711138529.png`，1256×2808）；虚拟屏 `android_vscreen_see` → `ok:true`（PNG 137,909 B，实测 1008×1792）。
- **联网回归**：托管 glibc node 的 `dns.lookup` 仍解析 `api.deepseek.com` → 111.51.158.194、`api.commandcode.ai` → 198.18.0.145。
- **离线门禁**：`pytest` **329 passed**、`javac_check` rc=0 / 0 errors、`node --check` 两插件 rc=0、签名 APK `202,204,389 B` 覆盖安装 Success、`.local/b8_verify_payload.py` 六条目全 MATCH（设备侧 `grep -c isHostedShellPrivileged` = 3）。

## [未发布 - 批次71] - 2026-09-18：修复截图功能全链路失效缺陷（EINVAL fsync + 私有目录跨 UID 读取 EACCES + 托管常驻 3081 桥未起）

### 修复
- **dsh-attachment-local 向上持久化 rootfs / 根目录 EINVAL**：批次67 引擎升级为独立常驻（shell uid=2000，`DSH_HOME=/data/local/tmp/dsh/home`），`dsh-attachment-local` 的 `ensureDurableDirectory` 从 home 向上遍历父目录做 `syncDirectory` 直到根目录 `/`。在 Android 的 tmpfs/ramdisk rootfs 上，`open("/", O_RDONLY)` 成功，但 `handle.sync()`（目录 fsync）报 **EINVAL: invalid argument, fsync**（部分 FUSE 报 ENOTSUP），导致所有图片保存为附件（`android_see`、`android_vscreen_see`、`read_image`、上传图片）彻底崩溃。
  - **修法**：
    1. `compatibility/0.1.5-rc.1/apply.py` 中升级 `apply_attachment_durability`，在 `handle.sync()` 上捕获 `EINVAL`、`ENOTSUP`、`EOPNOTSUPP`、`EACCES`、`EPERM`；
    2. 同步更新 `tests/test_updater.py` 契约断言；
    3. 同步更新 `dsh-patches/overlay/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js`；
    4. 同步更新 base APK `android-app/DeepSeekHarness.apk` 内的 `assets/payload.zip`；
    5. 移除 HostedEngineManager 中导致 JS 语法错误的注入，保持 fix-hosted-resolver.cjs 单一职责（仅负责 libc 解析器改写）；源码与 payload.zip 均内建完整 durability 补丁。
- **主屏截图路径位于 App 私有目录，托管引擎跨 UID 读取报 EACCES**：`AccessibilityService.java` 的 `handleScreenshot()` 将主屏截图写入 `new File(getFilesDir(), "screenshots")`（即 `/data/user/0/com.deepseek.harness/files/screenshots/`）。托管引擎以 shell (uid 2000) 运行，读该目录报 **EACCES: permission denied**，导致 `android_see` 主屏截图时 `readFile(v.path)` 必挂。
  - **修法**：
    1. `AccessibilityService.java` 优先保存到共享存储 `/storage/emulated/0/DeepSeekHarness/screenshots/`，不可写时回退外部私有/内部私有目录，并对生成的 PNG 显式设置 `setReadable(true, false)`；
    2. `plugins/dsh-tool-accessibility/lib/index.js` 的 `android_see` 在 `readFile` 遭遇 `EACCES` 时增加特权通道/base64 兜底读取，双重保险。
- **托管常驻导致 App 本地桥（3081 /vscreen/* 等）未启动**：在 `MainActivity.java` 中，`startNotifyServer()`（启动 3081 端口，承载虚拟屏 `/vscreen/*`、剪贴板、通知、任务存储）原本放在 `startEngine()` 线程中。批次67 引擎常驻后，MainActivity 检测到 `engineOnline() == true` 提前 `return`，导致 3081 端口从未被启动监听，插件调虚拟屏自愈必报「App 本地桥不可达（3081 /vscreen/*）」。
  - **修法**：在 `MainActivity.java` 中引入 `AtomicBoolean notifyServerStarted` 单例防重，并在 `if (engineOnline()) return;` 之前第一行立即调用 `startNotifyServer()`，确保 3081 桥随 App 启动必定常驻监听。

### 验证（真机 Honor BKQ-AN10 / MagicOS 11 / Android 17）
- **主屏截图全链路**：`android_see` 成功截取真实屏幕，图片落盘 `/storage/emulated/0/DeepSeekHarness/screenshots/screen-*.png`（336,795 B），托管引擎（uid 2000）直接读取成功，附件服务成功入库并生成 `sha256:37025777dad3571104abff614ba7cebbdd0965f9bfc78343e1380b43c382d777`（1256x2808 px），返回 `ok: true`，0 错误。
- **虚拟屏截图全链路**：3081 本地桥正常监听，成功创建虚拟屏（displayId=31）并启动应用，`android_see` 透明捕获虚拟屏画面，附件成功生成（1008x1792 px，141,225 B），返回 `ok: true`，0 错误。
- **附件往返验证**：`attach-roundtrip.mjs` 在真实截图上测试 `saveImageFile` + `readImageFile`，digest match true，无任何 `EINVAL fsync` 异常。
- **离线质量门禁**：`pytest` **315 passed**、`javac_check` rc=0 / 0 errors、APK 签名正常构建（202,204,389 B）。

## [未发布 - 批次69] - 2026-09-18：修复托管引擎 DNS 全灭（模型列表空 / 所有 API 请求失败的真正根因）

### 修复
- **托管引擎 DNS（核心）**：payload 的 glibc 被二进制补丁写死读 App 私有
  `/data/user/0/com.deepseek.harness/files/etc/r.conf`（实测 libc.so.6 内该字符串唯一）。App 内模式同 uid 没问题，
  但**托管引擎跑在 shell uid=2000 下读不到该文件**（`cat` → Permission denied）→ glibc 无 nameserver →
  `getaddrinfo` 返回 **EAI_AGAIN**，于是 Command Code 的模型目录（api.commandcode.ai / unpkg.com）拉不到
  → **模型列表为空**；DeepSeek API 请求同理失败（与 API Key 无关：实测 key 有效、`/v1/models` 从手机直连 200）。
  修法：新增 `fix-hosted-resolver.cjs`（node，staging 后与每次启动幂等执行）把托管 libc 内该路径改写为
  `/data/local/tmp/dsh/etc/r.conf`（NUL 补齐、原子 rename）；App 侧新增
  `resolvConfText()` / `writeSharedResolvConf()`（DNS 来源与 App 内模式同源：/system/etc/resolv.conf →
  net.dns1/2 → dumpsys connectivity → 223.5.5.5/119.29.29.29 兜底），start 脚本每次启动刷新
  `$DIR/etc/r.conf`（chmod 644，缺失时用 dumpsys 兜底）；MainActivity.refreshResolvConf 改为复用同一套探测。
- **收养路径重 staging**：覆盖安装后收养路径不经过 startEngine，会一直跑旧 payload/脚本（真机实测：升级后 libc
  仍是旧解析器路径）→ 新增 `stagedFingerprintMatches()`，收养时发现指纹过期就停一次并重 staging + 重启。
- **托管拉起全局单飞**：MainActivity / BootReceiver / 探活会并发调用 `startEngine`，并发时一个线程在 staging、
  另一个读到旧指纹 → `STAGE_FAILED` → 回退 App 内引擎 → 两个 node 抢 3080（真机实测：App 卡在启动页）。
  现在 `startEngine` 加静态锁，后到者走「复用」分支。
- **start 脚本单实例锁**：`$DIR/start.lock`（mkdir 原子锁 + pid 存活判定）并在拉起后**等 3080 LISTEN 再放锁**，
  杜绝「已拉起但未 LISTEN」窗口里再起一个 node（真机实测：每轮重启都会出现双引擎，败者 EADDRINUSE 崩）。
  `stopEngine` 一并清理该锁。

### 验证（真机 Honor BKQ-AN10 / MagicOS 11 / Android 17）
- **修复前**：托管引擎环境里 `dns.lookup api.deepseek.com` → `EAI_AGAIN`；`fetch` → `fetch failed`。
- **修复后**：`dns.lookup` → 真实 IP（111.12.215.79）；`fetch https://api.deepseek.com/v1/models` → 401（连通、仅缺鉴权）；
  Command Code 目录 `api.commandcode.ai/provider/v1/models` → **200 / 13551 B**、unpkg → 200、npm → 200。
- libc 旧路径计数 **0** / 新路径计数 **1**；`/data/local/tmp/dsh/etc/r.conf` 就位（644）。
- 引擎进程数 **1**（托管，PPID=1 / uid 2000 / 3080 LISTEN / 看护 OK），App 不再回退 App 内引擎、启动页正常进入主界面。
- 离线：`pytest` **315 passed**（新增 `tests/test_batch69_hosted_dns.py`）、`javac_check` rc=0、签名 APK 202,638,565 B。

### 设备侧配置修正（非代码）
- 用户的 `agent-default-model` 是 `deepseek-official / deepseek-flash + reasoningEffort: high`，而 DeepSeek 官方提供方的
  模型目录不声明任何推理强度 → LLM 层直接抛 `UNSUPPORTED_REASONING_EFFORT`。已删掉该 `reasoningEffort` 行
  （原文件备份为 `settings.yaml.bak-*`），并把引擎重启让配置生效。

## [未发布 - 批次68] - 2026-09-18：修复「托管 home 覆盖用户配置」+ 插件自有状态搬运（模型突然没账号 / 没有模型显示）

### 修复
- **包内种子不再覆盖用户 home**（根因①，真机实测共享 home 的 `settings.yaml` 被 826 B → 88 B 冲成包内默认）：`stageScriptText()` 的 `cp -rf "$DIR/dshhome/." "$DIR/home/"` 改为按 `HOME_USER_FILES` 清单跳过已存在的用户/插件自有文件 + 逐项复制；`cordis.patch.yml` / `profiles/` 等 App 管理项仍随包刷新。
- **home 根目录文件改为 `carry()` 双向搬运**（根因②：`agy-accounts.json` 这类插件自有状态永远进不了托管 home，而两个 home 目录不共享）：同则不动；一边缺失或对边更新（`-nt` + `cmp -s`）才复制；覆盖前先把被覆盖方存成 `.bak-<ts>`；`.bak-*` / `.migrated-*` 不参与；隐藏文件（`.credentials.yaml` 等）同样覆盖。① 共享→内部 的搬运在「引擎已在运行」早退**之前**执行，② 内部→共享 的回镜像不再无条件覆盖共享侧。
- **新增 `HOME_USER_FILES` 清单**（settings.yaml / .credentials.yaml / .anonymous-user-id / agy-master-key.json / agy-accounts.json / agy-fingerprint-data.json），并把 `agy-accounts.json` 一并 `chmod 600`（dsh-agy 同样走 `assertOwnerOnly`）。
- **新增一次性「修复迁移」`repairPrivateHomeOnce()`**（标记 `.repaired-private-home-v2`）：把批次67 之前私有 home（`files/payload/dshhome`）里的用户配置与插件状态捞回共享 home —— 缺失即补；内容不同时仅当「共享侧与包内种子逐字节一致」或「私有侧更大」才以私有侧覆盖（先存 `.bak-<ts>`）；复制后抬 mtime，让 `carry()` 带进托管 home。`startEngine()` 与 `adoptOnlineEngine()` 两条路径都接入（真机实测：App 冷启动走的是收养路径，只挂 startEngine 不够）。

### 验证
- 离线：`pytest` **303 passed**（新增 `tests/test_batch68_home_carryover.py` 13 条）；`python .local/javac_check.py` **rc=0 / 0 errors**；`python .local/b47_build.py all` 出签名 APK `202,638,565 B`。
- 真机（Honor BKQ-AN10 / MagicOS 11 / Android 17）：
  1. **修复迁移生效**：共享/内部 home 的 `settings.yaml` 由 187 B 恢复为 **826 B**（旧 187 B 存为 `.bak-*`），App 主题随用户配置 `ui-theme: preference: dark` 变暗，`agent-default-model: commandcode/deepseek/deepseek-v4.1-flash` 与 `jet-hub` codearts 账号配置回到引擎；引擎按修复后的 home 重启（pid 9164 / PPID=1 / 看护 `state=OK`）。
  2. **幂等**：重跑 `/data/local/tmp/dsh/start-engine.sh` → `already running pid=9164`，不产生新备份、不回退文件。
  3. **部署中的 `stage-payload.sh`**（scratch DIR 复跑）：用户文件保持 `SENTINEL-USER-CONFIG` 不被覆盖；种子新增文件（含隐藏文件）正常落地；用户文件缺失时正常补种。
  4. **部署中的 `start-engine.sh` 抽出的 `carry()`** 语义测试：单向补缺 / 相同不动 / 源更新则覆盖并备份 / 目标更新不回退 / `*.bak-*` 跳过 —— 全绿。

### 遗留
- `agy-accounts.json` 在私有 home 里同样不存在（该账号池在本机从未登录成功）→ **agy（Google Antigravity）模型仍需重新登录**（`/agy` 页或 `dsh-agy login`）；本批次保证登录后不再因切模式 / 覆盖安装丢失。

## [未发布 - 批次67] - 2026-09-18：引擎级常驻（Shizuku 托管 + shell 看护）与 MagicOS 11 非破坏能力收编

### 新增
- **托管引擎（全新）**：`android-app/src/com/deepseek/harness/HostedEngineManager.java` —— 经已授权的 Shizuku（shell uid=2000）用 `setsid nohup` 把引擎脱离 App 进程树拉起（真机实测 `PPID=1`、3080 由 uid 2000 监听），并配 shell 看护脚本 45s 一轮探活、挂掉自动复活；App 被杀 / 覆盖安装不再中断引擎。
- **双模选择与回退**：`MainActivity.startHostedEngineIfUsable()` 优先托管，失败打 `[b67] fallback to in-app engine (reason=…)` 并原样走老 `spawnNode` 路径；引擎已在线时走「收养」路径（`adoptOnlineEngine`：只补看护与复用标记，绝不重跑 spawn）。
- **控制入口（intent extra，设置页与 e2e 共用）**：`action_hosted_stop` / `action_hosted_cleanup` / `action_hosted_switch`。
- **开机/更新把引擎也带回来**：`BootReceiver` 在托管可用时直接请求 shell 托管拉起，否则静默唤起 MainActivity 走 App 内模式。
- **15 分钟引擎探活**：`AlarmReceiver.scheduleEngineProbe()` / `handleEngineProbe()`（`setExactAndAllowWhileIdle`，无精确闹钟权限自动降级），两种模式都能被兜底发现。
- **自检面板 7 → 12 条**：`KeepAlivePolicy` 新增引擎级 5 条（引擎在线 / 托管常驻 / shell 看护 / 精确闹钟 / 实况窗可晋升）+ 三个跳转键（Shizuku 授权 / 实况窗设置 / 通知读取）；悬浮窗与保活卡片同步呈现，卡片新增「引擎托管 / Shizuku 授权 / 实况窗设置」三个一键入口。
- 真机复测脚手架 `tools/e2e_batch67_residency.py`（六阶段：hosted-boot / force-stop / reinstall / watchdog / fallback / cleanup；token 全链路脱敏）。
- 能力清单文档 `docs/批次67-MagicOS11与Android17非破坏能力清单.md`（四档分类 + 探测命令 + 真机原始输出）。
- 契约测试 `tests/test_batch67_hosted_engine.py`（28 条：路径契约 / staging / 生命周期 / env 等价 / 双模 / 自检 / 数据迁移）。

### 变更
- **DSH_HOME 语义调整**：托管模式下引擎使用内部 `DSH_HOME=/data/local/tmp/dsh/home`（`dsh-app-boot` 要求 `profiles/node_modules/@deepseek-ai/*` 是 symlink，FUSE 的 /sdcard 不支持），用户数据（`sessions` / `attachments` / `storages`）以 symlink 落到共享目录 `/sdcard/DeepSeekHarness/home`，`settings.yaml` / `.credentials.yaml` / `agy-master-key.json` 双向镜像（引擎侧强制 `chmod 600`）。
- **数据迁移**：首次启用托管时把 App 私有 `files/payload/dshhome` 只补缺复制到共享 home（`.migrated-from-private` 标记），**原目录保留不删**，可回滚。
- **提权即留确认**：托管模式强制 `confirm_gate=true`（原值存 `confirm_gate_hosted_backup`），退出托管自动还原用户原值。
- `.local/b47_build.py` 源文件清单加入 `HostedEngineManager`。

### 修复（实施过程中真机暴露）
- **DSH_HOME 不能落 /sdcard**：symlink 不被 FUSE 支持 → 改为「内部权威 home + 用户数据 symlink + 配置镜像」。
- **凭证权限**：`dsh-credentials-local` 的 `assertOwnerOnly` 拒绝 660 → 启动脚本对凭证类文件强制 `chmod 600`。
- **看护单实例守卫误判**：`pgrep -f watchdog.sh | wc -l` 会把启动用的 `sh -c` 包装串算进来（恒为 2）→ 改 `mkdir` 原子锁（`watchdog.lock/pid`）。
- **收养路径漏刷脚本**：引擎已在线早退时不重写脚本 → `/data/local/tmp` 沿用旧版本脚本；`syncScriptsToHostedDir()` 现在每次先按当前 APK 重写。
- **`stopEngine` 自杀**：`kill -9 $(pgrep -f …)` 会匹配执行它的 shell 自身 → 改为 pidfile 精确 kill + 遍历时跳过 `$$` / `$PPID`，并清理 `watchdog.lock`。

- **workspace 键名写错**：`HostedEngineManager.workspacePath()` 读的是 `workspace`，而 MainActivity 的真实键是 `workspace_path` → 托管引擎会丢掉用户选的工作区；已修正并加契约断言（键名必须对齐 `MainActivity.KEY_WORKSPACE`）。

### 验证
- 离线：`python -m pytest tests/ -q` → **290 passed**；`python .local/javac_check.py` → **rc=0 / 0 errors**；`python .local/b47_build.py all` → 签名 APK `202,634,469 B`。
- 真机（Honor BKQ-AN10 / MagicOS 11 / Android 17）：① 托管引擎 `PPID=1` 且 uid 2000 监听 3080；② `am force-stop com.deepseek.harness` 后引擎同 pid 存活且 LISTEN；③ `adb install -r` 覆盖安装后引擎 pid 不变、ALIVE；④ `kill -9` 引擎后 45s 内看护自动复活（`state=RESTART`、新 pid）；⑤ ②④ 期间 App 进程数为 0（无人在场也看护）；⑥ `action_hosted_stop` 收尾无残留。

## [未发布 - 批次66b] - 2026-09-17：批次66 真机复测 + 升级/收尾路径五处缺陷修复

### 修复（真机复测暴露，均为批次66 未覆盖的路径）
- **服务端 jar 升级后不刷新（阻断性）**：`VscreensManager.ensureServerJar()` 旧实现「内部文件已存在就沿用」，装机升级后盘上仍是上一个版本的 jar（真机实测：APK 内已是 b12、盘上仍 b11）→ App 判 version mismatch → 反复 kill/respawn → 新建屏必 `SPAWN_FAILED`。改为按**内容哈希（SHA-1）**比对，与包内不一致即重抽（b11→b12 属等长改动，只有哈希能识别）。
- **`killByPidfile()` 只查私有目录 + pidfile 过期**：Shizuku 通道的 pidfile 落在 App 专属外部目录，旧实现只读 `getFilesDir()` → 残留服务端永远杀不掉（8998 被占）；且盘上 pid 早已失效（实测写 20189，真正占端口的是另一个 `dsh-vscreen`）。改为两个通道 pidfile 都查 + `kill -9 $(pidof dsh-vscreen)` 兜底（经 root/Shizuku 特权通道执行）。
- **`/vscreen/close` 不是收尾**：模型在任务中自己调 close 后 `sessionActive=false`，OverlayService 收尾判定便不再走 `shutdown()` → ① `doze_always_on` 永久停在 1；② `dsh-vscreen` 残留占着 8998。现 `handleClose()` 内补 `restoreDozeAod(ctx)` + `killByPidfile(ctx)`（真机验证：close 后 doze 回 null、`ps` 无残留）。
- **AOD 原值「未设置」永不还原**：`dozeAodOriginal` 用 Java `null` 同时表示「本会话未改过」与「原值就是未设置」→ 原值未设置的机器（真机就是）收尾直接早退。新增 `dozeAodDirty` 标志区分，`assertPanelAodIfNeeded()` 同步改用该标志。
- **锁屏期间屏幕每 ~11.6s 闪烁一次**：面板保活锁（`ACQUIRE_CAUSES_WAKEUP`）唤醒面板 → 触发 `SCREEN_ON` → 旧逻辑立即清宽限 + 释放锁 → 系统约 10s 后再熄屏 → 再唤醒（实测 22:34:07–22:37:04 连续 16 次 ACQ/REL）。改为按 `KeyguardManager.isKeyguardLocked()` 判定：仍锁屏则保留宽限与面板锁（新增日志 `[b66] screen on while still locked -> keep panel keepalive`），仅 `USER_PRESENT`（真解锁）才撤销；真机复测确认锁只获取一次并持续持有。
- **日志脱敏**：spawn 命令行原本整串入 logcat（含 `--token <32 位>`），现 `maskToken()` 打成 `--token ***`（logcat 本机任意 App 可读）。

### 新增
- `tools/e2e_batch66_lock_screen.py`：批次66 真机复测脚手架（`reuse/lock/debounce/cleanup` 四阶段、19 条判据、报告落盘；token 只从 `.local` 读取、永不打印）。
- `tests/test_batch66_lock_screen_resilience.py`：契约 12 → **19 条**（新增 7 条锁定上述修复，防回退）。

### 真机复测结论（Honor BKQ-AN10 / MagicOS 11 / Android 17，2026-09-17 晚）
- **建屏复用 ✅**：`create {}` 连续两次 → 第二次 `reused:true` 且 displayId 不变；显式尺寸后再发 `{}` 也复用（旧逻辑在此销毁重建）；直连 8998 `/health` 版本 = **b12**。
- **锁屏挂机 ✅**：`keyevent 223` 后依次出现 `screen off ... grace 120000ms, reassert AOD` → `panel keepalive acquired`（Honor 不尊重 `doze_always_on`，走面板兜底）→ 锁屏保持、屏幕不熄；观察窗口内 `displayId`/`serverPid` **全程不变**、无 `session dead`/`killed vscreen server`、`/vscreen/see` 持续返回 ~155–165KB 且 **sha1 每次不同**（非批次14f 的 13840B 冻结黑帧）。
- **端到端 ✅**：悬浮助手自然语言任务（打开时钟→秒表→等 90s→暂停→报结果）在**锁屏状态**下继续执行，`dsh-overlay` 轮询 `records` 55 → 111、`running=true`，全程无中断，解锁后正常收尾。
- **防抖回归 ✅**：人为 `kill -9` 服务端 → 3 次 `health miss n/3`（约 12s 一轮）→ **1 次** `session dead (attempts=0/2)` → 1 次 `recovered via shizuku (attempt=1)`；`session dead` 计数 = 1，**无 5s 杀建循环**。
- **解锁/收尾 ✅**：`keyevent 224` + 滑动解锁 → `panel keepalive released` + `screen on/unlock -> screen-off grace cleared`；`close` → `doze_always_on restored (null)`、`dsh-vscreen` 进程回收（`ps` 为空）。
- 已知噪声（未修）：`privSetting failed: ...` 是 `ShizukuProcessAdapter` 读流阶段的假报错，命令实际已生效（doze 写 1 / delete 均成功），但会掩盖真实失败，记入待办。


## [未发布 - 批次66] - 2026-09-17：锁屏挂机不中断（虚拟屏「销毁重建再销毁」根因与修复）

### 修复（用户症状：锁屏后任务跑不动，虚拟屏销毁 → 重建 → 再销毁）
- **根因 A（主因）：supervisor 单次探活失败即杀服务端换道重建** —— 旧 `VscreensManager.supervisorLoop()` 每 5s 一轮，`probeHealth` 读超时仅 1500ms，一次失败就 `handleSessionDeath()` → `killByPidfile()`（杀掉活着的服务端，display 随之销毁）→ 换道重拉 → 重建 display；下一轮若再失败，`cur` 已是另一通道 → **又换回**，形成 root↔shizuku **无限乒乓**（每 5s 一轮）；锁屏/深睡眠/CPU 抢占都会让 1.5s 超时假阴性，于是锁屏必现「销毁→重建→销毁」。
  - 修复：新增 `HEALTH_FAIL_THRESHOLD=3` 连续阈值 + `SUPERVISOR_PROBE_RETRY=2`（单 tick 内 400ms 间隔重试自证）+ `SUPERVISOR_PROBE_READ_TIMEOUT_MS=3000` 宽松读超时 + `SCREEN_OFF_GRACE_MS=120000`（灭屏宽限内只复述 AOD/续期 wakelock，**绝不**杀进程重建）+ `RECOVERY_COOLDOWN_MS=60000` 冷却 + `RECOVERY_MAX_ATTEMPTS=2` 抢救预算 + `recoveryChain` 抢救链去重（同链内不重复换道）+ 换道无路时**同通道就地重拉一次**（而非直接判死让插件立刻重新建屏）+ `SESSION_STABLE_MS=120000` 稳定后才复位预算 + 统一死亡收尾 `markSessionDead()`（幂等，含批次14/12w 的 doze/预览收尾）。
- **根因 B：空 JSON 自愈建屏把正在跑的 display 拆掉** —— 插件自愈固定 `POST /vscreen/create {}`；旧服务端把「未指定尺寸」归一化成默认 `1008x1792`，与显式尺寸的现有会话不等 → `closeDisplay()` 销毁重建。
  - 修复：`android-app/src/com/deepseek/harness/vscreen/Main.java` 的 `createDisplay()` 前置判断 `sizeSpecified = reqW > 0 || reqH > 0`；未指定尺寸且已有 display 时直接复用并返回 `"reused":true`（显式尺寸变化仍按原语义重建，保留横竖屏切换能力）。服务端指纹 `BUILD` 由 b11 提到 **b12**，`VscreensManager.SERVER_VERSION` 同步 b12（版本不符会按既有语义重拉，保证新 jar 真的生效）。
- **根因 C：锁屏后面板 OFF → SF 停止合成 → 黑帧（批次14f 结论）** —— AOD（`doze_always_on=1`）是唯一非侵入式缓解，但**只在入睡之前就位才生效**；旧实现仅在 create 时写一次，锁屏路径没有二次保障。
  - 修复：会话期注册灭屏广播（`ACTION_SCREEN_OFF/SCREEN_ON/USER_PRESENT`，仅会话存活期注册、收尾即注销）；灭屏瞬间后台线程**复述** `doze_always_on=1`；1.5s 后若 `PowerManager.isInteractive()` 仍为 false（AOD 被 ROM 忽略）→ 升级持「面板不熄」唤醒锁 `SCREEN_DIM_WAKE_LOCK | ACQUIRE_CAUSES_WAKEUP`（tag `dsh:vscreen-panel`），**仍保持锁屏**、仅屏幕不熄，保证 SF 继续合成；亮屏/解锁/会话收尾即释放；偏好 `dsh_prefs/vscreen_lock_panel_keepalive`（缺省 true）可整体关闭退回「仅 AOD」。

### 新增 / 变更
- 新增 `tests/test_batch66_lock_screen_resilience.py`（12 条镜像契约：阈值/自证重试/灭屏宽限/抢救预算/抢救链/单一死亡收尾/面板保活/建屏复用 + b12 指纹）。
- 修正存量红灯 `tests/test_m1_overlay_source.py::test_submit_not_blocked_by_missing_context`：该用例自批次61 起就断言 `buildAgentPrompt(..., command)`，而批次61 已改用 `effectiveCmd`（非本次改动引入），按现行为修正。
- 修正本地增量构建陷阱 `.local/b47_build.py`：此前 `assets/vscreen/vscreen-server.jar` 只会从 base APK 原样拷回，**只改服务端源码不会随包更新**（本轮实测 base 里仍是 b11，与 App 期望 b12 不匹配 → App 会反复重拉服务端）。现于 `stage_repack()` 覆盖该条目（源码口径：`android-app/assets/vscreen/vscreen-server.jar` → 打进 `android-app/out/vscreen-server/`）。

### 验证
- 单元测试：`python -m pytest tests/ -q` → **255 passed**（新增 12 条批次66 契约，0 失败）。
- 编译：`python .local/javac_check.py` → **rc=0 / 0 errors**；服务端三文件 `javac` → **rc=0**。
- 出包：`python .local/b47_build.py all` → **ALL DONE**，签名 APK `202,618,085 B`；解包确认 `assets/vscreen/vscreen-server.jar` 内 `classes.dex` 只含 **b12**。
- **未验证（诚实记录）**：本机 `adb devices` 无设备，锁屏实测 / 面板保活锁 / 广播注册注销 / AOD 复述的 Honor 真机行为待复测，清单见 `docs/批次66-锁屏挂机不中断方案.md` §六。
## [未发布 - 批次65] - 2026-09-17：超长任务动态心跳延期（永不误超时）与目标 App 进程强杀收网

### 关键突破与缺陷解决
- **超长任务动态心跳延期（彻底废除 10 分钟死限制，支持十几分钟至半小时复杂长任务）**：
  - **根因分析**：原 OverlayAgentClient 写死 TOTAL_TIMEOUT_MS = 600000L（10 分钟静态死截止时间）。复杂长任务跑满 10 分钟时，即使模型每一秒都在正常操作翻页与点击，也会在第 352 行被直接抛出 hard-timeout 强行掐断；
  - **动态心跳滚动延期（Rolling Activity Deadline）**：改造为基于活动心跳的动态截止机制。只要检测到 Agent 正在产出新事件记录（latestSeq > lastSeenSeq）或正在调用自动化工具（page.lastTool），截止时间 deadline 自动向后顺延 10 分钟；
  - **真卡死防护**：只有当连续 STEP_IDLE_TIMEOUT_MS（120s）没有任何事件且无工具活动时，才触发空闲报警；只要模型在做事，任务可以持续执行十几分钟甚至半小时绝不误杀。

- **目标 App 进程级强杀收网（彻底消除后台残留耗电）**：
  - **核心机制**：在 VscreensManager.shutdown() 收尾管线首位新增 killTargetAppIfAny()；
  - 任务收尾时，通过 Shizuku / Root 自动提取当前任务操作的第三方 App（如微博 com.sina.weibo、抖音 com.ss.android.ugc.aweme 等），执行 am force-stop <package>；
  - 达成真正意义上的「虚拟屏销毁 + 目标应用双清零残留」，用户无需手动清理后台任务卡片。

## [未发布 - 批次60] - 2026-09-17：方案 C：高阶自动化意图与多模态即时选区（剔除自绘胶囊/球死重）

### 新增 / 体验优化
- **死重清理与重构（双重减负）**：彻底剔除 OverlayService 中的自绘胶囊（capsuleView、miniBar 及其尺寸动画和定时器）与悬浮球（fab、snapToEdge 等死代码），运行态与完成态 100% 独占交给 Android 16 Live Updates（MagicOS 原生灵动胶囊），待机时零触控侵占、零视觉残留，全量转向 AI 键唤起居中大面板。
- **模块一：复杂意图模板预设（Prompt Chips 自定义工作流）**：新增 PromptChipItem 与 PromptChipManager，打破原硬编码限制，升级为数据驱动引擎，支持首项置顶、新增、编辑、删除与重置，并全量持久化至 dsh_prefs 的 custom_prompt_chips。
- **模块二：多模态即时选区（SelectionOverlayView）**：新增全屏高透黑曜石取景遮罩，基于 AccessibilityService.captureScreen 硬件免弹窗截屏，单指圈选动态镂空底层真实画面（PorterDuff.Mode.CLEAR）与 2dp 冰川蓝发光描边；支持 4 角标微调，弹出操作气泡工具条：[💬 针对此图提问]、[📝 提取此区文字]、[📋 复制图片]，Token 消耗压减 80% 以上，响应提速 70%。

### 虚拟屏（vscreen）启用判定与生命周期收尾
- **判定准则**：虚拟屏只为「让自动化在后台跑、不抢主屏焦点」而存在。只读/理解类（识别、提取、翻译、总结、划选问答）与单点浏览类一律留在主屏；仅跨应用批量/循环、锁屏挂机类才开虚拟屏。
- **Prompt 硬约束**：新增 `applyVscreenPolicy()`，每次提交前置《虚拟屏使用规范》并附本轮判定结论；`vscreen_mode=false` 时直接禁止一切 vscreen 工具。
- **端侧形态判定**：新增 `shouldUseVscreen()`，**先判禁止再判需要**，避免「提取选区文字」命中需求词而误开屏。
- **生命周期兜底**：新增 `VscreensManager.isSessionActive()` 与 `maybeCleanupVscreen()`，任务成功/失败收尾自动回收「本轮自己开的」虚拟屏（不动提交前已存在的），消除「跑完还得手动关小窗」。
- **取消/急停收尾补漏**：`cancelCommand()` 会 `agentGeneration++`，使 `onResult/onError` 的收尾回调被代际守卫丢弃；现于取消路径直接调用 `maybeCleanupVscreen("task canceled")`，保证「用户主动取消/急停」后本轮自建虚拟屏同样被回收（急停走的就是取消路径）。

### 选区上下文与「不存在选区」缺陷修复
- **无障碍选区精准读文 API**：在 `AccessibilityService` 中新增 `extractTextInSelectionRect(Rect)`，根据选区像素范围在控件树中自上而下、自左向右提取区域文字。
- **选区上下文闭环与大模型 Prompt 注入**：解决用户划选后大模型报「无法执行，屏幕上不存在选区」缺陷——在 `OverlayService` 中维护 `activeSelectionRect` 与 `activeSelectionText`，提交任务时自动将选区像素坐标、尺寸与提取文字注入 Prompt 上下文，明确指导大模型针对该选区作答。
- **UI 选区状态徽标与本地秒出**：在居中面板上新增 `selectionBadgeView` 状态药丸（显示选区尺寸、文本预览与 [✕ 清除] 按钮）；点击 [📝 提取文字] 本地 0 秒秒级呈现文字结果并复制到剪贴板，彻底告别选区消失困惑。

### 验证
- 单元测试：`python -m pytest tests/ -q` → **228 passed in 7.88s**（新增 11 条批次 60 契约单测，0 失败）。
- 增量构建：`python .local/b47_build.py all` → ALL DONE（202,609,893 字节，签名 APK 产出）。
- 真机端到端闭环（Honor BKQ-AN10 / MagicOS 11）：
  - 运行 `python tools/e2e_batch60_selection_and_chips.py` 全绿通过；
  - 验证 AI 键唤起大面板流挂动效与收起；
  - 验证自动识别 [🔍 划选] 蓝色药丸 (634, 968) 并点击，成功拉起全屏 SelectionOverlayView；
  - 验证单指圈选 (300, 800) → (900, 1400) 动态镂空与操作气泡弹出，产出 6 张端到端截图；
  - logcat 全程零 NPE，零死代码残留。

## [未发布 - 批次58] - 2026-09-17：方案 B：保活与自启引导收网（悬浮窗保活实时诊断 + 一键放行工具栏 + 真机端到端自启验证）

### 新增 / 体验优化
- **悬浮窗状态详情内保活实时诊断（7 项健康度）**：在 `OverlayService` 的 `detailBox`（点击 `ⓘ` 展开）中新增 `keepAliveStatusText`，实时读取电池优化、后台限制、自启开关、服务运行态、BOOT 接收器、引导标记、自检心跳新鲜度，三档色彩（绿 OK / 橙黄 WARN / 红 FAIL）高亮呈现当前设备的真实保活健康度。
- **悬浮窗三合一保活快捷引导工具栏**：
  - `[⚡ 启动管理]`：消费 `KeepAlivePolicy.startupManagerTargets()` 单点降级链（Honor 组件 → Honor action → 应用详情），秒开系统启动管理页面，一键放行后自动将引导标记置 true 并动态刷新状态；
  - `[🔋 电池优化]`：直达系统忽略电池优化申请弹窗与设置页；
  - `[🩺 完整自检]`：发送携带 `action_open_keepalive=true` 的 Intent 自动平滑收起悬浮窗并唤起 `MainActivity` 的沉浸式 7 条判据卡片。
- **MainActivity 路由直达**：在 `onCreate` 与 `onNewIntent` 中解析并直接消费 `action_open_keepalive`，实现从轻量浮窗到深度自检的无缝过渡。

### 验证
- 单元测试：`python -m pytest tests/ -q` → **218 passed**（新增 8 条方案 B 契约测试，0 失败）。
- 增量构建：`python .local/b47_build.py all` → 生成并签名 `DeepSeekHarness-b47.apk`（202,601,701 字节）。
- 真机端到端闭环（Honor BKQ-AN10 / MagicOS 11）：
  - 点击 `[⚡ 启动管理]` 秒级直达荣耀原厂应用启动管理设置页；
  - 放行后自检状态动态由 `保活：⚠ 建议放行自启 (6/7)` 跃升为翠绿色 `保活：✓ 正常 (7/7) · 心跳3m前`；
  - 点击 `[🔋 电池优化]` 秒级弹出系统忽略电池优化申请（Toast：`已打开忽略电池优化申请`）；
  - 点击 `[🩺 完整自检]` 悬浮窗平滑收起并瞬间弹出主 App 沉浸式 7 条判据全量诊断卡片；
  - 安装更新 APK 验证系统真实的 `ACTION_MY_PACKAGE_REPLACED` 广播触发 `BootReceiver`，成功拉起悬浮球服务；
  - 执行 `python tools/e2e_keepalive_self_heal.py` 验证通过（5/5 全部 PASS）。

## [未发布 - 批次57] - 2026-09-17：方案 A：交互感知与可读性深度打磨（动态微胶囊 + 历史成果抽屉 + Markdown富文本）

### 新增 / 体验优化
- **灵动胶囊动态微文案精炼（<= 8 字符严格预算）**：针对 MagicOS 状态栏右侧 5G/电量图标排挤问题，在 `PromotedProgressNotifier` 中新增智能动作动词提炼（识屏、定位、输入、点击、滑动、请作答、提交、步N）与紧凑耗时拼接（如 `识屏 · 2s`、`输入 · 5s`、`请作答 ⏳`），超长自动紧缩为紧凑无间隔格式，100% 杜绝胶囊右耳文字被截断。完成态升级为带有确认标识的 `完成 ✓`。
- **历史成果抽屉 / 会话时间线（📜）**：在 `OverlayService` 卡片头部新增 `📜` 历史入口，自动在 `dsh_prefs` 中维护最近 10 条任务执行记录（含执行时间、状态彩色标签、指令内容、完整成果）；弹窗支持一键「📥 载入面板查看」、「📋 复制成果全文」与「✏️ 回填原指令」，关闭或重开悬浮窗也能随时回溯成果。
- **纯原生轻量 Markdown 富文本渲染与一键复制代码**：实现零依赖纯原生 `SimpleMarkdownParser`，支持标题（加粗放大）、粗体、斜体、代码块（等宽字体+背景衬底）、行内代码、引用和列表排版；主面板结果与全文大弹窗同步接入富文本；全文弹窗智能感知代码块并提供「复制代码(N)」独立复制按钮。

### 验证
- 单元测试：`python -m pytest tests/ -q` → **210 passed**（新增 4 条针对动态微胶囊文案预算、动作提取与历史抽屉的契约测试，0 失败）。
- 增量构建：`python .local/b47_build.py all` → 成功生成并签名 `DeepSeekHarness-b47.apk`（202,601,701 字节）。

## [未发布 - 批次55] - 2026-09-17：引擎提问悬浮窗回填（55-B）+ 原生实况窗 spike（55-A1）+ 保活自检（55-C）

### 修复
- **引擎提问导致任务永久卡死（P0）**：真机实测任务停在 `ask_user_question` 110 秒无解——引擎侧**没有任何超时**，Host 转发事件瀑布（`user-questions/request`）无人接单会一直挂着。现新增 `DshEventMux`（WebSocket `/api/remote.mux` 订阅 `$events`）+ `OverlayService` 内提问卡片：提问到达自动弹面板，可在悬浮窗里点选项/填「其他回答」→ `POST /api/$events/result` 回填 → 任务继续。真机端到端闭环（回答后 1.2s 内 session `running` true→false、records 21→24、任务「成功：已完成」）。
- **保活自启开关写错文件（真 bug）**：批次47 把 `ball_autostart` 写进 `dsh_setup`，而 `BootReceiver` 读 `dsh_prefs/ball_autostart` → 用户「关闭悬浮球」在重启/更新后被忽略。现以 `dsh_prefs` 为权威源（`dsh_setup` 仅兼容回退），开/关两处同步写。
- **助手弹窗被误判成「用户划掉任务」**：`AssistActivity` 会主动 `finishAndRemoveTask()`，被 55-C 的 `onTaskRemoved` 自愈当成「被系统清理」，每次唤起助手白烧一次自愈额度（3 次后还会在设置页写出假的「保活 FAIL」）。新增 `OverlayService.noteInternalTaskRemoval()` + 15s 窗口，命中即只记录、不自愈。

### 新增
- `android-app/src/com/deepseek/harness/DshEventMux.java`：手写最小 RFC6455 WebSocket 客户端 + `$events` 逻辑流订阅（`ready`/`waterfall`/`cancel`）+ `$events/result` 回填；ping→pong（服务端 2s 心跳，2 次未回即断）、1s→15s 退避重连、失败静默。
- `OverlayService`：提问/审批卡片（`buildInteractionCard`/`showInteractionCard`/`renderQuestion`/`submitInteraction`/`rejectInteraction`/`clearInteractionCard`）、等待态胶囊与耗时行「等待您的回答 · 已 Ns」、**提问到达即展开面板**；`ask_user_question` 映射为「等待您回答提问」。
- `PromotedProgressNotifier.java`（55-A1 spike）：`POST_PROMOTED_NOTIFICATIONS` + `Notification.ProgressStyle` + `setRequestPromotedOngoing(true)`，独立 channel `dsh_live_update` / id 0x55A1 / 开关 `dsh_prefs/promoted_live_update`（默认 true），`SDK_INT>=36` 门控、异常静默；当前挂 `EngineService` 起停。
- `KeepAlivePolicy`（55-C）：7 条判据保活自检（5 硬 2 软）、Honor「应用启动管理」三段降级链、`onTaskRemoved` 自愈决策（尊重用户关球 / <60s 延后 / 10min 内 ≥3 次 giveUp）、5min 自检心跳（写 `dsh_prefs/keepalive_last_beat_at`）；`OverlayService` 落地心跳 + 自愈；`MainActivity` 新增「保活自检」卡片（逐条判据 + 引导 + 4 个按钮）与设置弹窗入口。
- 文档：`docs/批次55B-引擎提问回填实施方案与验证.md`、`docs/批次55B-引擎问询事件协议取证.md`。

### 变更
- `AndroidManifest.xml`：新增 `POST_PROMOTED_NOTIFICATIONS`（targetSdk/minSdk/versionCode 未动）。
- `.local/b47_build.py`：FILES 增 `PromotedProgressNotifier`、`DshEventMux`（本机增量构建脚本，`.local/` 不入库）。

### 验证
- 单元测试：`python -m pytest tests/ -q` → **163 passed**（批次53 基线 148 + 55-C 15）。
- 构建：`python .local/b47_build.py all` → rc=0 / ALL DONE（签名 APK）。
- 真机 55-B 端到端（SN-HONOR-XXXX）：`ready 帧到达 clientId=…` → `interaction pending kind=question count=1 eventId=45df476e-…` → 点选 Red → `interaction answered: [{"id":"favorite_color","selected":["Red"]}]` → `回填成功 …kind=result` → session `running=false`、records 21→24 → 面板「完成 / 任务：成功：已完成」。证据：`.local/repro/b55b/step4|7|8.txt`、截图 `s06_question.png`/`s07_picked.png`/`s12_final.png`。
- 真机 55-A1：`FLAG_PROMOTED_ONGOING`（0x00040000）+ `android.requestPromotedOngoing=true`；MagicOS `CapsuleManager`/`HwOperatorNPV_Home`/`KeyguardCapsuleHelper` 渲染实况窗（状态栏 chip / 锁屏 / AOD 均可达），「设置 → 灵动胶囊 → 应用服务」出现本 App——**targetSdk 仍为 28**，证明「必须升 targetSdk ≥ 36」的前提不成立。

### 结论
- **55-D（targetSdk 28 → 36 大升级）不再为 Live Updates 立项**：A1 已证伪其前提；如需追溯，仅保留为「其他 API 行为升级」的独立议题。

### 55-A2 补充（同日，实况窗落地为「任务实况」）

#### 新增
- `PromotedProgressNotifier`：`start/update/finish/stop` 任务实况语义（`finish` 完成态停留 5s 后自动撤销）+ `contentIntent`（点击回主界面）+ `setShortCriticalText`（运行中/步骤N/完成）+ 进度段随步骤增长（≤20）+ 正文限 80 字；smallIcon 改 `ic_whale_black`（A1 的「灰块」实为小图标被系统按 alpha 单色化）。
- `tools/e2e_user_question.py`：批次55-B 的可复跑端到端脚本（HOME → AssistActivity → 输入发送 → 轮询提问事件 → PIL 自动定位卡片蓝色按钮/chip → 点选提交 → 校验回填与任务继续；支持 `--analyze-card <png>` 离线标定）。

#### 变更
- `EngineService`：**删除**「引擎运行中」实况发布（引擎存活 ≠ 任务实况），仅保留 `onDestroy → stop()`。
- `OverlayService`：任务开始/每步/成功/失败/取消/急停/销毁各一处实况调用 + 新增私有 `parseStepNumber()`。

#### 验证
- `python -m pytest tests/ -q` → **185 passed**（+55-B 契约测试 22 条）。
- `tools/e2e_user_question.py` 真机实跑 **PASS**（23s 全链路：`interaction pending kind=question` → chip 自动定位 `(182,1115)` → 提交 `(234,1370)` → `回填成功 eventId=…` → `running=false`）。
- 实况窗三态截图与 dumpsys：`.local/repro/b55a2/`；**5 分钟不是通知寿命**（`mCapsuleExpandDuration=300000` 只是显示形态时长，对照组 +15min 仍可点、`FLAG_PROMOTED_ONGOING` 未变）⇒ 不新增续期定时器。
- 开关零行为：`promoted_live_update=false` 时任务照跑、无通知无胶囊无日志。




## [未发布 - 批次53] - 2026-09-17：浮窗层级回退 —— 修复「AI 键向下弹但出不来」

### 修复
- **AI 键再也呼不出助手（P0）**：真机取证证明批次52 引入的「无障碍浮层升层」在本机（Honor BKQ-AN10 / MagicOS 11）**零渲染** —— 窗口上报 `ty=ACCESSIBILITY_OVERLAY`、`mHasSurface=true`、`mDrawState=HAS_DRAWN`、`frame=[32,0][1224,1732]`、`isVisible=true`，但 `screencap` 截图里面板完全不可见、输入法也不弹（对照：无障碍未启用回落 `APPLICATION_OVERLAY` 时同一份代码面板正常可见）。
- **故障不可自愈（致命放大）**：旧实现把 `lp.type` 就地改成 2032，随后每次调用都在 `if (lp.type == TYPE_ACCESSIBILITY_OVERLAY) return;` 早退，浮窗**永久不再重新挂载** —— 表现为「第一次能用 → 任务执行中 showCapsule() 触发升层 → 之后每次按 AI 键都只剩系统 AI 预览窗向下弹一下」。
- **撤销升层**：删除 `promoteToAccessibilityWindowIfNeeded()` / `promoteRetryCount`；`addToWindow()` 恒用 `TYPE_APPLICATION_OVERLAY`（第三方可用的最高层级）。
- **新增自愈重挂载 `ensureOverlayAttached()`**：视图未挂载或窗口 token 失效时，把 WindowManager 归一化回应用浮窗、`lp.type` 强制回 2038 并重新 addView，留 `[b53] overlay re-attached` 回执；`openAssistantCapsule()` 与 `showCapsule()` 均改走该入口。
- **内容下移规避状态栏遮挡**：新增 `statusBarHeightPx()`，`buildOverlay()` 中 `rootView.setPadding(0, statusBarHeightPx(), 0, 0)`（本机下移 136px），灵动胶囊与面板不再被状态栏时钟/电量压住。
- **新增渲染看门狗 `panelShowWatchdog`**：展开后 900ms 兜底复位「可见但透明」残留（alpha/scale/translationY/子视图 alpha），异常状态写 `[b53] watchdog` 日志。

### 新增
- `tests/test_batch53_overlay_layer.py`：反向契约（禁止再出现无障碍浮层升层用法）+ 自愈入口、内容下移、看门狗契约。
- `docs/批次53-浮窗层级回退与AI键呼出修复.md`：取证与实施报告。
- `docs/批次54调研-灵动胶囊应用服务准入与LiveUpdates接入.md`：真机取证结论——「灵动胶囊→应用服务」列表的准入条件是声明/授予 `android.permission.POST_PROMOTED_NOTIFICATIONS`（Android 16 Live Updates，安装即自动授予），InstallerX Revived / 支付宝 / 相册 / Google 四者精确匹配；荣耀私有接口（`SUPPORT_CAPSULE_LIST_UPDATE`、`DISPLAY_CAPSULE`、`honor.service.capsule.*`）仍不可接入。**修正批次52「第三方无法接入胶囊」的过宽结论**：第三方可走 Live Updates 官方通路（需 targetSdk ≥ 36）。

### 验证
- 单元测试：`python -m pytest tests/ -q` → **148 passed**（基线 143 + 新增 5）。
- 构建：`python .local/b47_build.py all` → `.local/b47_out/DeepSeekHarness-b47.apk`。
- 真机（SN-HONOR-XXXX，**无障碍服务保持启用**）：窗口 `ty=APPLICATION_OVERLAY`、`frame=[32,0][1224,1868]`；AI 键呼出可见；收起→呼出连续 3 轮全部可见；任务执行中/取消后/完成后按 AI 键均可见（像素探针 + 截图 + logcat 三重判定），无 watchdog 告警；待机态 rootView GONE、无桌面残留。

## [未发布 - 批次52 修复] - 2026-09-17：AI 键唤不出助手回归修复 + 快捷方式目标纠正

### 修复
- **AI 键唤不出灵动助手回归修复**：
  - 真机取证定位：批次51 为隐藏多任务卡片，给 AssistActivity 加了 noHistory=true / autoRemoveFromRecents=true / taskAffinity 三件套，导致静态快捷方式解析路径异常、且 Activity 生命周期被系统提前回收，AI 键短按不再进入助手；
  - 现仅保留 excludeFromRecents=true（多任务卡片仍不残留，由代码侧 finishAndRemoveTask() 兜底），移除其余三个属性。
- **静态快捷方式 intent 纠正**：由 ACTION_ASSIST 改为 ACTION_MAIN + CATEGORY_LAUNCHER 且显式指向 AssistActivity，与 Honor 快捷服务到应用的唤起方式对齐；aapt dump xmltree 已核实 APK 内为 MAIN/LAUNCHER。

### 取证结论（回答用户疑问）
- **荣耀原生灵动胶囊不对外开放**：com.android.server.notification.SUPPORT_CAPSULE_LIST_UPDATE、com.android.server.display.DISPLAY_CAPSULE 均为 signature|privileged 私有权限；MagicCapsuleManager 渠道由 systemui 独占。
- **InstallerX Revived 并非白名单**：真机取证其未声明任何 capsule / action.ohos.liveview 能力；它能出现在 AI 键快捷服务到应用列表里，是因为该列表本质是已安装应用的 Launcher 入口清单，所有有启动图标的 App 都会出现（与本包同因）。

### 验证
- 单元测试：python -m pytest tests/ -q 到 143 passed in 9.18s；
- 真机（SN-HONOR-XXXX）：派发 ACTION_MAIN+LAUNCHER 显式指向 AssistActivity（AI 键等价路径）到面板正常展开（Requested w=1192 h=1732）；
- 悬浮窗层级：无障碍服务在线时 ty=ACCESSIBILITY_OVERLAY mBaseLayer=311000（高于 StatusBar），离线时自动回落 ty=APPLICATION_OVERLAY，功能不中断。

## [未发布 - 批次52] - 2026-09-17：灵动助手离线静默自愈 + 多轮连续追问会话

### 新增与优化
- **灵动胶囊 Z 轴层级突破（超越系统状态栏）**：真机取证确认此前胶囊窗口为 ty=APPLICATION_OVERLAY（mBaseLayer=111000），而系统状态栏为 ty=STATUS_BAR，故胶囊位于顶部信息栏之下层。现新增 promoteToAccessibilityWindowIfNeeded()：无障碍服务在线时动态把悬浮窗迁移到 TYPE_ACCESSIBILITY_OVERLAY（层级在 StatusBar 之上），带 500ms 退避重试（最多 20 次）等待无障碍服务异步连接；不可用时保持原窗口不中断。

- **任务执行中灵动胶囊常态展示与荣耀原厂材质复刻**：
  - 根除此前任务提交后由于 alpha=0 / 未调 requestLayout 导致执行中胶囊消失、做完才突兀弹大面板的缺陷；
  - 胶囊采用荣耀 MagicOS 原厂黑曜石微透底（0xF2080C14）+ 冰川蓝冷光微棱边（0x4D8FB8FF）+ 20dp 全圆角药丸形态 + 8dp 漫反射悬浮阴影；
  - 左侧蓝光脉冲呼吸微光（Alpha 0.4~1.0 舒缓律动），中间高清晰单行跑马灯文本（MARQUEE），右侧独立急停靶点小胶囊（⏹ 急停）；
  - 点击胶囊主体顺滑向下展开大面板，任务完成后展示翡翠绿「✓ 任务已完成」并在 3.2 秒后优雅缩回挖孔隐身；
- **引擎离线一键静默自愈（零切屏）**：
  - MainActivity.java 支持 silent=true 参数，拉起 3080 引擎后台线程后立即 moveTaskToBack(true)，绝对不抢占前台正在使用的第三方 App 焦点；
  - OverlayService.java 在检测到引擎离线时提交指令，不再直接弹错中断，而是自动提示「⚡ 正在静默自愈拉起…」并在后台拉起引擎，探活成功后全自动自动提交执行；
- **多轮连续追问与新会话切换**：
  - OverlayService.java 移除任务成功后盲目强制重置会话的代码，复用 OverlayAgentClient 原生的 30 步内会话延续能力；
  - 任务成功后输入框动态切换提示为「💬 追问刚才的结果，或输入新需求…」；
  - 快捷栏动态增设「✨ 新会话」药丸，点击可随时显式开启全新独立会话；
- **测试覆盖**：
  - 新增 tests/test_batch52_self_heal_and_conversation.py，验证静默拉起契约与多轮追问链路。

### 验证
- 单元测试：python -m pytest tests/ -q → 143 passed in 8.38s（全绿）；
- 增量编译打包签名：python .local/b47_build.py all 成功；
- 荣耀真机实测（SN-HONOR-XXXX）：静默拉起引擎验证前台焦点零丢失，AI 键唤起与多轮会话交互稳定。

## [未发布 - 批次51 修复] - 2026-09-17：打开应用阻断修复 + 外部点击收起 + 三段式液态玻璃流挂动效居中

### 修复
- **多任务列表彻底隐藏灵动助手**：AssistActivity 与 ProcessTextActivity 在 AndroidManifest.xml 补齐 excludeFromRecents="true"、noHistory="true"、autoRemoveFromRecents="true" 与独立 taskAffinity=""；同时在 AssistActivity.java 销毁时调用 finishAndRemoveTask()，确保从按键唤起助手后系统多任务流（Recents）0 痕迹，桌面上滑切换应用不再出现灵动助手卡片。
- **退回桌面残留长条胶囊（miniBar）修复**：旧时代用于给悬浮球显示结果的 miniBar 在非运行态下此前仍会执行 setVisibility(VISIBLE)，当从主应用退回桌面时伴随 rootView 恢复可见，导致 240dp×32dp 的任务结果长条死死常驻在屏幕正上方。现修复为非运行态 miniBar 强制保持 View.GONE，待机态悬浮窗尺寸严格回敛为 0 像素（touchableRegion 为空，alpha=0），彻底杜绝桌面残留。
- **点击应用图标进不去主应用阻断修复**：MainActivity.java 的 onNewIntent 此前无差别调用 moveTaskToBack(true) 和 OverlayService.openAssistantFromKey(this)，导致 singleTask 的主应用每次从桌面图标打开或从悬浮卡片点击「打开主应用（⤢）」时均被强制退回后台并弹出助手。现修复为严格仅在携带 action_open_assistant == true 时才唤起助手，普通启动与热唤醒均正常切前台 WebView。
- **点击卡片外部空白区域自动收起**：OverlayService.java 中为根容器 rootView 补齐 ACTION_OUTSIDE 触摸监听，用户点击屏幕空白区域自动收起悬浮卡片。
- **展开动效居中锚定与三段式流挂质感落地**：OverlayService.java 修复 openAssistantCapsule() 在首帧测量前 getWidth() == 0 导致 setPivotX(0) 引起右上角偏斜展开的问题，采用已知目标宽度 targetW 精准居中；落地 480ms 三段式流挂动效与内容 160ms 延迟渐显，配合软键盘平滑升起。
- **AssistActivity 销毁平滑化**：AssistActivity.java 增加 overridePendingTransition(0, 0) 并微延时 180ms 后销毁，保护输入法焦点通道并消除闪白。
- **冷启动挂载保护**：OverlayService.java 的 onStartCommand 对冷启动呼出助手增加延时就绪保证，避免首帧测量缺失。

### 验证
- 单元测试：python -m pytest tests/ -q → 139 passed in 8.10s；
- 本机构建打包签名：python .local/b47_build.py all 顺利产出 DeepSeekHarness-b47.apk；
- 荣耀真机部署与验证（SN-HONOR-XXXX）：
  1. 桌面点击图标冷启动/热启动均正常进入主应用前台（mFocusedApp=MainActivity）；
  2. 悬浮窗点击「⤢ 打开主应用」正常切回主应用；
  3. AI 键唤起 AssistActivity 正常居中流挂展开灵动助手；
  4. 外部空白区域点击正常收起面板（mCurrentFocus 正确切回）。

## [未发布 - 批次51] - 2026-09-16（AI 键入口可见性诊断 + 顶部液态玻璃倾泻展开方案）

### 调研（只读诊断，未改动行为）
- **AI 键入口可见性**：真机取证确认我方声明合格——
  - `cmd package query-activities -a MAIN -c LAUNCHER` 已能枚举 `com.deepseek.harness/.AssistActivity`；
  - `dumpsys package` 显示 `nonLocalizedLabel=灵动助手弹窗`、`launchMode=LAUNCH_SINGLE_INSTANCE`、MAIN/LAUNCHER 过滤器齐备；
  - `settings secure assistant=com.deepseek.harness/.AssistActivity`，系统助手路径已生效。
- **定位到荣耀侧真实界面与阻断线索**：
  - AI 键设置实为 `com.hihonor.magickey` 的 `AiKeyServiceSettingActivity` /
    `settings.servicechoose.AiKeyServiceSelectionActivity`（「选择服务」）；
  - 荣耀存在私有签名权限 `com.hihonor.permission.CAN_RECEIVE_AI_KEY`（仅授予 systemmanager / magickey），
    推测「选择服务」候选列表按该权限或系统白名单过滤，第三方应用天然不在其中。
- **动效根因定位**：面板形变原点偏离挖孔中心（`panelView` 是 rootView 第 4 个子 View 且自带 8dp topMargin）、
  `scaleX` 以面板自身中心双向生长导致「从中间裂开」、400ms + 超冲曲线时长过短、缺少液体连续性分段。

### 交付（方案文档，待实施）
- 新增 `docs/批次51-AI键入口与顶部液态玻璃倾泻展开方案.md`：
  - P1 修复设计：等价路径保底（冷启动不亮 WebView / 服务未就绪轮询 / AssistActivity finish 延后）
    + 应用列表尽力项（APP_ASSISTANT 分类、taskAffinity、桌面快捷方式、设置页 AI 键引导卡片、厂商 intent-filter 需用户拍板）；
  - P2 动效设计：三段式「流挂」——出液（0→180ms 建立视觉起点，起始尺寸对齐挖孔 296px）
    → 垂落（180→460ms 居中对称展开 + 内容延迟渐显）→ 定形（460→620ms 圆角 34→26dp 回稳）；
  - 验收标准 V1–V6（逐帧质心/面积曲线判定，起点必须落在挖孔下缘正中 X≈628px）；
  - 排期 S1–S5、风险与规避、与批次50 的关系（只替换过渡动效实现，不推翻既有成果）。
- `docs/PLAN-INDEX.md` 登记批次51 为 **待办**。
## [未发布 - 批次50] - 2026-09-16（顶部前摄巡航灵动胶囊）

### 新增（苹果灵动岛交互体验）
- **真机挖孔贴合与前摄居中（C1）**：
  - 基于真机 `DisplayCutout` 硬件级取证（居中药丸孔 296×136 px，X=628），窗口采用 `LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS`，严丝合缝包裹物理前摄；
  - 纯黑（`#000000`）+ 微透发光蓝外圈（`0x3360A5FA`）38dp 高度药丸造型，与前摄镜头完美融为一体。
- **液态舒展与收启动画（C2）**：
  - 发送指令后从前摄挖孔（85dp）向两侧平滑延展至 230dp，呈现类似苹果 Siri / 灵动岛的展开动效；
  - 任务结束或急停后反向缩回 85dp 并淡出隐藏。
- **巡航进度与毫秒级急停（C3）**：
  - 胶囊内包含蓝色呼吸光标、单行实时操作跑马灯（`AI 正在操作微信 · 步骤 2/3`）与右侧耗时/急停按键；
  - 运行期间轻触胶囊或急停按钮立即强制中断请求并释放模拟手指（`AccessibilityService.forceReleaseFingers`）。
- **完成态自动退场（C4）**：
  - 任务完成时胶囊亮起翠绿色打勾反馈（`✓ 任务完成 · 已存为文件`），倒计时 2.8 秒后自动收回隐藏。

### 验证
- 单元测试：新增 `tests/test_batch50_smart_capsule.py`（5 项测试全过）；
- 全量回归：`python -m pytest tests/ -q` → 134 passed in 9.43s；
- 真机验证：增量打包签名并部署至真机 `SN-HONOR-XXXX`，logcat 确认 `[b50] capsule overlay attached`。

## [未发布 - 批次49] - 2026-09-16（悬浮球自动化巡航与成果落盘）

### 新增（自动化避让与巡航急停）
- **跨 App 执行时视线避让与呼吸灯（G1）**：
  - 发送指令后面板自动折叠为小浮标，底层第三方 App 界面 100% 露出，无障碍识屏与手势不再受小鲸鱼卡片自身遮挡；
  - 小浮标在执行中开启亮蓝呼吸脉冲动画（`startPulseAnimation`），`miniBar` 紧凑单行进度条实时显示执行状态与引导文案。
- **操作高亮光圈与安全急停总线（G2）**：
  - AI 模拟手势点击时，屏幕对应坐标实时展现 450ms 扩散发光高亮指示圈（`showTapHighlight` / `displayTapRipple`），操作过程直观可视且不拦截触控；
  - 轻点小浮标或 miniBar 立即触发急停总线（`triggerEmergencyStop`），强制中断请求并通过无障碍服务一键抬起所有模拟手指（`AccessibilityService.forceReleaseFingers`），确保用户随时掌控设备。

### 新增（成果落盘与突破截断）
- **成果一键落盘 Markdown 文件（G3）**：
  - 悬浮球快捷药丸栏新增「📄 存为文件」按钮，一键将任务结果异步写入 `/sdcard/Documents/DSH_Outputs/dsh_result_<时间戳>.md`，带完整 Markdown 元数据头，并可通过系统 Intent 调用外部文本编辑器查看。
- **突破 4000 字符限制与全文查看/分享（G4）**：
  - 维护未截断完整输出 `fullResult`，卡片仅作为截断预览；
  - 新增「⤢ 查看全文」按钮（点击卡片结果文本区也可直接触发），弹出全屏独立滚动对话框，支持文字自由选中文本、一键复制全文以及通过系统分享面板发送到微信/备忘录。
- **横向滑动快捷药丸栏**：使用 `HorizontalScrollView` 包裹快捷按钮区，整洁容纳识屏、总结、提取、翻译、复制、存为文件与查看全文等全量功能。

### 新增（系统保活）
- **荣耀/MagicOS 专属应用启动管理引导（模块 C）**：
  - `MainActivity` 权限引导页新增「应用启动管理（荣耀/自启保活）」直达入口；
  - 快捷直跳 `com.hihonor.systemmanager/.startupmgr.ui.StartupNormalAppListActivity`，指导用户开启自启动、关联启动与后台活动，保障开机自愈。

### 验证
- 单元测试：新增 `tests/test_batch49_automation_and_save.py`（12 项测试全部通过）；
- 全量回归：`python -m pytest tests/ -q` → 129 passed in 9.85s；
- 真机验证：部署至荣耀真机 `SN-HONOR-XXXX`，启动管理 Intent 调用与悬浮窗服务正常运行。

## [未发布 - 批次48] - 2026-09-16（彻底拔除 YOYO 残留与悬浮球离线自愈）

### 彻底移除（去 YOYO 化清理完毕）
- **完全删除 YOYO 底部灵动胶囊拟态代码**：
  - 从 `OverlayService.java` 中彻底拔除 `dockContainer`、`dockBar`、`dockInput`、`dockResultScroll`、`dockDots`、`dockAvatar`、`dockBackdrop` 等全部胶囊拟态组件及布局逻辑（净减 580+ 行死代码）；
  - 彻底删除 `enterDockMode()`、`exitDockMode()`、`applyBackdropBlur()`、`playDockEnterAnimation()`、`makeDockChip()`、`showQuickDock()` 等全套胶囊控制方法；
  - **彻底移除长按悬浮球触发胶囊的绑定**（删除 `BALL_HOLD_MS` 及预约倒计时），长按不再误调出模仿 YOYO 的底栏，手势彻底恢复纯粹；
  - 删除 `DockWaveView.java` 独立文件及原厂 `ic_yoyo_*.png`（avatar/lens/plus/wave）全部矢量图片资产；
  - 删除旧胶囊测试契约 `tests/test_m1_yoyo_dock_source.py`，新增反向契约断言全仓零残留。

### 战略定位（用户明确「不做 YOYO 重复品，只做它结构上做不到的事」）
- **主动不做清单**：闹钟/提醒、发短信、拨打电话、天气、系统设置开关、简易翻译等厂商原生指令。
- **主攻 4 大结构性壁垒能力**：
  1. 跨第三方 App 泛化 UI 自动化与表单自动填报（依托已就绪的通用无障碍服务，YOYO 无通用 a11y）；
  2. 本地真实文件系统与代码级脚本批处理（AI 工作区直连真实外置存储 + Termux/chroot 本地计算）；
  3. 跨应用特权系统维护与应用冻结（Shizuku UID 2000 / Root 通道）；
  4. 自由接入私有模型（BYOM）与自定义 Agent Skills。

### 新增与修复
- **悬浮球离线一键自愈**：解决「悬浮球在桌面但红点、不可用、点不开、无法自愈」体验断点。点击卡片上红点状态区或「引擎离线」文案，悬浮窗直接发送 `action_launch_engine=true` 唤醒 `MainActivity` 复用现有单飞闸门在后台拉起 3080 node 引擎；
- **详情按钮显式化**：在卡片标题栏增加独立的 `ⓘ` 按钮，彻底解决卡片头触摸监听吞掉长按手势导致详情面板打不开的历史遗留 Bug；
- **探活时延可视化**：端口行透出最近一次探活距离现在的秒数（`最近探活 Xs 前 · 在线/离线`）。

### 验证
- 单元测试：`python -m pytest tests/ -q` → 121 passed / 1 skipped；
- 构建与部署：`.local/b47_build.py all` 顺利编译打包，APK 已真机覆盖安装。

## [未发布 - 批次47] - 2026-09-16（策略调整：去 YOYO 化）

### 变更（用户明确改策略）
- **彻底解除与厂商助手 / YOYO 的绑定**：不再识别、压灭、接管系统助手，也不再尝试抢占
  `secure voice_interaction_service`。电源长按等启动 YOYO 的方式完全交还系统，我们不再干预。
- 产品收敛为「**桌面悬浮球的保活与启动**」，后续只做自有功能的打磨与扩展。

### 删除（回滚）
- `AccessibilityService` 的助手拦截链（包名识别 / BACK 压灭 / 窗口列表预占位 / 冷却与取证字段），−155 行；
  原地保留 3 行策略注释指向 `docs/批次47-策略调整-去YOYO化与悬浮球聚焦.md`。
- `DshVoiceInteractionService` / `DshVoiceInteractionSessionService` / `DshVoiceInteractionSession` /
  `DshRecognitionService` / `AssistantTakeover` / `res/xml/voice_interaction_service.xml` 及清单声明。
- 设置页「系统助手接管」行与接管/恢复对话框；旧测试契约 3 份（改为反向契约 `tests/test_batch47_source.py`）。

### 新增
- **开机 / 覆盖安装自愈**：`BootReceiver`（BOOT_COMPLETED / MY_PACKAGE_REPLACED / QUICKBOOT_POWERON ×2）
  按 `dsh_prefs/ball_autostart` 拉起悬浮球；清单补 `RECEIVE_BOOT_COMPLETED` 与 receiver。
- **球上线回执**：建窗成功打 `[b47] ball-up`（与 `dsh-boot` 的「已请求拉起」区分），便于真机取证。
- **长按悬浮球 → 底部快捷胶囊**：长按 450ms 打开（`BALL_HOLD_MS`），拖动/松手/取消都会撤销计时；
  外部入口 `showFromAssistantKey` 更名 `showQuickDock`（去助手语义）。

### 修复
- **多任务列表彻底隐藏灵动助手**：AssistActivity 与 ProcessTextActivity 在 AndroidManifest.xml 补齐 excludeFromRecents="true"、noHistory="true"、autoRemoveFromRecents="true" 与独立 taskAffinity=""；同时在 AssistActivity.java 销毁时调用 finishAndRemoveTask()，确保从按键唤起助手后系统多任务流（Recents）0 痕迹，桌面上滑切换应用不再出现灵动助手卡片。
- **退回桌面残留长条胶囊（miniBar）修复**：旧时代用于给悬浮球显示结果的 miniBar 在非运行态下此前仍会执行 setVisibility(VISIBLE)，当从主应用退回桌面时伴随 rootView 恢复可见，导致 240dp×32dp 的任务结果长条死死常驻在屏幕正上方。现修复为非运行态 miniBar 强制保持 View.GONE，待机态悬浮窗尺寸严格回敛为 0 像素（touchableRegion 为空，alpha=0），彻底杜绝桌面残留。
- **悬浮球字段被局部变量遮蔽**：`buildOverlay()` 内 `FrameLayout fab = new …` 让字段 `this.fab` 从未赋值，
  导致 `fab.setVisibility(GONE/VISIBLE)`（Dock 模式隐藏球）与长按判定全是空操作。
- **冷启动球不可见**：`MainActivity.overlayForeground` 缺省 `true` 使开机/更新/STICKY 冷启动被误判为
  「App 在前台」→ 球被建出来却是 GONE、无 surface。缺省改为 `false`。
- **建窗失败即永久消失**：`addView` 失败由直接 `stopSelf()` 改为 200/400ms 退避重试 3 次并保留服务进程。
- **不再偷偷复活用户关掉的球**：`startEngine()` 仅在 `ball_autostart=true` 时拉起悬浮球。

### 验证（Honor BKQ-AN10 / MagicOS 11）
- 覆盖安装自启：`dsh-boot: 已请求拉起悬浮球 (autostart=true)` → 62ms 后 `dsh-overlay: [b47] ball-up`。
- 球可见：`mViewVisibility=0x0 mHasSurface=true`，frame=[10,440][164,594]（44dp）。
- 长按球 700ms → `[b47] dock-visible`、窗口转 `fillxfill gr=FILL`；点空白收回恢复 `wrapxwrap`；短按开卡片。
- 电源长按：无任何 `dsh-a11y` 干预日志（行为完全交还系统）。
- 单元测试：`python -m pytest tests/ -q` → 118 passed / 1 skipped。

## [未发布 - 批次46] - 2026-09-16

### 修复
- **多任务列表彻底隐藏灵动助手**：AssistActivity 与 ProcessTextActivity 在 AndroidManifest.xml 补齐 excludeFromRecents="true"、noHistory="true"、autoRemoveFromRecents="true" 与独立 taskAffinity=""；同时在 AssistActivity.java 销毁时调用 finishAndRemoveTask()，确保从按键唤起助手后系统多任务流（Recents）0 痕迹，桌面上滑切换应用不再出现灵动助手卡片。
- **退回桌面残留长条胶囊（miniBar）修复**：旧时代用于给悬浮球显示结果的 miniBar 在非运行态下此前仍会执行 setVisibility(VISIBLE)，当从主应用退回桌面时伴随 rootView 恢复可见，导致 240dp×32dp 的任务结果长条死死常驻在屏幕正上方。现修复为非运行态 miniBar 强制保持 View.GONE，待机态悬浮窗尺寸严格回敛为 0 像素（touchableRegion 为空，alpha=0），彻底杜绝桌面残留。
- **电源长按「先闪一下 YOYO」的时延压缩**（P0-2B，真机实测）：
  - 删除批次43 的「BACK → 100ms → 起 Dock」串行等待，改为**同帧并发**；
  - 新增**窗口列表预占位**：窗口级无障碍事件到来即主动扫 `getWindows()`，不等厂商窗口自己的事件
    （实测首个窗口事件 → 命中仅 3ms）；
  - **防误伤守卫**：厂商常驻空壳浮窗（荣耀 magicvoice 的 FlatStayAliveLayout 等）不再触发接管，
    仅「已获焦/活跃，或窗口树里已有内容」才算助手被拉起（阴性对照 0 误触发）；
  - 结果：接管时延（首个信号 → 胶囊可见）**P50 43ms / max 52ms**（批次43 时代为 100ms 起）。

### 新增
- **系统助手源头接管组件（P0-1，能力已就绪、本 ROM 暂不可用）**：
  - `DshVoiceInteractionService` / `DshVoiceInteractionSessionService` / `DshVoiceInteractionSession`
    / `DshRecognitionService` + `res/xml/voice_interaction_service.xml` + 清单声明；
  - `AssistantTakeover`：secure `voice_interaction_service` 的备份、写入、回读校验与一键恢复
    （Shizuku 主通道，root 兜底）；
  - 设置页新增「系统助手接管（电源长按 / 语音键）」行：接管 / 恢复系统助手，失败如实提示、原状不变。
  - **实测结论**：MagicOS 上写入会被 `com.hihonor.magicvoice` 在同一毫秒回写覆盖（logcat 铁证，
    见 docs/批次46-系统助手源头接管与动效收尾-实施报告.md 第 3 节），故本批次实际生效路径为窗口预占位；
    原值未被改动，系统无任何遗留变更。
- **Dock 动效（P1）**：升起 220ms `PathInterpolator(0.2,0,0,1)`、毛玻璃 120ms 淡入、
  结果抽屉 180ms 自底升起、退出 120ms 快速收笔（替代原来的瞬切）。
- **声波律动（P1）**：新增自绘 `DockWaveView`（5 柱 / 3dp 宽 / 18dp 峰高 / 相位错位 0.18 周期 /
  450ms 循环），替代 Dock 内的静态 `ic_yoyo_wave` 图标；`setEnergy(Float)` 预留真实麦克风能量接口位，
  当前为零权限依赖的合成波形。
- **客观像差指标工具（P2/G4）**：`tools/ui-diff.py` 输出 SSIM（整体/暗区）、胶囊几何与差值、
  配色与暗化系数，并给 pass/reasons 结论；配套 `tests/test_batch46_ui_diff.py`（7 用例，含纯 Python
  与 numpy 双引擎数值对拍）。
  - 稳健性加固（子代理独立复核后修的 3 处检测缺陷）：候选暗带**先按左右包络扩张再判最小宽度**（修复
    「居中大图标把整行切成两段后误报未定位」）、**任一侧贴边即判非胶囊**（修复导航栏/面板被当成胶囊）、
    **圆角半径 ≤3px 判非胶囊**（平直暗条），并附 `band_candidate` 供审计。
  - 使用注意：默认底色 `(31,34,42)` 源自批次45 的暗色壁纸样张；半透明玻璃胶囊需用
    `--band-color` 指定实测底色（真机实测约 `(52,39,47)`），否则底部裁剪区命中不到、geometry 为 null。

### 变更
- `AccessibilityService` 增加取证日志（窗口事件时间线 `[b46] win-evt`、接管 `[b46] assist-intercept`）。
- Dock 声波组件由 `ImageView` 改为 `DockWaveView`；原厂 `ic_yoyo_wave.png` 资产保留在包内。

### 验证（Honor BKQ-AN10 / MagicOS 11 / Android 17）
- 单元测试：`python -m pytest tests/ -q` 全绿。
- 接管时延 7 次采样：43/44/42/48/41/52/43 ms（P50=43ms，max=52ms）。
- 阴性对照：HOME/设置/桌面连续切换 5 次窗口变化，0 次误接管。
- Dock 开合回归：打开 fillxfill 可聚焦、点空白收回后恢复 wrapxwrap，无残留窗口；logcat 无崩溃。

## [未发布 - 批次45] - 2026-09-16

### 修复
- **多任务列表彻底隐藏灵动助手**：AssistActivity 与 ProcessTextActivity 在 AndroidManifest.xml 补齐 excludeFromRecents="true"、noHistory="true"、autoRemoveFromRecents="true" 与独立 taskAffinity=""；同时在 AssistActivity.java 销毁时调用 finishAndRemoveTask()，确保从按键唤起助手后系统多任务流（Recents）0 痕迹，桌面上滑切换应用不再出现灵动助手卡片。
- **退回桌面残留长条胶囊（miniBar）修复**：旧时代用于给悬浮球显示结果的 miniBar 在非运行态下此前仍会执行 setVisibility(VISIBLE)，当从主应用退回桌面时伴随 rootView 恢复可见，导致 240dp×32dp 的任务结果长条死死常驻在屏幕正上方。现修复为非运行态 miniBar 强制保持 View.GONE，待机态悬浮窗尺寸严格回敛为 0 像素（touchableRegion 为空，alpha=0），彻底杜绝桌面残留。
- **悬浮球移动「反手」与坐标重置**（真机复现并修复）：
  - 触控引擎改为**单指锁定**（activePointerId）：ACTION_POINTER_DOWN 忽略第二触点，
    ACTION_POINTER_UP 平滑移交主触点，彻底消除单手大鱼际误触导致的反向甩出/抖动。
  - 拖动加入**边界防护**，越界一律收敛回可视区。
  - 新增**靠边磁吸** snapToEdge()（220ms 减速插值，贴合左右边缘 8dp）。
  - 悬浮球坐标**独立持久化**（overlay_float_x/y）：进出 Dock 模式不再被硬编码重置。
  - 悬浮卡片展开增加**右侧溢出保护**：贴右边缘展开时自动左移，卡片完整可见。

### 新增
- **YOYO 底部灵动胶囊 1:1 复刻**（反编译真机 com.hihonor.magicvoice 提取原厂资产）：
  - 贴底 54dp 高 / 27dp 圆角胶囊（0xEE1E2129 + 1dp 高光描边），左右 14dp、底部 12dp 边距。
  - 原厂资产 ic_yoyo_avatar / ic_yoyo_plus / ic_yoyo_wave / ic_yoyo_lens。
  - 原生交互：无文字显示声波+识屏，输入文字后切换为发送键（不再常驻蓝色发送按钮）。
  - **液态毛玻璃背景**：Dock 捕获当前屏 → 高斯模糊（RenderEffect 56px）+ 轻量暗化，
    实测背景边缘能量 6.45 → 0.60；退出即释放位图。
  - 芯片行加入 4 点分页指示光点，场景芯片对齐原生。

### 变更
- AccessibilityService 暴露 instance 与 captureScreen()（Android 11+ 免弹窗截图），
  供悬浮窗毛玻璃背景使用，服务销毁自动清空引用。

### 验证（Honor BKQ-AN10 / MagicOS 11 / Android 17）
- 单元测试：**47 passed**（含批次45新增契约）。
- 悬浮球左右拖动 1:1 跟随、松手靠边磁吸、退出 Dock 坐标不重置、空白轻点退出、logcat 无崩溃。

## [未发布 - 批次43] - 2026-09-16

### 新增
- **厂商系统助手（荣耀 YOYO / 华为小艺等）毫秒级接管与硬件按键唤起 (P1-E1 突破)**：
  - **无障碍毫秒级接管总线**：在 `AccessibilityService.java` 中监听 `TYPE_WINDOW_STATE_CHANGED` 事件，识别厂商语音助手前台包名（荣耀 YOYO `com.hihonor.magicvoice`、华为小艺 `com.huawei.vassistant`、小米小爱 `com.miui.voiceassist`、OPPO小布 `com.heytap.speechassist` 等）。
  - **毫秒级压灭与无缝顶替**：命中后立即触发 `performGlobalAction(GLOBAL_ACTION_BACK)` 压退 YOYO 动画，并在 100ms 内调用 `OverlayService.showFromAssistantKey()`，瞬间直接展出小鲸鱼助手卡片并自动聚焦输入法。
  - **安全防抖与循环防护 (Guardrails)**：引入 1500ms 冷却时间戳（`ASSISTANT_INTERCEPT_COOLDOWN_MS`），杜绝 YOYO 销毁周期连续发送 BACK 导致的返回键雪崩。
  - **软硬件配置开关**：支持通过 `dsh_prefs` 的 `intercept_system_assistant` 开关控制，关闭后无损恢复荣耀原生 YOYO。
  - **真机实测闭环**：通过 `am start -n com.hihonor.magicvoice/.startup.MagicVoiceActivity` 验证，实测日志精准捕获 `[batch43] intercepting system assistant: com.hihonor.magicvoice, performing GLOBAL_ACTION_BACK`，屏幕瞬间展示小鲸鱼卡片并升起系统键盘（见实测截图）。

# DeepSeek Harness Android · 移动端优化改动清单

## v1.9.0-dsh0.1.5rc1（versionCode 28 · 2026-09-13）



### 💎 批次44 · YOYO 1:1 底部灵动胶囊形态重塑（系统级 Assistant 拟态真机验收）

- **1:1 原生贴底灵动胶囊架构（彻底取代悬浮大方块卡片）**：
  - **设计初衷**：长按电源键呼出悬浮窗时，中央大方块窗口显得像第三方 App，缺乏系统原厂助手的沉浸感；
  - **1:1 胶囊还原**：复刻荣耀 YOYO 原生沉浸 Dock 交互——紧贴屏幕底部导航条上方，高 54dp，圆角 27dp 纯正胶囊形态，底色深空暗晶黑（0xEE1E2129）搭配 1dp 白色微光描边；
  - **四大金刚布局**：左侧圆形 [+] 扩展圈号、中间浅灰占位 Hint“正在倾听，点击发送”、右侧三段动感声波 [|||] 与智慧视觉识屏镜头 [·]、右侧发光宝石蓝 [发送] 药丸；
  - **上方灵动芯片栏**：紧贴胶囊上方，左侧为小鲸鱼立体发光圆形头像（34dp），右侧横滑快速药丸（关机重启、关闭所有闹钟、识别屏幕、总结、提取文字、翻译）；
  - **双模式自适应引擎**：点悬浮球保持经典可拖动自由缩放小卡片；长按电源键/手势直接以贴底 1:1 原生 YOYO 胶囊唤出！
- **自动化测试与真机验收**：
  - 新增 tests/test_m1_yoyo_dock_source.py（3 项视觉与组件契约测试），全量 97 项单测 100% 绿灯通过；
  - 在 Honor BKQ-AN10 真机实测：唤出后底部优雅胶囊紧贴下巴，软键盘自动升起，视觉体验与系统级助手高度一致！

### ⚡ 批次43 · 系统助手硬件按键与手势接管（MagicOS YOYO 接管真机验收）

- **荣耀 MagicOS 硬件拦截突破（无障碍秒级智能接管）**：
  - **根因分析**：MagicOS 底层长按电源键 / 底部横条手势硬编码私有拦截（hw_long_home_voice_assistant=1），强制唤起 com.hihonor.magicvoice（YOYO 语音），绕过标准 ACTION_ASSIST 意图分发。
  - **核心方案**：在常驻已授权的 AccessibilityService 中监听 TYPE_WINDOW_STATE_CHANGED 窗口变化，当检测到 com.hihonor.magicvoice（及华为小艺 com.huawei.vassistant）界面被系统拉起时；
  - **动作流转**：执行 GLOBAL_ACTION_BACK 毫秒级压灭 YOYO 界面，延迟 100ms 自动呼出小鲸鱼全能助手卡片并聚焦输入法，完美实现物理按键/系统手势的无感替代！
  - **防抖与安全兜底**：设置 1500ms 冷却时间戳（ASSISTANT_INTERCEPT_COOLDOWN_MS），防止连续事件造成死循环；支持 intercept_system_assistant 开关自由启闭（默认开启）。
- **自动化测试与全量回归**：
  - 新增 tests/test_m1_assistant_interceptor_source.py（3 项契约断言），全量 93 项单测 100% 绿灯；
  - 完成 APK classes.dex 重新打包签名并安装至 Honor BKQ-AN10 真机。

### 🌟 批次42 · 系统级全局唤起入口与全局划词交互（真机验收）

- **【入口 E1】系统默认数字助手（AssistActivity）**：
  - 新增 AssistActivity（透明无感知穿透主题），声明 android.intent.action.ASSIST 意图；
  - 接入系统默认助手通道，支持长按电源键、底部导航条或屏幕边缘上滑直接呼出小鲸鱼悬浮助手面板并自动唤起键盘。
- **【入口 E2】下拉控制中心快捷磁贴（AssistantTileService）**：
  - 新增 AssistantTileService，继承系统原生 TileService，声明 BIND_QUICK_SETTINGS_TILE 与 action.QS_TILE；
  - 支持下拉通知栏/控制中心一键快捷切换展开或收起小鲸鱼悬浮卡片，状态与悬浮窗运行态实时同步高亮。
- **【入口 E3】系统全局划词菜单一键处理（ProcessTextActivity）**：
  - 新增 ProcessTextActivity，声明 android.intent.action.PROCESS_TEXT 并限定 text/plain；
  - 在浏览器、微信、备忘录等任意应用中选中文字，系统长按菜单直接弹出「小鲸鱼处理」；
  - 点击后自动提取选中文本灌入悬浮卡片输入框，一键发起智能分析/总结。
- **真机打包与全量单测闭环**：
  - 升级打包链路：aapt 自动编译二进制 AndroidManifest.xml 与 resources.arsc，与全量 classes 增量装配；
  - 新增 tests/test_m1_entry_source.py（4 项入口契约断言），全量 90 项单测 100% 绿灯；
  - 在 Honor BKQ-AN10 真机实测：系统划词选择「小鲸鱼处理」，选中文本毫秒级自动注入卡片输入框并展开！

### 🚀 批次41 · 悬浮助手自适应长生命周期与全自动避让（长任务可靠性闭环）

- **根因修复 1：自适应长生命周期心跳与防止自杀式 Cancel**：
  - **故障现象**：在 App（Web 界面）中直接执行多步任务（如“关闭所有闹钟”）能成功（实测跑 2 轮 21 步，耗时 4 分 47 秒，消耗 618K Tokens），但在悬浮助手中频繁失败，报错 [timeout/hard-timeout] 等待 Agent 结果超时（180s）。
  - **根因分析**：悬浮助手硬编码了 180s（3 分钟）暴力超时；多步任务中大模型思考、无障碍读屏与连续点击/滑动必然超过 3 分钟；更致命的是超时后客户端在 finishTask 中自动向引擎发送 session.cancel 掐死后台正常执行的 Agent。
  - **修复**：硬超时上限拓宽至 600s（10 分钟）；引入自适应心跳机制，只要检测到底层有新事件推进（latestSeq 增长）或工具调用产生，持续重置单步空闲计时器；仅在单步超过 120s 毫无响应时给出柔性提醒，彻底避免中途误杀。
- **根因修复 2：发送后全自动折叠避让（释放物理屏视野与无障碍触控通道）**：
  - **故障现象**：用户在悬浮卡片点击发送后，大卡片仍常驻屏幕中央，导致 Agent 读取屏幕时读到悬浮窗自己、点击物理元素时被悬浮卡片遮挡拦截。
  - **修复**：用户点按发送后，悬浮卡片立即自动收起折叠（setPanelVisible(false)），彻底释放物理屏幕视野；收起期间由边缘胶囊迷你条（miniBar）实时同步动态进展；任务执行完成或失败时自动重新展开大卡片呈现完整答案。
- **根因修复 3：会话生命周期治理与防止上下文爆炸**：
  - **根因分析**：原实现永久续接 overlay_last_session_id，一个经历过 20+ 步复杂任务的 Session 累积了 600K+ Tokens，下一个任务进入时推理首字延迟极高且极易超时。
  - **修复**：新任务检测如果现有会话历史事件量过大（seq >= 30）自动轮换干净的新 Session；任务成功完成或失败归档时自动调用 client.resetSession() 释放会话引用。
- **根因修复 4：工具调用轨迹实时捕获与友好中文回显**：
  - **修复**：parsePage 全面支持捕获 tool/call 事件，实时提取工具名称与步骤序号（如 android_screen -> 正在执行: 读取屏幕，tap -> 正在执行: 点击元素），通过 onProgress 实时推送给胶囊迷你条与卡片状态栏，让悬浮助手与 App 侧“轨迹”保持同步可视。

### ✨ 批次40 · 悬浮助手交互精细化与液态玻璃材质（真机验收）

- **拖拽缩放真实重排修复（根因）**：
  - **故障现象**：手指拖动右下角把手下拉放大窗口时，只有下方空白变大，菜单按钮与信息展示窗口的尺寸/位置纹丝不动。
  - **根因**：`panelView.onMeasure` 用 `userCardHeight` 做成了 `AT_MOST` 二次截断，与 `applyPanelSize` 设置的 `EXACTLY` 高度互相打架；结果区又被 160dp 天花板锁死，新增高度全部被吸收成底部留白。
  - **修复**：卡片高度完全交由 `layoutParams` 的 `EXACTLY` 约束；仅在「用户尚未缩放过」时保留 420dp 兜底上限。结果展示区（weight=1）解除 160dp 天花板，真实吸收新增高度——真机实测下拉 +420px 后信息展示区由 753px 增至 1193px，快捷药丸与输入行同步下移；回拖后完全复原。
  - **把手强化**：`◢` 字形放大到 14sp、高对比度配色，触控区提升至 ≥40dp，解决此前难以命中的问题。
- **输入框发送自动清空**：用户点击「发送」后，输入框立即清空并收起软键盘，光标自动复位，完美恢复「输入你想让我做的事（如：发微信、搜索、点赞）…」占位 Hint，彻底告别二次输入前手动全选或逐字退格的烦恼。
- **原生级自由缩放（Resize Handle & 尺寸记忆）**：
  - 在悬浮卡片右下角新增精致的拉伸把手（`◢`，支持灵敏手势拖拽）。
  - 支持随手指自由拉伸或收缩卡片宽高（宽度可在 240dp ~ 屏幕宽度间自由调整，高度自适应伸缩）。
  - 结果滚动区与卡片高度弹性联动，拉大窗口时自动展示更多文本行数，底部按钮永不移位挤压。
  - 用户调整后的宽高通过 `SharedPreferences` 实时持久化（`overlay_user_width` / `overlay_user_height`），下次展开自动保持偏好尺寸。
- **荣耀 MagicOS 液态玻璃材质重塑（Liquid Glass）**：
  - **通透晶质底板**：卡片大底升级为 85% 半透明微蓝深空灰（深色 `0xD9161D2B`）与晶白（浅色 `0xD9F3F6FC`），搭配 1dp `0x4DFFFFFF` 微发光双层反射高光描边与 22dp 大圆角，透光流动感十足。
  - **全员平级胶囊药丸**：彻底移除此前「识别屏幕」高饱和亮蓝的特权色彩割裂，所有快捷动作（识别屏幕、总结、提取、翻译、复制结果）全员统一为半透明磨砂胶囊（`0x26FFFFFF` 微透底 + `0x3DFFFFFF` 亮边高光），文字统一采用柔和亮白，视觉协调高级。
  - **凹槽内衬与发光按钮**：结果框升级为液态凹槽感内衬（`0x470C121D` 带 1dp 发光细线）；发送按钮升级为发光蓝宝石药丸（18dp 圆角带高光外圈）。
- **动态意图感知进度提示（inferProgressHint）**：
  - 彻底废除任何操作都硬编码「正在读取当前屏幕…」的刻板提示。
  - 新增意图感知推导器，针对发微信/聊天（`正在准备执行「...」…`）、滑动翻页（`正在规划手势操作「...」…`）、页面总结（`正在总结当前页面内容…`）、提取文字（`正在提取界面关键文本…`）、页面翻译（`正在翻译当前页面内容…`）及导航返回动态显示进度文案。
- **自动化测试与真机验收闭环**：
  - `tests/test_m1_overlay_source.py` 新增 5 项核心测试（含拖拽缩放真实重排回归），全量 33 项单测 100% 绿灯通过。
  - 在 Honor BKQ-AN10（Android 17）真机验证：发送后输入框即刻清空、右下角把手拖拽缩放平滑、快捷药丸视觉完全平级、动态提示文案精准回显。

### ⚡ 批次39 · 悬浮助手全能化与写操作解绑（真机验收）

- **根因修复：「当前应用上下文不可用，暂不能发送」彻底解绑**：
  - **根因分析**：旧 M1 逻辑硬性要求外部特定应用上下文（`!contextAvailable || contextPackage.isEmpty()`），在系统桌面、自身应用、无障碍短时断连或尚未捕获焦点时直接强行拦截发送，抛出「当前应用上下文不可用，暂不能发送」；且若 `submitInFlight` 状态残留，会导致后续发送被恒定判定为「任务：执行中，不能重复发送」。
  - **解绑与自愈重构**：
    1. 彻底移除 `submitCommand` 中的 `!contextAvailable` 硬阻断门槛，上下文仅作为可选目标提示。在无特定应用焦点（如系统桌面）时，自动降级为 `package="(全局/系统桌面)"`、`label="(无特定标签)"`，并交由 Agent 自主调用 `android_act` / `android_screen` 决策，真正实现全能助手随时随地接受用户指令。
    2. 增加客户端非运行态残留 `submitInFlight` 的自动检测与重置自愈，避免异常卡死在「不能重复发送」。
    3. 修复并保持系统 `enabled_accessibility_services`，恢复 3181 端口 `AccessibilityService` 本地 HTTP 服务。
  - **真机闭环**：Honor BKQ-AN10 重新打包安装验证，点击快捷操作即刻显示「任务：执行中，已提交」，彻底告别不可用拦截；单测新增 2 项断言全量通过（28 项）。
- **System Prompt 去只读枷锁**：彻底废弃「仅允许执行只读操作...禁止点击、输入、滚动」与「[M1 只读屏幕助手严格约束]」限制，重构为自主执行模式。赋予 Agent 自主感知屏幕、元素定位、点击、输入、滑动及导航等移动端全套操作能力。
- **UI 身份升级（从识屏工具演进为主控助手）**：
  - 卡片顶部 Title 由「小鲸鱼 · 识屏」升级为「小鲸鱼 · 助手」，长按展开/收起详情亦保持同步。
  - 输入框 Hint 由生硬的「输入只读命令…」升级为亲和且具动作暗示的「输入你想让我做的事（如：发微信、搜索、点赞）…」。
  - 默认结果展示区提示文案由「点下方「识别屏幕」直接读取当前屏幕。」升级为「点下方快捷键或输入任意指令，我来替你操作。」。
- **安全边界双保险**：执行规范明确将屏幕内容定性为不可信数据以防范提示词注入；常规翻页/点击/文本输入由 Agent 自主规划执行，高危操作（账户登出、清空数据、支付确认等）强制由安全审批门拦截确认。
- **自动化测试断言全量覆盖**：tests/test_m1_overlay_source.py 升级只读断言为全能操作断言，新增卡片身份及输入引导文案断言，26 项单元测试 100% 绿灯通过。
- **真机重打包与实机验收闭环**：通过全量 class 清单与 d8 重新生成 classes.dex，重打包签名后在 Honor BKQ-AN10（Android 17）真机验证：悬浮卡片标题更新为「小鲸鱼 · 助手」，输入框 Hint 正常显示，点击快捷操作能正常触发任务，点击主应用按钮秒级唤起并聚焦 MainActivity。

### 🚀 批次38 P1 · 悬浮助手体验补全与结果回流联动（真机验收）

- **布局高度封顶（防按钮挤出屏幕）**：彻底修复 `resultScroll` 与 `panelView` 采用 `WRAP_CONTENT` 在长文本下无限向下撑大卡片、导致底部快捷按钮与输入行被挤出屏幕（Frame 曾高达 2672px，超出屏幕底部 167px）的问题。为 `resultScroll` 设置上限 `160dp`（内容超出时内部平滑滚动），为 `panelView` 设置上限 `420dp`，保证无论输出多长文本，底部 5 枚快捷药丸、输入框与发送按钮均永久锚定且 100% 可见。
- **屏幕消息结构化提炼**：移除此前识别屏幕时未经处理就将 40 行原始无障碍节点堆入展示区的粗暴行为；改为提炼展示【当前应用】与【屏幕文字】关键项（用顿号紧凑分隔并过滤无意义字符与单字噪音，最多 12 个关键实体），等待模型时呈现清爽的「正在读取并分析屏幕内容…」优雅过渡。
- **throughSeq 根因修复**：更正 `OverlayAgentClient` 中 `session.page` 的 `throughSeq` 参数，改从 `session.list` 的 `projections.asOfSeq` 动态获取。真机证实此前传 `-1` 会被引擎切片成空数组导致 records 恒为 0 拿不到任何回复。
- **空转轮询快速终止**：会话已结束但连续 3 轮无任何输出记录时，立即以 `turn-ended-no-output` 报错并提示检查凭据与模型，彻底告别 180s 傻等。
- **主应用入口安家**：在卡片顶部 Header 右侧（折叠键旁）补回「打开主应用」按钮（`⤢`，32dp 触控区），点击直接唤起 `MainActivity` 并自动收起悬浮面板，兼顾轻量与深度功能入口。
- **结果一键复制到剪贴板**：快捷栏新增「复制结果」药丸 Chip，一键写入系统剪贴板（本地降级结果与 AI 结果均支持），并弹出 Toast 提示；同时支持长按结果区快速复制。
- **真机闭环验收**：在 Honor BKQ-AN10（Android 17）真机验证：点击「打开主应用」成功唤起并聚焦 `MainActivity`；点击「识别屏幕」产生读屏结果后，点击「复制结果」，成功在输入框粘贴回流结果；`test_m1_overlay_source.py` 新增断言全量通过（30 项）。

### 🛠 批次38 P0 · 只读悬浮助手可靠性与可观测（真机验证）

- **失败可判别**：`AgentException` 增加 stage/code，错误以 `[stage/code]` 前缀上报并落日志。真机实测 `agent task failed: [timeout/hard-timeout] 等待 Agent 结果超时（180s）`，不再只给一句中文。
- **超时分级**：软超时 25s 先提示「仍在处理，可继续等待或取消」，硬超时由 120s 放宽到 180s。
- **失败不空手（降级路径）**：识屏类命令提交前先本地读屏占位，AI 失败时补本地结果并明确标注「未经 AI 处理」，不把本地内容冒充成 AI 回答；全程不在主线程阻塞。
- **诊断可视化**：`Listener.onDiag` 把 session/running/已等待秒数/轮询轮次写入卡片详情。
- **证伪一处方案假设**：H1「客户端缓存旧 cookie」不成立 —— `rpc()` 每次请求都从 prefs 现读 `engine_cookie`；真机证据指向模型会话侧 180s 内不产生 assistant 文本。
- **构建**：新增 `.local/rebuild_dex.ps1`，每次全量重生成 class 清单。此前增量脚本沿用固定清单，导致 9 个新增内部类漏进 dex（代码写了、编译过了、行为不生效），`android-app/build.sh` 本身无此问题。

> 遗留（阻塞下一阶段）：引擎侧 180s 无 assistant 文本未根治，属 DSH 模型/会话排队；建议在 P1 入口改造前先定位，否则入口无内容可交付。

### 🎨 批次37 · 悬浮助手入口重做（MagicOS 风格，v1 真机验收）

- **一击即发**：快捷动作（识别屏幕/总结/提取/翻译）点击即提交，不再「填充输入框 + 再点发送」；长按改为「仅填充」，保留先编辑再发。
- **不再抢键盘**：展开卡片不再自动弹 IME（原最大摩擦点），软键盘只由「点输入框」触发；收起时强制隐藏。
- **结果就地可见**：结果在悬浮卡片内滚动展示（上限 600→4000 字符），新增流式回调 `OverlayAgentClient.Listener.onPartial`；收起后结果压成**迷你结果条**（点它回到卡片），不再一点窗外就丢。
- **有进展反馈**：运行中显示「AI 思考中 · 已 Ns」每秒心跳 + 取消按钮；状态点四态（就绪/运行中/完成/失败），完成/失败状态**粘住**不被引擎探测覆盖。
- **按钮瘦身**：快捷 chip 由 144×96dp 降到 32dp 高（pill），输入行 36dp，可点区 ≥40dp；常驻按钮从 9 枚降到 4 chips + 发送/取消；引擎/端口/AI 四行状态墙移入「长按卡片头」详情。
- **视觉**：44dp 圆角浮标 + 20dp 圆角卡片（320dp 宽，限屏宽-24dp）+ 品牌蓝 #4D6BFE，深浅色主题自适应（实测设备为深色模式），全部用运行时 `GradientDrawable`（aapt1 约束下不加新资源）。
- **回归**：`tests/test_m1_overlay_source.py` 新增/改写交互语义断言（一击即发、展开不弹 IME、收起留结果、心跳真会 tick）；69 项测试全通过。真机证据：单次点击后出现「取消」chip 且状态点转蓝，无「发送」介入。

> 主题：双运行时（runtime_mode）与熄屏挂机实证、启动链路减半、a11y 点击假成功堵洞与证据链抗噪重构、界面美化、工程清账与规范化；功耗基线与引擎怠速治理（5.58%→0.00%）、TaskSupervisor 后台任务闭环、提供方修复与第三方插件接入、点击/手势验证强证据化；官方权限管理预设体系与完全权限对齐复活、移动端审批门闭环与权限联动；虚拟屏后台代驾与透明路由、主屏物理焦点零抢屏实测。覆盖批次 12–29。

### ✨ 新增

- **M1 只读悬浮助手与当前屏直读（批次36）**：
  - **小鲸鱼命令入口**：悬浮面板新增当前外部应用、单行命令输入、发送/取消/收起和四个只读快捷动作；展开时临时获得输入焦点并弹起软键盘，收起后恢复非焦点悬浮窗。
  - **DSH Agent 会话桥**：新增 `OverlayAgentClient`，通过现有 `session.create/list/page/prompt/cancel` RPC 续接会话、提交只读任务、轮询本轮结果并支持取消；任务状态与结果摘要回显在面板内。
  - **当前屏与虚拟屏显式分流**：`android_screen` / `android_screen_refresh` 新增 `scope=auto|current`；`current` 在虚拟屏初始化前直接读取主屏 `displayId=0`，并通过 `exclude_self=1` 复用 `/context` 外部窗口选择、过滤 Harness 自身，失败返回 `NO_ACCESSIBILITY_READABLE_WINDOW`，不返回空树假成功。
  - **系统策略例外**：虚拟屏系统提示词保留普通后台任务默认走虚拟屏，同时明确 M1/`scope="current"` 必须读取真实主屏，避免系统级路由规则覆盖用户当前屏任务。
  - **悬浮上下文快照**：打开面板前缓存最近一次可读外部应用窗口根节点，面板抢占焦点后继续返回同一外部包，避免 IME/系统/悬浮窗事件把目标应用覆盖成不可读状态。
  - **DSH 0.1.5 RPC 线协议**：按 strict Typert 契约改用 `/api/session/<method>` 与 `{"args":{"request":...}}`（`list` 使用 `_request`）封装，修复悬浮提交的 HTTP 404 与参数校验失败。
  - **真机验收**：BKQ-AN10（Android 17 / SDK 37）安装升级成功；桌面、音乐、浏览器、Google Photos、日历 5 个普通应用均返回 `available=true` 且包名正确；取消路径返回“空闲（已取消）”。系统设置页被 Honor 以 `mIsForceHiddenNonSystemOverlayWindow=true` 策略隐藏非系统悬浮窗，属于 OEM fail-closed 限制。
  - **真机遗留**：Agent RPC 已完成协议握手并可提交、取消，但当前设备所选活动会话在 120s 内未返回结果（简单回复亦持续处理中），结果回流需在修复 DSH 模型/会话排队后复测。
  - **验证**：pytest 65 项、M1 当前屏 6 项、虚拟屏 8 组路由测试全过；Android 37 全量 javac 0 error（181 class）；完整 APK 构建成功，产物 `android-app/DeepSeekHarness.apk`（202,536,098 B，SHA-256 `C7FE0D51DFA0E127C9E5D74510D30A99D2ED968200BA823AB840E853C492DCEF`）。

- **虚拟屏语义读写与主动退出清理（批次34）**：
  - **虚拟屏 A11y 语义链路显式绑定 displayId**：`/dump`、`/input` 新增可选 `displayId`，App 侧经 `getWindowsOnAllDisplays()` 获取目标屏活动应用窗口根节点，不再依赖隐藏的“当前活动屏”行为；`android_screen` / `android_screen_refresh` 在虚拟屏模式下自动携带 displayId，缓存也按 display 隔离。
  - **虚拟屏输入不再依赖可见软键盘**：`android_type` 优先通过目标 display 的语义 `ACTION_SET_TEXT` / `ACTION_PASTE` 写入并回读，解决了系统 IME 留在主屏、虚拟屏无键盘时旧链路只能盲发 `KEYCODE_PASTE` 的问题；语义路径不可用时保留剪贴板 + `input -d <displayId> keyevent 279` 兼容回退，且最终结果必须由回读确认，不再固定返回 `verified:true`。
  - **主动退出回收 Node 引擎**：修复“退出只停前台保活、Node 成为孤儿进程”的生命周期缺口；确认退出时立即关闭看门狗闸门，`onDestroy` 停止保活服务、终止 node 并在超时后强制回收。看门狗在等待窗口和 `spawnNode` 入口均二次检查退出标记，堵住销毁期间复活的竞态。
  - **验证**：离线三大 Node 套件与 pytest 44 项通过；全量构建通过（BUILD OK，APK 193 MB）；Pixel 6 Pro 真机实测虚拟屏 `displayId=5` 下读到 Settings EditText，语义输入 `virtual-a11y-915` 回读一致；主动退出后 Node PID 已消失，重新启动可正常拉起；`tools/regression.sh` PASS=5 FAIL=0 SKIP=3。

- **Android 适配高危缺陷治理与真机闭环（批次33）**：
  - **WebView 文件下载（DownloadListener）完整接入**：在 `MainActivity` 中注册 `DownloadListener` 并实现后台下载线程与文件落地，捕获 WebUI 导出对话、下载代码与附件请求；支持 `http/https`（自动携带认证 Cookie）、`data:`（Base64/URL 本地解码）与 `blob:`（JS 提取）协议，安全写入公共 `/sdcard/Download/` 目录，并通过 `MediaScannerConnection` 刷新系统媒体库，彻底消除此前点击下载静默丢弃无响应的死角；
  - **dsh-native-command 原生路径放行修复**：修复 `canOpenNativePath` 中硬编码 `if (platform !== "linux") return false;` 的平台误判，放行 `platform === "android"`，确保在 bionic 降级运行时下“打开配置文件”原生弹窗亦能正常触发；
  - **特权通道（Shizuku/Root）动态自愈探测**：改造 `plugins/dsh-tool-shizuku`，特权工具 `shizuku_shell` 始终保留注册，并在执行期增加 `probePrivilegeLive()` 动态自愈探测；若 App 开机启动时 Shizuku/Root 尚未就绪而在运行中获得授权，无需杀掉重启 Node 引擎即可无缝接通特权执行通道；
  - **测试套件断言对齐与离线/真机全绿**：将 `tests/test_vscreen_router.mjs` 中的默认开启状态断言同步对齐批次 29 UI 策略；离线三大测试套件（`test_model_router`、`test_permission_gate`、`test_vscreen_router`）及 pytest 44 项全部通过；真机 Pixel 6 Pro 端到端回归（`regression.sh` PASS=5 0 FAIL、`test_device_vscreen_zero_stealing` 零抢屏实测 100% 通过、`test_model_router_device` 20 项全过、`device_test_permission_gate` 15 项全绿）。

- **mnemon 三层记忆控制平面与 CLI 随包接入（批次32）**：
  - 接入 `github.com/mnemon-dev/mnemon` 及官方 DSH 插件 `dsh-mnemon@0.5.8`（MIT 许可）；
  - **静态原生 CLI 内置**：将官方静态编译的 `mnemon_0.2.8_linux_arm64` 二进制持久化入 `compatibility/0.1.5-rc.1/overlay/bin/mnemon` 并随包打入 payload；MainActivity `setExecutables` 增加自动可执行权限赋予；
  - **依赖闭包物化**：物化 19 个核心与子包（含 9 个 provider、3 个 source、4 个 strategy）及传递依赖（`cosmokit`、`@standard-schema/spec`、`markdown-to-jsx`、`fflate`、`schemastery`、`zod`、`@deepseek-ai/dsh-client-ui-primitives` 等），全量 0 原生模块编译需求；
  - **组合配置注入**：在 `config/cordis.patch.yml` 与 overlay 副本注入 `connection` 注入补丁与 `mnemon-bundle` 分组（集成 Native Provider、本地 SQLite 存储、关闭外部 embedding、开启 Sidebar 与三层记忆）；
  - **工程与流水线健全**：更新 `build.sh` 双树物化与强校验、`compatibility.py` 白名单、`verify.py` 校验断言；

- **设置页打开配置文件与 Jet Hub 账号管理深度修复（批次32 修复项）**：
  - **打开配置文件原生链路打通**：
    1. 根因：`@deepseek-ai/dsh-native-command` 在 Android 运行环境下判定 `process.platform === "android"` 抛出未支持异常，或回退尝试调用不存在的 `xdg-open`，导致前端“打开配置文件”按钮报红字无响应；
    2. 修复：在 `dsh-native-command` 注入 Android 平台拦截，通过 3081 端口向 `MainActivity` 发送 `/open-file` 请求并带本地 token 鉴权；在 `MainActivity` 实现深色主题原生配置文件阅读器弹窗（等宽字体长按选中、自适应限高、复制全文、外部打开联动），真机点击瞬间弹出完整 `settings.yaml`。
- **dsh-agy 凭证导入与配额展示全链路修复（批次32 修复项二）**：
  - 根因链（三项叠加）：
    1. **导入解析器丢字段**：原版 `parseAndValidateAgyToken` 只认 `expiry`/`expires_at`（不认 Antigravity 导出文件的 `expired`），且完全不读 `email`/`project_id` 字段——导入成功但账号池里 email/projectId 全空，页面无法识别账号；
    2. **undici 权限链断裂**：dsh-agy 的 `proxy-DQPIwUov.mjs` 依赖 `undici`（EnvHttpProxyAgent/Socks5ProxyAgent），该包只在 dshroot 树存在、profiles/web 树缺失且手工 cp 后属主错误——web 路由注册即 `failed to import loader entry dsh-agy`，整个 /agy 仪表盘 400；
    3. **账号文件属主漂移**：root 调试期间写入 `agy-accounts.json` 后属主变 root，引擎（u0_a333）读文件 EACCES → /agy/api/accounts 500；
  - 修复：
    1. 导入解析器增加 JSON 字符串自动解析、`expired` 时间字段兼容、`email`/`project_id`（含驼峰变体）透传，`enrichWithAntigravityBackend` 改为文件自带值优先、best-effort 探测兜底；
    2. `undici` 纳入 overlay 随包物化（build.sh BARE_PKGS + compatibility.py 白名单 + verify），属主由 APK 解压保证；
    3. 账号文件属主修复（chown u0_a333 + chmod 600）；
  - 真机实证：导入 Antigravity 凭证后 /agy 页面显示账号（<email-redacted> · 当前使用 · 正常 · 项目 ID aicode-consumers），**模型配额池 27 个模型全部渲染**；token refresh（oauth2.googleapis.com 换发 200）与配额探测（fetchAvailableModels）全链路打通；

  - **dsh-codearts-auth Jet Hub 页面新建账号崩溃与鉴权根治**：
    1. 根因 A（最致命）：点击新建账号时，`login.js` 内部调用 `spawn("xdg-open", [url])` 调起华为云授权页面，Android 抛出异步 ENOENT 错误，未监听 `child.on("error")` 导致未捕获异常触发 Node 引擎崩溃死亡，进而引发前端网络断开报 `Failed to fetch`；
    2. 根因 B：核心网关 `dsh-client-connection` 对所有 `/api/*` 请求强制检查 Session Cookie，外部请求被 401 拦截；客户端未在 `inject` 中声明 `remote` 导致 Cordis Proxy 拦截抛出 `cannot get property "remote" without inject`；
    3. 修复：在 `login.js` 适配 Android `/system/bin/am start -a android.intent.action.VIEW -d <url>` 调起系统浏览器，并对所有子进程添加全局 error 监听彻底防止 Node 崩溃；网关层放行 loopback `/api/jet-hub` 请求；客户端补全 `inject: ["slots", "connection", "remote"]` 与安全防御访问；真机复验账号列表正常展示，点击新建账号 Node 稳定运行且系统浏览器顺利拉起。
  - **真机全链路实证（Android 17 / Pixel 6 Pro）**：
    1. CLI 端到端实测通过：静态二进制无需 glibc 包装，独立 `remember` 写入、`recall` hybrid 混合召回全闭环；
    2. 后端加载成功：DSH 引擎顺利启动，`dsh web` 监听 3080，`ctx.mnemonMemory` 服务就绪，零致命报错；
    3. 前端 WebUI 完美点亮：左侧边栏出现三层数据库记忆图标，点击成功展现“记忆系统（全局 · 已连接）”面板；设置页面成功注入“记忆系统”配置选项卡，三层记忆（运行时/档案/记忆空间）状态均正常开启。
- **runtime_mode 开关**：glibc ld.so 直跑 / bionic 双运行时可切换，glibc 连续 3 次启动失败自动降级 bionic 并 prefs 持久记忆（批次12m）。
- **预览悬浮窗（V3）**：屏幕预览悬浮窗接入（批次12w）。
- **诊断包**：一键导出运行时版本、prefs、最近日志等诊断信息，远程排障免复现（批次13d）。
- **/status 诊断计数器**：透出 clickEvents / windowEvents 计数，点击证据链可外部核实（批次19v2）。
- **TaskSupervisor（批次23）**：chroot 长命令后台作业升格为一等任务——App 侧 Task DB（`filesDir/tasks/tasks.json` 原子写、跨重启持久化）+ 3081 `/task/list|get|upsert|finish` 路由 + rc/done 终态捕获（exit code 精确落盘，自然退出自动上报 finish）+ stdout/stderr 拆分（out/err/ckpt 三指针，旧作业兼容回退）+ `android_task_list` / `android_task_resume` 新工具（一键重跑非续传的诚实承诺，可选 `DSH_TASK_CKPT` 自愿断点协议）。修复保活真洞：`/wakelock` 路由全仓无调用方、chroot 后台作业熄屏零保活——现 jobWakeLock 仅活跃任务期持有（KeepAlivePolicy 纯函数决策表 + TaskReaper 仅活跃任务期运行，空闲零持有；force-idle 深怠探针 10min 存活、击杀 60s 收养、清理后零锁实证）。
- **go-provider 第三方插件随包接入（批次23S3）**：`@jiesou/dsh-commandcode-go-provider@0.1.11`（纯 TS cordis 插件，零原生二进制，绕开 glibc/ABI 问题）随包烧录（overlay 三副本 + verify 双树校验 + build.sh 物化进 profile staging），Models 页 Command Code Go 卡片渲染实证。
- **Script-First 引导（批次24）**：android_see / android_screen / chroot_exec 工具描述加 Script-First 引导行（先看后动），并完成暴露面审视（三缺口备案）。
- **Dynamic Tool Registry MVP（批次24）**：系统提示词组装（system-prompt/assemble waterfall）期按前台应用动态过滤注入模型的工具 Schema（token 经济）——挂载 3181 前台包名快速轻量探针，非相关特化工具（如设置页屏蔽 SMS、通话记录）按白名单收敛；fail-open 兜底保证前台未知或异常时 100% 全量不过滤，关键看障/特权工具（android_see / screen / chroot 等）永远豁免；零常驻定时器与零唤醒。
- **模型路由调研与上游迁移预警（批次24/25）**：完成 `docs/模型路由调研-2026-09-14.md`（明确请求链路、提供方机制与移动端功耗约束，维持“先调研不动手”）；完成 `docs/上游0.1.5-final补丁迁移预研-2026-09-14.md`（实查 npm registry 0.1.5-rc.2 预览链，盘点 13 处关键补丁锚点，离线 43 项单测全绿，评定迁移难度为小时级）。
- **官方权限管理体系与完全权限对齐（批次26）**：
  - 解除 `cordis.patch.yml`（双副本）中对 `permission` 插件的禁用（0.1.1 历史遗留），恢复官方 DSH 预设体系与权限配置项；
  - 核心阻断根因与治理：官方 `dsh-permission-presets` 强依赖注入的 `ctx.shell` 暴露 `sandboxMode` 属性；而 Android 平台使用纯 JS subprocess 实现的 `dsh-bash-local` 原生未声明该属性，导致 permission 预设挂载失败抛错。在 `compatibility/0.1.5-rc.1/apply.py` 中为 `LocalBashExecutor` 补齐响应式 `sandboxMode` getter/setter（默认锁定 `'danger-full-access'`），双树（dshroot 必需 + profile 可选）三态幂等注入；
  - 预设配置精简与对齐：`cordis.patch.yml` 精简配置 `workspace-write`（sandbox: workspace-write, approval: ask）与 `danger-full-access`（sandbox: danger-full-access, approval: never），默认预设锁定 `danger-full-access`（完全权限），剔除无实际支撑的 `read-only` 预设；
  - 真机端到端实证（Pixel 6 Pro）：
    1. 设置弹窗成功恢复“权限”配置卡片（“选择新会话的默认权限模式：完全权限”）；
    2. 会话输入区成功恢复“访问模式，当前：完全权限”切换器；
    3. 全量构建门（`BUILD_CLEAN=1`，产物 191.7MB）+ 真机回归测试通过（`tools/regression.sh` PASS=5 FAIL=0 SKIP=3，冷启 602ms）。
- **高可用模型路由落地（批次27）**：
  - 新增纯 JS Cordis 插件 `@jiesou/dsh-model-router`（`plugins/dsh-model-router`，随包物化至 `dshhome` profile 与 `dshroot` 双树，保持 `@jiesou/` 命名空间规范）；
  - 核心功能：
    1. **TTFT 首字 8s 超时哨兵**：流式生成挂载首包时间守护器（默认 8s，环境变量 `DSH_ROUTER_TIMEOUT_MS` 可配），超过阈值无首字即刻中断主模型流并生成重试分片，保护移动端弱网与高拥堵体验；
    2. **透明故障转移**：在 `agent/request` 与 `agent/request-error` 生命周期拦截 429（限流/额度耗尽）、500（内部服务错误）及不可恢复网络异常，零感知平滑降级切换至备用模型（如 `commandcode-go-provider/deepseek-chat`）；
    3. **自适应熔断器**：连续失败计数达到阈值（默认 3 次，`DSH_CIRCUIT_BREAKER_THRESHOLD` 可配）进入 OPEN 熔断状态直接旁路，冷却期后 HALF-OPEN 探测恢复；
    4. **用户取消权威性保障**：严格识别 `signal.aborted`，用户主动停止生成时立即短路退出，严禁误触发降级与无谓重试；
    5. **移动端绿色功耗**：纯动作事件驱动，Timer 随流生命周期精确开启与即时清理，零常驻轮询、零唤醒、零待机功耗，双 runtime（glibc/bionic）100% 兼容；
  - 验证落地：
    - 离线 7 大核心场景单测全过；
    - 全量构建门（`BUILD_CLEAN=1`, `BUILD_SYNC_PLUGINS=1`，产物体积 191.7MB）一次通过；
    - 真机 Pixel 6 Pro（SDK 37）热加载热验证 20 项断言 100% 全绿；真机系统回归（`tools/regression.sh`）冷启 580ms，0 FAIL。
- **移动端审批门闭环与权限联动（批次28）**：
  - 将官方权限预设（`danger-full-access` 完全权限 vs `workspace-write` 工作区修改）与 Android 原生系统通知审批门（3081 `/confirm`）深度绑定闭环；
  - **完全权限免打扰全速放行**：在 `danger-full-access` 模式下，敏感特权写操作（`android_setting put`、`android_package install`、`shizuku_shell` 写命令等）彻底短路零弹窗直接放行，兼顾 AI 自动化全速执行体验；
  - **工作区修改模式高优先级通知审批**：在 `workspace-write` 模式下，敏感特权写操作自动向 Android 系统通知栏弹出带有允许/拒绝的高优先级系统通知卡片（`dsh_confirm` 渠道），用户点击允许即刻放行，点击拒绝精准拦截并抛出 `USER_REJECTED` 异常；
  - **安全超时与 Fail-closed 严格兜底**：通知等待超时未处理或审批服务不可达时，自动执行 fail-closed 策略拦截并抛出 `USER_REJECTED`，严格保障移动端设备安全；只读/安全操作（设置获取、应用启动、包列表、屏幕截图、只读 shell 等）白名单精准识别零弹窗放行；
  - **真机全链路实证（Pixel 6 Pro）**：
    - 离线 5 大场景底层联动单测（44 项断言）100% 通过；
    - 真机 Pixel 6 Pro 双树插件实测覆盖完全权限短路免打扰（3项）、通知卡片交互与拒绝/超时/允许拦截（3项）、只读白名单放行（9项），全部 15 项断言 100% 全绿；
    - 全量构建门（`BUILD_CLEAN=1`, `BUILD_SYNC_PLUGINS=1`，产物 183MB / 191.7MB）一次通过；
    - 真机系统回归（`tools/regression.sh` PASS=7 FAIL=0 SKIP=1，冷启 590ms）全线绿灯。
- **虚拟屏后台代驾：全局开关与透明路由（批次29）**：
  - **模式开关与自愈生命周期**：实现 `isVscreenModeEnabled(ctx)` 判定与开关（环境变量 `DSH_VSCREEN_MODE=1`、`dsh_prefs/vscreen_mode` 及插件配置 `vscreenMode: true` 灵活解析）；实现 `ensureVscreenCreated()` 首次动作静默建屏与异常自动自愈生命周期管理；
  - **通用自动化工具透明路由**：
    1. `android_app launch`：自动透明分流至 `/vscreen/launch` 虚拟屏独立任务栈，严格兼容官方 `resultSchema` 输出；
    2. `android_tap`：自动透明转为虚拟屏绝对/分数坐标触摸注入（`/vscreen/tap`），方法标记为 `vscreen-tap`；
    3. `android_swipe` / `android_type` / `android_input`：动作透明转为虚拟屏手势与输入注入，无缝兼容多种上游调用；
    4. `android_see` / `android_screenshot`：自动透明捕获虚拟屏独立画面（`/vscreen/see`），无感生成图像附件或落盘；
  - **主屏零抢屏保障（真机实证）**：
    - 主屏 Display 0 的物理焦点（`mCurrentFocus` / `mFocusedApp` / `NexusLauncherActivity`）绝对不受后台代驾任何干扰，彻底告别后台任务弹出抢夺物理前台的痛点；
    - 离线 7 组场景路由单测 100% 通过（`tests/test_vscreen_router.mjs`）；
    - 真机 Pixel 6 Pro 双树插件端到端实测（`scripts/test_device_vscreen_zero_stealing.mjs`）零抢屏核心断言 100% 全绿；
    - 全量构建门（`BUILD_CLEAN=1`, `BUILD_SYNC_PLUGINS=1`，产物体积 191.8MB）一次通过；
    - 真机回归全套（`tools/regression.sh` PASS=7 FAIL=0 SKIP=1，冷启 586ms）稳健闭环。
- **虚拟屏模式可视化开关与偏好联动（批次29 UI）**：App 右上角齿轮设置弹窗新增「后台虚拟屏模式」原生 Switch 开关卡片（主标题「后台虚拟屏模式」+ 副标题「自动化任务在独立副屏静默执行，不干扰主屏使用」），开关状态与 `vscreen_prefs`（键 `vscreen_mode`，默认开启）双向绑定，整行可点（点击卡片即翻转开关，落盘并回写 `dsh_prefs` 同名键以对齐插件侧判定），引擎拉起时通过环境变量 `DSH_VSCREEN_MODE`（开=1 / 关=0）同步注入，插件底层 `isVscreenModeEnabled()` 实时读取；真机核验：设置弹窗节点树命中该 Switch（`android.widget.Switch` + 文本「后台虚拟屏模式」，默认 checked=true），点按翻转 false 并落盘，重启回读一致。
- **修复「上传文件」按钮点击无反应（批次30）**：根因是 App **从未设置 `WebChromeClient`**——`android-app/src/` 全局搜索零结果，`MainActivity` 仅调用了 `setWebViewClient(...)`（管页面加载），而 Android WebView 规范要求网页 `<input type="file">` 的选文件请求必须由宿主 `WebChromeClient.onShowFileChooser()` 接管；未实现时该请求被**静默丢弃**（无异常、无日志），表现为按钮完全无响应。修复：新增 `WebChromeClient` 子类实现 `onShowFileChooser`（优先用官方 `FileChooserParams.createIntent()` 依 accept/mode 构造 Intent，异常时兜底 `ACTION_GET_CONTENT`；记录 `pendingFileChooser` 回调并以 `REQ_FILE_CHOOSER=401` 启动选择器），并在既有 `onActivityResult`（原用于工作区 SAF 授权）中并入结果回传分支——**无论成功/取消/失败都恰好调用一次 `onReceiveValue`（失败传 null）**，否则 WebView 会认为该次选择未结束、后续点击被永久阻塞。真机闭环验证：点击回形针 → **系统文件选择器（DocumentsUI PickActivity）成功弹出**（此前无任何反应）→ 选中文件 → 焦点正确回到 DSH 且回调已回传；`javac` 单文件编译 exit=0。未新增任何权限（targetSdk 28 下 `ACTION_GET_CONTENT` 由系统选择器进程持权，无需 `READ_EXTERNAL_STORAGE`）。
- **dsh-agy 接入（批次31，改造插件源码适配 DSH 0.1.5-rc.1）**：接入第三方插件 [chaos-03x/dsh-agy](https://github.com/chaos-03x/dsh-agy) v0.2.6（Google Antigravity OAuth 认证 + 模型接入，MIT，纯 JS 零原生二进制，npm 已发布且含 `lib/` 产物）。**批次30 曾因凭据契约冲突失败回滚**：原版用"追加写入"把主密钥以顶层键 `AGY_MASTER_KEY` 塞进 `.credentials.yaml`（其代码注释假定 DSH 会保留并忽略不认识的条目），而 DSH 0.1.5-rc.1 的 `dsh-credentials-local` 对未知顶层键**严格拒绝**（源码注释：`Everything is rejected rather than skipped`——静默忽略会被读成"我存的凭据没生效"），导致引擎启动抛错、进程死亡、App 自动重启再次触发，形成**无限崩溃循环**；唯一开关 `DSH_AGY_DISABLE=1` 会完全禁用插件，配置层无法绕过。**本批次改为直接改造插件源码**：① `loadMasterKey` 改为优先读插件自有文件 `<dshHome>/agy-master-key.json`（0600），并兼容读取旧 YAML 位置以平滑迁移；② `persistMasterKey` 不再写内核凭据文档，改为原子写入上述自有文件（附中文注释说明为何必须隔离）；③ 插件侧 `resolveCodec` 调整解析顺序为「自有文件 → 凭据服务 → 新建（落自有文件）」，**彻底删除"凭据服务写入失败则回退写 YAML"这条故障链**。命令行 CLI（`lib/cli`）因共用同一组函数而自动受益，无需改动。**真机端到端验证全绿**：`engineReady: true` 引擎正常启动、日志零错误并输出 `dsh web: http://...`；凭据文档 `AGY_MASTER_KEY` 计数为 **0**（彻底不再污染内核文件）；自有密钥文件按预期创建（0600、属主正确）；`dsh-agy`（inject=llm）与 `dsh-agy/web`（inject=llm,webServer）均注册成功。依赖链 `proper-lockfile@4.1.2` + `graceful-fs@4.2.11` + `signal-exit@3.0.7`（**必须 v3**，v4 移除默认导出会报 `onExit is not a function`）随包物化双树。**运维提醒**：`BUILD_CLEAN=1` 只重建本地 staging，设备端 payload 为增量解压——增删插件后需手动清理设备双树残留；且改设备上的文件务必用 `cp` 保持属主 `u0_a333:u0_a333`，用 `sed -i` 会因新建临时文件导致 `EACCES` 使引擎启动失败。
- **第三方插件 dsh-codearts-auth 随包接入（批次30）**：接入 [solilk115-arch/dsh-codearts-auth](https://github.com/solilk115-arch/dsh-codearts-auth) v0.1.0（MIT）——CodeArts（华为）+ CodeBuddy（国内/国际）认证与 LLM provider，含 Models 页 JetHub 配置 UI。**可行性三段实证**：① 纯 TypeScript、零原生依赖（仅 `jose` + `schemastery`，运行树已有 `jose`），树外 `pnpm build` + `pnpm build:client` 均 exit=0，编译产物 523KB/39 文件；② **接口兼容性**——上游编译期依赖 0.1.2-rc.1、本项目运行时 0.1.5-rc.1，逐包比对导出面：`dsh-credentials`（10 项）与 `dsh-commands`（5 项）**完全相同**，`dsh-llm` 47 项**全部保留** + 新增 15 项（纯增量无移除），插件实际使用的 5 个 API（`LlmError`/`CredentialRef`/`LlmAdapter`/`isQuotaExceededError`/`HarnessError`）全在；③ **真机加载**——设备 payload 双树上用官方 runtime node `ctx.plugin()` 注册成功（`DEVICE_REGISTER_OK`，inject = credentials/commands/llm/connection），客户端 bundle 格式校验通过（`window.__ModuleLoader__.load({id:"dsh-codearts-auth",...})`，依 `dsh-client-modules` 的运行时惰性加载机制，Models 页卡片无需重构建前端即会现出）。**工程改动**：物化进 `compatibility overlay/node_modules/dsh-codearts-auth/`（提交编译产物，沿用 `@jiesou` 范式）；`cordis.patch.yml` 四处副本加 `insert: {id: codearts-auth, name: 'dsh-codearts-auth'}`；`apply_profile_vendor_overlay` 增**裸包名白名单**（包名无 scope，无法被原 `@jiesou` 循环覆盖）；`build.sh` 增裸包名第三方插件的**双树随包物化 + 强校验**（profile 与 dshroot 各校验 `lib/index.js`，profile 另校验 `lib/client/jet-hub.js` 缺失即中止）；`verify.py` 增双树校验项。**顺带修复一处陈旧断言**：`verify.py` 仍在断言 `permission disabled: true`，而批次26 已将该服务改为启用+配置预设，该断言会让后续构建误报失败——改为断言「不得为 disabled」且「必须带 config 预设段」。
- **虚拟屏开关"点不动"修复：系统 Switch tint 在深色主题下不可见（批次29r2）**：用户复报「能打开右上角设置，但里面的开关根本不能点击选择」。逐像素复现后定位到真正根因——**不是点击失效，而是控件视觉上完全不可见**：代码虽已把系统 `Switch` 挂进卡片（上批 29r 修复），并在 `setThumbTintList`/`setTrackTintList` 上给了 `#4A9EFF`/`#B0BEC5`，但 `ColorStateList(states, colors)` 在深色主题 + 该 Switch 样式的叠加下，thumb/track 最终渲染成近乎全透明——真机截图放大后可见该位置**只有一枚极暗的「开启」字，滑块与轨道完全消失**；用户看得到文字却看不到控件，自然判定为「点不了」。修复：改为**自绘可见开关**（`FrameLayout` 内叠加 胶囊轨道 `GradientDrawable` + 圆形滑块 `View`，开=蓝底白钮「开」/关=灰底灰钮「关」），彻底摆脱系统主题 tint 的不确定性；触摸目标由 48×76 扩大到 56×30dp（`196×105` 物理像素），并补 `contentDescription`（「后台虚拟屏模式，已开启/已关闭」）供读屏识别。真机四路径回归全绿：真实手指点开关本体（false→true）、真实手指点卡片左侧空白整行（true→false）、无障碍 `/tap` 点卡片（false→true）、再点开关（true→false），均为**单次翻转无双重触发**；视觉证据：开启态蓝底白钮、关闭态灰底灰钮（纯胶囊轨道 + 圆形滑块，无文字），截图存 `.local/card_v2.png`/`card_off.png`；引擎侧不重启 App 即时读到新值（PID 15536 未变）。

### 🚀 性能与体验

- **熄屏挂机实测（V4）**：V4 熄屏挂机真机验证通过（批次12v）。
- **启动优化 14.5s→7.5s（约 -48%）**：引擎启动链路逐段计时、砍无效等待（批次13/14）。
- **F2 黑帧**：根因调查清楚并落地缓解，熄屏亮屏不再黑帧（批次14f）。
- **ToW spike**：takeScreenshotOfWindow 真机验证通过，为按窗口截屏铺路（批次14tow/15r）。
- **sharp 原生模块进包**：真 sharp 模块进包（方案 A，用户拍板），图片附件 EXIF 方向纠正 + >2048 长边缩放 + 重编码，四能力解锁、端到端验证通过（批次15a）。
- **功耗基线 + 引擎怠速治理 5.58%→0.00%（批次21/22 W-A/W-B）**：三场景 ×15min CPU 时间代理基线（先测后治）定位真凶 = node 引擎怠速自耗 5.58–5.78% 单核（超正常一个数量级，亮熄屏无差；App 侧含悬浮窗探测仅 0.88–0.96%）；线程级归因锁定 client-hmr 500ms×44 statSync/s 轮询与 skill-filesystem watchFile 两永续定时器，`DSH_ANDROID` 门停双树幂等补丁治理后熄屏闲置 node **5.58%→0.00% 归零**、亮屏 UI 在线 1.58%（≤1% 目标达成）。
- **悬浮窗探测自适应（批次22 W-C）**：OverlayService 探测循环状态机——灭屏暂停 / 亮屏恢复 / App 前台隐藏暂停，可见期 2s→10s 指数退避（不变步进×1.5），状态变化即回 2s；START_STICKY 灭屏拉起场景 isInteractive 校准初值。
- **点击验证 dump 经济（批次22 W-D）**：targetStateEffective 事件门控——无新事件 + 无脏标记 = 树不可能变化，跳过全树重定位遍历（迟到证据以事件形式到达即开门，不丢证据）；安静场景全树遍历 ≤7 次→1 次（省数十到数百次 binder IPC/次，兼收功耗与延迟），高噪场景行为不变。

### 🧱 工程与治理

- **工程清账 #8/#9**（批次15c）：dsh-tool-fs-search 的 Android ripgrep 解析块重写（env 最优先 + payload 根探测，探测失败如实拒绝，移除 @vscode/ripgrep 死兜底）等遗留账目清理。
- **界面美化**（批次16/17）：设置/退出改独立顶栏（根治 DSH 控件遮挡）、设置弹窗自绘卡片面板 + 顶栏单齿轮、蓝色大肥鱼品牌形象全端替换。
- **批次18 回归修复**：chroot job kill 返回体 undefined（lossless-JSON 拒绝）条件展开；vscreen key 数字键值转 KEYCODE 符号名（A17 input 按数字键解析致静默错键）；HOME 在虚拟屏无效果判明为平台行为，如实记录。
- **工程规范化（本批发版工程侧）**：删除 legacy-patch/ 与 android-app-fix/ 死代码目录；新增 GitHub Actions 轻量 CI（ruff + pytest + CLI 冒烟）与 compat-probe 上游兼容探针（apply.py 干跑）；fetch.py / apk.py 纯逻辑单元测试落地。
- **测试时长判据缩短（批次22 间 docs）**：长任务保活 / 熄屏挂机 30min→10min 趋势判据，deep doze 改 `dumpsys deviceidle force-idle` 秒级强制模拟；8h 拔线掉电实测取消（用户裁决），功耗验收指标 = CPU 时间代理（node 闲置 ≤1% 单核）。

### 🐛 修复

- **Shizuku 虚拟屏拉起修复（批次35）**：根因是 `VscreensManager` 将 `vscreen-server.jar` 的 classpath 指向 App 私有 `files` 目录，而 Shizuku 以 `shell(uid=2000)` 拉起 `app_process`，无法读取该目录，稳定失败为 `ClassNotFoundException: com.deepseek.harness.vscreen.Main`。现在内部 JAR 仅作为可信源，Shizuku 通道每次拉起前复制到 App 专属外部目录，再由 shell 加载；同步将 `android_app` 与 `android_vscreen_*` 设为动态工具注册表永久可见，并在开关开启时向系统提示词注入“应用启动必须走 android_app、不得用 shizuku_shell am/monkey 绕过、失败不得回退主屏”的强制策略。
- **a11y 点击假成功堵洞（批次19）**：校验对等——vid / 坐标双路径统一事件窗 + 签名链；gestureTapVerified 手势后验，注入无效时诚实失败（INJECT_NO_EFFECT），0 假成功。
- **点击证据链抗噪重构（批次19v2）**：任意事件证据在高噪 WebView 会被污染（外部复测 6/6 假成功实证），从 click 链移除；改认三类抗噪证据（VIEW_CLICKED 新声明 + 窗口级事件 + 目标节点定向状态复查 900ms）+ 静默点击 LRU 缓存命中手势先行。
- **提供方根因修复（批次23S3）**：本方 cordis.patch.yml 自 0.1.1 遗留的 llm-pi-ai disabled，导致 Models 页「添加自定义提供方」整链不渲染 + 服务端拒写——0.1.5-rc.1 依赖树确认纯 JS 后重启用（bare id 保 ensurePatchConfig 校验）；settings.yaml 移出升级覆盖清单，防用户自定义 provider 被升级抹除。
- **点击/手势验证强证据化（批次25 v3）**：手势后验 gestureTapVerified 原认「任意事件(1200ms)+签名」，高噪 WebView（流式对话）里真无效手势会被环境事件误判生效（批次22 W-A 结论）——现调用方有已定位目标时改认强证据三选一（TYPE_VIEW_CLICKED / 窗口级事件 / 派发前目标快照 + 定向状态复查），纯任意事件不再单独构成生效；判定窗保持 1200ms 总预算（强证据窗 400ms → 定向复查吃满剩余），DSH 页签往返 0.6~1.0s 迟到证据不回退，无目标（空白区）路径保持现状。误判方向由「假成功」转为「诚实失败」（INJECT_NO_EFFECT，模型可 android_see 复核后重试或特权通道 android_input 兜底）。

## v1.8.5-dsh0.1.5rc1（versionCode 27 · 开发中）

### ✨ 新增

- **系统分享接入**：任意 App 里「分享 → DeepSeek Harness」直接把内容发给 AI 处理（新建会话自动执行，完成后打开 App 即见结果）。支持文本（text/plain）与图片/文件（image/* 等，复制到私有 shared/ 目录后把路径交给 AI 查看）；引擎未就绪时自动等就绪再发，失败兜底复制到剪贴板。
- **runtime 切换「glibc ld.so 直跑」（零容器）**：payload 新增 `runtime-glibc/`（官方 Node.js 24 linux-arm64 + termux glibc-packages（gpkg）2.44 核心库 + musl 静态 rg/curl/busybox），经随包 `ld-linux --library-path` 启动官方 glibc node——不用 patchelf、不用 proot，运行期原生 syscall。此后上游新增 glibc 原生依赖不再需要逐个 bionic 移植。双 runtime 共存：glibc 连续 3 次启动失败自动降级 bionic（`runtime fallback` 日志 + prefs 持久），可清 `dsh_prefs/runtime_mode` 复位。
- **runtime 组装器**：`tools/runtime_glibc/fetch.py`（下载 sha256 锁定 + 缓存 + 16KB 页对齐检查 + DT_NEEDED 递归完备性检查）。

### 🔧 glibc 直跑真机适配（全部 Pixel 6 Pro / SDK 37 实证）

- wrapper `runtime/bin/node.glibc`：纯 mksh 内建 + 参数展开，**零外部命令**——app 域 seccomp 会 SIGSYS 杀掉 /system/bin/dirname 等外部命令；相对路径 `../../runtime-glibc`。
- **不导出 LD_PRELOAD=TEG**：glibc 库被 bionic 子进程继承后，bionic linker 解析其符号版本直接失败（`cannot find verneed/verdef for version index=32770 (_res)`），bash/glob/grep 全灭（A/B 实验实证）；TEG 的路径改写目标是不存在的 Termux 前缀，零收益。
- **libc.so.6 路径二进制补丁**：gpkg glibc 编译死 Termux 前缀的 resolv.conf/nsswitch.conf 路径 → 就地改写为 App 私有目录 `files/etc/{r,n}.conf`（≤原长，NUL 填充，幂等）；App 每次引擎启动刷新（DNS 源四级兜底：system resolv.conf → net.dns props → dumpsys connectivity → 公共 DNS 223.5.5.5/119.29.29.29）。
- **PATH 重排**：`/system/bin`（toybox）提到 `runtime-glibc/bin`（busybox 符号链接）之前——musl 静态 PIE（ET_DYN）自举形态被 app 域 seccomp 拦（SIGSYS 159），toybox 全套则 100% 可用；busybox 保留供 root 域。
- **注入 `DSH_RG_PATH=<payload>/runtime/bin/rg`**：glibc 模式下 `process.execPath` 是 ld.so（dirname 带偏），dsh-tool-fs-search 的 `resolveRgPath()` 找不到 rg → glob/grep 全灭；显式指定 musl 静态 rg 实测恢复。
- `setExecutables` 补 `runtime-glibc/lib/ld-linux-aarch64.so.1`（解压后无 exec 位会导致引擎起不来，root 域测试测不出）。

### 🐛 修复

- **internal-patch 升级覆盖语义**：`runtime*/`、`bin/` 前缀改为总是覆盖（版本锁定官方文件）——否则升级后旧 wrapper/旧二进制残留，新构建修复"从未生效"。
- env 注入（glibc 模式）：PATH 扩展、TMPDIR、HOME、DSH_RG_PATH；`privilege probe` 行追加 `RUNTIME=glibc|bionic` 便于外部核实。

### ⚠️ 已知边界

- busybox（musl 静态 PIE）在 app 域被 seccomp 杀（SIGSYS 159），仅 root 域可用；PATH 已由 toybox 顶替。
- Landlock/内核级沙箱全平台无解（Android sepolicy），沙箱约束靠 dsh 权限档位。

## v1.8.4-dsh0.1.5rc1（versionCode 26）

> 主题：本地桥接安全加固 + 审批门（默认关）+ 感知效率升级。全部改动经真机验证。

### ✨ 新增

- **本地桥接鉴权**：App 启动时生成随机 token（dsh_prefs/local_token），注入引擎 env `APP_LOCAL_TOKEN`；插件请求 3081/3181 时经 `X-DSH-Token` 头回传，服务端校验，不匹配一律 401。修复 Android 应用共享 loopback 导致第三方应用可直连 3081（伪造通知）/3181（免无障碍权限操控屏幕）的攻击面。token 为空时跳过校验保兼容。
- **审批门（默认关闭）**：装/卸/清应用、写 global|secure 设置、特权 shell 写命令（正则命中，只读命令不打扰）可经 /confirm 弹高优先级确认通知（允许/拒绝按钮），超时 60s 按拒绝处理（fail-closed）。**v1.8.5 起默认关闭**：env 注入改读 `dsh_prefs/confirm_gate`（默认 false），个人使用不受打扰，想开启待设置页开关（下版）。
- **AI 读取系统通知**：新增 NotificationListenerService（用户授予「通知读取权限」后）+ 3081 GET `/notifications` 路由 + `android_notifications` 工具——AI 能看到微信/邮件/验证码等最近通知（每应用保留最新，上限 50 条），本 App 自身通知不录入。
- **操作后自动附界面摘要**：android_tap / android_scroll 成功后自动刷新快照并在返回体附 `uiHint`（变化后界面可点击项 top10，含 fx/fy）——AI 大多数情况无需再显式读屏，每轮省一次感知调用。
- **android_screen_refresh 工具**：强制刷新读屏快照（绕过 10s 缓存）。

### 🚀 效率

- **读屏快照缓存**：/dump 结果缓存 10 秒，android_tap 按文字/描述点击优先用缓存本地解析中心坐标直点（method=snapshot-coords），未命中回退 App 端——「读屏→点→读屏→点」压缩为「读屏→点→点」。
- **android_screen 输出增强**：每个节点新增 fx/fy 分数坐标（免疫截图缩放误差）。

### 🛡️ 循环防护

- 动作签名检测：最近 8 次 tap/scroll 签名连续重复 ≥3 次时，返回体附 `warning` 引导 AI 换策略（改用 android_see 或刷新快照）。
- android_see 失败返回三级降级链（确认无障碍开关 → 改用 android_screen → fx/fy 试探）。

### 🔧 构建链路

- build.sh 新增**插件同步校验**：仓库 plugins/ 与 devhome profile 逐文件 sha256 对比，不一致中止并定位差异；`BUILD_SYNC_PLUGINS=1` 自动同步——杜绝"改了仓库插件忘 cp，白跑全量构建"。
- compatibility 补丁整体幂等化（`_replace_unless_present` / 区间替换结果已在即跳过），对已准备好的 devhome 重跑 no-op（真机 devhome 实测两次运行 0 文件变化）。

### 🐛 修复

- **审批门轮询 id 传递不一致**：插件把 id 放 POST body、App 端只读 URL query → 轮询永远返回 expired → 高危操作一律被拒。现双通道读取。**此 bug 存在于 1.8.4 首个真机包，必须升级**。
- /confirm 超时看护线程与用户点击竞争：resolve 仅覆盖 pending 状态，不会把用户已点的「允许」改回拒绝。

### ⚠️ 已知事项

- force-stop（从最近任务划掉）后部分 ROM 会重置无障碍开关与通知读取权限，需到系统设置重新开启（覆盖安装不受影响）。
- 本地 token 持久于 dsh_prefs；如需轮换，清除应用数据即可（下次启动自动重新生成）。

## v1.8.3-dsh0.1.5rc1（开发中 · versionCode 25）

### 修复
- **多任务列表彻底隐藏灵动助手**：AssistActivity 与 ProcessTextActivity 在 AndroidManifest.xml 补齐 excludeFromRecents="true"、noHistory="true"、autoRemoveFromRecents="true" 与独立 taskAffinity=""；同时在 AssistActivity.java 销毁时调用 finishAndRemoveTask()，确保从按键唤起助手后系统多任务流（Recents）0 痕迹，桌面上滑切换应用不再出现灵动助手卡片。
- **退回桌面残留长条胶囊（miniBar）修复**：旧时代用于给悬浮球显示结果的 miniBar 在非运行态下此前仍会执行 setVisibility(VISIBLE)，当从主应用退回桌面时伴随 rootView 恢复可见，导致 240dp×32dp 的任务结果长条死死常驻在屏幕正上方。现修复为非运行态 miniBar 强制保持 View.GONE，待机态悬浮窗尺寸严格回敛为 0 像素（touchableRegion 为空，alpha=0），彻底杜绝桌面残留。

- **android_touch_status 在有手指按住时报 schema 校验错**（Shizuku 测试机自检发现）：服务端 `/touch-status` 的 held[] 每项含 `elapsedMs`，而插件 heldSchema 声明 `additionalProperties:false` 未声明该字段 → `value.held[0].elapsedMs is not a declared property`。补上 `elapsedMs:{type:"number"}`。
- **android_app launch/force_stop 输出混入 ROM 噪声**（Shizuku 测试机自检发现，已在荣耀 BKQ-AN10 上复现）：部分 ROM 的 `monkey` 是 shell 包装脚本，会往 stdout 打印 `bash arg: -p`、`args: [...]`、`Network stats: enabled` 等调试行。`shizukuCmd`/`suCmd` 出口统一剥离此类噪声行，stdout 可直接解析。

## v1.8.2-dsh0.1.5rc1（versionCode 24）

### 修复
- **多任务列表彻底隐藏灵动助手**：AssistActivity 与 ProcessTextActivity 在 AndroidManifest.xml 补齐 excludeFromRecents="true"、noHistory="true"、autoRemoveFromRecents="true" 与独立 taskAffinity=""；同时在 AssistActivity.java 销毁时调用 finishAndRemoveTask()，确保从按键唤起助手后系统多任务流（Recents）0 痕迹，桌面上滑切换应用不再出现灵动助手卡片。
- **退回桌面残留长条胶囊（miniBar）修复**：旧时代用于给悬浮球显示结果的 miniBar 在非运行态下此前仍会执行 setVisibility(VISIBLE)，当从主应用退回桌面时伴随 rootView 恢复可见，导致 240dp×32dp 的任务结果长条死死常驻在屏幕正上方。现修复为非运行态 miniBar 强制保持 View.GONE，待机态悬浮窗尺寸严格回敛为 0 像素（touchableRegion 为空，alpha=0），彻底杜绝桌面残留。

- **read_image / android_see 附件落盘失败（EACCES open '/data/user/0'）**：dsh-attachment-local 的持久化保证会从 DSH_HOME 逐级向上 fsync 父目录直到文件系统根；DSH_HOME 位于 `/data/user/0/<pkg>/files/payload/…`，而 `/data/user/0` 权限为 `dr-x--x--x`（应用属 other，无读位），对其 `open(O_RDONLY|O_DIRECTORY)` 必然 EACCES → 整条附件写入链路失败。compatibility 补丁：`syncDirectory` 打开目录句柄遇 EACCES/EPERM 时跳过该层（数据本身已 sync，不可访问的祖先前缀由 OS 保证持久性）。
- **android_a11y_status / android_touch_status 只返回「操作成功。」无任何字段**：插件 `renderResult` 在 ok 时丢弃全部状态字段（3181 服务端 `/status`、`/touch-status` 字段齐全）。现透出 running/package/nodeCount/canScreenshot/apiLevel、screen/maxFingers/holdTimeoutMs/held。
- **悬浮窗长期显示「引擎在线 false」**：DSH 0.1.5 首页需 token 鉴权，无 token 探测得到 401；`OverlayService.engineAlive` 把 401 当离线（MainActivity.isDshEngine 已正确处理）。现移植同款判定：错误页含 "dsh web authentication required" 的可信 401 视为引擎在线。
- **payload 内 curl HTTPS 报 error 77（证书找不到）**：内置 curl 为 Termux 构建，CA 路径编译死为 Termux 的 cert.pem。payload 打包 Mozilla CA bundle（`runtime/etc/curl-ca-bundle.crt`，150 证书，源自 Git for Windows），启动时注入 `CURL_CA_BUNDLE` 指向它。

## v1.8.0-dsh0.1.5rc1（versionCode 22）

### 内核升级

- 锁定官方 DSH `0.1.5-rc.1`，对应 tag `dsh-v0.1.5-rc.1` 和 commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`。
- 增加版本化 Android 兼容层，替换缺少 Android arm64 预构建的 Node-API 组件。
- 保留 Shizuku、系统工具和无障碍工具插件，并调整 profile 插件解析路径。
- Android 禁用新的 permission preset 服务，避免无 Landlock 沙箱的 bash 执行器组合失败。
- 增加可重复执行的 payload 准备、验证和 APK 构建 CLI。

### 修复
- **多任务列表彻底隐藏灵动助手**：AssistActivity 与 ProcessTextActivity 在 AndroidManifest.xml 补齐 excludeFromRecents="true"、noHistory="true"、autoRemoveFromRecents="true" 与独立 taskAffinity=""；同时在 AssistActivity.java 销毁时调用 finishAndRemoveTask()，确保从按键唤起助手后系统多任务流（Recents）0 痕迹，桌面上滑切换应用不再出现灵动助手卡片。
- **退回桌面残留长条胶囊（miniBar）修复**：旧时代用于给悬浮球显示结果的 miniBar 在非运行态下此前仍会执行 setVisibility(VISIBLE)，当从主应用退回桌面时伴随 rootView 恢复可见，导致 240dp×32dp 的任务结果长条死死常驻在屏幕正上方。现修复为非运行态 miniBar 强制保持 View.GONE，待机态悬浮窗尺寸严格回敛为 0 像素（touchableRegion 为空，alpha=0），彻底杜绝桌面残留。

- 修复 APK 未打包 profile `node_modules` 的问题；此前 Node 启动时无法解析三个手机工具插件并反复退出。
- 修复 profile 整包依赖带入重复 DSH 内核、导致工作区选择后无法创建 Session 的问题；仅打包自定义插件并复用宿主 `dsh-tools`，覆盖升级时自动清理旧依赖。
- 适配 DSH `0.1.5-rc.1` 的浏览器启动令牌：原生壳捕获一次性 URL、交换会话 Cookie，并加载认证后的 WebView。
- 修复本地 HTTP 桥的 query 参数再次失效（回归）：路由分发前先剥掉了 `?query`，而各 handler 仍从 path 取参，导致 `/usage?days=N`、`/overlay?action=X` 等 GET 参数被静默丢弃（v1.7.5 曾修过一次）。现保留原始请求路径供 handler 取参，实测 `days` 与 `action` 均生效。
- 引擎启动时补打 `privilege probe: ROOT_AVAILABLE=… SHIZUKU_AVAILABLE=… channel=…` 日志：此前源码缺失该行，无法从外部判断 root/Shizuku 授权是否真正落到引擎进程。
- **write 工具新建文件报 link EACCES**（真机自检确认修复）：dsh-fs-local 的 createIfAbsent 分支用 `link()`（硬链接）发布新文件，Android SELinux 禁硬链接 → EACCES；改用 `copyFile(COPYFILE_EXCL)`，保留「目标已存在即失败」语义。
- **grep 工具报 ripgrep launch failed**（真机自检确认修复）：@vscode/ripgrep 无 Android 平台包（其 bin/ 为空，rgPath 指向不存在的文件，且 import 不抛错使 try/catch 兜底失效）；`DSH_ANDROID=1` 时优先使用与 node 同目录的 payload 内置 rg，再回退 `DSH_RG_PATH`。

### 风险

- DSH `0.1.5-rc.1` 的会话记录会迁移到 V3，升级前必须备份旧会话。
- 当前本地签名密钥与上游发布 APK 不一致，不能直接覆盖安装上游正式版。

## v1.7.5（正式版 + Lite 共存版 + 兼容版 · 2026-08-28）

> 内核 DSH 0.1.1-rc.2，versionCode 21，targetSdk 28。Termux 共存修复 + 无障碍手势引擎 + 工具输出校验修复。

### 🐛 修复
- **Termux 共存**：内置 node 在 Termux 环境编译，OPENSSLDIR 被编译死为 /data/data/com.termux/files/usr——装了 Termux 的设备启动即崩（EACCES），没装时靠 ENOENT 静默才碰巧正常。payload 内置最小 openssl.cnf，启动时注入 OPENSSL_CONF 指向它，有无 Termux 均稳定。
- **android_usage 报错/空结果**：appRequest 不解析 JSON（execute 返回字符串，被 DSH 工具运行时 schema 校验拒绝："value" must be an object）；已改为返回对象，并为 android_usage / android_overlay 补全输出 schema（days/apps/running/engineUp/granted/msg）；days 参数（GET query 丢失）与 android_overlay 的 action 参数一并修复。
- **无障碍手势引擎**：新增通用触摸原语（多指同时、按住保持、拖动、分数坐标 fx/fy、网格截图）；修复等待时序下手指数误抬起、手势中途出错的状态污染、同请求内 down 后 move 误判；网格截图 Immutable bitmap 崩溃修复。

### ✨ 新增（无障碍）
- android_swipe / android_hold / android_touch（状态式虚拟触摸屏，多指核心）/ android_gesture（多笔组合手势）/ android_touch_status（查询按住的手指）
- android_tap 支持 fx/fy 分数坐标（免疫截图缩放误差）；android_see 返回屏幕/截图尺寸与换算系数 + grid 网格叠加；android_screen 无节点界面（Unity/游戏）自动提示改用截图 + 分数坐标

## v1.7.0（正式版 + Lite + 兼容版 · 2026-08-27）

> 内核 DSH 0.1.1-rc.2，versionCode 17，targetSdk 28。新增**无障碍自动化（读屏 + 模拟操作）+ 屏幕理解（无障碍截图 + 视觉模型）**。

### ✨ 新功能
- **无障碍屏幕助手**：系统设置 → 无障碍开启「DeepSeek Harness 屏幕助手」后，AI 可读屏（android_screen）、点击（android_tap）、输入（android_type）、返回/主页（android_back/android_home）、滚动（android_scroll）、截图理解（android_see，无障碍截图 + attachments 发给视觉模型）
- 无障碍服务本地 HTTP 端口 = 通知端口 + 100（正式版 3181 / Lite 3183 / 兼容版 3185），三版本共存不冲突
- **启动失败诊断**：失败时多位置写 startup-diag.txt（外部目录/App 专属/Download），引擎日志镜像到外部 dsh-web.log（无需 root/adb 可读排查）

### 🐛 修复
- **工具名冲突导致引擎启动失败**：无障碍插件 android_input 与特权版（dsh-tool-android）android_input 重名，真机有 Shizuku/root 授权时引擎加载插件树报 duplicate → 无障碍输入改名 **android_type**
- **pwsh-sandbox 禁用不生效**：cordis.patch.yml 里条目 id 写的是 dsh-pwsh-sandbox，插件树实际 id 是 pwsh-sandbox → 禁用匹配不上、引擎启动 pending 崩溃 → 修正 id
- **表格窄屏被裁切无法横滑**：mobile.css 表格滚动类名哈希随前端构建变化失效 + 前端 md-table-wide 依赖 hover 显示滚动条（触屏无 hover）→ 改用稳定选择器 `[class*="tableScroll"]` 且移动端始终 `overflow-x: auto`
- **无障碍输入不进 WebView/网页输入框**：setText 只改无障碍节点、不触发前端 input 事件 → android_type 支持 `paste:true`（剪贴板粘贴，触发前端更新）

### 发布
- GitHub Release v1.7.0：正式版 / Lite / 兼容版 三 APK

## v1.6.5（正式版 + Lite + 兼容版 · 2026-08-25）

> 内核 DSH 0.1.1-rc.2，versionCode 16，targetSdk 28。三个版本可共存：正式版（com.deepseek.harness，3080）/ Lite（.beta，3082）/ **兼容版（.compat，3084，新）**。

### ✨ 新功能
- **AI 工作区（可选）**：权限页 SAF 选择外部共享存储文件夹（如 /sdcard/Documents）作为 AI 文件操作工作根目录，启动时经 `DSH_WORKSPACE` 环境变量传给引擎，bash 工具 cwd 自动切换；不限制工作区外访问权限
- **悬浮窗改 DSH 官方黑鲸鱼图标**（无背景）+ 展开面板显示引擎状态与 **AI 回复状态**（空闲/回复中，每 ~6 秒经 session.list 的 running 字段刷新）
- **内置 curl**：Android 系统无 curl，打包 termux NDK 原生构建的 curl 8.21.0 + libcurl/libnghttp2/3/libngtcp2/libssh2 依赖到 runtime，AI 可直接使用

### 🐛 修复
- **老安卓 WebView 兼容**：DSH 前端（Vite 6）需 Chromium 80+（module script + 可选链/nullish），Android 7/8 出厂 WebView（Chromium 51/59）白屏被误认“引擎启动失败”。正式版/Lite 启动检测 WebView 版本并提示引导；新增**兼容版 APK**（esbuild 打包 + polyfill 转译，老 WebView 可用）
- **版本比较 bug**：versionName 带后缀（1.6.5-test/lite/compat）时版本段解析失败变 0，导致误弹“发现新版本”，已改为提取数字前缀
- 悬浮窗会话状态解析（session.list 响应结构为 result.value.items，此前多解析一层）

### 发布
- GitHub Release v1.6.5：正式版 / Lite / 兼容版 三 APK

## v1.6.1（2026-08-24）

- Write 工具修复（dsh-tool-fs 写文件链路）

## v1.6.0（2026-08-24）

- 修复：history unavailable（attachment-local 缺 maxImageDimension → 默认 2000）、识图必挂（补 readImageRequest）、read_image EACCES（syncDirectory 容错）、grep/glob（内置 rg 15.2.0 + libpcre2）、android_usage/overlay（GET 读超时 + JSON.parse + schema）、Lite SHIZUKU_APP_ID
- 新功能：定时任务 Kun 式增强（repeat daily/interval + 结果通知）、应用使用时长（UsageStats /usage）、小鲸鱼悬浮窗（OverlayService）、android_overlay 工具

## v1.5.5（✅ 正式版：慢启动根因修复 · 2026-08-23）

> 纯修复版：功能基线同 v1.5.4（无端口冲突自动换端口，端口被占会启动失败属预期）。
> 内核 DSH 0.1.1-rc.2。真机验证（MT6835 / Android 15）：第二次冷启动 ~4s（正式版）/ ~4.6s（Lite，删除外部旧目录后完全内部存储），无超时。

### 已修复
- **慢启动根因（90s 超时）**：v1.5.1 引入的 `isDshEngine()` 健康检查只读首页**前 4096 字节**查找 `<title>DeepSeek Harness</title>`，但 DSH 首页实际约 14KB，`<title>` 位于**第 ~13.4KB 处**（13KB 内联引导脚本在前）→ 永远匹配不到 → `waitForServer` 干等 90s 超时（引擎其实 5s 就绪）。改为**读完整页面**（上限 256KB，本地读取 <50ms）；`ScheduleExecutor.engineReady()` 同步修复
- **排查排除项（有实测证据）**：payload 与 v1.4.0 逐字节一致；真机 cpuset 0-7 / top-app / ~2GHz 无资源限制；外部 FUSE 存储非主因（内部模式同样生效）

### 发布
- GitHub Release v1.5.5：`DeepSeekHarness-v1.5.5.apk`（正式版 com.deepseek.harness，versionCode 12）+ `DeepSeekHarness-Lite-v1.5.5.apk`（Lite 共存版 com.deepseek.harness.beta，端口 3082）

### 📌 说明
- 规划中的新功能（定时任务 Kun 式增强 / 应用使用时长 UsageStats / 小鲸鱼悬浮窗 / 插件适配加强）**代码已完成**（工作区 build/ 与 build-lite/），归入 **v1.6**

## v1.5.0（⚠️ 测试版本：功能增强 + 稳定性修复 · 2026-08-21）

> ⚠️ **本版本为测试版本（非正式版）**：新功能已实现且主要链路验证通过，
> 但**端口冲突处理存在已知 bug**（3080 被占用时引擎可能起不来，下版本修），
> 且定时任务等新功能仍需更多真机验证。发布目的是让用户提前体验，**不保证完全稳定**。

### 新功能
- **① 端口冲突处理**（⚠️ 有 bug，见下）：默认端口被占时自动换空闲端口（3081~3099）
- **② ABI 检测**：非 arm64 设备启动时提示（引擎仅支持 64 位）
- **③ 补丁启动自检**：`cordis.patch.yml` 缺失/被改坏时自动从 APK 恢复（防"没带禁用配置启动失败"）
- **④ 电池优化引导**：未设"不限制"时弹窗引导（防后台被杀）
- **⑤ 本地设置通道**：`android_setting_app` 工具——给「修改系统设置」权限即可改亮度/音量/超时等（免 Shizuku）；**音量走 AudioManager 真实生效**（修复 Settings.System 记录不生效的坑）
- **⑥ 定时任务**：`android_schedule` 工具——AlarmManager 系统闹钟 + 前台服务执行，到点**自动拉起引擎执行任务**（无需用户操作），结果可发通知
- **⑦ 剪贴板工具**：`android_clipboard`——AI 读写剪贴板（免权限）
- **⑧ 更新提示**：启动时查 GitHub 最新版，有新版弹窗引导下载

### 已修复
- **音量调节不生效**：`Settings.System.putInt("volume_music")` 只改记录不调音量 → 改走 `AudioManager.setStreamVolume` 真实生效；工具输出 schema 补 `stream/level/max` 字段（修复"写入成功但报输出无效"）
- **定时任务只发通知不执行**：BroadcastReceiver 里跑线程会被系统回收 → 改走**前台服务**执行；闹钟改 `setAlarmClock`（无需权限、Doze 也触发）；**DSH API 调用格式修正**（缺 `type/rpcId/method/payload` 包装 → 补全）；**sessionId 解析修正**（indexOf 偏移错误 → 精确匹配 `"sessionId":"`）
- **定时任务执行日志**：写到外部目录（`/sdcard/DeepSeekHarnessLite/scheduled-log.txt` / `DeepSeekHarness/scheduled-log.txt`），便于排查

### ⚠️ 已知问题（下版本修）
- **① 端口冲突处理有 bug**：3080 被占时换端口后引擎可能未在目标端口启动（WebView 显示占位服务内容）；连带 `ScheduleExecutor` 固定端口与主引擎换端口后不一致。**v1.5.1 修**

### 验证
- [x] 音量（AudioManager + schema）：真机通过
- [x] 定时任务（闹钟→前台服务→自动执行→结果通知）：真机通过（scheduled-log 确认"任务已发送给 AI"）
- [x] 剪贴板：真机通过
- [x] 编译：63 class + 2 插件无错误
- [ ] 端口冲突（已知 bug，待修）
- [ ] 补丁自检 / 电池优化引导 / ABI / 更新提示：逻辑简单，未逐一真机验证

---

## v1.4.0（可选特权降级 + 前台保活 + AI 通知 · 2026-08-20）

> **背景**：此前系统操作（装应用/改设置/模拟输入）全部依赖 Shizuku，
> 未授权时工具仍注册，AI 反复调用失败；且 root 设备无法利用 root 权限。
> 用户诉求：不授予 root/Shizuku 也能正常使用（文件读写/预览/编辑只需
> 「所有文件访问」权限），未授权时 AI 不要一直尝试调用特权工具；
> AI 干活时 App 挂后台不被杀；AI 能发通知（只需通知权限）。

### 功能
- **特权通道二选一**：MainActivity 启动时探测 `su -c id`（root）与 Shizuku
  授权状态，通过环境变量 `ROOT_AVAILABLE` / `SHIZUKU_AVAILABLE` 传给内核；
  插件执行时 **root(su) 优先，否则 Shizuku**（新增 `suCmd`，与 rish 同构）。
- **未授权不注册特权工具**（关键）：`dsh-tool-shizuku` / `dsh-tool-android`
  在两者都未授予时**不注册** `shizuku_shell` / `android_*` —— AI 工具列表里
  没有它们，自然不会反复尝试；只保留只读的 `shizuku_status` 供 AI 自查，
  其描述明确提示"文件读写请用 fs/bash 工具（只需所有文件访问权限）"。
  需要系统操作时 AI 会**引导用户授权**（弹 Shizuku 授权页），而非反复失败。
- **文件操作不依赖特权**：DSH 内核自带 `dsh-tool-fs`（read/write/edit）与
  bash 工具本就可用，授予「所有文件访问」即可编辑 /sdcard 文件，无需 Shizuku。
- **前台保活服务（EngineService.java）**：引擎启动时 `startForegroundService`
  拉起常驻通知服务（`foregroundServiceType="dataSync"`、START_STICKY），挂后台/
  锁屏引擎持续运行、AI 后台任务不被杀；用户主动「退出」时停止服务。
- **AI 发通知（android_notify 工具，仅需通知权限）**：MainActivity 起本地
  ServerSocket `127.0.0.1:3081`，收到 `{"title","text"}` JSON 即发系统通知；
  插件 `android_notify` **始终注册**（不依赖特权），端口由 `APP_NOTIFY_PORT`
  环境变量指定。真机验证：标题/正文正常显示。
- **权限引导页**：Shizuku 行改为「Shizuku / Root 特权（可选）」，文案说明
  不授权也能正常使用；root 探测在后台线程执行并缓存（避免主线程跑 su、
  避免 Magisk 弹窗反复触发），onResume 时重置重测。
- 版本号：versionCode 5 → **6**，versionName 1.3.3 → **1.4.0**

### 修复
- **多任务列表彻底隐藏灵动助手**：AssistActivity 与 ProcessTextActivity 在 AndroidManifest.xml 补齐 excludeFromRecents="true"、noHistory="true"、autoRemoveFromRecents="true" 与独立 taskAffinity=""；同时在 AssistActivity.java 销毁时调用 finishAndRemoveTask()，确保从按键唤起助手后系统多任务流（Recents）0 痕迹，桌面上滑切换应用不再出现灵动助手卡片。
- **退回桌面残留长条胶囊（miniBar）修复**：旧时代用于给悬浮球显示结果的 miniBar 在非运行态下此前仍会执行 setVisibility(VISIBLE)，当从主应用退回桌面时伴随 rootView 恢复可见，导致 240dp×32dp 的任务结果长条死死常驻在屏幕正上方。现修复为非运行态 miniBar 强制保持 View.GONE，待机态悬浮窗尺寸严格回敛为 0 像素（touchableRegion 为空，alpha=0），彻底杜绝桌面残留。的 bug
- **通知空消息**：`handleNotifyConnection` 用 `readLine()` 读到空行即停，但 HTTP
  正文在空行之后 → title/text 永远为空。改为解析 Content-Length 后精确读 body。
- **聊天记录互通（端口冲突）**：共存版与正式版抢 3080 端口，共存版引擎没起来时
  WebView 直连正式版引擎 → 显示正式版聊天记录。共存版改独立端口 3082/3083。

### DeepSeek Harness Lite（共存版，v1.4.0-lite）
- 给"不敢直接升级正式版"的用户试用：包名 `com.deepseek.harness.beta`（与正式版
  完全独立共存）、外部目录 `/sdcard/DeepSeekHarnessLite/`、独立端口 3082/3083、
  独立 dshhome（API Key 需单独填）。
- 真机验证通过：无 Shizuku 时 fs 工具建文件成功、聊天记录与正式版隔离、通知
  标题正文正常、需特权时引导授权。

### 验证
- [x] 构建通过（versionCode 6，dex 含 MainActivity/EngineService 102336 bytes）
- [x] 未授权场景：工具列表仅 shizuku_status（node 实测四种场景）
- [x] 引擎自测 HTTP 200（payload 实测）
- [x] 真机（Lite 版）：无 Shizuku 时 AI 成功创建 /sdcard/Download/test.txt
- [x] 真机（Lite 版）：通知标题/正文正常显示
- [x] 真机（Lite 版）：需特权操作时引导授权（弹 Shizuku 授权页）

---

## v1.3.3（修复：相册出现大量"零分零秒视频" · 2026-08-18）

> **背景**：外部运行目录 `/sdcard/DeepSeekHarness/dshroot` 含 2 万+ 文件
> （node_modules 的 .js/.ts/.d.ts 等），Android MediaStore 对未知类型文件做
> **内容嗅探**，把大量文本文件**误判为视频** → 相册出现"零分零秒"的假视频，
> 所有使用外部 dshroot 的用户都会遇到。

### 修复
- **多任务列表彻底隐藏灵动助手**：AssistActivity 与 ProcessTextActivity 在 AndroidManifest.xml 补齐 excludeFromRecents="true"、noHistory="true"、autoRemoveFromRecents="true" 与独立 taskAffinity=""；同时在 AssistActivity.java 销毁时调用 finishAndRemoveTask()，确保从按键唤起助手后系统多任务流（Recents）0 痕迹，桌面上滑切换应用不再出现灵动助手卡片。
- **退回桌面残留长条胶囊（miniBar）修复**：旧时代用于给悬浮球显示结果的 miniBar 在非运行态下此前仍会执行 setVisibility(VISIBLE)，当从主应用退回桌面时伴随 rootView 恢复可见，导致 240dp×32dp 的任务结果长条死死常驻在屏幕正上方。现修复为非运行态 miniBar 强制保持 View.GONE，待机态悬浮窗尺寸严格回敛为 0 像素（touchableRegion 为空，alpha=0），彻底杜绝桌面残留。
- **MainActivity 启动时自动创建 `/sdcard/DeepSeekHarness/.nomedia`**：
  MediaStore 忽略整个外部目录（含 dshroot），相册不再出现误判文件。
  幂等（已存在则跳过），外部目录可写时生效。
- 版本号：versionCode 4 → **5**，versionName 1.3.2 → **1.3.3**

### 用户侧修复（已装旧版的用户）
- 手动创建：文件管理器在 `/sdcard/DeepSeekHarness/` 下新建空文件 `.nomedia`；
  或直接升级 v1.3.3（自动创建）
- 相册里已出现的假视频可直接删除（都是 0 字节/损坏文本文件，无内容）；
  删除后若相册仍显示，重启相册或清除相册缓存

### 验证
- [ ] 构建通过（versionCode 5，dex 含 MainActivity）
- [ ] 引擎自测 HTTP 200
- [ ] .nomedia 创建逻辑进 dex（字符串验证）

---

## v1.3.2（修复：升级用户 UI 不更新 · 2026-08-18）

> **背景**：v1.3.0/v1.3.1 的侧栏改造与竖屏适配改的是**核心源码**
> （dsh-client-ui-layout / dsh-client-ui-cordis 的 client.js）。外部运行目录
> `/sdcard/DeepSeekHarness/dshroot` 采用"已有文件不覆盖"策略，而这两个
> client.js **不在强制覆盖白名单** → 从旧版升级的用户，外部目录保留旧文件，
> 页面仍是旧 UI（无三条杠侧栏、竖屏不适配）；只有干净安装/清数据重装的用户
> 才是新版 UI。真机反馈"下载 v1.3.x 页面还是旧版本"即此根因。

### 修复
- **多任务列表彻底隐藏灵动助手**：AssistActivity 与 ProcessTextActivity 在 AndroidManifest.xml 补齐 excludeFromRecents="true"、noHistory="true"、autoRemoveFromRecents="true" 与独立 taskAffinity=""；同时在 AssistActivity.java 销毁时调用 finishAndRemoveTask()，确保从按键唤起助手后系统多任务流（Recents）0 痕迹，桌面上滑切换应用不再出现灵动助手卡片。
- **退回桌面残留长条胶囊（miniBar）修复**：旧时代用于给悬浮球显示结果的 miniBar 在非运行态下此前仍会执行 setVisibility(VISIBLE)，当从主应用退回桌面时伴随 rootView 恢复可见，导致 240dp×32dp 的任务结果长条死死常驻在屏幕正上方。现修复为非运行态 miniBar 强制保持 View.GONE，待机态悬浮窗尺寸严格回敛为 0 像素（touchableRegion 为空，alpha=0），彻底杜绝桌面残留。
- **MainActivity.java `FORCE_OVERWRITE_PREFIXES` 增加 2 项**（升级时强制覆盖）：
  - `dsh-client-ui-layout/lib/client.js`（侧栏改造：三条杠/浮层侧栏/gridColumn）
  - `dsh-client-ui-cordis/lib/client.js`（插件按钮 header 单实例）
- 版本号：versionCode 3 → **4**，versionName 1.3.1 → **1.3.2**
- buildenv 重建（清数据被删）：从 /sdcard/github 归档恢复 + 工具 wrapper 重写 + devhome 软链 + v1.3.x UI 文件同步

### 用户侧修复（已装旧版的用户）
- 方式一：直接升级 v1.3.2 → 启动时自动强制覆盖这两个文件（REVISION 变化触发补齐）
- 方式二：删除 `/sdcard/DeepSeekHarness/dshroot` 重开 App（全量重新解压）

### 验证
- [x] dex 含 MainActivity ✅（94140 bytes，构建校验通过）
- [x] 引擎自测 HTTP 200 ✅（v1.3.2 payload 完整实测）
- [x] 白名单含 layout/cordis client.js ✅（dex 字符串验证）
- [x] payload 含 v1.3.x 新版 UI（gridColumn / toggleSidebar / header.utilities）✅

---

## v1.3.1（移动端 UI 打磨 + 插件按钮核心化 · 2026-08-17 深夜 ~ 08-18）

### 移动端布局打磨（mobile.css + mobile.js，运行目录同步生效）
- **消息操作条多行**：`.p-xYUq_actions`（复制/赞踩/分支/时间/耗时/token）`flex-wrap:wrap !important`
  （压过插件运行时注入的同名规则），窄屏不再一行溢出。
- **标题栏让位三条杠**：`.wSkVaW_header` 窄屏 `padding-left:52px`。
- **正文/输入框扩宽**：消息区 `.Md3f7G_scroll` padding 32→8px；composer
  `--dsh-composer-side-clearance/inset` 16/8→4px。
- **输入栏按钮重叠修复**：滚动容器 `scrollbar-gutter:auto`（有会话时滚动条不再占位压窄输入栏）；
  输入栏右侧按钮保持一行（nowrap）+ 模型名限宽 26vw + gap 6px。
- **Bash 工具卡片防横向溢出**：命令/输出 `white-space:pre-wrap` + `word-break:break-all`。
- **后台任务菜单防溢出**：`.QsffPG_menu` 窄屏 `right:0` 左展开 + 限宽。
- **设置页单栏适配**：`.VOzbGW_panel` 窄屏上下排列（导航横排可横向滚动 + 内容区
  `overflow-y:auto` 可滚动）。
- **键盘防自动聚焦**：mobile.js 用 pointerdown 位置判断 focus 来源——切换话题/新会话
  自动聚焦输入框时立即 blur（不弹键盘），只有用户点击输入框才弹。

### 插件按钮（真·改核心源码）
- **`dsh-client-ui-cordis/lib/client.js`**：CordisPanel 注册从 `sidebar.footer.action`
  改为 `conversation.session.header.utilities`（**单一实例**）：
  - 修掉双实例 bug（sidebar+header 各注册一份 → 两个独立 open 状态 → 面板开在一侧、
    点另一侧按钮关不掉）；
  - 面板本身 fixed 全屏（bottom:128px 左下），不依赖侧边栏展开。
- **位置**：mobile.css 把 header 里的 `[data-cordis-badge]` `position:fixed` 到三条杠
  下方（52px/8px，32×32，隐藏文字只留图标）；**不动 DOM**（按钮留在 #root 内，
  React 事件委托才有效）。
- 侧边栏里不再有插件按钮（注册已移走）。

### 其他
- **Session log 按钮禁用**：补丁加 `session-log-download: disabled`（右上角导出 ZIP 入口移除）。
- **补丁自动加载澄清**：`$DSH_HOME/cordis.patch.yml` 由 profile-boot homePatches 自动加载，
  App 启动**不需要 --patch**；加了反而 duplicate 崩溃（曾误改 MainActivity 又撤回）。
- **备份**：`/sdcard/github/backup-20260817-可运行版/`（mobile-patch + dshroot 关键文件 + 可用 APK）。

### 验证
- 最终 APK：dex 含 MainActivity ✅、payload 含核心注册 ✅、引擎自测 HTTP 200 ✅
- 真机验证：插件按钮开关面板正常、AI 生成插件审批后可关闭 ✅

---

## v1.3.0（闪退修复 + 侧栏改造真正落地 · 2026-08-17 深夜）

> ⚠️ **v1.2.0 的 APK 是坏的（安装即闪退）**：build.sh 里 javac 路径硬编码指向
> 已不存在的旧 Termux 目录（/data/data/com.coomi.android/...），javac 失败但被
> `|| true` 吞掉，dex 里没有 MainActivity，安装后启动报 ClassNotFoundException。

### 修复
- **多任务列表彻底隐藏灵动助手**：AssistActivity 与 ProcessTextActivity 在 AndroidManifest.xml 补齐 excludeFromRecents="true"、noHistory="true"、autoRemoveFromRecents="true" 与独立 taskAffinity=""；同时在 AssistActivity.java 销毁时调用 finishAndRemoveTask()，确保从按键唤起助手后系统多任务流（Recents）0 痕迹，桌面上滑切换应用不再出现灵动助手卡片。
- **退回桌面残留长条胶囊（miniBar）修复**：旧时代用于给悬浮球显示结果的 miniBar 在非运行态下此前仍会执行 setVisibility(VISIBLE)，当从主应用退回桌面时伴随 rootView 恢复可见，导致 240dp×32dp 的任务结果长条死死常驻在屏幕正上方。现修复为非运行态 miniBar 强制保持 View.GONE，待机态悬浮窗尺寸严格回敛为 0 像素（touchableRegion 为空，alpha=0），彻底杜绝桌面残留。内容
- **build.sh**：javac 路径改为从 DSH_DEV_HOME 推导 + 失败立即中止 + class 数非空校验
  + **dex 必须含 MainActivity 才放行**（防止再产出坏包）；构建环境 env.sh / d8 /
  apksigner 硬编码旧路径全部重写为新路径。
- **重新构建**：javac 49 个 class，dex 含 MainActivity（93KB），payload 引擎自测 HTTP 200。

### 侧栏改造（真·改核心文件，替代 v1.2.0 外部注入）
- **直接修改 `dsh-client-ui-layout/lib/client.js`（AppFrame 组件源码）**：
  - 窄屏（viewport<1024，竖屏+手机横屏）时 sidebar 列恒 0 宽 → 聊天区全宽；
  - 折叠时左上角渲染**三条杠按钮**（内联 SVG + 内联样式，点击 `actions.toggleSidebar()`）；
  - 展开时侧栏转 **fixed 浮层**（280px，z-30，阴影），不挤压聊天区；
  - 展开时渲染**全屏遮罩**（z-25），点击遮罩任意位置即收起侧栏；
  - 窄屏隐藏侧栏/详情拖拽把手；
  - **CenterColumn/DetailsColumn 显式指定 `gridColumn: 2/3`**——否则 sidebarCol 展开时
    转 fixed 脱离 grid 后，grid 自动放置会把聊天区排到第 1 列（0px）→ 聊天区消失、
    右边变成空白详情列（真机踩坑：展开侧栏后右侧纯色/内容靠左，靠这个修复）。
- **mobile-patch 清理**：删除 v1.2.0 的旧三条杠注入（mobile.js 第二个 IIFE + mobile.css
  相关段落），避免与 AppFrame 原生实现重复（双按钮/双实现冲突）；保留 v1.1.1 的
  软键盘适配与触摸优化。
- 类名事实纠正：`.pI_x6G_*`（layout）、`.hHd-Xa_*`（sidebar）、`data-sidebar-collapsed`
  都是**真实存在**的运行时插件 CSS module 类名（不在预构建 bundle 里，由
  ModuleLoader 动态注入），v1.2.0 的旧实现类名其实没写错，但改为原生实现更干净。
- 快速打包：payload.zip 仅 3 个小文件变化 → 用 `jar uf` 就地更新 APK 条目 +
  zipalign + 重签（约 2 分钟，跳过全量构建）。

### 验证
- 最终 APK：dex 含 MainActivity ✅、payload 含新 client.js ✅、引擎自测 HTTP 200 ✅
- 运行目录同步：外部 /sdcard/DeepSeekHarness/dshroot（App 立即生效，重启即可见）✅

---

## v1.2.0（竖屏 UI 改造 · 2026-08-17）

> 竖屏适配升级：**左侧竖栏（rail）改为左上角三条杠按钮**，聊天区全宽；
> 点三条杠等价于原 rail 顶部小鲸鱼按钮（展开/收起侧栏），功能不缺。

### 改动内容
- **mobile.css**：
  - 竖屏（portrait）下 AppFrame 侧栏列恒为 0 宽（`grid-template-columns: 0 minmax(0,1fr) 0 !important`），
    左侧 56px rail 整列隐藏，聊天区全宽；
  - 点三条杠展开侧栏时，侧栏以 **fixed 覆盖层**浮在聊天区上方（`position: fixed; z-index: 30;` + 阴影），
    **不挤压**聊天区；横屏不受影响；
  - 竖屏隐藏侧栏拖拽把手；
  - 新增 `.dsh-mobile-menu-btn`：左上角三条杠按钮，透明底、主题色线条（`--dsw-alias-label-secondary`），
    尺寸 36px（图标 22px，与小鲸鱼 24px 相当），按压时才出现柔和背景，风格与 App 主题一致。
- **mobile.js**：新增注入逻辑——
  - 竖屏 + rail 折叠（`data-sidebar-collapsed`）时显示三条杠按钮；
  - 点击 = 等价于点击原 rail 顶部小鲸鱼按钮（`.hHd-Xa_toggle.click()` → `toggleSidebar`）；
  - 展开侧栏后按钮自动隐藏（侧栏自带收起按钮），收起后恢复显示；
  - MutationObserver 监听 `data-sidebar-collapsed` 变化 + resize/orientationchange 刷新。

### 验证
- 新 APK（`android-app/DeepSeekHarness.apk`，109MB）构建成功并签名，包内 payload 已含 v2 mobile.css/js；
- 运行目录同步：`/sdcard/DeepSeekHarness/dshroot`、内部 `payload/dshroot`（立即生效，无需重装）。

---

## v1.1.1 稳定基线（原始记录）

> ⚠️ **说明**：本 PR 为**稳定基线**（对应实测可用的 v1.1.1），
> **UI 移动端适配属于半成品（WIP）**：侧边栏自动收起、设置页"点击跳转"等实验性
> UI 变换在部分设备上可能引入启动/渲染风险，故**不包含在本基线**（将以独立分支/后续版本提供）。
> 本基线优先保证：**启动稳定 + 基础移动端可用**。

> 本 PR 基于原作者 v0.1.0 源码，聚焦两类问题：
> **① 真机启动稳定性（node 运行时 + 服务器保活）② 基础移动端可用性（竖屏/触摸/退出）**
> 改动文件：`AndroidManifest.xml` / `build.sh` / `MainActivity.java` / `mobile-patch/*` / `README.md`

---

## 一、启动稳定性（修复真机 ERR_CONNECTION_REFUSED）

### 1.1 Node 运行时 soname 符号链接丢失（致命，已修复）
- **根因**：`build.sh` 用 `jar cMf` 打包 payload，**把符号链接全部压平成普通内容**；解压后
  `runtime/lib/` 只剩带版本号的文件（`libz.so.1.3.2` 等），`libz.so.1`、`libcrypto.so`、
  `libssl.so`、`libsqlite3.so.0` 全部缺失 → node 启动即报
  `CANNOT LINK EXECUTABLE: library "libz.so.1" not found`。
- **修复**：`build.sh` 在组装 payload 时**按 LINKS.txt 把 soname 目标复制成同名实体文件**
  （不依赖设备是否支持软链接，动态加载器按名字找文件即可）。经真机验证 node 正常启动。
  - 代价：payload 增大 ~34MB（版本化 .so 的实体副本）。

### 1.2 服务器保活：看门狗 + WebView 自动重试（新增）
- **根因**：原版 `webView.loadUrl()` 只执行一次；若 node 未就绪或进程被系统回收，页面永久停在
  `net::ERR_CONNECTION_REFUSED`，且没有任何恢复手段。
- **修复**（`MainActivity.java`）：
  - **WebView 失败重试**：主框架加载失败时每 2.5s 自动 `loadUrl(URL_HOME)`，直到服务器就绪（上限 120 次）。
  - **node 看门狗**：后台线程每 5s 检查 `healthOk()` + `nodeProcess.isAlive()`；node 死亡且服务不可用
    时自动重启引擎并刷新页面（20s 防抖避免风车重启）。

### 1.3 外部 dshroot 前端资源强制覆盖（保证 UI 资源随 APK 更新）
- **根因**：外部 `/sdcard/DeepSeekHarness/dshroot` 采用"已有文件永不覆盖"策略，
  旧版本的 `dist/mobile.css`/`mobile.js`/`index.html` 不会被新 APK 覆盖 → 移动端样式不生效。
- **修复**：将 `dsh-web-frontend/dist/mobile.css`、`mobile.js`、`index.html` 加入
  `FORCE_OVERWRITE_PREFIXES` 强制覆盖白名单，随 APK 更新。

---

## 二、基础移动端可用性

### 2.1 解锁竖屏（AndroidManifest.xml）
- `android:screenOrientation="sensorLandscape"` → `"unspecified"`（自由旋转）。
- 版本号升至 `versionCode=2 / versionName=1.1.0`。

### 2.2 mobile.css 重写（修复"死代码"）
- **根因**：原 mobile.css 使用的类名（`gdEzaW_`、`hHd-Xa_`、`pbvGtq_`、`qSYn7G_` 等）在
  真实前端构建（0.1.0-rc.6 dist）中**不存在**，全部规则无效。
- **修复**：改用从真实构建提取的类名（`_rail_1hk8w`、`_wrap_1ao1y`、`_answer_d4nqi`、
  `_markdown_1nba0`、`_block_10eou`、`_item_19372` 等）：触摸优化（点击目标 ≥44px）、
  竖屏内容全宽、鲸鱼蓝皮肤（`--dsw-alias-brand-primary: #4D6BFE`）。

### 2.3 mobile.js（稳定基线）：软键盘适配
- VisualViewport + translateY 方案，竖屏横屏通用，rAF 节流。
- 刻意**不包含**实验性 UI 变换（侧边栏自动收起、设置页点击跳转等），以保证各设备启动/渲染稳定。

### 2.4 退出交互（MainActivity.java）
- 右上角常驻「退出」浮动按钮（确认对话框后退出）。
- 系统返回键：有历史先 `goBack()`（可关侧边栏），无历史弹确认退出。

---

## 三、验证情况

| 项目 | 结果 |
|---|---|
| node 启动（soname 修复） | ✅ 真机验证 node 正常运行 |
| ERR_CONNECTION_REFUSED 恢复 | ✅ 看门狗 + 自动重试生效 |
| 竖屏自由旋转 | ✅ 已解锁 |
| 移动端样式注入生效 | ✅ 强制覆盖白名单保证更新 |
| 退出按钮 / 返回键 | ✅ |
| 依赖完整性 | ✅ payload 内 239 个依赖齐全（云端实测 dsh --version 可跑） |

## 四、构建与注意事项

- 构建：`bash android-app/build.sh`（需 android.jar、java-17、aapt/d8/zipalign/apksigner、release.jks）。
- 签名：本 PR 未包含签名密钥；安装包需自行签名。
- targetSdk 保持 28（≥29 会导致 node 二进制 EACCES）。
- 首次启动需解压 payload（2 万+ 文件，约 1-3 分钟），期间勿切后台。
- 外部存储权限未授予时回退内部 dshroot；授予后外部优先（已有文件不覆盖，白名单除外）。


### 修复
- **多任务列表彻底隐藏灵动助手**：AssistActivity 与 ProcessTextActivity 在 AndroidManifest.xml 补齐 excludeFromRecents="true"、noHistory="true"、autoRemoveFromRecents="true" 与独立 taskAffinity=""；同时在 AssistActivity.java 销毁时调用 finishAndRemoveTask()，确保从按键唤起助手后系统多任务流（Recents）0 痕迹，桌面上滑切换应用不再出现灵动助手卡片。
- **退回桌面残留长条胶囊（miniBar）修复**：旧时代用于给悬浮球显示结果的 miniBar 在非运行态下此前仍会执行 setVisibility(VISIBLE)，当从主应用退回桌面时伴随 rootView 恢复可见，导致 240dp×32dp 的任务结果长条死死常驻在屏幕正上方。现修复为非运行态 miniBar 强制保持 View.GONE，待机态悬浮窗尺寸严格回敛为 0 像素（touchableRegion 为空，alpha=0），彻底杜绝桌面残留。（批次51 实施，2026-09-16 当日）

- **P1 真根因纠正**：用户看的是「快捷服务」下的「应用」列表（非被厂商白名单挡住的「选择服务」），不再归因于 `com.hihonor.permission.CAN_RECEIVE_AI_KEY`。
- **根因**：本包声明了两个 `MAIN`/`LAUNCHER` Activity，使「按包唤起」退化为系统 Resolver（`HwResolverActivity`），导致用户选中后无法唤起；兼有桌面出现两个图标的回归。
- **F1**：`AssistActivity` 移除 `MAIN`+`LAUNCHER`（保留 `ACTION_ASSIST`）。实测：MAIN/LAUNCHER 2→1；`resolve-activity -p` 恢复正常；桌面图标 2→1；系统助手绑定不受影响。
- **F3**：新增静态快捷方式（`res/xml/shortcuts.xml` + meta-data），条目「灵动助手」；`dumpsys shortcut` 新增本包条目（修复前 0 条），也是绕开厂商白名单的保底入口。
- **F0（阻断性）**：`android-app/build.sh` 的 javac 源文件清单硬编码且遗漏 4 个清单组件，打出的 APK 一启动就因 `ClassNotFoundException: BootReceiver` 闪退；已改为 glob，已重建并真机验证不再崩溃。
- **遗留**：V10（真机手按 AI 键呼出）需用户重新选一次绑定后复测；P2 三段式液态玻璃动效未实施。


### 修复
- **多任务列表彻底隐藏灵动助手**：AssistActivity 与 ProcessTextActivity 在 AndroidManifest.xml 补齐 excludeFromRecents="true"、noHistory="true"、autoRemoveFromRecents="true" 与独立 taskAffinity=""；同时在 AssistActivity.java 销毁时调用 finishAndRemoveTask()，确保从按键唤起助手后系统多任务流（Recents）0 痕迹，桌面上滑切换应用不再出现灵动助手卡片。
- **退回桌面残留长条胶囊（miniBar）修复**：旧时代用于给悬浮球显示结果的 miniBar 在非运行态下此前仍会执行 setVisibility(VISIBLE)，当从主应用退回桌面时伴随 rootView 恢复可见，导致 240dp×32dp 的任务结果长条死死常驻在屏幕正上方。现修复为非运行态 miniBar 强制保持 View.GONE，待机态悬浮窗尺寸严格回敛为 0 像素（touchableRegion 为空，alpha=0），彻底杜绝桌面残留。：发送指令后助手整窗消失

- 根因：`submitCommand()` 在 `submitInFlight = true` 之前就调了 `setPanelVisible(false)`，使收起分支误判为“空闲”而把 rootView 置 GONE；且收起动画把 panelView 留在 alpha=0/scale≈0，任务完成只调 setPanelVisible(true) 不复位这些属性（可见但透明）。
- 修复：`submitInFlight` 提前置位；`setPanelVisible(true)` 统一复位 alpha/scale/translation 并取消遗留动画；App 前台时不强行显示悬浮窗。
- 验证：真机复现旧 APK “发送后 211s 不回来”，修复后 +8s 自动重新展开；pytest 138 passed, 1 skipped。

### 收尾（自动化 journal，2026-09-16 23:5x）
- **落盘**：补齐当日 journal（放入本轮自动化记录并与并发会话的修复记录对齐）、刷新 `docs/STATE.md` 手写区（场景/命令/状态/已知坑）与 AUTO 区块、`docs/PLAN-INDEX.md` 批次51 状态更新。
- **独立复核**：以当前源码 `python .local/b47_build.py all` 重建 + 真机重装，端到端复测「发送后面板自动回归」成立（暗像素 0.038 → 0.681）；`python -m pytest tests/ -q` → **139 passed**。
- **未实施**：批次51 P2 三段式液态玻璃「流挂」动效；V10 需用户重绑后手按 AI 键复测。
## [未发布 - 批次56] - 2026-09-17：任务完成自动展开 + 原生灵动胶囊独占运行信息 + 呼出收起全链路液态流动向灵动胶囊修复

### 修复
- **任务执行完收起窗口时向屏幕右侧滑动消失Bug（真 Bug）**：
  - **现象与终极根因**：真机取证证实，点击发送或收起时，卡片右边缘死死贴在屏幕最右物理边缘（x=1255px），左边缘向右缩，导致整张卡片呈现强烈的向右偏向滑移。终极根因是浮窗 WindowManager 参数采用了 WRAP_CONTENT 导致窗口几何包裹在卡片右侧，非全屏对称布局，使横向缩放变成右贴边单向形变。
  - **修复措施**：
    1. 窗口布局宽度升级为 MATCH_PARENT（全宽居中），子视图 panelView 采用 center_horizontal 严格物理对称居中；
    2. 移除 headerView 上绑定的 dragTouch 触控，废弃误触向右磁吸的 snapToEdge 逻辑；
    3. 打造液态灵动流行动效：呼出与收起全链路以顶部居中灵动胶囊/挖孔为起点与归宿（scaleX: 1f <-> 0.28f, scaleY: 1f <-> 0.08f, translationY: 0 <-> -36dp, PathInterpolator 贝塞尔曲线），实现从胶囊流挂下垂呼出、平滑流动汇聚缩回胶囊的纯正液态质感。

### 新增 / 体验优化
- **任务完成自动展开大卡片（告别繁琐二次点击）**：
  - 新增 autoExpandAfterTask()：任务成功、失败或急停后，不再停留在胶囊并要求用户点「查看 ⤢」，而是直接平滑自动展开大结果面板；
  - 前后台自适应：仅当 App 退到后台/桌面且悬浮窗可见时自动展开，若主应用自身在前台则智能避让不展开；展开后先置非聚焦窗口，不打扰用户正在进行的输入。
- **原生灵动胶囊独占运行态（消除上下双胶囊打架）**：
  - 新增 PromotedProgressNotifier.isRunInfoOnSystemCapsule(Context)：当 Android 16 Live Updates 系统胶囊可用（SDK>=36、开关开启、已授权）时返回 true；
  - OverlayService 中的自绘顶部胶囊在系统胶囊承载运行信息时自动静默隐藏，执行进度、步骤号和耗时统一由系统状态栏原生灵动胶囊独占呈现；OEM 未授权或低版本时自绘胶囊自动兜底；
  - 原生实况窗新增 4 参 update(..., elapsedSecs)，胶囊右侧显示如「步骤2 · 45s」，并新增 240s 心跳续期防 5 分钟超时缩圆点。

### 验证
- 单元测试：python -m pytest tests/ -q -> 206 passed（含新增 test_batch56_live_update_carrier.py 21 条契约测试）。
- 真机端到端验证：Honor BKQ-AN10（Android 17 / MagicOS 11）上验证发指令 1+1：1. 运行期间状态栏仅显示一个原生实况窗灵动胶囊（自绘胶囊已完全静默，无双胶囊）；2. 任务完成后 0 秒内面板自动平滑展开，免去点击；3. 点击 ⌄ 或外部空白收起，卡片纯垂直平滑收回消失，彻底消除了向右滑走的偏向动效。
## [未发布 - 批次64] - 2026-09-17：全面放宽虚拟屏默认机制（非只读操作全面允许虚拟屏 + 执行后自动强杀应用与回收）

### 策略重构
- **全面放宽虚拟屏准入机制（让长任务与操作类 App 彻底摆脱误拦）**：
  - **背景**：此前系统采用「白名单严格过滤」判定是否开虚拟屏，导致用户输入「打开微博领红包」等日常指令时被误判为单点操作，模型在主屏强行切前台且易违背规范停止；
  - **机制重构**：现在已有前台预览小窗显隐开关（🙈/👁），默认前台静默不弹窗。因此彻底放宽判定：**只有明确的「识别屏幕/提取文字/翻译/总结/选区问答」等只读理解类指令坚决留在主屏直读；其余所有涉及打开 App、操作 App、长任务、点击/输入等操作，一律默认允许并在虚拟屏中执行**；
  - **收尾生命周期升级**：任务执行完毕或取消后，`maybeCleanupVscreen()` 统一触发 `VscreensManager.shutdown()`，彻底销毁虚拟屏、释放系统 Wakelock 并关停预览小窗，确保前后台零残留。

## [未发布 - 批次63] - 2026-09-17：长任务执行稳定性增强（动作级多步意图晋升虚拟屏 + 引擎长轮询超时拓宽）

### 缺陷修复与体验增强
- **长任务直接开软件执行且超时失败根因定位与修复**：
  - **虚拟屏漏判定根因**：原判定仅匹配显式词汇（如「跨应用/批量/挂机」）；用户输入「打开抖音查看第五个视频的信息之后关闭」时，包含「打开 + 多步骤之后/然后/关闭」复合长动作，却因未写「后台/跨应用」被当做单点前台任务，模型直接在主屏拉起抖音并循环滑动执行；
  - **超时根因**：`OverlayAgentClient` 单次 RPC 读取超时设为 5000ms（5秒）。抖音等重载 App 在前台多步滑动取帧期间，引擎事件密集排队，轮询请求等待超过 5s 即被端侧误判为 `[net/connect-timeout] 引擎请求超时` 并异常中断任务；
  - **动作级长任务智能晋升**：`OverlayService.shouldUseVscreen()` 新增语义判定，当指令包含「打开/启动/进入」并伴随「之后/然后/再/并」等跨步长动作时，**自动晋升为需要虚拟屏的后台隔离任务**，无需用户刻意输入特定关键词；
  - **轮询超时拓宽与抗抖动**：将 `OverlayAgentClient` 的连接超时拓宽至 6000ms，单次读取超时拓宽至 15000ms（15秒），彻底杜绝因引擎重载处理密集事件导致的误报超时中断；
  - **全量测试通过**：`pytest tests/test_batch60_prompt_and_selection.py` 26 项全量通过（包含新增长任务晋升断言），重打包覆盖安装真机。

## [未发布 - 批次62] - 2026-09-17：虚拟屏实时预览小窗「显隐切换」功能落地（静默/可视自由控制）

### 新增功能
- **虚拟屏预览小窗显隐开关（自由切换静默模式与可视化巡检）**：
  - **核心设计**：虚拟屏（VirtualDisplay）作为后台自动化隔离通路保持全速运行；前台的悬浮预览小窗（`VscreensPreviewService`）由用户自主控制显隐，彻底解决「有些时候不想看到黑窗/过程，有些时候又需要确认画面」的诉求。
  - **默认静默（极简无扰）**：`vscreen_preview_enabled` 全局偏好默认设为 `false`，后台任务建立虚拟屏时**默认静默不弹窗**，零侵占屏幕；
  - **顶栏一键切换**：小鲸鱼助手大面板顶栏右侧新增快捷切换按钮（🙈 隐藏状态 / 👁 显示状态）；
    - 点击切换为 👁 时：若当前有活跃虚拟屏会话，实时弹出预览小窗；若当前无任务，提示「已开启预览，下次自动化时将自动呈现」；
    - 点击切换为 🙈 时：立即关闭并移除当前悬浮小窗，停止后台轮询省电，但后台虚拟屏自动化丝毫不受打扰；
  - **持久化状态同步**：开关状态持久化至 `dsh_prefs`，下次呼出面板自动同步图标与状态。

## [未发布 - 批次61] - 2026-09-17：修复划选提取文字弹出黑色虚拟屏（端侧硬闸门 + 插件只读降级主屏）

### 缺陷修复
- **划选文字后提取弹出黑色虚拟屏 bug**：
  - **根因分析**：批次60B 在 Prompt 中注入「本轮判定属于不需要虚拟屏类别，禁止切换虚拟屏」仅为软约束；当划选选区落入纯图像/无直接无障碍节点时，端侧转交 Agent 执行「提取此选区画面中的文字」。引擎侧 Agent 仍会调用 android_see 或未显式传 scope 的 android_screen，而插件侧 isVscreenModeEnabled() 仅读偏好开关（默认 true），透明自愈触发 ensureVscreenCreated 向 App 发起 /vscreen/create，导致 VscreensManager 拉起后台虚拟屏并启动 VscreensPreviewService 黑色预览小窗。
  - **App 端侧硬闸门**：
    - OverlayService 新增 vscreenNeededThisTask 状态与 isReadOnlyTaskInFlight() 静态查询方法，在 applyVscreenPolicy() 中固化本轮是否为只读/理解任务（识别/提取/翻译/总结/划选问答）；
    - VscreensManager.handleCreate() 在选道与拉起服务端前检查 OverlayService.isReadOnlyTaskInFlight()，只读任务进行中直接返回 ok:false, reason:READONLY_TASK 拒绝建屏，坚决不亮预览窗；
    - 任务收尾 maybeCleanupVscreen() 统一重置 vscreenNeededThisTask=false。
  - **插件侧只读降级主屏**：
    - dsh-tool-accessibility：android_screen 与 android_screen_refresh 在 ensureVscreenCreated() 失败（如收到 READONLY_TASK）时不再返回错误，而是降级复用主屏读取路径（displayId=0, exclude_self=1 的 /dump）；android_see 建屏被拒时平滑回落到原生主屏截图分支（a11yRequest('/screenshot')），成功返回附带降级提示 hint；
    - dsh-tool-android：android_screenshot 在建屏被拒时降级到原生私有 screencap 主屏截图路径，不再抛建屏失败；
    - 安全策略：写操作（android_tap / android_type / android_swipe / android_input）坚决不静默降级主屏，避免在用户前台真实屏幕乱点。
  - **打包与同步**：
    - 同步更新 android-app/staging/ 与 android-app/assets/payload.zip 中的两插件代码，通过 b47_build.py all 完成增量重打包签名与真机部署覆盖。
  - **验证**：
    - 离线单元测试：node tests/test_batch61_readonly_fallback.mjs（7/7 通过，含反证）、test_vscreen_router.mjs（8/8 通过）、test_m1_current_scope.mjs（6/6 通过）；
    - Python 镜像契约测试：pytest tests/test_batch60_prompt_and_selection.py（26/26 通过）；
  - 真机实测（SN-HONOR-XXXX）：划选屏幕文字 → 点气泡『提取文字』全流程执行，ps -A 中 vscreen 进程数保持为 0，SurfaceFlinger 虚拟显示数保持为 0，小鲸鱼助手面板完整输出结果，黑色虚拟屏小窗彻底不再弹出。
  - 链路打通：修复 resolveEffectiveCommand 零调用点问题，向 Agent 提交任务时真实注入选区像素范围与选区文字，避免选区提示失效。
