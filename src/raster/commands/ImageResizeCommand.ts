import type { Command } from '../../core/commands/Command'
import type { EditorCore } from '../../core/EditorCore'
import type { Layer, LayerTransform, LayerImageCrop } from '../../core/model/types'
import type { SelectionMask } from '../../core/selection/SelectionMask'
import { rasterSources } from '../RasterSourceRegistry'
import { validateDimensions } from '../../core/commands/DocumentGeometryCommands'

export type ResizeQuality = 'nearest' | 'low' | 'medium' | 'high'
interface LayerSnapshot { transform: LayerTransform; pixelSourceId?: string | null; maskId?: string; crop?: LayerImageCrop }

export class ImageResizeCommand implements Command {
  readonly label = 'Image Resize'
  private retainedBytes = 0
  private applied = false
  private resizedSourceIds: string[] = []
  get memoryCost(): number { return this.retainedBytes }
  private before: { width: number; height: number; selection: SelectionMask | null; layers: Map<string, LayerSnapshot> } | null = null
  private after: Map<string, LayerSnapshot> | null = null

  constructor(private readonly width: number, private readonly height: number, private readonly quality: ResizeQuality) {}

  execute(editor: EditorCore): void {
    const doc = editor.document
    if (!doc) throw new Error('Open a document first')
    validateDimensions(this.width, this.height)
    if (!this.before) {
      const fx = this.width / doc.dimensions.width, fy = this.height / doc.dimensions.height
      const layers = flatten(doc.layers)
      if (layers.some((layer) => layer.svgMatrix)) throw new Error('Resize layers with SVG matrices by exporting and reimporting first')
      if (Math.abs(fx - fy) > 1e-6 && layers.some((layer) => Math.abs(layer.transform.rotation) > 1e-6))
        throw new Error('Nonuniform resize of rotated layers is not supported')
      const before = new Map<string, LayerSnapshot>()
      const after = new Map<string, LayerSnapshot>()
      const resized = new Map<string, string>()
      const sourceIds = new Set<string>()
      layers.forEach((layer) => {
        if (layer.kind === 'raster' && layer.pixelSourceId) sourceIds.add(layer.pixelSourceId)
        if (layer.mask) sourceIds.add(layer.mask.pixelSourceId)
      })
      let allocated = 0
      for (const id of sourceIds) {
        const source = rasterSources.get(id)
        if (!source) throw new Error(`Missing image source ${id}`)
        const w = Math.max(1, Math.round(source.width * fx)), h = Math.max(1, Math.round(source.height * fy))
        validateDimensions(w, h)
        allocated += w * h * 4
        if (allocated > 128 * 1024 * 1024) throw new Error('Resized layer assets exceed the 128 MB undo budget')
      }
      try {
        for (const id of sourceIds) {
          const source = rasterSources.get(id)!
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(source.width * fx)); canvas.height = Math.max(1, Math.round(source.height * fy))
          const context = canvas.getContext('2d')
          if (!context) throw new Error('2D canvas is unavailable for resize')
          context.imageSmoothingEnabled = this.quality !== 'nearest'
          if (this.quality !== 'nearest') context.imageSmoothingQuality = this.quality
          context.drawImage(source.image, 0, 0, canvas.width, canvas.height)
          resized.set(id, rasterSources.registerCanvas(canvas))
        }
      } catch (error) { for (const id of resized.values()) rasterSources.remove(id); throw error }
      layers.forEach((layer) => {
        const original: LayerSnapshot = { transform: { ...layer.transform } }
        if (layer.kind === 'raster') { original.pixelSourceId = layer.pixelSourceId; if (layer.crop) original.crop = { ...layer.crop } }
        if (layer.mask) original.maskId = layer.mask.pixelSourceId
        before.set(layer.id, original)
        const transform = { ...layer.transform, x: layer.transform.x * fx, y: layer.transform.y * fy }
        if (layer.kind === 'text' || layer.kind === 'vector') { transform.scaleX *= fx; transform.scaleY *= fy }
        const next: LayerSnapshot = { transform }
        if (layer.kind === 'raster') {
          next.pixelSourceId = layer.pixelSourceId ? resized.get(layer.pixelSourceId)! : null
          if (layer.crop) next.crop = { x: layer.crop.x * fx, y: layer.crop.y * fy, width: Math.max(1, layer.crop.width * fx), height: Math.max(1, layer.crop.height * fy), offsetX: layer.crop.offsetX * fx, offsetY: layer.crop.offsetY * fy }
        }
        if (layer.mask) next.maskId = resized.get(layer.mask.pixelSourceId)!
        after.set(layer.id, next)
      })
      this.before = { width: doc.dimensions.width, height: doc.dimensions.height, selection: editor.selection, layers: before }
      this.after = after
      this.retainedBytes = allocated
      this.resizedSourceIds = [...resized.values()]
    }
    apply(editor, this.width, this.height, this.after!, null)
    this.applied = true
  }

  undo(editor: EditorCore): void {
    if (this.before) {
      apply(editor, this.before.width, this.before.height, this.before.layers, this.before.selection)
      this.applied = false
    }
  }

  dispose(): void {
    if (!this.applied) this.resizedSourceIds.forEach((id) => rasterSources.remove(id))
    this.resizedSourceIds = []
  }
}

function apply(editor: EditorCore, width: number, height: number, states: ReadonlyMap<string, LayerSnapshot>, selection: SelectionMask | null): void {
  const doc = editor.document
  if (!doc) return
  doc.dimensions.width = width; doc.dimensions.height = height
  flatten(doc.layers).forEach((layer) => {
    const state = states.get(layer.id)
    if (!state) return
    layer.transform = { ...state.transform }
    if (layer.kind === 'raster') { layer.pixelSourceId = state.pixelSourceId ?? null; if (state.crop) layer.crop = { ...state.crop }; else delete layer.crop }
    if (layer.mask && state.maskId) layer.mask.pixelSourceId = state.maskId
  })
  editor.setSelection(selection)
  editor.markDocumentChanged()
}

function flatten(layers: readonly Layer[]): Layer[] { return layers.flatMap((layer) => layer.kind === 'group' ? [layer, ...flatten(layer.children)] : [layer]) }
