import { describe, expect, it, vi } from 'vitest'
import { EditorCore } from '../../src/core/EditorCore'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import { createEntityId, cloneLayerTree } from '../../src/core/model/EditorDocument'
import { createLayerBase, type GroupLayer, type RasterLayer, type VectorLayer } from '../../src/core/model/types'
import { filterRegistry } from '../../src/core/filters/FilterRegistry'
import { LayerTransferService, type LayerAssetTransfer } from '../../src/core/layers/LayerTransferService'

function editor(name: string, width: number, height: number): EditorCore {
  const core = new EditorCore()
  core.setDocument(EditorDocument.create({ name, width, height, resolution: 72, background: 'transparent' }))
  return core
}

function assets(): LayerAssetTransfer & { prepared: string[]; rolledBack: string[] } {
  return {
    prepared: [], rolledBack: [],
    prepare(id) { this.prepared.push(id); return id.startsWith('immutable') ? id : `private-${id}` },
    rollback(id) { this.rolledBack.push(id) },
  }
}

describe('LayerTransferService', () => {
  it('copies nested raster and vector layers, effects, masks, transforms and order with fresh IDs', () => {
    const source = editor('Source', 800, 600)
    const destination = editor('Destination', 1200, 900)
    const raster: RasterLayer = {
      ...createLayerBase(createEntityId(), 'raster', 'Photo'), kind: 'raster', pixelSourceId: 'immutable-photo',
      opacity: 0.42, blendMode: 'multiply', mask: { pixelSourceId: 'mask-1', enabled: true, inverted: false },
      adjustments: [filterRegistry.create('exposure', { stops: 1.5 })],
      transform: { x: 28, y: 37, scaleX: 1.25, scaleY: 0.8, rotation: 0.4 },
    }
    const vector: VectorLayer = {
      ...createLayerBase(createEntityId(), 'vector', 'Path'), kind: 'vector',
      geometry: { type: 'path', d: 'M 0 0 L 10 10' },
      style: { fill: '#ff0000', stroke: '#000000', strokeWidth: 2, fillRule: 'nonzero' },
    }
    const group: GroupLayer = { ...createLayerBase(createEntityId(), 'group', 'Artwork'), kind: 'group', children: [raster, vector] }
    source.layers.insert(group)
    const before = cloneLayerTree(source.document!.layers)
    const bridge = assets()
    const result = new LayerTransferService(bridge).transfer({ source, destination, layerIds: [vector.id, group.id], mode: 'copy' })
    expect(result.sourceIds).toEqual([group.id])
    expect(source.document!.layers).toEqual(before)
    const copied = destination.layers.find(result.destinationIds[0]!) as GroupLayer
    expect(copied.kind).toBe('group')
    expect(copied.children.map((child) => child.name)).toEqual(['Photo', 'Path'])
    expect(new Set([copied.id, ...copied.children.map((child) => child.id)]).size).toBe(3)
    expect(copied.children[0]).toMatchObject({ opacity: 0.42, blendMode: 'multiply', transform: raster.transform, pixelSourceId: 'immutable-photo', mask: { pixelSourceId: 'private-mask-1' } })
    expect(copied.children[0]?.adjustments[0]).toMatchObject({ kind: 'exposure', parameters: { stops: 1.5 } })
    expect(copied.children[0]?.adjustments[0]?.id).not.toBe(raster.adjustments[0]?.id)
    expect(copied.children[1]).toMatchObject({ geometry: vector.geometry, style: vector.style })
    expect(bridge.prepared).toEqual(['mask-1', 'immutable-photo'])
    destination.undo()
    expect(destination.layers.find(copied.id)).toBeNull()
    destination.redo()
    expect(destination.layers.find(copied.id)).toBe(copied)
  })

  it('moves multiple roots in document order and restores source with undo', () => {
    const source = editor('Source', 200, 100)
    const destination = editor('Destination', 400, 300)
    const first = source.document!.layers[0]!
    first.transform.x = 12
    const second = source.layers.createEmptyLayer('Second')
    const third = source.layers.createEmptyLayer('Third')
    source.layers.insert(second)
    source.layers.insert(third)
    const bridge = assets()
    const result = new LayerTransferService(bridge).transfer({ source, destination, layerIds: [third.id, first.id], mode: 'move', centerInDestination: true })
    expect(result.sourceIds).toEqual([first.id, third.id])
    expect(source.document!.layers.map((layer) => layer.id)).toEqual([second.id])
    const transferred = result.destinationIds.map((id) => destination.layers.find(id)!)
    expect(transferred.map((layer) => layer.name)).toEqual([first.name, third.name])
    expect(transferred[0]?.transform).toMatchObject({ x: 112, y: 100 })
    source.undo()
    expect(source.document!.layers.map((layer) => layer.id)).toEqual([first.id, second.id, third.id])
    destination.undo()
    expect(result.destinationIds.every((id) => !destination.layers.find(id))).toBe(true)
    source.redo()
    destination.redo()
    expect(source.document!.layers.map((layer) => layer.id)).toEqual([second.id])
    expect(destination.layers.find(result.destinationIds[0]!)).not.toBeNull()
  })

  it('preserves stacking order when transferring roots from different parents into a destination group', () => {
    const source = editor('Source', 300, 200)
    const destination = editor('Destination', 600, 400)
    const nested = source.layers.createEmptyLayer('Nested')
    const sourceGroup: GroupLayer = { ...createLayerBase(createEntityId(), 'group', 'Source Group'), kind: 'group', children: [nested] }
    const top = source.layers.createEmptyLayer('Top')
    source.layers.insert(sourceGroup)
    source.layers.insert(top)
    const destinationGroup: GroupLayer = { ...createLayerBase(createEntityId(), 'group', 'Destination Group'), kind: 'group', children: [] }
    destination.layers.insert(destinationGroup)
    const result = new LayerTransferService(assets()).transfer({ source, destination, layerIds: [top.id, nested.id], mode: 'copy', parentId: destinationGroup.id })
    expect(result.sourceIds).toEqual([nested.id, top.id])
    expect(destinationGroup.children.map((layer) => layer.name)).toEqual(['Nested', 'Top'])
    expect(sourceGroup.children[0]).toBe(nested)
  })

  it('distinguishes duplication from a plain copy by naming destination roots', () => {
    const source = editor('Source', 100, 100)
    const destination = editor('Destination', 200, 200)
    const id = source.document!.layers[0]!.id
    const result = new LayerTransferService(assets()).transfer({ source, destination, layerIds: [id], mode: 'duplicate' })
    expect(destination.layers.find(result.destinationIds[0]!)?.name).toBe('Layer 1 copy')
    expect(source.layers.find(id)?.name).toBe('Layer 1')
  })

  it('leaves the source untouched when preparation or destination validation fails', () => {
    const source = editor('Source', 100, 100)
    const destination = editor('Destination', 200, 200)
    const layer = source.document!.layers[0] as RasterLayer
    layer.pixelSourceId = 'missing'
    const before = source.document!.serialize()
    const service = new LayerTransferService({ prepare() { throw new Error('Asset unavailable') }, rollback() {} })
    expect(() => service.transfer({ source, destination, layerIds: [layer.id], mode: 'move' })).toThrow('Asset unavailable')
    expect(source.document!.serialize()).toEqual(before)
    expect(destination.document!.layers).toHaveLength(1)
    expect(source.history.canUndo).toBe(false)
  })

  it('rolls back destination insertion and prepared assets when source removal fails', () => {
    const source = editor('Source', 100, 100)
    const destination = editor('Destination', 200, 200)
    const layer = source.document!.layers[0] as RasterLayer
    layer.pixelSourceId = 'editable-photo'
    const before = source.document!.serialize()
    const bridge = assets()
    vi.spyOn(source.layers, 'remove').mockImplementation(() => { throw new Error('Removal failed') })
    expect(() => new LayerTransferService(bridge).transfer({ source, destination, layerIds: [layer.id], mode: 'move' })).toThrow('Removal failed')
    expect(source.document!.serialize()).toEqual(before)
    expect(destination.document!.layers).toHaveLength(1)
    expect(destination.history.canUndo).toBe(false)
    expect(destination.isDirty).toBe(false)
    expect(source.isDirty).toBe(false)
    expect(bridge.rolledBack).toEqual(['private-editable-photo'])
  })
})
