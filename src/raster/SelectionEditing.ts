import type { EditorCore } from '../core/EditorCore'
import type { Command } from '../core/commands/Command'
import { createEntityId } from '../core/model/EditorDocument'
import { createLayerBase, type Layer, type RasterLayer } from '../core/model/types'
import type { SelectionRect } from '../core/selection/SelectionMask'
import { editableRasterWorldMatrix, invertAffine, transformPoint } from '../core/geometry/LayerCoordinates'
import { rasterSources } from './RasterSourceRegistry'

export interface PixelClipboard { x: number; y: number; image: ImageData }

/** Document-space clipboard retains the selection's fractional alpha. */
export class SelectionEditing {
  private clipboard: PixelClipboard | null = null

  copy(editor: EditorCore): PixelClipboard {
    const { source, matrix, bounds } = this.target(editor)
    const canvas = document.createElement('canvas')
    canvas.width = bounds.width; canvas.height = bounds.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D canvas is unavailable')
    context.translate(-bounds.x, -bounds.y)
    context.transform(...matrix)
    if (source) context.drawImage(source.image, 0, 0)
    const image = context.getImageData(0, 0, bounds.width, bounds.height)
    const selection = editor.selection!
    for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
      const i = (y * bounds.width + x) * 4 + 3
      image.data[i] = Math.round((image.data[i] ?? 0) * selection.coverageAt(bounds.x + x, bounds.y + y) / 255)
    }
    this.clipboard = { x: bounds.x, y: bounds.y, image }
    return this.clipboard
  }

  cut(editor: EditorCore): PixelClipboard { const copied = this.copy(editor); this.mutate(editor, 'Cut Selection', null); return copied }
  delete(editor: EditorCore): void { this.mutate(editor, 'Delete Selection', null) }
  fill(editor: EditorCore, color: readonly [number, number, number, number]): void { this.mutate(editor, 'Fill Selection', color) }

  paste(editor: EditorCore, external?: PixelClipboard): void {
    const clipboard = external ?? this.clipboard
    if (!clipboard || !editor.document) throw new Error('The image clipboard is empty')
    const { x, y, image } = clipboard
    if (image.width * image.height > 67_108_864) throw new Error('Pasted image is too large')
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d'); if (!context) throw new Error('2D canvas is unavailable')
    context.putImageData(image, 0, 0)
    const sourceId = rasterSources.registerCanvas(canvas)
    const layer: RasterLayer = { ...createLayerBase(createEntityId(), 'raster', 'Pasted pixels'), kind: 'raster', pixelSourceId: sourceId }
    layer.transform.x = x; layer.transform.y = y
    editor.execute(new PastePixelsCommand(layer, image.data.byteLength))
  }

  getClipboard(): PixelClipboard | null { return this.clipboard }

  private target(editor: EditorCore) {
    const doc = editor.document, selection = editor.selection
    if (!doc || !selection || selection.isEmpty || !selection.outlineBounds) throw new Error('Select an area first')
    const layer = doc.activeLayerId ? editor.layers.find(doc.activeLayerId) : null
    if (!layer || layer.kind !== 'raster' || layer.locked || !layer.visible) throw new Error('Select an unlocked raster layer')
    const matrix = editableRasterWorldMatrix(doc.layers, layer.id)
    if (!matrix) throw new Error('The layer cannot be edited')
    const source = layer.pixelSourceId ? rasterSources.get(layer.pixelSourceId) : undefined
    const rect = selection.outlineBounds
    const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y))
    const right = Math.min(doc.dimensions.width, Math.ceil(rect.x + rect.width))
    const bottom = Math.min(doc.dimensions.height, Math.ceil(rect.y + rect.height))
    return { layer, source, matrix, bounds: { x, y, width: right - x, height: bottom - y } }
  }

  private mutate(editor: EditorCore, label: string, color: readonly [number, number, number, number] | null): void {
    const { layer, source, matrix, bounds } = this.target(editor)
    const doc = editor.document!, selection = editor.selection!
    const inverse = invertAffine(matrix)
    const width = source?.width ?? doc.dimensions.width, height = source?.height ?? doc.dimensions.height
    const points = [
      { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x, y: bounds.y + bounds.height }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    ].map((p) => transformPoint(inverse, p))
    const left = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x)) - 1))
    const top = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y)) - 1))
    const right = Math.min(width, Math.ceil(Math.max(...points.map((p) => p.x)) + 1))
    const bottom = Math.min(height, Math.ceil(Math.max(...points.map((p) => p.y)) + 1))
    if (right <= left || bottom <= top) return
    const area = (right - left) * (bottom - top)
    if (area > 67_108_864) throw new Error('Selection edit exceeds the pixel safety limit')
    const originalId = layer.pixelSourceId
    const editable = originalId ? rasterSources.getEditableCanvas(originalId) : null
    const shared = originalId ? referenceCount(doc.layers, originalId) > 1 : false
    const copied = !editable || shared
    const id = copied ? rasterSources.createEditableCopy(originalId, width, height) : originalId!
    const canvas = rasterSources.getEditableCanvas(id)!
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const before = context.getImageData(left, top, right - left, bottom - top)
    const after = new ImageData(new Uint8ClampedArray(before.data), before.width, before.height)
    let changed = false
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const point = transformPoint(matrix, { x: x + 0.5, y: y + 0.5 })
      const coverage = selection.coverageAt(point.x, point.y) / 255
      if (!coverage) continue
      const i = ((y - top) * before.width + x - left) * 4
      if (color) {
        const strength = coverage * color[3] / 255
        const oldAlpha = (before.data[i + 3] ?? 0) / 255
        const outAlpha = strength + oldAlpha * (1 - strength)
        for (let channel = 0; channel < 3; channel++) {
          const old = before.data[i + channel] ?? 0
          after.data[i + channel] = outAlpha ? Math.round(((color[channel] ?? 0) * strength + old * oldAlpha * (1 - strength)) / outAlpha) : 0
        }
        after.data[i + 3] = Math.round(outAlpha * 255)
      } else after.data[i + 3] = Math.round((before.data[i + 3] ?? 0) * (1 - coverage))
      changed = true
    }
    if (!changed) { if (copied) rasterSources.remove(id); return }
    context.putImageData(after, left, top)
    rasterSources.touch(id, { x: left, y: top, width: before.width, height: before.height })
    if (copied) layer.pixelSourceId = id
    editor.commitExecuted(new SelectionPixelCommand(label, layer.id, originalId, id, { x: left, y: top, width: before.width, height: before.height }, copied ? null : before, copied ? null : after, copied ? width * height * 4 : before.data.byteLength + after.data.byteLength))
  }
}

