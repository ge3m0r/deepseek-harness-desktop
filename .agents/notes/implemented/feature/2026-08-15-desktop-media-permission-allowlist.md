# Agent Note: Desktop media permission allowlist

Status: implemented

English | [中文](2026-08-15-desktop-media-permission-allowlist.zh.md)

## Problem

The Electron desktop renderer reuses the Web client and its dynamic Client plugins, but a blanket permission denial prevents voice input, camera capture, and any plugin that uses the standard browser media APIs. Browser API availability alone is misleading because Electron rejects the request before the operating system can ask the user for consent.

## Decision

The desktop main process installs both Electron permission handlers on the main window's session. They allow only the `media` permission, only for the main window, and only when every origin supplied by Electron matches the loopback origin published by the owned `dsh web` child. Requests without an origin, requests from another origin, and all non-media permissions are denied.

The media permission covers microphone and camera because Electron presents both as `media`. The operating system remains the consent authority: macOS packages declare camera and microphone usage descriptions, and a user can deny or later revoke either permission in system settings. The renderer retains context isolation, Chromium sandboxing, disabled Node integration, and the navigation restrictions owned by the [desktop distribution](../architecture/2026-08-14-electron-desktop-distribution.md).

## Alternatives considered

**Allow every permission from the main window.** Rejected because a Client plugin could then acquire unrelated sensitive capabilities such as geolocation, USB, serial devices, or MIDI without a product decision for each capability.

**Keep denying every renderer permission.** Rejected because it makes standard browser voice and camera features unusable even after an explicit user gesture and leaves the operating system no opportunity to request consent.

**Distinguish microphone from camera in the Electron permission handler.** Rejected because Electron's handler exposes both through the same `media` permission. The operating system still grants and revokes microphone and camera access separately.

## Consequences

Voice and camera plugins loaded by the desktop Web origin can trigger the operating-system consent flow. The allowlist does not extend to pages opened in the system browser or to another origin loaded through a compromised navigation attempt. Pure policy tests pin the origin and permission decisions; TypeScript compilation pins the Electron handler integration, while the operating-system prompt remains platform-controlled and is verified through the packaged application rather than a model transcript snapshot.
