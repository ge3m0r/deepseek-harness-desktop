# Agent Note: 桌面媒体权限白名单

Status: implemented

[English](2026-08-15-desktop-media-permission-allowlist.md) | 中文

## 问题

Electron 桌面 renderer 复用 Web client 及其动态 Client 插件，但统一拒绝权限会阻止语音输入、摄像头采集及任何使用标准浏览器媒体 API 的插件。仅检测到浏览器 API 并不代表功能可用，因为 Electron 会在操作系统询问用户之前拒绝请求。

## 决策

桌面主进程在主窗口 session 上同时安装两个 Electron 权限 handler。只有权限为 `media`、请求来自主窗口，且 Electron 提供的每个来源都与所持有 `dsh web` 子进程发布的回环来源一致时，handler 才允许请求。缺少来源、来自其他来源及所有非媒体权限的请求都会被拒绝。

Electron 将麦克风和摄像头都表示为 `media` 权限，因此媒体权限会同时覆盖两者。操作系统仍持有最终授权：macOS 包声明摄像头和麦克风用途说明，用户可以拒绝授权，也可以稍后在系统设置中撤销任一权限。renderer 继续使用 context isolation、Chromium sandbox、禁用 Node 集成及[桌面分发](../architecture/2026-08-14-electron-desktop-distribution.md)持有的导航限制。

## 曾考虑的替代方案

**允许主窗口的所有权限。** 不采用：Client 插件可能因此获得定位、USB、串口或 MIDI 等无关敏感能力，而产品尚未分别决定是否提供这些能力。

**继续拒绝所有 renderer 权限。** 不采用：即使用户明确操作，也无法使用标准浏览器语音和摄像头功能，操作系统也没有机会询问用户是否授权。

**在 Electron 权限 handler 中区分麦克风与摄像头。** 不采用：Electron 的 handler 通过同一个 `media` 权限表示两者。操作系统仍会分别授予和撤销麦克风与摄像头访问。

## 后果

桌面 Web 来源加载的语音和摄像头插件可以触发操作系统授权流程。白名单不会扩展到系统浏览器中打开的页面，也不会扩展到通过受破坏的导航尝试加载的其他来源。纯策略测试固定来源和权限决定，TypeScript 编译固定 Electron handler 集成；操作系统提示由平台控制，因此通过打包应用验证，而不是使用模型 transcript 快照。
