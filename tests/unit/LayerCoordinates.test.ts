import { describe, expect, it } from 'vitest'
import { createLayerBase, type GroupLayer, type RasterLayer } from '../../src/core/model/types'
import { editableRasterWorldMatrix, invertAffine, transformPoint } from '../../src/core/geometry/LayerCoordinates'

describe('raster layer coordinates', () => {
  it('inverts the same nested transform used by the renderer', () => {
    const raster: RasterLayer = {
      ...createLayerBase('paint', 'raster', 'Paint'), kind: 'raster', pixelSourceId: null,
      transform: { x: 3, y: 4, scaleX: 2, scaleY: 2, rotation: 0 },
      svgMatrix: [1, 0, 0, 1, 5, 6],
    }
    const group: GroupLayer = {
      ...createLayerBase('group', 'group', 'Group'), kind: 'group', children: [raster],
      transform: { x: 100, y: 20, scaleX: 1, scaleY: 1, rotation: Math.PI / 2 },
    }
    const matrix = editableRasterWorldMatrix([group], raster.id)
    expect(matrix).not.toBeNull()
    const source = { x: 7.5, y: 9.5 }
    const documentPoint = transformPoint(matrix!, source)
    const recovered = transformPoint(invertAffine(matrix!), documentPoint)
    expect(recovered.x).toBeCloseTo(source.x, 8)
    expect(recovered.y).toBeCloseTo(source.y, 8)
  })

  it('rejects raster edits through hidden or locked ancestors', () => {
    const raster: RasterLayer = { ...createLayerBase('paint', 'raster', 'Paint'), kind: 'raster', pixelSourceId: null }
    const group: GroupLayer = { ...createLayerBase('group', 'group', 'Group'), kind: 'group', children: [raster] }
    expect(editableRasterWorldMatrix([group], raster.id)).not.toBeNull()
    group.visible = false
    expect(editableRasterWorldMatrix([group], raster.id)).toBeNull()
    group.visible = true
    group.locked = true
    expect(editableRasterWorldMatrix([group], raster.id)).toBeNull()
  })
})
