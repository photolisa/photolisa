import { describe, expect, it } from 'vitest'
import { fromHsv, toHsv } from '../../src/ui/colorField'

describe('color field conversions', () => {
  it('round trips RGB and preserves transparent alpha', () => {
    for (const color of [{ r: 0, g: 0, b: 0, a: 0 }, { r: 255, g: 255, b: 255, a: 128 }, { r: 18, g: 171, b: 52, a: 80 }, { r: 83, g: 109, b: 254, a: 255 }]) {
      expect(fromHsv(toHsv(color), color.a)).toEqual(color)
    }
  })
  it('wraps hue and handles grayscale and brightness endpoints', () => {
    expect(fromHsv({ h: 360, s: 1, v: 1 }, 42)).toEqual({ r: 255, g: 0, b: 0, a: 42 })
    expect(fromHsv({ h: 120, s: 1, v: 1 }, 255)).toEqual({ r: 0, g: 255, b: 0, a: 255 })
    expect(fromHsv({ h: 120, s: 0, v: 1 }, 255)).toEqual({ r: 255, g: 255, b: 255, a: 255 })
    expect(fromHsv({ h: 120, s: 1, v: 0 }, 255)).toEqual({ r: 0, g: 0, b: 0, a: 255 })
  })
})
