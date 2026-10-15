import type { Command } from '../core/commands/Command'
import type { EditorCore } from '../core/EditorCore'
import { editableRasterWorldMatrix, invertAffine, transformPoint, type Point } from '../core/geometry/LayerCoordinates'
import { rasterSources } from './RasterSourceRegistry'

const MAX_FILL_PIXELS = 8_388_608

/** Contiguous RGBA flood fill. The source is copied once so undo never needs a full-size pixel patch. */
export class PaintBucketService {
  fill(editor: EditorCore, point: Point, color: readonly [number, number, number, number], tolerance: number, opacity: number): boolean {
    const doc = editor.document
    const layer = doc?.activeLayerId ? editor.layers.find(doc.activeLayerId) : null
    if (!doc || !layer || layer.kind !== 'raster' || !layer.visible || layer.locked || editor.maskEditingLayerId === layer.id)
      throw new Error('Select an unlocked raster layer thumbnail before using the paint bucket')
    const matrix = editableRasterWorldMatrix(doc.layers, layer.id)
    if (!matrix) throw new Error('The layer cannot be filled')
    if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 255 || !Number.isFinite(opacity) || opacity < 0 || opacity > 1)
      throw new Error('Invalid paint bucket settings')
    if (color.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error('Invalid fill color')
    if (opacity === 0 || color[3] === 0) return false
    const originalId = layer.pixelSourceId
    const source = originalId ? rasterSources.get(originalId) : null
    if (!originalId || !source) throw new Error('The active raster layer has no pixels')
    const pixelCount = source.width * source.height
    if (pixelCount > MAX_FILL_PIXELS) throw new Error('Paint bucket is limited to raster layers of 8 million pixels')
    const local = transformPoint(invertAffine(matrix), point)
    const seedX = Math.floor(local.x), seedY = Math.floor(local.y)
    if (seedX < 0 || seedY < 0 || seedX >= source.width || seedY >= source.height) return false
    if (editor.selection && editor.selection.coverageAt(point.x, point.y) === 0) return false
    const editedId = rasterSources.createEditableCopy(originalId, source.width, source.height)
    try {
      const canvas = rasterSources.getEditableCanvas(editedId)!
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      const image = context.getImageData(0, 0, source.width, source.height)
      const pixels = image.data
      const seed = seedY * source.width + seedX
      const target = rgbaAt(pixels, seed)
      const visited = new Uint8Array(pixelCount)
      const queue = new Int32Array(pixelCount)
      let head = 0, tail = 0, changed = false
      queue[tail++] = seed; visited[seed] = 1
      let left = source.width, top = source.height, right = 0, bottom = 0
      function enqueue(index: number): void { if (!visited[index]) { visited[index] = 1; queue[tail++] = index } }
      while (head < tail) {
        const index = queue[head++]!
        if (!matches(pixels, index, target, tolerance)) continue
        const x = index % source.width, y = Math.floor(index / source.width)
        const world = transformPoint(matrix, { x: x + 0.5, y: y + 0.5 })
        const selected = (editor.selection?.coverageAt(world.x, world.y) ?? 255) / 255
        if (!selected) continue
        const strength = selected * opacity * color[3] / 255
        if (strength) {
          const offset = index * 4
          const before = [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]]
          blendPixel(pixels, offset, color, strength)
          if (before.some((value, channel) => value !== pixels[offset + channel])) {
            changed = true
            left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1)
          }
        }
        if (x > 0) enqueue(index - 1)
        if (x + 1 < source.width) enqueue(index + 1)
        if (y > 0) enqueue(index - source.width)
        if (y + 1 < source.height) enqueue(index + source.width)
      }
      if (!changed) { rasterSources.remove(editedId); return false }
      context.putImageData(image, 0, 0, left, top, right - left, bottom - top)
      rasterSources.touch(editedId, { x: left, y: top, width: right - left, height: bottom - top })
      layer.pixelSourceId = editedId
      editor.commitExecuted(new PaintBucketCommand(layer.id, originalId, editedId, pixelCount * 4))
      return true
    } catch (error) { rasterSources.remove(editedId); throw error }
  }
}

class PaintBucketCommand implements Command {
  readonly label = 'Paint Bucket'
  constructor(private readonly layerId: string, private readonly originalId: string, private readonly editedId: string, readonly memoryCost: number) {}
  execute(editor: EditorCore): void { this.apply(editor, this.editedId) }
  undo(editor: EditorCore): void { this.apply(editor, this.originalId) }
  private apply(editor: EditorCore, id: string): void {
    const layer = editor.layers.find(this.layerId)
    if (!layer || layer.kind !== 'raster') return
    layer.pixelSourceId = id
    editor.markDocumentChanged()
  }
}

function rgbaAt(data: Uint8ClampedArray, index: number): readonly [number, number, number, number] {
  const offset = index * 4
  return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0]
}

function matches(data: Uint8ClampedArray, index: number, target: readonly number[], tolerance: number): boolean {
  const offset = index * 4, alpha = data[offset + 3] ?? 0
  if (Math.abs(alpha - target[3]!) > tolerance) return false
  if (alpha === 0 && target[3] === 0) return true
  return Math.max(Math.abs((data[offset] ?? 0) - target[0]!), Math.abs((data[offset + 1] ?? 0) - target[1]!), Math.abs((data[offset + 2] ?? 0) - target[2]!)) <= tolerance
}

function blendPixel(data: Uint8ClampedArray, offset: number, color: readonly number[], strength: number): void {
  const oldAlpha = (data[offset + 3] ?? 0) / 255
  const outAlpha = strength + oldAlpha * (1 - strength)
  for (let channel = 0; channel < 3; channel++) data[offset + channel] = outAlpha
    ? Math.round(((color[channel] ?? 0) * strength + (data[offset + channel] ?? 0) * oldAlpha * (1 - strength)) / outAlpha) : 0
  data[offset + 3] = Math.round(outAlpha * 255)
}
