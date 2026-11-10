# Nexo 进阶说明

安装、设备连接和日常使用请查看 [项目使用说明](README.md#使用说明)，构建及发布请查看 [构建说明](docs/BUILDING.md)。

## 启用 Codex Hooks

1. Nexo「连接必备」→「GPT · Codex Hooks」→「配置 Hooks」。
2. 在 Codex 桌面端打开 Settings → Hooks 或 Review hooks，审核并信任 Nexo 状态灯命令，然后重新开始会话。Codex CLI 可运行 /hooks。
3. 保持 Nexo 运行。UserPromptSubmit、工具执行等事件显示黄灯；PermissionRequest 和已识别的输入请求显示红灯；Stop 显示绿灯。

配置器会合并用户现有 hooks.json，保留其他命令，并备份原文件。移除配置只移除 Nexo 自己的 Hook。没有改动 Codex 的权限批准策略，也不会自动信任 Hook。若 Codex 禁用了 Hooks，需要在 Codex 中启用后使用。

普通回复中要求补充信息的状态，结合回复文本规则判断，可能存在误判；必要时可用 CLI 修正。另保留本地 Codex 会话日志作为兜底。优先使用 Hooks，避免只靠文件轮询。

官方说明：https://learn.chatgpt.com/docs/hooks

## 命令行控制

从项目根目录运行，需 Node.js：

    node assets/nexo-cli.cjs status
    node assets/nexo-cli.cjs working --task task-a
    node assets/nexo-cli.cjs waiting --task task-b
    node assets/nexo-cli.cjs done --task task-a
    node assets/nexo-cli.cjs idle --task task-b
    node assets/nexo-cli.cjs clear
    node assets/nexo-cli.cjs quota
    node assets/nexo-cli.cjs quit

不同并行任务使用不同 --task ID；同一任务后续更新使用相同 ID。clear 清除灯色状态，quit 请求退出正在运行的 Nexo，不会停止 Codex 任务。

也可用 CLI 配置 Hooks：

    node assets/nexo-cli.cjs hooks install
    node assets/nexo-cli.cjs hooks status
    node assets/nexo-cli.cjs hooks remove

CLI、Hooks 和桌面程序默认共用 %LOCALAPPDATA%/Nexo/traffic；状态事件按独立文件排队，避免并发覆盖。可用 --data-dir 指定其他目录，主要用于调试。Hook 只保存任务 ID、状态、时间及工作目录，不保存提示词、命令正文或 API 密钥。

桌面配置 Hooks 后也会生成 %LOCALAPPDATA%/Nexo/codex-hooks/nexo-codex.ps1，可用 PowerShell 调用这个脚本代替 node assets/nexo-cli.cjs，使用 Nexo 自带运行时，无需额外安装 Node。

