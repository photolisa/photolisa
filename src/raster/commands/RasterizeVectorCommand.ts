import { geometryBounds } from '../../core/vector/PathGeometry'
import type { Command } from '../../core/commands/Command'
import type { EditorCore } from '../../core/EditorCore'
import type { RasterLayer, VectorLayer } from '../../core/model/types'
import type { LayerLocation } from '../../core/layers/LayerManager'
import { rasterSources } from '../RasterSourceRegistry'
import { paintVector } from '../VectorPainter'

/** Replaces one editable vector layer with pixels, keeping its ID and reversible original. */
export class RasterizeVectorCommand implements Command {
  readonly label = 'Rasterize Shape'
  private byteCost = 256
  get memoryCost(): number { return this.byteCost }
  private vector: VectorLayer | null = null
  private raster: RasterLayer | null = null
  private location: LayerLocation | null = null
  private rasterActive = false
  constructor(private readonly layerId: string) {}

  execute(editor: EditorCore): void {
    if (this.raster && this.location) { editor.layers.remove(this.layerId); editor.layers.insert(this.raster, this.location.parentId, this.location.index); this.rasterActive = true; return }
    const layer = editor.layers.find(this.layerId)
    if (!layer || layer.kind !== 'vector' || layer.locked) throw new Error('Select an unlocked vector layer to rasterize.')
    if (layer.svgMatrix || layer.mask || layer.adjustments.length) throw new Error('Rasterization of vector masks, effects, or SVG matrices is not supported.')
    const bounds = geometryBounds(layer.geometry)
    const stroke = layer.style.stroke ? layer.style.strokeWidth : 0
    const pad = Math.ceil(Math.max(stroke * (layer.style.strokeJoin === 'miter' || !layer.style.strokeJoin ? 5 : layer.style.strokeAlignment === 'outside' ? 1 : .5), layer.style.startArrow || layer.style.endArrow ? Math.max(6, stroke * 4) : 0)) + 1
    const left = Math.floor(bounds.x - pad), top = Math.floor(bounds.y - pad)
    const width = Math.ceil(bounds.x + bounds.width + pad) - left
    const height = Math.ceil(bounds.y + bounds.height + pad) - top
    if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height * 4 > 128 * 1024 * 1024) throw new Error('The rasterized shape exceeds the safe 128 MiB pixel budget.')
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2D canvas is unavailable')
    context.translate(-left, -top)
    paintVector(context, layer)
    const sourceId = rasterSources.registerCanvas(canvas)
    const cosine = Math.cos(layer.transform.rotation), sine = Math.sin(layer.transform.rotation)
    const dx = left * layer.transform.scaleX, dy = top * layer.transform.scaleY
    const { geometry: _geometry, style: _style, ...base } = layer
    const raster: RasterLayer = {
      ...base, kind: 'raster', pixelSourceId: sourceId,
      transform: { ...layer.transform, x: layer.transform.x + dx * cosine - dy * sine, y: layer.transform.y + dx * sine + dy * cosine },
    }
    const location = editor.layers.locationOf(this.layerId)
    if (!location) throw new Error('Vector layer no longer exists')
    this.vector = layer; this.raster = raster; this.location = location
    editor.layers.remove(this.layerId); editor.layers.insert(raster, location.parentId, location.index)
    this.byteCost = width * height * 4
    this.rasterActive = true
  }

  undo(editor: EditorCore): void {
    if (!this.vector || !this.location) return
    editor.layers.remove(this.layerId)
    editor.layers.insert(this.vector, this.location.parentId, this.location.index)
    this.rasterActive = false
  }

  dispose(): void {
    if (!this.rasterActive && this.raster?.pixelSourceId) rasterSources.remove(this.raster.pixelSourceId)
  }
}
