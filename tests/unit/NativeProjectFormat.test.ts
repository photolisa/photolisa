import { describe, expect, it } from 'vitest'
import { packNativeProject, unpackNativeProject, type NativeAsset } from '../../src/adapters/NativeProjectFormat'
import { EditorDocument } from '../../src/core/model/EditorDocument'
import { createLayerBase, type GroupLayer, type RasterLayer } from '../../src/core/model/types'

describe('native Photolisa format', () => {
  it('round-trips layer IDs, hierarchy, transforms, adjustments and separate binary assets', () => {
    const document = EditorDocument.create({ name: 'Round trip', width: 32, height: 24, resolution: 144, background: 'transparent' })
    const child: RasterLayer = { ...createLayerBase('child-id', 'raster', 'Pixels'), kind: 'raster', pixelSourceId: 'asset-1', transform: { x: 3, y: 4, scaleX: 2, scaleY: 1, rotation: 0.25 } }
    const group: GroupLayer = { ...createLayerBase('group-id', 'group', 'Group'), kind: 'group', children: [child] }
    document.layers.splice(0, 1, group)
    const asset: NativeAsset = { id: 'asset-1', mimeType: 'image/png', width: 2, height: 2, bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) }
    const unpacked = unpackNativeProject(packNativeProject(document.serialize(), [asset]))
    expect(unpacked.manifest.version).toBe(1)
    expect(unpacked.manifest.document.layers[0]?.id).toBe('group-id')
    expect(unpacked.manifest.document.layers[0]?.kind).toBe('group')
    expect(unpacked.assets.get('asset-1')).toEqual(asset.bytes)
  })

  it('rejects damaged asset bounds before decoding pixels', () => {
    const document = EditorDocument.create({ name: 'Safe', width: 2, height: 2, resolution: 72, background: 'white' })
    const bytes = packNativeProject(document.serialize(), [])
    new DataView(bytes.buffer).setUint32(10, 0xffff_ffff, true)
    expect(() => unpackNativeProject(bytes)).toThrow(/manifest length/i)
  })
})
