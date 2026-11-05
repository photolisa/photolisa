// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { isPenEraser, pressureOf, strokeSamples } from '../../src/tools/TabletInput'

describe('tablet pointer input', () => {
  it('recognizes the standard eraser button and bitmask only for pens', () => {
    expect(isPenEraser({ pointerType: 'pen', button: 5, buttons: 0 })).toBe(true)
    expect(isPenEraser({ pointerType: 'pen', button: -1, buttons: 32 })).toBe(true)
    expect(isPenEraser({ pointerType: 'pen', button: 2, buttons: 2 })).toBe(false)
    expect(isPenEraser({ pointerType: 'mouse', button: 5, buttons: 32 })).toBe(false)
  })

  it('preserves pen pressure and bounds invalid samples with constant mouse/touch pressure', () => {
    for (const pointerType of ['mouse', 'touch', '']) expect(pressureOf({ pointerType, pressure: .5 })).toBe(1)
    for (const pressure of [0, .01, .25, .5, 1]) expect(pressureOf({ pointerType: 'pen', pressure })).toBe(pressure)
    expect(pressureOf({ pointerType: 'pen', pressure: 2 })).toBe(1)
    for (const pressure of [NaN, Infinity, -1]) expect(pressureOf({ pointerType: 'pen', pressure })).toBe(0)
  })

  it('uses ordered coalesced contact samples, excluding hover and other pointers', () => {
    const light = new PointerEvent('pointermove', { pointerType: 'pen', pointerId: 7, buttons: 1, pressure: .2 })
    const heavy = new PointerEvent('pointermove', { pointerType: 'pen', pointerId: 7, buttons: 1, pressure: .9 })
    const hover = new PointerEvent('pointermove', { pointerType: 'pen', pointerId: 7 })
    const palm = new PointerEvent('pointermove', { pointerType: 'touch', pointerId: 8, buttons: 1 })
    Object.defineProperty(heavy, 'getCoalescedEvents', { value: () => [light, palm, hover, heavy] })
    expect(strokeSamples(heavy)).toEqual([light, heavy])
    expect(strokeSamples(hover)).toEqual([])
  })

  it('falls back to the dispatched event and accepts eraser contact', () => {
    const eraser = new PointerEvent('pointermove', { pointerType: 'pen', buttons: 32 })
    Object.defineProperty(eraser, 'getCoalescedEvents', { value: () => [] })
    expect(strokeSamples(eraser)).toEqual([eraser])
    expect(strokeSamples(new PointerEvent('pointermove', { pointerType: 'mouse', buttons: 1 }))).toHaveLength(1)
  })
})
