import { describe, expect, it } from 'vitest'
import { encodeIco, IcoError, inspectIco } from '../../src/adapters/IcoAdapter'

function pngHeader(size: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13)
  bytes.set([73, 72, 68, 82], 12)
  view.setUint32(16, size)
  view.setUint32(20, size)
  bytes[24] = 8; bytes[25] = 6
  return bytes
}

describe('ICO directory', () => {
  it('writes a true multi-image ICO with correct dimensions and offsets', () => {
    const encoded = encodeIco([{ size: 16, png: pngHeader(16) }, { size: 32, png: pngHeader(32) }, { size: 256, png: pngHeader(256) }])
    expect([...encoded.slice(0, 6)]).toEqual([0, 0, 1, 0, 3, 0])
    expect(inspectIco(encoded)).toEqual([
      { index: 0, width: 16, height: 16, bitDepth: 32, encoding: 'png' },
      { index: 1, width: 32, height: 32, bitDepth: 32, encoding: 'png' },
      { index: 2, width: 256, height: 256, bitDepth: 32, encoding: 'png' },
    ])
  })

  it('rejects plain PNGs, malformed offsets, dimension mismatches and duplicates', () => {
    expect(() => inspectIco(pngHeader(16))).toThrow(/not a Windows ICO/)
    const encoded = encodeIco([{ size: 16, png: pngHeader(16) }])
    new DataView(encoded.buffer).setUint32(18, 999999, true)
    expect(() => inspectIco(encoded)).toThrow(IcoError)
    expect(() => encodeIco([{ size: 16, png: pngHeader(32) }])).toThrow(/dimensions/)
    expect(() => encodeIco([{ size: 16, png: pngHeader(16) }, { size: 16, png: pngHeader(16) }])).toThrow(/unique/)
  })

  it('bounds entry count and rejects cursor resources', () => {
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setUint16(2, 2, true); view.setUint16(4, 1, true)
    expect(() => inspectIco(bytes)).toThrow(/not a Windows ICO/)
    view.setUint16(2, 1, true); view.setUint16(4, 129, true)
    expect(() => inspectIco(bytes)).toThrow(/directory/)
  })
})
