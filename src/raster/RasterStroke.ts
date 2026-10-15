import type { Command } from '../core/commands/Command'
import type { EditorCore } from '../core/EditorCore'
import type { EditorDocument } from '../core/model/EditorDocument'
import type { Layer, RasterLayer } from '../core/model/types'
import { rasterSources, type RasterSourceRegistry } from './RasterSourceRegistry'
import { accumulateCoverage, composeStrokePixel, pencilLine } from './StrokeMath'
import { editableRasterWorldMatrix, invertAffine, transformPoint } from '../core/geometry/LayerCoordinates'
import type { AffineMatrix } from '../core/model/types'
import { expandPaintSurface, type PaintSurfaceExpansion } from './PaintSurfaceExpansion'
import type { SelectionMask } from '../core/selection/SelectionMask'

const TILE_SIZE = 128

export interface DocumentPoint { x: number; y: number }
export interface DocumentRect { x: number; y: number; width: number; height: number }
export interface BrushSettings { diameter: number; hardness: number; opacity: number; color: string; colorAlpha?: number; flow?: number; spacing?: number }
export interface PencilSettings { diameter: number; opacity: number; color: string; colorAlpha?: number; pixelGrid?: boolean }
export type StrokeMode = 'brush' | 'pencil' | 'eraser'

interface TilePatch { x: number; y: number; before: ImageData; after: ImageData }

export class RasterStrokeService {
  constructor(private readonly sources: RasterSourceRegistry = rasterSources) {}

  begin(
    editorDocument: EditorDocument,
    layer: RasterLayer,
    settings: BrushSettings | PencilSettings,
    mode: StrokeMode,
    selection: SelectionMask | null,
    target: 'pixels' | 'mask' = 'pixels',
  ): RasterStrokeSession {
    let worldMatrix = editableRasterWorldMatrix(editorDocument.layers, layer.id)
    if (!worldMatrix) throw new Error('Select a visible, unlocked raster layer before painting.')
    let inverseMatrix = invertAffine(worldMatrix)
    const targetId = target === 'mask' ? layer.mask?.pixelSourceId ?? null : layer.pixelSourceId
    if (target === 'mask' && !layer.mask) throw new Error('Add a mask before painting it')
    const expansion = target === 'pixels' && mode !== 'eraser'
      ? expandPaintSurface(editorDocument, layer, inverseMatrix, this.sources) : null
    if (expansion) {
      worldMatrix = editableRasterWorldMatrix(editorDocument.layers, layer.id)!
      inverseMatrix = invertAffine(worldMatrix)
    }
    const effectiveId = expansion ? layer.pixelSourceId : targetId
    const source = effectiveId ? this.sources.get(effectiveId) : undefined
    const references = effectiveId ? countSourceReferences(editorDocument.layers, effectiveId) : 0
    const existingCanvas = effectiveId ? this.sources.getEditableCanvas(effectiveId) : null
    const mustCopy = !existingCanvas || references > 1
    const originalSourceId = targetId
    if (mustCopy) {
      const copied = this.sources.createEditableCopy(
        effectiveId,
        source?.width ?? editorDocument.dimensions.width,
        source?.height ?? editorDocument.dimensions.height,
      )
      if (target === 'mask') layer.mask!.pixelSourceId = copied
      else layer.pixelSourceId = copied
    }
    const editedId = target === 'mask' ? layer.mask!.pixelSourceId : layer.pixelSourceId
    const canvas = this.sources.getEditableCanvas(editedId ?? '')
    if (!canvas || !editedId) throw new Error('The active layer could not be made editable')
    return new RasterStrokeSession(layer, canvas, originalSourceId, editedId, settings, mode, selection, this.sources, worldMatrix, inverseMatrix, target, expansion, editorDocument.dimensions)
  }
}

export class RasterStrokeSession {
  private readonly context: CanvasRenderingContext2D
  private readonly tiles = new Map<string, { x: number; y: number; before: ImageData; after: ImageData; coverage: Uint8Array }>()
  private readonly dirtyTiles = new Set<string>()
  private lastPoint: { local: DocumentPoint; pressure: number } | null = null
  private distanceToNextDab = 0
  private ended = false
  private pendingDirty: DocumentRect | null = null
  private readonly color: readonly [number, number, number]
  private readonly colorAlpha: number
  private hasPainted = false

