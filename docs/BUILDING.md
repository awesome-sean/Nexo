# 构建与发布

## 环境

- Windows x64。
- Node.js 22、npm、Rust stable 和对应的 Windows C/C++ 构建工具。
- 手环工具链由 band-app/package-lock.json 锁定，使用项目本地 aiot-toolkit。
- 实际连接设备需要电脑蓝牙与有效的本机手环绑定资料。

## 安装依赖

```powershell
npm ci
npm --prefix band-app ci
```

## 蓝牙服务与电脑端

```powershell
cargo build --release --manifest-path core/Cargo.toml
npm run build
npm start
```

Rust 输出为 core/target/release/pulse-core.exe。桌面打包时将其复制为 NexoBridge.exe。npm run build 同时构建 CLI、主进程、预加载脚本和 React 界面。

## 手环快应用

```powershell
npm --prefix band-app run build
Get-ChildItem band-app/dist -Recurse -Filter *.rpk
```

从生成目录中选择本次构建的 Nexo RPK，复制到 assets/band-app.rpk，再构建电脑端。这样桌面向导和应用内升级使用的就是同一份快应用。

正式签名构建使用工具链的 release 命令及发布者自己的签名资料。

```powershell
npm --prefix band-app run release
```

工具链实际读取 band-app/src/manifest.json，请同时保持 band-app/manifest.json 同步。手环包名为 com.codeisland.band。覆盖升级需要保持包名和原安装所需签名一致，并递增 versionCode。自行签名的构建与已有安装之间的覆盖兼容性需要发布者确认。

## 生成 Windows 安装包

先完成 Rust 服务构建与 RPK 同步，再运行。

```powershell
npm run dist -- --win --x64
```

输出目录为 release，默认生成 Nexo-Setup-<版本>.exe，使用现有 NSIS 安装配置。发布前同步更新 package.json 与 package-lock.json 的版本，手环变更同步更新 band-app/src/manifest.json 与 band-app/manifest.json 中的 versionName 和 versionCode。

## GitHub 覆盖升级发布

更新源固定为 sthess548/Nexo 的正式最新 Release。先整理已有构建。

```powershell
node scripts/prepare-github-release.mjs release
```

脚本读取 win-unpacked/resources/app.asar，核对桌面版本和内置 RPK，生成 EXE 校验文件，并导出同一份 RPK。若构建输出使用其他目录，传入对应目录即可。

创建标签为 v<电脑端版本> 的 GitHub 草稿 Release，并上传以下文件。

| 文件 | 用途 |
| --- | --- |
| Nexo-Setup-<版本>.exe | Windows 安装包 |
| Nexo-Setup-<版本>.exe.sha256 | 应用内更新的 SHA256 校验 |
| Nexo-Band-<版本>.rpk | 与该桌面版配套的手环快应用 |
| Nexo-Band-<版本>.rpk.sha256 | 独立 RPK 下载校验 |

这里导出 RPK 的文件名使用电脑端发布版本，内部快应用版本仍来自其 manifest。上传完整后发布为正式最新版本。草稿和预发布版本会被更新服务忽略。

用户先升级带更新功能的电脑端，在「设置 → 关于 Nexo」一键升级。手环保持蓝牙连接，再点击「升级快应用」。已发布的旧电脑端首次接入此功能需要手动安装新版。

## 定向检查

```powershell
npx tsc --noEmit
node --test scripts/test-update-service.mjs scripts/test-launch-update.mjs
npm run test:gpt
```

这些检查覆盖类型、更新下载校验与 Codex 状态聚合。设备连接、振动及覆盖安装还需对应硬件与安装环境确认。
