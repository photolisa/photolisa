import { describe, expect, it } from 'vitest'
import { Viewport } from '../../src/renderer/Viewport'

describe('Viewport', () => {
  it('keeps the document point under the cursor fixed while zooming', () => {
    const viewport = new Viewport()
    viewport.resize({ width: 1000, height: 700 })
    viewport.setDocument({ width: 800, height: 600 })
    const cursor = { x: 325, y: 280 }
    const before = viewport.screenToDocument(cursor)

    viewport.setZoomAt(viewport.zoom * 2.5, cursor)

    expect(viewport.screenToDocument(cursor).x).toBeCloseTo(before.x, 8)
    expect(viewport.screenToDocument(cursor).y).toBeCloseTo(before.y, 8)
  })

  it('preserves the document point at the viewport center when resized', () => {
    const viewport = new Viewport()
    viewport.resize({ width: 1000, height: 700 })
    viewport.setDocument({ width: 1600, height: 900 })
    viewport.panBy({ x: 83, y: -47 })
    const centerBefore = viewport.screenToDocument({ x: 500, y: 350 })

    viewport.resize({ width: 1400, height: 900 })

    const centerAfter = viewport.screenToDocument({ x: 700, y: 450 })
    expect(centerAfter.x).toBeCloseTo(centerBefore.x, 8)
    expect(centerAfter.y).toBeCloseTo(centerBefore.y, 8)
  })

  it('fits the document without scaling above actual size', () => {
    const viewport = new Viewport()
    viewport.resize({ width: 1200, height: 800 })
    viewport.setDocument({ width: 400, height: 300 })
    expect(viewport.zoom).toBe(1)

    viewport.setDocument({ width: 2400, height: 1600 })
    expect(viewport.zoom).toBeLessThan(0.5)
  })
})