  constructor(
    private readonly layer: RasterLayer,
    private readonly canvas: HTMLCanvasElement,
    private readonly originalSourceId: string | null,
    readonly sourceId: string,
    private readonly settings: BrushSettings | PencilSettings,
    private readonly mode: StrokeMode,
    private readonly selection: SelectionMask | null,
    private readonly sources: RasterSourceRegistry,
    private readonly worldMatrix: AffineMatrix,
    private readonly inverseMatrix: AffineMatrix,
    private readonly target: 'pixels' | 'mask',
    private readonly expansion: PaintSurfaceExpansion | null,
    private readonly documentBounds: { width: number; height: number },
  ) {
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D canvas is unavailable')
    this.context = context
    this.color = parseColor(settings.color)
    this.colorAlpha = Math.max(0, Math.min(1, settings.colorAlpha ?? 1))
  }

  addPoint(documentPoint: DocumentPoint, pressure: number): void {
    if (this.ended) return
    if (this.colorAlpha <= 0 || this.settings.opacity <= 0) return
    const local = transformPoint(this.inverseMatrix, documentPoint)
    const normalizedPressure = Math.max(0.01, Math.min(1, pressure > 0 ? pressure : this.lastPoint?.pressure ?? 1))
    if (!this.lastPoint) {
      if (this.mode === 'pencil') this.pencilDab(Math.floor(local.x), Math.floor(local.y))
      else this.brushDab(local, normalizedPressure)
      this.distanceToNextDab = this.brushSpacing()
      this.flushDirty()
      this.lastPoint = { local, pressure: normalizedPressure }
      return
    }
    if (this.mode === 'pencil') {
      const from = { x: Math.floor(this.lastPoint.local.x), y: Math.floor(this.lastPoint.local.y) }
      const to = { x: Math.floor(local.x), y: Math.floor(local.y) }
      let first = true
      for (const pixel of pencilLine(from, to)) {
        if (first) { first = false; continue }
        this.pencilDab(pixel.x, pixel.y)
      }
    } else {
      const distance = Math.hypot(local.x - this.lastPoint.local.x, local.y - this.lastPoint.local.y)
      let traveled = this.distanceToNextDab
      while (traveled <= distance && distance > 0) {
        const ratio = traveled / distance
        this.brushDab({
          x: this.lastPoint.local.x + (local.x - this.lastPoint.local.x) * ratio,
          y: this.lastPoint.local.y + (local.y - this.lastPoint.local.y) * ratio,
        }, this.lastPoint.pressure + (normalizedPressure - this.lastPoint.pressure) * ratio)
        traveled += this.brushSpacing()
      }
      this.distanceToNextDab = traveled - distance
    }
    this.flushDirty()
    this.lastPoint = { local, pressure: normalizedPressure }
  }

  finish(): PixelStrokeCommand | null {
    if (this.ended) return null
    this.ended = true
    if (!this.hasPainted) { this.restoreOriginalSource(); return null }
    const patches: TilePatch[] = []
    this.tiles.forEach(({ x, y, before, after }) => {
      const changed = cropChangedPatch(x, y, before, after)
      if (changed) patches.push(changed)
    })
    if (patches.length === 0) { this.restoreOriginalSource(); return null }
    return new PixelStrokeCommand(this.layer.id, this.originalSourceId, this.sourceId, patches, this.canvas.width * this.canvas.height * 4 + (this.expansion?.maskBytes ?? 0), this.target, this.expansion)
  }

  /** Escape, pointer-cancel, and focus loss discard every uncommitted dab. */
  abort(): void {
    if (this.ended) return
    this.ended = true
    if (this.originalSourceId === this.sourceId) {
      let restored: DocumentRect | null = null
      for (const tile of this.tiles.values()) this.context.putImageData(tile.before, tile.x, tile.y)
      for (const tile of this.tiles.values()) restored = unionRect(restored, { x: tile.x, y: tile.y, width: tile.before.width, height: tile.before.height })
      if (restored) this.sources.touch(this.sourceId, restored)
    } else this.restoreOriginalSource()
  }

  private restoreOriginalSource(): void {
    if (this.originalSourceId === this.sourceId) return
    if (this.target === 'mask' && this.layer.mask && this.originalSourceId) this.layer.mask.pixelSourceId = this.originalSourceId
    else this.layer.pixelSourceId = this.originalSourceId
    this.expansion?.restore(this.layer)
    this.sources.remove(this.sourceId)
    if (this.expansion?.maskSourceId) this.sources.remove(this.expansion.maskSourceId)
  }

