# config/ —— DSH 组合配置（cordis.patch.yml）

`cordis.patch.yml` 是 DSH 的**组合配置补丁**（cordis patch），也是本项目的 **Android 兼容核心**——它决定了 App 里哪些模块启用/禁用、插入哪些自定义插件。

## 自动加载（重要）

- 文件位于运行目录的 `$DSH_HOME/cordis.patch.yml`（App 内为 `files/payload/dshhome/cordis.patch.yml`），由 DSH profile-boot 的 **homePatches 自动加载**
- **绝不要在 node 启动命令上加 `--patch` 指向它**：同一补丁被应用两次会 **duplicate loader entry 崩溃**（已实测）

## 内容逐项说明

```yaml
# 1) 禁用无法编译原生模块的插件（Android 上装不了它们的原生依赖）
- id: llm-pi-ai        # Pi-AI 模型适配器
  disabled: true
- id: sandbox          # 沙箱（依赖原生模块）
  disabled: true
- id: bash-sandbox     # 沙箱版 bash
  disabled: true

# 2) 权限预设：让工具按预设分配 sandbox/approval 策略
- id: permission
  config:
    presets:
      read-only:        { sandbox: read-only,        approval: ask }
      workspace-write:  { sandbox: workspace-write,  approval: ask }
      danger-full-access: { sandbox: danger-full-access, approval: never }
    defaultPreset: danger-full-access

# 3) 插入自定义模块（本项目的手机端特色）
- insert:
    - id: bash-local        # 替代 bash-sandbox 提供 ctx.shell（仅依赖 subprocess）
      name: '@deepseek-ai/dsh-bash-local'
      config: { cwd: !!js process.cwd(), timeoutMs: 60000 }
    - id: tool-shizuku      # 特权 shell 插件（见 plugins/）
      name: '@deepseek-ai/dsh-tool-shizuku'
    - id: tool-android      # 结构化系统操作插件（见 plugins/）
      name: '@deepseek-ai/dsh-tool-android'
```

另有运行目录实际生效的补丁追加项（`session-log-download: disabled`，禁用右上角导出 ZIP 入口，见 CHANGES.md v1.3.1）。

## 修改与生效

| 改哪里 | 怎么生效 |
|---|---|
| 运行目录 `files/payload/dshhome/cordis.patch.yml` | 重启引擎（彻底杀 App 重开）即生效，用于调试 |
| 源码 `config/cordis.patch.yml` | 改后重新打包 APK（build.sh 会复制进 payload） |
| `profiles/web/cordis.patch.yml` | web profile 专用补丁，同理自动加载 |
