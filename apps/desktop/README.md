# DeepSeek Harness Desktop

English | [中文](README.zh.md)

Electron distribution of the existing DeepSeek Harness Web application. The desktop main process starts the installed `dsh web` entry with an OS-assigned loopback port, waits for its readiness line, and opens that exact origin in a sandboxed window. The packaged application carries Electron's Node runtime, the Web frontend, the Host plugin tree, and native dependencies; users do not install Node or pnpm.

The distribution includes `dsh-better-sidebar` and mounts its bundle patch automatically. If the user's Web profile already lists that bundle or contains its legacy manual row, the desktop launcher does not add a duplicate mount. The launcher maintains the profile-level module fallback link to the installed desktop copy, so bare plugin resolution and existing bundle declarations do not require a separate npm installation.

## Development

From the repository root, run `pnpm run desktop:dev`. This builds the Host, Client, and Web artifacts before launching Electron. The desktop child uses the ordinary `web` profile and the same `~/.dsh` data as the CLI, including credentials, settings, sessions, and profile patches.

Creation-mode Plugin definitions are also stored under the Harness home and reappear after the desktop backend restarts. They return in the stopped state; Runs and Client approvals are intentionally not restored, so the user explicitly starts the required Package again.

`desktop:dev` performs one build and does not watch the desktop application or a sibling plugin checkout. During plugin development, client changes use the plugin's watch workflow and require a hard browser refresh, while Host changes require restarting the desktop backend. A packaged built-in plugin is immutable: update its dependency, run `pnpm install`, and rebuild the installer with `pnpm run desktop:pack` to distribute a new version.

## Distribution

Run `pnpm run desktop:pack` on the target operating system. macOS produces DMG and ZIP artifacts; Windows produces an NSIS installer. Products are written to `dist-desktop/`. The build first deploys a symlink-free production dependency tree, then packages the native prebuilds selected for the target operating system and architecture. The dependency tree remains a real application directory rather than an asar archive because the profile loader maintains filesystem links to the installed built-in plugins. Release automation therefore uses separate macOS and Windows jobs.

Production downloads require platform signing credentials to avoid operating-system trust warnings. macOS distribution also requires notarization. The build works without credentials for local verification and emits unsigned artifacts.

## Runtime ownership

The Electron renderer has no Node integration and runs with context isolation and Chromium sandboxing. It can navigate only within the loopback Web origin; HTTP and HTTPS popup targets open in the system browser. That owned origin may request camera or microphone access, which remains subject to the operating-system permission prompt. The desktop process denies every other renderer permission and rejects media requests from other origins.

Application exit sends SIGTERM to the owned `dsh web` child and waits seven seconds for plugin teardown. A child that does not reach quiescence is force-terminated before Electron exits.

## Known Limitations and Deferred Work

The first distribution has no automatic updater or bundled code-signing identity. Installing plugins other than the bundled better-sidebar still requires the package-manager path used by `dsh plugin`; the packaged profile, built-in plugins, and better-sidebar do not require a system Node installation.