  private brushSpacing(): number {
    const settings = this.settings as BrushSettings
    return Math.max(0.25, settings.diameter * Math.max(0.01, Math.min(2, settings.spacing ?? 0.12)))
  }

  private brushDab(point: DocumentPoint, pressure: number): void {
    const settings = this.settings as BrushSettings
    const radius = Math.max(0.5, settings.diameter * Math.max(0.1, pressure) / 2)
    const inner = Math.max(0, Math.min(1, settings.hardness)) * radius
    const flow = Math.max(0, Math.min(1, settings.flow ?? 1)) * pressure
    if (flow <= 0) return
    const left = Math.max(0, Math.floor(point.x - radius - 1))
    const top = Math.max(0, Math.floor(point.y - radius - 1))
    const right = Math.min(this.canvas.width - 1, Math.ceil(point.x + radius + 1))
    const bottom = Math.min(this.canvas.height - 1, Math.ceil(point.y + radius + 1))
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const distance = Math.hypot(x + 0.5 - point.x, y + 0.5 - point.y)
      // One-pixel edge coverage keeps round tips smooth even at 100% hardness.
      const outer = Math.min(1, Math.max(0, radius + 0.5 - distance))
      if (outer <= 0) continue
      const softness = distance <= inner ? 1 : inner >= radius ? 1 : Math.max(0, (radius + 0.5 - distance) / (radius + 0.5 - inner))
      this.paintPixel(x, y, flow * outer * softness)
    }
  }

  private pencilDab(x: number, y: number): void {
    const size = Math.max(1, Math.round(this.settings.diameter))
    const left = x - Math.floor((size - 1) / 2)
    const top = y - Math.floor((size - 1) / 2)
    for (let row = top; row < top + size; row++) for (let column = left; column < left + size; column++) this.paintPixel(column, row, 1)
  }

  private paintPixel(x: number, y: number, strength: number): void {
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height || strength <= 0) return
    const documentPoint = transformPoint(this.worldMatrix, { x: x + 0.5, y: y + 0.5 })
    if (documentPoint.x < 0 || documentPoint.y < 0
      || documentPoint.x >= this.documentBounds.width || documentPoint.y >= this.documentBounds.height) return
    let maskAlpha = 1
    if (this.selection) {
      maskAlpha = this.selection.coverageAt(documentPoint.x, documentPoint.y) / 255
      if (maskAlpha <= 0) return
    }
    const tileX = Math.floor(x / TILE_SIZE), tileY = Math.floor(y / TILE_SIZE)
    const key = `${tileX}:${tileY}`
    let tile = this.tiles.get(key)
    if (!tile) {
      const pixelX = tileX * TILE_SIZE, pixelY = tileY * TILE_SIZE
      const width = Math.min(TILE_SIZE, this.canvas.width - pixelX), height = Math.min(TILE_SIZE, this.canvas.height - pixelY)
      const before = this.context.getImageData(pixelX, pixelY, width, height)
      const after = new ImageData(new Uint8ClampedArray(before.data), width, height)
      tile = { x: pixelX, y: pixelY, before, after, coverage: new Uint8Array(width * height) }
      this.tiles.set(key, tile)
    }
    const pixel = (y - tile.y) * tile.before.width + x - tile.x
    const previous = (tile.coverage[pixel] ?? 0) / 255
    const coverage = Math.round(accumulateCoverage(previous, strength) * 255)
    if (coverage <= (tile.coverage[pixel] ?? 0)) return
    tile.coverage[pixel] = coverage
    const offset = pixel * 4
    const before: [number, number, number, number] = [tile.before.data[offset] ?? 0, tile.before.data[offset + 1] ?? 0, tile.before.data[offset + 2] ?? 0, tile.before.data[offset + 3] ?? 0]
    const alpha = Math.max(0, Math.min(1, this.settings.opacity)) * this.colorAlpha * coverage / 255 * maskAlpha
    const result = composeStrokePixel(before, this.color, alpha, this.mode === 'eraser')
    tile.after.data.set(result, offset)
    this.dirtyTiles.add(key)
    this.pendingDirty = unionRect(this.pendingDirty, { x, y, width: 1, height: 1 })
    this.hasPainted = true
  }

  private flushDirty(): void {
    if (!this.pendingDirty) return
    for (const key of this.dirtyTiles) {
      const tile = this.tiles.get(key)
      if (tile) this.context.putImageData(tile.after, tile.x, tile.y)
    }
    this.dirtyTiles.clear()
    this.sources.touch(this.sourceId, this.pendingDirty)
    this.pendingDirty = null
  }
}

