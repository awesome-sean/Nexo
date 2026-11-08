<div align="center">
  <img src="assets/desktop-mark.svg" width="72" alt="Nexo" />
  <h1>Nexo</h1>
  <p>把 Codex 的额度和任务状态，放到桌面与手环上。</p>
  <p>Windows 悬浮窗 · 小米手环桌搭 · Codex 状态联动</p>
  <p>
    <a href="https://github.com/sthess548/Nexo/releases">版本下载</a> ·
    <a href="NEXO-README.md">使用说明</a> ·
    <a href="docs/BUILDING.md">源码构建</a> ·
    <a href="https://github.com/sthess548/Nexo/issues">反馈问题</a>
  </p>
</div>

## 可以做什么

- **额度一眼可见**。显示 Codex 的 5 小时额度、每周额度和各自重置时间。
- **任务状态灯**。等待审核或额度耗尽暂停显示红灯，执行中显示黄灯，最近完成显示绿灯，空闲熄灯。
- **Windows 桌面悬浮窗**。支持浅色与深色外观、任务文字开关、透明度、大小、四向停靠和边缘距离。悬停 GPT 图标查看额度，双击将 Codex 窗口切到前台。
- **手环桌搭**。横屏显示时间、日期、额度、人民币花费估算和任务状态。支持双击切换表情、任务提醒及蓝牙重连。
- **快应用管理**。在电脑端查看手环已安装快应用，安装或卸载 RPK。
- **覆盖升级入口**。从本仓库正式 Releases 检查桌面更新，并通过新版电脑端随附的 RPK 升级手环应用。

## 界面预览

以下画面由项目源码渲染，额度与设备信息使用示例数据。

![Windows 悬浮窗编辑页面](docs/images/floating-workspace.png)

![手环桌搭页面](docs/images/band-workspace.png)

## 设备与运行环境

| 项目 | 范围 |
| --- | --- |
| 电脑端 | Windows x64，需要蓝牙连接手环 |
| 手环适配 | 小米手环 9 / 10 / 11，标准版与 NFC 版 |
| 实机确认 | 小米手环 9 标准版已由用户确认可用，其他型号尚未实机检验 |
| Codex 数据 | 来自本机 Codex 登录状态、日志与 Hooks |

手环 10 / 11 使用相应横屏布局偏移。手环 8、Pro 和 Active 不在当前适配范围内。

## 开始使用

1. 从 [Releases](https://github.com/sthess548/Nexo/releases) 安装 Windows 版 Nexo。仓库首次公开时，安装包以随后发布的正式版本为准。
2. 手环先通过小米运动健康完成账号绑定，在 Nexo「手环桌搭」打开「连接手环」。
3. 根据向导，通过电脑版 AstroBox 或手机日志导入手环连接资料。导入后在 AstroBox 中断开设备，再由 Nexo 连接。
4. 安装配套 Nexo 快应用，并在手环上打开。
5. 在「手环桌搭」的「GPT · Codex Hooks」卡片配置 Hooks，再按程序提示在 Codex 中审核并信任对应命令。

连接期间保持 Nexo 在电脑后台运行。关闭主窗口可保留托盘运行，托盘选择退出或电脑关机会停止同步。

完整手势、表情、震动和连接说明见 [使用说明](NEXO-README.md)。

## 任务提醒

| 状态 | 手环表情 | 震动 |
| --- | --- | --- |
| 🔴 等待处理 | smirk，自动切入，可双击返回时间页 | 短震＋长震，连续六组，共十二下 |
| 🟡 正在执行 | naughty，双击时间页查看 | 无 |
| 🟢 最近完成 | star，自动切入，10 分钟后返回时间页 | 连续四次系统长震 |
| 空闲 | sleep，双击时间页查看 | 无 |

多个任务按照等待处理、正在执行、最近完成、空闲的顺序聚合。震动的单次时长由手环固件决定。

## 从源码构建

桌面使用 Electron、React、TypeScript 和 Vite，蓝牙服务使用 Rust，手环快应用使用 Xiaomi Vela 工具链。

```powershell
git clone https://github.com/sthess548/Nexo.git
cd Nexo
npm ci
npm --prefix band-app ci
cargo build --release --manifest-path core/Cargo.toml
npm run build
npm start
```

这组命令构建并运行电脑端。快应用的重新构建、RPK 同步、NSIS 打包和发布文件准备见 [构建与发布说明](docs/BUILDING.md)。每次发布会同步更新随库内置 RPK，构建自己的版本时应按文档同步重建。

## 数据与额度说明

手环绑定资料和 Codex 登录信息在本机使用。任务状态来自 Hooks，并结合本机会话日志恢复状态。普通回复中的等待判断可能存在误判，可通过程序诊断与 CLI 排查。

人民币花费按本地日期汇总 Token，使用模型价格和可调整汇率估算，覆盖情况受日志与模型定价影响，具体金额请以服务方账单为准。在线检查更新需要访问 GitHub。

反馈问题时请遮盖 AuthKey、登录令牌、完整蓝牙地址和个人路径。

## 支持维护

如果 Nexo 对你有帮助，欢迎在程序「设置 → 打赏作者」中支持维护。也欢迎提交问题描述、复现步骤和经过脱敏的诊断信息。

## 许可与致谢

代码沿用 [MIT License](LICENSE)，保留已有版权声明。参考项目、素材来源与授权范围详见 [素材与第三方说明](NOTICE.md) 和 [第三方许可](assets/THIRD-PARTY-LICENSES.txt)。字体许可随资源附带。

品牌标识、设备图片和来源于桌搭快应用的表情资源另见素材说明。Nexo 为社区项目。
