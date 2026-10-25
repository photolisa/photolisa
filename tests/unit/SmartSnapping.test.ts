import { describe, expect, it } from 'vitest'
import {
  createSmartSnapScene,
  smartSnapBounds,
  type SmartSnapOptions,
} from '../../src/core/transform/SmartSnapping'

const settings: SmartSnapOptions = {
  tolerance: 6,
  zoom: 1,
  width: 1000,
  height: 800,
  grid: 0,
  guidesX: [],
  guidesY: [],
}
const rect = (x: number, y = 100, width = 20, height = 20) => ({
  x,
  y,
  width,
  height,
})

describe('smart snapping', () => {
  it('holds a magnetic target through jitter and releases without accumulating pointer lag', () => {
    const scene = createSmartSnapScene([rect(200, 300)])
    const captured = smartSnapBounds(rect(184), scene, settings)
    expect(captured).toMatchObject({ x: -4, lock: { x: 180 } })
    // The neighboring center is closer, but the original edge stays captured.
    const held = smartSnapBounds(rect(187), scene, {
      ...settings,
      previous: captured.lock,
    })
    expect(held).toMatchObject({ x: -7, lock: { x: 180 } })
    const released = smartSnapBounds(rect(190), scene, {
      ...settings,
      previous: held.lock,
    })
    expect(released).toMatchObject({ x: 0, lock: { x: 190 } })
  })
  it('scales magnetic release by zoom and drops invalid, axis-locked or vanished gap targets', () => {
    const scene = createSmartSnapScene([rect(200, 300)])
    const captured = smartSnapBounds(rect(180), scene, { ...settings, zoom: 4 })
    expect(
      smartSnapBounds(rect(181.75), scene, {
        ...settings,
        zoom: 4,
        previous: captured.lock,
      }).x,
    ).toBe(-1.75)
    expect(
      smartSnapBounds(rect(182.5), scene, {
        ...settings,
        zoom: 4,
        previous: captured.lock,
      }).lock.x,
    ).toBeNull()
    expect(
      smartSnapBounds(rect(187), scene, {
        ...settings,
        axis: 'y',
        previous: captured.lock,
      }).lock.x,
    ).toBeNull()
    const gaps = createSmartSnapScene([rect(10), rect(50)])
    const gap = smartSnapBounds(rect(92), gaps, settings)
    expect(
      smartSnapBounds(rect(97), gaps, { ...settings, previous: gap.lock }).x,
    ).toBe(-7)
    expect(
      smartSnapBounds(rect(97, 300), gaps, { ...settings, previous: gap.lock })
        .lock.x,
    ).toBeNull()
    expect(
      smartSnapBounds(rect(97), gaps, {
        ...settings,
        tolerance: 0,
        previous: gap.lock,
      }).x,
    ).toBe(0)
  })
  it('snaps canvas edges and center with screen-pixel tolerance', () => {
    const scene = createSmartSnapScene([])
    expect(smartSnapBounds(rect(3, 100), scene, settings)).toMatchObject({
      x: -3,
      vertical: 0,
    })
    expect(smartSnapBounds(rect(489, 391), scene, settings)).toMatchObject({
      x: 1,
      y: -1,
      vertical: 500,
      horizontal: 400,
    })
    expect(
      smartSnapBounds(rect(3, 100), scene, { ...settings, zoom: 4 }),
    ).toMatchObject({ x: 0, vertical: null })
    expect(smartSnapBounds(rect(979, 100), scene, settings)).toMatchObject({
      x: 1,
      vertical: 1000,
    })
  })
  it('highlights all matching edges and centers with finite target extents', () => {
    const scene = createSmartSnapScene([rect(200, 150), rect(200, 200)])
    const result = smartSnapBounds(rect(202, 102), scene, settings)
    expect(result.x).toBe(-2)
    const verticals = result.lines.filter((l) => l.from.x === l.to.x)
    expect(verticals.map((l) => l.from.x)).toEqual([200, 210, 220])
    expect(verticals[1]).toMatchObject({
      kind: 'center',
      from: { y: 100 },
      to: { y: 220 },
    })
  })
  it('snaps between two layers to equal gaps and highlights both measured gaps', () => {
    const result = smartSnapBounds(
      rect(59),
      createSmartSnapScene([rect(10), rect(110)]),
      settings,
    )
    expect(result.x).toBe(1)
    expect(
      result.measurements.filter((m) => m.equal).map((m) => m.distance),
    ).toEqual([30, 30])
  })
  it('repeats adjacent horizontal and vertical gaps for a third layer', () => {
    const horizontal = smartSnapBounds(
      rect(92),
      createSmartSnapScene([rect(10), rect(50)]),
      settings,
    )
    expect(horizontal.x).toBe(-2)
    expect(
      horizontal.measurements.filter((m) => m.equal).map((m) => m.distance),
    ).toEqual([20, 20])
    const vertical = smartSnapBounds(
      rect(100, 92),
      createSmartSnapScene([rect(100, 10), rect(100, 50)]),
      settings,
    )
    expect(vertical.y).toBe(-2)
    expect(
      vertical.measurements.filter((m) => m.equal).map((m) => m.distance),
    ).toEqual([20, 20])
  })
  it('ignores gaps in other rows and respects the axis lock without phantom guides', () => {
    const scene = createSmartSnapScene([rect(10, 300), rect(50, 300)])
    expect(smartSnapBounds(rect(92), scene, settings).x).toBe(0)
    const locked = smartSnapBounds(rect(489, 391), scene, {
      ...settings,
      axis: 'x',
    })
    expect(locked).toMatchObject({ x: 1, y: 0, horizontal: null })
    expect(locked.lines.every((l) => l.from.x === l.to.x)).toBe(true)
  })
  it('supports custom guides, grid and zero tolerance, rejecting invalid settings', () => {
    const scene = createSmartSnapScene([rect(NaN)])
    expect(scene.objects).toHaveLength(0)
    expect(
      smartSnapBounds(rect(82, 133), scene, {
        ...settings,
        guidesX: [80, NaN],
        grid: 10,
      }),
    ).toMatchObject({ x: -2, y: -3 })
    expect(
      smartSnapBounds(rect(3), scene, { ...settings, tolerance: 0 }).x,
    ).toBe(0)
    expect(
      smartSnapBounds(rect(0), scene, { ...settings, tolerance: NaN }).lines,
    ).toEqual([])
    expect(
      smartSnapBounds(rect(0), scene, { ...settings, zoom: 0 }).lines,
    ).toEqual([])
  })
  it('keeps fractional targets exact and gives a closer edge priority over spacing', () => {
    const scene = createSmartSnapScene([rect(10), rect(50), rect(91.25, 300)])
    const result = smartSnapBounds(rect(91.5), scene, settings)
    expect(result.x).toBe(-0.25)
    expect(result.measurements.some((m) => m.equal)).toBe(false)
  })
})
