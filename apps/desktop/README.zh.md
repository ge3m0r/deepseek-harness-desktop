# DeepSeek Harness 桌面版

[English](README.md) | 中文

现有 DeepSeek Harness Web 应用的 Electron 分发版本。桌面主进程使用操作系统分配的回环端口启动已安装的 `dsh web` 入口，等待其就绪信息，再在沙箱窗口中打开该准确来源。打包后的应用包含 Electron Node 运行时、Web 前端、Host 插件树和原生依赖；用户无需安装 Node 或 pnpm。

该分发版本内置 `dsh-better-sidebar` 并自动挂载其 bundle patch。如果用户的 Web profile 已列出该 bundle，或包含旧式手动挂载行，桌面启动器不会重复挂载。启动器为已安装的桌面副本维护 profile 级模块后备链接，因此裸插件解析和已有 bundle 声明无需单独通过 npm 安装插件。

## 开发

在仓库根目录运行 `pnpm run desktop:dev`。该命令构建 Host、Client 与 Web 产物，再启动 Electron。桌面子进程使用普通 `web` profile，并与 CLI 共用 `~/.dsh` 数据，包括凭据、设置、会话和 profile patch。

创造模式生成的 Plugin 定义也会保存在 Harness home 下，并在桌面后端重启后重新出现。恢复后的 Plugin 处于停止状态；Run 与 Client 审批不会恢复，用户需要显式重新启动所需 Package。

`desktop:dev` 只执行一次构建，不会监视桌面应用或相邻的插件源码目录。开发插件时，客户端改动使用插件自身的 watch 流程，并需要强制刷新浏览器；Host 改动需要重启桌面后端。打包后的内置插件不可原地修改：更新其依赖、运行 `pnpm install`，再用 `pnpm run desktop:pack` 重新构建安装包，才能分发新版本。

## 分发

在目标操作系统上运行 `pnpm run desktop:pack`。macOS 生成 DMG 与 ZIP 产物；Windows 生成 NSIS 安装程序。产物写入 `dist-desktop/`。构建过程先部署不含符号链接的生产依赖树，再打包为目标操作系统与架构选择的原生预构建文件。依赖树保留为真实的应用目录而不存入 asar 归档，因为 profile loader 会为已安装的内置插件维护文件系统链接。因此，发布自动化使用独立的 macOS 和 Windows job。

正式下载版本需要平台签名凭据，以免触发操作系统信任警告。macOS 分发还需要公证。没有凭据时，构建仍可用于本地验证，并生成未签名产物。

## 运行时归属

Electron renderer 不启用 Node 集成，并使用 context isolation 与 Chromium sandbox。它只能在回环 Web 来源内导航；HTTP 与 HTTPS 弹出目标在系统浏览器中打开。该应用自有来源可以请求摄像头或麦克风访问，操作系统仍会显示权限提示。桌面进程拒绝其他所有 renderer 权限，并拒绝来自其他来源的媒体请求。

应用退出时向其持有的 `dsh web` 子进程发送 SIGTERM，并等待 7 秒让插件完成清理。如果子进程未完全停止，Electron 会先强制终止它再退出。

## 已知限制与待办事项

第一版没有自动更新器，也不附带代码签名身份。安装除内置 better-sidebar 以外的插件仍需使用 `dsh plugin` 的包管理器路径；打包的 profile、内置插件与 better-sidebar 不需要系统安装 Node。
