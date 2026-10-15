import { describe, expect, it } from 'vitest'
import { initializeCanvas, readPsd, writePsdUint8Array, type Psd } from 'ag-psd'
import { preflightPsd } from '../../src/adapters/PsdAdapter'

describe('PSD interoperability', () => {
  it('round-trips a supported 8-bit RGB raster fixture without flattening its layer', () => {
    initializeCanvas((width, height) => ({ width, height, getContext: () => ({ createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }) }) }) as unknown as HTMLCanvasElement)
    const reference = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128])
    const fixture: Psd = {
      width: 2, height: 1,
      imageData: { width: 2, height: 1, data: reference },
      children: [{ name: 'Reference pixels', left: 0, top: 0, right: 2, bottom: 1, blendMode: 'multiply', opacity: 200, imageData: { width: 2, height: 1, data: reference } }],
    }
    const bytes = writePsdUint8Array(fixture, { generateThumbnail: false })
    expect(preflightPsd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)).toMatchObject({ width: 2, height: 1 })
    const decoded = readPsd(bytes, { useImageData: true, skipThumbnail: true })
    expect(decoded.children?.[0]?.name).toBe('Reference pixels')
    expect(decoded.children?.[0]?.blendMode).toBe('multiply')
    expect(Array.from(decoded.children?.[0]?.imageData?.data ?? [])).toEqual(Array.from(reference))
  })

  it('rejects PSB and 16-bit headers before ag-psd allocates decoded buffers', () => {
    const header = new ArrayBuffer(26); const bytes = new Uint8Array(header); bytes.set([56, 66, 80, 83])
    const view = new DataView(header); view.setUint16(4, 2); view.setUint16(12, 4); view.setUint32(14, 10); view.setUint32(18, 10); view.setUint16(22, 16); view.setUint16(24, 3)
    expect(() => preflightPsd(header)).toThrow(/PSB/)
  })
})
