# Nexo 使用说明

Nexo 目前仅显示 GPT，数据来自本机 Codex：5 小时额度、每周额度、当天人民币花费估算，以及任务状态。不提供其他 AI、第三方 API 或 CC Switch 接入。

当前桌面端版本为 v1.0.4，配套手环快应用为 v1.0.2。安装包见 GitHub Releases。构建顺序见 [构建说明](docs/BUILDING.md)。

## 手环连接

每次启动 Nexo 后，点击「连接手环」手动连接。连接后遇到蓝牙短暂断开会自动重试，手动断开后停止重试。

适配小米手环 9 / 10 / 11 的标准版与 NFC 版，不包含 Pro、Active 或手环 8。小米手环 9 标准版已在此前版本确认实机可用，其他型号尚未实机检验。

1. 电脑开启蓝牙，在本机登录 Codex；手环先通过小米运动健康完成账号绑定。
2. 在「手环桌搭」点击「连接手环」，选择 AstroBox 或手机日志导入，按旁边教程操作。
3. AstroBox 用户先在电脑版 AstroBox 登录同一小米账号并同步设备，再回到 Nexo 读取并选择手环；若 AstroBox 请求读取授权，批准后重新读取。
4. 导入完成后在 AstroBox 中断开手环，再由 Nexo 连接；手环出现确认请求时同意。
5. 通过配置向导或「快应用管理」安装与桌面端配套的新版 Nexo 快应用。在手环上打开 Nexo，保持电脑端运行。

连接失败时，保持手环亮屏并靠近电脑，暂停手机端同步，断开其他正在连接手环的程序，再在 Nexo 重试。详细错误可在「运行诊断」查看。

## Codex 任务状态灯

桌面端、手环端共用一份聚合状态。手环左侧中间的圆点表示：

| 状态 | 显示 | 含义 |
| --- | --- | --- |
| Waiting | 红灯常亮 | 等待审核、回答提问、选择选项或额度不足暂停 |
| Working | 黄灯常亮 | Codex 正在执行任务 |
| Done | 绿灯常亮 | 最近完成，保留 10 分钟 |
| Working + Done | 黄色常亮 | 仍有任务执行时保持黄灯，全部完成后亮绿灯 |
| Idle | 不显示圆点 | 当前空闲 |

收到提问或选项题时立即显示红灯，保持到对应回答收到。后台工具活动不会覆盖未回答问题的红灯，自动审批保持黄灯，审批方式未知的权限请求采用十秒兜底。

多个任务同时进行时，等待处理优先显示红灯；只要仍有任务执行就保持黄灯，全部完成后亮绿灯。完成提示保留十分钟。任务中断或会话结束会清理该会话状态。

状态变化通过现有手环连接立即推送，并由每 15 秒请求同步兜底。超过 45 秒未收到新状态，手环隐藏旧灯色。手环 10 / 11 保留向左偏移 6 像素的布局。

## 屏幕常亮

Nexo 快应用在前台运行时自动启用屏幕常亮，时间页和表情页均适用，适合桌搭展示。切出或退出快应用后恢复系统息屏。

## 手环切页与表情

- 连续双击时间页进入表情页，连续双击表情页回到时间页，两次点击间隔为 350 毫秒以内。
- 等待权限、确认、补充信息或额度暂停时自动显示 生气 表情。等待期间可双击返回时间页，重复同步尊重手动选择。保持表情页时，收到恢复执行的 Codex 状态后自动回到时间页。
- 任务完成时自动显示 星星眼 表情。完成后 10 分钟回到时间页，也可双击提前返回。重复同步沿用原来的完成期限。
- 工作表情使用 wink，空闲表情使用 睡觉。连续右滑两次退出快应用。
- 等待处理时连续提示六组，每组为一次短振和一次长振，共十二下。完成时连续触发四次长振，间隔 500 毫秒。手环 9/10 的系统长振时长由固件决定，实际持续时间可能有差异。状态恢复或退出页面会取消后续尚未触发的振动。任务圆点直径为 16px，灯光保持常亮。有任务执行时亮黄灯，全部完成后亮绿灯，需要处理时优先亮红灯。

### 振动开关

