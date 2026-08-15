/** Permission policy for the sandboxed desktop renderer. */

function hasAllowedOrigin(value: string | undefined, allowedOrigin: string): boolean {
  if (value === undefined || value.length === 0) return true
  try {
    return new URL(value).origin === allowedOrigin
  } catch {
    return false
  }
}

/**
 * Decide whether an Electron permission request may access microphone or camera media.
 *
 * @param permission Electron's permission name.
 * @param allowedOrigin The loopback origin published by the owned desktop backend.
 * @param requestOrigins Origin-bearing fields supplied by Electron for the request.
 * @returns Whether the request is a media request whose supplied origins all match the backend.
 */
export function allowsDesktopMediaPermission(
  permission: string,
  allowedOrigin: string,
  requestOrigins: readonly (string | undefined)[],
): boolean {
  const suppliedOrigins = requestOrigins.filter((origin): origin is string => origin !== undefined && origin.length > 0)
  return permission === 'media'
    && suppliedOrigins.length > 0
    && suppliedOrigins.every(origin => hasAllowedOrigin(origin, allowedOrigin))
}