class SelectionPixelCommand implements Command {
  constructor(readonly label: string, private readonly layerId: string, private readonly original: string | null, private readonly edited: string,
    private readonly rect: SelectionRect, private readonly before: ImageData | null, private readonly after: ImageData | null, readonly memoryCost: number) {}
  execute(editor: EditorCore): void { this.apply(editor, this.edited, this.after) }
  undo(editor: EditorCore): void { this.apply(editor, this.original, this.before) }
  private apply(editor: EditorCore, id: string | null, pixels: ImageData | null): void {
    const layer = editor.layers.find(this.layerId)
    if (!layer || layer.kind !== 'raster') return
    layer.pixelSourceId = id
    if (pixels && id) { rasterSources.getEditableCanvas(id)?.getContext('2d')?.putImageData(pixels, this.rect.x, this.rect.y); rasterSources.touch(id, this.rect) }
    editor.markDocumentChanged()
  }
}

class PastePixelsCommand implements Command {
  readonly label = 'Paste Pixels'
  private index: number | undefined
  readonly memoryCost: number
  constructor(private readonly layer: RasterLayer, bytes: number) { this.memoryCost = bytes }
  execute(editor: EditorCore): void { this.index = editor.layers.insert(this.layer, null, this.index).index }
  undo(editor: EditorCore): void { editor.layers.remove(this.layer.id) }
}

function referenceCount(layers: readonly Layer[], id: string): number {
  return layers.reduce((sum, layer) => sum + (layer.kind === 'group' ? referenceCount(layer.children, id) : layer.kind === 'raster' && layer.pixelSourceId === id ? 1 : 0), 0)
}
