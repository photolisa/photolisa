import { describe, expect, it } from 'vitest'
import { colorAt, colorHex, colorRgbHex, colorRgba } from '../../src/raster/SampledColor'

describe('sampled color', () => {
  it('preserves transparent RGBA channels and formats an alpha-bearing HEX value', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 0, 22, 91, 200, 128])
    const color = colorAt(pixels, 2, 1, 0)
    expect(color).toEqual({ r: 22, g: 91, b: 200, a: 128 })
    expect(colorHex(color)).toBe('#165BC880')
    expect(colorRgbHex(color)).toBe('#165BC8')
    expect(colorRgba(color)).toBe('rgba(22, 91, 200, 0.502)')
    expect(colorAt(pixels, 2, 0, 0).a).toBe(0)
  })
})
