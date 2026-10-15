import { describe, expect, it } from 'vitest'
import { accumulateCoverage, composeStrokePixel, pencilLine } from '../../src/raster/StrokeMath'

describe('stroke math', () => {
  it('visits every integer pixel on horizontal, diagonal, and reverse pencil lines', () => {
    expect([...pencilLine({ x: 1, y: 2 }, { x: 5, y: 2 })]).toEqual([
      { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 },
    ])
    expect([...pencilLine({ x: 3, y: 3 }, { x: 0, y: 0 })]).toEqual([
      { x: 3, y: 3 }, { x: 2, y: 2 }, { x: 1, y: 1 }, { x: 0, y: 0 },
    ])
  })

  it('accumulates flow while capping the final stroke with opacity', () => {
    let coverage = 0
    coverage = accumulateCoverage(coverage, 0.25)
    coverage = accumulateCoverage(coverage, 0.25)
    expect(coverage).toBeCloseTo(0.4375)
    const pixel = composeStrokePixel([0, 0, 0, 255], [255, 0, 0], coverage * 0.5, false)
    expect(pixel[0]).toBeLessThan(128)
    expect(pixel[3]).toBe(255)
  })

  it('composites over transparent pixels and erases alpha without changing other layers', () => {
    expect(composeStrokePixel([0, 0, 0, 0], [255, 0, 0], 0.5, false)).toEqual([255, 0, 0, 128])
    expect(composeStrokePixel([20, 40, 60, 255], [0, 0, 0], 0.5, true)).toEqual([20, 40, 60, 128])
  })
})
