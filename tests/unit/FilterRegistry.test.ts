import { describe, expect, it } from 'vitest'
import { filterRegistry } from '../../src/core/filters/FilterRegistry'

const pixel = (red: number, green: number, blue: number, alpha = 255) => ({
  data: new Uint8ClampedArray([red, green, blue, alpha]), width: 1, height: 1,
})

describe('FilterRegistry', () => {
  it('registers all supported adjustment kinds with normalized serializable parameters', () => {
    expect(filterRegistry.list().map((definition) => definition.kind)).toEqual([
      'brightness-contrast', 'exposure', 'saturation', 'hue', 'temperature',
      'grayscale', 'sepia', 'invert', 'gaussian-blur', 'sharpen', 'levels',
    ])
    expect(filterRegistry.create('brightness-contrast', { brightness: 9, contrast: -9 }).parameters)
      .toEqual({ brightness: 1, contrast: -1 })
    expect(filterRegistry.create('levels', { inputBlack: 250, inputWhite: 20, gamma: 99 }).parameters)
      .toEqual({ inputBlack: 250, inputWhite: 251, gamma: 10, outputBlack: 0, outputWhite: 255 })
  })

  it('mixes sepia color while retaining transparency', () => {
    const source = pixel(100, 150, 200, 63)
    const result = filterRegistry.apply(source, [filterRegistry.create('sepia', { amount: 1 })])
    expect([...result.data]).toEqual([192, 171, 134, 63])
    expect([...source.data]).toEqual([100, 150, 200, 63])
  })

  it('produces deterministic point-filter results without changing alpha or input pixels', () => {
    const source = pixel(64, 128, 192, 127)
    const result = filterRegistry.apply(source, [
      filterRegistry.create('brightness-contrast', { brightness: 0.1, contrast: 0 }),
      filterRegistry.create('invert', { amount: 1 }),
    ])

    expect([...source.data]).toEqual([64, 128, 192, 127])
    expect([...result.data]).toEqual([165, 101, 37, 127])
  })

  it('applies ordered adjustments and respects disabled entries', () => {
    const source = pixel(64, 64, 64)
    const exposure = filterRegistry.create('exposure', { stops: 1 })
    const invert = filterRegistry.create('invert', { amount: 1 })
    const first = filterRegistry.apply(source, [exposure, invert])
    const second = filterRegistry.apply(source, [invert, exposure])
    const disabled = filterRegistry.apply(source, [{ ...invert, enabled: false }])

    expect(first.data[0]).toBe(127)
    expect(second.data[0]).toBe(255)
    expect([...disabled.data]).toEqual([...source.data])
  })

  it('runs spatial blur and sharpen filters on copied buffers', () => {
    const source = { data: new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ]), width: 3, height: 1 }
    const blurred = filterRegistry.apply(source, [filterRegistry.create('gaussian-blur', { radius: 1 })])
    const sharpened = filterRegistry.apply(source, [filterRegistry.create('sharpen', { amount: 0.5 })])

    expect(blurred.data[0]).toBeGreaterThan(0)
    expect(blurred.data[4]).toBeLessThan(255)
    expect(sharpened.data[4]).toBe(255)
    expect([...source.data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255])
  })
})