export class PixelStrokeCommand implements Command {
  readonly label: string
  readonly memoryCost: number

  constructor(
    private readonly layerId: string,
    private readonly originalSourceId: string | null,
    private readonly editedSourceId: string,
    private readonly patches: readonly TilePatch[],
    sourceBytes: number,
    private readonly target: 'pixels' | 'mask' = 'pixels',
    private readonly expansion: PaintSurfaceExpansion | null = null,
  ) {
    this.label = target === 'mask' ? 'Paint Layer Mask' : 'Raster Stroke'
    const patchBytes = patches.reduce((sum, patch) => sum + patch.before.data.byteLength + patch.after.data.byteLength, 0)
    this.memoryCost = originalSourceId === editedSourceId ? patchBytes : sourceBytes + patchBytes
  }

  execute(editor: EditorCore): void {
    const layer = editor.layers.find(this.layerId)
    if (!layer || layer.kind !== 'raster') return
    if (this.originalSourceId !== this.editedSourceId) {
      if (this.target === 'mask' && layer.mask) layer.mask.pixelSourceId = this.editedSourceId
      else layer.pixelSourceId = this.editedSourceId
    }
    else applyPatches(this.editedSourceId, this.patches, 'after')
    this.expansion?.apply(layer)
    editor.markDocumentChanged()
  }

  undo(editor: EditorCore): void {
    const layer = editor.layers.find(this.layerId)
    if (!layer || layer.kind !== 'raster') return
    if (this.originalSourceId !== this.editedSourceId) {
      if (this.target === 'mask' && layer.mask && this.originalSourceId) layer.mask.pixelSourceId = this.originalSourceId
      else layer.pixelSourceId = this.originalSourceId
    }
    else applyPatches(this.editedSourceId, this.patches, 'before')
    this.expansion?.restore(layer)
    editor.markDocumentChanged()
  }
}

function applyPatches(sourceId: string, patches: readonly TilePatch[], state: 'before' | 'after'): void {
  const canvas = rasterSources.getEditableCanvas(sourceId)
  const context = canvas?.getContext('2d')
  if (!context) return
  let dirty: DocumentRect | null = null
  patches.forEach((patch) => { context.putImageData(patch[state], patch.x, patch.y); dirty = unionRect(dirty, { x: patch.x, y: patch.y, width: patch[state].width, height: patch[state].height }) })
  rasterSources.touch(sourceId, dirty ?? undefined)
}

function countSourceReferences(layers: readonly Layer[], sourceId: string): number {
  return layers.reduce((count, layer) => count + (layer.kind === 'group'
    ? countSourceReferences(layer.children, sourceId)
    : layer.kind === 'raster' && layer.pixelSourceId === sourceId ? 1 : 0) + (layer.mask?.pixelSourceId === sourceId ? 1 : 0), 0)
}

function parseColor(color: string): readonly [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('The drawing color must be a six-digit HEX value')
  return [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)]
}

function unionRect(a: DocumentRect | null, b: DocumentRect): DocumentRect {
  if (!a) return { ...b }
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

/** Retains only changed pixels inside a touched tile; sparse strokes stay small in history. */
function cropChangedPatch(x: number, y: number, before: ImageData, after: ImageData): TilePatch | null {
  let left = before.width, top = before.height, right = -1, bottom = -1
  for (let row = 0; row < before.height; row++) {
    for (let column = 0; column < before.width; column++) {
      const index = (row * before.width + column) * 4
      if (before.data[index] === after.data[index] && before.data[index + 1] === after.data[index + 1]
        && before.data[index + 2] === after.data[index + 2] && before.data[index + 3] === after.data[index + 3]) continue
      left = Math.min(left, column); right = Math.max(right, column)
      top = Math.min(top, row); bottom = Math.max(bottom, row)
    }
  }
  if (right < left || bottom < top) return null
  const width = right - left + 1, height = bottom - top + 1
  const oldPixels = new ImageData(width, height), newPixels = new ImageData(width, height)
  for (let row = 0; row < height; row++) {
    const start = ((top + row) * before.width + left) * 4
    oldPixels.data.set(before.data.subarray(start, start + width * 4), row * width * 4)
    newPixels.data.set(after.data.subarray(start, start + width * 4), row * width * 4)
  }
  return { x: x + left, y: y + top, before: oldPixels, after: newPixels }
}
