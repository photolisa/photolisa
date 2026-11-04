import { describe, expect, it } from 'vitest'
import { BRUSH_PRESETS, brushPreset, resolveBrush } from '../../src/raster/BrushPresets'
import { brushNoise, dabSpacing, dashVisible, paintBrushDab } from '../../src/raster/BrushTip'

function render(id: string, overrides = {}, pressure = 1): Float32Array {
  const brush = resolveBrush({ ...brushPreset(id).settings, diameter: 32, ...overrides })
  const pixels = new Float32Array(64 * 64)
  paintBrushDab(brush, { x: 32, y: 32, pressure, index: 2, seed: 42 }, 64, 64,
    (x, y, coverage) => { pixels[y * 64 + x] = (pixels[y * 64 + x] ?? 0) + coverage })
  return pixels
}
const sum = (pixels: Float32Array) => pixels.reduce((a, b) => a + b, 0)

describe('brush presets and raster tips', () => {
  it('provides all 18 presets with valid independent defaults', () => {
    expect(BRUSH_PRESETS).toHaveLength(18)
    expect(new Set(BRUSH_PRESETS.map(p => p.id)).size).toBe(18)
    for (const preset of BRUSH_PRESETS) {
      expect(resolveBrush(preset.settings)).toEqual(preset.settings)
      expect(sum(render(preset.id))).toBeGreaterThan(0)
    }
    expect(brushPreset('unknown').id).toBe('hard-round')
  })

  it('bounds invalid values so dab traversal and allocations stay finite', () => {
    const brush = resolveBrush({ diameter: Infinity, spacing: 0, flow: NaN, angle: -900, roundness: 0, scatter: 90 })
    expect(brush.diameter).toBe(32)
    expect(brush.spacing).toBe(.01)
    expect(brush.flow).toBe(1)
    expect(brush.angle).toBe(-180)
    expect(brush.roundness).toBe(.05)
    expect(brush.scatter).toBe(1)
    expect(dabSpacing(brush)).toBeGreaterThan(0)
  })

  it('has feathered edges and genuinely different textured material distributions', () => {
    const hard = render('hard-round'), soft = render('soft-round', { flow: 1 })
    expect(hard[32 * 64 + 44]).toBe(1)
    expect(soft[32 * 64 + 44]).toBeLessThan(.4)
    const signatures = ['pencil', 'watercolor', 'oil-paint', 'charcoal', 'chalk', 'crayon']
      .map(id => JSON.stringify([...render(id)]))
    expect(new Set(signatures).size).toBe(6)
    expect(render('chalk').some(value => value === 0)).toBe(true)
  })

  it('responds to pen pressure and allows constant-width drawing', () => {
    expect(sum(render('ink-brush', {}, .25))).toBeLessThan(sum(render('ink-brush')) * .15)
    expect(render('pen', {}, .2)).toEqual(render('pen', {}, 1))
    expect(render('hard-round', { pressureSize: false }, .2)).toEqual(render('hard-round', { pressureSize: false }, 1))
  })

  it('rotates an elliptical nib and preserves exact square pixel marks', () => {
    const horizontal = render('calligraphy', { angle: 0 }), vertical = render('calligraphy', { angle: 90 })
    expect(horizontal[32 * 64 + 44]).toBeGreaterThan(0)
    expect(vertical[32 * 64 + 44]).toBe(0)
    const pixel = render('pixel', { diameter: 3 })
    expect([...pixel].filter(v => v > 0)).toHaveLength(9)
    expect([...pixel].filter(v => v > 0).every(v => v === 1)).toBe(true)
  })

  it('keeps particles deterministic, sparse, and clipped to the surface', () => {
    expect(render('spray-paint')).toEqual(render('spray-paint'))
    expect(render('spray-paint')).not.toEqual(render('splatter'))
    expect([...render('spray-paint')].filter(v => v > 0).length).toBeLessThan(300)
    const brush = brushPreset('splatter').settings
    paintBrushDab(brush, { x: 0, y: 0, pressure: 1, index: 0, seed: 2 }, 8, 8,
      (x, y, coverage) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(8); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(8); expect(coverage).toBeGreaterThan(0) })
    expect(brushNoise(1, 2, 3)).toBe(brushNoise(1, 2, 3))
  })

  it('spaces dots and customizes dash periods in source pixel distances', () => {
    expect(dabSpacing(brushPreset('dotted').settings)).toBeCloseTo(21.6)
    const brush = resolveBrush({ ...brushPreset('dashed').settings, diameter: 10, dashLength: 3, dashGap: 2 })
    expect(dashVisible(brush, 29)).toBe(true)
    expect(dashVisible(brush, 30)).toBe(false)
    expect(dashVisible(brush, 49)).toBe(false)
    expect(dashVisible(brush, 50)).toBe(true)
  })
})
