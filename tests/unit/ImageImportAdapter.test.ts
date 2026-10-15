import { describe, expect, it } from 'vitest'
import { ImageImportError, inspectImageHeader } from '../../src/adapters/ImageImportAdapter'

describe('inspectImageHeader', () => {
  it('reads PNG dimensions', () => {
    const bytes = new Uint8Array(24)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const view = new DataView(bytes.buffer)
    view.setUint32(16, 1920)
    view.setUint32(20, 1080)
    expect(inspectImageHeader(bytes)).toEqual({ mime: 'image/png', width: 1920, height: 1080 })
  })

  it('reads JPEG dimensions from a start-of-frame marker', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    ])
    expect(inspectImageHeader(bytes)).toEqual({ mime: 'image/jpeg', width: 800, height: 600 })
  })

  it('reads extended WebP dimensions', () => {
    const bytes = new Uint8Array(30)
    bytes.set([...'RIFF'].map((character) => character.charCodeAt(0)), 0)
    bytes.set([...'WEBP'].map((character) => character.charCodeAt(0)), 8)
    bytes.set([...'VP8X'].map((character) => character.charCodeAt(0)), 12)
    bytes.set([0xff, 0x03, 0x00], 24)
    bytes.set([0xff, 0x01, 0x00], 27)
    expect(inspectImageHeader(bytes)).toEqual({ mime: 'image/webp', width: 1024, height: 512 })
  })

  it('rejects unknown files', () => {
    expect(() => inspectImageHeader(new Uint8Array([1, 2, 3]))).toThrow(ImageImportError)
  })
})
