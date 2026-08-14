# Agent Note: Electron desktop distribution over the Web profile

Status: implemented

English | [中文](2026-08-14-electron-desktop-distribution.zh.md)

## Problem

The browser application requires users to install Node, install the npm workspace, start `dsh web`, and open the printed URL. A desktop distribution must remove those prerequisites without creating a second UI implementation or bypassing the profile, plugin, persistence, permission, and teardown behavior already owned by the Web composition. The Host also loads native Node modules and can run local terminal processes, so a browser-only wrapper cannot carry the complete application.

## Decision

`apps/desktop` is an Electron application whose main process owns one `dsh web` child. It starts the installed CLI through Electron's Node runtime with `ELECTRON_RUN_AS_NODE=1`, binds an OS-assigned loopback port, waits for the existing `dsh web:` readiness line, and loads only that published origin. The child uses the ordinary `web` profile and `~/.dsh`; the desktop distribution therefore shares the CLI's configuration, credentials, sessions, plugin composition, and filesystem behavior instead of defining a desktop-specific composition.

The renderer keeps `nodeIntegration` disabled and enables context isolation and Chromium sandboxing. Navigation remains on the loopback origin, renderer permission requests are denied, and HTTP or HTTPS popup targets open in the operating-system browser. Renderer code receives no Electron or Node bridge.

The desktop process owns child shutdown. Application exit sends SIGTERM and waits seven seconds for the Web plugin tree to dispose; a child that does not exit within that grace receives SIGKILL. Concurrent exit requests join one stop operation, so Electron does not abandon a still-running Host process.

The desktop dependency tree pins `dsh-better-sidebar`, and startup applies its published bundle patch as a launcher overlay. The overlay is omitted when the Web profile already declares the bundle or contains its legacy manual plugin row, which prevents two host/client instances. The desktop launcher maintains the same profile-level module fallback link used by installed DSH packages and repairs it after the application moves, so bare plugin resolution and existing declarations use the bundled copy without a profile-local npm installation.

Electron Builder packages macOS DMG/ZIP and Windows NSIS products from the same app manifest. The build script first deploys a symlink-free production dependency tree instead of exposing the workspace virtual store to Electron Builder. Electron carries Node, Chromium, the built Web frontend, the CLI dependency closure, and native prebuilds. The application keeps that dependency tree outside an asar archive because profile startup maintains ordinary filesystem links from the Harness home to its installed built-in plugin directories. Native modules make each operating system and architecture its own build target; signed public releases use target-specific signing, and macOS products also use notarization.

## Alternatives considered

**Tauri with a Node sidecar.** Rejected because the Rust shell would still need a separately packaged Node Host for Cordis plugins, native modules, terminal processes, and dynamic package resolution. It adds a runtime and process protocol without removing Electron's main reason for inclusion.

**Load built frontend files directly.** Rejected because the Web app depends on Host API and upgrade routes, runtime boot injection, trust checks, and the Web profile's plugin roster. Keeping the loopback server preserves the real application entry path and origin semantics.

**Run the Host inside Electron's main process.** Rejected because a child gives the existing CLI exclusive ownership of signals, fail-loud handling, process exit codes, and bounded Cordis disposal. It also keeps renderer-window failures separate from the agent runtime and allows the desktop owner to escalate a hung teardown.

**Reuse the Python SDK single-file executable.** Rejected because that executable exposes the JSON-RPC SDK composition rather than the Web profile and deliberately excludes Windows. The desktop product needs the browser Host routes and a Windows installer.

## Consequences

Users can run the Web product and its bundled better-sidebar from a DMG or Windows installer without installing Node or pnpm. The application remains a local Web origin inside a native window, so existing Web coverage remains authoritative and desktop-specific tests cover readiness parsing, bundled-plugin mount selection, and process ownership. The distribution is larger than a system-WebView shell because it carries Chromium and Node. Automatic updates, release signing identities, and a package-manager-independent installer for other plugins remain separate work; built-in profiles, built-in plugins, and better-sidebar require no external runtime.