在「连接必备 → 手环提醒与表情」调整「手环振动」，默认开启。关闭后为无振动，后续尚未触发的振动会取消。设置保存在电脑端，通过蓝牙发送，断连后在下次连接时同步。两端均需安装包含该功能的配套版本。

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

## 额度与费用

绿色圆环显示 5 小时剩余额度，紫色圆环显示每周剩余额度，下方为各自重置时间。状态灯的颜色与这两个额度圆环独立。

花费按电脑本地日期统计当天 Codex 日志中的 token，结合内置 API 价格及可调整美元兑人民币汇率估算。缺失日志、未知模型和跨设备使用会影响统计覆盖，金额不是订阅账单。

## 开机自启动

在「设置 → 偏好设置」或托盘右键菜单开启「开机自启动」。Windows 登录后主窗口隐藏在右下角托盘，已开启悬浮窗时显示悬浮窗，关闭悬浮窗时仅显示托盘图标。手动打开程序或点击托盘可显示主窗口。旧版自启动配置会自动迁移，并保留 Windows 中的启用或禁用状态。

## 桌面悬浮窗

仅有一个 GPT。支持显示文字和不显示文字两套任务灯、透明度、胶囊大小、停靠位置及边缘标签。边缘标签支持鼠标悬停展开，悬停 GPT 图标查看详情，双击 GPT 图标将 ChatGPT 窗口切到前台。圆环颜色依据额度消耗比例变化，与任务状态灯区分。

完整胶囊边缘距离可调 0–64 个 Windows 逻辑像素，默认 12px，0px 紧贴桌面可用区域边缘。编辑页和右键菜单都可调整。收起的边缘标签使用 0px 贴边。

支持浅色、深色模式。英文保持原字体，额度、金额与 Token 数字使用本机 DIN 字体；中文使用无衬线字体。已移除 Windows 毛玻璃背景功能。

## 应用内覆盖升级

在「设置 → 关于 Nexo」检查更新。电脑端从 [awesome-sean/Nexo 的正式 Releases](https://github.com/awesome-sean/Nexo/releases) 读取版本，点击「下载并安装」后，更新卡片显示下载及 SHA256 校验进度。校验通过后直接打开 Windows 安装向导，按提示完成安装，并在完成页选择运行 Nexo。下载失败时可选择「浏览器下载」。已有设置与手环绑定保存在用户数据目录。

升级电脑端后，保持手环蓝牙连接，在同一页点击「升级快应用」。Nexo 比较手环已安装版本与内置 RPK，仅对未安装或较旧版本开放安装按钮，手环确认安装并读取到目标版本后显示完成。独立发布的 RPK 可供手动安装，应用内升级使用桌面安装包随附的 RPK。

检查更新需要访问 GitHub。首次使用请先安装电脑端。

### 发布更新

先递增电脑端 package.json 版本，并同步 package-lock.json。快应用变化时递增 band-app/src/manifest.json 的 versionName 和 versionCode，并同步 band-app/manifest.json，使用原有包名与签名构建 RPK，更新 assets/band-app.rpk 后再构建桌面安装包。EXE 使用现有应用标识及 NSIS 安装配置。

构建完成后运行以下命令，参数为包含安装包与 win-unpacked 的构建目录。

    node scripts/prepare-github-release.mjs release

脚本核对桌面版本与内置 RPK，生成安装包校验文件，并导出同一份快应用。该命令只整理已有构建文件。

在上述 GitHub 仓库创建版本标签为 v<电脑端版本> 的草稿 Release，上传 Nexo-Setup-<电脑端版本>.exe、同名 .exe.sha256、Nexo-Band-<快应用版本>.rpk 与同名 .rpk.sha256。上传完整后发布为正式最新版本，应用即可检测。更新服务忽略草稿及预发布版本。

## 从源码运行

    npm ci
    npm run build
    npm start

上面的 build 只构建桌面代码和 CLI。连接服务需先执行 cargo build --release --manifest-path core/Cargo.toml，生成 core/target/release/pulse-core.exe。

本次定向检查入口：npm run test:gpt。发布 EXE 和 RPK 仍遵循 AGENTS.md 中的明确授权约定。

源码许可证见 LICENSE；第三方与字体许可见 assets/THIRD-PARTY-LICENSES.txt 和 assets/font-licenses。
