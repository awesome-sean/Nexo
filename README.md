<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/nexo-logo-dark.svg" />
    <img src="assets/desktop-mark.svg" width="88" height="88" alt="Nexo Logo" />
  </picture>
  <h1>Nexo</h1>
  <p>通过 Windows 桌面悬浮窗或小米手环桌搭，查看 ChatGPT/Codex 额度与任务状态。</p>
</div>

<p align="center">
  <a href="#使用说明">使用说明</a> ·
  <a href="#版本更新">版本更新</a> ·
  <a href="docs/BUILDING.md">源码构建</a> ·
  <a href="https://github.com/awesome-sean/Nexo/issues">反馈问题</a>
</p>

- **Windows 桌面悬浮窗**。下载并安装电脑端 EXE 即可使用。<br>
  最新 EXE 下载地址　[https://github.com/awesome-sean/Nexo/releases/download/v1.0.4/Nexo-Setup-1.0.4.exe](https://github.com/awesome-sean/Nexo/releases/download/v1.0.4/Nexo-Setup-1.0.4.exe)
- **小米手环横屏桌搭**。需要电脑端 EXE 和手环 RPK，连接后联动使用。<br>
  最新 RPK 下载地址　[https://github.com/awesome-sean/Nexo/releases/download/v1.0.2/Nexo-Band-1.0.2.rpk](https://github.com/awesome-sean/Nexo/releases/download/v1.0.2/Nexo-Band-1.0.2.rpk)

## 版本更新

| 应用 | 当前版本 | 发行页 |
| --- | --- | --- |
| 电脑应用程序 · Windows | **v1.0.4** | [电脑端 v1.0.4 发行页](https://github.com/awesome-sean/Nexo/releases/tag/v1.0.4) |
| 手环快应用 · 小米手环 | **v1.0.2** | [手环快应用 v1.0.2 发行页](https://github.com/awesome-sean/Nexo/releases/tag/v1.0.2) |

[查看所有版本](https://github.com/awesome-sean/Nexo/releases)

## 主要功能

### 电脑端应用程序

- 查看 5 小时和每周额度、重置时间及当天花费估算。
- 管理手环连接与快应用，支持后台运行、开机自启动和检查更新。

### 桌面悬浮窗

- 通过红黄绿灯查看 Codex 任务状态，悬停 GPT 图标查看额度，双击唤起 ChatGPT。
- 可调整深浅外观、文字、透明度、大小和四向停靠位置。

### 小米手环横屏桌搭

- 前台常亮显示时间、额度、花费及任务状态。
- 支持表情联动、双击切页与可关闭的振动提醒。

## 任务状态一眼看懂

| 灯色 | 什么时候亮 | 手环提醒 |
| --- | --- | --- |
| 🔴 等待处理 | Codex 提问、等待审核，或额度不足暂停 | 自动显示 生气，短振＋长振重复六组 |
| 🟡 正在执行 | Codex 正在工作，收到对应回答后继续执行 | wink，无振动 |
| 🟢 最近完成 | 任务完成，保留 10 分钟 | 自动显示 星星眼，连续四次长振 |
| 熄灯 | 当前空闲 | 睡觉，无振动 |

提问后保持红灯，收到对应回答才恢复黄灯。多个任务优先显示待处理的红灯，其次为执行中的黄灯。只要还有任务执行就保持黄灯，全部完成后亮绿灯，完成提示保留十分钟。

![任务执行中、待审核或提问、任务已完成的桌面悬浮窗与手环画面](docs/images/task-states.png)

## 界面预览

以下为当前源码实际渲染，额度与设备信息使用示例数据，图片保持原始比例。

![Windows 悬浮窗编辑页面](docs/images/floating-workspace.png)

![手环桌搭页面](docs/images/band-workspace.png)

## 使用说明

### Windows 桌面悬浮窗

1. 安装 [电脑端 EXE v1.0.4](https://github.com/awesome-sean/Nexo/releases/download/v1.0.4/Nexo-Setup-1.0.4.exe)，并在电脑上登录 ChatGPT。
2. 在「Windows 悬浮窗」开启「显示」，按需调整外观与停靠位置。悬停 GPT 图标查看额度，双击将 ChatGPT 切到前台。
3. 如需任务状态联动，点击右上角「连接必备 → 配置 Hooks」，在 Codex 中审核并信任 Nexo 命令，然后重新开始会话。Codex CLI 可运行 `/hooks`。保持 Nexo 在后台运行。

需要开机自启动时，可在「设置 → 偏好设置」或托盘右键菜单开启。

### 小米手环桌搭

需要 [电脑端 EXE v1.0.4](https://github.com/awesome-sean/Nexo/releases/download/v1.0.4/Nexo-Setup-1.0.4.exe)、[手环 RPK v1.0.2](https://github.com/awesome-sean/Nexo/releases/download/v1.0.2/Nexo-Band-1.0.2.rpk) 和电脑蓝牙。

1. 手环先通过小米运动健康绑定账号，电脑开启蓝牙并登录 ChatGPT。
2. 在 Nexo「手环桌搭」点击「连接手环」，通过 AstroBox 或手机日志导入设备资料；使用 AstroBox 时，先登录同一账号并同步设备，导入后在 AstroBox 中断开手环。手环出现确认请求时点击同意。
3. 按向导安装快应用。之后每次启动 Nexo，点击「连接手环」即可；已安装的快应用会自动发送打开指令，更新可在「手环快应用」卡片单独进行。

快应用在前台运行时屏幕常亮。双击切换时间页与表情页，连续右滑两次退出。等待处理和任务完成时会振动；可在「连接必备 → 手环提醒与表情」关闭，需两端使用配套版本。等待处理时为六组「短振＋长振」，完成时为四次长振，具体时长由手环决定。

连接失败时，让手环靠近电脑并保持亮屏，暂停手机同步并断开 AstroBox 等其他连接，再重试；可在「设置 → 运行诊断」查看状态。退出 Nexo 或关闭电脑后同步停止，重新启动后需手动连接。

### 更新

电脑端在「设置 → 关于 Nexo」检查更新，下载并校验后按 Windows 安装向导操作；失败时可选择浏览器下载。个人设置与绑定保存在本机。手环保持连接后，可在同页覆盖升级快应用，也可手动安装 RPK。

[命令行与进阶说明](NEXO-README.md) · [源码构建](docs/BUILDING.md)

## 支持设备

Windows x64，需要电脑蓝牙。适配小米手环 **9 / 10 / 11 标准版和 NFC 版**。小米手环 9 标准版已实机确认，其他型号尚未实机检验。

## 费用与数据

花费按电脑本地日期统计 Token，结合模型价格和可调整汇率估算。日志缺失及未知模型会影响金额，请以服务方账单为准。手环绑定资料与 Codex 登录信息在本机使用，检查更新需要访问 GitHub。反馈时请遮盖密钥、令牌和完整蓝牙地址。

## 源码与许可

Electron、React、TypeScript、Rust 与 Xiaomi Vela。构建步骤见 [构建说明](docs/BUILDING.md)。

代码采用 [MIT License](LICENSE)。字体、标识、设备图片和表情素材的来源与授权范围见 [素材说明](NOTICE.md) 和 [第三方许可](assets/THIRD-PARTY-LICENSES.txt)。

如果 Nexo 对你有帮助，欢迎点击 GitHub 页面右上角的 ⭐ Star，或提交问题与改进建议。也可以在程序「设置 → 打赏作者」，支持持续维护与更新。每一份支持都很重要。
