import { describe, expect, it } from 'vitest'
import { RasterSourceRegistry } from '../../src/raster/RasterSourceRegistry'

describe('RasterSourceRegistry dirty regions', () => {
  it('unions changed areas and consumes them once', () => {
    const registry = new RasterSourceRegistry()
    const id = registry.registerCanvas({ width: 100, height: 100 } as HTMLCanvasElement)
    registry.touch(id, { x: 4, y: 8, width: 10, height: 10 })
    registry.touch(id, { x: 12, y: 6, width: 5, height: 4 })
    expect(registry.get(id)?.revision).toBe(2)
    expect(registry.takeDirty(id)).toEqual({ x: 4, y: 6, width: 13, height: 12 })
    expect(registry.takeDirty(id)).toBeNull()
    registry.touch(id)
    registry.touch(id, { x: 1, y: 1, width: 1, height: 1 })
    expect(registry.takeDirty(id)).toBeNull()
  })
})
