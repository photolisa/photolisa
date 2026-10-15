import type { Command } from '../../core/commands/Command'
import type { EditorCore } from '../../core/EditorCore'
import type { LayerMask, RasterLayer } from '../../core/model/types'
import type { SelectionMask } from '../../core/selection/SelectionMask'
import { editableRasterWorldMatrix, transformPoint } from '../../core/geometry/LayerCoordinates'
import { rasterSources } from '../RasterSourceRegistry'

export type MaskCreation = 'reveal-all' | 'reveal-selection' | 'hide-selection'

export class CreateLayerMaskCommand implements Command {
  readonly label = 'Create Layer Mask'
  private created: LayerMask | null = null
  private previous: LayerMask | null = null
  readonly memoryCost: number

  constructor(private readonly layerId: string, private readonly mode: MaskCreation, private readonly selection: SelectionMask | null,
    private readonly width: number, private readonly height: number) {
    this.memoryCost = width * height * 4
  }

  execute(editor: EditorCore): void {
    const layer = requireRaster(editor, this.layerId)
    if (layer.locked) throw new Error('Unlock the layer before changing its mask')
    if (!this.created) {
      if (!Number.isSafeInteger(this.width * this.height) || this.width * this.height > 67_108_864) throw new Error('Mask exceeds the pixel safety limit')
      const matrix = editableRasterWorldMatrix(editor.document!.layers, layer.id)
      if (!matrix) throw new Error('The layer cannot be masked')
      const canvas = document.createElement('canvas'); canvas.width = this.width; canvas.height = this.height
      const context = canvas.getContext('2d'); if (!context) throw new Error('2D canvas is unavailable')
      const image = context.createImageData(this.width, this.height)
      for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
        const point = transformPoint(matrix, { x: x + 0.5, y: y + 0.5 })
        const coverage = this.selection?.coverageAt(point.x, point.y) ?? 0
        const value = this.mode === 'reveal-all' ? 255 : this.mode === 'reveal-selection' ? coverage : 255 - coverage
        const offset = (y * this.width + x) * 4
        image.data[offset] = value; image.data[offset + 1] = value; image.data[offset + 2] = value; image.data[offset + 3] = 255
      }
      context.putImageData(image, 0, 0)
      this.created = { pixelSourceId: rasterSources.registerCanvas(canvas), enabled: true, inverted: false }
      this.previous = layer.mask ? { ...layer.mask } : null
    }
    layer.mask = { ...this.created }
    editor.markDocumentChanged()
  }

  undo(editor: EditorCore): void { requireRaster(editor, this.layerId).mask = this.previous ? { ...this.previous } : null; editor.markDocumentChanged() }
}

export class SetLayerMaskCommand implements Command {
  readonly label: string
  private before: LayerMask | null = null
  constructor(private readonly layerId: string, private readonly action: 'enable' | 'disable' | 'invert' | 'remove') {
    this.label = `${action[0]?.toUpperCase() ?? ''}${action.slice(1)} Layer Mask`
  }
  execute(editor: EditorCore): void {
    const layer = requireRaster(editor, this.layerId)
    if (layer.locked) throw new Error('Unlock the layer before changing its mask')
    this.before ??= layer.mask ? { ...layer.mask } : null
    if (!layer.mask) throw new Error('The layer has no mask')
    if (this.action === 'remove') layer.mask = null
    else if (this.action === 'invert') layer.mask.inverted = !this.before?.inverted
    else layer.mask.enabled = this.action === 'enable'
    editor.markDocumentChanged()
  }
  undo(editor: EditorCore): void { requireRaster(editor, this.layerId).mask = this.before ? { ...this.before } : null; editor.markDocumentChanged() }
}

function requireRaster(editor: EditorCore, id: string): RasterLayer {
  const layer = editor.layers.find(id)
  if (!layer || layer.kind !== 'raster') throw new Error('Select a raster layer')
  return layer
}
