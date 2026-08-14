# Agent Note: 基于 Web profile 的 Electron 桌面分发

Status: implemented

[English](2026-08-14-electron-desktop-distribution.md) | 中文

## 问题

浏览器应用要求用户安装 Node、安装 NPM 工作区、启动 `dsh web`，再打开其输出的 URL。桌面分发必须移除这些前提，同时不能创建第二套 UI 实现，也不能绕过 Web 组合已经持有的 profile、插件、持久化、权限与清理行为。Host 还会加载 Node 原生模块并运行本地终端进程，因此仅包装浏览器页面无法携带完整应用。

## 决策

`apps/desktop` 是 Electron 应用，其主进程持有一个 `dsh web` 子进程。它通过 Electron 的 Node 运行时和 `ELECTRON_RUN_AS_NODE=1` 启动已安装的 CLI，在操作系统分配的回环端口上监听，等待既有 `dsh web:` 就绪信息，再只加载该信息发布的来源。子进程使用普通 `web` profile 与 `~/.dsh`；因此桌面分发与 CLI 共用配置、凭据、会话、插件组合和文件系统行为，不定义桌面专属组合。

renderer 禁用 `nodeIntegration`，并启用 context isolation 与 Chromium sandbox。导航限制在回环来源内，renderer 权限请求全部拒绝，HTTP 或 HTTPS 弹出目标在操作系统浏览器中打开。renderer 代码不会获得 Electron 或 Node bridge。

桌面进程持有子进程的关闭过程。应用退出时发送 SIGTERM，并等待 7 秒让 Web 插件树 dispose（资源释放）；如果子进程未在宽限时间内退出，则发送 SIGKILL。并发退出请求加入同一个停止操作，因此 Electron 不会遗留仍在运行的 Host 进程。

桌面依赖树固定包含 `dsh-better-sidebar`，启动时将其发布的 bundle patch 作为启动器 overlay 应用。如果 Web profile 已声明该 bundle，或包含旧式手动插件行，启动器会省略 overlay，避免出现两组 host/client 实例。桌面启动器维护与已安装 DSH 包相同的 profile 级模块后备链接，并在应用移动后修复它，因此裸插件解析和已有声明会使用内置副本，无需在 profile 中通过 npm 单独安装。

Electron Builder 依据同一个应用 manifest（元数据清单）打包 macOS DMG／ZIP 与 Windows NSIS 产物。构建脚本先部署不含符号链接的生产依赖树，而不是把工作区虚拟存储暴露给 Electron Builder。Electron 携带 Node、Chromium、构建后的 Web 前端、CLI 依赖闭包和原生预构建文件。应用不把该依赖树存入 asar 归档，因为 profile 启动过程会从 Harness home 向已安装的内置插件目录维护普通文件系统链接。原生模块使每个操作系统与架构成为独立构建目标；公开签名版本使用目标平台的签名，macOS 产物还需要公证。

## 曾考虑的替代方案

**使用带 Node sidecar 的 Tauri。** 不采用：Rust 外壳仍需单独打包 Node Host，才能运行 Cordis 插件、原生模块、终端进程与动态包解析。该方案增加一种运行时和一套进程协议，却没有消除采用 Electron 的主要理由。

**直接加载构建后的前端文件。** 不采用：Web 应用依赖 Host API 与 upgrade route、运行时启动注入、信任检查及 Web profile 的插件清单。保留回环服务器才能继续使用真实应用入口和来源语义。

**在 Electron 主进程内运行 Host。** 不采用：子进程让既有 CLI 独占信号、快速失败处理、进程退出码和有界 Cordis 清理。它还把 renderer 窗口故障与 agent 运行时隔离，并允许桌面持有方升级处理无法完成的清理。

**复用 Python SDK 单文件可执行程序。** 不采用：该可执行程序提供 JSON-RPC SDK 组合，而非 Web profile，并且明确排除 Windows。桌面产品需要浏览器 Host route 与 Windows 安装程序。

## 后果

用户无需安装 Node 或 pnpm，即可从 DMG 或 Windows 安装程序运行 Web 产品及其内置 better-sidebar。应用仍是在原生窗口内运行的本地 Web 来源，因此既有 Web 覆盖继续作为权威验证，桌面专属测试则覆盖就绪信息解析、内置插件挂载选择与进程归属。由于分发包携带 Chromium 和 Node，其体积会大于使用系统 WebView 的外壳。自动更新、发布签名身份和不依赖包管理器的其他插件安装器仍属于独立工作；内置 profile、内置插件与 better-sidebar 不需要外部运行时。
