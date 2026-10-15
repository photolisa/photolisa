import type { EditorCore } from '../core/EditorCore'
import type { Command } from '../core/commands/Command'
import type { Layer } from '../core/model/types'
import { editableRasterWorldMatrix, invertAffine, transformPoint, type Point } from '../core/geometry/LayerCoordinates'
import { rasterSources } from './RasterSourceRegistry'

export type RetouchMode = 'clone-stamp' | 'spot-repair'

/** One dab touches only its local rectangle and keeps a bounded undo patch. */
export class RetouchingService {
  private sample: Point | null = null
  setSample(point: Point): void { this.sample = { ...point } }
  getSample(): Point | null { return this.sample }

  dab(editor: EditorCore, point: Point, mode: RetouchMode, diameter: number, opacity: number): boolean {
    const doc = editor.document
    const layer = doc?.activeLayerId ? editor.layers.find(doc.activeLayerId) : null
    if (!doc || !layer || layer.kind !== 'raster' || layer.locked || !layer.visible) throw new Error('Select an unlocked raster layer')
    const matrix = editableRasterWorldMatrix(doc.layers, layer.id)
    if (!matrix) throw new Error('The layer cannot be retouched')
    if (mode === 'clone-stamp' && !this.sample) throw new Error('Alt-click to choose a clone sample point')
    if (!Number.isFinite(diameter) || diameter < 1 || diameter > 500) throw new Error('Invalid retouch brush size')
    const inverse = invertAffine(matrix)
    const center = transformPoint(inverse, point)
    const sample = this.sample ? transformPoint(inverse, this.sample) : null
    const source = layer.pixelSourceId ? rasterSources.get(layer.pixelSourceId) : null
    if (!source) return false
    const radius = diameter / 2
    const x = Math.max(0, Math.floor(center.x - radius - 1)), y = Math.max(0, Math.floor(center.y - radius - 1))
    const right = Math.min(source.width, Math.ceil(center.x + radius + 1)), bottom = Math.min(source.height, Math.ceil(center.y + radius + 1))
    if (right <= x || bottom <= y) return false
    const originalId = layer.pixelSourceId
    const existing = rasterSources.getEditableCanvas(originalId!)
    const copy = !existing || countReferences(doc.layers, originalId!) > 1
    const editedId = copy ? rasterSources.createEditableCopy(originalId, source.width, source.height) : originalId!
    const canvas = rasterSources.getEditableCanvas(editedId)!
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const before = context.getImageData(x, y, right - x, bottom - y)
    const after = new ImageData(new Uint8ClampedArray(before.data), before.width, before.height)
    const shiftX = sample ? sample.x - center.x : 0, shiftY = sample ? sample.y - center.y : 0
    const sampleLeft = Math.max(0, Math.floor(mode === 'clone-stamp' ? x + shiftX - 1 : center.x - radius - 3))
    const sampleTop = Math.max(0, Math.floor(mode === 'clone-stamp' ? y + shiftY - 1 : center.y - radius - 3))
    const sampleRight = Math.min(source.width, Math.ceil(mode === 'clone-stamp' ? right + shiftX + 1 : center.x + radius + 3))
    const sampleBottom = Math.min(source.height, Math.ceil(mode === 'clone-stamp' ? bottom + shiftY + 1 : center.y + radius + 3))
    if (sampleRight <= sampleLeft || sampleBottom <= sampleTop) { if (copy) rasterSources.remove(editedId); return false }
    const sampleCanvas = document.createElement('canvas')
    sampleCanvas.width = Math.max(1, sampleRight - sampleLeft); sampleCanvas.height = Math.max(1, sampleBottom - sampleTop)
    const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true })!
    sampleContext.drawImage(source.image, sampleLeft, sampleTop, sampleCanvas.width, sampleCanvas.height, 0, 0, sampleCanvas.width, sampleCanvas.height)
    const sourcePixels = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data
    const pixelAt = (px: number, py: number): [number, number, number, number] | null => {
      if (px < sampleLeft || py < sampleTop || px >= sampleRight || py >= sampleBottom) return null
      const offset = ((py - sampleTop) * sampleCanvas.width + px - sampleLeft) * 4
      return [sourcePixels[offset] ?? 0, sourcePixels[offset + 1] ?? 0, sourcePixels[offset + 2] ?? 0, sourcePixels[offset + 3] ?? 0]
    }
    const outerColor = mode === 'spot-repair' ? ringColor(pixelAt, center, radius) : null
    let changed = false
    for (let row = y; row < bottom; row++) for (let column = x; column < right; column++) {
      const distance = Math.hypot(column + 0.5 - center.x, row + 0.5 - center.y)
      if (distance > radius + 0.5) continue
      const world = transformPoint(matrix, { x: column + 0.5, y: row + 0.5 })
      const selected = (editor.selection?.coverageAt(world.x, world.y) ?? 255) / 255
      let strength = Math.max(0, Math.min(1, opacity)) * selected * Math.min(1, radius + 0.5 - distance)
      if (!strength) continue
      const offset = ((row - y) * before.width + column - x) * 4
      let sampled: number[]
      if (mode === 'clone-stamp') {
        const sx = Math.floor(column + shiftX), sy = Math.floor(row + shiftY)
        const value = pixelAt(sx, sy)
        if (!value) continue
        sampled = value
      } else {
        if (!outerColor) continue
        sampled = [outerColor[0], outerColor[1], outerColor[2], before.data[offset + 3] ?? 0]
        strength *= Math.max(0, Math.min(1, (radius - distance) / Math.max(1, radius * 0.35)))
        if (!strength) continue
        for (let channel = 0; channel < 3; channel++) after.data[offset + channel] = Math.round((before.data[offset + channel] ?? 0) * (1 - strength) + (sampled[channel] ?? 0) * strength)
        changed = true
        continue
      }
      const sourceAlpha = (sampled[3] ?? 0) / 255 * strength
      const targetAlpha = (before.data[offset + 3] ?? 0) / 255
      const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha)
      for (let channel = 0; channel < 3; channel++) after.data[offset + channel] = outAlpha
        ? Math.round(((sampled[channel] ?? 0) * sourceAlpha + (before.data[offset + channel] ?? 0) * targetAlpha * (1 - sourceAlpha)) / outAlpha) : 0
      after.data[offset + 3] = Math.round(outAlpha * 255)
      changed = true
    }
    if (!changed) { if (copy) rasterSources.remove(editedId); return false }
    context.putImageData(after, x, y)
    rasterSources.touch(editedId, { x, y, width: before.width, height: before.height })
    if (copy) layer.pixelSourceId = editedId
    editor.commitExecuted(new RetouchPatchCommand(mode === 'clone-stamp' ? 'Clone Stamp' : 'Spot Repair', layer.id, originalId, editedId,
      { x, y, width: before.width, height: before.height }, copy ? null : before, copy ? null : after,
      copy ? source.width * source.height * 4 : before.data.byteLength + after.data.byteLength))
    return true
  }
}

