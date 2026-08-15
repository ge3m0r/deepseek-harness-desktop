import { describe, expect, it } from 'vitest'
import { allowsDesktopMediaPermission } from '../src/permissions.ts'

const allowedOrigin = 'http://127.0.0.1:43123'

describe('desktop media permission policy', () => {
  it('allows camera and microphone media requests from the owned backend origin', () => {
    expect(allowsDesktopMediaPermission('media', allowedOrigin, [
      'http://127.0.0.1:43123/voice',
      'http://127.0.0.1:43123',
    ])).toBe(true)
  })

  it('rejects media requests from another origin or without an origin', () => {
    expect(allowsDesktopMediaPermission('media', allowedOrigin, ['https://example.com/'])).toBe(false)
    expect(allowsDesktopMediaPermission('media', allowedOrigin, [])).toBe(false)
  })

  it('rejects non-media permissions from the owned backend origin', () => {
    expect(allowsDesktopMediaPermission('geolocation', allowedOrigin, [allowedOrigin])).toBe(false)
    expect(allowsDesktopMediaPermission('notifications', allowedOrigin, [allowedOrigin])).toBe(false)
  })
})
