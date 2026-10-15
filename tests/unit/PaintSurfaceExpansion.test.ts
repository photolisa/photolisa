import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import type { GroupLayer, RasterLayer } from '../../src/core/model/types'
import { createLayerBase } from '../../src/core/model/types'
import { editableRasterWorldMatrix, invertAffine, transformPoint } from '../../src/core/geometry/LayerCoordinates'
import { expandPaintSurface } from '../../src/raster/PaintSurfaceExpansion'
import { RasterSourceRegistry } from '../../src/raster/RasterSourceRegistry'

afterEach(() => vi.unstubAllGlobals())

function fixture() {
  const document = EditorDocument.create({ name: 'Paint', width: 16, height: 16, resolution: 72, background: 'transparent' })
  return { document, layer: document.layers[0] as RasterLayer, sources: new RasterSourceRegistry() }
}

describe('paint surface expansion', () => {
  it('avoids allocating for an unchanged layer and respects explicit crops', () => {
    const { document, layer, sources } = fixture()
    const inverse = invertAffine(editableRasterWorldMatrix(document.layers, layer.id)!)
    expect(expandPaintSurface(document, layer, inverse, sources)).toBeNull()
    layer.crop = { x: 0, y: 0, width: 4, height: 4, offsetX: 0, offsetY: 0 }
    layer.transform.x = 8
    expect(expandPaintSurface(document, layer, inverse, sources)).toBeNull()
  })

  it('preserves source pixel positions under nested transforms and shifts the mask with them', () => {
    const { document, layer, sources } = fixture()
    const drawImage = vi.fn()
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0,
      getContext: () => ({ drawImage, fillRect: vi.fn(), clearRect: vi.fn() }) }) })
    layer.pixelSourceId = sources.registerCanvas({ width: 16, height: 16 } as HTMLCanvasElement)
    const originalMask = sources.registerCanvas({ width: 16, height: 16 } as HTMLCanvasElement)
    layer.mask = { pixelSourceId: originalMask, enabled: true, inverted: false }
    layer.transform.x = 4
    const before = { ...layer.transform }
    const group: GroupLayer = { ...createLayerBase('group', 'group', 'Group'), kind: 'group', children: [layer] }
    group.transform.rotation = Math.PI / 2
    group.transform.x = 16
    document.layers.splice(0, 1, group)
    const world = editableRasterWorldMatrix(document.layers, layer.id)!
    const expansion = expandPaintSurface(document, layer, invertAffine(world), sources)!
    expect(sources.get(layer.pixelSourceId!)?.width).toBe(20)
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 4, -0)
    const shifted = editableRasterWorldMatrix(document.layers, layer.id)!
    const afterPoint = transformPoint(shifted, { x: 12, y: 8 })
    const beforePoint = transformPoint(world, { x: 8, y: 8 })
    expect(afterPoint.x).toBeCloseTo(beforePoint.x, 10)
    expect(afterPoint.y).toBeCloseTo(beforePoint.y, 10)
    expect(layer.mask.pixelSourceId).toBe(expansion.maskSourceId)
    expansion.restore(layer)
    expect(layer.transform).toEqual(before)
    expect(layer.mask.pixelSourceId).toBe(originalMask)
    expansion.apply(layer)
    expect(layer.mask.pixelSourceId).toBe(expansion.maskSourceId)
  })

  it('rejects excessive expansion before allocating or changing the layer', () => {
    const { document, layer, sources } = fixture()
    layer.transform.scaleX = 0.0001
    const before = { ...layer.transform }
    expect(() => expandPaintSurface(document, layer,
      invertAffine(editableRasterWorldMatrix(document.layers, layer.id)!), sources)).toThrow('dimension limit')
    expect(layer.transform).toEqual(before)
    expect(layer.pixelSourceId).toBeNull()
  })
})