function ringColor(pixelAt: (x: number, y: number) => [number, number, number, number] | null, center: Point, radius: number): [number, number, number] | null {
  const samples: number[][] = []
  const count = Math.max(16, Math.ceil(radius * 6))
  for (let i = 0; i < count; i++) {
    const angle = i * Math.PI * 2 / count
    const x = Math.floor(center.x + Math.cos(angle) * (radius + 2)), y = Math.floor(center.y + Math.sin(angle) * (radius + 2))
    const pixel = pixelAt(x, y)
    if (!pixel || pixel[3] < 32) continue
    samples.push(pixel.slice(0, 3))
  }
  if (!samples.length) return null
  return [0, 1, 2].map((channel) => {
    const sorted = samples.map((sample) => sample[channel] ?? 0).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? 0
  }) as [number, number, number]
}

class RetouchPatchCommand implements Command {
  constructor(readonly label: string, private readonly layerId: string, private readonly original: string | null, private readonly edited: string,
    private readonly rect: { x: number; y: number; width: number; height: number }, private readonly before: ImageData | null, private readonly after: ImageData | null, readonly memoryCost: number) {}
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

function countReferences(layers: readonly Layer[], id: string): number {
  return layers.reduce((sum, layer) => sum + (layer.kind === 'group' ? countReferences(layer.children, id) : layer.kind === 'raster' && layer.pixelSourceId === id ? 1 : 0), 0)
}
